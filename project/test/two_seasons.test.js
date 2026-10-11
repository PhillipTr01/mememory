const { test } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
require("../game/config").SEASON_CLOSE_WAIT = 0; // the seasons start right away in the tests
const seasons = require("../game/seasons");
const coins = require("../game/coins");
const worlds = require("../game/worlds");
const limits = require("../game/limits");
const config = require("../game/config");

for (const name of ["ts_open", "ts_vip", "ts_late"]) h.addUser(name);

const HOUR = 3600 * 1000;

test("two seasons at once: one for everybody, one for a whitelist - a slot each (world, wallet), a player in both switches between them", async () => {
  seasons.reset();
  h.setCoins("ts_open", 1000);
  h.setCoins("ts_vip", 2000);
  const now = Date.now();
  const general = (await seasons.create({ name: "General", icon: "🌍", start: now - 1000, end: now + 48 * HOUR, budget: 5000, every: 0, wagerX: 0 })).season;
  const vip = (await seasons.create({ name: "VIP", icon: "👑", start: now - 500, end: now + 24 * HOUR, budget: 9000, every: 0, wagerX: 0, accessMode: "whitelist", accessNames: ["ts_vip"] })).season;
  await seasons.tick(now);

  // Both run - each in its own slot
  assert.deepStrictEqual(seasons.runningAll().map((s) => [s.name, s.slot]), [["General", "season"], ["VIP", "season2"]]);
  assert.strictEqual(seasons.running("/season2").id, vip.id);
  assert.strictEqual(seasons.publicSeason(seasons.byId(vip.id)).world, "/season2");
  assert.ok(coins.season2.base().reset === "season-" + vip.id);

  // The whitelist: only ts_vip may join the VIP season
  assert.match((await seasons.join("ts_open", now, vip.id)).error, /closed/);
  assert.strictEqual((await seasons.join("ts_open", now, general.id)).coins, 5000);
  assert.strictEqual((await seasons.join("ts_vip", now, general.id)).coins, 5000);
  assert.strictEqual((await seasons.join("ts_vip", now, vip.id)).coins, 9000);
  // Two wallets apart - the normal one never changes
  const vipUser = h.userOf("ts_vip");
  assert.deepStrictEqual([vipUser.coins, vipUser.seasonCoins, vipUser.season2Coins], [2000, 5000, 9000]);
  assert.deepStrictEqual(seasons.joinedSeasons("ts_vip").map((s) => s.id), [general.id, vip.id]);
  assert.strictEqual((await coins.wallet("/season2").get("ts_vip")).coins, 9000);
  assert.strictEqual((await coins.wallet("/season2").get("ts_open")).joined, false, "not in the VIP season: watching");

  // The world: the last joined - one at a time
  assert.strictEqual(worlds.worldOf("ts_vip"), "/season2");
  assert.strictEqual(worlds.worldOf("ts_open"), "/season");
  assert.deepStrictEqual(await seasons.switchWorld("ts_vip", "season"), { world: "season", season: general.id });
  assert.strictEqual(worlds.worldOf("ts_vip"), "/season");
  assert.deepStrictEqual(await seasons.switchWorld("ts_vip", vip.id), { world: "season2", season: vip.id });
  assert.strictEqual(worlds.worldOf("ts_vip"), "/season2");
  assert.match((await seasons.switchWorld("ts_open", "season2")).error, /Join/);

  // A bet in one world: only its wallet
  assert.strictEqual(await coins.wallet("/season2").spend("ts_vip", 4000, { reason: "other" }), true);
  assert.deepStrictEqual([h.userOf("ts_vip").seasonCoins, h.userOf("ts_vip").season2Coins], [5000, 5000]);

  // Each leaderboard: its own players
  assert.deepStrictEqual((await seasons.standings(general.id)).map((r) => r.username).sort(), ["ts_open", "ts_vip"]);
  assert.deepStrictEqual((await seasons.standings("season2")).map((r) => [r.username, r.coins]), [["ts_vip", 5000]]);

  // The VIP season ends: its coins to the normal wallet - the general one goes on
  await seasons.tick(now + 25 * HOUR);
  assert.strictEqual(seasons.byId(vip.id).ended, true);
  assert.strictEqual(seasons.byId(vip.id).final.rows[0].username, "ts_vip");
  assert.strictEqual(h.coinsOf("ts_vip"), 7000);
  assert.strictEqual(h.userOf("ts_vip").seasonCoins, 5000, "the general season's coins stay");
  assert.strictEqual(worlds.worldOf("ts_vip"), "", "the world of the VIP season is gone: the normal casino");
  assert.deepStrictEqual(seasons.runningAll().map((s) => s.name), ["General"]);
  assert.strictEqual(coins.era("season2"), null);
  seasons.reset();
});

test("two seasons at once: a third waits for a free slot; every season has its own limits in its world", async () => {
  seasons.reset();
  const now = Date.now();
  const a = (await seasons.create({ name: "A", icon: "🅰️", start: now - 1000, end: now + 2 * HOUR, budget: 100, every: 0 })).season;
  const b = (await seasons.create({ name: "B", icon: "🅱️", start: now - 1000, end: now + 4 * HOUR, budget: 100, every: 0 })).season;
  const c = (await seasons.create({ name: "C", icon: "©️", start: now + 3 * HOUR, end: now + 6 * HOUR, budget: 100, every: 0 })).season;
  assert.ok(c, "a third after the first one ends");
  const before = config.SEASON_LIMITS;
  config.SEASON_LIMITS = { [a.id]: { SLOTS_MAX_BET: 500 }, [c.id]: { SLOTS_MAX_BET: 300 } };
  try {
    await seasons.tick(now);
    assert.deepStrictEqual(seasons.runningAll().map((s) => s.name), ["A", "B"]);
    assert.strictEqual(limits.forWorld("/season").SLOTS_MAX_BET, 500);
    assert.strictEqual(limits.forWorld("/season2").SLOTS_MAX_BET, config.SLOTS_MAX_BET, "B: no own limits");
    // A ends, C takes its slot
    await seasons.tick(now + 3 * HOUR);
    await seasons.tick(now + 3 * HOUR + 10);
    assert.deepStrictEqual(seasons.runningAll().map((s) => [s.name, s.slot]), [["C", "season"], ["B", "season2"]]);
    assert.strictEqual(limits.forWorld("/season").SLOTS_MAX_BET, 300, "the slot's world: the limits of the season in it now");
    assert.ok(b);
  } finally {
    config.SEASON_LIMITS = before;
    seasons.reset();
  }
});
