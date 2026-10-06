const EventEmitter = require("events");
const User = require("../models/User");
const config = require("./config");

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

/*
 * Coins for the hidden jackpot. Stored on the user, every change is a single
 * atomic update, so two games (or tabs) can't spend the same coins twice.
 * Users from before the coins existed get the start coins on first use.
 */

function changed(result) {
  return result != null && (result.nModified > 0 || result.modifiedCount > 0);
}

// Accounts from before the start coins were raised got this much
const OLD_START_COINS = 100;

/*
 * Everybody gets the start coins once: accounts without coins get them now,
 * accounts that only got the old (smaller) start coins get the difference.
 * coinStart remembers what an account got.
 */
async function ensure(username) {
  await User.updateOne(
    { username: username, coins: { $exists: false } },
    { $set: { coins: config.START_COINS, coinStart: config.START_COINS } },
  );
  await User.updateOne(
    { username: username, coins: { $exists: true }, coinStart: { $exists: false } },
    { $inc: { coins: Math.max(0, config.START_COINS - OLD_START_COINS) }, $set: { coinStart: config.START_COINS } },
  );
}

function bonusAvailable(user, now = Date.now()) {
  if (user == null || user.coins >= config.BONUS_BELOW) return false;
  return user.coinBonusAt == null || now - new Date(user.coinBonusAt).getTime() >= config.BONUS_EVERY;
}

// { coins, bonus } - bonus: the daily free coins can be claimed now
async function get(username) {
  await ensure(username);
  const user = await User.findOne({ username: username }).select("coins coinBonusAt");
  if (user == null) return { coins: 0, bonus: false };
  return { coins: user.coins || 0, bonus: bonusAvailable(user) };
}

// quiet: the pages are told later with notify() (a win that is shown after an animation)
async function add(username, amount, options) {
  if (!Number.isInteger(amount) || amount <= 0) return false;
  await ensure(username);
  const done = changed(await User.updateOne({ username: username }, { $inc: { coins: amount } }));
  if (done && !(options && options.quiet)) notify(username);
  return done;
}

// Takes the coins only if the user has enough (false otherwise)
async function spend(username, amount) {
  if (!Number.isInteger(amount) || amount <= 0) return false;
  await ensure(username);
  const done = changed(
    await User.updateOne({ username: username, coins: { $gte: amount } }, { $inc: { coins: -amount } }),
  );
  if (done) notify(username);
  return done;
}

// Free coins once a day for players who are (almost) broke
async function claimBonus(username, now = Date.now()) {
  await ensure(username);
  const result = await User.updateOne(
    {
      username: username,
      coins: { $lt: config.BONUS_BELOW },
      $or: [{ coinBonusAt: { $exists: false } }, { coinBonusAt: null }, { coinBonusAt: { $lte: new Date(now - config.BONUS_EVERY) } }],
    },
    { $inc: { coins: config.DAILY_BONUS }, $set: { coinBonusAt: new Date(now) } },
  );
  if (changed(result)) notify(username);
  return changed(result);
}

// Coins for a win in a game (never blocks or breaks the game)
function reward(username, mode) {
  const amount = config.COIN_REWARDS[mode];
  if (!amount) return;
  add(username, amount).catch((error) => console.error("[coins] Could not add coins:", error));
}

module.exports = { get, add, spend, claimBonus, reward, bonusAvailable, changes, notify };
