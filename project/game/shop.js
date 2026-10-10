const User = require("../models/User");
const Setting = require("../models/Setting");
const coins = require("./coins");
const testMode = require("./test_mode");

/*
 * The accessory shop of the casino: frames around the avatar and animations
 * of it (like the profile decorations of Discord). Only the casino shows them.
 * Paid with the normal 🪙 - never with the coins of a season.
 *
 * A player: user.looks = {owned: [id], frame: id|null, effect: id|null}
 *
 * The admin (Casino, Shop): every item on or off and its price - and "free
 * for all" (for testing): everybody can wear every item that is on without
 * buying it. Turned off again, everything nobody bought comes off.
 * An item that is off: not in the shop, nobody wears it (who bought it keeps it).
 *
 * Exclusive items (exclusive: true) can't be bought - the admin gives them as rewards (give:
 * Players → Reward), together with coins or a prize of their own. What was given is kept for
 * good: user.looks.won = [{id, source, icon, rank, at}].
 */
const ITEMS = [
  // Frames: a ring around the avatar
  { id: "bronze", kind: "frame", name: "Bronze Ring", price: 50000, rarity: "common" },
  { id: "silver", kind: "frame", name: "Silver Ring", price: 75000, rarity: "common" },
  { id: "gold", kind: "frame", name: "Gold Ring", price: 100000, rarity: "common" },
  { id: "ruby", kind: "frame", name: "Ruby", price: 125000, rarity: "common" },
  { id: "emerald", kind: "frame", name: "Emerald", price: 150000, rarity: "common" },
  { id: "sakura", kind: "frame", name: "Sakura", price: 200000, rarity: "rare" },
  { id: "neon", kind: "frame", name: "Neon", price: 250000, rarity: "rare" },
  { id: "shadow", kind: "frame", name: "Shadow", price: 300000, rarity: "rare" },
  { id: "retro", kind: "frame", name: "Retro", price: 350000, rarity: "rare" },
  { id: "ice", kind: "frame", name: "Frost", price: 400000, rarity: "rare" },
  { id: "candy", kind: "frame", name: "Candy Swirl", price: 450000, rarity: "rare" },
  { id: "electric", kind: "frame", name: "Electric", price: 550000, rarity: "epic" },
  { id: "fire", kind: "frame", name: "Inferno", price: 750000, rarity: "epic" },
  { id: "ocean", kind: "frame", name: "Ocean", price: 750000, rarity: "epic" },
  { id: "toxic", kind: "frame", name: "Toxic", price: 750000, rarity: "epic" },
  { id: "rainbow", kind: "frame", name: "Rainbow", price: 1000000, rarity: "epic" },
  { id: "devil", kind: "frame", name: "Devil", price: 1300000, rarity: "epic" },
  { id: "galaxy", kind: "frame", name: "Galaxy", price: 1500000, rarity: "legendary" },
  { id: "royal", kind: "frame", name: "Royal", price: 2000000, rarity: "legendary" },
  { id: "diamond", kind: "frame", name: "Diamond", price: 2500000, rarity: "legendary" },
  { id: "aurora", kind: "frame", name: "Aurora", price: 3000000, rarity: "legendary" },
  { id: "phoenix", kind: "frame", name: "Phoenix", price: 4000000, rarity: "legendary" },
  // Animations
  { id: "shake", kind: "effect", name: "Shake", price: 150000, rarity: "common" },
  { id: "zzz", kind: "effect", name: "Sleepy", price: 250000, rarity: "common" },
  { id: "float", kind: "effect", name: "Float", price: 300000, rarity: "common" },
  { id: "bounce", kind: "effect", name: "Bounce", price: 300000, rarity: "common" },
  { id: "wobble", kind: "effect", name: "Wobble", price: 350000, rarity: "common" },
  { id: "music", kind: "effect", name: "Music", price: 500000, rarity: "rare" },
  { id: "bubbles", kind: "effect", name: "Bubbles", price: 600000, rarity: "rare" },
  { id: "sparkles", kind: "effect", name: "Sparkles", price: 700000, rarity: "rare" },
  { id: "pulse", kind: "effect", name: "Pulse", price: 750000, rarity: "rare" },
  { id: "hearts", kind: "effect", name: "Hearts", price: 800000, rarity: "rare" },
  { id: "snow", kind: "effect", name: "Snowfall", price: 900000, rarity: "rare" },
  { id: "dizzy", kind: "effect", name: "Dizzy", price: 900000, rarity: "rare" },
  { id: "flames", kind: "effect", name: "Flames", price: 960000, rarity: "rare" },
  { id: "lightning", kind: "effect", name: "Lightning", price: 1100000, rarity: "epic" },
  { id: "confetti", kind: "effect", name: "Confetti", price: 1200000, rarity: "epic" },
  { id: "money", kind: "effect", name: "Money Rain", price: 1300000, rarity: "epic" },
  { id: "fireworks", kind: "effect", name: "Fireworks", price: 1800000, rarity: "epic" },
  { id: "orbit", kind: "effect", name: "Orbit", price: 2000000, rarity: "epic" },
  { id: "glitch", kind: "effect", name: "Glitch", price: 2400000, rarity: "epic" },
  { id: "halo", kind: "effect", name: "Halo", price: 3200000, rarity: "legendary" },
  { id: "aura", kind: "effect", name: "Aura", price: 5000000, rarity: "legendary" },
  { id: "vortex", kind: "effect", name: "Vortex", price: 7000000, rarity: "legendary" },
  // Exclusive (by default): only given as rewards - never sold. The price counts when the admin moves one into the shop.
  { id: "champion", kind: "frame", name: "Champion's Laurel", price: 5000000, rarity: "exclusive" },
  { id: "runnerup", kind: "frame", name: "Silver Laurel", price: 3500000, rarity: "exclusive" },
  { id: "podium", kind: "frame", name: "Bronze Laurel", price: 2500000, rarity: "exclusive" },
  { id: "contender", kind: "frame", name: "Contender", price: 1500000, rarity: "exclusive" },
  { id: "pumpkin", kind: "frame", name: "Pumpkin Patch", price: 1200000, rarity: "exclusive" },
  { id: "candycane", kind: "frame", name: "Candy Cane", price: 1200000, rarity: "exclusive" },
  { id: "lunar", kind: "frame", name: "Lunar Dragon", price: 2000000, rarity: "exclusive" },
  { id: "pixel", kind: "frame", name: "Pixel Hero", price: 900000, rarity: "exclusive" },
  { id: "vapor", kind: "frame", name: "Vaporwave", price: 1000000, rarity: "exclusive" },
  { id: "crowned", kind: "effect", name: "Victory Crown", price: 5000000, rarity: "exclusive" },
  { id: "spotlight", kind: "effect", name: "Spotlight", price: 3000000, rarity: "exclusive" },
  { id: "starfall", kind: "effect", name: "Starfall", price: 2000000, rarity: "exclusive" },
  { id: "bats", kind: "effect", name: "Bat Swarm", price: 1200000, rarity: "exclusive" },
  { id: "jingle", kind: "effect", name: "Jingle Bells", price: 1200000, rarity: "exclusive" },
  { id: "lanterns", kind: "effect", name: "Sky Lanterns", price: 1800000, rarity: "exclusive" },
  { id: "disco", kind: "effect", name: "Disco Lights", price: 1500000, rarity: "exclusive" },
  { id: "butterflies", kind: "effect", name: "Butterflies", price: 1000000, rarity: "exclusive" },
];
const MAX_REWARD_COINS = 100000000;
const MAX_REWARD_RULES = 20;
const KINDS = ["frame", "effect"];
// The categories: the shop's rarities (sold) - and exclusive (never sold, only given). The admin can move any item.
const RARITIES = ["common", "rare", "epic", "legendary", "exclusive"];
const KEY = "shop";

// What the admin set: {items: {id: {on, price}}, free}
let setup = { items: {}, free: false };

const byId = (id) => ITEMS.find((item) => item.id === id) || null;

// An item as it is now (the admin's price, category, on or off)
function itemNow(item) {
  const own = setup.items[item.id] || {};
  const rarity = RARITIES.includes(own.rarity) ? own.rarity : item.rarity;
  return { ...item, defaultPrice: item.price, defaultRarity: item.rarity, price: Number.isInteger(own.price) ? own.price : item.price, rarity: rarity, exclusive: rarity === "exclusive", on: own.on !== false };
}

// The order everywhere (the shop, the admin): by rarity, then by price, then by name
function sorted(list) {
  return list.slice().sort((a, b) => RARITIES.indexOf(a.rarity) - RARITIES.indexOf(b.rarity) || a.price - b.price || a.name.localeCompare(b.name));
}

function items() {
  return sorted(ITEMS.map(itemNow));
}

// What is given at once: items (any - one frame and one animation at most), coins and / or a prize of your own
// (a text: a voucher, a dinner - the admin hands it over) -> {items, coins, prize} or {error}
function checkGift(input, what) {
  const ids = Array.isArray(input && input.items) ? [...new Set(input.items.filter(Boolean))] : [];
  if (!ids.every((id) => byId(id))) return { error: `${what}: unknown item.` };
  if (KINDS.some((kind) => ids.filter((id) => byId(id).kind === kind).length > 1)) return { error: `${what}: one frame and one animation at most.` };
  const coins = input && input.coins != null && input.coins !== "" ? Number(input.coins) : 0;
  if (!Number.isInteger(coins) || coins < 0 || coins > MAX_REWARD_COINS) return { error: `${what}: coins from 0 to ${MAX_REWARD_COINS.toLocaleString("en-US")}.` };
  const prize = typeof (input && input.prize) === "string" ? input.prize.trim() : "";
  if (prize.length > 80) return { error: `${what}: the prize - up to 80 characters.` };
  if (!ids.length && coins === 0 && !prize) return { error: `${what}: pick an item, coins or a prize.` };
  return { items: ids, coins: coins, prize: prize };
}

const isOn = (id) => byId(id) != null && itemNow(byId(id)).on;

function looksOf(user) {
  const looks = (user && user.looks) || {};
  const won = Array.isArray(looks.won) ? looks.won.filter((entry) => entry && byId(entry.id)) : [];
  const owned = [...new Set([...(Array.isArray(looks.owned) ? looks.owned.filter((id) => byId(id)) : []), ...won.map((entry) => entry.id)])];
  // What can be worn: what is bought - or (free for all) everything - as long as it is on
  const wearable = (id) => isOn(id) && (setup.free || owned.includes(id));
  const worn = (kind) => (looks[kind] && byId(looks[kind]) && byId(looks[kind]).kind === kind && wearable(looks[kind]) ? looks[kind] : null);
  return { owned: owned, won: won, frame: worn("frame"), effect: worn("effect") };
}

// The coins the shop takes: outside a season the balance, in a season the one from before it
async function balanceOf(username) {
  const data = await coins.get(username);
  return data.coins;
}

// The items of the shop (on)
function shopItems() {
  return items().filter((item) => item.on);
}

// The shop of a player: the items that are on, what they have and wear, what they can pay with
async function view(username) {
  // Test mode: every item that is on, worn only in the sandbox (nothing saved)
  if (testMode.active(username)) {
    const worn = testMode.looks(username);
    const wearable = (id) => (id && isOn(id) ? id : null);
    return { items: shopItems(), owned: [], won: [], frame: wearable(worn.frame), effect: wearable(worn.effect), free: true, test: true, balance: testMode.balance(username), season: false };
  }
  const user = await User.findOne({ username: username }).lean();
  return { items: shopItems(), ...looksOf(user), free: setup.free, balance: await balanceOf(username), season: false };
}

async function buy(username, id) {
  const item = byId(id) && itemNow(byId(id));
  if (item == null || !item.on) return { error: "This item doesn't exist." };
  if (item.exclusive) return { error: "Exclusive items can't be bought - they are only given as rewards." };
  if (setup.free || testMode.active(username)) return { error: "Everything is free right now - just wear it." };
  const user = await User.findOne({ username: username }).lean();
  const looks = looksOf(user);
  if (looks.owned.includes(id)) return { error: "You have it already." };
  // (always the normal 🪙 - the season's coins stay in the season world)
  const paid = await coins.spend(username, item.price, { reason: "shop", note: item.name });
  if (!paid) return { error: "You don't have enough coins." };
  // Bought: worn right away (instead of the one of its kind) - (the stored list: only what was bought)
  const stored = (user && user.looks) || {};
  const next = { ...stored, owned: [...(Array.isArray(stored.owned) ? stored.owned : []), id], frame: looks.frame, effect: looks.effect, [item.kind]: id };
  await User.updateOne({ username: username }, { $set: { looks: next } });
  coins.notify(username);
  return { ...(await view(username)), bought: id };
}

// Wear an item (or nothing of its kind: id null)
async function wear(username, kind, id) {
  if (!KINDS.includes(kind)) return { error: "Unknown kind." };
  if (testMode.active(username)) {
    if (id != null && (!byId(id) || byId(id).kind !== kind || !isOn(id))) return { error: "You don't have this item." };
    testMode.wear(username, kind, id);
    return view(username);
  }
  const user = await User.findOne({ username: username }).lean();
  const looks = looksOf(user);
  if (id != null) {
    const item = byId(id);
    if (item == null || item.kind !== kind || !isOn(id) || !(setup.free || looks.owned.includes(id))) return { error: "You don't have this item." };
  }
  await User.updateOne({ username: username }, { $set: { looks: { ...((user && user.looks) || {}), frame: looks.frame, effect: looks.effect, [kind]: id } } });
  return view(username);
}

// What some players wear (for the avatars of a page): {name: {frame, effect}} - only who wears something
async function worn(names) {
  const users = await User.find({ username: { $in: names } }).select("username looks").lean();
  const result = {};
  for (const user of users) {
    // (a tester: what they wear in the sandbox)
    const test = testMode.active(user.username) ? testMode.looks(user.username) : null;
    const looks = test ? { frame: test.frame && isOn(test.frame) ? test.frame : null, effect: test.effect && isOn(test.effect) ? test.effect : null } : looksOf(user);
    if (looks.frame || looks.effect) result[user.username] = { frame: looks.frame, effect: looks.effect };
  }
  return result;
}

/*
 * A reward for a player: items (kept for good, with where they came from) and / or coins (the normal 🪙).
 * from: {source (e.g. the season's name), icon, rank (a season's place - or null), note}. The player
 * hears of it (game/notices.js, a popup - kept for later when the casino isn't open). -> false: no such player
 */
async function reward(username, gift, from) {
  const user = await User.findOne({ username: username }).select("username looks").lean();
  if (user == null) return false;
  const at = Date.now();
  if (gift.items.length) {
    const stored = user.looks || {};
    const won = [...(Array.isArray(stored.won) ? stored.won : []), ...gift.items.map((id) => ({ id: id, source: from.source, icon: from.icon || null, rank: from.rank || null, at: at }))];
    await User.updateOne({ username: username }, { $set: { looks: { ...stored, owned: Array.isArray(stored.owned) ? stored.owned : [], won: won } } });
  }
  const where = [from.source, from.rank ? "#" + from.rank : null, from.note].filter(Boolean).join(" · ");
  if (gift.coins > 0) await coins.add(username, gift.coins, { reason: from.rank ? "season reward" : "reward", note: where });
  // A prize of your own: in the coin history (0 coins) - so the admin sees whom to hand it to
  const prizes = gift.prizes || (gift.prize ? [gift.prize] : []);
  for (const prize of prizes) coins.log(username, 0, "prize", (prize + " · " + where).slice(0, 300));
  require("./notices").send(username, "reward", {
    source: from.source,
    icon: from.icon || null,
    rank: from.rank || null,
    note: from.note || null,
    coins: gift.coins,
    prizes: prizes,
    items: gift.items.map((id) => ({ id: id, kind: byId(id).kind, name: byId(id).name })),
  });
  return true;
}

// The admin gives a player something: {username, items, coins, note} -> {given} or {error}
async function give(input) {
  const username = typeof (input && input.username) === "string" ? input.username.trim() : "";
  if (!username) return { error: "Pick a player." };
  const gift = checkGift(input, "The reward");
  if (gift.error) return gift;
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 80) : "";
  const user = await User.findOne({ username: username }).select("username casinoApproved").lean();
  if (user == null) return { error: "No such player." };
  await reward(user.username, gift, { source: note || "A reward", icon: "🎁", rank: null, note: null });
  return { given: { username: user.username, ...gift, note: note } };
}

/*
 * The items of a player for the admin: [{id, name, kind, rarity, given, source, icon, rank, at, worn}] - bought
 * (given: false; at: from the coin history, see the admin route) and given (with where from). An item both bought
 * and given shows once (as given).
 */
function itemsOf(user) {
  const looks = looksOf(user);
  const stored = (user && user.looks) || {};
  const given = new Map(looks.won.map((entry) => [entry.id, entry]));
  const bought = (Array.isArray(stored.owned) ? stored.owned : []).filter((id) => byId(id) && !given.has(id));
  const row = (id, entry) => {
    const item = itemNow(byId(id));
    return { id: id, name: item.name, kind: item.kind, rarity: item.rarity, given: entry != null, source: entry ? entry.source || null : null, icon: entry ? entry.icon || null : null, rank: entry ? entry.rank || null : null, at: entry ? entry.at || null : null, worn: looks[item.kind] === id };
  };
  return sorted([...[...new Set(bought)].map((id) => row(id)), ...[...given.values()].map((entry) => row(entry.id, entry))]);
}

// The admin takes an item away (bought or given - no coins back): worn, it comes off -> {items} or {error}
async function removeItem(username, id) {
  if (byId(id) == null) return { error: "Unknown item." };
  const user = await User.findOne({ username: username }).select("username looks").lean();
  if (user == null) return { error: "No such player." };
  const stored = (user && user.looks) || {};
  const owned = Array.isArray(stored.owned) ? stored.owned : [];
  const won = Array.isArray(stored.won) ? stored.won : [];
  if (!owned.includes(id) && !won.some((entry) => entry && entry.id === id)) return { error: "The player doesn't have this item." };
  const next = { ...stored, owned: owned.filter((own) => own !== id), won: won.filter((entry) => entry && entry.id !== id) };
  if (next[byId(id).kind] === id) next[byId(id).kind] = null;
  await User.updateOne({ username: user.username }, { $set: { looks: next } });
  return { items: itemsOf({ ...user, looks: next }) };
}

/* ---------- The admin ---------- */

function config() {
  return { items: items(), free: setup.free };
}

// {items: {id: {on, price}}, free} - only what changes. Free for all off again: what nobody bought comes off
async function update(input) {
  const body = input || {};
  const next = { items: { ...setup.items }, free: setup.free };
  for (const [id, change] of Object.entries(body.items || {})) {
    if (!byId(id) || change == null || typeof change !== "object") return { error: "Unknown item." };
    const own = { ...(next.items[id] || {}) };
    if ("on" in change) own.on = change.on !== false;
    if ("rarity" in change) {
      if (!RARITIES.includes(change.rarity)) return { error: `${byId(id).name}: an unknown category.` };
      own.rarity = change.rarity;
    }
    if ("price" in change) {
      const price = Number(change.price);
      if (!Number.isInteger(price) || price < 0 || price > 1000000000) return { error: `${byId(id).name}: a price from 0 to 1,000,000,000.` };
      own.price = price;
    }
    next.items[id] = own;
  }
  if ("free" in body) next.free = body.free === true;
  const freeEnds = setup.free && !next.free;
  setup = next;
  await Setting.updateOne({ key: KEY }, { $set: { value: JSON.stringify(setup) } }, { upsert: true });
  if (freeEnds) await takeOffUnbought();
  return config();
}

// Everybody wears only what they bought (and what is on) - for real, in the database
async function takeOffUnbought() {
  const users = await User.find({ looks: { $ne: null } }).select("username looks").lean();
  await Promise.all(
    users.map((user) => {
      const looks = looksOf(user);
      const stored = user.looks || {};
      if (stored.frame === looks.frame && stored.effect === looks.effect) return null;
      return User.updateOne({ username: user.username }, { $set: { looks: { ...stored, frame: looks.frame, effect: looks.effect } } });
    }),
  );
}

async function load() {
  const row = await Setting.findOne({ key: KEY }).lean();
  try {
    const saved = row && typeof row.value === "string" ? JSON.parse(row.value) : null;
    setup = { items: (saved && saved.items) || {}, free: Boolean(saved && saved.free) };
  } catch (error) {
    setup = { items: {}, free: false };
  }
}

// (tests, the hard reset)
function reset() {
  setup = { items: {}, free: false };
}

module.exports = { ITEMS, KINDS, RARITIES, byId, items, looksOf, itemsOf, removeItem, view, buy, wear, worn, balanceOf, reward, give, config, update, load, reset };
