const { test, before, after } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const config = require("../game/config");
const slots = require("../game/slots");

/* ---------- The machine ---------- */

test("slots: 5 reels, 3 rows, 9 lines; pays back about 96.8% (exactly computed, no max win)", () => {
  assert.strictEqual(slots.STRIPS.length, 5);
  assert.strictEqual(slots.LINES.length, 9);
  assert.ok(slots.LINES.every((rows) => rows.length === 5 && rows.every((row) => row >= 0 && row <= 2)));
  // Nine different lines
  assert.strictEqual(new Set(slots.LINES.map((rows) => rows.join())).size, 9);
  const { rtp, lineHit } = slots.rtp();
  assert.ok(rtp > 0.965 && rtp < 0.971, `payback ${(rtp * 100).toFixed(2)}%`);
  assert.ok(lineHit > 0.05, "a line wins often enough");
});

test("slots: a line wins from the left, the wild stands for every symbol", () => {
  const pays = (id) => slots.SYMBOLS.find((s) => s.id === id).pays;
  assert.deepStrictEqual(slots.lineWin(["pepe", "pepe", "pepe", "doge", "pepe"]), { multiplier: pays("pepe")[0], symbol: "pepe", count: 3 });
  assert.strictEqual(slots.lineWin(["doge", "pepe", "pepe", "pepe", "pepe"]).multiplier, 0, "only from the left");
  assert.deepStrictEqual(slots.lineWin(["wild", "rocket", "wild", "rocket", "banana"]), { multiplier: pays("rocket")[1], symbol: "rocket", count: 4 });
  assert.deepStrictEqual(slots.lineWin(["wild", "wild", "wild", "wild", "wild"]), { multiplier: pays("wild")[2], symbol: "wild", count: 5 });
  // Three wilds and a banana: the wilds pay more on their own
  assert.deepStrictEqual(slots.lineWin(["wild", "wild", "wild", "banana", "doge"]), { multiplier: pays("wild")[0], symbol: "wild", count: 3 });
  assert.strictEqual(slots.lineWin(["banana", "doge", "banana", "banana", "banana"]).multiplier, 0);
});

test("slots: a spin pays a ninth of the bet per line times the multiplier", () => {
  // Every reel stops where its middle row is a diamond (or a wild)
  const stops = slots.STRIPS.map((strip) => strip.indexOf("diamond"));
  let n = 0;
  const result = slots.spin(900, () => stops[n++]);
  assert.deepStrictEqual(result.grid.map((reel) => reel[1]), ["diamond", "diamond", "diamond", "diamond", "diamond"]);
  const middle = result.lines.find((line) => line.line === 0);
  assert.deepStrictEqual([middle.symbol, middle.count, middle.win], ["diamond", 5, 100 * slots.SYMBOLS.find((s) => s.id === "diamond").pays[2]]);
  assert.strictEqual(result.win, Math.floor((900 * result.lines.reduce((sum, line) => sum + line.multiplier, 0)) / 9));
});

test("slots: three 🎁 start the bonus game - free spins with a growing multiplier, no max win (every free spin plays)", () => {
  // The 🎁 only on reels 1, 3, 5, never two in one window
  slots.STRIPS.forEach((strip, reel) => {
    const at = strip.map((s, i) => (s === "bonus" ? i : -1)).filter((i) => i >= 0);
    assert.strictEqual(at.length, [2, 0, 2, 0, 4][reel]);
    // Never two in one window (3 rows): at least 3 apart, also round the end of the strip
    at.forEach((i, n) => {
      const next = at[(n + 1) % at.length];
      if (at.length > 1) assert.ok((next - i + strip.length) % strip.length >= 3);
    });
  });
  // The middle row of reels 1, 3, 5 on a 🎁; the wheels: 8 free spins (field 2), start x3 (field 2)
  const bonusStops = slots.STRIPS.map((strip, reel) => ([0, 2, 4].includes(reel) ? strip.indexOf("bonus") : 0));
  // (the first ticket of field 2 of each wheel)
  const spinsTicket = slots.BONUS_SPINS[0].weight + slots.BONUS_SPINS[1].weight;
  const multiplierTicket = slots.BONUS_MULTIPLIERS[0].weight + slots.BONUS_MULTIPLIERS[1].weight;
  // Every free spin: the middle row all diamonds (5x diamond on line 1) - the free spins turn their own strips
  const diamonds = slots.FREE_STRIPS.map((strip) => strip.indexOf("diamond"));
  const rolls = bonusStops.concat([spinsTicket, multiplierTicket]);
  for (let n = 0; n < 8; n++) rolls.push(...diamonds);
  let i = 0;
  const big = slots.spin(100, () => rolls[i++]);
  assert.deepStrictEqual([big.bonus.spins, big.bonus.multiplier], [8, 3]);
  // Diamonds every time: far over the old cap of 250x - and still all 8 free spins play
  assert.ok(big.win > 100 * 250);
  assert.ok(!big.capped);
  assert.strictEqual(big.bonus.freeSpins.length, 8);
  assert.strictEqual(big.bonus.win + big.lineWin, big.win);

  // 5 free spins from x1 (stops without a 🎁 in sight: no retrigger) - every win is the line win times
  // the multiplier, which climbs by one
  const start = bonusStops.concat([0, 0]);
  const plain = slots.FREE_STRIPS.map((strip) => strip.findIndex((_, i) => [-1, 0, 1].every((d) => strip[(i + d + strip.length) % strip.length] !== "bonus")));
  let k = 0;
  let r = 0;
  const random = slots.spin(100, () => (k < start.length ? start[k++] : plain[r++ % 5]));
  assert.deepStrictEqual(random.bonus.freeSpins.map((f) => f.multiplier), [1, 2, 3, 4, 5]);
  random.bonus.freeSpins.forEach((f) => assert.strictEqual(f.win, f.lineWin * f.multiplier));

  // Three 🎁 in a free spin: 5 free spins more (5 + 5 = 10, multiplier 1 to 10)
  // (the 🎁 of the free spins: on their own strips)
  const freeBonusStops = slots.FREE_STRIPS.map((strip, reel) => ([0, 2, 4].includes(reel) ? strip.indexOf("bonus") : 0));
  const again = bonusStops.concat([0, 0], freeBonusStops);
  let j = 0;
  r = 0;
  const retriggered = slots.spin(100, () => (j < again.length ? again[j++] : plain[r++ % 5]));
  assert.strictEqual(retriggered.bonus.freeSpins[0].retrigger, slots.RETRIGGER);
  assert.strictEqual(retriggered.bonus.spins, 5 + slots.RETRIGGER);
  assert.strictEqual(retriggered.bonus.freeSpins.length, 10);
  assert.strictEqual(retriggered.bonus.freeSpins[9].multiplier, 10);

  // The bonus about 1 of 200 spins, a retrigger about 1 of 30 free spins
  const { bonusChance, rtp } = slots.rtp();
  assert.ok(bonusChance > 1 / 230 && bonusChance < 1 / 170, `bonus 1 of ${Math.round(1 / bonusChance)}`);
  const inWindow = (reel) => (slots.FREE_STRIPS[reel].filter((s) => s === "bonus").length * 3) / slots.FREE_STRIPS[reel].length;
  const retrigger = inWindow(0) * inWindow(2) * inWindow(4);
  assert.ok(retrigger > 1 / 45 && retrigger < 1 / 20, `retrigger 1 of ${Math.round(1 / retrigger)}`);
  assert.ok(rtp > 0.93 && rtp < 0.985);
});

test("slots: the coin sweat - the coin game still possible on the last reel, about as often as the 🎁 sweat", () => {
  const coin = (n) => Array.from({ length: 4 }, (_, reel) => [reel < n ? "coin" : "pepe", "doge", "banana"]).concat([["pepe", "doge", "banana"]]);
  assert.strictEqual(slots.coinSweat(coin(4), [0, 0, 0, 0, 0]), true, "4 coins: always");
  assert.strictEqual(slots.coinSweat(coin(2), [0, 0, 0, 0, 0]), false);
  let sweats = 0;
  const N = 40000;
  for (let i = 0; i < N; i++) {
    const r = slots.spin(100);
    if (slots.coinSweat(r.grid, r.stops)) sweats++;
  }
  assert.ok(sweats / N > 1 / 75 && sweats / N < 1 / 35, `1 of ${Math.round(N / sweats)}`);
});

test("slots: the free spins - no 🪙, fewer 🍌 (bigger wins), more 🎁 (retriggers)", () => {
  slots.FREE_STRIPS.forEach((strip, reel) => {
    assert.ok(!strip.includes("coin"));
    const count = (list, id) => list.filter((s) => s === id).length;
    assert.strictEqual(count(strip, "banana"), Math.max(0, count(slots.STRIPS[reel], "banana") - slots.FREE_DROP));
    assert.strictEqual(count(strip, "bonus"), slots.FREE_BONUS[reel]);
    // The rest as on the normal reels
    ["pepe", "doge", "money", "rocket", "diamond", "wild"].forEach((id) => assert.strictEqual(count(strip, id), count(slots.STRIPS[reel], id)));
    // Still never two 🎁 in one window
    const at = strip.map((s, i) => (s === "bonus" ? i : -1)).filter((i) => i >= 0);
    at.forEach((i, n) => at.length > 1 && assert.ok((at[(n + 1) % at.length] - i + strip.length) % strip.length >= 3));
  });
  for (let i = 0; i < 20; i++) {
    const result = slots.spin(100, undefined, { forceBonus: "free" });
    result.bonus.freeSpins.forEach((free) => assert.ok(!free.grid.flat().includes("coin")));
  }
});

test("slots: five 🪙 start the coin game - respins until three in a row bring nothing, every coin pays", () => {
  // The 🪙 on every reel
  slots.STRIPS.forEach((strip) => assert.ok(strip.includes("coin")));
  const { coinChance, coinRtp, rtp } = slots.rtp();
  assert.ok(coinChance > 1 / 230 && coinChance < 1 / 175, `coin game 1 of ${Math.round(1 / coinChance)}`);
  assert.ok(coinRtp > 0.08 && coinRtp < 0.25);
  assert.ok(rtp > 0.965 && rtp < 0.971, `payback ${(rtp * 100).toFixed(2)}%`);
  for (let i = 0; i < 200; i++) {
    const result = slots.spin(100, undefined, { forceBonus: "coins" });
    const game = result.coinGame;
    assert.ok(game && !result.bonus, "the coin game every time");
    assert.ok(game.start.length >= slots.COIN_TRIGGER);
    // The respins: a new coin brings them back to 3, an empty one takes one away; ends at 0 or all 15
    let left = slots.COIN_RESPINS;
    game.respins.forEach((r) => {
      left = r.coins.length ? slots.COIN_RESPINS : left - 1;
      assert.strictEqual(r.left, left);
    });
    assert.ok(left === 0 || game.coins.length === 15);
    // Never two coins on one spot
    assert.strictEqual(new Set(game.coins.map((c) => c.reel * 3 + c.row)).size, game.coins.length);
    assert.strictEqual(game.ultra, game.coins.length === 15);
    const x = game.coins.reduce((sum, c) => sum + c.x, 0) + (game.ultra ? slots.ULTRA : 0);
    assert.strictEqual(game.win, Math.min(Math.floor(100 * x), 100 * slots.COIN_MAX_WIN));
    assert.strictEqual(result.win, Math.min(result.lineWin, 100 * slots.MAX_WIN) + game.win);
  }
  // Every coin a value or a prize
  const prizes = slots.COIN_VALUES.filter((v) => v.prize).map((v) => v.prize);
  assert.deepStrictEqual(prizes, ["mini", "major", "mega"]);
});

/* ---------- The page ---------- */

let server;
const tokens = {};
const sockets = [];

before(async () => {
  server = await h.startServer();
  tokens.alice = h.addUser("alice");
  tokens.bob = h.addUser("bob");
});

test("slots: a 🧰 in the coin game - the player picks one of three boxes (MINI, MAJOR, MEGA shuffled on the server), the pick pays", async () => {
  const timing = { SLOTS_HOLD: 60000, SLOTS_MIN_GAP: 0, SLOTS_SPIN: 20, SLOTS_COUNT_TIME: 20, SLOTS_COIN_INTRO: 30, SLOTS_RESPIN: 20, SLOTS_ULTRA_TIME: 20, SLOTS_BONUS_END: 20, SLOTS_BIG_TIME: 20, SLOTS_SWEAT: 0, SLOTS_TEST_BONUS: "chest" };
  const before = Object.fromEntries(Object.keys(timing).map((key) => [key, config[key]]));
  Object.assign(config, timing);
  try {
    sockets.forEach((socket) => socket.close());
    await h.wait(50);
    h.setCoins("alice", 5000);
    const page = client("alice");
    await h.once(page, "slotsSetup");
    const result = h.once(page, "slotsResult");
    page.emit("spin", { bet: 100 });
    const spin = await result;
    const chest = spin.coinGame.start.find((c) => c.chest);
    assert.ok(chest && chest.x === 0 && !chest.prize, "a closed chest - worth nothing yet");
    assert.ok(!JSON.stringify(spin).includes("boxes"), "the boxes stay on the server");
    page.emit("bonusStart", { id: spin.id });
    await h.wait(10);
    // The chest is on the screen: the coin game waits for the pick (no payout meanwhile)
    page.emit("chestShow", { id: spin.id });
    await h.wait(30 + spin.coinGame.respins.length * 20 + 300);
    assert.strictEqual(h.coinsOf("alice"), 4900, "waits for the pick");
    // Wrong picks: nothing
    page.emit("chestPick", { id: spin.id, reel: chest.reel, row: chest.row, pick: 3 });
    page.emit("chestPick", { id: "nope", reel: chest.reel, row: chest.row, pick: 0 });
    const opened = h.once(page, "chestOpened");
    page.emit("chestPick", { id: spin.id, reel: chest.reel, row: chest.row, pick: 1 });
    const data = await opened;
    assert.deepStrictEqual([...data.boxes].sort(), ["major", "mega", "mini"]);
    assert.strictEqual(data.prize, data.boxes[1], "the picked box");
    const prizeX = slots.COIN_VALUES.find((v) => v.prize === data.prize).x;
    assert.strictEqual(data.win, spin.win + Math.min(spin.coinGame.win + 100 * prizeX, 100 * slots.COIN_MAX_WIN) - spin.coinGame.win);
    // A second pick of the same chest: nothing
    let again = false;
    page.once("chestOpened", () => (again = true));
    page.emit("chestPick", { id: spin.id, reel: chest.reel, row: chest.row, pick: 0 });
    await h.wait(30 + spin.coinGame.respins.length * 20 + 300);
    assert.strictEqual(again, false);
    assert.strictEqual(h.coinsOf("alice"), 4900 + data.win, "the prize of the pick is paid");
    page.close();
  } finally {
    Object.assign(config, before);
  }
});

test("slots: the chests take their weight from MINI, MAJOR and MEGA in equal parts - every prize as likely as before, the payback stays", () => {
  const weight = (prize) => slots.COIN_VALUES.find((v) => v.prize === prize).weight;
  const chest = slots.COIN_VALUES.find((v) => v.chest).weight;
  assert.strictEqual(chest % 3, 0);
  assert.deepStrictEqual(["mini", "major", "mega"].map((p) => weight(p) + chest / 3), [110, 35, 6]);
  for (let i = 0; i < 50; i++) assert.deepStrictEqual([...slots.chestBoxes()].sort(), ["major", "mega", "mini"]);
  // Opened: every copy of the coin gets the prize, the coin game and the spin pay it
  const result = slots.spin(100, undefined, { forceBonus: "chest" });
  const { reel, row } = result.coins.find((c) => c.chest);
  const before = result.win;
  const more = slots.openChest(result, 100, reel, row, "major");
  assert.strictEqual(result.win, before + more);
  assert.ok(more > 0 || result.coinGame.win === 100 * slots.COIN_MAX_WIN);
  [result.coins, result.coinGame.start, result.coinGame.coins].forEach((list) => assert.strictEqual(list.find((c) => c.reel === reel && c.row === row).prize, "major"));
});

after(async () => {
  sockets.forEach((s) => s.close());
  await server.close();
});

function client(name) {
  const socket = server.client("/slots", tokens[name]);
  sockets.push(socket);
  return socket;
}

test("slots: a spin a moment too early waits for the gap, one far too early is refused - the page always hears back", async () => {
  const old = { SLOTS_MIN_GAP: config.SLOTS_MIN_GAP, SLOTS_SPIN: config.SLOTS_SPIN };
  Object.assign(config, { SLOTS_MIN_GAP: 400, SLOTS_SPIN: 10 });
  try {
    h.setCoins("bob", 5000);
    const bob = client("bob");
    await h.once(bob, "slotsSetup");
    const first = h.once(bob, "slotsResult");
    bob.emit("spin", { bet: 10 });
    await first;
    const start = Date.now();
    const second = h.once(bob, "slotsResult");
    bob.emit("spin", { bet: 10 });
    await second;
    assert.ok(Date.now() - start >= 300, "waited for the gap");
    // Far too early: refused out loud (the coins stay)
    config.SLOTS_MIN_GAP = 5000;
    const coinsBefore = h.coinsOf("bob");
    const skipped = h.once(bob, "slotsSkip");
    bob.emit("spin", { bet: 10 });
    await skipped;
    assert.strictEqual(h.coinsOf("bob"), coinsBefore);
  } finally {
    Object.assign(config, old);
  }
});

test("slots: a spin costs the bet, the win comes right away, the others see it", async () => {
  Object.assign(config, { SLOTS_MIN_GAP: 0, SLOTS_SPIN: 10, SLOTS_COUNT_TIME: 0, SLOTS_BONUS_TIME: 0, SLOTS_FREE_SPIN: 0, SLOTS_BONUS_END: 0, SLOTS_RETRIGGER_TIME: 0, SLOTS_BIG_TIME: 0, SLOTS_SWEAT: 0 });
  h.setCoins("alice", 5000);
  const alice = client("alice");
  const bob = client("bob");
  const setup = await h.once(alice, "slotsSetup");
  assert.deepStrictEqual([setup.rules.minBet, setup.rules.maxBet, setup.rules.lines], [config.SLOTS_MIN_BET, config.SLOTS_MAX_BET, 9]);
  await h.once(bob, "slotsFeed");
  const feeds = [];
  bob.on("slotsFeed", (feed) => feeds.push(feed));

  // Out of the limits: nothing happens to the coins
  const n = (value) => value.toLocaleString("en-US");
  for (const bet of [config.SLOTS_MIN_BET - 1, config.SLOTS_MAX_BET + 1]) {
    const refused = h.once(alice, "slotsError");
    alice.emit("spin", { bet });
    assert.match(await refused, new RegExp(`${n(config.SLOTS_MIN_BET)} to ${n(config.SLOTS_MAX_BET)}`));
  }
  assert.strictEqual(h.coinsOf("alice"), 5000);

  // Spins until one wins: every spin costs 100, every win is paid
  let spent = 0;
  let won = 0;
  let winning = null;
  for (let i = 0; i < 200 && !winning; i++) {
    const result = h.once(alice, "slotsResult");
    alice.emit("spin", { bet: 100 });
    const r = await result;
    spent += 100;
    won += r.win;
    assert.strictEqual(r.grid.length, 5);
    // A bonus game waits for the click: played to its end right here (paid now, nothing left over for the next tests)
    if (r.id && (r.bonus || r.coinGame)) {
      alice.emit("bonusStart", { id: r.id });
      alice.emit("bonusDone", { id: r.id });
      continue;
    }
    if (r.win > 0) winning = r;
  }
  assert.ok(winning, "a win within 200 spins");
  await h.wait(50);
  assert.strictEqual(h.coinsOf("alice"), 5000 - spent + won);
  const feed = feeds[feeds.length - 1];
  assert.ok(feed, "bob saw the win");
  assert.strictEqual(feed[0].name, "alice");
  assert.strictEqual(feed[0].win, winning.win);

  // Not enough coins
  h.setCoins("alice", 50);
  const poor = h.once(alice, "slotsError");
  alice.emit("spin", { bet: 100 });
  assert.match(await poor, /enough coins/);
  Object.assign(config, { SLOTS_MIN_GAP: 2250, SLOTS_SPIN: 2000, SLOTS_COUNT_TIME: 800, SLOTS_BONUS_TIME: 6000, SLOTS_FREE_SPIN: 3000, SLOTS_BONUS_END: 4000, SLOTS_RETRIGGER_TIME: 900, SLOTS_BIG_TIME: 3000, SLOTS_SWEAT: 1800 });
});

test("slots: the admin test switch - every spin starts the bonus game", () => {
  for (let i = 0; i < 20; i++) {
    assert.ok(slots.spin(100, undefined, { forceBonus: "coins" }).coinGame, "or the coin game");
    const result = slots.spin(100, undefined, { forceBonus: true });
    assert.ok(result.bonus, "a bonus every time");
    assert.ok([0, 2, 4].every((reel) => result.grid[reel].includes("bonus")));
    assert.ok(result.win <= 100 * slots.MAX_WIN);
  }
});

test("slots: a bonus game waits while the player is away and goes on when they come back", async () => {
  const timing = { SLOTS_HOLD: 60000, SLOTS_MIN_GAP: 0, SLOTS_SPIN: 50, SLOTS_COUNT_TIME: 50, SLOTS_BONUS_TIME: 100, SLOTS_FREE_SPIN: 100, SLOTS_RETRIGGER_TIME: 10, SLOTS_BONUS_END: 50, SLOTS_RESUME_TIME: 50, SLOTS_BIG_TIME: 50, SLOTS_TEST_BONUS: "free" };
  const before = Object.fromEntries(Object.keys(timing).map((key) => [key, config[key]]));
  Object.assign(config, timing);
  try {
    // No other page of alice open (from the tests before)
    sockets.forEach((socket) => socket.close());
    await h.wait(50);
    h.setCoins("alice", 5000);
    const page = client("alice");
    await h.once(page, "slotsSetup");
    const result = h.once(page, "slotsResult");
    page.emit("spin", { bet: 100 });
    const spin = await result;
    assert.ok(spin.bonus && spin.id, "a bonus game with an id");
    // "You won free spins" waits for the click: nothing is paid meanwhile
    await h.wait(spin.payIn + 200);
    assert.strictEqual(h.coinsOf("alice"), 4900, "nothing paid before the start");
    // Started - one free spin seen, then the player leaves
    page.emit("bonusStart", { id: spin.id });
    page.emit("bonusProgress", { id: spin.id, shown: 1 });
    await h.wait(30);
    page.close();
    await h.wait(spin.payIn + 200);
    assert.strictEqual(h.coinsOf("alice"), 4900, "nothing paid while away");

    // Back: the bonus goes on after the first free spin, paid when it is over
    const again = client("alice");
    const resumed = await h.once(again, "slotsResume");
    assert.deepStrictEqual([resumed.id, resumed.shown, resumed.started, resumed.win], [spin.id, 1, true, spin.win]);
    assert.ok(resumed.payIn < spin.payIn);
    await h.wait(resumed.payIn + 200);
    assert.strictEqual(h.coinsOf("alice"), 4900 + spin.win);
    again.close();
  } finally {
    Object.assign(config, before);
  }
});

test("slots: the page played the bonus game to its end - paid right away (the count time), not after the reckoned show", async () => {
  const timing = { SLOTS_HOLD: 60000, SLOTS_MIN_GAP: 0, SLOTS_SPIN: 20, SLOTS_COUNT_TIME: 30, SLOTS_BONUS_TIME: 2000, SLOTS_FREE_SPIN: 2000, SLOTS_RETRIGGER_TIME: 10, SLOTS_BONUS_END: 2000, SLOTS_BIG_TIME: 2000, SLOTS_TEST_BONUS: "free" };
  const before = Object.fromEntries(Object.keys(timing).map((key) => [key, config[key]]));
  Object.assign(config, timing);
  try {
    sockets.forEach((socket) => socket.close());
    await h.wait(50);
    h.setCoins("alice", 5000);
    const page = client("alice");
    await h.once(page, "slotsSetup");
    const result = h.once(page, "slotsResult");
    page.emit("spin", { bet: 100 });
    const spin = await result;
    page.emit("bonusStart", { id: spin.id });
    await h.wait(30);
    // (another id - or someone else's - changes nothing)
    page.emit("bonusDone", { id: "nope" });
    page.emit("bonusDone", { id: spin.id });
    await h.wait(150);
    assert.strictEqual(h.coinsOf("alice"), 4900 + spin.win, "paid a moment after the end on the page");
    page.close();
  } finally {
    Object.assign(config, before);
  }
});

test("slots: the coin game waits for the click too and is paid when it is over", async () => {
  const timing = { SLOTS_HOLD: 60000, SLOTS_MIN_GAP: 0, SLOTS_SPIN: 20, SLOTS_COUNT_TIME: 20, SLOTS_COIN_INTRO: 30, SLOTS_RESPIN: 20, SLOTS_ULTRA_TIME: 20, SLOTS_BONUS_END: 20, SLOTS_BIG_TIME: 20, SLOTS_SWEAT: 0, SLOTS_TEST_BONUS: "coins" };
  const before = Object.fromEntries(Object.keys(timing).map((key) => [key, config[key]]));
  Object.assign(config, timing);
  try {
    sockets.forEach((socket) => socket.close());
    await h.wait(50);
    h.setCoins("alice", 5000);
    const page = client("alice");
    await h.once(page, "slotsSetup");
    const result = h.once(page, "slotsResult");
    page.emit("spin", { bet: 100 });
    const spin = await result;
    assert.ok(spin.coinGame && spin.id && spin.coins.length >= 5);
    await h.wait(300);
    assert.strictEqual(h.coinsOf("alice"), 4900, "nothing paid before the start");
    page.emit("bonusStart", { id: spin.id });
    await h.wait(30 + spin.coinGame.respins.length * 20 + 300);
    // (a 🧰 nobody picked: opened at random at the payout - it pays on top)
    if (spin.coinGame.coins.some((c) => c.chest)) assert.ok(h.coinsOf("alice") > 4900 + spin.win);
    else assert.strictEqual(h.coinsOf("alice"), 4900 + spin.win);
    page.close();
  } finally {
    Object.assign(config, before);
  }
});

test("slots: their own share of the max bet by balance (1/x of its all-in amount and of its share)", async () => {
  const h = require("./helpers");
  const coins = require("../game/coins");
  const limits = require("../game/limits");
  const config = require("../game/config");
  const saved = [config.BET_CAP_FLOOR, config.BET_CAP_SHARE, config.SLOTS_CAP_DIV];
  try {
    Object.assign(config, { BET_CAP_FLOOR: 50000, BET_CAP_SHARE: 25, SLOTS_CAP_DIV: 5 });
    assert.deepStrictEqual(limits.capRule("", "slots"), { floor: 10000, share: 5 });
    assert.strictEqual(limits.betCap(40000, "", "slots"), 10000, "all in only up to 50,000 / 5");
    assert.strictEqual(limits.betCap(1000000, "", "slots"), 50000, "above it 25% / 5 of the coins");
    assert.strictEqual(limits.betCap(1000000, ""), 250000, "the other games: the whole cap");
    assert.deepStrictEqual([limits.betCap(1000100, "", "slots"), limits.betCap(1234567, "")], [50100, 308700], "the share rounded up to the next 100");
    // A divided all-in amount up to the next 100 too: 10,000 / 15 - 700 (not 666)
    config.BET_CAP_FLOOR = 10000;
    config.SLOTS_CAP_DIV = 15;
    assert.strictEqual(limits.capRule("", "slots").floor, 700);
    assert.strictEqual(limits.betCap(500, "", "slots"), 700);
    Object.assign(config, { BET_CAP_FLOOR: 50000, SLOTS_CAP_DIV: 5 });
    h.addUser("capper");
    h.setCoins("capper", 1000000);
    assert.strictEqual(await coins.spend("capper", 50001, { reason: "slots bet" }), false);
    assert.match(coins.refusal("capper"), /Your max bet is 50,000\./);
    assert.strictEqual(await coins.spend("capper", 50000, { reason: "slots bet" }), true);
    assert.strictEqual(await coins.spend("capper", 200000, { reason: "roulette bet" }), true, "another game: the whole cap");
    assert.deepStrictEqual((await coins.get("capper")).slotsCapRule, { floor: 10000, share: 5 });
    config.SLOTS_CAP_DIV = 1;
    assert.strictEqual(limits.betCap(1000000, "", "slots"), 250000, "1: the same as every game");
  } finally {
    [config.BET_CAP_FLOOR, config.BET_CAP_SHARE, config.SLOTS_CAP_DIV] = saved;
  }
});

test("slots: one machine at a time - a second tab can't spin while the first one does (no autoplay in two tabs)", async () => {
  Object.assign(config, { SLOTS_MIN_GAP: 0, SLOTS_SPIN: 10, SLOTS_COUNT_TIME: 0, SLOTS_TAB_LOCK: 3000 });
  h.setCoins("alice", 100000);
  const first = client("alice");
  const second = client("alice");
  await Promise.all([h.once(first, "slotsSetup"), h.once(second, "slotsSetup")]);
  const spun = h.once(first, "slotsResult");
  first.emit("spin", { bet: 10 });
  await spun;
  const refused = h.once(second, "slotsError");
  second.emit("spin", { bet: 10 });
  assert.match(await refused, /another tab/);
  // The first tab goes on
  const again = h.once(first, "slotsResult");
  first.emit("spin", { bet: 10 });
  await again;
  config.SLOTS_TAB_LOCK = 8000;
});
