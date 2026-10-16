/*
 * The admin's test mode: a player account (the admin's own) plays in a world
 * of its own (game/worlds.js: every game once more, only for testers - real
 * players never see it) with a sandbox balance - as good as unlimited,
 * refilled by itself (unless the admin turns that off) - and every item of the shop to wear. Nothing of it is
 * saved: no coin history, no change to the real balance, the leaderboard or
 * the season. Stopped (or a restart of the server): it is gone, the account
 * is as it was. Test coins never go to real players (no gifts).
 *
 * changes: "change" (username) - started or stopped (the pages load again, in
 * the other world); "coins" (username) - refilled
 */
const EventEmitter = require("events");

const DEFAULT_COINS = 10000000;
// (testers play in a world of their own - game/worlds.js; coins to or from real players: never)
const BLOCKED_REASONS = ["gift sent"];
const MESSAGE = "🧪 Test mode: not with test coins - they never go to real players.";

const testers = new Map(); // username -> {coins, start, since, looks: {frame, effect, background}}
const changes = new EventEmitter();
changes.setMaxListeners(0);

function active(username) {
  return testers.has(username);
}

function start(username, coins = DEFAULT_COINS) {
  if (!username) return { error: "Pick a player." };
  if (!Number.isInteger(coins) || coins < 1 || coins > 1000000000000) return { error: "Coins from 1 to 1,000,000,000,000." };
  const before = testers.get(username);
  testers.set(username, { coins: coins, start: coins, since: before ? before.since : Date.now(), refill: before ? before.refill : true, looks: before ? before.looks : { frame: null, effect: null, background: null } });
  // (again: only the balance - the pages stay where they are)
  changes.emit(before ? "coins" : "change", username);
  return { tester: view(username) };
}

function stop(username) {
  if (!testers.delete(username)) return { error: "Not in test mode." };
  changes.emit("change", username);
  return { stopped: username };
}

function view(username) {
  const t = testers.get(username);
  return t ? { username: username, coins: t.coins, start: t.start, since: t.since, refill: t.refill } : null;
}

function list() {
  return [...testers.keys()].map(view);
}

function balance(username) {
  const t = testers.get(username);
  return t ? t.coins : 0;
}

function add(username, amount) {
  const t = testers.get(username);
  if (!t) return false;
  t.coins += amount;
  return true;
}

// Auto refill on (the admin panel's switch): as good as unlimited - not enough left, filled up to the start again (at
// least the amount). Off: the coins run out like real ones.
function spend(username, amount) {
  const t = testers.get(username);
  if (!t) return false;
  if (t.coins < amount && !t.refill) return false;
  if (t.coins < amount) t.coins = Math.max(t.start, amount);
  t.coins -= amount;
  return true;
}

function setRefill(username, on) {
  const t = testers.get(username);
  if (!t) return { error: "Not in test mode." };
  t.refill = on === true;
  return { tester: view(username) };
}

function looks(username) {
  const t = testers.get(username);
  return t ? t.looks : null;
}

function wear(username, kind, id) {
  const t = testers.get(username);
  if (!t) return false;
  t.looks = { ...t.looks, [kind]: id };
  return true;
}

// (tests, the hard reset)
function reset() {
  const names = [...testers.keys()];
  testers.clear();
  names.forEach((name) => changes.emit("change", name));
}

module.exports = { DEFAULT_COINS, BLOCKED_REASONS, MESSAGE, active, start, stop, view, list, balance, add, spend, setRefill, looks, wear, reset, changes };
