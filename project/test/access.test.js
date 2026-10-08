const { test, before, after } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const cookieParser = require("cookie-parser");
const h = require("./helpers");
const config = require("../game/config");
const coins = require("../game/coins");
const access = require("../game/access");
const PageAuth = require("../middleware/auth");
const secretRoute = require("../routes/secret_route");
const adminRoute = require("../routes/admin_route");

const ADMIN = encodeURI(config.ADMIN_PATH);
const CASINO = encodeURI(config.JACKPOT_PATH);
const DAY = 24 * 60 * 60 * 1000;
let app;
let base;
let server;
let adminCookie;
const tokens = {};
const sockets = [];

before(async () => {
  config.ADMIN_PASSWORD = "very-secret-pass";
  const web = express();
  web.use(cookieParser());
  web.use(CASINO, secretRoute(PageAuth));
  web.use(ADMIN, adminRoute());
  app = web.listen(0);
  base = `http://localhost:${app.address().port}`;
  server = await h.startServer();
  for (const name of ["tom", "uma", "vic"]) tokens[name] = h.addUser(name, { approved: false });
  tokens.old = h.addUser("old");

  const login = await call(ADMIN + "/login", { json: { password: "very-secret-pass" } });
  adminCookie = login.headers.get("set-cookie").split(";")[0];
});

after(async () => {
  config.ADMIN_PASSWORD = "";
  sockets.forEach((s) => s.close());
  await server.close();
  app.close();
});

function call(path, options = {}) {
  const headers = {};
  if (options.cookie) headers.cookie = options.cookie;
  if (options.json) headers["Content-Type"] = "application/json";
  return fetch(base + path, { method: options.json ? "POST" : "GET", headers, body: options.json ? JSON.stringify(options.json) : undefined, redirect: "manual" });
}

const as = (name) => ({ cookie: `token=${tokens[name]}` });

async function adminApi(path, json) {
  const res = await call(ADMIN + "/api/" + path, { cookie: adminCookie, json });
  return { status: res.status, body: await res.json() };
}

// Connects to a casino namespace: "connect" or the error message
function connect(namespace, name) {
  const socket = server.client(namespace, tokens[name]);
  sockets.push(socket);
  return new Promise((resolve) => {
    socket.once("connect", () => resolve({ socket, ok: true }));
    socket.once("connect_error", (error) => resolve({ socket, ok: false, error: error.message }));
  });
}

test("access: without the approval the secret address only shows the page to ask for access", async () => {
  const start = await call(CASINO + "/", as("tom"));
  assert.strictEqual(start.status, 200);
  const html = await start.text();
  assert.match(html, /Ask for access/);
  assert.doesNotMatch(html, /<title>Jackpot/);
  // Every address of the casino (also one that doesn't exist): the page to ask for access, right there
  for (const path of ["/jackpot", "/battles", "/poker", "/blackjack", "/slots", "/leaderboard", "/battles/xyz", "/nothing"]) {
    const res = await call(CASINO + path, as("tom"));
    assert.strictEqual(res.status, 200, path);
    assert.match(await res.text(), /Ask for access/, path);
  }
  // Not logged in: the login - and then back to the page
  assert.strictEqual((await call(CASINO + "/")).headers.get("location"), "/?next=" + encodeURIComponent(CASINO + "/"));
  assert.strictEqual((await call(CASINO + "/battles")).headers.get("location"), "/?next=" + encodeURIComponent(CASINO + "/battles"));
  assert.strictEqual((await call(CASINO + "/withdraw", { ...as("tom"), json: { amount: 5000 } })).status, 403);
  assert.strictEqual((await call(CASINO + "/withdrawals", as("tom"))).status, 403);
  assert.strictEqual((await call(CASINO + "/leaderboard/data", as("tom"))).status, 403);
  // Approved: the leaderboard
  assert.strictEqual((await call(CASINO + "/leaderboard", as("old"))).status, 200);
  const board = await (await call(CASINO + "/leaderboard/data", as("old"))).json();
  assert.strictEqual(board.me.username, "old");

  for (const namespace of ["/jackpot", "/battles", "/poker", "/blackjack", "/slots"]) {
    const result = await connect(namespace, "tom");
    assert.deepStrictEqual([result.ok, result.error], [false, "unauthorized"], namespace);
  }
  // The rest of the site is open
  assert.strictEqual((await connect("/lobby", "tom")).ok, true);
  // An approved player gets in
  assert.strictEqual((await call(CASINO + "/blackjack", as("old"))).status, 200);
  assert.strictEqual((await connect("/blackjack", "old")).ok, true);
});

test("access: asking for access - the admin sees the request, can approve or decline it", async () => {
  // Looking is no request
  assert.deepStrictEqual(await (await call(CASINO + "/request", as("tom"))).json(), { approved: false, requested: false, startCoins: config.START_COINS });
  assert.deepStrictEqual((await adminApi("overview")).body.requests, []);
  // Vic asks and is declined: he can ask again
  assert.strictEqual((await call(CASINO + "/request", { ...as("vic"), json: {} })).status, 200);
  assert.strictEqual((await adminApi("overview")).body.requests[0].username, "vic");
  assert.deepStrictEqual((await adminApi("access/decline", { username: "vic" })).body, { username: "vic" });
  assert.strictEqual((await (await call(CASINO + "/request", as("vic"))).json()).requested, false);
  assert.strictEqual((await adminApi("access/decline", { username: "old" })).status, 400, "approved: nothing to decline");

  // Tom asks
  assert.deepStrictEqual(await (await call(CASINO + "/request", { ...as("tom"), json: {} })).json(), { requested: true });
  assert.strictEqual((await (await call(CASINO + "/request", as("tom"))).json()).requested, true);
  const overview = (await adminApi("overview")).body;
  assert.deepStrictEqual(overview.requests.map((r) => r.username), ["tom"]);
  assert.strictEqual(overview.waiting, 1);
  assert.ok(Array.isArray(overview.open), "the open payouts are there too");

  const res = await adminApi("access");
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.firstApproval, null);
  assert.strictEqual(res.body.startCoins, config.START_COINS);
  // The approved players first, then who asked, then the rest
  assert.deepStrictEqual(res.body.players.map((p) => p.username), ["old", "tom", "uma", "vic"]);
  const tom = res.body.players[1];
  assert.deepStrictEqual(tom, { username: "tom", approved: false, approvedAt: null, requestedAt: tom.requestedAt, payout: false });
  assert.ok(tom.requestedAt);
  // Not in the casino: not on the leaderboard, no balance to change
  assert.ok(!(await adminApi("users")).body.some((p) => p.username === "tom"));
  assert.strictEqual((await adminApi("balance", { username: "tom", mode: "set", amount: 5 })).status, 400);
  // Without the admin login: nothing
  assert.strictEqual((await call(ADMIN + "/api/access", { json: { username: "tom", approve: true } })).status, 401);
});

test("access: the start money - just the start coins without a season (missed bonuses only count in a season)", async () => {
  const days = require("../game/days");
  // The very first approval (3 calendar days ago): just the start money
  const first = days.dayStart(days.dayStart() - 2.5 * DAY) + 2 * 60 * 60 * 1000;
  const tom = await access.approve("tom", first);
  assert.deepStrictEqual(tom, { username: "tom", coins: config.START_COINS, missed: 0, again: false });
  assert.strictEqual(h.coinsOf("tom"), config.START_COINS);
  assert.strictEqual((await access.approve("tom")).error, "Already approved.");

  // Today: three days later - still just the start coins (no season runs)
  const res = await adminApi("access", { username: "uma", approve: true });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body, { username: "uma", coins: config.START_COINS, missed: 0, again: false });
  assert.strictEqual(h.coinsOf("uma"), config.START_COINS);
  const log = h.coinLogs.filter((row) => row.username === "uma");
  assert.deepStrictEqual(log.map((row) => [row.amount, row.reason]), [[config.START_COINS, "start coins"]]);
  // The bonus of today is hers
  assert.strictEqual(await coins.claimBonus("uma"), true);
  assert.strictEqual(h.coinsOf("uma"), config.START_COINS + config.DAILY_BONUS);

  // What the next one gets
  const list = (await adminApi("access")).body;
  assert.strictEqual(new Date(list.firstApproval).getTime(), first);
  assert.deepStrictEqual([list.startCoins, list.missed, list.since], [config.START_COINS, 0, null]);

  // Now uma gets in
  assert.strictEqual((await call(CASINO + "/", as("uma"))).status, 200);
  const page = await connect("/jackpot", "uma");
  assert.strictEqual(page.ok, true);
});

test("access: taken away - the open pages close, a new approval gives no second start money", async () => {
  const { socket } = await connect("/jackpot", "uma");
  const closed = h.once(socket, "casinoClosed");
  const gone = h.once(socket, "disconnect");
  const res = await adminApi("access", { username: "uma", approve: false });
  assert.strictEqual(res.status, 200);
  await closed;
  await gone;
  assert.match(await (await call(CASINO + "/", as("uma"))).text(), /Ask for access/);
  // The old request is gone: to get back in, uma has to ask again
  assert.strictEqual((await (await call(CASINO + "/request", as("uma"))).json()).requested, false);
  assert.ok(!(await adminApi("overview")).body.requests.some((r) => r.username === "uma"));
  assert.strictEqual((await connect("/jackpot", "uma")).ok, false);

  h.setCoins("uma", 1234);
  const again = await adminApi("access", { username: "uma", approve: true });
  assert.deepStrictEqual(again.body, { username: "uma", again: true });
  assert.strictEqual(h.coinsOf("uma"), 1234, "the old coins, no new start money");
  assert.strictEqual((await adminApi("access", { username: "nobody", approve: true })).status, 400);
});

test("access: payouts only for players the admin ticked", async () => {
  // tom: approved, payouts not allowed yet
  const before = h.coinsOf("tom");
  const refused = await call(CASINO + "/withdraw", { ...as("tom"), json: { amount: 5000 } });
  assert.strictEqual(refused.status, 403);
  assert.match((await refused.json()).error, /Payouts aren't enabled/);
  assert.strictEqual(h.coinsOf("tom"), before);
  assert.strictEqual((await coins.get("tom")).payout, false);
  assert.strictEqual((await adminApi("access")).body.players.find((p) => p.username === "tom").payout, false);

  // Ticked: the open page hears it right away, the payout works
  const { socket } = await connect("/jackpot", "tom");
  const told = new Promise((resolve) => socket.on("coins", (data) => data.payout && resolve(data)));
  assert.deepStrictEqual((await adminApi("payout", { username: "tom", allowed: true })).body, { username: "tom", payout: true });
  assert.strictEqual((await told).payout, true);
  const ok = await call(CASINO + "/withdraw", { ...as("tom"), json: { amount: 5000 } });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(h.coinsOf("tom"), before - 5000);

  // Unticked again
  await adminApi("payout", { username: "tom", allowed: false });
  assert.strictEqual((await call(CASINO + "/withdraw", { ...as("tom"), json: { amount: 5000 } })).status, 403);
  assert.strictEqual((await adminApi("payout", { username: "nobody", allowed: true })).status, 400);
});

test("access: maintenance - closes like a season (games finish, countdown), then only the whitelist gets in", async () => {
  const maintenance = require("../game/maintenance");
  const casinoLock = require("../game/casino_lock");
  tokens.wes = h.addUser("wes");
  tokens.xia = h.addUser("xia");
  const until = Date.now() + 2 * 60 * 60 * 1000;
  // An open page of a player not on the whitelist closes when it starts
  const open = await connect("/jackpot", "xia");
  assert.strictEqual(open.ok, true);
  const closed = h.once(open.socket, "casinoClosed");
  // First the casino closes (no new bets), every page sees the countdown - then it is on
  const banner = h.once(open.socket, "seasonClosing");
  const on = await adminApi("maintenance", { on: true, whitelist: ["wes"], until: until, note: "New cases!", wait: 1 });
  assert.strictEqual(on.status, 200);
  const started = on.body.maintenance;
  assert.deepStrictEqual([started.on, started.whitelist, started.until, started.note, started.wait], [false, ["wes"], until, "New cases!", 1]);
  assert.ok(started.closing && started.closing.startsAt > Date.now(), "nothing runs: the countdown right away");
  assert.strictEqual(casinoLock.locked(), true, "no new bets while it closes");
  assert.strictEqual((await banner).kind, "maintenance");
  await closed;
  assert.strictEqual(maintenance.get().on, true);
  assert.strictEqual(casinoLock.locked(), false, "the whitelist plays during the maintenance");

  // Not on the whitelist: the maintenance page everywhere, no data, no games
  for (const path of ["/", "/slots", "/battles/xyz"]) {
    const res = await call(CASINO + path, as("xia"));
    assert.strictEqual(res.status, 200, path);
    assert.match(await res.text(), /closed for maintenance/, path);
  }
  const data = await call(CASINO + "/leaderboard/data", as("xia"));
  assert.strictEqual(data.status, 503);
  assert.deepStrictEqual((await data.json()).maintenance, { on: true, until: until, note: "New cases!" });
  assert.strictEqual((await connect("/slots", "xia")).ok, false);
  // The maintenance page asks: still closed - when is it most likely over?
  const info = await (await call(CASINO + "/maintenance", as("xia"))).json();
  assert.deepStrictEqual(info, { on: true, until: until, note: "New cases!", allowed: false });

  // On the whitelist: plays as always
  const wes = await call(CASINO + "/", as("wes"));
  assert.doesNotMatch(await wes.text(), /closed for maintenance/);
  assert.strictEqual((await connect("/slots", "wes")).ok, true);
  assert.strictEqual((await (await call(CASINO + "/maintenance", as("wes"))).json()).allowed, true);

  // Wrong values change nothing
  assert.strictEqual((await adminApi("maintenance", { on: "yes" })).status, 400);
  assert.strictEqual((await adminApi("maintenance", { whitelist: "wes" })).status, 400);
  assert.strictEqual((await adminApi("maintenance", { wait: -1 })).status, 400);
  assert.strictEqual(maintenance.get().on, true);
  // The admin panel knows the players to put on the list
  assert.ok((await adminApi("maintenance")).body.players.includes("xia"));

  // Over: everybody is back in
  await adminApi("maintenance", { on: false });
  assert.doesNotMatch(await (await call(CASINO + "/", as("xia"))).text(), /closed for maintenance/);
  assert.strictEqual((await connect("/slots", "xia")).ok, true);
  assert.strictEqual(maintenance.get().whitelist[0], "wes", "the whitelist stays for the next time");
  maintenance.reset();
});

test("access: gifts - coins for another player, at most GIFT_LIMIT in total", async () => {
  tokens.gia = h.addUser("gia");
  tokens.hal = h.addUser("hal");
  h.setCoins("gia", 20000);
  h.setCoins("hal", 100);
  const give = async (to, amount) => {
    const res = await call(CASINO + "/gift", { ...as("gia"), json: { to, amount } });
    return { status: res.status, body: await res.json() };
  };
  assert.deepStrictEqual(await (await call(CASINO + "/gift", as("gia"))).json(), { limit: 10000, given: 0, left: 10000 });
  // The other one hears it on every open casino page
  const page = await connect("/jackpot", "hal");
  const heard = h.once(page.socket, "giftReceived");
  const first = await give("hal", 6000);
  assert.strictEqual(first.status, 200);
  assert.deepStrictEqual(first.body, { coins: 14000, left: 4000 });
  assert.deepStrictEqual(await heard, { from: "gia", amount: 6000 });
  assert.strictEqual(h.coinsOf("hal"), 6100);
  // More than is left of the limit, to themselves, to nobody, no number: nothing happens
  assert.match((await give("hal", 5000)).body.error, /4,000 more/);
  assert.match((await give("gia", 10)).body.error, /yourself/);
  assert.match((await give("nobody", 10)).body.error, /no such player/);
  assert.strictEqual((await give("hal", 1.5)).status, 400);
  assert.strictEqual((await give("hal", -5)).status, 400);
  assert.strictEqual(h.coinsOf("gia"), 14000);
  // The rest - then the limit is reached
  assert.strictEqual((await give("hal", 4000)).status, 200);
  assert.match((await give("hal", 1)).body.error, /the most you can/);
  assert.strictEqual(h.coinsOf("hal"), 10100);
  // Not more than the own coins
  h.setCoins("hal", 50);
  const poor = await call(CASINO + "/gift", { ...as("hal"), json: { to: "gia", amount: 51 } });
  assert.match((await poor.json()).error, /that many coins/);
});
