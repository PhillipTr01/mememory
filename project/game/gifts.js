const config = require("./config");
const days = require("./days");
const coins = require("./coins");
const seasons = require("./seasons");
const access = require("./access");
const { send: notify } = require("./notices");
const User = require("../models/User");
const CoinLog = require("../models/CoinLog");

/*
 * Coins as a gift to another player (a click on a name in the casino chat).
 * Every player can give at most GIFT_LIMIT coins a day (from midnight on: the
 * full amount again).
 */

// What the player gave today
async function given(username, now = Date.now()) {
  const rows = await CoinLog.find({ username: username, reason: "gift sent", at: { $gte: new Date(days.dayStart(now)) } }).lean();
  return rows.reduce((sum, row) => sum + Math.abs(row.amount), 0);
}

// {limit, given, left}
async function status(username) {
  const sent = await given(username);
  return { limit: config.GIFT_LIMIT, given: sent, left: Math.max(0, config.GIFT_LIMIT - sent) };
}

// from gives `amount` coins to `to`: {coins (left), left (to give)} or {error}
async function give(from, to, amount) {
  if (typeof to !== "string" || !to.trim()) return { error: "To whom?" };
  to = to.trim();
  if (to === from) return { error: "Not to yourself." };
  if (!Number.isInteger(amount) || amount < 1) return { error: "A whole number of coins, please." };
  const user = await User.findOne({ username: to }).select("username casinoApproved").lean();
  if (user == null || !access.approved(user)) return { error: "There's no such player in the casino." };
  // In a season: only between players who are in it (the coins are season coins)
  if (seasons.running() && (seasons.joined(from) === false || seasons.joined(to) === false)) return { error: `${to} hasn't started the season yet.` };
  const before = await status(from);
  if (amount > before.left) return { error: before.left > 0 ? `You can give 🪙 ${before.left.toLocaleString("en-US")} more today (of ${before.limit.toLocaleString("en-US")} a day).` : `You gave the most you can today (🪙 ${before.limit.toLocaleString("en-US")} a day) - more tomorrow.` };
  if (!(await coins.spend(from, amount, { reason: "gift sent", note: "to " + to }))) return { error: "You don't have that many coins." };
  await coins.add(to, amount, { reason: "gift received", note: "from " + from });
  notify(to, "giftReceived", { from: from, amount: amount });
  return { coins: (await coins.get(from)).coins, left: before.left - amount };
}

module.exports = { status, give };
