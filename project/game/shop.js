const User = require("../models/User");
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
 */
const ITEMS = [
  // Frames: a ring around the avatar
  { id: "gold", kind: "frame", name: "Gold Ring", price: 10000, rarity: "common" },
  { id: "silver", kind: "frame", name: "Silver Ring", price: 7500, rarity: "common" },
  { id: "neon", kind: "frame", name: "Neon", price: 25000, rarity: "rare" },
  { id: "ice", kind: "frame", name: "Frost", price: 40000, rarity: "rare" },
  { id: "fire", kind: "frame", name: "Inferno", price: 60000, rarity: "epic" },
  { id: "rainbow", kind: "frame", name: "Rainbow", price: 100000, rarity: "epic" },
  { id: "royal", kind: "frame", name: "Royal", price: 200000, rarity: "legendary" },
  // Animations: the avatar moves, glows or gets company
  { id: "pulse", kind: "effect", name: "Pulse", price: 10000, rarity: "common" },
  { id: "float", kind: "effect", name: "Float", price: 15000, rarity: "common" },
  { id: "sparkles", kind: "effect", name: "Sparkles", price: 35000, rarity: "rare" },
  { id: "orbit", kind: "effect", name: "Orbit", price: 50000, rarity: "epic" },
  { id: "flames", kind: "effect", name: "Flames", price: 75000, rarity: "epic" },
  { id: "halo", kind: "effect", name: "Halo", price: 120000, rarity: "legendary" },
];
const KINDS = ["frame", "effect"];

const byId = (id) => ITEMS.find((item) => item.id === id) || null;

function looksOf(user) {
  const looks = (user && user.looks) || {};
  const owned = Array.isArray(looks.owned) ? looks.owned.filter((id) => byId(id)) : [];
  const worn = (kind) => (looks[kind] && owned.includes(looks[kind]) && byId(looks[kind]).kind === kind ? looks[kind] : null);
  return { owned: owned, frame: worn("frame"), effect: worn("effect") };
}

// The coins the shop takes: outside a season the balance, in a season the one from before it
async function balanceOf(username) {
  if (seasons.running()) return seasons.storedOf(username) || 0;
  const data = await coins.get(username);
  return data.coins;
}

// The shop of a player: the items, what they have and wear, what they can pay with
async function view(username) {
  const user = await User.findOne({ username: username }).lean();
  return { items: ITEMS, ...looksOf(user), balance: await balanceOf(username), season: seasons.running() != null };
}

async function buy(username, id) {
  const item = byId(id);
  if (item == null) return { error: "This item doesn't exist." };
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
    if (item == null || item.kind !== kind || !looks.owned.includes(id)) return { error: "You don't have this item." };
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

module.exports = { ITEMS, KINDS, byId, looksOf, view, buy, wear, worn, balanceOf };
