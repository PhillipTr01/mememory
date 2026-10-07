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
 * window). All three in sight start the bonus: a wheel of multipliers, the
 * bonus pays the bet times the multiplier. A spin never pays more than
 * MAX_WIN times the bet.
 */
const SYMBOLS = [
  { id: "banana", icon: "🍌", name: "Banana", count: 8, pays: [4, 11, 33] },
  { id: "doge", icon: "🐕", name: "Doge", count: 7, pays: [7, 17, 55] },
  { id: "pepe", icon: "🐸", name: "Pepe", count: 5, pays: [9, 26, 88] },
  { id: "moai", icon: "🗿", name: "Moai", count: 4, pays: [11, 33, 130] },
  { id: "rocket", icon: "🚀", name: "To the moon", count: 3, pays: [17, 55, 220] },
  { id: "stonks", icon: "📈", name: "Stonks", count: 2, pays: [26, 88, 440] },
  { id: "diamond", icon: "💎", name: "Diamond hands", count: 1, pays: [44, 220, 1100] },
  { id: "wild", icon: "😎", name: "Wild", count: 2, pays: [66, 330, 2200], wild: true },
  // Pays no line - three in sight (reels 1, 3, 5) start the bonus
  { id: "bonus", icon: "🎁", name: "Bonus", count: 0, pays: [0, 0, 0], scatter: true },
];
const BONUS = "bonus";
const BONUS_REELS = [0, 2, 4];
const BONUS_COUNT = 2; // on each of these reels
const MAX_WIN = 250; // times the bet, for a whole spin

// The bonus wheel: multiplier and weight (of 1000)
const BONUS_WHEEL = [
  { multiplier: 2, weight: 300 },
  { multiplier: 3, weight: 250 },
  { multiplier: 5, weight: 200 },
  { multiplier: 10, weight: 130 },
  { multiplier: 20, weight: 70 },
  { multiplier: 50, weight: 40 },
  { multiplier: 100, weight: 9 },
  { multiplier: 250, weight: 1 },
];
const WHEEL_TOTAL = BONUS_WHEEL.reduce((sum, field) => sum + field.weight, 0);
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

/*
 * One spin for `bet` coins: {stops, grid (grid[reel][row]), lines: [{line,
 * symbol, count, multiplier, win}], win}. `randomInt(max)` can be replaced
 * in the tests.
 */
function spin(bet, randomInt = crypto.randomInt) {
  const stops = STRIPS.map((strip) => randomInt(strip.length));
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
  const lineWinTotal = Math.floor((bet * multiplier) / LINE_COUNT);
  // Three 🎁 in sight: the bonus wheel
  let bonus = null;
  if (BONUS_REELS.every((reel) => grid[reel].includes(BONUS))) {
    let ticket = randomInt(WHEEL_TOTAL);
    const field = BONUS_WHEEL.findIndex((f) => (ticket -= f.weight) < 0);
    bonus = { field: field, multiplier: BONUS_WHEEL[field].multiplier, win: bet * BONUS_WHEEL[field].multiplier };
  }
  const uncapped = lineWinTotal + (bonus ? bonus.win : 0);
  const win = Math.min(uncapped, bet * MAX_WIN);
  return { stops: stops, grid: grid, lines: lines, multiplier: multiplier / LINE_COUNT, lineWin: lineWinTotal, bonus: bonus, win: win, capped: uncapped > win };
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
  const wheelAverage = BONUS_WHEEL.reduce((sum, f) => sum + f.multiplier * f.weight, 0) / WHEEL_TOTAL;
  return { rtp: paid + bonusChance * wheelAverage, lines: paid, lineHit: hits, bonusChance: bonusChance, bonusRtp: bonusChance * wheelAverage };
}

// For the page: symbols (with the pays) and the lines
function catalog() {
  return {
    symbols: SYMBOLS.map((symbol) => ({ id: symbol.id, icon: symbol.icon, name: symbol.name, pays: symbol.pays, wild: symbol.wild === true, scatter: symbol.scatter === true })),
    lines: LINES,
    strips: STRIPS,
    wheel: BONUS_WHEEL.map((f) => f.multiplier),
    maxWin: MAX_WIN,
  };
}

module.exports = { SYMBOLS, LINES, STRIPS, REELS, ROWS, LINE_COUNT, BONUS_WHEEL, MAX_WIN, lineWin, spin, rtp, catalog };
