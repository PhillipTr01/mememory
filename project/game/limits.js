const config = require("./config");

/*
 * The limits of a world (bets, buy-ins, seats, the max bet by balance): the
 * season world has its own ones where the admin set some
 * (config.SEASON_LIMITS, game/settings.js) - everything else is config.
 * forWorld(world).KEY reads like config.KEY.
 */
const season = new Proxy(config, {
  get(target, key) {
    const own = target.SEASON_LIMITS;
    return own && typeof key === "string" && own[key] != null ? own[key] : target[key];
  },
});

function forWorld(world) {
  return world === "/season" || world === "season" ? season : config;
}

// A game with its own share of the cap: slots spin far faster than the tables (1/x of the floor and of the share)
const DIVIDERS = { slots: "SLOTS_CAP_DIV" };

// How much of the cap a game gets: 1/x (1: all of it)
function dividerOf(world, game) {
  const key = DIVIDERS[game];
  const x = key ? Number(forWorld(world)[key]) : 1;
  return Number.isFinite(x) && x >= 1 ? x : 1;
}

// The rule ({floor, share} - null: no cap): everything up to the floor, above it share% of the balance
// (a game with its own share: both divided by its x). The pages work out what is left of a round themselves.
function capRule(world, game) {
  const limits = forWorld(world);
  if (!(limits.BET_CAP_SHARE < 100)) return null;
  const x = dividerOf(world, game);
  return { floor: Math.floor(limits.BET_CAP_FLOOR / x), share: limits.BET_CAP_SHARE / x };
}

// Up to the next 100 (a whole 100 stays)
function roundUp(value) {
  return Math.ceil(Math.round(value * 1000) / 1000 / 100) * 100;
}

// The most one bet may take with this balance (Infinity: no cap)
function betCap(balance, world, game) {
  const rule = capRule(world, game);
  if (rule == null) return Infinity;
  // (the share rounded up to the next 100)
  return Math.max(rule.floor, roundUp((balance * rule.share) / 100));
}

// The game of a bet (the reason of the coin history): only games with their own share
function gameOfReason(reason) {
  return reason === "slots bet" ? "slots" : null;
}

module.exports = { forWorld, betCap, capRule, dividerOf, gameOfReason };
