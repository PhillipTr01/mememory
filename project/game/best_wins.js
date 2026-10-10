const CoinLog = require("../models/CoinLog");
const coins = require("./coins");
const days = require("./days");

/*
 * The best wins of a game (the side of its page): the biggest single wins of today and of all time,
 * from the coin history - in the season world only the season's (its era), in the normal casino only
 * the normal ones. The admin's test world has none (test coins aren't written down).
 * attach(room, reason, world): every page that opens gets them ("bestWins"), changed(): again to all of them.
 */
const COUNT = 10;
const DELAY = 1500; // a win is written down a moment after it is paid

async function lists(reason, world) {
  if (world === "/test") return { today: [], all: [] };
  const era = world === "/season" ? coins.era() : null;
  if (world === "/season" && !era) return { today: [], all: [] };
  // (a push in blackjack only gives the bet back - not a win)
  const base = { reason: reason, note: { $ne: "push" }, ...(era ? { era: era } : coins.eraFilter()) };
  const pick = (rows) => rows.map((row) => ({ name: row.username, win: row.amount, bet: row.bet || betOf(row), note: row.note || null, at: row.at }));
  const [today, all] = await Promise.all([
    CoinLog.find({ ...base, at: { $gte: new Date(days.dayStart()) } }).sort({ amount: -1 }).limit(COUNT).lean(),
    CoinLog.find(base).sort({ amount: -1 }).limit(COUNT).lean(),
  ]);
  await findBets([...today, ...all], base);
  return { today: pick(today), all: pick(all) };
}

/*
 * Wins from before the bet was written down with them: the bet from the history - the player's last bet of the
 * game before the win (a spin, a battle: one bet, one win). Other games (a round of many bets) stay without.
 * Found once per win (by its id).
 */
const BET_OF = { "slots win": "slots bet", "battle win": "battle" };
const found = new Map(); // id of a win -> its bet (null: none found)
const betOf = (row) => found.get(String(row._id)) || null;

async function findBets(rows, base) {
  const missing = rows.filter((row) => !row.bet && BET_OF[row.reason] && row._id != null && !found.has(String(row._id)));
  await Promise.all(
    missing.map(async (row) => {
      const [bet] = await CoinLog.find({ username: row.username, reason: BET_OF[row.reason], amount: { $lt: 0 }, at: { $lte: row.at }, era: base.era })
        .sort({ at: -1 })
        .limit(1)
        .lean();
      found.set(String(row._id), bet ? -bet.amount : null);
    }),
  );
}

function attach(room, reason, world = "") {
  const send = (target) =>
    lists(reason, world)
      .then((data) => target.emit("bestWins", data))
      .catch((error) => console.error("[best wins] Could not load:", error));
  room.on("connection", (socket) => send(socket));
  let timer = null;
  return {
    // A win was paid: everybody on the page gets the lists again (a moment later, once)
    changed() {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        send(room);
      }, DELAY);
      timer.unref();
    },
    lists: () => lists(reason, world),
  };
}

/*
 * A game whose wins aren't in the coin history (poker: a pot becomes chips, not coins): it writes its
 * wins down itself - record(name, win, note). The lists are saved with the game (persist, under `key`).
 */
function attachRecorded(room, key, persist) {
  let state = { all: [], today: [], day: days.dayStart() };
  const top = (list, entry) => list.concat([entry]).sort((a, b) => b.win - a.win).slice(0, COUNT);
  const current = () => {
    // A new day: the list of today starts empty
    if (state.day !== days.dayStart()) state = { ...state, today: [], day: days.dayStart() };
    return { today: state.today, all: state.all };
  };
  room.on("connection", (socket) => socket.emit("bestWins", current()));
  persist.register(
    key,
    () => state,
    (saved) => {
      if (saved && Array.isArray(saved.all)) state = { all: saved.all, today: Array.isArray(saved.today) ? saved.today : [], day: saved.day || days.dayStart() };
      room.emit("bestWins", current());
    },
  );
  return {
    record(name, win, note, bet) {
      if (!(win > 0)) return;
      const entry = { name: name, win: win, bet: bet > 0 ? bet : null, note: note || null, at: new Date().toISOString() };
      current();
      state = { ...state, all: top(state.all, entry), today: top(state.today, entry) };
      persist.changed(key);
      room.emit("bestWins", current());
    },
    lists: current,
  };
}

module.exports = { attach, attachRecorded, lists, COUNT };
