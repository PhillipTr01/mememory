const test = require("node:test");
const assert = require("node:assert");
require("./helpers");
const CoinLog = require("../models/CoinLog");
const config = require("../game/config");
const rtp = require("../game/rtp_monitor");

test("rtp monitor: what a game really paid back - bets minus refunds, the wins, the range of time, the expected payback", async () => {
  const now = Date.now();
  const at = (ago) => new Date(now - ago * 86400000);
  // Roulette today: 3 bets of 100 (one given back), one win of 200
  for (let i = 0; i < 3; i++) await CoinLog.create({ username: "rt_a", amount: -100, reason: "roulette bet", at: at(0) });
  await CoinLog.create({ username: "rt_a", amount: 100, reason: "roulette refund", at: at(0) });
  await CoinLog.create({ username: "rt_a", amount: 200, reason: "roulette win", at: at(0) });
  // ... and 10 days ago: not in the week
  await CoinLog.create({ username: "rt_a", amount: -1000, reason: "roulette bet", at: at(10) });
  // A season's bets don't count for the normal casino
  await CoinLog.create({ username: "rt_a", amount: -500, reason: "roulette bet", at: at(0), era: "season-x" });

  const week = await rtp.report("week", "normal", now);
  const roulette = week.games.find((game) => game.id === "roulette");
  assert.deepStrictEqual([roulette.bets, roulette.wagered, roulette.paid, roulette.profit], [3, 200, 200, 0]);
  assert.strictEqual(roulette.rtp, 1);
  assert.ok(roulette.theory > 0.9 && roulette.theory < 1, "the maths of the wheel");
  assert.strictEqual(roulette.status, "few", "too few bets to tell");

  const all = await rtp.report("all", "normal", now);
  assert.strictEqual(all.games.find((game) => game.id === "roulette").wagered, 1200);
  assert.strictEqual(all.games.find((game) => game.id === "slots").status, "empty");
  assert.ok(all.total.wagered >= 1200);
  // Nothing in the season world without a running season
  assert.strictEqual((await rtp.report("all", "season", now)).games.find((game) => game.id === "roulette").wagered, 0);
});

test("rtp monitor: enough bets - a payback far from the maths is flagged, one close to it is fine", async () => {
  const now = Date.now();
  const old = config.RTP_MIN_BETS;
  config.RTP_MIN_BETS = 50;
  try {
    // Bầu Cua: 100 bets of 10, wins of 20 on every second one - pays back 100% (the maths: ~95%)
    for (let i = 0; i < 100; i++) {
      await CoinLog.create({ username: "rt_b", amount: -10, reason: "baucua bet", at: new Date(now) });
      if (i % 2) await CoinLog.create({ username: "rt_b", amount: 20, reason: "baucua win", at: new Date(now) });
    }
    let game = (await rtp.report("today", "normal", now)).games.find((g) => g.id === "baucua");
    assert.strictEqual(game.rtp, 1);
    assert.ok(game.spread > 0 && game.spread < 0.2);
    assert.ok(["ok", "watch"].includes(game.status), "5 points off with this spread is still chance: " + game.status);
    // Then 100 more bets that all win 10x: far too much
    for (let i = 0; i < 100; i++) {
      await CoinLog.create({ username: "rt_b", amount: -10, reason: "baucua bet", at: new Date(now) });
      await CoinLog.create({ username: "rt_b", amount: 100, reason: "baucua win", at: new Date(now) });
    }
    game = (await rtp.report("today", "normal", now)).games.find((g) => g.id === "baucua");
    assert.strictEqual(game.status, "check");
  } finally {
    config.RTP_MIN_BETS = old;
  }
});

test("rtp monitor: slots - a thousand spins without a big win is no alarm (the spread comes from the maths)", async () => {
  const now = Date.now();
  const old = config.RTP_MIN_BETS;
  config.RTP_MIN_BETS = 50;
  try {
    // ~1,000 spins of 2,000, small wins only: two thirds paid back (the maths: ~97%)
    for (let i = 0; i < 1000; i++) {
      await CoinLog.create({ username: "rt_s", amount: -2000, reason: "slots bet", at: new Date(now) });
      if (i % 3 === 0) await CoinLog.create({ username: "rt_s", amount: 4000, reason: "slots win", at: new Date(now) });
    }
    const game = (await rtp.report("today", "normal", now)).games.find((g) => g.id === "slots");
    assert.ok(game.rtp > 0.6 && game.rtp < 0.7);
    // 7.3 bets of spread per spin over sqrt(1,000) spins: about 23 points
    assert.ok(game.spread > 0.2 && game.spread < 0.26, "spread " + game.spread);
    assert.notStrictEqual(game.status, "check");
  } finally {
    config.RTP_MIN_BETS = old;
  }
});
