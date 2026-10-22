const { test, after } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const config = require("../game/config");
const seasons = require("../game/seasons");
const kit = require("../game/season_kit");
const plays = require("../game/play_events");
const games = require("../game/games");
const days = require("../game/days");

config.SEASON_CLOSE_WAIT = 0;
after(() => seasons.reset());

// A play as the games send it (play_events adds net, x and the outcome)
const play = (fields) => {
  const win = fields.win || 0;
  return { win: win, net: win - fields.bet, x: fields.bet ? win / fields.bet : 0, outcome: win > fields.bet ? "win" : win < fields.bet ? "loss" : "even", ...fields };
};
const red = (won) => play({ game: "roulette", name: "kit_a", bet: 100, on: "red", result: won ? "red" : "blue", win: won ? 200 : 0 });
const green = (won) => play({ game: "roulette", name: "kit_a", bet: 100, on: "green", result: won ? "green" : "red", win: won ? 1400 : 0 });

const built = (input) => {
  const result = kit.check(input);
  assert.ok(!result.error, result.error);
  return { id: 1, slot: "season", name: "Kit", coinIcon: "💎", kit: result.kit };
};

test("season kit: a goal of steps - lose 10 times on red in a row, then green right after", () => {
  const season = built({
    quests: [
      {
        id: "redgreen",
        steps: [
          { game: "roulette", outcome: "loss", where: [{ field: "on", op: "eq", value: "red" }], need: 10, inRow: true },
          { game: "roulette", outcome: "win", where: [{ field: "on", value: "green" }], need: 1, next: true },
        ],
        reward: { coins: 5000 },
      },
    ],
  });
  assert.strictEqual(kit.questText(season.kit.quests[0]), "Lose 10 times in roulette on red in a row. Right after that, win once in roulette on green.");
  const state = { users: {} };
  const progress = () => state.users.kit_a.q.redgreen;
  // 9 losses on red, then red wins: in a row - from the start
  for (let i = 0; i < 9; i++) kit.apply(season, state, red(false));
  assert.strictEqual(progress().count, 9);
  kit.apply(season, state, red(true));
  assert.strictEqual(progress().count, 0);
  // A bet on blue doesn't count and doesn't break it
  kit.apply(season, state, play({ game: "roulette", name: "kit_a", bet: 100, on: "blue", result: "red", win: 0 }));
  for (let i = 0; i < 10; i++) kit.apply(season, state, red(false));
  assert.deepStrictEqual([progress().step, progress().count], [1, 0]);
  // Green has to hit the next time it is played - or the goal starts over
  kit.apply(season, state, green(false));
  assert.deepStrictEqual([progress().step, progress().count], [0, 0]);
  for (let i = 0; i < 10; i++) kit.apply(season, state, red(false));
  const done = kit.apply(season, state, green(true));
  assert.deepStrictEqual(done.map((q) => q.id), ["redgreen"]);
  assert.ok(progress().done);
  // Done once: nothing more
  assert.deepStrictEqual(kit.apply(season, state, green(true)), []);
});

test("season kit: conditions on what a game knows - a jackpot won with 5% or less, a daily goal starts again the next day", () => {
  const season = built({
    currencies: [{ name: "Stars", icon: "⭐" }],
    quests: [{ id: "lucky", repeat: "daily", steps: [{ game: "jackpot", outcome: "win", where: [{ field: "chance", op: "lte", value: 5 }], need: 1 }], reward: { currencies: { stars: 3 } } }],
  });
  assert.strictEqual(kit.questText(season.kit.quests[0]), "Win once in the jackpot with a chance of at most 5%.");
  const state = { users: {} };
  const pot = (chance, won) => play({ game: "jackpot", name: "kit_a", bet: 50, chance: chance, win: won ? 1000 : 0 });
  const day = days.dayStart(Date.parse("2026-10-06T12:00:00Z")) + 3600000;
  assert.deepStrictEqual(kit.apply(season, state, pot(20, true), day), []);
  assert.deepStrictEqual(kit.apply(season, state, pot(4.5, false), day), []);
  assert.strictEqual(kit.apply(season, state, pot(4.5, true), day).length, 1);
  assert.strictEqual(state.users.kit_a.cur.stars, 3, "the currency of the reward");
  assert.deepStrictEqual(kit.apply(season, state, pot(1, true), day + 3600000), [], "once a day");
  assert.strictEqual(kit.apply(season, state, pot(1, true), day + 86400000).length, 1, "the next day again");
  assert.strictEqual(state.users.kit_a.cur.stars, 6);
});

test("season kit: currencies earned while playing, what is left over counts on", () => {
  const season = built({ currencies: [{ name: "Chips", icon: "🎟️", earn: { on: true, game: "slots", measure: "bet", per: 1000, amount: 2 } }] });
  const state = { users: {} };
  const spin = (bet) => kit.apply(season, state, play({ game: "slots", name: "kit_a", bet: bet, win: 0, kind: "nothing" }));
  spin(600);
  spin(600);
  assert.deepStrictEqual([state.users.kit_a.cur.chips, state.users.kit_a.rest.chips], [2, 200]);
  kit.apply(season, state, play({ game: "roulette", name: "kit_a", bet: 5000, on: "red", win: 0 }));
  assert.strictEqual(state.users.kit_a.cur.chips, 2, "only on slots");
});

test("season kit: what the admin builds is checked", () => {
  assert.match(kit.check({ games: [] }).error, /at least one game/);
  assert.strictEqual(kit.check({ games: games.GAMES.filter((g) => !g.noSeason).map((g) => g.id) }).kit.games, null, "every game: none listed");
  assert.match(kit.check({ quests: [{ steps: [{ game: "slots", where: [{ field: "on", value: "red" }], need: 1 }] }] }).error, /doesn't know/);
  assert.match(kit.check({ quests: [{ steps: [{ game: "roulette", where: [{ field: "on", value: "purple" }], need: 1 }] }] }).error, /pick a value/);
  assert.match(kit.check({ quests: [{ steps: [] }] }).error, /1 to 6 steps/);
  assert.match(kit.check({ board: "stars" }).error, /unknown currency/);
  assert.match(kit.check({ quests: [{ steps: [{ need: 1 }], reward: { currencies: { gems: 5 } } }] }).error, /unknown currency/);
  // Yes / no conditions read as plain words
  const q = kit.check({ quests: [{ steps: [{ game: "blackjack", outcome: "win", where: [{ field: "doubled", value: "yes" }], need: 3, inRow: true }] }] }).kit.quests[0];
  assert.strictEqual(kit.questText(q), "Win 3 times in blackjack after doubling in a row.");
});

test("season kit: a season with only some games, goals paid in the season's coins, a leaderboard by a currency", async () => {
  seasons.reset();
  kit.reset();
  h.addUser("kit_a");
  h.addUser("kit_b");
  const now = Date.now();
  const made = await seasons.create({
    name: "Slots only",
    icon: "🎰",
    start: now - 1000,
    end: now + 3600 * 1000,
    budget: 1000,
    every: 0,
    wagerX: 0,
    kit: {
      games: ["slots"],
      currencies: [{ name: "Stars", icon: "⭐" }],
      quests: [{ id: "spin3", steps: [{ game: "slots", need: 3 }], reward: { coins: 500, currencies: { stars: 7 } } }],
      board: "stars",
    },
  });
  assert.ok(made.season, made.error);
  await seasons.tick(now);
  await seasons.join("kit_a", now);
  await seasons.join("kit_b", now);
  assert.ok(games.enabled("slots", "kit_a"));
  assert.ok(!games.enabled("jackpot", "kit_a") && !games.enabled("roulette", "kit_a"), "only the season's games");
  assert.strictEqual(games.firstEnabled("kit_a").id, "slots");

  for (let i = 0; i < 3; i++) plays.played("/season", { game: "slots", name: "kit_a", bet: 10, win: 0, kind: "nothing" });
  await h.wait(30);
  assert.strictEqual(h.userOf("kit_a").seasonCoins, 1500, "the goal paid 500 season coins");
  const view = await kit.view(seasons.running(), "kit_a");
  assert.deepStrictEqual([view.quests[0].done, view.quests[0].text, view.currencies[0].amount], [true, "Play 3 times in slots.", 7]);

  // The leaderboard counts the stars - not the coins
  const board = await require("../game/leaderboard").get(Date.now(), "/season");
  assert.deepStrictEqual(board.rows.map((r) => [r.username, r.coins]), [["kit_a", 7], ["kit_b", 0]]);
  assert.deepStrictEqual(seasons.publicSeason(seasons.running()).board, { id: "stars", name: "Stars", icon: "⭐" });

  // Saved without the kit (an older page): as it was
  await seasons.update(made.season.id, { ...seasons.publicSeason(seasons.running()), kit: undefined });
  assert.deepStrictEqual(seasons.running().kit.games, ["slots"]);
});
