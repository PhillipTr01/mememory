const config = require("./config");

/*
 * The games of the casino and whether they are on (admin panel, Settings).
 * A game that is off has no tab in the game list and its page leads to the
 * next game that is on. `tab` is the link of its tab (relative, see the pages).
 */
const GAMES = [
  { id: "jackpot", key: "GAME_JACKPOT", name: "Jackpot", page: "/jackpot", tab: "./", namespace: "/jackpot" },
  { id: "battles", key: "GAME_BATTLES", name: "Case battles", page: "/battles", tab: "battles", namespace: "/battles" },
  { id: "poker", key: "GAME_POKER", name: "Poker", page: "/poker", tab: "poker", namespace: "/poker" },
  { id: "blackjack", key: "GAME_BLACKJACK", name: "Blackjack", page: "/blackjack", tab: "blackjack", namespace: "/blackjack" },
];

function enabled(id) {
  const game = GAMES.find((g) => g.id === id);
  return game != null && config[game.key] !== false;
}

// Where a player goes instead (null: no game is on - the leaderboard)
function firstEnabled() {
  return GAMES.find((game) => config[game.key] !== false) || null;
}

module.exports = { GAMES, enabled, firstEnabled };
