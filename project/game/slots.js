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
 * Bonus: the 🎁 is only on reels 1, 3 and 5 (see BONUS_COUNT, never two in one
 * window). All three in sight start the bonus game: a double wheel decides
 * how many free spins (outer ring) and the multiplier to start with (inner
 * ring). The free spins play by themselves on the same reels; the multiplier
 * climbs by one after every free spin, so the last spins are worth the most.
 * A spin (with its whole bonus) never pays more than MAX_WIN times the bet -
 * when the bonus reaches it, it ends right there.
 */
const SYMBOLS = [
  { id: "banana", icon: "🍌", name: "Banana", count: 9, pays: [3, 8, 24] },
  { id: "pepe", icon: "🐸", name: "Pepe", count: 8, pays: [4, 13, 36] },
  { id: "doge", icon: "🐕", name: "Doge", count: 6, pays: [8, 22, 83] },
  { id: "money", icon: "💰", name: "Money bag", count: 4, pays: [13, 38, 164] },
  { id: "rocket", icon: "🚀", name: "To the moon", count: 3, pays: [19, 67, 329] },
  { id: "diamond", icon: "💎", name: "Diamond hands", count: 1, pays: [32, 164, 822] },
  { id: "wild", icon: "👑", name: "Wild", count: 2, pays: [49, 247, 1643], wild: true },
  // Pays no line - three in sight (reels 1, 3, 5) start the bonus
  { id: "bonus", icon: "🎁", name: "Bonus", count: 0, pays: [0, 0, 0], scatter: true },
  // Pays no line - five in sight (anywhere) start the coin game; every coin carries a value
  { id: "coin", icon: "🪙", name: "Coin", count: 0, pays: [0, 0, 0], coin: true },
];
const BONUS = "bonus";
const BONUS_REELS = [0, 2, 4];
// How many 🎁 on each reel (two in sight on reels 1 and 3: the sweat)
const BONUS_COUNT = [2, 0, 2, 0, 3];
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

/*
 * The coin game (hold and win): five 🪙 or more in sight (any reel, any row)
 * start it. The coins stay where they are, the other spots spin again - 3
 * respins. Every new coin stays too and the respins go back to 3. It ends
 * when the respins are used up or all 15 spots are coins. Every coin carries
 * a value (times the bet) or a prize: MINI, MAJOR, MEGA. All 15 spots full:
 * the ULTRA prize on top. The coin game pays everything on its coins.
 * (Three 🎁 and five 🪙 at once: the free spins win, the coins pay nothing.)
 */
const COIN = "coin";
const COIN_TRIGGER = 5; // this many 🪙 in sight start the coin game
const COIN_RESPINS = 3;
// How many 🪙 on each reel: in small groups (a group can fill a whole reel)
const COIN_GROUPS = [
  [2, 1],
  [1, 2],
  [2, 1],
  [1, 1],
  [1, 1],
];
// In a respin every empty spot gets a 🪙 with this chance (in 1000) - often, the values small
const COIN_LAND = 60;
// The value of a coin: times the bet, or a prize (also times the bet), with weights
const COIN_VALUES = [
  { x: 1, weight: 400 },
  { x: 2, weight: 300 },
  { x: 3, weight: 160 },
  { x: 5, weight: 80 },
  { x: 8, weight: 45 },
  { x: 15, weight: 22 },
  { x: 25, prize: "mini", weight: 16 },
  { x: 60, prize: "major", weight: 5 },
  { x: 150, prize: "mega", weight: 1 },
];
const ULTRA = 500; // all 15 spots full: this many times the bet on top
const COIN_MAX_WIN = 1000; // the coin game never pays more than this many times the bet
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
// Reels 1, 3, 5: the 🎁 (BONUS_COUNT of them), spread over the strip (never two in the same window)
const STRIPS = [11, 23, 37, 41, 53].map((seed, reel) => {
  const strip = makeStrip(seed);
  // The 🪙 groups, spread over the strip (back to front: the places stay right)
  const groups = COIN_GROUPS[reel];
  const gap = Math.floor(strip.length / groups.length);
  for (let n = groups.length - 1; n >= 0; n--) strip.splice(n * gap + Math.floor(gap / 2), 0, ...Array(groups[n]).fill(COIN));
  const count = BONUS_COUNT[reel];
  if (!count) return strip;
  // Spread out: never two in one window
  const step = Math.floor((strip.length + count) / count);
  for (let n = 0; n < count; n++) strip.splice(n * step, 0, BONUS);
  return strip;
});

// The free spins turn other strips: the same, without the 🪙 (no coin game in the free spins)
const FREE_STRIPS = STRIPS.map((strip) => strip.filter((id) => id !== COIN));

// The multiplier of one line (symbols from the left), and what it is made of
function lineWin(symbols) {
  let wilds = 0;
  while (wilds < symbols.length && symbols[wilds] === WILD) wilds++;
  let best = { multiplier: 0, symbol: null, count: 0 };
  if (wilds >= 3) best = { multiplier: BY_ID.get(WILD).pays[wilds - 3], symbol: WILD, count: wilds };
  if (wilds === symbols.length) return best;
  const symbol = symbols[wilds];
  if (symbol === BONUS || symbol === COIN) return best;
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
function reels(bet, randomInt, fixed, strips = STRIPS) {
  const stops = strips.map((strip, reel) => (fixed && fixed[reel] != null ? fixed[reel] : randomInt(strip.length)));
  const grid = strips.map((strip, reel) => window(strip, stops[reel]));
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

// A coin's value (times the bet) or prize
function coinValue(randomInt) {
  const field = COIN_VALUES[roll(COIN_VALUES, randomInt)];
  return field.prize ? { x: field.x, prize: field.prize } : { x: field.x };
}

// Every 🪙 in sight with its value: [{reel, row, x, prize?}]
function coinsIn(grid, randomInt) {
  const list = [];
  grid.forEach((symbols, reel) => symbols.forEach((id, row) => id === COIN && list.push({ reel: reel, row: row, ...coinValue(randomInt) })));
  return list;
}

/*
 * The coin game from the coins in sight: {start, respins: [{coins (the new
 * ones), left (respins left after it)}], coins (all), ultra, x (times the
 * bet), win}
 */
function coinGame(bet, start, randomInt) {
  const taken = new Set(start.map((c) => c.reel * ROWS + c.row));
  const coins = start.slice();
  const respins = [];
  let left = COIN_RESPINS;
  while (left > 0 && taken.size < REELS * ROWS) {
    const fresh = [];
    for (let spot = 0; spot < REELS * ROWS; spot++) {
      if (taken.has(spot) || randomInt(1000) >= COIN_LAND) continue;
      fresh.push({ reel: Math.floor(spot / ROWS), row: spot % ROWS, ...coinValue(randomInt) });
    }
    fresh.forEach((c) => taken.add(c.reel * ROWS + c.row));
    coins.push(...fresh);
    left = fresh.length ? COIN_RESPINS : left - 1;
    respins.push({ coins: fresh, left: left });
  }
  const ultra = taken.size === REELS * ROWS;
  const x = coins.reduce((sum, c) => sum + c.x, 0) + (ultra ? ULTRA : 0);
  return { start: start, respins: respins, coins: coins, ultra: ultra, x: x, win: Math.min(Math.floor(bet * x), bet * COIN_MAX_WIN) };
}

/*
 * The coin sweat (the last reel turns longer): 4 🪙 on the first four reels -
 * or 3 (one of them on reel 4) in 2 of 5 spins (by the stops), so it comes
 * about as often as the sweat of two 🎁 (1 of 40 spins). The page uses the
 * same rule.
 */
// How many reels sweat (0 to 3): from the reel after the one where 3 🪙 are in sight - the earlier
// the coins come, the more reels sweat
function coinSweatReels(grid, stops) {
  if (!coinSweat(grid, stops)) return 0;
  for (let reel = 2; reel <= 4; reel++) {
    if (grid.slice(0, reel).flat().filter((id) => id === COIN).length >= COIN_TRIGGER - 2) return REELS - reel;
  }
  return 1;
}

// The extra time of the sweat (times SLOTS_SWEAT) for the last reel: the first sweating reel 1,
// every further one half of it more
function sweatShare(reels) {
  return reels > 0 ? 1 + 0.5 * (reels - 1) : 0;
}

function coinSweat(grid, stops) {
  const coins = grid.slice(0, 4).flat().filter((id) => id === COIN).length;
  if (coins === COIN_TRIGGER - 1) return true;
  return coins === COIN_TRIGGER - 2 && grid[3].includes(COIN) && stops.reduce((sum, stop) => sum + stop, 0) % 5 < 2;
}

/*
 * One spin for `bet` coins: {stops, grid (grid[reel][row]), lines: [{line,
 * symbol, count, multiplier, win}], lineWin, bonus, win, capped}. With three
 * 🎁 the bonus game is played here too: bonus = {spinsField, multiplierField,
 * spins, multiplier, freeSpins: [{stops, grid, lines, lineWin, multiplier,
 * win}], win}; coins: the 🪙 in sight with their values; coinGame (five 🪙):
 * see coinGame(). `randomInt(max)` can be replaced in the tests;
 * options.forceBonus (admin, for testing): "free" starts the free spins every
 * time, "coins" the coin game (true: the free spins).
 */
function spin(bet, randomInt = crypto.randomInt, options = {}) {
  const force = options.forceBonus === true ? "free" : options.forceBonus;
  const stopsWhere = (strip, test) => strip.map((_, i) => (test(window(strip, i)) ? i : -1)).filter((i) => i >= 0);
  let fixed = null;
  // Testing (admin panel): a 🎁 in the window of every bonus reel - the bonus game every time
  if (force === "free")
    fixed = STRIPS.map((strip, reel) => {
      if (!BONUS_REELS.includes(reel)) return null;
      const at = strip.map((id, i) => (id === BONUS ? i : -1)).filter((i) => i >= 0);
      return at[randomInt(at.length)];
    });
  // ... or a 🪙 on every reel (and no 🎁): the coin game every time
  if (force === "coins")
    fixed = STRIPS.map((strip) => {
      const at = stopsWhere(strip, (w) => w.includes(COIN) && !w.includes(BONUS));
      return at[randomInt(at.length)];
    });
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
      const free = reels(bet, randomInt, null, FREE_STRIPS);
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
  // The 🪙 in sight (with their values); five of them start the coin game (not with the free spins)
  const coins = coinsIn(base.grid, randomInt);
  let coinResult = null;
  if (!bonus && coins.length >= COIN_TRIGGER) {
    coinResult = coinGame(bet, coins, randomInt);
    win += coinResult.win;
  }
  return { stops: base.stops, grid: base.grid, lines: base.lines, multiplier: base.multiplier, lineWin: base.lineWin, coins: coins, bonus: bonus, coinGame: coinResult, win: win, capped: capped };
}

/*
 * The payback, exactly: the symbols of a line come from 5 independent reels,
 * every symbol as likely as its share of the strip. All 8^5 lines with their
 * chance -> the average multiplier of a line = the share of the bet paid back.
 */
function rtp() {
  // The normal spins and the free spins (their own strips, without the 🪙)
  const base = lineStats(STRIPS);
  const free = lineStats(FREE_STRIPS);
  const paid = base.paid;
  const bonusChance = base.bonusChance;
  const retriggerChance = free.bonusChance;
  // The bonus game: free spin k (0, 1, ...) pays a free spin times (start + k * step), if it is
  // played at all. A free spin pays on average `free.paid` whatever came before:
  // E[bonus] = free.paid * sum over k of (start + k * step) * P(free spin k is played). Retriggers (three
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
        add(Math.min(MAX_FREE_SPINS, spins + RETRIGGER), q * retriggerChance);
        add(spins, q * (1 - retriggerChance));
      });
      played += weight * p;
      playedK += weight * p * k;
      totals = next;
    }
  });
  // (without the max win - the true payback is a tiny bit lower)
  const bonusAverage = free.paid * (played * start + BONUS_STEP * playedK);
  const coin = coinRtp();
  return { rtp: paid + bonusChance * bonusAverage + coin.rtp, lines: paid, freeLines: free.paid, lineHit: base.hits, bonusChance: bonusChance, bonusRtp: bonusChance * bonusAverage, bonusAverage: bonusAverage, coinChance: coin.chance, coinRtp: coin.rtp, coinAverage: coin.average, ultraChance: coin.ultra };
}

// One kind of strips: the average line multiplier (= the payback of the lines), how often a line
// wins, and the chance of three 🎁 (one in the window of each bonus reel - at most one fits)
function lineStats(strips) {
  const ids = SYMBOLS.map((symbol) => symbol.id);
  const chance = strips.map((strip) => new Map(ids.map((id) => [id, strip.filter((s) => s === id).length / strip.length])));
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
  const inWindow = (reel) => (strips[reel].filter((s) => s === BONUS).length * ROWS) / strips[reel].length;
  return { paid: paid, hits: hits, bonusChance: BONUS_REELS.reduce((p, reel) => p * inWindow(reel), 1) };
}

/*
 * The coin game, exactly. The reels stop independently: the chance of every
 * number of 🪙 in sight together with "three 🎁" (then the free spins, no
 * coin game), reel by reel. From n coins on: the respins as a chain over
 * (coins, respins left) - every empty spot gets a coin with COIN_LAND/1000.
 * Every coin is worth the average value; all 15: ULTRA on top.
 */
function coinRtp() {
  const SPOTS = REELS * ROWS;
  // [gifts on every bonus reel so far?][coins] -> chance
  let dist = new Map([["1|0", 1]]);
  STRIPS.forEach((strip, reel) => {
    const next = new Map();
    strip.forEach((_, stop) => {
      const w = window(strip, stop);
      const c = w.filter((id) => id === COIN).length;
      const g = !BONUS_REELS.includes(reel) || w.includes(BONUS);
      dist.forEach((p, key) => {
        const [all, n] = key.split("|").map(Number);
        const k = (all && g ? 1 : 0) + "|" + (n + c);
        next.set(k, (next.get(k) || 0) + p / strip.length);
      });
    });
    dist = next;
  });
  const q = COIN_LAND / 1000;
  const binom = (m, k) => {
    let r = 1;
    for (let i = 0; i < k; i++) r = (r * (m - i)) / (i + 1);
    return r * q ** k * (1 - q) ** (m - k);
  };
  // E[coins at the end], P(all 15) from (n coins, r respins left)
  const memo = new Map();
  function from(n, r) {
    if (n === SPOTS || r === 0) return { coins: n, full: n === SPOTS ? 1 : 0 };
    const key = n + "|" + r;
    if (memo.has(key)) return memo.get(key);
    const result = { coins: 0, full: 0 };
    for (let k = 0; k <= SPOTS - n; k++) {
      const p = binom(SPOTS - n, k);
      const after = k ? from(n + k, COIN_RESPINS) : from(n, r - 1);
      result.coins += p * after.coins;
      result.full += p * after.full;
    }
    memo.set(key, result);
    return result;
  }
  const mean = COIN_VALUES.reduce((sum, f) => sum + f.x * f.weight, 0) / total(COIN_VALUES);
  let chance = 0;
  let paid = 0;
  let ultra = 0;
  dist.forEach((p, key) => {
    const [all, n] = key.split("|").map(Number);
    if (all || n < COIN_TRIGGER) return;
    const end = from(n, COIN_RESPINS);
    chance += p;
    paid += p * (end.coins * mean + end.full * ULTRA);
    ultra += p * end.full;
  });
  // (without the coin game's max win - the true payback is a tiny bit lower)
  return { chance: chance, rtp: paid, average: chance ? paid / chance : 0, ultra: ultra };
}

// For the page: symbols (with the pays) and the lines
function catalog() {
  return {
    symbols: SYMBOLS.map((symbol) => ({ id: symbol.id, icon: symbol.icon, name: symbol.name, pays: symbol.pays, wild: symbol.wild === true, scatter: symbol.scatter === true, coin: symbol.coin === true })),
    lines: LINES,
    strips: STRIPS,
    freeStrips: FREE_STRIPS,
    bonus: { spins: BONUS_SPINS.map((f) => f.spins), multipliers: BONUS_MULTIPLIERS.map((f) => f.multiplier), step: BONUS_STEP, retrigger: RETRIGGER, maxSpins: MAX_FREE_SPINS },
    coins: { trigger: COIN_TRIGGER, respins: COIN_RESPINS, values: COIN_VALUES.filter((f) => !f.prize).map((f) => f.x), prizes: COIN_VALUES.filter((f) => f.prize).map((f) => ({ prize: f.prize, x: f.x })), ultra: ULTRA, maxWin: COIN_MAX_WIN },
    maxWin: MAX_WIN,
  };
}

module.exports = { SYMBOLS, LINES, STRIPS, FREE_STRIPS, REELS, ROWS, LINE_COUNT, BONUS_SPINS, BONUS_MULTIPLIERS, BONUS_STEP, RETRIGGER, MAX_FREE_SPINS, MAX_WIN, COIN_TRIGGER, COIN_RESPINS, COIN_VALUES, COIN_LAND, ULTRA, COIN_MAX_WIN, lineWin, spin, coinGame, coinSweat, coinSweatReels, sweatShare, rtp, catalog };
