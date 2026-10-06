const crypto = require("crypto");

/*
 * Slots: 5 reels, 3 rows, 9 lines. A spin stops every reel at a random place
 * of its strip (a secure random number); the 3 symbols around the stop are
 * shown. A line wins with 3, 4 or 5 of the same symbol from the left reel on;
 * the wild stands for every symbol (and pays itself for 3+ wilds in a row).
 *
 * The bet is for the whole spin: every line gets a ninth of it, a win pays
 * the line's share times the multiplier. Every reel has the same symbols
 * (in another order), so the payback is exact: see rtp() and the tests.
 */
const SYMBOLS = [
  { id: "banana", icon: "🍌", name: "Banana", count: 8, pays: [4, 10, 30] },
  { id: "doge", icon: "🐕", name: "Doge", count: 7, pays: [6, 16, 50] },
  { id: "pepe", icon: "🐸", name: "Pepe", count: 5, pays: [8, 24, 80] },
  { id: "moai", icon: "🗿", name: "Moai", count: 4, pays: [10, 30, 120] },
  { id: "rocket", icon: "🚀", name: "To the moon", count: 3, pays: [16, 50, 200] },
  { id: "stonks", icon: "📈", name: "Stonks", count: 2, pays: [24, 80, 400] },
  { id: "diamond", icon: "💎", name: "Diamond hands", count: 1, pays: [40, 200, 1000] },
  { id: "wild", icon: "😎", name: "Wild", count: 2, pays: [60, 300, 2000], wild: true },
];
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
const STRIPS = [11, 23, 37, 41, 53].map(makeStrip);

// The multiplier of one line (symbols from the left), and what it is made of
function lineWin(symbols) {
  let wilds = 0;
  while (wilds < symbols.length && symbols[wilds] === WILD) wilds++;
  let best = { multiplier: 0, symbol: null, count: 0 };
  if (wilds >= 3) best = { multiplier: BY_ID.get(WILD).pays[wilds - 3], symbol: WILD, count: wilds };
  if (wilds === symbols.length) return best;
  const symbol = symbols[wilds];
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
  const win = Math.floor((bet * multiplier) / LINE_COUNT);
  return { stops: stops, grid: grid, lines: lines, multiplier: multiplier / LINE_COUNT, win: win };
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
  return { rtp: paid, lineHit: hits };
}

// For the page: symbols (with the pays) and the lines
function catalog() {
  return {
    symbols: SYMBOLS.map((symbol) => ({ id: symbol.id, icon: symbol.icon, name: symbol.name, pays: symbol.pays, wild: symbol.wild === true })),
    lines: LINES,
    strips: STRIPS,
  };
}

module.exports = { SYMBOLS, LINES, STRIPS, REELS, ROWS, LINE_COUNT, lineWin, spin, rtp, catalog };
