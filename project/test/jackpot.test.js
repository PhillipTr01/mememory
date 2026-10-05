const { test, before, after } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const config = require("../game/config");
const coins = require("../game/coins");
const { pickWinner } = require("../game/jackpot");

// Short timings for the tests
Object.assign(config, { JACKPOT_COUNTDOWN: 200, JACKPOT_SPIN: 100, JACKPOT_PAUSE: 100 });

/* ---------- Pure logic ---------- */

test("jackpot: every coin is a ticket, the chance is the share of the pot", () => {
  const entries = [
    { name: "alice", coins: 30 },
    { name: "bob", coins: 10 },
  ];
  // Tickets 0-29 belong to alice, 30-39 to bob
  assert.strictEqual(pickWinner(entries, () => 0).winner, "alice");
  assert.strictEqual(pickWinner(entries, () => 29).winner, "alice");
  assert.strictEqual(pickWinner(entries, () => 30).winner, "bob");
  assert.strictEqual(pickWinner(entries, () => 39).winner, "bob");
  assert.strictEqual(pickWinner(entries, () => 5).total, 40);

  const wins = { alice: 0, bob: 0 };
  for (let i = 0; i < 8000; i++) wins[pickWinner(entries).winner]++;
  const share = wins.alice / 8000;
  assert.ok(share > 0.71 && share < 0.79, `alice wins about 75% (${share})`);
  assert.strictEqual(pickWinner([]), null);
});

/* ---------- Coins ---------- */

let server;
const sockets = [];
const tokens = {};

function client(user) {
  const socket = server.client("/jackpot", tokens[user]);
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

before(async () => {
  server = await h.startServer();
  for (const name of ["alice", "bob", "carol", "dave"]) tokens[name] = h.addUser(name);
});

after(async () => {
  sockets.forEach((s) => s.close());
  await server.close();
});

test("coins: old accounts start with the start coins, spending needs enough coins", async () => {
  assert.deepStrictEqual(await coins.get("dave"), { coins: config.START_COINS, bonus: false });
  assert.strictEqual(await coins.spend("dave", config.START_COINS + 1), false);
  assert.strictEqual(await coins.spend("dave", 40), true);
  assert.strictEqual(await coins.spend("dave", 1.5), false);
  assert.strictEqual(await coins.spend("dave", -5), false);
  assert.strictEqual(h.coinsOf("dave"), config.START_COINS - 40);

  // Wins give coins
  coins.reward("dave", "expert");
  await h.wait(20);
  assert.strictEqual(h.coinsOf("dave"), config.START_COINS - 40 + config.COIN_REWARDS.expert);
});

test("coins: free coins once a day, only when (almost) broke", async () => {
  h.setCoins("dave", 50);
  assert.strictEqual(await coins.claimBonus("dave"), false, "not broke");
  h.setCoins("dave", 3);
  assert.strictEqual((await coins.get("dave")).bonus, true);
  assert.strictEqual(await coins.claimBonus("dave"), true);
  assert.strictEqual(h.coinsOf("dave"), 3 + config.DAILY_BONUS);
  h.setCoins("dave", 0);
  assert.strictEqual(await coins.claimBonus("dave"), false, "once a day");
  assert.strictEqual(await coins.claimBonus("dave", Date.now() + config.BONUS_EVERY + 1000), true);
});

/* ---------- The pot ---------- */

test("jackpot: two players start the countdown, the winner gets the whole pot", async () => {
  h.setCoins("alice", 100);
  h.setCoins("bob", 100);
  const alice = client("alice");
  const bob = client("bob");
  await waitFor(alice, "coins", (data) => data.coins === 100);
  await waitFor(bob, "coins", (data) => data.coins === 100);

  // One player alone: no countdown
  const open = waitFor(alice, "jackpotState", (s) => s.total === 30);
  alice.emit("bet", { amount: 30 });
  const state = await open;
  assert.strictEqual(state.phase, "open");
  assert.strictEqual(h.coinsOf("alice"), 70);

  const countdown = waitFor(alice, "jackpotState", (s) => s.phase === "countdown");
  bob.emit("bet", { amount: 10 });
  const running = await countdown;
  assert.strictEqual(running.total, 40);
  assert.ok(running.endsIn > 0);

  // Bets during the countdown still count
  const more = waitFor(alice, "jackpotState", (s) => s.total === 45);
  bob.emit("bet", { amount: 5 });
  await more;

  const drawing = await waitFor(alice, "jackpotState", (s) => s.phase === "drawing");
  assert.ok(["alice", "bob"].includes(drawing.draw.winner));
  assert.strictEqual(drawing.draw.total, 45);
  assert.ok(drawing.draw.ticket >= 0 && drawing.draw.ticket < 45);

  // Nothing is lost or created: 200 coins before, 200 after
  await waitFor(alice, "jackpotState", (s) => s.history.length > 0);
  assert.strictEqual(h.coinsOf("alice") + h.coinsOf("bob"), 200);
  const winner = drawing.draw.winner;
  assert.strictEqual(h.coinsOf(winner), (winner === "alice" ? 70 : 85) + 45);

  // A new, empty round follows
  const next = await waitFor(alice, "jackpotState", (s) => s.phase === "open");
  assert.strictEqual(next.total, 0);
  assert.strictEqual(next.round, drawing.round + 1);
});

test("jackpot: invalid bets are rejected", async () => {
  h.setCoins("carol", 20);
  const carol = client("carol");
  await waitFor(carol, "coins", (data) => data.coins === 20);

  for (const amount of [0, -5, 2.5, "10", null]) carol.emit("bet", { amount });
  carol.emit("bet", null);
  const tooMuch = h.once(carol, "betError");
  carol.emit("bet", { amount: 21 });
  assert.match(await tooMuch, /enough coins/);

  const overLimit = h.once(carol, "betError");
  carol.emit("bet", { amount: config.JACKPOT_MAX_BET + 1 });
  assert.match(await overLimit, /At most/);
  assert.strictEqual(h.coinsOf("carol"), 20);
});

test("jackpot: chat works like in the other games", async () => {
  const alice = client("alice");
  const message = waitFor(alice, "chatMessage", (m) => m.type === "user" && m.text === "good luck");
  alice.emit("sendChatMessage", { message: "good luck" });
  assert.strictEqual((await message).name, "alice");
});
