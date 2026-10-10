const Setting = require("../models/Setting");
const days = require("./days");

/*
 * The daily streak (admin panel: Casino → Daily streak): claiming the free coins day after day
 * makes them grow. Day n of the streak pays rewards[n-1] percent of the daily bonus; after the last
 * day it stays there ("stay") or starts at day 1 again ("restart"). A day missed ends the streak -
 * unless the grace allows it (that many days may be missed in a row). Every world counts its own
 * streak (the normal casino, the season's).
 */
const KEY = "admin:streak";
const MAX_DAYS = 30;
const MAX_PERCENT = 100000;
const DEFAULTS = Object.freeze({ on: true, rewards: [100, 120, 140, 160, 180, 200, 300], after: "stay", grace: 0 });
const AFTER = ["stay", "restart"];

let state = clone(DEFAULTS);

function clone(value) {
  return { on: value.on, rewards: value.rewards.slice(), after: value.after, grace: value.grace };
}

function current() {
  return clone(state);
}

// {on, rewards, after, grace} -> {value} or {error}
function check(input) {
  if (input == null || typeof input !== "object") return { error: "No values." };
  const next = clone(state);
  if ("on" in input) {
    if (typeof input.on !== "boolean") return { error: "On or off." };
    next.on = input.on;
  }
  if ("rewards" in input) {
    const rewards = input.rewards;
    if (!Array.isArray(rewards) || rewards.length < 1 || rewards.length > MAX_DAYS) return { error: `From 1 to ${MAX_DAYS} days.` };
    if (!rewards.every((value) => Number.isInteger(value) && value >= 0 && value <= MAX_PERCENT)) return { error: `Every day: a whole percent from 0 to ${MAX_PERCENT.toLocaleString("en-US")}.` };
    next.rewards = rewards.slice();
  }
  if ("after" in input) {
    if (!AFTER.includes(input.after)) return { error: "After the last day: stay or start again." };
    next.after = input.after;
  }
  if ("grace" in input) {
    if (!Number.isInteger(input.grace) || input.grace < 0 || input.grace > 7) return { error: "Days that may be missed: 0 to 7." };
    next.grace = input.grace;
  }
  return { value: next };
}

async function update(input) {
  const result = check(input);
  if (result.error) return result;
  state = result.value;
  await Setting.updateOne({ key: KEY }, { $set: { value: current() } }, { upsert: true });
  return { streak: current() };
}

async function reset() {
  state = clone(DEFAULTS);
  await Setting.deleteMany({ key: KEY });
  return current();
}

async function load() {
  const row = await Setting.findOne({ key: KEY }).lean();
  if (row == null || row.value == null) return;
  const result = check(row.value);
  if (!result.error) state = result.value;
}

// The percent of the daily bonus day `day` (1, 2, ...) of a streak pays - off: always 100
function percentFor(day) {
  if (!state.on) return 100;
  const list = state.rewards;
  const index = day <= list.length ? day - 1 : state.after === "restart" ? (day - 1) % list.length : list.length - 1;
  return list[Math.max(0, index)];
}

/*
 * The day of the streak a claim now would be: lastAt - the last claim (null: none), last - its day of the streak.
 * Claimed today already: that day again.
 */
function dayFor(lastAt, last, now = Date.now()) {
  if (lastAt == null || !Number.isInteger(last) || last < 1) return 1;
  const gap = days.dayNumber(now) - days.dayNumber(new Date(lastAt).getTime());
  if (gap <= 0) return last;
  return gap <= 1 + state.grace ? last + 1 : 1;
}

// The streak as it stands (for the pages): the day reached (0: none / over), the day a claim now would be
function info(lastAt, last, claimedToday, now = Date.now()) {
  const next = claimedToday ? null : dayFor(lastAt, last, now);
  const alive = Number.isInteger(last) && last > 0 && (claimedToday || next > 1) ? last : 0;
  return { on: state.on, day: alive, next: next, rewards: state.rewards.slice(), after: state.after, grace: state.grace };
}

module.exports = { DEFAULTS, MAX_DAYS, current, check, update, reset, load, percentFor, dayFor, info };
