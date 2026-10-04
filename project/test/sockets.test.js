const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const rooms = require("../game/rooms");

let server;
const sockets = [];
const tokens = {};

function client(namespace, user) {
  const socket = server.client(namespace, user ? tokens[user] : null);
  sockets.push(socket);
  return socket;
}

async function createGame(user, event, data) {
  const lobby = client("/lobby", user);
  await h.once(lobby, "connect");
  lobby.emit(event, data);
  const { gameID } = await h.once(lobby, "saveGameID");
  lobby.close();
  return gameID;
}

before(async () => {
  server = await h.startServer();
  for (const name of ["alice", "bob", "carol"]) tokens[name] = h.addUser(name);
});

beforeEach(() => {
  h.increments.length = 0;
  h.setMemeCount(40);
});

after(async () => {
  sockets.forEach((s) => s.close());
  await server.close();
});

test("sockets without a valid login are rejected", async () => {
  const socket = client("/lobby", null);
  const error = await h.once(socket, "connect_error");
  assert.strictEqual(error.message, "unauthorized");
});

test("singleplayer: invalid input does not crash the server", async () => {
  const gameID = await createGame("alice", "playSingleplayer", { difficulty: 0 });
  const socket = client("/singleplayer", "alice");
  await h.once(socket, "connect");

  // Garbage before the game exists
  socket.emit("openCard", 5);
  socket.emit("endTurn");
  socket.emit("surrender");
  socket.emit("initializingGame", null);
  await h.once(socket, "noGameFound");

  socket.emit("initializingGame", { gameID });
  assert.strictEqual(await h.once(socket, "setComputername"), "Easy Bot");

  // Invalid card ids are ignored
  for (const id of ["1", -1, 66, 1.5, null, { id: 1 }]) socket.emit("openCard", id);
  // endTurn while no two cards are open is ignored
  socket.emit("endTurn");

  socket.emit("openCard", 0);
  const card = await h.once(socket, "turnCard");
  assert.strictEqual(card.id, 0);
  assert.match(card.src, /^https:\/\/i\.redd\.it\//);
});

test("singleplayer: a game can only be initialized once and only by its owner", async () => {
  const gameID = await createGame("alice", "playSingleplayer", { difficulty: 1 });

  const bob = client("/singleplayer", "bob");
  await h.once(bob, "connect");
  bob.emit("initializingGame", { gameID });
  await h.once(bob, "noGameFound");

  const alice = client("/singleplayer", "alice");
  await h.once(alice, "connect");
  alice.emit("initializingGame", { gameID });
  await h.once(alice, "setComputername");

  const alice2 = client("/singleplayer", "alice");
  await h.once(alice2, "connect");
  alice2.emit("initializingGame", { gameID });
  await h.once(alice2, "noGameFound");
});

test("singleplayer: surrender + disconnect counts exactly one loss", async () => {
  const gameID = await createGame("alice", "playSingleplayer", { difficulty: 2 });
  const socket = client("/singleplayer", "alice");
  await h.once(socket, "connect");
  socket.emit("initializingGame", { gameID });
  await h.once(socket, "setComputername");

  socket.emit("surrender");
  const result = await h.once(socket, "getWinner");
  assert.strictEqual(result.winner, 1);

  socket.emit("surrender");
  socket.close();
  await h.wait(300);

  assert.deepStrictEqual(h.increments, [{ username: "alice", field: "hardLose" }]);
});

test("singleplayer: not enough memes gives a clean error", async () => {
  h.setMemeCount(5);
  const gameID = await createGame("alice", "playSingleplayer", { difficulty: 0 });
  const socket = client("/singleplayer", "alice");
  await h.once(socket, "connect");
  socket.emit("initializingGame", { gameID });
  const message = await h.once(socket, "gameError");
  assert.match(message, /Not enough memes/);
});

test("lobby: invalid difficulty and unknown game ids are handled", async () => {
  const lobby = client("/lobby", "alice");
  await h.once(lobby, "connect");
  lobby.emit("playSingleplayer", { difficulty: 7 });
  lobby.emit("playSingleplayer", null);
  lobby.emit("joinMultiplayer", "doesNotExist");
  assert.match(await h.once(lobby, "gameError"), /No game found/);
});

test("multiplayer: a singleplayer id can't be used to join (used to crash)", async () => {
  const gameID = await createGame("alice", "playSingleplayer", { difficulty: 0 });
  const bob = client("/multiplayer", "bob");
  await h.once(bob, "connect");
  bob.emit("joinGame", { gameID });
  await h.once(bob, "noGameFound");
});

async function startMultiplayer() {
  const gameID = await createGame("alice", "playMultiplayer");

  const alice = client("/multiplayer", "alice");
  await h.once(alice, "connect");
  alice.emit("initializingGame", { gameID });
  await h.once(alice, "visualInitializing");

  const bob = client("/multiplayer", "bob");
  await h.once(bob, "connect");
  const enabled = h.once(alice, "enableStartGame");
  bob.emit("joinGame", { gameID, username: "alice" }); // username from the client is ignored
  const players = await h.once(bob, "visualInitializing");
  assert.deepStrictEqual(players.player.map((p) => p.name), ["alice", "bob"]);
  await enabled;

  return { gameID, alice, bob };
}

test("multiplayer: only the creator can start, a leaver loses and the other wins", async () => {
  const { alice, bob } = await startMultiplayer();

  bob.emit("startGame"); // not the creator -> ignored
  const highlight = h.once(alice, "highlightPlayer");
  alice.emit("startGame");
  const { turn } = await highlight;
  assert.ok(turn === 1 || turn === 2);

  // The player whose turn it isn't can't open cards
  const other = turn === 1 ? bob : alice;
  other.emit("openCard", 3);
  other.emit("endTurn");

  const winner = h.once(alice, "getWinner");
  bob.close();
  const result = await winner;
  assert.deepStrictEqual(result.winners, ["alice"]);
  await h.wait(100);

  assert.deepStrictEqual(
    h.increments.sort((a, b) => a.username.localeCompare(b.username)),
    [
      { username: "alice", field: "multiplayerWin" },
      { username: "bob", field: "multiplayerLose" },
    ],
  );
});

test("multiplayer: chat messages are validated and trimmed", async () => {
  const { alice, bob } = await startMultiplayer();

  alice.emit("sendChatMessage", null);
  alice.emit("sendChatMessage", { message: 42 });
  alice.emit("sendChatMessage", { message: "x".repeat(2000) });
  const message = await h.once(bob, "receiveChatMessage");
  assert.strictEqual(message.name, "alice");
  assert.strictEqual(message.message.length, 500);
});

test("multiplayer: when the creator leaves before the start, the next player takes over", async () => {
  const { alice, bob } = await startMultiplayer();

  const creator = h.once(bob, "newCreator");
  alice.close();
  assert.deepStrictEqual(await creator, { name: "bob" });
});

test("rooms: abandoned rooms are removed", () => {
  const before = rooms.size();
  const id = rooms.create("multiplayer", {});
  assert.ok(rooms.get(id, "multiplayer"));
  assert.strictEqual(rooms.get(id, "singleplayer"), null);
  rooms.sweep(Date.now() + 24 * 60 * 60 * 1000);
  assert.strictEqual(rooms.get(id), null);
  assert.ok(rooms.size() <= before);
});

test("singleplayer: after the player's turn the computer plays", async () => {
  const gameID = await createGame("alice", "playSingleplayer", { difficulty: 3 });
  const socket = client("/singleplayer", "alice");
  await h.once(socket, "connect");
  socket.emit("initializingGame", { gameID });
  await h.once(socket, "setComputername");

  // Open cards until two of them don't match
  let first = null;
  for (let id = 0; id < 66; id++) {
    socket.emit("openCard", id);
    const card = await h.once(socket, "turnCard");
    if (first == null) {
      first = card;
    } else if (card.src !== first.src) {
      break;
    } else {
      first = null; // a match, the player continues
    }
  }

  await h.once(socket, "activateEndTurn");
  const highlight = h.once(socket, "highlightPlayer");
  socket.emit("endTurn");
  assert.strictEqual((await highlight).turn, 1);

  // The computer flips two cards on its own
  const flips = [await h.once(socket, "turnCard", 4000), await h.once(socket, "turnCard", 4000)];
  assert.strictEqual(flips.length, 2);
});
