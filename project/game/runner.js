const config = require("./config");
const engine = require("../public/scripts/runner_engine");

/*
 * The runner's payout: the entry times a multiplier of the meters run - every coin picked up adds RUNNER_COIN_BONUS
 * to it (up to RUNNER_COIN_CAP): coins make a good run better, a run that pays nothing stays at nothing.
 * Below RUNNER_MIN (a share of the break-even score) nothing, up to RUNNER_EVEN it grows to 1x (the entry
 * back), above it RUNNER_SLOPE more per break-even distance - up to RUNNER_MAX. Steep below, gentle above:
 * a good player gets more out of a run, but only very good ones come out ahead.
 */
function multiplier(score) {
  const even = Math.max(1, config.RUNNER_EVEN);
  if (score < even * config.RUNNER_MIN) return 0;
  if (score < even) return Math.round((score / even) * 1000) / 1000;
  return Math.min(config.RUNNER_MAX, Math.round((1 + config.RUNNER_SLOPE * (score / even - 1)) * 1000) / 1000);
}

// What the coins add: 0.12 - 12% more
const coinBonus = (coins) => Math.min(config.RUNNER_COIN_CAP, Math.max(0, coins) * config.RUNNER_COIN_BONUS);

// (a practice run - no entry: nothing)
const payout = (stake, meters, coins = 0) => (stake > 0 ? Math.floor(stake * multiplier(meters) * (1 + coinBonus(coins))) : 0);

// What the page shows: the scores of a few multipliers (from where the payout starts up to the cap)
function table() {
  const even = config.RUNNER_EVEN;
  const top = Math.round(even * (1 + (config.RUNNER_MAX - 1) / Math.max(0.0001, config.RUNNER_SLOPE)));
  return { min: Math.ceil(even * config.RUNNER_MIN), even: even, max: config.RUNNER_MAX, top: top, minMult: Math.round(config.RUNNER_MIN * 100) / 100 };
}

module.exports = { engine, multiplier, coinBonus, payout, table };
