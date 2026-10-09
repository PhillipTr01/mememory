const EventEmitter = require("events");
const User = require("../models/User");
const Setting = require("../models/Setting");
const coins = require("./coins");

/*
 * Money rains (admin panel, Casino): coins for many players at once - right
 * now or planned for a time (once, every day or every week). Who gets them:
 * - all: every player in the casino
 * - online: who has a casino page open at that moment
 * - bottom: the last X% of the leaderboard
 * - below: everybody with less than N coins
 * In the normal casino (the 🪙) - or the season world (who joined the
 * running season, its coins).
 *
 * changes: "rain" ({id, amount, names, note, world}) - paid; "change" - the list changed
 */
const KEY = "moneyRains";
const TARGETS = ["all", "online", "bottom", "below"];
const REPEATS = { none: 0, daily: 24 * 3600 * 1000, weekly: 7 * 24 * 3600 * 1000 };
const TICK = 10 * 1000;
const HISTORY = 50;

const changes = new EventEmitter();
changes.setMaxListeners(0);

let state = { rains: [], next: 1 };
let loaded = false;
let timer = null;
// Who is online (game/casino_chat.js - set by app.js / the tests, so this file has no socket parts)
let onlineLookup = () => [];
function setOnline(lookup) {
  onlineLookup = lookup;
}

async function save() {
  await Setting.updateOne({ key: KEY }, { $set: { value: JSON.stringify(state) } }, { upsert: true });
}

async function load() {
  const row = await Setting.findOne({ key: KEY }).lean();
  try {
    if (row && typeof row.value === "string") state = { rains: [], next: 1, ...JSON.parse(row.value) };
  } catch (error) {
    console.error("[rain] Could not read the money rains:", error);
  }
  loaded = true;
}

// What the admin enters: {at (ms; not given: now), amount, target, percent, below, world, repeat, note}
function check(input, now = Date.now()) {
  if (input == null || typeof input !== "object") return { error: "No money rain." };
  const amount = Number(input.amount);
  if (!Number.isInteger(amount) || amount < 1 || amount > 100000000) return { error: "Coins per player: 1 to 100,000,000." };
  const target = String(input.target || "all");
  if (!TARGETS.includes(target)) return { error: "Unknown target." };
  const percent = target === "bottom" ? Number(input.percent) : null;
  if (target === "bottom" && (!Number.isInteger(percent) || percent < 1 || percent > 100)) return { error: "The last 1 to 100% of the leaderboard." };
  const below = target === "below" ? Number(input.below) : null;
  if (target === "below" && (!Number.isInteger(below) || below < 1 || below > 1000000000)) return { error: "Less than how many coins? 1 to 1,000,000,000." };
  const world = input.world === "season" ? "season" : "normal";
  const repeat = Object.prototype.hasOwnProperty.call(REPEATS, input.repeat) ? input.repeat : "none";
  const at = input.at == null || input.at === "" ? now : Number(input.at);
  if (!Number.isFinite(at)) return { error: "When?" };
  if (at < now - 60 * 1000) return { error: "The time has to be in the future." };
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 80) : "";
  return { rain: { at: at, amount: amount, target: target, percent: percent, below: below, world: world, repeat: repeat, note: note } };
}

// The players a rain would go to now: [username]
async function targets(rain) {
  const season = rain.world === "season" ? require("./seasons").running() : null;
  if (rain.world === "season" && !season) return [];
  const wallet = coins.wallet(rain.world === "season" ? "/season" : "");
  const fields = wallet.fields;
  let users = (await User.find({ casinoApproved: true }).select(["username", fields.coins, fields.reset].join(" ")).lean()).map((user) => ({ username: user.username, coins: wallet.balanceOf(user) }));
  if (season) users = users.filter((user) => require("./seasons").joined(user.username) === true);
  if (rain.target === "online") {
    const online = new Set(onlineLookup());
    users = users.filter((user) => online.has(user.username));
  } else if (rain.target === "below") {
    users = users.filter((user) => user.coins < rain.below);
  } else if (rain.target === "bottom") {
    // The last X% of the leaderboard (at least one player)
    users.sort((a, b) => a.coins - b.coins || a.username.localeCompare(b.username));
    users = users.slice(0, Math.max(1, Math.ceil((users.length * rain.percent) / 100)));
  }
  return users.map((user) => user.username).sort((a, b) => a.localeCompare(b));
}

// For the admin: how many players it would reach right now
async function preview(input) {
  const result = check({ ...input, at: null });
  if (result.error) return result;
  const names = await targets(result.rain);
  return { players: names.length, total: names.length * result.rain.amount, names: names.slice(0, 30) };
}

function view(rain) {
  return { ...rain };
}

function list() {
  const planned = state.rains.filter((rain) => rain.status === "planned").sort((a, b) => a.at - b.at);
  const done = state.rains.filter((rain) => rain.status !== "planned").sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  return { planned: planned.map(view), done: done.map(view) };
}

// A new money rain - now (paid right away) or planned
async function create(input, now = Date.now()) {
  const result = check(input, now);
  if (result.error) return result;
  const rain = { id: state.next++, ...result.rain, status: "planned", createdAt: now };
  state.rains.push(rain);
  await save();
  changes.emit("change");
  if (rain.at <= now) await tick(now);
  return { rain: view(state.rains.find((r) => r.id === rain.id) || rain) };
}

async function cancel(id) {
  const rain = state.rains.find((r) => r.id === Number(id) && r.status === "planned");
  if (!rain) return { error: "No planned money rain with this id." };
  state.rains.splice(state.rains.indexOf(rain), 1);
  await save();
  changes.emit("change");
  return { ok: true };
}

// The admin lets it rain right now (a planned one - its repeat goes on from its own time)
async function now(id) {
  const rain = state.rains.find((r) => r.id === Number(id) && r.status === "planned");
  if (!rain) return { error: "No planned money rain with this id." };
  await pay(rain, Date.now());
  return { rain: view(rain) };
}

async function pay(rain, at) {
  const names = await targets(rain);
  const wallet = coins.wallet(rain.world === "season" ? "/season" : "");
  const paid = [];
  for (const name of names) {
    if (await wallet.add(name, rain.amount, { reason: "money rain", note: rain.note || undefined })) paid.push(name);
  }
  rain.status = "done";
  rain.doneAt = at;
  rain.players = paid.length;
  rain.paid = paid.length * rain.amount;
  // Again: the next one (every day / every week from the planned time)
  if (REPEATS[rain.repeat]) {
    let next = rain.at + REPEATS[rain.repeat];
    while (next <= at) next += REPEATS[rain.repeat];
    const { id, status, doneAt, players, paid: total, ...plan } = rain;
    state.rains.push({ ...plan, id: state.next++, at: next, status: "planned", createdAt: at });
  }
  // Only the last few that are over
  const done = state.rains.filter((r) => r.status === "done").sort((a, b) => b.doneAt - a.doneAt);
  for (const old of done.slice(HISTORY)) state.rains.splice(state.rains.indexOf(old), 1);
  await save();
  changes.emit("rain", { id: rain.id, amount: rain.amount, names: paid, note: rain.note, world: rain.world });
  changes.emit("change");
}

let ticking = null;
function tick(at = Date.now()) {
  if (!loaded) return Promise.resolve();
  ticking = (ticking || Promise.resolve())
    .then(async () => {
      for (const rain of state.rains.filter((r) => r.status === "planned" && r.at <= at).sort((a, b) => a.at - b.at)) await pay(rain, at);
    })
    .catch((error) => console.error("[rain] Could not let it rain:", error));
  return ticking;
}

function start() {
  if (timer) return;
  timer = setInterval(() => tick(), TICK);
  timer.unref();
  tick();
}

// The hard reset: every planned money rain is gone (the ones that fell stay in the list)
async function clearPlanned() {
  state.rains = state.rains.filter((rain) => rain.status !== "planned");
  await save();
  changes.emit("change");
}

// Tests: everything forgotten
function reset() {
  state = { rains: [], next: 1 };
  loaded = true;
}

module.exports = { TARGETS, REPEATS, changes, setOnline, load, start, tick, list, create, cancel, clearPlanned, now, preview, targets, check, reset };
