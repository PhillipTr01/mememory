const test = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const CoinLog = require("../models/CoinLog");
const config = require("../game/config");
const days = require("../game/days");
const cashback = require("../game/cashback");

const DAY = 24 * 3600 * 1000;

test("cashback: after midnight a share of the net loss of the day before comes back - once; winners and other kinds get nothing", async () => {
  cashback.reset();
  const today = days.dayStart(Date.parse("2026-10-12T12:00:00Z"));
  const yesterday = today - DAY / 2;
  h.addUser("loser");
  h.addUser("winner");
  h.setCoins("loser", 1000);
  h.setCoins("winner", 1000);
  const log = (username, amount, reason, at) => CoinLog.create({ username, amount, reason, at: new Date(at) });
  // loser: -10,000 in bets, 3,000 back from wins and a refund - net -7,000
  await log("loser", -6000, "slots bet", yesterday);
  await log("loser", -4000, "roulette bet", yesterday);
  await log("loser", 2000, "slots win", yesterday);
  await log("loser", 1000, "roulette refund", yesterday);
  // not a game: doesn't count; and today's bets count tomorrow
  await log("loser", -50000, "shop", yesterday);
  await log("loser", -9000, "slots bet", today + 1000);
  // winner: +500 net
  await log("winner", -1000, "baucua bet", yesterday);
  await log("winner", 1500, "baucua win", yesterday);
  const before = { percent: config.CASHBACK_PERCENT, max: config.CASHBACK_MAX };
  Object.assign(config, { CASHBACK_PERCENT: 10, CASHBACK_MAX: 0 });
  try {
    const paid = await cashback.payDay("normal", today + 60 * 1000);
    assert.deepStrictEqual(paid.map((p) => [p.username, p.loss, p.amount]), [["loser", 7000, 700]]);
    assert.strictEqual(h.coinsOf("loser"), 1700);
    assert.strictEqual(h.coinsOf("winner"), 1000);
    assert.deepStrictEqual(await cashback.payDay("normal", today + 2 * 60 * 1000), [], "once a day");
    // The cap - and off
    config.CASHBACK_MAX = 500;
    assert.strictEqual(cashback.amountFor(7000, "normal"), 500);
    config.CASHBACK_PERCENT = 0;
    assert.strictEqual(cashback.amountFor(7000, "normal"), 0);
    // The season world without a season: nothing
    assert.deepStrictEqual(await cashback.payDay("season", today + 60 * 1000), []);
  } finally {
    Object.assign(config, { CASHBACK_PERCENT: before.percent, CASHBACK_MAX: before.max });
    cashback.reset();
  }
});

test("cashback in a season: the coins of second chances never count - the same bad day pays the same, with or without second chances", async () => {
  cashback.reset();
  const seasons = require("../game/seasons");
  const coins = require("../game/coins");
  seasons.reset();
  config.SEASON_CLOSE_WAIT = 0;
  const today = days.dayStart(Date.now());
  const yesterday = today - DAY / 2;
  const s = (await seasons.create({ name: "Fair", icon: "⚖️", start: today - 2 * DAY, end: today + 5 * DAY, budget: 50000, every: 0, secondChances: 2, chanceDelay: 0 })).season;
  await seasons.tick(today - 2 * DAY + 1000);
  for (const name of ["cb_plain", "cb_chance", "cb_later"]) {
    h.addUser(name);
    await seasons.join(name, today - 2 * DAY + 2000, s.id);
  }
  const era = coins.era("season");
  const log = (username, amount, reason, at) => CoinLog.create({ username, amount, reason, at: new Date(at), era });
  // cb_plain: loses 50,000 of the budget and stops
  await log("cb_plain", -50000, "slots bet", yesterday);
  // cb_chance: loses the 50,000 too, takes a second chance (+50,000) and loses that as well - the same day
  await log("cb_chance", -50000, "slots bet", yesterday);
  await log("cb_chance", 50000, "second chance", yesterday + 1000);
  await log("cb_chance", -50000, "roulette bet", yesterday + 2000);
  // cb_later: a second chance the day before yesterday, its coins lost yesterday (with 20,000 of its own)
  await log("cb_later", -50000, "slots bet", yesterday - DAY);
  await log("cb_later", 50000, "second chance", yesterday - DAY + 1000);
  await log("cb_later", -70000, "slots bet", yesterday);
  const before = config.CASHBACK_PERCENT;
  config.CASHBACK_PERCENT = 10;
  try {
    const paid = await cashback.payDay("season", today + 60 * 1000);
    const by = Object.fromEntries(paid.map((p) => [p.username, [p.loss, p.amount]]));
    assert.deepStrictEqual(by.cb_plain, [50000, 5000]);
    assert.deepStrictEqual(by.cb_chance, [50000, 5000], "the second chance's 50,000 don't count - the same as cb_plain");
    assert.deepStrictEqual(by.cb_later, [20000, 2000], "the second chance's coins are lost first - only the rest counts");
  } finally {
    config.CASHBACK_PERCENT = before;
    cashback.reset();
    seasons.reset();
  }
});
