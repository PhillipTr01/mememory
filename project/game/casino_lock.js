const EventEmitter = require("events");

/*
 * Closing time before a season starts or ends (game/seasons.js): no new bets, rounds
 * or seats anywhere. Running rounds go on to their end (a jackpot draw, a
 * battle, a poker hand, a blackjack round); open battles are cancelled,
 * waiting slot wins paid. Every game registers whether something still runs.
 *
 * changes: "locked", "unlocked"
 */
// What a refused bet says: why the casino is closed
const MESSAGES = {
  start: "A new season starts in a moment - no new bets until then.",
  end: "The season ends in a moment - no new bets anymore.",
};
const changes = new EventEmitter();
changes.setMaxListeners(0);
const running = new Map(); // game -> () => boolean: a round is still going on

let lockedNow = false;
let reason = "start";

function locked() {
  return lockedNow;
}

function message() {
  return MESSAGES[reason] || MESSAGES.start;
}

// why: "start" (a season starts) or "end" (the running one ends)
function lock(why = "start") {
  reason = why;
  if (lockedNow) return;
  lockedNow = true;
  changes.emit("locked");
}

function unlock() {
  if (!lockedNow) return;
  lockedNow = false;
  changes.emit("unlocked");
}

function registerRunning(name, check) {
  running.set(name, check);
}

// The games where something still runs (empty: everything is quiet)
function busyGames() {
  const busy = [];
  for (const [name, check] of running) {
    try {
      if (check()) busy.push(name);
    } catch (error) {
      // a broken check doesn't hold the season up
    }
  }
  return busy;
}

module.exports = { message, changes, locked, lock, unlock, registerRunning, busyGames };
