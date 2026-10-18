const poker = require("./poker");

/*
 * Poker bots: they fill a table when there are too few people (see sockets/poker_server.js).
 * A bot only knows what a player at its seat knows: its own two cards, the board, the bets.
 * It plays tight and solid - its chance to win against random hands (played out a few
 * hundred times) against the price of a call, a raise with a strong hand, now and then a bluff.
 */

const NAMES = ["Bot Ace", "Bot River", "Bot Lucky", "Bot Chip"];
const TRIALS = 250; // boards played out per decision
const BLUFF = 0.07; // how often a weak hand bets when nobody did
const RAISES = 2; // a bot raises at most this often on one street - then it only calls

// A fast score of 5 to 7 cards as one number (bigger wins) - the same order as poker.bestHand, many times faster
const RANK = Object.fromEntries([..."23456789TJQKA"].map((r, i) => [r, i + 2]));
const SUIT = { s: 0, h: 1, d: 2, c: 3 };
// (the highest straight in a bitmask of ranks - the wheel: 5)
function straightTop(mask) {
  for (let top = 14; top >= 6; top--) if (((mask >> (top - 4)) & 31) === 31) return top;
  return (mask & 0b100000000111100) === 0b100000000111100 ? 5 : 0;
}
const pack = (kind, ...ranks) => ranks.reduce((score, rank, i) => score + rank * Math.pow(15, 4 - i), kind * Math.pow(15, 5));
function fastScore(cards) {
  const counts = new Array(15).fill(0);
  const suits = [0, 0, 0, 0];
  const bySuit = [0, 0, 0, 0];
  let mask = 0;
  for (const card of cards) {
    const r = RANK[card[0]];
    const su = SUIT[card[1]];
    counts[r]++;
    suits[su]++;
    bySuit[su] |= 1 << r;
    mask |= 1 << r;
  }
  const flushSuit = suits.findIndex((n) => n >= 5);
  if (flushSuit >= 0) {
    const top = straightTop(bySuit[flushSuit]);
    if (top) return pack(8, top);
  }
  const quads = [], trips = [], pairs = [];
  for (let r = 14; r >= 2; r--) {
    if (counts[r] === 4) quads.push(r);
    else if (counts[r] === 3) trips.push(r);
    else if (counts[r] === 2) pairs.push(r);
  }
  const kickers = (skip, n) => {
    const out = [];
    for (let r = 14; r >= 2 && out.length < n; r--) if (counts[r] && !skip.includes(r)) out.push(r);
    return out;
  };
  if (quads.length) return pack(7, quads[0], ...kickers([quads[0]], 1));
  if (trips.length && (trips.length > 1 || pairs.length)) return pack(6, trips[0], trips.length > 1 ? Math.max(trips[1], pairs[0] || 0) : pairs[0]);
  if (flushSuit >= 0) {
    const ranks = [];
    for (let r = 14; r >= 2 && ranks.length < 5; r--) if (bySuit[flushSuit] & (1 << r)) ranks.push(r);
    return pack(5, ...ranks);
  }
  const straight = straightTop(mask);
  if (straight) return pack(4, straight);
  if (trips.length) return pack(3, trips[0], ...kickers([trips[0]], 2));
  if (pairs.length >= 2) return pack(2, pairs[0], pairs[1], ...kickers([pairs[0], pairs[1]], 1));
  if (pairs.length) return pack(1, pairs[0], ...kickers([pairs[0]], 3));
  return pack(0, ...kickers([], 5));
}

// The chance to win (a tie counts half) with `cards` and `board` against `opponents` random hands
function equity(cards, board, opponents, rng = Math.random, trials = TRIALS) {
  const known = new Set([...cards, ...board]);
  const rest = poker.newDeck().filter((card) => !known.has(card));
  const need = 5 - board.length;
  let won = 0;
  for (let t = 0; t < trials; t++) {
    // (a partial shuffle: only the cards dealt)
    const take = need + 2 * opponents;
    for (let i = 0; i < take; i++) {
      const j = i + Math.floor(rng() * (rest.length - i));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    const full = board.concat(rest.slice(0, need));
    const mine = fastScore(cards.concat(full));
    let best = 1; // (1: not behind anybody, 0: behind)
    let ties = 0;
    for (let o = 0; o < opponents && best > 0; o++) {
      const at = need + 2 * o;
      const diff = mine - fastScore([rest[at], rest[at + 1]].concat(full));
      if (diff < 0) best = 0;
      else if (diff === 0) ties++;
    }
    if (best > 0) won += 1 / (1 + ties);
  }
  return won / trials;
}

// How a bot plays: soft on purpose - small value bets, few raises, a little loose - so it is a fair
// opponent at the table, not a shark that drains weak players
const STYLE = {
  value: 1.6, // bets when its chance is this many times the average ...
  valueOften: 0.6, // ... this often (a check hides the rest)
  valueSize: [0.38, 0.55], // of the pot
  raise: 2.25, // raises a bet when its chance is this many times the average ...
  raiseOften: 0.42,
  raiseSize: [0.5, 0.8],
  loose: 0, // calls when its chance beats the price by this much
};

/*
 * What a bot does at its turn. view: {cards, board, pot (every chip in the middle, this
 * street's bets too), toCall, bet (its own on this street), stack, highBet, minRaise,
 * bigBlind, opponents (still in the hand), raises (its own on this street)}
 * -> {type: "fold" | "check" | "call" | "raise", amount (raise: to)}
 */
function decide(view, rng = Math.random, style = STYLE) {
  const { cards, board, pot, toCall, bet, stack, highBet, minRaise, bigBlind } = view;
  const opponents = Math.max(1, view.opponents);
  const win = equity(cards, board, opponents, rng);
  // (how much better than an average hand at this table: 1 = average)
  const edge = win * (opponents + 1);
  const max = bet + stack;
  const between = ([low, high]) => low + rng() * (high - low);
  // A raise to: a share of the pot on top of the call - at least a full raise, at most all (less than a raise left: all)
  const raiseTo = (share) => {
    const size = Math.max(minRaise, Math.round(((pot + toCall) * share) / bigBlind) * bigBlind);
    const to = highBet + size;
    return { type: "raise", amount: max - to < minRaise ? max : to };
  };
  const canRaise = max > highBet && (view.raises || 0) < RAISES;

  if (toCall <= 0) {
    // Nobody bet: bet a strong hand (not always - a check hides it), sometimes a bluff, else check
    if (canRaise && edge > style.value && rng() < style.valueOften) return raiseTo(between(style.valueSize));
    if (canRaise && board.length >= 3 && board.length < 5 && edge < 0.8 && rng() < BLUFF) return raiseTo(style.valueSize[0]);
    return { type: "check" };
  }
  // A bet to answer: call when the chance to win pays for it, raise a strong hand
  const price = toCall / (pot + toCall);
  if (canRaise && edge > style.raise && rng() < style.raiseOften) return raiseTo(between(style.raiseSize));
  if (win > price + style.loose) return { type: "call" };
  // (a cheap call now and then: a bot that always folds is easy to read)
  if (toCall <= bigBlind && win > price - 0.05 && rng() < 0.3) return { type: "call" };
  return { type: "fold" };
}

// The house's ledger of the bots per world ("" the casino, "/season" ...): what they bought in, took out, hands played
const ledgers = new Map();
function registerLedger(world, get) {
  ledgers.set(world || "", get);
}
function ledgerOf(world) {
  const get = ledgers.get(world || "");
  return get ? get() : null;
}

module.exports = { NAMES, STYLE, fastScore, equity, decide, registerLedger, ledgerOf };
