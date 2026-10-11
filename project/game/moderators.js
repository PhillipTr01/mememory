const EventEmitter = require("events");
const User = require("../models/User");
const Setting = require("../models/Setting");
const days = require("./days");

/*
 * Moderators: players the admin trusts with a few things on the casino pages (not the admin panel).
 * The admin turns a player into a moderator and picks what they may do (perms):
 * - rain: a money rain for everybody online - every one of them gets the amount (the moderator too, also
 *   with only moderators online; never in a season), at most `rainMax` per rain and `rainWeekly` a week (Monday to Sunday; 0: no limit)
 * - chat: delete messages of the casino chat, mute players for a while
 * - announce: a highlighted message in the casino chat (📣)
 * Everything a moderator does is written down (the log - the admin sees it).
 *
 * changes: "change" (username) - a player became / stopped being a moderator, or their perms changed
 */
const PERMS = ["rain", "chat", "announce"];
const PERM_NAMES = { rain: "Money rain", chat: "Chat moderation", announce: "Announcements" };
const SEASON = "No money rains in a season - only in the normal casino.";
const MUTE_MAX = 24 * 60; // a moderator mutes for at most a day (minutes)
const LOG_KEY = "modLog";
const LOG_SIZE = 300;
const DEFAULTS = { rainMax: 50000, rainWeekly: 250000, rainCooldown: 12 };
const COOLDOWN_MIN = 0; // hours between two money rains of the same moderator (0: no own wait)
const HOUR = 3600 * 1000;
// The wait between two money rains of moderators - for all of them together (one rains: everybody waits).
// The admin sets the hours (the money rain page); stored with when the last one fell and by whom.
const COOLDOWN_KEY = "modRainCooldown";
let cooldown = { hours: 12, lastAt: null, lastBy: null };
let cooldownLoaded = false;

async function loadCooldown() {
  if (cooldownLoaded) return cooldown;
  const row = await Setting.findOne({ key: COOLDOWN_KEY }).lean();
  try {
    if (row && typeof row.value === "string") cooldown = { ...cooldown, ...JSON.parse(row.value) };
  } catch (error) {
    // the default
  }
  cooldownLoaded = true;
  return cooldown;
}

async function saveCooldown() {
  await Setting.updateOne({ key: COOLDOWN_KEY }, { $set: { value: JSON.stringify(cooldown) } }, { upsert: true });
}

// {hours, lastAt, lastBy, nextAt} - nextAt: when the next money rain of a moderator may come (null: now)
async function rainCooldown(now = Date.now()) {
  await loadCooldown();
  const nextAt = cooldown.lastAt && cooldown.hours > 0 ? cooldown.lastAt + cooldown.hours * HOUR : null;
  return { hours: cooldown.hours, lastAt: cooldown.lastAt, lastBy: cooldown.lastBy, nextAt: nextAt && nextAt > now ? nextAt : null };
}

// The admin: the hours between two money rains of moderators (0: no wait)
async function setRainCooldown(hours) {
  const value = Number(hours);
  if (!Number.isInteger(value) || value < 0 || value > 24 * 30) return { error: "The wait: 0 to 720 hours." };
  await loadCooldown();
  cooldown.hours = value;
  await saveCooldown();
  return { cooldown: await rainCooldown() };
}

// Monday 00:00 of this week (the money rain limit counts from it)
function weekStart(now = Date.now()) {
  const day = days.dayStart(now);
  const weekday = (new Date(day).getDay() + 6) % 7; // Monday 0 ... Sunday 6
  return days.dayStart(day - weekday * 24 * 3600 * 1000 + 12 * 3600 * 1000);
}

const changes = new EventEmitter();
changes.setMaxListeners(0);

let log = [];
let logLoaded = false;
let modNames = new Set(); // who is a moderator (the chat marks them with 🛡️) - kept up to date by set / refresh

async function refresh() {
  try {
    const users = await User.find({ mod: { $ne: null } }).select("username mod").lean();
    modNames = new Set(users.filter((user) => modOf(user)).map((user) => user.username));
  } catch (error) {
    console.error("[mods] Could not load the moderators:", error);
  }
  return modNames;
}
const names = () => [...modNames].sort((a, b) => a.localeCompare(b));
const busy = new Set(); // a rain of a moderator in progress (two clicks)

async function loadLog() {
  if (logLoaded) return;
  const row = await Setting.findOne({ key: LOG_KEY }).lean();
  try {
    log = row && typeof row.value === "string" ? JSON.parse(row.value) : [];
  } catch (error) {
    log = [];
  }
  logLoaded = true;
}

async function write(by, action, detail) {
  await loadLog();
  log.unshift({ at: Date.now(), by: by, action: action, detail: detail || "" });
  log.length = Math.min(log.length, LOG_SIZE);
  await Setting.updateOne({ key: LOG_KEY }, { $set: { value: JSON.stringify(log) } }, { upsert: true });
}

const ownWait = (mod) => (Number.isInteger(mod.rainCooldown) && mod.rainCooldown >= 0 ? mod.rainCooldown : DEFAULTS.rainCooldown);

// What a moderator may do: {on, perms, rainMax, rainWeekly, used (this week)} - null: no moderator
function modOf(user) {
  const mod = user && user.mod;
  if (!mod || mod.on !== true) return null;
  return {
    on: true,
    perms: Object.fromEntries(PERMS.map((perm) => [perm, !!(mod.perms && mod.perms[perm])])),
    rainMax: Number.isInteger(mod.rainMax) ? mod.rainMax : DEFAULTS.rainMax,
    rainWeekly: Number.isInteger(mod.rainWeekly) ? mod.rainWeekly : DEFAULTS.rainWeekly,
    used: mod.used && mod.used.week === weekStart() ? mod.used.amount || 0 : 0,
    // Their own wait (hours) after their last money rain - besides the wait for all moderators (rainCooldown())
    rainCooldown: ownWait(mod),
    lastRain: mod.lastRain || null,
    nextRain: mod.lastRain && ownWait(mod) > 0 ? mod.lastRain + ownWait(mod) * HOUR : null,
  };
}

async function get(username) {
  const user = await User.findOne({ username: username }).select("username mod").lean();
  return modOf(user);
}

async function can(username, perm) {
  const mod = await get(username);
  return mod != null && mod.perms[perm] === true;
}

/* ---------- Admin ---------- */

// Every moderator (and who was one): [{username, ...mod}]
async function list() {
  const users = await User.find({ mod: { $ne: null } }).select("username mod").lean();
  return users.filter((user) => modOf(user)).map((user) => ({ username: user.username, ...modOf(user) })).sort((a, b) => a.username.localeCompare(b.username));
}

// The admin sets a player's moderator rights: {on, perms: {rain, chat, announce}, rainMax, rainWeekly}
async function set(username, input) {
  if (input == null || typeof input !== "object") return { error: "Nothing to set." };
  const user = await User.findOne({ username: username }).select("username mod casinoApproved").lean();
  if (user == null) return { error: "No such player." };
  const on = input.on === true;
  const rainMax = input.rainMax == null || input.rainMax === "" ? DEFAULTS.rainMax : Number(input.rainMax);
  const rainWeekly = input.rainWeekly == null || input.rainWeekly === "" ? DEFAULTS.rainWeekly : Number(input.rainWeekly);
  if (!Number.isInteger(rainMax) || rainMax < 1 || rainMax > 100000000) return { error: "Money rain at most: 1 to 100,000,000 coins." };
  if (!Number.isInteger(rainWeekly) || rainWeekly < 0 || rainWeekly > 1000000000) return { error: "Money rain a week: 0 (no limit) to 1,000,000,000 coins." };
  const rainCooldown = input.rainCooldown == null || input.rainCooldown === "" ? DEFAULTS.rainCooldown : Number(input.rainCooldown);
  if (!Number.isInteger(rainCooldown) || rainCooldown < COOLDOWN_MIN || rainCooldown > 24 * 365) return { error: "Their wait between money rains: 0 to 8,760 hours." };
  if (on && !user.casinoApproved) return { error: "Only a player with access to the casino can be a moderator." };
  const before = user.mod || {};
  const mod = {
    on: on,
    perms: Object.fromEntries(PERMS.map((perm) => [perm, !!(input.perms && input.perms[perm])])),
    rainMax: rainMax,
    rainWeekly: rainWeekly,
    rainCooldown: rainCooldown,
    lastRain: before.lastRain || null,
    used: before.used || null,
    since: on ? before.since || Date.now() : null,
  };
  await User.updateOne({ username: user.username }, { $set: { mod: mod } });
  if (modOf({ mod: mod })) modNames.add(user.username);
  else modNames.delete(user.username);
  changes.emit("change", user.username);
  return { mod: modOf({ mod: mod }) || { on: false } };
}

// The log for the admin: the last actions (of everybody - or of one moderator)
async function history(username) {
  await loadLog();
  return username ? log.filter((entry) => entry.by === username) : log.slice();
}

/* ---------- What a moderator does ---------- */

// A money rain: `amount` coins for every player online (the moderator too - also when only moderators
// are online). input: {amount, note} - in the world the moderator plays in
async function rain(username, input, world = "normal") {
  if (input == null || typeof input !== "object") return { error: "No money rain." };
  if (busy.has(username)) return { error: "One money rain at a time." };
  busy.add(username);
  try {
    const user = await User.findOne({ username: username }).select("username mod").lean();
    const mod = modOf(user);
    if (!mod || !mod.perms.rain) return { error: "You may not let it rain." };
    if (world === "season") return { error: SEASON };
    const amount = Number(input.amount);
    if (!Number.isInteger(amount) || amount < 1) return { error: "How many coins for every player?" };
    // (the limits count the amount once - however many players are online)
    // Their own wait - and the one for all moderators together (after anybody's money rain)
    if (mod.nextRain && Date.now() < mod.nextRain) return { error: `You can let it rain again ${waitText(mod.nextRain - Date.now())} (${mod.rainCooldown} h after your last one).`, nextRain: mod.nextRain };
    const wait = await rainCooldown();
    if (wait.nextAt) return { error: `The next money rain of a moderator ${waitText(wait.nextAt - Date.now())} (${wait.hours} h between two${wait.lastBy ? `, the last one by ${wait.lastBy}` : ""}).`, nextRain: wait.nextAt };
    if (amount > mod.rainMax) return { error: `At most 🪙 ${mod.rainMax.toLocaleString("en-US")} per money rain.` };
    if (mod.rainWeekly > 0 && mod.used + amount > mod.rainWeekly) {
      const left = Math.max(0, mod.rainWeekly - mod.used);
      return { error: left > 0 ? `You can give 🪙 ${left.toLocaleString("en-US")} more this week (of ${mod.rainWeekly.toLocaleString("en-US")} a week).` : `You gave all ${mod.rainWeekly.toLocaleString("en-US")} of this week - more from Monday.` };
    }
    const note = typeof input.note === "string" ? input.note.trim().slice(0, 80) : "";
    const rains = require("./money_rain");
    // Who gets it: everybody online (the moderator too)
    const names = await rains.targets({ target: "online", world: world });
    if (!names.length) return { error: "Nobody is online." };
    const each = amount;
    const total = each * names.length;
    const made = await rains.create({ amount: each, target: "online", world: world, note: note || `From moderator ${username}`, by: username, names: names });
    if (made.error) return made;
    const done = made.rain;
    const paid = done.paid != null ? done.paid : total;
    await User.updateOne({ username: username }, { $set: { mod: { ...user.mod, used: { week: weekStart(), amount: mod.used + amount }, lastRain: Date.now() } } });
    cooldown.lastAt = Date.now();
    cooldown.lastBy = username;
    await saveCooldown();
    await write(username, "rain", `🪙 ${paid.toLocaleString("en-US")} - ${done.players != null ? done.players : names.length} players × ${each.toLocaleString("en-US")}${world === "season" ? " (season)" : ""}${note ? ` · “${note}”` : ""}`);
    return { players: done.players != null ? done.players : names.length, each: each, total: paid, left: mod.rainWeekly > 0 ? Math.max(0, mod.rainWeekly - mod.used - amount) : null };
  } finally {
    busy.delete(username);
  }
}

// "in 3 h 20 min", "in 45 min"
function waitText(ms) {
  const min = Math.max(1, Math.ceil(ms / 60000));
  const h = Math.floor(min / 60);
  return "in " + (h ? h + " h" + (min % 60 ? " " + (min % 60) + " min" : "") : min + " min");
}

// What the rain would do (before it is sent): {players, each, total}
async function rainPreview(username, input, world = "normal") {
  const mod = await get(username);
  if (!mod || !mod.perms.rain) return { error: "You may not let it rain." };
  if (world === "season") return { error: SEASON };
  const amount = Number(input && input.amount) || 0;
  const names = await require("./money_rain").targets({ target: "online", world: world });
  return { players: names.length, each: amount, total: amount * names.length };
}

async function deleteMessage(username, id) {
  if (!(await can(username, "chat"))) return { error: "You may not moderate the chat." };
  const chat = require("./casino_chat");
  const message = chat.messages().find((entry) => entry.id === id);
  if (!message) return { error: "No such message (anymore)." };
  chat.remove(id);
  await write(username, "delete", `${message.name || "?"}: “${String(message.text || "").slice(0, 60)}”`);
  return { ok: true };
}

// Mutes a player in the casino chat for `minutes` (at most a day) - not the admin's bans for good
async function mute(username, target, minutes) {
  if (!(await can(username, "chat"))) return { error: "You may not moderate the chat." };
  if (typeof target !== "string" || !target) return { error: "Whom?" };
  if (target === username) return { error: "Not yourself." };
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MUTE_MAX) return { error: `Mute for 1 to ${MUTE_MAX} minutes.` };
  const user = await User.findOne({ username: target }).select("username mod").lean();
  if (user == null) return { error: "No such player." };
  if (modOf(user)) return { error: "Moderators can't mute each other - ask the admin." };
  require("./casino_chat").ban(user.username, minutes);
  await write(username, "mute", `${user.username} for ${minutes} min`);
  return { ok: true, mutes: mutes() };
}

async function unmute(username, target) {
  if (!(await can(username, "chat"))) return { error: "You may not moderate the chat." };
  if (!require("./casino_chat").unban(String(target))) return { error: "Not muted." };
  await write(username, "unmute", String(target));
  return { ok: true, mutes: mutes() };
}

// Who is muted now (only for a while - a ban for good is the admin's): [{username, until}]
function mutes() {
  return require("./casino_chat")
    .banList()
    .filter((ban) => ban.until != null);
}

// 📣 A highlighted message of a moderator in the casino chat - gone after `minutes` (1 min by default, up to a day)
const ANNOUNCE_TIMES = [1, 15, 60, 360, 1440];
async function announce(username, text, minutes = 1) {
  if (!(await can(username, "announce"))) return { error: "You may not make announcements." };
  const message = typeof text === "string" ? text.trim().replace(/\s+/g, " ").slice(0, 200) : "";
  if (message.length < 2) return { error: "What do you want to announce?" };
  const keep = ANNOUNCE_TIMES.includes(Number(minutes)) ? Number(minutes) : 1;
  require("./casino_chat").announce(username, message, keep);
  await write(username, "announce", `“${message.slice(0, 80)}” (${keep >= 60 ? keep / 60 + " h" : keep + " min"})`);
  return { ok: true };
}

// For the moderator's own panel: what they may, how much rain is left this week, who is muted, their last actions
async function panel(username) {
  const mod = await get(username);
  if (!mod) return { mod: null };
  return {
    mod: mod,
    rainLeft: mod.rainWeekly > 0 ? Math.max(0, mod.rainWeekly - mod.used) : null,
    mutes: mod.perms.chat ? mutes() : [],
    muteMax: MUTE_MAX,
    // The wait between money rains (all moderators together): {hours, nextAt, lastBy}
    rainWait: await rainCooldown(),
    log: (await history(username)).slice(0, 20),
  };
}

// Tests: everything forgotten
function reset() {
  log = [];
  logLoaded = true;
  busy.clear();
  cooldown = { hours: 12, lastAt: null, lastBy: null };
  cooldownLoaded = true;
}

module.exports = { COOLDOWN_MIN, rainCooldown, setRainCooldown, refresh, names, PERMS, PERM_NAMES, MUTE_MAX, DEFAULTS, changes, modOf, get, can, list, set, history, rain, rainPreview, deleteMessage, mute, unmute, mutes, announce, panel, reset };
