const rooms = require("./rooms");
const multiplayerRoom = require("./multiplayer_room");
const { PIECES } = require("./tictactoe");

const STATUS = {
  WAITING: "waiting", // a seat is free
  PLAYING: "playing",
  FINISHED: "finished", // both seats taken, waiting for a rematch
};

/* A room for two players. Seats are fixed, so the colors don't swap when somebody leaves. */
function createRoom(host) {
  return rooms.create("tictactoe", {
    host: host,
    isPublic: true,
    status: STATUS.WAITING,
    // [seat0, seat1]: {name, connected, socketId, disconnectedAt, wins, rematch} or null
    seats: [null, null],
    spectators: new Map(), // socketId -> name
    game: null, // last / current game, see game/tictactoe.js
    forfeit: false, // the last game was won because the opponent left
    starter: null, // seat that started the last game
    chat: [],
    round: 0, // counts the games, so clients play the start animation once per game
    startsAt: 0, // moves are possible after the "who starts" animation
    emptySince: Date.now(),
  });
}

function seatOf(room, name) {
  return room.seats.findIndex((seat) => seat != null && seat.name === name);
}

function serialize(gameID, room) {
  const game = room.game;
  return {
    gameID: gameID,
    host: room.host,
    status: room.status,
    seats: room.seats.map((seat, index) =>
      seat == null
        ? null
        : {
            name: seat.name,
            connected: seat.connected,
            wins: seat.wins,
            rematch: seat.rematch,
            // Before the first game everybody has all pieces
            reserve: game != null ? game.reserves[index] : { ...PIECES },
          },
    ),
    // Only the top piece of every cell is visible
    board: game != null ? game.board.map((stack) => (stack.length > 0 ? stack[stack.length - 1] : null)) : null,
    turn: game != null ? game.turn : null,
    winner: game != null ? game.winner : null,
    draw: game != null && game.draw,
    line: game != null ? game.line : null,
    lastMove: game != null ? game.lastMove : null,
    passed: game != null ? game.passed : null,
    forfeit: room.forfeit,
    round: room.round,
    startIn: Math.max(0, room.startsAt - Date.now()),
    spectators: [...new Set(room.spectators.values())],
  };
}

/* Open Tic Tac Toe rooms for the lobby list */
function publicRooms(username) {
  return rooms
    .list("tictactoe")
    .filter(([, room]) => room.isPublic && room.seats.some((seat) => seat != null && seat.connected))
    .map(([gameID, room]) => {
      const names = room.seats.filter((seat) => seat != null).map((seat) => seat.name);
      return {
        gameID: gameID,
        game: "tictactoe",
        host: room.host,
        status: room.status === STATUS.WAITING ? "waiting" : "playing",
        players: names.length,
        playerNames: names,
        maxPlayers: 2,
        spectators: room.spectators.size,
        kicked: false,
        createdAt: room.createdAt,
      };
    });
}

multiplayerRoom.addLobbySource(publicRooms);

rooms.onRemove((gameID, room) => {
  if (room.type === "tictactoe") multiplayerRoom.notifyLobby();
});

module.exports = { STATUS, createRoom, seatOf, serialize, publicRooms };
