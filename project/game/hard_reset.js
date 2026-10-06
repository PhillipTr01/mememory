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

module.exports = { hardReset };
