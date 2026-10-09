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

// The most one bet may take with this balance: everything up to the floor, above it a share of the balance (Infinity: no cap)
function betCap(balance, world) {
  const limits = forWorld(world);
  if (!(limits.BET_CAP_SHARE < 100)) return Infinity;
  return Math.max(limits.BET_CAP_FLOOR, Math.floor((balance * limits.BET_CAP_SHARE) / 100));
}

// The rule for the pages ({floor, share} - null: no cap): they work out what is left of a round themselves
function capRule(world) {
  const limits = forWorld(world);
  return limits.BET_CAP_SHARE < 100 ? { floor: limits.BET_CAP_FLOOR, share: limits.BET_CAP_SHARE } : null;
}

module.exports = { forWorld, betCap, capRule };
