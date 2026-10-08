const EventEmitter = require("events");
const Setting = require("../models/Setting");

/*
 * Maintenance (admin panel, Settings): the casino is closed for everybody but
 * the players on the whitelist. The others see a page with the reason and when
 * it is most likely over - and are let in by themselves when it ends.
 *
 * {on, whitelist: [usernames], until: ms or null (most likely over then), note}
 */
const KEY = "maintenance";
const NOTE_MAX = 300;

// "change" (state): open casino pages of players who are not on the whitelist are closed
const changes = new EventEmitter();
changes.setMaxListeners(0);

let state = { on: false, whitelist: [], until: null, note: "" };

function get() {
  return { on: state.on, whitelist: state.whitelist.slice(), until: state.until, note: state.note };
}

// What the players outside see (not the whitelist)
function publicInfo() {
  return { on: state.on, until: state.until, note: state.note };
}

// May the player into the casino right now?
function allowed(username) {
  return !state.on || state.whitelist.includes(username);
}

// {on, whitelist, until, note} -> {maintenance} or {error}; nothing changes on an error
function check(input) {
  if (input == null || typeof input !== "object") return { error: "Nothing to save." };
  const next = get();
  if (input.on != null) {
    if (typeof input.on !== "boolean") return { error: "On or off." };
    next.on = input.on;
  }
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
  return { maintenance: next };
}

async function save() {
  await Setting.updateOne({ key: KEY }, { $set: { value: get() } }, { upsert: true });
}

async function update(input) {
  const result = check(input);
  if (result.error) return result;
  state = result.maintenance;
  await save();
  changes.emit("change", get());
  return { maintenance: get() };
}

// The server starts: maintenance as it was
async function load() {
  const row = await Setting.findOne({ key: KEY }).lean();
  if (row == null || row.value == null || typeof row.value !== "object") return;
  const result = check({ on: false, whitelist: [], until: null, note: "", ...row.value });
  if (!result.error) state = result.maintenance;
}

// (tests)
function reset() {
  state = { on: false, whitelist: [], until: null, note: "" };
}

module.exports = { get, publicInfo, allowed, update, load, reset, changes };
