const { test, before, after } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const config = require("../game/config");
const baucua = require("../game/baucua");
const cases = require("../game/cases");
const inPlay = require("../game/in_play");

// Short timings for the tests
Object.assign(config, { BAUCUA_TIMER: 300, BAUCUA_SPIN: 100, BAUCUA_PAUSE: 100 });

test("baucua: six animals, three dice - 1 / 2 / 3 dice of an animal pay 2x / 3x / 10x, 205/216 back", () => {
  assert.deepStrictEqual(baucua.IDS, ["tiger", "gourd", "rooster", "fish", "crab", "shrimp"]);
  assert.deepStrictEqual(baucua.PAYOUT, [0, 2, 3, 10]);
  assert.ok(Math.abs(baucua.rtp() - 205 / 216) < 1e-12);
  assert.strictEqual(baucua.payout("crab", 100, ["crab", "fish", "tiger"]), 200);
  assert.strictEqual(baucua.payout("crab", 100, ["crab", "crab", "tiger"]), 300);
  assert.strictEqual(baucua.payout("crab", 100, ["crab", "crab", "crab"]), 1000);
  assert.strictEqual(baucua.payout("gourd", 100, ["crab", "crab", "crab"]), 0);
  // Provably fair: the dice come from the seed - every animal on every die, about as often
  const { seed } = cases.newSeed();
  assert.deepStrictEqual(baucua.diceFor(seed, 7), baucua.diceFor(seed, 7));
  const counts = new Map();
  let paid = 0;
  const rounds = 6000;
  for (let round = 0; round < rounds; round++) {
    const dice = baucua.diceFor(seed, round);
    dice.forEach((id) => counts.set(id, (counts.get(id) || 0) + 1));
    paid += baucua.payout("fish", 1, dice);
  }
  assert.strictEqual(counts.size, 6);
  for (const n of counts.values()) assert.ok(Math.abs(n - (rounds * 3) / 6) < 400, `${n}`);
  assert.ok(Math.abs(paid / rounds - 205 / 216) < 0.06, `payback ${paid / rounds}`);
});

let server;
const sockets = [];
const tokens = {};

function client(name) {
  const socket = server.client("/baucua", tokens[name]);
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
  for (const name of ["bc_alice", "bc_bob"]) tokens[name] = h.addUser(name);
});

after(async () => {
  sockets.forEach((s) => s.close());
  server.baucua.stop();
  await server.close();
});

test("baucua: no timer without a bet; the first bet starts it, the dice roll, every animal pays by its dice", async () => {
  h.setCoins("bc_alice", 10000);
  h.setCoins("bc_bob", 10000);
  const alice = client("bc_alice");
  const bob = client("bc_bob");
  const idle = await h.once(alice, "baucuaState");
  await h.once(bob, "baucuaState");
  assert.strictEqual(idle.phase, "idle");
  assert.ok(idle.fair.hash && !idle.fair.seed, "only the hash before the roll");
  assert.deepStrictEqual(idle.rules.payout, [0, 2, 3, 10]);
  await h.wait(400);
  assert.strictEqual(server.baucua.table.phase, "idle");

  const betting = waitFor(alice, "baucuaState", (s) => s.phase === "betting");
  alice.emit("bet", { animal: "crab", amount: 1000 });
  const started = await betting;
  assert.ok(started.timeLeft > 0 && started.timeLeft <= 300);
  assert.strictEqual(h.coinsOf("bc_alice"), 9000);
  assert.ok(inPlay.where("bc_alice").includes("baucua"));
  // Several animals at once - and a wrong one is ignored
  alice.emit("bet", { animal: "fish", amount: 200 });
  alice.emit("bet", { animal: "dragon", amount: 200 });
  bob.emit("bet", { animal: "tiger", amount: 500 });
  await waitFor(alice, "baucuaState", (s) => s.bets.length === 3);

  const rolled = await waitFor(alice, "baucuaState", (s) => s.phase === "rolling");
  assert.deepStrictEqual(rolled.dice, baucua.diceFor(rolled.fair.seed, rolled.round), "the dice from the seed");
  const late = h.once(bob, "baucuaError");
  bob.emit("bet", { animal: "crab", amount: 100 });
  assert.match(await late, /rolling/);

  const done = await waitFor(alice, "baucuaState", (s) => s.history.length > 0 && s.history[0].round === rolled.round);
  await h.wait(30);
  const pays = (animal, amount) => baucua.payout(animal, amount, rolled.dice);
  assert.strictEqual(h.coinsOf("bc_alice"), 8800 + pays("crab", 1000) + pays("fish", 200));
  assert.strictEqual(h.coinsOf("bc_bob"), 9500 + pays("tiger", 500));
  assert.deepStrictEqual(done.history[0].dice, rolled.dice);
  const next = await waitFor(alice, "baucuaState", (s) => s.round === rolled.round + 1);
  assert.strictEqual(next.phase, "idle");
  assert.ok(!inPlay.where("bc_alice").includes("baucua"));
});

test("baucua: at most BAUCUA_MAX_BET per player and round (all animals), at least the min bet", async () => {
  const old = config.BAUCUA_MAX_BET;
  config.BAUCUA_MAX_BET = 1000;
  try {
    h.setCoins("bc_bob", 5000);
    const bob = client("bc_bob");
    await h.once(bob, "baucuaState");
    const small = h.once(bob, "baucuaError");
    bob.emit("bet", { animal: "gourd", amount: 5 });
    assert.match(await small, /At least/);
    bob.emit("bet", { animal: "gourd", amount: 800 });
    await waitFor(bob, "baucuaState", (s) => s.bets.some((b) => b.name === "bc_bob"));
    const tooMuch = h.once(bob, "baucuaError");
    bob.emit("bet", { animal: "shrimp", amount: 300 });
    assert.match(await tooMuch, /At most/);
    assert.strictEqual(h.coinsOf("bc_bob"), 4200);
    await waitFor(bob, "baucuaState", (s) => s.phase === "idle", 3000);
  } finally {
    config.BAUCUA_MAX_BET = old;
  }
});

test("baucua: the admin's test world - a forced triple, bots", () => {
  const test = server.test.baucua;
  test.forceDice("triple");
  assert.ok(test.botBet("bot_x", "crab", 100));
  assert.ok(test.rollNow());
  const dice = test.table.dice;
  assert.ok(dice[0] === dice[1] && dice[1] === dice[2]);
  test.stop();
});

test("baucua: at most BAUCUA_MAX_BETS separate bets per player and round (3 by default)", async () => {
  assert.strictEqual(config.BAUCUA_MAX_BETS, 3);
  h.setCoins("bc_alice", 5000);
  const alice = client("bc_alice");
  await waitFor(alice, "baucuaState", (s) => s.phase === "idle" && s.rules.maxBets === 3);
  for (const animal of ["crab", "fish", "crab"]) alice.emit("bet", { animal, amount: 100 });
  await waitFor(alice, "baucuaState", (s) => s.bets.filter((b) => b.name === "bc_alice").length === 3);
  const refused = h.once(alice, "baucuaError");
  alice.emit("bet", { animal: "tiger", amount: 100 });
  assert.match(await refused, /At most 3 bets per round/);
  assert.strictEqual(h.coinsOf("bc_alice"), 4700);
  await waitFor(alice, "baucuaState", (s) => s.phase === "idle", 3000);
});
