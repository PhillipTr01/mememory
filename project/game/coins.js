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
// (during a season tagged with it - the history from before stays apart)
// options.normal: into the history outside of seasons (the normal balance, changed during a season)
function log(username, amount, reason, note, options = {}) {
  const now = options.normal ? null : era();
  Promise.resolve()
    .then(() => CoinLog.create({ username: username, amount: amount, reason: reason || "other", note: note, at: new Date(), ...(now ? { era: now } : {}) }))
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

// The running season (its reset id) - null without one
function era() {
  return seasonBase && seasonBase.active ? seasonBase.reset : null;
}

// The coin history to show: the season's - or everything outside of seasons
function eraFilter() {
  const now = era();
  return now ? { era: now } : { era: { $exists: false } };
}

// The balance from before a running season (game/seasons.js sets the lookup) - shown next to the coins
let storedLookup = () => null;
function setStoredLookup(lookup) {
  storedLookup = lookup;
}

// In a running season: did the player start it (game/seasons.js sets the lookup)? null: no season
let joinedLookup = () => null;
function setJoinedLookup(lookup) {
  joinedLookup = lookup;
}
// When the player started the running season (game/seasons.js sets the lookup) - null: no season
let joinedAtLookup = () => null;
function setJoinedAtLookup(lookup) {
  joinedAtLookup = lookup;
}

// Not started the running season: watching only (no coins, no daily bonus)
function watching(username) {
  return era() != null && joinedLookup(username) === false;
}

// The free coins of the day: the running season's - or the setting
function dailyBonus() {
  return seasonBase && Number.isInteger(seasonBase.bonus) ? seasonBase.bonus : config.DAILY_BONUS;
}

// The balance as the player sees it (accounts from before a reset get the start coins)
function balanceOf(user) {
  const now = base();
  return user.coinReset === now.reset ? user.coins || 0 : now.start;
}

/*
 * While the server starts, the coins wait: the running season (its reset, its
 * start coins) is only known once it is loaded - checking a balance before
 * that would take every season balance for an old one and reset it. app.js
 * holds them until the season is loaded.
 */
let gate = Promise.resolve();
let openGate = null;
function hold() {
  if (openGate) return;
  gate = new Promise((resolve) => (openGate = resolve));
}
function release() {
  if (openGate) openGate();
  openGate = null;
}

/*
 * Approved players (see game/access.js) get the start coins once more after a
 * reset of all coins (base().reset): coinReset remembers the last reset they
 * got. The first start coins come with the approval.
 */
async function ensure(username) {
  await gate;
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

// In a running season the daily bonuses add up - nobody misses one: every day since the last claim
// (or since starting the season), today's included. Outside of seasons: today's.
function bonusDays(user, now = Date.now()) {
  if (era() == null || user == null) return 1;
  const last = user.coinBonusAt ? new Date(user.coinBonusAt).getTime() : null;
  const joined = joinedAtLookup(user.username);
  const from = last != null ? days.dayNumber(last) + 1 : joined != null ? days.dayNumber(joined) : days.dayNumber(now);
  return Math.max(1, days.dayNumber(now) - from + 1);
}

function bonusDue(user, now = Date.now()) {
  return dailyBonus() * bonusDays(user, now);
}

// { coins, bonus, bonusIn, payout } - bonus: the daily free coins can be claimed now, payout: may pay coins out
async function get(username) {
  await ensure(username);
  const user = await User.findOne({ username: username }).select("username coins coinBonusAt payoutAllowed");
  if (user == null) return { coins: 0, bonus: false, bonusIn: days.nextDay() - Date.now(), payout: false };
  const joined = joinedLookup(username);
  const available = bonusAvailable(user) && joined !== false;
  return { coins: user.coins || 0, bonus: available, bonusIn: bonusIn(user), bonusAmount: available ? bonusDue(user) : dailyBonus(), payout: user.payoutAllowed === true, stored: storedLookup(username), joined: era() != null ? joined !== false : null };
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
// When a player last spent coins (a bet): for a moment the coins count as in a game - until the game has them
const spentAt = new Map();
function lastSpent(username) {
  return spentAt.get(username) || 0;
}

async function spend(username, amount, options) {
  if (!Number.isInteger(amount) || amount <= 0) return false;
  await ensure(username);
  const done = changed(
    await User.updateOne({ username: username, coins: { $gte: amount } }, { $inc: { coins: -amount } }),
  );
  if (done) {
    spentAt.set(username, Date.now());
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

// Free coins once a day (calendar day), for everybody - in a season the days not claimed on top.
// Returns what was paid (0: nothing, already claimed today)
async function claim(username, now = Date.now()) {
  if (watching(username)) return 0;
  await ensure(username);
  const user = await User.findOne({ username: username }).select("username coinBonusAt").lean();
  if (user == null || !bonusAvailable(user, now)) return 0;
  const count = bonusDays(user, now);
  const amount = dailyBonus() * count;
  const result = await User.updateOne(
    {
      username: username,
      $or: [{ coinBonusAt: { $exists: false } }, { coinBonusAt: null }, { coinBonusAt: { $lt: new Date(days.dayStart(now)) } }],
    },
    { $inc: { coins: amount }, $set: { coinBonusAt: new Date(now) } },
  );
  if (!changed(result)) return 0;
  log(username, amount, "daily bonus", count > 1 ? `${count} days` : undefined);
  notify(username);
  return amount;
}

async function claimBonus(username, now = Date.now()) {
  return (await claim(username, now)) > 0;
}

// Coins for a win in a game (never blocks or breaks the game)
function reward(username, mode) {
  const amount = config.COIN_REWARDS[mode];
  if (!amount) return;
  add(username, amount, { reason: "game win", note: mode }).catch((error) => console.error("[coins] Could not add coins:", error));
}

module.exports = { lastSpent, hold, release, claim, bonusDue, setJoinedAtLookup, setJoinedLookup, watching, setStoredLookup, setBase, base, era, eraFilter, dailyBonus, balanceOf, log, get, add, spend, set, claimBonus, reward, bonusAvailable, changes, notify };
