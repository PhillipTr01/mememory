const config = require("./config");
const testMode = require("./test_mode");
const days = require("./days");
const coins = require("./coins");
const access = require("./access");
const { send: notify } = require("./notices");
const User = require("../models/User");
const CoinLog = require("../models/CoinLog");

/*
 * Coins as a gift to another player (a click on a name in the casino chat) -
 * in the world the giver plays in: the 🪙 in the normal casino, the season's
 * coins in the season world (only to who joined the season). Each world has
 * its own limit a day (GIFT_LIMIT, SEASON_GIFT_LIMIT) - from midnight on the
 * full amount again; both can be sent.
 */
const seasons = () => require("./seasons");

// The world the player gives in: "season" or "normal"
function worldOf(username) {
  return seasons().inSeasonWorld(username) ? "season" : "normal";
}

function limitOf(world) {
  return world === "season" ? config.SEASON_GIFT_LIMIT : config.GIFT_LIMIT;
}

// What the player gave today in a world (the season's gifts have its era)
async function given(username, world, now = Date.now()) {
  const era = world === "season" ? coins.era() : null;
  const rows = await CoinLog.find({ username: username, reason: "gift sent", at: { $gte: new Date(days.dayStart(now)) }, ...(era ? { era: era } : { era: { $exists: false } }) }).lean();
  return rows.reduce((sum, row) => sum + Math.abs(row.amount), 0);
}

// {limit, given, left, world} - in the world the player plays in now
async function status(username, world = worldOf(username)) {
  const sent = await given(username, world);
  const limit = limitOf(world);
  return { limit: limit, given: sent, left: Math.max(0, limit - sent), world: world };
}

// from gives `amount` coins to `to`: {coins (left), left (to give)} or {error}
async function give(from, to, amount) {
  if (typeof to !== "string" || !to.trim()) return { error: "To whom?" };
  to = to.trim();
  if (to === from) return { error: "Not to yourself." };
  if (testMode.active(from) || testMode.active(to)) return { error: testMode.MESSAGE };
  if (!Number.isInteger(amount) || amount < 1) return { error: "A whole number of coins, please." };
  const user = await User.findOne({ username: to }).select("username casinoApproved").lean();
  if (user == null || !access.approved(user)) return { error: "There's no such player in the casino." };
  const world = worldOf(from);
  // Season coins only to who plays in the season
  if (world === "season" && seasons().joined(to) !== true) return { error: `${to} isn't in the season - season coins only go to players in it.` };
  const wallet = world === "season" ? coins.season : coins;
  const coin = world === "season" ? "" : "🪙 ";
  const before = await status(from, world);
  if (amount > before.left) return { error: before.left > 0 ? `You can give ${coin}${before.left.toLocaleString("en-US")} more today (of ${before.limit.toLocaleString("en-US")} a day).` : `You gave the most you can today (${coin}${before.limit.toLocaleString("en-US")} a day) - more tomorrow.` };
  if (!(await wallet.spend(from, amount, { reason: "gift sent", note: "to " + to }))) return { error: "You don't have that many coins." };
  await wallet.add(to, amount, { reason: "gift received", note: "from " + from });
  notify(to, "giftReceived", { from: from, amount: amount, world: world, coinIcon: world === "season" ? seasons().publicSeason(seasons().running()).coinIcon : null });
  return { coins: (await wallet.get(from)).coins, left: before.left - amount, world: world };
}

module.exports = { status, give, worldOf };
