const config = require("../game/config");
const coins = require("../game/coins");
const poker = require("../game/poker");
const casinoChat = require("../game/casino_chat");
const socketAuth = require("./socket_auth");
const safe = require("./safe_handler");
const version = require("../game/version");

const ROOM = "poker"; // one table for everybody
const BETTING = ["preflop", "flop", "turn", "river"];

/*
 * Hidden poker: one texas hold'em table with a few seats. Players sit down
 * with coins (the same coins as in the jackpot) and get their chips back as
 * coins when they stand up. The server deals, only the own cards are sent.
 */
module.exports = function (io) {
  const room = io.of("/poker");
  room.use(socketAuth);
  casinoChat.attach(room, ROOM);

  const table = {
    seats: new Array(config.POKER_SEATS).fill(null),
    phase: "waiting", // waiting | preflop | flop | turn | river | showdown
    hand: 0,
    button: -1,
    sb: -1,
    bb: -1,
    board: [],
    deck: [],
    current: -1, // seat whose turn it is
    lastActor: -1, // the next turn is the next open seat after this one
    turnAt: null, // deadline of the current turn
    startAt: null, // the next hand starts (waiting)
    highBet: 0, // highest bet on this street
    minRaise: config.POKER_BIG_BLIND,
    result: null, // {showdown, winners: [{seat, name, amount, hand, cards}], hands: [{seat, hand}]}
    timer: null, // next hand / next street
    turnTimer: null,
    history: [], // [{hand, winners: [{name, amount, hand}]}] newest first
  };
  const busy = new Set(); // users with a coin payment in progress

  /* ---------- Seats ---------- */

  const seatOf = (name) => table.seats.findIndex((seat) => seat && seat.name === name);
  const inHand = (i) => table.seats[i] != null && table.seats[i].inHand;
  const live = (i) => inHand(i) && !table.seats[i].folded;
  const canAct = (i) => live(i) && !table.seats[i].allIn;
  const indexes = () => table.seats.map((_, i) => i);

  // The first seat after `from` (going round the table) that matches
  function nextFrom(from, test) {
    for (let step = 1; step <= table.seats.length; step++) {
      const i = (((from + step) % table.seats.length) + table.seats.length) % table.seats.length;
      if (test(i)) return i;
    }
    return -1;
  }

  function connected(name) {
    for (const socket of room.sockets.values()) if (socket.data.username === name) return true;
    return false;
  }


  // Chips back to coins, the seat is free again
  function cashOut(i) {
    const seat = table.seats[i];
    if (seat == null) return;
    clearTimeout(seat.awayTimer);
    table.seats[i] = null;
    if (seat.stack > 0) coins.add(seat.name, seat.stack, { reason: "poker cash-out" }).catch((error) => console.error("[poker] Could not cash out:", error));
  }

  /* ---------- State ---------- */

  function serialize(viewer) {
    const bets = table.seats.reduce((sum, seat) => sum + (seat ? seat.bet : 0), 0);
    const total = table.seats.reduce((sum, seat) => sum + (seat ? seat.total : 0), 0);
    return {
      phase: table.phase,
      hand: table.hand,
      seats: table.seats.map(
        (seat) =>
          seat && {
            name: seat.name,
            stack: seat.stack,
            bet: seat.bet,
            folded: seat.folded,
            allIn: seat.allIn,
            inHand: seat.inHand,
            lastAction: seat.lastAction,
            away: seat.awaySince != null,
            leaving: seat.leaving === true,
            // Only the own cards - the others' only after a showdown
            cards: seat.name === viewer || seat.shown ? seat.cards : seat.cards.map(() => null),
            // What the player has right now (only where the cards can be seen)
            handName: (seat.name === viewer || seat.shown) && seat.cards.length && !seat.folded ? poker.handName(seat.cards.concat(table.board)) : null,
          },
      ),
      // Main pot and side pots (with what is bet on this street): who plays for how much
      pots: table.phase === "showdown" || table.phase === "waiting" ? [] : potsNow(),
      board: table.board,
      button: table.button,
      sb: table.sb,
      bb: table.bb,
      current: table.current,
      turnIn: table.turnAt != null ? Math.max(0, table.turnAt - Date.now()) : null,
      startIn: table.startAt != null ? Math.max(0, table.startAt - Date.now()) : null,
      // The chips in the middle (this street's bets are in front of the players)
      pot: table.phase === "showdown" ? 0 : total - bets,
      highBet: table.highBet,
      minRaise: table.minRaise,
      result: table.result,
      history: table.history,
      viewers: room.sockets.size,
      rules: {
        smallBlind: config.POKER_SMALL_BLIND,
        bigBlind: config.POKER_BIG_BLIND,
        minBuyIn: config.POKER_MIN_BUYIN,
        maxBuyIn: config.POKER_MAX_BUYIN,
        turn: config.POKER_TURN,
      },
    };
  }

  /*
   * The pots during a hand: a side pot only starts where somebody is all-in
   * (a bet that wasn't called yet is no side pot - the others still can).
   */
  function potsNow() {
    const seats = indexes().filter(inHand);
    const live = seats.filter((i) => !table.seats[i].folded);
    const levels = [...new Set(live.filter((i) => table.seats[i].allIn).map((i) => table.seats[i].total))].sort((a, b) => a - b);
    const result = [];
    let below = 0;
    const add = (amount, eligible) => {
      if (amount <= 0) return;
      const last = result[result.length - 1];
      if (last && last.eligible.join() === eligible.join()) last.amount += amount;
      else result.push({ amount: amount, eligible: eligible });
    };
    for (const level of levels) {
      const amount = seats.reduce((sum, i) => sum + Math.max(0, Math.min(table.seats[i].total, level) - below), 0);
      add(amount, live.filter((i) => !table.seats[i].allIn || table.seats[i].total >= level));
      below = level;
    }
    add(
      seats.reduce((sum, i) => sum + Math.max(0, table.seats[i].total - below), 0),
      live.filter((i) => !table.seats[i].allIn || table.seats[i].total > below),
    );
    return result.map((pot) => ({ amount: pot.amount, players: pot.eligible.map((i) => table.seats[i].name) }));
  }

  function emitState() {
    for (const socket of room.sockets.values()) socket.emit("pokerState", serialize(socket.data.username));
  }

  async function sendCoins(username) {
    const data = await coins.get(username);
    for (const socket of room.sockets.values()) {
      if (socket.data.username === username) socket.emit("coins", data);
    }
  }

  coins.changes.on("change", (username) => sendCoins(username).catch(() => {}));

  /* ---------- A hand ---------- */

  function players() {
    return indexes().filter((i) => table.seats[i] && table.seats[i].stack > 0 && !table.seats[i].leaving);
  }

  // Two players with chips: the next hand starts soon
  function scheduleStart() {
    if (table.phase !== "waiting" || table.startAt != null || players().length < 2) return;
    table.startAt = Date.now() + config.POKER_START;
    table.timer = setTimeout(() => {
      table.startAt = null;
      startHand();
    }, config.POKER_START);
  }

  function post(i, amount, label) {
    const seat = table.seats[i];
    const pay = Math.min(amount, seat.stack);
    seat.stack -= pay;
    seat.bet += pay;
    seat.total += pay;
    if (seat.stack === 0) seat.allIn = true;
    seat.lastAction = seat.allIn ? "All-in" : label;
  }

  function startHand() {
    clearTimeout(table.timer);
    table.startAt = null;
    const playing = players();
    if (playing.length < 2) {
      table.phase = "waiting";
      emitState();
      return;
    }
    table.hand++;
    table.result = null;
    table.board = [];
    table.deck = poker.shuffle(poker.newDeck());
    table.seats.forEach((seat, i) => {
      if (seat == null) return;
      Object.assign(seat, { cards: [], bet: 0, total: 0, folded: false, allIn: false, acted: false, shown: false, lastAction: null });
      seat.inHand = playing.includes(i);
    });

    const isPlaying = (i) => playing.includes(i);
    table.button = nextFrom(table.button, isPlaying);
    // Heads-up: the button is the small blind
    table.sb = playing.length === 2 ? table.button : nextFrom(table.button, isPlaying);
    table.bb = nextFrom(table.sb, isPlaying);
    post(table.sb, config.POKER_SMALL_BLIND, "Small blind");
    post(table.bb, config.POKER_BIG_BLIND, "Big blind");
    table.highBet = Math.max(table.seats[table.sb].bet, table.seats[table.bb].bet);
    table.minRaise = config.POKER_BIG_BLIND;

    // Two cards each, one at a time, starting left of the button
    for (let round = 0; round < 2; round++) {
      let i = table.button;
      for (let n = 0; n < playing.length; n++) {
        i = nextFrom(i, isPlaying);
        table.seats[i].cards.push(table.deck.pop());
      }
    }
    table.phase = "preflop";
    table.lastActor = table.bb;
    proceed();
  }

  // After every action: next turn, next street or the end of the hand
  function proceed() {
    clearTimeout(table.turnTimer);
    const alive = indexes().filter(live);
    if (alive.length === 1) return winByFold(alive[0]);

    const actors = indexes().filter(canAct);
    const pending = actors.filter((i) => !table.seats[i].acted || table.seats[i].bet < table.highBet);
    const alone = actors.length === 1 && table.seats[actors[0]].bet >= table.highBet;
    if (pending.length > 0 && !alone) {
      table.current = nextFrom(table.lastActor, (i) => pending.includes(i));
      startTurn();
      emitState();
      return;
    }
    nextStreet();
  }

  function startTurn() {
    const seat = table.seats[table.current];
    // Nobody at the page: no long wait for the others
    const time = seat.awaySince != null ? 1500 : config.POKER_TURN;
    table.turnAt = Date.now() + time;
    const turn = table.current;
    const hand = table.hand;
    table.turnTimer = setTimeout(() => {
      if (table.current !== turn || table.hand !== hand) return;
      const me = table.seats[turn];
      act(turn, me.bet >= table.highBet ? "check" : "fold");
    }, time);
  }

  function nextStreet() {
    table.current = -1;
    table.turnAt = null;
    if (table.phase === "river") return showdown();

    table.seats.forEach((seat, i) => {
      if (!inHand(i)) return;
      seat.bet = 0;
      seat.acted = false;
      if (!seat.folded && !seat.allIn) seat.lastAction = null;
    });
    table.highBet = 0;
    table.minRaise = config.POKER_BIG_BLIND;
    table.deck.pop(); // burn
    if (table.phase === "preflop") {
      table.board.push(table.deck.pop(), table.deck.pop(), table.deck.pop());
      table.phase = "flop";
    } else {
      table.board.push(table.deck.pop());
      table.phase = table.phase === "flop" ? "turn" : "river";
    }

    // Everybody (but one) is all-in: the rest of the board comes card by card
    if (indexes().filter(canAct).length <= 1) {
      // The cards are shown right away (nothing to bet on anymore)
      indexes().filter(live).forEach((i) => (table.seats[i].shown = true));
      emitState();
      table.timer = setTimeout(nextStreet, config.POKER_STREET);
      return;
    }
    table.lastActor = table.button;
    proceed();
  }

  function act(i, type, amount) {
    if (!BETTING.includes(table.phase) || table.current !== i) return "It's not your turn.";
    const seat = table.seats[i];
    const toCall = table.highBet - seat.bet;
    const pay = (chips) => {
      seat.stack -= chips;
      seat.bet += chips;
      seat.total += chips;
      if (seat.stack === 0) seat.allIn = true;
    };

    if (type === "allin") {
      amount = seat.bet + seat.stack;
      type = amount > table.highBet ? "raise" : "call";
    }
    if (type === "call" && toCall <= 0) type = "check";

    if (type === "fold") {
      seat.folded = true;
      seat.lastAction = "Fold";
    } else if (type === "check") {
      if (toCall > 0) return "You can't check - call or fold.";
      seat.lastAction = "Check";
    } else if (type === "call") {
      pay(Math.min(toCall, seat.stack));
      seat.lastAction = seat.allIn ? "All-in" : "Call";
    } else if (type === "raise") {
      const max = seat.bet + seat.stack;
      if (!Number.isInteger(amount) || amount <= table.highBet || amount > max) return "Invalid amount.";
      // Less than a full raise is only allowed all-in
      if (amount < table.highBet + table.minRaise && amount < max) return `Raise to at least ${table.highBet + table.minRaise}.`;
      const raise = amount - table.highBet;
      if (raise >= table.minRaise) {
        table.minRaise = raise;
        // Everybody else has to answer the raise
        indexes().filter((j) => j !== i && canAct(j)).forEach((j) => (table.seats[j].acted = false));
      }
      const bet = table.highBet === 0;
      pay(amount - seat.bet);
      table.highBet = amount;
      seat.lastAction = seat.allIn ? "All-in" : bet ? "Bet" : "Raise";
    } else {
      return "Unknown action.";
    }
    seat.acted = true;
    table.lastActor = i;
    proceed();
    return null;
  }

  function winByFold(i) {
    const seat = table.seats[i];
    const amount = table.seats.reduce((sum, s) => sum + (s && s.inHand ? s.total : 0), 0);
    seat.stack += amount;
    table.result = {
      showdown: false,
      winners: [{ seat: i, name: seat.name, amount: amount }],
      hands: [],
      pots: [{ amount: amount, players: [seat.name], winners: [{ seat: i, name: seat.name, amount: amount, hand: null }] }],
    };
    finishHand();
  }

  function showdown() {
    const alive = indexes().filter(live);
    const hands = new Map(alive.map((i) => [i, poker.bestHand(table.seats[i].cards.concat(table.board))]));
    const potList = poker.pots(indexes().filter(inHand).map((i) => ({ seat: i, total: table.seats[i].total, folded: table.seats[i].folded })));
    // Odd chips: first to the players left of the button
    const order = [];
    for (let i = nextFrom(table.button, () => true), n = 0; n < table.seats.length; n++, i = (i + 1) % table.seats.length) order.push(i);
    const byPot = poker.payoutByPot(potList, hands, order);
    const won = new Map();
    byPot.forEach((pot) => pot.winners.forEach((w) => won.set(w.seat, (won.get(w.seat) || 0) + w.amount)));
    won.forEach((amount, i) => (table.seats[i].stack += amount));
    alive.forEach((i) => (table.seats[i].shown = true));
    table.result = {
      showdown: true,
      winners: [...won.entries()].map(([i, amount]) => ({
        seat: i,
        name: table.seats[i].name,
        amount: amount,
        hand: hands.get(i).name,
        cards: hands.get(i).cards,
      })),
      hands: alive.map((i) => ({ seat: i, hand: hands.get(i).name })),
      // Pot by pot: how big, who could win it, who got what
      pots: byPot.map((pot) => ({
        amount: pot.amount,
        players: pot.eligible.map((i) => table.seats[i].name),
        winners: pot.winners.map((w) => ({ seat: w.seat, name: table.seats[w.seat].name, amount: w.amount, hand: hands.get(w.seat).name })),
      })),
    };
    finishHand();
  }

  function finishHand() {
    clearTimeout(table.turnTimer);
    // Every chip of the hand is paid out now: nothing in the middle anymore
    table.seats.forEach((seat) => seat && (seat.bet = 0));
    table.phase = "showdown";
    table.current = -1;
    table.turnAt = null;
    const winners = table.result.winners;
    table.history.unshift({
      hand: table.hand,
      winners: winners.map((w) => ({ name: w.name, amount: w.amount, hand: w.hand || null })),
    });
    table.history.length = Math.min(table.history.length, config.POKER_HISTORY);
    emitState();
    table.timer = setTimeout(afterHand, config.POKER_SHOWDOWN);
  }

  function afterHand() {
    table.seats.forEach((seat, i) => {
      if (seat == null) return;
      seat.inHand = false;
      seat.shown = false;
      seat.bet = 0;
      seat.total = 0;
      seat.cards = [];
      seat.lastAction = null;
      // Out of chips, standing up or gone: off the table
      if (seat.leaving || seat.stack === 0) cashOut(i);
    });
    table.board = [];
    table.result = null;
    table.current = -1;
    table.phase = "waiting";
    if (players().length >= 2) startHand();
    else emitState();
  }

  // Standing up: folds a running hand, the chips come back at its end
  function standUp(i) {
    const seat = table.seats[i];
    if (seat == null) return;
    if (!seat.inHand || table.phase === "waiting") {
      cashOut(i);
      // Alone again: no next hand
      if (table.phase === "waiting" && players().length < 2) {
        clearTimeout(table.timer);
        table.startAt = null;
      }
      emitState();
      return;
    }
    seat.leaving = true;
    if (BETTING.includes(table.phase) && !seat.folded) {
      if (table.current === i) {
        act(i, "fold");
        return;
      }
      seat.folded = true;
      seat.lastAction = "Fold";
      if (indexes().filter(live).length === 1) {
        proceed();
        return;
      }
    }
    emitState();
  }

  /* ---------- Connection ---------- */

  room.on("connection", (socket) => {
    version.announce(socket);
    const username = socket.data.username;
    socket.gameID = ROOM; // for the chat
    socket.join(ROOM);
    socket.emit("joined", { username: username });
    casinoChat.join(socket);
    sendCoins(username).catch((error) => console.error("[poker] Could not load coins:", error));

    // Back (reload, second tab): the seat is still there
    const mine = seatOf(username);
    if (mine >= 0) {
      clearTimeout(table.seats[mine].awayTimer);
      table.seats[mine].awaySince = null;
    }
    emitState();

    const error = (message) => socket.emit("pokerError", message);

    socket.on(
      "sit",
      safe("sit", async (data) => {
        if (data == null) return;
        const { seat, buyIn } = data;
        if (!Number.isInteger(seat) || seat < 0 || seat >= table.seats.length) return;
        if (!Number.isInteger(buyIn) || buyIn < config.POKER_MIN_BUYIN || buyIn > config.POKER_MAX_BUYIN) {
          error(`Buy in with ${config.POKER_MIN_BUYIN} - ${config.POKER_MAX_BUYIN} coins.`);
          return;
        }
        if (table.seats[seat] != null || seatOf(username) >= 0 || busy.has(username)) return;
        busy.add(username);
        try {
          if (!(await coins.spend(username, buyIn, { reason: "poker buy-in" }))) {
            error("You don't have enough coins.");
            return;
          }
          // Somebody was faster
          if (table.seats[seat] != null || seatOf(username) >= 0) {
            await coins.add(username, buyIn, { reason: "poker refund" });
            error("This seat was just taken.");
            return;
          }
          table.seats[seat] = {
            name: username,
            stack: buyIn,
            cards: [],
            bet: 0,
            total: 0,
            folded: false,
            allIn: false,
            acted: false,
            inHand: false, // plays from the next hand on
            lastAction: null,
            awaySince: null,
            awayTimer: null,
          };
          scheduleStart();
          emitState();
        } finally {
          busy.delete(username);
        }
      }),
    );

    // More chips between hands (up to the maximum buy-in)
    socket.on(
      "addChips",
      safe("addChips", async (amount) => {
        const i = seatOf(username);
        if (i < 0 || !Number.isInteger(amount) || amount <= 0 || busy.has(username)) return;
        const seat = table.seats[i];
        if (seat.inHand && table.phase !== "showdown") {
          error("Add chips between hands.");
          return;
        }
        if (seat.stack + amount > config.POKER_MAX_BUYIN) {
          error(`At most ${config.POKER_MAX_BUYIN} chips at the table.`);
          return;
        }
        busy.add(username);
        try {
          if (!(await coins.spend(username, amount, { reason: "poker chips" }))) {
            error("You don't have enough coins.");
            return;
          }
          if (table.seats[i] !== seat) {
            await coins.add(username, amount, { reason: "poker refund" });
            return;
          }
          seat.stack += amount;
          scheduleStart();
          emitState();
        } finally {
          busy.delete(username);
        }
      }),
    );

    socket.on(
      "stand",
      safe("stand", () => {
        const i = seatOf(username);
        if (i >= 0) standUp(i);
      }),
    );

    socket.on(
      "action",
      safe("action", (data) => {
        if (data == null || typeof data.type !== "string") return;
        const i = seatOf(username);
        if (i < 0) return;
        const problem = act(i, data.type, data.amount);
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

    // The last page of a player is gone: a short wait (reload), then off the table
    socket.on(
      "disconnect",
      safe("disconnect", () => {
        const i = seatOf(username);
        if (i >= 0 && !connected(username)) {
          const seat = table.seats[i];
          seat.awaySince = Date.now();
          clearTimeout(seat.awayTimer);
          seat.awayTimer = setTimeout(() => {
            if (table.seats[i] === seat && !connected(username)) standUp(i);
          }, config.POKER_AWAY);
          // Their turn right now: the others don't wait the whole time
          if (table.current === i) {
            clearTimeout(table.turnTimer);
            startTurn();
          }
        }
        emitState();
      }),
    );
  });

  /*
   * The server stops: every chip goes back (the stacks and what is in the pot
   * of a running hand), nothing is lost with a restart.
   */
  async function refundAll() {
    clearTimeout(table.timer);
    clearTimeout(table.turnTimer);
    const payments = [];
    table.seats.forEach((seat, i) => {
      if (seat == null) return;
      clearTimeout(seat.awayTimer);
      const chips = seat.stack + (table.phase === "showdown" ? 0 : seat.total);
      table.seats[i] = null;
      if (chips > 0) payments.push(coins.add(seat.name, chips, { reason: "poker refund" }).catch((e) => console.error("[poker] Refund failed:", e)));
    });
    await Promise.all(payments);
  }

  return { table, refundAll };
};
