const crypto = require("crypto");

/*
 * Slots: 5 reels, 3 rows, 9 lines. A spin stops every reel at a random place
 * of its strip (a secure random number); the 3 symbols around the stop are
 * shown. A line wins with 3, 4 or 5 of the same symbol from the left reel on;
 * the wild stands for every symbol (and pays itself for 3+ wilds in a row).
 *
 * The bet is for the whole spin: every line gets a ninth of it, a win pays
 * the line's share times the multiplier. The payback is exact: see rtp() and
 * the tests.
 *
 * Bonus: the 🎁 is only on reels 1, 3 and 5 (twice each, never two in one
 * window). All three in sight start the bonus game: a double wheel decides
 * how many free spins (outer ring) and the multiplier to start with (inner
 * ring). The free spins play by themselves on the same reels; the multiplier
 * climbs by one after every free spin, so the last spins are worth the most.
 * A spin (with its whole bonus) never pays more than MAX_WIN times the bet -
 * when the bonus reaches it, it ends right there.
 */
const SYMBOLS = [
  { id: "banana", icon: "🍌", name: "Banana", count: 9, pays: [3, 8, 24] },
  { id: "pepe", icon: "🐸", name: "Pepe", count: 8, pays: [4, 12, 36] },
  { id: "doge", icon: "🐕", name: "Doge", count: 6, pays: [7, 21, 79] },
  { id: "money", icon: "💰", name: "Money bag", count: 4, pays: [12, 36, 157] },
  { id: "rocket", icon: "🚀", name: "To the moon", count: 3, pays: [18, 64, 315] },
  { id: "diamond", icon: "💎", name: "Diamond hands", count: 1, pays: [31, 157, 787] },
  { id: "wild", icon: "👑", name: "Wild", count: 2, pays: [47, 236, 1573], wild: true },
  // Pays no line - three in sight (reels 1, 3, 5) start the bonus
  { id: "bonus", icon: "🎁", name: "Bonus", count: 0, pays: [0, 0, 0], scatter: true },
];
const BONUS = "bonus";
const BONUS_REELS = [0, 2, 4];
const BONUS_COUNT = 2; // on each of these reels
const MAX_WIN = 250; // times the bet, for a whole spin

// The bonus wheels: free spins (outer ring) and the start multiplier (inner ring), with weights
const BONUS_SPINS = [
  { spins: 5, weight: 40 },
  { spins: 6, weight: 26 },
  { spins: 8, weight: 20 },
  { spins: 10, weight: 10 },
  { spins: 12, weight: 4 },
];
const BONUS_MULTIPLIERS = [
  { multiplier: 1, weight: 50 },
  { multiplier: 2, weight: 30 },
  { multiplier: 3, weight: 15 },
  { multiplier: 5, weight: 5 },
];
const BONUS_STEP = 1; // the multiplier grows by this after every free spin
const RETRIGGER = 5; // three 🎁 in a free spin: this many free spins more
const MAX_FREE_SPINS = 50; // never more free spins than this in one bonus
const total = (list) => list.reduce((sum, field) => sum + field.weight, 0);

// A field of a wheel, as likely as its weight
function roll(list, randomInt) {
  let ticket = randomInt(total(list));
  return list.findIndex((field) => (ticket -= field.weight) < 0);
}
const BY_ID = new Map(SYMBOLS.map((symbol) => [symbol.id, symbol]));
const WILD = "wild";
const REELS = 5;
const ROWS = 3;
const LINE_COUNT = 9;

// The 9 lines: the row (0 top, 1 middle, 2 bottom) on every reel
const LINES = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
];

// The strips: every symbol as often as its count, spread out (another order on every reel)
function makeStrip(seed) {
  const strip = [];
  SYMBOLS.forEach((symbol) => {
    for (let i = 0; i < symbol.count; i++) strip.push(symbol.id);
  });
  let state = seed;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  for (let i = strip.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [strip[i], strip[j]] = [strip[j], strip[i]];
  }
  return strip;
}
// Reels 1, 3, 5: the 🎁 twice, half a strip apart (never two in the same window)
const STRIPS = [11, 23, 37, 41, 53].map((seed, reel) => {
  const strip = makeStrip(seed);
  if (!BONUS_REELS.includes(reel)) return strip;
  const step = Math.floor((strip.length + BONUS_COUNT) / BONUS_COUNT);
  for (let n = 0; n < BONUS_COUNT; n++) strip.splice(n * step, 0, BONUS);
  return strip;
});

// The multiplier of one line (symbols from the left), and what it is made of
function lineWin(symbols) {
  let wilds = 0;
  while (wilds < symbols.length && symbols[wilds] === WILD) wilds++;
  let best = { multiplier: 0, symbol: null, count: 0 };
  if (wilds >= 3) best = { multiplier: BY_ID.get(WILD).pays[wilds - 3], symbol: WILD, count: wilds };
  if (wilds === symbols.length) return best;
  const symbol = symbols[wilds];
  if (symbol === BONUS) return best;
  let count = wilds;
  while (count < symbols.length && (symbols[count] === symbol || symbols[count] === WILD)) count++;
  if (count >= 3) {
    const multiplier = BY_ID.get(symbol).pays[count - 3];
    if (multiplier > best.multiplier) best = { multiplier: multiplier, symbol: symbol, count: count };
  }
  return best;
}

// The 3 symbols of a reel around its stop (top, middle, bottom)
function window(strip, stop) {
  const at = (i) => strip[(i + strip.length) % strip.length];
  return [at(stop - 1), at(stop), at(stop + 1)];
}

// The reels stop and the 9 lines are paid: {stops, grid, lines, multiplier (all lines), lineWin}
function reels(bet, randomInt, fixed) {
  const stops = STRIPS.map((strip, reel) => (fixed && fixed[reel] != null ? fixed[reel] : randomInt(strip.length)));
  const grid = STRIPS.map((strip, reel) => window(strip, stops[reel]));
  const lines = [];
  let multiplier = 0;
  LINES.forEach((rows, line) => {
    const result = lineWin(rows.map((row, reel) => grid[reel][row]));
    if (result.multiplier > 0) {
      multiplier += result.multiplier;
      lines.push({ line: line, symbol: result.symbol, count: result.count, multiplier: result.multiplier, win: Math.floor((bet * result.multiplier) / LINE_COUNT) });
    }
  });
  // Every line gets a ninth of the bet: the whole win at once (no rounding per line)
  return { stops: stops, grid: grid, lines: lines, multiplier: multiplier / LINE_COUNT, lineWin: Math.floor((bet * multiplier) / LINE_COUNT) };
}

/*
 * One spin for `bet` coins: {stops, grid (grid[reel][row]), lines: [{line,
 * symbol, count, multiplier, win}], lineWin, bonus, win, capped}. With three
 * 🎁 the bonus game is played here too: bonus = {spinsField, multiplierField,
 * spins, multiplier, freeSpins: [{stops, grid, lines, lineWin, multiplier,
 * win}], win}. `randomInt(max)` can be replaced in the tests; options.forceBonus
 * (admin, for testing) starts the bonus game every time.
 */
function spin(bet, randomInt = crypto.randomInt, options = {}) {
  // Testing (admin panel): a 🎁 in the window of every bonus reel - the bonus game every time
  const fixed = options.forceBonus
    ? STRIPS.map((strip, reel) => {
        if (!BONUS_REELS.includes(reel)) return null;
        const at = strip.map((id, i) => (id === BONUS ? i : -1)).filter((i) => i >= 0);
        return at[randomInt(at.length)];
      })
    : null;
  const base = reels(bet, randomInt, fixed);
  const cap = bet * MAX_WIN;
  let win = Math.min(base.lineWin, cap);
  let capped = base.lineWin > cap;
  let bonus = null;
  if (BONUS_REELS.every((reel) => base.grid[reel].includes(BONUS))) {
    const spinsField = roll(BONUS_SPINS, randomInt);
    const multiplierField = roll(BONUS_MULTIPLIERS, randomInt);
    const startSpins = BONUS_SPINS[spinsField].spins;
    bonus = { spinsField: spinsField, multiplierField: multiplierField, startSpins: startSpins, spins: startSpins, multiplier: BONUS_MULTIPLIERS[multiplierField].multiplier, freeSpins: [], win: 0 };
    for (let n = 0; n < bonus.spins && !capped; n++) {
      const free = reels(bet, randomInt);
      // Three 🎁 again: more free spins (the spin counts as well)
      const more = BONUS_REELS.every((reel) => free.grid[reel].includes(BONUS)) ? Math.min(RETRIGGER, MAX_FREE_SPINS - bonus.spins) : 0;
      bonus.spins += more;
      const multiplier = bonus.multiplier + n * BONUS_STEP;
      let freeWin = free.lineWin * multiplier;
      // The max win is reached: the bonus ends with this spin
      if (win + freeWin >= cap) {
        freeWin = cap - win;
        capped = true;
      }
      win += freeWin;
      bonus.win += freeWin;
      bonus.freeSpins.push({ stops: free.stops, grid: free.grid, lines: free.lines, lineWin: free.lineWin, multiplier: multiplier, win: freeWin, retrigger: more, spins: bonus.spins });
    }
  }
  return { stops: base.stops, grid: base.grid, lines: base.lines, multiplier: base.multiplier, lineWin: base.lineWin, bonus: bonus, win: win, capped: capped };
}

/*
 * The payback, exactly: the symbols of a line come from 5 independent reels,
 * every symbol as likely as its share of the strip. All 8^5 lines with their
 * chance -> the average multiplier of a line = the share of the bet paid back.
 */
function rtp() {
  const ids = SYMBOLS.map((symbol) => symbol.id);
  const chance = STRIPS.map((strip) => new Map(ids.map((id) => [id, strip.filter((s) => s === id).length / strip.length])));
  let paid = 0;
  let hits = 0;
  const line = [];
  (function walk(reel, p) {
    if (reel === REELS) {
      const m = lineWin(line).multiplier;
      paid += p * m;
      if (m > 0) hits += p;
      return;
    }
    for (const id of ids) {
      const q = chance[reel].get(id);
      if (q === 0) continue;
      line[reel] = id;
      walk(reel + 1, p * q);
    }
  })(0, 1);
  // Every line gets a ninth of the bet and there are nine of them: the average line multiplier is the payback
  // The bonus: a 🎁 in the window of each bonus reel (at most one fits in a window)
  const inWindow = (reel) => (STRIPS[reel].filter((s) => s === BONUS).length * ROWS) / STRIPS[reel].length;
  const bonusChance = BONUS_REELS.reduce((p, reel) => p * inWindow(reel), 1);
  // The bonus game: free spin k (0, 1, ...) pays a normal spin times (start + k * step), if it is
  // played at all. A free spin is a normal spin, so it pays on average `paid` whatever came before:
  // E[bonus] = paid * sum over k of (start + k * step) * P(free spin k is played). Retriggers (three
  // 🎁 in a free spin: RETRIGGER more, at most MAX_FREE_SPINS) make later spins possible.
  const start = BONUS_MULTIPLIERS.reduce((sum, f) => sum + f.multiplier * f.weight, 0) / total(BONUS_MULTIPLIERS);
  let played = 0; // E[number of free spins]
  let playedK = 0; // E[sum of k over the played free spins]
  BONUS_SPINS.forEach((f) => {
    const weight = f.weight / total(BONUS_SPINS);
    // Chance of every total of free spins so far, spin after spin
    let totals = new Map([[f.spins, 1]]);
    for (let k = 0; k < MAX_FREE_SPINS; k++) {
      let p = 0;
      const next = new Map();
      const add = (spins, q) => next.set(spins, (next.get(spins) || 0) + q);
      totals.forEach((q, spins) => {
        if (k >= spins) return add(spins, q); // over
        p += q;
        add(Math.min(MAX_FREE_SPINS, spins + RETRIGGER), q * bonusChance);
        add(spins, q * (1 - bonusChance));
      });
      played += weight * p;
      playedK += weight * p * k;
      totals = next;
    }
  });
  // (without the max win - the true payback is a tiny bit lower)
  const bonusAverage = paid * (played * start + BONUS_STEP * playedK);
  return { rtp: paid + bonusChance * bonusAverage, lines: paid, lineHit: hits, bonusChance: bonusChance, bonusRtp: bonusChance * bonusAverage, bonusAverage: bonusAverage };
}

// For the page: symbols (with the pays) and the lines
function catalog() {
  return {
    symbols: SYMBOLS.map((symbol) => ({ id: symbol.id, icon: symbol.icon, name: symbol.name, pays: symbol.pays, wild: symbol.wild === true, scatter: symbol.scatter === true })),
    lines: LINES,
    strips: STRIPS,
    bonus: { spins: BONUS_SPINS.map((f) => f.spins), multipliers: BONUS_MULTIPLIERS.map((f) => f.multiplier), step: BONUS_STEP, retrigger: RETRIGGER, maxSpins: MAX_FREE_SPINS },
    maxWin: MAX_WIN,
  };
}

module.exports = { SYMBOLS, LINES, STRIPS, REELS, ROWS, LINE_COUNT, BONUS_SPINS, BONUS_MULTIPLIERS, BONUS_STEP, RETRIGGER, MAX_FREE_SPINS, MAX_WIN, lineWin, spin, rtp, catalog };
