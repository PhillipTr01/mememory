const config = require("../game/config");
const coins = require("../game/coins");
const bj = require("../game/blackjack");
const casinoChat = require("../game/casino_chat");
const socketAuth = require("./socket_auth");
const safe = require("./safe_handler");
const version = require("../game/version");

const ROOM = "blackjack";

/*
 * Hidden blackjack: one table, everybody against the dealer. A player puts a
 * bet on one or more seats, then every hand is played in turn (hit, stand,
 * double, split), then the dealer draws to 17. Blackjack pays 3:2.
 * The dealer's second card stays on the server until it is turned.
 */
module.exports = function (io) {
  const room = io.of("/blackjack");
  room.use(socketAuth.casino);
  casinoChat.attach(room, ROOM);

  const table = {
    round: 1,
    phase: "betting", // betting | playing | dealer | result
    seats: new Array(config.BJ_SEATS).fill(null), // {name, bet, hands: [{cards, bet, split, doubled, done, result, payout}]}
    dealer: { cards: [], hidden: true },
    shoe: [],
    current: null, // {seat, hand}
    turnAt: null,
    startAt: null, // betting ends
    timer: null,
    turnTimer: null,
    history: [], // [{round, dealer, results: [{name, result, payout, bet}]}] newest first
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
      rules: { minBet: config.BJ_MIN_BET, maxBet: config.BJ_MAX_BET, turn: config.BJ_TURN, decks: bj.DECKS },
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

  function startBetting() {
    if (table.startAt != null) return;
    table.startAt = Date.now() + config.BJ_BETTING;
    table.timer = setTimeout(deal, config.BJ_BETTING);
  }

  function deal() {
    clearTimeout(table.timer);
    table.startAt = null;
    const seats = playing();
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
      // Gone from the page: the seat is free again
      if (!connected(seat.name)) table.seats[i] = null;
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

    // A bet on a seat (a free one, or one of the own seats): more coins on it
    socket.on(
      "bet",
      safe("bet", async (data) => {
        if (data == null) return;
        const { seat: s, amount } = data;
        if (!Number.isInteger(s) || s < 0 || s >= table.seats.length || !Number.isInteger(amount) || amount <= 0) return;
        if (table.phase !== "betting") return error("Wait for the next round.");
        const seat = table.seats[s];
        if (seat && seat.name !== username) return error("This seat is taken.");
        const total = (seat ? seat.bet : 0) + amount;
        if (total < config.BJ_MIN_BET) return error(`At least ${config.BJ_MIN_BET} coins.`);
        if (total > config.BJ_MAX_BET) return error(`At most ${config.BJ_MAX_BET.toLocaleString("en-US")} coins per seat.`);
        if (busy.has(username)) return;
        busy.add(username);
        try {
          if (!(await coins.spend(username, amount, { reason: "blackjack bet" }))) return error("You don't have enough coins.");
          const now = table.seats[s];
          // Somebody was faster, or the round started
          if (table.phase !== "betting" || (now && now.name !== username)) {
            await coins.add(username, amount, { reason: "blackjack refund" });
            return error("Too late for this seat.");
          }
          if (now == null) table.seats[s] = { name: username, bet: 0, hands: [] };
          table.seats[s].bet += amount;
          startBetting();
          emitState();
        } finally {
          busy.delete(username);
        }
      }),
    );

    // Take the bet off a seat (while betting) - the seat is free again
    socket.on(
      "clearBet",
      safe("clearBet", async (s) => {
        const seat = table.seats[s];
        if (!seat || seat.name !== username || table.phase !== "betting") return;
        table.seats[s] = null;
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
    table.seats.fill(null);
    await Promise.all(payments);
  }

  return { table, refundAll };
};
