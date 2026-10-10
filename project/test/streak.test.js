const test = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const config = require("../game/config");
const coins = require("../game/coins");
const streak = require("../game/streak");
const days = require("../game/days");

const DAY = 24 * 3600 * 1000;

test("streak: the free coins grow day after day - a day missed starts over, the grace lets one pass", async () => {
  await streak.update({ on: true, rewards: [100, 150, 200], after: "stay", grace: 0 });
  const bonus = config.DAILY_BONUS;
  const noon = days.dayStart(Date.parse("2026-10-06T10:00:00Z")) + 12 * 3600 * 1000;
  h.addUser("sam");
  h.setCoins("sam", 0);
  const paid = [];
  for (let d = 0; d < 5; d++) paid.push(await coins.claim("sam", noon + d * DAY));
  assert.deepStrictEqual(paid, [bonus, bonus * 1.5, bonus * 2, bonus * 2, bonus * 2], "the last day stays");
  assert.strictEqual(h.userOf("sam").coinStreak, 5);
  assert.strictEqual(await coins.claim("sam", noon + 4 * DAY + 1000), 0, "once a day");

  // A day missed: day 1 again
  assert.strictEqual(await coins.claim("sam", noon + 6 * DAY), bonus);
  // With a grace of 1: a day off is fine (the streak goes on)
  await streak.update({ grace: 1 });
  assert.strictEqual(await coins.claim("sam", noon + 8 * DAY), bonus * 1.5);
  // ... two are not
  assert.strictEqual(await coins.claim("sam", noon + 11 * DAY), bonus);

  // What the pages get: the flame (day reached) and what a claim now pays
  const info = coins.streakInfo(h.userOf("sam"), noon + 12 * DAY);
  assert.deepStrictEqual([info.day, info.next, info.base], [1, 2, bonus]);
  assert.deepStrictEqual(coins.streakInfo(h.userOf("sam"), noon + 11 * DAY + 1000).next, null, "claimed today");
  await streak.reset();
});

test("streak: after the last day it can start again; off - every day the plain bonus; bad values are refused", async () => {
  await streak.update({ on: true, rewards: [100, 300], after: "restart", grace: 0 });
  assert.deepStrictEqual([1, 2, 3, 4].map(streak.percentFor), [100, 300, 100, 300]);
  await streak.update({ on: false });
  assert.deepStrictEqual([1, 2, 3].map(streak.percentFor), [100, 100, 100]);
  assert.ok(streak.check({ rewards: [] }).error);
  assert.ok(streak.check({ rewards: [100, -5] }).error);
  assert.ok(streak.check({ rewards: Array(31).fill(100) }).error);
  assert.ok(streak.check({ after: "never" }).error);
  assert.ok(streak.check({ grace: 8 }).error);
  // Saved: back after a restart
  await streak.update({ on: true, rewards: [100, 250], after: "stay", grace: 2 });
  await streak.reset();
  assert.deepStrictEqual(streak.current().rewards, streak.DEFAULTS.rewards);
});

test("streak: the normal casino and the seasons have their own settings (an old saved setting counts for both)", async () => {
  await streak.reset();
  await streak.update({ on: true, rewards: [100, 500], after: "stay", grace: 0 }, "season");
  assert.deepStrictEqual([streak.percentFor(2), streak.percentFor(2, "season")], [streak.DEFAULTS.rewards[1], 500]);
  assert.deepStrictEqual(streak.current("season").rewards, [100, 500]);
  assert.deepStrictEqual(streak.current().rewards, streak.DEFAULTS.rewards, "the casino's stays");
  await streak.update({ on: false }, "normal");
  assert.strictEqual(streak.percentFor(2), 100);
  assert.strictEqual(streak.percentFor(2, "season"), 500, "off only in the casino");
  // Saved before the worlds had their own: both get it
  const Setting = require("../models/Setting");
  await Setting.updateOne({ key: "admin:streak" }, { $set: { value: { on: true, rewards: [100, 200, 300], after: "stay", grace: 1 } } }, { upsert: true });
  await streak.load();
  assert.deepStrictEqual([streak.current().rewards, streak.current("season").rewards], [[100, 200, 300], [100, 200, 300]]);
  await streak.reset();
});
