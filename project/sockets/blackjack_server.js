const config = require("../game/config");
const coins = require("../game/coins");
const bj = require("../game/blackjack");
const casinoChat = require("../game/casino_chat");
const socketAuth = require("./socket_auth");
const safe = require("./safe_handler");
const version = require("../game/version");
const persist = require("../game/persist");
const live = require("../game/live");

const ROOM = "blackjack";

/*
 * Hidden blackjack: a lobby with a few tables (BJ_TABLES, each with its own
 * limits), everybody at a table against the dealer. A player sits down on a
 * seat and bets on it (a second seat only once the first one has a bet), then
 * every hand is played in turn (hit, stand, double, split), then the dealer
 * draws to 17. Blackjack pays 3:2. A seat without a bet stands up by itself,
 * and so does a player who leaves the page (unless the cards are dealt).
 * Seat 0 is the right one (seen from the players): the cards go round
 * clockwise from there, like at a real table.
 * The dealer's second card stays on the server until it is turned.
 *
 * A page picks its table with the handshake query `table` (none: the default
 * table, "lobby": no table - only the overview of all tables).
 */
module.exports = function (io) {
  const room = io.of("/blackjack");
  room.use(socketAuth.casino);
  casinoChat.attach(room, ROOM);

  const tables = new Map(config.BJ_TABLES.map((def) => [def.id, createTable(def)]));
  const LOBBY = "lobby";

  function tableOf(socket) {
    return tables.get(socket.data.bjTable) || null;
  }

  // The lobby: every table in short (free seats, players, limits)
  function summaries(viewer) {
    return [...tables.values()].map((t) => t.summary(viewer));
  }

  function emitLobby() {
    for (const socket of room.sockets.values()) {
      if (socket.data.bjTable === LOBBY) socket.emit("blackjackTables", summaries(socket.data.username));
    }
  }

  function createTable(def) {
    // The limits per seat (can be changed in the admin panel)
    const minBet = () => config[def.minKey];
    const maxBet = () => config[def.maxKey];

    const table = {
      id: def.id,
      round: 1,
      phase: "betting", // betting | playing | dealer | result
      seats: new Array(config.BJ_SEATS).fill(null), // {name, bet, standAt, standTimer, hands: [{cards, bet, split, doubled, done, result, payout}]}
      dealer: { cards: [], hidden: true },
      shoe: [],
      current: null, // {seat, hand}
      turnAt: null,
      startAt: null, // betting ends
      timer: null,
      turnTimer: null,
      history: [], // [{round, dealer, results: [{name, result, payout, bet}]}] newest first
      lastBets: new Map(), // username -> [{seat, amount}] of the last round played (for "same bet")
      leaveTimers: new Map(), // username -> gone from the page: stands up soon
    };
    const busy = new Set();

    // The open pages of this table
    function pages() {
      return [...room.sockets.values()].filter((socket) => socket.data.bjTable === def.id);
    }

    /* ---------- State ---------- */

    function connected(name) {
      return pages().some((socket) => socket.data.username === name);
    }

    function serialize(viewer) {
      const hidden = table.dealer.hidden && table.dealer.cards.length > 1;
      const dealerCards = hidden ? [table.dealer.cards[0], null] : table.dealer.cards;
      const visible = dealerCards.filter((card) => card != null);
      return {
        table: { id: def.id, name: def.name, icon: def.icon },
        round: table.round,
        phase: table.phase,
        seats: table.seats.map(
          (seat) =>
            seat && {
              name: seat.name,
              bet: seat.bet,
              standIn: seat.standAt != null ? Math.max(0, seat.standAt - Date.now()) : null,
              hands: seat.hands.map((hand) => ({
                cards: hand.cards,
                bet: hand.bet,
                value: bj.handValue(hand.cards),
                blackjack: bj.isBlackjack(hand.cards, hand.split),
                doubled: hand.doubled,
                done: hand.done,
                result: hand.result || null,
                payout: hand.payout || 0,
              })),
            },
        ),
        dealer: { cards: dealerCards, value: visible.length ? bj.handValue(visible) : null, hidden: hidden },
        current: table.current,
        turnIn: table.turnAt != null ? Math.max(0, table.turnAt - Date.now()) : null,
        startIn: table.startAt != null ? Math.max(0, table.startAt - Date.now()) : null,
        history: table.history,
        viewers: pages().length,
        rules: { minBet: minBet(), maxBet: maxBet(), mySeats: config.BJ_MY_SEATS, turn: config.BJ_TURN, betting: config.BJ_BETTING, sit: config.BJ_SIT, decks: bj.DECKS },
        lastBets: table.lastBets.get(viewer) || null,
      };
    }

    function emitState() {
      for (const socket of pages()) socket.emit("blackjackState", serialize(socket.data.username));
      emitLobby();
      persist.changed("blackjack");
    }

    // For the lobby
    function summary(viewer) {
      const players = new Set(table.seats.filter(Boolean).map((seat) => seat.name));
      return {
        id: def.id,
        name: def.name,
        icon: def.icon,
        about: def.about,
        minBet: minBet(),
        maxBet: maxBet(),
        seats: table.seats.length,
        free: table.seats.filter((seat) => seat == null).length,
        players: [...players],
        mine: table.seats.filter((seat) => seat && seat.name === viewer).length,
        phase: table.phase,
        round: table.round,
        watching: pages().length,
      };
    }

    /* ---------- Round ---------- */

    function playing() {
      return table.seats.map((seat, i) => (seat && seat.bet > 0 ? i : -1)).filter((i) => i >= 0);
    }

    function draw() {
      return table.shoe.pop();
    }

    /* ---------- Seats ---------- */

    // Without a bet a seat is only kept for a while (in the betting time)
    function startStandTimer(i, after = config.BJ_SIT) {
      const seat = table.seats[i];
      clearTimeout(seat.standTimer);
      seat.standAt = Date.now() + after;
      seat.standTimer = setTimeout(() => {
        if (table.seats[i] !== seat || seat.bet > 0 || table.phase !== "betting") return;
        standUp(i);
        emitState();
      }, after);
    }

    function stopStandTimer(seat) {
      clearTimeout(seat.standTimer);
      seat.standTimer = null;
      seat.standAt = null;
    }

    function standUp(i) {
      const seat = table.seats[i];
      if (seat == null) return;
      stopStandTimer(seat);
      table.seats[i] = null;
    }

    function startBetting() {
      if (table.startAt != null) return;
      table.startAt = Date.now() + config.BJ_BETTING;
      table.timer = setTimeout(deal, config.BJ_BETTING);
    }

    function deal() {
      clearTimeout(table.timer);
      table.startAt = null;
      // No bet on it: the player stands up
      table.seats.forEach((seat, i) => {
        if (seat == null) return;
        if (seat.bet > 0) stopStandTimer(seat);
        else standUp(i);
      });
      const seats = playing();
      // What everybody bet this round: one click to bet it again next round
      const bets = new Map();
      seats.forEach((i) => {
        const seat = table.seats[i];
        if (!bets.has(seat.name)) bets.set(seat.name, []);
        bets.get(seat.name).push({ seat: i, amount: seat.bet });
      });
      bets.forEach((list, name) => table.lastBets.set(name, list));
      if (seats.length === 0) {
        table.phase = "betting";
        emitState();
        return;
      }
      // A new shoe for every round: nothing to count
      table.shoe = bj.newShoe();
      seats.forEach((i) => (table.seats[i].hands = [{ cards: [], bet: table.seats[i].bet, split: false, doubled: false, done: false }]));
      table.dealer = { cards: [], hidden: true };
      for (let n = 0; n < 2; n++) {
        seats.forEach((i) => table.seats[i].hands[0].cards.push(draw()));
        table.dealer.cards.push(draw());
      }
      table.phase = "playing";

      // The dealer looks at the second card when the first is an ace or worth 10
      if (bj.cardValue(table.dealer.cards[0]) >= 10 && bj.isBlackjack(table.dealer.cards, false)) {
        seats.forEach((i) => table.seats[i].hands.forEach((hand) => (hand.done = true)));
        return finishRound();
      }
      // A blackjack is done right away
      seats.forEach((i) => {
        const hand = table.seats[i].hands[0];
        if (bj.isBlackjack(hand.cards, false)) hand.done = true;
      });
      nextTurn();
    }

    // The next hand that still has to play (seat by seat, hand by hand)
    function nextTurn() {
      clearTimeout(table.turnTimer);
      for (const i of playing()) {
        const hands = table.seats[i].hands;
        for (let h = 0; h < hands.length; h++) {
          if (!hands[h].done) {
            table.current = { seat: i, hand: h };
            // Nobody at the page: no long wait for the others
            armTurn(i, h, connected(table.seats[i].name) ? config.BJ_TURN : 1500);
            emitState();
            return;
          }
        }
      }
      table.current = null;
      table.turnAt = null;
      dealerTurn();
    }

    // The time for a hand: then it stands
    function armTurn(i, h, time) {
      clearTimeout(table.turnTimer);
      table.turnAt = Date.now() + time;
      const round = table.round;
      table.turnTimer = setTimeout(() => {
        if (table.round !== round || !table.current || table.current.seat !== i || table.current.hand !== h) return;
        table.seats[i].hands[h].done = true;
        nextTurn();
      }, time);
    }

    // The dealer turns the card and draws to 17 (one card after the other)
    function dealerTurn() {
      table.phase = "dealer";
      table.dealer.hidden = false;
      emitState();
      // Everybody bust: no need to draw
      const open = playing().some((i) => table.seats[i].hands.some((hand) => bj.handValue(hand.cards).total <= 21));
      const step = () => {
        if (open && bj.dealerHits(table.dealer.cards)) {
          table.dealer.cards.push(draw());
          emitState();
          table.timer = setTimeout(step, config.BJ_STEP);
        } else {
          table.timer = setTimeout(finishRound, config.BJ_STEP);
        }
      };
      table.timer = setTimeout(step, config.BJ_STEP);
    }

    function finishRound() {
      clearTimeout(table.turnTimer);
      table.phase = "result";
      table.dealer.hidden = false;
      table.current = null;
      table.turnAt = null;
      const results = [];
      for (const i of playing()) {
        const seat = table.seats[i];
        for (const hand of seat.hands) {
          const { result, payout } = bj.settle(hand, table.dealer.cards);
          hand.result = result;
          hand.payout = payout;
          hand.done = true;
          if (payout > 0) coins.add(seat.name, payout, { reason: "blackjack win", note: result }).catch((error) => console.error("[blackjack] Could not pay:", error));
          results.push({ name: seat.name, result: result, bet: hand.bet, payout: payout });
        }
      }
      table.history.unshift({ round: table.round, dealer: bj.handValue(table.dealer.cards).total, results: results });
      table.history.length = Math.min(table.history.length, config.BJ_HISTORY);
      emitState();
      table.timer = setTimeout(newRound, config.BJ_RESULT);
    }

    function newRound() {
      table.round++;
      table.phase = "betting";
      table.dealer = { cards: [], hidden: true };
      table.current = null;
      table.seats.forEach((seat, i) => {
        if (seat == null) return;
        seat.bet = 0;
        seat.hands = [];
        // Gone from the page: the seat is free again; otherwise a new bet in time
        if (!connected(seat.name)) standUp(i);
        else startStandTimer(i);
      });
      emitState();
    }

    /* ---------- Actions ---------- */

    function act(username, type) {
      if (table.phase !== "playing" || table.current == null) return "It's not your turn.";
      const seat = table.seats[table.current.seat];
      if (seat.name !== username) return "It's not your turn.";
      const hand = seat.hands[table.current.hand];
      if (type === "hit") {
        hand.cards.push(draw());
        if (bj.handValue(hand.cards).total >= 21) hand.done = true;
      } else if (type === "stand") {
        hand.done = true;
      } else {
        return "Unknown action.";
      }
      nextTurn();
      return null;
    }

    // Double and split cost the bet again
    async function actWithCoins(username, type) {
      if (table.phase !== "playing" || table.current == null) return "It's not your turn.";
      const { seat: s, hand: h } = table.current;
      const seat = table.seats[s];
      if (seat.name !== username) return "It's not your turn.";
      const hand = seat.hands[h];
      if (type === "double" && hand.cards.length !== 2) return "Double only on the first two cards.";
      if (type === "split" && (!bj.canSplit(hand.cards) || seat.hands.length >= 4)) return "These cards can't be split.";
      if (busy.has(username)) return null;
      busy.add(username);
      try {
        if (!(await coins.spend(username, hand.bet, { reason: "blackjack bet", note: type }))) return "You don't have enough coins.";
        // Still the same hand after the payment?
        if (table.current == null || table.current.seat !== s || table.current.hand !== h || table.seats[s] !== seat) {
          await coins.add(username, hand.bet, { reason: "blackjack refund" });
          return "Too late.";
        }
        if (type === "double") {
          hand.bet *= 2;
          hand.doubled = true;
          hand.cards.push(draw());
          hand.done = true;
        } else {
          const second = { cards: [hand.cards.pop()], bet: hand.bet, split: true, doubled: false, done: false };
          hand.split = true;
          hand.cards.push(draw());
          second.cards.push(draw());
          seat.hands.splice(h + 1, 0, second);
          // Split aces: one card each, that's it
          if (hand.cards[0][0] === "A") {
            hand.done = true;
            second.done = true;
          }
          if (bj.handValue(hand.cards).total === 21) hand.done = true;
        }
        nextTurn();
        return null;
      } finally {
        busy.delete(username);
      }
    }

    /* ---------- Actions of a player ---------- */

    const handlers = {
      // Sit down on a free seat - a second one only when the others have a bet
      sit(username, error, s) {
        if (!Number.isInteger(s) || s < 0 || s >= table.seats.length) return;
        if (table.seats[s]) return table.seats[s].name === username ? undefined : error("This seat is taken.");
        const mine = table.seats.filter((seat) => seat && seat.name === username);
        if (mine.some((seat) => seat.bet === 0)) return error("Bet on your seat first, then take another one.");
        if (mine.length >= config.BJ_MY_SEATS) return error(`At most ${config.BJ_MY_SEATS} seats at a time.`);
        table.seats[s] = { name: username, bet: 0, hands: [], standAt: null, standTimer: null };
        // During a round: the stand-up time starts with the next betting time
        if (table.phase === "betting") startStandTimer(s);
        emitState();
      },

      // A bet on an own seat: more coins on it
      async bet(username, error, data) {
        if (data == null) return;
        const { seat: s, amount } = data;
        if (!Number.isInteger(s) || s < 0 || s >= table.seats.length || !Number.isInteger(amount) || amount <= 0) return;
        if (table.phase !== "betting") return error("Wait for the next round.");
        const seat = table.seats[s];
        if (seat == null) return error("Sit down first.");
        if (seat.name !== username) return error("This seat is taken.");
        const total = seat.bet + amount;
        if (total < minBet()) return error(`At least ${minBet().toLocaleString("en-US")} coins.`);
        if (total > maxBet()) return error(`At most ${maxBet().toLocaleString("en-US")} coins per seat.`);
        if (busy.has(username)) return;
        busy.add(username);
        try {
          if (!(await coins.spend(username, amount, { reason: "blackjack bet" }))) return error("You don't have enough coins.");
          // The round started, or the player stood up meanwhile
          if (table.phase !== "betting" || table.seats[s] !== seat) {
            await coins.add(username, amount, { reason: "blackjack refund" });
            return error("Too late for this seat.");
          }
          seat.bet += amount;
          stopStandTimer(seat);
          startBetting();
          emitState();
        } finally {
          busy.delete(username);
        }
      },

      /*
       * The same bets as last round, with one click. The seats: first the ones
       * the player sits on right now, then the old ones (if free), then the
       * nearest free ones - never more than BJ_MY_SEATS seats together.
       */
      async rebet(username, error) {
        const last = table.lastBets.get(username);
        if (!last || last.length === 0) return error("No bet to repeat yet.");
        if (table.phase !== "betting") return error("Wait for the next round.");
        if (table.seats.some((seat) => seat && seat.name === username && seat.bet > 0)) return error("You already bet this round.");
        if (busy.has(username)) return;
        busy.add(username);
        try {
          const total = last.reduce((sum, bet) => sum + bet.amount, 0);
          if (!(await coins.spend(username, total, { reason: "blackjack bet", note: "same bet" }))) return error("You don't have enough coins.");
          // The seats now (the round may have started, others may have sat down meanwhile)
          let refund = 0;
          let placed = 0;
          const own = (i) => table.seats[i] != null && table.seats[i].name === username && table.seats[i].bet === 0;
          const indexes = table.seats.map((_, i) => i);
          for (const bet of last) {
            const held = table.seats.filter((seat) => seat && seat.name === username).length;
            const order = [
              ...indexes.filter(own),
              ...(Number.isInteger(bet.seat) && bet.seat >= 0 && bet.seat < table.seats.length ? [bet.seat] : []),
              ...indexes.slice().sort((x, y) => Math.abs(x - bet.seat) - Math.abs(y - bet.seat) || x - y),
            ];
            const s = table.phase === "betting" ? order.find((i) => own(i) || (table.seats[i] == null && held < config.BJ_MY_SEATS)) : undefined;
            if (s === undefined) {
              refund += bet.amount;
              continue;
            }
            if (table.seats[s] == null) table.seats[s] = { name: username, bet: 0, hands: [], standAt: null, standTimer: null };
            table.seats[s].bet = bet.amount;
            stopStandTimer(table.seats[s]);
            placed++;
          }
          if (refund > 0) {
            await coins.add(username, refund, { reason: "blackjack refund" });
            error(placed ? "Not every seat was free - the rest is back." : "No free seat - the coins are back.");
          }
          if (placed) startBetting();
          emitState();
        } finally {
          busy.delete(username);
        }
      },

      // Stand up (while betting, or before the own seat plays): the bet comes back
      async clearBet(username, error, s) {
        const seat = table.seats[s];
        if (!seat || seat.name !== username) return;
        if (table.phase !== "betting" && seat.hands.length > 0) return;
        await leaveSeat(s);
        emitState();
      },

      async action(username, error, type) {
        const problem = type === "double" || type === "split" ? await actWithCoins(username, type) : act(username, type);
        if (problem) error(problem);
      },
    };

    // Off a seat that isn't dealt in: the bet comes back
    async function leaveSeat(s) {
      const seat = table.seats[s];
      if (!seat || (table.phase !== "betting" && seat.hands.length > 0)) return;
      standUp(s);
      if (playing().length === 0 && table.phase === "betting") {
        clearTimeout(table.timer);
        table.startAt = null;
      }
      if (seat.bet > 0) await coins.add(seat.name, seat.bet, { reason: "blackjack refund" });
    }

    // A page of this table opened: back in time, the seats stay
    function joined(username) {
      clearTimeout(table.leaveTimers.get(username));
      table.leaveTimers.delete(username);
      emitState();
    }

    // The last page of a player is gone (another page, tab closed): off the
    // seats after a short wait (a reload keeps them). Seats in a dealt round
    // stay - the next round frees them.
    function left(username) {
      if (connected(username)) return emitState();
      clearTimeout(table.leaveTimers.get(username));
      const timer = setTimeout(async () => {
        table.leaveTimers.delete(username);
        if (connected(username)) return;
        const seats = table.seats.map((seat, i) => (seat && seat.name === username ? i : -1)).filter((i) => i >= 0);
        try {
          for (const i of seats) await leaveSeat(i);
        } finally {
          emitState();
        }
      }, config.CASINO_LEAVE);
      timer.unref();
      table.leaveTimers.set(username, timer);
      emitState();
    }

    // The server stops: every bet that isn't paid out yet goes back
    async function refundAll() {
      clearTimeout(table.timer);
      clearTimeout(table.turnTimer);
      table.leaveTimers.forEach((timer) => clearTimeout(timer));
      table.leaveTimers.clear();
      const payments = [];
      if (table.phase !== "result") {
        table.seats.forEach((seat) => {
          if (seat == null) return;
          const amount = seat.hands.length ? seat.hands.reduce((sum, hand) => sum + hand.bet, 0) : seat.bet;
          if (amount > 0) payments.push(coins.add(seat.name, amount, { reason: "blackjack refund", note: "server stop" }).catch(() => {}));
        });
      }
      table.seats.forEach((seat) => seat && stopStandTimer(seat));
      table.seats.fill(null);
      await Promise.all(payments);
    }

    /* ---------- Restart of the server ---------- */

    function snapshot() {
      return {
        round: table.round,
        phase: table.phase,
        seats: table.seats,
        dealer: table.dealer,
        shoe: table.shoe,
        current: table.current,
        turnAt: table.turnAt,
        startAt: table.startAt,
        history: table.history,
        lastBets: table.lastBets,
      };
    }

    // The saved table again: the round goes on where it was (with a little time to come back)
    function restore(saved) {
      clearTimeout(table.timer);
      clearTimeout(table.turnTimer);
      table.seats.forEach((seat) => seat && clearTimeout(seat.standTimer));
      Object.assign(table, saved, { id: def.id, timer: null, turnTimer: null, leaveTimers: new Map() });
      if (!(table.lastBets instanceof Map)) table.lastBets = new Map();
      // Saved with another number of seats: the seats too many go (their bets back)
      if (!Array.isArray(table.seats)) table.seats = [];
      table.seats.slice(config.BJ_SEATS).forEach((seat) => {
        if (seat == null) return;
        const amount = seat.hands && seat.hands.length ? seat.hands.reduce((sum, hand) => sum + hand.bet, 0) : seat.bet;
        if (amount > 0 && table.phase !== "result") coins.add(seat.name, amount, { reason: "blackjack refund", note: "table changed" }).catch(() => {});
      });
      table.seats = table.seats.slice(0, config.BJ_SEATS).concat(new Array(Math.max(0, config.BJ_SEATS - table.seats.length)).fill(null));
      if (table.current && table.current.seat >= config.BJ_SEATS) table.current = null;
      const now = Date.now();
      const grace = config.RESTORE_GRACE;
      const left = (at) => Math.max(grace, (at || 0) - now);
      table.seats.forEach((seat) => seat && (seat.standTimer = null));
      if (table.phase === "betting") {
        if (table.startAt != null) {
          const after = left(table.startAt);
          table.startAt = now + after;
          table.timer = setTimeout(deal, after);
        }
        table.seats.forEach((seat, i) => seat && seat.bet === 0 && seat.standAt != null && startStandTimer(i, left(seat.standAt)));
      } else if (table.phase === "playing") {
        if (table.current) armTurn(table.current.seat, table.current.hand, left(table.turnAt));
        else nextTurn();
      } else if (table.phase === "dealer") {
        dealerTurn();
      } else if (table.phase === "result") {
        table.timer = setTimeout(newRound, config.BJ_RESULT);
      }
      emitState();
    }

    return { def, table, serialize, summary, handlers, joined, left, refundAll, snapshot, restore };
  }

  async function sendCoins(username) {
    const data = await coins.get(username);
    for (const socket of room.sockets.values()) if (socket.data.username === username) socket.emit("coins", data);
  }

  coins.changes.on("change", (username) => sendCoins(username).catch(() => {}));

  /* ---------- Connection ---------- */

  room.on("connection", (socket) => {
    version.announce(socket);
    const username = socket.data.username;
    const wanted = socket.handshake.query && socket.handshake.query.table;
    socket.data.bjTable = wanted === LOBBY ? LOBBY : tables.has(wanted) ? wanted : config.BJ_DEFAULT_TABLE;
    socket.join(ROOM);
    socket.emit("joined", { username: username });
    casinoChat.join(socket);
    sendCoins(username).catch((error) => console.error("[blackjack] Could not load coins:", error));
    const error = (message) => socket.emit("blackjackError", message);
    const current = tableOf(socket);
    if (current) current.joined(username);
    else socket.emit("blackjackTables", summaries(username));

    for (const name of Object.keys(current ? current.handlers : {})) {
      socket.on(
        name,
        safe(name, (data) => current.handlers[name](username, error, data)),
      );
    }

    socket.on(
      "claimBonus",
      safe("claimBonus", async () => {
        if (await coins.claimBonus(username)) socket.emit("bonusClaimed", config.DAILY_BONUS);
        await sendCoins(username);
      }),
    );

    socket.on(
      "sendChatMessage",
      safe("sendChatMessage", (data) => casinoChat.fromUser(socket, data)),
    );

    socket.on(
      "disconnect",
      safe("disconnect", () => {
        if (current) current.left(username);
        else emitLobby();
      }),
    );
  });

  async function refundAll() {
    await Promise.all([...tables.values()].map((t) => t.refundAll()));
  }

  live.register("blackjack", () => [...tables.values()].map((t) => ({ name: t.def.name, icon: t.def.icon, phase: t.table.phase, round: t.table.round, taken: t.table.seats.filter(Boolean).length, seats: t.table.seats.length })));

  persist.register(
    "blackjack",
    () => ({ tables: Object.fromEntries([...tables].map(([id, t]) => [id, t.snapshot()])) }),
    (saved) => {
      // Saved before there were several tables: that one was the default table
      const list = saved && saved.tables ? saved.tables : { [config.BJ_DEFAULT_TABLE]: saved };
      for (const [id, state] of Object.entries(list)) if (tables.has(id) && state) tables.get(id).restore(state);
    },
  );

  const main = tables.get(config.BJ_DEFAULT_TABLE);
  return { table: main.table, tables, refundAll };
};
