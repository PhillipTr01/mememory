const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const rooms = require("../game/rooms");
const config = require("../game/config");

// Short timings, so rejoin and cleanup can be tested quickly
Object.assign(config, {
  REJOIN_GRACE_WAITING: 300,
  REJOIN_GRACE_PLAYING: 300,
  EMPTY_ROOM_GRACE: 300,
  START_ANIMATION: 100,
  TICK: 50,
  SPEED_TURN_TIME: 400,
  SPEED_MISS_DELAY: 100,
  SPEED_ANIMATION_GRACE: 50,
  SPEED_START_ANIMATION: 100,
  // The player starts, so the tests can open cards right away
  SINGLEPLAYER_STARTER: 0,
});

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

// Waits for the first event that matches the predicate
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

async function joinRoom(user, gameID) {
  const socket = client("/multiplayer", user);
  const joined = h.once(socket, "joinedRoom");
  socket.emit("joinRoom", { gameID });
  return { socket, joined: await joined };
}

// Room with alice as host; the guests join and press "Ready" (unless ready = false)
async function openRoom(...guests) {
  return openRoomWith({ ready: true }, ...guests);
}

async function openRoomWith(options, ...guests) {
  const gameID = await createGame("alice", "playMultiplayer");
  const alice = (await joinRoom("alice", gameID)).socket;
  const others = [];
  for (const guest of guests) {
    const state = waitFor(alice, "roomState", (s) => s.players.some((p) => p.name === guest));
    const socket = (await joinRoom(guest, gameID)).socket;
    others.push(socket);
    await state;
    if (options.ready) {
      const ready = waitFor(alice, "roomState", (s) => s.players.some((p) => p.name === guest && p.ready));
      socket.emit("setReady", { ready: true });
      await ready;
    }
  }
  return { gameID, alice, others };
}

test("multiplayer: a singleplayer id can't be used to join (used to crash)", async () => {
  const gameID = await createGame("alice", "playSingleplayer", { difficulty: 0 });
  const bob = client("/multiplayer", "bob");
  bob.emit("joinRoom", { gameID });
  await h.once(bob, "noGameFound");
});

test("multiplayer: waiting room shows players, host and settings", async () => {
  const gameID = await createGame("alice", "playMultiplayer");
  const alice = client("/multiplayer", "alice");
  const first = h.once(alice, "roomState");
  alice.emit("joinRoom", { gameID });
  const state = await first;

  assert.strictEqual(state.status, "waiting");
  assert.strictEqual(state.host, "alice");
  assert.deepStrictEqual(state.players.map((p) => p.name), ["alice"]);
  assert.ok(state.maxPlayersLimit >= state.maxPlayers);

  // Only the host can change the settings, the value has to be in range
  const bob = (await joinRoom("bob", gameID)).socket;
  bob.emit("updateSettings", { maxPlayers: 2 });
  alice.emit("updateSettings", { maxPlayers: 1 }); // too small -> ignored
  alice.emit("updateSettings", { maxPlayers: 99 }); // too big -> ignored
  alice.emit("updateSettings", { maxPlayers: 2, isPublic: false });
  const updated = await waitFor(bob, "roomState", (s) => s.maxPlayers === 2);
  assert.strictEqual(updated.isPublic, false);

  // Room is full now -> carol watches
  const carol = await joinRoom("carol", gameID);
  assert.strictEqual(carol.joined.spectator, true);
});

test("multiplayer: the room list in the lobby shows public rooms only", async () => {
  const { gameID, alice } = await openRoom();
  const lobby = client("/lobby", "bob");
  const list = await h.once(lobby, "roomList");
  assert.ok(list.some((room) => room.gameID === gameID && room.host === "alice"));

  alice.emit("updateSettings", { isPublic: false });
  await waitFor(lobby, "roomList", (rooms) => !rooms.some((room) => room.gameID === gameID));
});

test("multiplayer: opening the room in a second tab replaces the first one", async () => {
  const { gameID, alice } = await openRoom();
  const replaced = h.once(alice, "sessionReplaced");
  const second = client("/multiplayer", "alice");
  const joined = h.once(second, "joinedRoom");
  const stateEvent = h.once(second, "roomState");
  second.emit("joinRoom", { gameID });
  assert.strictEqual((await joined).spectator, false);
  await replaced;
  const state = await stateEvent;
  assert.deepStrictEqual(state.players.map((p) => [p.name, p.connected]), [["alice", true]]);
});

test("multiplayer: only the host can start, a leaver loses and the other wins", async () => {
  const { alice, others: [bob] } = await openRoom("bob");

  bob.emit("startGame"); // not the host -> ignored
  const starting = h.once(bob, "gameStarting");
  const started = waitFor(alice, "roomState", (s) => s.status === "playing");
  alice.emit("startGame");
  const animation = await starting;
  // The order is shuffled for every game
  assert.deepStrictEqual(animation.players.slice().sort(), ["alice", "bob"]);
  const { turn, players } = await started;
  assert.strictEqual(turn, animation.starter);
  assert.ok(turn === 0 || turn === 1);

  // The player whose turn it isn't can't open cards
  const other = players[turn].name === "alice" ? bob : alice;
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

test("multiplayer: games with more than two players keep the turn order", async () => {
  const { alice, others } = await openRoom("bob", "carol");
  const sockets = { alice, bob: others[0], carol: others[1] };

  const started = waitFor(alice, "roomState", (s) => s.status === "playing");
  alice.emit("startGame");
  let state = await started;
  // Cards can't be opened during the start animation
  assert.strictEqual(state.status, "playing");
  assert.strictEqual(state.players.length, 3);

  // The player whose turn it is leaves -> the next active player continues
  const leaving = state.players[state.turn].name;
  const expected = state.players[(state.turn + 1) % 3].name;
  const watcher = leaving === "alice" ? sockets.bob : alice;
  const next = waitFor(watcher, "roomState", (s) => !s.players.find((p) => p.name === leaving).active);
  sockets[leaving].emit("surrender");
  state = await next;
  assert.strictEqual(state.players[state.turn].name, expected);
  assert.strictEqual(state.status, "playing");
});

test("multiplayer: the player order is shuffled", async () => {
  const orders = new Set();
  for (let i = 0; i < 12 && orders.size < 2; i++) {
    const { alice } = await openRoom("bob", "carol");
    const starting = h.once(alice, "gameStarting");
    alice.emit("startGame");
    orders.add((await starting).players.join(","));
    alice.emit("leaveRoom");
  }
  assert.ok(orders.size > 1, "different orders");
});

test("multiplayer: rematch after the game goes back to the waiting room", async () => {
  const { gameID, alice, others } = await openRoom("bob");
  const bob = others[0];
  const started = waitFor(alice, "roomState", (s) => s.status === "playing");
  alice.emit("startGame");
  await started;
  const oldImages = rooms.get(gameID, "multiplayer").cardImages;

  const finished = h.once(alice, "getWinner");
  bob.emit("surrender");
  await finished;
  assert.ok(rooms.get(gameID, "multiplayer"), "the room stays for a rematch");

  // Strangers can't enter a finished room
  const carol = client("/multiplayer", "carol");
  carol.emit("joinRoom", { gameID });
  await h.once(carol, "noGameFound");

  // Only the host can start a rematch
  bob.emit("rematch");
  await h.wait(150);
  assert.strictEqual(rooms.get(gameID, "multiplayer").status, "finished");

  const back = waitFor(alice, "roomState", (s) => s.status === "waiting");
  const reset = h.once(bob, "rematch");
  alice.emit("rematch");
  const state = await back;
  await reset;
  assert.deepStrictEqual(state.players.map((p) => [p.name, p.points, p.active, p.ready]).sort(), [
    ["alice", 0, true, false],
    ["bob", 0, true, false],
  ]);
  assert.strictEqual(state.host, "alice");
  assert.notStrictEqual(rooms.get(gameID, "multiplayer").cardImages, oldImages, "new board");
});

test("multiplayer: the host leaves after the game, the next player can start the rematch", async () => {
  const { gameID, alice, others } = await openRoom("bob");
  const bob = others[0];
  const started = waitFor(alice, "roomState", (s) => s.status === "playing");
  alice.emit("startGame");
  await started;
  const finished = h.once(bob, "getWinner");
  alice.emit("surrender");
  await finished;

  const newHost = waitFor(bob, "roomState", (s) => s.host === "bob");
  alice.emit("leaveRoom");
  await newHost;

  const back = waitFor(bob, "roomState", (s) => s.status === "waiting");
  bob.emit("rematch");
  const state = await back;
  assert.deepStrictEqual(state.players.map((p) => p.name), ["bob"], "only players who are still here");
});

test("multiplayer: chat is validated, rate limited and kept as history", async () => {
  const { gameID, alice, others: [bob] } = await openRoom("bob");

  alice.emit("sendChatMessage", null);
  alice.emit("sendChatMessage", { message: 42 });
  alice.emit("sendChatMessage", { message: "   " });
  alice.emit("sendChatMessage", { message: "  hello   <b>world</b>  " + "x".repeat(2000) });
  const message = await waitFor(bob, "chatMessage", (m) => m.type === "user");
  assert.strictEqual(message.name, "alice");
  assert.ok(message.text.startsWith("hello <b>world</b> "));
  assert.strictEqual(message.text.length, 300);

  // Too fast
  alice.emit("sendChatMessage", { message: "spam" });
  assert.match(await h.once(alice, "chatError"), /too fast/);

  // Late joiners get the history including system messages
  const carol = client("/multiplayer", "carol");
  const history = h.once(carol, "chatHistory");
  carol.emit("joinRoom", { gameID });
  const messages = await history;
  assert.ok(messages.some((m) => m.type === "system" && /bob joined/.test(m.text)));
  assert.ok(messages.some((m) => m.type === "user" && m.name === "alice"));
});

test("multiplayer: when the host leaves before the start, the next player takes over", async () => {
  const { alice, others: [bob] } = await openRoom("bob");

  const state = waitFor(bob, "roomState", (s) => s.host === "bob");
  alice.emit("leaveRoom");
  assert.deepStrictEqual((await state).players.map((p) => p.name), ["bob"]);
});

test("multiplayer: a disconnected host keeps the seat for a while, then hands over", async () => {
  const { alice, others: [bob] } = await openRoom("bob");

  const offline = waitFor(bob, "roomState", (s) => s.players.some((p) => p.name === "alice" && !p.connected));
  alice.close();
  const state = await offline;
  assert.strictEqual(state.host, "alice");

  const handover = await waitFor(bob, "roomState", (s) => s.host === "bob", 2000);
  assert.deepStrictEqual(handover.players.map((p) => p.name), ["bob"]);
});

test("multiplayer: players can rejoin a running game and keep their points", async () => {
  const { gameID, alice, others: [bob] } = await openRoom("bob");
  const started = waitFor(alice, "roomState", (s) => s.status === "playing");
  alice.emit("startGame");
  await started;

  const offline = waitFor(alice, "roomState", (s) => s.players.some((p) => p.name === "bob" && !p.connected));
  bob.close();
  const state = await offline;
  // The turn never stays with a disconnected player
  assert.strictEqual(state.players[state.turn].name, "alice");

  const bob2 = client("/multiplayer", "bob");
  const board = h.once(bob2, "boardState");
  const joined = h.once(bob2, "joinedRoom");
  bob2.emit("joinRoom", { gameID });
  assert.strictEqual((await joined).spectator, false);
  assert.ok(Array.isArray((await board).found));
  const back = await waitFor(alice, "roomState", (s) => s.players.every((p) => p.connected));
  assert.strictEqual(back.status, "playing");
  assert.strictEqual(h.increments.length, 0);
});

test("multiplayer: a player who doesn't come back loses the game", async () => {
  const { alice, others: [bob] } = await openRoom("bob");
  const started = waitFor(alice, "roomState", (s) => s.status === "playing");
  alice.emit("startGame");
  await started;

  const winner = h.once(alice, "getWinner", 2000);
  bob.close();
  assert.deepStrictEqual((await winner).winners, ["alice"]);
});

test("multiplayer: the host can kick players, they can only watch afterwards", async () => {
  const { gameID, alice, others: [bob] } = await openRoom("bob");
  const kicked = h.once(bob, "kicked");
  alice.emit("kickPlayer", { name: "bob" });
  await kicked;

  const bob2 = client("/multiplayer", "bob");
  bob2.emit("joinRoom", { gameID });
  assert.strictEqual((await h.once(bob2, "joinedRoom")).spectator, true);
});

test("multiplayer: empty rooms are deleted", async () => {
  const { gameID, alice } = await openRoom();
  alice.close();
  await h.wait(900);
  assert.strictEqual(rooms.get(gameID), null);

  // A room nobody ever entered is removed as well
  const unused = await createGame("bob", "playMultiplayer");
  await h.wait(900);
  assert.strictEqual(rooms.get(unused), null);
});

test("multiplayer: the lobby lists running games too", async () => {
  const { gameID, alice } = await openRoom("bob");
  alice.emit("startGame");
  const lobby = client("/lobby", "carol");
  const list = await waitFor(lobby, "roomList", (r) => r.some((room) => room.gameID === gameID && room.status !== "waiting"));
  assert.strictEqual(list.find((room) => room.gameID === gameID).players, 2);
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
  const flips = [await h.once(socket, "turnCard", 8000), await h.once(socket, "turnCard", 8000)];
  assert.strictEqual(flips.length, 2);
});

test("singleplayer: who starts is random", async () => {
  config.SINGLEPLAYER_STARTER = null;
  try {
    const starters = new Set();
    for (let i = 0; i < 12 && starters.size < 2; i++) {
      const gameID = await createGame("alice", "playSingleplayer", { difficulty: 0 });
      const socket = client("/singleplayer", "alice");
      await h.once(socket, "connect");
      const highlight = h.once(socket, "highlightPlayer");
      socket.emit("initializingGame", { gameID });
      starters.add((await highlight).turn);
      socket.close();
    }
    assert.deepStrictEqual([...starters].sort(), [0, 1]);
  } finally {
    config.SINGLEPLAYER_STARTER = 0;
  }
});

test("singleplayer: rematch starts a new game against the same bot", async () => {
  const gameID = await createGame("alice", "playSingleplayer", { difficulty: 1 });
  const socket = client("/singleplayer", "alice");
  await h.once(socket, "connect");
  socket.emit("initializingGame", { gameID });
  await h.once(socket, "setComputername");

  // No rematch while the game is running
  socket.emit("rematch");
  socket.emit("surrender");
  await h.once(socket, "getWinner");

  const rematch = h.once(socket, "rematch");
  const highlight = h.once(socket, "highlightPlayer");
  socket.emit("rematch");
  await rematch;
  assert.strictEqual((await highlight).computer, "Medium Bot");

  // The new game can be played
  socket.emit("openCard", 0);
  assert.strictEqual((await h.once(socket, "turnCard")).id, 0);
});

test("multiplayer: watch joins as spectator even with free seats", async () => {
  const { gameID } = await openRoom();
  const bob = client("/multiplayer", "bob");
  const joined = h.once(bob, "joinedRoom");
  bob.emit("joinRoom", { gameID, watch: true });
  assert.strictEqual((await joined).spectator, true);

  // The lobby knows who plays in a room (for the "Rejoin" button)
  const lobby = client("/lobby", "carol");
  const list = await waitFor(lobby, "roomList", (rooms) => rooms.some((room) => room.gameID === gameID));
  assert.deepStrictEqual(list.find((room) => room.gameID === gameID).playerNames, ["alice"]);
});

async function startSpeedGame() {
  const { gameID, alice, others: [bob] } = await openRoom("bob");
  const updated = waitFor(alice, "roomState", (s) => s.mode === "speed");
  bob.emit("updateSettings", { mode: "speed" }); // not the host -> ignored
  alice.emit("updateSettings", { mode: "nonsense" }); // invalid -> ignored
  alice.emit("updateSettings", { mode: "speed" });
  await updated;
  const started = waitFor(alice, "roomState", (s) => s.status === "playing");
  alice.emit("startGame");
  const state = await started;
  return { gameID, alice, bob, state };
}

test("speed round: the turn passes when the time runs out", async () => {
  const { alice, state } = await startSpeedGame();
  assert.ok(state.turnRemaining > 0 && state.turnRemaining <= 400);

  const first = state.players[state.turn].name;
  const timeout = h.once(alice, "turnTimeout", 2000);
  const next = await waitFor(alice, "roomState", (s) => s.players[s.turn].name !== first, 2000);
  assert.strictEqual((await timeout).name, first);
  assert.ok(next.turnRemaining > 0);
});

test("speed round: two wrong cards end the turn without End turn", async () => {
  const { gameID, alice, bob, state } = await startSpeedGame();
  const room = rooms.get(gameID, "multiplayer");
  const current = state.players[state.turn].name === "alice" ? alice : bob;
  const first = state.players[state.turn].name;

  // two cards that are no pair
  const a = 0;
  const b = room.cardPairs[0] === 1 ? 2 : 1;
  const passed = waitFor(alice, "roomState", (s) => s.players[s.turn].name !== first, 2000);
  current.emit("openCard", a);
  current.emit("openCard", b);
  await passed;
});

test("classic rooms have no turn timer", async () => {
  const { alice } = await openRoom("bob");
  const started = waitFor(alice, "roomState", (s) => s.status === "playing");
  alice.emit("startGame");
  const state = await started;
  assert.strictEqual(state.mode, "classic");
  assert.strictEqual(state.turnRemaining, null);
});

test("speed round: the host chooses the seconds per turn", async () => {
  const { alice, others: [bob] } = await openRoom("bob");
  alice.emit("updateSettings", { mode: "speed" });
  alice.emit("updateSettings", { turnTime: 20 }); // not offered anymore -> ignored
  bob.emit("updateSettings", { turnTime: 5 }); // not the host -> ignored
  alice.emit("updateSettings", { turnTime: 15 });
  const state = await waitFor(bob, "roomState", (s) => s.mode === "speed" && s.turnTime === 15000);
  assert.deepStrictEqual(state.turnTimeOptions, [3, 5, 10, 15]);
});

test("multiplayer: the host can only start when everybody is ready", async () => {
  const { gameID, alice, others: [bob] } = await openRoomWith({ ready: false }, "bob");
  const room = rooms.get(gameID, "multiplayer");

  alice.emit("startGame"); // bob isn't ready -> ignored
  bob.emit("setReady", { ready: "yes" }); // invalid -> ignored
  await h.wait(200);
  assert.strictEqual(room.status, "waiting");

  const ready = waitFor(alice, "roomState", (s) => s.players.find((p) => p.name === "bob").ready);
  bob.emit("setReady", { ready: true });
  await ready;

  const started = waitFor(alice, "roomState", (s) => s.status === "playing");
  alice.emit("startGame");
  await started;

  // Not possible anymore once the game runs
  bob.emit("setReady", { ready: false });
  await h.wait(100);
  assert.strictEqual(room.players.find((p) => p.name === "bob").ready, true);
});

test("lobby: a kicked player only gets the option to watch", async () => {
  const { gameID, alice, others: [bob] } = await openRoom("bob");
  const kicked = h.once(bob, "kicked");
  alice.emit("kickPlayer", { name: "bob" });
  await kicked;

  const bobLobby = client("/lobby", "bob");
  const carolLobby = client("/lobby", "carol");
  const forBob = await waitFor(bobLobby, "roomList", (rooms) => rooms.some((room) => room.gameID === gameID));
  const forCarol = await waitFor(carolLobby, "roomList", (rooms) => rooms.some((room) => room.gameID === gameID));
  assert.strictEqual(forBob.find((room) => room.gameID === gameID).kicked, true);
  assert.strictEqual(forCarol.find((room) => room.gameID === gameID).kicked, false);
});

test("speed round: animations don't count, the clock stops after two wrong cards", async () => {
  const { gameID, alice, bob, state } = await startSpeedGame();
  // The clock starts after the card animation; until then the full time is left
  assert.ok(state.turnStartsIn > 0);
  assert.strictEqual(state.turnRemaining, state.turnTime);

  const room = rooms.get(gameID, "multiplayer");
  const current = state.players[state.turn].name === "alice" ? alice : bob;
  const b = room.cardPairs[0] === 1 ? 2 : 1;
  const stopped = waitFor(alice, "roomState", (s) => s.status === "playing" && s.turnRemaining === null, 2000);
  current.emit("openCard", 0);
  current.emit("openCard", b);
  await stopped;
});
