/* Multiplayer settings. The maximum can be changed with MULTIPLAYER_MAX_PLAYERS. */

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const MIN_PLAYERS = 2;
const MAX_PLAYERS = clamp(parseInt(process.env.MULTIPLAYER_MAX_PLAYERS, 10) || 8, MIN_PLAYERS, 16);

module.exports = {
  MIN_PLAYERS,
  MAX_PLAYERS,
  // Size of a new room, the host can change it in the waiting room.
  DEFAULT_MAX_PLAYERS: Math.min(4, MAX_PLAYERS),
  MAX_CHAT_LENGTH: 300,
  CHAT_HISTORY: 50,
  CHAT_COOLDOWN: 500, // ms between two chat messages of one player
};
