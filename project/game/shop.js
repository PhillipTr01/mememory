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
 * Season items (season: true) can't be bought: the best of a season win them when it ends
 * (seasonRewards: which places get which items - the admin sets it, Casino → Shop). Who won one
 * keeps it for good: user.looks.won = [{id, season, rank, at}].
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
  // Season rewards: only won - never sold
  { id: "champion", kind: "frame", name: "Champion's Laurel", price: 0, rarity: "season", season: true },
  { id: "runnerup", kind: "frame", name: "Silver Laurel", price: 0, rarity: "season", season: true },
  { id: "podium", kind: "frame", name: "Bronze Laurel", price: 0, rarity: "season", season: true },
  { id: "contender", kind: "frame", name: "Contender", price: 0, rarity: "season", season: true },
  { id: "crowned", kind: "effect", name: "Victory Crown", price: 0, rarity: "season", season: true },
  { id: "spotlight", kind: "effect", name: "Spotlight", price: 0, rarity: "season", season: true },
  { id: "starfall", kind: "effect", name: "Starfall", price: 0, rarity: "season", season: true },
];
// Who wins what at the end of a season (places from - to): the admin can change it
const SEASON_REWARDS = [
  { from: 1, to: 1, items: ["champion", "crowned"] },
  { from: 2, to: 2, items: ["runnerup", "spotlight"] },
  { from: 3, to: 3, items: ["podium", "spotlight"] },
  { from: 4, to: 10, items: ["contender", "starfall"] },
];
const MAX_REWARD_RULES = 20;
const KINDS = ["frame", "effect"];
const KEY = "shop";

// What the admin set: {items: {id: {on, price}}, free, seasonRewards}
let setup = { items: {}, free: false, seasonRewards: null };

const byId = (id) => ITEMS.find((item) => item.id === id) || null;

// An item as it is now (the admin's price, on or off)
function itemNow(item) {
  const own = setup.items[item.id] || {};
  return { ...item, defaultPrice: item.price, price: Number.isInteger(own.price) ? own.price : item.price, on: own.on !== false };
}

function items() {
  return ITEMS.map(itemNow);
}

// The rules of the season rewards now (null: the default ones)
function seasonRewards() {
  return (setup.seasonRewards || SEASON_REWARDS).map((rule) => ({ from: rule.from, to: rule.to, items: rule.items.slice() }));
}

// The items a place of a season wins (the rules that cover it, together - every item once)
function rewardsFor(rank) {
  if (!Number.isInteger(rank) || rank < 1) return [];
  const ids = seasonRewards()
    .filter((rule) => rank >= rule.from && rank <= rule.to)
    .flatMap((rule) => rule.items);
  return [...new Set(ids)].filter((id) => byId(id) && byId(id).season);
}

// How to win a season item (for the shop): "1st place", "Places 4-10", ... - null: no place wins it now
function howToWin(id) {
  const places = seasonRewards().filter((rule) => rule.items.includes(id));
  if (!places.length) return null;
  const ordinal = (n) => n + (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th");
  return places.map((rule) => (rule.from === rule.to ? ordinal(rule.from) + " place" : `Places ${rule.from}-${rule.to}`)).join(", ");
}

// {seasonRewards: [{from, to, items}]} -> the rules or {error}
function checkRewards(input) {
  if (!Array.isArray(input) || input.length > MAX_REWARD_RULES) return { error: `At most ${MAX_REWARD_RULES} rules.` };
  const rules = [];
  for (const rule of input) {
    const from = Number(rule && rule.from);
    const to = Number(rule && rule.to);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > 1000) return { error: "A rule needs places from 1 to 1,000 (from not after to)." };
    const ids = Array.isArray(rule.items) ? [...new Set(rule.items)] : [];
    if (!ids.length || !ids.every((id) => byId(id) && byId(id).season)) return { error: `Places ${from}-${to}: pick at least one season item.` };
    if (KINDS.some((kind) => ids.filter((id) => byId(id).kind === kind).length > 1)) return { error: `Places ${from}-${to}: one frame and one animation at most.` };
    rules.push({ from: from, to: to, items: ids });
  }
  return { rules: rules.sort((a, b) => a.from - b.from) };
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

// The items of the shop (on) - a season item with how to win it
function shopItems() {
  return items()
    .filter((item) => item.on)
    .map((item) => (item.season ? { ...item, howToWin: howToWin(item.id) } : item));
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
  if (item.season) return { error: "Season items can't be bought - win them in a season." };
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
 * A season is over: its best win their items (rows: the final places, {rank, username} - rank null:
 * not placed). The items are kept for good; the winners hear of it (game/notices.js, the inbox).
 * -> [{username, rank, items: [id]}]
 */
async function awardSeason(season, rows) {
  const given = [];
  for (const row of rows || []) {
    const ids = rewardsFor(row.rank);
    if (!ids.length) continue;
    const user = await User.findOne({ username: row.username }).select("username looks").lean();
    if (user == null) continue;
    const stored = user.looks || {};
    const won = [...(Array.isArray(stored.won) ? stored.won : []), ...ids.map((id) => ({ id: id, season: season.name, icon: season.icon || null, rank: row.rank, at: Date.now() }))];
    await User.updateOne({ username: row.username }, { $set: { looks: { ...stored, owned: Array.isArray(stored.owned) ? stored.owned : [], won: won } } });
    given.push({ username: row.username, rank: row.rank, items: ids });
    require("./notices").send(row.username, "seasonReward", { season: season.name, icon: season.icon || null, rank: row.rank, items: ids.map((id) => ({ id: id, kind: byId(id).kind, name: byId(id).name })) });
  }
  return given;
}

/* ---------- The admin ---------- */

function config() {
  return { items: items(), free: setup.free, seasonRewards: seasonRewards(), seasonDefaults: SEASON_REWARDS };
}

// {items: {id: {on, price}}, free} - only what changes. Free for all off again: what nobody bought comes off
async function update(input) {
  const body = input || {};
  const next = { items: { ...setup.items }, free: setup.free, seasonRewards: setup.seasonRewards };
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
  if ("seasonRewards" in body) {
    if (body.seasonRewards == null) next.seasonRewards = null;
    else {
      const checked = checkRewards(body.seasonRewards);
      if (checked.error) return { error: checked.error };
      next.seasonRewards = checked.rules;
    }
  }
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
    const rules = saved && saved.seasonRewards ? checkRewards(saved.seasonRewards) : null;
    setup = { items: (saved && saved.items) || {}, free: Boolean(saved && saved.free), seasonRewards: rules && rules.rules ? rules.rules : null };
  } catch (error) {
    setup = { items: {}, free: false, seasonRewards: null };
  }
}

// (tests, the hard reset)
function reset() {
  setup = { items: {}, free: false, seasonRewards: null };
}

module.exports = { ITEMS, KINDS, SEASON_REWARDS, byId, items, looksOf, view, buy, wear, worn, balanceOf, seasonRewards, rewardsFor, howToWin, awardSeason, config, update, load, reset };
