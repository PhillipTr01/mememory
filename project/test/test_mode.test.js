const { test, before, after } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const config = require("../game/config");
const coins = require("../game/coins");
const testMode = require("../game/test_mode");
const shop = require("../game/shop");
const gifts = require("../game/gifts");
const withdrawals = require("../game/withdrawals");

Object.assign(config, { ROULETTE_TIMER: 100, ROULETTE_SPIN: 50, ROULETTE_PAUSE: 50 });

let server;
const tokens = {};
const sockets = [];
before(async () => {
  server = await h.startServer();
  for (const name of ["admin1", "real1"]) tokens[name] = h.addUser(name);
});
after(async () => {
  sockets.forEach((s) => s.close());
  testMode.reset();
  server.roulette.stop();
  await server.close();
});

test("test mode: a sandbox balance - the real coins, the history and the shop stay as they were; stopped: gone", async () => {
  h.setCoins("admin1", 1234);
  const logs = h.coinLogs.filter((row) => row.username === "admin1").length;
  assert.ok(!testMode.start("admin1", 5000).error);
  assert.strictEqual((await coins.get("admin1")).coins, 5000);
  assert.ok((await coins.get("admin1")).test);
  // As good as unlimited: more than there is - filled up
  assert.ok(await coins.spend("admin1", 3000, { reason: "slots bet" }));
  assert.ok(await coins.spend("admin1", 4000, { reason: "slots bet" }));
  assert.strictEqual((await coins.get("admin1")).coins, 1000);
  assert.ok(await coins.add("admin1", 500, { reason: "slots win" }));
  assert.strictEqual(testMode.balance("admin1"), 1500);
  assert.strictEqual(await coins.claim("admin1"), coins.dailyBonus(), "the bonus as often as wanted");
  assert.strictEqual(await coins.claim("admin1"), coins.dailyBonus());
  // Nothing of it in the database
  assert.strictEqual(h.coinsOf("admin1"), 1234);
  assert.strictEqual(h.coinLogs.filter((row) => row.username === "admin1").length, logs, "no coin history");

  // Coins of other players: never
  assert.ok(!(await coins.spend("admin1", 100, { reason: "jackpot bet" })));
  assert.match((await gifts.give("admin1", "real1", 100)).error, /Test mode/);
  assert.match((await withdrawals.request("admin1", 10000)).error, /Test mode/);

  // The shop: everything to wear, nothing saved
  const view = await shop.view("admin1");
  assert.ok(view.free && view.test);
  assert.ok(!(await shop.wear("admin1", "frame", "royal")).error);
  assert.deepStrictEqual(await shop.worn(["admin1"]), { admin1: { frame: "royal", effect: null } });
  assert.ok(!(h.userOf("admin1").looks && h.userOf("admin1").looks.frame));

  // Stopped: the real account again
  assert.ok(!testMode.stop("admin1").error);
  assert.strictEqual((await coins.get("admin1")).coins, 1234);
  assert.deepStrictEqual(await shop.worn(["admin1"]), {});
});

test("test mode: roulette with test coins pays into the sandbox; jackpot is closed", async () => {
  h.setCoins("admin1", 100);
  testMode.start("admin1", 1000000);
  const socket = server.client("/roulette", tokens.admin1);
  sockets.push(socket);
  await h.once(socket, "rouletteState");
  socket.emit("bet", { color: "green", amount: 10000 });
  await new Promise((resolve) => socket.on("rouletteState", (s) => s.phase === "idle" && s.history.length && resolve()));
  const won = server.roulette.table.history[0].color === "green";
  assert.strictEqual(testMode.balance("admin1"), 1000000 - 10000 + (won ? 140000 : 0));
  assert.strictEqual(h.coinsOf("admin1"), 100);

  const jackpot = server.client("/jackpot", tokens.admin1);
  sockets.push(jackpot);
  await h.once(jackpot, "jackpotState");
  const refused = h.once(jackpot, "betError");
  jackpot.emit("bet", { amount: 100 });
  assert.match(await refused, /Test mode/);
  testMode.stop("admin1");
});
