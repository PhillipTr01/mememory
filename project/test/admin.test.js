const { test, before, after } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const cookieParser = require("cookie-parser");
const h = require("./helpers");
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
  assert.match(cookie, /SameSite=Strict/i);
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

  const history = (await adminApi("history?username=paula")).body;
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
  const history = (await adminApi("history?username=quinn")).body.map((row) => row.reason);
  assert.ok(history.includes("withdrawal") && history.includes("withdrawal refund"));
});

test("admin: leaderboard, the richest first", async () => {
  h.setCoins("rosa", 900000);
  const board = (await adminApi("overview")).body.leaderboard;
  assert.strictEqual(board[0].username, "rosa");
  for (let i = 1; i < board.length; i++) assert.ok(board[i - 1].coins >= board[i].coins);
  assert.deepStrictEqual((await adminApi("users?q=ros")).body.map((p) => p.username), ["rosa"]);
});

test("admin: the address works with and without the invisible emoji character", async () => {
  const plain = encodeURI(config.ADMIN_PATH.replace(/\uFE0F/g, ""));
  assert.notStrictEqual(plain, ADMIN, "the default address has such a character");
  const res = await call(plain + "/", { cookie: adminCookie });
  assert.strictEqual(res.status, 200);
  assert.match(await res.text(), /adBalance/);
  // Without the slash: to the address with the slash
  const redirect = await call(plain);
  assert.strictEqual(redirect.status, 302);
  assert.strictEqual(redirect.headers.get("location"), plain + "/");
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
