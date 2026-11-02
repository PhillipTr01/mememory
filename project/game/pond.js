const crypto = require("crypto");

/*
 * Frog Pond: a square pond of 6x6 that can grow up to 8x8. Four frogs (green, red, gold, blue) sit on it. A spot
 * holds an amber of one of the four colours, a feature symbol or nothing.
 *
 * The frogs move: each frog in turn hops to the nearest symbol it can collect and on from there, as long as it
 * finds one. It moves only onto a spot next to it that holds amber of its own colour, the ✨ wild (amber of every
 * colour) or a feature symbol - and collects it. Amber of another colour, an empty spot and another frog stop it; it
 * can walk back over its own trail. Every amber it collects pays the amber's value of its colour (by its level).
 * The pond is always full when it fills: only the frogs empty spots.
 *
 * The feature symbols act once all frogs have moved (in the order they were collected):
 *  - 🪙 coin: an instant win;
 *  - ☀️ sun: the amber of the frog's colour upgrades one step (at most MAX_LEVEL times; no more suns land once every
 *    colour is at the top);
 *  - ✨ wild: counts as an amber of the frog that collects it;
 *  - 🪷 lotus: the pond grows by one row and one column (at most 8x8);
 *  - 🌧️ rain: a redrop, the empty spots fill with new symbols;
 *  - 🌀 swirl: the amber of another colour on the pond turns into the frog's colour - at once, the frog collects on;
 *  - 🪰 flies: the empty spots fill with flies - a frog can cross a fly once (it eats it);
 *  - 🪨 rock: a rock falls on a spot - the 3x3 spots around it get new symbols, a frog hit jumps to a free spot;
 *  - 😈 curse: the frog turns evil (one per spin): it grows to 2x2, eats the frogs next to it (on its turn and
 *    after every hop) and collects their colours from then on;
 *  - 🌕 moon: the bonus symbol.
 * When no frog can move any more, the frogs side by side meet: each pair asks for a trade by chance
 * (TRADE_CHANCE, once until one of them moves again) and swaps spots when that lets one of them move on - several
 * pairs at once. When two frogs ask the same frog, they argue instead: the spots around the
 * two that stop them (amber of another colour, an empty spot, a fly) get new symbols - room to move on.
 * Then the frogs move again - and so on while they find something to collect (or a meeting changes the pond).
 *
 * The feature meter: every amber collected counts. A full meter (METER) gives three chests, each a random feature
 * symbol that acts for a random frog.
 *
 * The bonus game: 3 🌕 collected in a spin start FREE_SPINS free spins. The size of the pond, the meter, the levels
 * of the amber and the 🌕 collected stay from one free spin to the next. Every 3 🌕 collected in the free spins give
 * FREE_MORE free spins more. A spin never pays more than MAX_WIN times the bet (the free spins end there).
 *
 * The payback is 96.8%, as the slots': the pays are scaled by PAY_SCALE so that the simulated spins pay it back.
 */
// The rules' version: free spins saved by other rules are paid, not shown again (their symbols may be gone)
const VERSION = 4;
const MIN_SIZE = 6;
const MAX_SIZE = 8;

// The four frogs, the colours of the amber (on the page: one gem in four colours; the icons for texts)
const FAMILIES = [
  { id: "leaf", name: "Green gems", frog: "Green frog", color: "#4ade80", icon: "🟢" },
  { id: "berry", name: "Red gems", frog: "Red frog", color: "#f87171", icon: "🔴" },
  { id: "bug", name: "Gold gems", frog: "Gold frog", color: "#facc15", icon: "🟡" },
  { id: "shell", name: "Blue gems", frog: "Blue frog", color: "#60a5fa", icon: "🔵" },
];
const FAMILY_IDS = FAMILIES.map((family) => family.id);
// An amber pays this (times the bet, before PAY_SCALE) at level 0 .. 7
const AMBER_VALUES = [0.02, 0.035, 0.06, 0.1, 0.17, 0.28, 0.45, 0.75];
const MAX_LEVEL = AMBER_VALUES.length - 1;
// A coin pays this (times the bet, before PAY_SCALE)
const COIN_VALUES = [0.2, 0.5, 1, 2, 5];
const COIN_WEIGHTS = [40, 30, 18, 9, 3];
const METER = 30; // a full feature meter: this many amber
const CHESTS = 3;

const FEATURES = [
  { id: "coin", icon: "🪙", name: "Coin" },
  { id: "sun", icon: "☀️", name: "Sun" },
  { id: "wild", icon: "✨", name: "Firefly" },
  { id: "lotus", icon: "🪷", name: "Lotus" },
  { id: "rain", icon: "🌧️", name: "Rain" },
  { id: "swirl", icon: "🌀", name: "Swirl" },
  { id: "flies", icon: "🪰", name: "Flies" },
  { id: "rock", icon: "🪨", name: "Rock" },
  { id: "evil", icon: "😈", name: "Curse" },
  { id: "moon", icon: "🌕", name: "Full moon" },
];
const FEATURE_IDS = FEATURES.map((feature) => feature.id);
// How likely a new spot is each colour's amber or each feature (weights) - the pond is always full (empty: never; a
// spot is only emptied by a frog). The free spins: far more suns, wilds and lotuses
const LANDING = { empty: 0, amber: 13, coin: 1.3, sun: 0.4, wild: 1.5, lotus: 0.35, rain: 0.35, swirl: 0.35, flies: 0.35, rock: 0.35, evil: 0.25, moon: 0.7 };
const FREE_LANDING = { ...LANDING, sun: 7, wild: 6, lotus: 1.2, moon: 0.8 };
// What a chest holds (weights)
const CHEST = { coin: 34, sun: 24, wild: 10, lotus: 6, rain: 8, swirl: 8, flies: 8, rock: 8, evil: 0, moon: 2 };

// The symbols for the page: the amber (one per colour), the coins, the features, a fly on the pond
const SYMBOLS = [
  ...FAMILIES.map((family) => ({ id: family.id, icon: family.icon, name: family.name, family: family.id })),
  ...COIN_VALUES.map((value, i) => ({ id: "coin" + i, icon: "🪙", name: "Coin", feature: "coin", coin: value })),
  ...FEATURES.filter((feature) => feature.id != "coin").map((feature) => ({ id: feature.id, icon: feature.icon, name: feature.name, feature: feature.id })),
  { id: "fly", icon: "🪰", name: "Fly", fly: true },
];
const BY_ID = new Map(SYMBOLS.map((symbol) => [symbol.id, symbol]));

// The pays times this: the payback 96.8% (as the slots). Simulated (3.2 million whole spins): base game 46.6%, free
// spins about every 217 spins at 109.3x - 96.8% (+-0.5%) in all
const PAY_SCALE = 0.792;
const RTP = 0.968;
const MOON_TRIGGER = 3; // this many 🌕 collected start the free spins ...
const FREE_SPINS = 8; // ... this many of them
const FREE_MORE = 3; // every MOON_TRIGGER 🌕 collected in the free spins: this many more
const MAX_FREE_SPINS = 30;
const MAX_WIN = 10000; // a spin (and its free spins) never pays more than this many times the bet
const TRADE_CHANCE = 50; // in 100: two frogs side by side ask for a trade
const MAX_STEPS = 60; // (a safety net - the frogs never move this often in a spin)
// Bonus buy: the free spins after the base game for this many times the bet - a bought spin pays about 109.8x on
// average (simulated), so about 95% of it comes back
const BUY_PRICE = 116;
const BUY_RTP = 0.946;
// How far one spin's win strays from its average, in bets (simulated) - for the RTP monitor
const SPIN_SPREAD = 9.6;

function pick(weights, randomInt) {
  const tickets = weights.map((w) => Math.round(w * 1000));
  let ticket = randomInt(tickets.reduce((a, b) => a + b, 0));
  for (let i = 0; i < tickets.length; i++) if ((ticket -= tickets[i]) < 0) return i;
  return tickets.length - 1;
}

const coinId = (randomInt) => "coin" + pick(COIN_WEIGHTS, randomInt);

// A new spot: empty (null), an amber or a feature
function land(randomInt, landing = LANDING) {
  const kinds = ["empty", ...FAMILY_IDS, ...FEATURE_IDS];
  const weights = kinds.map((kind) => (kind == "empty" ? landing.empty : FAMILY_IDS.includes(kind) ? landing.amber : landing[kind]));
  const kind = kinds[pick(weights, randomInt)];
  if (kind == "empty") return null;
  return kind == "coin" ? coinId(randomInt) : kind;
}

const newLevels = () => Object.fromEntries(FAMILY_IDS.map((id) => [id, 0]));
const newState = () => ({ levels: newLevels(), meter: 0, moons: 0 });

// A new pond: grid[column] = the spots from the top down
function board(randomInt, size = MIN_SIZE, landing = LANDING) {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => land(randomInt, landing)));
}

// The frogs on a pond: each on a spot of its own (the spot under it is empty) -> {leaf: [c, r], ...}
function placeFrogs(grid, randomInt) {
  const size = grid.length;
  const frogs = {};
  const taken = new Set();
  for (const family of FAMILY_IDS) {
    let spot;
    do spot = [randomInt(size), randomInt(size)];
    while (taken.has(key(...spot)));
    taken.add(key(...spot));
    frogs[family] = spot;
    grid[spot[0]][spot[1]] = null;
  }
  return frogs;
}

const key = (c, r) => c + ":" + r;
// A frog's spot: [c, r] - an evil frog [c, r, size, colours] (its top left spot; the colours it collects)
const sizeOf = (spot) => spot[2] || 1;
const coloursOf = (family, spot) => spot[3] || [family];
const isEvil = (spot) => !!(spot && spot[3]);
const bodyOf = (c, r, n) => Array.from({ length: n * n }, (_, i) => [c + (i % n), r + Math.floor(i / n)]);
// Every spot a frog sits on
const occupied = (frogs, except) => new Set(Object.entries(frogs).flatMap(([f, spot]) => (f === except ? [] : bodyOf(spot[0], spot[1], sizeOf(spot)).map((cell) => key(...cell)))));
// Two bodies side by side (or overlapping)
function touching(a, b) {
  const [na, nb] = [sizeOf(a), sizeOf(b)];
  const dx = Math.max(a[0] - (b[0] + nb - 1), b[0] - (a[0] + na - 1), 0);
  const dy = Math.max(a[1] - (b[1] + nb - 1), b[1] - (a[1] + na - 1), 0);
  return dx + dy === 1 || (dx === 0 && dy === 0);
}
const symbolOf = (id) => (id == null ? null : BY_ID.get(id) || null);
const isFeature = (id) => !!(symbolOf(id) && symbolOf(id).feature);
// What a frog of `family` collects: its amber, the wild, the features
const collects = (id, family) => id === family || isFeature(id);
const NEIGHBOURS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/*
 * A frog moves (the grid changes in place): it hops to the nearest spot it collects (over the flies and its own
 * trail) - again and again. An evil frog (2x2) moves as a block and eats the frogs next to it before it starts and
 * after every hop. -> {family, path: [[c, r], ...] (from where it sat, spot by spot), cells: [[spots entered], ...]
 * (per hop), got: [ids collected], amber (how many), eats: [{family, after (hops)}], end: [c, r]}
 */
function moveFrog(grid, frogs, family, randomInt = null) {
  const size = grid.length;
  const spot = frogs[family];
  const n = sizeOf(spot);
  const colours = coloursOf(family, spot).slice();
  const evil = isEvil(spot);
  const takes = (id) => colours.includes(id) || isFeature(id);
  let others = occupied(frogs, family);
  const eats = [];
  let at = [spot[0], spot[1]];
  // (an evil frog eats the frogs next to it: they are gone, their colours are its own now)
  const eat = (after) => {
    if (!evil) return;
    for (const f of FAMILY_IDS) {
      if (f === family || !frogs[f] || !touching([...at, n], frogs[f])) continue;
      delete frogs[f];
      colours.push(f);
      eats.push({ family: f, after: after });
    }
    others = occupied(frogs, family);
  };
  eat(0);
  const trail = new Set(bodyOf(at[0], at[1], n).map((cell) => key(...cell)));
  const path = [at];
  const cells = [[]];
  const got = [];
  const swirls = [];
  // The spots entered from one spot to the next (the whole body for a small frog)
  const entered = (from, to) => {
    const old = new Set(bodyOf(from[0], from[1], n).map((cell) => key(...cell)));
    return bodyOf(to[0], to[1], n).filter((cell) => !old.has(key(...cell)));
  };
  for (;;) {
    // The nearest spot to collect (breadth first over the trail and the flies)
    const from = new Map([[key(...at), null]]);
    const queue = [at];
    let target = null;
    while (queue.length && !target) {
      const current = queue.shift();
      for (const [dc, dr] of NEIGHBOURS) {
        const next = [current[0] + dc, current[1] + dr];
        const k = key(...next);
        if (next[0] < 0 || next[1] < 0 || next[0] + n > size || next[1] + n > grid[next[0]].length || from.has(k)) continue;
        const into = entered(current, next);
        if (into.some((cell) => others.has(key(...cell)))) continue;
        // (on from there: its trail and the flies - never amber of another colour or an empty spot)
        const open = into.every(([c, r]) => trail.has(key(c, r)) || grid[c][r] === "fly" || takes(grid[c][r]));
        if (!open) continue;
        from.set(k, current);
        if (into.some(([c, r]) => !trail.has(key(c, r)) && takes(grid[c][r]))) {
          target = next;
          break;
        }
        queue.push(next);
      }
    }
    if (!target) break;
    const way = [];
    for (let step = target; step && key(...step) !== key(...at); step = from.get(key(...step))) way.unshift(step);
    let previous = at;
    way.forEach((step) => {
      const into = entered(previous, step);
      into.forEach(([c, r]) => {
        const id = grid[c][r];
        // (it eats the flies and collects its own; the other colours stay)
        if (id === "fly") grid[c][r] = null;
        else if (takes(id)) {
          got.push(id);
          grid[c][r] = null;
          // (the swirl acts at once: the gems of another colour turn into the frog's, it collects on with them)
          if (id === "swirl" && randomInt) swirls.push({ after: path.length, ...swirlGrid(grid, family, colours, randomInt) });
        }
        trail.add(key(c, r));
      });
      path.push(step);
      cells.push(into);
      previous = step;
      at = step;
      eat(path.length - 1);
    });
    at = target;
  }
  frogs[family] = evil ? [at[0], at[1], n, colours] : at;
  const amber = got.filter((id) => colours.includes(id) || id === "wild").length;
  return { family: family, path: path, cells: cells, got: got, amber: amber, eats: eats, swirls: swirls, end: at };
}

// The swirl: the gems of one other colour on the pond (at random) turn into the frog's -> {from, cells}
function swirlGrid(grid, family, colours, randomInt) {
  const present = FAMILY_IDS.filter((f) => !colours.includes(f) && grid.some((column) => column.includes(f)));
  const from = present.length ? present[randomInt(present.length)] : null;
  const cells = [];
  grid.forEach((column, c) =>
    column.forEach((other, r) => {
      if (from && other === from) {
        grid[c][r] = family;
        cells.push([c, r]);
      }
    }),
  );
  return { from: from, cells: cells };
}

const emptySpots = (grid, frogs) => {
  const sitting = occupied(frogs);
  const spots = [];
  grid.forEach((column, c) => column.forEach((id, r) => id == null && !sitting.has(key(c, r)) && spots.push([c, r])));
  return spots;
};

/*
 * A feature acts for the frog of `family` (the grid, the frogs and the state change in place) -> what it did:
 * {id, family, ...} (coin: pay; sun: level; wild (from a chest): at; lotus: grew; swirl: from, cells; rain and
 * flies: cells; rock: at, cells, ids, jumps: [{family, to}])
 */
function act(id, family, grid, frogs, state, randomInt, landing, chest) {
  const feature = symbolOf(id) ? symbolOf(id).feature : id;
  const effect = { id: feature, family: family };
  if (feature === "coin") {
    effect.value = symbolOf(id) ? symbolOf(id).coin : COIN_VALUES[pick(COIN_WEIGHTS, randomInt)];
    effect.pay = effect.value * PAY_SCALE;
  } else if (feature === "sun") {
    state.levels[family] = Math.min(MAX_LEVEL, state.levels[family] + 1);
    effect.level = state.levels[family];
  } else if (feature === "wild") {
    // (collected: it was an amber of the frog; from a chest: it lands on an empty spot)
    if (!chest) return null;
    const spots = emptySpots(grid, frogs);
    if (!spots.length) return effect;
    const [c, r] = spots[randomInt(spots.length)];
    grid[c][r] = "wild";
    effect.at = [c, r];
  } else if (feature === "lotus") {
    effect.grew = grid.length < MAX_SIZE;
    if (effect.grew) {
      // (a row at the bottom, a column on the right)
      grid.forEach((column) => column.push(land(randomInt, landing)));
      grid.push(Array.from({ length: grid[0].length }, () => land(randomInt, landing)));
    }
  } else if (feature === "swirl") {
    const present = FAMILY_IDS.filter((f) => f !== family && grid.some((column) => column.includes(f)));
    const from = present.length ? present[randomInt(present.length)] : null;
    effect.from = from;
    effect.cells = [];
    grid.forEach((column, c) =>
      column.forEach((other, r) => {
        if (from && other === from) {
          grid[c][r] = family;
          effect.cells.push([c, r]);
        }
      }),
    );
  } else if (feature === "rain" || feature === "flies") {
    effect.cells = emptySpots(grid, frogs);
    effect.cells.forEach(([c, r]) => (grid[c][r] = feature === "rain" ? land(randomInt, landing) : "fly"));
  } else if (feature === "rock") {
    // (where it lands; the 3x3 around it: new symbols; a frog there jumps to a free spot outside)
    const size = grid.length;
    const at = [randomInt(size), randomInt(size)];
    const inside = (c, r) => Math.abs(c - at[0]) <= 1 && Math.abs(r - at[1]) <= 1;
    const sitting = occupied(frogs);
    effect.at = at;
    effect.cells = [];
    effect.ids = [];
    for (let c = at[0] - 1; c <= at[0] + 1; c++)
      for (let r = at[1] - 1; r <= at[1] + 1; r++) {
        if (c < 0 || r < 0 || c >= size || r >= size || sitting.has(key(c, r))) continue;
        grid[c][r] = land(randomInt, landing);
        effect.cells.push([c, r]);
        effect.ids.push(grid[c][r]);
      }
    effect.jumps = [];
    for (const family of FAMILY_IDS) {
      // (an evil frog is too big: the rock bounces off)
      if (!frogs[family] || isEvil(frogs[family]) || !inside(...frogs[family])) continue;
      const taken = occupied(frogs);
      const free = [];
      const any = [];
      grid.forEach((column, c) => column.forEach((id, r) => !inside(c, r) && !taken.has(key(c, r)) && (id == null ? free : any).push([c, r])));
      const spots = free.length ? free : any;
      if (!spots.length) continue;
      const to = spots[randomInt(spots.length)];
      // (the spot it left gets a new symbol too, the one it lands on is its own)
      const from = frogs[family];
      grid[from[0]][from[1]] = land(randomInt, landing);
      effect.cells.push(from.slice());
      effect.ids.push(grid[from[0]][from[1]]);
      grid[to[0]][to[1]] = null;
      frogs[family] = to;
      effect.jumps.push({ family: family, to: to.slice() });
    }
  } else if (feature === "evil") {
    // (one evil frog a spin; a frog that is gone or evil already: nothing)
    if (!frogs[family] || Object.values(frogs).some(isEvil)) {
      effect.none = true;
      return effect;
    }
    const spot = frogs[family];
    const colours = [family];
    effect.eats = [];
    const eatNext = (body) => {
      for (const f of FAMILY_IDS) {
        if (f === family || !frogs[f] || !touching(body, frogs[f])) continue;
        delete frogs[f];
        colours.push(f);
        effect.eats.push(f);
      }
    };
    eatNext([spot[0], spot[1], 1]);
    // It grows to 2x2 (the spots it covers are crushed), where there is room
    const size = grid.length;
    const others = occupied(frogs, family);
    const room = [[0, 0], [1, 0], [0, 1], [1, 1]]
      .map(([dc, dr]) => [spot[0] - dc, spot[1] - dr])
      .filter(([c, r]) => c >= 0 && r >= 0 && c + 2 <= size && r + 2 <= size && bodyOf(c, r, 2).every((cell) => !others.has(key(...cell))));
    const anchor = room.length ? room[randomInt(room.length)] : null;
    let n = 1;
    let at = [spot[0], spot[1]];
    effect.cleared = [];
    if (anchor) {
      n = 2;
      at = anchor;
      bodyOf(at[0], at[1], 2).forEach(([c, r]) => {
        if (grid[c][r] != null) effect.cleared.push([c, r]);
        grid[c][r] = null;
      });
      eatNext([at[0], at[1], 2]);
    }
    frogs[family] = [at[0], at[1], n, colours];
    effect.spot = frogs[family];
  } else if (feature === "moon") {
    state.moons++;
    effect.moons = state.moons;
  }
  return effect;
}

/*
 * Frogs side by side meet (the grid and the frogs change in place; `used`: the pairs that met and have not moved
 * since) -> [{id: "trade", frogs: [a, b]} | {id: "argue", frogs: [a, b], over: c, cells: [[c, r], ...]}]
 */
function meet(grid, frogs, randomInt, landing, used) {
  const size = grid.length;
  const asking = [];
  for (let i = 0; i < FAMILY_IDS.length; i++)
    for (let j = i + 1; j < FAMILY_IDS.length; j++) {
      const [a, b] = [FAMILY_IDS[i], FAMILY_IDS[j]];
      const pair = a + ":" + b;
      if (!frogs[a] || !frogs[b] || isEvil(frogs[a]) || isEvil(frogs[b])) continue;
      if (used.has(pair) || Math.abs(frogs[a][0] - frogs[b][0]) + Math.abs(frogs[a][1] - frogs[b][1]) !== 1) continue;
      used.add(pair);
      if (randomInt(100) < TRADE_CHANCE) asking.push([a, b]);
    }
  const meets = [];
  const busy = new Set();
  // Two frogs ask the same one: they argue, the spots around them that stop them get new symbols
  for (const over of FAMILY_IDS) {
    const others = asking.filter((pair) => pair.includes(over)).map((pair) => (pair[0] === over ? pair[1] : pair[0]));
    if (others.length < 2 || busy.has(over)) continue;
    const two = others.slice(0, 2);
    if (two.some((f) => busy.has(f))) continue;
    const sitting = occupied(frogs);
    const cells = [];
    for (const family of two)
      for (const [dc, dr] of NEIGHBOURS) {
        const [c, r] = [frogs[family][0] + dc, frogs[family][1] + dr];
        if (c < 0 || r < 0 || c >= size || r >= size || sitting.has(key(c, r)) || cells.some((cell) => key(...cell) === key(c, r))) continue;
        if (collects(grid[c][r], family) || grid[c][r] === "wild") continue;
        grid[c][r] = land(randomInt, landing);
        cells.push([c, r]);
      }
    [over, ...two].forEach((f) => busy.add(f));
    meets.push({ id: "argue", frogs: two, over: over, cells: cells });
  }
  // The others trade, but only when it helps: they swap spots and one of them can move on from there
  const canMove = (swapped, family) => moveFrog(grid.map((column) => column.slice()), { ...swapped }, family).path.length > 1;
  for (const [a, b] of asking) {
    if (busy.has(a) || busy.has(b)) continue;
    const swapped = { ...frogs, [a]: frogs[b], [b]: frogs[a] };
    if (!canMove(swapped, a) && !canMove(swapped, b)) continue;
    [frogs[a], frogs[b]] = [frogs[b], frogs[a]];
    busy.add(a);
    busy.add(b);
    meets.push({ id: "trade", frogs: [a, b] });
  }
  return meets;
}

/*
 * A pond played out: the frogs move, the features act, the meter fills - while the frogs find something.
 * `state` = {levels, meter, moons} (changed in place: the free spins keep it). -> {steps: [{grid, frogs (before),
 * moves: [{family, path, got, amber, level, pay}] (one frog after the other), chests: [ids], effects: [...], meets:
 * [...] (see meet), pay, levels, meter, moons (after)}],
 * grid, frogs (the last), pay (times the bet)}
 */
// No more suns once every colour is at its top level (they would do nothing)
const maxed = (state) => FAMILY_IDS.every((f) => state.levels[f] >= MAX_LEVEL);
const landingFor = (landing, state) => (maxed(state) ? { ...landing, sun: 0 } : landing);

function play(grid, frogs, randomInt, state, baseLanding = LANDING) {
  const steps = [];
  let pay = 0;
  grid = grid.map((column) => column.slice());
  frogs = Object.fromEntries(Object.entries(frogs).map(([f, spot]) => [f, spot.slice()]));
  const used = new Set();
  for (let n = 0; n < MAX_STEPS; n++) {
    const landing = landingFor(baseLanding, state);
    const before = grid.map((column) => column.slice());
    const frogsBefore = Object.fromEntries(Object.entries(frogs).map(([f, spot]) => [f, spot.slice()]));
    const step = { grid: before, frogs: frogsBefore, moves: [], chests: [], effects: [], meets: [], pay: 0 };
    for (const family of FAMILY_IDS) {
      if (!frogs[family]) continue;
      const move = moveFrog(grid, frogs, family, randomInt);
      if (move.path.length < 2 && !move.eats.length) continue;
      // (it moved: it may meet the others again)
      [...used].filter((pair) => pair.split(":").includes(family)).forEach((pair) => used.delete(pair));
      move.level = state.levels[family];
      // (each gem by the level of its colour: an evil frog collects the colours it ate; the wild is its own)
      move.pay = move.got.filter((id) => id === "wild" || FAMILY_IDS.includes(id)).reduce((sum, id) => sum + AMBER_VALUES[state.levels[id === "wild" ? family : id]], 0) * PAY_SCALE;
      step.pay += move.pay;
      step.moves.push(move);
    }
    // The meter: full, it gives the chests
    state.meter += step.moves.reduce((sum, move) => sum + move.amber, 0);
    while (state.meter >= METER) {
      state.meter -= METER;
      const ids = Object.keys(CHEST);
      const weights = ids.map((id) => (id === "sun" && maxed(state) ? 0 : CHEST[id]));
      for (let i = 0; i < CHESTS; i++) step.chests.push({ id: ids[pick(weights, randomInt)], family: FAMILY_IDS[randomInt(FAMILY_IDS.length)] });
    }
    // The features act: the collected ones in order, then the chests'
    // (a swirl a frog collects has acted already, on its way)
    const acting = [...step.moves.flatMap((move) => move.got.filter((id) => isFeature(id) && id !== "swirl").map((id) => ({ id: id, family: move.family }))), ...step.chests.map((chest) => ({ ...chest, chest: true }))];
    for (const one of acting) {
      const effect = act(one.id, one.family, grid, frogs, state, randomInt, landing, one.chest === true);
      if (!effect) continue;
      if (one.chest) effect.chest = true;
      if (effect.pay) step.pay += effect.pay;
      step.effects.push(effect);
    }
    // (the frogs meet only when none of them can move any more: then every pair side by side may trade)
    if (!step.moves.length) step.meets = meet(grid, frogs, randomInt, landing, used);
    if (!step.moves.length && !step.meets.length) break;
    pay += step.pay;
    step.levels = { ...state.levels };
    step.meter = state.meter;
    step.moons = state.moons;
    steps.push(step);
  }
  return { steps: steps, grid: grid, frogs: frogs, pay: pay };
}

// A new pond with its frogs
function deal(randomInt, size = MIN_SIZE, landing = LANDING) {
  const grid = board(randomInt, size, landing);
  const frogs = placeFrogs(grid, randomInt);
  return { grid, frogs };
}

/*
 * The free spins from `spins` of them: {start, spins (all), freeSpins: [{grid, frogs (first), steps, last,
 * lastFrogs, moons (collected in it), more, size, levels, meter, collected (the 🌕 so far, at the start), pay (times
 * the bet), spins}], x (times the bet), capped}
 */
function freeGame(spins, randomInt, room = MAX_WIN) {
  const game = { start: spins, spins: spins, freeSpins: [], x: 0, capped: false };
  const state = newState();
  let size = MIN_SIZE;
  for (let n = 0; n < game.spins; n++) {
    const start = { size: size, levels: { ...state.levels }, meter: state.meter, collected: state.moons };
    const { grid, frogs } = deal(randomInt, size, landingFor(FREE_LANDING, state));
    const result = play(grid, frogs, randomInt, state, FREE_LANDING);
    size = result.grid.length;
    const moons = state.moons - start.collected;
    const sets = Math.floor(state.moons / MOON_TRIGGER) - Math.floor(start.collected / MOON_TRIGGER);
    const more = Math.min(sets * FREE_MORE, MAX_FREE_SPINS - game.spins);
    game.spins += more;
    let pay = result.pay;
    if (game.x + pay >= room) {
      pay = room - game.x;
      game.capped = true;
    }
    game.x += pay;
    game.freeSpins.push({ grid: grid, frogs: frogs, steps: result.steps, last: result.grid, lastFrogs: result.frogs, moons: moons, more: more, ...start, pay: pay, spins: game.spins });
    if (game.capped) break;
  }
  return game;
}

/*
 * One spin for `bet` coins: {grid, frogs (first), steps, last, lastFrogs, moons (collected), lineX (the base game,
 * times the bet), bonus (the free game or null), x (all, times the bet), win (coins), capped}. options.buy: the free
 * spins come after the base game whatever it collects; options.forceBonus (the admin's test world): the same
 * without paying for it.
 */
function spin(bet, randomInt = crypto.randomInt, options = {}) {
  const { grid, frogs } = deal(randomInt);
  const state = newState();
  const base = play(grid, frogs, randomInt, state);
  let x = Math.min(base.pay, MAX_WIN);
  let capped = base.pay > MAX_WIN;
  let bonus = null;
  if (!capped && (state.moons >= MOON_TRIGGER || options.buy || options.forceBonus)) {
    bonus = freeGame(FREE_SPINS, randomInt, MAX_WIN - x);
    x += bonus.x;
    capped = bonus.capped;
  }
  return { grid: grid, frogs: frogs, steps: base.steps, last: base.grid, lastFrogs: base.frogs, moons: state.moons, lineX: Math.min(base.pay, MAX_WIN), bonus: bonus, x: x, win: Math.floor(bet * x), capped: capped };
}

// For the page: the symbols, the frogs, the values (scaled), the rules
function catalog() {
  const scaled = (value) => Math.round(value * PAY_SCALE * 10000) / 10000;
  return {
    symbols: SYMBOLS.map((symbol) => ({ ...symbol, coin: symbol.coin != null ? scaled(symbol.coin) : undefined })),
    families: FAMILIES.map((family) => ({ id: family.id, name: family.name, frog: family.frog, color: family.color, icon: family.icon })),
    features: FEATURES,
    amberValues: AMBER_VALUES.map(scaled),
    size: [MIN_SIZE, MAX_SIZE],
    maxLevel: MAX_LEVEL,
    meter: METER,
    chests: CHESTS,
    free: { trigger: MOON_TRIGGER, spins: FREE_SPINS, more: FREE_MORE, max: MAX_FREE_SPINS },
    maxWin: MAX_WIN,
    buy: BUY_PRICE,
    buyRtp: BUY_RTP,
  };
}

module.exports = { VERSION, RTP, MIN_SIZE, MAX_SIZE, FAMILIES, FAMILY_IDS, FEATURES, FEATURE_IDS, SYMBOLS, BY_ID, AMBER_VALUES, COIN_VALUES, MAX_LEVEL, METER, CHESTS, CHEST, PAY_SCALE, MOON_TRIGGER, FREE_SPINS, FREE_MORE, MAX_FREE_SPINS, MAX_WIN, BUY_PRICE, BUY_RTP, SPIN_SPREAD, LANDING, FREE_LANDING, TRADE_CHANCE, board, placeFrogs, deal, moveFrog, act, meet, play, freeGame, spin, catalog, newLevels, newState };
