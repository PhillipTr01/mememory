const crypto = require("crypto");

/*
 * Frog Pond: a square board of 6x6 that can grow up to 8x8. Wins are clusters: 7 or more symbols of one family
 * touching side by side (any tier mixed). A cluster pays the values of its symbols times a factor for its size. The
 * ✨ firefly is wild and joins every cluster it touches (it counts as the best tier in that cluster).
 *
 * Tumbles: the symbols of every cluster disappear, the ones above fall down and new ones fill the board from the
 * top - again and again while something wins.
 *
 * The frogs: one frog per family, each with a belly. Every symbol of its family in a winning cluster fills it by 1.
 * A full belly makes the frog leap: it eats every symbol of its family left on the board (each pays its value
 * times LEAP_PAY), its belly empties and its family grows up: from then on that family lands in better tiers (at
 * most 2 times).
 *
 * The specials (they act when nothing wins any more, then they are gone):
 *  - 🪷 lotus: the board grows by one row and one column (at most 8x8);
 *  - 🌊 splash: clears its row and its column (but the 🌕).
 *
 * Free spins: 3 🌕 or more on the board when the tumbles are over start them (8, 2 more for every 🌕 past the 3rd).
 * In the base game the board, the bellies and the families start new every spin. In the free spins they stay: a
 * grown board, half full bellies and grown up families carry on to the next free spin. Every 🌕 in a free spin is
 * one free spin more. A spin never pays more than MAX_WIN times the bet (the free spins end there).
 *
 * The payback is 96.8%, as the slots': the pays are scaled by PAY_SCALE so that the simulated spins pay it back.
 */
// The rules' version: free spins saved by other rules are paid, not shown again (their symbols may be gone)
const VERSION = 2;
const MIN_SIZE = 6;
const MAX_SIZE = 8;
const CLUSTER = 7; // at least this many symbols touching win

// The families: 3 tiers each (values: times the bet per symbol, before PAY_SCALE)
const FAMILIES = [
  { id: "leaf", name: "Leaves", frog: "Green frog", color: "#4ade80", icons: ["🍃", "🌿", "🍀"], names: ["Leaf", "Fern", "Clover"] },
  { id: "berry", name: "Berries", frog: "Red frog", color: "#f87171", icons: ["🫐", "🍒", "🍓"], names: ["Blueberry", "Cherry", "Strawberry"] },
  { id: "bug", name: "Bugs", frog: "Gold frog", color: "#facc15", icons: ["🐜", "🐞", "🦋"], names: ["Ant", "Ladybug", "Butterfly"] },
  { id: "shell", name: "Shells", frog: "Blue frog", color: "#60a5fa", icons: ["🐚", "🦪", "💎"], names: ["Shell", "Oyster", "Pearl"] },
];
const TIER_VALUES = [0.02, 0.07, 0.3];
// How a family lands at level 0, 1, 2 (weights of tier 0, 1, 2)
const LEVEL_TIERS = [
  [74, 22, 4],
  [48, 40, 12],
  [24, 46, 30],
];
const MAX_LEVEL = LEVEL_TIERS.length - 1;
// A cluster of 7, 8, ... pays the values of its symbols times this (the last one for every bigger cluster)
const SIZE_FACTORS = [1, 1.1, 1.2, 1.35, 1.5, 1.7, 1.9, 2.1, 2.4, 2.7, 3, 3.5];
const BELLY = 14; // a frog leaps with this many symbols of its family in its belly ...
const FREE_BELLY = 13; // ... in the free spins this many
const LEAP_PAY = 2; // a symbol eaten by a frog pays its value times this

const SPECIALS = [
  { id: "wild", icon: "✨", name: "Firefly", wild: true },
  { id: "lotus", icon: "🪷", name: "Lotus" },
  { id: "splash", icon: "🌊", name: "Splash" },
  { id: "moon", icon: "🌕", name: "Full moon", scatter: true },
];
// How likely a new symbol is each family or special (weights). The free spins: fewer 🌕
const LANDING = { family: 22, wild: 1.1, lotus: 0.6, splash: 0.8, moon: 0.5 };
const FREE_LANDING = { ...LANDING, wild: 1.6, moon: 0.2 };

const SYMBOLS = [];
FAMILIES.forEach((family) => family.icons.forEach((icon, tier) => SYMBOLS.push({ id: family.id + tier, icon: icon, name: family.names[tier], family: family.id, tier: tier, value: TIER_VALUES[tier] })));
SPECIALS.forEach((special) => SYMBOLS.push({ ...special, family: null, tier: null, value: 0 }));
const BY_ID = new Map(SYMBOLS.map((symbol) => [symbol.id, symbol]));
const FAMILY_IDS = FAMILIES.map((family) => family.id);

// The pays times this: the payback 96.8% (as the slots). Simulated (10 million spins, 100,000 free games): 96.83%
// (base game 54.29%, free spins 42.54% - about every 250 spins, 98.1x with 3 🌕), +-0.16%
const PAY_SCALE = 1.497;
const RTP = 0.968;
const MOON_TRIGGER = 3; // this many 🌕 start the free spins ...
const FREE_SPINS = 8; // ... this many of them ...
const FREE_PER_MOON = 2; // ... and this many more for every 🌕 past MOON_TRIGGER
const MAX_FREE_SPINS = 50;
const MAX_WIN = 10000; // a spin (and its free spins) never pays more than this many times the bet
const MAX_STEPS = 120; // (a safety net - a run of tumbles is never this long)
// Bonus buy: the free spins right away (3 🌕) for this many times the bet - a bought spin pays 100.4x on average
// (simulated), so about 91.3% of it comes back
const BUY_PRICE = 110;
const BUY_RTP = 0.913;
// How far one spin's win strays from its average, in bets (simulated) - for the RTP monitor
const SPIN_SPREAD = 10;

function pick(weights, randomInt) {
  const tickets = weights.map((w) => Math.round(w * 1000));
  let ticket = randomInt(tickets.reduce((a, b) => a + b, 0));
  for (let i = 0; i < tickets.length; i++) if ((ticket -= tickets[i]) < 0) return i;
  return tickets.length - 1;
}

// A new symbol for a spot: a family (its tier by its level) or a special
function land(randomInt, levels, landing = LANDING) {
  const kinds = [...FAMILY_IDS, "wild", "lotus", "splash", "moon"];
  const weights = kinds.map((kind) => (FAMILY_IDS.includes(kind) ? landing.family : landing[kind]));
  const kind = kinds[pick(weights, randomInt)];
  if (!FAMILY_IDS.includes(kind)) return kind;
  return kind + pick(LEVEL_TIERS[levels[kind] || 0], randomInt);
}

const newLevels = () => Object.fromEntries(FAMILY_IDS.map((id) => [id, 0]));
const newBellies = () => Object.fromEntries(FAMILY_IDS.map((id) => [id, 0]));

// A new board: grid[column] = the symbols from the top down
function board(randomInt, size = MIN_SIZE, levels = newLevels(), landing = LANDING) {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => land(randomInt, levels, landing)));
}

const familyOf = (id) => (BY_ID.get(id) || {}).family || null;
const key = (c, r) => c + ":" + r;

/*
 * The clusters of a board: [{family, cells: [[column, row], ...], size, value (the symbols' values), pay (times the
 * bet)}] - 7 or more of one family (any tier) or wild touching side by side, at least one of the family
 */
function clustersOf(grid) {
  const size = grid.length;
  const clusters = [];
  for (const family of FAMILY_IDS) {
    const seen = new Set();
    for (let c = 0; c < size; c++) {
      for (let r = 0; r < grid[c].length; r++) {
        if (familyOf(grid[c][r]) !== family || seen.has(key(c, r))) continue;
        const cells = [];
        const inCluster = new Set([key(c, r)]);
        const queue = [[c, r]];
        while (queue.length) {
          const [x, y] = queue.pop();
          cells.push([x, y]);
          if (familyOf(grid[x][y]) === family) seen.add(key(x, y));
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= size || ny >= grid[nx].length || inCluster.has(key(nx, ny))) continue;
            const id = grid[nx][ny];
            if (id !== "wild" && familyOf(id) !== family) continue;
            inCluster.add(key(nx, ny));
            queue.push([nx, ny]);
          }
        }
        if (cells.length < CLUSTER) continue;
        cells.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const tiers = cells.map(([x, y]) => BY_ID.get(grid[x][y])).filter((s) => s.family);
        const best = Math.max(...tiers.map((s) => s.value));
        const value = tiers.reduce((sum, s) => sum + s.value, 0) + (cells.length - tiers.length) * best;
        const factor = SIZE_FACTORS[Math.min(cells.length - CLUSTER, SIZE_FACTORS.length - 1)];
        clusters.push({ family: family, cells: cells, size: cells.length, value: value, pay: value * factor * PAY_SCALE });
      }
    }
  }
  return clusters;
}

// The board after the spots `gone` went: the rest falls down, new ones on top; `grow`: one row and column more
function refill(grid, gone, randomInt, levels, landing, grow = false) {
  const next = grid.map((column, c) => {
    const kept = column.filter((_, r) => !gone.has(key(c, r)));
    const height = column.length + (grow ? 1 : 0);
    return [...Array.from({ length: height - kept.length }, () => land(randomInt, levels, landing)), ...kept];
  });
  if (grow) next.push(Array.from({ length: next[0].length }, () => land(randomInt, levels, landing)));
  return next;
}

/*
 * A board played out: clusters win and tumble, full frogs leap, specials act - until nothing happens any more.
 * `state` = {levels, bellies} (changed in place: the free spins keep them). -> {steps: [{grid (before), kind ("win"
 * or "special"), clusters, leaps: [{family, cells, pay, level (after)}], specials: [{id, at, cells}], grow, gone:
 * [[c, r]], pay, bellies (after), levels (after)}], grid (the last), pay (times the bet)}
 */
function play(grid, randomInt, state, landing = LANDING) {
  const steps = [];
  let pay = 0;
  for (let n = 0; n < MAX_STEPS; n++) {
    const clusters = clustersOf(grid);
    const gone = new Set();
    const step = { grid: grid, kind: clusters.length ? "win" : "special", clusters: clusters, leaps: [], specials: [], grow: false, pay: 0 };
    if (clusters.length) {
      clusters.forEach((cluster) => {
        step.pay += cluster.pay;
        cluster.cells.forEach(([c, r]) => {
          gone.add(key(c, r));
          if (familyOf(grid[c][r]) === cluster.family) state.bellies[cluster.family]++;
        });
      });
      // Full frogs leap: they eat every symbol of their family left on the board
      for (const family of FAMILY_IDS) {
        if (state.bellies[family] < (state.belly || BELLY)) continue;
        state.bellies[family] = 0;
        state.levels[family] = Math.min(MAX_LEVEL, state.levels[family] + 1);
        const cells = [];
        let value = 0;
        grid.forEach((column, c) =>
          column.forEach((id, r) => {
            if (familyOf(id) !== family || gone.has(key(c, r))) return;
            cells.push([c, r]);
            value += BY_ID.get(id).value;
          }),
        );
        cells.forEach(([c, r]) => gone.add(key(c, r)));
        const leapPay = value * LEAP_PAY * PAY_SCALE;
        step.pay += leapPay;
        step.leaps.push({ family: family, cells: cells, pay: leapPay, level: state.levels[family] });
      }
    } else {
      // Nothing wins: the specials act (and are gone)
      grid.forEach((column, c) =>
        column.forEach((id, r) => {
          if (id === "lotus") {
            gone.add(key(c, r));
            step.specials.push({ id: id, at: [c, r], cells: [] });
            if (grid.length + (step.grow ? 1 : 0) < MAX_SIZE) step.grow = true;
          } else if (id === "splash") {
            const cells = [];
            grid.forEach((col, x) =>
              col.forEach((other, y) => {
                if ((x === c || y === r) && other !== "moon") {
                  gone.add(key(x, y));
                  if (x !== c || y !== r) cells.push([x, y]);
                }
              }),
            );
            step.specials.push({ id: id, at: [c, r], cells: cells });
          }
        }),
      );
      if (!step.specials.length) break;
    }
    pay += step.pay;
    step.gone = [...gone].map((spot) => spot.split(":").map(Number));
    step.bellies = { ...state.bellies };
    step.levels = { ...state.levels };
    steps.push(step);
    grid = refill(grid, gone, randomInt, state.levels, landing, step.grow);
  }
  return { steps: steps, grid: grid, pay: pay };
}

const moonsIn = (grid) => grid.reduce((sum, column) => sum + column.filter((id) => id === "moon").length, 0);
const freeSpinsFor = (moons) => (moons >= MOON_TRIGGER ? FREE_SPINS + FREE_PER_MOON * (moons - MOON_TRIGGER) : 0);

/*
 * The free spins from `spins` of them: {start, spins (all), freeSpins: [{grid (first), steps, last, moons, more,
 * size (at the start), levels, bellies (at the start), pay (times the bet), spins}], x (times the bet), capped}
 */
function freeGame(spins, randomInt, room = MAX_WIN) {
  const game = { start: spins, spins: spins, freeSpins: [], x: 0, capped: false };
  const state = { levels: newLevels(), bellies: newBellies(), belly: FREE_BELLY };
  let size = MIN_SIZE;
  for (let n = 0; n < game.spins; n++) {
    const start = { size: size, levels: { ...state.levels }, bellies: { ...state.bellies } };
    const first = board(randomInt, size, state.levels, FREE_LANDING);
    const result = play(first, randomInt, state, FREE_LANDING);
    size = result.grid.length;
    const moons = moonsIn(result.grid);
    const more = Math.min(moons, MAX_FREE_SPINS - game.spins);
    game.spins += more;
    let pay = result.pay;
    if (game.x + pay >= room) {
      pay = room - game.x;
      game.capped = true;
    }
    game.x += pay;
    game.freeSpins.push({ grid: first, steps: result.steps, last: result.grid, moons: moons, more: more, ...start, pay: pay, spins: game.spins });
    if (game.capped) break;
  }
  return game;
}

/*
 * One spin for `bet` coins: {grid (first), steps, last, moons, lineX (the base game, times the bet), bonus (the free
 * game or null), x (all, times the bet), win (coins), capped}. options.buy: the free spins right away (3 🌕 on the
 * board); options.forceBonus (the admin's test world): the same without paying for it.
 */
function spin(bet, randomInt = crypto.randomInt, options = {}) {
  let first = board(randomInt);
  if (options.buy || options.forceBonus) {
    first = first.map((column) => column.map((id) => (id === "moon" ? "leaf0" : id)));
    const spots = [];
    while (spots.length < MOON_TRIGGER) {
      const spot = [randomInt(MIN_SIZE), randomInt(MIN_SIZE)];
      if (!spots.some(([c, r]) => c === spot[0] && r === spot[1])) spots.push(spot);
    }
    spots.forEach(([c, r]) => (first[c][r] = "moon"));
  }
  const base = play(first, randomInt, { levels: newLevels(), bellies: newBellies() });
  let x = Math.min(base.pay, MAX_WIN);
  let capped = base.pay > MAX_WIN;
  const moons = moonsIn(base.grid);
  let bonus = null;
  if (!capped && moons >= MOON_TRIGGER) {
    bonus = freeGame(freeSpinsFor(moons), randomInt, MAX_WIN - x);
    x += bonus.x;
    capped = bonus.capped;
  }
  return { grid: first, steps: base.steps, last: base.grid, moons: moons, lineX: Math.min(base.pay, MAX_WIN), bonus: bonus, x: x, win: Math.floor(bet * x), capped: capped };
}

// For the page: the symbols (with their values, scaled), the families, the rules
function catalog() {
  return {
    symbols: SYMBOLS.map((symbol) => ({ id: symbol.id, icon: symbol.icon, name: symbol.name, family: symbol.family, tier: symbol.tier, value: Math.round(symbol.value * PAY_SCALE * 10000) / 10000, wild: symbol.wild === true, scatter: symbol.scatter === true })),
    families: FAMILIES.map((family) => ({ id: family.id, name: family.name, frog: family.frog, color: family.color })),
    sizeFactors: SIZE_FACTORS,
    cluster: CLUSTER,
    size: [MIN_SIZE, MAX_SIZE],
    belly: BELLY,
    freeBelly: FREE_BELLY,
    leapPay: LEAP_PAY,
    maxLevel: MAX_LEVEL,
    free: { trigger: MOON_TRIGGER, spins: FREE_SPINS, perMoon: FREE_PER_MOON, max: MAX_FREE_SPINS },
    maxWin: MAX_WIN,
    buy: BUY_PRICE,
    buyRtp: BUY_RTP,
  };
}

module.exports = { VERSION, RTP, MIN_SIZE, MAX_SIZE, CLUSTER, FAMILIES, FAMILY_IDS, SYMBOLS, BY_ID, TIER_VALUES, SIZE_FACTORS, BELLY, FREE_BELLY, LEAP_PAY, MAX_LEVEL, PAY_SCALE, MOON_TRIGGER, FREE_SPINS, FREE_PER_MOON, MAX_FREE_SPINS, MAX_WIN, BUY_PRICE, BUY_RTP, SPIN_SPREAD, board, clustersOf, play, refill, moonsIn, freeSpinsFor, freeGame, spin, catalog, newLevels, newBellies };
