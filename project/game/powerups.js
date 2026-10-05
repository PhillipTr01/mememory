/*
 * MemeMory power-ups (mode "powerups").
 * Pure helpers without sockets: definitions, random picks and board changes.
 */
const { CARD_COUNT } = require("./board");

const COLUMNS = 11; // the board is 11 x 6 cards (on big screens)
const ROWS = CARD_COUNT / COLUMNS;

const HAND_LIMIT = 3; // power-ups a player can hold
const POWER_PAIRS = 4; // pairs on the board that give a power-up
const UNLUCKY_TURNS = 5; // turns in a row without a pair -> bonus power-up
const START_POWERUPS = 2;

/*
 * rarity: how often it comes (by impact), see RARITY
 * emoji: shown in the game and in chat messages
 * target: what the player has to choose before it is used
 *   null    - nothing, used right away
 *   "card"  - one closed card
 *   "cards" - two closed cards
 *   "player" - an opponent (chosen automatically if there is only one)
 */
const POWERUPS = {
  // Information
  map: { category: "info", rarity: "common", target: null, emoji: "🗺️", name: "Map", description: "Shows you which cards were never opened." },
  peek: { category: "info", rarity: "common", target: "card", emoji: "🔍", name: "Peek", description: "Look at one closed card - only you see it." },
  spotlight: { category: "info", rarity: "rare", target: "card", emoji: "🔦", name: "Spotlight", description: "Look at a card and its neighbours - only you see them." },
  // Tempo
  extraTurn: { category: "tempo", rarity: "rare", target: null, emoji: "➕", name: "Extra turn", description: "After your next wrong pair you keep playing." },
  secondChance: { category: "tempo", rarity: "uncommon", target: null, emoji: "🔁", name: "Second chance", description: "If your second card is wrong, it closes and you pick another one." },
  tripleFlip: { category: "tempo", rarity: "rare", target: null, emoji: "🔱", name: "Triple flip", description: "Open 3 cards instead of 2 - any pair among them counts." },
  // Attack
  shuffle: { category: "attack", rarity: "rare", target: null, emoji: "🔀", name: "Shuffle", description: "Shuffles all closed cards." },
  fog: { category: "attack", rarity: "uncommon", target: "player", emoji: "🌫️", name: "Fog", description: "A player of your choice only sees blurred cards in their next turn." },
  skip: { category: "attack", rarity: "rare", target: "player", emoji: "⏭️", name: "Skip", description: "A player of your choice misses their next turn." },
  steal: { category: "attack", rarity: "uncommon", target: "player", emoji: "🥷", name: "Steal", description: "Take a random power-up from a player of your choice." },
  // Points
  shield: { category: "points", rarity: "common", target: null, emoji: "🛡️", name: "Shield", description: "Blocks the next attack against you (Fog, Skip, Steal)." },
  combo: { category: "points", rarity: "uncommon", target: null, emoji: "🎯", name: "Combo", description: "This turn every further pair gives bonus points (+1, +2, ...)." },
  doubleOrNothing: { category: "points", rarity: "common", target: null, emoji: "🎰", name: "Double or nothing", description: "Your next pair this turn counts double - a wrong pair costs 1 point." },
  // Board
  swap: { category: "board", rarity: "uncommon", target: "cards", emoji: "🔄", name: "Swap", description: "Swap two closed cards." },
  rowShift: { category: "board", rarity: "uncommon", target: "card", emoji: "↔️", name: "Row shift", description: "The closed cards in the row of a card move one place to the right." },
  rotate: { category: "board", rarity: "uncommon", target: null, emoji: "🌀", name: "Rotate", description: "Turns the whole board by 180 degrees." },
  bomb: { category: "board", rarity: "common", target: "card", emoji: "💣", name: "Bomb", description: "Shows a card and its neighbours to everybody for 2 seconds." },
  // Chaos
  party: { category: "chaos", rarity: "uncommon", target: null, emoji: "🎉", name: "Party", description: "Every player gets a random power-up." },
  mysteryBox: { category: "chaos", rarity: "common", target: null, emoji: "🎁", name: "Mystery box", description: "Usually a random power-up - but it can also hurt you." },
};

const IDS = Object.keys(POWERUPS);

/*
 * Weights by impact: strong power-ups come less often, but still regularly
 * (common ~8%, uncommon ~4.7%, rare ~2.7% per draw each).
 */
const RARITY = { common: 12, uncommon: 7, rare: 4 };

// Every time a player got a power-up, it comes half as often for them
const REPEAT_FACTOR = 0.5;

/*
 * received: how often the player already got each power-up ({ map: 2, ... }),
 * so the same power-up gets rarer for them every time
 */
function weight(id, received = {}) {
  return RARITY[POWERUPS[id].rarity] * Math.pow(REPEAT_FACTOR, received[id] || 0);
}

function weightedPick(list, received) {
  const total = list.reduce((sum, id) => sum + weight(id, received), 0);
  let roll = Math.random() * total;
  for (const id of list) {
    roll -= weight(id, received);
    if (roll < 0) return id;
  }
  return list[list.length - 1];
}

function randomPowerup(received, exclude = []) {
  return weightedPick(IDS.filter((id) => !exclude.includes(id)), received);
}

// Two power-ups from different categories (everybody starts with the same two)
function startPowerups() {
  const first = randomPowerup();
  const second = weightedPick(IDS.filter((id) => POWERUPS[id].category !== POWERUPS[first].category));
  return [first, second];
}

// Pairs (as card ids, both cards of a pair) that give a power-up when found
function choosePowerCards(cardPairs) {
  const pairs = [];
  for (let id = 0; id < CARD_COUNT; id++) {
    if (id < cardPairs[id]) pairs.push(id);
  }
  const cards = [];
  for (let i = 0; i < POWER_PAIRS && pairs.length > 0; i++) {
    const index = Math.floor(Math.random() * pairs.length);
    const id = pairs.splice(index, 1)[0];
    cards.push(id, cardPairs[id]);
  }
  return cards;
}

// The card and its neighbours (3 x 3 on the 11 x 6 board)
function area(id) {
  const row = Math.floor(id / COLUMNS);
  const column = id % COLUMNS;
  const cards = [];
  for (let r = row - 1; r <= row + 1; r++) {
    for (let c = column - 1; c <= column + 1; c++) {
      if (r >= 0 && r < ROWS && c >= 0 && c < COLUMNS) cards.push(r * COLUMNS + c);
    }
  }
  return cards;
}

/*
 * Moves the cards: perm[newPosition] = oldPosition. Images, pairs, how often
 * a card was opened, found/opened cards and power cards move along, so the
 * game stays consistent.
 */
function applyPermutation(room, perm) {
  const newOf = [];
  perm.forEach((oldPosition, newPosition) => (newOf[oldPosition] = newPosition));

  room.cardImages = perm.map((old) => room.cardImages[old]);
  room.cardCounter = perm.map((old) => room.cardCounter[old]);
  room.cardPairs = perm.map((old) => newOf[room.cardPairs[old]]);
  room.foundMatches = room.foundMatches.map((old) => newOf[old]);
  room.openedCards = room.openedCards.map((old) => newOf[old]);
  room.powerCards = (room.powerCards || []).map((old) => newOf[old]);
}

function identity() {
  return [...Array(CARD_COUNT).keys()];
}

// All closed cards change places
function shufflePermutation(room) {
  const perm = identity();
  const closed = perm.filter((id) => !room.foundMatches.includes(id) && !room.openedCards.includes(id));
  const shuffled = closed.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  closed.forEach((position, index) => (perm[position] = shuffled[index]));
  return perm;
}

function swapPermutation(a, b) {
  const perm = identity();
  perm[a] = b;
  perm[b] = a;
  return perm;
}

// The closed cards of a row move one place to the right (the last one to the front)
function rowShiftPermutation(room, id) {
  const perm = identity();
  const row = Math.floor(id / COLUMNS);
  const closed = [];
  for (let column = 0; column < COLUMNS; column++) {
    const card = row * COLUMNS + column;
    if (!room.foundMatches.includes(card) && !room.openedCards.includes(card)) closed.push(card);
  }
  closed.forEach((position, index) => (perm[position] = closed[(index - 1 + closed.length) % closed.length]));
  return closed.length > 1 ? perm : null;
}

// The whole board turns by 180 degrees
function rotatePermutation() {
  return identity().map((id) => CARD_COUNT - 1 - id);
}

module.exports = {
  POWERUPS,
  IDS,
  RARITY,
  REPEAT_FACTOR,
  weight,
  HAND_LIMIT,
  POWER_PAIRS,
  UNLUCKY_TURNS,
  START_POWERUPS,
  randomPowerup,
  startPowerups,
  choosePowerCards,
  area,
  applyPermutation,
  shufflePermutation,
  swapPermutation,
  rowShiftPermutation,
  rotatePermutation,
};
