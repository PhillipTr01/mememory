const { test, before, after } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const config = require("../game/config");
const { bestHand, compare, pots, payout, payoutByPot, handName, newDeck, shuffle } = require("../game/poker");

// Short timings for the tests
Object.assign(config, { POKER_START: 30, POKER_SHOWDOWN: 60, POKER_DECIDE: 400, POKER_AFTER_DECIDE: 50, POKER_STREET: 10, POKER_TURN: 3000, POKER_AWAY: 100 });
// (the amounts of these tests are made for small blinds - the levels are the same)
Object.assign(config, { POKER_SMALL_BLIND: 5, POKER_BIG_BLIND: 10, POKER_MIN_BUYIN: 100, POKER_RAKE: 0 });

/* ---------- Hands ---------- */

const hand = (cards) => bestHand(cards.split(" "));

test("poker: every kind of hand, ranked the right way", () => {
  const ladder = [
    "2h 7d 9c Js Kd 3c 4s", // high card
    "2h 2d 9c Js Kd 3c 5s", // pair
    "2h 2d 9c 9s Kd 3c 5s", // two pair
    "2h 2d 2c 9s Kd 3c 5s", // three of a kind
    "Ah 2d 3c 4s 5h Kd Kc", // straight (the wheel)
    "2h 5h 7h 9h Jh Ad Ac", // flush
    "9h 9d 9c 4s 4h Kd 2c", // full house
    "9h 9d 9c 9s 4h Kd 2c", // four of a kind
    "As Ks Qs Js Ts 2d 3c", // straight flush
  ].map(hand);
  ladder.forEach((h, i) => assert.strictEqual(h.score[0], i, h.name));
  for (let i = 1; i < ladder.length; i++) assert.ok(compare(ladder[i].score, ladder[i - 1].score) > 0);
  assert.strictEqual(ladder[4].name, "Straight");
  assert.deepStrictEqual(ladder[8].cards.sort(), ["As", "Js", "Ks", "Qs", "Ts"]);
});

test("poker: kickers and ties", () => {
  // Same pair, the kicker decides
  assert.ok(compare(hand("Ah Ad Kc 7s 4d 3c 2h").score, hand("As Ac Qc 7d 4h 3s 2d").score) > 0);
  // The wheel is the lowest straight
  assert.ok(compare(hand("2h 3d 4c 5s 6h Kd Kc").score, hand("Ah 2d 3c 4s 5h Kd Kc").score) > 0);
  // The board plays: a tie
  assert.strictEqual(compare(hand("2h 3d As Ks Qs Js Ts").score, hand("4h 5d As Ks Qs Js Ts").score), 0);
  // A deck has 52 different cards, the shuffle keeps them all
  const deck = shuffle(newDeck());
  assert.strictEqual(new Set(deck).size, 52);
});

test("poker: side pots - an all-in player only wins what was matched", () => {
  const potList = pots([
    { seat: 0, total: 30, folded: false }, // all-in for 30
    { seat: 1, total: 100, folded: false },
    { seat: 2, total: 100, folded: false },
    { seat: 3, total: 50, folded: true },
  ]);
  assert.deepStrictEqual(potList, [
    { amount: 120, eligible: [0, 1, 2] },
    { amount: 160, eligible: [1, 2] },
  ]);
  // Seat 0 has the best hand, seat 2 the second best
  const hands = new Map([
    [0, { score: [5, 14] }],
    [1, { score: [1, 3] }],
    [2, { score: [2, 9] }],
  ]);
  const won = payout(potList, hands, [0, 1, 2, 3]);
  assert.strictEqual(won.get(0), 120);
  assert.strictEqual(won.get(2), 160);
  assert.strictEqual(won.get(1), undefined);

  // A split pot: the odd chip goes to the first player in the order
  const split = payout([{ amount: 101, eligible: [1, 2] }], new Map([[1, { score: [3, 5] }], [2, { score: [3, 5] }]]), [2, 1]);
  assert.strictEqual(split.get(2), 51);
  assert.strictEqual(split.get(1), 50);
});

test("poker: pot by pot - who gets which pot, and what a player has right now", () => {
  const potList = [
    { amount: 120, eligible: [0, 1, 2] },
    { amount: 160, eligible: [1, 2] },
  ];
  const hands = new Map([
    [0, { score: [5, 14] }],
    [1, { score: [2, 9] }],
    [2, { score: [2, 9] }],
  ]);
  assert.deepStrictEqual(payoutByPot(potList, hands, [0, 1, 2]), [
    { amount: 120, eligible: [0, 1, 2], winners: [{ seat: 0, amount: 120 }] },
    { amount: 160, eligible: [1, 2], winners: [{ seat: 1, amount: 80 }, { seat: 2, amount: 80 }] },
  ]);
  // Before the flop only pairs count, later the best hand
  assert.strictEqual(handName(["Ah", "Ad"]), "Pair");
  assert.strictEqual(handName(["Ah", "Kd"]), "High card");
  assert.strictEqual(handName(["Ah", "Ad", "Kc", "Ks", "2d"]), "Two pair");
  assert.strictEqual(handName(["9h", "9d", "9c", "4s", "4h", "2c"]), "Full house");
});

/* ---------- The table ---------- */

let server;
const sockets = [];
const tokens = {};

function client(user) {
  const socket = server.client("/poker", tokens[user]);
  sockets.push(socket);
  return socket;
}

function waitFor(socket, event, predicate, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timeout waiting for "${event}"`));
    }, timeout);
    function handler(data) {
      if (!predicate(data)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(data);
    }
    socket.on(event, handler);
  });
}

const seatOf = (state, name) => state.seats.findIndex((seat) => seat && seat.name === name);
const stacks = (state) => state.seats.reduce((sum, seat) => sum + (seat ? seat.stack + seat.bet : 0), 0) + state.pot;

before(async () => {
  server = await h.startServer();
  for (const name of ["alice", "bob", "carol"]) tokens[name] = h.addUser(name);
});

after(async () => {
  sockets.forEach((s) => s.close());
  await server.close();
});

// Everybody stands up, the table is empty again
async function clearTable(players) {
  for (const p of players) p.emit("stand");
  await waitFor(players[0], "pokerState", (s) => s.seats.every((seat) => seat == null), 5000);
}

test("poker: sit down with coins, only the own cards are visible, check down to the showdown - the house takes its rake", async () => {
  config.POKER_RAKE = 5;
  h.setCoins("alice", 1000);
  h.setCoins("bob", 1000);
  const alice = client("alice");
  const bob = client("bob");
  await Promise.all([waitFor(alice, "coins", (d) => d.coins === 1000), waitFor(bob, "coins", (d) => d.coins === 1000)]);

  alice.emit("sit", { seat: 0, buyIn: 200 });
  await waitFor(alice, "pokerState", (s) => s.seats[0] != null);
  assert.strictEqual(h.coinsOf("alice"), 800);

  const dealt = waitFor(alice, "pokerState", (s) => s.phase === "preflop");
  const dealtBob = waitFor(bob, "pokerState", (s) => s.phase === "preflop");
  bob.emit("sit", { seat: 3, buyIn: 300 });
  const [state, bobState] = await Promise.all([dealt, dealtBob]);

  // Own cards yes, the other's no - and what the own hand is right now
  assert.strictEqual(state.seats[0].cards.length, 2);
  assert.ok(["Pair", "High card"].includes(state.seats[0].handName));
  assert.strictEqual(state.seats[3].handName, null, "not for the cards of the others");
  assert.deepStrictEqual(state.pots.map((p) => p.amount), [15]);
  assert.ok(state.seats[0].cards.every((card) => typeof card === "string"));
  assert.deepStrictEqual(state.seats[3].cards, [null, null]);
  assert.deepStrictEqual(bobState.seats[0].cards, [null, null]);
  assert.notDeepStrictEqual(bobState.seats[3].cards, state.seats[0].cards);

  // Heads-up: the button is the small blind and acts first before the flop
  assert.strictEqual(state.sb, state.button);
  assert.strictEqual(state.seats[state.sb].bet, config.POKER_SMALL_BLIND);
  assert.strictEqual(state.seats[state.bb].bet, config.POKER_BIG_BLIND);
  assert.strictEqual(state.current, state.sb);
  assert.strictEqual(stacks(state), 500);

  const player = (seat) => (seat === 0 ? alice : bob);
  // Not your turn
  const wrong = h.once(player(state.bb), "pokerError");
  player(state.bb).emit("action", { type: "check" });
  assert.match(await wrong, /not your turn/);

  // Call, then check every street: the cards come 3 + 1 + 1
  player(state.sb).emit("action", { type: "call" });
  let s = await waitFor(alice, "pokerState", (x) => x.current === state.bb);
  player(state.bb).emit("action", { type: "check" });
  for (const cards of [3, 4, 5]) {
    s = await waitFor(alice, "pokerState", (x) => x.board.length === cards && x.current >= 0);
    assert.strictEqual(s.pot, 20);
    // After the flop the big blind (left of the button) starts
    assert.strictEqual(s.current, state.bb);
    player(s.current).emit("action", { type: "check" });
    const next = await waitFor(alice, "pokerState", (x) => x.current !== s.current);
    if (next.phase === "showdown") break;
    player(next.current).emit("action", { type: "check" });
  }

  const end = await waitFor(alice, "pokerState", (x) => x.phase === "showdown");
  // The result pot by pot - the house kept 5% of the 20 (the flop came): 1
  assert.strictEqual(end.result.rake, 1);
  assert.strictEqual(end.result.pots.reduce((sum, p) => sum + p.amount, 0), 19);
  assert.ok(end.result.pots[0].winners[0].hand);
  assert.strictEqual(end.result.showdown, true);
  // The winner shows; who lost decides (show or muck) - here they show
  const losers = [0, 3].filter((i) => !end.result.winners.some((w) => w.seat === i));
  losers.forEach((i) => assert.strictEqual(end.seats[i].deciding, true));
  losers.forEach((i) => player(i).emit("decide", { show: true }));
  const shown = losers.length ? await waitFor(alice, "pokerState", (x) => losers.every((i) => x.seats[i].shown)) : end;
  assert.ok([0, 3].every((i) => shown.seats[i].cards.every((card) => typeof card === "string")), "now both hands are shown");
  assert.ok(end.result.winners.length >= 1);
  assert.strictEqual(end.result.winners.reduce((sum, w) => sum + w.amount, 0), 19);
  assert.strictEqual(stacks(end), 499, "only the rake is gone");

  // Standing up: the chips are coins again
  await clearTable([alice, bob]);
  await h.wait(30);
  assert.strictEqual(h.coinsOf("alice") + h.coinsOf("bob"), 1999);
  config.POKER_RAKE = 0;
});

test("poker: a raise has to be answered, a fold gives the pot away", async () => {
  h.setCoins("alice", 1000);
  h.setCoins("carol", 1000);
  const alice = client("alice");
  const carol = client("carol");
  await waitFor(carol, "coins", (d) => d.coins === 1000);
  alice.emit("sit", { seat: 1, buyIn: 100 });
  await waitFor(alice, "pokerState", (s) => s.seats[1] != null);
  carol.emit("sit", { seat: 2, buyIn: 100 });
  const state = await waitFor(alice, "pokerState", (s) => s.phase === "preflop");
  const player = (seat) => (seat === 1 ? alice : carol);
  const first = player(state.current);
  const other = player(state.bb);

  // Wrong amounts are refused
  const tooSmall = h.once(first, "pokerError");
  first.emit("action", { type: "raise", amount: 15 });
  assert.match(await tooSmall, /at least 20/);
  const check = h.once(first, "pokerError");
  first.emit("action", { type: "check" });
  assert.match(await check, /can't check/);

  // Raise to 30, the big blind folds: the raiser gets the blinds
  first.emit("action", { type: "raise", amount: 30 });
  const raised = await waitFor(alice, "pokerState", (s) => s.current === state.bb);
  assert.strictEqual(raised.highBet, 30);
  assert.strictEqual(raised.seats[state.sb].lastAction, "Raise");
  other.emit("action", { type: "fold" });
  const end = await waitFor(alice, "pokerState", (s) => s.phase === "showdown");
  assert.strictEqual(end.result.showdown, false);
  assert.deepStrictEqual(end.result.winners.map((w) => [w.seat, w.amount]), [[state.sb, 40]]);
  assert.strictEqual(end.seats[state.sb].stack, 110);
  assert.strictEqual(end.seats[state.bb].stack, 90);
  // No showdown: carol's cards stay secret for alice
  assert.deepStrictEqual(end.seats[2].cards, [null, null]);

  await clearTable([alice, carol]);
});

test("poker: all-in, standing up in a hand and wrong buy-ins", async () => {
  h.setCoins("alice", 1000);
  h.setCoins("bob", 1000);
  const alice = client("alice");
  const bob = client("bob");
  await waitFor(bob, "coins", (d) => d.coins === 1000);

  for (const buyIn of [50, config.POKER_MAX_BUYIN + 1, 10.5, "100"]) {
    const refused = h.once(alice, "pokerError");
    alice.emit("sit", { seat: 0, buyIn });
    assert.match(await refused, new RegExp(`Buy in with ${config.POKER_MIN_BUYIN} - ${config.POKER_MAX_BUYIN}`));
  }
  const poor = h.once(alice, "pokerError");
  h.setCoins("alice", 120);
  alice.emit("sit", { seat: 0, buyIn: 150 });
  assert.match(await poor, /enough coins/);
  h.setCoins("alice", 1000);

  alice.emit("sit", { seat: 0, buyIn: 100 });
  await waitFor(alice, "pokerState", (s) => s.seats[0] != null);
  bob.emit("sit", { seat: 0, buyIn: 100 }); // taken: nothing happens
  bob.emit("sit", { seat: 4, buyIn: 200 });
  const state = await waitFor(alice, "pokerState", (s) => s.phase === "preflop");
  const player = (seat) => (seat === 0 ? alice : bob);

  // Everything in, the other calls: the board comes by itself
  player(state.current).emit("action", { type: "allin" });
  await waitFor(alice, "pokerState", (s) => s.current === state.bb);
  player(state.bb).emit("action", { type: "call" });
  const end = await waitFor(alice, "pokerState", (s) => s.phase === "showdown", 5000);
  assert.strictEqual(end.board.length, 5);
  assert.strictEqual(stacks(end), 300);
  // Alice (100) can't win more than 200
  const aliceWon = end.result.winners.filter((w) => w.seat === 0).reduce((sum, w) => sum + w.amount, 0);
  assert.ok(aliceWon <= 200);

  // Whoever is left with chips plays on; standing up during a hand folds it
  const next = await waitFor(alice, "pokerState", (s) => s.phase === "preflop" || s.phase === "waiting", 5000);
  if (next.phase === "preflop") {
    const stander = next.current === 0 ? bob : alice;
    stander.emit("stand");
    await waitFor(alice, "pokerState", (s) => s.phase === "showdown");
  }
  await clearTable([alice, bob]);
  await h.wait(30);
  assert.strictEqual(h.coinsOf("alice") + h.coinsOf("bob"), 2000, "every coin is back");
});

test("poker: the blinds go up every few hands and stay up while people play - back to the start when the table was empty", async () => {
  const before = { POKER_LEVEL_HANDS: config.POKER_LEVEL_HANDS, POKER_LEVEL_RESET: config.POKER_LEVEL_RESET };
  Object.assign(config, { POKER_LEVEL_HANDS: 1, POKER_LEVEL_RESET: 200 });
  try {
    // A fresh table (the hands of the tests before started the level clock)
    Object.assign(server.poker.table, { level: 0, levelSince: null, levelHands: 0 });
    h.setCoins("alice", 50000);
    h.setCoins("bob", 50000);
    const alice = client("alice");
    const bob = client("bob");
    await Promise.all([waitFor(alice, "coins", (d) => d.coins === 50000), waitFor(bob, "coins", (d) => d.coins === 50000)]);
    alice.emit("sit", { seat: 0, buyIn: 5000 });
    await waitFor(alice, "pokerState", (s) => s.seats[0] != null);
    const first = waitFor(alice, "pokerState", (s) => s.phase === "preflop");
    bob.emit("sit", { seat: 1, buyIn: 5000 });
    const hand1 = await first;
    assert.deepStrictEqual([hand1.level.number, hand1.rules.smallBlind, hand1.rules.bigBlind], [1, config.POKER_SMALL_BLIND, config.POKER_BIG_BLIND]);
    assert.deepStrictEqual(hand1.level.next, { small: config.POKER_SMALL_BLIND * 2, big: config.POKER_BIG_BLIND * 2 });
    assert.strictEqual(hand1.level.handsLeft, 0, "up with the next hand");

    // After the hands of a level: the blinds are doubled
    const fold = async (hand) => {
      const next = waitFor(alice, "pokerState", (s) => s.phase === "preflop" && s.hand === hand.hand + 1, 5000);
      (hand.current === 0 ? alice : bob).emit("action", { type: "fold" });
      return next;
    };
    const hand2 = await fold(hand1);
    assert.deepStrictEqual([hand2.level.number, hand2.rules.bigBlind, hand2.seats[hand2.bb].bet], [2, config.POKER_BIG_BLIND * 2, config.POKER_BIG_BLIND * 2]);

    // Playing on (even longer than the reset time of an empty table): the blinds stay up - and go on up
    await h.wait(300);
    const hand3 = await fold(hand2);
    assert.deepStrictEqual([hand3.level.number, hand3.rules.bigBlind], [3, config.POKER_BIG_BLIND * 4]);

    // Everybody stands up: after a while the blinds are back at the start
    await clearTable([alice, bob]);
    const reset = await waitFor(alice, "pokerState", (s) => s.level.number === 1, 3000);
    assert.strictEqual(reset.rules.bigBlind, config.POKER_BIG_BLIND);
  } finally {
    Object.assign(config, before);
  }
});

test("poker: after a hand the player decides to show or muck - with a timer, then mucked", async () => {
  h.setCoins("alice", 5000);
  h.setCoins("bob", 5000);
  const alice = client("alice");
  const bob = client("bob");
  await Promise.all([waitFor(alice, "coins", (d) => d.coins === 5000), waitFor(bob, "coins", (d) => d.coins === 5000)]);
  alice.emit("sit", { seat: 0, buyIn: 1000 });
  await waitFor(alice, "pokerState", (s) => s.seats[0] != null);
  const dealt = waitFor(alice, "pokerState", (s) => s.phase === "preflop");
  bob.emit("sit", { seat: 1, buyIn: 1000 });
  let state = await dealt;
  const player = (seat) => (seat === 0 ? alice : bob);

  // Everybody else folds: no showdown, the cards stay hidden - the winner may show them
  const winner = state.current === 0 ? 1 : 0;
  const over = waitFor(alice, "pokerState", (s) => s.phase === "showdown");
  player(state.current).emit("action", { type: "fold" });
  let end = await over;
  assert.strictEqual(end.result.showdown, false);
  assert.strictEqual(end.seats[winner].deciding, true, "the winner decides");
  assert.ok(end.decideIn > 0 && end.decideIn <= config.POKER_DECIDE);
  const other = winner === 0 ? 1 : 0;
  const seen = waitFor(player(other), "pokerState", (s) => s.phase === "showdown" && s.seats[winner] && s.seats[winner].shown);
  player(winner).emit("decide", { show: true });
  const shown = await seen;
  assert.ok(shown.seats[winner].cards.every((card) => typeof card === "string"), "the winner showed the cards");
  assert.strictEqual(shown.decideIn, null, "nobody decides anymore");
  await clearTable([alice, bob]);
});

test("poker: a server stop gives every chip back, also the ones in the pot", async () => {
  h.setCoins("alice", 500);
  h.setCoins("carol", 500);
  const alice = client("alice");
  const carol = client("carol");
  await waitFor(carol, "coins", (d) => d.coins === 500);
  alice.emit("sit", { seat: 0, buyIn: 200 });
  await waitFor(alice, "pokerState", (s) => s.seats[0] != null);
  carol.emit("sit", { seat: 1, buyIn: 200 });
  await waitFor(alice, "pokerState", (s) => s.phase === "preflop");
  assert.strictEqual(h.coinsOf("alice") + h.coinsOf("carol"), 600);

  await server.poker.refundAll();
  assert.strictEqual(h.coinsOf("alice") + h.coinsOf("carol"), 1000);
  assert.ok(server.poker.table.seats.every((seat) => seat == null));
});
