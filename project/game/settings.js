const EventEmitter = require("events");
const Setting = require("../models/Setting");
const config = require("./config");

// "change" ({KEY: value}) after the admin changed values (e.g. a game turned off)
const changes = new EventEmitter();

/*
 * Values the admin can change in the admin panel (Settings). They live in
 * config like every other value, a change is stored and comes back after a
 * restart. Times are stored in ms but shown in seconds (scale).
 */
const KEY = "admin:settings";

// group: the page of the admin panel (general or a game), section: a card on it.
// type "toggle": on / off (a game), "choice": one of `options` ({value, label}), everything else a whole number.
const FIELDS = [
  { group: "general", section: "Coins", key: "START_COINS", label: "Start coins", hint: "What a newly approved player gets (in a season: the season's budget plus every daily bonus missed since it started).", min: 0, max: 100000000 },
  { group: "general", section: "Coins", key: "DAILY_BONUS", label: "Daily bonus", hint: "Free coins once a day for every player.", min: 0, max: 10000000 },
  { group: "jackpot", section: "Jackpot", key: "GAME_JACKPOT", type: "toggle", label: "Jackpot is on", hint: "Off: no tab, nobody can open it." },
  { group: "jackpot", section: "Bets", key: "JACKPOT_MAX_COINS", label: "Max coins per round", hint: "All bets of one player in one round together.", min: 1, max: 100000000 },
  { group: "jackpot", section: "Bets", key: "JACKPOT_MAX_BETS", label: "Bets per round", hint: "Separate bets of one player in one round.", min: 1, max: 100 },
  { group: "jackpot", section: "Timing", key: "JACKPOT_GHOST_AFTER", label: "Ghost joins after", hint: "Alone in the pot this long: the 👻 joins.", unit: "s", scale: 1000, min: 1, max: 3600 },
  { group: "jackpot", section: "Timing", key: "JACKPOT_COUNTDOWN", label: "Countdown", hint: "From the second player to the draw.", unit: "s", scale: 1000, min: 5, max: 600 },
  { group: "battles", section: "Case battles", key: "GAME_BATTLES", type: "toggle", label: "Case battles are on", hint: "Off: no tab, nobody can open it." },
  { group: "battles", section: "Battles", key: "BATTLE_MAX_CASES", label: "Max cases per battle", min: 1, max: 1000 },
  { group: "battles", section: "Battles", key: "BATTLE_MAX_OPEN", label: "Open battles per player", min: 1, max: 50 },
  { group: "poker", section: "Poker", key: "GAME_POKER", type: "toggle", label: "Poker is on", hint: "Off: no tab, nobody can open it." },
  { group: "poker", section: "Buy-in", key: "POKER_MIN_BUYIN", label: "Min buy-in", min: 1, max: 100000000 },
  { group: "poker", section: "Buy-in", key: "POKER_MAX_BUYIN", label: "Max buy-in", min: 1, max: 100000000 },
  { group: "slots", section: "Slots", key: "GAME_SLOTS", type: "toggle", label: "Slots are on", hint: "Off: no tab, nobody can open it." },
  { group: "slots", section: "Bets", key: "SLOTS_MIN_BET", label: "Min bet per spin", hint: "For all 9 lines together.", min: 9, max: 100000000 },
  { group: "slots", section: "Testing", key: "SLOTS_TEST_BONUS", type: "choice", label: "Every spin starts a bonus", hint: "For testing only: every spin of every player gets this bonus game. Turn it off again afterwards!", options: [{ value: "off", label: "Off" }, { value: "free", label: "🎁 Free spins" }, { value: "coins", label: "🪙 Coin game" }] },
  { group: "slots", section: "Bets", key: "SLOTS_MAX_BET", label: "Max bet per spin", hint: "For all 9 lines together.", min: 9, max: 100000000 },
  { group: "blackjack", section: "Blackjack", key: "GAME_BLACKJACK", type: "toggle", label: "Blackjack is on", hint: "Off: no tab, nobody can open it." },
  { group: "blackjack", section: "Seats", key: "BJ_MY_SEATS", label: "Seats per player", hint: "At one table at a time.", min: 1, max: 5 },
  { group: "blackjack", section: "Casual Corner", key: "BJ_CASUAL_MIN", label: "Min bet", hint: "Per seat.", min: 1, max: 100000000 },
  { group: "blackjack", section: "Casual Corner", key: "BJ_CASUAL_MAX", label: "Max bet", hint: "Per seat.", min: 1, max: 100000000 },
  { group: "blackjack", section: "Classic Table", key: "BJ_CLASSIC_MIN", label: "Min bet", hint: "Per seat.", min: 1, max: 100000000 },
  { group: "blackjack", section: "Classic Table", key: "BJ_CLASSIC_MAX", label: "Max bet", hint: "Per seat.", min: 1, max: 100000000 },
  { group: "blackjack", section: "High Roller", key: "BJ_HIGH_MIN", label: "Min bet", hint: "Per seat.", min: 1, max: 100000000 },
  { group: "blackjack", section: "High Roller", key: "BJ_HIGH_MAX", label: "Max bet", hint: "Per seat.", min: 1, max: 100000000 },
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
    min: field.min,
    max: field.max,
    options: field.options || null,
    value: shown(field, config[field.key]),
    default: shown(field, DEFAULTS[field.key]),
  }));
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
  for (const table of config.BJ_TABLES) {
    if (next[table.minKey] > next[table.maxKey]) return { error: `${table.name}: the min bet is higher than the max bet.` };
  }
  if (next.SLOTS_MIN_BET > next.SLOTS_MAX_BET) return { error: "Slots: the min bet is higher than the max bet." };
  if (next.POKER_MIN_BUYIN > next.POKER_MAX_BUYIN) return { error: "Poker: the min buy-in is higher than the max buy-in." };
  return { values: values };
}

// The changed values (only the ones that differ from the default are stored)
async function save() {
  const changed = Object.fromEntries(FIELDS.filter((field) => config[field.key] !== DEFAULTS[field.key]).map((field) => [field.key, config[field.key]]));
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

async function resetToDefaults() {
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
    const field = BY_KEY.get(key);
    const fits = field && (field.type === "toggle" ? typeof value === "boolean" : field.type === "choice" ? field.options.some((option) => option.value === value) : Number.isInteger(value));
    if (fits) config[key] = value;
  }
}

module.exports = { list, update, resetToDefaults, load, FIELDS, changes };
