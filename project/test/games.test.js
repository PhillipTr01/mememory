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

test("games: the Dungeon is off until the admin turns it on - test mode has it anyway", () => {
  const before = config.GAME_RPG;
  try {
    assert.strictEqual(config.GAME_RPG, false);
    assert.strictEqual(games.enabled("rpg", "games_player"), false);
    testMode.start("games_tester");
    assert.strictEqual(games.enabled("rpg", "games_tester"), true);
    config.GAME_RPG = true;
    assert.strictEqual(games.enabled("rpg", "games_player"), true);
    // (never where a game sends to when another is off)
    config.GAME_JACKPOT = config.GAME_ROULETTE = config.GAME_BAUCUA = config.GAME_BATTLES = config.GAME_POKER = config.GAME_BLACKJACK = config.GAME_SLOTS = false;
    assert.strictEqual(games.firstEnabled("games_player"), null);
  } finally {
    testMode.stop("games_tester");
    config.GAME_RPG = before;
    config.GAME_JACKPOT = config.GAME_ROULETTE = config.GAME_BAUCUA = config.GAME_BATTLES = config.GAME_POKER = config.GAME_BLACKJACK = config.GAME_SLOTS = true;
  }
});
