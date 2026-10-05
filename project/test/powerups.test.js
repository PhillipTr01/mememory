const { test, before, after } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const rooms = require("../game/rooms");
const config = require("../game/config");
const powerups = require("../game/powerups");
const { CARD_COUNT, createBoard } = require("../game/board");

Object.assign(config, { START_ANIMATION: 100, TICK: 50 });

/* ---------- Pure logic ---------- */

test("powerups: everybody starts with two power-ups from different categories", () => {
  for (let i = 0; i < 50; i++) {
    const [a, b] = powerups.startPowerups();
    assert.notStrictEqual(powerups.POWERUPS[a].category, powerups.POWERUPS[b].category);
  }
});

test("powerups: the area is the card and its neighbours on the 11 x 6 board", () => {
  assert.deepStrictEqual(powerups.area(0).sort((a, b) => a - b), [0, 1, 11, 12]);
  assert.strictEqual(powerups.area(12).length, 9);
  assert.deepStrictEqual(powerups.area(65).sort((a, b) => a - b), [53, 54, 64, 65]);
});

function assertConsistent(room) {
  for (let id = 0; id < CARD_COUNT; id++) {
    const partner = room.cardPairs[id];
    assert.notStrictEqual(partner, id);
    assert.strictEqual(room.cardPairs[partner], id, "pairs point at each other");
    assert.strictEqual(room.cardImages[partner], room.cardImages[id], "pairs have the same image");
  }
  // Found cards are still complete pairs
  for (const id of room.foundMatches) assert.ok(room.foundMatches.includes(room.cardPairs[id]));
  for (const id of room.powerCards) assert.ok(room.powerCards.includes(room.cardPairs[id]));
}

test("powerups: shuffle, swap and rotate keep the board consistent", async () => {
  const board = await createBoard();
  const room = {
    ...board,
    cardCounter: Array(CARD_COUNT).fill(0),
    foundMatches: [3, board.cardPairs[3]],
    openedCards: [],
    powerCards: powerups.choosePowerCards(board.cardPairs),
  };
  assert.strictEqual(room.powerCards.length, powerups.POWER_PAIRS * 2);
  const found = room.foundMatches.slice();
  room.cardCounter[5] = 2;
  const image5 = room.cardImages[5];

  powerups.applyPermutation(room, powerups.shufflePermutation(room));
  assertConsistent(room);
  assert.deepStrictEqual(room.foundMatches, found, "found cards don't move");

  const imageA = room.cardImages[10];
  powerups.applyPermutation(room, powerups.swapPermutation(10, 20));
  assertConsistent(room);
  assert.strictEqual(room.cardImages[20], imageA);

  powerups.applyPermutation(room, powerups.rotatePermutation());
  assertConsistent(room);
  assert.deepStrictEqual(room.foundMatches.sort(), found.map((id) => CARD_COUNT - 1 - id).sort());
  assert.ok(room.cardCounter.includes(2), "counters move along");
  assert.ok(room.cardImages.includes(image5));
});

/* ---------- In the game ---------- */

let server;
const sockets = [];
const tokens = {};

function client(user) {
  const socket = server.client("/multiplayer", tokens[user]);
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

// alice (host) and bob in a running power-up game
async function powerupGame() {
  const lobby = server.client("/lobby", tokens.alice);
  sockets.push(lobby);
  lobby.emit("playMultiplayer");
  const { gameID } = await h.once(lobby, "saveGameID");

  const alice = client("alice");
  alice.emit("joinRoom", { gameID });
  await h.once(alice, "joinedRoom");
  const bob = client("bob");
  bob.emit("joinRoom", { gameID });
  await h.once(bob, "joinedRoom");
  bob.emit("setReady", { ready: true });
  alice.emit("updateSettings", { mode: "powerups" });
  await waitFor(alice, "roomState", (s) => s.mode === "powerups" && s.players.every((p) => p.name === "alice" || p.ready));

  const playing = waitFor(alice, "roomState", (s) => s.status === "playing");
  alice.emit("startGame");
  const state = await playing;
  const room = rooms.get(gameID, "multiplayer");
  const byName = { alice, bob };
  const current = state.players[state.turn].name;
  const other = current === "alice" ? "bob" : "alice";
  return { gameID, room, state, alice, bob, current: byName[current], other: byName[other], currentName: current, otherName: other };
}

// Two cards that are not a pair (and not power cards)
function wrongPair(room) {
  for (let a = 0; a < CARD_COUNT; a++) {
    for (let b = a + 1; b < CARD_COUNT; b++) {
      if (room.cardPairs[a] !== b && !room.foundMatches.includes(a) && !room.foundMatches.includes(b)) return [a, b];
    }
  }
}

before(async () => {
  server = await h.startServer();
  for (const name of ["alice", "bob"]) tokens[name] = h.addUser(name);
});

after(async () => {
  sockets.forEach((s) => s.close());
  await server.close();
});

test("powerups game: same two start power-ups for everybody, four power pairs", async () => {
  const { state, room } = await powerupGame();
  const [a, b] = state.players;
  assert.strictEqual(a.powerups.length, 2);
  assert.deepStrictEqual(a.powerups, b.powerups);
  assert.notStrictEqual(powerups.POWERUPS[a.powerups[0]].category, powerups.POWERUPS[a.powerups[1]].category);
  assert.strictEqual(room.powerCards.length, 8);
});

test("powerups game: only on the own turn, once per turn, and it leaves the hand", async () => {
  const { room, current, other, currentName, otherName, gameID } = await powerupGame();
  const me = room.players.find((p) => p.name === currentName);
  me.powerups = ["gamble", "shield"];
  room.players.find((p) => p.name === otherName).powerups = ["gamble"];

  // Not the other player's turn
  other.emit("usePowerup", { id: "gamble" });
  // Not in the hand
  current.emit("usePowerup", { id: "rotate" });
  await h.wait(100);
  assert.strictEqual(room.turnPowerUsed, false);

  const used = waitFor(current, "roomState", (s) => s.turnPowerUsed);
  current.emit("usePowerup", { id: "gamble" });
  const state = await used;
  assert.deepStrictEqual(state.players.find((p) => p.name === currentName).powerups, ["shield"]);
  assert.ok([0, 2].includes(state.players.find((p) => p.name === currentName).points));

  // Only one per turn
  current.emit("usePowerup", { id: "shield" });
  await h.wait(100);
  assert.strictEqual(me.shield, false);
  assert.ok(rooms.get(gameID, "multiplayer"));
});

test("powerups game: skip lets the opponent sit out, a shield blocks it", async () => {
  const { room, current, currentName, otherName } = await powerupGame();
  const me = room.players.find((p) => p.name === currentName);
  const opponent = room.players.find((p) => p.name === otherName);
  me.powerups = ["skip"];

  current.emit("usePowerup", { id: "skip" });
  await waitFor(current, "roomState", (s) => s.players.find((p) => p.name === otherName).skipNext);

  // Wrong pair -> End turn -> the opponent is skipped, it's my turn again
  const [a, b] = wrongPair(room);
  current.emit("openCard", a);
  current.emit("openCard", b);
  await h.once(current, "activateEndTurn");
  const next = waitFor(current, "roomState", (s) => !s.players.find((p) => p.name === otherName).skipNext);
  current.emit("endTurn");
  const state = await next;
  assert.strictEqual(state.players[state.turn].name, currentName);

  // Shield
  room.turnPowerUsed = false;
  me.powerups = ["skip"];
  opponent.shield = true;
  const blocked = waitFor(current, "roomState", (s) => !s.players.find((p) => p.name === otherName).shield);
  current.emit("usePowerup", { id: "skip" });
  const after = await blocked;
  assert.strictEqual(after.players.find((p) => p.name === otherName).skipNext, false);
});

test("powerups game: a power-up pair gives a power-up, the hand holds three", async () => {
  const { room, current, currentName } = await powerupGame();
  const me = room.players.find((p) => p.name === currentName);
  me.powerups = [];
  const [a, b] = [room.powerCards[0], room.powerCards[1]];
  assert.strictEqual(room.cardPairs[a], b);

  const card = waitFor(current, "turnCard", (data) => data.id === a);
  current.emit("openCard", a);
  assert.strictEqual((await card).power, true, "power cards are marked when opened");
  const got = waitFor(current, "roomState", (s) => s.players.find((p) => p.name === currentName).powerups.length === 1);
  current.emit("openCard", b);
  await got;

  // Full hand: nothing more
  me.powerups = ["map", "peek", "fog"];
  const [c, d] = [room.powerCards[2], room.powerCards[3]];
  const chat = waitFor(current, "chatMessage", (m) => /no free slot/.test(m.text));
  current.emit("openCard", c);
  current.emit("openCard", d);
  await chat;
  assert.strictEqual(me.powerups.length, 3);
});

test("powerups game: unlucky bonus after five turns without a pair", async () => {
  const { room, current, currentName } = await powerupGame();
  const me = room.players.find((p) => p.name === currentName);
  me.powerups = [];
  me.unlucky = powerups.UNLUCKY_TURNS - 1;

  const [a, b] = wrongPair(room);
  current.emit("openCard", a);
  current.emit("openCard", b);
  await h.once(current, "activateEndTurn");
  const bonus = waitFor(current, "chatMessage", (m) => /bad luck/.test(m.text));
  current.emit("endTurn");
  await bonus;
  assert.strictEqual(me.powerups.length, 1);
  assert.strictEqual(me.unlucky, 0);
});

test("powerups game: second chance and extra turn", async () => {
  const { room, current, currentName } = await powerupGame();
  const me = room.players.find((p) => p.name === currentName);
  me.powerups = ["secondChance"];

  current.emit("usePowerup", { id: "secondChance" });
  await waitFor(current, "roomState", (s) => s.players.find((p) => p.name === currentName).armed.includes("secondChance"));
  const [a, b] = wrongPair(room);
  current.emit("openCard", a);
  current.emit("openCard", b);
  await waitFor(current, "chatMessage", (m) => /second chance/.test(m.text));
  assert.deepStrictEqual(room.openedCards, [a], "only the second card closes");
  assert.strictEqual(room.players[room.turn].name, currentName);

  // Extra turn (next turn, after the cards are closed)
  room.turnPowerUsed = false;
  room.openedCards = [];
  me.powerups = ["extraTurn"];
  current.emit("usePowerup", { id: "extraTurn" });
  await waitFor(current, "roomState", (s) => s.players.find((p) => p.name === currentName).armed.includes("extraTurn"));
  await h.wait(1000); // the closing card from the second chance
  const [c, d] = wrongPair(room);
  current.emit("openCard", c);
  current.emit("openCard", d);
  await h.once(current, "activateEndTurn");
  const kept = waitFor(current, "chatMessage", (m) => /extra turn/.test(m.text));
  current.emit("endTurn");
  await kept;
  assert.strictEqual(room.players[room.turn].name, currentName);
});

test("powerups game: rotate and shuffle send the new board, peek only to the player", async () => {
  const { room, current, other, currentName } = await powerupGame();
  const me = room.players.find((p) => p.name === currentName);
  me.powerups = ["rotate", "peek"];

  const changed = h.once(other, "boardChanged");
  const board = h.once(other, "boardState");
  current.emit("usePowerup", { id: "rotate" });
  assert.strictEqual((await changed).type, "rotate");
  assert.ok(Array.isArray((await board).found));
  assertConsistent(room);

  room.turnPowerUsed = false;
  let otherSaw = false;
  other.on("powerupReveal", () => (otherSaw = true));
  const peek = h.once(current, "powerupReveal");
  current.emit("usePowerup", { id: "peek", targets: [7] });
  const data = await peek;
  assert.strictEqual(data.cards[0].id, 7);
  assert.strictEqual(data.cards[0].src, room.cardImages[7]);
  await h.wait(100);
  assert.strictEqual(otherSaw, false);
});
