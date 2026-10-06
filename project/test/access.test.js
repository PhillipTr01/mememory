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

test("access: without the approval every casino page leads back to the start page", async () => {
  for (const path of ["/", "/jackpot", "/battles", "/poker", "/blackjack"]) {
    const res = await call(CASINO + path, as("tom"));
    assert.strictEqual(res.status, 302, path);
    assert.strictEqual(res.headers.get("location"), "/", path);
  }
  assert.strictEqual((await call(CASINO + "/withdraw", { ...as("tom"), json: { amount: 5000 } })).status, 403);
  assert.strictEqual((await call(CASINO + "/withdrawals", as("tom"))).status, 403);

  for (const namespace of ["/casino", "/jackpot", "/battles", "/poker", "/blackjack"]) {
    const result = await connect(namespace, "tom");
    assert.deepStrictEqual([result.ok, result.error], [false, "unauthorized"], namespace);
  }
  // The rest of the site is open
  assert.strictEqual((await connect("/lobby", "tom")).ok, true);
  // An approved player gets in
  assert.strictEqual((await call(CASINO + "/blackjack", as("old"))).status, 200);
  assert.strictEqual((await connect("/blackjack", "old")).ok, true);
});

test("access: the admin sees who wants in, first", async () => {
  const res = await adminApi("access");
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.firstApproval, null);
  assert.strictEqual(res.body.startCoins, config.START_COINS);
  assert.deepStrictEqual(res.body.players[0], { username: "tom", approved: false, approvedAt: null, requestedAt: res.body.players[0].requestedAt, payout: false });
  assert.ok(res.body.players[0].requestedAt, "tom tried to get in");
  const old = res.body.players.find((p) => p.username === "old");
  assert.strictEqual(old.approved, true);
  assert.strictEqual((await adminApi("overview")).body.waiting, 1);
  // Not in the casino: not on the leaderboard, no balance to change
  assert.ok(!(await adminApi("users")).body.some((p) => p.username === "tom"));
  assert.strictEqual((await adminApi("balance", { username: "tom", mode: "set", amount: 5 })).status, 400);
  // Without the admin login: nothing
  assert.strictEqual((await call(ADMIN + "/api/access", { json: { username: "tom", approve: true } })).status, 401);
});

test("access: the start money - 50,000 plus the daily bonus of every day since the first approval", async () => {
  const days = require("../game/days");
  // The very first approval (3 calendar days ago): just the start money
  const first = days.dayStart(days.dayStart() - 2.5 * DAY) + 2 * 60 * 60 * 1000;
  const tom = await access.approve("tom", first);
  assert.deepStrictEqual(tom, { username: "tom", coins: config.START_COINS, missed: 0, again: false });
  assert.strictEqual(h.coinsOf("tom"), config.START_COINS);
  assert.strictEqual((await access.approve("tom")).error, "Already approved.");

  // Today: three days later - three bonuses missed
  const res = await adminApi("access", { username: "uma", approve: true });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body, { username: "uma", coins: config.START_COINS + 3 * config.DAILY_BONUS, missed: 3, again: false });
  assert.strictEqual(h.coinsOf("uma"), 57500);
  const log = h.coinLogs.filter((row) => row.username === "uma");
  assert.deepStrictEqual(log.map((row) => [row.amount, row.reason]), [[57500, "start coins"]]);
  assert.match(log[0].note, /3 missed daily bonuses/);
  // The bonus of today is still hers
  assert.strictEqual(await coins.claimBonus("uma"), true);
  assert.strictEqual(h.coinsOf("uma"), 57500 + config.DAILY_BONUS);

  // What the next one gets
  const list = (await adminApi("access")).body;
  assert.strictEqual(new Date(list.firstApproval).getTime(), first);
  assert.deepStrictEqual([list.startCoins, list.missed], [57500, 3]);

  // Now uma gets in
  assert.strictEqual((await call(CASINO + "/", as("uma"))).status, 200);
  const page = await connect("/casino", "uma");
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
  assert.strictEqual((await call(CASINO + "/jackpot", as("uma"))).headers.get("location"), "/");
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
  const { socket } = await connect("/casino", "tom");
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
