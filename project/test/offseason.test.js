const test = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const CoinLog = require("../models/CoinLog");
const config = require("../game/config");
const days = require("../game/days");
const coins = require("../game/coins");
const inPlay = require("../game/in_play");
const cashback = require("../game/cashback");
const offseason = require("../game/offseason");

const DAY = 24 * 3600 * 1000;

function withMode(mode, refill, fn, wait = 0) {
  const before = { mode: config.OFFSEASON_MODE, refill: config.OFFSEASON_REFILL, wait: config.OFFSEASON_REFILL_WAIT };
  Object.assign(config, { OFFSEASON_MODE: mode, OFFSEASON_REFILL: refill, OFFSEASON_REFILL_WAIT: wait });
  return Promise.resolve(fn()).finally(() => {
    Object.assign(config, { OFFSEASON_MODE: before.mode, OFFSEASON_REFILL: before.refill, OFFSEASON_REFILL_WAIT: before.wait });
    offseason.reset();
  });
}

test("outside seasons, second chance: a balance at 0 is filled up right away - every time, only with nothing in play", () =>
  withMode("chance", 20000, async () => {
    h.addUser("broke");
    h.setCoins("broke", 0);
    // The daily bonus mode: nothing happens
    config.OFFSEASON_MODE = "bonus";
    assert.strictEqual(await offseason.check("broke"), 0);
    config.OFFSEASON_MODE = "chance";
    // Still coins: nothing
    h.setCoins("broke", 5);
    assert.strictEqual(await offseason.check("broke"), 0);
    // A bet still running: not yet - it is looked at again when it is over
    h.setCoins("broke", 0);
    let running = true;
    inPlay.register("test-game", (name) => running && name === "broke");
    try {
      assert.strictEqual(await offseason.check("broke"), 0);
      assert.strictEqual(h.coinsOf("broke"), 0);
      running = false;
      await h.wait(1800);
      assert.strictEqual(h.coinsOf("broke"), 20000, "filled up when the bet was over");
    } finally {
      inPlay.register("test-game", () => false);
    }
    const logged = await CoinLog.findOne({ username: "broke", reason: "second chance" }).lean();
    assert.strictEqual(logged.amount, 20000);
    // Every time it hits 0 again (a change of the balance is enough)
    h.setCoins("broke", 0);
    coins.notify("broke");
    await h.wait(100);
    assert.strictEqual(h.coinsOf("broke"), 20000, "again");
  }));

test("outside seasons, second chance: at most once every OFFSEASON_REFILL_WAIT minutes - after it, filled up", () =>
  withMode(
    "chance",
    20000,
    async () => {
      const User = require("../models/User");
      h.addUser("waiter");
      h.setCoins("waiter", 0);
      assert.strictEqual(await offseason.check("waiter"), 20000);
      // At 0 again right away: waits - the page knows how long
      h.setCoins("waiter", 0);
      assert.strictEqual(await offseason.check("waiter"), 0);
      const info = await coins.get("waiter");
      assert.ok(info.refillIn > 29 * 60000 && info.refillIn <= 30 * 60000, "about 30 min left");
      assert.strictEqual(info.refillWait, 30);
      // The wait is over (the last one 31 min ago): filled up
      await User.updateOne({ username: "waiter" }, { $set: { refillAt: new Date(Date.now() - 31 * 60000) } });
      assert.strictEqual(await offseason.check("waiter"), 20000);
      // The admin sets no wait: right away again
      config.OFFSEASON_REFILL_WAIT = 0;
      h.setCoins("waiter", 0);
      assert.strictEqual(await offseason.check("waiter"), 20000);
    },
    30,
  ));

test("outside seasons, second chance: no daily bonus and no cashback", () =>
  withMode("chance", 20000, async () => {
    h.addUser("nobonus");
    h.setCoins("nobonus", 1000);
    const info = await coins.get("nobonus");
    assert.strictEqual(info.bonus, false);
    assert.strictEqual(info.bonusOff, true);
    assert.strictEqual(await coins.claim("nobonus"), 0);
    assert.strictEqual(h.coinsOf("nobonus"), 1000);
    // Cashback: the day counts as done, nothing paid
    cashback.reset();
    const today = days.dayStart(Date.parse("2026-11-03T12:00:00Z"));
    await CoinLog.create({ username: "nobonus", amount: -5000, reason: "slots bet", at: new Date(today - DAY / 2) });
    assert.deepStrictEqual(await cashback.payDay("normal", today + 60 * 1000), []);
    assert.strictEqual(h.coinsOf("nobonus"), 1000);
    // Back to the daily bonus: claimable again
    config.OFFSEASON_MODE = "bonus";
    assert.ok((await coins.claim("nobonus")) > 0);
    cashback.reset();
  }));

test("outside seasons, second chance: the daily streaks are safe - the days of the pause don't count as missed", async () => {
  const User = require("../models/User");
  const streak = require("../game/streak");
  h.addUser("streaky");
  h.addUser("lapsed");
  const day = (n) => days.dayStart(Date.parse("2026-11-10T12:00:00Z")) + n * DAY + 12 * 3600 * 1000;
  // streaky claimed on the day the pause began (day 0), lapsed two days before it
  await User.updateOne({ username: "streaky" }, { $set: { coinBonusAt: new Date(day(0)), coinStreak: 4 } });
  await User.updateOne({ username: "lapsed" }, { $set: { coinBonusAt: new Date(day(-2)), coinStreak: 2 } });
  // The pause from day 0 to day 9 (the daily bonus is back on day 9)
  assert.ok((await offseason.keepStreaks(day(0), day(9))) >= 2);
  const after = await User.findOne({ username: "streaky" }).lean();
  assert.strictEqual(days.dayNumber(after.coinBonusAt.getTime()), days.dayNumber(day(8)), "as if claimed yesterday");
  assert.strictEqual(streak.dayFor(after.coinBonusAt, 4, day(9)), 5, "the streak goes on with day 5");
  // (a day missed before the pause stays missed)
  const lapsed = await User.findOne({ username: "lapsed" }).lean();
  assert.strictEqual(days.dayNumber(lapsed.coinBonusAt.getTime()), days.dayNumber(day(7)));
  // The switch itself: on - the pause starts; off - it ends (same day: nothing to move)
  await withMode("chance", 20000, async () => {
    await offseason.sync(day(20));
    config.OFFSEASON_MODE = "bonus";
    assert.strictEqual(await offseason.sync(day(20)), 0);
  });
});
