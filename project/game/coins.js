const EventEmitter = require("events");
const User = require("../models/User");
const CoinLog = require("../models/CoinLog");
const config = require("./config");
const days = require("./days");

/*
 * "change" (username) after every change of a balance: every page that shows
 * coins (jackpot, case battles) gets the new balance, whichever page (or game)
 * changed it.
 */
const changes = new EventEmitter();
changes.setMaxListeners(0);

function notify(username) {
  changes.emit("change", username);
}

// History of every change (for the admin panel); never blocks or breaks a game
function log(username, amount, reason, note) {
  Promise.resolve()
    .then(() => CoinLog.create({ username: username, amount: amount, reason: reason || "other", note: note, at: new Date() }))
    .catch((error) => console.error("[coins] Could not write the history:", error));
}

/*
 * Coins for the hidden jackpot. Stored on the user, every change is a single
 * atomic update, so two games (or tabs) can't spend the same coins twice.
 * Every account gets the start coins on first use (and after a reset).
 */

function changed(result) {
  return result != null && (result.nModified > 0 || result.modifiedCount > 0);
}

/*
 * The coins everybody starts with: config.COIN_RESET / START_COINS - or, once
 * a season started (game/seasons.js), the season's reset and budget.
 * since: when it started (for the daily bonuses a late player missed).
 */
let seasonBase = null;

function setBase(value) {
  seasonBase = value && typeof value.reset === "string" ? value : null;
}

function base() {
  return seasonBase || { reset: config.COIN_RESET, start: config.START_COINS, since: null };
}

// The balance as the player sees it (accounts from before a reset get the start coins)
function balanceOf(user) {
  const now = base();
  return user.coinReset === now.reset ? user.coins || 0 : now.start;
}

/*
 * Approved players (see game/access.js) get the start coins once more after a
 * reset of all coins (base().reset): coinReset remembers the last reset they
 * got. The first start coins come with the approval.
 */
async function ensure(username) {
  const now = base();
  const reset = await User.updateOne({ username: username, casinoApproved: true, coinReset: { $ne: now.reset } }, { $set: { coins: now.start, coinReset: now.reset } });
  if (changed(reset)) log(username, now.start, "start coins");
}

// Time (ms) until the next free coins can be claimed (0: now) - once per calendar day, new ones at midnight
function bonusIn(user, now = Date.now()) {
  if (user == null || user.coinBonusAt == null) return 0;
  const claimed = new Date(user.coinBonusAt).getTime();
  if (claimed < days.dayStart(now)) return 0;
  return Math.max(0, days.nextDay(now) - now);
}

function bonusAvailable(user, now = Date.now()) {
  return user != null && bonusIn(user, now) === 0;
}

// { coins, bonus, bonusIn, payout } - bonus: the daily free coins can be claimed now, payout: may pay coins out
async function get(username) {
  await ensure(username);
  const user = await User.findOne({ username: username }).select("coins coinBonusAt payoutAllowed");
  if (user == null) return { coins: 0, bonus: false, bonusIn: days.nextDay() - Date.now(), payout: false };
  return { coins: user.coins || 0, bonus: bonusAvailable(user), bonusIn: bonusIn(user), bonusAmount: config.DAILY_BONUS, payout: user.payoutAllowed === true };
}

/*
 * options.reason: why (for the history), options.note: more about it,
 * options.quiet: the pages are told later with notify() (a win that is shown after an animation)
 */
async function add(username, amount, options) {
  if (!Number.isInteger(amount) || amount <= 0) return false;
  options = options || {};
  await ensure(username);
  const done = changed(await User.updateOne({ username: username }, { $inc: { coins: amount } }));
  if (done) log(username, amount, options.reason, options.note);
  if (done && !options.quiet) notify(username);
  return done;
}

// Takes the coins only if the user has enough (false otherwise)
async function spend(username, amount, options) {
  if (!Number.isInteger(amount) || amount <= 0) return false;
  await ensure(username);
  const done = changed(
    await User.updateOne({ username: username, coins: { $gte: amount } }, { $inc: { coins: -amount } }),
  );
  if (done) {
    log(username, -amount, (options && options.reason) || "other", options && options.note);
    notify(username);
  }
  return done;
}

// The admin sets a balance (returns the new balance, null: no such user)
async function set(username, amount, note) {
  if (!Number.isInteger(amount) || amount < 0) return null;
  await ensure(username);
  const user = await User.findOne({ username: username }).select("coins");
  if (user == null) return null;
  const before = user.coins || 0;
  await User.updateOne({ username: username }, { $set: { coins: amount } });
  log(username, amount - before, "admin", note);
  notify(username);
  return amount;
}

// Free coins once a day (calendar day), for everybody
async function claimBonus(username, now = Date.now()) {
  await ensure(username);
  const result = await User.updateOne(
    {
      username: username,
      $or: [{ coinBonusAt: { $exists: false } }, { coinBonusAt: null }, { coinBonusAt: { $lt: new Date(days.dayStart(now)) } }],
    },
    { $inc: { coins: config.DAILY_BONUS }, $set: { coinBonusAt: new Date(now) } },
  );
  if (changed(result)) {
    log(username, config.DAILY_BONUS, "daily bonus");
    notify(username);
  }
  return changed(result);
}

// Coins for a win in a game (never blocks or breaks the game)
function reward(username, mode) {
  const amount = config.COIN_REWARDS[mode];
  if (!amount) return;
  add(username, amount, { reason: "game win", note: mode }).catch((error) => console.error("[coins] Could not add coins:", error));
}

module.exports = { setBase, base, balanceOf, log, get, add, spend, set, claimBonus, reward, bonusAvailable, changes, notify };
