const EventEmitter = require("events");
const Setting = require("../models/Setting");
const config = require("./config");
const cases = require("./cases");

// "change" ({KEY: value}) after the admin changed values (e.g. a game turned off)
const changes = new EventEmitter();

/*
 * Values the admin can change in the admin panel (Settings). They live in
 * config like every other value, a change is stored and comes back after a
 * restart. Times are stored in ms but shown in seconds (scale).
 */
const KEY = "admin:settings";

// group: the page of the admin panel (general or a game), section: a card on it.
// type "toggle": on / off (a game), "choice": one of `options` ({value, label}), "cases": the cases turned off
// (a list of ids, at least one stays on), everything else a whole number (step: what the arrows of the field add).
// scope "outside": only outside of a season (a season has its own value) - everything else counts always.
// season: true - the season world can have its own value (the "Season" switch of the page; none: the normal one).
const FIELDS = [
  { group: "general", section: "Coins", key: "START_COINS", label: "Start coins", scope: "outside", hint: "What a newly approved player gets outside of a season (in a season: the season's budget instead).", step: 1000, min: 0, max: 100000000 },
  { group: "general", section: "Gifts", key: "GIFT_LIMIT", label: "Gifts per player and day", hint: "🪙 a player can give others a day (a click on a name in the casino chat) - from midnight on the full amount again.", step: 1000, min: 0, max: 100000000 },
  { group: "general", section: "Gifts", key: "SEASON_GIFT_LIMIT", label: "Gifts per player and day in a season", hint: "Season coins a player can give others in the season world a day - apart from the 🪙 above (both can be sent).", step: 1000, min: 0, max: 100000000 },
  { group: "general", section: "Max bet by balance", key: "BET_CAP_FLOOR", season: true, label: "All in up to", hint: "A player with at most this many coins can bet all of them (every game).", step: 10000, min: 0, max: 100000000 },
  { group: "general", section: "Max bet by balance", key: "BET_CAP_SHARE", season: true, label: "Above it: per bet at most", hint: "Percent of the balance one bet may take above the amount above (but always at least that amount). 100%: no cap.", unit: "%", step: 5, min: 1, max: 100 },
  { group: "general", section: "Coins", key: "DAILY_BONUS", label: "Daily bonus", scope: "outside", hint: "Free coins once a day for every player outside of a season (a season has its own).", step: 100, min: 0, max: 10000000 },
  { group: "jackpot", section: "Jackpot", key: "GAME_JACKPOT", type: "toggle", label: "Jackpot is on", hint: "Off: no tab, nobody can open it." },
  { group: "jackpot", section: "Bets", key: "JACKPOT_MAX_COINS", season: true, label: "Max coins per round", hint: "All bets of one player in one round together.", step: 1000, min: 1, max: 100000000 },
  { group: "jackpot", section: "Bets", key: "JACKPOT_RAKE", label: "House cut", hint: "Percent of the pot the house keeps - but never more than half of the others' coins (a winner never gets back less than the own bet).", unit: "%", step: 1, min: 0, max: 50 },
  { group: "jackpot", section: "Bets", key: "JACKPOT_MAX_BETS", season: true, label: "Bets per round", hint: "Separate bets of one player in one round.", step: 1, min: 1, max: 100 },
  { group: "jackpot", section: "Ghost", key: "JACKPOT_GHOST_MIN", label: "Ghost bets from", hint: "Percent of the coins of the player alone in the pot - the ghost picks a share between this and the next one.", unit: "%", step: 5, min: 1, max: 500 },
  { group: "jackpot", section: "Ghost", key: "JACKPOT_GHOST_TOP", label: "Ghost bets up to", hint: "Percent of the coins of the player alone in the pot.", unit: "%", step: 5, min: 1, max: 500 },
  { group: "jackpot", section: "Ghost", key: "JACKPOT_GHOST_MAX", label: "Ghost bets at most", hint: "Whatever the share - the ghost never bets more coins than this.", step: 1000, min: 1, max: 100000000 },
  { group: "jackpot", section: "Timing", key: "JACKPOT_GHOST_AFTER", label: "Ghost joins after", hint: "Alone in the pot this long: the 👻 joins.", unit: "s", scale: 1000, step: 1, min: 1, max: 3600 },
  { group: "jackpot", section: "Timing", key: "JACKPOT_COUNTDOWN", label: "Countdown", hint: "From the second player to the draw.", unit: "s", scale: 1000, step: 5, min: 5, max: 600 },
  { group: "battles", section: "Case battles", key: "GAME_BATTLES", type: "toggle", label: "Case battles are on", hint: "Off: no tab, nobody can open it." },
  { group: "battles", section: "Cases", key: "BATTLE_CASES_OFF", type: "cases", label: "Cases", hint: "Turned off: gone from the case list, no new battles with it (running battles play to the end)." },
  { group: "battles", section: "Battles", key: "BATTLE_MAX_CASES", season: true, label: "Max cases per battle", step: 1, min: 1, max: 1000 },
  { group: "battles", section: "Battles", key: "BATTLE_MAX_COST", season: true, label: "Max cost per battle", hint: "What one seat may cost - all cases of the battle together.", step: 1000, min: 1, max: 100000000 },
  { group: "battles", section: "Battles", key: "BATTLE_MAX_OPEN", season: true, label: "Battles per player at a time", hint: "Created ones that wait or run (filled with bots too).", step: 1, min: 1, max: 50 },
  { group: "poker", section: "Poker", key: "GAME_POKER", type: "toggle", label: "Poker is on", hint: "Off: no tab, nobody can open it." },
  { group: "poker", section: "Buy-in", key: "POKER_MIN_BUYIN", season: true, label: "Min buy-in", step: 100, min: 1, max: 100000000 },
  { group: "poker", section: "Buy-in", key: "POKER_MAX_BUYIN", season: true, label: "Max buy-in", step: 500, min: 1, max: 100000000 },
  { group: "poker", section: "Rake", key: "POKER_RAKE", label: "Rake", hint: "Percent of every pot that saw the flop the house keeps (5%: a payback of about 95%).", unit: "%", step: 1, min: 0, max: 50 },
  { group: "slots", section: "Slots", key: "GAME_SLOTS", type: "toggle", label: "Slots are on", hint: "Off: no tab, nobody can open it." },
  { group: "slots", section: "Bets", key: "SLOTS_MIN_BET", season: true, label: "Min bet per spin", hint: "For all 9 lines together.", step: 9, min: 9, max: 100000000 },
  { group: "slots", section: "Bets", key: "SLOTS_MAX_BET", season: true, label: "Max bet per spin", hint: "For all 9 lines together.", step: 90, min: 9, max: 100000000 },
  { group: "roulette", section: "Roulette", key: "GAME_ROULETTE", type: "toggle", label: "Roulette is on", hint: "Off: no tab, nobody can open it." },
  { group: "roulette", section: "Bets", key: "ROULETTE_MIN_BET", season: true, label: "Min bet", step: 10, min: 1, max: 100000000 },
  { group: "roulette", section: "Bets", key: "ROULETTE_MAX_BET", season: true, label: "Max bet per round", hint: "All colors of a player together.", step: 1000, min: 1, max: 100000000 },
  { group: "roulette", section: "Round", key: "ROULETTE_TIMER", label: "Time to bet", hint: "Starts with the first bet of a round.", unit: "s", scale: 1000, step: 1, min: 3, max: 120 },
  { group: "blackjack", section: "Blackjack", key: "GAME_BLACKJACK", type: "toggle", label: "Blackjack is on", hint: "Off: no tab, nobody can open it." },
  { group: "blackjack", section: "Seats", key: "BJ_MY_SEATS", season: true, label: "Seats per player", hint: "At one table at a time.", step: 1, min: 1, max: 5 },
  { group: "blackjack", section: "Casual Corner", key: "BJ_CASUAL_MIN", season: true, label: "Min bet", hint: "Per seat.", step: 10, min: 1, max: 100000000 },
  { group: "blackjack", section: "Casual Corner", key: "BJ_CASUAL_MAX", season: true, label: "Max bet", hint: "Per seat.", step: 50, min: 1, max: 100000000 },
  { group: "blackjack", section: "Classic Table", key: "BJ_CLASSIC_MIN", season: true, label: "Min bet", hint: "Per seat.", step: 50, min: 1, max: 100000000 },
  { group: "blackjack", section: "Classic Table", key: "BJ_CLASSIC_MAX", season: true, label: "Max bet", hint: "Per seat.", step: 100, min: 1, max: 100000000 },
  { group: "blackjack", section: "High Roller", key: "BJ_HIGH_MIN", season: true, label: "Min bet", hint: "Per seat.", step: 100, min: 1, max: 100000000 },
  { group: "blackjack", section: "High Roller", key: "BJ_HIGH_MAX", season: true, label: "Max bet", hint: "Per seat.", step: 500, min: 1, max: 100000000 },
];

const BY_KEY = new Map(FIELDS.map((field) => [field.key, field]));
// The values before any change (for "reset to default")
const DEFAULTS = Object.fromEntries(FIELDS.map((field) => [field.key, config[field.key]]));

function shown(field, value) {
  return field.scale ? value / field.scale : value;
}

// Every field with its value now and its default, as the admin panel shows them
function list() {
  return FIELDS.map((field) => ({
    group: field.group,
    type: field.type || "number",
    section: field.section,
    key: field.key,
    label: field.label,
    hint: field.hint || null,
    unit: field.unit || null,
    step: field.step || 1,
    scope: field.scope || "always",
    min: field.min,
    max: field.max,
    options: field.type === "cases" ? cases.CASES.map((box) => ({ value: box.id, label: box.name, icon: box.icon, price: box.price, risk: box.risk })) : field.options || null,
    value: shown(field, config[field.key]),
    default: shown(field, DEFAULTS[field.key]),
    season: field.season === true,
    seasonValue: field.season && config.SEASON_LIMITS[field.key] != null ? shown(field, config.SEASON_LIMITS[field.key]) : null,
  }));
}

// The value of a key in a world ("/season": its own one if it has one)
function valueIn(world, key) {
  if (world === "/season" && config.SEASON_LIMITS && config.SEASON_LIMITS[key] != null) return config.SEASON_LIMITS[key];
  return config[key];
}

// What does not fit together (min over max, ...) in values (the normal ones or the season's), null: fine
function mismatch(next, prefix = "") {
  for (const table of config.BJ_TABLES) {
    if (next[table.minKey] > next[table.maxKey]) return `${prefix}${table.name}: the min bet is higher than the max bet.`;
  }
  if (next.SLOTS_MIN_BET > next.SLOTS_MAX_BET) return `${prefix}Slots: the min bet is higher than the max bet.`;
  if (next.ROULETTE_MIN_BET > next.ROULETTE_MAX_BET) return `${prefix}Roulette: the min bet is higher than the max bet.`;
  if (next.JACKPOT_GHOST_MIN > next.JACKPOT_GHOST_TOP) return `${prefix}Ghost: the share from is higher than the share up to.`;
  if (next.POKER_MIN_BUYIN > next.POKER_MAX_BUYIN) return `${prefix}Poker: the min buy-in is higher than the max buy-in.`;
  return null;
}

// {KEY: shown value} -> {values} or {error}; nothing changes on an error
function check(input) {
  if (input == null || typeof input !== "object") return { error: "No values." };
  const values = {};
  for (const [key, value] of Object.entries(input)) {
    const field = BY_KEY.get(key);
    if (field == null) return { error: `Unknown setting ${key}.` };
    if (field.type === "toggle") {
      if (typeof value !== "boolean") return { error: `${field.label}: on or off.` };
      values[key] = value;
      continue;
    }
    if (field.type === "cases") {
      if (!Array.isArray(value) || !value.every((id) => typeof id === "string" && cases.caseById(id))) return { error: `${field.label}: unknown case.` };
      if (cases.CASES.every((box) => value.includes(box.id))) return { error: "At least one case stays on (or turn case battles off)." };
      values[key] = [...new Set(value)];
      continue;
    }
    if (field.type === "choice") {
      if (!field.options.some((option) => option.value === value)) return { error: `${field.label}: one of ${field.options.map((o) => o.label).join(", ")}.` };
      values[key] = value;
      continue;
    }
    if (!Number.isInteger(value) || value < field.min || value > field.max) {
      return { error: `${field.label}: a whole number from ${field.min.toLocaleString("en-US")} to ${field.max.toLocaleString("en-US")}.` };
    }
    values[key] = field.scale ? value * field.scale : value;
  }
  const next = { ...config, ...values };
  const wrong = mismatch(next) || mismatch({ ...next, ...config.SEASON_LIMITS }, "Season - ");
  if (wrong) return { error: wrong };
  return { values: values };
}

// The season's own values: {KEY: shown value | null (the normal one again)} -> {values} (all of the season's) or {error}
function checkSeason(input) {
  if (input == null || typeof input !== "object") return { error: "No values." };
  const values = { ...config.SEASON_LIMITS };
  for (const [key, value] of Object.entries(input)) {
    const field = BY_KEY.get(key);
    if (field == null || field.season !== true) return { error: `${field ? field.label : key}: the season has no own value for it.` };
    if (value == null || value === "") {
      delete values[key];
      continue;
    }
    if (!Number.isInteger(value) || value < field.min || value > field.max) {
      return { error: `Season - ${field.label}: a whole number from ${field.min.toLocaleString("en-US")} to ${field.max.toLocaleString("en-US")}.` };
    }
    values[key] = field.scale ? value * field.scale : value;
  }
  const wrong = mismatch({ ...config, ...values }, "Season - ");
  if (wrong) return { error: wrong };
  return { values: values };
}

// The changed values (only the ones that differ from the default are stored) and the season's own ones
async function save() {
  const same = (field) => (field.type === "cases" ? JSON.stringify(config[field.key]) === JSON.stringify(DEFAULTS[field.key]) : config[field.key] === DEFAULTS[field.key]);
  const changed = Object.fromEntries(FIELDS.filter((field) => !same(field)).map((field) => [field.key, config[field.key]]));
  if (Object.keys(config.SEASON_LIMITS).length > 0) changed.SEASON_LIMITS = config.SEASON_LIMITS;
  await Setting.updateOne({ key: KEY }, { $set: { value: changed } }, { upsert: true });
}

async function update(input) {
  const result = check(input);
  if (result.error) return result;
  Object.assign(config, result.values);
  await save();
  changes.emit("change", result.values);
  return { settings: list() };
}

async function updateSeason(input) {
  const result = checkSeason(input);
  if (result.error) return result;
  config.SEASON_LIMITS = result.values;
  await save();
  changes.emit("change", { SEASON_LIMITS: result.values });
  return { settings: list() };
}

// season: true - only the season's own values go (the normal ones count there again)
async function resetToDefaults(options = {}) {
  if (options.season) {
    config.SEASON_LIMITS = {};
    await save();
    changes.emit("change", { SEASON_LIMITS: {} });
    return { settings: list() };
  }
  Object.assign(config, DEFAULTS);
  await save();
  changes.emit("change", { ...DEFAULTS });
  return { settings: list() };
}

// The server starts: the stored values again
async function load() {
  const row = await Setting.findOne({ key: KEY }).lean();
  if (row == null || row.value == null || typeof row.value !== "object") return;
  for (const [key, value] of Object.entries(row.value)) {
    if (key === "SEASON_LIMITS") {
      if (value && typeof value === "object") {
        config.SEASON_LIMITS = Object.fromEntries(Object.entries(value).filter(([k, v]) => BY_KEY.has(k) && BY_KEY.get(k).season === true && Number.isInteger(v)));
      }
      continue;
    }
    const field = BY_KEY.get(key);
    if (field && field.type === "cases") {
      if (Array.isArray(value)) config[key] = value.filter((id) => cases.caseById(id));
      continue;
    }
    const fits = field && (field.type === "toggle" ? typeof value === "boolean" : field.type === "choice" ? field.options.some((option) => option.value === value) : Number.isInteger(value));
    if (fits) config[key] = value;
  }
}

module.exports = { list, update, updateSeason, resetToDefaults, load, valueIn, FIELDS, changes };
