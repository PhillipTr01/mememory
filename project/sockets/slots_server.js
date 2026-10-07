const config = require("../game/config");
const coins = require("../game/coins");
const slots = require("../game/slots");
const casinoChat = require("../game/casino_chat");
const socketAuth = require("./socket_auth");
const safe = require("./safe_handler");
const version = require("../game/version");
const persist = require("../game/persist");
const live = require("../game/live");

const ROOM = "slots";

/*
 * Hidden slots: everybody plays alone against the machine. A spin costs the
 * bet (SLOTS_MIN_BET .. SLOTS_MAX_BET), the server rolls the reels (see
 * game/slots.js) and pays the win right away. The page only shows it.
 * Every win lands in a list for everybody ("last wins").
 */
module.exports = function (io) {
  const room = io.of("/slots");
  room.use(socketAuth.casino);
  casinoChat.attach(room, ROOM);

  const machine = {
    feed: [], // [{name, bet, win, symbol, count, bonus, at}] newest first
    spins: 0, // spins since the start (for the admin overview)
    pending: [], // wins not paid yet: [{id, name, win, note, at}] - paid when the page has shown them
  };
  const timers = new Map(); // id of a pending win -> its timer
  let pendingId = 0;
  const busy = new Set(); // a spin in progress (two tabs, fast clicks)
  const lastSpin = new Map(); // username -> time of the last spin

  /*
   * How long the page shows a spin before the win is counted up: the reels,
   * the bonus wheel, the big-win show. The coins come only after that - they
   * can't be played elsewhere before the spin is over on the screen.
   */
  function showTime(bet, result) {
    let time = config.SLOTS_SPIN + config.SLOTS_COUNT_TIME;
    if (result.bonus) time += config.SLOTS_BONUS_TIME + result.bonus.freeSpins.length * config.SLOTS_FREE_SPIN + config.SLOTS_BONUS_END;
    if (result.win >= bet * config.SLOTS_BIG_WIN) time += config.SLOTS_BIG_TIME;
    return time;
  }

  async function payPending(entry) {
    clearTimeout(timers.get(entry.id));
    timers.delete(entry.id);
    const index = machine.pending.indexOf(entry);
    if (index < 0) return;
    machine.pending.splice(index, 1);
    persist.changed("slots");
    try {
      await coins.add(entry.name, entry.win, { reason: "slots win", note: entry.note });
    } catch (error) {
      console.error("[slots] Could not pay a win:", error);
    }
    if (entry.feed) {
      machine.feed.unshift(entry.feed);
      machine.feed.length = Math.min(machine.feed.length, config.SLOTS_FEED);
      room.to(ROOM).emit("slotsFeed", machine.feed);
      persist.changed("slots");
    }
  }

  function schedulePay(entry, after) {
    clearTimeout(timers.get(entry.id));
    const timer = setTimeout(() => payPending(entry), Math.max(0, after));
    timer.unref();
    timers.set(entry.id, timer);
  }

  function rules() {
    return { minBet: config.SLOTS_MIN_BET, maxBet: config.SLOTS_MAX_BET, lines: slots.LINE_COUNT, spinTime: config.SLOTS_SPIN, bonusTime: config.SLOTS_BONUS_TIME, freeSpinTime: config.SLOTS_FREE_SPIN, bonusEndTime: config.SLOTS_BONUS_END, bigWin: config.SLOTS_BIG_WIN, bigTime: config.SLOTS_BIG_TIME, countTime: config.SLOTS_COUNT_TIME };
  }

  async function sendCoins(username) {
    const data = await coins.get(username);
    for (const socket of room.sockets.values()) if (socket.data.username === username) socket.emit("coins", data);
  }

  coins.changes.on("change", (username) => sendCoins(username).catch(() => {}));

  live.register("slots", () => ({ spins: machine.spins, playing: new Set([...room.sockets.values()].map((s) => s.data.username)).size }));

  room.on("connection", (socket) => {
    version.announce(socket);
    const username = socket.data.username;
    socket.join(ROOM);
    socket.emit("joined", { username: username });
    socket.emit("slotsSetup", { ...slots.catalog(), rules: rules() });
    socket.emit("slotsFeed", machine.feed);
    casinoChat.join(socket);
    sendCoins(username).catch((error) => console.error("[slots] Could not load coins:", error));
    const error = (message) => socket.emit("slotsError", message);

    socket.on(
      "spin",
      safe("spin", async (data) => {
        const bet = data != null ? data.bet : null;
        if (!Number.isInteger(bet)) return;
        if (bet < config.SLOTS_MIN_BET || bet > config.SLOTS_MAX_BET) {
          return error(`A spin is ${config.SLOTS_MIN_BET.toLocaleString("en-US")} to ${config.SLOTS_MAX_BET.toLocaleString("en-US")} coins.`);
        }
        // One spin at a time - and not faster than the reels turn
        if (busy.has(username) || Date.now() - (lastSpin.get(username) || 0) < config.SLOTS_MIN_GAP) return;
        busy.add(username);
        try {
          if (!(await coins.spend(username, bet, { reason: "slots bet" }))) return error("You don't have enough coins.");
          lastSpin.set(username, Date.now());
          const result = slots.spin(bet, undefined, { forceBonus: config.SLOTS_TEST_BONUS === true });
          machine.spins++;
          const payIn = showTime(bet, result);
          if (result.win > 0) {
            const best = result.lines.length ? result.lines.reduce((a, b) => (b.multiplier > a.multiplier ? b : a)) : null;
            const note = result.bonus ? `bonus ${result.bonus.spins} free spins x${result.bonus.multiplier}` : `${best.count}x ${best.symbol}`;
            const entry = {
              id: ++pendingId + ":" + Date.now(),
              name: username,
              win: result.win,
              note: note,
              at: Date.now() + payIn,
              feed: { name: username, bet: bet, win: result.win, symbol: best ? best.symbol : "bonus", count: best ? best.count : 3, bonus: result.bonus ? result.bonus.spins : null, at: Date.now() },
            };
            machine.pending.push(entry);
            persist.changed("slots");
            schedulePay(entry, payIn);
          }
          socket.emit("slotsResult", { bet: bet, grid: result.grid, stops: result.stops, lines: result.lines, lineWin: result.lineWin, bonus: result.bonus, win: result.win, payIn: payIn });
        } finally {
          busy.delete(username);
        }
      }),
    );

    socket.on(
      "claimBonus",
      safe("claimBonus", async () => {
        if (await coins.claimBonus(username)) socket.emit("bonusClaimed", config.DAILY_BONUS);
        await sendCoins(username);
      }),
    );

    socket.on(
      "sendChatMessage",
      safe("sendChatMessage", (data) => casinoChat.fromUser(socket, data)),
    );
  });

  // The last wins survive a restart
  persist.register(
    "slots",
    () => ({ feed: machine.feed, spins: machine.spins, pending: machine.pending }),
    (saved) => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      machine.feed = Array.isArray(saved.feed) ? saved.feed : [];
      machine.spins = saved.spins || 0;
      // Wins that were not paid before the stop: paid now (or when their show is over)
      machine.pending = Array.isArray(saved.pending) ? saved.pending : [];
      machine.pending.forEach((entry) => schedulePay(entry, (entry.at || 0) - Date.now()));
      room.to(ROOM).emit("slotsFeed", machine.feed);
    },
  );

  // The server stops: every win that is still waiting is paid
  async function payAll() {
    await Promise.all(machine.pending.slice().map(payPending));
  }

  return { machine, payAll };
};
