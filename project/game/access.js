const EventEmitter = require("events");
const User = require("../models/User");
const Setting = require("../models/Setting");
const coins = require("./coins");
const config = require("./config");
const days = require("./days");

/*
 * The secret casino is only for players the admin let in (in the admin panel).
 * Who gets in the first time gets the start coins plus every daily bonus
 * missed since the very first player got in - so a late player starts like
 * somebody who was there from the beginning and claimed every bonus.
 */
const FIRST = "casinoFirstApproval";

// "revoked" (username): the open casino pages of the player are closed
const changes = new EventEmitter();
changes.setMaxListeners(0);

function approved(user) {
  return user != null && user.casinoApproved === true;
}

// The day the first player got in (null: nobody yet)
async function firstApproval() {
  const row = await Setting.findOne({ key: FIRST }).lean();
  return row && row.value ? new Date(row.value) : null;
}

async function setFirstApproval(now) {
  try {
    await Setting.create({ key: FIRST, value: new Date(now) });
  } catch (error) {
    // Two approvals at the same time: the other one was first
  }
  return firstApproval();
}

// What a player gets who is let in now: {coins, missed} - a bonus for every day since the day of the first approval (today's one they claim themselves)
function startCoins(first, now = Date.now()) {
  const missed = first == null ? 0 : Math.max(0, days.dayNumber(now) - days.dayNumber(new Date(first).getTime()));
  return { coins: config.START_COINS + missed * config.DAILY_BONUS, missed: missed };
}

// Let a player in: {username, coins, missed, again} or {error}
async function approve(username, now = Date.now()) {
  const user = await User.findOne({ username: username }).select("username casinoApproved casinoApprovedAt").lean();
  if (user == null) return { error: "No such player." };
  if (approved(user)) return { error: "Already approved." };

  // Approved before (and taken out again): no second start money
  if (user.casinoApprovedAt != null) {
    await User.updateOne({ username: username }, { $set: { casinoApproved: true } });
    return { username: username, again: true };
  }

  const first = (await firstApproval()) || (await setFirstApproval(now));
  const start = startCoins(first, now);
  const result = await User.updateOne(
    { username: username, casinoApproved: { $ne: true } },
    { $set: { casinoApproved: true, casinoApprovedAt: new Date(now), coins: start.coins, coinReset: config.COIN_RESET, coinBonusAt: null } },
  );
  if (!(result.nModified > 0 || result.modifiedCount > 0)) return { error: "Already approved." };
  const note = start.missed > 0 ? `approved: ${config.START_COINS.toLocaleString("en-US")} + ${start.missed} missed daily bonus${start.missed === 1 ? "" : "es"}` : "approved";
  coins.log(username, start.coins, "start coins", note);
  coins.notify(username);
  return { username: username, coins: start.coins, missed: start.missed, again: false };
}

// Take a player out again (the coins stay for a later approval)
async function revoke(username) {
  const result = await User.updateOne({ username: username, casinoApproved: true }, { $set: { casinoApproved: false } });
  if (!(result.nModified > 0 || result.modifiedCount > 0)) return { error: "Not approved." };
  changes.emit("revoked", username);
  return { username: username };
}

// Payouts on / off for a player (the open pages update right away)
async function setPayout(username, allowed) {
  const user = await User.findOne({ username: username }).select("username").lean();
  if (user == null) return { error: "No such player." };
  await User.updateOne({ username: username }, { $set: { payoutAllowed: allowed === true } });
  coins.notify(username);
  return { username: username, payout: allowed === true };
}

// A player without access asks for it (on the secret page): shown to the admin as a request
async function request(userId) {
  await User.updateOne(
    { _id: userId, casinoApproved: { $ne: true }, $or: [{ casinoRequestedAt: { $exists: false } }, { casinoRequestedAt: null }] },
    { $set: { casinoRequestedAt: new Date() } },
  );
}

// The admin says no: the request is gone (the player can ask again)
async function decline(username) {
  const result = await User.updateOne({ username: username, casinoApproved: { $ne: true } }, { $set: { casinoRequestedAt: null } });
  if (!(result.nModified > 0 || result.modifiedCount > 0)) return { error: "No such request." };
  return { username: username };
}

module.exports = { approved, approve, revoke, setPayout, request, decline, firstApproval, startCoins, changes };
