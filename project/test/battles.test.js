const { test, before, after } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const config = require("../game/config");
const cases = require("../game/cases");
const coins = require("../game/coins");

// Short timings for the tests
Object.assign(config, { BATTLE_START: 50, BATTLE_ROUND: 50, BATTLE_KEEP: 5000 });

/* ---------- Cases ---------- */

test("cases: the chances add up and every case gives back a bit less than it costs", () => {
  for (const box of cases.CASES) {
    const weights = box.items.reduce((sum, item) => sum + item.weight, 0);
    assert.strictEqual(weights, cases.WEIGHT_TOTAL, `${box.id}: chances add up to 100%`);
    const back = cases.expectedValue(box) / box.price;
    assert.ok(back > 0.88 && back < 0.97, `${box.id}: ${Math.round(back * 100)}% back on average`);
    assert.ok(["balanced", "high"].includes(box.risk));
  }
});

test("cases: balanced cases are safe, high risk cases have a big jackpot", () => {
  const chanceAtLeastPrice = (box) =>
    box.items.filter((item) => item.value >= box.price).reduce((sum, item) => sum + item.weight, 0) / cases.WEIGHT_TOTAL;
  const best = (box) => Math.max(...box.items.map((item) => item.value)) / box.price;
  for (const box of cases.CASES) {
    if (box.risk === "balanced") {
      assert.ok(chanceAtLeastPrice(box) >= 0.4, `${box.id}: often the price back`);
      assert.ok(best(box) <= 10, `${box.id}: no crazy jackpot`);
    } else {
      assert.ok(chanceAtLeastPrice(box) <= 0.25, `${box.id}: mostly a loss`);
      assert.ok(best(box) >= 50, `${box.id}: a huge item`);
    }
  }
  assert.ok(cases.CASES.some((box) => box.risk === "balanced") && cases.CASES.some((box) => box.risk === "high"));
});

test("cases: the roll picks the item by its chance, provably fair", () => {
  const box = cases.caseById("starter");
  assert.strictEqual(cases.itemFor(box, 0), 0);
  assert.strictEqual(cases.itemFor(box, 0.29999), 0);
  assert.strictEqual(cases.itemFor(box, 0.3), 1);
  assert.strictEqual(cases.itemFor(box, 0.99999), box.items.length - 1);

  const { seed, hash } = cases.newSeed();
  assert.strictEqual(cases.seedHash(seed), hash);
  // The same seed and key always give the same roll, a different key another one
  assert.strictEqual(cases.roll(seed, "a:0:0"), cases.roll(seed, "a:0:0"));
  assert.notStrictEqual(cases.roll(seed, "a:0:0"), cases.roll(seed, "a:0:1"));

  // The rolls are spread evenly
  const counts = new Array(box.items.length).fill(0);
  for (let i = 0; i < 20000; i++) counts[cases.itemFor(box, cases.roll(seed, i))]++;
  box.items.forEach((item, index) => {
    const expected = item.weight / cases.WEIGHT_TOTAL;
    assert.ok(Math.abs(counts[index] / 20000 - expected) < 0.015, `${item.name}: ${counts[index] / 20000} ~ ${expected}`);
  });
});

/* ---------- Battles ---------- */

let server;
const sockets = [];
const tokens = {};

function client(user) {
  const socket = server.client("/battles", tokens[user]);
  sockets.push(socket);
  return socket;
}

function waitFor(socket, event, predicate, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timeout waiting for "${event}"`));
    }, timeout);
    function handler(data) {
      if (!predicate(data)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(data);
    }
    socket.on(event, handler);
  });
}

const battleIn = (data, id) => data.list.find((battle) => battle.id === id);

before(async () => {
  server = await h.startServer();
  for (const name of ["alice", "bob", "carol"]) tokens[name] = h.addUser(name);
});

after(async () => {
  sockets.forEach((s) => s.close());
  await server.close();
});

test("battles: two players pay the cases, the best total wins every item", async () => {
  h.setCoins("alice", 500);
  h.setCoins("bob", 500);
  const alice = client("alice");
  const bob = client("bob");
  const ready = [h.once(alice, "cases"), waitFor(alice, "coins", (data) => data.coins === 500), waitFor(bob, "coins", (data) => data.coins === 500)];
  const [catalog] = await Promise.all(ready);
  assert.ok(catalog.length >= 6 && catalog[0].items[0].chance > 0);

  const created = h.once(alice, "battleCreated");
  alice.emit("createBattle", { cases: ["starter", "classic", "starter"], size: 2 });
  const id = await created;
  assert.strictEqual(h.coinsOf("alice"), 500 - 45);

  const waiting = battleIn(await waitFor(bob, "battles", (data) => battleIn(data, id)), id);
  assert.strictEqual(waiting.phase, "waiting");
  assert.strictEqual(waiting.price, 45);
  assert.deepStrictEqual(waiting.seats, [{ name: "alice", bot: false }, null]);
  assert.strictEqual(waiting.fair.seed, undefined, "the seed is secret until the end");
  const hash = waiting.fair.hash;

  // Bob joins: the battle starts, nothing is shown yet
  const running = waitFor(bob, "battles", (data) => battleIn(data, id) && battleIn(data, id).phase === "running");
  bob.emit("joinBattle", id);
  const started = battleIn(await running, id);
  assert.strictEqual(started.revealed, 0);
  assert.deepStrictEqual(started.rounds, [], "the items come round by round");

  // One round after the other
  const round1 = battleIn(await waitFor(bob, "battles", (data) => battleIn(data, id) && battleIn(data, id).revealed === 1), id);
  assert.strictEqual(round1.rounds.length, 1);

  const done = battleIn(await waitFor(bob, "battles", (data) => battleIn(data, id) && battleIn(data, id).phase === "done"), id);
  assert.strictEqual(done.rounds.length, 3);
  assert.strictEqual(cases.seedHash(done.fair.seed), hash);

  // Everybody can check every item with the seed
  done.rounds.forEach((round, r) =>
    round.forEach((item, seat) => {
      const box = cases.caseById(done.cases[r]);
      assert.strictEqual(item, cases.itemFor(box, cases.roll(done.fair.seed, `${id}:${r}:${seat}`)));
    }),
  );
  const [a, b] = done.totals;
  assert.strictEqual(done.payout, a + b);
  assert.ok(done.totals[done.winner] === Math.max(a, b));

  // The winner gets every item's worth, the other one nothing
  const winner = done.seats[done.winner].name;
  const loser = winner === "alice" ? "bob" : "alice";
  assert.strictEqual(h.coinsOf(winner), 455 + done.payout);
  assert.strictEqual(h.coinsOf(loser), 455);
});

test("battles: crazy mode - the lowest total wins; bots fill the seats", async () => {
  h.setCoins("carol", 1000);
  const carol = client("carol");
  await waitFor(carol, "coins", (data) => data.coins === 1000);
  const created = h.once(carol, "battleCreated");
  carol.emit("createBattle", { cases: ["lottery", "moon"], size: 3, crazy: true });
  const id = await created;

  // Only the creator can add bots
  const bob = client("bob");
  await h.once(bob, "battles");
  bob.emit("addBot", id);
  carol.emit("addBot", id);
  await waitFor(carol, "battles", (data) => battleIn(data, id) && battleIn(data, id).seats[1] != null);
  carol.emit("addBot", id);

  const done = battleIn(await waitFor(carol, "battles", (data) => battleIn(data, id) && battleIn(data, id).phase === "done"), id);
  assert.deepStrictEqual(done.seats.map((seat) => seat.bot), [false, true, true]);
  assert.notStrictEqual(done.seats[1].name, done.seats[2].name);
  assert.strictEqual(done.totals[done.winner], Math.min(...done.totals));
  // A bot's win stays with the house
  const expected = done.winner === 0 ? 1000 - 70 + done.payout : 1000 - 70;
  assert.strictEqual(h.coinsOf("carol"), expected);
});

test("battles: the same coins as the jackpot - every change reaches the page right away", async () => {
  h.setCoins("carol", 100);
  const carol = client("carol");
  const jackpot = server.client("/jackpot", tokens.carol);
  sockets.push(jackpot);
  await Promise.all([waitFor(carol, "coins", (d) => d.coins === 100), waitFor(jackpot, "coins", (d) => d.coins === 100)]);

  // A bet in the jackpot (another page): the battles page has the new balance
  const onBattles = waitFor(carol, "coins", (d) => d.coins === 60);
  jackpot.emit("bet", { amount: 40 });
  await onBattles;

  // A win in a game, too
  const won = waitFor(carol, "coins", (d) => d.coins === 60 + config.COIN_REWARDS.tictactoe);
  coins.reward("carol", "tictactoe");
  await won;

  // A quiet payout (shown after an animation) only when it is announced
  let early = false;
  const listener = (d) => d.coins === 65 + 500 && (early = true);
  carol.on("coins", listener);
  await coins.add("carol", 500, { quiet: true });
  await h.wait(50);
  assert.strictEqual(early, false);
  const announced = waitFor(carol, "coins", (d) => d.coins === 565);
  coins.notify("carol");
  await announced;
  carol.off("coins", listener);
});

test("battles: invalid battles, not enough coins, cancel gives the coins back", async () => {
  h.setCoins("alice", 30);
  const alice = client("alice");
  await waitFor(alice, "coins", (data) => data.coins === 30);

  for (const data of [null, {}, { cases: [] }, { cases: ["nope"], size: 2 }, { cases: ["starter"], size: 5 }, { cases: new Array(11).fill("starter"), size: 2 }]) {
    alice.emit("createBattle", data);
  }
  const poor = h.once(alice, "battleError");
  alice.emit("createBattle", { cases: ["pepe"], size: 2 });
  assert.match(await poor, /enough coins/);
  assert.strictEqual(h.coinsOf("alice"), 30);

  const created = h.once(alice, "battleCreated");
  alice.emit("createBattle", { cases: ["starter", "starter"], size: 4 });
  const id = await created;
  assert.strictEqual(h.coinsOf("alice"), 10);

  // Bob joins, then alice cancels: both get their coins back
  h.setCoins("bob", 100);
  const bob = client("bob");
  await waitFor(bob, "coins", (data) => data.coins === 100);
  bob.emit("joinBattle", id);
  await waitFor(bob, "battles", (data) => battleIn(data, id) && battleIn(data, id).seats[1] != null);
  assert.strictEqual(h.coinsOf("bob"), 80);
  bob.emit("joinBattle", id); // twice: nothing happens
  bob.emit("cancelBattle", id); // not the creator: nothing happens
  await h.wait(50);
  assert.strictEqual(h.coinsOf("bob"), 80);

  alice.emit("cancelBattle", id);
  await waitFor(alice, "battles", (data) => !battleIn(data, id));
  await h.wait(50);
  assert.strictEqual(h.coinsOf("alice"), 30);
  assert.strictEqual(h.coinsOf("bob"), 100);
});
