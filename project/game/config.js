/* Multiplayer settings. The maximum can be changed with MULTIPLAYER_MAX_PLAYERS. */

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const MIN_PLAYERS = 2;
const MAX_PLAYERS = clamp(parseInt(process.env.MULTIPLAYER_MAX_PLAYERS, 10) || 8, MIN_PLAYERS, 16);

// Plain object on purpose: the tests shorten the timings.
module.exports = {
  MIN_PLAYERS,
  MAX_PLAYERS,
  // Size of a new room, the host can change it in the waiting room.
  DEFAULT_MAX_PLAYERS: Math.min(4, MAX_PLAYERS),
  MAX_CHAT_LENGTH: 300,
  CHAT_HISTORY: 50,
  CHAT_COOLDOWN: 500, // ms between two chat messages of one player

  // A disconnected player keeps the seat this long (reload, bad connection, ...)
  REJOIN_GRACE_WAITING: 20 * 1000,
  REJOIN_GRACE_PLAYING: 60 * 1000,
  // Rooms without anybody in them are deleted after this time
  EMPTY_ROOM_GRACE: 15 * 1000,
  // Length of the "who starts" animation, the game begins afterwards
  START_ANIMATION: 4000,
  // How often disconnected players and empty rooms are checked
  TICK: 1000,

  // Game modes the host can choose in the waiting room
  MODES: ["classic", "speed"],
  // Speed round: default time per turn (ms), the choices for the host (seconds)
  // and the pause after two wrong cards before the turn passes
  SPEED_TURN_TIME: 10 * 1000,
  SPEED_TURN_OPTIONS: [3, 5, 10, 15],
  SPEED_MISS_DELAY: 1100,
  // The clock starts after the card animations (flip takes 0.5s on the client in speed rounds)
  SPEED_ANIMATION_GRACE: 600,
  // Speed round: shorter "who starts" animation
  SPEED_START_ANIMATION: 2600,
};
