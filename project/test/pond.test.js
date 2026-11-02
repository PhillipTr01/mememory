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

const copy = (grid) => grid.map((column) => column.slice());
// A pond from rows (easier to read): rows[r][c], "." an empty spot
const fromRows = (rows) => rows[0].map((_, c) => rows.map((row) => (row[c] === "." ? null : row[c])));

test("pond: a frog moves only onto its amber, the wild and the features next to it - other colours and empty spots stop it, a fly bridges a gap", () => {
  const grid = fromRows([
    ["berry", "leaf", "coin1", ".", "leaf", "leaf"],
    [".", "fly", ".", ".", ".", "."],
    ["shell", "leaf", "wild", "bug", "leaf", "."],
    [".", ".", ".", ".", ".", "."],
    ["leaf", "leaf", ".", ".", ".", "."],
    [".", ".", ".", ".", ".", "."],
  ]);
  const frogs = { leaf: [0, 1], berry: [5, 5], bug: [0, 5], shell: [5, 3] };
  const move = pd.moveFrog(grid, frogs, "leaf");
  // (over the fly to the two leaves, on to the coin and the wild; the red, blue and gold amber stop it)
  assert.deepStrictEqual(move.got.slice().sort(), ["coin1", "leaf", "leaf", "wild"]);
  assert.strictEqual(move.amber, 3, "2 leaves and the wild");
  assert.deepStrictEqual([grid[0][0], grid[0][2], grid[3][2]], ["berry", "shell", "bug"], "the other colours stay");
  assert.strictEqual(grid[1][1], null, "the fly crossed is eaten");
  assert.deepStrictEqual([grid[4][0], grid[5][0], grid[4][2], grid[0][4], grid[1][4]], ["leaf", "leaf", "leaf", "leaf", "leaf"], "out of reach");
  assert.deepStrictEqual(frogs.leaf, move.end);
  // Without the fly: the frog is stuck
  const stuck = fromRows([["berry", "leaf"], [".", "."]]);
  assert.strictEqual(pd.moveFrog(stuck, { leaf: [0, 1], berry: [1, 1], bug: [9, 9], shell: [8, 8] }, "leaf").path.length, 1);
  // Every hop goes to a neighbour
  move.path.slice(1).forEach((spot, i) => assert.strictEqual(Math.abs(spot[0] - move.path[i][0]) + Math.abs(spot[1] - move.path[i][1]), 1));
  // Another frog blocks the way
  const blocked = fromRows([["leaf", "leaf", "leaf"], [".", ".", "."], [".", ".", "."]]);
  const two = { leaf: [0, 0], berry: [1, 0], bug: [2, 2], shell: [1, 2] };
  blocked[0][0] = null;
  assert.strictEqual(pd.moveFrog(blocked, two, "leaf").path.length, 1);
});

test("pond: the frogs move while they find something - the pond stays square (6x6 to 8x8), the meter below full, the levels at most 7", () => {
  const random = rng(7);
  const seen = { coin: 0, sun: 0, lotus: 0, rain: 0, swirl: 0, flies: 0, moon: 0, wild: 0, chests: 0 };
  for (let i = 0; i < 3000; i++) {
    const state = pd.newState();
    const { grid, frogs } = pd.deal(random);
    const result = pd.play(grid, frogs, random, state);
    const n = result.grid.length;
    assert.ok(n >= 6 && n <= 8);
    result.grid.forEach((column) => assert.strictEqual(column.length, n));
    const spots = Object.values(result.frogs).map((spot) => spot.join(":"));
    assert.strictEqual(new Set(spots).size, 4, "a frog per spot");
    Object.values(result.frogs).forEach(([c, r]) => assert.strictEqual(result.grid[c][r], null, "an empty spot under a frog"));
    // Nothing left to collect at the end
    for (const family of pd.FAMILY_IDS) assert.strictEqual(pd.moveFrog(copy(result.grid), JSON.parse(JSON.stringify(result.frogs)), family).path.length, 1);
    let pay = 0;
    let moons = 0;
    result.steps.forEach((step) => {
      pay += step.pay;
      assert.ok(step.moves.length > 0 || step.meets.length > 0, "a step moves a frog or changes the pond");
      const parts = step.moves.reduce((sum, move) => sum + move.pay, 0) + step.effects.reduce((sum, effect) => sum + (effect.pay || 0), 0);
      assert.ok(Math.abs(parts - step.pay) < 1e-9, "the moves and the coins");
      step.moves.forEach((move) => assert.ok(Math.abs(move.pay - move.amber * pd.AMBER_VALUES[move.level] * pd.PAY_SCALE) < 1e-9));
      assert.ok(step.meter >= 0 && step.meter < pd.METER);
      Object.values(step.levels).forEach((level) => assert.ok(level >= 0 && level <= pd.MAX_LEVEL));
      step.effects.forEach((effect) => (seen[effect.id] = (seen[effect.id] || 0) + 1));
      if (step.chests.length) seen.chests++;
      moons += step.effects.filter((effect) => effect.id === "moon").length;
    });
    assert.strictEqual(state.moons, moons);
    assert.ok(Math.abs(result.pay - pay) < 1e-9);
  }
  Object.entries(seen).forEach(([id, count]) => assert.ok(count > 0, `${id} seen`));
});

test("pond: the features - a coin pays, the sun upgrades, the swirl turns a colour, rain and flies fill the empty spots, the lotus grows the pond", () => {
  const random = rng(5);
  const frogs = { leaf: [0, 0], berry: [5, 5], bug: [0, 5], shell: [5, 0] };
  const fresh = () => {
    const grid = Array.from({ length: 6 }, () => Array(6).fill(null));
    grid[2][2] = "berry";
    grid[3][3] = "berry";
    grid[4][4] = "bug";
    return grid;
  };
  const state = pd.newState();
  const coin = pd.act("coin3", "leaf", fresh(), frogs, state, random, pd.LANDING);
  assert.ok(Math.abs(coin.pay - pd.COIN_VALUES[3] * pd.PAY_SCALE) < 1e-9);
  for (let i = 0; i < 9; i++) pd.act("sun", "leaf", fresh(), frogs, state, random, pd.LANDING);
  assert.strictEqual(state.levels.leaf, pd.MAX_LEVEL, "at most 7 upgrades");
  // (the swirl: one colour turns, here the red or the gold)
  const swirled = fresh();
  const swirl = pd.act("swirl", "leaf", swirled, frogs, state, random, pd.LANDING);
  assert.ok(["berry", "bug"].includes(swirl.from));
  swirl.cells.forEach(([c, r]) => assert.strictEqual(swirled[c][r], "leaf"));
  assert.ok(!swirled.some((column) => column.includes(swirl.from)));
  // Flies: every empty spot but the frogs'
  const popped = fresh();
  const flies = pd.act("flies", "leaf", popped, frogs, state, random, pd.LANDING);
  assert.strictEqual(flies.cells.length, 36 - 3 - 4);
  Object.values(frogs).forEach(([c, r]) => assert.strictEqual(popped[c][r], null));
  const rained = fresh();
  const rain = pd.act("rain", "leaf", rained, frogs, state, random, pd.LANDING);
  assert.strictEqual(rain.cells.length, 29);
  // The lotus: one row and one column more, at most 8x8
  const grown = fresh();
  assert.strictEqual(pd.act("lotus", "leaf", grown, frogs, state, random, pd.LANDING).grew, true);
  assert.deepStrictEqual([grown.length, grown[0].length, grown[2][2]], [7, 7, "berry"]);
  pd.act("lotus", "leaf", grown, frogs, state, random, pd.LANDING);
  assert.strictEqual(pd.act("lotus", "leaf", grown, frogs, state, random, pd.LANDING).grew, false);
  assert.strictEqual(grown.length, 8);
  // The moon counts; a wild from a chest lands on an empty spot
  pd.act("moon", "leaf", fresh(), frogs, state, random, pd.LANDING);
  assert.strictEqual(state.moons, 1);
  const wild = pd.act("wild", "leaf", fresh(), frogs, state, random, pd.LANDING, true);
  assert.ok(wild.at);
  assert.strictEqual(pd.act("wild", "leaf", fresh(), frogs, state, random, pd.LANDING, false), null, "a collected wild was its frog's amber");
});

test("pond: frogs side by side may trade spots by chance when it helps; two frogs asking the same one argue and get new symbols around them", () => {
  const yes = () => 0; // (every pair asks)
  const no = (max) => max - 1; // (no pair asks)
  const pond = () => Array.from({ length: 6 }, () => Array(6).fill("shell"));
  // Two frogs side by side: by chance they trade spots, once until one of them moves again
  let frogs = { leaf: [0, 0], berry: [1, 0], bug: [5, 5], shell: [3, 3] };
  let used = new Set();
  assert.deepStrictEqual(pd.meet(pond(), frogs, no, pd.LANDING, used), []);
  assert.deepStrictEqual(pd.meet(pond(), frogs, yes, pd.LANDING, used), [], "they asked already");
  // (only when it helps: here nobody could move on from the other spot)
  assert.deepStrictEqual(pd.meet(pond(), frogs, yes, pd.LANDING, new Set()), [], "a trade that changes nothing");
  // (a leaf next to the red frog: the green frog can collect it from there)
  const helps = pond();
  helps[2][0] = "leaf";
  used = new Set();
  assert.deepStrictEqual(pd.meet(helps, frogs, yes, pd.LANDING, used), [{ id: "trade", frogs: ["leaf", "berry"] }]);
  assert.deepStrictEqual([frogs.leaf, frogs.berry], [[1, 0], [0, 0]]);
  // Two frogs ask the same one: they argue, the spots around them that stop them get new symbols
  frogs = { leaf: [1, 1], berry: [0, 1], bug: [2, 1], shell: [5, 5] };
  const grid = pond();
  Object.values(frogs).forEach(([c, r]) => (grid[c][r] = null));
  grid[0][0] = "berry";
  const meets = pd.meet(grid, frogs, yes, pd.LANDING, new Set());
  assert.strictEqual(meets.length, 1);
  assert.deepStrictEqual([meets[0].id, meets[0].frogs, meets[0].over], ["argue", ["berry", "bug"], "leaf"]);
  const cells = meets[0].cells.map((cell) => cell.join(":")).sort();
  // (around the red frog: its own amber stays; the frogs' spots stay)
  assert.deepStrictEqual(cells, ["0:2", "2:0", "2:2", "3:1"]);
  assert.deepStrictEqual([frogs.leaf, frogs.berry, frogs.bug], [[1, 1], [0, 1], [2, 1]], "nobody trades");
  // In a spin: a step with only a meeting, then the frogs try again
  const random = rng(21);
  let met = 0;
  for (let i = 0; i < 400; i++) {
    const { grid: g, frogs: f } = pd.deal(random);
    met += pd.play(g, f, random, pd.newState()).steps.reduce((sum, step) => sum + step.meets.length, 0);
  }
  assert.ok(met > 30, `${met} meetings`);
});

test("pond: every full meter opens 3 chests", () => {
  const random = rng(9);
  const grid = Array.from({ length: 6 }, () => Array(6).fill("leaf"));
  const frogs = pd.placeFrogs(grid, random);
  const state = { ...pd.newState(), meter: pd.METER - 2 };
  const step = pd.play(grid, frogs, random, state).steps[0];
  const amber = step.moves.reduce((sum, move) => sum + move.amber, 0);
  assert.strictEqual(step.chests.length, Math.floor((pd.METER - 2 + amber) / pd.METER) * pd.CHESTS);
  assert.ok(step.chests.length >= pd.CHESTS);
  step.chests.forEach((chest) => assert.ok(Object.keys(pd.CHEST).includes(chest.id) && pd.FAMILY_IDS.includes(chest.family)));
  assert.ok(step.effects.filter((effect) => effect.chest).length >= 1);
});

test("pond: the free spins - 3 🌕 collected give 8; the pond, the meter, the levels and the moons carry on, every 3 🌕 3 more (30 at most)", () => {
  const random = rng(11);
  let sawMore = false;
  for (let g = 0; g < 150; g++) {
    const game = pd.freeGame(pd.FREE_SPINS, random);
    let size = pd.MIN_SIZE;
    let spins = pd.FREE_SPINS;
    let x = 0;
    let levels = pd.newLevels();
    let meter = 0;
    let collected = 0;
    game.freeSpins.forEach((free) => {
      assert.strictEqual(free.size, size, "the pond keeps its size");
      assert.strictEqual(free.grid.length, size);
      assert.deepStrictEqual(free.levels, levels, "the amber keeps its level");
      assert.strictEqual(free.meter, meter, "the meter keeps its amber");
      assert.strictEqual(free.collected, collected, "the moons collected stay");
      size = free.last.length;
      const last = free.steps[free.steps.length - 1];
      if (last) [levels, meter] = [last.levels, last.meter];
      collected += free.moons;
      const more = (Math.floor(collected / pd.MOON_TRIGGER) - Math.floor((collected - free.moons) / pd.MOON_TRIGGER)) * pd.FREE_MORE;
      assert.strictEqual(free.more, Math.min(more, pd.MAX_FREE_SPINS - spins));
      if (free.more) sawMore = true;
      spins += free.more;
      assert.strictEqual(free.spins, spins);
      x += free.pay;
    });
    assert.strictEqual(game.freeSpins.length, game.spins);
    assert.ok(Math.abs(game.x - x) < 1e-6);
  }
  assert.ok(sawMore);
});

test("pond: a bonus buy starts the free spins every time; a spin never pays more than the max win", () => {
  const random = rng(3);
  for (let i = 0; i < 60; i++) {
    const s = pd.spin(100, random, { buy: true });
    assert.ok(s.bonus, "the free spins");
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
    const state = pd.newState();
    const { grid, frogs } = pd.deal(random);
    base += pd.play(grid, frogs, random, state).pay;
    if (state.moons >= pd.MOON_TRIGGER) triggers++;
  }
  // (the base game: 54.3%)
  assert.ok(Math.abs(base / N - 0.543) < 0.02, `base game ${base / N}`);
  // (the free spins: about 1 in 254 spins)
  assert.ok(Math.abs(N / triggers - 254) < 45, `free spins every ${N / triggers}`);
  let free = 0;
  const G = 2000;
  for (let g = 0; g < G; g++) free += pd.freeGame(pd.FREE_SPINS, random).x;
  // (about 108.1x - its spread over 2,000 games about 2x)
  assert.ok(Math.abs(free / G - 108.1) < 8, `free spins ${free / G}`);
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

const FAST = { POND_MIN_GAP: 0, POND_SPIN: 10, POND_STEP: 0, POND_TURN: 0, POND_HOP: 0, POND_WALK: 0, POND_MEET: 0, POND_EFFECT: 0, POND_CHEST_TIME: 0, POND_COUNT_TIME: 0, POND_FREE_INTRO: 0, POND_FREE_SPIN: 0, POND_MOON_TIME: 0, POND_BONUS_END: 0, POND_BIG_TIME: 0 };

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
    assert.ok(spin.bonus && spin.id && spin.frogs && spin.lastFrogs);
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
  const old = { id: "old:1", name: "mia", bet: 100, win: 1106, note: "free spins 8", at: Date.now() + 60000, result: { bet: 100, version: 2, grid: [["flower0"]], bonus: { freeSpins: [] }, win: 1106 }, shown: 3, state: "paused", feed: null };
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
