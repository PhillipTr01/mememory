const test = require("node:test");
const assert = require("node:assert");
const config = require("../game/config");
const info = require("../game/info");

test("every game explains itself, with the limits of now", () => {
  for (const game of Object.keys(info.GAMES)) {
    const about = info.get(game);
    assert.ok(about.title);
    assert.ok(about.sections.length > 0);
    for (const section of about.sections) assert.ok(section.heading && section.items.length > 0);
  }
  assert.strictEqual(info.get("nothing"), null);
  assert.strictEqual(info.get("constructor"), null);
  // The 3 blackjack rooms and the changed slots limit
  assert.strictEqual(info.get("blackjack").sections.find((s) => s.heading === "The 3 rooms").items.length, 3);
  const before = config.SLOTS_MAX_BET;
  config.SLOTS_MAX_BET = 4321;
  try {
    assert.match(JSON.stringify(info.get("slots")), /4,321/);
  } finally {
    config.SLOTS_MAX_BET = before;
  }
});

test("info: the season world shows its own limits - and the max bet by balance", () => {
  const before = { ...config.SEASON_LIMITS };
  config.SEASON_LIMITS = { SLOTS_MAX_BET: 1170, BET_CAP_SHARE: 10 };
  try {
    const season = JSON.stringify(info.get("slots", "/season"));
    assert.match(season, /1,170/);
    assert.match(JSON.stringify(info.get("roulette", "/season")), /at most 10% of your coins/);
    // (slots: 1/x of it)
    assert.match(season, new RegExp(`at most ${Math.round((10 / config.SLOTS_CAP_DIV) * 100) / 100}% of your coins`));
    assert.doesNotMatch(JSON.stringify(info.get("slots", "")), /1,170/);
    assert.match(JSON.stringify(info.get("roulette", "")), new RegExp(`at most ${config.BET_CAP_SHARE}% of your coins`));
  } finally {
    config.SEASON_LIMITS = before;
  }
});
