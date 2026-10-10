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
 * Exclusive items (exclusive: true) can't be bought - they are only given: to the places of a
 * season when it ends (seasonRewards: which places get which items and coins - any item, the
 * admin sets it, Casino → Shop) or by the admin to anybody (give). What was given is kept for
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
  // Exclusive: only given (a season's places, the admin) - never sold
  { id: "champion", kind: "frame", name: "Champion's Laurel", price: 0, rarity: "exclusive", exclusive: true },
  { id: "runnerup", kind: "frame", name: "Silver Laurel", price: 0, rarity: "exclusive", exclusive: true },
  { id: "podium", kind: "frame", name: "Bronze Laurel", price: 0, rarity: "exclusive", exclusive: true },
  { id: "contender", kind: "frame", name: "Contender", price: 0, rarity: "exclusive", exclusive: true },
  { id: "crowned", kind: "effect", name: "Victory Crown", price: 0, rarity: "exclusive", exclusive: true },
  { id: "spotlight", kind: "effect", name: "Spotlight", price: 0, rarity: "exclusive", exclusive: true },
  { id: "starfall", kind: "effect", name: "Starfall", price: 0, rarity: "exclusive", exclusive: true },
];
// Who wins what at the end of a season (places from - to): any items, coins (the normal 🪙) - the admin can change it
const SEASON_REWARDS = [
  { from: 1, to: 1, items: ["champion", "crowned"], coins: 0 },
  { from: 2, to: 2, items: ["runnerup", "spotlight"], coins: 0 },
  { from: 3, to: 3, items: ["podium", "spotlight"], coins: 0 },
  { from: 4, to: 10, items: ["contender", "starfall"], coins: 0 },
];
const MAX_REWARD_COINS = 100000000;
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
  return (setup.seasonRewards || SEASON_REWARDS).map((rule) => ({ from: rule.from, to: rule.to, items: rule.items.slice(), coins: rule.coins || 0, prize: rule.prize || "" }));
}

// What a place of a season wins: the rules that cover it, together - {items: [id] (every item once), coins, prizes: [text]}
function rewardsFor(rank) {
  if (!Number.isInteger(rank) || rank < 1) return { items: [], coins: 0, prizes: [] };
  const rules = seasonRewards().filter((rule) => rank >= rule.from && rank <= rule.to);
  const ids = [...new Set(rules.flatMap((rule) => rule.items))].filter((id) => byId(id));
  return { items: ids, coins: rules.reduce((sum, rule) => sum + (rule.coins || 0), 0), prizes: rules.map((rule) => rule.prize).filter(Boolean) };
}

// How to get an exclusive item (for the shop): "1st place of a season", "Places 4-10 of a season" - null: only from the admin
function howToWin(id) {
  const places = seasonRewards().filter((rule) => rule.items.includes(id));
  if (!places.length) return null;
  const ordinal = (n) => n + (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th");
  return places.map((rule) => (rule.from === rule.to ? ordinal(rule.from) + " place" : `Places ${rule.from}-${rule.to}`)).join(", ") + " of a season";
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

// {seasonRewards: [{from, to, items, coins}]} -> the rules or {error}
function checkRewards(input) {
  if (!Array.isArray(input) || input.length > MAX_REWARD_RULES) return { error: `At most ${MAX_REWARD_RULES} rules.` };
  const rules = [];
  for (const rule of input) {
    const from = Number(rule && rule.from);
    const to = Number(rule && rule.to);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > 1000) return { error: "A rule needs places from 1 to 1,000 (from not after to)." };
    const gift = checkGift(rule, `Places ${from}-${to}`);
    if (gift.error) return gift;
    rules.push({ from: from, to: to, items: gift.items, coins: gift.coins, prize: gift.prize });
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

// The items of the shop (on) - an exclusive item with how to get it
function shopItems() {
  return items()
    .filter((item) => item.on)
    .map((item) => (item.exclusive ? { ...item, howToWin: howToWin(item.id) } : item));
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

/*
 * A season is over: its places win what the rules give them (rows: the final places, {rank, username} -
 * rank null: not placed). -> [{username, rank, items: [id], coins}]
 */
async function awardSeason(season, rows) {
  const given = [];
  for (const row of rows || []) {
    const gift = rewardsFor(row.rank);
    if (!gift.items.length && !gift.coins && !gift.prizes.length) continue;
    if (await reward(row.username, gift, { source: season.name, icon: season.icon || null, rank: row.rank })) given.push({ username: row.username, rank: row.rank, ...gift });
  }
  return given;
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

module.exports = { ITEMS, KINDS, SEASON_REWARDS, byId, items, looksOf, view, buy, wear, worn, balanceOf, seasonRewards, rewardsFor, howToWin, reward, awardSeason, give, config, update, load, reset };
