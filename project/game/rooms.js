const randomstring = require("randomstring");

/*
 * In-memory store of all open games.
 * Every room has a type, so a singleplayer gameID can't be used to join a
 * multiplayer game (and the other way round), and a timestamp so abandoned
 * rooms are removed instead of filling up the memory forever.
 */
const rooms = new Map();
const listeners = [];

// Lets other modules react when rooms disappear (e.g. update the lobby's room list).
function onRemove(listener) {
  listeners.push(listener);
}

function notifyRemoved(gameID, room) {
  for (const listener of listeners) {
    try {
      listener(gameID, room);
    } catch (error) {
      console.error("[rooms] Listener failed:", error);
    }
  }
}

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
  // owner: who created the room (see removeUnused)
  const owner = data.username || data.host || null;
  rooms.set(gameID, { ...data, type, owner, used: false, createdAt: now, lastActivity: now });
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
  const room = rooms.get(gameID);
  if (room != null) {
    rooms.delete(gameID);
    notifyRemoved(gameID, room);
  }
}

// Removes the rooms of one type that a user created, but nobody ever entered
function removeUnused(type, owner) {
  for (const [gameID, room] of rooms) {
    if (room.type === type && !room.used && room.owner === owner) remove(gameID);
  }
}

// All rooms of one type as [gameID, room] pairs.
function list(type) {
  return [...rooms].filter(([, room]) => room.type === type);
}

function sweep(now = Date.now()) {
  for (const [gameID, room] of rooms) {
    const ttl = room.used ? IDLE_ROOM_TTL : UNUSED_ROOM_TTL;
    if (now - room.lastActivity > ttl) {
      remove(gameID);
    }
  }
}

const sweeper = setInterval(sweep, SWEEP_INTERVAL);
// Don't keep the process alive just for the sweeper.
sweeper.unref();

module.exports = { create, get, touch, remove, removeUnused, list, onRemove, sweep, size: () => rooms.size };
