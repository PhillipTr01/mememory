const User = require("../models/User");
const CoinLog = require("../models/CoinLog");
const Setting = require("../models/Setting");
const access = require("./access");
const persist = require("./persist");

/*
 * The hard reset of the admin panel - part by part, the admin picks what goes:
 * the records (the coin history, all coins, the games as on
 * their first start, the casino chat) - and, only when picked, what was set up
 * (who has access, what was bought in the shop, the seasons, the values of
 * the settings pages, the planned money rains). The accounts themselves
 * always stay.
 */
const PARTS = [
  // The records
  { id: "history", group: "records", label: "Coin history", about: "Every coin change, the daily leaderboard and the money rains that fell." },
  { id: "coins", group: "records", label: "Coins", about: "All balances (normal and season) - players start again with the start coins." },
  { id: "games", group: "records", label: "Games", about: "Pots, battles, tables, rounds and last wins - every game as on its first start." },
  { id: "chat", group: "records", label: "Casino chat", about: "Every message and every chat ban." },
  // What was set up
  { id: "access", group: "setup", label: "Access", about: "Who may play - everybody asks for access again." },
  { id: "purchases", group: "setup", label: "Shop purchases", about: "Every bought frame and effect comes off the avatars (the ones won in seasons too)." },
  { id: "seasons", group: "setup", label: "Seasons", about: "Every season - planned, running and over - and its leaderboard." },
  { id: "settings", group: "setup", label: "Settings", about: "Every value of the settings pages back to its default (the season's own limits and the daily streak too)." },
  { id: "rains", group: "setup", label: "Money rains", about: "Every planned money rain." },
];
const IDS = PARTS.map((part) => part.id);
// Nothing picked (an old call): everything as before - all records, access, purchases and seasons
const DEFAULT = ["history", "coins", "games", "chat", "access", "purchases", "seasons"];
const CHAT_KEYS = ["chat"];

// parts: the ids to reset -> {done: [ids], history, players} or {error}
async function hardReset(parts) {
  const picked = parts == null ? DEFAULT : parts;
  if (!Array.isArray(picked) || picked.length === 0) return { error: "Pick at least one part to reset." };
  const unknown = picked.find((id) => !IDS.includes(id));
  if (unknown) return { error: `Unknown part ${unknown}.` };
  const has = (id) => picked.includes(id);
  const result = { done: IDS.filter(has), history: 0, players: 0 };

  // Open casino pages close when what they show changes (coins, games, access)
  if (has("coins") || has("games") || has("access") || has("chat")) {
    require("./test_mode").reset();
    access.changes.emit("closeAll");
  }
  if (has("games") || has("chat")) {
    await persist.resetAll(persist.keys().filter((key) => (CHAT_KEYS.includes(key) ? !has("chat") : !has("games"))));
  }
  if (has("history")) {
    result.history = (await CoinLog.deleteMany({})).deletedCount || 0;
    await Setting.deleteMany({ key: "leaderboard" });
    await require("./money_rain").clearDone();
  }

  const $set = {};
  const $unset = {};
  if (has("coins")) {
    $set.coins = 0;
    Object.assign($unset, { coinReset: 1, coinBonusAt: 1, coinStreak: 1, seasonCoins: 1, seasonReset: 1, seasonBonusAt: 1, seasonStreak: 1, season2Coins: 1, season2Reset: 1, season2BonusAt: 1, season2Streak: 1, inbox: 1 });
  }
  if (has("access")) {
    Object.assign($set, { casinoApproved: false });
    Object.assign($unset, { casinoApprovedAt: 1, casinoRequestedAt: 1 });
  }
  if (has("purchases")) $unset.looks = 1;
  if (Object.keys($set).length || Object.keys($unset).length) {
    const users = await User.updateMany({}, { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) });
    result.players = users.nModified != null ? users.nModified : users.modifiedCount || 0;
  }
  // The day of the first approval (start coins + missed bonuses): with the coins
  if (has("coins")) await Setting.deleteMany({ key: "casinoFirstApproval" });

  if (has("seasons")) {
    await require("./seasons").clear();
    // (the limits of every season go with them)
    await require("./settings").clearSeasonLimits();
  }
  if (has("settings")) {
    const settings = require("./settings");
    await settings.resetToDefaults();
    await settings.clearSeasonLimits();
    await require("./streak").reset();
  }
  if (has("rains")) await require("./money_rain").clearPlanned();
  return result;
}

module.exports = { hardReset, PARTS, DEFAULT };
