const { test, before, after } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const config = require("../game/config");
const coins = require("../game/coins");
const crypto = require("crypto");
const { pickWinner, newFairRound, fairHash, fairWinner } = require("../game/jackpot");

// Short timings for the tests
Object.assign(config, { JACKPOT_COUNTDOWN: 200, JACKPOT_SPIN: 100, JACKPOT_PAUSE: 100, JACKPOT_BET_DELAY: [0, 0] });

/* ---------- Pure logic ---------- */

test("jackpot: every coin is a ticket, the chance is the share of the pot", () => {
  const entries = [
    { name: "alice", coins: 30 },
    { name: "bob", coins: 10 },
  ];
  // Tickets 0-29 belong to alice, 30-39 to bob
  assert.strictEqual(pickWinner(entries, () => 0).winner, "alice");
  assert.strictEqual(pickWinner(entries, () => 29).winner, "alice");
  assert.strictEqual(pickWinner(entries, () => 30).winner, "bob");
  assert.strictEqual(pickWinner(entries, () => 39).winner, "bob");
  assert.strictEqual(pickWinner(entries, () => 5).total, 40);

  const wins = { alice: 0, bob: 0 };
  for (let i = 0; i < 8000; i++) wins[pickWinner(entries).winner]++;
  const share = wins.alice / 8000;
  assert.ok(share > 0.71 && share < 0.79, `alice wins about 75% (${share})`);
  assert.strictEqual(pickWinner([]), null);
});

test("jackpot: provably fair - the number is fixed before the round, its hash is public", () => {
  const round = newFairRound();
  assert.match(round.number, /^0\.\d{12}$/);
  assert.strictEqual(round.hash, crypto.createHash("sha256").update(round.number + ":" + round.secret).digest("hex"));
  assert.strictEqual(fairHash(round.number, round.secret), round.hash);

  // The number picks the ticket: 0.5 of 40 tickets = ticket 20
  const bets = [{ name: "alice", coins: 30 }, { name: "bob", coins: 10 }];
  assert.deepStrictEqual(fairWinner(bets, "0.500000000000"), { winner: "alice", ticket: 20, total: 40 });
  assert.strictEqual(fairWinner(bets, "0.999999999999").winner, "bob");
  assert.strictEqual(fairWinner(bets, "0.000000000000").ticket, 0);
});

test("jackpot: later bets get the tickets at the end (own range per bet)", () => {
  // alice 0-49, bob 50-79, alice again 80-99: the last 20% are alice's second bet
  const bets = [{ name: "alice", coins: 50 }, { name: "bob", coins: 30 }, { name: "alice", coins: 20 }];
  assert.strictEqual(fairWinner(bets, "0.79").winner, "bob");
  assert.strictEqual(fairWinner(bets, "0.80").winner, "alice");
  assert.strictEqual(fairWinner(bets, "0.99").ticket, 99);
});

/* ---------- Coins ---------- */

let server;
const sockets = [];
const tokens = {};

function client(user) {
  const socket = server.client("/jackpot", tokens[user]);
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

before(async () => {
  server = await h.startServer();
  for (const name of ["alice", "bob", "carol", "dave"]) tokens[name] = h.addUser(name);
});

after(async () => {
  sockets.forEach((s) => s.close());
  await server.close();
});

test("coins: old accounts start with the start coins, spending needs enough coins", async () => {
  assert.deepStrictEqual(await coins.get("dave"), { coins: config.START_COINS, bonus: false });
  assert.strictEqual(await coins.spend("dave", config.START_COINS + 1), false);
  assert.strictEqual(await coins.spend("dave", 40), true);
  assert.strictEqual(await coins.spend("dave", 1.5), false);
  assert.strictEqual(await coins.spend("dave", -5), false);
  assert.strictEqual(h.coinsOf("dave"), config.START_COINS - 40);

  // Wins give coins
  coins.reward("dave", "expert");
  await h.wait(20);
  assert.strictEqual(h.coinsOf("dave"), config.START_COINS - 40 + config.COIN_REWARDS.expert);
});

test("coins: free coins once a day, only when (almost) broke", async () => {
  h.setCoins("dave", 50);
  assert.strictEqual(await coins.claimBonus("dave"), false, "not broke");
  h.setCoins("dave", 3);
  assert.strictEqual((await coins.get("dave")).bonus, true);
  assert.strictEqual(await coins.claimBonus("dave"), true);
  assert.strictEqual(h.coinsOf("dave"), 3 + config.DAILY_BONUS);
  h.setCoins("dave", 0);
  assert.strictEqual(await coins.claimBonus("dave"), false, "once a day");
  assert.strictEqual(await coins.claimBonus("dave", Date.now() + config.BONUS_EVERY + 1000), true);
});

/* ---------- The pot ---------- */

test("jackpot: two players start the countdown, the winner gets the whole pot", async () => {
  h.setCoins("alice", 100);
  h.setCoins("bob", 100);
  const alice = client("alice");
  const bob = client("bob");
  await waitFor(alice, "coins", (data) => data.coins === 100);
  await waitFor(bob, "coins", (data) => data.coins === 100);

  // One player alone: no countdown
  const open = waitFor(alice, "jackpotState", (s) => s.total === 30);
  alice.emit("bet", { amount: 30 });
  const state = await open;
  assert.strictEqual(state.phase, "open");
  assert.strictEqual(h.coinsOf("alice"), 70);

  const countdown = waitFor(alice, "jackpotState", (s) => s.phase === "countdown");
  bob.emit("bet", { amount: 10 });
  const running = await countdown;
  assert.strictEqual(running.total, 40);
  assert.ok(running.endsIn > 0);

  // Bets during the countdown still count
  const more = waitFor(alice, "jackpotState", (s) => s.total === 45);
  bob.emit("bet", { amount: 5 });

  // Every bet has its own tickets, in the order of the bets
  const bets = (await more).bets;
  assert.deepStrictEqual(bets.map((b) => [b.name, b.from, b.to]), [["alice", 1, 30], ["bob", 31, 40], ["bob", 41, 45]]);
  assert.strictEqual((await more).fair.number, undefined, "the winning number is secret until the draw");
  const hash = (await more).fair.hash;

  const drawing = await waitFor(alice, "jackpotState", (s) => s.phase === "drawing");
  // Now everybody can check the draw
  assert.strictEqual(fairHash(drawing.fair.number, drawing.fair.secret), hash);
  assert.strictEqual(drawing.draw.ticket, Math.floor(Number(drawing.fair.number) * 45));
  assert.ok(["alice", "bob"].includes(drawing.draw.winner));
  assert.strictEqual(drawing.draw.total, 45);
  assert.ok(drawing.draw.ticket >= 0 && drawing.draw.ticket < 45);

  // Nothing is lost or created: 200 coins before, 200 after
  await waitFor(alice, "jackpotState", (s) => s.history.length > 0);
  assert.strictEqual(h.coinsOf("alice") + h.coinsOf("bob"), 200);
  const winner = drawing.draw.winner;
  assert.strictEqual(h.coinsOf(winner), (winner === "alice" ? 70 : 85) + 45);

  // A new, empty round follows
  const next = await waitFor(alice, "jackpotState", (s) => s.phase === "open");
  assert.strictEqual(next.total, 0);
  assert.strictEqual(next.round, drawing.round + 1);
});

test("jackpot: invalid bets are rejected", async () => {
  h.setCoins("carol", 20);
  const carol = client("carol");
  await waitFor(carol, "coins", (data) => data.coins === 20);

  for (const amount of [0, -5, 2.5, "10", null]) carol.emit("bet", { amount });
  carol.emit("bet", null);
  const tooMuch = h.once(carol, "betError");
  carol.emit("bet", { amount: 21 });
  assert.match(await tooMuch, /enough coins/);

  assert.strictEqual(h.coinsOf("carol"), 20);

  // Any amount, but only a few separate bets per round
  h.setCoins("carol", 5000);
  for (let i = 0; i < config.JACKPOT_MAX_BETS; i++) {
    const placed = waitFor(carol, "jackpotState", (s) => s.bets.filter((b) => b.name === "carol").length === i + 1);
    carol.emit("bet", { amount: i === 0 ? 2000 : 1 });
    await placed;
  }
  const overLimit = h.once(carol, "betError");
  carol.emit("bet", { amount: 1 });
  assert.match(await overLimit, /At most 5 bets/);
  assert.strictEqual(h.coinsOf("carol"), 5000 - 2000 - (config.JACKPOT_MAX_BETS - 1));
});

test("jackpot: one chat for every hidden game, no info messages", async () => {
  const alice = client("alice");
  const onPoker = server.client("/poker", tokens.bob);
  const onBattles = server.client("/battles", tokens.carol);
  const onCasino = server.client("/casino", tokens.dave);
  sockets.push(onPoker, onBattles, onCasino);
  await Promise.all([alice, onPoker, onBattles, onCasino].map((s) => h.once(s, "connect")));
  await h.wait(50);
  const everywhere = [alice, onPoker, onBattles, onCasino].map((s) => waitFor(s, "chatMessage", (m) => m.text === "good luck"));
  alice.emit("sendChatMessage", { message: "good luck" });
  for (const message of await Promise.all(everywhere)) {
    assert.strictEqual(message.name, "alice");
    assert.strictEqual(message.type, "user");
  }
  // A new page gets the history - only messages of players
  const late = server.client("/battles", tokens.bob);
  sockets.push(late);
  const history = await h.once(late, "chatHistory");
  assert.ok(history.some((m) => m.text === "good luck"));
  assert.ok(history.every((m) => m.type === "user"));
});

test("jackpot: a bet gets into the pot only after a few seconds - too late for the draw: coins back", async () => {
  Object.assign(config, { JACKPOT_BET_DELAY: [300, 300], JACKPOT_COUNTDOWN: 1000 });
  try {
    h.setCoins("alice", 100);
    h.setCoins("bob", 100);
    const alice = client("alice");
    const bob = client("bob");
    const [before] = await Promise.all([
      waitFor(alice, "jackpotState", (s) => s.phase === "open"),
      waitFor(alice, "coins", (d) => d.coins === 100),
      waitFor(bob, "coins", (d) => d.coins === 100),
    ]);
    assert.ok(config.JACKPOT_DRAWS.includes(before.mode), "the animation of the round is chosen by the server");
    const start = before.total; // what is in the pot from before

    // On its way: the coins are reserved, but the pot doesn't have it yet - for nobody
    const own = waitFor(alice, "jackpotState", (s) => s.pending.length === 1);
    const forBob = waitFor(bob, "jackpotState", () => true);
    alice.emit("bet", { amount: 30 });
    const mine = await own;
    assert.strictEqual(mine.total, start, "not in the pot yet");
    assert.ok(mine.bets.every((bet) => bet.name !== "alice"));
    assert.strictEqual((await forBob).total, start);
    assert.deepStrictEqual((await forBob).pending, [], "the others don't know about it");
    assert.strictEqual(h.coinsOf("alice"), 70, "reserved right away");

    // After the delay it is in the pot, with its tickets
    const landed = await waitFor(bob, "jackpotState", (s) => s.total === start + 30);
    assert.deepStrictEqual(landed.bets[landed.bets.length - 1], { name: "alice", amount: 30, from: start + 1, to: start + 30 });

    // Bob's bet counts when it arrives (a second player: the countdown runs)
    bob.emit("bet", { amount: 10 });
    const counting = await waitFor(alice, "jackpotState", (s) => s.total === start + 40);
    assert.strictEqual(counting.phase, "countdown");

    // A bet that doesn't arrive before the draw doesn't count: the coins come back
    await h.wait(Math.max(0, counting.endsIn - 150)); // the bet would arrive after the draw started
    const bounced = h.once(bob, "betError");
    bob.emit("bet", { amount: 20 });
    const drawing = await waitFor(alice, "jackpotState", (s) => s.phase === "drawing", 4000);
    assert.strictEqual(drawing.draw.total, start + 40, "the late bet is not in the draw");
    assert.match(await bounced, /Too late/);
    await h.wait(50);
    const winner = drawing.draw.winner;
    // 100 - 10 (bet) - 20 (back again) + 20 = 90, plus the pot if bob won
    assert.strictEqual(h.coinsOf("bob"), 90 + (winner === "bob" ? start + 40 : 0));
    assert.strictEqual(drawing.mode, before.mode, "the same animation for everybody");
    await waitFor(alice, "jackpotState", (s) => s.phase === "open", 4000);
  } finally {
    Object.assign(config, { JACKPOT_BET_DELAY: [0, 0], JACKPOT_COUNTDOWN: 200 });
  }
});

test("jackpot: the secret word gives coins every time (not too fast)", async () => {
  h.setCoins("carol", 0);
  const carol = client("carol");
  await waitFor(carol, "coins", (data) => data.coins === 0);

  // Wrong letters: nothing
  carol.emit("typed", "money");
  carol.emit("typed", 12345);
  carol.emit("typed", "x".repeat(40) + config.JACKPOT_SECRET);
  await h.wait(100);
  assert.strictEqual(h.coinsOf("carol"), 0);

  const got = h.once(carol, "secretCoins");
  carol.emit("typed", "abc" + config.JACKPOT_SECRET);
  assert.strictEqual(await got, config.JACKPOT_SECRET_COINS);
  assert.strictEqual(h.coinsOf("carol"), config.JACKPOT_SECRET_COINS);

  // Right away again: too fast, after the cooldown: again
  carol.emit("typed", config.JACKPOT_SECRET);
  await h.wait(100);
  assert.strictEqual(h.coinsOf("carol"), config.JACKPOT_SECRET_COINS);
  await h.wait(config.JACKPOT_SECRET_COOLDOWN);
  const again = h.once(carol, "secretCoins");
  carol.emit("typed", config.JACKPOT_SECRET);
  await again;
  assert.strictEqual(h.coinsOf("carol"), 2 * config.JACKPOT_SECRET_COINS);
});

/* ---------- Secret address, start coins ---------- */

test("casino: a secret address with the choice of games, jackpot, battles and poker under it", async () => {
  const express = require("express");
  const http = require("http");
  const secretRoute = require("../routes/secret_route");
  const app = express();
  const base = encodeURI(config.JACKPOT_PATH);
  app.use(base, secretRoute((req, res, next) => next()));
  const web = http.createServer(app);
  await new Promise((resolve) => web.listen(0, resolve));
  const get = (path) =>
    new Promise((resolve, reject) =>
      http.get({ port: web.address().port, path: path }, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode, location: res.headers.location, body: body }));
      }).on("error", reject),
    );
  try {
    assert.strictEqual(config.JACKPOT_PATH, "/🤫🎰💸");
    // Without the slash: redirected, so the relative links work
    const redirect = await get(base);
    assert.strictEqual(redirect.status, 302);
    assert.strictEqual(redirect.location, base + "/");
    assert.match((await get(base + "/")).body, /<title>Secret Casino/);
    assert.match((await get(base + "/jackpot")).body, /<title>Jackpot/);
    assert.match((await get(base + "/battles")).body, /<title>Case Battles/);
    assert.match((await get(base + "/poker")).body, /<title>Poker/);
    // The old, easy addresses are gone
    for (const path of ["/jackpot", "/battles", "/poker"]) assert.strictEqual((await get(path)).status, 404);
  } finally {
    await new Promise((resolve) => web.close(resolve));
  }
});

test("jackpot: the Konami code gets the secret address from the server", async () => {
  const lobby = server.client("/lobby", tokens.alice);
  sockets.push(lobby);
  await h.once(lobby, "connect");
  const url = await new Promise((resolve) => lobby.emit("secretDoor", resolve));
  assert.strictEqual(url, encodeURI("/🤫🎰💸") + "/");
});

test("coins: everybody starts with 100k - a reset gives every account 100k once", async () => {
  assert.strictEqual(config.START_COINS, 100000);
  // A new account
  h.addUser("erin");
  assert.strictEqual((await coins.get("erin")).coins, 100000);
  // An account from before the reset (30 coins left): 100k, only once
  h.addUser("frank");
  const User = require("../models/User");
  await User.updateOne({ username: "frank" }, { $set: { coins: 30, coinReset: "an-old-reset" } });
  assert.strictEqual((await coins.get("frank")).coins, 100000);
  assert.strictEqual(await coins.spend("frank", 99000), true);
  assert.strictEqual((await coins.get("frank")).coins, 1000, "no second reset");
});

test("casino: the start page shows what is going on in every game", async () => {
  const page = server.client("/casino", tokens.carol);
  sockets.push(page);
  const summary = await h.once(page, "summary");
  assert.deepStrictEqual(Object.keys(summary).sort(), ["battles", "jackpot", "poker"]);
  assert.strictEqual(summary.poker.seats, config.POKER_SEATS);
  assert.ok(typeof summary.jackpot.total === "number");
});
