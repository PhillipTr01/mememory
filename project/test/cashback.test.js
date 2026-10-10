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
