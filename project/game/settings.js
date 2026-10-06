const Setting = require("../models/Setting");
const config = require("./config");

/*
 * Values the admin can change in the admin panel (Settings). They live in
 * config like every other value, a change is stored and comes back after a
 * restart. Times are stored in ms but shown in seconds (scale).
 */
const KEY = "admin:settings";

const FIELDS = [
  { section: "Coins", key: "START_COINS", label: "Start coins", hint: "What a newly approved player gets (plus every daily bonus missed since the first approval).", min: 0, max: 100000000 },
  { section: "Coins", key: "DAILY_BONUS", label: "Daily bonus", hint: "Free coins once a day for every player.", min: 0, max: 10000000 },
  { section: "Jackpot", key: "JACKPOT_MAX_COINS", label: "Max coins per round", hint: "All bets of one player in one round together.", min: 1, max: 100000000 },
  { section: "Jackpot", key: "JACKPOT_MAX_BETS", label: "Bets per round", hint: "Separate bets of one player in one round.", min: 1, max: 100 },
  { section: "Jackpot", key: "JACKPOT_GHOST_AFTER", label: "Ghost joins after", hint: "Alone in the pot this long: the 👻 joins.", unit: "s", scale: 1000, min: 1, max: 3600 },
  { section: "Jackpot", key: "JACKPOT_COUNTDOWN", label: "Countdown", hint: "From the second player to the draw.", unit: "s", scale: 1000, min: 5, max: 600 },
  { section: "Case battles", key: "BATTLE_MAX_CASES", label: "Max cases per battle", min: 1, max: 1000 },
  { section: "Case battles", key: "BATTLE_MAX_OPEN", label: "Open battles per player", min: 1, max: 50 },
  { section: "Blackjack", key: "BJ_CASUAL_MIN", label: "Casual Corner: min bet", hint: "Per seat.", min: 1, max: 100000000 },
  { section: "Blackjack", key: "BJ_CASUAL_MAX", label: "Casual Corner: max bet", hint: "Per seat.", min: 1, max: 100000000 },
  { section: "Blackjack", key: "BJ_CLASSIC_MIN", label: "Classic Table: min bet", hint: "Per seat.", min: 1, max: 100000000 },
  { section: "Blackjack", key: "BJ_CLASSIC_MAX", label: "Classic Table: max bet", hint: "Per seat.", min: 1, max: 100000000 },
  { section: "Blackjack", key: "BJ_HIGH_MIN", label: "High Roller: min bet", hint: "Per seat.", min: 1, max: 100000000 },
  { section: "Blackjack", key: "BJ_HIGH_MAX", label: "High Roller: max bet", hint: "Per seat.", min: 1, max: 100000000 },
  { section: "Blackjack", key: "BJ_MY_SEATS", label: "Seats per player", min: 1, max: 5 },
  { section: "Poker", key: "POKER_MIN_BUYIN", label: "Min buy-in", min: 1, max: 100000000 },
  { section: "Poker", key: "POKER_MAX_BUYIN", label: "Max buy-in", min: 1, max: 100000000 },
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
    section: field.section,
    key: field.key,
    label: field.label,
    hint: field.hint || null,
    unit: field.unit || null,
    min: field.min,
    max: field.max,
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
    if (!Number.isInteger(value) || value < field.min || value > field.max) {
      return { error: `${field.label}: a whole number from ${field.min.toLocaleString("en-US")} to ${field.max.toLocaleString("en-US")}.` };
    }
    values[key] = field.scale ? value * field.scale : value;
  }
  const next = { ...config, ...values };
  for (const table of config.BJ_TABLES) {
    if (next[table.minKey] > next[table.maxKey]) return { error: `${table.name}: the min bet is higher than the max bet.` };
  }
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
  return { settings: list() };
}

async function resetToDefaults() {
  Object.assign(config, DEFAULTS);
  await save();
  return { settings: list() };
}

// The server starts: the stored values again
async function load() {
  const row = await Setting.findOne({ key: KEY }).lean();
  if (row == null || row.value == null || typeof row.value !== "object") return;
  for (const [key, value] of Object.entries(row.value)) if (BY_KEY.has(key) && Number.isInteger(value)) config[key] = value;
}

module.exports = { list, update, resetToDefaults, load, FIELDS };
