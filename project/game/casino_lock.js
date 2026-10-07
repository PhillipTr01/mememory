const EventEmitter = require("events");

/*
 * Closing time before a season starts (game/seasons.js): no new bets, rounds
 * or seats anywhere. Running rounds go on to their end (a jackpot draw, a
 * battle, a poker hand, a blackjack round); open battles are cancelled,
 * waiting slot wins paid. Every game registers whether something still runs.
 *
 * changes: "locked", "unlocked"
 */
const MESSAGE = "A new season starts in a moment - no new bets until then.";
const changes = new EventEmitter();
changes.setMaxListeners(0);
const running = new Map(); // game -> () => boolean: a round is still going on

let lockedNow = false;

function locked() {
  return lockedNow;
}

function lock() {
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

module.exports = { MESSAGE, changes, locked, lock, unlock, registerRunning, busyGames };
