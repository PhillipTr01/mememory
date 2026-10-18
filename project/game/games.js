const config = require("./config");
const testMode = require("./test_mode");

/*
 * The games of the casino and whether they are on (admin panel, Settings).
 * A game that is off has no tab in the game list and its page leads to the
 * next game that is on. `tab` is the link of its tab (relative, see the pages).
 */
const GAMES = [
  { id: "jackpot", key: "GAME_JACKPOT", name: "Jackpot", page: "/jackpot", tab: "./", namespace: "/jackpot" },
  { id: "roulette", key: "GAME_ROULETTE", name: "Roulette", page: "/roulette", tab: "roulette", namespace: "/roulette" },
  { id: "baucua", key: "GAME_BAUCUA", name: "Bầu Cua", page: "/baucua", tab: "baucua", namespace: "/baucua" },
  { id: "battles", key: "GAME_BATTLES", name: "Case battles", page: "/battles", tab: "battles", namespace: "/battles" },
  { id: "poker", key: "GAME_POKER", name: "Poker", page: "/poker", tab: "poker", namespace: "/poker" },
  { id: "blackjack", key: "GAME_BLACKJACK", name: "Blackjack", page: "/blackjack", tab: "blackjack", namespace: "/blackjack" },
  { id: "slots", key: "GAME_SLOTS", name: "Slots", page: "/slots", tab: "slots", namespace: "/slots" },
  { id: "runner", key: "GAME_RUNNER", name: "Runner", page: "/runner", tab: "runner", namespace: "/runner" },
  // (the dungeon: the normal casino's coins only - not in a season world)
  { id: "rpg", key: "GAME_RPG", name: "Dungeon", page: "/rpg", tab: "rpg", namespace: "/rpg", noSeason: true },
];

// (a player in test mode: every game is on - try a game out before it opens for everybody)
function enabled(id, username) {
  const game = GAMES.find((g) => g.id === id);
  if (game == null) return false;
  if (username != null && testMode.active(username)) return true;
  if (game.noSeason && username != null && require("./worlds").isSeason(require("./worlds").worldOf(username))) return false;
  return config[game.key] !== false;
}

// Where a player goes instead (null: no game is on - the leaderboard)
function firstEnabled(username) {
  return GAMES.find((game) => !game.noSeason && enabled(game.id, username)) || null;
}

module.exports = { GAMES, enabled, firstEnabled };
