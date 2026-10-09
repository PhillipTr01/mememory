const config = require("../game/config");
const baucua = require("../game/baucua");
const socketAuth = require("./socket_auth");
const safe = require("./safe_handler");
const version = require("../game/version");

const ROOM = "baucua";
const PHASE = {
  IDLE: "idle", // no bet yet: no timer (nothing runs while nobody plays)
  BETTING: "betting", // the first bet started the timer
  ROLLING: "rolling", // the bowl shakes on the pages, the dice are known on the server
};

/*
 * Bầu cua: everybody bets on the same three dice - on one animal or several.
 * The first bet of a round starts the timer (BAUCUA_TIMER); then the bowl
 * shakes and lifts (BAUCUA_SPIN) and the winners are paid. A short pause
 * (BAUCUA_PAUSE) shows the dice, then the next round waits for a bet.
 */
module.exports = function (io, options = {}) {
  // The real casino, the season world or the admin's test world (game/worlds.js)
  const world = options.world || "";
  const { coins, persist, live, inPlay, casinoLock, casinoChat, limits } = require("../game/worlds").services(world);
  const room = io.of(world + "/baucua");
  room.use(socketAuth.casino);
  casinoChat.attach(room, ROOM);

  const table = {
    round: 1,
    phase: PHASE.IDLE,
    fair: baucua.newSeed(),
    bets: [], // [{name, animal, amount}] in their order
    endsAt: null, // betting: when the bowl shakes
    rollAt: null, // rolling: when it started
    dice: null, // rolling: the three animals
    history: [], // [{round, dice, at, total, players, won, paid}] newest first
    last: null, // the last round: {round, dice, total, winners: [{name, win}]}
  };
  let timer = null;

  // The bets of a player in this round: {animal: amount}
  function betsOf(name) {
    const sums = Object.fromEntries(baucua.IDS.map((id) => [id, 0]));
    for (const bet of table.bets) if (bet.name === name) sums[bet.animal] += bet.amount;
    return sums;
  }

  function rules() {
    return { minBet: limits.BAUCUA_MIN_BET, maxBet: limits.BAUCUA_MAX_BET, timer: config.BAUCUA_TIMER, spin: config.BAUCUA_SPIN, pause: config.BAUCUA_PAUSE, payout: baucua.PAYOUT, animals: baucua.ANIMALS };
  }

  function state() {
    const now = Date.now();
    const rolling = table.phase === PHASE.ROLLING;
    return {
      round: table.round,
      phase: table.phase,
      timeLeft: table.phase === PHASE.BETTING && table.endsAt ? Math.max(0, table.endsAt - now) : null,
      rollLeft: rolling ? Math.max(0, table.rollAt + config.BAUCUA_SPIN - now) : null,
      dice: rolling ? table.dice : null,
      bets: table.bets.map((bet) => ({ name: bet.name, animal: bet.animal, amount: bet.amount })),
      history: table.history,
      last: table.last,
      fair: rolling ? table.fair : { hash: table.fair.hash },
      rules: rules(),
    };
  }

  function emitState() {
    room.to(ROOM).emit("baucuaState", state());
    persist.changed("baucua");
  }

  async function sendCoins(username) {
    const data = await coins.get(username);
    for (const socket of room.sockets.values()) if (socket.data.username === username) socket.emit("coins", data);
  }
  coins.changes.on("change", (username) => sendCoins(username).catch(() => {}));

  // The first bet: the timer runs
  function startTimer(left = config.BAUCUA_TIMER) {
    table.phase = PHASE.BETTING;
    table.endsAt = Date.now() + left;
    clearTimeout(timer);
    timer = setTimeout(roll, left);
  }

  function roll() {
    if (table.phase !== PHASE.BETTING) return;
    clearTimeout(timer);
    table.phase = PHASE.ROLLING;
    table.endsAt = null;
    table.rollAt = Date.now();
    table.dice = forcedDice() || baucua.diceFor(table.fair.seed, table.round);
    table.paid = false;
    emitState();
    timer = setTimeout(finish, config.BAUCUA_SPIN);
  }

  // The bowl is lifted: the winners are paid, the dice stay for a moment
  async function finish() {
    await pay();
    // (once per round - a restart in the middle of the end doesn't add it again)
    if (!(table.history[0] && table.history[0].round === table.round)) {
      const last = table.last || { total: 0, winners: [] };
      table.history.unshift({ round: table.round, dice: table.dice, at: Date.now(), total: last.total, players: new Set(table.bets.map((b) => b.name)).size, won: last.winners.length, paid: last.winners.reduce((sum, w) => sum + w.win, 0) });
      table.history.length = Math.min(table.history.length, config.BAUCUA_HISTORY);
    }
    emitState();
    clearTimeout(timer);
    timer = setTimeout(newRound, config.BAUCUA_PAUSE);
  }

  // Once per round (a restart in the middle of the roll pays then)
  async function pay() {
    if (table.paid) return;
    table.paid = true;
    persist.changed("baucua");
    const wins = new Map();
    for (const bet of table.bets) {
      const win = baucua.payout(bet.animal, bet.amount, table.dice);
      if (win > 0) wins.set(bet.name, (wins.get(bet.name) || 0) + win);
    }
    table.last = {
      round: table.round,
      dice: table.dice,
      total: table.bets.reduce((sum, bet) => sum + bet.amount, 0),
      winners: [...wins].map(([name, win]) => ({ name, win })).sort((a, b) => b.win - a.win),
    };
    await Promise.all(
      [...wins].map(([name, win]) => coins.add(name, win, { reason: "baucua win", note: table.dice.join(" ") }).catch((error) => console.error("[baucua] Could not pay a win:", error))),
    );
  }

  function newRound() {
    clearTimeout(timer);
    table.round++;
    table.phase = PHASE.IDLE;
    table.fair = baucua.newSeed();
    table.bets = [];
    table.endsAt = null;
    table.rollAt = null;
    table.dice = null;
    table.paid = false;
    emitState();
  }

  live.register("baucua", () => ({ round: table.round, phase: table.phase, players: new Set(table.bets.map((b) => b.name)).size, total: table.bets.reduce((s, b) => s + b.amount, 0) }));

  const busy = new Map(); // username -> the bets of the player in turn (two tabs, fast clicks)

  room.on("connection", (socket) => {
    version.announce(socket);
    const username = socket.data.username;
    socket.join(ROOM);
    socket.emit("joined", { username: username });
    socket.emit("baucuaState", state());
    casinoChat.join(socket);
    sendCoins(username).catch((error) => console.error("[baucua] Could not load coins:", error));
    const error = (message) => socket.emit("baucuaError", message);

    socket.on(
      "bet",
      safe("bet", async (data) => {
        if (data == null || !baucua.IDS.includes(data.animal) || !Number.isInteger(data.amount)) return;
        const amount = data.amount;
        if (casinoLock.locked()) return error(casinoLock.message());
        if (table.phase === PHASE.ROLLING) return error("The dice are rolling - bet on the next round.");
        if (amount < limits.BAUCUA_MIN_BET) return error(`At least 🪙 ${limits.BAUCUA_MIN_BET.toLocaleString("en-US")} per bet.`);
        // One bet of a player after the other (fast clicks, two tabs): none gets lost
        const place = async () => {
          const total = Object.values(betsOf(username)).reduce((sum, value) => sum + value, 0);
          if (total + amount > limits.BAUCUA_MAX_BET) return error(`At most 🪙 ${limits.BAUCUA_MAX_BET.toLocaleString("en-US")} per round (all animals together).`);
          if (!(await coins.spend(username, amount, { reason: "baucua bet", note: data.animal }))) return error(coins.refusal(username) || "You don't have enough coins.");
          // (the round may have moved on while the coins were taken)
          if (table.phase === PHASE.ROLLING) {
            await coins.add(username, amount, { reason: "baucua refund" });
            return error("Too late - the dice are rolling already.");
          }
          table.bets.push({ name: username, animal: data.animal, amount: amount });
          if (table.phase === PHASE.IDLE) startTimer();
          emitState();
        };
        const next = (busy.get(username) || Promise.resolve()).then(place, place);
        busy.set(username, next);
        try {
          await next;
        } finally {
          if (busy.get(username) === next) busy.delete(username);
        }
      }),
    );

    socket.on(
      "sendChatMessage",
      safe("sendChatMessage", (data) => casinoChat.fromUser(socket, data)),
    );
  });

  // A round survives a restart: the bets stay, the timer goes on (at least RESTORE_GRACE), a roll is paid
  persist.register(
    "baucua",
    () => ({ ...table }),
    (saved) => {
      clearTimeout(timer);
      Object.assign(table, saved);
      if (!Array.isArray(table.bets)) table.bets = [];
      if (!Array.isArray(table.history)) table.history = [];
      if (table.phase === PHASE.BETTING) {
        startTimer(Math.max(config.RESTORE_GRACE, (saved.endsAt || 0) - Date.now()));
      } else if (table.phase === PHASE.ROLLING) {
        if (table.paid) timer = setTimeout(newRound, config.BAUCUA_PAUSE);
        else timer = setTimeout(finish, Math.max(0, table.rollAt + config.BAUCUA_SPIN - Date.now()));
      }
      room.to(ROOM).emit("baucuaState", state());
    },
  );

  // Closing time (a season, a maintenance): no new bets - a round with bets rolls to its end
  casinoLock.registerRunning("baucua", () => table.bets.length > 0);
  inPlay.register("baucua", (name) => table.bets.some((bet) => bet.name === name));

  /* ---------- Debug (the admin's test world) ---------- */

  let forced = null;
  // The next dice: "triple" (all three the same), "pair", "single" (three different) - null: the seed's
  function forceDice(kind) {
    forced = ["triple", "pair", "single"].includes(kind) ? kind : null;
    return true;
  }
  function forcedDice() {
    if (!forced) return null;
    const kind = forced;
    forced = null;
    const pick = () => baucua.IDS[Math.floor(Math.random() * baucua.IDS.length)];
    const a = pick();
    if (kind === "triple") return [a, a, a];
    const others = baucua.IDS.filter((id) => id !== a);
    const b = others[Math.floor(Math.random() * others.length)];
    if (kind === "pair") return [a, b, a];
    const rest = others.filter((id) => id !== b);
    return [a, b, rest[Math.floor(Math.random() * rest.length)]];
  }

  // A bot bets (nobody's coins - its win is gone with it)
  function botBet(name, animal, amount) {
    if (table.phase === PHASE.ROLLING || !baucua.IDS.includes(animal)) return false;
    table.bets.push({ name: name, animal: animal, amount: amount });
    if (table.phase === PHASE.IDLE) startTimer();
    emitState();
    return true;
  }

  // The time to bet is over now
  function rollNow() {
    if (table.phase !== PHASE.BETTING) return false;
    roll();
    return true;
  }

  return { table, roll, botBet, rollNow, forceDice, stop: () => clearTimeout(timer) };
};
