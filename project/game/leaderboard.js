const User = require("../models/User");
const Setting = require("../models/Setting");
const config = require("./config");
const days = require("./days");

/*
 * The leaderboard of the casino: the approved players by their coins. It is
 * made once a day (at midnight, like the daily bonus) and stays the same until
 * the next day - with the places of the day before, so everybody sees who
 * went up or down.
 */
const KEY = "leaderboard";
const SIZE = 100;

// The balance as the player sees it (accounts from before a reset get the start coins)
function balance(user) {
  return user.coinReset === config.COIN_RESET ? user.coins || 0 : config.START_COINS;
}

async function build(now, before) {
  const users = await User.find({ casinoApproved: true }).select("username coins coinReset").lean();
  const placeBefore = new Map(((before && before.rows) || []).map((row) => [row.username, row.rank]));
  const rows = users
    .map((user) => ({ username: user.username, coins: balance(user) }))
    .sort((a, b) => b.coins - a.coins || a.username.localeCompare(b.username))
    .map((row, index) => ({ ...row, rank: index + 1, before: placeBefore.has(row.username) ? placeBefore.get(row.username) : null }));
  return { at: now, rows: rows };
}

async function load() {
  const row = await Setting.findOne({ key: KEY }).lean();
  try {
    return row && typeof row.value === "string" ? JSON.parse(row.value) : null;
  } catch (error) {
    return null;
  }
}

// Today's leaderboard (made now if it is from an earlier day)
async function get(now = Date.now()) {
  let board = await load();
  if (board == null || board.at < days.dayStart(now)) {
    board = await build(now, board);
    await Setting.updateOne({ key: KEY }, { $set: { value: JSON.stringify(board) } }, { upsert: true });
  }
  return board;
}

// What a page shows: the top players, the own place, when the next update comes
async function view(username, now = Date.now()) {
  const board = await get(now);
  return {
    updatedAt: board.at,
    nextIn: days.nextDay(now) - now,
    players: board.rows.length,
    rows: board.rows.slice(0, SIZE),
    me: board.rows.find((row) => row.username === username) || null,
  };
}

module.exports = { get, view, build };
