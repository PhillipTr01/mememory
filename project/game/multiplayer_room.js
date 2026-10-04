const rooms = require("./rooms");
const config = require("./config");
const { CARD_COUNT } = require("./board");

const STATUS = { WAITING: "waiting", PLAYING: "playing", FINISHED: "finished" };

/* Creates a new multiplayer room. The host joins it from the game page. */
function createRoom(host, board) {
  return rooms.create("multiplayer", {
    host: host,
    maxPlayers: config.DEFAULT_MAX_PLAYERS,
    isPublic: true,
    status: STATUS.WAITING,
    players: [], // [{name, points, active}] - inactive players left or surrendered
    turn: -1, // index into players
    openedCards: [],
    checkingCards: false,
    foundMatches: [],
    cardCounter: Array(CARD_COUNT).fill(0),
    cardPairs: board.cardPairs,
    cardImages: board.cardImages,
    chat: [],
  });
}

function activePlayers(room) {
  return room.players.filter((player) => player.active);
}

/* Everything the clients need to draw the waiting room and the scoreboard. */
function serialize(gameID, room) {
  return {
    gameID: gameID,
    host: room.host,
    status: room.status,
    isPublic: room.isPublic,
    maxPlayers: room.maxPlayers,
    minPlayers: config.MIN_PLAYERS,
    maxPlayersLimit: config.MAX_PLAYERS,
    turn: room.turn,
    players: room.players.map((player) => ({
      name: player.name,
      points: player.points,
      active: player.active,
    })),
  };
}

/* Open rooms shown in the lobby. */
function publicRooms() {
  return rooms
    .list("multiplayer")
    .filter(
      ([, room]) =>
        room.isPublic &&
        room.status === STATUS.WAITING &&
        room.players.length > 0 &&
        room.players.length < room.maxPlayers,
    )
    .map(([gameID, room]) => ({
      gameID: gameID,
      host: room.host,
      players: room.players.length,
      maxPlayers: room.maxPlayers,
    }))
    .slice(0, 50);
}

/* Sends the room list to everybody in the lobby (debounced). */
let lobby = null;
let pending = null;

function attachLobby(namespace) {
  lobby = namespace;
}

function notifyLobby() {
  if (lobby == null || pending != null) return;
  pending = setTimeout(() => {
    pending = null;
    lobby.emit("roomList", publicRooms());
  }, 200);
}

rooms.onRemove((gameID, room) => {
  if (room.type === "multiplayer") notifyLobby();
});

module.exports = {
  STATUS,
  createRoom,
  activePlayers,
  serialize,
  publicRooms,
  attachLobby,
  notifyLobby,
};
