const { test } = require("node:test");
const assert = require("node:assert");
const config = require("../game/config");
const games = require("../game/games");
const testMode = require("../game/test_mode");

test("games: a game turned off is hidden for players - a tester still has it", () => {
  const before = config.GAME_SLOTS;
  config.GAME_SLOTS = false;
  try {
    assert.strictEqual(games.enabled("slots", "games_player"), false);
    testMode.start("games_tester");
    assert.strictEqual(games.enabled("slots", "games_tester"), true);
    assert.strictEqual(games.enabled("slots"), false);
  } finally {
    testMode.stop("games_tester");
    config.GAME_SLOTS = before;
  }
});
