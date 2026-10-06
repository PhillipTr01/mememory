const { test, before, after } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const config = require("../game/config");
const coins = require("../game/coins");
const crypto = require("crypto");
const { pickWinner, newFairRound, fairHash, fairWinner } = require("../game/jackpot");

// Short timings for the tests
Object.assign(config, { JACKPOT_COUNTDOWN: 200, JACKPOT_SPIN: 100, JACKPOT_PAUSE: 100, JACKPOT_BET_DELAY: [0, 0], JACKPOT_GHOST_AFTER: 60000 });

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
  const first = await coins.get("dave");
  assert.strictEqual(first.coins, config.START_COINS);
  assert.strictEqual(first.bonus, true, "the free coins of the first day are there");
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

test("coins: free coins for everybody once a day, whatever the balance", async () => {
  h.setCoins("dave", 50000);
  const before = await coins.get("dave");
  assert.strictEqual(before.bonus, true);
  assert.strictEqual(before.bonusIn, 0);
  assert.strictEqual(before.bonusAmount, config.DAILY_BONUS);
  assert.strictEqual(await coins.claimBonus("dave"), true, "not only when broke");
  assert.strictEqual(h.coinsOf("dave"), 50000 + config.DAILY_BONUS);
  // Once a day: the page knows when the next ones come
  assert.strictEqual(await coins.claimBonus("dave"), false, "once a day");
  const after = await coins.get("dave");
  assert.strictEqual(after.bonus, false);
  assert.ok(after.bonusIn > 0 && after.bonusIn <= 25 * 60 * 60 * 1000);
});

test("coins: the free coins come back at midnight (German time), not after 24 hours", async () => {
  const days = require("../game/days");
  // Midnight in Berlin: summer time (UTC+2) and winter time (UTC+1), also on the days the clocks change
  assert.strictEqual(new Date(days.dayStart(Date.parse("2026-10-06T21:50:00Z"))).toISOString(), "2026-10-05T22:00:00.000Z");
  assert.strictEqual(new Date(days.dayStart(Date.parse("2026-10-06T22:10:00Z"))).toISOString(), "2026-10-06T22:00:00.000Z");
  assert.strictEqual(new Date(days.dayStart(Date.parse("2026-12-24T12:00:00Z"))).toISOString(), "2026-12-23T23:00:00.000Z");
  assert.strictEqual(new Date(days.nextDay(Date.parse("2026-03-29T12:00:00Z"))).toISOString(), "2026-03-29T22:00:00.000Z");
  assert.strictEqual(new Date(days.nextDay(Date.parse("2026-10-25T12:00:00Z"))).toISOString(), "2026-10-25T23:00:00.000Z");

  // Claimed at 23:50 - the next ones 10 minutes later, at 00:00
  const lateEvening = Date.parse("2026-10-06T21:50:00Z");
  h.setCoins("dave", 1000);
  h.userOf("dave").coinBonusAt = null;
  assert.strictEqual(await coins.claimBonus("dave", lateEvening), true);
  assert.strictEqual(await coins.claimBonus("dave", lateEvening + 9 * 60 * 1000), false, "still the same day");
  assert.strictEqual(await coins.claimBonus("dave", lateEvening + 11 * 60 * 1000), true, "a new day");
  assert.strictEqual(h.coinsOf("dave"), 1000 + 2 * config.DAILY_BONUS);
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

test("jackpot: alone in the pot - a ghost of 85-115% joins, a real player makes it disappear", async () => {
  h.setCoins("alice", 5000);
  h.setCoins("bob", 5000);
  const alice = client("alice");
  const bob = client("bob");
  await waitFor(alice, "coins", (data) => data.coins === 5000);
  await waitFor(bob, "coins", (data) => data.coins === 5000);
  assert.strictEqual(server.jackpot.pot.phase, "open");
  Object.assign(config, { JACKPOT_GHOST_AFTER: 150, JACKPOT_COUNTDOWN: 1500 });

  // Alice alone: the page knows when the ghost comes, then it is in the pot
  const alone = waitFor(alice, "jackpotState", (s) => s.total === 1000);
  const ghosted = waitFor(alice, "jackpotState", (s) => s.entries.some((e) => e.ghost));
  alice.emit("bet", { amount: 1000 });
  assert.ok((await alone).ghostIn > 0);
  const withGhost = await ghosted;
  const ghost = withGhost.entries.find((e) => e.ghost);
  assert.strictEqual(ghost.name, "Ghost");
  assert.ok(ghost.coins >= 850 && ghost.coins <= 1150, `ghost: ${ghost.coins}`);
  assert.strictEqual(withGhost.phase, "countdown", "the ghost starts the countdown");
  assert.deepStrictEqual(withGhost.bets.map((b) => [b.name, b.from, b.to]), [["alice", 1, 1000], ["Ghost", 1001, 1000 + ghost.coins]]);

  // Alice puts in more: the ghost answers right away with 85-115% of it
  const answered = waitFor(alice, "jackpotState", (s) => s.bets.length === 4);
  alice.emit("bet", { amount: 400 });
  const more = await answered;
  assert.deepStrictEqual(more.bets.map((b) => b.name), ["alice", "Ghost", "alice", "Ghost"]);
  const answer = more.bets[3].amount;
  assert.ok(answer >= 340 && answer <= 460, `ghost answer: ${answer}`);
  assert.strictEqual(more.entries.find((e) => e.ghost).coins, ghost.coins + answer);

  // Bob joins before the draw: the ghost is gone, the tickets are counted again
  const gone = waitFor(alice, "jackpotState", (s) => s.entries.some((e) => e.name === "bob"));
  bob.emit("bet", { amount: 200 });
  const real = await gone;
  assert.deepStrictEqual(real.entries.map((e) => e.name), ["alice", "bob"]);
  assert.deepStrictEqual(real.bets.map((b) => [b.name, b.from, b.to]), [["alice", 1, 1000], ["alice", 1001, 1400], ["bob", 1401, 1600]]);
  assert.strictEqual(real.total, 1600);
  assert.strictEqual(real.phase, "countdown", "the countdown goes on");
  await waitFor(alice, "jackpotState", (s) => s.phase === "open" && s.total === 0, 5000);
  assert.strictEqual(h.coinsOf("alice") + h.coinsOf("bob"), 10000, "only real coins in the pot");

  // No one joins: the ghost may win - then the house keeps the pot
  const ghostAgain = waitFor(alice, "jackpotState", (s) => s.entries.some((e) => e.ghost));
  alice.emit("bet", { amount: 1000 });
  await ghostAgain;
  server.jackpot.pot.fair.number = "0.999999999999"; // the last ticket: the ghost's
  const before = h.coinsOf("alice");
  const drawn = await waitFor(alice, "jackpotState", (s) => s.phase === "drawing", 5000);
  assert.strictEqual(drawn.draw.winner, "Ghost");
  await waitFor(alice, "jackpotState", (s) => s.phase === "open" && s.total === 0, 5000);
  assert.strictEqual(h.coinsOf("alice"), before, "nothing back");
  Object.assign(config, { JACKPOT_GHOST_AFTER: 60000, JACKPOT_COUNTDOWN: 200 });
});

test("casino: the chat shows who is online on any casino page - once per player", async () => {
  const pages = [server.client("/jackpot", tokens.alice), server.client("/poker", tokens.alice), server.client("/blackjack", tokens.carol)];
  sockets.push(...pages);
  const seen = waitFor(pages[2], "casinoOnline", (d) => d.names.includes("alice") && d.names.includes("carol"));
  await Promise.all(pages.map((s) => h.once(s, "connect")));
  const online = await seen;
  assert.strictEqual(online.names.filter((n) => n === "alice").length, 1, "two tabs, one name");
  // Carol leaves: the others hear it
  const left = waitFor(pages[0], "casinoOnline", (d) => !d.names.includes("carol"));
  pages[2].close();
  await left;
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
  const onCasino = server.client("/blackjack", tokens.dave);
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

test("jackpot: a bet gets into the pot only after a few seconds - too late for the draw: the next pot", async () => {
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

    // A bet that doesn't arrive before the draw doesn't count in it - it goes into the next pot
    await h.wait(Math.max(0, counting.endsIn - 150)); // the bet arrives after the draw started
    const moved = h.once(bob, "betInfo");
    const waiting = waitFor(bob, "jackpotState", (s) => s.pending.some((b) => b.next), 5000);
    bob.emit("bet", { amount: 20 });
    const drawing = await waitFor(alice, "jackpotState", (s) => s.phase === "drawing", 4000);
    assert.strictEqual(drawing.draw.total, start + 40, "the late bet is not in the draw");
    assert.match(await moved, /next pot/);
    const waitingForBob = await waiting;
    assert.deepStrictEqual(waitingForBob.pending.map((b) => [b.amount, b.next]), [[20, true]]);
    const winner = drawing.draw.winner;
    // Not given back: 100 - 10 - 20 = 70, plus the pot if bob won
    assert.strictEqual(h.coinsOf("bob"), 70 + (winner === "bob" ? start + 40 : 0));
    assert.strictEqual(drawing.mode, before.mode, "the same animation for everybody");

    // The next round starts with bob's bet in it
    const next = await waitFor(alice, "jackpotState", (s) => s.phase === "open" && s.round === drawing.round + 1, 4000);
    assert.deepStrictEqual(next.bets, [{ name: "bob", amount: 20, from: 1, to: 20 }]);
    assert.strictEqual(next.total, 20);
    // ... and bets during a draw are fine too: they also wait for the next pot
  } finally {
    Object.assign(config, { JACKPOT_BET_DELAY: [0, 0], JACKPOT_COUNTDOWN: 200 });
  }
});

/* ---------- Secret address, start coins ---------- */

test("casino: a secret address - the jackpot is the start page, the other games under it", async () => {
  const express = require("express");
  const http = require("http");
  const secretRoute = require("../routes/secret_route");
  const app = express();
  const base = encodeURI(config.JACKPOT_PATH);
  // Logged in as alice (approved for the casino)
  app.use(base, secretRoute((req, res, next) => ((req._id = "id_alice"), next())));
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
    assert.match((await get(base + "/")).body, /<title>Jackpot/);
    assert.match((await get(base + "/jackpot")).body, /<title>Jackpot/);
    assert.match((await get(base + "/battles")).body, /<title>Case Battles/);
    assert.match((await get(base + "/poker")).body, /<title>Poker/);
    assert.match((await get(base + "/blackjack")).body, /<title>Blackjack/);
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

test("coins: new accounts start with 25k - a reset gives every account the start coins once", async () => {
  assert.strictEqual(config.START_COINS, 25000);
  // A new account
  h.addUser("erin");
  assert.strictEqual((await coins.get("erin")).coins, 25000);
  // An account from before a reset (30 coins left): the start coins, only once
  h.addUser("frank");
  const User = require("../models/User");
  await User.updateOne({ username: "frank" }, { $set: { coins: 30, coinReset: "an-old-reset" } });
  assert.strictEqual((await coins.get("frank")).coins, 25000);
  assert.strictEqual(await coins.spend("frank", 24000), true);
  assert.strictEqual((await coins.get("frank")).coins, 1000, "no second reset");
});

