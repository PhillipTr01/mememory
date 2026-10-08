const crypto = require("crypto");
const { newDeck, shuffle } = require("./poker");

/*
 * Blackjack against the dealer. Cards like in poker: "As", "Td", ...
 *
 * No card counting: every round is dealt from a new shoe (6 decks, shuffled
 * with a secure random number) - what was played before says nothing about
 * what comes next.
 */
const DECKS = 6;

// Tests can put a fixed shoe here (the cards are taken from the end)
const testing = { shoe: null };

function newShoe() {
  if (testing.shoe) return testing.shoe.slice();
  const shoe = [];
  for (let i = 0; i < DECKS; i++) shoe.push(...newDeck());
  return shuffle(shoe, crypto.randomInt);
}

function cardValue(card) {
  const rank = card[0];
  if (rank === "A") return 11;
  if ("TJQK".includes(rank)) return 10;
  return Number(rank);
}

// {total, soft}: aces count 11 as long as that doesn't bust the hand
function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    total += cardValue(card);
    if (card[0] === "A") aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total: total, soft: aces > 0 };
}

// Only the first two cards of a hand that wasn't split
function isBlackjack(cards, split) {
  return !split && cards.length === 2 && handValue(cards).total === 21;
}

// The dealer draws to 16 and stands on every 17 (also a soft one)
function dealerHits(cards) {
  return handValue(cards).total < 17;
}

// Two cards of the same value (10, J, Q, K count as the same)
function canSplit(cards) {
  return cards.length === 2 && cardValue(cards[0]) === cardValue(cards[1]);
}

/*
 * How a hand ends against the dealer: {result, payout} - payout is what goes
 * back to the player for the bet (0: lost, bet: push, 2x bet: win, 2.5x: blackjack 3:2).
 */
function settle(hand, dealerCards) {
  const player = handValue(hand.cards).total;
  const dealer = handValue(dealerCards).total;
  const playerBj = isBlackjack(hand.cards, hand.split);
  const dealerBj = isBlackjack(dealerCards, false);
  if (player > 21) return { result: "bust", payout: 0 };
  if (playerBj && dealerBj) return { result: "push", payout: hand.bet };
  if (playerBj) return { result: "blackjack", payout: hand.bet + Math.floor((hand.bet * 3) / 2) };
  if (dealerBj) return { result: "lose", payout: 0 };
  if (dealer > 21 || player > dealer) return { result: "win", payout: hand.bet * 2 };
  if (player === dealer) return { result: "push", payout: hand.bet };
  return { result: "lose", payout: 0 };
}

/*
 * Side bets, decided by the first cards (each at most half the main bet):
 *   Perfect Pairs: the player's first two cards are a pair -
 *     mixed (other colour) 6:1, coloured (same colour) 12:1, perfect (same suit) 25:1
 *   21+3: the player's two cards and the dealer's up card as a poker hand -
 *     flush 5:1, straight 10:1, three of a kind 30:1, straight flush 40:1, suited trips 100:1
 * {name, odds} of the win, or null. Payout: the side bet times (odds + 1).
 */
const SIDE_BETS = ["pairs", "plus3"];
const red = (card) => card[1] === "h" || card[1] === "d";
const RANKS = "A23456789TJQK";

function perfectPairs(cards) {
  const [a, b] = cards;
  if (a[0] !== b[0]) return null;
  if (a[1] === b[1]) return { name: "Perfect pair", odds: 25 };
  if (red(a) === red(b)) return { name: "Coloured pair", odds: 12 };
  return { name: "Mixed pair", odds: 6 };
}

function plus3(cards, up) {
  const three = [cards[0], cards[1], up];
  const flush = three.every((card) => card[1] === three[0][1]);
  const trips = three.every((card) => card[0] === three[0][0]);
  // A straight: three ranks in a row (the ace low or high: A23, QKA)
  const ranks = three.map((card) => RANKS.indexOf(card[0])).sort((x, y) => x - y);
  const inRow = (r) => r[1] === r[0] + 1 && r[2] === r[1] + 1;
  const straight = inRow(ranks) || (ranks[0] === 0 && inRow([ranks[1], ranks[2], 13]));
  if (trips && flush) return { name: "Suited trips", odds: 100 };
  if (straight && flush) return { name: "Straight flush", odds: 40 };
  if (trips) return { name: "Three of a kind", odds: 30 };
  if (straight) return { name: "Straight", odds: 10 };
  if (flush) return { name: "Flush", odds: 5 };
  return null;
}

// What a side bet pays after the deal: {type, bet, name, payout} (payout 0: lost)
function settleSide(type, bet, cards, up) {
  const win = type === "pairs" ? perfectPairs(cards) : plus3(cards, up);
  return { type: type, bet: bet, name: win ? win.name : null, payout: win ? bet * (win.odds + 1) : 0 };
}

module.exports = { newShoe, cardValue, handValue, isBlackjack, dealerHits, canSplit, settle, perfectPairs, plus3, settleSide, SIDE_BETS, testing, DECKS };
