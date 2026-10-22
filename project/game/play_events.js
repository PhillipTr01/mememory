const EventEmitter = require("events");

/*
 * Every play of every game, once it is settled: played(world, play) - the games call it, the season's
 * goals and currencies (game/season_kit.js) listen. A play: {game, name, bet, win, ...what the game
 * knows about it (the color bet on, the chance in the pot, the hand)}. Added here: net (win - bet),
 * x (win / bet) and outcome ("win": more back than bet, "loss": less, "even": the bet back).
 */
const events = new EventEmitter();
events.setMaxListeners(0);

function played(world, play) {
  if (!play || typeof play.name !== "string" || !(play.bet >= 0)) return;
  const win = Math.max(0, Number(play.win) || 0);
  const full = { ...play, win: win, net: win - play.bet, x: play.bet > 0 ? win / play.bet : 0, outcome: win > play.bet ? "win" : win < play.bet ? "loss" : "even", at: Date.now() };
  try {
    events.emit("play", world, full);
  } catch (error) {
    console.error("[plays] A listener failed:", error);
  }
}

module.exports = { played, events };
