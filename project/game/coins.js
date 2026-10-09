const EventEmitter = require("events");
const User = require("../models/User");
const CoinLog = require("../models/CoinLog");
const config = require("./config");
const days = require("./days");
const limits = require("./limits");

// Bets (every game): one may take at most limits.betCap of the balance - more only with options.nocap (a double, a split)
const BET_REASONS = ["jackpot bet", "battle", "poker buy-in", "poker chips", "blackjack bet", "slots bet", "roulette bet", "baucua bet"];

/*
 * "change" (username) after every change of a balance: every page that shows
 * coins (jackpot, case battles) gets the new balance, whichever page (or game)
 * changed it.
 */
const changes = new EventEmitter();
changes.setMaxListeners(0);

function notify(username) {
  changes.emit("change", username);
}

/*
 * Two worlds, two wallets (see game/worlds.js): the normal casino (the 🪙,
 * user.coins) and the season world (the season's coins, user.seasonCoins -
 * only while a season runs, only for who joined it). Nothing goes from one
 * to the other - only at the end of a season its coins go to the normal
 * wallet (game/seasons.js). The module itself is the normal wallet;
 * coins.season the season's, coins.wallet(world) the one of a world.
 */
const FIELDS = {
  normal: { coins: "coins", reset: "coinReset", bonusAt: "coinBonusAt" },
  season: { coins: "seasonCoins", reset: "seasonReset", bonusAt: "seasonBonusAt" },
};

// History of every change (for the admin panel); never blocks or breaks a game
// era: the season's coins are tagged with it - the normal history has none
function writeLog(username, amount, reason, note, era) {
  Promise.resolve()
    .then(() => CoinLog.create({ username: username, amount: amount, reason: reason || "other", note: note, at: new Date(), ...(era ? { era: era } : {}) }))
    .catch((error) => console.error("[coins] Could not write the history:", error));
}

function changed(result) {
  return result != null && (result.nModified > 0 || result.modifiedCount > 0);
}

/*
 * The running season (game/seasons.js): {reset: "season-<id>", start, budget,
 * bonus, since, active} - its coins only count with this reset.
 */
let seasonBase = null;

function setBase(value) {
  seasonBase = value && typeof value.reset === "string" ? value : null;
}

// The normal start coins: config.COIN_RESET / START_COINS
function base() {
  return { reset: config.COIN_RESET, start: config.START_COINS, since: null };
}

// The running season (its reset id) - null without one
function era() {
  return seasonBase && seasonBase.active ? seasonBase.reset : null;
}

// The normal coin history (the season's has its era)
function eraFilter() {
  return { era: { $exists: false } };
}

// In the running season: did the player join it (game/seasons.js sets the lookup)? null: no season
let joinedLookup = () => null;
function setJoinedLookup(lookup) {
  joinedLookup = lookup;
}
// When the player joined the running season (game/seasons.js sets the lookup) - null: no season
let joinedAtLookup = () => null;
function setJoinedAtLookup(lookup) {
  joinedAtLookup = lookup;
}
// The wager for a place on the season's leaderboard: {done, need} (game/seasons.js sets the lookup)
let wagerLookup = async () => null;
function setWagerLookup(lookup) {
  wagerLookup = lookup;
}

// (old: the balance from before a season - the normal wallet is apart now, nothing to look up)
function setStoredLookup() {}

// (required when needed: test_mode has no requires, but keeps the load order simple)
const testMode = () => require("./test_mode");

/*
 * While the server starts, the coins wait: the running season (its reset, its
 * start coins) is only known once it is loaded. app.js holds them until the
 * season is loaded.
 */
let gate = Promise.resolve();
let openGate = null;
function hold() {
  if (openGate) return;
  gate = new Promise((resolve) => (openGate = resolve));
}
function release() {
  if (openGate) openGate();
  openGate = null;
}

// Time (ms) until the next free coins can be claimed (0: now) - once per calendar day, new ones at midnight
function bonusInAt(bonusAt, now = Date.now()) {
  if (bonusAt == null) return 0;
  const claimed = new Date(bonusAt).getTime();
  if (claimed < days.dayStart(now)) return 0;
  return Math.max(0, days.nextDay(now) - now);
}

// When a player last spent coins (a bet): for a moment the coins count as in a game - until the game has them
const spentAt = new Map();
function lastSpent(username) {
  return spentAt.get(username) || 0;
}

function makeWallet(kind) {
  const f = FIELDS[kind];
  const season = kind === "season";

  // The start of this wallet: normal - the start coins; season - 0 (the budget comes with joining)
  const walletBase = () => (season ? seasonBase || { reset: "no-season", start: 0, since: null } : base());
  const walletEra = () => (season ? era() : null);
  const log = (username, amount, reason, note) => writeLog(username, amount, reason, note, walletEra());

  // Not joined the running season: watching only (no coins, no daily bonus)
  function watching(username) {
    if (!season) return false;
    return (era() == null || joinedLookup(username) !== true) && !testMode().active(username);
  }

  // The free coins of the day: the season's - or the setting
  function dailyBonus() {
    if (season && seasonBase && Number.isInteger(seasonBase.bonus)) return seasonBase.bonus;
    return config.DAILY_BONUS;
  }

  // The balance as the player sees it (accounts from before a reset get the start coins)
  function balanceOf(user) {
    const now = walletBase();
    return user[f.reset] === now.reset ? user[f.coins] || 0 : now.start;
  }

  /*
   * Approved players get the start coins once more after a reset of all coins
   * (base().reset): the reset field remembers the last reset they got. In the
   * season: who joined it (0 - the budget comes with joining).
   */
  async function ensure(username) {
    await gate;
    const now = walletBase();
    const reset = await User.updateOne({ username: username, casinoApproved: true, [f.reset]: { $ne: now.reset } }, { $set: { [f.coins]: now.start, [f.reset]: now.reset } });
    if (changed(reset) && now.start > 0) log(username, now.start, "start coins");
  }

  // In a season the daily bonuses add up - nobody misses one: every day since the last claim
  // (or since joining the season), today's included. Normal: today's.
  function bonusDays(user, now = Date.now()) {
    if (!season || era() == null || user == null) return 1;
    const last = user[f.bonusAt] ? new Date(user[f.bonusAt]).getTime() : null;
    const joined = joinedAtLookup(user.username);
    const from = last != null ? days.dayNumber(last) + 1 : joined != null ? days.dayNumber(joined) : days.dayNumber(now);
    return Math.max(1, days.dayNumber(now) - from + 1);
  }

  // (the season's bonus counts only this season: an older claim is from another season)
  function bonusAtOf(user) {
    if (user == null) return null;
    if (season && user[f.reset] !== walletBase().reset) return null;
    return user[f.bonusAt] || null;
  }

  function bonusAvailable(user, now = Date.now()) {
    return user != null && bonusInAt(bonusAtOf(user), now) === 0;
  }

  function bonusDue(user, now = Date.now()) {
    return dailyBonus() * bonusDays(user, now);
  }

  // The most one bet may take with this balance (null: no cap) - the pages use it for their "Max"
  function capFor(balance) {
    const cap = limits.betCap(balance, kind);
    return Number.isFinite(cap) ? cap : null;
  }

  // { coins, bonus, bonusIn, payout, world, betCap } - bonus: the daily free coins can be claimed now, payout: may pay coins out
  // (in the season: normal - the normal balance, shown next to the season's)
  async function get(username) {
    // Test mode (the admin): the sandbox - the real balance stays as it is
    if (testMode().active(username)) {
      const balance = testMode().balance(username);
      return { coins: balance, bonus: true, bonusIn: 0, bonusAmount: dailyBonus(), payout: false, normal: null, world: kind, joined: null, test: true, betCap: limits.betCap(balance, "normal") === Infinity ? null : limits.betCap(balance, "normal"), betCapRule: limits.capRule("normal") };
    }
    // (after a restart: the season is known first)
    await gate;
    if (season && watching(username)) {
      return { coins: 0, bonus: false, bonusIn: days.nextDay() - Date.now(), bonusAmount: dailyBonus(), payout: false, normal: null, world: kind, joined: false };
    }
    await ensure(username);
    const user = await User.findOne({ username: username }).select(["username", f.coins, f.reset, f.bonusAt, "payoutAllowed", ...(season ? ["coins", "coinReset"] : [])].join(" "));
    if (user == null) return { coins: 0, bonus: false, bonusIn: days.nextDay() - Date.now(), payout: false, world: kind };
    const available = bonusAvailable(user);
    return {
      coins: user[f.coins] || 0,
      betCap: capFor(user[f.coins] || 0),
      betCapRule: limits.capRule(kind),
      bonus: available,
      bonusIn: bonusInAt(bonusAtOf(user)),
      bonusAmount: available ? bonusDue(user) : dailyBonus(),
      // (payouts: only the normal coins)
      payout: !season && user.payoutAllowed === true,
      normal: season ? normalWallet.balanceOf(user) : null,
      wager: season ? await wagerLookup(username).catch(() => null) : null,
      world: kind,
      joined: season ? true : null,
    };
  }

  /*
   * options.reason: why (for the history), options.note: more about it,
   * options.quiet: the pages are told later with notify() (a win that is shown after an animation)
   */
  async function add(username, amount, options) {
    if (!Number.isInteger(amount) || amount <= 0) return false;
    options = options || {};
    if (testMode().active(username)) {
      testMode().add(username, amount);
      if (!options.quiet) notify(username);
      return true;
    }
    if (watching(username)) return false;
    await ensure(username);
    const done = changed(await User.updateOne({ username: username }, { $inc: { [f.coins]: amount } }));
    if (done) log(username, amount, options.reason, options.note);
    if (done && !options.quiet) notify(username);
    return done;
  }

  // Why the last spend of a player was refused, if not for too few coins (a bet over the max bet by balance)
  const refusals = new Map();
  function refusal(username) {
    const text = refusals.get(username) || null;
    refusals.delete(username);
    return text;
  }
  // cap: the most for the whole round, round: what is in already
  function capText(cap, round, world = kind) {
    const L = limits.forWorld(world);
    const why = `${L.BET_CAP_SHARE}% of your coins - all in only up to ${L.BET_CAP_FLOOR.toLocaleString("en-US")}`;
    if (round > 0) return `With your balance you can bet at most ${cap.toLocaleString("en-US")} coins per round (${why}) - ${round.toLocaleString("en-US")} are in already, ${Math.max(0, cap - round).toLocaleString("en-US")} more.`;
    return `With your balance a bet is at most ${cap.toLocaleString("en-US")} coins (${why}).`;
  }

  /*
   * Takes the coins only if the user has enough (false otherwise) - and, for a bet, not more than the max bet by
   * balance. options.round: the coins of the player already in this round (a pot, a table): the cap counts for the
   * round together - worked out from the balance before the round (what is left + what is in).
   */
  async function spend(username, amount, options) {
    if (!Number.isInteger(amount) || amount <= 0) return false;
    refusals.delete(username);
    const capped = BET_REASONS.includes(options && options.reason) && !(options && options.nocap);
    const round = capped ? Math.max(0, Math.floor(Number(options && options.round) || 0)) : 0;
    if (testMode().active(username)) {
      // (never coins of other players for test coins - the games check it too, with a message)
      if (testMode().BLOCKED_REASONS.includes(options && options.reason)) return false;
      const cap = capped ? limits.betCap(testMode().balance(username) + round, "normal") : Infinity;
      if (amount + round > cap) {
        refusals.set(username, capText(cap, round, "normal"));
        return false;
      }
      testMode().spend(username, amount);
      spentAt.set(username, Date.now());
      notify(username);
      return true;
    }
    if (watching(username)) return false;
    await ensure(username);
    // (the cap: round + amount <= share% of (balance + round) - or not over the floor)
    const L = limits.forWorld(kind);
    const total = amount + round;
    const need = capped && L.BET_CAP_SHARE < 100 && total > L.BET_CAP_FLOOR ? Math.max(amount, Math.ceil((total * 100) / L.BET_CAP_SHARE) - round) : amount;
    const done = changed(await User.updateOne({ username: username, [f.coins]: { $gte: need } }, { $inc: { [f.coins]: -amount } }));
    if (!done && need > amount) {
      const user = await User.findOne({ username: username }).select(f.coins).lean();
      const balance = user ? user[f.coins] || 0 : 0;
      if (balance >= amount) refusals.set(username, capText(limits.betCap(balance + round, kind), round));
    }
    if (done) {
      spentAt.set(username, Date.now());
      log(username, -amount, (options && options.reason) || "other", options && options.note);
      notify(username);
    }
    return done;
  }

  // The admin sets a balance (returns the new balance, null: no such user)
  async function set(username, amount, note) {
    if (!Number.isInteger(amount) || amount < 0) return null;
    await ensure(username);
    const user = await User.findOne({ username: username }).select(f.coins);
    if (user == null) return null;
    const before = user[f.coins] || 0;
    await User.updateOne({ username: username }, { $set: { [f.coins]: amount } });
    log(username, amount - before, "admin", note);
    notify(username);
    return amount;
  }

  // Free coins once a day (calendar day) - in a season the days not claimed on top.
  // Returns what was paid (0: nothing, already claimed today)
  async function claim(username, now = Date.now()) {
    // Test mode: the daily bonus as often as wanted (in the sandbox)
    if (testMode().active(username)) {
      testMode().add(username, dailyBonus());
      notify(username);
      return dailyBonus();
    }
    if (watching(username)) return 0;
    await ensure(username);
    const user = await User.findOne({ username: username }).select(["username", f.reset, f.bonusAt].join(" ")).lean();
    if (user == null || !bonusAvailable(user, now)) return 0;
    const count = bonusDays(user, now);
    const amount = dailyBonus() * count;
    const notToday = [{ [f.bonusAt]: { $exists: false } }, { [f.bonusAt]: null }, { [f.bonusAt]: { $lt: new Date(days.dayStart(now)) } }];
    // (the season's: a claim of another season doesn't count)
    if (season) notToday.push({ [f.reset]: { $ne: walletBase().reset } });
    const result = await User.updateOne({ username: username, $or: notToday }, { $inc: { [f.coins]: amount }, $set: { [f.bonusAt]: new Date(now) } });
    if (!changed(result)) return 0;
    log(username, amount, "daily bonus", count > 1 ? `${count} days` : undefined);
    notify(username);
    return amount;
  }

  async function claimBonus(username, now = Date.now()) {
    return (await claim(username, now)) > 0;
  }

  return { kind, fields: f, changes, notify, lastSpent, base: walletBase, era: walletEra, log, watching, dailyBonus, balanceOf, ensure, bonusAvailable, bonusDue, get, add, spend, refusal, set, claim, claimBonus };
}

const normalWallet = makeWallet("normal");
const seasonWallet = makeWallet("season");

// The wallet of a world (game/worlds.js): "/season" - the season's, everything else the normal one
function wallet(world) {
  return world === "/season" || world === "season" ? seasonWallet : normalWallet;
}

// Coins for a win in a game (never blocks or breaks the game)
function reward(username, mode) {
  const amount = config.COIN_REWARDS[mode];
  if (!amount) return;
  normalWallet.add(username, amount, { reason: "game win", note: mode }).catch((error) => console.error("[coins] Could not add coins:", error));
}

// Test mode started or stopped: the pages of the player get the balance (the sandbox - or the real one again)
testMode().changes.on("change", (username) => notify(username));
testMode().changes.on("coins", (username) => notify(username));

module.exports = {
  ...normalWallet,
  season: seasonWallet,
  wallet,
  lastSpent,
  hold,
  release,
  setJoinedAtLookup,
  setJoinedLookup,
  setStoredLookup,
  setWagerLookup,
  setBase,
  seasonBase: () => seasonBase,
  base,
  era,
  eraFilter,
  log: (username, amount, reason, note, options = {}) => writeLog(username, amount, reason, note, options.era || null),
  reward,
  changes,
  notify,
};
