const { test, before, after } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const config = require("../game/config");
const pd = require("../game/pond");

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

const ALL = (id) => [id, id, id, id, id, id];

test("pond: clusters - 7 or more of one kind touching side by side, tiers mixed, the firefly joins and counts as the best tier", () => {
  // 7 berries in an L (a firefly in it), the rest in diagonal stripes (no cluster)
  const stripe = (c, r) => ["leaf0", "bug0", "shell0"][(c + r) % 3];
  const grid = Array.from({ length: 6 }, (_, c) => Array.from({ length: 6 }, (_, r) => stripe(c, r)));
  [[0, 0, "berry0"], [1, 0, "berry2"], [2, 0, "wild"], [3, 0, "berry1"], [4, 0, "berry0"], [4, 1, "berry0"], [4, 2, "berry2"]].forEach(([c, r, id]) => (grid[c][r] = id));
  grid[5][5] = "moon";
  grid[0][5] = "splash";
  const clusters = pd.clustersOf(grid);
  assert.strictEqual(clusters.length, 1);
  const [berry] = clusters;
  assert.strictEqual(berry.family, "berry");
  assert.deepStrictEqual(berry.cells, [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [4, 1], [4, 2]]);
  const v = pd.TIER_VALUES;
  const value = v[0] + v[2] + v[2] + v[1] + v[0] + v[0] + v[2];
  assert.ok(Math.abs(berry.value - value) < 1e-9);
  assert.ok(Math.abs(berry.pay - value * pd.SIZE_FACTORS[0] * pd.PAY_SCALE) < 1e-9);
  // 6 touching: nothing; a whole board of one kind: one cluster of 36 (the biggest size factor)
  grid[4][2] = "moon";
  assert.strictEqual(pd.clustersOf(grid).length, 0);
  const full = pd.clustersOf(Array.from({ length: 6 }, () => ALL("shell1")));
  assert.deepStrictEqual([full.length, full[0].size], [1, 36]);
  assert.ok(Math.abs(full[0].pay - 36 * v[1] * pd.SIZE_FACTORS[pd.SIZE_FACTORS.length - 1] * pd.PAY_SCALE) < 1e-9);
});

test("pond: tumbles, frogs and specials - it ends with nothing left to do, the board stays square and never above 8x8", () => {
  const random = rng(7);
  let leaps = 0;
  let grew = 0;
  let splashes = 0;
  for (let i = 0; i < 3000; i++) {
    const state = { levels: pd.newLevels(), bellies: pd.newBellies() };
    const first = pd.board(random);
    const result = pd.play(first, random, state);
    const n = result.grid.length;
    assert.ok(n >= 6 && n <= 8);
    result.grid.forEach((column) => assert.strictEqual(column.length, n));
    assert.strictEqual(pd.clustersOf(result.grid).length, 0, "nothing wins at the end");
    assert.ok(!result.grid.some((c) => c.includes("lotus") || c.includes("splash")), "no special left");
    if (result.steps.length) assert.strictEqual(result.steps[0].grid, first);
    let pay = 0;
    result.steps.forEach((step) => {
      pay += step.pay;
      if (step.kind === "win") assert.ok(step.clusters.length > 0);
      else assert.ok(step.specials.length > 0 && step.clusters.length === 0);
      step.leaps.forEach((leap) => {
        leaps++;
        assert.strictEqual(step.bellies[leap.family], 0, "the belly empties");
        assert.ok(leap.level >= 1 && leap.level <= pd.MAX_LEVEL);
      });
      if (step.grow) grew++;
      splashes += step.specials.filter((s) => s.id === "splash").length;
      Object.values(step.bellies).forEach((b) => assert.ok(b < pd.BELLY));
    });
    assert.ok(Math.abs(result.pay - pay) < 1e-9);
  }
  assert.ok(leaps > 20 && grew > 100 && splashes > 100, `leaps ${leaps}, grown ${grew}, splashes ${splashes}`);
});

test("pond: a full frog eats all of its kind left on the board and its kind lands better from then on", () => {
  const random = rng(5);
  const state = { levels: pd.newLevels(), bellies: { ...pd.newBellies(), bug: pd.BELLY - 1 } };
  // A cluster of 7 bugs on top, 3 more bugs elsewhere
  const grid = Array.from({ length: 6 }, (_, c) => Array.from({ length: 6 }, (_, r) => ["leaf0", "shell0", "berry0"][(c + r) % 3]));
  for (let c = 0; c < 6; c++) grid[c][0] = "bug0";
  grid[0][1] = "bug0";
  grid[0][5] = grid[2][4] = "bug2";
  grid[5][5] = "bug1";
  const step = pd.play(grid, random, state).steps[0];
  assert.deepStrictEqual(step.leaps.map((l) => [l.family, l.cells.length, l.level]), [["bug", 3, 1]]);
  const value = 2 * pd.TIER_VALUES[2] + pd.TIER_VALUES[1];
  assert.ok(Math.abs(step.leaps[0].pay - value * pd.LEAP_PAY * pd.PAY_SCALE) < 1e-9);
  assert.strictEqual(state.levels.bug >= 1, true);
  // Better tiers: a grown up family lands far more of its tier 2
  const count = (levels) => {
    let top = 0;
    for (let i = 0; i < 4000; i++) {
      const grid = pd.board(random, 6, levels);
      grid.forEach((column) => column.forEach((id) => id === "bug2" && top++));
    }
    return top;
  };
  assert.ok(count({ ...pd.newLevels(), bug: 2 }) > 4 * count(pd.newLevels()));
});

test("pond: the free spins - 3 🌕 give 8, every 🌕 more 2; the pond, the bellies and the better kinds carry on, a 🌕 a spin more", () => {
  assert.deepStrictEqual([2, 3, 4, 5].map(pd.freeSpinsFor), [0, 8, 10, 12]);
  const random = rng(11);
  let sawMoon = false;
  let carried = false;
  for (let g = 0; g < 150; g++) {
    const game = pd.freeGame(pd.FREE_SPINS, random);
    let size = pd.MIN_SIZE;
    let spins = pd.FREE_SPINS;
    let x = 0;
    let levels = pd.newLevels();
    game.freeSpins.forEach((free) => {
      assert.strictEqual(free.size, size, "the pond keeps its size");
      assert.strictEqual(free.grid.length, size);
      assert.deepStrictEqual(free.levels, levels, "the kinds keep their level");
      size = free.last.length;
      levels = free.steps.length ? free.steps[free.steps.length - 1].levels : levels;
      if (Object.values(free.bellies).some((b) => b > 0)) carried = true;
      spins += free.more;
      assert.strictEqual(free.spins, spins);
      if (free.moons) sawMoon = true;
      x += free.pay;
    });
    assert.strictEqual(game.freeSpins.length, Math.min(game.spins, pd.MAX_FREE_SPINS));
    assert.ok(Math.abs(game.x - x) < 1e-6);
  }
  assert.ok(sawMoon && carried);
});

test("pond: a bonus buy starts the free spins every time; a spin never pays more than the max win", () => {
  const random = rng(3);
  for (let i = 0; i < 100; i++) {
    const s = pd.spin(100, random, { buy: true });
    assert.ok(s.moons >= pd.MOON_TRIGGER && s.bonus, "the free spins");
    assert.ok(s.x <= pd.MAX_WIN);
    assert.strictEqual(s.win, Math.floor(100 * s.x));
  }
});

test("pond: pays back about 96.8% - the base game (seeded spins) and the free spins (seeded free games) as the calibration says", () => {
  const random = rng(2024);
  const N = 60000;
  let base = 0;
  let triggers = 0;
  for (let i = 0; i < N; i++) {
    const result = pd.play(pd.board(random), random, { levels: pd.newLevels(), bellies: pd.newBellies() });
    base += result.pay;
    if (pd.moonsIn(result.grid) >= pd.MOON_TRIGGER) triggers++;
  }
  // (the base game: 54.29% - its spread over 60,000 spins about 0.4%)
  assert.ok(Math.abs(base / N - 0.5429) < 0.02, `base game ${base / N}`);
  // (the free spins: about 1 in 250 spins)
  assert.ok(Math.abs(N / triggers - 250) < 45, `free spins every ${N / triggers}`);
  let free = 0;
  const G = 2000;
  for (let g = 0; g < G; g++) free += pd.freeGame(pd.FREE_SPINS, random).x;
  // (3 🌕: about 98.1x - its spread over 2,000 games about 2.6x)
  assert.ok(Math.abs(free / G - 98.1) < 10, `free spins ${free / G}`);
  assert.strictEqual(pd.RTP, 0.968);
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
  const socket = server.client("/pond", tokens[name]);
  sockets.push(socket);
  return socket;
}

const FAST = { POND_MIN_GAP: 0, POND_SPIN: 10, POND_TUMBLE: 0, POND_COUNT_TIME: 0, POND_FREE_INTRO: 0, POND_FREE_SPIN: 0, POND_MOON_TIME: 0, POND_LEAP_TIME: 0, POND_BONUS_END: 0, POND_BIG_TIME: 0 };

test("pond: a spin costs the bet, the server's board decides, the win is paid once shown - the others see it", async () => {
  const before = Object.fromEntries(Object.keys(FAST).map((key) => [key, config[key]]));
  Object.assign(config, FAST);
  try {
    h.setCoins("mia", 50000);
    const mia = client("mia");
    const noa = client("noa");
    const setup = await h.once(mia, "pdSetup");
    assert.deepStrictEqual([setup.rules.minBet, setup.rules.maxBet, setup.size, setup.families.length, setup.buy], [config.POND_MIN_BET, config.POND_MAX_BET, [6, 8], 4, pd.BUY_PRICE]);
    await h.once(noa, "pdFeed");
    const feeds = [];
    noa.on("pdFeed", (feed) => feeds.push(feed));
    const n = (value) => value.toLocaleString("en-US");
    for (const bet of [config.POND_MIN_BET - 1, config.POND_MAX_BET + 1]) {
      const refused = h.once(mia, "pdError");
      mia.emit("spin", { bet });
      assert.match(await refused, new RegExp(`${n(config.POND_MIN_BET)} to ${n(config.POND_MAX_BET)}`));
    }
    assert.strictEqual(h.coinsOf("mia"), 50000);
    let spent = 0;
    let won = 0;
    let winning = null;
    for (let i = 0; i < 100 && !winning; i++) {
      const result = h.once(mia, "pdResult");
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

test("pond: a bonus buy - the free spins wait for the click, are paid when played (away: held, back: on from there)", async () => {
  const timing = { ...FAST, SLOTS_HOLD: 60000, POND_FREE_SPIN: 60, SLOTS_RESUME_TIME: 20 };
  const before = Object.fromEntries(Object.keys(timing).map((key) => [key, config[key]]));
  Object.assign(config, timing);
  try {
    sockets.forEach((socket) => socket.close());
    await h.wait(50);
    h.setCoins("mia", 50000);
    const page = client("mia");
    await h.once(page, "pdSetup");
    const result = h.once(page, "pdResult");
    page.emit("spin", { bet: 100, buy: true });
    const spin = await result;
    assert.ok(spin.bonus && spin.id && spin.moons >= pd.MOON_TRIGGER);
    assert.strictEqual(h.coinsOf("mia"), 50000 - 100 * pd.BUY_PRICE, "the price of the buy");
    // One spin at a time while free spins wait
    const busy = h.once(page, "pdError");
    page.emit("spin", { bet: 100 });
    assert.match(await busy, /free spins first/);
    await h.wait(100);
    assert.strictEqual(h.coinsOf("mia"), 50000 - 100 * pd.BUY_PRICE, "nothing paid before the start");
    page.emit("bonusStart", { id: spin.id });
    page.emit("bonusProgress", { id: spin.id, shown: 1 });
    await h.wait(30);
    page.close();
    await h.wait(spin.bonus.freeSpins.length * 60 + 300);
    assert.strictEqual(h.coinsOf("mia"), 50000 - 100 * pd.BUY_PRICE, "nothing paid while away");
    const again = client("mia");
    const resumed = await h.once(again, "pdResume");
    assert.deepStrictEqual([resumed.id, resumed.shown, resumed.started, resumed.win], [spin.id, 1, true, spin.win]);
    await h.wait(resumed.payIn + 200);
    assert.strictEqual(h.coinsOf("mia"), 50000 - 100 * pd.BUY_PRICE + spin.win);
    again.close();
  } finally {
    Object.assign(config, before);
  }
});

test("pond: its own share of the max bet by balance (1/x) - a bonus buy counts like a bet at a table", () => {
  const limits = require("../game/limits");
  const saved = [config.BET_CAP_FLOOR, config.BET_CAP_SHARE, config.POND_CAP_DIV];
  try {
    config.BET_CAP_FLOOR = 10000;
    config.BET_CAP_SHARE = 10;
    config.POND_CAP_DIV = 15;
    assert.deepStrictEqual(limits.capRule("", "pond"), { floor: 700, share: 10 / 15 });
    assert.deepStrictEqual(limits.capRule("", "pond:buy"), { floor: 10000, share: 10 });
    assert.strictEqual(limits.gameOfReason("pond bet"), "pond");
  } finally {
    [config.BET_CAP_FLOOR, config.BET_CAP_SHARE, config.POND_CAP_DIV] = saved;
  }
});

test("pond: free spins saved by other rules (an update of the game) are paid when the player is back, not shown again", async () => {
  sockets.forEach((socket) => socket.close());
  await h.wait(50);
  h.setCoins("mia", 1000);
  const old = { id: "old:1", name: "mia", bet: 100, win: 1106, note: "free spins 8", at: Date.now() + 60000, result: { bet: 100, grid: [["flower0"]], bonus: { freeSpins: [] }, win: 1106 }, shown: 3, state: "paused", feed: null };
  server.pond.machine.pending.push(old);
  const page = client("mia");
  let resumed = false;
  page.on("pdResume", () => (resumed = true));
  await h.once(page, "pdSetup");
  await h.wait(100);
  assert.strictEqual(resumed, false, "not shown again");
  assert.strictEqual(h.coinsOf("mia"), 1000 + 1106, "paid");
  assert.ok(!server.pond.machine.pending.includes(old));
  page.close();
});
