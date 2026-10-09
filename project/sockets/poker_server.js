const config = require("../game/config");
const coins = require("../game/coins");
const inPlay = require("../game/in_play");
const casinoLock = require("../game/casino_lock");
const poker = require("../game/poker");
const casinoChat = require("../game/casino_chat");
const socketAuth = require("./socket_auth");
const safe = require("./safe_handler");
const version = require("../game/version");
const persist = require("../game/persist");
const liveGames = require("../game/live");

const ROOM = "poker"; // one table for everybody
const BETTING = ["preflop", "flop", "turn", "river"];

/*
 * Hidden poker: one texas hold'em table with a few seats. Players sit down
 * with coins (the same coins as in the jackpot) and get their chips back as
 * coins when they stand up. The server deals, only the own cards are sent.
 */
module.exports = function (io, options = {}) {
  // The real casino - or the admin's test world (game/worlds.js): its own namespace, nothing saved
  const world = options.world || "";
  const { coins, persist, inPlay, casinoLock, casinoChat, limits } = require("../game/worlds").services(world);
  const room = io.of(world + "/poker");
  room.use(socketAuth.casino);
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
    minRaise: 0, // set with every hand (the big blind)
    result: null, // {showdown, winners: [{seat, name, amount, hand, cards}], hands: [{seat, hand}]}
    timer: null, // next hand / next street
    turnTimer: null,
    history: [], // [{hand, winners: [{name, amount, hand}]}] newest first
    level: 0, // the blind level (see blinds())
    levelSince: null, // when the blinds started at the first level (null: with the next hand)
    levelHands: 0, // hands played at this level
    emptySince: null, // nobody at the table since then
    resetTimer: null,
    decideUntil: null, // after a hand: until then the players decide to show or muck their cards
  };
  const busy = new Set(); // users with a coin payment in progress

  /* ---------- Blinds: up every few hands, back to the start when the table was empty a while ---------- */

  function blindsAt(level) {
    const steps = config.POKER_BLIND_STEPS || [1];
    const factor = steps[Math.min(level, steps.length - 1)];
    return { small: config.POKER_SMALL_BLIND * factor, big: config.POKER_BIG_BLIND * factor };
  }

  function blinds() {
    return blindsAt(table.level);
  }

  function lastLevel() {
    return (config.POKER_BLIND_STEPS || [1]).length - 1;
  }

  // At the start of a hand: up a level after POKER_LEVEL_HANDS hands (the first hand after a reset: the first level)
  function updateLevel(now = Date.now()) {
    if (table.levelSince == null) {
      table.level = 0;
      table.levelSince = now;
      table.levelHands = 0;
    } else if (table.level < lastLevel() && table.levelHands >= config.POKER_LEVEL_HANDS) {
      table.level++;
      table.levelHands = 0;
    }
    table.levelHands++;
  }

  // Nobody sits at the table for a while: the blinds start low again
  function watchEmpty() {
    const empty = table.seats.every((seat) => seat == null);
    if (!empty) {
      table.emptySince = null;
      clearTimeout(table.resetTimer);
      table.resetTimer = null;
      return;
    }
    if (table.emptySince != null) return;
    table.emptySince = Date.now();
    clearTimeout(table.resetTimer);
    table.resetTimer = setTimeout(() => {
      table.resetTimer = null;
      if (!table.seats.every((seat) => seat == null)) return;
      table.level = 0;
      table.levelSince = null;
      table.levelHands = 0;
      emitState();
    }, config.POKER_LEVEL_RESET);
    table.resetTimer.unref();
  }

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
            // Only the own cards - the others' only after a showdown (or when they show them)
            cards: seat.name === viewer || seat.shown ? seat.cards : seat.cards.map(() => null),
            shown: seat.shown === true,
            mucked: seat.mucked === true,
            // After the hand: show or muck? (a decision with a timer)
            deciding: seat.deciding === true,
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
      // The blinds now, after how many hands (and to what) they go up
      level: {
        number: table.level + 1,
        handsLeft: table.levelSince != null && table.level < lastLevel() ? Math.max(0, config.POKER_LEVEL_HANDS - table.levelHands) : null,
        next: table.level < lastLevel() ? blindsAt(table.level + 1) : null,
      },
      decideIn: table.decideUntil != null ? Math.max(0, table.decideUntil - Date.now()) : null,
      decideTime: config.POKER_DECIDE,
      rules: {
        smallBlind: blinds().small,
        bigBlind: blinds().big,
        minBuyIn: limits.POKER_MIN_BUYIN,
        maxBuyIn: limits.POKER_MAX_BUYIN,
        defaultBuyIn: config.POKER_DEFAULT_BUYIN,
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
    watchEmpty();
    for (const socket of room.sockets.values()) socket.emit("pokerState", serialize(socket.data.username));
    persist.changed("poker");
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
    if (table.phase !== "waiting" || table.startAt != null || players().length < 2 || casinoLock.locked()) return;
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
    updateLevel();
    table.hand++;
    table.result = null;
    table.board = [];
    table.deck = poker.shuffle(poker.newDeck());
    table.seats.forEach((seat, i) => {
      if (seat == null) return;
      Object.assign(seat, { cards: [], bet: 0, total: 0, folded: false, allIn: false, acted: false, shown: false, mucked: false, deciding: false, lastAction: null });
      seat.inHand = playing.includes(i);
    });

    const isPlaying = (i) => playing.includes(i);
    table.button = nextFrom(table.button, isPlaying);
    // Heads-up: the button is the small blind
    table.sb = playing.length === 2 ? table.button : nextFrom(table.button, isPlaying);
    table.bb = nextFrom(table.sb, isPlaying);
    const { small, big } = blinds();
    post(table.sb, small, "Small blind");
    post(table.bb, big, "Big blind");
    table.highBet = Math.max(table.seats[table.sb].bet, table.seats[table.bb].bet);
    table.minRaise = big;

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

  function startTurn(after) {
    const seat = table.seats[table.current];
    // Nobody at the page: no long wait for the others
    const time = after != null ? after : seat.awaySince != null ? 1500 : config.POKER_TURN;
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
    table.minRaise = blinds().big;
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

  // The house's cut of a pot (rake): only once the flop came ("no flop, no drop")
  function rakeOf(amount) {
    return table.board.length >= 3 ? Math.floor((amount * config.POKER_RAKE) / 100) : 0;
  }

  function winByFold(i) {
    const seat = table.seats[i];
    const all = table.seats.reduce((sum, s) => sum + (s && s.inHand ? s.total : 0), 0);
    // Only what the others matched pays rake - the winner's own bet nobody called comes back whole
    const others = table.seats.filter((s, k) => s && s.inHand && k !== i).map((s) => s.total);
    const called = Math.min(seat.total, Math.max(0, ...others));
    const contested = table.seats.reduce((sum, s) => sum + (s && s.inHand ? Math.min(s.total, called) : 0), 0);
    const rake = rakeOf(contested);
    const amount = all - rake;
    seat.stack += amount;
    table.result = {
      showdown: false,
      rake: rake,
      winners: [{ seat: i, name: seat.name, amount: amount }],
      hands: [],
      pots: [{ amount: amount, players: [seat.name], winners: [{ seat: i, name: seat.name, amount: amount, hand: null }] }],
    };
    // Nobody has to show: the winner decides to show the cards or not
    if (seat.cards.length && !seat.shown) seat.deciding = true;
    finishHand();
  }

  function showdown() {
    const alive = indexes().filter(live);
    const hands = new Map(alive.map((i) => [i, poker.bestHand(table.seats[i].cards.concat(table.board))]));
    const potList = poker.pots(indexes().filter(inHand).map((i) => ({ seat: i, total: table.seats[i].total, folded: table.seats[i].folded })));
    // The rake: from every pot at least two players play for (not from chips nobody called)
    let rake = 0;
    potList.forEach((pot) => {
      if (pot.eligible.length < 2) return;
      const cut = rakeOf(pot.amount);
      pot.amount -= cut;
      rake += cut;
    });
    // Odd chips: first to the players left of the button
    const order = [];
    for (let i = nextFrom(table.button, () => true), n = 0; n < table.seats.length; n++, i = (i + 1) % table.seats.length) order.push(i);
    const byPot = poker.payoutByPot(potList, hands, order);
    const won = new Map();
    byPot.forEach((pot) => pot.winners.forEach((w) => won.set(w.seat, (won.get(w.seat) || 0) + w.amount)));
    won.forEach((amount, i) => (table.seats[i].stack += amount));
    // The winners show their cards; who lost decides: show them or muck them (hidden)
    alive.forEach((i) => {
      const seat = table.seats[i];
      if (won.has(i) || seat.shown) seat.shown = true;
      else seat.deciding = true;
    });
    table.result = {
      showdown: true,
      rake: rake,
      winners: [...won.entries()].map(([i, amount]) => ({
        seat: i,
        name: table.seats[i].name,
        amount: amount,
        hand: hands.get(i).name,
        cards: hands.get(i).cards,
        // (the cards of the hand itself - the others in `cards` are kickers)
        made: hands.get(i).made,
      })),
      hands: alive.map((i) => ({ seat: i, hand: table.seats[i].deciding ? null : hands.get(i).name, mucked: false, deciding: table.seats[i].deciding })),
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
    // Show or muck: everybody who has to decide gets POKER_DECIDE, then the cards are mucked
    const deciding = table.seats.some((seat) => seat && seat.deciding);
    table.decideUntil = deciding ? Date.now() + config.POKER_DECIDE : null;
    if (deciding) {
      table.decideTimer = setTimeout(endDecisions, config.POKER_DECIDE);
      table.decideTimer.unref();
    }
    emitState();
    table.timer = setTimeout(afterHand, deciding ? Math.max(config.POKER_SHOWDOWN, config.POKER_DECIDE + config.POKER_AFTER_DECIDE) : config.POKER_SHOWDOWN);
  }

  // One player decides: show the cards to the table (true) or muck them
  function decide(i, show) {
    const seat = table.seats[i];
    if (seat == null || !seat.deciding) return;
    seat.deciding = false;
    seat.shown = show;
    seat.mucked = !show;
    const entry = table.result && table.result.hands.find((hand) => hand.seat === i);
    if (entry) Object.assign(entry, { deciding: false, mucked: !show, hand: show ? poker.handName(seat.cards.concat(table.board)) : null });
    if (!table.seats.some((s) => s && s.deciding)) {
      clearTimeout(table.decideTimer);
      table.decideUntil = null;
    }
  }

  // The time is up: who didn't decide mucks
  function endDecisions() {
    clearTimeout(table.decideTimer);
    table.seats.forEach((seat, i) => seat && seat.deciding && decide(i, false));
    table.decideUntil = null;
    emitState();
  }

  function afterHand() {
    clearTimeout(table.decideTimer);
    table.decideUntil = null;
    table.seats.forEach((seat, i) => {
      if (seat == null) return;
      seat.inHand = false;
      seat.shown = false;
      seat.mucked = false;
      seat.deciding = false;
      seat.bet = 0;
      seat.total = 0;
      seat.cards = [];
      seat.lastAction = null;
      // Out of chips, standing up or gone (left the page during the hand): off the table
      if (seat.leaving || seat.stack === 0 || (seat.awaySince != null && !connected(seat.name))) cashOut(i);
    });
    table.board = [];
    table.result = null;
    table.current = -1;
    table.phase = "waiting";
    // Closing time before a season: no next hand - everybody gets the chips back
    if (casinoLock.locked()) return closeTable();
    if (players().length >= 2) startHand();
    else emitState();
  }

  // Everybody stands up, the chips go back (closing time before a season)
  function closeTable() {
    clearTimeout(table.timer);
    table.startAt = null;
    table.seats.forEach((seat, i) => seat && cashOut(i));
    emitState();
  }
  casinoLock.changes.on("locked", () => {
    if (table.phase === "waiting") closeTable();
  });
  casinoLock.registerRunning("poker", () => table.phase !== "waiting" || table.seats.some((seat) => seat && seat.stack > 0));

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
        if (casinoLock.locked()) return error(casinoLock.message());
        if (data == null) return;
        const { seat, buyIn } = data;
        if (!Number.isInteger(seat) || seat < 0 || seat >= table.seats.length) return;
        if (!Number.isInteger(buyIn) || buyIn < limits.POKER_MIN_BUYIN || buyIn > limits.POKER_MAX_BUYIN) {
          error(`Buy in with ${limits.POKER_MIN_BUYIN} - ${limits.POKER_MAX_BUYIN} coins.`);
          return;
        }
        if (table.seats[seat] != null || seatOf(username) >= 0 || busy.has(username)) return;
        busy.add(username);
        try {
          if (!(await coins.spend(username, buyIn, { reason: "poker buy-in" }))) {
            error(coins.refusal(username) || "You don't have enough coins.");
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
        if (casinoLock.locked()) return error(casinoLock.message());
        const i = seatOf(username);
        if (i < 0 || !Number.isInteger(amount) || amount <= 0 || busy.has(username)) return;
        const seat = table.seats[i];
        if (seat.inHand && table.phase !== "showdown") {
          error("Add chips between hands.");
          return;
        }
        if (seat.stack + amount > limits.POKER_MAX_BUYIN) {
          error(`At most ${limits.POKER_MAX_BUYIN} chips at the table.`);
          return;
        }
        busy.add(username);
        try {
          if (!(await coins.spend(username, amount, { reason: "poker chips" }))) {
            error(coins.refusal(username) || "You don't have enough coins.");
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

    // After the hand: show the own cards to the table - or muck them (a decision with a timer)
    socket.on(
      "decide",
      safe("decide", (data) => {
        const i = seatOf(username);
        if (i < 0 || table.phase !== "showdown" || data == null || typeof data.show !== "boolean") return;
        decide(i, data.show);
        emitState();
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
        const paid = await coins.claim(username);
        if (paid) socket.emit("bonusClaimed", paid);
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
          // Not in a hand: off the table right away (after a reload-sized wait);
          // in a hand: the seat stays until the hand is over (or POKER_AWAY)
          const inHand = seat.inHand && table.phase !== "waiting";
          seat.awayTimer = setTimeout(
            () => {
              if (table.seats[i] === seat && !connected(username)) standUp(i);
            },
            inHand ? config.POKER_AWAY : Math.min(config.POKER_AWAY, config.CASINO_LEAVE),
          );
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

  /* ---------- Restart of the server ---------- */

  // Coins in play: a seat with chips (or chips in the pot)
  inPlay.register("poker", (name) => table.seats.some((seat) => seat && seat.name === name && (seat.stack > 0 || (table.phase !== "waiting" && table.phase !== "showdown" && !seat.folded && seat.total > 0))));

  liveGames.register("poker", () => ({ phase: table.phase, hand: table.hand, seated: table.seats.filter(Boolean).length, seats: table.seats.length }));

  persist.register(
    "poker",
    () => {
      const saved = {};
      for (const key of ["seats", "phase", "hand", "button", "sb", "bb", "board", "deck", "current", "lastActor", "turnAt", "highBet", "minRaise", "result", "history", "level", "levelSince", "levelHands", "decideUntil"]) saved[key] = table[key];
      return saved;
    },
    restore,
  );

  // The saved table again: the hand goes on where it was. Players get time to
  // come back - who doesn't, stands up (the chips go back as coins)
  function restore(saved) {
    clearTimeout(table.timer);
    clearTimeout(table.turnTimer);
    table.seats.forEach((seat) => seat && clearTimeout(seat.awayTimer));
    clearTimeout(table.decideTimer);
    Object.assign(table, saved, { timer: null, turnTimer: null, decideTimer: null, startAt: null, resetTimer: null, emptySince: null });
    if (!Number.isInteger(table.level)) table.level = 0;
    if (table.levelSince === undefined) table.levelSince = null;
    if (!Number.isInteger(table.levelHands)) table.levelHands = 0;
    const now = Date.now();
    const grace = config.RESTORE_GRACE;
    table.seats.forEach((seat, i) => {
      if (seat == null) return;
      seat.awaySince = null;
      seat.awayTimer = setTimeout(() => {
        if (table.seats[i] !== seat || connected(seat.name)) return;
        seat.awaySince = Date.now();
        standUp(i);
        emitState();
      }, Math.max(config.POKER_AWAY, grace));
    });
    if (table.phase === "waiting") {
      scheduleStart();
    } else if (table.phase === "showdown") {
      // Still deciding: the rest of the time (at least the grace), then mucked
      if (table.decideUntil != null) table.decideTimer = setTimeout(endDecisions, Math.max(grace, table.decideUntil - now));
      table.timer = setTimeout(afterHand, Math.max(grace, (table.decideUntil || now) - now) + config.POKER_SHOWDOWN);
    } else if (table.current >= 0 && table.seats[table.current]) {
      startTurn(Math.max(grace, (table.turnAt || 0) - now));
    } else {
      // All-in: the rest of the board
      table.timer = setTimeout(nextStreet, config.POKER_STREET);
    }
    emitState();
  }

  return { table, refundAll };
};
