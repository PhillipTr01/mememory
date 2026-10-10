const { test, before, after } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const config = require("../game/config");
const coins = require("../game/coins");
const testMode = require("../game/test_mode");
const shop = require("../game/shop");
const gifts = require("../game/gifts");
const withdrawals = require("../game/withdrawals");

Object.assign(config, { ROULETTE_TIMER: 100, ROULETTE_SPIN: 50, ROULETTE_PAUSE: 50, JACKPOT_BET_DELAY: [10, 20], JACKPOT_SPIN: 50, JACKPOT_PAUSE: 50, SLOTS_MIN_GAP: 0, SLOTS_SPIN: 10 });

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
  // (a table game: slots have their own, smaller share of the max bet by balance)
  assert.ok(await coins.spend("admin1", 3000, { reason: "roulette bet" }));
  assert.ok(await coins.spend("admin1", 4000, { reason: "roulette bet" }));
  assert.strictEqual((await coins.get("admin1")).coins, 1000);
  assert.ok(await coins.add("admin1", 500, { reason: "slots win" }));
  assert.strictEqual(testMode.balance("admin1"), 1500);
  assert.strictEqual(await coins.claim("admin1"), coins.dailyBonus(), "the bonus as often as wanted");
  assert.strictEqual(await coins.claim("admin1"), coins.dailyBonus());
  // Nothing of it in the database
  assert.strictEqual(h.coinsOf("admin1"), 1234);
  assert.strictEqual(h.coinLogs.filter((row) => row.username === "admin1").length, logs, "no coin history");

  // Coins of other players: never
  assert.ok(!(await coins.spend("admin1", 100, { reason: "gift sent" })));
  assert.match((await gifts.give("admin1", "real1", 100)).error, /Test mode/);
  assert.match((await withdrawals.request("admin1", 10000)).error, /Test mode/);

  // The shop: everything to wear, nothing saved
  const view = await shop.view("admin1");
  assert.ok(view.free && view.test);
  assert.ok(!(await shop.wear("admin1", "frame", "royal")).error);
  assert.deepStrictEqual(await shop.worn(["admin1"]), { admin1: { frame: "royal", effect: null, background: null } });
  assert.ok(!(h.userOf("admin1").looks && h.userOf("admin1").looks.frame));

  // Stopped: the real account again
  assert.ok(!testMode.stop("admin1").error);
  assert.strictEqual((await coins.get("admin1")).coins, 1234);
  assert.deepStrictEqual(await shop.worn(["admin1"]), {});
});

test("test mode: a world of its own - testers only there, real players never; jackpot with bots, roulette pays into the sandbox", async () => {
  h.setCoins("admin1", 100);
  h.setCoins("real1", 5000);
  testMode.start("admin1", 1000000);
  // The real casino: no tester - the test world: no real player ("testMode": the page loads again)
  const wrong = server.client("/roulette", tokens.admin1);
  sockets.push(wrong);
  assert.strictEqual((await h.once(wrong, "connect_error")).message, "testMode");
  const outsider = server.client("/test/jackpot", tokens.real1);
  sockets.push(outsider);
  assert.strictEqual((await h.once(outsider, "connect_error")).message, "testMode");

  // Roulette in the test world: test coins in and out
  const socket = server.client("/test/roulette", tokens.admin1);
  sockets.push(socket);
  await h.once(socket, "rouletteState");
  socket.emit("bet", { color: "green", amount: 10000 });
  await new Promise((resolve) => socket.on("rouletteState", (s) => s.phase === "idle" && s.history.length && resolve()));
  const won = server.test.roulette.table.history[0].color === "green";
  assert.strictEqual(testMode.balance("admin1"), 1000000 - 10000 + (won ? 140000 : 0));
  assert.strictEqual(h.coinsOf("admin1"), 100);
  assert.strictEqual(server.roulette.table.history.length, 0, "the real roulette saw nothing");

  // Jackpot in the test world: open for testers - bots join, the draw now
  const jackpot = server.client("/test/jackpot", tokens.admin1);
  sockets.push(jackpot);
  await h.once(jackpot, "jackpotState");
  const landed = new Promise((resolve) => jackpot.on("jackpotState", (s) => s.entries && s.entries.length >= 2 && resolve(s)));
  server.test.jackpot.botBet("🤖Botty", 500);
  jackpot.emit("bet", { amount: 1000 });
  const state = await landed;
  assert.ok(state.entries.some((e) => e.name === "🤖Botty"));
  assert.strictEqual(server.jackpot.pot.entries.length, 0, "the real jackpot saw nothing");
  assert.ok(server.test.jackpot.drawNow());
  assert.strictEqual(h.coinsOf("real1"), 5000);
  testMode.stop("admin1");
});

test("test mode debug levers: the next winner, roulette color, slots bonus, stacked blackjack deal, the draw animation", async () => {
  const roulette = require("../game/roulette");
  testMode.start("admin1", 1000000);
  try {
    // Jackpot: a bot and me - the bot wins, the animation picked
    const jp = server.test.jackpot;
    // (the draw of the test before: over first)
    while (jp.pot.phase === "drawing") await h.wait(20);
    jp.botBet("🤖Botty", 100);
    jp.botBet("🤖Clanky", 100);
    assert.ok(jp.setMode("claw"));
    assert.strictEqual(jp.pot.mode, "claw");
    assert.ok(jp.forceWinner("🤖Clanky"));
    assert.ok(jp.drawNow());
    await h.wait(20);
    assert.strictEqual(jp.pot.draw.winner, "🤖Clanky");

    // Roulette: green next
    const rl = server.test.roulette;
    rl.forceColor("green");
    rl.botBet("🤖Botty", "red", 100);
    assert.ok(rl.rollNow());
    assert.strictEqual(roulette.WHEEL[rl.table.slot].color, "green");

    // Slots: the next spin starts the coin game
    server.test.slots.forceBonus("coins");
    const slots = server.client("/test/slots", tokens.admin1);
    sockets.push(slots);
    await h.once(slots, "slotsSetup");
    const result = h.once(slots, "slotsResult");
    slots.emit("spin", { bet: 10 });
    assert.ok((await result).coinGame, "the coin game");

    // Blackjack: the next deal is stacked
    assert.ok(server.test.blackjack.stackDeal("blackjack"));
    assert.ok(!server.test.blackjack.stackDeal("nonsense"));
  } finally {
    testMode.stop("admin1");
  }
});
