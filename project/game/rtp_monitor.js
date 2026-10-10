const CoinLog = require("../models/CoinLog");
const coins = require("./coins");
const days = require("./days");
const config = require("./config");
const slots = require("./slots");
const roulette = require("./roulette");
const baucua = require("./baucua");
const cases = require("./cases");

/*
 * The RTP monitor (admin panel): how much of the bets every game really paid back - from the coin
 * history - next to what the maths says it should. Wagered: the bets minus what was given back
 * (a refund is no bet), paid: the wins. The spread tells how far off the real payback may be by
 * pure chance (about one standard error, from the wins themselves): far more than that - check it.
 */
const GAMES = [
  { id: "slots", name: "Slots", icon: "🎰", bet: ["slots bet"], win: ["slots win"], refund: [], theory: () => slots.rtp().rtp },
  { id: "roulette", name: "Roulette", icon: "🎡", bet: ["roulette bet"], win: ["roulette win"], refund: ["roulette refund"], theory: () => roulette.rtp("red") },
  { id: "baucua", name: "Bầu Cua", icon: "🦀", bet: ["baucua bet"], win: ["baucua win"], refund: ["baucua refund"], theory: () => baucua.rtp() },
  { id: "blackjack", name: "Blackjack", icon: "🃏", bet: ["blackjack bet"], win: ["blackjack win"], refund: ["blackjack refund"], theory: () => null, about: "Depends on how the players play - about 99.5% with perfect basic strategy." },
  {
    id: "battles",
    name: "Case battles",
    icon: "🎁",
    bet: ["battle"],
    win: ["battle win"],
    refund: ["battle refund"],
    // (every case pays back its own - the average of the cases that are on)
    theory: () => {
      const on = cases.CASES.filter((box) => cases.enabled(box.key));
      return on.length ? on.reduce((sum, box) => sum + cases.rtpOf(box), 0) / on.length : null;
    },
    about: "The average of the cases that are on - every case pays back its own.",
  },
  { id: "jackpot", name: "Jackpot", icon: "💰", bet: ["jackpot bet"], win: ["jackpot win"], refund: ["jackpot refund"], theory: () => 1 - config.JACKPOT_RAKE / 100, about: () => `Players against players: the house keeps at most ${config.JACKPOT_RAKE}% of a pot (less when one player put in nearly all of it).` },
  { id: "poker", name: "Poker", icon: "♠️", bet: ["poker buy-in", "poker chips"], win: ["poker cash-out"], refund: ["poker refund"], theory: () => null, about: () => `Players against players: the house keeps ${config.POKER_RAKE}% of every pot that saw the flop. Chips still on a table count as not paid back yet.` },
];

const RANGES = { today: "Today", week: "7 days", month: "30 days", all: "All time" };
const DAY = 24 * 3600 * 1000;

function since(range, now = Date.now()) {
  if (range === "today") return days.dayStart(now);
  if (range === "week") return days.dayStart(now) - 6 * DAY;
  if (range === "month") return days.dayStart(now) - 29 * DAY;
  return null;
}

// The rows of the history the monitor reads: per kind the sum, the count and the sum of the squares
async function sums(range, world, now) {
  const reasons = GAMES.flatMap((game) => [...game.bet, ...game.win, ...game.refund]);
  const from = since(range, now);
  const era = world === "season" ? coins.era() : null;
  if (world === "season" && !era) return new Map();
  const match = { reason: { $in: reasons }, ...(era ? { era: era } : coins.eraFilter()), ...(from != null ? { at: { $gte: new Date(from) } } : {}) };
  const rows = await CoinLog.aggregate([{ $match: match }, { $group: { _id: "$reason", sum: { $sum: "$amount" }, count: { $sum: 1 }, squares: { $sum: { $multiply: ["$amount", "$amount"] } } } }]);
  return new Map(rows.map((row) => [row._id, row]));
}

const text = (value) => (typeof value === "function" ? value() : value || null);

/*
 * {range, world, games: [{id, name, icon, bets, wagered, paid, profit, rtp, theory, spread, status, about}]}
 * status: "empty" (no bets), "few" (too few bets to tell), "ok", "watch" (2-3 spreads off), "check" (more)
 */
async function report(range = "week", world = "normal", now = Date.now()) {
  if (!RANGES[range]) range = "week";
  if (world !== "season") world = "normal";
  const all = await sums(range, world, now);
  const total = (kinds, key) => kinds.reduce((sum, kind) => sum + ((all.get(kind) || {})[key] || 0), 0);
  const games = GAMES.map((game) => {
    const bets = total(game.bet, "count");
    const wagered = Math.max(0, -total(game.bet, "sum") - total(game.refund, "sum"));
    const paid = total(game.win, "sum");
    const wins = total(game.win, "count");
    const rtp = wagered > 0 ? paid / wagered : null;
    let theory = null;
    try {
      theory = game.theory();
    } catch (error) {
      theory = null;
    }
    // (the spread of the payback by chance: the spread of the wins over the bets)
    const squares = total(game.win, "squares");
    const variance = wins > 0 ? Math.max(0, squares - (paid * paid) / Math.max(bets, wins)) : 0;
    const spread = wagered > 0 ? Math.sqrt(variance) / wagered : null;
    let status = "ok";
    if (bets === 0) status = "empty";
    else if (bets < config.RTP_MIN_BETS) status = "few";
    else if (theory != null && rtp != null && spread != null) {
      const off = Math.abs(rtp - theory) / Math.max(spread, 0.001);
      status = off > 3 ? "check" : off > 2 ? "watch" : "ok";
    }
    return { id: game.id, name: game.name, icon: game.icon, bets: bets, wins: wins, wagered: wagered, paid: paid, profit: wagered - paid, rtp: rtp, theory: theory, spread: spread, status: status, about: text(game.about) };
  });
  const wagered = games.reduce((sum, game) => sum + game.wagered, 0);
  const paid = games.reduce((sum, game) => sum + game.paid, 0);
  return { range: range, world: world, ranges: RANGES, seasonRunning: coins.era() != null, minBets: config.RTP_MIN_BETS, games: games, total: { wagered: wagered, paid: paid, profit: wagered - paid, rtp: wagered > 0 ? paid / wagered : null } };
}

module.exports = { GAMES, RANGES, report };
