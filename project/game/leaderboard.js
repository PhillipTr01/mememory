const User = require("../models/User");
const Setting = require("../models/Setting");
const coins = require("./coins");
const days = require("./days");
const seasons = require("./seasons");

/*
 * The leaderboard of the casino: the approved players by their coins.
 *
 * No season running: live - every look shows the coins right now, the arrows
 * show the change since midnight. A season running: updated as often as the
 * season says (every few minutes, hours, once a day - or live as well); the
 * arrows show the change since the update before.
 *
 * A snapshot is kept for the arrows (and for the places between the updates).
 */
const KEY = "leaderboard";
const SIZE = 100;

async function build(now, before) {
  // (in a season: only who hit "Start")
  const users = (await User.find({ casinoApproved: true }).select("username coins coinReset").lean()).filter((user) => seasons.joined(user.username) !== false);
  const placeBefore = new Map(((before && before.rows) || []).map((row) => [row.username, row.rank]));
  const rows = users
    .map((user) => ({ username: user.username, coins: coins.balanceOf(user) }))
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

// When the snapshot is made next: `every` minutes later (1440: at midnight)
function nextUpdate(now, every) {
  return every >= 1440 || every <= 0 ? days.nextDay(now) : now + every * 60 * 1000;
}

// The snapshot (made anew when it is time - or a season started / ended)
async function snapshot(now, seasonId, every) {
  let board = await load();
  const same = board != null && (board.season || null) === seasonId;
  if (!same || now >= (board.next || 0)) {
    board = { ...(await build(now, same ? board : null)), season: seasonId, next: nextUpdate(now, every) };
    await Setting.updateOne({ key: KEY }, { $set: { value: JSON.stringify(board) } }, { upsert: true });
  }
  return board;
}

// A player hits "Start" in the season: on the board right away (with the start coins) - the
// others stay as they were at the last update
let adding = Promise.resolve();
seasons.changes.on("joined", (username) => {
  adding = adding
    .then(async () => {
      const season = seasons.running();
      const board = await load();
      if (!season || board == null || board.season !== season.id || board.rows.some((row) => row.username === username)) return;
      const user = await User.findOne({ username: username }).select("username coins coinReset").lean();
      if (user == null) return;
      const rows = [...board.rows, { username: username, coins: coins.balanceOf(user), before: null }]
        .sort((a, b) => b.coins - a.coins || a.username.localeCompare(b.username))
        .map((row, index) => ({ ...row, rank: index + 1 }));
      await Setting.updateOne({ key: KEY }, { $set: { value: JSON.stringify({ ...board, rows: rows }) } }, { upsert: true });
    })
    .catch((error) => console.error("[leaderboard] Could not add a player:", error));
});

// Today's / this update's leaderboard: {at, rows, live, next}
async function get(now = Date.now()) {
  await seasons.tick(now);
  const season = seasons.running();
  const every = season ? season.every : 0;
  // Live: the snapshot only for the arrows (once a day)
  const board = await snapshot(now, season ? season.id : null, every === 0 ? 1440 : every);
  if (every === 0) return { ...(await build(now, board)), live: true, next: null };
  return { at: board.at, rows: board.rows, live: false, next: board.next };
}

// What a page shows: the top players, the own place, the season, when the next update comes
async function view(username, now = Date.now()) {
  const board = await get(now);
  const season = seasons.running();
  const ended = seasons.lastEnded();
  return {
    updatedAt: board.at,
    live: board.live,
    nextIn: board.next == null ? null : Math.max(0, board.next - now),
    players: board.rows.length,
    rows: board.rows.slice(0, SIZE),
    me: board.rows.find((row) => row.username === username) || null,
    season: season ? seasons.publicSeason(season) : null,
    // The last season that is over (the winner page)
    lastSeason: ended ? { id: ended.id, name: ended.name, icon: ended.icon, endedAt: ended.endedAt } : null,
  };
}

// The winner page of a season that is over
function final(id, username) {
  const season = seasons.byId(id);
  if (season == null || !season.ended || !season.final) return null;
  // (only the place, the coins and the prize - the stats of the players are for the admin panel)
  const pub = (row) => row && { rank: row.rank, username: row.username, coins: row.coins, ...(row.prize ? { prize: row.prize } : {}) };
  return {
    season: seasons.publicSeason(season),
    rows: season.final.rows.slice(0, SIZE).map(pub),
    players: season.final.rows.length,
    me: pub(season.final.rows.find((row) => row.username === username)) || null,
  };
}

module.exports = { get, view, final, build };
