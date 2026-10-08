const crypto = require("crypto");

/*
 * Texas hold'em basics: deck, best hand of 7 cards, side pots.
 * Cards are strings: rank + suit, "As" = ace of spades, "Td" = ten of diamonds.
 */
const RANKS = "23456789TJQKA";
const SUITS = "shdc";

const HAND_NAMES = ["High card", "Pair", "Two pair", "Three of a kind", "Straight", "Flush", "Full house", "Four of a kind", "Straight flush"];

function newDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push(rank + suit);
  return deck;
}

// Fisher-Yates with a secure random number
function shuffle(deck, randomInt = crypto.randomInt) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function rankOf(card) {
  return RANKS.indexOf(card[0]) + 2; // 2..14
}

/*
 * Score of exactly 5 cards: [category, tie breakers...], compared element by
 * element - the higher array wins.
 */
function score5(cards) {
  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const flush = cards.every((card) => card[1] === cards[0][1]);
  const unique = [...new Set(ranks)];
  let straightHigh = 0;
  if (unique.length === 5) {
    if (ranks[0] - ranks[4] === 4) straightHigh = ranks[0];
    // The wheel: A-2-3-4-5, the five is the highest card
    if (ranks.join() === "14,5,4,3,2") straightHigh = 5;
  }
  if (straightHigh && flush) return [8, straightHigh];

  // Ranks grouped by how often they are there: [[count, rank], ...] biggest first
  const counts = new Map();
  ranks.forEach((rank) => counts.set(rank, (counts.get(rank) || 0) + 1));
  const groups = [...counts.entries()].map(([rank, count]) => [count, rank]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const byGroup = groups.map((group) => group[1]);

  if (groups[0][0] === 4) return [7, ...byGroup];
  if (groups[0][0] === 3 && groups[1][0] === 2) return [6, ...byGroup];
  if (flush) return [5, ...ranks];
  if (straightHigh) return [4, straightHigh];
  if (groups[0][0] === 3) return [3, ...byGroup];
  if (groups[0][0] === 2 && groups[1][0] === 2) return [2, ...byGroup];
  if (groups[0][0] === 2) return [1, ...byGroup];
  return [0, ...ranks];
}

function compare(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0);
  }
  return 0;
}

// The cards of five that make the hand (the pairs, the three of a kind ...) - the rest are kickers
function madeCards(five, score) {
  const kind = score[0];
  // Straight, flush, full house, straight flush: all five
  if (kind === 4 || kind === 5 || kind === 6 || kind === 8) return five.slice();
  // High card: the highest
  if (kind === 0) return five.filter((card) => rankOf(card) === score[1]).slice(0, 1);
  // Pairs, three or four of a kind: the cards of a rank that is there more than once
  const count = (card) => five.filter((other) => rankOf(other) === rankOf(card)).length;
  return five.filter((card) => count(card) >= 2);
}

// The best 5 of 5-7 cards: {score, cards, made (the cards of the hand, without kickers), name}
function bestHand(cards) {
  let best = null;
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const five = [cards[a], cards[b], cards[c], cards[d], cards[e]];
            const score = score5(five);
            if (best == null || compare(score, best.score) > 0) best = { score: score, cards: five };
          }
  best.name = HAND_NAMES[best.score[0]];
  best.made = madeCards(best.cards, best.score);
  return best;
}

/*
 * Side pots from what everybody put in this hand.
 * players: [{seat, total, folded}] -> [{amount, eligible: [seat...]}]
 * A player who is all-in for less can only win what everybody matched.
 */
function pots(players) {
  const left = new Map(players.map((p) => [p.seat, p.total]));
  const result = [];
  for (;;) {
    const open = players.filter((p) => !p.folded && left.get(p.seat) > 0);
    if (open.length === 0) break;
    const level = Math.min(...open.map((p) => left.get(p.seat)));
    let amount = 0;
    for (const p of players) {
      const part = Math.min(left.get(p.seat), level);
      amount += part;
      left.set(p.seat, left.get(p.seat) - part);
    }
    const eligible = open.map((p) => p.seat);
    const last = result[result.length - 1];
    if (last && last.eligible.join() === eligible.join()) last.amount += amount;
    else result.push({ amount: amount, eligible: eligible });
  }
  // Chips of folded players above everybody else's: to the last pot
  const rest = [...left.values()].reduce((sum, value) => sum + value, 0);
  if (rest > 0 && result.length > 0) result[result.length - 1].amount += rest;
  return result;
}

/*
 * Who gets what: the best hand among the eligible players wins each pot, a tie
 * splits it (odd chips go to the first winners in `order`, left of the button).
 * hands: Map seat -> {score}. Returns Map seat -> amount won.
 */
function payout(potList, hands, order) {
  const won = new Map();
  for (const pot of payoutByPot(potList, hands, order)) {
    for (const w of pot.winners) won.set(w.seat, (won.get(w.seat) || 0) + w.amount);
  }
  return won;
}

// The same, pot by pot: [{amount, eligible, winners: [{seat, amount}]}]
function payoutByPot(potList, hands, order) {
  const result = [];
  for (const pot of potList) {
    let best = null;
    let winners = [];
    for (const seat of pot.eligible) {
      const hand = hands.get(seat);
      if (hand == null) continue;
      const diff = best == null ? 1 : compare(hand.score, best);
      if (diff > 0) {
        best = hand.score;
        winners = [seat];
      } else if (diff === 0) {
        winners.push(seat);
      }
    }
    if (winners.length === 0) continue;
    winners.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const share = Math.floor(pot.amount / winners.length);
    let odd = pot.amount - share * winners.length;
    result.push({
      amount: pot.amount,
      eligible: pot.eligible,
      winners: winners.map((seat) => ({ seat: seat, amount: share + (odd-- > 0 ? 1 : 0) })),
    });
  }
  return result;
}

/*
 * What a player has right now (2 to 7 cards): before the flop only pairs
 * count, from 5 cards on the best hand.
 */
function handName(cards) {
  if (cards.length >= 5) return bestHand(cards).name;
  const counts = new Map();
  cards.forEach((card) => counts.set(card[0], (counts.get(card[0]) || 0) + 1));
  const groups = [...counts.values()].sort((a, b) => b - a);
  if (groups[0] === 4) return HAND_NAMES[7];
  if (groups[0] === 3) return HAND_NAMES[3];
  if (groups[0] === 2 && groups[1] === 2) return HAND_NAMES[2];
  if (groups[0] === 2) return HAND_NAMES[1];
  return HAND_NAMES[0];
}

module.exports = { newDeck, shuffle, score5, bestHand, compare, pots, payout, payoutByPot, handName, HAND_NAMES };
