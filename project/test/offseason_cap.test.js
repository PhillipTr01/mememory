const test = require("node:test");
const assert = require("node:assert");
const config = require("../game/config");
const limits = require("../game/limits");

test("second chance can turn off the max bet by balance outside of seasons only", () => {
  const before = { mode: config.OFFSEASON_MODE, off: config.OFFSEASON_NO_CAP, share: config.BET_CAP_SHARE };
  try {
    config.BET_CAP_SHARE = 20;
    config.OFFSEASON_MODE = "chance";
    config.OFFSEASON_NO_CAP = false;
    assert.ok(limits.capRule("", "jackpot"));
    config.OFFSEASON_NO_CAP = true;
    assert.strictEqual(limits.capRule("", "jackpot"), null);
    assert.strictEqual(limits.capRule("", "slots"), null);
    assert.strictEqual(limits.betCap(1e9, "", "slots"), Infinity);
    // (a season world keeps its cap)
    const seasonWorld = require("../game/worlds").SEASONS[0];
    assert.ok(limits.capRule(seasonWorld, "jackpot"));
    // (the daily bonus mode: the cap counts again)
    config.OFFSEASON_MODE = "bonus";
    assert.ok(limits.capRule("", "jackpot"));
  } finally {
    config.OFFSEASON_MODE = before.mode;
    config.OFFSEASON_NO_CAP = before.off;
    config.BET_CAP_SHARE = before.share;
  }
});
