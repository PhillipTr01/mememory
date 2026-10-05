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
    // [{name, points, active, connected, ready, socketId, disconnectedAt}]
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
    // Time left once the clock runs, and how long until it starts (animations)
    turnRemaining:
      room.turnEndsAt != null ? Math.min(room.turnTime, Math.max(0, room.turnEndsAt - Date.now())) : null,
    turnStartsIn: room.turnEndsAt != null ? Math.max(0, (room.turnStartsAt || 0) - Date.now()) : 0,
    pairsLeft: (CARD_COUNT - room.foundMatches.length) / 2,
    turnPowerUsed: room.turnPowerUsed === true,
    rejoinSeconds: Math.round(config.REJOIN_GRACE_PLAYING / 1000),
    openedCount: room.openedCards.length,
    checkingCards: room.checkingCards === true,
    spectators: [...new Set(room.spectators.values())],
    players: room.players.map((player) => ({
      name: player.name,
      points: player.points,
      active: player.active,
      connected: player.connected,
      ready: player.ready === true,
      // Left the room / didn't come back (not surrendered)
      left: player.left === true,
      // Power-up mode: hand and running effects
      powerups: player.powerups || [],
      shield: player.shield === true,
      fog: player.fog === true,
      skipNext: player.skipNext === true,
      armed: player.armed ? Object.keys(player.armed).filter((key) => player.armed[key]) : [],
      // Lost the connection / closed the page: time left to come back (ms)
      awayLeft:
        player.connected || !player.active || player.disconnectedAt == null
          ? null
          : Math.max(
              0,
              player.disconnectedAt +
                (room.status === STATUS.WAITING ? config.REJOIN_GRACE_WAITING : config.REJOIN_GRACE_PLAYING) -
                Date.now(),
            ),
    })),
  };
}

/* Other games (e.g. Tic Tac Toe XL) add their open rooms to the lobby list */
const lobbySources = [];

function addLobbySource(source) {
  lobbySources.push(source);
}

/*
 * Rooms shown in the lobby: public, not finished and somebody is in it.
 * "kicked" tells the given user that the host removed them from the room.
 */
function publicRooms(username) {
  const memory = rooms
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
      kicked: username != null && room.banned.has(username),
      createdAt: room.createdAt,
    }));

  return memory
    .concat(...lobbySources.map((source) => source(username)))
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
    // Every user gets their own list (e.g. "kicked" is personal)
    for (const [, socket] of lobby.sockets) {
      socket.emit("roomList", publicRooms(socket.data.username));
    }
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
  addLobbySource,
  attachLobby,
  notifyLobby,
};
