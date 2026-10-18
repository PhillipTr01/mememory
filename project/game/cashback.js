const CoinLog = require("../models/CoinLog");
const Setting = require("../models/Setting");
const config = require("./config");
const coins = require("./coins");
const days = require("./days");
const limits = require("./limits");
const slots = require("./season_slots");

/*
 * Daily cashback: after midnight every player gets a share (CASHBACK_PERCENT, at most CASHBACK_MAX - 0: no
 * cap) of what they lost in the games the day before - the net loss: every bet, minus what came back (wins,
 * refunds, cash-outs). Per world: the normal casino in 🪙, the running season in its coins (its own values).
 * Each day is paid once (kept in the settings - a restart doesn't pay it twice).
 *
 * A season's second chances: their coins never count for the cashback - a loss counts only once the coins
 * of the player's second chances are gone (they are lost first). So who used second chances doesn't get
 * more cashback for the same bad day than who didn't. Kept per season: how much of each player's second
 * chances was lost already (state.chanceLost[era][username]).
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
  "runner bet", "runner win",
];
const DAY = 24 * 3600 * 1000;

// the last day paid (days.dayNumber) per world ("normal", the season slots)
const emptyState = () => ({ normal: null, ...Object.fromEntries(slots.KEYS.map((key) => [key, null])), chanceLost: {} });
let state = emptyState();
let timer = null;

async function load() {
  const row = await Setting.findOne({ key: KEY }).lean();
  if (row && row.value && typeof row.value === "object") {
    state = { ...emptyState(), ...Object.fromEntries(Object.keys(emptyState()).map((key) => [key, row.value[key] ?? null])) };
    if (!state.chanceLost || typeof state.chanceLost !== "object") state.chanceLost = {};
  }
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
  const era = slots.isSeason(world) ? coins.era(world) : null;
  if (slots.isSeason(world) && !era) return [];
  const match = { reason: { $in: GAME_REASONS }, at: { $gte: new Date(from), $lt: new Date(to) }, ...(era ? { era: era } : coins.eraFilter()) };
  const rows = await CoinLog.aggregate([{ $match: match }, { $group: { _id: "$username", net: { $sum: "$amount" } } }]);
  return rows.map((row) => ({ username: row._id, net: row.net }));
}

// The coins of a season's second chances a player got until `to`: {username: coins}
async function chanceCoins(era, to) {
  const rows = await CoinLog.aggregate([{ $match: { reason: "second chance", era: era, at: { $lt: new Date(to) } } }, { $group: { _id: "$username", coins: { $sum: "$amount" } } }]);
  return new Map(rows.map((row) => [row._id, row.coins]));
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
  // Outside of seasons with "second chance" (game/offseason.js): no cashback (the day counts as done)
  if (world === "normal" && config.OFFSEASON_MODE === "chance") return [];
  const wallet = coins.wallet(world);
  const paid = [];
  // (a season: the coins of its second chances are lost first - they never count)
  const era = slots.isSeason(world) ? coins.era(world) : null;
  const chances = era ? await chanceCoins(era, to) : null;
  if (era) {
    // (only the running season of each slot is kept - the ones over are gone)
    const eras = new Set(slots.KEYS.map((key) => coins.era(key)).filter(Boolean));
    for (const old of Object.keys(state.chanceLost)) if (!eras.has(old)) delete state.chanceLost[old];
    state.chanceLost[era] = state.chanceLost[era] || {};
  }
  let changedChances = false;
  for (const row of await results(world, from, to)) {
    let loss = -row.net;
    if (era && loss > 0) {
      const lostBefore = state.chanceLost[era][row.username] || 0;
      const left = Math.max(0, (chances.get(row.username) || 0) - lostBefore);
      const fromChances = Math.min(loss, left);
      if (fromChances > 0) {
        state.chanceLost[era][row.username] = lostBefore + fromChances;
        changedChances = true;
        loss -= fromChances;
      }
    }
    const amount = amountFor(loss, world);
    if (amount <= 0) continue;
    if (!(await wallet.add(row.username, amount, { reason: "cashback", note: `${rule(world).percent}% of ${loss.toLocaleString("en-US")} lost`, quiet: true }))) continue;
    wallet.notify(row.username);
    paid.push({ username: row.username, loss: loss, amount: amount });
    require("./notices").send(row.username, "cashback", { amount: amount, loss: loss, percent: rule(world).percent, world: world, coinIcon: slots.isSeason(world) ? seasonCoinIcon(world) : null });
  }
  if (changedChances) await save();
  return paid;
}

function seasonCoinIcon(world) {
  try {
    const seasons = require("./seasons");
    const running = seasons.running(world);
    return running ? seasons.publicSeason(running).coinIcon || null : null;
  } catch (error) {
    return null;
  }
}

async function tick(now = Date.now()) {
  for (const world of ["normal", ...slots.KEYS]) {
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
  state = emptyState();
}

module.exports = { GAME_REASONS, amountFor, results, payDay, tick, start, stop, load, reset, rule };
