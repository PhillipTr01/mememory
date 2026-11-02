const { test, before, after } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const config = require("../game/config");
const mw = require("../game/megaways");

// A seeded random number generator (the spins of a test the same every time)
function rng(seed) {
  let a = seed >>> 0;
  return (max) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * max);
  };
}

/* ---------- The machine ---------- */

test("megaways: 6 reels of 2 to 7 rows - the ways are the product of the heights, the wild never on the first reel", () => {
  const random = rng(1);
  for (let i = 0; i < 2000; i++) {
    const grid = mw.screen(random);
    assert.strictEqual(grid.length, 6);
    grid.forEach((column) => assert.ok(column.length >= 2 && column.length <= 7));
    assert.ok(!grid[0].includes("wild"));
    assert.strictEqual(mw.waysOf(grid), grid.reduce((ways, column) => ways * column.length, 1));
  }
  assert.strictEqual(mw.catalog().maxWays, 117649);
});

test("megaways: a symbol wins on 3+ reels from the left - every combination a way, the wild stands in", () => {
  const pay = (id, reels) => mw.BY_ID.get(id).pays[reels - 3] * mw.PAY_SCALE;
  // 👑 on reels 1-3 (2 x 1 x 2 = 4 ways, one of them through a wild on reel 3), nothing on reel 4
  const grid = [
    ["crown", "crown", "bone"],
    ["key", "crown"],
    ["wild", "crown", "scroll"],
    ["key", "key"],
    ["bone", "bone"],
    ["egg", "bone"],
  ];
  const wins = mw.winsOf(grid);
  const crown = wins.find((w) => w.symbol === "crown");
  assert.deepStrictEqual([crown.reels, crown.ways], [3, 4]);
  assert.ok(Math.abs(crown.pay - 4 * pay("crown", 3)) < 1e-9);
  assert.deepStrictEqual(crown.spots, [[0, 0], [0, 1], [1, 1], [2, 0], [2, 1]]);
  // (the 🗝️ on reel 2 and 4 - not from the left: nothing; the wild alone pays nothing)
  assert.ok(!wins.some((w) => w.symbol === "key" || w.symbol === "wild"));
  // 6 reels: the 6-reel pay
  const full = mw.winsOf(Array.from({ length: 6 }, () => ["dragon", "bone"])).find((w) => w.symbol === "dragon");
  assert.deepStrictEqual([full.reels, full.ways], [6, 1]);
});

test("megaways: tumbles - the winning symbols go, the rest falls down, the heights stay, again while something wins", () => {
  const random = rng(7);
  let tumbled = 0;
  for (let i = 0; i < 3000; i++) {
    const first = mw.screen(random);
    const result = mw.tumble(first, random);
    assert.deepStrictEqual(result.grid.map((c) => c.length), first.map((c) => c.length));
    assert.strictEqual(mw.winsOf(result.grid).length, 0, "it ends without a win");
    if (result.steps.length) assert.strictEqual(result.steps[0].grid, first);
    result.steps.forEach((step) => {
      assert.ok(step.wins.length > 0);
      assert.ok(Math.abs(step.pay - step.wins.reduce((s, w) => s + w.pay, 0)) < 1e-9);
    });
    if (result.steps.length > 1) tumbled++;
    // (the symbols that didn't win stay - at the bottom of their reel)
    if (result.steps.length) {
      const step = result.steps[0];
      const gone = new Set(step.wins.flatMap((w) => w.spots.map(([r, row]) => r + ":" + row)));
      const next = result.steps[1] ? result.steps[1].grid : result.grid;
      step.grid.forEach((column, reel) => {
        const kept = column.filter((_, row) => !gone.has(reel + ":" + row));
        assert.deepStrictEqual(next[reel].slice(next[reel].length - kept.length), kept);
      });
    }
  }
  assert.ok(tumbled > 100, "chains of tumbles happen");
});

test("megaways: the free spins - 4 🥚 give 8, every 🥚 more 2; the multiplier grows with every tumble and never falls, a 🥚 a spin more and a taller cave", () => {
  assert.deepStrictEqual([3, 4, 5, 6].map(mw.freeSpinsFor), [0, 8, 10, 12]);
  const random = rng(11);
  let sawEgg = false;
  for (let g = 0; g < 300; g++) {
    const game = mw.freeGame(mw.FREE_SPINS, random);
    let multiplier = 1;
    let least = mw.MIN_ROWS;
    let spins = mw.FREE_SPINS;
    let x = 0;
    game.freeSpins.forEach((free) => {
      assert.strictEqual(free.multiplier, multiplier, "it never goes back down");
      free.steps.forEach((step, i) => assert.strictEqual(step.multiplier, multiplier + i));
      multiplier += free.steps.length;
      assert.strictEqual(free.multiplierAfter, multiplier);
      assert.strictEqual(free.least, least);
      free.grid.forEach((column) => assert.ok(column.length >= least));
      least = Math.min(mw.MAX_ROWS, least + free.eggs);
      spins += free.more;
      assert.strictEqual(free.spins, spins);
      if (free.eggs) sawEgg = true;
      x += free.pay;
    });
    assert.strictEqual(game.freeSpins.length, Math.min(game.spins, mw.MAX_FREE_SPINS));
    assert.ok(Math.abs(game.x - x) < 1e-6);
  }
  assert.ok(sawEgg);
});

test("megaways: a bonus buy starts the free spins every time; a spin never pays more than the max win", () => {
  const random = rng(3);
  for (let i = 0; i < 200; i++) {
    const s = mw.spin(100, random, { buy: true });
    assert.ok(s.eggs >= mw.EGG_TRIGGER && s.bonus, "the free spins");
    assert.ok(s.x <= mw.MAX_WIN);
    assert.strictEqual(s.win, Math.floor(100 * s.x));
  }
});

test("megaways: pays back about 96.8% - the base game (seeded spins) and the free spins (seeded free games) as the calibration says", () => {
  const random = rng(2024);
  const N = 120000;
  let base = 0;
  let triggers = 0;
  for (let i = 0; i < N; i++) {
    const result = mw.tumble(mw.screen(random), random);
    base += result.pay;
    if (mw.eggsIn(result.grid) >= mw.EGG_TRIGGER) triggers++;
  }
  // (the base game: 55.57% x 1.0448 = 58.06% - its spread over 120,000 spins about 0.6%)
  assert.ok(Math.abs(base / N - 0.5806) < 0.02, `base game ${base / N}`);
  // (the free spins: about 1 in 235 spins)
  assert.ok(Math.abs(N / triggers - 235) < 25, `free spins every ${N / triggers}`);
  let free = 0;
  const G = 8000;
  for (let g = 0; g < G; g++) free += mw.freeGame(mw.FREE_SPINS, random).x;
  // (4 🥚: about 80.5x - its spread over 8,000 games about 3.4x)
  assert.ok(Math.abs(free / G - 80.5) < 11, `free spins ${free / G}`);
  assert.strictEqual(mw.RTP, 0.968);
});

/* ---------- The server ---------- */

let server;
const tokens = {};
const sockets = [];

before(async () => {
  server = await h.startServer();
  tokens.mia = h.addUser("mia");
  tokens.noa = h.addUser("noa");
});

after(async () => {
  sockets.forEach((s) => s.close());
  await server.close();
});

function client(name) {
  const socket = server.client("/megaways", tokens[name]);
  sockets.push(socket);
  return socket;
}

const FAST = { MEGAWAYS_MIN_GAP: 0, MEGAWAYS_SPIN: 10, MEGAWAYS_TUMBLE: 0, MEGAWAYS_COUNT_TIME: 0, MEGAWAYS_FREE_INTRO: 0, MEGAWAYS_FREE_SPIN: 0, MEGAWAYS_EGG_TIME: 0, MEGAWAYS_BONUS_END: 0, MEGAWAYS_BIG_TIME: 0 };

test("megaways: a spin costs the bet, the server's reels decide, the win is paid once shown - the others see it", async () => {
  const before = Object.fromEntries(Object.keys(FAST).map((key) => [key, config[key]]));
  Object.assign(config, FAST);
  try {
    h.setCoins("mia", 50000);
    const mia = client("mia");
    const noa = client("noa");
    const setup = await h.once(mia, "mwSetup");
    assert.deepStrictEqual([setup.rules.minBet, setup.rules.maxBet, setup.reels, setup.maxWays, setup.buy], [config.MEGAWAYS_MIN_BET, config.MEGAWAYS_MAX_BET, 6, 117649, mw.BUY_PRICE]);
    await h.once(noa, "mwFeed");
    const feeds = [];
    noa.on("mwFeed", (feed) => feeds.push(feed));
    const n = (value) => value.toLocaleString("en-US");
    for (const bet of [config.MEGAWAYS_MIN_BET - 1, config.MEGAWAYS_MAX_BET + 1]) {
      const refused = h.once(mia, "mwError");
      mia.emit("spin", { bet });
      assert.match(await refused, new RegExp(`${n(config.MEGAWAYS_MIN_BET)} to ${n(config.MEGAWAYS_MAX_BET)}`));
    }
    assert.strictEqual(h.coinsOf("mia"), 50000);
    let spent = 0;
    let won = 0;
    let winning = null;
    for (let i = 0; i < 100 && !winning; i++) {
      const result = h.once(mia, "mwResult");
      mia.emit("spin", { bet: 100 });
      const r = await result;
      spent += 100;
      won += r.win;
      assert.strictEqual(r.grid.length, 6);
      if (r.bonus) {
        mia.emit("bonusStart", { id: r.id });
        mia.emit("bonusDone", { id: r.id });
        await h.wait(20);
        continue;
      }
      if (r.win > 0) winning = r;
    }
    assert.ok(winning, "a win within 100 spins");
    await h.wait(60);
    assert.strictEqual(h.coinsOf("mia"), 50000 - spent + won);
    const feed = feeds[feeds.length - 1];
    assert.ok(feed && feed[0].name === "mia" && feed[0].win === winning.win, "noa saw the win");
    assert.strictEqual(winning.win, Math.floor(100 * winning.x));
  } finally {
    Object.assign(config, before);
  }
});

test("megaways: a bonus buy - the free spins wait for the click, are paid when played (away: held, back: on from there)", async () => {
  const timing = { ...FAST, SLOTS_HOLD: 60000, MEGAWAYS_FREE_SPIN: 60, SLOTS_RESUME_TIME: 20 };
  const before = Object.fromEntries(Object.keys(timing).map((key) => [key, config[key]]));
  Object.assign(config, timing);
  try {
    sockets.forEach((socket) => socket.close());
    await h.wait(50);
    h.setCoins("mia", 50000);
    const page = client("mia");
    await h.once(page, "mwSetup");
    const result = h.once(page, "mwResult");
    page.emit("spin", { bet: 100, buy: true });
    const spin = await result;
    assert.ok(spin.bonus && spin.id && spin.eggs >= mw.EGG_TRIGGER);
    assert.strictEqual(h.coinsOf("mia"), 50000 - 100 * mw.BUY_PRICE, "the price of the buy");
    // One spin at a time while free spins wait
    const busy = h.once(page, "mwError");
    page.emit("spin", { bet: 100 });
    assert.match(await busy, /free spins first/);
    await h.wait(100);
    assert.strictEqual(h.coinsOf("mia"), 50000 - 100 * mw.BUY_PRICE, "nothing paid before the start");
    page.emit("bonusStart", { id: spin.id });
    page.emit("bonusProgress", { id: spin.id, shown: 1 });
    await h.wait(30);
    page.close();
    await h.wait(spin.bonus.freeSpins.length * 60 + 300);
    assert.strictEqual(h.coinsOf("mia"), 50000 - 100 * mw.BUY_PRICE, "nothing paid while away");
    const again = client("mia");
    const resumed = await h.once(again, "mwResume");
    assert.deepStrictEqual([resumed.id, resumed.shown, resumed.started, resumed.win], [spin.id, 1, true, spin.win]);
    await h.wait(resumed.payIn + 200);
    assert.strictEqual(h.coinsOf("mia"), 50000 - 100 * mw.BUY_PRICE + spin.win);
    again.close();
  } finally {
    Object.assign(config, before);
  }
});

test("megaways: its own share of the max bet by balance (1/x) - a bonus buy counts like a bet at a table", () => {
  const limits = require("../game/limits");
  const saved = [config.BET_CAP_FLOOR, config.BET_CAP_SHARE, config.MEGAWAYS_CAP_DIV];
  try {
    config.BET_CAP_FLOOR = 10000;
    config.BET_CAP_SHARE = 10;
    config.MEGAWAYS_CAP_DIV = 15;
    assert.deepStrictEqual(limits.capRule("", "megaways"), { floor: 700, share: 10 / 15 });
    assert.deepStrictEqual(limits.capRule("", "megaways:buy"), { floor: 10000, share: 10 });
    assert.strictEqual(limits.gameOfReason("megaways bet"), "megaways");
  } finally {
    [config.BET_CAP_FLOOR, config.BET_CAP_SHARE, config.MEGAWAYS_CAP_DIV] = saved;
  }
});
