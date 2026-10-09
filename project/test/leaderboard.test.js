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

// The coins of the season world (user.seasonCoins)
const seasonCoinsOf = (name) => h.userOf(name).seasonCoins;
const setSeasonCoins = (name, amount) => Object.assign(h.userOf(name), { seasonCoins: amount, seasonReset: coins.season.base().reset });

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

test("seasons: a world of its own - at the start everybody may join (the budget, the season world), the normal coins never change; at the end the winners with their prizes, the season's coins go to the normal wallet", async () => {
  seasons.reset();
  const now = Date.now();
  const start = now + 60 * 60 * 1000;
  const end = start + 7 * 24 * 60 * 60 * 1000;
  // What the admin enters is checked
  assert.match((await seasons.create({ name: "", icon: "🔥", start, end, budget: 1000, every: 60 })).error, /name/);
  assert.match((await seasons.create({ name: "S", icon: "🔥", start: end, end: start, budget: 1000, every: 60 })).error, /after the start/);
  assert.match((await seasons.create({ name: "S", icon: "🔥", start, end, budget: 1000, every: 7 })).error, /interval/);
  assert.match((await seasons.create({ name: "S", icon: "🔥", start, end, budget: 1000, every: 60, prizesOn: true, prizes: [] })).error, /at least one/);
  const made = await seasons.create({ name: "Season 1", icon: "🔥", start, end, budget: 50000, every: 60, wagerX: 0, prizesOn: true, prizes: [{ place: 2, prize: "A meme T-shirt" }, { place: 1, prize: "🏆 The golden pepe" }] });
  assert.strictEqual(made.season.status, "planned");
  assert.deepStrictEqual(made.season.prizes.map((p) => p.place), [1, 2], "sorted by place");
  assert.deepStrictEqual(made.season.access, { mode: "all", names: [] }, "open for everybody");
  // Never two at the same time
  assert.match((await seasons.create({ name: "Overlap", icon: "🌊", start: start + 1000, end: end + 1000, budget: 1, every: 0 })).error, /overlaps/);

  h.setCoins("anna", 1000);
  h.setCoins("ben", 2000);
  h.setCoins("cleo", 3000);
  await seasons.tick(start - 1000);
  assert.strictEqual(seasons.running(), null);

  // The start: the season world opens - the normal coins stay as they are
  const started = new Promise((resolve) => seasons.changes.once("started", resolve));
  await seasons.tick(start + 1000);
  assert.strictEqual((await started).name, "Season 1");
  assert.strictEqual(seasons.running().id, made.season.id);
  assert.deepStrictEqual(["anna", "ben", "cleo"].map(h.coinsOf), [1000, 2000, 3000]);
  assert.strictEqual(seasons.joined("anna"), false);
  assert.strictEqual(seasons.inSeasonWorld("anna"), false);
  assert.strictEqual(await coins.season.claimBonus("anna", start + 1500), false, "no season bonus before joining");
  assert.strictEqual((await coins.season.get("anna")).joined, false);
  assert.strictEqual((await coins.get("anna")).coins, 1000, "the normal casino as before");
  assert.strictEqual((await leaderboard.view("anna", start + 1500)).season, null, "the normal leaderboard in the normal world");
  assert.match((await seasons.switchWorld("anna", "season")).error, /Join/);

  // Joining: the budget in the season wallet - and the season world
  const moved = [];
  const onWorld = (name, world) => moved.push([name, world]);
  seasons.changes.on("world", onWorld);
  for (const name of ["anna", "ben", "cleo"]) assert.deepStrictEqual(await seasons.join(name, start + 1500), { coins: 50000, missed: 0 });
  seasons.changes.off("world", onWorld);
  assert.deepStrictEqual(moved, [["anna", "/season"], ["ben", "/season"], ["cleo", "/season"]]);
  assert.match((await seasons.join("anna", start + 1600)).error, /already/);
  assert.match((await seasons.join("dora", start + 1600)).error, /Not in the casino/);
  assert.deepStrictEqual(["anna", "ben", "cleo"].map(seasonCoinsOf), [50000, 50000, 50000]);
  assert.deepStrictEqual(["anna", "ben", "cleo"].map(h.coinsOf), [1000, 2000, 3000], "the normal coins untouched");
  assert.ok(seasons.inSeasonWorld("anna"));
  assert.strictEqual(require("../game/worlds").worldOf("anna"), "/season");
  const wallet = await coins.season.get("anna");
  assert.deepStrictEqual([wallet.coins, wallet.normal, wallet.joined, wallet.payout], [50000, 1000, true, false]);
  // Season coins and normal coins: apart
  assert.ok(await coins.season.spend("cleo", 100, { reason: "slots bet" }));
  assert.ok(await coins.add("cleo", 5, { reason: "test" }));
  assert.deepStrictEqual([seasonCoinsOf("cleo"), h.coinsOf("cleo")], [49900, 3005]);
  setSeasonCoins("cleo", 50000);
  h.setCoins("cleo", 3000);
  // The switch: back to the normal casino and again into the season
  assert.deepStrictEqual(await seasons.switchWorld("anna", "normal"), { world: "normal" });
  assert.ok(!seasons.inSeasonWorld("anna"));
  assert.deepStrictEqual(await seasons.switchWorld("anna", "season"), { world: "season" });
  await h.wait(10);
  assert.deepStrictEqual((await leaderboard.view("anna", start + 1700)).rows.map((r) => [r.username, r.coins]), [["cleo", 50000], ["anna", 50000], ["ben", 50000]], "on the season's board right away (the same coins: more wagered first)");
  // The season's coin history has its era - the normal one stays apart
  await h.wait(10);
  const seasonLogs = () => h.coinLogs.filter((row) => row.era === coins.era());
  assert.ok(seasonLogs().some((row) => row.reason === "season start"));
  // Payouts: the normal coins, also during a season
  assert.ok(!/paused/.test((await require("../game/withdrawals").request("anna", 1000)).error || ""));
  await h.wait(10);
  // The daily bonus of the season (changed while it runs) - the normal one stays
  assert.strictEqual(coins.season.dailyBonus(), 1000, "the season setting when none was given");
  assert.ok((await seasons.update(made.season.id, { ...seasons.publicSeason(seasons.running()), dailyBonus: 777 })).season);
  assert.strictEqual(coins.season.dailyBonus(), 777);
  assert.strictEqual(coins.dailyBonus(), 2500);
  // A player let in now gets the normal start coins - joining gives the budget; three days later with the 3 daily bonuses missed
  assert.strictEqual(access.startCoins(null, start + 2000).coins, coins.base().start);
  assert.deepStrictEqual(seasons.joinCoins(start + 2000), { coins: 50000, missed: 0 });
  const later = days.dayStart(start) + 3 * 24 * 3600 * 1000 + 5 * 3600 * 1000;
  assert.deepStrictEqual(seasons.joinCoins(later), { coins: 50000 + 3 * 777, missed: 3 });

  // The leaderboard of the season: updated every hour, not in between
  const first = await leaderboard.view("anna", start + 2000);
  assert.ok(!first.live && first.season.name === "Season 1" && first.world === "season");
  assert.ok(first.nextIn > 59 * 60 * 1000 && first.nextIn <= 60 * 60 * 1000);
  await coins.season.add("cleo", 30000, { reason: "test" });
  const between = await leaderboard.view("anna", start + 30 * 60 * 1000);
  assert.strictEqual(between.rows[0].coins, 50000, "not yet");
  const update = await leaderboard.view("anna", start + 61 * 60 * 1000);
  assert.deepStrictEqual([update.rows[0].username, update.rows[0].coins], ["cleo", 80000]);

  // The end: the final places with the prizes, the winner page - the season's coins into the normal wallet
  await coins.season.add("ben", 10000, { reason: "test" });
  const ended = new Promise((resolve) => seasons.changes.once("ended", resolve));
  await seasons.tick(end + 1000);
  assert.strictEqual((await ended).name, "Season 1");
  assert.strictEqual(seasons.running(), null);
  const final = leaderboard.final(made.season.id, "anna");
  assert.deepStrictEqual(final.rows.slice(0, 3).map((r) => [r.rank, r.username, r.prize || null]), [[1, "cleo", "🏆 The golden pepe"], [2, "ben", "A meme T-shirt"], [3, "anna", null]]);
  assert.strictEqual(final.season.status, "ended");
  assert.deepStrictEqual(["anna", "ben", "cleo"].map(h.coinsOf), [1000 + 50000, 2000 + 60000, 3000 + 80000]);
  assert.ok(!seasons.inSeasonWorld("anna"), "everybody back in the normal casino");
  // After the season: the normal leaderboard (live), with a link to the winners
  const after = await leaderboard.view("anna", end + 2000);
  assert.ok(after.live && after.season === null);
  assert.strictEqual(after.lastSeason.id, made.season.id);
  assert.strictEqual((await leaderboard.view("anna", end + 3000)).rows[0].coins, 83000);
  await h.wait(10);
  assert.ok(h.coinLogs.some((row) => row.reason === "season payout" && row.username === "cleo" && row.amount === 80000 && !row.era));
});

test("seasons: closed rounds - a whitelist or a banlist; who isn't allowed doesn't see the season and can't join", async () => {
  seasons.reset();
  const now = Date.now();
  assert.match((await seasons.create({ name: "VIP", icon: "💎", start: now - 1000, end: now + 3600 * 1000, budget: 100, every: 0, accessMode: "whitelist", accessNames: [] })).error, /at least one/);
  assert.match((await seasons.create({ name: "VIP", icon: "💎", start: now - 1000, end: now + 3600 * 1000, budget: 100, every: 0, accessMode: "nope" })).error, /Unknown access/);
  const made = await seasons.create({ name: "VIP", icon: "💎", start: now - 1000, end: now + 3600 * 1000, budget: 100, every: 0, accessMode: "whitelist", accessNames: "anna, Ben" });
  assert.deepStrictEqual(made.season.access, { mode: "whitelist", names: ["anna", "Ben"] });
  await seasons.tick(now);
  const season = seasons.running();
  assert.deepStrictEqual(["anna", "ben", "cleo"].map((name) => seasons.allowed(season, name)), [true, true, false]);
  assert.match((await seasons.join("cleo", now)).error, /closed/);
  assert.ok(!(await seasons.join("ben", now)).error);
  // The banlist: everybody but who is on it
  assert.ok((await seasons.update(made.season.id, { ...seasons.publicSeason(season), accessMode: "banlist", accessNames: ["ben"] })).season);
  assert.deepStrictEqual(["anna", "ben", "cleo"].map((name) => seasons.allowed(seasons.running(), name)), [true, false, true]);
  assert.strictEqual(seasons.joined("ben"), false, "banned: out of the season");
  assert.ok(!seasons.inSeasonWorld("ben"));
  await seasons.endNow(made.season.id);
  seasons.reset();
});

test("seasons: a planned season can be highlighted - the pill shows it before it starts (only to who may play)", async () => {
  seasons.reset();
  const now = Date.now();
  const made = await seasons.create({ name: "Soon", icon: "⏳", start: now + 3600 * 1000, end: now + 7200 * 1000, budget: 100, every: 0, highlight: true, accessMode: "banlist", accessNames: ["cleo"] });
  assert.strictEqual(made.season.highlight, true);
  assert.strictEqual(seasons.upcoming("anna").name, "Soon");
  assert.strictEqual(seasons.upcoming("cleo"), null, "banned: not shown");
  assert.ok((await seasons.update(made.season.id, { ...made.season, highlight: false })).season);
  assert.strictEqual(seasons.upcoming("anna"), null);
  seasons.reset();
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
  // The accent color: checked, and on the casino pages of the season world while the season runs
  assert.match((await seasons.update(made.season.id, { ...made.season, name: "Quick one", color: "purple" })).error, /color/);
  assert.ok((await seasons.update(made.season.id, { ...made.season, name: "Quick one", color: "#9D84C2" })).season);
  await seasons.join("anna", now);
  assert.match(seasons.accentStyle("anna"), /--mm-accent: #9d84c2; --mm-accent-rgb: 157, 132, 194;/);
  assert.strictEqual(seasons.accentStyle("ben"), "", "the normal casino keeps its gold");
  const over = await seasons.endNow(made.season.id);
  assert.strictEqual(seasons.accentStyle("anna"), "", "the gold again after the season");
  assert.strictEqual(over.season.status, "ended");
  assert.ok((await seasons.remove(made.season.id)).ok, "deleted afterwards");
  seasons.reset();
});

test("seasons: the start - only the countdown; nothing waits for the games and nothing closes", async () => {
  seasons.reset();
  const config = require("../game/config");
  const casinoLock = require("../game/casino_lock");
  const now = Date.now() + 1000; // the ticks of the test: after the start
  let busy = true;
  casinoLock.registerRunning("test-game", () => busy);
  casinoLock.season.registerRunning("test-game", () => busy);
  const events = [];
  const onClosing = (info) => events.push(info);
  seasons.changes.on("closing", onClosing);
  config.SEASON_CLOSE_WAIT = 60 * 1000;
  try {
    const made = await seasons.create({ name: "Closing", icon: "🚪", start: now - 500, end: now + 3600 * 1000, budget: 900, every: 0, closeWait: 30 });
    // The countdown right away (30 s, not the 1 minute of the setting) - rounds still running don't matter
    await seasons.tick(now);
    assert.ok(!casinoLock.locked() && !casinoLock.season.locked(), "nothing closes");
    assert.strictEqual(seasons.running(), null);
    assert.strictEqual(seasons.closingInfo(now).startsIn, 30 * 1000);
    assert.strictEqual(seasons.list().find((x) => x.id === made.season.id).status, "starting");
    await seasons.tick(now + 20 * 1000);
    assert.strictEqual(seasons.running(), null, "still counting down");
    await seasons.tick(now + 31 * 1000);
    assert.strictEqual(seasons.running().name, "Closing");
    assert.deepStrictEqual(events.map((e) => e.startsIn), [30 * 1000]);
    busy = false;
    await seasons.tick(now + 32 * 1000);
    await seasons.endNow(made.season.id);
  } finally {
    config.SEASON_CLOSE_WAIT = 0;
    busy = false;
    seasons.changes.off("closing", onClosing);
    seasons.reset();
  }
});

test("seasons: before the end the season world closes - its last rounds finish, then the wait; the normal casino stays open; the end moved later opens it again", async () => {
  seasons.reset();
  const config = require("../game/config");
  const casinoLock = require("../game/casino_lock");
  const now = Date.now();
  const made = await seasons.create({ name: "Ending", icon: "🏁", start: now - 1000, end: now + 3600 * 1000, budget: 900, every: 0 });
  await seasons.tick(now);
  assert.strictEqual(seasons.running().name, "Ending");
  let busy = true;
  casinoLock.season.registerRunning("test-game-end", () => busy);
  const events = [];
  const onClosing = (info) => events.push(info && info.kind);
  seasons.changes.on("closing", onClosing);
  config.SEASON_CLOSE_WAIT = 60 * 1000;
  try {
    // The end: the season world closes, still running while a round is on
    const end = now + 3600 * 1000;
    await seasons.tick(end);
    assert.ok(casinoLock.season.locked());
    assert.ok(!casinoLock.locked(), "the normal casino stays open");
    assert.strictEqual(seasons.closingInfo(end).kind, "end");
    assert.match(casinoLock.season.message(), /season ends/, "a refused bet says why");
    assert.strictEqual(seasons.running().name, "Ending", "not over yet");
    // The admin moves the end later: open again
    const season = seasons.publicSeason(seasons.running());
    assert.ok((await seasons.update(made.season.id, { ...season, end: Date.now() + 2 * 3600 * 1000 })).season);
    await seasons.tick(end + 1000);
    assert.ok(!casinoLock.season.locked(), "open again");
    assert.strictEqual(seasons.closingInfo(), null);
    // Ended by the admin: closes, the round finishes, a minute later it is over
    await seasons.endNow(made.season.id, end + 2000);
    assert.ok(casinoLock.season.locked());
    assert.strictEqual(seasons.running().name, "Ending");
    busy = false;
    await seasons.tick(end + 3000);
    assert.strictEqual(seasons.closingInfo(end + 3000).startsIn, 60 * 1000);
    await seasons.tick(end + 64 * 1000);
    assert.strictEqual(seasons.running(), null, "over");
    assert.strictEqual(seasons.byId(made.season.id).ended, true);
    assert.ok(!casinoLock.season.locked(), "open again after the end");
    assert.deepStrictEqual(events, ["end", null, "end", "end"]);
  } finally {
    config.SEASON_CLOSE_WAIT = 0;
    busy = false;
    seasons.changes.off("closing", onClosing);
    seasons.reset();
  }
});

test("seasons: the daily bonuses add up - a day not claimed comes with the next claim", async () => {
  seasons.reset();
  const now = Date.now();
  const made = await seasons.create({ name: "Bonus", icon: "🎁", start: now - 1000, end: now + 30 * 24 * 3600 * 1000, budget: 1000, every: 0, dailyBonus: 100 });
  await seasons.tick(now);
  await seasons.join("ben", now);
  assert.strictEqual(seasonCoinsOf("ben"), 1000);
  assert.strictEqual(await coins.season.claim("ben", now), 100, "today's");
  assert.strictEqual(await coins.season.claim("ben", now + 1000), 0, "once a day");
  // Three days without a claim: the fourth day brings all four
  const day4 = days.dayStart(now) + 3 * 24 * 3600 * 1000 + 12 * 3600 * 1000;
  assert.strictEqual((await coins.season.get("ben")).bonusAmount, 100, "(already claimed today)");
  assert.strictEqual(await coins.season.claim("ben", day4), 300, "days 2, 3 and 4");
  assert.strictEqual(seasonCoinsOf("ben"), 1400);
  await seasons.endNow(made.season.id);
  seasons.reset();
});

test("seasons: second chances - 0 coins and nothing in play, then the budget again; the first right away, the next one only the next day (no wait set)", async () => {
  seasons.reset();
  const inPlay = require("../game/in_play").season;
  let playing = false;
  inPlay.register("test", (name) => playing && name === "anna");
  const now = Date.now();
  const made = await seasons.create({ name: "Comeback", icon: "🔁", start: now - 1000, end: now + 30 * 24 * 3600 * 1000, budget: 5000, every: 0, secondChances: 2 });
  assert.strictEqual(made.season.secondChances, 2);
  await seasons.tick(now);
  assert.strictEqual((await seasons.chanceStatus("anna", now)).reason, "notJoined", "only who joined the season");
  await seasons.join("anna", now);
  // The day of the start: the first one right away
  setSeasonCoins("anna", 0);
  assert.strictEqual((await seasons.chanceStatus("anna", now + 1000)).can, true);
  // The next day - still coins: no second chance
  const day2 = days.nextDay(now) + 1000;
  setSeasonCoins("anna", 100);
  assert.strictEqual((await seasons.chanceStatus("anna", day2)).reason, "coins");
  // Everything lost - but a bet is still in a game of the season world
  setSeasonCoins("anna", 0);
  playing = true;
  assert.strictEqual((await seasons.chanceStatus("anna", day2)).reason, "inPlay");
  playing = false;
  const status = await seasons.chanceStatus("anna", day2);
  assert.deepStrictEqual([status.can, status.left, status.total], [true, 2, 2]);
  const used = await seasons.useChance("anna", day2);
  assert.deepStrictEqual(used, { coins: 5000, left: 1 });
  assert.strictEqual(seasonCoinsOf("anna"), 5000);
  // Lost again the same day: the next one only tomorrow
  setSeasonCoins("anna", 0);
  const later = await seasons.chanceStatus("anna", day2 + 1000);
  assert.strictEqual(later.reason, "cooldown");
  assert.strictEqual(later.nextAt, days.nextDay(day2));
  assert.match((await seasons.useChance("anna", day2 + 1000)).error, /tomorrow/);
  // The next day: the last one
  const day3 = days.nextDay(day2) + 1000;
  assert.strictEqual((await seasons.useChance("anna", day3)).left, 0);
  setSeasonCoins("anna", 0);
  assert.strictEqual((await seasons.chanceStatus("anna", days.nextDay(day3) + 1000)).reason, "used");
  // A player who joined the season later: the first one right away, too
  h.addUser("newbie");
  await seasons.join("newbie", day3);
  setSeasonCoins("newbie", 0);
  assert.strictEqual((await seasons.chanceStatus("newbie", day3 + 1000)).can, true);
  assert.strictEqual(seasons.joinedAt("newbie"), day3);
  seasons.reset();
});

test("seasons: the wait between second chances - hours of its own, none, or the next day", async () => {
  seasons.reset();
  const now = Date.now();
  const made = await seasons.create({ name: "Quick", icon: "⚡", start: now - 1000, end: now + 30 * 24 * 3600 * 1000, budget: 5000, every: 0, secondChances: 3, chanceDelay: 2 });
  assert.strictEqual(made.season.chanceDelay, 2);
  await seasons.tick(now);
  h.addUser("zoe");
  await seasons.join("zoe", now);
  setSeasonCoins("zoe", 0);
  assert.strictEqual((await seasons.useChance("zoe", now + 1000)).left, 2);
  setSeasonCoins("zoe", 0);
  // 2 hours after the last one
  const wait = await seasons.chanceStatus("zoe", now + 2000);
  assert.deepStrictEqual([wait.reason, wait.nextAt], ["cooldown", now + 1000 + 2 * 3600 * 1000]);
  assert.match((await seasons.useChance("zoe", now + 2000)).error, /later/);
  // Waiting - but a bet still runs: in play, not "out of coins"
  const inPlay = require("../game/in_play").season;
  inPlay.register("test-wait", (name) => name === "zoe");
  assert.strictEqual((await seasons.chanceStatus("zoe", now + 2000)).reason, "inPlay");
  inPlay.register("test-wait", () => false);
  // A bet just made (the game doesn't have it yet): in play, too
  setSeasonCoins("zoe", 50);
  assert.ok(await coins.season.spend("zoe", 50, { reason: "slots bet" }));
  assert.strictEqual((await seasons.chanceStatus("zoe", Date.now())).reason, "inPlay");
  assert.strictEqual((await seasons.chanceStatus("zoe", now + 1000 + 2 * 3600 * 1000)).can, true);
  // None: right away - and back to the next day (not set)
  await seasons.update(made.season.id, { ...made.season, chanceDelay: 0 });
  assert.strictEqual((await seasons.chanceStatus("zoe", now + 3000)).can, true);
  await seasons.update(made.season.id, { ...made.season, chanceDelay: null });
  assert.strictEqual((await seasons.chanceStatus("zoe", now + 3000)).nextAt, days.nextDay(now + 1000));
  assert.match((await seasons.update(made.season.id, { ...made.season, chanceDelay: 169 })).error, /0 to 168/);
  assert.match((await seasons.update(made.season.id, { ...made.season, chanceDelay: 1.5 })).error, /0 to 168/);
  seasons.reset();
});

test("seasons: a restart doesn't touch the balances - the coins wait until the season is loaded", async () => {
  seasons.reset();
  const now = Date.now();
  const made = await seasons.create({ name: "Restart", icon: "🔄", start: now - 1000, end: now + 3600 * 1000, budget: 5000, every: 0 });
  await seasons.tick(now);
  await seasons.join("anna", now);
  setSeasonCoins("anna", 7777);
  const saved = coins.seasonBase();
  // The server starts again: the season isn't loaded yet, a page asks for the coins
  coins.hold();
  coins.setBase(null);
  const asked = coins.season.get("anna");
  await h.wait(20);
  assert.strictEqual(seasonCoinsOf("anna"), 7777, "nothing reset while waiting");
  // The season is loaded: now the answer - the season balance as it was
  coins.setBase(saved);
  coins.release();
  assert.strictEqual((await asked).coins, 7777);
  assert.strictEqual(seasonCoinsOf("anna"), 7777);
  await seasons.endNow(made.season.id);
  seasons.reset();
});

test("seasons: a season from before the worlds were apart moves into the season world - the normal coins and games come back", async () => {
  seasons.reset();
  const Setting = require("../models/Setting");
  const persist = require("../game/persist");
  const now = Date.now();
  const era = "season-77";
  // How it was: the whole casino in the season - user.coins the season's, the normal ones saved
  const old = { id: 77, name: "Old", icon: "🦕", start: now - 1000, end: now + 3600 * 1000, budget: 500, every: 0, started: true, ended: false, startedAt: now - 1000, joined: { anna: now - 500 }, saved: { anna: 1234, ben: 4321 }, baseBefore: null };
  await Setting.updateOne({ key: "seasons" }, { $set: { value: JSON.stringify({ seasons: [old], base: { reset: era, start: 0, budget: 500, join: true, since: now - 1000, active: true, bonus: null }, next: 78 }) } }, { upsert: true });
  await Setting.updateOne({ key: "seasonGames:77" }, { $set: { value: JSON.stringify({ "migrate-game": persist.toJSON({ round: 1 }) }) } }, { upsert: true });
  await Setting.updateOne({ key: "game:migrate-game" }, { $set: { value: persist.toJSON({ round: 9 }) } }, { upsert: true });
  Object.assign(h.userOf("anna"), { coins: 999, coinReset: era });
  Object.assign(h.userOf("ben"), { coins: 0, coinReset: era });
  await seasons.load();
  const season = seasons.running();
  assert.ok(season.world && !season.saved);
  assert.deepStrictEqual([h.coinsOf("anna"), seasonCoinsOf("anna"), h.coinsOf("ben"), seasonCoinsOf("ben")], [1234, 999, 4321, 0]);
  assert.ok(seasons.inSeasonWorld("anna"), "who joined plays on in the season world");
  assert.ok(!seasons.inSeasonWorld("ben"));
  assert.strictEqual(JSON.parse((await Setting.findOne({ key: "game:migrate-game" }).lean()).value).round, 1, "the normal game from before");
  assert.strictEqual(JSON.parse((await Setting.findOne({ key: "game:season/migrate-game" }).lean()).value).round, 9, "the season's game in the season world");
  assert.strictEqual(await Setting.findOne({ key: "seasonGames:77" }).lean(), null);
  await seasons.endNow(77);
  await Setting.deleteMany({ key: { $in: ["seasons", "game:migrate-game", "game:season/migrate-game"] } });
  seasons.reset();
});

test("seasons: a place only after wagering 7x the start (again for every second chance) - until then on the board without a place", async () => {
  seasons.reset();
  const now = Date.now();
  const made = await seasons.create({ name: "Wager", icon: "🎲", start: now - 1000, end: now + 3600 * 1000, budget: 100, every: 0, secondChances: 1, prizesOn: true, prizes: [{ place: 1, prize: "🏆" }] });
  assert.strictEqual(made.season.wagerX, 7, "7x by default");
  assert.match((await seasons.create({ name: "X", icon: "🎲", start: now + 7200 * 1000, end: now + 9000 * 1000, budget: 100, every: 0, wagerX: -1 })).error, /0 to 1000/);
  await seasons.tick(now);
  for (const name of ["anna", "ben", "cleo"]) await seasons.join(name, now);
  // anna: 700 wagered (7 x 100) - ben: 500 - cleo: nothing, but the most coins
  setSeasonCoins("anna", 50);
  setSeasonCoins("ben", 900);
  setSeasonCoins("cleo", 5000);
  await coins.season.add("anna", 700, { reason: "test" });
  assert.ok(await coins.season.spend("anna", 700, { reason: "slots bet" }));
  assert.ok(await coins.season.spend("ben", 500, { reason: "roulette bet" }));
  setSeasonCoins("ben", 900);
  await h.wait(20);
  const board = await seasons.board(made.season.id);
  const row = (name) => board.rows.find((r) => r.username === name);
  assert.strictEqual(row("anna").rank, 1, "wagered enough: the place (and the prize)");
  assert.strictEqual(row("anna").prize, "🏆");
  assert.deepStrictEqual([row("cleo").rank, row("cleo").pending, row("cleo").wager.need], [null, true, 700], "the most coins - but no place yet");
  assert.deepStrictEqual([row("ben").rank, row("ben").wager.done, row("ben").wager.need], [null, 500, 700]);
  assert.deepStrictEqual(board.rows.map((r) => r.username), ["anna", "cleo", "ben"], "who has a place first, then the others by coins");
  // A second chance: 7x more to wager before the place counts again
  setSeasonCoins("anna", 0);
  await seasons.useChance("anna", now + 5000);
  assert.strictEqual(seasons.wagerNeed(seasons.running(), "anna"), 1400);
  const after = await seasons.board(made.season.id);
  assert.strictEqual(after.rows.find((r) => r.username === "anna").rank, null);
  // The end: only who has a place wins
  await seasons.endNow(made.season.id);
  assert.strictEqual(seasons.publicSeason(seasons.byId(made.season.id)).winner, null, "nobody wagered enough at the end");
  seasons.reset();
});
