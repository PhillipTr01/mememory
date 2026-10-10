const User = require("../models/User");
const Setting = require("../models/Setting");
const coins = require("./coins");
const days = require("./days");
const seasons = require("./seasons");
const { place } = require("./places");

/*
 * The leaderboards of the casino - one per world (game/worlds.js):
 *
 * The normal casino: the approved players by their 🪙, live - every look
 * shows the coins right now, the arrows show the change since midnight.
 *
 * The season world: who joined the running season by its coins - updated as
 * often as the season says (every few minutes, hours, once a day - or live
 * as well); the arrows show the change since the update before.
 *
 * A snapshot is kept for the arrows (and for the places between the updates).
 */
const KEY = "leaderboard";
const SIZE = 100;
const keyOf = (season) => (season ? seasons.BOARD_KEY : KEY);

async function build(now, before, season) {
  const placeBefore = new Map(((before && before.rows) || []).map((row) => [row.username, row.rank]));
  let rows;
  if (season) {
    rows = await placed(season, (await seasons.standings()).map((row) => ({ username: row.username, coins: row.coins })));
  } else {
    const users = await User.find({ casinoApproved: true }).select("username coins coinReset").lean();
    rows = place(users.map((user) => ({ username: user.username, coins: coins.balanceOf(user) })));
  }
  return { at: now, rows: rows.map((row) => ({ ...row, before: placeBefore.has(row.username) ? placeBefore.get(row.username) : null })) };
}

// The places of a season: the same coins, the same place - every player with the second chances
// and coins wagered (shown on the board; the same coins go by them)
async function placed(season, rows) {
  const stats = await seasons.tieStats(season);
  // (who hasn't wagered enough yet: on the board, after the places - without a place)
  return place(
    rows.map((row) => ({ ...row, ...stats(row.username) })),
    { prizes: seasons.prizesOf(season), stats: stats, need: () => seasons.wagerNeed(season) },
  );
}

async function load(season) {
  const row = await Setting.findOne({ key: keyOf(season) }).lean();
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

// The snapshot (made anew when it is time - or another season)
async function snapshot(now, season, every) {
  let board = await load(season);
  const seasonId = season ? season.id : null;
  const same = board != null && (board.season || null) === seasonId;
  if (!same || now >= (board.next || 0)) {
    board = { ...(await build(now, same ? board : null, season)), season: seasonId, next: nextUpdate(now, every) };
    await Setting.updateOne({ key: keyOf(season) }, { $set: { value: JSON.stringify(board) } }, { upsert: true });
  }
  return board;
}

// A player joins the season: on its board right away (with the start coins) - the
// others stay as they were at the last update
let adding = Promise.resolve();
seasons.changes.on("joined", (username) => {
  adding = adding
    .then(async () => {
      const season = seasons.running();
      const board = await load(season);
      if (!season || board == null || board.season !== season.id || board.rows.some((row) => row.username === username)) return;
      const user = await User.findOne({ username: username }).select("username seasonCoins seasonReset").lean();
      if (user == null) return;
      const before = new Map(board.rows.map((row) => [row.username, row.before]));
      const rows = (await placed(season, [...board.rows.map((row) => ({ username: row.username, coins: row.coins })), { username: username, coins: coins.season.balanceOf(user) }])).map((row) => ({ ...row, before: before.has(row.username) ? before.get(row.username) : null }));
      await Setting.updateOne({ key: keyOf(season) }, { $set: { value: JSON.stringify({ ...board, rows: rows }) } }, { upsert: true });
    })
    .catch((error) => console.error("[leaderboard] Could not add a player:", error));
});

// The leaderboard of a world: {at, rows, live, next} - season: true for the running season's
async function get(now = Date.now(), world = "") {
  await seasons.tick(now);
  const season = world === seasons.SEASON_WORLD ? seasons.running() : null;
  const every = season ? season.every : 0;
  // Live: the snapshot only for the arrows (once a day)
  const board = await snapshot(now, season, every === 0 ? 1440 : every);
  if (every === 0) return { ...(await build(now, board, season)), live: true, next: null };
  return { at: board.at, rows: board.rows, live: false, next: board.next };
}

// What a page shows: the leaderboard of the player's world - the top players, the own place, the
// season (in the season world), when the next update comes
async function view(username, now = Date.now()) {
  const world = seasons.inSeasonWorld(username) ? seasons.SEASON_WORLD : "";
  const board = await get(now, world);
  const season = world ? seasons.running() : null;
  const ended = seasons.lastEnded();
  return {
    updatedAt: board.at,
    live: board.live,
    nextIn: board.next == null ? null : Math.max(0, board.next - now),
    players: board.rows.length,
    // (a season: who has a place already - the others still have to wager)
    counted: board.rows.filter((row) => row.rank != null).length,
    rows: board.rows.slice(0, SIZE),
    me: board.rows.find((row) => row.username === username) || null,
    season: season ? seasons.publicSeason(season) : null,
    world: world ? "season" : "normal",
    // The last season that is over (the winner page)
    lastSeason: ended ? { id: ended.id, name: ended.name, icon: ended.icon, endedAt: ended.endedAt } : null,
  };
}

// The winner page of a season that is over
function final(id, username) {
  const season = seasons.byId(id);
  if (season == null || !season.ended || !season.final) return null;
  // (only the place, the coins and the prize - the stats of the players are for the admin panel)
  const pub = (row) => row && { rank: row.rank, username: row.username, coins: row.coins, chances: row.chances, wagered: row.wagered, ...(row.prize ? { prize: row.prize } : {}), ...(row.decided ? { decided: row.decided } : {}), ...(row.wager ? { wager: row.wager } : {}), ...(row.pending ? { pending: true } : {}) };
  return {
    season: seasons.publicSeason(season),
    rows: season.final.rows.slice(0, SIZE).map(pub),
    players: season.final.rows.length,
    me: pub(season.final.rows.find((row) => row.username === username)) || null,
  };
}

module.exports = { get, view, final, build };
