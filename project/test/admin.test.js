const { test, before, after } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const cookieParser = require("cookie-parser");
const h = require("./helpers");
require("../game/config").SEASON_CLOSE_WAIT = 0; // the season starts right away in the tests
const config = require("../game/config");
const coins = require("../game/coins");
const PageAuth = require("../middleware/auth");
const secretRoute = require("../routes/secret_route");
const adminRoute = require("../routes/admin_route");

const ADMIN = encodeURI(config.ADMIN_PATH);
const CASINO = encodeURI(config.JACKPOT_PATH);
let server;
let base;
const tokens = {};

before(async () => {
  config.ADMIN_PASSWORD = "very-secret-pass";
  const app = express();
  app.use(cookieParser());
  app.use(CASINO, secretRoute(PageAuth));
  app.use(config.addresses(config.ADMIN_PATH), adminRoute());
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  for (const name of ["paula", "quinn", "rosa"]) tokens[name] = h.addUser(name);
});

after(() => {
  config.ADMIN_PASSWORD = "";
  server.close();
});

function call(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.cookie) headers.cookie = options.cookie;
  if (options.json) headers["Content-Type"] = "application/json";
  return fetch(base + path, { method: options.json ? "POST" : options.method || "GET", headers, body: options.json ? JSON.stringify(options.json) : undefined, redirect: "manual" });
}

let adminCookie = null;

async function adminApi(path, json) {
  const res = await call(ADMIN + "/api/" + path, { cookie: adminCookie, json });
  return { status: res.status, body: await res.json() };
}

test("admin: a secret address and a password - nothing works without the login", async () => {
  const page = await call(ADMIN + "/");
  assert.strictEqual(page.status, 200);
  const html = await page.text();
  assert.match(html, /type="password"/, "the login");
  assert.doesNotMatch(html, /adBalance/, "not the panel");
  assert.strictEqual((await call(ADMIN + "/api/overview")).status, 401);

  const wrong = await call(ADMIN + "/login", { json: { password: "guess" } });
  assert.strictEqual(wrong.status, 401);
  assert.strictEqual(wrong.headers.get("set-cookie"), null);

  const right = await call(ADMIN + "/login", { json: { password: "very-secret-pass" } });
  assert.strictEqual(right.status, 200);
  const cookie = right.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.doesNotMatch(cookie, /Secure/i, "plain http: no secure cookie (the browser would throw it away)");
  adminCookie = cookie.split(";")[0];

  assert.match(await (await call(ADMIN + "/", { cookie: adminCookie })).text(), /adBalance/, "the panel");
  // A made-up token is no login
  assert.strictEqual((await call(ADMIN + "/api/overview", { cookie: "admin_token=forged" })).status, 401);
});

test("admin: change balances, the history knows every change", async () => {
  await coins.get("paula"); // start coins
  let res = await adminApi("balance", { username: "paula", mode: "set", amount: 5000, note: "test" });
  assert.deepStrictEqual(res.body, { username: "paula", coins: 5000 });
  res = await adminApi("balance", { username: "paula", mode: "add", amount: -1000 });
  assert.strictEqual(res.body.coins, 4000);
  res = await adminApi("balance", { username: "paula", mode: "add", amount: -99999 });
  assert.strictEqual(res.status, 400, "not more than she has");
  assert.strictEqual((await adminApi("balance", { username: "nobody", mode: "add", amount: 5 })).status, 404);
  assert.strictEqual((await adminApi("balance", { username: "paula", mode: "set", amount: -5 })).status, 400);

  const history = (await adminApi("history?username=paula")).body.rows;
  assert.deepStrictEqual(
    history.map((row) => [row.reason, row.amount]),
    [["admin", -1000], ["admin", 5000 - config.START_COINS], ["start coins", config.START_COINS]],
  );
  assert.strictEqual(history[1].note, "test");
});

test("admin: payouts - a player takes coins off, the admin pays or rejects (coins back)", async () => {
  h.setCoins("quinn", 20000);
  const player = { cookie: `token=${tokens.quinn}` };
  let res = await call(CASINO + "/withdraw", { ...player, json: { amount: 6000 } });
  assert.strictEqual(res.status, 200);
  const first = await res.json();
  assert.strictEqual(first.status, "open");
  assert.strictEqual(h.coinsOf("quinn"), 14000);

  // Not more than the balance, at least 5k, only whole thousands
  for (const amount of [30000, 4000, 5500, "x"]) {
    res = await call(CASINO + "/withdraw", { ...player, json: { amount } });
    assert.strictEqual(res.status, 400);
  }
  assert.strictEqual(h.coinsOf("quinn"), 14000);
  res = await call(CASINO + "/withdraw", { ...player, json: { amount: 5000 } });
  const second = await res.json();

  // The admin sees both
  const overview = (await adminApi("overview")).body;
  assert.deepStrictEqual(overview.open.map((w) => [w.username, w.amount]).sort(), [["quinn", 5000], ["quinn", 6000]]);
  assert.strictEqual(overview.openCoins, 11000);

  // Paid: done; rejected: the coins go back
  assert.strictEqual((await adminApi("withdrawals/" + first.id, { action: "paid" })).status, 200);
  assert.strictEqual((await adminApi("withdrawals/" + first.id, { action: "reject" })).status, 400, "only once");
  assert.strictEqual(h.coinsOf("quinn"), 9000, "both payouts are off the balance");
  assert.strictEqual((await adminApi("withdrawals/" + second.id, { action: "reject", note: "nope" })).status, 200);
  assert.strictEqual(h.coinsOf("quinn"), 14000, "the rejected 5000 are back");

  // The player sees what happened
  const own = await (await call(CASINO + "/withdrawals", player)).json();
  assert.deepStrictEqual(own.map((w) => [w.amount, w.status, w.note]).sort(), [[5000, "rejected", "nope"], [6000, "paid", null]]);
  assert.deepStrictEqual((await adminApi("withdrawals?status=open")).body, []);
  const history = (await adminApi("history?username=quinn")).body.rows.map((row) => row.reason);
  assert.ok(history.includes("withdrawal") && history.includes("withdrawal refund"));
});

test("admin: leaderboard, the richest first", async () => {
  h.setCoins("rosa", 900000);
  const board = (await adminApi("overview")).body.leaderboard;
  assert.strictEqual(board[0].username, "rosa");
  for (let i = 1; i < board.length; i++) assert.ok(board[i - 1].coins >= board[i].coins);
  assert.deepStrictEqual((await adminApi("users?q=ros")).body.map((p) => p.username), ["rosa"]);
});

test("admin: an address the address bar shows as it is - with or without invisible emoji characters", async () => {
  assert.ok(!/\uFE0F/.test(config.ADMIN_PATH), "no invisible character in the default address (no %EF%B8%8F in the bar)");
  // A self chosen address with such a character works both ways
  assert.deepStrictEqual(config.addresses("/🛠️🦆"), [encodeURI("/🛠️🦆"), encodeURI("/🛠🦆")]);
  const res = await call(ADMIN + "/", { cookie: adminCookie });
  assert.match(await res.text(), /adBalance/);
  // Without the slash: to the address with the slash
  const redirect = await call(ADMIN);
  assert.strictEqual(redirect.status, 302);
  assert.strictEqual(redirect.headers.get("location"), ADMIN + "/");
});

test("admin: the stored hash - only the right password fits", async () => {
  const crypto = require("crypto");
  const saved = { password: config.ADMIN_PASSWORD, hash: config.ADMIN_PASSWORD_HASH };
  const salt = crypto.randomBytes(16);
  config.ADMIN_PASSWORD = "";
  config.ADMIN_PASSWORD_HASH = "scrypt:" + salt.toString("hex") + ":" + crypto.scryptSync("hash-pass", salt, 32).toString("hex");
  try {
    assert.strictEqual((await call(ADMIN + "/login", { json: { password: "nope" } })).status, 401);
    assert.strictEqual((await call(ADMIN + "/login", { json: { password: "hash-pass" } })).status, 200);
  } finally {
    Object.assign(config, { ADMIN_PASSWORD: saved.password, ADMIN_PASSWORD_HASH: saved.hash });
  }
});

test("admin: without a password (and hash) there is no admin panel", async () => {
  const saved = { password: config.ADMIN_PASSWORD, hash: config.ADMIN_PASSWORD_HASH };
  Object.assign(config, { ADMIN_PASSWORD: "", ADMIN_PASSWORD_HASH: "" });
  try {
    assert.strictEqual((await call(ADMIN + "/")).status, 404);
    assert.strictEqual((await call(ADMIN + "/login", { json: { password: "" } })).status, 404);
  } finally {
    Object.assign(config, { ADMIN_PASSWORD: saved.password, ADMIN_PASSWORD_HASH: saved.hash });
  }
});

test("admin: too many wrong passwords - wait a minute", async () => {
  for (let i = 0; i < 5; i++) assert.strictEqual((await call(ADMIN + "/login", { json: { password: "no" } })).status, 401);
  assert.strictEqual((await call(ADMIN + "/login", { json: { password: "very-secret-pass" } })).status, 429);
});

test("admin: the casino chat - delete a message, ban and unban a player, clear everything", async () => {
  const casinoChat = require("../game/casino_chat");
  const errors = [];
  const socket = (name) => ({ data: { username: name }, emit: (event, text) => event === "chatError" && errors.push(text) });
  casinoChat.fromUser(socket("paula"), { message: "hello casino" });
  casinoChat.fromUser(socket("quinn"), { message: "spam spam" });
  let res = await adminApi("chat");
  assert.deepStrictEqual(res.body.messages.map((m) => [m.name, m.text]), [["paula", "hello casino"], ["quinn", "spam spam"]]);

  // One message gone
  const spam = res.body.messages[1];
  assert.strictEqual((await adminApi("chat/delete", { id: spam.id })).status, 200);
  assert.strictEqual((await adminApi("chat/delete", { id: spam.id })).status, 404);
  assert.deepStrictEqual((await adminApi("chat")).body.messages.map((m) => m.text), ["hello casino"]);

  // Banned: no more messages (for an hour, or for good)
  assert.strictEqual((await adminApi("chat/ban", { username: "nobody-here", minutes: 60 })).status, 404);
  assert.strictEqual((await adminApi("chat/ban", { username: "quinn", minutes: 0 })).status, 400);
  res = await adminApi("chat/ban", { username: "quinn", minutes: 60 });
  assert.strictEqual(res.body.bans[0].username, "quinn");
  assert.ok(res.body.bans[0].until > Date.now());
  casinoChat.fromUser(socket("quinn"), { message: "let me talk" });
  assert.match(errors.pop(), /banned from the chat for 60 more min/);
  await adminApi("chat/ban", { username: "quinn", minutes: null });
  casinoChat.fromUser(socket("quinn"), { message: "please" });
  assert.match(errors.pop(), /banned from the chat\./);
  assert.strictEqual((await adminApi("chat")).body.messages.length, 1);

  res = await adminApi("chat/unban", { username: "quinn" });
  assert.deepStrictEqual(res.body.bans, []);
  casinoChat.fromUser(socket("quinn"), { message: "thanks" });
  assert.strictEqual((await adminApi("chat")).body.messages.length, 2);

  await adminApi("chat/clear", {});
  assert.deepStrictEqual((await adminApi("chat")).body.messages, []);
});

test("admin: settings - start coins, daily bonus ... are changed, checked and stored", async () => {
  const before = { start: config.START_COINS, bonus: config.DAILY_BONUS, ghost: config.JACKPOT_GHOST_AFTER };
  let res = await adminApi("settings");
  const start = res.body.settings.find((f) => f.key === "START_COINS");
  assert.deepStrictEqual([start.section, start.value, start.default], ["Coins", before.start, before.start]);
  assert.strictEqual(res.body.settings.find((f) => f.key === "JACKPOT_GHOST_AFTER").value, before.ghost / 1000, "in seconds");

  res = await adminApi("settings", { values: { START_COINS: 30000, DAILY_BONUS: 1000, JACKPOT_GHOST_AFTER: 20 } });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual([config.START_COINS, config.DAILY_BONUS, config.JACKPOT_GHOST_AFTER], [30000, 1000, 20000]);
  const stored = await require("../models/Setting").findOne({ key: "admin:settings" }).lean();
  assert.deepStrictEqual(stored.value, { START_COINS: 30000, DAILY_BONUS: 1000, JACKPOT_GHOST_AFTER: 20000 });

  // Wrong values: nothing changes
  for (const values of [{ START_COINS: -1 }, { START_COINS: 1.5 }, { NOPE: 1 }, { BJ_CLASSIC_MIN: 9000, BJ_CLASSIC_MAX: 100 }]) {
    res = await adminApi("settings", { values });
    assert.strictEqual(res.status, 400, JSON.stringify(values));
  }
  assert.strictEqual(config.START_COINS, 30000);

  res = await adminApi("settings", { defaults: true });
  assert.deepStrictEqual([config.START_COINS, config.DAILY_BONUS, config.JACKPOT_GHOST_AFTER], [before.start, before.bonus, before.ghost]);
});

test("admin: a game turned off - no tab, its page leads to the next game, its open pages go", async () => {
  const settings = require("../game/settings");
  const turnedOff = [];
  const listener = (values) => turnedOff.push(values);
  settings.changes.on("change", listener);
  const as = (name) => ({ cookie: `token=${tokens[name]}` });
  // All on: every tab, every page
  let page = await call(CASINO + "/poker", as("paula"));
  assert.strictEqual(page.status, 200);
  assert.doesNotMatch(await page.text(), /display: none !important/);

  assert.strictEqual((await adminApi("settings", { values: { GAME_POKER: "no" } })).status, 400, "on or off only");
  let res = await adminApi("settings", { values: { GAME_POKER: false } });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.settings.find((f) => f.key === "GAME_POKER").value, false);
  assert.deepStrictEqual(turnedOff.pop(), { GAME_POKER: false }, "the open poker pages are told");
  // The page leads to the jackpot, the other pages have no poker tab
  page = await call(CASINO + "/poker", as("paula"));
  assert.strictEqual(page.status, 302);
  assert.match(page.headers.get("location"), /\/jackpot$/);
  const battles = await (await call(CASINO + "/battles", as("paula"))).text();
  assert.match(battles, /\.cs-tab\[href="poker"\] \{ display: none !important; \}/);

  // The jackpot off too: the casino starts with the next game that is on
  await adminApi("settings", { values: { GAME_JACKPOT: false } });
  page = await call(CASINO + "/", as("paula"));
  assert.strictEqual(page.status, 302);
  assert.match(page.headers.get("location"), /\/battles$/);

  await adminApi("settings", { defaults: true });
  assert.strictEqual((await call(CASINO + "/poker", as("paula"))).status, 200, "on again");
  settings.changes.off("change", listener);
});

test("admin: in a season the players show their normal coins, changes go there; the season board has the stats", async () => {
  const seasons = require("../game/seasons");
  seasons.reset();
  const now = Date.now();
  const made = await seasons.create({ name: "Board", icon: "📋", start: now - 1000, end: now + 3600 * 1000, budget: 1000, every: 0, secondChances: 2 });
  await seasons.tick(now);
  const normal = seasons.normalOf("rosa");
  assert.ok(normal != null);
  await seasons.join("rosa", now);
  await coins.spend("rosa", 300, { reason: "slots bet" });
  await coins.add("rosa", 900, { reason: "slots win" });
  // The players: the normal coins, nothing of the season
  const rosa = (await adminApi("users")).body.find((p) => p.username === "rosa");
  assert.deepStrictEqual(rosa, { username: "rosa", coins: normal });
  // A change goes to the normal coins - the season coins stay
  const res = await adminApi("balance", { username: "rosa", mode: "add", amount: 250, note: "gift" });
  assert.strictEqual(res.body.coins, normal + 250);
  assert.strictEqual(seasons.normalOf("rosa"), normal + 250);
  assert.strictEqual((await coins.get("rosa")).coins, 1600);
  assert.strictEqual((await adminApi("balance", { username: "rosa", mode: "add", amount: -(normal + 999) })).status, 400);
  // The history: the normal one (a part of the name is enough) - or the season's, by kinds
  const normalHistory = (await adminApi("history?username=OS")).body;
  assert.ok(normalHistory.rows.some((row) => row.username === "rosa" && row.reason === "admin" && row.amount === 250));
  assert.ok(!normalHistory.rows.some((row) => row.reason === "slots bet"));
  assert.deepStrictEqual(normalHistory.season, { name: "Board", icon: "📋" });
  const seasonHistory = (await adminApi("history?username=rosa&scope=season&reason=" + encodeURIComponent("slots bet,slots win"))).body;
  assert.deepStrictEqual(seasonHistory.rows.map((row) => row.reason).sort(), ["slots bet", "slots win"]);
  // The board: when they started, second chances, what they did
  const board = (await adminApi("seasons/" + made.season.id + "/board")).body;
  const row = board.rows.find((r) => r.username === "rosa");
  assert.deepStrictEqual(
    [row.coins, row.joinedAt, row.chances, board.chancesTotal, row.bets, row.wagered, row.biggestWin, row.fromGames, row.favourite],
    [1600, now, 0, 2, 1, 300, 900, 600, "Slots"],
  );
  seasons.reset();
});

// The last test: everything is gone afterwards
test("admin: the hard reset - history, payouts, accesses, coins and seasons are gone", async () => {
  const CoinLog = require("../models/CoinLog");
  const access = require("../game/access");
  const seasons = require("../game/seasons");
  seasons.reset();
  // A running season and a planned one
  const now = Date.now();
  await seasons.create({ name: "Running", icon: "🔥", start: now - 1000, end: now + 3600 * 1000, budget: 1234, every: 0 });
  await seasons.create({ name: "Later", icon: "❄️", start: now + 7200 * 1000, end: now + 9000 * 1000, budget: 1, every: 0 });
  await seasons.tick(now);
  assert.strictEqual(seasons.running().name, "Running");
  await coins.add("rosa", 500, { reason: "admin" });
  assert.ok((await CoinLog.countDocuments({})) > 0);
  let closed = 0;
  access.changes.once("closeAll", () => closed++);

  let res = await adminApi("reset", {});
  assert.strictEqual(res.status, 400, "only with the word");
  assert.strictEqual(closed, 0);
  res = await adminApi("reset", { confirm: "RESET" });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(closed, 1, "every casino page closes");
  assert.strictEqual(await CoinLog.countDocuments({}), 0);
  assert.deepStrictEqual([seasons.list(), seasons.running()], [[], null], "no seasons anymore");
  assert.strictEqual(require("../game/coins").base().start, config.START_COINS);
  const rosa = await require("../models/User").findOne({ username: "rosa" }).lean();
  assert.deepStrictEqual([rosa.casinoApproved, rosa.casinoApprovedAt, rosa.coins, rosa.payoutAllowed], [false, undefined, 0, false]);
  assert.strictEqual((await adminApi("overview")).body.players, 0);
  // A new approval: the start coins again
  const again = await access.approve("rosa");
  assert.strictEqual(again.coins, config.START_COINS);
});
