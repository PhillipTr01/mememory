const test = require("node:test");
const assert = require("node:assert");
const config = require("../game/config");
const limits = require("../game/limits");

test("second chance can turn off the max bet by balance outside of seasons only", () => {
  const before = { mode: config.OFFSEASON_MODE, off: config.OFFSEASON_NO_CAP, share: config.BET_CAP_SHARE };
  try {
    config.BET_CAP_SHARE = 20;
    config.OFFSEASON_MODE = "chance";
    config.OFFSEASON_NO_CAP = false;
    assert.ok(limits.capRule("", "jackpot"));
    config.OFFSEASON_NO_CAP = true;
    assert.strictEqual(limits.capRule("", "jackpot"), null);
    assert.strictEqual(limits.capRule("", "slots"), null);
    assert.strictEqual(limits.betCap(1e9, "", "slots"), Infinity);
    // (a season world keeps its cap)
    const seasonWorld = require("../game/worlds").SEASONS[0];
    assert.ok(limits.capRule(seasonWorld, "jackpot"));
    // (the daily bonus mode: the cap counts again)
    config.OFFSEASON_MODE = "bonus";
    assert.ok(limits.capRule("", "jackpot"));
  } finally {
    config.OFFSEASON_MODE = before.mode;
    config.OFFSEASON_NO_CAP = before.off;
    config.BET_CAP_SHARE = before.share;
  }
});

test("per game: the admin lifts the max bet by balance of one game - the others keep it, a slots bonus buy goes with the slots", () => {
  const before = { share: config.BET_CAP_SHARE, poker: config.NOCAP_POKER, slots: config.NOCAP_SLOTS };
  try {
    config.BET_CAP_SHARE = 20;
    config.NOCAP_POKER = true;
    assert.strictEqual(limits.capRule("", "poker"), null);
    assert.strictEqual(limits.betCap(1000, "", "poker"), Infinity);
    assert.ok(limits.capRule("", "jackpot"));
    // (in a season world too)
    assert.strictEqual(limits.capRule(require("../game/worlds").SEASONS[0], "poker"), null);
    assert.strictEqual(limits.gameOfReason("poker chips"), "poker");
    assert.ok(limits.capRule("", "slots:buy"));
    config.NOCAP_SLOTS = true;
    assert.strictEqual(limits.capRule("", "slots:buy"), null);
  } finally {
    config.BET_CAP_SHARE = before.share;
    config.NOCAP_POKER = before.poker;
    config.NOCAP_SLOTS = before.slots;
  }
});

test("per game: available in seasons - the Dungeon never, the others unless the admin keeps them out", () => {
  const games = require("../game/games");
  const of = (id) => games.GAMES.find((g) => g.id === id);
  const before = config.GAME_POKER_SEASON;
  try {
    assert.strictEqual(games.inSeasons(of("poker")), true);
    assert.strictEqual(games.inSeasons(of("rpg")), false);
    config.GAME_POKER_SEASON = false;
    assert.strictEqual(games.inSeasons(of("poker")), false);
    // (the normal casino keeps it)
    assert.strictEqual(games.enabled("poker", "nobody_in_a_season"), true);
  } finally {
    config.GAME_POKER_SEASON = before;
  }
});

test("per game: the admin lifts the max bet by balance of one game - the others keep it, a slots bonus buy goes with the slots", () => {
  const before = { share: config.BET_CAP_SHARE, poker: config.NOCAP_POKER, slots: config.NOCAP_SLOTS };
  try {
    config.BET_CAP_SHARE = 20;
    config.NOCAP_POKER = true;
    assert.strictEqual(limits.capRule("", "poker"), null);
    assert.strictEqual(limits.betCap(1000, "", "poker"), Infinity);
    assert.ok(limits.capRule("", "jackpot"));
    // (in a season world too)
    assert.strictEqual(limits.capRule(require("../game/worlds").SEASONS[0], "poker"), null);
    assert.strictEqual(limits.gameOfReason("poker chips"), "poker");
    assert.ok(limits.capRule("", "slots:buy"));
    config.NOCAP_SLOTS = true;
    assert.strictEqual(limits.capRule("", "slots:buy"), null);
  } finally {
    config.BET_CAP_SHARE = before.share;
    config.NOCAP_POKER = before.poker;
    config.NOCAP_SLOTS = before.slots;
  }
});

test("per game: available in seasons - the Dungeon never, the others unless the admin keeps them out", () => {
  const games = require("../game/games");
  const of = (id) => games.GAMES.find((g) => g.id === id);
  const before = config.GAME_POKER_SEASON;
  try {
    assert.strictEqual(games.inSeasons(of("poker")), true);
    assert.strictEqual(games.inSeasons(of("rpg")), false);
    config.GAME_POKER_SEASON = false;
    assert.strictEqual(games.inSeasons(of("poker")), false);
    // (the normal casino keeps it)
    assert.strictEqual(games.enabled("poker", "nobody_in_a_season"), true);
  } finally {
    config.GAME_POKER_SEASON = before;
  }
});
