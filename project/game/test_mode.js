/*
 * The admin's test mode: a player account (the admin's own) plays with a
 * sandbox balance - as good as unlimited, refilled by itself - and every item
 * of the shop to wear. Nothing of it is saved: no coin history, no change to
 * the real balance, the leaderboard or the season. Stopped (or a restart of
 * the server): it is gone, the account is as it was.
 *
 * Test coins never mix with the coins of real players: the games where the
 * coins go from one player to another (jackpot, poker, gifts, payouts, a case
 * battle with other people) are closed while testing. Roulette, slots,
 * blackjack and case battles against bots are open.
 *
 * changes: "change" (username) - started, stopped, refilled
 */
const EventEmitter = require("events");

const DEFAULT_COINS = 10000000;
const BLOCKED_REASONS = ["jackpot bet", "poker buy-in", "poker chips", "gift sent", "withdrawal"];
const MESSAGE = "🧪 Test mode: not here - this game is played with the coins of other players.";

const testers = new Map(); // username -> {coins, start, since, looks: {frame, effect}}
const changes = new EventEmitter();
changes.setMaxListeners(0);

function active(username) {
  return testers.has(username);
}

function start(username, coins = DEFAULT_COINS) {
  if (!username) return { error: "Pick a player." };
  if (!Number.isInteger(coins) || coins < 1 || coins > 1000000000000) return { error: "Coins from 1 to 1,000,000,000,000." };
  const before = testers.get(username);
  testers.set(username, { coins: coins, start: coins, since: before ? before.since : Date.now(), looks: before ? before.looks : { frame: null, effect: null } });
  changes.emit("change", username);
  return { tester: view(username) };
}

function stop(username) {
  if (!testers.delete(username)) return { error: "Not in test mode." };
  changes.emit("change", username);
  return { stopped: username };
}

function view(username) {
  const t = testers.get(username);
  return t ? { username: username, coins: t.coins, start: t.start, since: t.since } : null;
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

// As good as unlimited: not enough left - it is filled up to the start again (at least the amount)
function spend(username, amount) {
  const t = testers.get(username);
  if (!t) return false;
  if (t.coins < amount) t.coins = Math.max(t.start, amount);
  t.coins -= amount;
  return true;
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

module.exports = { DEFAULT_COINS, BLOCKED_REASONS, MESSAGE, active, start, stop, view, list, balance, add, spend, looks, wear, reset, changes };
