const crypto = require("crypto");

/*
 * Cases for the hidden case battles (like on csgofast). Every item has a value
 * in coins and a weight: the chance is weight / WEIGHT_TOTAL. On average a
 * case gives back a little less than it costs (the house edge, see the tests).
 *
 *   low risk:  every item is worth something near the price (at most 2.5x)
 *   balanced:  most items are worth something near the price
 *   high risk: mostly cheap junk, but a small chance of a huge item (up to 50x the price)
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
      { name: "Rubber Duck", icon: "🦆", value: 2, weight: 20908 },
      { name: "Deal With It", icon: "🕶️", value: 5, weight: 30571 },
      { name: "Banana for Scale", icon: "🍌", value: 10, weight: 23364 },
      { name: "Nyan Cat", icon: "🌈", value: 18, weight: 21052 },
      { name: "Dogecoin", icon: "🐕", value: 30, weight: 3685 },
      { name: "Trollface", icon: "😈", value: 60, weight: 420 },
    ],
  },
  {
    id: "classic",
    name: "Classic Memes",
    icon: "😂",
    price: 25,
    risk: "balanced",
    items: [
      { name: "Facepalm", icon: "🤦", value: 5, weight: 17412 },
      { name: "Distracted Boyfriend", icon: "👀", value: 12, weight: 25175 },
      { name: "This Is Fine", icon: "🔥", value: 25, weight: 22445 },
      { name: "Grumpy Cat", icon: "😾", value: 35, weight: 30440 },
      { name: "Rickroll", icon: "🕺", value: 60, weight: 3625 },
      { name: "Galaxy Brain", icon: "🧠", value: 110, weight: 903 },
    ],
  },
  {
    id: "doge",
    name: "Such Doge",
    icon: "🐕",
    price: 50,
    risk: "balanced",
    items: [
      { name: "Wow Bone", icon: "🦴", value: 10, weight: 5830 },
      { name: "Many Treat", icon: "🍪", value: 25, weight: 31699 },
      { name: "Such Hat", icon: "🎩", value: 50, weight: 23114 },
      { name: "Very Ball", icon: "🎾", value: 60, weight: 33160 },
      { name: "Shiba Crown", icon: "👑", value: 100, weight: 5426 },
      { name: "Moon Doge", icon: "🌕", value: 300, weight: 771 },
    ],
  },
  {
    id: "diamond",
    name: "Diamond Hands",
    icon: "💎",
    price: 100,
    risk: "balanced",
    items: [
      { name: "Paper Hands", icon: "🧻", value: 20, weight: 11441 },
      { name: "HODL Sign", icon: "🪧", value: 50, weight: 23789 },
      { name: "Lambo Keys", icon: "🔑", value: 100, weight: 27573 },
      { name: "Diamond Fist", icon: "✊", value: 120, weight: 29927 },
      { name: "Gold Bar", icon: "🥇", value: 220, weight: 6828 },
      { name: "Diamond Hands", icon: "💎", value: 500, weight: 442 },
    ],
  },
  {
    id: "stonks",
    name: "Stonks",
    icon: "📈",
    price: 250,
    risk: "balanced",
    items: [
      { name: "Not Stonks", icon: "📉", value: 50, weight: 6043 },
      { name: "Meme Stock", icon: "📄", value: 120, weight: 33469 },
      { name: "Stonks Guy", icon: "👨‍💼", value: 250, weight: 22304 },
      { name: "Bull Market", icon: "🐂", value: 280, weight: 32306 },
      { name: "Rocket Fuel", icon: "⛽", value: 540, weight: 5398 },
      { name: "Wall Street Bet", icon: "🏦", value: 1500, weight: 480 },
    ],
  },
  {
    id: "lottery",
    name: "Lottery Ticket",
    icon: "🎟️",
    price: 20,
    risk: "high",
    items: [
      { name: "Losing Ticket", icon: "🗑️", value: 1, weight: 49739 },
      { name: "Pocket Lint", icon: "🧦", value: 4, weight: 29347 },
      { name: "Scratch Card", icon: "🃏", value: 15, weight: 8373 },
      { name: "Four-Leaf Clover", icon: "🍀", value: 60, weight: 10691 },
      { name: "Golden Ticket", icon: "🎫", value: 340, weight: 1820 },
      { name: "Jackpot", icon: "🎰", value: 2500, weight: 30 },
    ],
  },
  {
    id: "moon",
    name: "To the Moon",
    icon: "🚀",
    price: 50,
    risk: "high",
    items: [
      { name: "Crashed Rocket", icon: "💥", value: 2, weight: 38047 },
      { name: "Launch Pad", icon: "🛰️", value: 10, weight: 35557 },
      { name: "Astronaut", icon: "👨‍🚀", value: 50, weight: 11892 },
      { name: "Moon Rock", icon: "🌑", value: 150, weight: 12225 },
      { name: "Mars Colony", icon: "🪐", value: 520, weight: 2250 },
      { name: "To the Moon", icon: "🚀", value: 5000, weight: 29 },
    ],
  },
  {
    id: "allin",
    name: "All or Nothing",
    icon: "🎲",
    price: 100,
    risk: "high",
    items: [
      { name: "Nothing", icon: "💨", value: 1, weight: 50792 },
      { name: "Snake Eyes", icon: "🐍", value: 20, weight: 25707 },
      { name: "Lucky Dice", icon: "🎲", value: 100, weight: 9845 },
      { name: "Royal Flush", icon: "🂡", value: 350, weight: 12076 },
      { name: "High Roller", icon: "🎩", value: 1500, weight: 1556 },
      { name: "All In", icon: "💰", value: 15000, weight: 24 },
    ],
  },
  {
    id: "pepe",
    name: "Golden Pepe",
    icon: "🐸",
    price: 500,
    risk: "high",
    items: [
      { name: "Sad Pepe", icon: "😢", value: 10, weight: 42801 },
      { name: "Smug Pepe", icon: "😏", value: 100, weight: 19865 },
      { name: "Pepe Hands", icon: "🙌", value: 450, weight: 26246 },
      { name: "Rare Pepe", icon: "🖼️", value: 1800, weight: 9620 },
      { name: "Feels Good Man", icon: "😌", value: 6000, weight: 1439 },
      { name: "Golden Pepe", icon: "🐸", value: 25000, weight: 29 },
    ],
  },
  {
    id: "piggy",
    name: "Piggy Bank",
    icon: "🐷",
    price: 10,
    risk: "low",
    items: [
      { name: "Lost Button", icon: "🔘", value: 5, weight: 19539 },
      { name: "Bottle Cap", icon: "🧢", value: 7, weight: 29845 },
      { name: "Lucky Penny", icon: "🪙", value: 10, weight: 23559 },
      { name: "Shiny Marble", icon: "🔮", value: 11, weight: 13352 },
      { name: "Silver Spoon", icon: "🥄", value: 16, weight: 11633 },
      { name: "Golden Egg", icon: "🥚", value: 25, weight: 2072 },
    ],
  },
  {
    id: "couch",
    name: "Couch Change",
    icon: "🛋️",
    price: 50,
    risk: "low",
    items: [
      { name: "Old Receipt", icon: "🧾", value: 25, weight: 25203 },
      { name: "Remote Control", icon: "📺", value: 35, weight: 18908 },
      { name: "Lost Keys", icon: "🗝️", value: 50, weight: 24517 },
      { name: "Phone Charger", icon: "🔌", value: 55, weight: 20484 },
      { name: "Wallet", icon: "👛", value: 80, weight: 8674 },
      { name: "Winning Scratchcard", icon: "🎟️", value: 125, weight: 2214 },
    ],
  },
  {
    id: "savings",
    name: "Savings Account",
    icon: "🏦",
    price: 100,
    risk: "low",
    items: [
      { name: "Fees", icon: "📎", value: 50, weight: 21748 },
      { name: "Interest", icon: "💹", value: 70, weight: 25895 },
      { name: "Savings Bond", icon: "📜", value: 100, weight: 26947 },
      { name: "Gift Card", icon: "💳", value: 110, weight: 13683 },
      { name: "Bonus Check", icon: "✅", value: 160, weight: 9796 },
      { name: "Inheritance", icon: "💌", value: 250, weight: 1931 },
    ],
  },
  {
    id: "index",
    name: "Index Fund",
    icon: "📊",
    price: 250,
    risk: "low",
    items: [
      { name: "Dip", icon: "🫗", value: 125, weight: 9950 },
      { name: "Sideways", icon: "➡️", value: 175, weight: 28359 },
      { name: "Dividend", icon: "🌱", value: 250, weight: 39272 },
      { name: "Green Day", icon: "🟩", value: 275, weight: 12969 },
      { name: "Bull Run", icon: "🐃", value: 400, weight: 6877 },
      { name: "All Time High", icon: "🏔️", value: 625, weight: 2573 },
    ],
  },
  {
    id: "reserve",
    name: "Gold Reserve",
    icon: "🪙",
    price: 500,
    risk: "low",
    items: [
      { name: "Gold Dust", icon: "✨", value: 250, weight: 27317 },
      { name: "Gold Ring", icon: "💍", value: 350, weight: 21013 },
      { name: "Gold Coin", icon: "🟡", value: 500, weight: 19028 },
      { name: "Gold Watch", icon: "⌚", value: 550, weight: 20172 },
      { name: "Gold Chain", icon: "⛓️", value: 800, weight: 10733 },
      { name: "Gold Bar Stack", icon: "🧱", value: 1250, weight: 1737 },
    ],
  },
  {
    id: "vault",
    name: "Swiss Vault",
    icon: "🔐",
    price: 1000,
    risk: "low",
    items: [
      { name: "Safety Deposit", icon: "🗄️", value: 500, weight: 11762 },
      { name: "Swiss Watch", icon: "🕰️", value: 700, weight: 27558 },
      { name: "Bearer Bond", icon: "📃", value: 1000, weight: 35978 },
      { name: "Numbered Account", icon: "🔢", value: 1100, weight: 16255 },
      { name: "Diamond Pouch", icon: "👝", value: 1600, weight: 7164 },
      { name: "The Big Vault", icon: "🏛️", value: 2500, weight: 1283 },
    ],
  },
  {
    id: "memelord",
    name: "Meme Lord",
    icon: "👑",
    price: 500,
    risk: "balanced",
    items: [
      { name: "Cringe", icon: "😬", value: 100, weight: 9297 },
      { name: "Repost", icon: "🔁", value: 250, weight: 31645 },
      { name: "Fresh Meme", icon: "🍃", value: 500, weight: 25207 },
      { name: "Viral Post", icon: "📈", value: 600, weight: 29222 },
      { name: "Front Page", icon: "📰", value: 1100, weight: 4143 },
      { name: "Meme Lord Crown", icon: "👑", value: 2500, weight: 486 },
    ],
  },
  {
    id: "halloffame",
    name: "Hall of Fame",
    icon: "🏆",
    price: 1000,
    risk: "balanced",
    items: [
      { name: "Participation Award", icon: "🎗️", value: 200, weight: 9835 },
      { name: "Bronze Medal", icon: "🥉", value: 500, weight: 30044 },
      { name: "Silver Medal", icon: "🥈", value: 1000, weight: 18998 },
      { name: "Gold Medal", icon: "🏅", value: 1200, weight: 35918 },
      { name: "Trophy", icon: "🏆", value: 2200, weight: 4719 },
      { name: "Legend Status", icon: "🌟", value: 5000, weight: 486 },
    ],
  },
  {
    id: "crypto",
    name: "Crypto Crash",
    icon: "📉",
    price: 250,
    risk: "high",
    items: [
      { name: "Rug Pull", icon: "🧹", value: 10, weight: 42777 },
      { name: "Bag Holder", icon: "👜", value: 50, weight: 29651 },
      { name: "Hodl", icon: "💪", value: 250, weight: 12250 },
      { name: "Pump", icon: "⛽", value: 750, weight: 13518 },
      { name: "Moon Bag", icon: "🌙", value: 2600, weight: 1765 },
      { name: "Satoshi Wallet", icon: "₿", value: 25000, weight: 39 },
    ],
  },
  {
    id: "diamondrain",
    name: "Diamond Rain",
    icon: "💠",
    price: 750,
    risk: "high",
    items: [
      { name: "Glass Shard", icon: "🪟", value: 30, weight: 50374 },
      { name: "Cubic Zirconia", icon: "🔹", value: 150, weight: 20324 },
      { name: "Sapphire", icon: "🔷", value: 750, weight: 13269 },
      { name: "Emerald", icon: "💚", value: 2250, weight: 14154 },
      { name: "Ruby", icon: "❤️", value: 7500, weight: 1789 },
      { name: "Diamond Storm", icon: "💠", value: 37500, weight: 90 },
    ],
  },
  {
    id: "whale",
    name: "Whale Alert",
    icon: "🐳",
    price: 1000,
    risk: "high",
    items: [
      { name: "Plankton", icon: "🦐", value: 40, weight: 50186 },
      { name: "Shrimp", icon: "🍤", value: 200, weight: 21701 },
      { name: "Dolphin", icon: "🐬", value: 1000, weight: 13208 },
      { name: "Shark", icon: "🦈", value: 3000, weight: 12818 },
      { name: "Orca", icon: "🐋", value: 10000, weight: 2004 },
      { name: "The Whale", icon: "🐳", value: 50000, weight: 83 },
    ],
  },
  {
    id: "dragon",
    name: "Dragon's Hoard",
    icon: "🐉",
    price: 2500,
    risk: "high",
    items: [
      { name: "Charred Bone", icon: "🦴", value: 100, weight: 32100 },
      { name: "Fire Lizard", icon: "🦎", value: 400, weight: 24000 },
      { name: "Dragon Egg", icon: "🥚", value: 1500, weight: 20000 },
      { name: "Fire Breath", icon: "🔥", value: 3200, weight: 15000 },
      { name: "Hoard of Gold", icon: "💰", value: 10500, weight: 7600 },
      { name: "Wyvern", icon: "🐲", value: 25000, weight: 1250 },
      { name: "Elder Dragon", icon: "🐉", value: 125000, weight: 50 },
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
