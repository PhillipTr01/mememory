/*
 * Coins of a player that are in a game right now (a bet in the pot, a seat
 * with chips, a battle that is not over, a win still to be paid): every game
 * registers a check. A second chance (game/seasons.js) only comes when
 * nothing is in play anywhere.
 */
const checks = new Map(); // name -> (username) => boolean

function register(name, check) {
  checks.set(name, check);
}

// The games with coins of the player in play (empty: none)
function where(username) {
  const found = [];
  for (const [name, check] of checks) {
    try {
      if (check(username)) found.push(name);
    } catch (error) {
      // a broken check counts as nothing in play
    }
  }
  return found;
}

module.exports = { register, where };
