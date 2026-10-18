const poker = require("./poker");

/*
 * Poker bots: they fill a table when there are too few people (see sockets/poker_server.js).
 * A bot only knows what a player at its seat knows: its own two cards, the board, the bets.
 * It plays tight and solid - its chance to win against random hands (played out a few
 * hundred times) against the price of a call - with bluffs, slowplays and bet sizes that don't tell the hand.
 */

const NAMES = ["Bot Ace", "Bot River", "Bot Lucky", "Bot Chip"];
const TRIALS = 250; // boards played out per decision
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

// How a bot plays. Bet sizes never tell the hand: strong hands, medium ones and bluffs all pick from the
// same sizes. Strong hands are sometimes slowplayed (checked, then raised), weak ones bluffed on every
// street, a bet sometimes raised as a bluff - the numbers: how often (0..1) and how strong (times the average)
const STYLE = {
  strong: 1.6, // a strong hand: its chance this many times the average at the table
  medium: 1.05, // a medium one (below: weak)
  betStrong: 0.6, // nobody bet: a strong hand bets this often (the rest: a slowplay)
  betMedium: 0.3,
  bluff: [0.15, 0.11, 0.09], // a weak hand bets this often on the flop, the turn, the river (heads-up - fewer with more players)
  raiseStrong: 0.45, // a bet to answer: a strong hand raises this often
  raiseBluff: 0.05, // ... a weak or medium one raises as a bluff (heads-up)
  openRange: 1.3, // before the flop: raises with this edge or more ...
  openOften: 0.55,
  openBluff: 0.08, // ... and sometimes with anything
  loose: 0.02, // calls when its chance beats the price by this much (below 0: looser)
  sizes: [0.33, 0.5, 0.66], // of the pot - one list for every bet
};

// A few characters (by the bot's name - see NAMES): one plays wilder, one tighter, one bets more
const PERSONALITIES = [
  {},
  { bluff: [0.2, 0.15, 0.12], raiseBluff: 0.08, openBluff: 0.12, betStrong: 0.7, loose: -0.01 },
  { betStrong: 0.5, betMedium: 0.2, bluff: [0.1, 0.08, 0.06], raiseStrong: 0.55, openOften: 0.45, loose: 0.03 },
  { bluff: [0.17, 0.12, 0.1], betMedium: 0.35, raiseStrong: 0.4, openRange: 1.2, sizes: [0.4, 0.5, 0.66, 0.8] },
];
const styleOf = (name) => ({ ...STYLE, ...PERSONALITIES[Math.max(0, NAMES.indexOf(name)) % PERSONALITIES.length] });

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
  const strong = edge >= style.strong;
  const medium = !strong && edge >= style.medium;
  const max = bet + stack;
  // (bluffs: fewer the more players could call)
  const heads = 1 / opponents;
  // A raise to: one of the sizes on top of the call, whatever the hand - at least a full raise, at most all
  // (less than a raise left: all)
  const raise = () => {
    const share = style.sizes[Math.floor(rng() * style.sizes.length)];
    const size = Math.max(minRaise, Math.round(((pot + toCall) * share) / bigBlind) * bigBlind);
    const to = highBet + size;
    return { type: "raise", amount: max - to < minRaise ? max : to };
  };
  const canRaise = max > highBet && (view.raises || 0) < RAISES;
  const preflop = board.length === 0;

  if (toCall <= 0) {
    // Nobody bet: strong hands mostly bet (else a slowplay), medium ones sometimes, weak ones bluff now and then
    if (!canRaise) return { type: "check" };
    if (preflop) return edge >= style.openRange && rng() < style.openOften ? raise() : { type: "check" };
    if (strong && rng() < style.betStrong) return raise();
    if (medium && rng() < style.betMedium) return raise();
    if (!strong && !medium && rng() < style.bluff[board.length - 3] * heads) return raise();
    return { type: "check" };
  }
  // A bet to answer: raise strong hands (often - a slowplayed one too), now and then a bluff raise,
  // call when the chance pays for the price, else fold
  const price = toCall / (pot + toCall);
  if (canRaise) {
    if (preflop && edge >= style.openRange && rng() < style.openOften) return raise();
    if (preflop && rng() < style.openBluff * heads) return raise();
    if (!preflop && strong && rng() < style.raiseStrong) return raise();
    if (!preflop && !strong && rng() < style.raiseBluff * heads) return raise();
  }
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

module.exports = { NAMES, STYLE, styleOf, fastScore, equity, decide, registerLedger, ledgerOf };
