const { test, before, after } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const config = require("../game/config");
const slots = require("../game/slots");

/* ---------- The machine ---------- */

test("slots: 5 reels, 3 rows, 9 lines; pays back about 95% (exactly computed)", () => {
  assert.strictEqual(slots.STRIPS.length, 5);
  assert.strictEqual(slots.LINES.length, 9);
  assert.ok(slots.LINES.every((rows) => rows.length === 5 && rows.every((row) => row >= 0 && row <= 2)));
  // Nine different lines
  assert.strictEqual(new Set(slots.LINES.map((rows) => rows.join())).size, 9);
  const { rtp, lineHit } = slots.rtp();
  assert.ok(rtp > 0.93 && rtp < 0.97, `payback ${(rtp * 100).toFixed(2)}%`);
  assert.ok(lineHit > 0.05, "a line wins often enough");
});

test("slots: a line wins from the left, the wild stands for every symbol", () => {
  const pays = (id) => slots.SYMBOLS.find((s) => s.id === id).pays;
  assert.deepStrictEqual(slots.lineWin(["pepe", "pepe", "pepe", "doge", "pepe"]), { multiplier: pays("pepe")[0], symbol: "pepe", count: 3 });
  assert.strictEqual(slots.lineWin(["doge", "pepe", "pepe", "pepe", "pepe"]).multiplier, 0, "only from the left");
  assert.deepStrictEqual(slots.lineWin(["wild", "rocket", "wild", "rocket", "banana"]), { multiplier: pays("rocket")[1], symbol: "rocket", count: 4 });
  assert.deepStrictEqual(slots.lineWin(["wild", "wild", "wild", "wild", "wild"]), { multiplier: pays("wild")[2], symbol: "wild", count: 5 });
  // Three wilds and a banana: the wilds pay more on their own
  assert.deepStrictEqual(slots.lineWin(["wild", "wild", "wild", "banana", "doge"]), { multiplier: pays("wild")[0], symbol: "wild", count: 3 });
  assert.strictEqual(slots.lineWin(["banana", "doge", "banana", "banana", "banana"]).multiplier, 0);
});

test("slots: a spin pays a ninth of the bet per line times the multiplier", () => {
  // Every reel stops where its middle row is a diamond (or a wild)
  const stops = slots.STRIPS.map((strip) => strip.indexOf("diamond"));
  let n = 0;
  const result = slots.spin(900, () => stops[n++]);
  assert.deepStrictEqual(result.grid.map((reel) => reel[1]), ["diamond", "diamond", "diamond", "diamond", "diamond"]);
  const middle = result.lines.find((line) => line.line === 0);
  assert.deepStrictEqual([middle.symbol, middle.count, middle.win], ["diamond", 5, 100 * slots.SYMBOLS.find((s) => s.id === "diamond").pays[2]]);
  assert.strictEqual(result.win, Math.floor((900 * result.lines.reduce((sum, line) => sum + line.multiplier, 0)) / 9));
});

test("slots: three 🎁 start the bonus game - free spins with a growing multiplier, at most 250x the bet", () => {
  // The 🎁 only on reels 1, 3, 5, never two in one window
  slots.STRIPS.forEach((strip, reel) => {
    const at = strip.map((s, i) => (s === "bonus" ? i : -1)).filter((i) => i >= 0);
    assert.strictEqual(at.length, [3, 0, 3, 0, 1][reel]);
    // Never two in one window (3 rows): at least 3 apart, also round the end of the strip
    at.forEach((i, n) => {
      const next = at[(n + 1) % at.length];
      if (at.length > 1) assert.ok((next - i + strip.length) % strip.length >= 3);
    });
  });
  // The middle row of reels 1, 3, 5 on a 🎁; the wheels: 8 free spins (field 2), start x3 (field 2)
  const bonusStops = slots.STRIPS.map((strip, reel) => ([0, 2, 4].includes(reel) ? strip.indexOf("bonus") : 0));
  const spinsTicket = 40 + 26; // the first ticket of field 2
  const multiplierTicket = 50 + 30;
  // Every free spin: the middle row all diamonds (5x diamond on line 1)
  const diamonds = slots.STRIPS.map((strip) => strip.indexOf("diamond"));
  const rolls = bonusStops.concat([spinsTicket, multiplierTicket]);
  for (let n = 0; n < 8; n++) rolls.push(...diamonds);
  let i = 0;
  const big = slots.spin(100, () => rolls[i++]);
  assert.deepStrictEqual([big.bonus.spins, big.bonus.multiplier], [8, 3]);
  // Diamonds every time: the max win is reached in the first free spins and the bonus ends there
  assert.strictEqual(big.win, 100 * slots.MAX_WIN);
  assert.ok(big.capped);
  assert.ok(big.bonus.freeSpins.length < 8);
  assert.strictEqual(big.bonus.win + big.lineWin, big.win);

  // 5 free spins from x1 (stops without a 🎁 in sight: no retrigger) - every win is the line win times
  // the multiplier, which climbs by one
  const start = bonusStops.concat([0, 0]);
  const plain = slots.STRIPS.map((strip) => strip.findIndex((_, i) => [-1, 0, 1].every((d) => strip[(i + d + strip.length) % strip.length] !== "bonus")));
  let k = 0;
  let r = 0;
  const random = slots.spin(100, () => (k < start.length ? start[k++] : plain[r++ % 5]));
  assert.deepStrictEqual(random.bonus.freeSpins.map((f) => f.multiplier), [1, 2, 3, 4, 5]);
  random.bonus.freeSpins.forEach((f) => assert.strictEqual(f.win, f.lineWin * f.multiplier));

  // Three 🎁 in a free spin: 5 free spins more (5 + 5 = 10, multiplier 1 to 10)
  const again = bonusStops.concat([0, 0], bonusStops);
  let j = 0;
  r = 0;
  const retriggered = slots.spin(100, () => (j < again.length ? again[j++] : plain[r++ % 5]));
  assert.strictEqual(retriggered.bonus.freeSpins[0].retrigger, slots.RETRIGGER);
  assert.strictEqual(retriggered.bonus.spins, 5 + slots.RETRIGGER);
  assert.strictEqual(retriggered.bonus.freeSpins.length, 10);
  assert.strictEqual(retriggered.bonus.freeSpins[9].multiplier, 10);

  // Rare: the bonus about 1 of 200 spins, the max win in very few bonuses 
  const { bonusChance, rtp } = slots.rtp();
  assert.ok(bonusChance > 1 / 250 && bonusChance < 1 / 150, `bonus 1 of ${Math.round(1 / bonusChance)}`);
  assert.ok(rtp > 0.93 && rtp < 0.97);
});

/* ---------- The page ---------- */

let server;
const tokens = {};
const sockets = [];

before(async () => {
  server = await h.startServer();
  tokens.alice = h.addUser("alice");
  tokens.bob = h.addUser("bob");
});

after(async () => {
  sockets.forEach((s) => s.close());
  await server.close();
});

function client(name) {
  const socket = server.client("/slots", tokens[name]);
  sockets.push(socket);
  return socket;
}

test("slots: a spin costs the bet, the win comes right away, the others see it", async () => {
  Object.assign(config, { SLOTS_MIN_GAP: 0, SLOTS_SPIN: 10, SLOTS_COUNT_TIME: 0, SLOTS_BONUS_TIME: 0, SLOTS_FREE_SPIN: 0, SLOTS_BONUS_END: 0, SLOTS_RETRIGGER_TIME: 0, SLOTS_BIG_TIME: 0, SLOTS_SWEAT: 0 });
  h.setCoins("alice", 5000);
  const alice = client("alice");
  const bob = client("bob");
  const setup = await h.once(alice, "slotsSetup");
  assert.deepStrictEqual([setup.rules.minBet, setup.rules.maxBet, setup.rules.lines], [10, 1000, 9]);
  await h.once(bob, "slotsFeed");
  const feeds = [];
  bob.on("slotsFeed", (feed) => feeds.push(feed));

  // Out of the limits: nothing happens to the coins
  for (const bet of [5, 1001]) {
    const refused = h.once(alice, "slotsError");
    alice.emit("spin", { bet });
    assert.match(await refused, /10 to 1,000/);
  }
  assert.strictEqual(h.coinsOf("alice"), 5000);

  // Spins until one wins: every spin costs 100, every win is paid
  let spent = 0;
  let won = 0;
  let winning = null;
  for (let i = 0; i < 200 && !winning; i++) {
    const result = h.once(alice, "slotsResult");
    alice.emit("spin", { bet: 100 });
    const r = await result;
    spent += 100;
    won += r.win;
    assert.strictEqual(r.grid.length, 5);
    if (r.win > 0) winning = r;
  }
  assert.ok(winning, "a win within 200 spins");
  await h.wait(50);
  assert.strictEqual(h.coinsOf("alice"), 5000 - spent + won);
  const feed = feeds[feeds.length - 1];
  assert.ok(feed, "bob saw the win");
  assert.strictEqual(feed[0].name, "alice");
  assert.strictEqual(feed[0].win, winning.win);

  // Not enough coins
  h.setCoins("alice", 50);
  const poor = h.once(alice, "slotsError");
  alice.emit("spin", { bet: 100 });
  assert.match(await poor, /enough coins/);
  Object.assign(config, { SLOTS_MIN_GAP: 600, SLOTS_SPIN: 2000, SLOTS_COUNT_TIME: 1800, SLOTS_BONUS_TIME: 6000, SLOTS_FREE_SPIN: 3000, SLOTS_BONUS_END: 4000, SLOTS_RETRIGGER_TIME: 900, SLOTS_BIG_TIME: 3000, SLOTS_SWEAT: 1800 });
});

test("slots: the admin test switch - every spin starts the bonus game", () => {
  for (let i = 0; i < 20; i++) {
    const result = slots.spin(100, undefined, { forceBonus: true });
    assert.ok(result.bonus, "a bonus every time");
    assert.ok([0, 2, 4].every((reel) => result.grid[reel].includes("bonus")));
    assert.ok(result.win <= 100 * slots.MAX_WIN);
  }
});

test("slots: a bonus game waits while the player is away and goes on when they come back", async () => {
  const timing = { SLOTS_HOLD: 60000, SLOTS_MIN_GAP: 0, SLOTS_SPIN: 50, SLOTS_COUNT_TIME: 50, SLOTS_BONUS_TIME: 100, SLOTS_FREE_SPIN: 100, SLOTS_RETRIGGER_TIME: 10, SLOTS_BONUS_END: 50, SLOTS_RESUME_TIME: 50, SLOTS_BIG_TIME: 50, SLOTS_TEST_BONUS: true };
  const before = Object.fromEntries(Object.keys(timing).map((key) => [key, config[key]]));
  Object.assign(config, timing);
  try {
    // No other page of alice open (from the tests before)
    sockets.forEach((socket) => socket.close());
    await h.wait(50);
    h.setCoins("alice", 5000);
    const page = client("alice");
    await h.once(page, "slotsSetup");
    const result = h.once(page, "slotsResult");
    page.emit("spin", { bet: 100 });
    const spin = await result;
    assert.ok(spin.bonus && spin.id, "a bonus game with an id");
    // "You won free spins" waits for the click: nothing is paid meanwhile
    await h.wait(spin.payIn + 200);
    assert.strictEqual(h.coinsOf("alice"), 4900, "nothing paid before the start");
    // Started - one free spin seen, then the player leaves
    page.emit("bonusStart", { id: spin.id });
    page.emit("bonusProgress", { id: spin.id, shown: 1 });
    await h.wait(30);
    page.close();
    await h.wait(spin.payIn + 200);
    assert.strictEqual(h.coinsOf("alice"), 4900, "nothing paid while away");

    // Back: the bonus goes on after the first free spin, paid when it is over
    const again = client("alice");
    const resumed = await h.once(again, "slotsResume");
    assert.deepStrictEqual([resumed.id, resumed.shown, resumed.started, resumed.win], [spin.id, 1, true, spin.win]);
    assert.ok(resumed.payIn < spin.payIn);
    await h.wait(resumed.payIn + 200);
    assert.strictEqual(h.coinsOf("alice"), 4900 + spin.win);
    again.close();
  } finally {
    Object.assign(config, before);
  }
});
