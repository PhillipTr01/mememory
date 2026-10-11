const EventEmitter = require("events");
const User = require("../models/User");
const Setting = require("../models/Setting");
const CoinLog = require("../models/CoinLog");
const coins = require("./coins");
const config = require("./config");
const days = require("./days");
const inPlays = require("./in_play");
const casinoLocks = require("./casino_lock");
const persist = require("./persist");
const slots = require("./season_slots");
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
 * Two seasons can run at the same time (e.g. one for everybody, one for a
 * whitelist): a season gets a slot when it starts (game/season_slots.js) - a
 * world, a wallet, games and a leaderboard of its own. A player can be in
 * both and switches between the worlds. A season can be open for everybody (default),
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
 * changes: "closing" (info - or null with the slot key - again when the countdown starts), "started" (season),
 * "ended" (season), "joined" (username, season), "world" (username, world: "/season", "/season2" or "")
 */
const KEY = "seasons";
// The coin of a season that has none of its own (the 🪙 is the money outside seasons)
const SEASON_COIN = "💎";
const BACKUP = "seasonGames:"; // + id: the games from before the season (old seasons, see migrate)
// Who may play in a season: everybody - only the whitelist - everybody but the banlist
const ACCESS = ["all", "whitelist", "banlist"];
const SEASON_WORLD = "/season";
// The leaderboard of the season in the first slot (game/leaderboard.js keeps it there - the second: slot.board)
const BOARD_KEY = "leaderboard:season";
// At most this many seasons at the same time (one per slot)
const MAX_AT_ONCE = slots.SLOTS.length;
// How often the leaderboard of a season is updated (minutes; 0: all the time, 1440: once a day at midnight)
const INTERVALS = [0, 5, 15, 60, 360, 1440];
const MAX_PRIZES = 20;
const TICK = 10 * 1000;

const changes = new EventEmitter();
changes.setMaxListeners(0);

// slots: per slot key {base (the coins of its season, see coins.setBase), closing (the countdown before its season starts / ends)}
const emptyState = () => ({ seasons: [], next: 1, slots: {} });
let state = emptyState();
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
    status: closingOf(season) && closingOf(season).kind === "start" ? "starting" : status(season),
    // (the slot it runs in: its world - null: not started / over)
    slot: season.started && !season.ended && slotOf(season) ? slotOf(season).key : null,
    world: season.started && !season.ended && slotOf(season) ? slotOf(season).world : null,
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
// bonus: the season's daily bonuses the player claimed in the current chance - they have to be wagered too
// (as often as the budget)
function wagerNeed(season, bonus = 0) {
  return wagerXOf(season) * (season.budget + (bonus || 0));
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
const isRunning = (season) => !!(season && season.started && !season.ended);

// The slot of a season (game/season_slots.js) - null: it has none (planned, not closing yet)
const slotOf = (season) => (season ? slots.of(season.slot) : null);
// The state of a slot: {base, closing}
function slotState(key) {
  state.slots = state.slots || {};
  return (state.slots[key] = state.slots[key] || { base: null, closing: null });
}
const lockOf = (season) => casinoLocks[slotOf(season) ? slotOf(season).key : "season"];
const inPlayOf = (season) => inPlays[slotOf(season) ? slotOf(season).key : "season"];
const walletOf = (season) => coins.wallet(slotOf(season) ? slotOf(season).key : "season");
const fieldsOf = (season) => (slotOf(season) || slots.SLOTS[0]).fields;
// The leaderboard of a running season (game/leaderboard.js)
const boardKey = (season) => (slotOf(season) || slots.SLOTS[0]).board;

// Every running season (by slot)
function runningAll() {
  return slots.KEYS.map((key) => runningIn(key)).filter(Boolean);
}

function runningIn(key) {
  return state.seasons.find((season) => isRunning(season) && season.slot === key) || null;
}

// The running season of a slot ("season", "season2" - or a world "/season2", or a season id) -
// nothing given: the first running one
function running(which) {
  if (which == null) return runningAll()[0] || null;
  if (typeof which === "number" || /^\d+$/.test(String(which))) {
    const season = byId(which);
    return isRunning(season) ? season : null;
  }
  const slot = slots.of(which);
  return slot ? runningIn(slot.key) : null;
}

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
    if (row && typeof row.value === "string") state = { ...emptyState(), ...JSON.parse(row.value) };
  } catch (error) {
    console.error("[seasons] Could not read the seasons:", error);
  }
  toSlots();
  await migrate();
  for (const slot of slots.SLOTS) {
    const own = slotState(slot.key);
    coins.setBase(own.base, slot.key);
    const season = runningIn(slot.key);
    slots.setCurrent(slot.key, season ? season.id : null);
    // (the server stopped while the season world was closing for the end: closed again)
    if (own.closing && own.closing.kind === "end") casinoLocks[slot.key].lock("end");
  }
  // (the limits of seasons from before there were two: one set for every season - now every season has its own)
  await require("./settings").adoptSeasonLimits(state.seasons.filter((season) => !season.ended).map((season) => season.id));
  loaded = true;
}

// From before there were two seasons at once: the one base / countdown is the first slot's
function toSlots() {
  state.slots = state.slots || {};
  if ("base" in state || "closing" in state) {
    const first = slotState(slots.SLOTS[0].key);
    if (state.base) first.base = state.base;
    if (state.closing) first.closing = { kind: "start", ...state.closing };
    const closing = state.closing && byId(state.closing.id);
    if (closing && !closing.slot) closing.slot = slots.SLOTS[0].key;
    delete state.base;
    delete state.closing;
  }
  for (const season of state.seasons) {
    if (isRunning(season) && !season.slot) season.slot = slots.SLOTS[0].key;
  }
}

/*
 * A season that started before the worlds were apart: the whole casino was the
 * season then (user.coins: the season's coins, season.saved: the normal ones,
 * the games of before in a backup). Now: the season's coins and games go to
 * the season world, the normal ones come back - who joined plays on in the
 * season world.
 */
async function migrate() {
  const season = running("season");
  if (season == null || season.world === true || season.saved == null) return;
  const base = slotState("season").base;
  const era = base && base.reset;
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
  if (base) base.active = true;
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

// The countdown of a season (before it starts or ends) - null: none
function closingOf(season) {
  const slot = slotOf(season);
  const closing = slot ? slotState(slot.key).closing : null;
  return closing && closing.id === season.id ? closing : null;
}

// What a slot closes for: "start" (its season starts) or "end" (its season ends) - nothing given: the first countdown
function closingKind(key) {
  const closing = key ? slotState(slots.of(key) ? slots.of(key).key : key).closing : closings()[0];
  return closing ? closing.kind || "start" : null;
}

// Every countdown now (one per slot at most)
function closings() {
  return slots.KEYS.map((key) => slotState(key).closing).filter(Boolean);
}

// The countdown of a season: {id, name, icon, slot, kind, startsIn (ms until it starts / ends, null: the games are
// still finishing)} - nothing given: the first one (null: none)
function closingInfo(now = Date.now(), key = null) {
  const closing = key ? slotState(slots.of(key) ? slots.of(key).key : key).closing : closings()[0];
  const season = closing && byId(closing.id);
  if (!season) return null;
  return { id: season.id, name: season.name, icon: season.icon, color: season.color || null, slot: season.slot || null, world: slotOf(season) ? slotOf(season).world : null, kind: closing.kind || "start", startsIn: closing.startsAt == null ? null : Math.max(0, closing.startsAt - now) };
}

// Every countdown for the pages (closingInfo of each)
function closingInfos(now = Date.now()) {
  return slots.KEYS.map((key) => closingInfo(now, key)).filter(Boolean);
}

// A free slot for a season that starts: none of its seasons runs, no other season counts down in it
function freeSlot(season) {
  if (season.slot && !runningIn(season.slot)) {
    const closing = slotState(season.slot).closing;
    if (!closing || closing.id === season.id) return season.slot;
  }
  const free = slots.KEYS.find((key) => !runningIn(key) && !slotState(key).closing);
  return free || null;
}

// The world of a season closes for its start or its end: true when it is time (every game was
// quiet - or waited long enough - and then SEASON_CLOSE_WAIT); the world opens again after it
async function closeFor(season, kind, now) {
  let closing = closingOf(season);
  if (!closing || closing.kind !== kind) {
    // The start: the season gets its slot (none free: it waits) - only the countdown, the casino goes on
    if (kind === "start") {
      const slot = freeSlot(season);
      if (!slot) return false;
      season.slot = slot;
    }
    // The end: the season world closes first
    closing = slotState(season.slot).closing = { id: season.id, kind: kind, since: now, startsAt: kind === "start" ? now + closeWaitOf(season) : null };
    if (kind === "end") lockOf(season).lock("end");
    await save();
    changes.emit("closing", closingInfo(now, season.slot), season.slot);
    if (kind === "start") soon(closeWaitOf(season) + 100);
  }
  // Every game of the season world quiet (or waited long enough): the countdown
  if (closing.startsAt == null && (lockOf(season).busyGames().length === 0 || now - closing.since >= config.SEASON_CLOSE_MAX)) {
    closing.startsAt = now + closeWaitOf(season);
    await save();
    changes.emit("closing", closingInfo(now, season.slot), season.slot);
    soon(closeWaitOf(season) + 100);
  }
  if (closing.startsAt != null && now >= closing.startsAt) {
    slotState(season.slot).closing = null;
    return true;
  }
  if (closing.startsAt == null) soon(2000);
  return false;
}

// A season's world was closing for something that is off now (the end moved later): open again
async function stopClosing(season) {
  slotState(season.slot).closing = null;
  lockOf(season).unlock("end");
  await save();
  changes.emit("closing", null, season.slot);
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
  // At most two seasons at the same time (one per slot): never a moment with three
  const others = state.seasons.filter((season) => season !== current && !season.ended && season.start < end && start < season.end);
  const crowded = atOnce(others, start, end);
  if (crowded) return { error: `At most ${MAX_AT_ONCE} seasons at the same time - it overlaps with ${crowded.map((season) => `"${season.name}"`).join(" and ")}.` };
  return { season: { name: name, icon: icon, coinIcon: coinIcon, start: start, end: end, budget: budget, dailyBonus: dailyBonus, secondChances: secondChances, chanceDelay: chanceDelay, closeWait: closeWait, color: color, every: every, prizesOn: prizesOn, prizes: clean, access: { mode: accessMode, names: accessNames }, highlight: highlight, wagerX: wagerX } };
}

// Seasons (all overlapping start - end) that run together with a new one somewhere in start - end: MAX_AT_ONCE of
// them at one moment (with the new one: too many) - null: fine. (Time spans: some of them overlap at one moment
// when the latest start is before the earliest end)
function atOnce(others, start, end) {
  const groups = (list, size) => (size === 0 ? [[]] : list.flatMap((season, i) => groups(list.slice(i + 1), size - 1).map((rest) => [season, ...rest])));
  return groups(others, MAX_AT_ONCE).find((group) => Math.max(start, ...group.map((s) => s.start)) < Math.min(end, ...group.map((s) => s.end))) || null;
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
  const base = status(season) === "running" && slotOf(season) ? slotState(season.slot).base : null;
  if (base) {
    base.bonus = season.dailyBonus;
    coins.setBase(base, season.slot);
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
  if (closingOf(season)) {
    slotState(season.slot).closing = null;
    lockOf(season).unlock("end");
    changes.emit("closing", null, season.slot);
  }
  await require("./settings").dropSeasonLimits(season.id);
  await save();
  return { ok: true };
}

/* ---------- Start and end ---------- */

// The season world of its slot opens: its games start anew, everybody may join (the budget comes with joining)
async function startSeason(season, now) {
  const slot = slotOf(season);
  season.started = true;
  season.startedAt = now;
  season.joined = {};
  season.here = {};
  season.world = true;
  const base = { reset: "season-" + season.id, start: 0, budget: season.budget, join: true, since: now, active: true, bonus: Number.isInteger(season.dailyBonus) ? season.dailyBonus : null };
  slotState(slot.key).base = base;
  coins.setBase(base, slot.key);
  slots.setCurrent(slot.key, season.id);
  await save();
  await persist.resetPrefix(slot.prefix);
  await Setting.deleteMany({ key: { $in: [slot.board] } });
  changes.emit("started", publicSeason(season));
}

// The season meant: a season, its id, a slot ("season2") / world ("/season2") - nothing: the first running one
function seasonOf(which) {
  if (which && typeof which === "object") return which;
  return running(which);
}

// What joining gives now: the budget and a daily bonus for every day since the start - {coins, missed}
function joinCoins(now = Date.now(), which = null) {
  const season = seasonOf(which);
  if (season == null) return null;
  const missed = Math.max(0, days.dayNumber(now) - days.dayNumber(season.startedAt || season.start));
  return { coins: season.budget + missed * walletOf(season).dailyBonus(), missed: missed };
}

// The player joins a running season (which: its id or slot - nothing: the first one): the budget (and a daily
// bonus for every day missed since the start - today's one they claim themselves) - and its world.
// {coins, missed} or {error}
async function join(username, now = Date.now(), which = null) {
  const season = seasonOf(which);
  if (season == null) return { error: "No season runs." };
  if (!allowed(season, username)) return { error: "This season is closed - you're not on its list." };
  season.joined = season.joined || {};
  if (season.joined[username]) return { error: "You are in the season already." };
  const user = await User.findOne({ username: username }).select("username casinoApproved").lean();
  if (user == null || user.casinoApproved !== true) return { error: "Not in the casino." };
  if (season.joined[username]) return { error: "You are in the season already." };
  season.joined[username] = now;
  // (in one world at a time: the other season's world is left)
  for (const other of runningAll()) if (other.here) delete other.here[username];
  season.here = season.here || {};
  season.here[username] = true;
  const { coins: amount, missed } = joinCoins(now, season);
  await save();
  const f = fieldsOf(season);
  await User.updateOne({ username: username }, { $set: { [f.coins]: amount, [f.reset]: slotState(season.slot).base.reset }, $unset: { [f.bonusAt]: 1 } });
  walletOf(season).log(username, amount, "season start", missed > 0 ? `${season.name}: ${season.budget.toLocaleString("en-US")} + ${missed} missed daily bonus${missed === 1 ? "" : "es"}` : season.name);
  coins.notify(username);
  changes.emit("joined", username, publicSeason(season));
  changes.emit("world", username, slotOf(season).world);
  return { coins: amount, missed: missed };
}

// When the player joined a running season (null: not in it, or no season)
function joinedAt(username, which = null) {
  const season = seasonOf(which);
  return season && season.joined && season.joined[username] ? season.joined[username] : null;
}

// In a running season (which: id / slot - nothing: the first one): did the player join it? (null: no season)
function joined(username, which = null) {
  const season = seasonOf(which);
  if (season == null) return null;
  // (a season from before joining existed: everybody is in)
  if (season.joined == null) return allowed(season, username);
  return !!season.joined[username] && allowed(season, username);
}

// The running seasons the player is in
function joinedSeasons(username) {
  return runningAll().filter((season) => joined(username, season) === true);
}

// (the wallets ask by their slot)
coins.setJoinedLookup((username, key) => joined(username, runningIn(key || "season")) ?? null);
// (since when the player is in it: the daily bonuses add up from that day on)
coins.setJoinedAtLookup((username, key) => {
  const season = runningIn(key || "season");
  if (season == null) return null;
  return (season.joined && season.joined[username]) || season.startedAt || season.start;
});

// The wager for a place of a player right now: {done, need} - read from the season's coin history
coins.setWagerLookup(async (username, key) => {
  const season = runningIn(key || "season");
  if (season == null || !wagerXOf(season)) return null;
  const rows = await CoinLog.find({ era: "season-" + season.id, username: username, reason: { $in: [...BETS, "daily bonus"] } }).lean();
  const from = chanceStart(season, username);
  const now = rows.filter((row) => new Date(row.at).getTime() >= from);
  const bonus = now.filter((row) => row.reason === "daily bonus").reduce((sum, row) => sum + row.amount, 0);
  return { done: now.filter((row) => row.reason !== "daily bonus").reduce((sum, row) => sum - row.amount, 0), need: wagerNeed(season, bonus), bonus: bonus };
});

// The season whose world the player plays in now (joined it and switched there) - null: the normal casino
function hereIn(username) {
  return runningAll().find((season) => season.here && season.here[username] && joined(username, season)) || null;
}

// Plays the player in a season world now?
function inSeasonWorld(username) {
  return hereIn(username) != null;
}

// The season world the player plays in now ("/season", "/season2") - null: the normal casino
function worldOf(username) {
  const season = hereIn(username);
  return season ? slotOf(season).world : null;
}

// The player switches the world: "normal" - or a running season they joined (its id, its slot "season" / "season2"
// or its world; "season": the first one they joined)
async function switchWorld(username, to) {
  const all = runningAll();
  let season = null;
  if (to !== "normal") {
    season = to === "season" ? joinedSeasons(username)[0] || running("season") : running(to);
    if (season == null && to !== "season" && !slots.of(to) && !/^\d+$/.test(String(to))) return { error: "Unknown world." };
    if (season == null) return { error: "No season runs." };
    if (!joined(username, season)) return { error: "Join the season first." };
  }
  for (const other of all) if (other !== season && other.here) delete other.here[username];
  if (season) {
    season.here = season.here || {};
    season.here[username] = true;
  }
  await save();
  const world = season ? slotOf(season).world : "";
  changes.emit("world", username, world);
  return season ? { world: season.slot, season: season.id } : { world: "normal" };
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
  const slot = slotOf(season);
  // (with the stats: the coin history of the season is gone after it)
  const rows = await withStats(season, await standings(season));
  // The same coins, the same place - between them: fewer second chances, then more coins wagered
  const byName = new Map(rows.map((row) => [row.username, row]));
  season.final = { at: now, rows: place(rows, { prizes: prizesOf(season), stats: (username) => ({ chances: byName.get(username).chances, wagered: byName.get(username).wagered, chanceWagered: byName.get(username).chanceWagered }), need: (username) => wagerNeed(season, byName.get(username).chanceBonus) }) };
  season.ended = true;
  season.endedAt = now;
  const own = slotState(slot.key);
  const seasonEra = own.base ? own.base.reset : null;
  const players = Object.keys(season.here || {});
  season.here = {};
  own.base = null;
  coins.setBase(null, slot.key);
  slots.setCurrent(slot.key, null);
  await save();
  // The coins of the season: into the normal wallet
  for (const row of rows) {
    if (row.coins > 0) await coins.add(row.username, row.coins, { reason: "season payout", note: season.name });
  }
  await givePrizes(season, season.final.rows);
  await User.updateMany({ [slot.fields.reset]: seasonEra }, { $set: { [slot.fields.coins]: 0 } });
  // The season world: empty again (its games, its history)
  await persist.resetPrefix(slot.prefix);
  if (seasonEra) await CoinLog.deleteMany({ era: seasonEra });
  await Setting.deleteMany({ key: { $in: [slot.board] } });
  changes.emit("ended", publicSeason(season));
  for (const username of players) changes.emit("world", username, "");
  for (const row of rows) coins.notify(row.username);
}

// Everybody in a running season (who joined) by the season's coins: [{rank, username, coins}]
async function standings(which = null) {
  const season = seasonOf(which);
  if (season == null) return [];
  const f = fieldsOf(season);
  const users = await User.find({ casinoApproved: true }).select(["username", f.coins, f.reset].join(" ")).lean();
  return place(users.filter((user) => joined(user.username, season) === true).map((user) => ({ username: user.username, coins: walletOf(season).balanceOf(user) })));
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
    const s = (stats[row.username] = stats[row.username] || { bets: 0, wagered: 0, chanceWagered: 0, chanceBonus: 0, biggestWin: 0, fromGames: 0, dailyBonuses: 0, lastActive: null, games: {} });
    const at = new Date(row.at).getTime();
    if (s.lastActive == null || at > s.lastActive) s.lastActive = at;
    if (row.reason === "daily bonus") {
      s.dailyBonuses++;
      // (the bonuses of the current chance: on top of the wager for a place)
      if (at >= chanceStart(season, row.username)) s.chanceBonus += row.amount;
    }
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
const statsCache = new Map();
async function tieStats(season, now = Date.now()) {
  let cached = statsCache.get(season.id);
  if (!cached || now - cached.at > 15000) {
    cached = { at: now, stats: await seasonStats(season) };
    statsCache.set(season.id, cached);
  }
  const stats = cached.stats;
  const chances = season.chances || {};
  return (username) => ({ chances: (chances[username] && chances[username].used) || 0, wagered: (stats[username] && stats[username].wagered) || 0, chanceWagered: (stats[username] && stats[username].chanceWagered) || 0, chanceBonus: (stats[username] && stats[username].chanceBonus) || 0 });
}

// The leaderboard rows with when they started, the second chances and the stats
async function withStats(season, rows) {
  const stats = await seasonStats(season);
  return rows.map((row) => ({
    ...row,
    joinedAt: (season.joined && season.joined[row.username]) || null,
    chances: (season.chances && season.chances[row.username] && season.chances[row.username].used) || 0,
    ...(stats[row.username] || { bets: 0, wagered: 0, chanceWagered: 0, chanceBonus: 0, biggestWin: 0, fromGames: 0, dailyBonuses: 0, lastActive: null, favourite: null }),
  }));
}

// For the admin panel: {status, at, chancesTotal, rows} - running: right now, over: the final places
async function board(id) {
  const season = byId(id);
  if (season == null) return null;
  const result = { status: status(season), chancesTotal: season.secondChances || 0 };
  if (season.ended) return { ...result, at: season.final ? season.final.at : null, rows: season.final ? season.final.rows : [] };
  if (!season.started) return { ...result, at: null, rows: [] };
  const rows = await withStats(season, await standings(season));
  const byName = new Map(rows.map((row) => [row.username, row]));
  return { ...result, at: Date.now(), rows: place(rows, { prizes: prizesOf(season), stats: (username) => ({ chances: byName.get(username).chances, wagered: byName.get(username).wagered, chanceWagered: byName.get(username).chanceWagered }), need: (username) => wagerNeed(season, byName.get(username).chanceBonus) }) };
}

let ticking = null;
// Starts and ends seasons when it is time (at most one per slot)
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
        // The start (a slot is free): first the countdown
        if (!season.started && season.start <= now && (await closeFor(season, "start", now))) {
          await startSeason(season, now);
        }
        // The end: first its world closes - running rounds go to their end, nothing new
        if (season.started && !season.ended && season.end <= now && (await closeFor(season, "end", now))) {
          await endSeason(season, now);
          lockOf(season).unlock("end");
        }
        // Closing for the end, but the admin moved the end later: open again
        const closing = closingOf(season);
        if (closing && closing.kind === "end" && !season.ended && season.end > now) await stopClosing(season);
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
// which: the season (id / slot - nothing: the first running one)
async function chanceStatus(username, now = Date.now(), which = null) {
  const season = seasonOf(which);
  const total = season ? season.secondChances || 0 : 0;
  if (!season || total === 0) return { can: false, reason: "none", left: 0, total: 0 };
  const record = (season.chances && season.chances[username]) || { used: 0, lastAt: null };
  const left = Math.max(0, total - record.used);
  const result = { can: false, left: left, total: total, budget: season.budget, nextAt: null };
  if (joined(username, season) === false) return { ...result, reason: "notJoined" };
  if (left === 0) return { ...result, reason: "used" };
  // Still coins - or coins in a game (a bet that is not over, or one just made that the game gets now): nothing yet
  // (before the wait: no "out of coins" while a bet still runs)
  if ((await walletOf(season).get(username)).coins > 0) return { ...result, reason: "coins" };
  if (inPlayOf(season).where(username).length || now - coins.lastSpent(username) < SPEND_GRACE) return { ...result, reason: "inPlay" };
  // The first one right away - after a second chance, the next one after the delay (not set: the next day)
  const delay = chanceDelayOf(season);
  const from = record.used === 0 ? null : delay == null ? days.nextDay(record.lastAt) : record.lastAt + delay * 3600 * 1000;
  if (from != null && now < from) return { ...result, reason: "cooldown", nextAt: from };
  return { ...result, can: true, reason: null };
}

// Takes a second chance: the budget again (no missed bonuses) - {coins, left} or {error}
async function useChance(username, now = Date.now(), which = null) {
  const season = seasonOf(which);
  const status = await chanceStatus(username, now, season);
  if (!status.can) return { error: status.reason === "cooldown" ? (chanceDelayOf(season) == null ? "Your next second chance comes tomorrow." : "Your next second chance comes later.") : "No second chance right now.", status: status };
  season.chances = season.chances || {};
  const record = season.chances[username] || { used: 0, lastAt: null };
  season.chances[username] = { used: record.used + 1, lastAt: now };
  await save();
  const f = fieldsOf(season);
  await User.updateOne({ username: username }, { $set: { [f.coins]: season.budget, [f.reset]: slotState(season.slot).base.reset } });
  walletOf(season).log(username, season.budget, "second chance", season.name);
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
  forgetAll();
  await Setting.deleteMany({ key: { $in: [KEY, ...slots.SLOTS.map((slot) => slot.board), ...ids.map((id) => BACKUP + id)] } });
  if (wasRunning) changes.emit("cleared");
}

// Tests: everything forgotten
function reset() {
  forgetAll();
  loaded = true;
}

function forgetAll() {
  state = emptyState();
  statsCache.clear();
  for (const key of slots.KEYS) {
    coins.setBase(null, key);
    slots.setCurrent(key, null);
    casinoLocks[key].unlock("end");
  }
}

// The running season's accent color for the casino pages: a <style> (or "")
// The coin icon of the running season for the casino pages (see casino_coin.js) - nothing: the 🪙
// (only in the season world: the normal casino keeps the 🪙 and its gold)
function coinScript(username) {
  const season = hereIn(username);
  if (!season) return "";
  const icon = season.coinIcon || SEASON_COIN;
  return `<script>window.CASINO_COIN = ${JSON.stringify(icon).replace(/</g, "\\u003c")};</script>`;
}

function accentStyle(username) {
  const season = hereIn(username);
  if (!season) return "";
  const color = season && season.color;
  if (!color || !/^#[0-9a-f]{6}$/.test(color)) return "";
  const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const hover = "#" + rgb.map((v) => Math.round(v * 0.86).toString(16).padStart(2, "0")).join("");
  return `<style>body.jackpot-theme { --mm-accent: ${color}; --mm-accent-rgb: ${rgb.join(", ")}; --mm-accent-hover: ${hover}; }</style>`;
}

module.exports = { wagerNeed, wagerXOf, prizesOf, prizeText, tieStats, board, joinedAt, join, joined, joinedSeasons, joinCoins, allowed, accessOf, inSeasonWorld, hereIn, worldOf, switchWorld, upcoming, closingInfo, closingInfos, closingKind, closingOf, runningAll, slotOf, boardKey, MAX_AT_ONCE, chanceStatus, useChance, clear, accentStyle, coinScript, INTERVALS, ACCESS, BOARD_KEY, SEASON_WORLD, changes, load, list, create, update, remove, endNow, tick, start, stop, reset, running, lastEnded, byId, publicSeason, standings, status };
