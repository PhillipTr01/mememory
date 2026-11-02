const crypto = require("crypto");

/*
 * Megaways (Dragon's Hoard): 6 reels, every reel shows 2 to 7 symbols - the
 * heights are rolled anew every spin, so a spin has up to 7^6 = 117,649 ways.
 * A way wins with the same symbol on 3 or more reels side by side from the
 * left (any row); every combination of those symbols is a way of its own, so
 * a win pays the symbol's pay times the ways (times the bet). The 🔥 wild
 * (reels 2 to 6) stands for every symbol but the 🥚.
 *
 * Tumbles: the symbols of every win disappear, the ones above fall down and
 * new ones fill the reels from the top - again and again while something wins.
 *
 * Free spins (the dragon's hoard): 4 🥚 or more in sight when the tumbles are
 * over start them - 10 free spins and 2 more for every 🥚 past the 4th.
 * In the free spins:
 *  - the dragon multiplier starts at x1, grows by 1 with every tumble and never
 *    goes back down until the free spins are over: every win is paid times it;
 *  - every 🥚 that lands is one free spin more and the cave grows: every reel
 *    shows at least one row more from then on (at most 7 - all 117,649 ways).
 * A spin never pays more than MAX_WIN times the bet (the free spins end there).
 *
 * The payback is 96.8%, as the slots': the pays are scaled by PAY_SCALE so that the
 * simulated spins pay it back (the tumbles make an exact sum out of reach).
 */
const REELS = 6;
const MIN_ROWS = 2;
const MAX_ROWS = 7;
// How often a reel shows 2, 3, ... 7 rows (weights)
const HEIGHTS = [
  { rows: 2, weight: 8 },
  { rows: 3, weight: 18 },
  { rows: 4, weight: 24 },
  { rows: 5, weight: 24 },
  { rows: 6, weight: 16 },
  { rows: 7, weight: 10 },
];
// The symbols: weight - how likely on a spot (wild only on reels 2 to 6), pays - for 3, 4, 5, 6 reels per way
// (before PAY_SCALE; times the bet)
const SYMBOLS = [
  { id: "bone", icon: "🦴", name: "Bone", weight: 15, pays: [0.1, 0.15, 0.25, 0.5] },
  { id: "mushroom", icon: "🍄", name: "Mushroom", weight: 15, pays: [0.1, 0.15, 0.25, 0.5] },
  { id: "key", icon: "🗝️", name: "Key", weight: 15, pays: [0.1, 0.15, 0.25, 0.5] },
  { id: "candle", icon: "🕯️", name: "Candle", weight: 15, pays: [0.1, 0.15, 0.25, 0.5] },
  { id: "scroll", icon: "📜", name: "Scroll", weight: 13, pays: [0.1, 0.2, 0.3, 0.6] },
  { id: "potion", icon: "🧪", name: "Potion", weight: 13, pays: [0.15, 0.25, 0.4, 0.8] },
  { id: "sword", icon: "🗡️", name: "Sword", weight: 10, pays: [0.2, 0.4, 0.6, 1.2] },
  { id: "shield", icon: "🛡️", name: "Shield", weight: 9, pays: [0.25, 0.5, 0.8, 1.5] },
  { id: "ring", icon: "💍", name: "Ring", weight: 6, pays: [0.4, 0.8, 1.5, 3] },
  { id: "crown", icon: "👑", name: "Crown", weight: 5, pays: [0.6, 1.2, 2.5, 5] },
  { id: "dragon", icon: "🐉", name: "Dragon", weight: 3, pays: [1, 2, 5, 10] },
  { id: "wild", icon: "🔥", name: "Dragon fire", weight: 1.2, wild: true, pays: [0, 0, 0, 0] },
  { id: "egg", icon: "🥚", name: "Dragon egg", weight: 2.5, scatter: true, pays: [0, 0, 0, 0] },
];
const WILD = "wild";
const EGG = "egg";
const BY_ID = new Map(SYMBOLS.map((symbol) => [symbol.id, symbol]));
// The pays times this: the payback 96.8% (as the slots). Simulated (20 million spins, 2 million free games):
// the table as written pays back 92.65% (base game 55.57%, free spins 37.08% - about every 235 spins, 77x with 4
// 🥚), +-0.1%; times 1.0448 -> 96.8%
const PAY_SCALE = 1.0448;
const RTP = 0.968;
// (the free spins: the 🥚 this much rarer - the cave grows slower)
const FREE_EGG = 0.22;
const EGG_TRIGGER = 4; // this many 🥚 start the free spins ...
const FREE_SPINS = 8; // ... this many of them ...
const FREE_PER_EGG = 2; // ... and this many more for every 🥚 past EGG_TRIGGER
const MAX_FREE_SPINS = 60;
const MAX_WIN = 10000; // a spin (and its free spins) never pays more than this many times the bet
const MAX_TUMBLES = 60; // (a safety net - a run of tumbles is never this long)
// Bonus buy: the free spins right away (4 🥚) for this many times the bet - a bought spin pays 84.1x on average
// (simulated), so about 84% of it comes back (as the slots' buys)
const BUY_PRICE = 100;
const BUY_RTP = 0.841;
// How far one spin's win strays from its average, in bets (simulated) - for the RTP monitor
const SPIN_SPREAD = 21;

const total = (list) => list.reduce((sum, field) => sum + field.weight, 0);
// (weights with a fraction: in thousandths)
const ticketsOf = (list) => list.map((field) => Math.round(field.weight * 1000));

// The symbols a spot of a reel can show (the wild not on the first reel) and their tickets
const POOLS = Array.from({ length: REELS }, (_, reel) => {
  const list = SYMBOLS.filter((symbol) => !(symbol.wild && reel === 0));
  return { ids: list.map((symbol) => symbol.id), tickets: ticketsOf(list) };
});
// (the free spins: fewer 🥚)
const FREE_POOLS = POOLS.map((pool) => ({ ids: pool.ids, tickets: pool.ids.map((id, i) => (id === EGG ? Math.round(pool.tickets[i] * FREE_EGG) : pool.tickets[i])) }));
const HEIGHT_TICKETS = ticketsOf(HEIGHTS);

function pick(tickets, randomInt) {
  let ticket = randomInt(tickets.reduce((a, b) => a + b, 0));
  for (let i = 0; i < tickets.length; i++) if ((ticket -= tickets[i]) < 0) return i;
  return tickets.length - 1;
}
const symbolOn = (reel, randomInt, pools = POOLS) => pools[reel].ids[pick(pools[reel].tickets, randomInt)];
// The height of a reel: at least `least` rows (the free spins' cave)
function heightOf(randomInt, least = MIN_ROWS) {
  return Math.max(least, HEIGHTS[pick(HEIGHT_TICKETS, randomInt)].rows);
}

// A new screen: grid[reel] = the symbols from the top down
function screen(randomInt, least = MIN_ROWS, pools = POOLS) {
  return Array.from({ length: REELS }, (_, reel) => Array.from({ length: heightOf(randomInt, least) }, () => symbolOn(reel, randomInt, pools)));
}

const waysOf = (grid) => grid.reduce((ways, column) => ways * column.length, 1);

/*
 * The wins of a screen: [{symbol, reels (3 to 6), ways, pay (times the bet), spots: [[reel, row], ...]}] - a symbol
 * wins with itself or the wild on every reel from the left, the ways are the product of those counts
 */
function winsOf(grid) {
  const wins = [];
  for (const symbol of SYMBOLS) {
    if (symbol.wild || symbol.scatter) continue;
    let ways = 1;
    let reels = 0;
    for (let reel = 0; reel < REELS; reel++) {
      const count = grid[reel].filter((id) => id === symbol.id || id === WILD).length;
      if (!count) break;
      ways *= count;
      reels++;
    }
    if (reels < 3) continue;
    const spots = [];
    for (let reel = 0; reel < reels; reel++) grid[reel].forEach((id, row) => (id === symbol.id || id === WILD) && spots.push([reel, row]));
    wins.push({ symbol: symbol.id, reels: reels, ways: ways, pay: symbol.pays[reels - 3] * PAY_SCALE * ways, spots: spots });
  }
  return wins;
}

/*
 * The tumbles of a screen: while something wins, the winning spots go, the rest falls down, new symbols come in
 * from the top. -> {steps: [{grid (before), wins, pay (times the bet), fallen: [[reel, row] new spots]}], grid (the
 * last), pay (all, times the bet), tumbles (how many times it tumbled)}
 */
function tumble(grid, randomInt, pools = POOLS) {
  const steps = [];
  let pay = 0;
  for (let n = 0; n < MAX_TUMBLES; n++) {
    const wins = winsOf(grid);
    if (!wins.length) break;
    const stepPay = wins.reduce((sum, win) => sum + win.pay, 0);
    pay += stepPay;
    const gone = new Set();
    wins.forEach((win) => win.spots.forEach(([reel, row]) => gone.add(reel + ":" + row)));
    // Every reel: the symbols left fall to the bottom, new ones on top (the same height)
    const next = grid.map((column, reel) => {
      const kept = column.filter((_, row) => !gone.has(reel + ":" + row));
      const fresh = Array.from({ length: column.length - kept.length }, () => symbolOn(reel, randomInt, pools));
      return [...fresh, ...kept];
    });
    steps.push({ grid: grid, wins: wins, pay: stepPay, fresh: next.map((column, reel) => column.length - grid[reel].filter((_, row) => !gone.has(reel + ":" + row)).length) });
    grid = next;
  }
  return { steps: steps, grid: grid, pay: pay, tumbles: steps.length };
}

const eggsIn = (grid) => grid.reduce((sum, column) => sum + column.filter((id) => id === EGG).length, 0);
const freeSpinsFor = (eggs) => (eggs >= EGG_TRIGGER ? FREE_SPINS + FREE_PER_EGG * (eggs - EGG_TRIGGER) : 0);

/*
 * The free spins from `spins` of them: {start, spins (all), freeSpins: [{grid (first), steps, last (grid), eggs,
 * more (free spins more), least (rows at least), multiplier (at the start of the spin), multiplierAfter, pay (times
 * the bet, with the multiplier)}], x (times the bet), capped}
 */
function freeGame(spins, randomInt, room = MAX_WIN) {
  const game = { start: spins, spins: spins, freeSpins: [], x: 0, capped: false };
  let multiplier = 1;
  let least = MIN_ROWS;
  for (let n = 0; n < game.spins; n++) {
    const first = screen(randomInt, least, FREE_POOLS);
    const result = tumble(first, randomInt, FREE_POOLS);
    // Every tumble's wins times the multiplier of that moment - then it grows by 1
    let pay = 0;
    const start = multiplier;
    result.steps.forEach((step) => {
      step.multiplier = multiplier;
      pay += step.pay * multiplier;
      multiplier++;
    });
    const eggs = eggsIn(result.grid);
    const more = Math.min(eggs, MAX_FREE_SPINS - game.spins);
    game.spins += more;
    const rows = least;
    least = Math.min(MAX_ROWS, least + eggs);
    if (game.x + pay >= room) {
      pay = room - game.x;
      game.capped = true;
    }
    game.x += pay;
    game.freeSpins.push({ grid: first, steps: result.steps, last: result.grid, eggs: eggs, more: more, least: rows, multiplier: start, multiplierAfter: multiplier, pay: pay, spins: game.spins });
    if (game.capped) break;
  }
  return game;
}

/*
 * One spin for `bet` coins: {grid (first), steps, last, ways, eggs, lineX (the base game, times the bet), bonus
 * (the free game or null), x (all, times the bet), win (coins), capped}. options.buy: the free spins right away (4
 * 🥚 in sight); options.forceBonus (the admin's test world): the same without paying for it.
 */
function spin(bet, randomInt = crypto.randomInt, options = {}) {
  let first = screen(randomInt);
  // (bought / forced: 4 🥚 put on 4 reels of the first screen)
  if (options.buy || options.forceBonus) {
    const reels = [0, 1, 2, 3, 4, 5];
    for (let i = reels.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [reels[i], reels[j]] = [reels[j], reels[i]];
    }
    first = first.map((column) => column.map((id) => (id === EGG ? "key" : id)));
    reels.slice(0, EGG_TRIGGER).forEach((reel) => (first[reel][randomInt(first[reel].length)] = EGG));
  }
  const base = tumble(first, randomInt);
  let x = Math.min(base.pay, MAX_WIN);
  let capped = base.pay > MAX_WIN;
  const eggs = eggsIn(base.grid);
  let bonus = null;
  if (!capped && eggs >= EGG_TRIGGER) {
    bonus = freeGame(freeSpinsFor(eggs), randomInt, MAX_WIN - x);
    x += bonus.x;
    capped = bonus.capped;
  }
  return { grid: first, ways: waysOf(first), steps: base.steps, last: base.grid, eggs: eggs, lineX: Math.min(base.pay, MAX_WIN), bonus: bonus, x: x, win: Math.floor(bet * x), capped: capped };
}

// For the page: the symbols (with the pays, scaled), the rules of the free spins
function catalog() {
  return {
    symbols: SYMBOLS.map((symbol) => ({ id: symbol.id, icon: symbol.icon, name: symbol.name, pays: symbol.pays.map((p) => Math.round(p * PAY_SCALE * 1000) / 1000), wild: symbol.wild === true, scatter: symbol.scatter === true })),
    reels: REELS,
    rows: [MIN_ROWS, MAX_ROWS],
    maxWays: MAX_ROWS ** REELS,
    free: { trigger: EGG_TRIGGER, spins: FREE_SPINS, perEgg: FREE_PER_EGG, max: MAX_FREE_SPINS },
    maxWin: MAX_WIN,
    buy: BUY_PRICE,
    buyRtp: BUY_RTP,
  };
}

module.exports = { RTP, REELS, MIN_ROWS, MAX_ROWS, HEIGHTS, SYMBOLS, BY_ID, PAY_SCALE, EGG_TRIGGER, FREE_SPINS, FREE_PER_EGG, MAX_FREE_SPINS, MAX_WIN, BUY_PRICE, BUY_RTP, SPIN_SPREAD, screen, winsOf, tumble, waysOf, eggsIn, freeSpinsFor, freeGame, spin, catalog };
