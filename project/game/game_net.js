const CoinLog = require("../models/CoinLog");
const coins = require("./coins");
const days = require("./days");
const { GAME_REASONS } = require("./cashback");

/*
 * What a player won or lost in one game (the pages show it): every bet and everything that came back
 * (wins, refunds, cash-outs) added up - today and in total, in the world they play in (normal: the 🪙,
 * the season: this season's coins).
 */
const PREFIX = { jackpot: "jackpot", battles: "battle", poker: "poker", blackjack: "blackjack", slots: "slots", roulette: "roulette", baucua: "baucua" };

function reasonsOf(game) {
  const prefix = PREFIX[game];
  return prefix ? GAME_REASONS.filter((reason) => reason === prefix || reason.startsWith(prefix + " ")) : [];
}

// -> {today, total, rounds} or null (an unknown game, or no season to count in)
async function netOf(username, game, world, now = Date.now()) {
  const reasons = reasonsOf(game);
  if (!reasons.length) return null;
  const era = world === "season" ? coins.era() : null;
  if (world === "season" && !era) return null;
  const match = { username: username, reason: { $in: reasons }, ...(era ? { era: era } : coins.eraFilter()) };
  const sum = async (extra) => {
    const rows = await CoinLog.aggregate([{ $match: { ...match, ...extra } }, { $group: { _id: "$username", net: { $sum: "$amount" }, count: { $sum: 1 } } }]);
    return rows.length ? rows[0] : { net: 0, count: 0 };
  };
  const [total, today, bets] = await Promise.all([sum({}), sum({ at: { $gte: new Date(days.dayStart(now)) } }), sum({ reason: reasons[0] })]);
  return { today: today.net, total: total.net, rounds: bets.count };
}

module.exports = { netOf, reasonsOf };
