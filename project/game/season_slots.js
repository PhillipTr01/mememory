/*
 * Two seasons can run at the same time (game/seasons.js) - e.g. one for
 * everybody and one only for a whitelist. Each running season gets a slot: a
 * world of its own (game/worlds.js), its own wallet on the user (coins.js),
 * its own games (persist keys), its own leaderboard. A player can be in both
 * and switches between the worlds.
 *
 * The first slot keeps the names from the time there was only one season
 * ("/season", user.seasonCoins, ...) - nothing stored has to move.
 *
 * Nothing is required here: everything may require this module.
 */
const SLOTS = [
  {
    key: "season",
    world: "/season",
    fields: { coins: "seasonCoins", reset: "seasonReset", bonusAt: "seasonBonusAt", streak: "seasonStreak" },
    prefix: "season/",
    board: "leaderboard:season",
  },
  {
    key: "season2",
    world: "/season2",
    fields: { coins: "season2Coins", reset: "season2Reset", bonusAt: "season2BonusAt", streak: "season2Streak" },
    prefix: "season2/",
    board: "leaderboard:season2",
  },
];
const KEYS = SLOTS.map((slot) => slot.key);
const WORLDS = SLOTS.map((slot) => slot.world);

// The slot of a key ("season2") or a world ("/season2") - null: none (the normal casino, the test world)
function of(value) {
  if (value == null) return null;
  if (typeof value === "object" && KEYS.includes(value.key)) return value;
  return SLOTS.find((slot) => slot.key === value || slot.world === value) || null;
}

const isSeason = (value) => of(value) != null;

// The season running in a slot right now (its id) - game/seasons.js keeps it up to date
const current = {};
function setCurrent(key, id) {
  if (id == null) delete current[key];
  else current[key] = id;
}
const seasonIdOf = (value) => {
  const slot = of(value);
  return slot ? (current[slot.key] ?? null) : null;
};

module.exports = { SLOTS, KEYS, WORLDS, of, isSeason, setCurrent, seasonIdOf };
