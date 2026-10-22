const User = require("../models/User");
const Setting = require("../models/Setting");
const coins = require("./coins");
const days = require("./days");
const seasons = require("./seasons");
const { place } = require("./places");
const slots = require("./season_slots");
const config = require("./config");

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
// (a season: the board of its slot)
const keyOf = (season) => (season ? seasons.boardKey(season) : KEY);

async function build(now, before, season) {
  const placeBefore = new Map(((before && before.rows) || []).map((row) => [row.username, row.rank]));
  let rows;
  if (season) {
    rows = await placed(season, (await seasons.standings(season)).map((row) => ({ username: row.username, coins: row.coins })));
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
    { prizes: seasons.prizesOf(season), stats: stats, need: (username) => seasons.wagerNeed(season, stats(username).chanceBonus) },
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
seasons.changes.on("joined", (username, joined) => {
  adding = adding
    .then(async () => {
      const season = joined ? seasons.running(joined.id) : null;
      if (!season) return;
      const board = await load(season);
      if (board == null || board.season !== season.id || board.rows.some((row) => row.username === username)) return;
      const wallet = coins.wallet(season.slot);
      const user = await User.findOne({ username: username }).select(["username", wallet.fields.coins, wallet.fields.reset].join(" ")).lean();
      if (user == null) return;
      const before = new Map(board.rows.map((row) => [row.username, row.before]));
      const rows = (await placed(season, [...board.rows.map((row) => ({ username: row.username, coins: row.coins })), { username: username, coins: require("./season_kit").boardOf(season) ? 0 : wallet.balanceOf(user) }])).map((row) => ({ ...row, before: before.has(row.username) ? before.get(row.username) : null }));
      await Setting.updateOne({ key: keyOf(season) }, { $set: { value: JSON.stringify({ ...board, rows: rows }) } }, { upsert: true });
    })
    .catch((error) => console.error("[leaderboard] Could not add a player:", error));
});

// The leaderboard of a world: {at, rows, live, next} - a season world ("/season", "/season2"): its season's
async function get(now = Date.now(), world = "") {
  await seasons.tick(now);
  const season = slots.isSeason(world) ? seasons.running(world) : null;
  const every = season ? season.every : 0;
  // Live: the snapshot only for the arrows (once a day)
  const board = await snapshot(now, season, every === 0 ? 1440 : every);
  if (every === 0) return { ...(await build(now, board, season)), live: true, next: null };
  return { at: board.at, rows: board.rows, live: false, next: board.next };
}

// What a page shows: the leaderboard of the player's world - the top players, the own place, the
// season (in a season world), when the next update comes. which: another board - "normal" or a running
// season the player may see (its id or slot); nothing: the player's world
async function view(username, now = Date.now(), which = null) {
  let world = seasons.worldOf(username) || "";
  // (in a season world: only its own board - the other boards only from the normal casino)
  const inSeason = world !== "";
  if (inSeason) which = null;
  if (which === "normal") world = "";
  else if (which != null && which !== "") {
    const other = seasons.running(which);
    if (other && seasons.allowed(other, username)) world = seasons.slotOf(other).world;
  }
  const board = await get(now, world);
  const season = world ? seasons.running(world) : null;
  const ended = seasons.lastEnded();
  // (a board updated only now and then: the own row always right now - coins, wager, place among everybody now)
  let me = board.rows.find((row) => row.username === username) || null;
  if (!board.live && season && seasons.joined(username, season.id)) {
    const fresh = await build(now, board, season);
    const live = fresh.rows.find((row) => row.username === username);
    if (live) me = { ...live, live: true, counted: fresh.rows.filter((row) => row.rank != null).length };
  }
  return {
    updatedAt: board.at,
    live: board.live,
    nextIn: board.next == null ? null : Math.max(0, board.next - now),
    players: board.rows.length,
    // (a season: who has a place already - the others still have to wager)
    counted: board.rows.filter((row) => row.rank != null).length,
    rows: board.rows.slice(0, SIZE),
    me: me,
    season: season ? seasons.publicSeason(season) : null,
    world: season ? season.slot : "normal",
    // (the other boards to switch to: the running seasons the player may see)
    boards: inSeason ? [] : seasons.runningAll().filter((s) => seasons.allowed(s, username)).map((s) => ({ id: s.id, slot: s.slot, name: s.name, icon: s.icon })),
    // The last season that is over (the winner page)
    lastSeason: ended ? { id: ended.id, name: ended.name, icon: ended.icon, endedAt: ended.endedAt } : null,
    // Every season that is over (the newest first, the ones the player could see): their winner pages
    // (only in the normal casino, PAST_SEASON_DAYS after the end)
    pastSeasons: (inSeason ? [] : seasons.list())
      .filter((s) => s.status === "ended" && s.players > 0 && now - (s.endedAt || s.end) <= config.PAST_SEASON_DAYS * 86400 * 1000 && seasons.allowed(seasons.byId(s.id), username))
      .sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))
      .slice(0, 20)
      .map((s) => ({ id: s.id, name: s.name, icon: s.icon, endedAt: s.endedAt, players: s.players, winner: s.winner ? { username: s.winner.username, coins: s.winner.coins } : null })),
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
