const User = require("../models/User");
const Setting = require("../models/Setting");
const coins = require("./coins");
const seasons = require("./seasons");

/*
 * The accessory shop of the casino: frames around the avatar and animations
 * of it (like the profile decorations of Discord). Only the casino shows them.
 * Paid with the balance outside a season - in a season with the balance from
 * before it (the one that comes back after the season), never with the
 * coins of the season.
 *
 * A player: user.looks = {owned: [id], frame: id|null, effect: id|null}
 *
 * The admin (Casino, Shop): every item on or off and its price - and "free
 * for all" (for testing): everybody can wear every item that is on without
 * buying it. Turned off again, everything nobody bought comes off.
 * An item that is off: not in the shop, nobody wears it (who bought it keeps it).
 */
const ITEMS = [
  // Frames: a ring around the avatar
  { id: "silver", kind: "frame", name: "Silver Ring", price: 7500, rarity: "common" },
  { id: "gold", kind: "frame", name: "Gold Ring", price: 10000, rarity: "common" },
  { id: "emerald", kind: "frame", name: "Emerald", price: 15000, rarity: "common" },
  { id: "sakura", kind: "frame", name: "Sakura", price: 20000, rarity: "rare" },
  { id: "neon", kind: "frame", name: "Neon", price: 25000, rarity: "rare" },
  { id: "ice", kind: "frame", name: "Frost", price: 40000, rarity: "rare" },
  { id: "electric", kind: "frame", name: "Electric", price: 50000, rarity: "epic" },
  { id: "fire", kind: "frame", name: "Inferno", price: 60000, rarity: "epic" },
  { id: "candy", kind: "frame", name: "Candy Swirl", price: 70000, rarity: "epic" },
  { id: "rainbow", kind: "frame", name: "Rainbow", price: 100000, rarity: "epic" },
  { id: "galaxy", kind: "frame", name: "Galaxy", price: 150000, rarity: "legendary" },
  { id: "royal", kind: "frame", name: "Royal", price: 200000, rarity: "legendary" },
  // Animations: the avatar moves, glows or gets company
  { id: "pulse", kind: "effect", name: "Pulse", price: 10000, rarity: "common" },
  { id: "float", kind: "effect", name: "Float", price: 15000, rarity: "common" },
  { id: "bounce", kind: "effect", name: "Bounce", price: 15000, rarity: "common" },
  { id: "wobble", kind: "effect", name: "Wobble", price: 20000, rarity: "rare" },
  { id: "sparkles", kind: "effect", name: "Sparkles", price: 35000, rarity: "rare" },
  { id: "hearts", kind: "effect", name: "Hearts", price: 40000, rarity: "rare" },
  { id: "snow", kind: "effect", name: "Snowfall", price: 45000, rarity: "rare" },
  { id: "orbit", kind: "effect", name: "Orbit", price: 50000, rarity: "epic" },
  { id: "glitch", kind: "effect", name: "Glitch", price: 60000, rarity: "epic" },
  { id: "flames", kind: "effect", name: "Flames", price: 75000, rarity: "epic" },
  { id: "money", kind: "effect", name: "Money Rain", price: 100000, rarity: "legendary" },
  { id: "halo", kind: "effect", name: "Halo", price: 120000, rarity: "legendary" },
];
const KINDS = ["frame", "effect"];
const KEY = "shop";

// What the admin set: {items: {id: {on, price}}, free}
let setup = { items: {}, free: false };

const byId = (id) => ITEMS.find((item) => item.id === id) || null;

// An item as it is now (the admin's price, on or off)
function itemNow(item) {
  const own = setup.items[item.id] || {};
  return { ...item, defaultPrice: item.price, price: Number.isInteger(own.price) ? own.price : item.price, on: own.on !== false };
}

function items() {
  return ITEMS.map(itemNow);
}

const isOn = (id) => byId(id) != null && itemNow(byId(id)).on;

function looksOf(user) {
  const looks = (user && user.looks) || {};
  const owned = Array.isArray(looks.owned) ? looks.owned.filter((id) => byId(id)) : [];
  // What can be worn: what is bought - or (free for all) everything - as long as it is on
  const wearable = (id) => isOn(id) && (setup.free || owned.includes(id));
  const worn = (kind) => (looks[kind] && byId(looks[kind]) && byId(looks[kind]).kind === kind && wearable(looks[kind]) ? looks[kind] : null);
  return { owned: owned, frame: worn("frame"), effect: worn("effect") };
}

// The coins the shop takes: outside a season the balance, in a season the one from before it
async function balanceOf(username) {
  if (seasons.running()) return seasons.storedOf(username) || 0;
  const data = await coins.get(username);
  return data.coins;
}

// The shop of a player: the items that are on, what they have and wear, what they can pay with
async function view(username) {
  const user = await User.findOne({ username: username }).lean();
  return { items: items().filter((item) => item.on), ...looksOf(user), free: setup.free, balance: await balanceOf(username), season: seasons.running() != null };
}

async function buy(username, id) {
  const item = byId(id) && itemNow(byId(id));
  if (item == null || !item.on) return { error: "This item doesn't exist." };
  if (setup.free) return { error: "Everything is free right now - just wear it." };
  const user = await User.findOne({ username: username }).lean();
  const looks = looksOf(user);
  if (looks.owned.includes(id)) return { error: "You have it already." };
  const paid = seasons.running() ? await seasons.spendSaved(username, item.price) : await coins.spend(username, item.price, { reason: "shop", note: item.name });
  if (!paid) return { error: seasons.running() ? "Not enough coins from before the season." : "You don't have enough coins." };
  // Bought: worn right away (instead of the one of its kind)
  const next = { ...looks, owned: [...looks.owned, id], [item.kind]: id };
  await User.updateOne({ username: username }, { $set: { looks: next } });
  coins.notify(username);
  return { ...(await view(username)), bought: id };
}

// Wear an item (or nothing of its kind: id null)
async function wear(username, kind, id) {
  if (!KINDS.includes(kind)) return { error: "Unknown kind." };
  const user = await User.findOne({ username: username }).lean();
  const looks = looksOf(user);
  if (id != null) {
    const item = byId(id);
    if (item == null || item.kind !== kind || !isOn(id) || !(setup.free || looks.owned.includes(id))) return { error: "You don't have this item." };
  }
  await User.updateOne({ username: username }, { $set: { looks: { ...looks, [kind]: id } } });
  return view(username);
}

// What some players wear (for the avatars of a page): {name: {frame, effect}} - only who wears something
async function worn(names) {
  const users = await User.find({ username: { $in: names } }).select("username looks").lean();
  const result = {};
  for (const user of users) {
    const looks = looksOf(user);
    if (looks.frame || looks.effect) result[user.username] = { frame: looks.frame, effect: looks.effect };
  }
  return result;
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
      return User.updateOne({ username: user.username }, { $set: { looks: looks } });
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

module.exports = { ITEMS, KINDS, byId, items, looksOf, view, buy, wear, worn, balanceOf, config, update, load, reset };
