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

function withMode(mode, refill, fn) {
  const before = { mode: config.OFFSEASON_MODE, refill: config.OFFSEASON_REFILL };
  Object.assign(config, { OFFSEASON_MODE: mode, OFFSEASON_REFILL: refill });
  return Promise.resolve(fn()).finally(() => {
    Object.assign(config, { OFFSEASON_MODE: before.mode, OFFSEASON_REFILL: before.refill });
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
