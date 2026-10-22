const Setting = require("../models/Setting");
const days = require("./days");
const slots = require("./season_slots");
const plays = require("./play_events");

/*
 * The season sandbox (admin panel, Seasons): what a season is built from beyond its coins.
 *
 * - games: the games of the season world (null: every game a season may have)
 * - currencies: up to MAX_CURRENCIES of the season's own ({id, name, icon, earn, milestones}) - given by
 *   goals, earned while playing (earn: {game, outcome, measure, per, amount}: `amount` for every `per`),
 *   spent in the season shop. milestones: a reward when this many were earned (a season pass).
 * - quests: goals made of steps, done one after the other. A step: {game, outcome, where, need,
 *   measure, inRow, next} - the plays of `game` that match `where` (conditions on what the game knows
 *   of a play, FIELDS) and `outcome` count towards `need` (plays, coins wagered, won, ...). inRow: a
 *   play that matches `where` but not `outcome` starts the step over; next: the first such play after
 *   the step before has to match, or the goal starts over. repeat: once, every day or every week.
 *   scope "everyone": one goal for all players together. hidden: secret until done. requires: another
 *   goal first. from / until: only then. reward: season coins, currencies, shop items, a badge.
 * - board: what the leaderboard counts - "coins", a currency or a stat (STATS)
 * - boosts: more coins on wins or more of a currency - always, at set hours, between two dates or in
 *   golden minutes (random moments every day); for a game, every game or the game of the day
 * - shop: offers bought with a currency
 * - teams: the players split up, a score per team, a reward for the best team at the end
 * - rules: {gifts} - may the players give each other coins
 *
 * The progress of every player is kept per season (Setting "season-kit:<id>").
 */
const MAX_CURRENCIES = 5;
const MAX_QUESTS = 50;
const MAX_STEPS = 6;
const MAX_WHERE = 6;
const REPEATS = ["once", "daily", "weekly"];
const OUTCOMES = ["any", "win", "loss", "even"];
const MEASURES = ["plays", "bet", "win", "profit", "loss"];
const NUMBER_OPS = ["eq", "ne", "gte", "lte", "gt", "lt"];
const CHOICE_OPS = ["eq", "ne"];

const opt = (ids, names = {}) => ids.map((id) => ({ id: id, name: names[id] || id.charAt(0).toUpperCase() + id.slice(1) }));
const YES = opt(["yes", "no"]);

// What a goal can ask of a play: on every game (COMMON) and per game. say: how the text of a goal
// writes it (prefix / suffix around "at least 5")
const COMMON = [
  { id: "bet", name: "Bet", type: "number", say: ["with a bet of", "coins"] },
  { id: "win", name: "Payout", type: "number", say: ["with a payout of", "coins"] },
  { id: "x", name: "Times the bet", type: "number", say: ["paying", "times the bet"] },
];
const FIELDS = {
  roulette: [
    { id: "on", name: "Bet on", type: "choice", options: opt(["red", "blue", "green"]), say: ["on", ""] },
    { id: "result", name: "Wheel shows", type: "choice", options: opt(["red", "blue", "green"]), say: ["when the wheel shows", ""] },
    { id: "number", name: "Number", type: "number", say: ["when the number is", ""] },
  ],
  baucua: [
    { id: "on", name: "Bet on", type: "choice", options: opt(["tiger", "gourd", "rooster", "fish", "crab", "shrimp"]), say: ["on the", ""] },
    { id: "hits", name: "Matching dice", type: "number", say: ["with", "matching dice"] },
  ],
  slots: [
    { id: "kind", name: "Result", type: "choice", options: opt(["nothing", "line", "free games", "coin game"]), say: ["with", ""] },
    { id: "symbol", name: "Best symbol", type: "choice", options: opt(["banana", "pepe", "doge", "money", "rocket", "diamond", "wild"]), say: ["with the best line of", ""] },
    { id: "count", name: "Line length", type: "number", say: ["with a line of", "symbols"] },
    { id: "buy", name: "Bonus buy", type: "choice", options: YES, yes: ["with a bonus buy", "without a bonus buy"] },
  ],
  blackjack: [
    { id: "kind", name: "Bet", type: "choice", options: opt(["hand", "side bet"]), say: ["with a", ""] },
    { id: "result", name: "Result", type: "choice", options: opt(["blackjack", "win", "push", "lose", "bust"]), say: ["ending in", ""] },
    { id: "doubled", name: "Doubled", type: "choice", options: YES, yes: ["after doubling", "without doubling"] },
    { id: "split", name: "Split", type: "choice", options: YES, yes: ["after a split", "without a split"] },
    { id: "side", name: "Side bet", type: "choice", options: opt(["pairs", "plus3"], { pairs: "Perfect Pairs", plus3: "21+3" }), say: ["on", ""] },
  ],
  jackpot: [
    { id: "chance", name: "Chance to win (%)", type: "number", say: ["with a chance of", "%"] },
    { id: "players", name: "Players", type: "number", say: ["with", "players"] },
    { id: "pot", name: "Pot", type: "number", say: ["with a pot of", "coins"] },
    { id: "ghost", name: "Against the ghost", type: "choice", options: YES, yes: ["against the ghost", "against other players"] },
  ],
  battles: [
    { id: "mode", name: "Mode", type: "choice", options: opt(["classic", "crazy", "jackpot", "bestof", "worstof"], { bestof: "Best of", worstof: "Worst of" }), say: ["in", "mode"] },
    { id: "players", name: "Players", type: "number", say: ["with", "players"] },
    { id: "teams", name: "Teams", type: "choice", options: YES, yes: ["in teams", "without teams"] },
  ],
  runner: [
    { id: "distance", name: "Distance (m)", type: "number", say: ["running", "m"] },
    { id: "pickups", name: "Coins picked up", type: "number", say: ["picking up", "coins"] },
  ],
  poker: [
    { id: "hand", name: "Hand", type: "choice", options: opt(["high card", "pair", "two pair", "three of a kind", "straight", "flush", "full house", "four of a kind", "straight flush"]), say: ["with", ""] },
    { id: "showdown", name: "Showdown", type: "choice", options: YES, yes: ["at the showdown", "without a showdown"] },
    { id: "folded", name: "Folded", type: "choice", options: YES, yes: ["after folding", "without folding"] },
  ],
};
const GAME_NAMES = { any: "any game", jackpot: "the jackpot", roulette: "roulette", baucua: "Bầu Cua", battles: "case battles", poker: "poker", blackjack: "blackjack", slots: "slots", runner: "the runner" };

const seasonGames = () => require("./games").GAMES.filter((game) => !game.noSeason);
const fieldsOf = (game) => [...COMMON, ...(FIELDS[game] || [])];

// What the leaderboard (and the teams) can count besides the coins and the currencies
const STATS = [
  { id: "wagered", name: "Coins wagered", icon: "🫴🏽" },
  { id: "won", name: "Coins won", icon: "💰" },
  { id: "profit", name: "Profit", icon: "📈" },
  { id: "plays", name: "Plays", icon: "🎲" },
  { id: "biggestWin", name: "Biggest win", icon: "🏆" },
  { id: "biggestX", name: "Biggest multiplier", icon: "✖️" },
  { id: "goals", name: "Goals done", icon: "🎯" },
  { id: "badges", name: "Badges", icon: "🏅" },
];
const BOOST_KINDS = ["winBonus", "currencyX"];
const BOOST_TIMES = ["always", "hours", "dates", "golden"];
const MAX_BOOSTS = 10;
const MAX_MILESTONES = 30;
const MAX_OFFERS = 20;
const MAX_TEAMS = 4;

// The building blocks for the admin panel
function catalog() {
  return {
    games: seasonGames().map((game) => ({ id: game.id, name: game.name, fields: (FIELDS[game.id] || []).map(({ say, yes, ...field }) => field) })),
    common: COMMON.map(({ say, ...field }) => field),
    outcomes: OUTCOMES,
    measures: MEASURES,
    repeats: REPEATS,
    stats: STATS,
    boostKinds: BOOST_KINDS,
    boostTimes: BOOST_TIMES,
    limits: { currencies: MAX_CURRENCIES, quests: MAX_QUESTS, steps: MAX_STEPS, where: MAX_WHERE, boosts: MAX_BOOSTS, milestones: MAX_MILESTONES, offers: MAX_OFFERS, teams: MAX_TEAMS },
  };
}

/* ---------- Checking what the admin built ---------- */

const short = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const iconOk = (icon) => icon.length > 0 && [...icon].length <= 4 && !/[<>&"'\s]/.test(icon);
const newId = () => Math.random().toString(36).slice(2, 10);
const idOk = (id) => typeof id === "string" && /^[a-z0-9]{1,16}$/.test(id);
const uniqueId = (wanted, taken) => {
  let id = idOk(wanted) ? wanted : newId();
  while (taken.some((other) => other.id === id) || id === "coins" || STATS.some((s) => s.id === id)) id = newId();
  return id;
};
const time = (value) => (value == null || value === "" ? null : Number(value));

function checkWhere(list, game, label) {
  if (list == null) return { where: [] };
  if (!Array.isArray(list) || list.length > MAX_WHERE) return { error: `${label}: at most ${MAX_WHERE} conditions.` };
  const where = [];
  for (const cond of list) {
    const field = fieldsOf(game).find((f) => f.id === (cond && cond.field));
    if (!field) return { error: `${label}: a condition that ${game === "any" ? "only one game" : "this game"} doesn't know.` };
    const ops = field.type === "number" ? NUMBER_OPS : CHOICE_OPS;
    const op = ops.includes(cond.op) ? cond.op : "eq";
    let value = cond.value;
    if (field.type === "number") {
      value = Number(value);
      if (!Number.isFinite(value) || value < 0 || value > 1e12) return { error: `${label}: ${field.name} needs a number.` };
    } else if (!field.options.some((o) => o.id === value)) return { error: `${label}: pick a value for ${field.name}.` };
    where.push({ field: field.id, op: op, value: value });
  }
  return { where: where };
}

function checkStep(step, label) {
  if (step == null || typeof step !== "object") return { error: `${label}: empty.` };
  const game = step.game == null || step.game === "" ? "any" : String(step.game);
  if (game !== "any" && !seasonGames().some((g) => g.id === game)) return { error: `${label}: unknown game.` };
  const outcome = OUTCOMES.includes(step.outcome) ? step.outcome : "any";
  const measure = MEASURES.includes(step.measure) ? step.measure : "plays";
  const need = Number(step.need);
  if (!Number.isInteger(need) || need < 1 || need > 1e12) return { error: `${label}: how many, 1 or more.` };
  const where = checkWhere(step.where, game, label);
  if (where.error) return where;
  return { step: { game: game, outcome: outcome, where: where.where, need: need, measure: measure, inRow: step.inRow === true, next: step.next === true } };
}

// A reward: season coins, currencies, shop items, a badge
function checkReward(reward, currencies, label) {
  const r = reward || {};
  const coins = r.coins == null || r.coins === "" ? 0 : Number(r.coins);
  if (!Number.isInteger(coins) || coins < 0 || coins > 1e9) return { error: `${label}: coins from 0 to 1,000,000,000.` };
  const cur = {};
  for (const [id, amount] of Object.entries(r.currencies || {})) {
    if (amount == null || amount === "" || Number(amount) === 0) continue;
    if (!currencies.some((c) => c.id === id)) return { error: `${label}: unknown currency.` };
    if (!Number.isInteger(Number(amount)) || Number(amount) < 0 || Number(amount) > 1e9) return { error: `${label}: a currency from 0 to 1,000,000,000.` };
    cur[id] = Number(amount);
  }
  const shop = require("./shop");
  const items = Array.isArray(r.items) ? [...new Set(r.items.map(String))].filter(Boolean) : [];
  if (items.some((id) => !shop.byId(id))) return { error: `${label}: unknown item.` };
  let badge = null;
  if (r.badge && (short(r.badge.name, 30) || short(r.badge.icon, 8))) {
    const icon = short(r.badge.icon, 8);
    const name = short(r.badge.name, 30);
    if (!iconOk(icon) || !name) return { error: `${label}: a badge needs an icon and a name.` };
    badge = { icon: icon, name: name };
  }
  return { reward: { coins: coins, currencies: cur, items: items, badge: badge } };
}

function checkBoost(b, label, currencies) {
  const kind = BOOST_KINDS.includes(b && b.kind) ? b.kind : "winBonus";
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount < 1 || amount > 1000) return { error: `${label}: from 1 to 1000%.` };
  const game = b.game == null || b.game === "" ? "any" : String(b.game);
  if (!["any", "daily"].includes(game) && !seasonGames().some((g) => g.id === game)) return { error: `${label}: unknown game.` };
  const currency = kind === "currencyX" ? String(b.currency || "") : null;
  if (kind === "currencyX" && currency !== "all" && !currencies.some((c) => c.id === currency)) return { error: `${label}: pick a currency.` };
  const w = b.when || {};
  const type = BOOST_TIMES.includes(w.type) ? w.type : "always";
  const when = { type: type };
  if (type === "hours") {
    when.from = Number(w.from);
    when.to = Number(w.to);
    if (![when.from, when.to].every((h) => Number.isInteger(h) && h >= 0 && h <= 24) || when.from === when.to) return { error: `${label}: hours from 0 to 24.` };
    when.days = Array.isArray(w.days) ? [...new Set(w.days.map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort() : [];
    if (when.days.length === 0) when.days = [0, 1, 2, 3, 4, 5, 6];
  } else if (type === "dates") {
    when.from = time(w.from);
    when.to = time(w.to);
    if (!Number.isFinite(when.from) || !Number.isFinite(when.to) || when.to <= when.from) return { error: `${label}: a start and an end after it.` };
  } else if (type === "golden") {
    when.times = Number(w.times);
    when.minutes = Number(w.minutes);
    if (!Number.isInteger(when.times) || when.times < 1 || when.times > 24) return { error: `${label}: 1 to 24 times a day.` };
    if (!Number.isInteger(when.minutes) || when.minutes < 1 || when.minutes > 60) return { error: `${label}: 1 to 60 minutes.` };
  }
  return { boost: { id: idOk(b.id) ? b.id : newId(), name: short(b.name, 40), icon: iconOk(short(b.icon, 8)) ? short(b.icon, 8) : "⚡", kind: kind, amount: amount, game: game, currency: currency, when: when } };
}

// {kit} - or {error}
function check(input) {
  const kit = input || {};
  // Games: none given or all of them - every game
  let games = null;
  if (Array.isArray(kit.games)) {
    const known = seasonGames().map((g) => g.id);
    games = [...new Set(kit.games.map(String))].filter((id) => known.includes(id));
    if (games.length === 0) return { error: "A season needs at least one game." };
    if (games.length === known.length) games = null;
  }
  // Currencies (first without their rewards: a milestone may give another currency)
  const currencies = [];
  const raw = Array.isArray(kit.currencies) ? kit.currencies : [];
  if (raw.length > MAX_CURRENCIES) return { error: `At most ${MAX_CURRENCIES} currencies.` };
  for (const c of raw) {
    const name = short(c && c.name, 20);
    const icon = short(c && c.icon, 8);
    if (!name) return { error: "A currency needs a name." };
    if (!iconOk(icon)) return { error: `The currency ${name} needs an icon (one emoji).` };
    const id = uniqueId(idOk(c.id) ? c.id : name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12), currencies);
    let earn = null;
    if (c.earn && c.earn.on) {
      const step = checkStep({ ...c.earn, need: 1 }, `Earning ${name}`);
      if (step.error) return step;
      const per = Number(c.earn.per);
      const amount = Number(c.earn.amount);
      if (!(per > 0) || per > 1e12) return { error: `Earning ${name}: "for every" needs a number.` };
      if (!Number.isInteger(amount) || amount < 1 || amount > 1e9) return { error: `Earning ${name}: how many, 1 or more.` };
      earn = { on: true, game: step.step.game, outcome: step.step.outcome, where: step.step.where, measure: step.step.measure, per: per, amount: amount };
    }
    currencies.push({ id: id, name: name, icon: icon, earn: earn, milestones: [] });
  }
  // The milestones of a currency (a season pass): a reward when this many were earned
  for (const [i, c] of raw.entries()) {
    const list = Array.isArray(c.milestones) ? c.milestones : [];
    if (list.length > MAX_MILESTONES) return { error: `${currencies[i].name}: at most ${MAX_MILESTONES} milestones.` };
    for (const m of list) {
      const at = Number(m && m.at);
      if (!Number.isInteger(at) || at < 1 || at > 1e12) return { error: `${currencies[i].name}: a milestone needs an amount.` };
      if (currencies[i].milestones.some((other) => other.at === at)) return { error: `${currencies[i].name}: two milestones at ${at}.` };
      const reward = checkReward(m.reward, currencies, `${currencies[i].name} milestone ${at}`);
      if (reward.error) return reward;
      currencies[i].milestones.push({ at: at, name: short(m.name, 40), reward: reward.reward });
    }
    currencies[i].milestones.sort((a, b) => a.at - b.at);
  }
  const quests = [];
  const list = Array.isArray(kit.quests) ? kit.quests : [];
  if (list.length > MAX_QUESTS) return { error: `At most ${MAX_QUESTS} goals.` };
  for (const [i, q] of list.entries()) {
    const label = `Goal ${i + 1}`;
    const icon = short(q && q.icon, 8) || "🎯";
    if (!iconOk(icon)) return { error: `${label}: one emoji as its icon.` };
    const steps = Array.isArray(q.steps) ? q.steps : [];
    if (steps.length < 1 || steps.length > MAX_STEPS) return { error: `${label}: 1 to ${MAX_STEPS} steps.` };
    const clean = [];
    for (const [j, s] of steps.entries()) {
      const step = checkStep(s, `${label}, step ${j + 1}`);
      if (step.error) return step;
      clean.push(step.step);
    }
    const reward = checkReward(q.reward, currencies, label);
    if (reward.error) return reward;
    const from = time(q.from);
    const until = time(q.until);
    if ((from != null && !Number.isFinite(from)) || (until != null && !Number.isFinite(until)) || (from != null && until != null && until <= from)) return { error: `${label}: the end comes after the start.` };
    quests.push({
      id: uniqueId(q.id, quests),
      name: short(q.name, 60),
      icon: icon,
      text: short(q.text, 300),
      repeat: REPEATS.includes(q.repeat) ? q.repeat : "once",
      // everyone: one goal for all players together - who helped gets the reward
      scope: q.scope === "everyone" ? "everyone" : "player",
      hidden: q.hidden === true,
      requires: typeof q.requires === "string" && q.requires ? q.requires : null,
      from: from,
      until: until,
      steps: clean,
      reward: reward.reward,
    });
  }
  for (const q of quests) if (q.requires && !quests.some((other) => other.id === q.requires && other !== q)) q.requires = null;
  const statOk = (id) => id === "coins" || currencies.some((c) => c.id === id) || STATS.some((s) => s.id === id);
  const board = kit.board == null || kit.board === "" ? "coins" : String(kit.board);
  if (!statOk(board)) return { error: "The leaderboard counts something unknown." };
  // Boosts: more coins on wins, more of a currency - always, at set hours, between two dates or in golden minutes
  const boosts = [];
  const rawBoosts = Array.isArray(kit.boosts) ? kit.boosts : [];
  if (rawBoosts.length > MAX_BOOSTS) return { error: `At most ${MAX_BOOSTS} boosts.` };
  for (const [i, b] of rawBoosts.entries()) {
    const boost = checkBoost(b || {}, `Boost ${i + 1}`, currencies);
    if (boost.error) return boost;
    boost.boost.id = uniqueId(boost.boost.id, boosts);
    boosts.push(boost.boost);
  }
  // The shop of the season: rewards for a currency
  const shop = [];
  const rawShop = Array.isArray(kit.shop) ? kit.shop : [];
  if (rawShop.length > MAX_OFFERS) return { error: `At most ${MAX_OFFERS} offers in the shop.` };
  for (const [i, o] of rawShop.entries()) {
    const label = `Offer ${i + 1}`;
    const currency = o && o.price && String(o.price.currency);
    const amount = Number(o && o.price && o.price.amount);
    if (!currencies.some((c) => c.id === currency)) return { error: `${label}: pick the currency it costs.` };
    if (!Number.isInteger(amount) || amount < 1 || amount > 1e12) return { error: `${label}: a price of 1 or more.` };
    const reward = checkReward(o.reward, currencies, label);
    if (reward.error) return reward;
    const r = reward.reward;
    if (!r.coins && !Object.keys(r.currencies).length && !r.items.length && !r.badge) return { error: `${label}: what does it give?` };
    const limit = o.limit == null || o.limit === "" ? 0 : Number(o.limit);
    if (!Number.isInteger(limit) || limit < 0 || limit > 1000) return { error: `${label}: how often, 0 (no limit) to 1000.` };
    shop.push({ id: uniqueId(o.id, shop), icon: iconOk(short(o.icon, 8)) ? short(o.icon, 8) : "🛍️", name: short(o.name, 40), price: { currency: currency, amount: amount }, reward: r, limit: limit });
  }
  // Teams: the players are split up when they first play - the team with the most wins a reward at the end
  let teams = null;
  if (kit.teams && kit.teams.on) {
    const rawTeams = Array.isArray(kit.teams.list) ? kit.teams.list : [];
    if (rawTeams.length < 2 || rawTeams.length > MAX_TEAMS) return { error: `Teams: 2 to ${MAX_TEAMS} teams.` };
    const listed = [];
    for (const t of rawTeams) {
      const name = short(t && t.name, 20);
      const icon = short(t && t.icon, 8);
      if (!name || !iconOk(icon)) return { error: "Teams: every team needs a name and an icon." };
      const color = /^#[0-9a-f]{6}$/i.test(String(t.color || "")) ? String(t.color).toLowerCase() : null;
      listed.push({ id: uniqueId(t.id, listed), name: name, icon: icon, color: color });
    }
    const score = kit.teams.score == null || kit.teams.score === "" ? "goals" : String(kit.teams.score);
    if (score === "coins" || !statOk(score)) return { error: "Teams: count a currency or a stat." };
    const reward = checkReward(kit.teams.reward, currencies, "The team reward");
    if (reward.error) return reward;
    teams = { on: true, list: listed, score: score, reward: reward.reward };
  }
  const rules = { gifts: !(kit.rules && kit.rules.gifts === false) };
  return { kit: { games: games, currencies: currencies, quests: quests, board: board, boosts: boosts, shop: shop, teams: teams, rules: rules } };
}

/* ---------- What the players read ---------- */

const format = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
const OP_WORDS = { eq: "", ne: "not ", gte: "at least ", lte: "at most ", gt: "more than ", lt: "less than " };

function condText(cond, game) {
  const field = fieldsOf(game).find((f) => f.id === cond.field);
  if (!field) return "";
  if (field.yes) return field.yes[(cond.value === "yes") !== (cond.op === "ne") ? 0 : 1];
  const value = field.type === "number" ? format(cond.value) : (field.options.find((o) => o.id === cond.value) || { name: cond.value }).name.toLowerCase();
  const words = field.type === "number" && cond.op === "eq" ? "exactly " : OP_WORDS[cond.op] || "";
  return [field.say[0], words + value, field.say[1]].filter(Boolean).join(" ").replace(/ %/, "%");
}

function stepText(step) {
  const n = format(step.need);
  const times = step.need === 1 ? "once" : `${n} times`;
  const verb = {
    plays: { any: `Play ${times}`, win: `Win ${times}`, loss: `Lose ${times}`, even: `Get your bet back ${times}` },
    bet: { any: `Wager ${n} coins` },
    win: { any: `Win ${n} coins` },
    profit: { any: `Make a profit of ${n} coins` },
    loss: { any: `Lose ${n} coins` },
  }[step.measure];
  const outcomeWords = { any: "", win: " on winning plays", loss: " on losing plays", even: " on even plays" };
  let text = verb[step.outcome] || verb.any + outcomeWords[step.outcome];
  text += ` in ${GAME_NAMES[step.game] || step.game}`;
  const conds = step.where.map((cond) => condText(cond, step.game)).filter(Boolean);
  if (conds.length) text += " " + conds.join(" and ");
  if (step.inRow && step.need > 1) text += " in a row";
  return text;
}

function questText(quest) {
  if (quest.text) return quest.text;
  const steps = quest.steps.map((step, i) => (i === 0 ? stepText(step) : (step.next ? "Right after that, " : "Then ") + stepText(step).charAt(0).toLowerCase() + stepText(step).slice(1)) + ".").join(" ");
  return quest.scope === "everyone" ? "All players together: " + steps.charAt(0).toLowerCase() + steps.slice(1) : steps;
}

function earnText(currency) {
  const e = currency.earn;
  const per = format(e.per);
  const what = { plays: `every ${e.per === 1 ? "play" : per + " plays"}`, bet: `every ${per} coins wagered`, win: `every ${per} coins won`, profit: `every ${per} coins of profit`, loss: `every ${per} coins lost` }[e.measure];
  const conds = e.where.map((cond) => condText(cond, e.game)).filter(Boolean);
  const outcome = { any: "", win: " on winning plays", loss: " on losing plays", even: " on even plays" }[e.outcome];
  return `You get ${format(e.amount)} ${currency.icon} for ${what}${outcome} in ${GAME_NAMES[e.game] || e.game}${conds.length ? " " + conds.join(" and ") : ""}.`;
}

const pad = (n) => String(n).padStart(2, "0");
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function boostText(season, boost) {
  const kit = kitOf(season);
  const where = boost.game === "daily" ? "in the game of the day" : boost.game === "any" ? "in every game" : "in " + (GAME_NAMES[boost.game] || boost.game);
  let what;
  if (boost.kind === "winBonus") what = `Wins ${where} pay ${format(boost.amount)}% more`;
  else {
    const c = boost.currency === "all" ? null : kit.currencies.find((cur) => cur.id === boost.currency);
    const x = 1 + boost.amount / 100;
    const many = x === 2 ? "twice as many" : `${format(x)} times as many`;
    what = `You earn ${many} ${c ? c.icon : "of every currency"} ${where}`;
  }
  const w = boost.when;
  if (w.type === "hours") {
    const allDays = w.days.length === 7;
    const dayText = allDays ? "every day" : w.days.length === 2 && w.days[0] === 5 && w.days[1] === 6 ? "on weekends" : "on " + w.days.map((d) => WEEKDAYS[d]).join(", ");
    if (w.from === 0 && w.to === 24) return `${what} ${dayText}.`;
    return `${what} ${dayText} from ${pad(w.from)}:00 to ${pad(w.to % 24)}:00.`;
  }
  if (w.type === "golden") return `${what} for ${w.minutes} minutes, ${w.times === 1 ? "once" : w.times + " times"} a day at a random moment.`;
  if (w.type === "dates") return `${what} for a while.`;
  return `${what}.`;
}

// What a reward is, as one line: "💎 5,000 · ⭐ 10 · Golden frame · 🏅 Hunter"
function rewardText(season, reward) {
  const kit = kitOf(season) || { currencies: [] };
  const shop = require("./shop");
  return [
    reward.coins > 0 ? `${season.coinIcon || "💎"} ${format(reward.coins)}` : null,
    ...Object.entries(reward.currencies || {}).map(([id, n]) => {
      const c = kit.currencies.find((cur) => cur.id === id);
      return c ? `${c.icon} ${format(n)}` : null;
    }),
    ...(reward.items || []).map((id) => (shop.byId(id) ? shop.byId(id).name : null)),
    reward.badge ? `${reward.badge.icon} ${reward.badge.name}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/* ---------- Time: boosts, the game of the day ---------- */

// A number from a text, the same every time (the golden minutes and the game of the day of a day)
function seeded(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

const minuteOfDay = (now) => Math.floor((now - days.dayStart(now)) / 60000);
const weekday = (now) => (days.dayNumber(now) + 3) % 7; // 0: Monday

// The golden minutes of a boost on a day: [start minute, ...]
function goldenStarts(boost, now) {
  const random = seeded(boost.id + ":" + days.dayNumber(now));
  return Array.from({ length: boost.when.times }, () => Math.floor(random() * (1440 - boost.when.minutes))).sort((a, b) => a - b);
}

// Is the boost on now? -> {on, endsIn, startsIn} (ms; null: unknown or never)
function boostState(boost, now = Date.now()) {
  const w = boost.when;
  const minute = minuteOfDay(now);
  const dayLeft = days.nextDay(now) - now;
  if (w.type === "always") return { on: true, endsIn: null, startsIn: null };
  if (w.type === "dates") return { on: now >= w.from && now < w.to, endsIn: now < w.to ? w.to - now : null, startsIn: now < w.from ? w.from - now : null };
  if (w.type === "hours") {
    const from = w.from * 60;
    const to = w.to * 60;
    const today = w.days.includes(weekday(now));
    const inside = from < to ? minute >= from && minute < to : minute >= from || minute < to;
    // (a span over midnight belongs to the day it started)
    const startDay = from < to || minute >= from ? weekday(now) : (weekday(now) + 6) % 7;
    const on = inside && w.days.includes(startDay);
    const ms = (m) => (m - minute) * 60000 - (now % 60000);
    if (on) return { on: true, endsIn: from < to || minute < to ? ms(to) : ms(to + 1440), startsIn: null };
    if (today && minute < from) return { on: false, endsIn: null, startsIn: ms(from) };
    for (let d = 1; d <= 7; d++) if (w.days.includes((weekday(now) + d) % 7)) return { on: false, endsIn: null, startsIn: dayLeft + (d - 1) * 86400000 + from * 60000 };
    return { on: false, endsIn: null, startsIn: null };
  }
  // golden: random minutes, the next one is a surprise
  for (const start of goldenStarts(boost, now)) {
    if (minute >= start && minute < start + w.minutes) return { on: true, endsIn: (start + w.minutes - minute) * 60000 - (now % 60000), startsIn: null };
  }
  return { on: false, endsIn: null, startsIn: null };
}

// The game of the day: one of the season's games, a new one every day
function gameOfDay(season, now = Date.now()) {
  const kit = kitOf(season);
  const list = (kit && kit.games) || seasonGames().map((g) => g.id);
  return list[Math.floor(seeded(season.id + ":day:" + days.dayNumber(now))() * list.length)];
}

function boostsFor(season, play, now) {
  const kit = kitOf(season);
  if (!kit || !kit.boosts) return [];
  const today = kit.boosts.some((b) => b.game === "daily") ? gameOfDay(season, now) : null;
  return kit.boosts.filter((b) => (b.game === "any" || b.game === play.game || (b.game === "daily" && play.game === today)) && boostState(b, now).on);
}

// The extra coins of a win (win bonus boosts on now): {amount, names}
function winBonus(season, play, now = Date.now()) {
  if (!(play.win > 0)) return { amount: 0, names: [] };
  const on = boostsFor(season, play, now).filter((b) => b.kind === "winBonus");
  const percent = on.reduce((sum, b) => sum + b.amount, 0);
  return { amount: Math.floor((play.win * percent) / 100), names: on.map((b) => b.name || "Boost") };
}

/* ---------- The progress of the players ---------- */

const states = new Map(); // season id -> {users: {name: {...}}, global: {questId: {...}}}
const loading = new Map();
const keyOf = (id) => "season-kit:" + id;

async function load(id) {
  if (states.has(id)) return states.get(id);
  if (!loading.has(id)) {
    loading.set(
      id,
      Setting.findOne({ key: keyOf(id) })
        .lean()
        .then((row) => {
          let state = { users: {} };
          try {
            if (row && typeof row.value === "string") state = JSON.parse(row.value);
          } catch (error) {
            // a fresh start
          }
          if (!state.users) state.users = {};
          if (!state.global) state.global = {};
          if (!states.has(id)) states.set(id, state);
          loading.delete(id);
          return states.get(id);
        }),
    );
  }
  return loading.get(id);
}

const saving = new Map();
function changed(id) {
  if (saving.has(id)) return;
  saving.set(
    id,
    setTimeout(() => {
      saving.delete(id);
      Setting.updateOne({ key: keyOf(id) }, { $set: { value: JSON.stringify(states.get(id)) } }, { upsert: true }).catch((error) => console.error("[season kit] Could not save:", error));
    }, 2000),
  );
  saving.get(id).unref();
}

// Which day / week a daily / weekly goal counts in (weeks start on Monday)
function periodOf(repeat, now = Date.now()) {
  if (repeat === "daily") return "d" + days.dayNumber(now);
  if (repeat === "weekly") return "w" + Math.floor((days.dayNumber(now) + 3) / 7);
  return "all";
}

const kitOf = (season) => season && season.kit;

function userOf(state, name, kit) {
  const user = (state.users[name] = state.users[name] || { q: {}, cur: {}, rest: {} });
  user.earned = user.earned || {};
  user.ms = user.ms || {};
  user.stats = user.stats || {};
  user.badges = user.badges || [];
  user.bought = user.bought || {};
  // (teams: the one with the fewest players so far)
  if (kit && kit.teams && kit.teams.on && !kit.teams.list.some((t) => t.id === user.team)) {
    const count = (id) => Object.values(state.users).filter((u) => u.team === id).length;
    user.team = kit.teams.list.slice().sort((a, b) => count(a.id) - count(b.id))[0].id;
  }
  return user;
}

function progressOf(holder, quest, now = Date.now()) {
  const period = periodOf(quest.repeat, now);
  let p = holder[quest.id];
  if (!p || p.period !== period) p = holder[quest.id] = { period: period, step: 0, count: 0, done: false };
  return p;
}

const matchGame = (step, play) => step.game === "any" || step.game === play.game;
const matchOutcome = (step, play) => step.outcome === "any" || step.outcome === play.outcome;
function matchWhere(where, play) {
  return where.every((cond) => {
    const value = play[cond.field];
    if (value == null) return false;
    const v = typeof value === "boolean" ? (value ? "yes" : "no") : value;
    switch (cond.op) {
      case "ne":
        return v !== cond.value;
      case "gte":
        return v >= cond.value;
      case "lte":
        return v <= cond.value;
      case "gt":
        return v > cond.value;
      case "lt":
        return v < cond.value;
      default:
        return v === cond.value;
    }
  });
}
const amountOf = (measure, play) => ({ plays: 1, bet: play.bet, win: play.win, profit: Math.max(0, play.net), loss: Math.max(0, -play.net) })[measure] || 0;
const open = (quest, now) => (quest.from == null || now >= quest.from) && (quest.until == null || now < quest.until);

// A step of a goal goes on with a play: true when the goal is done by it
function advance(p, quest, play) {
  const step = quest.steps[p.step];
  if (!step || !matchGame(step, play) || !matchWhere(step.where, play)) return false;
  const together = quest.scope === "everyone";
  if (!matchOutcome(step, play)) {
    // (right after the step before: this play had to be it - the goal starts over)
    if (!together && step.next && p.step > 0 && p.count === 0) Object.assign(p, { step: 0, count: 0 });
    else if (!together && step.inRow) p.count = 0;
    return false;
  }
  const amount = amountOf(step.measure, play);
  p.count += amount;
  if (together && amount > 0) p.by = { ...(p.by || {}), [play.name]: ((p.by && p.by[play.name]) || 0) + 1 };
  if (p.count >= step.need) {
    p.step++;
    p.count = 0;
    if (p.step >= quest.steps.length) {
      p.done = true;
      return true;
    }
  }
  return false;
}

/*
 * What a player gets (a goal, a milestone, an offer): the currencies, the badge and the stats right away -
 * the coins and the items are paid later (out: [{to, reward, icon, name, text, kind}])
 */
function give(season, state, name, reward, info, out) {
  const kit = kitOf(season);
  const user = userOf(state, name, kit);
  for (const [id, amount] of Object.entries(reward.currencies || {})) addCurrency(season, state, user, name, id, amount, out);
  if (reward.badge && !user.badges.some((b) => b.name === reward.badge.name)) {
    user.badges.push({ ...reward.badge, at: Date.now() });
    user.stats.badges = user.badges.length;
  }
  out.push({ ...info, to: name, reward: reward });
}

function addCurrency(season, state, user, name, id, amount, out) {
  if (!(amount > 0)) return;
  user.cur[id] = (user.cur[id] || 0) + amount;
  user.earned[id] = (user.earned[id] || 0) + amount;
  // The milestones reached with it (a season pass)
  const currency = kitOf(season).currencies.find((c) => c.id === id);
  if (!currency || !currency.milestones) return;
  const reached = currency.milestones.filter((m) => m.at <= user.earned[id]).length;
  const before = user.ms[id] || 0;
  user.ms[id] = Math.max(before, reached);
  for (const m of currency.milestones.slice(before, reached)) {
    give(season, state, name, m.reward, { kind: "milestone", id: id + ":" + m.at, icon: currency.icon, name: m.name || `${format(m.at)} ${currency.name}`, text: `You reached ${format(m.at)} ${currency.icon}.` }, out);
  }
}

// A play in the season: goals, currencies, stats and teams go on. Returns what was reached ([{kind, id, to, reward, ...}]).
function apply(season, state, play, now = Date.now()) {
  const kit = kitOf(season);
  if (!kit) return [];
  state.global = state.global || {};
  const user = userOf(state, play.name, kit);
  const out = [];
  // The stats (the leaderboard and the teams can count them)
  const s = user.stats;
  s.plays = (s.plays || 0) + 1;
  s.wagered = (s.wagered || 0) + play.bet;
  s.won = (s.won || 0) + play.win;
  s.profit = (s.profit || 0) + play.net;
  s.biggestWin = Math.max(s.biggestWin || 0, play.win);
  s.biggestX = Math.max(s.biggestX || 0, Math.round(play.x * 100) / 100);
  // (a goal done by this play: the goals after it count from the next play on)
  const justDone = new Set();
  for (const quest of kit.quests) {
    if (!open(quest, now)) continue;
    if (quest.requires) {
      const before = kit.quests.find((q) => q.id === quest.requires);
      const needed = before && (before.scope === "everyone" ? state.global[before.id] : user.q[before.id]);
      if (!needed || !needed.done || needed.period !== periodOf(before.repeat, now) || justDone.has(before.id)) continue;
    }
    if (quest.scope === "everyone") {
      const p = progressOf(state.global, quest, now);
      if (p.done || !advance(p, quest, play)) continue;
      justDone.add(quest.id);
      // Done together: everybody who helped gets the reward
      for (const name of Object.keys(p.by || {})) {
        const helper = userOf(state, name, kit);
        helper.stats.goals = (helper.stats.goals || 0) + 1;
        give(season, state, name, quest.reward, { kind: "goal", id: quest.id, icon: quest.icon, name: quest.name || null, text: questText(quest) }, out);
      }
      continue;
    }
    const p = progressOf(user.q, quest, now);
    if (p.done || !advance(p, quest, play)) continue;
    justDone.add(quest.id);
    p.doneAt = now;
    s.goals = (s.goals || 0) + 1;
    give(season, state, play.name, quest.reward, { kind: "goal", id: quest.id, icon: quest.icon, name: quest.name || null, text: questText(quest) }, out);
  }
  // Currencies earned while playing: `amount` for every `per` (what is left over counts on) - boosts multiply it
  const boosts = boostsFor(season, play, now).filter((b) => b.kind === "currencyX");
  for (const currency of kit.currencies) {
    const earn = currency.earn;
    if (!earn || !matchGame(earn, play) || !matchOutcome(earn, play) || !matchWhere(earn.where, play)) continue;
    const total = (user.rest[currency.id] || 0) + amountOf(earn.measure, play);
    const times = Math.floor(total / earn.per);
    user.rest[currency.id] = total - times * earn.per;
    const boost = boosts.filter((b) => b.currency === "all" || b.currency === currency.id).reduce((sum, b) => sum + b.amount, 0);
    if (times > 0) addCurrency(season, state, user, play.name, currency.id, Math.floor(times * earn.amount * (1 + boost / 100)), out);
  }
  return out;
}

// Coins and items of what was reached
async function pay(season, item) {
  const reward = item.reward;
  if (reward.coins > 0) {
    await require("./coins")
      .wallet(season.slot)
      .add(item.to, reward.coins, { reason: "quest reward", note: (item.name || item.text || "").slice(0, 80) });
  }
  if (reward.items && reward.items.length) await require("./shop").reward(item.to, { items: reward.items, coins: 0, prize: "" }, { source: season.name, icon: item.icon, note: item.name || null });
}

function deliver(season, list) {
  const notices = require("./notices");
  for (const item of list) {
    pay(season, item).catch((error) => console.error("[season kit] Could not pay:", error));
    notices.send(item.to, "goalDone", { kind: item.kind, icon: item.icon, name: item.name || null, text: item.text, reward: rewardText(season, item.reward) });
    notices.send(item.to, "goalsChanged", null);
  }
}

const lastSent = new Map();
async function onPlay(world, play) {
  if (!slots.isSeason(world)) return;
  const season = require("./seasons").running(world);
  if (!kitOf(season)) return;
  const state = await load(season.id);
  const done = apply(season, state, play);
  changed(season.id);
  deliver(season, done);
  // Boosts: the extra coins of a win
  const bonus = winBonus(season, play);
  if (bonus.amount > 0) {
    require("./coins")
      .wallet(season.slot)
      .add(play.name, bonus.amount, { reason: "boost bonus", note: bonus.names.join(", ").slice(0, 80) })
      .catch((error) => console.error("[season kit] Could not pay a boost:", error));
  }
  // (the goals panel: at most every 2 s)
  const key = season.id + ":" + play.name;
  if (Date.now() - (lastSent.get(key) || 0) > 2000) {
    lastSent.set(key, Date.now());
    require("./notices").send(play.name, "goalsChanged", null);
  }
}
plays.events.on("play", (world, play) => onPlay(world, play).catch((error) => console.error("[season kit] A play failed:", error)));

// The season shop: a player buys an offer with a currency -> {ok} or {error}
async function buy(season, name, offerId, now = Date.now()) {
  const kit = kitOf(season);
  const offer = kit && (kit.shop || []).find((o) => o.id === offerId);
  if (!offer) return { error: "This offer is gone." };
  const state = await load(season.id);
  const user = userOf(state, name, kit);
  if (offer.limit > 0 && (user.bought[offer.id] || 0) >= offer.limit) return { error: "You already got this as often as it goes." };
  if ((user.cur[offer.price.currency] || 0) < offer.price.amount) return { error: "You don't have enough for it." };
  user.cur[offer.price.currency] -= offer.price.amount;
  user.bought[offer.id] = (user.bought[offer.id] || 0) + 1;
  const out = [];
  give(season, state, name, offer.reward, { kind: "offer", id: offer.id, icon: offer.icon, name: offer.name || null, text: "Bought in the season shop." }, out);
  changed(season.id);
  deliver(season, out);
  return { ok: true };
}

/* ---------- What the players see ---------- */

const statOf = (season, user, id) => {
  if (STATS.some((s) => s.id === id)) return (user.stats && user.stats[id]) || 0;
  return (user.cur && user.cur[id]) || 0;
};
function metricInfo(season, id) {
  const stat = STATS.find((s) => s.id === id);
  if (stat) return { id: id, name: stat.name, icon: stat.icon };
  const c = (kitOf(season).currencies || []).find((cur) => cur.id === id);
  return c ? { id: c.id, name: c.name, icon: c.icon } : null;
}

function teamsOf(season, state) {
  const kit = kitOf(season);
  if (!kit.teams || !kit.teams.on) return null;
  const users = Object.values(state.users);
  return kit.teams.list
    .map((t) => {
      const members = users.filter((u) => u.team === t.id);
      return { id: t.id, name: t.name, icon: t.icon, color: t.color, members: members.length, score: Math.round(members.reduce((sum, u) => sum + statOf(season, u, kit.teams.score), 0) * 100) / 100 };
    })
    .sort((a, b) => b.score - a.score);
}

// The goals page of a player
async function view(season, name, now = Date.now()) {
  const kit = kitOf(season);
  if (!kit) return { currencies: [], quests: [], board: "coins" };
  const state = await load(season.id);
  const user = state.users[name] ? userOf(state, name, kit) : { q: {}, cur: {}, earned: {}, ms: {}, stats: {}, badges: [], bought: {} };
  // (teams: the player has one from the start)
  if (kit.teams && kit.teams.on && !state.users[name] && require("./seasons").joined(name, season.id)) {
    userOf(state, name, kit);
    changed(season.id);
  }
  const mine = state.users[name] || user;
  const next = { daily: days.nextDay(now) - now, weekly: null };
  next.weekly = next.daily + (6 - weekday(now)) * 86400000;
  const doneOf = (q) => {
    const p = q.scope === "everyone" ? state.global[q.id] : user.q[q.id];
    return p && p.period === periodOf(q.repeat, now) ? p : null;
  };
  const today = gameOfDay(season, now);
  return {
    currencies: kit.currencies.map((c) => ({
      id: c.id,
      name: c.name,
      icon: c.icon,
      amount: user.cur[c.id] || 0,
      earned: user.earned[c.id] || 0,
      earn: c.earn ? earnText(c) : null,
      milestones: (c.milestones || []).map((m) => ({ at: m.at, name: m.name || null, reward: rewardText(season, m.reward), reached: (user.earned[c.id] || 0) >= m.at })),
    })),
    quests: kit.quests.map((quest) => {
      const p = doneOf(quest) || { step: 0, count: 0, done: false };
      const step = quest.steps[Math.min(p.step, quest.steps.length - 1)];
      const locked = quest.requires ? !(doneOf(kit.quests.find((q) => q.id === quest.requires) || {}) || {}).done : false;
      const before = quest.requires ? kit.quests.find((q) => q.id === quest.requires) : null;
      return {
        id: quest.id,
        icon: quest.hidden && !p.done ? "❔" : quest.icon,
        name: quest.hidden && !p.done ? "A secret goal" : quest.name || null,
        text: quest.hidden && !p.done ? "Nobody knows what it is until somebody does it." : questText(quest),
        repeat: quest.repeat,
        together: quest.scope === "everyone",
        helped: quest.scope === "everyone" && !!(p.by && p.by[name]),
        locked: locked,
        after: locked && before ? before.name || questText(before) : null,
        startsIn: quest.from != null && now < quest.from ? quest.from - now : null,
        over: quest.until != null && now >= quest.until,
        endsIn: quest.until != null && now < quest.until ? quest.until - now : null,
        steps: quest.steps.length,
        step: p.done ? quest.steps.length : p.step,
        count: p.done ? step.need : p.count,
        need: step.need,
        done: p.done,
        resetIn: quest.repeat === "once" ? null : next[quest.repeat],
        reward: rewardText(season, quest.reward),
      };
    }),
    boosts: (kit.boosts || []).map((b) => {
      const st = boostState(b, now);
      return { icon: b.icon, name: b.name || null, text: boostText(season, b), on: st.on, endsIn: st.endsIn, startsIn: st.startsIn };
    }),
    gameOfDay: (kit.boosts || []).some((b) => b.game === "daily") ? { id: today, name: (seasonGames().find((g) => g.id === today) || { name: today }).name } : null,
    shop: (kit.shop || []).map((o) => {
      const c = kit.currencies.find((cur) => cur.id === o.price.currency);
      const bought = user.bought[o.id] || 0;
      return { id: o.id, icon: o.icon, name: o.name || rewardText(season, o.reward), reward: rewardText(season, o.reward), price: o.price.amount, priceIcon: c ? c.icon : "", left: o.limit > 0 ? Math.max(0, o.limit - bought) : null, afford: (user.cur[o.price.currency] || 0) >= o.price.amount };
    }),
    teams: kit.teams && kit.teams.on ? { list: teamsOf(season, state), mine: mine.team || null, score: metricInfo(season, kit.teams.score), reward: rewardText(season, kit.teams.reward) } : null,
    badges: user.badges.map((b) => ({ icon: b.icon, name: b.name })),
    board: kit.board,
    boardInfo: kit.board === "coins" ? null : metricInfo(season, kit.board),
  };
}

// What the leaderboard counts for every player of a season: name -> amount
async function balances(season, id) {
  const state = await load(season.id);
  const result = new Map();
  for (const [name, user] of Object.entries(state.users)) result.set(name, Math.round(statOf(season, user, id) * 100) / 100);
  return result;
}

// The leaderboard counts something else than the coins: {id, name, icon} - null: the coins
function boardOf(season) {
  const kit = kitOf(season);
  if (!kit || !kit.board || kit.board === "coins") return null;
  return metricInfo(season, kit.board);
}

// The badges and the team of the players (next to their names on the leaderboard): name -> {badges, team}
async function marksOf(season) {
  const kit = kitOf(season);
  const result = new Map();
  if (!kit) return result;
  const state = await load(season.id);
  for (const [name, user] of Object.entries(state.users)) {
    const team = kit.teams && kit.teams.on ? kit.teams.list.find((t) => t.id === user.team) : null;
    const badges = (user.badges || []).map((b) => ({ icon: b.icon, name: b.name }));
    if (badges.length || team) result.set(name, { badges: badges, team: team ? { icon: team.icon, name: team.name, color: team.color } : null });
  }
  return result;
}

// May a game be played in the season?
function hasGame(season, id) {
  const kit = kitOf(season);
  return !kit || !kit.games || kit.games.includes(id);
}

// May the players give each other coins in the season?
function giftsAllowed(season) {
  const kit = kitOf(season);
  return !kit || !kit.rules || kit.rules.gifts !== false;
}

/* ---------- Boosts starting, teams at the end ---------- */

// A boost goes on: everybody in the season hears it
const boostsOn = new Map(); // season id -> Set of boost ids on
function watchBoosts(now = Date.now()) {
  const seasons = require("./seasons");
  for (const season of seasons.runningAll()) {
    const kit = kitOf(season);
    if (!kit || !kit.boosts || !kit.boosts.length) continue;
    const before = boostsOn.get(season.id);
    const on = new Set(kit.boosts.filter((b) => boostState(b, now).on).map((b) => b.id));
    boostsOn.set(season.id, on);
    // (the first look after a start: no notices for what was on already)
    if (!before) continue;
    const started = kit.boosts.filter((b) => on.has(b.id) && !before.has(b.id));
    for (const boost of started) {
      for (const name of Object.keys(season.joined || {})) {
        require("./notices").send(name, "boostOn", { icon: boost.icon, name: boost.name || null, text: boostText(season, boost) });
        require("./notices").send(name, "goalsChanged", null);
      }
    }
  }
}
setInterval(() => {
  try {
    watchBoosts();
  } catch (error) {
    console.error("[season kit] Boosts:", error);
  }
}, 15000).unref();

// The season is over: the players of the team with the most get the team reward
async function teamReward(season) {
  const kit = kitOf(season);
  if (!kit || !kit.teams || !kit.teams.on) return [];
  const state = await load(season.id);
  const [best, second] = teamsOf(season, state);
  if (!best || best.score <= 0 || (second && second.score === best.score)) return [];
  const out = [];
  for (const [name, user] of Object.entries(state.users)) {
    if (user.team !== best.id) continue;
    give(season, state, name, kit.teams.reward, { kind: "team", id: best.id, icon: best.icon, name: best.name, text: `Team ${best.name} won the season.` }, out);
  }
  changed(season.id);
  return out;
}
require("./seasons").changes.on("ended", (pub) => {
  const season = require("./seasons").byId(pub.id);
  if (!season) return;
  teamReward(season)
    .then((out) => {
      // (the season's coins are over: only the items and the badge count now)
      for (const item of out) {
        if (item.reward.items && item.reward.items.length) require("./shop").reward(item.to, { items: item.reward.items, coins: 0, prize: "" }, { source: season.name, icon: item.icon, note: item.text }).catch(() => {});
      }
    })
    .catch((error) => console.error("[season kit] Team reward:", error));
});

// (tests: forget what is kept)
function reset() {
  states.clear();
  loading.clear();
  boostsOn.clear();
}

module.exports = { catalog, check, earnText, boostText, apply, buy, view, balances, boardOf, marksOf, hasGame, giftsAllowed, questText, stepText, rewardText, boostState, gameOfDay, winBonus, watchBoosts, teamReward, load, reset, periodOf, FIELDS, COMMON, STATS };
