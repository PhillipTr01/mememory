const config = require("../game/config");
const coins = require("../game/coins");
const inPlay = require("../game/in_play");
const casinoLock = require("../game/casino_lock");
const roulette = require("../game/roulette");
const casinoChat = require("../game/casino_chat");
const socketAuth = require("./socket_auth");
const safe = require("./safe_handler");
const version = require("../game/version");
const persist = require("../game/persist");
const live = require("../game/live");

const ROOM = "roulette";
const PHASE = {
  IDLE: "idle", // no bet yet: no timer (nothing runs while nobody plays)
  BETTING: "betting", // the first bet started the timer
  ROLLING: "rolling", // the reel rolls on the pages, the slot is known on the server
};

/*
 * Roulette: everybody bets on the same roll - red or blue (2×) and / or green
 * (14×). The first bet of a round starts the timer (ROULETTE_TIMER); then the
 * reel rolls (ROULETTE_SPIN) and the winners are paid when it stops. A short
 * pause (ROULETTE_PAUSE) shows the result, then the next round waits for a bet.
 */
module.exports = function (io, options = {}) {
  // The real casino - or the admin's test world (game/worlds.js): its own namespace, nothing saved
  const world = options.world || "";
  const { coins, persist, live, inPlay, casinoLock, casinoChat, limits } = require("../game/worlds").services(world);
  const room = io.of(world + "/roulette");
  room.use(socketAuth.casino);
  casinoChat.attach(room, ROOM);

  const table = {
    round: 1,
    phase: PHASE.IDLE,
    fair: roulette.newSeed(),
    bets: [], // [{name, color, amount}] in their order
    endsAt: null, // betting: when the reel starts
    rollAt: null, // rolling: when the reel started
    slot: null, // rolling: where it stops
    history: [], // [{round, slot, number, color, at}] newest first
    last: null, // the last round: {round, slot, color, winners: [{name, win}], total}
  };
  let timer = null;

  // The bets of a player in this round: {red, blue, green}
  function betsOf(name) {
    const sums = { red: 0, blue: 0, green: 0 };
    for (const bet of table.bets) if (bet.name === name) sums[bet.color] += bet.amount;
    return sums;
  }

  function state() {
    const now = Date.now();
    const rolling = table.phase === PHASE.ROLLING;
    return {
      round: table.round,
      phase: table.phase,
      timeLeft: table.phase === PHASE.BETTING && table.endsAt ? Math.max(0, table.endsAt - now) : null,
      rollLeft: rolling ? Math.max(0, table.rollAt + config.ROULETTE_SPIN - now) : null,
      slot: rolling ? table.slot : null,
      bets: table.bets.map((bet) => ({ name: bet.name, color: bet.color, amount: bet.amount })),
      history: table.history,
      last: table.last,
      fair: rolling ? table.fair : { hash: table.fair.hash },
      rules: rules(),
    };
  }

  function rules() {
    return { minBet: limits.ROULETTE_MIN_BET, maxBet: limits.ROULETTE_MAX_BET, timer: config.ROULETTE_TIMER, spin: config.ROULETTE_SPIN, pause: config.ROULETTE_PAUSE, payout: roulette.PAYOUT, wheel: roulette.WHEEL };
  }

  function emitState() {
    room.to(ROOM).emit("rouletteState", state());
    persist.changed("roulette");
  }

  async function sendCoins(username) {
    const data = await coins.get(username);
    for (const socket of room.sockets.values()) if (socket.data.username === username) socket.emit("coins", data);
  }
  coins.changes.on("change", (username) => sendCoins(username).catch(() => {}));

  // The first bet: the timer runs
  function startTimer(left = config.ROULETTE_TIMER) {
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
    table.slot = roulette.slotFor(table.fair.seed, table.round);
    // (debug, the test world only: the color the admin picked)
    if (forcedColor) {
      const slots = roulette.WHEEL.map((slot, i) => (slot.color === forcedColor ? i : -1)).filter((i) => i >= 0);
      table.slot = slots[Math.floor(Math.random() * slots.length)];
      forcedColor = null;
    }
    table.paid = false;
    emitState();
    timer = setTimeout(finish, config.ROULETTE_SPIN);
  }

  // The reel stopped: the winners are paid, the result stays for a moment
  async function finish() {
    await pay();
    const slot = roulette.WHEEL[table.slot];
    // (once per round - a restart in the middle of the end doesn't add it again)
    if (table.history[0] && table.history[0].round === table.round) {
      clearTimeout(timer);
      timer = setTimeout(newRound, config.ROULETTE_PAUSE);
      return emitState();
    }
    const last = table.last || { total: 0, winners: [] };
    table.history.unshift({ round: table.round, slot: table.slot, number: slot.number, color: slot.color, at: Date.now(), total: last.total, players: new Set(table.bets.map((b) => b.name)).size, winners: last.winners.slice(0, 3), won: last.winners.length, paid: last.winners.reduce((sum, w) => sum + w.win, 0) });
    table.history.length = Math.min(table.history.length, config.ROULETTE_HISTORY);
    emitState();
    clearTimeout(timer);
    timer = setTimeout(newRound, config.ROULETTE_PAUSE);
  }

  // Once per round (a restart in the middle of the roll pays then)
  async function pay() {
    if (table.paid) return;
    table.paid = true;
    persist.changed("roulette");
    const wins = new Map();
    for (const bet of table.bets) {
      const win = roulette.payout(bet.color, bet.amount, table.slot);
      if (win > 0) wins.set(bet.name, (wins.get(bet.name) || 0) + win);
    }
    const slot = roulette.WHEEL[table.slot];
    table.last = {
      round: table.round,
      slot: table.slot,
      number: slot.number,
      color: slot.color,
      total: table.bets.reduce((sum, bet) => sum + bet.amount, 0),
      winners: [...wins].map(([name, win]) => ({ name, win })).sort((a, b) => b.win - a.win),
    };
    await Promise.all(
      [...wins].map(([name, win]) =>
        coins.add(name, win, { reason: "roulette win", note: slot.color }).catch((error) => console.error("[roulette] Could not pay a win:", error)),
      ),
    );
  }

  function newRound() {
    clearTimeout(timer);
    table.round++;
    table.phase = PHASE.IDLE;
    table.fair = roulette.newSeed();
    table.bets = [];
    table.endsAt = null;
    table.rollAt = null;
    table.slot = null;
    table.paid = false;
    emitState();
  }

  live.register("roulette", () => ({ round: table.round, phase: table.phase, players: new Set(table.bets.map((b) => b.name)).size, total: table.bets.reduce((s, b) => s + b.amount, 0) }));

  const busy = new Map(); // username -> the bets of the player in turn (two tabs, fast clicks)

  room.on("connection", (socket) => {
    version.announce(socket);
    const username = socket.data.username;
    socket.join(ROOM);
    socket.emit("joined", { username: username });
    socket.emit("rouletteState", state());
    casinoChat.join(socket);
    sendCoins(username).catch((error) => console.error("[roulette] Could not load coins:", error));
    const error = (message) => socket.emit("rouletteError", message);

    socket.on(
      "bet",
      safe("bet", async (data) => {
        if (data == null || !roulette.COLORS.includes(data.color) || !Number.isInteger(data.amount)) return;
        const amount = data.amount;
        if (casinoLock.locked()) return error(casinoLock.message());
        if (table.phase === PHASE.ROLLING) return error("The reel rolls - bet on the next round.");
        if (amount < limits.ROULETTE_MIN_BET) return error(`At least 🪙 ${limits.ROULETTE_MIN_BET.toLocaleString("en-US")} per bet.`);
        // One bet of a player after the other (fast clicks, two tabs): none gets lost
        const place = async () => {
          const sums = betsOf(username);
          if (!roulette.allowed(sums, data.color)) return error(data.color === "red" ? "You bet on blue - red only in the next round." : "You bet on red - blue only in the next round.");
          const total = sums.red + sums.blue + sums.green;
          if (total + amount > limits.ROULETTE_MAX_BET) return error(`At most 🪙 ${limits.ROULETTE_MAX_BET.toLocaleString("en-US")} per round (all colors together).`);
          if (!(await coins.spend(username, amount, { reason: "roulette bet", note: data.color }))) return error(coins.refusal(username) || "You don't have enough coins.");
          // (the round may have moved on while the coins were taken)
          if (table.phase === PHASE.ROLLING) {
            await coins.add(username, amount, { reason: "roulette refund" });
            return error("Too late - the reel rolls already.");
          }
          table.bets.push({ name: username, color: data.color, amount: amount });
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
    "roulette",
    () => ({ ...table }),
    (saved) => {
      clearTimeout(timer);
      Object.assign(table, saved);
      if (!Array.isArray(table.bets)) table.bets = [];
      if (!Array.isArray(table.history)) table.history = [];
      if (table.phase === PHASE.BETTING) {
        startTimer(Math.max(config.RESTORE_GRACE, (saved.endsAt || 0) - Date.now()));
      } else if (table.phase === PHASE.ROLLING) {
        if (table.paid) timer = setTimeout(newRound, config.ROULETTE_PAUSE);
        else timer = setTimeout(finish, Math.max(0, table.rollAt + config.ROULETTE_SPIN - Date.now()));
      }
      room.to(ROOM).emit("rouletteState", state());
    },
  );

  // Closing time (a season, a maintenance): no new bets - a round with bets rolls to its end
  casinoLock.registerRunning("roulette", () => table.bets.length > 0);
  inPlay.register("roulette", (name) => table.bets.some((bet) => bet.name === name));

  /* ---------- Debug (the admin's test world) ---------- */

  let forcedColor = null;
  // The color of the next roll (null: the seed's)
  function forceColor(color) {
    forcedColor = roulette.COLORS.includes(color) ? color : null;
    return true;
  }

  // A bot bets (nobody's coins - its win is gone with it)
  function botBet(name, color, amount) {
    if (table.phase === PHASE.ROLLING || !roulette.COLORS.includes(color)) return false;
    table.bets.push({ name: name, color: color, amount: amount });
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

  return { table, roll, botBet, rollNow, forceColor, stop: () => clearTimeout(timer) };
};
