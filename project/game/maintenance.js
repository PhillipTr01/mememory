const EventEmitter = require("events");
const Setting = require("../models/Setting");
const config = require("./config");
const casinoLock = require("./casino_lock");

/*
 * Maintenance (admin panel, Settings): the casino is closed for everybody but
 * the players on the whitelist. The others see a page with the reason and when
 * it is most likely over - and are let in by themselves when it ends.
 *
 * It starts like a season: first the casino closes (no new bets, running rounds
 * go to their end - at most SEASON_CLOSE_MAX), then a countdown (`wait`
 * seconds), then the maintenance is on.
 *
 * {on, closing: {since, startsAt (null: the games are still finishing)} or null,
 *  whitelist: [usernames], until: ms or null (most likely over then), note, wait (s)}
 */
const KEY = "maintenance";
const NOTE_MAX = 300;
const DEFAULT_WAIT = 60;

// "change" (state): open casino pages of players who are not on the whitelist are closed
// "closing" (info or null): every open casino page shows that it closes soon
const changes = new EventEmitter();
changes.setMaxListeners(0);

const fresh = () => ({ on: false, closing: null, whitelist: [], until: null, note: "", wait: DEFAULT_WAIT });
let state = fresh();
let timer = null;

function get() {
  return { on: state.on, closing: state.closing ? { ...state.closing } : null, whitelist: state.whitelist.slice(), until: state.until, note: state.note, wait: state.wait };
}

// What the players outside see (not the whitelist)
function publicInfo() {
  return { on: state.on, until: state.until, note: state.note };
}

// For the banner on the casino pages while it closes: {name, icon, kind, startsIn (null: games still finishing)}
function closingInfo(now = Date.now()) {
  if (!state.closing) return null;
  return { name: "Maintenance", icon: "🔧", kind: "maintenance", startsIn: state.closing.startsAt == null ? null : Math.max(0, state.closing.startsAt - now) };
}

// May the player into the casino right now?
function allowed(username) {
  return !state.on || state.whitelist.includes(username);
}

// {on, whitelist, until, note, wait} -> {maintenance} or {error}; nothing changes on an error
function check(input) {
  if (input == null || typeof input !== "object") return { error: "Nothing to save." };
  const next = get();
  if (input.on != null && typeof input.on !== "boolean") return { error: "On or off." };
  if (input.whitelist != null) {
    if (!Array.isArray(input.whitelist) || !input.whitelist.every((name) => typeof name === "string" && name.trim())) return { error: "The whitelist: player names." };
    next.whitelist = [...new Set(input.whitelist.map((name) => name.trim()))].slice(0, 500);
  }
  if (input.until !== undefined) {
    if (input.until === null || input.until === "") next.until = null;
    else if (!Number.isFinite(Number(input.until))) return { error: "When it is over: a date." };
    else next.until = Math.round(Number(input.until));
  }
  if (input.note != null) {
    if (typeof input.note !== "string") return { error: "The note: text." };
    next.note = input.note.trim().slice(0, NOTE_MAX);
  }
  if (input.wait != null) {
    const wait = Number(input.wait);
    if (!Number.isInteger(wait) || wait < 0 || wait > 3600) return { error: "The countdown: 0 to 3600 seconds." };
    next.wait = wait;
  }
  return { maintenance: next };
}

async function save() {
  await Setting.updateOne({ key: KEY }, { $set: { value: get() } }, { upsert: true });
}

function later(ms) {
  clearTimeout(timer);
  timer = setTimeout(() => tick().catch((error) => console.error("[maintenance] Could not go on:", error)), ms);
  timer.unref();
}

// Closing: every game quiet (or waited long enough) - the countdown; over - the maintenance is on
async function tick(now = Date.now()) {
  if (!state.closing) return;
  if (state.closing.startsAt == null && (casinoLock.busyGames().length === 0 || now - state.closing.since >= config.SEASON_CLOSE_MAX)) {
    state.closing.startsAt = now + state.wait * 1000;
    await save();
    changes.emit("closing", closingInfo(now));
  }
  if (state.closing.startsAt != null && now >= state.closing.startsAt) {
    // On: the whitelist plays (the casino is open again for them), everybody else is out
    state.closing = null;
    state.on = true;
    casinoLock.unlock("maintenance");
    await save();
    changes.emit("closing", null);
    changes.emit("change", get());
    return;
  }
  later(state.closing.startsAt == null ? 2000 : state.closing.startsAt - now + 50);
}

async function update(input, now = Date.now()) {
  const result = check(input);
  if (result.error) return result;
  const want = input.on;
  const before = { on: state.on, closing: state.closing };
  state = { ...result.maintenance, on: before.on, closing: before.closing };
  if (want === true && !state.on && !state.closing) {
    // Start: the casino closes first, the games finish - then the countdown
    state.closing = { since: now, startsAt: null };
    casinoLock.lock("maintenance");
    await save();
    changes.emit("closing", closingInfo(now));
    await tick(now);
  } else if (want === false && (state.on || state.closing)) {
    // Off (or not anymore while it closes): open for everybody
    clearTimeout(timer);
    const wasClosing = state.closing != null;
    state.on = false;
    state.closing = null;
    casinoLock.unlock("maintenance");
    await save();
    if (wasClosing) changes.emit("closing", null);
    changes.emit("change", get());
  } else {
    await save();
    // (the whitelist may have changed while it is on)
    if (state.on) changes.emit("change", get());
  }
  return { maintenance: get() };
}

// The server starts: maintenance as it was (closing: it goes on)
async function load() {
  const row = await Setting.findOne({ key: KEY }).lean();
  if (row == null || row.value == null || typeof row.value !== "object") return;
  const value = row.value;
  const result = check({ ...fresh(), ...value, on: undefined });
  if (result.error) return;
  state = { ...result.maintenance, on: value.on === true, closing: value.closing && Number.isFinite(value.closing.since) ? { since: value.closing.since, startsAt: Number.isFinite(value.closing.startsAt) ? value.closing.startsAt : null } : null };
  if (state.closing) {
    casinoLock.lock("maintenance");
    later(1000);
  }
}

// (tests)
function reset() {
  clearTimeout(timer);
  if (state.closing) casinoLock.unlock("maintenance");
  state = fresh();
}

module.exports = { get, publicInfo, closingInfo, allowed, update, load, reset, tick, changes };
