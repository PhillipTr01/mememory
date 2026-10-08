const crypto = require("crypto");
const Setting = require("../models/Setting");
const EventEmitter = require("events");

// "change": the cases changed (the battle pages get the new list)
const changes = new EventEmitter();

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

// The cases as they come with the casino (the admin panel can change them, add new ones - see below)
const BUILT_IN = [
  {
    id: "starter",
    name: "Starter",
    icon: "🎒",
    price: 10,
    risk: "balanced",
    target: 0.912,
    items: [
      { name: "Rubber Duck", icon: "🦆", value: 2, weight: 21751 },
      { name: "Deal With It", icon: "🕶️", value: 5, weight: 31288 },
      { name: "Banana for Scale", icon: "🍌", value: 10, weight: 23270 },
      { name: "Nyan Cat", icon: "🌈", value: 18, weight: 20076 },
      { name: "Dogecoin", icon: "🐕", value: 30, weight: 3294 },
      { name: "Trollface", icon: "😈", value: 60, weight: 321 },
    ],
  },
  {
    id: "classic",
    name: "Classic Memes",
    icon: "😂",
    price: 25,
    risk: "balanced",
    target: 0.91,
    items: [
      { name: "Facepalm", icon: "🤦", value: 5, weight: 18176 },
      { name: "Distracted Boyfriend", icon: "👀", value: 12, weight: 25844 },
      { name: "This Is Fine", icon: "🔥", value: 25, weight: 22340 },
      { name: "Grumpy Cat", icon: "😾", value: 35, weight: 29583 },
      { name: "Rickroll", icon: "🕺", value: 60, weight: 3321 },
      { name: "Galaxy Brain", icon: "🧠", value: 110, weight: 736 },
    ],
  },
  {
    id: "doge",
    name: "Such Doge",
    icon: "🐕",
    price: 50,
    risk: "balanced",
    target: 0.915,
    items: [
      { name: "Wow Bone", icon: "🦴", value: 10, weight: 6370 },
      { name: "Many Treat", icon: "🍪", value: 25, weight: 33395 },
      { name: "Such Hat", icon: "🎩", value: 50, weight: 22929 },
      { name: "Very Ball", icon: "🎾", value: 60, weight: 32112 },
      { name: "Shiba Crown", icon: "👑", value: 100, weight: 4774 },
      { name: "Moon Doge", icon: "🌕", value: 300, weight: 420 },
    ],
  },
  {
    id: "diamond",
    name: "Diamond Hands",
    icon: "💎",
    price: 100,
    risk: "balanced",
    target: 0.913,
    items: [
      { name: "Paper Hands", icon: "🧻", value: 20, weight: 12524 },
      { name: "HODL Sign", icon: "🪧", value: 50, weight: 25090 },
      { name: "Lambo Keys", icon: "🔑", value: 100, weight: 27336 },
      { name: "Diamond Fist", icon: "✊", value: 120, weight: 28944 },
      { name: "Gold Bar", icon: "🥇", value: 220, weight: 5837 },
      { name: "Diamond Hands", icon: "💎", value: 500, weight: 269 },
    ],
  },
  {
    id: "stonks",
    name: "Stonks",
    icon: "📈",
    price: 250,
    risk: "balanced",
    target: 0.907,
    items: [
      { name: "Not Stonks", icon: "📉", value: 50, weight: 5992 },
      { name: "Meme Stock", icon: "📄", value: 120, weight: 33293 },
      { name: "Stonks Guy", icon: "👨‍💼", value: 250, weight: 22330 },
      { name: "Bull Market", icon: "🐂", value: 280, weight: 32389 },
      { name: "Rocket Fuel", icon: "⛽", value: 540, weight: 5483 },
      { name: "Wall Street Bet", icon: "🏦", value: 1500, weight: 513 },
    ],
  },
  {
    id: "lottery",
    name: "Lottery Ticket",
    icon: "🎟️",
    price: 20,
    risk: "high",
    target: 0.875,
    items: [
      { name: "Losing Ticket", icon: "🗑️", value: 1, weight: 49546 },
      { name: "Pocket Lint", icon: "🧦", value: 4, weight: 29255 },
      { name: "Scratch Card", icon: "🃏", value: 15, weight: 8371 },
      { name: "Four-Leaf Clover", icon: "🍀", value: 60, weight: 10802 },
      { name: "Golden Ticket", icon: "🎫", value: 340, weight: 1969 },
      { name: "Jackpot", icon: "🎰", value: 2500, weight: 57 },
    ],
  },
  {
    id: "moon",
    name: "To the Moon",
    icon: "🚀",
    price: 50,
    risk: "high",
    target: 0.881,
    items: [
      { name: "Crashed Rocket", icon: "💥", value: 2, weight: 37851 },
      { name: "Launch Pad", icon: "🛰️", value: 10, weight: 35409 },
      { name: "Astronaut", icon: "👨‍🚀", value: 50, weight: 11903 },
      { name: "Moon Rock", icon: "🌑", value: 150, weight: 12390 },
      { name: "Mars Colony", icon: "🪐", value: 520, weight: 2390 },
      { name: "To the Moon", icon: "🚀", value: 5000, weight: 57 },
    ],
  },
  {
    id: "allin",
    name: "All or Nothing",
    icon: "🎲",
    price: 100,
    risk: "high",
    target: 0.885,
    items: [
      { name: "Nothing", icon: "💨", value: 1, weight: 50652 },
      { name: "Snake Eyes", icon: "🐍", value: 20, weight: 25653 },
      { name: "Lucky Dice", icon: "🎲", value: 100, weight: 9850 },
      { name: "Royal Flush", icon: "🂡", value: 350, weight: 12176 },
      { name: "High Roller", icon: "🎩", value: 1500, weight: 1628 },
      { name: "All In", icon: "💰", value: 15000, weight: 41 },
    ],
  },
  {
    id: "pepe",
    name: "Golden Pepe",
    icon: "🐸",
    price: 500,
    risk: "high",
    target: 0.884,
    items: [
      { name: "Sad Pepe", icon: "😢", value: 10, weight: 29234 },
      { name: "Smug Pepe", icon: "😏", value: 100, weight: 24863 },
      { name: "Pepe Hands", icon: "🙌", value: 300, weight: 24944 },
      { name: "Rare Pepe", icon: "🖼️", value: 1000, weight: 18169 },
      { name: "Feels Good Man", icon: "😌", value: 5000, weight: 2697 },
      { name: "Golden Pepe", icon: "🐸", value: 25000, weight: 93 },
    ],
  },
  {
    id: "piggy",
    name: "Piggy Bank",
    icon: "🐷",
    price: 10,
    risk: "low",
    target: 0.931,
    items: [
      { name: "Lost Button", icon: "🔘", value: 5, weight: 19333 },
      { name: "Bottle Cap", icon: "🧢", value: 7, weight: 29675 },
      { name: "Lucky Penny", icon: "🪙", value: 10, weight: 23600 },
      { name: "Shiny Marble", icon: "🔮", value: 11, weight: 13409 },
      { name: "Silver Spoon", icon: "🥄", value: 16, weight: 11827 },
      { name: "Golden Egg", icon: "🥚", value: 25, weight: 2156 },
    ],
  },
  {
    id: "couch",
    name: "Couch Change",
    icon: "🛋️",
    price: 50,
    risk: "low",
    target: 0.929,
    items: [
      { name: "Old Receipt", icon: "🧾", value: 25, weight: 24801 },
      { name: "Remote Control", icon: "📺", value: 35, weight: 18748 },
      { name: "Lost Keys", icon: "🗝️", value: 50, weight: 24585 },
      { name: "Phone Charger", icon: "🔌", value: 55, weight: 20618 },
      { name: "Wallet", icon: "👛", value: 80, weight: 8897 },
      { name: "Winning Scratchcard", icon: "🎟️", value: 125, weight: 2351 },
    ],
  },
  {
    id: "savings",
    name: "Savings Account",
    icon: "🏦",
    price: 100,
    risk: "low",
    target: 0.927,
    items: [
      { name: "Fees", icon: "📎", value: 50, weight: 21048 },
      { name: "Interest", icon: "💹", value: 70, weight: 25454 },
      { name: "Savings Bond", icon: "📜", value: 100, weight: 27111 },
      { name: "Gift Card", icon: "💳", value: 110, weight: 13875 },
      { name: "Bonus Check", icon: "✅", value: 160, weight: 10327 },
      { name: "Inheritance", icon: "💌", value: 250, weight: 2185 },
    ],
  },
  {
    id: "index",
    name: "Index Fund",
    icon: "📊",
    price: 250,
    risk: "low",
    target: 0.935,
    items: [
      { name: "Dip", icon: "🫗", value: 125, weight: 10809 },
      { name: "Sideways", icon: "➡️", value: 175, weight: 29683 },
      { name: "Dividend", icon: "🌱", value: 250, weight: 38880 },
      { name: "Green Day", icon: "🟩", value: 275, weight: 12605 },
      { name: "Bull Run", icon: "🐃", value: 400, weight: 6093 },
      { name: "All Time High", icon: "🏔️", value: 625, weight: 1930 },
    ],
  },
  {
    id: "reserve",
    name: "Gold Reserve",
    icon: "🪙",
    price: 500,
    risk: "low",
    target: 0.925,
    items: [
      { name: "Gold Dust", icon: "✨", value: 250, weight: 26352 },
      { name: "Gold Ring", icon: "💍", value: 350, weight: 20623 },
      { name: "Gold Coin", icon: "🟡", value: 500, weight: 19162 },
      { name: "Gold Watch", icon: "⌚", value: 550, weight: 20490 },
      { name: "Gold Chain", icon: "⛓️", value: 800, weight: 11381 },
      { name: "Gold Bar Stack", icon: "🧱", value: 1250, weight: 1992 },
    ],
  },
  {
    id: "vault",
    name: "Swiss Vault",
    icon: "🔐",
    price: 1000,
    risk: "low",
    target: 0.933,
    items: [
      { name: "Safety Deposit", icon: "🗄️", value: 500, weight: 11959 },
      { name: "Swiss Watch", icon: "🕰️", value: 700, weight: 27805 },
      { name: "Bearer Bond", icon: "📃", value: 1000, weight: 35887 },
      { name: "Numbered Account", icon: "🔢", value: 1100, weight: 16153 },
      { name: "Diamond Pouch", icon: "👝", value: 1600, weight: 6986 },
      { name: "The Big Vault", icon: "🏛️", value: 2500, weight: 1210 },
    ],
  },
  {
    id: "memelord",
    name: "Meme Lord",
    icon: "👑",
    price: 500,
    risk: "balanced",
    target: 0.905,
    items: [
      { name: "Cringe", icon: "😬", value: 100, weight: 9072 },
      { name: "Repost", icon: "🔁", value: 250, weight: 31203 },
      { name: "Fresh Meme", icon: "🍃", value: 500, weight: 25295 },
      { name: "Viral Post", icon: "📈", value: 600, weight: 29529 },
      { name: "Front Page", icon: "📰", value: 1100, weight: 4338 },
      { name: "Meme Lord Crown", icon: "👑", value: 2500, weight: 563 },
    ],
  },
  {
    id: "halloffame",
    name: "Hall of Fame",
    icon: "🏆",
    price: 1000,
    risk: "balanced",
    target: 0.908,
    items: [
      { name: "Participation Award", icon: "🎗️", value: 200, weight: 10112 },
      { name: "Bronze Medal", icon: "🥉", value: 500, weight: 30529 },
      { name: "Silver Medal", icon: "🥈", value: 1000, weight: 18934 },
      { name: "Gold Medal", icon: "🏅", value: 1200, weight: 35518 },
      { name: "Trophy", icon: "🏆", value: 2200, weight: 4491 },
      { name: "Legend Status", icon: "🌟", value: 5000, weight: 416 },
    ],
  },
  {
    id: "crypto",
    name: "Crypto Crash",
    icon: "📉",
    price: 250,
    risk: "high",
    target: 0.878,
    items: [
      { name: "Rug Pull", icon: "🧹", value: 10, weight: 42139 },
      { name: "Bag Holder", icon: "👜", value: 50, weight: 29321 },
      { name: "Hodl", icon: "💪", value: 250, weight: 12292 },
      { name: "Pump", icon: "⛽", value: 750, weight: 14067 },
      { name: "Moon Bag", icon: "🌙", value: 2600, weight: 2103 },
      { name: "Satoshi Wallet", icon: "₿", value: 12500, weight: 78 },
    ],
  },
  {
    id: "diamondrain",
    name: "Diamond Rain",
    icon: "💠",
    price: 750,
    risk: "high",
    target: 0.877,
    items: [
      { name: "Glass Shard", icon: "🪟", value: 30, weight: 49864 },
      { name: "Cubic Zirconia", icon: "🔹", value: 150, weight: 20162 },
      { name: "Sapphire", icon: "🔷", value: 750, weight: 13301 },
      { name: "Emerald", icon: "💚", value: 2250, weight: 14563 },
      { name: "Ruby", icon: "❤️", value: 7500, weight: 2020 },
      { name: "Diamond Storm", icon: "💠", value: 37500, weight: 90 },
    ],
  },
  {
    id: "whale",
    name: "Whale Alert",
    icon: "🐳",
    price: 1000,
    risk: "high",
    target: 0.874,
    items: [
      { name: "Plankton", icon: "🦐", value: 40, weight: 49487 },
      { name: "Shrimp", icon: "🍤", value: 200, weight: 21464 },
      { name: "Dolphin", icon: "🐬", value: 1000, weight: 13255 },
      { name: "Shark", icon: "🦈", value: 3000, weight: 13339 },
      { name: "Orca", icon: "🐋", value: 10000, weight: 2372 },
      { name: "The Whale", icon: "🐳", value: 50000, weight: 83 },
    ],
  },
  {
    id: "dragon",
    name: "Dragon's Hoard",
    icon: "🐉",
    price: 2500,
    risk: "high",
    target: 0.879,
    items: [
      { name: "Charred Bone", icon: "🦴", value: 100, weight: 31798 },
      { name: "Fire Lizard", icon: "🦎", value: 400, weight: 23807 },
      { name: "Dragon Egg", icon: "🥚", value: 1500, weight: 19941 },
      { name: "Fire Breath", icon: "🔥", value: 3200, weight: 15073 },
      { name: "Hoard of Gold", icon: "💰", value: 10500, weight: 7899 },
      { name: "Wyvern", icon: "🐲", value: 25000, weight: 1391 },
      { name: "Elder Dragon", icon: "🐉", value: 125000, weight: 91 },
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

/*
 * The cases now (the built-in ones - or as the admin panel changed them).
 * Every case has an id (stays - for turning it on / off) and a key (its
 * version): a change gives a new key, the old version is kept (retired) -
 * battles that have it (running ones, the history) stay as they were.
 */
const CASES = [];
const RETIRED = new Map(); // key -> an old version
let deleted = []; // built-in cases the admin deleted
let BY_KEY = new Map();
let BY_ID = new Map();
const KEY = "cases";

const clone = (value) => JSON.parse(JSON.stringify(value));

function prepare(box) {
  box.key = box.key || box.id;
  box.items.forEach((item) => (item.rarity = rarityOf(item.value, box.price)));
  return box;
}

function index() {
  BY_KEY = new Map(CASES.map((box) => [box.key, box]));
  BY_ID = new Map(CASES.map((box) => [box.id, box]));
}

function useDefaults() {
  CASES.splice(0, CASES.length, ...clone(BUILT_IN).map(prepare));
  RETIRED.clear();
  deleted = [];
  index();
}
useDefaults();

// The case as it is now (by its id)
function current(id) {
  return BY_ID.get(id) || null;
}

// By key (a version) - or by id (the case now)
function caseById(id) {
  return BY_KEY.get(id) || RETIRED.get(id) || BY_ID.get(id) || null;
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

// Turned on in the admin panel (config.BATTLE_CASES_OFF) - a battle that has a case already plays it to the end
function enabled(id) {
  const off = require("./config").BATTLE_CASES_OFF;
  // (only the version now - an old one can't start new battles)
  const box = BY_KEY.get(id);
  return box != null && !(Array.isArray(off) && off.includes(box.id));
}

// The public list of cases for the page (without the weights as raw numbers); off: turned off (not in the
// list to pick from - but battles that have it still show it)
function catalog() {
  const shown = (box, retired) => ({
    id: box.key,
    caseId: box.id,
    off: retired || !enabled(box.key),
    ...(retired ? { retired: true } : {}),
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
  });
  // (the old versions too: battles that have them show them - nobody can pick them)
  return [...CASES.map((box) => shown(box, false)), ...[...RETIRED.values()].map((box) => shown(box, true))];
}

/* ---------- The case editor (admin panel) ---------- */

const RISKS = ["low", "balanced", "high"];

// The payback of a case (expected value / price)
const rtpOf = (box) => (box.price > 0 ? expectedValue(box) / box.price : 0);

// Weights that add up to WEIGHT_TOTAL (every item at least 1) - from any positive numbers
function normalize(weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const free = WEIGHT_TOTAL - weights.length;
  const raw = weights.map((w) => (w / sum) * free);
  const out = raw.map((w) => Math.floor(w));
  let rest = free - out.reduce((a, b) => a + b, 0);
  raw.map((w, i) => [w - Math.floor(w), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => {
    if (rest-- > 0) out[i]++;
  });
  return out.map((w) => w + 1);
}

/*
 * The RTP balancer: the chances move (the values stay) until the case pays
 * back `target` of its price on average. The shape stays: every chance is
 * tilted by the same factor per coin of value (exponential tilting) - a
 * target lower than now makes the expensive items rarer, a higher one more
 * common. {items, rtp} or {error}.
 */
function balance(items, price, target) {
  const values = items.map((item) => item.value / price);
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (!(target > low && target < high)) return { error: `With these values the payback can only be between ${(low * 100).toFixed(1)}% and ${(high * 100).toFixed(1)}%.` };
  const start = normalize(items.map((item) => Math.max(1, item.weight || 1)));
  const scale = high || 1;
  const rtpAt = (lambda) => {
    const tilted = start.map((w, i) => w * Math.exp((lambda * values[i]) / scale));
    const sum = tilted.reduce((a, b) => a + b, 0);
    return tilted.reduce((a, w, i) => a + (w / sum) * values[i], 0);
  };
  let a = -300;
  let b = 300;
  for (let i = 0; i < 200; i++) {
    const mid = (a + b) / 2;
    if (rtpAt(mid) < target) a = mid;
    else b = mid;
  }
  const lambda = (a + b) / 2;
  const weights = normalize(start.map((w, i) => w * Math.exp((lambda * values[i]) / scale)));
  const balanced = items.map((item, i) => ({ ...item, weight: weights[i] }));
  return { items: balanced, rtp: rtpOf({ price: price, items: balanced }) };
}

// A case from the editor, checked: {case} or {error}
function check(input, id) {
  const box = input || {};
  const name = String(box.name || "").trim().slice(0, 40);
  const icon = String(box.icon || "").trim().slice(0, 8);
  const price = Number(box.price);
  const target = box.target == null || box.target === "" ? null : Number(box.target);
  if (!name) return { error: "A name, please." };
  if (!icon) return { error: "An icon, please." };
  if (!Number.isInteger(price) || price < 1 || price > 10000000) return { error: "A price from 1 to 10,000,000." };
  if (!RISKS.includes(box.risk)) return { error: "Risk: low, balanced or high." };
  if (target != null && !(target > 0.1 && target < 2)) return { error: "A payback from 10% to 200%." };
  if (!Array.isArray(box.items) || box.items.length < 2 || box.items.length > 20) return { error: "2 to 20 items." };
  const items = [];
  for (const item of box.items) {
    const itemName = String((item && item.name) || "").trim().slice(0, 40);
    const itemIcon = String((item && item.icon) || "").trim().slice(0, 8);
    const value = Number(item && item.value);
    const weight = Number(item && item.weight);
    if (!itemName || !itemIcon) return { error: "Every item needs a name and an icon." };
    if (!Number.isInteger(value) || value < 0 || value > 1000000000) return { error: `${itemName}: a value from 0 to 1,000,000,000.` };
    if (!(weight > 0)) return { error: `${itemName}: a chance above 0.` };
    items.push({ name: itemName, icon: itemIcon, value: value, weight: weight });
  }
  const weights = normalize(items.map((item) => item.weight));
  items.forEach((item, i) => (item.weight = weights[i]));
  let result = { id: id, name: name, icon: icon, price: price, risk: box.risk, target: target, items: items };
  // Balanced to the target on saving (if asked for)
  if (box.autoBalance && target != null) {
    const balanced = balance(items, price, target);
    if (balanced.error) return balanced;
    result.items = balanced.items;
  }
  result.items.sort((a, b) => a.value - b.value);
  return { case: result };
}

// For the admin panel: every case with its weights, payback, target - and if it is built in / changed
function list() {
  const off = require("./config").BATTLE_CASES_OFF || [];
  return CASES.map((box) => {
    const original = BUILT_IN.find((b) => b.id === box.id);
    return {
      id: box.id,
      name: box.name,
      icon: box.icon,
      price: box.price,
      risk: box.risk,
      target: box.target != null ? box.target : null,
      rtp: rtpOf(box),
      top: Math.max(...box.items.map((item) => item.value)) / box.price,
      off: off.includes(box.id),
      builtIn: original != null,
      changed: original != null && box.key !== box.id,
      savedAt: box.savedAt || null,
      versions: versions(box.id).length,
      items: box.items.map((item) => ({ name: item.name, icon: item.icon, value: item.value, weight: item.weight, chance: item.weight / WEIGHT_TOTAL, rarity: item.rarity })),
    };
  });
}

async function save() {
  const stored = (box) => ({ id: box.id, key: box.key, savedAt: box.savedAt || null, retiredAt: box.retiredAt || null, name: box.name, icon: box.icon, price: box.price, risk: box.risk, target: box.target != null ? box.target : null, items: box.items.map((item) => ({ name: item.name, icon: item.icon, value: item.value, weight: item.weight })) });
  await Setting.updateOne({ key: KEY }, { $set: { value: JSON.stringify({ cases: CASES.map(stored), retired: [...RETIRED.values()].map(stored), deleted: deleted }) } }, { upsert: true });
  changes.emit("change");
}

// The cases from the database (before the battles come back - they may have old versions)
async function load() {
  const row = await Setting.findOne({ key: KEY }).lean();
  useDefaults();
  if (!row || typeof row.value !== "string") return;
  let data;
  try {
    data = JSON.parse(row.value);
  } catch (error) {
    return console.error("[cases] Could not read the cases:", error);
  }
  deleted = Array.isArray(data.deleted) ? data.deleted : [];
  // (a built-in case nobody changed: as the code has it now - its chances may have been balanced since)
  const stored = (Array.isArray(data.cases) ? data.cases : []).map((box) => {
    const original = BUILT_IN.find((b) => b.id === box.id);
    return prepare(original && box.key === box.id ? clone(original) : box);
  });
  // Built-in cases added since (not deleted) come in too
  const missing = clone(BUILT_IN).filter((box) => !deleted.includes(box.id) && !stored.some((other) => other.id === box.id)).map(prepare);
  CASES.splice(0, CASES.length, ...stored, ...missing);
  (Array.isArray(data.retired) ? data.retired : []).forEach((box) => RETIRED.set(box.key, prepare(box)));
  index();
}

// A new version of a case (the old one stays for the battles that have it)
function replace(old, next) {
  old.retiredAt = Date.now();
  RETIRED.set(old.key, old);
  let key = old.id + "~" + Date.now().toString(36);
  while (RETIRED.has(key) || key === old.key) key += "x";
  const box = prepare({ ...next, id: old.id, key: key, savedAt: Date.now() });
  CASES[CASES.indexOf(old)] = box;
  index();
  return box;
}

async function create(input) {
  const base = String((input && input.name) || "case").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 20) || "case";
  let id = base;
  for (let n = 2; BY_ID.has(id) || RETIRED.has(id) || BUILT_IN.some((b) => b.id === id); n++) id = base + n;
  const result = check(input, id);
  if (result.error) return result;
  CASES.push(prepare({ ...result.case, key: id, savedAt: Date.now() }));
  index();
  await save();
  return { case: list().find((box) => box.id === id) };
}

async function update(id, input) {
  const old = BY_ID.get(id);
  if (old == null) return { error: "No such case." };
  const result = check(input, id);
  if (result.error) return result;
  replace(old, result.case);
  await save();
  return { case: list().find((box) => box.id === id) };
}

// Gone from the cases (the old version stays for the battles that have it) - at least one stays
async function remove(id) {
  const old = BY_ID.get(id);
  if (old == null) return { error: "No such case." };
  if (CASES.length <= 1) return { error: "At least one case stays." };
  old.retiredAt = Date.now();
  RETIRED.set(old.key, old);
  CASES.splice(CASES.indexOf(old), 1);
  if (BUILT_IN.some((b) => b.id === id)) deleted.push(id);
  index();
  await save();
  return { ok: true };
}

// A built-in case as it came with the casino again
async function restore(id) {
  const original = BUILT_IN.find((b) => b.id === id);
  if (original == null) return { error: "Only built-in cases can be restored." };
  const old = BY_ID.get(id);
  const box = prepare(clone(original));
  if (old) {
    if (old.key !== box.key) {
      old.retiredAt = Date.now();
      RETIRED.set(old.key, old);
    }
    CASES[CASES.indexOf(old)] = box;
  } else {
    CASES.push(box);
    deleted = deleted.filter((other) => other !== id);
  }
  RETIRED.delete(box.key);
  index();
  await save();
  return { case: list().find((other) => other.id === id) };
}

// The versions battles still have (sockets/battles_server.js tells)
let usedLookup = () => new Set();
function setUsedLookup(lookup) {
  usedLookup = lookup;
}

// An earlier version that no battle has anymore: gone for good
async function removeVersion(id, key) {
  const version = RETIRED.get(key);
  if (version == null || version.id !== id) return { error: "No such version." };
  if (usedLookup().has(key)) return { error: "A battle still has this version - it can be removed once that battle is gone." };
  RETIRED.delete(key);
  await save();
  return { ok: true };
}

// The earlier versions of a case, the newest first: {key, savedAt, retiredAt, name, icon, price, rtp, items, used}
function versions(id) {
  return [...RETIRED.values()]
    .filter((box) => box.id === id)
    .sort((a, b) => (b.retiredAt || 0) - (a.retiredAt || 0))
    .slice(0, 30)
    .map((box) => ({ used: usedLookup().has(box.key), key: box.key, savedAt: box.savedAt || null, retiredAt: box.retiredAt || null, name: box.name, icon: box.icon, price: box.price, risk: box.risk, target: box.target != null ? box.target : null, rtp: rtpOf(box), items: box.items.map((item) => ({ name: item.name, icon: item.icon, value: item.value, weight: item.weight, chance: item.weight / WEIGHT_TOTAL })) }));
}

// An earlier version back (as a new version - the one now is kept too); a deleted case comes back
async function restoreVersion(id, key) {
  const version = RETIRED.get(key);
  if (version == null || version.id !== id) return { error: "No such version." };
  const next = { name: version.name, icon: version.icon, price: version.price, risk: version.risk, target: version.target != null ? version.target : null, items: clone(version.items).map(({ name, icon, value, weight }) => ({ name, icon, value, weight })) };
  const old = BY_ID.get(id);
  if (old) replace(old, next);
  else {
    CASES.push(prepare({ ...next, id: id, key: id + "~" + Date.now().toString(36), savedAt: Date.now() }));
    deleted = deleted.filter((other) => other !== id);
    index();
  }
  await save();
  return { case: list().find((box) => box.id === id) };
}

// Deleted cases (with their last version) - to bring one back
function deletedCases() {
  const ids = [...new Set([...RETIRED.values()].map((box) => box.id))].filter((id) => !BY_ID.has(id));
  return ids.map((id) => versions(id)[0] && { id: id, ...versions(id)[0] }).filter(Boolean);
}

module.exports = { setUsedLookup, removeVersion, current, versions, restoreVersion, deletedCases, changes, enabled, CASES, BUILT_IN, WEIGHT_TOTAL, caseById, expectedValue, itemFor, newSeed, seedHash, roll, rarityOf, catalog, rtpOf, normalize, balance, check, list, load, create, update, remove, restore, useDefaults };
