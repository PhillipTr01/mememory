const { test } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
require("../game/config").SEASON_CLOSE_WAIT = 0; // the season starts right away in the tests
const leaderboard = require("../game/leaderboard");
const seasons = require("../game/seasons");
const coins = require("../game/coins");
const access = require("../game/access");
const days = require("../game/days");

for (const name of ["anna", "ben", "cleo"]) h.addUser(name);
h.addUser("dora", { approved: false });

test("leaderboard: without a season it is live - the arrows show the change since midnight", async () => {
  seasons.reset();
  h.setCoins("anna", 1000);
  h.setCoins("ben", 5000);
  h.setCoins("cleo", 3000);
  h.setCoins("dora", 99999); // not in the casino: not on the board
  const morning = days.dayStart(Date.parse("2026-10-06T12:00:00Z")) + 9 * 3600 * 1000;

  const first = await leaderboard.view("anna", morning);
  assert.deepStrictEqual(first.rows.map((r) => [r.rank, r.username, r.coins]), [[1, "ben", 5000], [2, "cleo", 3000], [3, "anna", 1000]]);
  assert.ok(first.live && first.nextIn === null && first.season === null);
  assert.strictEqual(first.me.rank, 3);

  // Right away: the new coins, anna went up two places since midnight
  h.setCoins("anna", 9000);
  const later = await leaderboard.view("anna", morning + 60 * 1000);
  assert.deepStrictEqual(later.rows.map((r) => [r.username, r.before]), [["anna", 3], ["ben", 1], ["cleo", 2]]);
  assert.strictEqual(later.updatedAt, morning + 60 * 1000);
});

test("seasons: planned ahead - at the start each player hits Start and gets the budget, at the end the winners with their prizes", async () => {
  seasons.reset();
  const now = Date.now();
  const start = now + 60 * 60 * 1000;
  const end = start + 7 * 24 * 60 * 60 * 1000;
  // What the admin enters is checked
  assert.match((await seasons.create({ name: "", icon: "🔥", start, end, budget: 1000, every: 60 })).error, /name/);
  assert.match((await seasons.create({ name: "S", icon: "🔥", start: end, end: start, budget: 1000, every: 60 })).error, /after the start/);
  assert.match((await seasons.create({ name: "S", icon: "🔥", start, end, budget: 1000, every: 7 })).error, /interval/);
  assert.match((await seasons.create({ name: "S", icon: "🔥", start, end, budget: 1000, every: 60, prizesOn: true, prizes: [] })).error, /at least one/);
  const made = await seasons.create({ name: "Season 1", icon: "🔥", start, end, budget: 50000, every: 60, prizesOn: true, prizes: [{ place: 2, prize: "A meme T-shirt" }, { place: 1, prize: "🏆 The golden pepe" }] });
  assert.strictEqual(made.season.status, "planned");
  assert.deepStrictEqual(made.season.prizes.map((p) => p.place), [1, 2], "sorted by place");
  // Never two at the same time
  assert.match((await seasons.create({ name: "Overlap", icon: "🌊", start: start + 1000, end: end + 1000, budget: 1, every: 0 })).error, /overlaps/);

  // Before the start: nothing changes
  h.setCoins("anna", 1000);
  h.setCoins("ben", 2000);
  await coins.add("ben", 1, { reason: "before the season" });
  h.setCoins("ben", 2000);
  await h.wait(10);
  await seasons.tick(start - 1000);
  assert.strictEqual(h.coinsOf("anna"), 1000);

  // The start: everybody in the casino at 0, watching - until they hit "Start" (not dora - she is not in)
  await seasons.tick(start + 1000);
  assert.strictEqual(seasons.running().id, made.season.id);
  assert.deepStrictEqual(["anna", "ben", "cleo"].map(h.coinsOf), [0, 0, 0]);
  assert.strictEqual(h.coinsOf("dora"), 99999);
  assert.strictEqual(seasons.joined("anna"), false);
  assert.strictEqual(await coins.claimBonus("anna", start + 1500), false, "no daily bonus before the start");
  assert.strictEqual((await coins.get("anna")).joined, false);
  assert.strictEqual((await leaderboard.view("anna", start + 1500)).rows.length, 0, "nobody on the board yet");
  for (const name of ["anna", "ben", "cleo"]) assert.deepStrictEqual(await seasons.join(name, start + 1500), { coins: 50000, missed: 0 });
  assert.match((await seasons.join("anna", start + 1600)).error, /already/);
  assert.match((await seasons.join("dora", start + 1600)).error, /Not in the casino/);
  assert.deepStrictEqual(["anna", "ben", "cleo"].map(h.coinsOf), [50000, 50000, 50000]);
  assert.strictEqual((await coins.get("anna")).joined, true);
  await h.wait(10);
  assert.deepStrictEqual((await leaderboard.view("anna", start + 1700)).rows.map((r) => [r.username, r.coins]), [["anna", 50000], ["ben", 50000], ["cleo", 50000]], "on the board right away");
  // Like a hard reset: the coin history shown starts anew (the one from before is kept apart)
  await h.wait(10);
  const shown = () => h.coinLogs.filter((row) => Object.entries(coins.eraFilter()).every(([key, c]) => (c && c.$exists === false ? row[key] === undefined : row[key] === c)));
  assert.ok(shown().length > 0 && shown().every((row) => row.reason === "season start"));
  // Payouts wait until the season is over
  assert.match((await require("../game/withdrawals").request("anna", 1000)).error, /paused/);
  assert.strictEqual(coins.base().start, 0, "the budget comes with Start");
  await h.wait(10);
  // The daily bonus of the season (changed while it runs)
  assert.strictEqual(coins.dailyBonus(), 1000, "the season setting when none was given");
  assert.ok((await seasons.update(made.season.id, { ...seasons.publicSeason(seasons.running()), dailyBonus: 777 })).season);
  assert.strictEqual(coins.dailyBonus(), 777);
  // A player let in now starts at 0 too - "Start" gives the budget; three days later with the 3 daily bonuses missed
  assert.strictEqual(access.startCoins(null, start + 2000).coins, 0);
  assert.deepStrictEqual(seasons.joinCoins(start + 2000), { coins: 50000, missed: 0 });
  const later = days.dayStart(start) + 3 * 24 * 3600 * 1000 + 5 * 3600 * 1000;
  assert.deepStrictEqual(seasons.joinCoins(later), { coins: 50000 + 3 * 777, missed: 3 });

  // The leaderboard of the season: updated every hour, not in between
  const first = await leaderboard.view("anna", start + 2000);
  assert.ok(!first.live && first.season.name === "Season 1");
  assert.ok(first.nextIn > 59 * 60 * 1000 && first.nextIn <= 60 * 60 * 1000);
  await coins.add("cleo", 30000, { reason: "test" });
  const between = await leaderboard.view("anna", start + 30 * 60 * 1000);
  assert.strictEqual(between.rows[0].coins, 50000, "not yet");
  const update = await leaderboard.view("anna", start + 61 * 60 * 1000);
  assert.deepStrictEqual([update.rows[0].username, update.rows[0].coins], ["cleo", 80000]);

  // The end: the final places with the prizes, the winner page
  await coins.add("ben", 10000, { reason: "test" });
  const ended = new Promise((resolve) => seasons.changes.once("ended", resolve));
  await seasons.tick(end + 1000);
  assert.strictEqual((await ended).name, "Season 1");
  assert.strictEqual(seasons.running(), null);
  const final = leaderboard.final(made.season.id, "anna");
  assert.deepStrictEqual(final.rows.slice(0, 3).map((r) => [r.rank, r.username, r.prize || null]), [[1, "cleo", "🏆 The golden pepe"], [2, "ben", "A meme T-shirt"], [3, "anna", null]]);
  assert.strictEqual(final.season.status, "ended");
  // After the season: the normal leaderboard again (live), with a link to the winners
  const after = await leaderboard.view("anna", end + 2000);
  assert.ok(after.live && after.season === null);
  assert.strictEqual(after.lastSeason.id, made.season.id);
  // The history from before the season is back, the season's own is gone
  await h.wait(10);
  assert.deepStrictEqual(shown().map((row) => row.reason), ["before the season"]);
  // Everybody has the balance from before the season again - with the season's on top; the daily bonus is the normal one again
  assert.deepStrictEqual(["anna", "ben", "cleo"].map(h.coinsOf), [1000 + 50000, 2000 + 60000, 3000 + 80000]);
  assert.strictEqual((await leaderboard.view("anna", end + 3000)).rows[0].coins, 83000);
  assert.strictEqual(coins.dailyBonus(), 2500);
});

test("seasons: a running season can't be deleted, it can end early; start and budget stay", async () => {
  seasons.reset();
  const now = Date.now();
  const made = await seasons.create({ name: "Quick", icon: "⚡", start: now - 1000, end: now + 3600 * 1000, budget: 777, every: 0 });
  await seasons.tick(now);
  assert.strictEqual(seasons.running().name, "Quick");
  assert.match((await seasons.remove(made.season.id)).error, /end it first/);
  assert.match((await seasons.update(made.season.id, { ...made.season, budget: 5 })).error, /can't change/);
  assert.ok((await seasons.update(made.season.id, { ...made.season, name: "Quick one" })).season);
  // The accent color: checked, and on every casino page while the season runs
  assert.match((await seasons.update(made.season.id, { ...made.season, name: "Quick one", color: "purple" })).error, /color/);
  assert.ok((await seasons.update(made.season.id, { ...made.season, name: "Quick one", color: "#9D84C2" })).season);
  assert.match(seasons.accentStyle(), /--mm-accent: #9d84c2; --mm-accent-rgb: 157, 132, 194;/);
  const over = await seasons.endNow(made.season.id);
  assert.strictEqual(seasons.accentStyle(), "", "the gold again after the season");
  assert.strictEqual(over.season.status, "ended");
  assert.ok((await seasons.remove(made.season.id)).ok, "deleted afterwards");
  seasons.reset();
});

test("seasons: before the start the casino closes - running games finish, no new bets, then the wait", async () => {
  seasons.reset();
  const config = require("../game/config");
  const casinoLock = require("../game/casino_lock");
  const now = Date.now() + 1000; // the ticks of the test: after the start
  let busy = true;
  casinoLock.registerRunning("test-game", () => busy);
  const events = [];
  const onClosing = (info) => events.push(info);
  seasons.changes.on("closing", onClosing);
  config.SEASON_CLOSE_WAIT = 60 * 1000;
  try {
    const made = await seasons.create({ name: "Closing", icon: "🚪", start: now - 500, end: now + 3600 * 1000, budget: 900, every: 0 });
    // A round still runs: closed, but no countdown yet
    await seasons.tick(now);
    assert.ok(casinoLock.locked(), "no new bets");
    assert.strictEqual(seasons.running(), null);
    assert.strictEqual(seasons.closingInfo(now).startsIn, null);
    assert.strictEqual(seasons.list().find((x) => x.id === made.season.id).status, "starting");
    // The round is over: one minute, then the season
    busy = false;
    await seasons.tick(now + 5000);
    assert.strictEqual(seasons.closingInfo(now + 5000).startsIn, 60 * 1000);
    await seasons.tick(now + 30 * 1000);
    assert.strictEqual(seasons.running(), null, "still waiting");
    assert.ok(casinoLock.locked());
    await seasons.tick(now + 66 * 1000);
    assert.strictEqual(seasons.running().name, "Closing");
    assert.ok(!casinoLock.locked(), "open again");
    assert.deepStrictEqual(events.map((e) => e.startsIn), [null, 60 * 1000]);
    await seasons.endNow(made.season.id);
  } finally {
    config.SEASON_CLOSE_WAIT = 0;
    busy = false;
    seasons.changes.off("closing", onClosing);
    seasons.reset();
  }
});

test("seasons: second chances - 0 coins and nothing in play, then the budget again; the next one only the next day", async () => {
  seasons.reset();
  const inPlay = require("../game/in_play");
  let playing = false;
  inPlay.register("test", (name) => playing && name === "anna");
  const now = Date.now();
  const made = await seasons.create({ name: "Comeback", icon: "🔁", start: now - 1000, end: now + 30 * 24 * 3600 * 1000, budget: 5000, every: 0, secondChances: 2 });
  assert.strictEqual(made.season.secondChances, 2);
  await seasons.tick(now);
  assert.strictEqual((await seasons.chanceStatus("anna", now)).reason, "notJoined", "only who started the season");
  await seasons.join("anna", now);
  // Still coins: no second chance; the balance from before is shown with the coins
  assert.strictEqual((await seasons.chanceStatus("anna", now)).reason, "coins");
  assert.strictEqual((await coins.get("anna")).stored, seasons.storedOf("anna"));
  assert.ok(seasons.storedOf("anna") != null);
  // Everything lost - but a bet is still in a game
  h.setCoins("anna", 0);
  playing = true;
  assert.strictEqual((await seasons.chanceStatus("anna", now)).reason, "inPlay");
  playing = false;
  const status = await seasons.chanceStatus("anna", now);
  assert.deepStrictEqual([status.can, status.left, status.total], [true, 2, 2]);
  const used = await seasons.useChance("anna", now);
  assert.deepStrictEqual(used, { coins: 5000, left: 1 });
  assert.strictEqual(h.coinsOf("anna"), 5000);
  // Lost again the same day: the next one only tomorrow
  h.setCoins("anna", 0);
  const later = await seasons.chanceStatus("anna", now + 1000);
  assert.strictEqual(later.reason, "cooldown");
  assert.strictEqual(later.nextAt, days.nextDay(now));
  assert.match((await seasons.useChance("anna", now + 1000)).error, /tomorrow/);
  // The next day: the last one
  const tomorrow = days.nextDay(now) + 1000;
  assert.strictEqual((await seasons.useChance("anna", tomorrow)).left, 0);
  h.setCoins("anna", 0);
  assert.strictEqual((await seasons.chanceStatus("anna", days.nextDay(tomorrow) + 1000)).reason, "used");
  // A player who started the season a day later: the first one only from the day after
  h.addUser("newbie");
  await seasons.join("newbie", tomorrow);
  h.setCoins("newbie", 0);
  const newbie = await seasons.chanceStatus("newbie", tomorrow + 1000);
  assert.deepStrictEqual([newbie.reason, newbie.nextAt], ["cooldown", days.nextDay(tomorrow)]);
  seasons.reset();
});
