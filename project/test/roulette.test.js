const { test, before, after } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const config = require("../game/config");
const roulette = require("../game/roulette");
const cases = require("../game/cases");
const inPlay = require("../game/in_play");

// Short timings for the tests
Object.assign(config, { ROULETTE_TIMER: 300, ROULETTE_SPIN: 100, ROULETTE_PAUSE: 100 });

test("roulette: 7 red, 7 blue, 1 green - 2x and 14x, the same payback for every color", () => {
  const count = (color) => roulette.WHEEL.filter((slot) => slot.color === color).length;
  assert.deepStrictEqual([count("red"), count("blue"), count("green"), roulette.WHEEL.length], [7, 7, 1, 15]);
  assert.deepStrictEqual(roulette.PAYOUT, { red: 2, blue: 2, green: 14 });
  for (const color of roulette.COLORS) assert.ok(Math.abs(roulette.rtp(color) - 14 / 15) < 1e-9, color);
  // Red and blue never together, green with either
  assert.ok(!roulette.allowed({ red: 10 }, "blue"));
  assert.ok(!roulette.allowed({ blue: 10 }, "red"));
  assert.ok(roulette.allowed({ red: 10 }, "green") && roulette.allowed({ blue: 10, green: 5 }, "green"));
  // Provably fair: the slot comes from the seed, every slot comes
  const { seed } = cases.newSeed();
  assert.strictEqual(roulette.slotFor(seed, 7), roulette.slotFor(seed, 7));
  const seen = new Set();
  for (let round = 0; round < 2000; round++) seen.add(roulette.slotFor(seed, round));
  assert.strictEqual(seen.size, 15);
});

let server;
const sockets = [];
const tokens = {};

function client(name) {
  const socket = server.client("/roulette", tokens[name]);
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
  for (const name of ["alice", "bob"]) tokens[name] = h.addUser(name);
});

after(async () => {
  sockets.forEach((s) => s.close());
  server.roulette.stop();
  await server.close();
});

test("roulette: no timer without a bet; the first bet starts it, the reel rolls, the winners are paid", async () => {
  h.setCoins("alice", 10000);
  h.setCoins("bob", 10000);
  const alice = client("alice");
  const bob = client("bob");
  const idle = await h.once(alice, "rouletteState");
  await h.once(bob, "rouletteState");
  assert.strictEqual(idle.phase, "idle");
  assert.strictEqual(idle.timeLeft, null);
  assert.ok(idle.fair.hash && !idle.fair.seed, "only the hash before the roll");
  // Nobody bets: nothing happens
  await h.wait(400);
  assert.strictEqual(server.roulette.table.phase, "idle");

  const betting = waitFor(alice, "rouletteState", (s) => s.phase === "betting");
  alice.emit("bet", { color: "red", amount: 1000 });
  const started = await betting;
  assert.ok(started.timeLeft > 0 && started.timeLeft <= 300);
  assert.strictEqual(h.coinsOf("alice"), 9000);
  assert.ok(inPlay.where("alice").includes("roulette"));

  // Red and blue never together
  const refused = h.once(alice, "rouletteError");
  alice.emit("bet", { color: "blue", amount: 100 });
  assert.match(await refused, /red/);
  // Green with it - and bob on blue
  alice.emit("bet", { color: "green", amount: 100 });
  bob.emit("bet", { color: "blue", amount: 500 });
  await waitFor(alice, "rouletteState", (s) => s.bets.length === 3);

  const rolled = await waitFor(alice, "rouletteState", (s) => s.phase === "rolling");
  assert.ok(Number.isInteger(rolled.slot));
  assert.strictEqual(rolled.slot, roulette.slotFor(rolled.fair.seed, rolled.round), "the slot from the seed");
  // No bets while it rolls
  const late = h.once(bob, "rouletteError");
  bob.emit("bet", { color: "green", amount: 100 });
  assert.match(await late, /rolls/);

  const done = await waitFor(alice, "rouletteState", (s) => s.history.length > 0 && s.history[0].round === rolled.round);
  const color = roulette.WHEEL[rolled.slot].color;
  const expectAlice = 8900 + (color === "red" ? 2000 : 0) + (color === "green" ? 1400 : 0);
  const expectBob = 9500 + (color === "blue" ? 1000 : 0);
  await h.wait(30);
  assert.strictEqual(h.coinsOf("alice"), expectAlice, `alice on ${color}`);
  assert.strictEqual(h.coinsOf("bob"), expectBob, `bob on ${color}`);
  assert.strictEqual(done.history[0].color, color);
  // Then a new round that waits for a bet
  const next = await waitFor(alice, "rouletteState", (s) => s.round === rolled.round + 1);
  assert.strictEqual(next.phase, "idle");
  assert.strictEqual(next.bets.length, 0);
  assert.ok(!inPlay.where("alice").includes("roulette"));
});

test("roulette: at most ROULETTE_MAX_BET per player and round (all colors), at least the min bet, not more than the coins", async () => {
  const old = config.ROULETTE_MAX_BET;
  config.ROULETTE_MAX_BET = 1000;
  try {
    h.setCoins("bob", 5000);
    const bob = client("bob");
    await h.once(bob, "rouletteState");
    const small = h.once(bob, "rouletteError");
    bob.emit("bet", { color: "red", amount: 5 });
    assert.match(await small, /At least/);
    bob.emit("bet", { color: "red", amount: 800 });
    await waitFor(bob, "rouletteState", (s) => s.bets.some((b) => b.name === "bob"));
    const tooMuch = h.once(bob, "rouletteError");
    bob.emit("bet", { color: "green", amount: 300 });
    assert.match(await tooMuch, /At most/);
    assert.strictEqual(h.coinsOf("bob"), 4200);
    // Not enough coins
    h.setCoins("bob", 50);
    const poor = h.once(bob, "rouletteError");
    bob.emit("bet", { color: "green", amount: 100 });
    assert.match(await poor, /enough coins/);
    await waitFor(bob, "rouletteState", (s) => s.phase === "idle", 3000);
  } finally {
    config.ROULETTE_MAX_BET = old;
  }
});

test("roulette: fast bets one after the other - none gets lost", async () => {
  h.setCoins("alice", 5000);
  const alice = client("alice");
  await h.once(alice, "rouletteState");
  for (const color of ["red", "green", "red", "green"]) alice.emit("bet", { color, amount: 100 });
  const state = await waitFor(alice, "rouletteState", (s) => s.bets.filter((b) => b.name === "alice").length === 4);
  assert.strictEqual(state.bets.length, 4);
  assert.strictEqual(h.coinsOf("alice"), 4600);
  await waitFor(alice, "rouletteState", (s) => s.phase === "idle", 3000);
});
