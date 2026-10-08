const { test, after } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const config = require("../game/config");
const persist = require("../game/persist");
const bj = require("../game/blackjack");

// Long timers: nothing moves on by itself while the "server" restarts
Object.assign(config, {
  JACKPOT_RAKE: 0,
  POKER_RAKE: 0,
  JACKPOT_BET_DELAY: [0, 0],
  JACKPOT_GHOST_AFTER: 60000,
  JACKPOT_COUNTDOWN: 60000,
  BJ_BETTING: 60000,
  POKER_START: 50,
  POKER_TURN: 60000,
});

const tokens = {};
for (const name of ["alice", "bob", "carol", "dave"]) {
  tokens[name] = h.addUser(name);
  h.setCoins(name, 10000);
}
const sockets = [];
const servers = [];

// Every timer of the games stops (otherwise the test keeps running)
function stopGames(server) {
  clearTimeout(server.jackpot.pot.timer);
  clearTimeout(server.jackpot.pot.ghostTimer);
  server.jackpot.pot.incoming.forEach((bet) => clearTimeout(bet.timer));
  for (const table of [server.poker.table, ...[...server.blackjack.tables.values()].map((t) => t.table)]) {
    clearTimeout(table.timer);
    clearTimeout(table.turnTimer);
    if (table.leaveTimers) table.leaveTimers.forEach((timer) => clearTimeout(timer));
    table.seats.forEach((seat) => seat && (clearTimeout(seat.awayTimer), clearTimeout(seat.standTimer)));
  }
  for (const battle of server.battles.lobby.list.values()) clearTimeout(battle.timer);
}

after(async () => {
  bj.testing.shoe = null;
  sockets.forEach((s) => s.close());
  for (const server of servers) {
    stopGames(server);
    await server.close();
  }
  persist.reset();
});

function client(server, namespace, name) {
  const socket = server.client(namespace, tokens[name]);
  sockets.push(socket);
  return socket;
}

function waitFor(socket, event, predicate, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for "${event}"`)), timeout);
    socket.on(event, function handler(data) {
      if (!predicate(data)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(data);
    });
  });
}

test("restart: every game, its running round, its history and the chat are back - nothing refunded, nothing lost", async () => {
  persist.reset();
  const first = await h.startServer();
  servers.push(first);
  await persist.restoreAll(); // nothing saved yet

  // Chat
  const chat = client(first, "/jackpot", "alice");
  await h.once(chat, "connect");
  chat.emit("sendChatMessage", { message: "see you after the restart" });
  await waitFor(chat, "chatMessage", (m) => m.text === "see you after the restart");

  // Jackpot: two bets, the countdown runs
  const bob = client(first, "/jackpot", "bob");
  await h.once(bob, "connect");
  chat.emit("bet", { amount: 300 });
  await waitFor(chat, "jackpotState", (s) => s.total === 300);
  bob.emit("bet", { amount: 200 });
  const jackpot = await waitFor(chat, "jackpotState", (s) => s.phase === "countdown" && s.total === 500);

  // Blackjack: a bet on seat 2 (classic table), the betting time runs
  const table = client(first, "/blackjack", "carol");
  await h.once(table, "connect");
  table.emit("sit", 2);
  table.emit("bet", { seat: 2, amount: 600 });
  await waitFor(table, "blackjackState", (s) => s.seats[2] && s.seats[2].bet === 600);

  // Poker: a hand is running
  const p1 = client(first, "/poker", "dave");
  const p2 = client(first, "/poker", "bob");
  await Promise.all([h.once(p1, "connect"), h.once(p2, "connect")]);
  p1.emit("sit", { seat: 0, buyIn: 1000 });
  await waitFor(p1, "pokerState", (s) => s.seats[0] != null);
  p2.emit("sit", { seat: 1, buyIn: 1000 });
  const hand = await waitFor(p1, "pokerState", (s) => s.phase === "preflop" && s.current >= 0);
  const daveCards = hand.seats[0].cards;

  // Case battles: one is waiting for a second player
  const battles = client(first, "/battles", "alice");
  await h.once(battles, "connect");
  battles.emit("createBattle", { cases: ["starter"], size: 2 });
  const battleId = await h.once(battles, "battleCreated");

  const coinsBefore = Object.fromEntries(Object.keys(tokens).map((name) => [name, h.coinsOf(name)]));

  // The server stops (saves everything) ...
  await persist.saveAll();
  persist.reset();
  sockets.splice(0).forEach((s) => s.close());

  // ... and starts again
  const second = await h.startServer();
  servers.push(second);
  await persist.restoreAll();

  // The pages show everything as it was
  const again = client(second, "/jackpot", "alice");
  const [history, state] = await Promise.all([h.once(again, "chatHistory"), h.once(again, "jackpotState")]);
  assert.ok(history.some((m) => m.text === "see you after the restart"), "the chat");
  assert.strictEqual(state.phase, "countdown");
  assert.strictEqual(state.round, jackpot.round);
  assert.deepStrictEqual(state.bets, jackpot.bets, "the same bets and tickets");
  assert.strictEqual(state.fair.hash, jackpot.fair.hash, "the same (provably fair) round");
  assert.ok(state.endsIn >= config.RESTORE_GRACE - 1000, "time to come back");

  const bjState = await h.once(client(second, "/blackjack", "carol"), "blackjackState");
  assert.deepStrictEqual([bjState.phase, bjState.seats[2].name, bjState.seats[2].bet], ["betting", "carol", 600]);

  const pk = await h.once(client(second, "/poker", "dave"), "pokerState");
  assert.strictEqual(pk.phase, "preflop");
  assert.strictEqual(pk.hand, hand.hand);
  assert.deepStrictEqual(pk.seats[0].cards, daveCards, "the same cards");
  assert.deepStrictEqual(pk.seats.map((s) => s && [s.name, s.stack, s.bet]), hand.seats.map((s) => s && [s.name, s.stack, s.bet]));
  assert.ok(pk.turnIn >= config.RESTORE_GRACE - 1000);

  const list = await h.once(client(second, "/battles", "bob"), "battles");
  const battle = list.list.find((b) => b.id === battleId);
  assert.ok(battle && battle.phase === "waiting", "the waiting battle");

  // Nothing was refunded or lost
  for (const name of Object.keys(tokens)) assert.strictEqual(h.coinsOf(name), coinsBefore[name], name);

  // ... and the games go on: bob joins the battle
  const joiner = client(second, "/battles", "bob");
  await h.once(joiner, "connect");
  const running = waitFor(joiner, "battles", (d) => d.list.some((b) => b.id === battleId && b.phase === "running"));
  joiner.emit("joinBattle", battleId);
  await running;
});

test("restart during the draw: the winner is paid once, the round ends and the history keeps it", async () => {
  Object.assign(config, { JACKPOT_COUNTDOWN: 50, JACKPOT_SPIN: 3000, JACKPOT_PAUSE: 50 });
  persist.reset();
  h.settings.length = 0; // nothing saved from the test before
  servers.forEach(stopGames);
  const first = await h.startServer();
  servers.push(first);
  await persist.restoreAll();
  h.setCoins("alice", 1000);
  h.setCoins("bob", 1000);
  const alice = client(first, "/jackpot", "alice");
  const bob = client(first, "/jackpot", "bob");
  await Promise.all([h.once(alice, "connect"), h.once(bob, "connect")]);
  await h.wait(100);
  alice.emit("bet", { amount: 100 });
  await waitFor(alice, "jackpotState", (s) => s.entries.some((e) => e.name === "alice"));
  bob.emit("bet", { amount: 100 });
  const drawing = await waitFor(alice, "jackpotState", (s) => s.phase === "drawing", 5000);
  await h.wait(50);
  const total = h.coinsOf("alice") + h.coinsOf("bob");
  assert.strictEqual(total, 2000 - 200, "not paid while the draw is running");

  await persist.saveAll();
  persist.reset();
  stopGames(first); // the old server is gone (its draw timer too)
  sockets.splice(0).forEach((s) => s.close());
  const second = await h.startServer();
  servers.push(second);
  Object.assign(config, { JACKPOT_SPIN: 300 });
  await persist.restoreAll();

  const watcher = client(second, "/jackpot", "alice");
  const done = await waitFor(watcher, "jackpotState", (s) => s.phase === "open" && s.history.some((r) => r.round === drawing.round), 5000);
  assert.strictEqual(done.history[0].winner, drawing.draw.winner);
  assert.strictEqual(h.coinsOf("alice") + h.coinsOf("bob"), 2000, "paid exactly once");
});

test("persist: a season saves every game and puts it back afterwards", async () => {
  // A tiny game of its own
  const game = { rounds: 7 };
  persist.register("seasonTest", () => game, (saved) => Object.assign(game, saved));
  const before = persist.snapshotAll();
  assert.strictEqual(JSON.parse(before.seasonTest).rounds, 7);
  // The season: everything anew, then played on
  await persist.resetAll();
  game.rounds = 99;
  // Over: as before the season
  await persist.restoreSnapshots(before);
  assert.strictEqual(game.rounds, 7);
});

test("persist: the chat stays through a season (start and end)", async () => {
  const chat = { messages: ["before"] };
  persist.register("chatTest", () => chat, (saved) => Object.assign(chat, saved));
  const before = persist.snapshotAll();
  await persist.resetAll(["chatTest"]);
  chat.messages.push("during");
  await persist.restoreSnapshots(before, ["chatTest"]);
  assert.deepStrictEqual(chat.messages, ["before", "during"]);
  // (the season really keeps "chat")
  assert.match(require("fs").readFileSync(require.resolve("../game/hard_reset"), "utf8"), /SEASON_KEEP = \["chat"\]/);
});
