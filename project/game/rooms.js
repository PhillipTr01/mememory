const randomstring = require("randomstring");

/*
 * In-memory store of all open games.
 * Every room has a type, so a singleplayer gameID can't be used to join a
 * multiplayer game (and the other way round), and a timestamp so abandoned
 * rooms are removed instead of filling up the memory forever.
 */
const rooms = new Map();

const UNUSED_ROOM_TTL = 15 * 60 * 1000; // created, but nobody ever played
const IDLE_ROOM_TTL = 2 * 60 * 60 * 1000; // no activity at all
const SWEEP_INTERVAL = 5 * 60 * 1000;

function create(type, data) {
  let gameID;
  do {
    // Randomstring of 10 Chars
    gameID = randomstring.generate(10);
  } while (rooms.has(gameID));

  const now = Date.now();
  rooms.set(gameID, { ...data, type, used: false, createdAt: now, lastActivity: now });
  return gameID;
}

// Returns the room only if it exists and has the expected type.
function get(gameID, type) {
  if (typeof gameID !== "string") return null;
  const room = rooms.get(gameID);
  if (room == null || (type != null && room.type !== type)) return null;
  return room;
}

// Marks a room as in use and refreshes its idle timer.
function touch(room) {
  if (room != null) {
    room.used = true;
    room.lastActivity = Date.now();
  }
}

function remove(gameID) {
  rooms.delete(gameID);
}

function sweep(now = Date.now()) {
  for (const [gameID, room] of rooms) {
    const ttl = room.used ? IDLE_ROOM_TTL : UNUSED_ROOM_TTL;
    if (now - room.lastActivity > ttl) {
      rooms.delete(gameID);
    }
  }
}

const sweeper = setInterval(sweep, SWEEP_INTERVAL);
// Don't keep the process alive just for the sweeper.
sweeper.unref();

module.exports = { create, get, touch, remove, sweep, size: () => rooms.size };
