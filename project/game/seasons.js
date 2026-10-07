const EventEmitter = require("events");
const User = require("../models/User");
const Setting = require("../models/Setting");
const coins = require("./coins");
const config = require("./config");
const { seasonReset } = require("./hard_reset");

/*
 * Seasons (admin panel): planned ahead from a start to an end. When a season
 * starts, the casino starts anew like after the hard reset (games, coin
 * history, payouts) - everybody who is in stays in and gets the season's
 * start budget; the leaderboard shows the season (updated as often as
 * the season says). When it ends, the final places are kept - with the
 * prizes, if the season has any - and shown on the winner page.
 *
 * Without a running season the leaderboard is the normal one (live).
 *
 * changes: "started" (season), "ended" (season)
 */
const KEY = "seasons";
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

// For the admin panel and the pages
function publicSeason(season) {
  return {
    id: season.id,
    name: season.name,
    icon: season.icon,
    start: season.start,
    end: season.end,
    budget: season.budget,
    dailyBonus: Number.isInteger(season.dailyBonus) ? season.dailyBonus : null,
    every: season.every,
    prizesOn: season.prizesOn,
    prizes: season.prizes,
    status: status(season),
    endedAt: season.endedAt || null,
    players: season.final ? season.final.rows.length : null,
    winner: season.final && season.final.rows.length ? season.final.rows[0] : null,
  };
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
  coins.setBase(state.base);
  loaded = true;
}

/* ---------- Checking what the admin entered ---------- */

function check(input, current) {
  if (input == null || typeof input !== "object") return { error: "No season." };
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 1 || name.length > 40) return { error: "A name, up to 40 characters." };
  const icon = typeof input.icon === "string" ? input.icon.trim() : "";
  if (icon.length < 1 || [...icon].length > 4) return { error: "An icon (one emoji)." };
  const start = Number(input.start);
  const end = Number(input.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { error: "A start and an end." };
  if (end <= start) return { error: "The end comes after the start." };
  const budget = Number(input.budget);
  if (!Number.isInteger(budget) || budget < 0 || budget > 1000000000) return { error: "A start budget from 0 to 1,000,000,000." };
  // (not given: the daily bonus of the settings)
  const dailyBonus = input.dailyBonus == null || input.dailyBonus === "" ? config.DAILY_BONUS : Number(input.dailyBonus);
  if (!Number.isInteger(dailyBonus) || dailyBonus < 0 || dailyBonus > 10000000) return { error: "A daily bonus from 0 to 10,000,000." };
  const every = Number(input.every);
  if (!INTERVALS.includes(every)) return { error: "Unknown update interval." };
  const prizesOn = input.prizesOn === true;
  const prizes = Array.isArray(input.prizes) ? input.prizes : [];
  if (prizes.length > MAX_PRIZES) return { error: `At most ${MAX_PRIZES} prizes.` };
  const clean = [];
  for (const prize of prizes) {
    const place = Number(prize && prize.place);
    const text = prize && typeof prize.prize === "string" ? prize.prize.trim() : "";
    if (!Number.isInteger(place) || place < 1 || place > 1000) return { error: "A prize needs a place (1 or more)." };
    if (text.length < 1 || text.length > 80) return { error: `The prize for place ${place}: up to 80 characters.` };
    if (clean.some((p) => p.place === place)) return { error: `Place ${place} has two prizes.` };
    clean.push({ place: place, prize: text });
  }
  clean.sort((a, b) => a.place - b.place);
  if (prizesOn && clean.length === 0) return { error: "Prizes are on - add at least one." };

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
  return { season: { name: name, icon: icon, start: start, end: end, budget: budget, dailyBonus: dailyBonus, every: every, prizesOn: prizesOn, prizes: clean } };
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
  await save();
  return { ok: true };
}

/* ---------- Start and end ---------- */

// Every account in the casino starts with the budget, the games start anew
async function startSeason(season, now) {
  season.started = true;
  season.startedAt = now;
  state.base = { reset: "season-" + season.id, start: season.budget, since: now, bonus: Number.isInteger(season.dailyBonus) ? season.dailyBonus : null };
  coins.setBase(state.base);
  await save();
  const players = await User.find({ casinoApproved: true }).select("username").lean();
  await seasonReset(season.budget, state.base.reset);
  for (const player of players) coins.log(player.username, season.budget, "season start", season.name);
  changes.emit("started", publicSeason(season));
  for (const player of players) coins.notify(player.username);
}

// The final places (everybody in the casino, by coins) - with the prizes
async function endSeason(season, now) {
  const rows = await standings();
  const prizes = season.prizesOn ? new Map(season.prizes.map((p) => [p.place, p.prize])) : new Map();
  season.final = { at: now, rows: rows.map((row) => (prizes.has(row.rank) ? { ...row, prize: prizes.get(row.rank) } : row)) };
  season.ended = true;
  season.endedAt = now;
  // The coins stay until the next season - the daily bonus is the normal one again
  if (state.base) {
    state.base.bonus = null;
    coins.setBase(state.base);
  }
  await save();
  changes.emit("ended", publicSeason(season));
}

// Everybody in the casino by coins: [{rank, username, coins}]
async function standings() {
  const users = await User.find({ casinoApproved: true }).select("username coins coinReset").lean();
  return users
    .map((user) => ({ username: user.username, coins: coins.balanceOf(user) }))
    .sort((a, b) => b.coins - a.coins || a.username.localeCompare(b.username))
    .map((row, index) => ({ rank: index + 1, ...row }));
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
        if (!season.started && season.start <= now && !running()) await startSeason(season, now);
        if (season.started && !season.ended && season.end <= now) await endSeason(season, now);
      }
    })
    .catch((error) => console.error("[seasons] Could not start or end a season:", error));
  return ticking;
}

// The admin ends the running season right now
async function endNow(id, now = Date.now()) {
  const season = byId(id);
  if (season == null || status(season) !== "running") return { error: "The season doesn't run." };
  season.end = now;
  await endSeason(season, now);
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

// Tests: everything forgotten
function reset() {
  state = { seasons: [], base: null, next: 1 };
  coins.setBase(null);
  loaded = true;
}

module.exports = { INTERVALS, changes, load, list, create, update, remove, endNow, tick, start, stop, reset, running, lastEnded, byId, publicSeason, standings, status };
