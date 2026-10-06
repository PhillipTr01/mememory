const config = require("../game/config");
const coins = require("../game/coins");
const bj = require("../game/blackjack");
const casinoChat = require("../game/casino_chat");
const socketAuth = require("./socket_auth");
const safe = require("./safe_handler");
const version = require("../game/version");

const ROOM = "blackjack";

/*
 * Hidden blackjack: one table, everybody against the dealer. A player sits
 * down on a seat and bets on it (a second seat only once the first one has a
 * bet), then every hand is played in turn (hit, stand, double, split), then
 * the dealer draws to 17. Blackjack pays 3:2. A seat without a bet stands up
 * by itself. Seat 0 is the right one (seen from the players): the cards go
 * round clockwise from there, like at a real table.
 * The dealer's second card stays on the server until it is turned.
 */
module.exports = function (io) {
  const room = io.of("/blackjack");
  room.use(socketAuth.casino);
  casinoChat.attach(room, ROOM);

  const table = {
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
  };
  const busy = new Set();

  /* ---------- State ---------- */

  function connected(name) {
    for (const socket of room.sockets.values()) if (socket.data.username === name) return true;
    return false;
  }

  function serialize(viewer) {
    const hidden = table.dealer.hidden && table.dealer.cards.length > 1;
    const dealerCards = hidden ? [table.dealer.cards[0], null] : table.dealer.cards;
    const visible = dealerCards.filter((card) => card != null);
    return {
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
      viewers: room.sockets.size,
      rules: { minBet: config.BJ_MIN_BET, maxBet: config.BJ_MAX_BET, mySeats: config.BJ_MY_SEATS, turn: config.BJ_TURN, betting: config.BJ_BETTING, sit: config.BJ_SIT, decks: bj.DECKS },
      lastBets: table.lastBets.get(viewer) || null,
    };
  }

  function emitState() {
    for (const socket of room.sockets.values()) socket.emit("blackjackState", serialize(socket.data.username));
  }

  async function sendCoins(username) {
    const data = await coins.get(username);
    for (const socket of room.sockets.values()) if (socket.data.username === username) socket.emit("coins", data);
  }

  coins.changes.on("change", (username) => sendCoins(username).catch(() => {}));

  /* ---------- Round ---------- */

  function playing() {
    return table.seats.map((seat, i) => (seat && seat.bet > 0 ? i : -1)).filter((i) => i >= 0);
  }

  function draw() {
    return table.shoe.pop();
  }

  /* ---------- Seats ---------- */

  // Without a bet a seat is only kept for a while (in the betting time)
  function startStandTimer(i) {
    const seat = table.seats[i];
    clearTimeout(seat.standTimer);
    seat.standAt = Date.now() + config.BJ_SIT;
    seat.standTimer = setTimeout(() => {
      if (table.seats[i] !== seat || seat.bet > 0 || table.phase !== "betting") return;
      standUp(i);
      emitState();
    }, config.BJ_SIT);
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
          const seat = table.seats[i];
          // Nobody at the page: no long wait for the others
          const time = connected(seat.name) ? config.BJ_TURN : 1500;
          table.turnAt = Date.now() + time;
          const round = table.round;
          table.turnTimer = setTimeout(() => {
            if (table.round !== round || !table.current || table.current.seat !== i || table.current.hand !== h) return;
            hands[h].done = true;
            nextTurn();
          }, time);
          emitState();
          return;
        }
      }
    }
    table.current = null;
    table.turnAt = null;
    dealerTurn();
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

  /* ---------- Connection ---------- */

  room.on("connection", (socket) => {
    version.announce(socket);
    const username = socket.data.username;
    socket.join(ROOM);
    socket.emit("joined", { username: username });
    casinoChat.join(socket);
    emitState();
    sendCoins(username).catch((error) => console.error("[blackjack] Could not load coins:", error));
    const error = (message) => socket.emit("blackjackError", message);

    // Sit down on a free seat - a second one only when the others have a bet
    socket.on(
      "sit",
      safe("sit", (s) => {
        if (!Number.isInteger(s) || s < 0 || s >= table.seats.length) return;
        if (table.seats[s]) return table.seats[s].name === username ? undefined : error("This seat is taken.");
        const mine = table.seats.filter((seat) => seat && seat.name === username);
        if (mine.some((seat) => seat.bet === 0)) return error("Bet on your seat first, then take another one.");
        if (mine.length >= config.BJ_MY_SEATS) return error(`At most ${config.BJ_MY_SEATS} seats at a time.`);
        table.seats[s] = { name: username, bet: 0, hands: [], standAt: null, standTimer: null };
        // During a round: the stand-up time starts with the next betting time
        if (table.phase === "betting") startStandTimer(s);
        emitState();
      }),
    );

    // A bet on an own seat: more coins on it
    socket.on(
      "bet",
      safe("bet", async (data) => {
        if (data == null) return;
        const { seat: s, amount } = data;
        if (!Number.isInteger(s) || s < 0 || s >= table.seats.length || !Number.isInteger(amount) || amount <= 0) return;
        if (table.phase !== "betting") return error("Wait for the next round.");
        const seat = table.seats[s];
        if (seat == null) return error("Sit down first.");
        if (seat.name !== username) return error("This seat is taken.");
        const total = seat.bet + amount;
        if (total < config.BJ_MIN_BET) return error(`At least ${config.BJ_MIN_BET} coins.`);
        if (total > config.BJ_MAX_BET) return error(`At most ${config.BJ_MAX_BET.toLocaleString("en-US")} coins per seat.`);
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
      }),
    );

    // The same bets as last round, with one click: the same seats (or free ones) and amounts
    socket.on(
      "rebet",
      safe("rebet", async () => {
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
          const free = (i) => table.phase === "betting" && (table.seats[i] == null || (table.seats[i].name === username && table.seats[i].bet === 0));
          const used = new Set();
          for (const bet of last) {
            let s = free(bet.seat) && !used.has(bet.seat) ? bet.seat : -1;
            // The old seat is taken: the nearest free one
            if (s < 0) s = table.seats.findIndex((_, i) => free(i) && !used.has(i) && !last.some((b) => b.seat === i));
            const mine = table.seats.filter((seat, i) => seat && seat.name === username && (seat.bet > 0 || used.has(i))).length;
            if (s < 0 || mine >= config.BJ_MY_SEATS) {
              refund += bet.amount;
              continue;
            }
            used.add(s);
            if (table.seats[s] == null) table.seats[s] = { name: username, bet: 0, hands: [], standAt: null, standTimer: null };
            table.seats[s].bet = bet.amount;
            stopStandTimer(table.seats[s]);
          }
          if (refund > 0) {
            await coins.add(username, refund, { reason: "blackjack refund" });
            error(used.size ? "Not every seat was free - the rest is back." : "No free seat - the coins are back.");
          }
          if (used.size) startBetting();
          emitState();
        } finally {
          busy.delete(username);
        }
      }),
    );

    // Stand up (while betting, or before the own seat plays): the bet comes back
    socket.on(
      "clearBet",
      safe("clearBet", async (s) => {
        const seat = table.seats[s];
        if (!seat || seat.name !== username) return;
        if (table.phase !== "betting" && seat.hands.length > 0) return;
        standUp(s);
        if (seat.bet > 0) await coins.add(username, seat.bet, { reason: "blackjack refund" });
        if (playing().length === 0) {
          clearTimeout(table.timer);
          table.startAt = null;
        }
        emitState();
      }),
    );

    socket.on(
      "action",
      safe("action", async (type) => {
        const problem = type === "double" || type === "split" ? await actWithCoins(username, type) : act(username, type);
        if (problem) error(problem);
      }),
    );

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
      safe("disconnect", () => emitState()),
    );
  });

  // The server stops: every bet that isn't paid out yet goes back
  async function refundAll() {
    clearTimeout(table.timer);
    clearTimeout(table.turnTimer);
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

  return { table, refundAll };
};
