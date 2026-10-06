const { test, before, after } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const config = require("../game/config");
const bj = require("../game/blackjack");

// Short timings for the tests
Object.assign(config, { BJ_BETTING: 80, BJ_STEP: 10, BJ_RESULT: 80, BJ_TURN: 3000 });

/* ---------- Rules ---------- */

test("blackjack: card values, soft aces, blackjack, the dealer stands on 17", () => {
  assert.deepStrictEqual(bj.handValue(["As", "6d"]), { total: 17, soft: true });
  assert.deepStrictEqual(bj.handValue(["As", "6d", "Tc"]), { total: 17, soft: false });
  assert.deepStrictEqual(bj.handValue(["As", "Ad", "9c"]), { total: 21, soft: true });
  assert.strictEqual(bj.isBlackjack(["As", "Kd"], false), true);
  assert.strictEqual(bj.isBlackjack(["As", "Kd"], true), false, "after a split it is only 21");
  assert.strictEqual(bj.dealerHits(["Ts", "6d"]), true);
  assert.strictEqual(bj.dealerHits(["As", "6d"]), false, "stands on a soft 17");
  assert.strictEqual(bj.canSplit(["Ks", "Qd"]), true);
  assert.strictEqual(bj.canSplit(["Ks", "9d"]), false);

  const hand = (cards, bet) => ({ cards: cards, bet: bet || 100, split: false });
  assert.deepStrictEqual(bj.settle(hand(["As", "Kd"]), ["9s", "8d"]), { result: "blackjack", payout: 250 });
  assert.deepStrictEqual(bj.settle(hand(["Ts", "9d"]), ["9s", "8d"]), { result: "win", payout: 200 });
  assert.deepStrictEqual(bj.settle(hand(["Ts", "7d"]), ["9s", "8d"]), { result: "push", payout: 100 });
  assert.deepStrictEqual(bj.settle(hand(["Ts", "6d"]), ["9s", "8d"]), { result: "lose", payout: 0 });
  assert.deepStrictEqual(bj.settle(hand(["Ts", "6d", "8c"]), ["9s", "8d"]), { result: "bust", payout: 0 });
  assert.deepStrictEqual(bj.settle(hand(["Ts", "6d"]), ["9s", "8d", "Kc"]), { result: "win", payout: 200 });
  assert.deepStrictEqual(bj.settle(hand(["As", "Kd"]), ["Ah", "Qd"]), { result: "push", payout: 100 });
});

test("blackjack: no counting - every round a new, fully shuffled shoe of 6 decks", () => {
  const a = bj.newShoe();
  const b = bj.newShoe();
  assert.strictEqual(a.length, 312);
  assert.strictEqual(new Set(a).size, 52);
  assert.strictEqual(a.filter((card) => card === "As").length, 6);
  assert.notDeepStrictEqual(a, b);
});

test("blackjack: the cards are spread like a real shoe - every rank and suit equally often, at every place", () => {
  const SHOES = 20000;
  const ranks = "23456789TJQKA";
  // The first card dealt (the end of the shoe) and one from the middle
  const first = new Map();
  const middle = new Map();
  const suits = new Map();
  for (let n = 0; n < SHOES; n++) {
    const shoe = bj.newShoe();
    const top = shoe[shoe.length - 1];
    const mid = shoe[150];
    first.set(top[0], (first.get(top[0]) || 0) + 1);
    middle.set(mid[0], (middle.get(mid[0]) || 0) + 1);
    suits.set(top[1], (suits.get(top[1]) || 0) + 1);
  }
  for (const rank of ranks) {
    for (const [name, counts] of [["first", first], ["middle", middle]]) {
      const share = counts.get(rank) / SHOES;
      assert.ok(Math.abs(share - 1 / 13) < 0.012, `${name} card ${rank}: ${share.toFixed(4)} ~ ${(1 / 13).toFixed(4)}`);
    }
  }
  for (const suit of "shdc") assert.ok(Math.abs(suits.get(suit) / SHOES - 0.25) < 0.02, `suit ${suit}`);
  // A ten-value card (10, J, Q, K) a bit less than a third of the time - like in a real casino
  const tens = ["T", "J", "Q", "K"].reduce((sum, rank) => sum + first.get(rank), 0) / SHOES;
  assert.ok(Math.abs(tens - 4 / 13) < 0.015, `ten-value cards: ${tens}`);
});

/* ---------- The table ---------- */

let server;
const sockets = [];
const tokens = {};

function client(user) {
  const socket = server.client("/blackjack", tokens[user]);
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

// The cards in the order they are dealt (player, dealer, player, dealer, then hits)
function shoe(...cards) {
  bj.testing.shoe = cards.slice().reverse();
}

before(async () => {
  server = await h.startServer();
  for (const name of ["alice", "bob", "carol"]) tokens[name] = h.addUser(name);
});

after(async () => {
  bj.testing.shoe = null;
  sockets.forEach((s) => s.close());
  await server.close();
});

// One round with alice on seat 0: bet, wait for the cards
async function round(alice, bet, cards) {
  shoe(...cards);
  const dealt = waitFor(alice, "blackjackState", (s) => s.phase !== "betting");
  alice.emit("sit", 0);
  alice.emit("bet", { seat: 0, amount: bet });
  return dealt;
}

const over = (socket) => waitFor(socket, "blackjackState", (s) => s.phase === "result");
const fresh = (socket) => waitFor(socket, "blackjackState", (s) => s.phase === "betting" && s.seats.every((seat) => !seat || seat.bet === 0));

test("blackjack: sit down first, bets 10 to 5,000 per seat, a second seat after a bet on the first", async () => {
  h.setCoins("alice", 20000);
  h.setCoins("bob", 20000);
  const alice = client("alice");
  const bob = client("bob");
  await Promise.all([waitFor(alice, "coins", (d) => d.coins === 20000), waitFor(bob, "coins", (d) => d.coins === 20000)]);
  config.BJ_BETTING = 60000; // the round waits

  // No bet without a seat
  let refused = h.once(alice, "blackjackError");
  alice.emit("bet", { seat: 0, amount: 100 });
  assert.match(await refused, /Sit down first/);
  alice.emit("sit", 0);
  const seated = await waitFor(alice, "blackjackState", (s) => s.seats[0] && s.seats[0].name === "alice");
  assert.strictEqual(seated.seats[0].bet, 0);
  assert.ok(seated.seats[0].standIn > 0, "without a bet the seat is only kept for a while");
  // A second seat only after a bet on the first
  refused = h.once(alice, "blackjackError");
  alice.emit("sit", 1);
  assert.match(await refused, /Bet on your seat first/);

  for (const [amount, message] of [[5, /At least 10/], [5001, /At most 5,000/]]) {
    const refused = h.once(alice, "blackjackError");
    alice.emit("bet", { seat: 0, amount });
    assert.match(await refused, message);
  }
  // Two seats for alice
  alice.emit("bet", { seat: 0, amount: 3000 });
  const bet = await waitFor(alice, "blackjackState", (s) => s.seats[0] && s.seats[0].bet === 3000);
  assert.strictEqual(bet.seats[0].standIn, null, "with a bet the seat stays");
  alice.emit("sit", 1);
  await waitFor(alice, "blackjackState", (s) => s.seats[1] && s.seats[1].name === "alice");
  alice.emit("bet", { seat: 1, amount: 500 });
  const both = await waitFor(alice, "blackjackState", (s) => s.seats[1] && s.seats[1].bet === 500);
  assert.strictEqual(both.seats[0].name, "alice");
  assert.ok(both.startIn > 0, "the betting time runs");
  // More on the own seat, but not over 5,000
  const tooMuch = h.once(alice, "blackjackError");
  alice.emit("bet", { seat: 0, amount: 2500 });
  assert.match(await tooMuch, /At most 5,000/);
  // At most 3 seats at a time
  alice.emit("sit", 2);
  await waitFor(alice, "blackjackState", (s) => s.seats[2] && s.seats[2].name === "alice");
  alice.emit("bet", { seat: 2, amount: 10 });
  await waitFor(alice, "blackjackState", (s) => s.seats[2] && s.seats[2].bet === 10);
  const tooMany = h.once(alice, "blackjackError");
  alice.emit("sit", 3);
  assert.match(await tooMany, /At most 3 seats/);
  alice.emit("clearBet", 2);
  await waitFor(alice, "blackjackState", (s) => s.seats[2] == null);
  assert.strictEqual(both.seats.length, 7, "seven seats");

  // Bob can't take alice's seat
  for (const event of ["sit", "bet"]) {
    const taken = h.once(bob, "blackjackError");
    bob.emit(event, event === "sit" ? 0 : { seat: 0, amount: 100 });
    assert.match(await taken, /taken/);
  }
  assert.strictEqual(h.coinsOf("alice"), 20000 - 3500);

  // Taking the bets back: the coins come back, the seats are free
  alice.emit("clearBet", 0);
  alice.emit("clearBet", 1);
  await waitFor(alice, "blackjackState", (s) => s.seats.every((seat) => seat == null));
  await h.wait(30);
  assert.strictEqual(h.coinsOf("alice"), 20000);
  config.BJ_BETTING = 80;
});

test("blackjack: the dealer's second card is hidden, a stand against 17 is a push", async () => {
  h.setCoins("alice", 1000);
  const alice = client("alice");
  await waitFor(alice, "coins", (d) => d.coins === 1000);
  const dealt = await round(alice, 100, ["Ts", "9h", "7d", "8c"]);
  assert.strictEqual(dealt.phase, "playing");
  assert.deepStrictEqual(dealt.dealer.cards, ["9h", null], "the hole card stays on the server");
  assert.deepStrictEqual(dealt.current, { seat: 0, hand: 0 });
  assert.strictEqual(dealt.seats[0].hands[0].value.total, 17);

  const end = over(alice);
  alice.emit("action", "stand");
  const result = await end;
  assert.deepStrictEqual(result.dealer.cards, ["9h", "8c"]);
  assert.strictEqual(result.seats[0].hands[0].result, "push");
  await h.wait(30);
  assert.strictEqual(h.coinsOf("alice"), 1000);
  await fresh(alice);
});

test("blackjack: a blackjack pays 3:2, a double draws one card for twice the bet", async () => {
  h.setCoins("alice", 1000);
  const alice = client("alice");
  await waitFor(alice, "coins", (d) => d.coins === 1000);

  // Blackjack: done right away, the dealer plays (16, draws a 2: 18)
  let end = over(alice);
  await round(alice, 100, ["As", "9h", "Kd", "7c", "2d"]);
  let result = await end;
  assert.strictEqual(result.seats[0].hands[0].result, "blackjack");
  await h.wait(30);
  assert.strictEqual(h.coinsOf("alice"), 1000 + 150);
  await fresh(alice);

  // Double on 11: one card (a ten), 21 against the dealer's 17
  end = over(alice);
  await round(alice, 100, ["5s", "9h", "6d", "8c", "Tc"]);
  alice.emit("action", "double");
  result = await end;
  const hand = result.seats[0].hands[0];
  assert.strictEqual(hand.doubled, true);
  assert.deepStrictEqual(hand.cards, ["5s", "6d", "Tc"]);
  assert.strictEqual(hand.result, "win");
  await h.wait(30);
  assert.strictEqual(h.coinsOf("alice"), 1150 + 200);
  await fresh(alice);
});

test("blackjack: split - two hands, both played; the dealer busts", async () => {
  h.setCoins("alice", 1000);
  const alice = client("alice");
  await waitFor(alice, "coins", (d) => d.coins === 1000);
  const end = over(alice);
  // 8 8 against 10 6; split: 8+3, 8+10; hit the first: K (21); the dealer draws a 9 (bust)
  await round(alice, 100, ["8s", "Th", "8d", "6c", "3d", "Tc", "Kh", "9s"]);
  alice.emit("action", "split");
  const split = await waitFor(alice, "blackjackState", (s) => s.seats[0].hands.length === 2);
  assert.deepStrictEqual(split.seats[0].hands.map((hand) => hand.cards), [["8s", "3d"], ["8d", "Tc"]]);
  assert.deepStrictEqual(split.current, { seat: 0, hand: 0 });
  alice.emit("action", "hit"); // 21: done by itself
  await waitFor(alice, "blackjackState", (s) => s.current && s.current.hand === 1);
  alice.emit("action", "stand");
  const result = await end;
  assert.deepStrictEqual(result.seats[0].hands.map((hand) => hand.result), ["win", "win"]);
  assert.strictEqual(result.dealer.value.total, 25);
  await h.wait(30);
  assert.strictEqual(h.coinsOf("alice"), 1000 + 200);
  await fresh(alice);
});

test("blackjack: the dealer looks for a blackjack first - it ends the round", async () => {
  h.setCoins("alice", 1000);
  const alice = client("alice");
  await waitFor(alice, "coins", (d) => d.coins === 1000);
  const end = over(alice);
  await round(alice, 100, ["Ts", "Ah", "9d", "Kc"]);
  const result = await end;
  assert.strictEqual(result.seats[0].hands[0].result, "lose");
  assert.deepStrictEqual(result.dealer.cards, ["Ah", "Kc"]);
  await h.wait(30);
  assert.strictEqual(h.coinsOf("alice"), 900);
  // Not your turn: nothing
  const wrong = h.once(alice, "blackjackError");
  alice.emit("action", "hit");
  assert.match(await wrong, /not your turn/);
  await fresh(alice);
});

test("blackjack: a seat without a bet - the player stands up by himself", async () => {
  h.setCoins("bob", 1000);
  const bob = client("bob");
  await waitFor(bob, "coins", (d) => d.coins === 1000);
  // Not in time: free again
  config.BJ_SIT = 150;
  bob.emit("sit", 3);
  await waitFor(bob, "blackjackState", (s) => s.seats[3] && s.seats[3].name === "bob");
  await waitFor(bob, "blackjackState", (s) => s.seats[3] == null);
  config.BJ_SIT = 20000;

  // The cards come: a seat without a bet is left
  config.BJ_BETTING = 400;
  bob.emit("sit", 3);
  await waitFor(bob, "blackjackState", (s) => s.seats[3] && s.seats[3].name === "bob");
  shoe("Ts", "9h", "7d", "8c");
  bob.emit("bet", { seat: 3, amount: 100 });
  await waitFor(bob, "blackjackState", (s) => s.seats[3] && s.seats[3].bet === 100);
  bob.emit("sit", 4);
  const dealt = await waitFor(bob, "blackjackState", (s) => s.phase === "playing");
  config.BJ_BETTING = 80;
  assert.strictEqual(dealt.seats[4], null, "stood up");
  assert.strictEqual(dealt.seats[3].hands.length, 1);
  const end = over(bob);
  bob.emit("action", "stand");
  await end;
  await fresh(bob);
});

test("blackjack: the same bets as last round with one click", async () => {
  h.setCoins("carol", 10000);
  const carol = client("carol");
  await waitFor(carol, "coins", (d) => d.coins === 10000);
  // Nothing to repeat yet
  let refused = h.once(carol, "blackjackError");
  carol.emit("rebet");
  assert.match(await refused, /No bet to repeat/);

  // A round on seats 5 and 6
  shoe("Ts", "9h", "Td", "9h", "8c", "7d", "9c", "8s");
  carol.emit("sit", 5);
  carol.emit("bet", { seat: 5, amount: 300 });
  await waitFor(carol, "blackjackState", (s) => s.seats[5] && s.seats[5].bet === 300);
  carol.emit("sit", 6);
  carol.emit("bet", { seat: 6, amount: 200 });
  await waitFor(carol, "blackjackState", (s) => s.phase === "playing");
  const end = over(carol);
  carol.emit("action", "stand");
  await waitFor(carol, "blackjackState", (s) => s.current && s.current.seat === 6);
  carol.emit("action", "stand");
  await end;
  const next = await fresh(carol);
  assert.deepStrictEqual(next.lastBets, [{ seat: 5, amount: 300 }, { seat: 6, amount: 200 }]);
  await h.wait(30);
  const before = h.coinsOf("carol");

  // One click: the same seats, the same coins
  config.BJ_BETTING = 60000;
  carol.emit("rebet");
  const again = await waitFor(carol, "blackjackState", (s) => s.seats[5] && s.seats[5].bet === 300 && s.seats[6] && s.seats[6].bet === 200);
  assert.ok(again.startIn > 0);
  await h.wait(30);
  assert.strictEqual(h.coinsOf("carol"), before - 500);
  refused = h.once(carol, "blackjackError");
  carol.emit("rebet");
  assert.match(await refused, /already bet/);
  carol.emit("clearBet", 5);
  carol.emit("clearBet", 6);
  await waitFor(carol, "blackjackState", (s) => s.seats[5] == null && s.seats[6] == null);
  config.BJ_BETTING = 80;
  await h.wait(30);
  assert.strictEqual(h.coinsOf("carol"), before);
});

test("blackjack: a server stop gives every open bet back", async () => {
  h.setCoins("bob", 1000);
  const bob = client("bob");
  await waitFor(bob, "coins", (d) => d.coins === 1000);
  shoe("Ts", "9h", "7d", "8c");
  const dealt = waitFor(bob, "blackjackState", (s) => s.phase === "playing");
  // Still on seat 4 from the last round (without a bet): a bet there
  bob.emit("sit", 3);
  bob.emit("bet", { seat: 3, amount: 400 });
  await dealt;
  assert.strictEqual(h.coinsOf("bob"), 600);
  await server.blackjack.refundAll();
  assert.strictEqual(h.coinsOf("bob"), 1000);
});
