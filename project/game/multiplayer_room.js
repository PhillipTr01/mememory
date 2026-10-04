const rooms = require("./rooms");
const config = require("./config");
const { CARD_COUNT } = require("./board");

const STATUS = {
  WAITING: "waiting",
  STARTING: "starting", // "who starts" animation is running
  PLAYING: "playing",
  FINISHED: "finished",
};

/* Creates a new multiplayer room. The host joins it from the game page. */
function createRoom(host, board) {
  return rooms.create("multiplayer", {
    host: host,
    maxPlayers: config.DEFAULT_MAX_PLAYERS,
    isPublic: true,
    mode: "classic",
    turnTime: config.SPEED_TURN_TIME, // speed round: ms per turn, chosen by the host
    turnEndsAt: null, // speed round: when the current turn runs out
    turnToken: 0, // changes with every new turn, so old timers do nothing
    status: STATUS.WAITING,
    // [{name, points, active, connected, socketId, disconnectedAt}]
    // inactive = left or surrendered, not connected = may still come back
    players: [],
    spectators: new Map(), // socketId -> name
    banned: new Set(), // kicked by the host
    turn: -1, // index into players
    openedCards: [],
    checkingCards: false,
    foundMatches: [],
    cardCounter: Array(CARD_COUNT).fill(0),
    cardPairs: board.cardPairs,
    cardImages: board.cardImages,
    chat: [],
    emptySince: Date.now(),
    timers: [],
  });
}

function activePlayers(room) {
  return room.players.filter((player) => player.active);
}

function connectedCount(room) {
  return room.players.filter((player) => player.connected).length + room.spectators.size;
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
    mode: room.mode,
    turnTime: room.turnTime,
    turnTimeOptions: config.SPEED_TURN_OPTIONS,
    // Remaining time instead of a timestamp, so different clocks don't matter
    turnRemaining: room.turnEndsAt != null ? Math.max(0, room.turnEndsAt - Date.now()) : null,
    pairsLeft: (CARD_COUNT - room.foundMatches.length) / 2,
    spectators: [...new Set(room.spectators.values())],
    players: room.players.map((player) => ({
      name: player.name,
      points: player.points,
      active: player.active,
      connected: player.connected,
    })),
  };
}

/* Rooms shown in the lobby: public, not finished and somebody is in it. */
function publicRooms() {
  return rooms
    .list("multiplayer")
    .filter(
      ([, room]) =>
        room.isPublic &&
        room.status !== STATUS.FINISHED &&
        room.players.some((player) => player.connected),
    )
    .map(([gameID, room]) => ({
      gameID: gameID,
      host: room.host,
      status: room.status,
      mode: room.mode,
      turnTime: room.turnTime,
      players: room.players.filter((player) => player.active).length,
      // Lets the lobby show "Rejoin" for players who are already in the room
      playerNames: room.players.filter((player) => player.active).map((player) => player.name),
      maxPlayers: room.maxPlayers,
      spectators: room.spectators.size,
      createdAt: room.createdAt,
    }))
    .sort((a, b) => (a.status === b.status ? b.createdAt - a.createdAt : a.status === STATUS.WAITING ? -1 : 1))
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
  if (room.type !== "multiplayer") return;
  // Stop pending timers (start animation, card animations)
  (room.timers || []).forEach(clearTimeout);
  notifyLobby();
});

module.exports = {
  STATUS,
  createRoom,
  activePlayers,
  connectedCount,
  serialize,
  publicRooms,
  attachLobby,
  notifyLobby,
};
