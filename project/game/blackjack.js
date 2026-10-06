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

module.exports = { newShoe, cardValue, handValue, isBlackjack, dealerHits, canSplit, settle, testing, DECKS };
