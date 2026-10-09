const { test, before, after } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const config = require("../game/config");
const cases = require("../game/cases");
const coins = require("../game/coins");

// Short timings for the tests
Object.assign(config, { BATTLE_START: 50, BATTLE_ROUND: 50, BATTLE_KEEP: 5000, BATTLE_MODE_REVEAL: 20, BATTLE_JACKPOT_DRAW: 20 });

/* ---------- Cases ---------- */

test("cases: the chances add up, every case gives back less than it costs - high risk ~87%, balanced ~92.5%, low risk ~97%", () => {
  for (const box of cases.CASES) {
    const weights = box.items.reduce((sum, item) => sum + item.weight, 0);
    assert.strictEqual(weights, cases.WEIGHT_TOTAL, `${box.id}: chances add up to 100%`);
    const back = cases.expectedValue(box) / box.price;
    // High risk gives back less on average (the price of the big jackpots)
    const [low, high] = { high: [0.86, 0.89], balanced: [0.915, 0.94], low: [0.955, 0.98] }[box.risk];
    assert.ok(back > low && back < high, `${box.id}: ${Math.round(back * 100)}% back on average`);
    assert.ok(["low", "balanced", "high"].includes(box.risk));
  }
});

test("cases: balanced cases are safe, high risk cases have a big jackpot", () => {
  const chanceAtLeastPrice = (box) =>
    box.items.filter((item) => item.value >= box.price).reduce((sum, item) => sum + item.weight, 0) / cases.WEIGHT_TOTAL;
  const best = (box) => Math.max(...box.items.map((item) => item.value)) / box.price;
  for (const box of cases.CASES) {
    assert.ok(best(box) * box.price <= Math.max(50000, box.price * 50), `${box.id}: at most 50k (or 50x a pricier case)`);
    assert.ok(box.price <= 2500, `${box.id}: at most 2.5k per case`);
    if (box.risk === "low") {
      assert.ok(chanceAtLeastPrice(box) >= 0.5, `${box.id}: mostly the price back`);
      assert.ok(best(box) <= 3, `${box.id}: no big jackpot`);
      assert.ok(Math.min(...box.items.map((item) => item.value)) >= box.price * 0.4, `${box.id}: no junk`);
    } else if (box.risk === "balanced") {
      assert.ok(chanceAtLeastPrice(box) >= 0.4, `${box.id}: often the price back`);
      assert.ok(best(box) <= 10, `${box.id}: no crazy jackpot`);
    } else {
      assert.ok(chanceAtLeastPrice(box) <= 0.3, `${box.id}: mostly a loss`);
      assert.ok(best(box) >= 50, `${box.id}: a huge item`);
    }
  }
  for (const risk of ["low", "balanced", "high"]) assert.ok(cases.CASES.filter((box) => box.risk === risk).length >= 5, risk);
  // Up to 2.5k per case (the dragon), the biggest win is 125k
  assert.strictEqual(Math.max(...cases.CASES.map((box) => box.price)), 2500);
  assert.strictEqual(Math.max(...cases.CASES.flatMap((box) => box.items.map((item) => item.value))), 125000);
});

test("cases: no case is another one with a different price - own chances, own payback", () => {
  const shape = (box) => box.items.map((item) => `${(item.value / box.price).toFixed(3)}@${item.weight}`).join(",");
  const shapes = new Set(cases.CASES.map(shape));
  assert.strictEqual(shapes.size, cases.CASES.length, "every case has its own chances");
  const paybacks = new Set(cases.CASES.map((box) => (cases.expectedValue(box) / box.price).toFixed(3)));
  assert.strictEqual(paybacks.size, cases.CASES.length, "every case has its own payback");
  // The jackpot items stay rare
  for (const box of cases.CASES) {
    const top = box.items.reduce((a, b) => (b.value > a.value ? b : a));
    const limit = { low: 0.03, balanced: 0.01, high: 0.001 }[box.risk];
    assert.ok(top.weight / cases.WEIGHT_TOTAL <= limit, `${box.id}: the best item at most ${limit * 100}%`);
  }
});

test("cases: the roll picks the item by its chance, provably fair", () => {
  const box = cases.caseById("starter");
  const first = box.items[0].weight / cases.WEIGHT_TOTAL; // the chance of the first item
  assert.strictEqual(cases.itemFor(box, 0), 0);
  assert.strictEqual(cases.itemFor(box, first - 0.00001), 0);
  assert.strictEqual(cases.itemFor(box, first), 1);
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
  for (const name of ["alice", "bob", "carol", "erin"]) tokens[name] = h.addUser(name);
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
  // While the cases are opened nobody has the pot yet (it can't be played elsewhere)
  assert.deepStrictEqual([h.coinsOf("alice"), h.coinsOf("bob")], [455, 455]);

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
  await h.wait(30);
  assert.strictEqual(h.coinsOf(winner), 455 + done.payout, "paid when the battle is over");
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
  // A bot's win stays with the house (a tie: carol gets her share of the pot)
  const mine = done.winners.indexOf(0);
  const expected = 1000 - 70 + (mine >= 0 ? done.shares[mine] : 0);
  await h.wait(30);
  assert.strictEqual(h.coinsOf("carol"), expected);
});

test("battles: random mode - one of all the modes, decided by the seed, only shown at the end", async () => {
  h.setCoins("carol", 1000);
  const carol = client("carol");
  await waitFor(carol, "coins", (data) => data.coins === 1000);
  const created = h.once(carol, "battleCreated");
  carol.emit("createBattle", { cases: ["lottery", "moon"], size: 2, mode: "random" });
  const id = await created;
  const running = waitFor(carol, "battles", (data) => battleIn(data, id) && battleIn(data, id).phase === "running");
  carol.emit("addBot", id);
  const during = battleIn(await running, id);
  assert.deepStrictEqual([during.mode, during.crazy, during.picked, during.points], ["random", null, null, null], "not known while it runs");
  const done = battleIn(await waitFor(carol, "battles", (data) => battleIn(data, id) && battleIn(data, id).phase === "done"), id);
  // The seed picked one of all the modes - anybody can check that afterwards
  const cases = require("../game/cases");
  const options = ["classic", "crazy", "jackpot", "bestof", "worstof"];
  assert.strictEqual(done.picked, options[Math.floor(cases.roll(done.fair.seed, `${id}:mode`) * options.length)]);
  assert.strictEqual(done.crazy, done.picked === "crazy");
  if (done.picked === "classic" || done.picked === "crazy") {
    const best = done.crazy ? Math.min(...done.totals) : Math.max(...done.totals);
    assert.strictEqual(done.totals[done.winner], best);
  }
  if (done.picked === "jackpot") assert.ok(done.ticket >= 0 && done.ticket < done.payout);
  if (done.picked === "bestof" || done.picked === "worstof") assert.ok(Array.isArray(done.points));
  // (the pot comes after the reveal of the mode - before the next test)
  await h.wait(80);
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

test("battles: up to 25 cases and 20,000 coins per battle", async () => {
  h.setCoins("bob", 100000);
  const bob = client("bob");
  await waitFor(bob, "coins", (d) => d.coins === 100000);
  const created = h.once(bob, "battleCreated");
  const listed = waitFor(bob, "battles", (data) => data.list.some((b) => b.cases.length === 25));
  bob.emit("createBattle", { cases: new Array(25).fill("piggy"), size: 2 });
  const id = await created;
  const battle = battleIn(await listed, id);
  assert.strictEqual(battle.cases.length, 25);
  assert.strictEqual(battle.price, 250);
  bob.emit("cancelBattle", id);
  await waitFor(bob, "battles", (data) => !battleIn(data, id));
  // More cases - or more coins - than allowed
  const tooMany = h.once(bob, "battleError");
  bob.emit("createBattle", { cases: new Array(26).fill("piggy"), size: 2 });
  assert.match(await tooMany, /At most 25 cases/);
  const tooMuch = h.once(bob, "battleError");
  bob.emit("createBattle", { cases: new Array(21).fill("vault"), size: 2 });
  assert.match(await tooMuch, /at most 🪙 20,000/);
});

test("battles: a player who joined can leave before it starts - the coins come back, the host can't", async () => {
  h.setCoins("alice", 1000);
  h.setCoins("bob", 1000);
  const alice = client("alice");
  const bob = client("bob");
  await Promise.all([waitFor(alice, "coins", (d) => d.coins === 1000), waitFor(bob, "coins", (d) => d.coins === 1000)]);
  alice.emit("createBattle", { cases: ["piggy"], size: 3 });
  const id = await h.once(alice, "battleCreated");
  const joined = waitFor(alice, "battles", (data) => battleIn(data, id) && battleIn(data, id).seats.filter(Boolean).length === 2);
  bob.emit("joinBattle", id);
  await joined;
  assert.strictEqual(h.coinsOf("bob"), 990);
  // The host can't leave (only cancel)
  alice.emit("leaveBattle", id);
  // Bob leaves: his seat is free, his coins are back
  const left = h.once(bob, "battleLeft");
  const freed = waitFor(alice, "battles", (data) => battleIn(data, id) && battleIn(data, id).seats.filter(Boolean).length === 1);
  bob.emit("leaveBattle", id);
  assert.strictEqual(await left, id);
  const after = battleIn(await freed, id);
  assert.deepStrictEqual(after.seats.map((seat) => seat && seat.name), ["alice", null, null]);
  assert.strictEqual(h.coinsOf("bob"), 1000);
  assert.strictEqual(h.coinsOf("alice"), 990, "the host is still in");
  // Not in it (anymore): nothing happens
  bob.emit("leaveBattle", id);
  alice.emit("cancelBattle", id);
  await waitFor(alice, "battles", (data) => !battleIn(data, id));
  assert.strictEqual(h.coinsOf("bob"), 1000);
});

test("battles: invalid battles, not enough coins, cancel gives the coins back", async () => {
  h.setCoins("alice", 30);
  const alice = client("alice");
  await waitFor(alice, "coins", (data) => data.coins === 30);

  for (const data of [null, {}, { cases: [] }, { cases: ["nope"], size: 2 }, { cases: ["starter"], size: 5 }]) {
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

test("battles: everybody in a battle hears that it starts - on every casino page", async () => {
  h.setCoins("alice", 500);
  h.setCoins("carol", 500);
  const alice = client("alice");
  const onPoker = server.client("/poker", tokens.alice);
  const onBlackjack = server.client("/blackjack", tokens.carol);
  const outsider = server.client("/jackpot", tokens.bob);
  sockets.push(onPoker, onBlackjack, outsider);
  await Promise.all([alice, onPoker, onBlackjack, outsider].map((s) => h.once(s, "connect")));
  let bobHeard = false;
  outsider.on("battleStarted", () => (bobHeard = true));

  const created = h.once(alice, "battleCreated");
  alice.emit("createBattle", { cases: ["starter"], size: 2, crazy: true });
  const id = await created;
  const heard = [h.once(onPoker, "battleStarted"), h.once(onBlackjack, "battleStarted"), h.once(alice, "battleStarted")];
  const carol = client("carol");
  await h.once(carol, "connect");
  carol.emit("joinBattle", id);
  for (const notice of await Promise.all(heard)) {
    assert.deepStrictEqual(notice, { id: id, price: notice.price, cases: 1, players: ["alice", "carol"], crazy: true, mode: "crazy" });
  }
  await h.wait(50);
  assert.strictEqual(bobHeard, false, "only the players of the battle");
});

test("battles: a tie - the winners split the pot (not the creator alone)", async () => {
  // Every case gives the same item: alice and bob have the same total
  const itemFor = cases.itemFor;
  cases.itemFor = (box) => itemFor(box, 0.5);
  try {
    // (late payouts of the battles before are in first)
    await h.wait(150);
    h.setCoins("alice", 500);
    h.setCoins("bob", 500);
    const alice = client("alice");
    const bob = client("bob");
    await Promise.all([waitFor(alice, "coins", (d) => d.coins === 500), waitFor(bob, "coins", (d) => d.coins === 500)]);
    const created = h.once(alice, "battleCreated");
    alice.emit("createBattle", { cases: ["starter", "classic"], size: 2, mode: "classic" });
    const id = await created;
    await waitFor(bob, "battles", (data) => battleIn(data, id));
    const done = waitFor(bob, "battles", (data) => battleIn(data, id) && battleIn(data, id).phase === "done");
    bob.emit("joinBattle", id);
    const battle = battleIn(await done, id);
    assert.strictEqual(battle.totals[0], battle.totals[1]);
    assert.deepStrictEqual(battle.winners, [0, 1]);
    assert.strictEqual(battle.shares[0] + battle.shares[1], battle.payout);
    assert.ok(Math.abs(battle.shares[0] - battle.shares[1]) <= 1);
    await h.wait(50);
    const price = battle.price;
    assert.deepStrictEqual([h.coinsOf("alice"), h.coinsOf("bob")], [500 - price + battle.shares[0], 500 - price + battle.shares[1]]);
    assert.deepStrictEqual(server.battles.lobby.history[0].winners, ["alice", "bob"]);
  } finally {
    cases.itemFor = itemFor;
  }
});

test("cases: the admin turns cases off - gone from the list to pick from, no new battles with them, at least one stays on", async () => {
  const settings = require("../game/settings");
  const [first, second] = cases.CASES;
  try {
    assert.ok((await settings.update({ BATTLE_CASES_OFF: [first.id] })).settings);
    assert.deepStrictEqual(config.BATTLE_CASES_OFF, [first.id]);
    assert.strictEqual(cases.enabled(first.id), false);
    assert.strictEqual(cases.enabled(second.id), true);
    // Still in the catalog (battles that have it show it), marked off
    assert.strictEqual(cases.catalog().find((box) => box.id === first.id).off, true);
    assert.strictEqual(cases.catalog().find((box) => box.id === second.id).off, false);
    // Unknown cases and all of them off: refused
    assert.match((await settings.update({ BATTLE_CASES_OFF: ["nope"] })).error, /unknown case/);
    assert.match((await settings.update({ BATTLE_CASES_OFF: cases.CASES.map((box) => box.id) })).error, /At least one/);
    assert.deepStrictEqual(config.BATTLE_CASES_OFF, [first.id], "nothing changed");
    // The admin panel lists every case with its switch
    const field = settings.list().find((f) => f.key === "BATTLE_CASES_OFF");
    assert.strictEqual(field.type, "cases");
    assert.strictEqual(field.options.length, cases.CASES.length);
  } finally {
    await settings.update({ BATTLE_CASES_OFF: [] });
  }
});

test("battles: jackpot mode - one winner, drawn from the seed by the worth; best of / worst of - the most rounds win", async () => {
  h.setCoins("carol", 50000);
  const carol = client("carol");
  await waitFor(carol, "coins", (d) => d.coins === 50000);
  // Best of with one case: fine (one round decides)
  carol.emit("createBattle", { cases: ["starter"], size: 2, mode: "bestof" });
  const single = await h.once(carol, "battleCreated");
  carol.emit("cancelBattle", single);
  for (const kind of ["jackpot", "bestof", "worstof"]) {
    carol.emit("createBattle", { cases: ["starter", "classic", "doge"], size: 3, mode: kind });
    const id = await h.once(carol, "battleCreated");
    carol.emit("addBot", id);
    carol.emit("addBot", id);
    const done = await waitFor(carol, "battles", (data) => data.list.some((b) => b.id === id && b.phase === "done"), 8000).then((data) => data.list.find((b) => b.id === id));
    assert.strictEqual(done.mode, kind);
    assert.strictEqual(done.payout, done.totals.reduce((sum, t) => sum + t, 0));
    if (kind === "jackpot") {
      // The ticket from the seed, in the pot: whose worth covers it wins (alone)
      const ticket = cases.roll(done.fair.seed, `${id}:jackpot`) * done.payout;
      assert.ok(Math.abs(done.ticket - ticket) < 1e-6);
      let covered = 0;
      const winner = done.totals.findIndex((total) => (covered += total) > ticket);
      assert.deepStrictEqual(done.winners, [winner]);
    } else {
      // The rounds: the best item of each (worst of: the worst) - the most rounds win (equal: the bigger total - worst of: the smaller)
      const least = kind === "worstof";
      const pick = (list) => (least ? Math.min(...list) : Math.max(...list));
      const points = done.seats.map(() => 0);
      done.rounds.forEach((round, r) => {
        const values = round.map((item) => cases.caseById(done.cases[r]).items[item].value);
        values.forEach((value, seat) => value === pick(values) && points[seat]++);
      });
      assert.deepStrictEqual(done.points, points);
      const most = Math.max(...points);
      const top = pick(points.map((p, seat) => (p === most ? done.totals[seat] : least ? Infinity : -1)));
      assert.deepStrictEqual(done.winners, points.map((p, seat) => (p === most && done.totals[seat] === top ? seat : -1)).filter((seat) => seat >= 0));
    }
  }
  carol.close();
});

test("battles: a player has at most BATTLE_MAX_OPEN battles at a time - one filled with bots counts while it runs", async () => {
  const old = { BATTLE_MAX_OPEN: config.BATTLE_MAX_OPEN, BATTLE_START: config.BATTLE_START };
  Object.assign(config, { BATTLE_MAX_OPEN: 2, BATTLE_START: 5000 });
  try {
    h.setCoins("erin", 1000);
    const erin = client("erin");
    await waitFor(erin, "coins", (data) => data.coins === 1000);
    const first = h.once(erin, "battleCreated");
    erin.emit("createBattle", { cases: ["piggy"], size: 2 });
    const id = await first;
    // Filled with a bot: it runs (the countdown is long here) - still one of hers
    erin.emit("addBot", id);
    await waitFor(erin, "battles", (data) => battleIn(data, id) && battleIn(data, id).phase === "running");
    const second = h.once(erin, "battleCreated");
    erin.emit("createBattle", { cases: ["piggy"], size: 2 });
    await second;
    const refused = h.once(erin, "battleError");
    erin.emit("createBattle", { cases: ["piggy"], size: 2 });
    assert.match(await refused, /At most 2 battles/);
  } finally {
    Object.assign(config, old);
  }
});

test("battles: while the end plays (the mode reveal) nobody in the battle has lost yet - no second chance before it", async () => {
  const inPlay = require("../game/in_play");
  const old = config.BATTLE_MODE_REVEAL;
  config.BATTLE_MODE_REVEAL = 600;
  try {
    h.setCoins("carol", 1000);
    const carol = client("carol");
    await waitFor(carol, "coins", (data) => data.coins === 1000);
    const created = h.once(carol, "battleCreated");
    carol.emit("createBattle", { cases: ["starter"], size: 2, mode: "random" });
    const id = await created;
    carol.emit("addBot", id);
    const done = battleIn(await waitFor(carol, "battles", (data) => battleIn(data, id) && battleIn(data, id).phase === "done"), id);
    assert.ok(inPlay.where("carol").includes("battles"), "the reveal still plays");
    await h.wait(750);
    // Over: nothing in play any more (a winner is paid by now)
    assert.ok(!inPlay.where("carol").includes("battles"), done.winners.includes(0) ? "won and paid" : "lost");
  } finally {
    config.BATTLE_MODE_REVEAL = old;
  }
});
