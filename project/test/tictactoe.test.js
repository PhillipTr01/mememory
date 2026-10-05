const { test, before, after } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const rooms = require("../game/rooms");
const config = require("../game/config");
const ttt = require("../game/tictactoe");

Object.assign(config, { START_ANIMATION: 100, TICK: 50, TTT_REJOIN_GRACE: 300, REJOIN_GRACE_WAITING: 300, EMPTY_ROOM_GRACE: 300 });

/* ---------- Game logic ---------- */

test("logic: bigger pieces cover smaller ones, never the other way round", () => {
  const game = ttt.newGame(0);
  assert.ok(ttt.place(game, 0, 2, 4).ok);
  assert.ok(ttt.place(game, 1, 2, 4).error, "same size can't cover");
  assert.ok(ttt.place(game, 1, 1, 4).error, "smaller can't cover");
  assert.ok(ttt.place(game, 1, 3, 4).ok);
  assert.deepStrictEqual(ttt.top(game, 4), { owner: 1, size: 3 });
  assert.ok(ttt.place(game, 0, 4, 4).ok, "own color covers the opponent");
  assert.ok(ttt.place(game, 1, 4, 4).error, "size 4 can't be covered");
});

test("logic: turns, reserves and invalid input", () => {
  const game = ttt.newGame(1);
  assert.ok(ttt.place(game, 0, 1, 0).error, "not your turn");
  for (const [size, cell] of [[0, 0], [5, 0], ["1", 0], [1, -1], [1, 9], [1, 1.5], [null, null]]) {
    assert.ok(ttt.place(game, 1, size, cell).error);
  }
  assert.ok(ttt.place(game, 1, 4, 0).ok);
  game.turn = 1;
  assert.ok(ttt.place(game, 1, 4, 1).error, "no size 4 left");
  assert.strictEqual(game.reserves[1][4], 0);
});

test("logic: three visible pieces in a row win, covered ones don't count", () => {
  const game = ttt.newGame(0);
  ttt.place(game, 0, 1, 0);
  ttt.place(game, 1, 2, 0); // covers player 0
  ttt.place(game, 0, 1, 1);
  ttt.place(game, 1, 1, 8);
  ttt.place(game, 0, 3, 2);
  assert.strictEqual(game.winner, null, "cell 0 belongs to player 1 now");
  ttt.place(game, 1, 2, 7);
  ttt.place(game, 0, 3, 0); // takes cell 0 back
  assert.strictEqual(game.winner, 0);
  assert.deepStrictEqual(game.line, [0, 1, 2]);
  assert.ok(ttt.place(game, 1, 4, 4).error, "game is over");
});

test("logic: a player without a move is skipped, nobody can move -> draw", () => {
  const game = ttt.newGame(0);
  // Player 1 has only size 1 pieces left, the board is full of bigger pieces
  game.reserves[1] = { 1: 1, 2: 0, 3: 0, 4: 0 };
  game.board = [3, 3, 2, 2, 3, 3, 2, 2, 1].map((size, i) => [{ owner: i % 2 === 0 ? 1 : 0, size: size }]);
  game.board[8] = [{ owner: 1, size: 4 }];
  game.reserves[0] = { 1: 0, 2: 0, 3: 1, 4: 1 };
  assert.strictEqual(ttt.hasMove(game, 1), false);
  assert.ok(ttt.place(game, 0, 3, 2).ok);
  assert.strictEqual(game.turn, 0, "player 1 is skipped");
  assert.strictEqual(game.passed, 1);
  assert.strictEqual(game.draw, false);
  assert.ok(ttt.place(game, 0, 4, 3).ok);
  assert.strictEqual(game.draw, true);
});

/* ---------- Sockets ---------- */

let server;
const sockets = [];
const tokens = {};

function client(namespace, user) {
  const socket = server.client(namespace, user ? tokens[user] : null);
  sockets.push(socket);
  return socket;
}

async function createGame(user) {
  const lobby = client("/lobby", user);
  await h.once(lobby, "connect");
  lobby.emit("playTicTacToe");
  const data = await h.once(lobby, "saveGameID");
  assert.strictEqual(data.url, "/tictactoe");
  lobby.close();
  return data.gameID;
}

// Waits for a state that matches the condition
function stateWhere(socket, check, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("state", listener);
      reject(new Error("Timeout waiting for state"));
    }, timeout);
    function listener(state) {
      if (check(state)) {
        clearTimeout(timer);
        socket.off("state", listener);
        resolve(state);
      }
    }
    socket.on("state", listener);
  });
}

async function join(user, gameID, watch) {
  const socket = client("/tictactoe", user);
  await h.once(socket, "connect");
  const first = h.once(socket, "state");
  socket.emit("joinGame", { gameID, watch });
  await h.once(socket, "joined");
  socket.firstState = await first;
  return socket;
}

async function startedGame() {
  const gameID = await createGame("alice");
  const alice = await join("alice", gameID);
  const playing = stateWhere(alice, (s) => s.status === "playing");
  const bob = await join("bob", gameID);
  const state = await playing;
  assert.ok(state.startIn > 0, "clients show who starts");
  await h.wait(config.START_ANIMATION + 20);
  // Seats (colors) are random
  const A = state.seats.findIndex((seat) => seat.name === "alice");
  const B = 1 - A;
  // [player whose turn it is, the other one]
  const players = state.turn === A ? [alice, bob] : [bob, alice];
  return { gameID, alice, bob, state, players, A, B };
}

before(async () => {
  server = await h.startServer();
  for (const name of ["alice", "bob", "carol"]) tokens[name] = h.addUser(name);
});

after(async () => {
  sockets.forEach((s) => s.close());
  await server.close();
});

test("tictactoe: two players start a game, others watch", async () => {
  const { gameID, alice, state } = await startedGame();
  assert.deepStrictEqual(state.seats.map((s) => s.name).sort(), ["alice", "bob"]);
  assert.deepStrictEqual(state.seats[0].reserve, ttt.PIECES);
  assert.deepStrictEqual(state.seats[1].reserve, ttt.PIECES);
  assert.ok([0, 1].includes(state.turn));

  const watching = stateWhere(alice, (s) => s.spectators.includes("carol"));
  const carol = await join("carol", gameID);
  await watching;
  carol.emit("place", { size: 1, cell: 0 });
  await h.wait(100);
  assert.strictEqual(rooms.get(gameID, "tictactoe").game.board[0].length, 0, "spectators can't play");
});

test("tictactoe: moves are checked by the server and a line wins", async () => {
  const { gameID, alice, players } = await startedGame();
  const [first, second] = players;

  // Not your turn / invalid moves don't change anything
  const errors = [];
  second.on("moveError", (message) => errors.push(message));
  second.emit("place", { size: 1, cell: 0 });
  first.emit("place", { size: 9, cell: 0 });
  first.emit("place", null);
  await h.wait(100);
  assert.strictEqual(errors.length, 1);

  const moves = [
    [first, 1, 0],
    [second, 1, 3],
    [first, 2, 1],
    [second, 2, 4],
  ];
  for (const [socket, size, cell] of moves) {
    const next = stateWhere(alice, (s) => s.board[cell] != null && s.board[cell].size === size);
    socket.emit("place", { size, cell });
    await next;
  }
  const finished = stateWhere(alice, (s) => s.status === "finished");
  first.emit("place", { size: 3, cell: 2 });
  const state = await finished;
  assert.deepStrictEqual(state.line, [0, 1, 2]);
  assert.strictEqual(state.seats[state.winner].wins, 1);

  // Rematch: both have to agree, the other player starts
  first.emit("rematch");
  await stateWhere(alice, (s) => s.seats[state.winner].rematch === true);
  const rematch = stateWhere(alice, (s) => s.status === "playing");
  second.emit("rematch");
  const next = await rematch;
  assert.strictEqual(next.turn, 1 - state.turn);
  assert.ok(next.board.every((cell) => cell == null));
  assert.strictEqual(rooms.get(gameID, "tictactoe").game.reserves[0][1], ttt.PIECES[1]);
});

test("tictactoe: leaving during a game lets the opponent win, a new player can join", async () => {
  const { gameID, alice, bob, A, B } = await startedGame();
  const left = stateWhere(alice, (s) => s.seats[B] == null);
  bob.emit("leave");
  const state = await left;
  assert.strictEqual(state.winner, A);
  assert.strictEqual(state.forfeit, true);
  assert.strictEqual(state.status, "waiting");

  const playing = stateWhere(alice, (s) => s.status === "playing");
  await join("carol", gameID);
  const next = await playing;
  assert.strictEqual(next.seats[B].name, "carol");
  assert.strictEqual(next.seats[A].wins, 0, "new opponent, new score");
});

test("tictactoe: rejoin after a reload, forfeit when not coming back", async () => {
  const { gameID, alice, bob, A, B } = await startedGame();
  bob.close();
  await stateWhere(alice, (s) => s.seats[B].connected === false);

  // Bob comes back in time
  const bob2 = await join("bob", gameID);
  const back = bob2.firstState;
  assert.strictEqual(back.seats[B].connected, true);
  assert.strictEqual(back.status, "playing");

  // ... and then leaves for good
  bob2.close();
  const state = await stateWhere(alice, (s) => s.seats[B] == null, 2000);
  assert.strictEqual(state.winner, A);
});

test("tictactoe: the lobby lists open games and the room code works", async () => {
  const gameID = await createGame("alice");
  const alice = await join("alice", gameID);

  const lobby = client("/lobby", "bob");
  const list = await h.once(lobby, "roomList");
  const entry = list.find((room) => room.gameID === gameID);
  assert.ok(entry);
  assert.strictEqual(entry.game, "tictactoe");
  assert.strictEqual(entry.status, "waiting");

  lobby.emit("joinMultiplayer", ` ${gameID} `);
  assert.deepStrictEqual(await h.once(lobby, "saveGameID"), { gameID, url: "/tictactoe" });

  // Empty rooms are removed
  alice.close();
  await h.wait(1000);
  assert.strictEqual(rooms.get(gameID, "tictactoe"), null);
});

test("tictactoe: the creator keeps the first seat, the colors are random", async () => {
  const colors = new Set();
  for (let i = 0; i < 12 && colors.size < 2; i++) {
    const gameID = await createGame("alice");
    const alice = await join("alice", gameID);
    assert.strictEqual(alice.firstState.seats[0].name, "alice");
    colors.add(alice.firstState.swapColors);
    alice.emit("leave");
  }
  assert.deepStrictEqual([...colors].sort(), [false, true]);
});

test("tictactoe: unknown games", async () => {
  const socket = client("/tictactoe", "alice");
  await h.once(socket, "connect");
  socket.emit("joinGame", { gameID: "nope" });
  await h.once(socket, "noGameFound");
  socket.emit("joinGame", null);
  await h.once(socket, "noGameFound");
});

test("tictactoe: chat with history, system messages and spectators", async () => {
  const { gameID, alice, bob } = await startedGame();
  const message = new Promise((resolve) =>
    bob.on("chatMessage", (m) => m.type === "user" && resolve(m)),
  );
  alice.emit("sendChatMessage", { message: "  gg   wp  " });
  const received = await message;
  assert.strictEqual(received.text, "gg wp");
  assert.strictEqual(received.name, "alice");
  assert.strictEqual(received.spectator, false);

  // Too fast / invalid
  alice.emit("sendChatMessage", { message: "again" });
  assert.strictEqual(await h.once(alice, "chatError"), "You are sending messages too fast.");
  alice.emit("sendChatMessage", null);

  // Late joiners get the history
  const carol = client("/tictactoe", "carol");
  await h.once(carol, "connect");
  const history = h.once(carol, "chatHistory");
  carol.emit("joinGame", { gameID });
  const messages = await history;
  assert.ok(messages.some((m) => m.text === "gg wp"));
  assert.ok(messages.some((m) => m.type === "system" && /starts/.test(m.text)));

  const fromCarol = new Promise((resolve) =>
    alice.on("chatMessage", (m) => m.name === "carol" && resolve(m)),
  );
  carol.emit("sendChatMessage", { message: "hi" });
  assert.strictEqual((await fromCarol).spectator, true);
});
