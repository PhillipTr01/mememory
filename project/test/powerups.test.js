const { test, before, after } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const rooms = require("../game/rooms");
const config = require("../game/config");
const powerups = require("../game/powerups");
const { CARD_COUNT, createBoard } = require("../game/board");

Object.assign(config, { START_ANIMATION: 100, POWERUPS_START_ANIMATION: 100, TICK: 50 });

/* ---------- Pure logic ---------- */

test("powerups: everybody starts with two power-ups from different categories", () => {
  for (let i = 0; i < 50; i++) {
    const [a, b] = powerups.startPowerups();
    assert.notStrictEqual(powerups.POWERUPS[a].category, powerups.POWERUPS[b].category);
  }
});

test("powerups: strong power-ups are rarer, but every power-up comes", () => {
  const counts = {};
  for (let i = 0; i < 30000; i++) {
    const id = powerups.randomPowerup();
    counts[id] = (counts[id] || 0) + 1;
  }
  for (const id of powerups.IDS) assert.ok(counts[id] > 500, `${id} comes regularly`);
  const share = (rarity) =>
    powerups.IDS.filter((id) => powerups.POWERUPS[id].rarity === rarity).reduce((sum, id) => sum + counts[id], 0) /
    powerups.IDS.filter((id) => powerups.POWERUPS[id].rarity === rarity).length;
  assert.ok(share("common") > share("uncommon"));
  assert.ok(share("uncommon") > share("rare"));
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

  // Swap two closed cards (the found pair stays where it is)
  const [a, b] = [...Array(CARD_COUNT).keys()].filter((id) => !room.foundMatches.includes(id));
  const imageA = room.cardImages[a];
  powerups.applyPermutation(room, powerups.swapPermutation(a, b));
  assertConsistent(room);
  assert.strictEqual(room.cardImages[b], imageA);
  assert.deepStrictEqual(room.foundMatches, found);

  // Row shift: only the closed cards of the row move, one place to the right
  const rowPerm = powerups.rowShiftPermutation(room, 0);
  const closedRow = [...Array(11).keys()].filter((id) => !room.foundMatches.includes(id));
  closedRow.forEach((position, index) =>
    assert.strictEqual(rowPerm[position], closedRow[(index - 1 + closedRow.length) % closedRow.length]),
  );
  powerups.applyPermutation(room, rowPerm);
  assertConsistent(room);
  assert.deepStrictEqual(room.foundMatches, found);

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

// alice (host) and bob (and more guests) in a running power-up game
async function powerupGame(...extra) {
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
  const guests = {};
  for (const name of extra) {
    const guest = client(name);
    guests[name] = guest;
    guest.emit("joinRoom", { gameID });
    await h.once(guest, "joinedRoom");
    guest.emit("setReady", { ready: true });
  }
  alice.emit("updateSettings", { mode: "powerups" });
  await waitFor(alice, "roomState", (s) => s.mode === "powerups" && s.players.length === 2 + extra.length && s.players.every((p) => p.name === "alice" || p.ready));

  const playing = waitFor(alice, "roomState", (s) => s.status === "playing");
  alice.emit("startGame");
  const state = await playing;
  const room = rooms.get(gameID, "multiplayer");
  const byName = { alice, bob, ...guests };
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
  for (const name of ["alice", "bob", "carol"]) tokens[name] = h.addUser(name);
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

test("powerups game: the chat says which power-ups everybody starts with", async () => {
  const { room, state } = await powerupGame();
  const names = state.players[0].powerups.map((id) => powerups.POWERUPS[id].name);
  const message = room.chat.find((m) => /Everybody starts with/.test(m.text));
  assert.ok(message, "start message in the chat");
  assert.ok(names.every((name) => message.text.includes(name)));
});

test("powerups game: only on the own turn, once per turn, and it leaves the hand", async () => {
  const { room, current, other, currentName, otherName, gameID } = await powerupGame();
  const me = room.players.find((p) => p.name === currentName);
  me.powerups = ["doubleOrNothing", "shield"];
  room.players.find((p) => p.name === otherName).powerups = ["doubleOrNothing"];

  // Not the other player's turn
  other.emit("usePowerup", { id: "doubleOrNothing" });
  // Not in the hand
  current.emit("usePowerup", { id: "rotate" });
  await h.wait(100);
  assert.strictEqual(room.turnPowerUsed, false);

  const used = waitFor(current, "roomState", (s) => s.turnPowerUsed);
  current.emit("usePowerup", { id: "doubleOrNothing" });
  const state = await used;
  assert.deepStrictEqual(state.players.find((p) => p.name === currentName).powerups, ["shield"]);
  assert.ok(state.players.find((p) => p.name === currentName).armed.includes("doubleOrNothing"));

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
  const move = await changed;
  assert.strictEqual(move.type, "rotate");
  assert.strictEqual(move.perm[0], CARD_COUNT - 1, "the clients get the moves for the animation");
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

test("powerups game: attacks hit the chosen player (with more than one opponent)", async () => {
  const { room, current, currentName } = await powerupGame("carol");
  const me = room.players.find((p) => p.name === currentName);
  const targets = room.players.filter((p) => p.name !== currentName);
  const victim = targets[targets.length - 1]; // not necessarily the next player
  me.powerups = ["skip", "fog"];

  // Without a choice nothing happens (two opponents)
  current.emit("usePowerup", { id: "skip" });
  current.emit("usePowerup", { id: "skip", player: currentName }); // not myself
  await h.wait(100);
  assert.strictEqual(room.turnPowerUsed, false);

  const hit = waitFor(current, "roomState", (s) => s.players.find((p) => p.name === victim.name).skipNext);
  current.emit("usePowerup", { id: "skip", player: victim.name });
  await hit;
  assert.ok(targets.every((p) => p.skipNext === (p === victim)));
});

// A card that is not part of a power-up pair, and closed
function plainCard(room, not = []) {
  for (let id = 0; id < CARD_COUNT; id++) {
    if (room.powerCards.includes(id) || room.foundMatches.includes(id) || not.includes(id)) continue;
    if (not.some((other) => room.cardPairs[other] === id)) continue;
    return id;
  }
}

test("powerups game: triple flip - a pair among three cards counts, the third closes", async () => {
  const { room, current, currentName } = await powerupGame();
  const me = room.players.find((p) => p.name === currentName);
  me.powerups = ["tripleFlip"];
  current.emit("usePowerup", { id: "tripleFlip" });
  await waitFor(current, "roomState", (s) => s.players.find((p) => p.name === currentName).armed.includes("tripleFlip"));

  const a = plainCard(room);
  const c = plainCard(room, [a]);
  const b = room.cardPairs[a];
  const waiting = waitFor(current, "roomState", (s) => s.openedCount === 2 && !s.checkingCards);
  current.emit("openCard", a);
  current.emit("openCard", c);
  await waiting; // no End turn after two wrong cards
  const closed = waitFor(current, "closeCards", (data) => data[1] === c);
  current.emit("openCard", b);
  await closed;
  assert.ok(room.foundMatches.includes(a) && room.foundMatches.includes(b));
  assert.strictEqual(me.points, 1);
  assert.strictEqual(me.armed.tripleFlip, false, "used up");
  assert.strictEqual(room.players[room.turn].name, currentName, "a pair: keep playing");

  // Normal again: two wrong cards end the turn
  await h.wait(100);
  const [d, e] = wrongPair(room);
  current.emit("openCard", d);
  current.emit("openCard", e);
  await h.once(current, "activateEndTurn");
});

test("powerups game: double or nothing", async () => {
  const { room, current, currentName } = await powerupGame();
  const me = room.players.find((p) => p.name === currentName);
  me.powerups = ["doubleOrNothing"];
  current.emit("usePowerup", { id: "doubleOrNothing" });
  await waitFor(current, "roomState", (s) => s.players.find((p) => p.name === currentName).armed.includes("doubleOrNothing"));
  const a = plainCard(room);
  const pair = waitFor(current, "roomState", (s) => s.players.find((p) => p.name === currentName).points === 2);
  current.emit("openCard", a);
  current.emit("openCard", room.cardPairs[a]);
  await pair;

  // Next turn's gamble goes wrong: -1 (also below 0)
  me.points = 0;
  me.armed.doubleOrNothing = true;
  const [b, c] = wrongPair(room);
  current.emit("openCard", b);
  current.emit("openCard", c);
  await h.once(current, "activateEndTurn");
  assert.strictEqual(me.points, -1);
});

test("powerups game: steal, party and mystery box", async () => {
  const { room, current, currentName, otherName } = await powerupGame();
  const me = room.players.find((p) => p.name === currentName);
  const opponent = room.players.find((p) => p.name === otherName);
  me.powerups = ["steal"];
  opponent.powerups = ["map"];
  current.emit("usePowerup", { id: "steal" });
  await waitFor(current, "roomState", (s) => s.players.find((p) => p.name === otherName).powerups.length === 0);
  assert.deepStrictEqual(me.powerups, ["map"]);

  room.turnPowerUsed = false;
  me.powerups = ["party"];
  opponent.powerups = [];
  current.emit("usePowerup", { id: "party" });
  await waitFor(current, "roomState", (s) => s.players.every((p) => p.powerups.length === 1));

  room.turnPowerUsed = false;
  me.powerups = ["mysteryBox"];
  me.points = 0;
  current.emit("usePowerup", { id: "mysteryBox" });
  await waitFor(current, "roomState", (s) => !s.players.find((p) => p.name === currentName).powerups.includes("mysteryBox"));
  // Something happened: a new power-up, -1 point or a skipped turn
  assert.ok(me.powerups.length === 1 || me.points === -1 || me.skipNext);
});

test("powerups game: row shift moves the closed cards of the row", async () => {
  const { room, current, other, currentName } = await powerupGame();
  const me = room.players.find((p) => p.name === currentName);
  me.powerups = ["rowShift"];
  const images = room.cardImages.slice(0, 11);
  const changed = h.once(other, "boardChanged");
  current.emit("usePowerup", { id: "rowShift", targets: [3] });
  assert.strictEqual((await changed).type, "rowShift");
  assert.deepStrictEqual(room.cardImages.slice(0, 11), [images[10], ...images.slice(0, 10)]);
  assertConsistent(room);
});
