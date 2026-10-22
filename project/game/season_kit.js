const Setting = require("../models/Setting");
const days = require("./days");
const slots = require("./season_slots");
const plays = require("./play_events");

/*
 * The season sandbox (admin panel, Seasons): what a season is built from beyond its coins.
 *
 * - games: the games of the season world (null: every game a season may have)
 * - currencies: up to MAX_CURRENCIES of the season's own ({id, name, icon, earn}) - given by goals,
 *   or earned while playing (earn: {game, outcome, measure, per, amount}: `amount` for every `per`)
 * - quests: goals made of steps, done one after the other. A step: {game, outcome, where, need,
 *   measure, inRow, next} - the plays of `game` that match `where` (conditions on what the game knows
 *   of a play, FIELDS) and `outcome` count towards `need` (plays, coins wagered, won, ...). inRow: a
 *   play that matches `where` but not `outcome` starts the step over; next: the first such play after
 *   the step before has to match, or the goal starts over. repeat: once, every day or every week.
 *   reward: season coins, currencies, shop items.
 * - board: what the leaderboard counts - "coins" or a currency
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

// The building blocks for the admin panel
function catalog() {
  return {
    games: seasonGames().map((game) => ({ id: game.id, name: game.name, fields: (FIELDS[game.id] || []).map(({ say, yes, ...field }) => field) })),
    common: COMMON.map(({ say, ...field }) => field),
    outcomes: OUTCOMES,
    measures: MEASURES,
    repeats: REPEATS,
    limits: { currencies: MAX_CURRENCIES, quests: MAX_QUESTS, steps: MAX_STEPS, where: MAX_WHERE },
  };
}

/* ---------- Checking what the admin built ---------- */

const short = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const iconOk = (icon) => icon.length > 0 && [...icon].length <= 4 && !/[<>&"'\s]/.test(icon);
const newId = () => Math.random().toString(36).slice(2, 10);
const idOk = (id) => typeof id === "string" && /^[a-z0-9]{1,16}$/.test(id);

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
  const items = Array.isArray(r.items) ? [...new Set(r.items.map(String))] : [];
  if (items.some((id) => !shop.byId(id))) return { error: `${label}: unknown item.` };
  return { reward: { coins: coins, currencies: cur, items: items } };
}

// {games, currencies, quests, board} - or {error}
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
  const currencies = [];
  for (const c of Array.isArray(kit.currencies) ? kit.currencies : []) {
    const name = short(c && c.name, 20);
    const icon = short(c && c.icon, 8);
    if (!name) return { error: "A currency needs a name." };
    if (!iconOk(icon)) return { error: `The currency ${name} needs an icon (one emoji).` };
    let id = idOk(c.id) ? c.id : name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || newId();
    while (currencies.some((other) => other.id === id) || id === "coins") id = newId();
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
    currencies.push({ id: id, name: name, icon: icon, earn: earn });
  }
  if (currencies.length > MAX_CURRENCIES) return { error: `At most ${MAX_CURRENCIES} currencies.` };
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
    let id = idOk(q.id) ? q.id : newId();
    while (quests.some((other) => other.id === id)) id = newId();
    quests.push({ id: id, name: short(q.name, 60), icon: icon, text: short(q.text, 300), repeat: REPEATS.includes(q.repeat) ? q.repeat : "once", steps: clean, reward: reward.reward });
  }
  const board = kit.board == null || kit.board === "" || kit.board === "coins" ? "coins" : String(kit.board);
  if (board !== "coins" && !currencies.some((c) => c.id === board)) return { error: "The leaderboard counts an unknown currency." };
  return { kit: { games: games, currencies: currencies, quests: quests, board: board } };
}

/* ---------- What a goal says (the player reads it) ---------- */

const format = (n) => Number(n).toLocaleString("en-US");
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
  return quest.steps.map((step, i) => (i === 0 ? stepText(step) : (step.next ? "Right after that, " : "Then ") + stepText(step).charAt(0).toLowerCase() + stepText(step).slice(1)) + ".").join(" ");
}

/* ---------- The progress of the players ---------- */

const states = new Map(); // season id -> {users: {name: {q: {id: {period, step, count, done}}, cur: {id: n}, rest: {id: n}}}}
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

function userOf(state, name) {
  return (state.users[name] = state.users[name] || { q: {}, cur: {}, rest: {} });
}

function progressOf(user, quest, now = Date.now()) {
  const period = periodOf(quest.repeat, now);
  let p = user.q[quest.id];
  if (!p || p.period !== period) p = user.q[quest.id] = { period: period, step: 0, count: 0, done: false };
  return p;
}

const kitOf = (season) => season && season.kit;
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

// A play in the season: the goals and the currencies of the player go on. Returns the goals done by it.
function apply(season, state, play, now = Date.now()) {
  const kit = kitOf(season);
  if (!kit) return [];
  const user = userOf(state, play.name);
  const done = [];
  for (const quest of kit.quests) {
    const p = progressOf(user, quest, now);
    if (p.done) continue;
    const step = quest.steps[p.step];
    if (!step || !matchGame(step, play) || !matchWhere(step.where, play)) continue;
    if (!matchOutcome(step, play)) {
      // (right after the step before: this play had to be it - the goal starts over)
      if (step.next && p.step > 0 && p.count === 0) Object.assign(p, { step: 0, count: 0 });
      else if (step.inRow) p.count = 0;
      continue;
    }
    p.count += amountOf(step.measure, play);
    if (p.count >= step.need) {
      p.step++;
      p.count = 0;
      if (p.step >= quest.steps.length) {
        p.done = true;
        p.doneAt = now;
        done.push(quest);
      }
    }
  }
  // Currencies earned while playing: `amount` for every `per` (what is left over counts on)
  for (const currency of kit.currencies) {
    const earn = currency.earn;
    if (!earn || !matchGame(earn, play) || !matchOutcome(earn, play) || !matchWhere(earn.where, play)) continue;
    const total = (user.rest[currency.id] || 0) + amountOf(earn.measure, play);
    const times = Math.floor(total / earn.per);
    user.rest[currency.id] = total - times * earn.per;
    if (times > 0) user.cur[currency.id] = (user.cur[currency.id] || 0) + times * earn.amount;
  }
  for (const quest of done) for (const [id, amount] of Object.entries(quest.reward.currencies)) user.cur[id] = (user.cur[id] || 0) + amount;
  return done;
}

// The rewards of a goal: season coins, shop items (the currencies are counted in apply)
async function pay(season, name, quest) {
  const reward = quest.reward;
  if (reward.coins > 0) {
    await require("./coins")
      .wallet(season.slot)
      .add(name, reward.coins, { reason: "quest reward", note: quest.name || questText(quest).slice(0, 80) });
  }
  if (reward.items.length) await require("./shop").reward(name, { items: reward.items, coins: 0, prize: "" }, { source: season.name, icon: quest.icon, note: quest.name || null });
}

const lastSent = new Map();
async function onPlay(world, play) {
  if (!slots.isSeason(world)) return;
  const season = require("./seasons").running(world);
  if (!kitOf(season)) return;
  const state = await load(season.id);
  const done = apply(season, state, play);
  changed(season.id);
  const notices = require("./notices");
  for (const quest of done) {
    pay(season, play.name, quest).catch((error) => console.error("[season kit] Could not pay a goal:", error));
    notices.send(play.name, "goalDone", { icon: quest.icon, name: quest.name || null, text: questText(quest), reward: rewardText(season, quest.reward) });
  }
  // (the goals panel: at most every 2 s - or right away when a goal is done)
  const key = season.id + ":" + play.name;
  if (done.length || Date.now() - (lastSent.get(key) || 0) > 2000) {
    lastSent.set(key, Date.now());
    notices.send(play.name, "goalsChanged", null);
  }
}
plays.events.on("play", (world, play) => onPlay(world, play).catch((error) => console.error("[season kit] A play failed:", error)));

// What a reward is, as one line: "💎 5,000 · ⭐ 10 · Golden frame"
function rewardText(season, reward) {
  const kit = kitOf(season) || { currencies: [] };
  const shop = require("./shop");
  return [
    reward.coins > 0 ? `${season.coinIcon || "💎"} ${format(reward.coins)}` : null,
    ...Object.entries(reward.currencies).map(([id, n]) => {
      const c = kit.currencies.find((cur) => cur.id === id);
      return c ? `${c.icon} ${format(n)}` : null;
    }),
    ...reward.items.map((id) => (shop.byId(id) ? shop.byId(id).name : null)),
  ]
    .filter(Boolean)
    .join(" · ");
}

// The goals page of a player: {currencies, quests, board}
async function view(season, name, now = Date.now()) {
  const kit = kitOf(season);
  if (!kit) return { currencies: [], quests: [], board: "coins" };
  const state = await load(season.id);
  const user = state.users[name] || { q: {}, cur: {} };
  const next = { daily: days.nextDay(now) - now, weekly: null };
  const week = (days.dayNumber(now) + 3) % 7;
  next.weekly = next.daily + (6 - week) * 86400000;
  return {
    currencies: kit.currencies.map((c) => ({ id: c.id, name: c.name, icon: c.icon, amount: user.cur[c.id] || 0, earn: c.earn ? earnText(c) : null })),
    quests: kit.quests.map((quest) => {
      const p = user.q[quest.id] && user.q[quest.id].period === periodOf(quest.repeat, now) ? user.q[quest.id] : { step: 0, count: 0, done: false };
      const step = quest.steps[Math.min(p.step, quest.steps.length - 1)];
      return {
        id: quest.id,
        icon: quest.icon,
        name: quest.name || null,
        text: questText(quest),
        repeat: quest.repeat,
        steps: quest.steps.length,
        step: p.done ? quest.steps.length : p.step,
        count: p.done ? step.need : p.count,
        need: step.need,
        done: p.done,
        resetIn: quest.repeat === "once" ? null : next[quest.repeat],
        reward: rewardText(season, quest.reward),
      };
    }),
    board: kit.board,
  };
}

function earnText(currency) {
  const e = currency.earn;
  const per = format(e.per);
  const what = { plays: `every ${e.per === 1 ? "play" : per + " plays"}`, bet: `every ${per} coins wagered`, win: `every ${per} coins won`, profit: `every ${per} coins of profit`, loss: `every ${per} coins lost` }[e.measure];
  const conds = e.where.map((cond) => condText(cond, e.game)).filter(Boolean);
  const outcome = { any: "", win: " on winning plays", loss: " on losing plays", even: " on even plays" }[e.outcome];
  return `You get ${format(e.amount)} ${currency.icon} for ${what}${outcome} in ${GAME_NAMES[e.game] || e.game}${conds.length ? " " + conds.join(" and ") : ""}.`;
}

// The balance of a currency of every player of a season (the leaderboard): name -> amount
async function balances(season, currency) {
  const state = await load(season.id);
  const result = new Map();
  for (const [name, user] of Object.entries(state.users)) result.set(name, (user.cur && user.cur[currency]) || 0);
  return result;
}

// The leaderboard counts a currency: {id, name, icon} - null: the coins
function boardOf(season) {
  const kit = kitOf(season);
  if (!kit || kit.board === "coins") return null;
  const c = kit.currencies.find((cur) => cur.id === kit.board);
  return c ? { id: c.id, name: c.name, icon: c.icon } : null;
}

// May a game be played in the season?
function hasGame(season, id) {
  const kit = kitOf(season);
  return !kit || !kit.games || kit.games.includes(id);
}

// (tests: forget what is kept)
function reset() {
  states.clear();
  loading.clear();
}

module.exports = { catalog, check, earnText, apply, view, balances, boardOf, hasGame, questText, stepText, rewardText, load, reset, periodOf, FIELDS, COMMON };
