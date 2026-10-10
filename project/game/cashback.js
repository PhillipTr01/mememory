const CoinLog = require("../models/CoinLog");
const Setting = require("../models/Setting");
const config = require("./config");
const coins = require("./coins");
const days = require("./days");
const limits = require("./limits");

/*
 * Daily cashback: after midnight every player gets a share (CASHBACK_PERCENT, at most CASHBACK_MAX - 0: no
 * cap) of what they lost in the games the day before - the net loss: every bet, minus what came back (wins,
 * refunds, cash-outs). Per world: the normal casino in 🪙, the running season in its coins (its own values).
 * Each day is paid once (kept in the settings - a restart doesn't pay it twice).
 */
const KEY = "cashback";
// What counts: the bets of the games and everything they give back
const GAME_REASONS = [
  "jackpot bet", "jackpot win", "jackpot refund",
  "battle", "battle win", "battle refund",
  "poker buy-in", "poker chips", "poker cash-out", "poker refund",
  "blackjack bet", "blackjack win", "blackjack refund",
  "slots bet", "slots win",
  "roulette bet", "roulette win", "roulette refund",
  "baucua bet", "baucua win", "baucua refund",
];
const DAY = 24 * 3600 * 1000;

let state = { normal: null, season: null }; // the last day paid (days.dayNumber) per world
let timer = null;

async function load() {
  const row = await Setting.findOne({ key: KEY }).lean();
  if (row && row.value && typeof row.value === "object") state = { normal: row.value.normal ?? null, season: row.value.season ?? null };
}

async function save() {
  await Setting.updateOne({ key: KEY }, { $set: { value: state } }, { upsert: true });
}

// The share and the cap of a world now
function rule(world) {
  const L = limits.forWorld(world);
  return { percent: Math.max(0, Number(L.CASHBACK_PERCENT) || 0), max: Math.max(0, Number(L.CASHBACK_MAX) || 0) };
}

// The cashback of one player for a net loss
function amountFor(loss, world) {
  const r = rule(world);
  if (!(loss > 0) || r.percent <= 0) return 0;
  const amount = Math.floor((loss * r.percent) / 100);
  return r.max > 0 ? Math.min(amount, r.max) : amount;
}

// The net results of a day (from - to) in a world: [{username, net}] (net < 0: lost)
async function results(world, from, to) {
  const era = world === "season" ? coins.era() : null;
  if (world === "season" && !era) return [];
  const match = { reason: { $in: GAME_REASONS }, at: { $gte: new Date(from), $lt: new Date(to) }, ...(era ? { era: era } : coins.eraFilter()) };
  const rows = await CoinLog.aggregate([{ $match: match }, { $group: { _id: "$username", net: { $sum: "$amount" } } }]);
  return rows.map((row) => ({ username: row._id, net: row.net }));
}

/*
 * Pays the day before `now` in a world (once) -> [{username, loss, amount}]. A new day without a payment
 * yet: only the day just over (days further back are skipped - nobody waits for them).
 */
async function payDay(world, now = Date.now()) {
  const today = days.dayNumber(now);
  if (state[world] != null && state[world] >= today - 1) return [];
  const to = days.dayStart(now);
  const from = days.dayStart(to - DAY / 2);
  // (marked first - two runs at once never pay twice)
  state[world] = today - 1;
  await save();
  const wallet = world === "season" ? coins.season : coins;
  const paid = [];
  for (const row of await results(world, from, to)) {
    const loss = -row.net;
    const amount = amountFor(loss, world);
    if (amount <= 0) continue;
    if (!(await wallet.add(row.username, amount, { reason: "cashback", note: `${rule(world).percent}% of ${loss.toLocaleString("en-US")} lost`, quiet: true }))) continue;
    wallet.notify(row.username);
    paid.push({ username: row.username, loss: loss, amount: amount });
    require("./notices").send(row.username, "cashback", { amount: amount, loss: loss, percent: rule(world).percent, world: world, coinIcon: world === "season" ? seasonCoinIcon() : null });
  }
  return paid;
}

function seasonCoinIcon() {
  try {
    const seasons = require("./seasons");
    const running = seasons.running();
    return running ? seasons.publicSeason(running).coinIcon || null : null;
  } catch (error) {
    return null;
  }
}

async function tick(now = Date.now()) {
  for (const world of ["normal", "season"]) {
    try {
      await payDay(world, now);
    } catch (error) {
      console.error(`[cashback] Could not pay the ${world} cashback:`, error);
    }
  }
}

// Checked every minute - the first time a day is new, the day before is paid
function start() {
  stop();
  tick();
  timer = setInterval(tick, 60 * 1000);
  timer.unref();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

// (tests, the hard reset)
function reset() {
  state = { normal: null, season: null };
}

module.exports = { GAME_REASONS, amountFor, results, payDay, tick, start, stop, load, reset, rule };
