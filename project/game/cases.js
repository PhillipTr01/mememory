const crypto = require("crypto");

/*
 * Cases for the hidden case battles (like on csgofast). Every item has a value
 * in coins and a weight: the chance is weight / WEIGHT_TOTAL. On average a
 * case gives back a little less than it costs (the house edge, see the tests).
 *
 *   balanced:  most items are worth something near the price
 *   high risk: mostly cheap junk, but a small chance of a huge item
 */
const WEIGHT_TOTAL = 100000;

const CASES = [
  {
    id: "starter",
    name: "Starter",
    icon: "🎒",
    price: 10,
    risk: "balanced",
    items: [
      { name: "Rubber Duck", icon: "🦆", value: 2, weight: 30000 },
      { name: "Deal With It", icon: "🕶️", value: 5, weight: 30000 },
      { name: "Banana for Scale", icon: "🍌", value: 10, weight: 20000 },
      { name: "Nyan Cat", icon: "🌈", value: 18, weight: 12000 },
      { name: "Dogecoin", icon: "🐕", value: 30, weight: 6000 },
      { name: "Trollface", icon: "😈", value: 60, weight: 2000 },
    ],
  },
  {
    id: "classic",
    name: "Classic Memes",
    icon: "😂",
    price: 25,
    risk: "balanced",
    items: [
      { name: "Facepalm", icon: "🤦", value: 5, weight: 25000 },
      { name: "Distracted Boyfriend", icon: "👀", value: 12, weight: 27000 },
      { name: "This Is Fine", icon: "🔥", value: 25, weight: 22000 },
      { name: "Grumpy Cat", icon: "😾", value: 35, weight: 15000 },
      { name: "Rickroll", icon: "🕺", value: 60, weight: 8000 },
      { name: "Galaxy Brain", icon: "🧠", value: 110, weight: 3000 },
    ],
  },
  {
    id: "doge",
    name: "Such Doge",
    icon: "🐕",
    price: 50,
    risk: "balanced",
    items: [
      { name: "Wow Bone", icon: "🦴", value: 10, weight: 22000 },
      { name: "Many Treat", icon: "🍪", value: 25, weight: 27000 },
      { name: "Such Hat", icon: "🎩", value: 50, weight: 24000 },
      { name: "Very Ball", icon: "🎾", value: 60, weight: 16000 },
      { name: "Shiba Crown", icon: "👑", value: 100, weight: 8500 },
      { name: "Moon Doge", icon: "🌕", value: 300, weight: 2500 },
    ],
  },
  {
    id: "diamond",
    name: "Diamond Hands",
    icon: "💎",
    price: 100,
    risk: "balanced",
    items: [
      { name: "Paper Hands", icon: "🧻", value: 20, weight: 20000 },
      { name: "HODL Sign", icon: "🪧", value: 50, weight: 26000 },
      { name: "Lambo Keys", icon: "🔑", value: 100, weight: 25000 },
      { name: "Diamond Fist", icon: "✊", value: 120, weight: 18000 },
      { name: "Gold Bar", icon: "🥇", value: 220, weight: 8800 },
      { name: "Diamond Hands", icon: "💎", value: 500, weight: 2200 },
    ],
  },
  {
    id: "stonks",
    name: "Stonks",
    icon: "📈",
    price: 250,
    risk: "balanced",
    items: [
      { name: "Not Stonks", icon: "📉", value: 50, weight: 20000 },
      { name: "Meme Stock", icon: "📄", value: 120, weight: 26000 },
      { name: "Stonks Guy", icon: "👨‍💼", value: 250, weight: 25000 },
      { name: "Bull Market", icon: "🐂", value: 280, weight: 18000 },
      { name: "Rocket Fuel", icon: "⛽", value: 540, weight: 9000 },
      { name: "Wall Street Bet", icon: "🏦", value: 1500, weight: 2000 },
    ],
  },
  {
    id: "lottery",
    name: "Lottery Ticket",
    icon: "🎟️",
    price: 20,
    risk: "high",
    items: [
      { name: "Losing Ticket", icon: "🗑️", value: 1, weight: 55000 },
      { name: "Pocket Lint", icon: "🧦", value: 4, weight: 25000 },
      { name: "Scratch Card", icon: "🃏", value: 15, weight: 12000 },
      { name: "Four-Leaf Clover", icon: "🍀", value: 60, weight: 5800 },
      { name: "Golden Ticket", icon: "🎫", value: 340, weight: 2000 },
      { name: "Jackpot", icon: "🎰", value: 2500, weight: 200 },
    ],
  },
  {
    id: "moon",
    name: "To the Moon",
    icon: "🚀",
    price: 50,
    risk: "high",
    items: [
      { name: "Crashed Rocket", icon: "💥", value: 2, weight: 50000 },
      { name: "Launch Pad", icon: "🛰️", value: 10, weight: 28000 },
      { name: "Astronaut", icon: "👨‍🚀", value: 50, weight: 13000 },
      { name: "Moon Rock", icon: "🌑", value: 150, weight: 6500 },
      { name: "Mars Colony", icon: "🪐", value: 520, weight: 2200 },
      { name: "To the Moon", icon: "🚀", value: 5000, weight: 300 },
    ],
  },
  {
    id: "allin",
    name: "All or Nothing",
    icon: "🎲",
    price: 100,
    risk: "high",
    items: [
      { name: "Nothing", icon: "💨", value: 1, weight: 60000 },
      { name: "Snake Eyes", icon: "🐍", value: 20, weight: 22000 },
      { name: "Lucky Dice", icon: "🎲", value: 100, weight: 10000 },
      { name: "Royal Flush", icon: "🂡", value: 350, weight: 6000 },
      { name: "High Roller", icon: "🎩", value: 1500, weight: 1800 },
      { name: "All In", icon: "💰", value: 15000, weight: 200 },
    ],
  },
  {
    id: "pepe",
    name: "Golden Pepe",
    icon: "🐸",
    price: 500,
    risk: "high",
    items: [
      { name: "Sad Pepe", icon: "😢", value: 10, weight: 55000 },
      { name: "Smug Pepe", icon: "😏", value: 100, weight: 22000 },
      { name: "Pepe Hands", icon: "🙌", value: 450, weight: 13000 },
      { name: "Rare Pepe", icon: "🖼️", value: 1800, weight: 7500 },
      { name: "Feels Good Man", icon: "😌", value: 6000, weight: 2300 },
      { name: "Golden Pepe", icon: "🐸", value: 50000, weight: 200 },
    ],
  },
];

// Rarity (color) from the value compared to the price of the case
function rarityOf(value, price) {
  const ratio = value / price;
  if (ratio >= 20) return "gold";
  if (ratio >= 6) return "red";
  if (ratio >= 2.5) return "pink";
  if (ratio >= 1.2) return "purple";
  if (ratio >= 0.6) return "blue";
  return "grey";
}

CASES.forEach((box) => box.items.forEach((item) => (item.rarity = rarityOf(item.value, box.price))));

const BY_ID = new Map(CASES.map((box) => [box.id, box]));

function caseById(id) {
  return BY_ID.get(id) || null;
}

// Average value of one opening
function expectedValue(box) {
  return box.items.reduce((sum, item) => sum + (item.value * item.weight) / WEIGHT_TOTAL, 0);
}

// The item for a roll in 0..1
function itemFor(box, roll) {
  const ticket = Math.min(WEIGHT_TOTAL - 1, Math.floor(roll * WEIGHT_TOTAL));
  let counted = 0;
  const index = box.items.findIndex((item) => (counted += item.weight) > ticket);
  return index;
}

/*
 * Provably fair: the seed is chosen when the battle is created, everybody sees
 * sha256(seed) right away and the seed after the battle. Every roll comes from
 * the seed and the battle, round and seat, so nothing can be changed later.
 */
function newSeed() {
  const seed = crypto.randomBytes(16).toString("hex");
  return { seed: seed, hash: seedHash(seed) };
}

function seedHash(seed) {
  return crypto.createHash("sha256").update(seed).digest("hex");
}

function roll(seed, key) {
  const hex = crypto.createHmac("sha256", seed).update(String(key)).digest("hex");
  return parseInt(hex.slice(0, 13), 16) / Math.pow(16, 13);
}

// The public list of cases for the page (without the weights as raw numbers)
function catalog() {
  return CASES.map((box) => ({
    id: box.id,
    name: box.name,
    icon: box.icon,
    price: box.price,
    risk: box.risk,
    items: box.items.map((item) => ({
      name: item.name,
      icon: item.icon,
      value: item.value,
      rarity: item.rarity,
      chance: item.weight / WEIGHT_TOTAL,
    })),
  }));
}

module.exports = { CASES, WEIGHT_TOTAL, caseById, expectedValue, itemFor, newSeed, seedHash, roll, rarityOf, catalog };
