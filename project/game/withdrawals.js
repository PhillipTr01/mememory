const Withdrawal = require("../models/Withdrawal");
const testMode = require("./test_mode");
const coins = require("./coins");
const config = require("./config");
const seasons = require("./seasons");

/*
 * Payouts: a player takes coins off the balance, the admin pays them out
 * (somewhere else) and marks them as paid - or rejects them, then the coins
 * go back to the player.
 */

// {ok, withdrawal} or {error}
async function request(username, amount) {
  // The coins of a season are only for the season
  if (seasons.running()) return { error: "Payouts are paused while a season runs." };
  if (testMode.active(username)) return { error: "🧪 Test mode: no payouts with test coins." };
  if (!Number.isInteger(amount) || amount < config.WITHDRAW_MIN) return { error: `At least ${config.WITHDRAW_MIN.toLocaleString("en-US")} coins.` };
  if (amount % config.WITHDRAW_STEP !== 0) return { error: `Only in steps of ${config.WITHDRAW_STEP.toLocaleString("en-US")} coins.` };
  const open = await Withdrawal.countDocuments({ username: username, status: "open" });
  if (open >= config.WITHDRAW_MAX_OPEN) return { error: `At most ${config.WITHDRAW_MAX_OPEN} open payouts at a time.` };
  if (!(await coins.spend(username, amount, { reason: "withdrawal" }))) return { error: "You don't have enough coins." };
  try {
    const withdrawal = await Withdrawal.create({ username: username, amount: amount, status: "open", createdAt: new Date() });
    return { ok: true, withdrawal: shape(withdrawal) };
  } catch (error) {
    // Not saved: the coins go back
    await coins.add(username, amount, { reason: "withdrawal refund", note: "could not be saved" });
    throw error;
  }
}

function shape(w) {
  return { id: String(w._id), username: w.username, amount: w.amount, status: w.status, note: w.note || null, createdAt: w.createdAt, handledAt: w.handledAt || null };
}

async function list(filter, limit) {
  const rows = await Withdrawal.find(filter).sort({ createdAt: -1 }).limit(limit || 50).lean();
  return rows.map(shape);
}

// The admin: "paid" or "reject" (coins back). Only open payouts can be handled.
async function handle(id, action, note) {
  if (!["paid", "reject"].includes(action)) return { error: "Unknown action." };
  const status = action === "paid" ? "paid" : "rejected";
  const withdrawal = await Withdrawal.findOne({ _id: id, status: "open" }).lean();
  if (withdrawal == null) return { error: "No open payout with this id." };
  const result = await Withdrawal.updateOne({ _id: id, status: "open" }, { $set: { status: status, note: note || undefined, handledAt: new Date() } });
  // Somebody (another tab) was faster
  if (!(result.nModified > 0 || result.modifiedCount > 0)) return { error: "This payout was already handled." };
  // (rejected during a season: the coins go to the balance from before the season - back after it)
  if (status === "rejected" && !(await seasons.addToSaved(withdrawal.username, withdrawal.amount))) {
    await coins.add(withdrawal.username, withdrawal.amount, { reason: "withdrawal refund", note: note });
  }
  return { ok: true };
}

module.exports = { request, list, handle };
