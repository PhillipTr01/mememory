const User = require("../models/User");
const CoinLog = require("../models/CoinLog");
const Withdrawal = require("../models/Withdrawal");
const Setting = require("../models/Setting");
const access = require("./access");
const persist = require("./persist");

/*
 * The hard reset of the admin panel: the casino starts anew. Every open
 * casino page closes, every game (pots, battles, tables, chat) is as on its
 * first start, and the history of coins, the payouts, every access (and
 * request) and all coins are gone. The accounts themselves stay - to play
 * again a player asks for access again and gets the start coins.
 */
async function hardReset() {
  access.changes.emit("closeAll");
  await persist.resetAll();
  const [logs, payouts, users] = await Promise.all([
    CoinLog.deleteMany({}),
    Withdrawal.deleteMany({}),
    User.updateMany(
      {},
      {
        $set: { casinoApproved: false, payoutAllowed: false, coins: 0 },
        $unset: { casinoApprovedAt: 1, casinoRequestedAt: 1, coinReset: 1, coinBonusAt: 1 },
      },
    ),
  ]);
  // The day of the first approval (start coins + missed bonuses) and the leaderboard of the day
  await Setting.deleteMany({ key: { $in: ["casinoFirstApproval", "leaderboard"] } });
  return {
    history: logs.deletedCount || 0,
    payouts: payouts.deletedCount || 0,
    players: users.nModified != null ? users.nModified : users.modifiedCount || 0,
  };
}

/*
 * A season starts (game/seasons.js): the casino starts anew like after the
 * hard reset - every game, the leaderboard, the coin history shown (the one
 * from before is kept apart and comes back after the season) - but everybody
 * who is in stays in and starts with the season's budget. Returns the state
 * of every game before (restored after the season).
 */
async function seasonReset(budget, reset) {
  const games = persist.snapshotAll();
  await persist.resetAll();
  await User.updateMany({ casinoApproved: true }, { $set: { coins: budget, coinReset: reset }, $unset: { coinBonusAt: 1 } });
  await Setting.deleteMany({ key: { $in: ["leaderboard"] } });
  return games;
}

// The season is over: the games as before it, its own coin history gone
async function seasonRestore(games, reset) {
  await persist.restoreSnapshots(games);
  await CoinLog.deleteMany({ era: reset });
  await Setting.deleteMany({ key: { $in: ["leaderboard"] } });
}

module.exports = { hardReset, seasonReset, seasonRestore };
