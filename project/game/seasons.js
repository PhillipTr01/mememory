const EventEmitter = require("events");
const User = require("../models/User");
const Setting = require("../models/Setting");
const CoinLog = require("../models/CoinLog");
const coins = require("./coins");
const config = require("./config");
const days = require("./days");
const inPlay = require("./in_play").season;
const casinoLock = require("./casino_lock").season;
const persist = require("./persist");
const { place } = require("./places");

/*
 * Seasons (admin panel): planned ahead from a start to an end. A season is a
 * world of its own (game/worlds.js "/season"), next to the normal casino -
 * like another tenant: its own coins (user.seasonCoins), its own games, its
 * own leaderboard. Only the chat is the same. The normal casino goes on as
 * it is, nothing of it changes.
 *
 * At the start (after a short countdown) the season world opens - its games
 * start anew. Every player gets asked to join (or later: the season pill at
 * the top, the profile menu); joining gives the budget (and the daily
 * bonuses missed since the start) and switches to the season world. A
 * player who joined can switch between the worlds at any time.
 *
 * Only one season at a time. A season can be open for everybody (default),
 * only for the players on its whitelist - or for everybody but the ones on
 * its banlist: who can't play in it doesn't see it.
 *
 * Before the end the season world closes (game/casino_lock.js): no new bets,
 * running rounds go to their end - when every game of it is quiet (or after
 * SEASON_CLOSE_MAX), the countdown - then the final places are kept (with the
 * prizes, if the season has any, on the winner page) and the coins of the
 * season go to the normal wallet of every player.
 *
 * Second chances: a season can give a player who lost everything (0 coins,
 * nothing in play anywhere) a few new starts with the budget. The first one
 * right away, every further one after the delay of the season (chanceDelay:
 * hours - not set: from the next day on).
 *
 * A planned season can be highlighted: the pill at the top shows when it
 * starts (and everything about it on a click).
 *
 * changes: "closing" (info, again when the countdown starts), "started" (season), "ended" (season),
 * "joined" (username), "world" (username, world: "/season" or "")
 */
const KEY = "seasons";
// The coin of a season that has none of its own (the 🪙 is the money outside seasons)
const SEASON_COIN = "💎";
const BACKUP = "seasonGames:"; // + id: the games from before the season (old seasons, see migrate)
// Who may play in a season: everybody - only the whitelist - everybody but the banlist
const ACCESS = ["all", "whitelist", "banlist"];
const SEASON_WORLD = "/season";
// The leaderboard of the running season (game/leaderboard.js keeps it there)
const BOARD_KEY = "leaderboard:season";
// How often the leaderboard of a season is updated (minutes; 0: all the time, 1440: once a day at midnight)
const INTERVALS = [0, 5, 15, 60, 360, 1440];
const MAX_PRIZES = 20;
const TICK = 10 * 1000;

const changes = new EventEmitter();
changes.setMaxListeners(0);

let state = { seasons: [], base: null, next: 1 };
let loaded = false;
let timer = null;

function status(season) {
  if (season.ended) return "ended";
  if (season.started) return "running";
  return "planned";
}

// The winner for the pages: the place, the name, the coins, the prize (not the stats)
const winnerOf = (row) => ({ rank: row.rank, username: row.username, coins: row.coins, ...(row.prize ? { prize: row.prize } : {}) });

// For the admin panel and the pages
function publicSeason(season) {
  return {
    id: season.id,
    name: season.name,
    icon: season.icon,
    coinIcon: season.coinIcon || SEASON_COIN,
    start: season.start,
    end: season.end,
    budget: season.budget,
    dailyBonus: Number.isInteger(season.dailyBonus) ? season.dailyBonus : null,
    secondChances: season.secondChances || 0,
    chanceDelay: chanceDelayOf(season),
    closeWait: closeWaitOf(season) / 1000,
    every: season.every,
    color: season.color || null,
    prizesOn: season.prizesOn,
    // (with what each one is as one line - label)
    prizes: (season.prizes || []).map((p) => ({ place: p.place, prize: p.prize || "", coins: p.coins || 0, items: p.items || [], label: prizeText(p) })),
    wagerX: wagerXOf(season),
    highlight: season.highlight === true,
    access: accessOf(season),
    status: state.closing && state.closing.id === season.id && closingKind() === "start" ? "starting" : status(season),
    endedAt: season.endedAt || null,
    players: season.final ? season.final.rows.length : Object.keys(season.joined || {}).length,
    winner: season.final && season.final.rows.length && season.final.rows[0].rank === 1 ? winnerOf(season.final.rows[0]) : null,
  };
}

// Who may play in it: {mode: "all" | "whitelist" | "banlist", names: [...]}
function accessOf(season) {
  const access = season && season.access;
  return { mode: access && ACCESS.includes(access.mode) ? access.mode : "all", names: access && Array.isArray(access.names) ? access.names : [] };
}

// May the player play in (and see) the season?
function allowed(season, username) {
  if (season == null) return false;
  const access = accessOf(season);
  const listed = access.names.some((name) => name.toLowerCase() === String(username).toLowerCase());
  if (access.mode === "whitelist") return listed;
  if (access.mode === "banlist") return !listed;
  return true;
}

// To get a place: wager this many times the start budget - again for every second chance
function wagerXOf(season) {
  return Number.isInteger(season.wagerX) ? season.wagerX : config.SEASON_WAGER_X;
}

// The coins a player has to wager to get a place on the season's leaderboard - per chance: the start
// and every second chance need it again (counted from that chance on)
function wagerNeed(season) {
  return wagerXOf(season) * season.budget;
}

// When the player's current chance began (the last second chance - 0: the start)
function chanceStart(season, username) {
  const record = season.chances && season.chances[username];
  return record && record.used > 0 && record.lastAt ? record.lastAt : 0;
}

function list() {
  return state.seasons
    .slice()
    .sort((a, b) => b.start - a.start)
    .map(publicSeason);
}

const byId = (id) => state.seasons.find((season) => season.id === Number(id));
const running = () => state.seasons.find((season) => season.started && !season.ended) || null;

// The last season that is over (for the winner page)
function lastEnded() {
  return state.seasons.filter((season) => season.ended && season.final).sort((a, b) => b.endedAt - a.endedAt)[0] || null;
}

async function save() {
  await Setting.updateOne({ key: KEY }, { $set: { value: JSON.stringify(state) } }, { upsert: true });
}

// The server starts: the seasons as they were (and the coins of the season that started last)
async function load() {
  const row = await Setting.findOne({ key: KEY }).lean();
  try {
    if (row && typeof row.value === "string") state = { seasons: [], base: null, next: 1, ...JSON.parse(row.value) };
  } catch (error) {
    console.error("[seasons] Could not read the seasons:", error);
  }
  await migrate();
  coins.setBase(state.base);
  // (the server stopped while the season world was closing for the end: closed again)
  if (state.closing && closingKind() === "end") casinoLock.lock("end");
  loaded = true;
}

/*
 * A season that started before the worlds were apart: the whole casino was the
 * season then (user.coins: the season's coins, season.saved: the normal ones,
 * the games of before in a backup). Now: the season's coins and games go to
 * the season world, the normal ones come back - who joined plays on in the
 * season world.
 */
async function migrate() {
  const season = running();
  if (season == null || season.world === true || season.saved == null) return;
  const era = state.base && state.base.reset;
  const saved = season.saved || {};
  const normalStart = season.baseBefore ? season.baseBefore.start : config.START_COINS;
  const users = await User.find({ casinoApproved: true }).select("username coins coinReset coinBonusAt").lean();
  for (const user of users) {
    const inIt = season.joined == null || !!(season.joined && season.joined[user.username]);
    const seasonCoins = inIt && user.coinReset === era ? user.coins || 0 : 0;
    const normal = user.username in saved ? saved[user.username] : normalStart;
    await User.updateOne(
      { username: user.username },
      { $set: { seasonCoins: seasonCoins, seasonReset: era, ...(user.coinBonusAt ? { seasonBonusAt: user.coinBonusAt } : {}), coins: normal, coinReset: config.COIN_RESET }, $unset: { coinBonusAt: 1 } },
    );
  }
  // The games: the ones of the season to the season world, the ones from before back
  const backup = await Setting.findOne({ key: BACKUP + season.id }).lean();
  let before = {};
  try {
    before = backup && typeof backup.value === "string" ? JSON.parse(backup.value) || {} : {};
  } catch (error) {
    before = {};
  }
  const rows = await Setting.find({ key: { $regex: "^game:" } }).lean();
  for (const row of rows) {
    const key = row.key.slice("game:".length);
    if (key === "chat" || key.startsWith("season/")) continue;
    await Setting.updateOne({ key: "game:season/" + key }, { $set: { value: row.value } }, { upsert: true });
    if (typeof before[key] === "string") await Setting.updateOne({ key: row.key }, { $set: { value: before[key] } }, { upsert: true });
    else await Setting.deleteMany({ key: { $in: [row.key] } });
  }
  await Setting.deleteMany({ key: { $in: [BACKUP + season.id] } });
  // Who joined plays on in the season world
  season.here = Object.fromEntries(Object.keys(season.joined || {}).map((name) => [name, true]));
  season.world = true;
  delete season.saved;
  delete season.baseBefore;
  if (state.base) state.base.active = true;
  await save();
  console.log(`[seasons] "${season.name}" moved to the season world (${users.length} players).`);
}

// How long the countdown before the start and the end runs (ms): the season's own - or the setting
// The wait between two second chances: hours (0: right away) - null: from the next day on
function chanceDelayOf(season) {
  return Number.isInteger(season.chanceDelay) ? season.chanceDelay : null;
}

function closeWaitOf(season) {
  return Number.isInteger(season.closeWait) ? season.closeWait * 1000 : config.SEASON_CLOSE_WAIT;
}

// What the casino closes for: "start" (a season starts) or "end" (the running one ends)
function closingKind() {
  return state.closing ? state.closing.kind || "start" : null;
}

// The casino closes for a season: {id, name, icon, kind, startsIn (ms until it starts / ends, null: the games are still finishing)}
function closingInfo(now = Date.now()) {
  const closing = state.closing;
  const season = closing && byId(closing.id);
  if (!season) return null;
  return { id: season.id, name: season.name, icon: season.icon, color: season.color || null, kind: closingKind(), startsIn: closing.startsAt == null ? null : Math.max(0, closing.startsAt - now) };
}

// The casino closes for the start or the end of a season: true when it is time (every game was
// quiet - or waited long enough - and then SEASON_CLOSE_WAIT); the casino opens again after it
async function closeFor(season, kind, now) {
  if (!state.closing || state.closing.id !== season.id || closingKind() !== kind) {
    // The start: only the countdown (the normal casino goes on) - the end: the season world closes first
    state.closing = { id: season.id, kind: kind, since: now, startsAt: kind === "start" ? now + closeWaitOf(season) : null };
    if (kind === "end") casinoLock.lock("end");
    await save();
    changes.emit("closing", closingInfo(now));
    if (kind === "start") soon(closeWaitOf(season) + 100);
  }
  // Every game of the season world quiet (or waited long enough): the countdown
  if (state.closing.startsAt == null && (casinoLock.busyGames().length === 0 || now - state.closing.since >= config.SEASON_CLOSE_MAX)) {
    state.closing.startsAt = now + closeWaitOf(season);
    await save();
    changes.emit("closing", closingInfo(now));
    soon(closeWaitOf(season) + 100);
  }
  if (state.closing.startsAt != null && now >= state.closing.startsAt) {
    state.closing = null;
    return true;
  }
  if (state.closing.startsAt == null) soon(2000);
  return false;
}

// The casino was closing for something that is off now (the end moved later): open again
async function stopClosing() {
  state.closing = null;
  casinoLock.unlock("end");
  await save();
  changes.emit("closing", null);
}

// While closing: look again soon (not only every TICK)
function soon(ms) {
  if (!timer) return;
  setTimeout(() => tick(), ms).unref();
}

/* ---------- Checking what the admin entered ---------- */

function check(input, current) {
  if (input == null || typeof input !== "object") return { error: "No season." };
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 1 || name.length > 40) return { error: "A name, up to 40 characters." };
  const icon = typeof input.icon === "string" ? input.icon.trim() : "";
  if (icon.length < 1 || [...icon].length > 4) return { error: "An icon (one emoji)." };
  // The coins of the season: never the 🪙 (that is the money outside seasons) - not given: 💎
  const coinIcon = typeof input.coinIcon === "string" && input.coinIcon.trim() ? input.coinIcon.trim() : SEASON_COIN;
  if (coinIcon === "🪙") return { error: "The 🪙 is the money outside seasons - pick another coin for the season." };
  if ([...coinIcon].length > 4 || /[<>&"'\s]/.test(coinIcon)) return { error: "A coin icon (one emoji)." };
  const start = Number(input.start);
  const end = Number(input.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { error: "A start and an end." };
  if (end <= start) return { error: "The end comes after the start." };
  const budget = Number(input.budget);
  if (!Number.isInteger(budget) || budget < 0 || budget > 1000000000) return { error: "A start budget from 0 to 1,000,000,000." };
  // (not given: the daily bonus of seasons in the settings)
  const dailyBonus = input.dailyBonus == null || input.dailyBonus === "" ? config.SEASON_DAILY_BONUS : Number(input.dailyBonus);
  if (!Number.isInteger(dailyBonus) || dailyBonus < 0 || dailyBonus > 10000000) return { error: "A daily bonus from 0 to 10,000,000." };
  // The accent color of the season (null: the gold of the casino)
  const color = input.color == null || input.color === "" ? null : String(input.color).toLowerCase();
  if (color != null && !/^#[0-9a-f]{6}$/.test(color)) return { error: "A color like #d4a64a." };
  const secondChances = input.secondChances == null || input.secondChances === "" ? 0 : Number(input.secondChances);
  if (!Number.isInteger(secondChances) || secondChances < 0 || secondChances > 20) return { error: "Second chances: 0 to 20." };
  // The wait between two second chances (hours; not given: from the next day on)
  const chanceDelay = input.chanceDelay == null || input.chanceDelay === "" ? null : Number(input.chanceDelay);
  if (chanceDelay != null && (!Number.isInteger(chanceDelay) || chanceDelay < 0 || chanceDelay > 168)) return { error: "The wait between second chances: 0 to 168 hours." };
  // The countdown before the start and the end (seconds; not given: the setting, 1 minute)
  const closeWait = input.closeWait == null || input.closeWait === "" ? null : Number(input.closeWait);
  if (closeWait != null && (!Number.isInteger(closeWait) || closeWait < 0 || closeWait > 3600)) return { error: "The countdown: 0 to 3600 seconds." };
  const every = Number(input.every);
  if (!INTERVALS.includes(every)) return { error: "Unknown update interval." };
  const prizesOn = input.prizesOn === true;
  const prizes = Array.isArray(input.prizes) ? input.prizes : [];
  if (prizes.length > MAX_PRIZES) return { error: `At most ${MAX_PRIZES} prizes.` };
  const clean = [];
  // A prize like a reward (admin panel): a prize of your own (text), coins and / or items - see shop.checkGift
  for (const prize of prizes) {
    const place = Number(prize && prize.place);
    if (!Number.isInteger(place) || place < 1 || place > 1000) return { error: "A prize needs a place (1 or more)." };
    if (clean.some((p) => p.place === place)) return { error: `Place ${place} has two prizes.` };
    const gift = require("./shop").checkGift(prize, `The prize for place ${place}`);
    if (gift.error) return gift;
    clean.push({ place: place, prize: gift.prize, coins: gift.coins, items: gift.items });
  }
  clean.sort((a, b) => a.place - b.place);
  if (prizesOn && clean.length === 0) return { error: "Prizes are on - add at least one." };
  // Who may play: everybody (default) - the whitelist only - everybody but the banlist
  const accessMode = input.accessMode == null || input.accessMode === "" ? "all" : String(input.accessMode);
  if (!ACCESS.includes(accessMode)) return { error: "Unknown access (everybody, whitelist or banlist)." };
  const rawNames = Array.isArray(input.accessNames) ? input.accessNames : String(input.accessNames || "").split(/[\s,;]+/);
  const accessNames = [...new Set(rawNames.map((name) => String(name).trim()).filter(Boolean))];
  if (accessNames.length > 500) return { error: "At most 500 names on the list." };
  if (accessNames.some((name) => name.length > 40)) return { error: "A name on the list is too long." };
  if (accessMode === "whitelist" && accessNames.length === 0) return { error: "The whitelist is on - add at least one player." };
  const highlight = input.highlight === true;
  // To get a place: wager this many times the start budget (not given: the setting, 3x)
  const wagerX = input.wagerX == null || input.wagerX === "" ? config.SEASON_WAGER_X : Number(input.wagerX);
  if (!Number.isInteger(wagerX) || wagerX < 0 || wagerX > 1000) return { error: "Wager to get a place: 0 to 1000 times the start budget." };

  // A running season: the start and the budget are given (they happened already)
  if (current && current.started) {
    if (start !== current.start || budget !== current.budget) return { error: "The season runs already: start and budget can't change." };
    if (end <= Date.now()) return { error: "The end has to be in the future (or end it now)." };
  } else if (end <= Date.now()) {
    return { error: "The end has to be in the future." };
  }
  // Never two seasons at the same time
  const other = state.seasons.find((season) => season !== current && !season.ended && season.start < end && start < season.end);
  if (other) return { error: `It overlaps with "${other.name}".` };
  return { season: { name: name, icon: icon, coinIcon: coinIcon, start: start, end: end, budget: budget, dailyBonus: dailyBonus, secondChances: secondChances, chanceDelay: chanceDelay, closeWait: closeWait, color: color, every: every, prizesOn: prizesOn, prizes: clean, access: { mode: accessMode, names: accessNames }, highlight: highlight, wagerX: wagerX } };
}

async function create(input) {
  const result = check(input, null);
  if (result.error) return result;
  const season = { id: state.next++, ...result.season, started: false, ended: false };
  state.seasons.push(season);
  await save();
  await tick();
  return { season: publicSeason(season) };
}

async function update(id, input) {
  const season = byId(id);
  if (season == null) return { error: "No such season." };
  if (season.ended) return { error: "The season is over." };
  const result = check(input, season);
  if (result.error) return result;
  Object.assign(season, result.season);
  // The running season: its daily bonus counts right away
  if (status(season) === "running" && state.base) {
    state.base.bonus = season.dailyBonus;
    coins.setBase(state.base);
  }
  await save();
  await tick();
  return { season: publicSeason(season) };
}

async function remove(id) {
  const season = byId(id);
  if (season == null) return { error: "No such season." };
  if (status(season) === "running") return { error: "The season runs - end it first." };
  state.seasons.splice(state.seasons.indexOf(season), 1);
  if (state.closing && state.closing.id === season.id) {
    state.closing = null;
    casinoLock.unlock();
    changes.emit("closing", null);
  }
  await save();
  return { ok: true };
}

/* ---------- Start and end ---------- */

// The season world opens: its games start anew, everybody may join (the budget comes with joining)
async function startSeason(season, now) {
  season.started = true;
  season.startedAt = now;
  season.joined = {};
  season.here = {};
  season.world = true;
  state.base = { reset: "season-" + season.id, start: 0, budget: season.budget, join: true, since: now, active: true, bonus: Number.isInteger(season.dailyBonus) ? season.dailyBonus : null };
  coins.setBase(state.base);
  await save();
  await persist.resetPrefix("season/");
  await Setting.deleteMany({ key: { $in: [BOARD_KEY] } });
  changes.emit("started", publicSeason(season));
}

// What joining gives now: the budget and a daily bonus for every day since the start - {coins, missed}
function joinCoins(now = Date.now()) {
  const season = running();
  if (season == null) return null;
  const missed = Math.max(0, days.dayNumber(now) - days.dayNumber(season.startedAt || season.start));
  return { coins: season.budget + missed * coins.season.dailyBonus(), missed: missed };
}

// The player joins the season: the budget (and a daily bonus for every day missed since the start -
// today's one they claim themselves) - and the season world. {coins, missed} or {error}
async function join(username, now = Date.now()) {
  const season = running();
  if (season == null) return { error: "No season runs." };
  if (!allowed(season, username)) return { error: "This season is closed - you're not on its list." };
  season.joined = season.joined || {};
  if (season.joined[username]) return { error: "You are in the season already." };
  const user = await User.findOne({ username: username }).select("username casinoApproved").lean();
  if (user == null || user.casinoApproved !== true) return { error: "Not in the casino." };
  if (season.joined[username]) return { error: "You are in the season already." };
  season.joined[username] = now;
  season.here = season.here || {};
  season.here[username] = true;
  const { coins: amount, missed } = joinCoins(now);
  await save();
  await User.updateOne({ username: username }, { $set: { seasonCoins: amount, seasonReset: state.base.reset }, $unset: { seasonBonusAt: 1 } });
  coins.season.log(username, amount, "season start", missed > 0 ? `${season.name}: ${season.budget.toLocaleString("en-US")} + ${missed} missed daily bonus${missed === 1 ? "" : "es"}` : season.name);
  coins.notify(username);
  changes.emit("joined", username);
  changes.emit("world", username, SEASON_WORLD);
  return { coins: amount, missed: missed };
}

// When the player joined the running season (null: not in it, or no season)
function joinedAt(username) {
  const season = running();
  return season && season.joined && season.joined[username] ? season.joined[username] : null;
}

// In the running season: did the player join it? (null: no season)
function joined(username) {
  const season = running();
  if (season == null) return null;
  // (a season from before joining existed: everybody is in)
  if (season.joined == null) return allowed(season, username);
  return !!season.joined[username] && allowed(season, username);
}
coins.setJoinedLookup(joined);
// (since when the player is in it: the daily bonuses add up from that day on)
coins.setJoinedAtLookup((username) => {
  const season = running();
  if (season == null) return null;
  return (season.joined && season.joined[username]) || season.startedAt || season.start;
});

// The wager for a place of a player right now: {done, need} - read from the season's coin history
coins.setWagerLookup(async (username) => {
  const season = running();
  if (season == null || !wagerXOf(season)) return null;
  const rows = await CoinLog.find({ era: "season-" + season.id, username: username, reason: { $in: BETS } }).lean();
  const from = chanceStart(season, username);
  return { done: rows.filter((row) => new Date(row.at).getTime() >= from).reduce((sum, row) => sum - row.amount, 0), need: wagerNeed(season) };
});

// Plays the player in the season world now? (joined it and switched there)
function inSeasonWorld(username) {
  const season = running();
  return !!(season && season.here && season.here[username] && joined(username));
}

// The player switches the world: "season" (only who joined the running season) or "normal"
async function switchWorld(username, to) {
  const season = running();
  if (to === "season") {
    if (season == null) return { error: "No season runs." };
    if (!joined(username)) return { error: "Join the season first." };
    season.here = season.here || {};
    season.here[username] = true;
  } else if (to === "normal") {
    if (season && season.here) delete season.here[username];
  } else return { error: "Unknown world." };
  await save();
  const world = to === "season" ? SEASON_WORLD : "";
  changes.emit("world", username, world);
  return { world: to };
}

// The season the pill at the top shows to a player: the running one - or a highlighted planned one
function upcoming(username, now = Date.now()) {
  const season = state.seasons
    .filter((s) => !s.started && !s.ended && s.highlight === true && s.end > now && allowed(s, username))
    .sort((a, b) => a.start - b.start)[0];
  return season || null;
}

// The final places (everybody who joined, by coins) - with the prizes; the coins of the season go to the normal wallet
async function endSeason(season, now) {
  // (with the stats: the coin history of the season is gone after it)
  const rows = await withStats(season, await standings());
  // The same coins, the same place - between them: fewer second chances, then more coins wagered
  const byName = new Map(rows.map((row) => [row.username, row]));
  season.final = { at: now, rows: place(rows, { prizes: prizesOf(season), stats: (username) => ({ chances: byName.get(username).chances, wagered: byName.get(username).wagered, chanceWagered: byName.get(username).chanceWagered }), need: () => wagerNeed(season) }) };
  season.ended = true;
  season.endedAt = now;
  const seasonEra = state.base ? state.base.reset : null;
  const players = Object.keys(season.here || {});
  season.here = {};
  state.base = null;
  coins.setBase(null);
  await save();
  // The coins of the season: into the normal wallet
  for (const row of rows) {
    if (row.coins > 0) await coins.add(row.username, row.coins, { reason: "season payout", note: season.name });
  }
  await givePrizes(season, season.final.rows);
  await User.updateMany({ seasonReset: seasonEra }, { $set: { seasonCoins: 0 } });
  // The season world: empty again (its games, its history)
  await persist.resetPrefix("season/");
  if (seasonEra) await CoinLog.deleteMany({ era: seasonEra });
  await Setting.deleteMany({ key: { $in: [BOARD_KEY] } });
  changes.emit("ended", publicSeason(season));
  for (const username of players) changes.emit("world", username, "");
  for (const row of rows) coins.notify(row.username);
}

// Everybody in the season (who joined) by the season's coins: [{rank, username, coins}]
async function standings() {
  const users = await User.find({ casinoApproved: true }).select("username seasonCoins seasonReset").lean();
  return place(users.filter((user) => joined(user.username) === true).map((user) => ({ username: user.username, coins: coins.season.balanceOf(user) })));
}

/* ---------- The leaderboard of a season for the admin panel ---------- */

// The bets and wins of the games (the coin history) - by the start of the reason
const GAMES = [
  ["jackpot", "Jackpot"],
  ["battle", "Case battles"],
  ["poker", "Poker"],
  ["blackjack", "Blackjack"],
  ["slots", "Slots"],
  ["roulette", "Roulette"],
  ["baucua", "Bầu Cua"],
];
const BETS = ["jackpot bet", "battle", "poker buy-in", "poker chips", "blackjack bet", "slots bet", "roulette bet", "baucua bet"];
const WINS = ["jackpot win", "battle win", "blackjack win", "slots win", "roulette win", "baucua win", "game win"];
const gameOf = (reason) => (GAMES.find(([prefix]) => reason.startsWith(prefix)) || [null, null])[1];

// What every player did in the season (from its coin history): {username: {...}}
async function seasonStats(season) {
  const era = "season-" + season.id;
  const rows = await CoinLog.find({ era: era }).lean();
  const stats = {};
  for (const row of rows) {
    const s = (stats[row.username] = stats[row.username] || { bets: 0, wagered: 0, chanceWagered: 0, biggestWin: 0, fromGames: 0, dailyBonuses: 0, lastActive: null, games: {} });
    const at = new Date(row.at).getTime();
    if (s.lastActive == null || at > s.lastActive) s.lastActive = at;
    if (row.reason === "daily bonus") s.dailyBonuses++;
    if (BETS.includes(row.reason)) {
      s.bets++;
      s.wagered += -row.amount;
      // (the wager for a place counts per chance: only since the last second chance)
      if (at >= chanceStart(season, row.username)) s.chanceWagered += -row.amount;
      const game = gameOf(row.reason);
      s.games[game] = (s.games[game] || 0) + 1;
    }
    if (WINS.includes(row.reason)) s.biggestWin = Math.max(s.biggestWin, row.amount);
    // Won or lost in the games: every bet, win, refund and cash-out
    if (gameOf(row.reason) || row.reason === "game win") s.fromGames += row.amount;
  }
  for (const s of Object.values(stats)) {
    const top = Object.entries(s.games).sort((a, b) => b[1] - a[1])[0];
    s.favourite = top ? top[0] : null;
    delete s.games;
  }
  return stats;
}

// What a prize is, as one line: "€25 voucher · 🪙 10,000 · Golden frame" (older seasons: the text only)
function prizeText(prize) {
  const shop = require("./shop");
  const items = (prize.items || []).map((id) => shop.byId(id)).filter(Boolean).map((item) => item.name);
  return [prize.prize || null, prize.coins > 0 ? "🪙 " + prize.coins.toLocaleString("en-US") : null, ...items].filter(Boolean).join(" · ");
}

// The prizes of a season (place -> what it is, as text) - null without
function prizesOf(season) {
  return season && season.prizesOn && season.prizes && season.prizes.length ? new Map(season.prizes.map((p) => [p.place, prizeText(p)])) : null;
}

// The prizes at the end: every placed player with a prize gets it like a reward (items, coins, a prize of their own)
async function givePrizes(season, rows) {
  if (!prizesOf(season)) return;
  const shop = require("./shop");
  for (const row of rows) {
    const prize = row.prize && season.prizes.find((p) => p.place === row.rank);
    if (!prize) continue;
    const gift = { items: (prize.items || []).filter((id) => shop.byId(id)), coins: prize.coins || 0, prize: prize.prize || "" };
    if (!gift.items.length && !gift.coins && !gift.prize) continue;
    try {
      await shop.reward(row.username, gift, { source: season.name, icon: season.icon || "🏆", rank: row.rank, note: null });
    } catch (error) {
      console.error("[seasons] Could not give a prize:", error);
    }
  }
}

// The second chances and coins wagered of the players of the running season (on the leaderboard -
// and the order when players have the same coins): username -> {chances, wagered}. Counted
// at most every 15 s (the coin history is read for it)
let statsCache = { id: null, at: 0, stats: null };
async function tieStats(season, now = Date.now()) {
  if (statsCache.id !== season.id || now - statsCache.at > 15000) statsCache = { id: season.id, at: now, stats: await seasonStats(season) };
  const stats = statsCache.stats;
  const chances = season.chances || {};
  return (username) => ({ chances: (chances[username] && chances[username].used) || 0, wagered: (stats[username] && stats[username].wagered) || 0, chanceWagered: (stats[username] && stats[username].chanceWagered) || 0 });
}

// The leaderboard rows with when they started, the second chances and the stats
async function withStats(season, rows) {
  const stats = await seasonStats(season);
  return rows.map((row) => ({
    ...row,
    joinedAt: (season.joined && season.joined[row.username]) || null,
    chances: (season.chances && season.chances[row.username] && season.chances[row.username].used) || 0,
    ...(stats[row.username] || { bets: 0, wagered: 0, chanceWagered: 0, biggestWin: 0, fromGames: 0, dailyBonuses: 0, lastActive: null, favourite: null }),
  }));
}

// For the admin panel: {status, at, chancesTotal, rows} - running: right now, over: the final places
async function board(id) {
  const season = byId(id);
  if (season == null) return null;
  const result = { status: status(season), chancesTotal: season.secondChances || 0 };
  if (season.ended) return { ...result, at: season.final ? season.final.at : null, rows: season.final ? season.final.rows : [] };
  if (!season.started) return { ...result, at: null, rows: [] };
  const rows = await withStats(season, await standings());
  const byName = new Map(rows.map((row) => [row.username, row]));
  return { ...result, at: Date.now(), rows: place(rows, { prizes: prizesOf(season), stats: (username) => ({ chances: byName.get(username).chances, wagered: byName.get(username).wagered, chanceWagered: byName.get(username).chanceWagered }), need: () => wagerNeed(season) }) };
}

let ticking = null;
// Starts and ends seasons when it is time (one at a time)
function tick(now = Date.now()) {
  if (!loaded) return Promise.resolve();
  ticking = (ticking || Promise.resolve())
    .then(async () => {
      for (const season of state.seasons.slice().sort((a, b) => a.start - b.start)) {
        if (!season.started && !season.ended && season.end <= now) {
          // Missed completely (the server was off): over without having run
          season.started = true;
          season.ended = true;
          season.endedAt = now;
          season.final = { at: now, rows: [] };
          await save();
          continue;
        }
        // The start: first the casino closes - running rounds go to their end, nothing new
        if (!season.started && season.start <= now && !running() && (await closeFor(season, "start", now))) {
          await startSeason(season, now);
        }
        // The end: the same
        if (season.started && !season.ended && season.end <= now && (await closeFor(season, "end", now))) {
          await endSeason(season, now);
          casinoLock.unlock("end");
        }
        // Closing for the end, but the admin moved the end later: open again
        if (state.closing && state.closing.id === season.id && closingKind() === "end" && !season.ended && season.end > now) await stopClosing();
      }
    })
    .catch((error) => console.error("[seasons] Could not start or end a season:", error));
  return ticking;
}

/* ---------- Second chances ---------- */

// A bet just made: in play for this long (until the game has it)
const SPEND_GRACE = 2000;

// {can, left, total, budget, nextAt, reason}: reason "none" (no season / no second chances), "used",
// "cooldown" (nextAt), "coins" (still has coins), "inPlay" (coins in a game)
async function chanceStatus(username, now = Date.now()) {
  const season = running();
  const total = season ? season.secondChances || 0 : 0;
  if (!season || total === 0) return { can: false, reason: "none", left: 0, total: 0 };
  const record = (season.chances && season.chances[username]) || { used: 0, lastAt: null };
  const left = Math.max(0, total - record.used);
  const result = { can: false, left: left, total: total, budget: season.budget, nextAt: null };
  if (joined(username) === false) return { ...result, reason: "notJoined" };
  if (left === 0) return { ...result, reason: "used" };
  // Still coins - or coins in a game (a bet that is not over, or one just made that the game gets now): nothing yet
  // (before the wait: no "out of coins" while a bet still runs)
  if ((await coins.season.get(username)).coins > 0) return { ...result, reason: "coins" };
  if (inPlay.where(username).length || now - coins.lastSpent(username) < SPEND_GRACE) return { ...result, reason: "inPlay" };
  // The first one right away - after a second chance, the next one after the delay (not set: the next day)
  const delay = chanceDelayOf(season);
  const from = record.used === 0 ? null : delay == null ? days.nextDay(record.lastAt) : record.lastAt + delay * 3600 * 1000;
  if (from != null && now < from) return { ...result, reason: "cooldown", nextAt: from };
  return { ...result, can: true, reason: null };
}

// Takes a second chance: the budget again (no missed bonuses) - {coins, left} or {error}
async function useChance(username, now = Date.now()) {
  const status = await chanceStatus(username, now);
  if (!status.can) return { error: status.reason === "cooldown" ? (chanceDelayOf(running()) == null ? "Your next second chance comes tomorrow." : "Your next second chance comes later.") : "No second chance right now.", status: status };
  const season = running();
  season.chances = season.chances || {};
  const record = season.chances[username] || { used: 0, lastAt: null };
  season.chances[username] = { used: record.used + 1, lastAt: now };
  await save();
  await User.updateOne({ username: username }, { $set: { seasonCoins: season.budget, seasonReset: state.base.reset } });
  coins.season.log(username, season.budget, "second chance", season.name);
  coins.notify(username);
  return { coins: season.budget, left: status.left - 1 };
}

// The admin ends the running season right now (the casino closes first, like at the end time)
async function endNow(id, now = Date.now()) {
  const season = byId(id);
  if (season == null || status(season) !== "running") return { error: "The season doesn't run." };
  season.end = Math.min(season.end, now);
  await save();
  await tick(now);
  return { season: publicSeason(season) };
}

function start() {
  if (timer) return;
  timer = setInterval(() => tick(), TICK);
  timer.unref();
  tick();
}

function stop() {
  clearInterval(timer);
  timer = null;
}

// Hard reset (admin panel): every season is gone - planned, running and over (with their winner pages)
async function clear() {
  const ids = state.seasons.map((season) => season.id);
  const wasRunning = running();
  state = { seasons: [], base: null, next: 1 };
  coins.setBase(null);
  casinoLock.unlock("end");
  await Setting.deleteMany({ key: { $in: [KEY, BOARD_KEY, ...ids.map((id) => BACKUP + id)] } });
  if (wasRunning) changes.emit("cleared");
}

// Tests: everything forgotten
function reset() {
  state = { seasons: [], base: null, next: 1 };
  coins.setBase(null);
  casinoLock.unlock("end");
  loaded = true;
}

// The running season's accent color for the casino pages: a <style> (or "")
// The coin icon of the running season for the casino pages (see casino_coin.js) - nothing: the 🪙
// (only in the season world: the normal casino keeps the 🪙 and its gold)
function coinScript(username) {
  const season = running();
  if (!season || !inSeasonWorld(username)) return "";
  const icon = season.coinIcon || SEASON_COIN;
  return `<script>window.CASINO_COIN = ${JSON.stringify(icon).replace(/</g, "\\u003c")};</script>`;
}

function accentStyle(username) {
  const season = running();
  if (!season || !inSeasonWorld(username)) return "";
  const color = season && season.color;
  if (!color || !/^#[0-9a-f]{6}$/.test(color)) return "";
  const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const hover = "#" + rgb.map((v) => Math.round(v * 0.86).toString(16).padStart(2, "0")).join("");
  return `<style>body.jackpot-theme { --mm-accent: ${color}; --mm-accent-rgb: ${rgb.join(", ")}; --mm-accent-hover: ${hover}; }</style>`;
}

module.exports = { wagerNeed, wagerXOf, prizesOf, prizeText, tieStats, board, joinedAt, join, joined, joinCoins, allowed, accessOf, inSeasonWorld, switchWorld, upcoming, closingInfo, closingKind, chanceStatus, useChance, clear, accentStyle, coinScript, INTERVALS, ACCESS, BOARD_KEY, SEASON_WORLD, changes, load, list, create, update, remove, endNow, tick, start, stop, reset, running, lastEnded, byId, publicSeason, standings, status };
