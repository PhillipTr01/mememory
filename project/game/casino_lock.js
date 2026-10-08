const EventEmitter = require("events");

/*
 * Closing time before a season starts or ends (game/seasons.js) - or before a
 * maintenance (game/maintenance.js): no new bets, rounds
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
  maintenance: "A maintenance starts in a moment - no new bets until it is over.",
};
const changes = new EventEmitter();
changes.setMaxListeners(0);
const running = new Map(); // game -> () => boolean: a round is still going on

// Who holds the casino closed: "start" / "end" (a season), "maintenance" - closed while anybody does
const holders = new Set();
let reason = "start";

function locked() {
  return holders.size > 0;
}

function message() {
  return MESSAGES[reason] || MESSAGES.start;
}

// why: "start" (a season starts), "end" (the running one ends) or "maintenance"
function lock(why = "start") {
  reason = why;
  const was = locked();
  // (a season: start or end, never both)
  if (why !== "maintenance") holders.delete(why === "start" ? "end" : "start");
  holders.add(why);
  if (!was) changes.emit("locked");
}

// why: what lets go ("maintenance") - not given: the season
function unlock(why) {
  if (!locked()) return;
  if (why) holders.delete(why);
  else {
    holders.delete("start");
    holders.delete("end");
  }
  if (holders.size) reason = [...holders][holders.size - 1];
  else changes.emit("unlocked");
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
