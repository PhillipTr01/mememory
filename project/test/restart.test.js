const { test, after } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const config = require("../game/config");
const rooms = require("../game/rooms");
const persist = require("../game/persist");

Object.assign(config, { START_ANIMATION: 100, REJOIN_GRACE_PLAYING: 5000, REJOIN_GRACE_WAITING: 5000, EMPTY_ROOM_GRACE: 5000 });

const tokens = {};
for (const name of ["alice", "bob"]) tokens[name] = h.addUser(name);
let server;
const sockets = [];

after(async () => {
  sockets.forEach((s) => s.close());
  await server.close();
  persist.reset();
});

function client(namespace, user) {
  const socket = server.client(namespace, tokens[user]);
  sockets.push(socket);
  return socket;
}

function waitFor(socket, event, check, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for "${event}"`)), timeout);
    socket.on(event, function listener(data) {
      if (!check(data)) return;
      clearTimeout(timer);
      socket.off(event, listener);
      resolve(data);
    });
  });
}

async function createGame(user, event, data) {
  const lobby = client("/lobby", user);
  await h.once(lobby, "connect");
  lobby.emit(event, data);
  const { gameID } = await h.once(lobby, "saveGameID");
  lobby.close();
  return gameID;
}

// The server stops (everything saved) and starts again: the same process, so the rooms are emptied by hand
async function restart() {
  await persist.saveAll();
  persist.reset();
  for (const type of ["multiplayer", "tictactoe", "singleplayer"]) rooms.list(type).forEach(([gameID]) => rooms.remove(gameID));
  sockets.splice(0).forEach((s) => s.close());
  await server.close();
  server = await h.startServer();
  persist.expectRestore();
  // Pages that connect now wait until the games are back
  const early = client("/tictactoe", "alice");
  const connected = h.once(early, "connect");
  await h.wait(50);
  await persist.restoreAll();
  await connected;
}

test("restart: running MemeMory, tic-tac-toe and singleplayer games go on - nobody is kicked", async () => {
  server = await h.startServer();
  await persist.restoreAll();

  // MemeMory with two players, running
  const memory = await createGame("alice", "playMultiplayer");
  const alice = client("/multiplayer", "alice");
  alice.emit("joinRoom", { gameID: memory });
  await h.once(alice, "joinedRoom");
  const bob = client("/multiplayer", "bob");
  bob.emit("joinRoom", { gameID: memory });
  await h.once(bob, "joinedRoom");
  bob.emit("setReady", { ready: true });
  await waitFor(alice, "roomState", (s) => s.players.some((p) => p.name === "bob" && p.ready));
  const started = waitFor(alice, "roomState", (s) => s.status === "playing");
  alice.emit("startGame");
  const before = await started;

  // Tic-tac-toe, one piece on the board
  const ttt = await createGame("alice", "playTicTacToe");
  const ta = client("/tictactoe", "alice");
  ta.emit("joinGame", { gameID: ttt });
  await h.once(ta, "joined");
  const tb = client("/tictactoe", "bob");
  const tPlaying = waitFor(ta, "state", (s) => s.status === "playing");
  tb.emit("joinGame", { gameID: ttt });
  const tState = await tPlaying;
  await h.wait(config.START_ANIMATION + 30);
  const mover = tState.seats[tState.turn].name === "alice" ? ta : tb;
  const placed = waitFor(ta, "state", (s) => s.board && s.board[4] != null);
  mover.emit("place", { size: 2, cell: 4 });
  const tBefore = await placed;

  // Singleplayer against the bot
  const single = await createGame("alice", "playSingleplayer", { difficulty: 0 });
  const sp = client("/singleplayer", "alice");
  await h.once(sp, "connect");
  sp.emit("initializingGame", { gameID: single });
  await h.once(sp, "highlightPlayer");

  await restart();

  // Everybody comes back (the pages reload and join again)
  const a2 = client("/multiplayer", "alice");
  const b2 = client("/multiplayer", "bob");
  a2.emit("joinRoom", { gameID: memory });
  b2.emit("joinRoom", { gameID: memory });
  const back = await waitFor(a2, "roomState", (s) => s.players.every((p) => p.connected));
  assert.strictEqual(back.status, "playing");
  assert.strictEqual(back.turn, before.turn);
  assert.deepStrictEqual(back.players.map((p) => [p.name, p.points]), before.players.map((p) => [p.name, p.points]));

  const ta2 = client("/tictactoe", "alice");
  const tb2 = client("/tictactoe", "bob");
  ta2.emit("joinGame", { gameID: ttt });
  tb2.emit("joinGame", { gameID: ttt });
  const tBack = await waitFor(ta2, "state", (s) => s.seats.every((seat) => seat.connected));
  assert.strictEqual(tBack.status, "playing");
  assert.deepStrictEqual(tBack.board, tBefore.board, "the same board");
  assert.strictEqual(tBack.turn, tBefore.turn);
  // ... and the game goes on
  const next = tBack.seats[tBack.turn].name === "alice" ? ta2 : tb2;
  const moved = waitFor(ta2, "state", (s) => s.board[0] != null);
  next.emit("place", { size: 1, cell: 0 });
  await moved;

  const sp2 = client("/singleplayer", "alice");
  await h.once(sp2, "connect");
  const resumed = h.once(sp2, "resumeGame");
  sp2.emit("initializingGame", { gameID: single });
  const game = await resumed;
  assert.strictEqual(game.finished, false, "the game against the bot goes on");
});
