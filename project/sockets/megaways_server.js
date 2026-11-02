const config = require("../game/config");
const megaways = require("../game/megaways");
const plays = require("../game/play_events");
const socketAuth = require("./socket_auth");
const safe = require("./safe_handler");
const version = require("../game/version");

const ROOM = "megaways";

/*
 * Megaways: everybody plays alone against the machine, like the slots (sockets/slots_server.js). A spin costs the
 * bet (MEGAWAYS_MIN_BET .. MEGAWAYS_MAX_BET), the server rolls the reels and the tumbles (game/megaways.js) and pays
 * the win once the page has shown it. The free spins wait for the player's click - a player who leaves finds them
 * again (held, or paused where they were); after SLOTS_HOLD they are paid anyway.
 */
module.exports = function (io, options = {}) {
  // The real casino - or the admin's test world, a season world (game/worlds.js): its own namespace
  const world = options.world || "";
  const { coins, persist, live, inPlay, casinoLock, casinoChat, limits } = require("../game/worlds").services(world);
  const room = io.of(world + "/megaways");
  room.use(socketAuth.casino);
  casinoChat.attach(room, ROOM);
  // The biggest wins (the side of the page)
  const best = require("../game/best_wins").attach(room, "megaways win", world);

  const machine = {
    feed: [], // [{name, bet, buy, win, symbol, ways, free, at}] newest first
    spins: 0,
    pending: [], // wins not paid yet: [{id, name, bet, win, note, at, result, shown, state, feed}]
  };
  const timers = new Map();
  let pendingId = 0;
  const busy = new Set();
  const lastSpin = new Map();
  const spinTab = new Map();

  // How long the page shows the base game: the drop, every tumble, the big-win show
  function baseTime(bet, result) {
    let time = config.MEGAWAYS_SPIN + result.steps.length * config.MEGAWAYS_TUMBLE + config.MEGAWAYS_COUNT_TIME;
    if (!result.bonus && result.win >= bet * config.MEGAWAYS_BIG_WIN) time += config.MEGAWAYS_BIG_TIME;
    return time;
  }

  // The free spins from free spin `shown` on (after `intro`): every spin, its tumbles, its eggs - then the end
  function restTime(bet, result, shown, intro) {
    const left = result.bonus.freeSpins.slice(Math.max(0, shown));
    let time = intro + left.reduce((sum, free) => sum + config.MEGAWAYS_FREE_SPIN + free.steps.length * config.MEGAWAYS_TUMBLE + (free.eggs ? config.MEGAWAYS_EGG_TIME : 0), 0) + config.MEGAWAYS_BONUS_END + config.MEGAWAYS_COUNT_TIME;
    if (result.win >= bet * config.MEGAWAYS_BIG_WIN) time += config.MEGAWAYS_BIG_TIME;
    return time;
  }

  function hold(entry, state) {
    entry.state = state;
    entry.at = Date.now() + config.SLOTS_HOLD;
    schedulePay(entry, config.SLOTS_HOLD);
    persist.changed("megaways");
  }

  function play(entry, intro) {
    entry.state = "playing";
    const rest = restTime(entry.result.bet, entry.result, entry.shown, intro);
    entry.at = Date.now() + rest;
    schedulePay(entry, rest);
    persist.changed("megaways");
    return rest;
  }

  function pause(username) {
    for (const entry of machine.pending) {
      if (entry.name === username && entry.result && entry.state === "playing" && Date.now() < entry.at) hold(entry, "paused");
    }
  }

  function resume(socket, username) {
    for (const entry of machine.pending) {
      if (entry.name !== username || !entry.result) continue;
      if (entry.state === "paused") {
        const rest = play(entry, config.SLOTS_RESUME_TIME);
        socket.emit("mwResume", { ...entry.result, id: entry.id, shown: entry.shown, started: true, payIn: rest });
      } else if (entry.state === "waiting") {
        socket.emit("mwResume", { ...entry.result, id: entry.id, shown: 0, started: false });
      }
    }
  }

  async function payPending(entry) {
    clearTimeout(timers.get(entry.id));
    timers.delete(entry.id);
    const index = machine.pending.indexOf(entry);
    if (index < 0) return;
    machine.pending.splice(index, 1);
    persist.changed("megaways");
    try {
      if (entry.win > 0) {
        await coins.add(entry.name, entry.win, { reason: "megaways win", note: entry.note, bet: entry.bet });
        best.changed();
      }
    } catch (error) {
      console.error("[megaways] Could not pay a win:", error);
    }
    const feed = entry.feed || {};
    plays.played(world, { game: "megaways", name: entry.name, bet: feed.buy || entry.bet || 0, win: entry.win, kind: feed.free ? "free spins" : entry.win > 0 ? "win" : "nothing", symbol: feed.symbol || null, tumbles: feed.tumbles || 0, buy: !!feed.buy });
    if (entry.feed && entry.win > 0) {
      machine.feed.unshift(entry.feed);
      machine.feed.length = Math.min(machine.feed.length, config.MEGAWAYS_FEED);
      room.to(ROOM).emit("mwFeed", machine.feed);
      persist.changed("megaways");
    }
  }

  function schedulePay(entry, after) {
    clearTimeout(timers.get(entry.id));
    const timer = setTimeout(() => payPending(entry), Math.max(0, after));
    timer.unref();
    timers.set(entry.id, timer);
  }

  function rules() {
    return { minBet: limits.MEGAWAYS_MIN_BET, maxBet: limits.MEGAWAYS_MAX_BET, spinTime: config.MEGAWAYS_SPIN, tumbleTime: config.MEGAWAYS_TUMBLE, freeIntro: config.MEGAWAYS_FREE_INTRO, freeSpinTime: config.MEGAWAYS_FREE_SPIN, eggTime: config.MEGAWAYS_EGG_TIME, bonusEndTime: config.MEGAWAYS_BONUS_END, bigWin: config.MEGAWAYS_BIG_WIN, bigTime: config.MEGAWAYS_BIG_TIME, countTime: config.MEGAWAYS_COUNT_TIME, pauseTime: config.MEGAWAYS_PAUSE, minGap: config.MEGAWAYS_MIN_GAP, resumeTime: config.SLOTS_RESUME_TIME };
  }

  async function sendCoins(username) {
    const data = await coins.get(username);
    for (const socket of room.sockets.values()) if (socket.data.username === username) socket.emit("coins", data);
  }
  coins.changes.on("change", (username) => sendCoins(username).catch(() => {}));

  live.register("megaways", () => ({ spins: machine.spins, playing: new Set([...room.sockets.values()].map((s) => s.data.username)).size }));

  // The best win of a spin's base game (for the feed and the season's goals): the symbol of the biggest win
  function bestOf(result) {
    let top = null;
    for (const step of result.steps) for (const win of step.wins) if (!top || win.pay > top.pay) top = win;
    return top;
  }

  room.on("connection", (socket) => {
    version.announce(socket);
    const username = socket.data.username;
    socket.join(ROOM);
    socket.emit("joined", { username: username });
    socket.emit("mwSetup", { ...megaways.catalog(), rules: rules() });
    socket.emit("mwFeed", machine.feed);
    casinoChat.join(socket);
    sendCoins(username).catch((error) => console.error("[megaways] Could not load coins:", error));
    const error = (message) => socket.emit("mwError", message);
    resume(socket, username);

    // The player clicked "start": the free spins play (and are paid when they are over)
    socket.on(
      "bonusStart",
      safe("bonusStart", (data) => {
        const entry = machine.pending.find((e) => e.id === (data && data.id) && e.name === username);
        if (entry && entry.result && entry.state === "waiting") play(entry, config.MEGAWAYS_FREE_INTRO);
      }),
    );

    // How far the page is in the free spins (to go on there after a break)
    socket.on(
      "bonusProgress",
      safe("bonusProgress", (data) => {
        const entry = machine.pending.find((e) => e.id === (data && data.id) && e.name === username);
        if (!entry || !entry.result || !Number.isInteger(data.shown)) return;
        entry.shown = Math.max(entry.shown, Math.min(data.shown, entry.result.bonus.freeSpins.length));
        persist.changed("megaways");
      }),
    );

    // The page played the free spins to their end: paid now (while the win is counted up)
    socket.on(
      "bonusDone",
      safe("bonusDone", (data) => {
        const entry = machine.pending.find((e) => e.id === (data && data.id) && e.name === username);
        if (!entry || !entry.result || entry.state !== "playing") return;
        if (Date.now() + config.MEGAWAYS_COUNT_TIME >= entry.at) return;
        entry.at = Date.now() + config.MEGAWAYS_COUNT_TIME;
        schedulePay(entry, config.MEGAWAYS_COUNT_TIME);
        persist.changed("megaways");
      }),
    );

    socket.on("disconnect", () => {
      if (![...room.sockets.values()].some((other) => other !== socket && other.data.username === username)) pause(username);
    });

    socket.on(
      "spin",
      safe("spin", async (data) => {
        const bet = data != null ? data.bet : null;
        if (!Number.isInteger(bet)) return;
        const buy = data.buy === true;
        const cost = buy ? bet * megaways.BUY_PRICE : bet;
        if (bet < limits.MEGAWAYS_MIN_BET || bet > limits.MEGAWAYS_MAX_BET) {
          return error(`A spin is ${limits.MEGAWAYS_MIN_BET.toLocaleString("en-US")} to ${limits.MEGAWAYS_MAX_BET.toLocaleString("en-US")} coins.`);
        }
        if (casinoLock.locked()) return error(casinoLock.message());
        // One machine at a time: another tab that spun just now is refused
        const other = spinTab.get(username);
        if (other && other !== socket.id && socket.nsp.sockets.has(other) && Date.now() - (lastSpin.get(username) || 0) < config.SLOTS_TAB_LOCK) {
          return error("Already spinning in another tab.");
        }
        // A spin left open on the screen (free spins not paid yet): one at a time
        if (machine.pending.some((entry) => entry.name === username && entry.result)) return error("Play your free spins first.");
        if (busy.has(username)) return socket.emit("mwSkip");
        const early = config.MEGAWAYS_MIN_GAP - (Date.now() - (lastSpin.get(username) || 0));
        if (early > 1000) return socket.emit("mwSkip");
        busy.add(username);
        try {
          if (early > 0) await new Promise((resolve) => setTimeout(resolve, early));
          // (a buy: its price counts against the max bet by balance like a bet at a table - as the slots' buys)
          const spent = buy ? await coins.spend(username, cost, { reason: "megaways bet", note: "bonus buy", capGame: "megaways:buy" }) : await coins.spend(username, bet, { reason: "megaways bet" });
          if (!spent) return error(coins.refusal(username) || "You don't have enough coins.");
          lastSpin.set(username, Date.now());
          spinTab.set(username, socket.id);
          // (the admin's test world: the next spin starts the free spins)
          const force = !buy && (nextBonus || config.MEGAWAYS_TEST_BONUS === true);
          nextBonus = false;
          const result = megaways.spin(bet, undefined, { buy: buy, forceBonus: force });
          machine.spins++;
          const top = bestOf(result);
          const free = result.bonus;
          let id = null;
          // (the free spins: what the whole show takes once they are started - they wait for the click)
          const payIn = baseTime(bet, result) + (free ? restTime(bet, result, 0, config.MEGAWAYS_FREE_INTRO) : 0);
          if (result.win > 0 || free) {
            id = ++pendingId + ":" + Date.now();
            const note = free ? `free spins ${free.freeSpins.length} x${free.freeSpins.length ? free.freeSpins[free.freeSpins.length - 1].multiplierAfter - 1 : 1}` : `${top.reels}x ${top.symbol} ${result.ways} ways`;
            const entry = {
              id: id,
              name: username,
              bet: bet,
              win: result.win,
              note: note + (buy ? " (bonus buy)" : ""),
              at: Date.now() + payIn,
              // The free spins: everything to show them again, how far they were seen
              result: free ? { bet: bet, grid: result.grid, ways: result.ways, steps: result.steps, last: result.last, eggs: result.eggs, lineX: result.lineX, bonus: free, x: result.x, win: result.win, capped: result.capped } : null,
              shown: 0,
              state: null,
              feed: { name: username, bet: bet, buy: buy ? cost : null, win: result.win, symbol: top ? top.symbol : free ? "egg" : null, ways: result.ways, tumbles: result.steps.length, free: free ? free.freeSpins.length : null, at: Date.now() },
            };
            machine.pending.push(entry);
            persist.changed("megaways");
            if (entry.result) hold(entry, "waiting");
            else schedulePay(entry, payIn);
          } else {
            setTimeout(() => plays.played(world, { game: "megaways", name: username, bet: bet, win: 0, kind: "nothing", symbol: null, tumbles: 0, buy: false }), payIn).unref();
          }
          socket.emit("mwResult", { id: id, bet: bet, buy: buy, cost: cost, grid: result.grid, ways: result.ways, steps: result.steps, last: result.last, eggs: result.eggs, lineX: result.lineX, bonus: result.bonus, x: result.x, win: result.win, capped: result.capped, payIn: payIn });
        } finally {
          busy.delete(username);
        }
      }),
    );

    socket.on(
      "sendChatMessage",
      safe("sendChatMessage", (data) => casinoChat.fromUser(socket, data)),
    );
  });

  // The last wins and the free spins not paid yet survive a restart
  persist.register(
    "megaways",
    () => ({ feed: machine.feed, spins: machine.spins, pending: machine.pending }),
    (saved) => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      machine.feed = Array.isArray(saved.feed) ? saved.feed : [];
      machine.spins = saved.spins || 0;
      machine.pending = Array.isArray(saved.pending) ? saved.pending : [];
      // (free spins are never paid unseen because of the restart: held where they were)
      machine.pending.forEach((entry) => {
        if (!entry.result) return schedulePay(entry, (entry.at || 0) - Date.now());
        entry.state = entry.state === "waiting" ? "waiting" : "paused";
        entry.at = Date.now() + config.SLOTS_HOLD;
        schedulePay(entry, config.SLOTS_HOLD);
      });
      room.to(ROOM).emit("mwFeed", machine.feed);
    },
  );

  async function payAll() {
    await Promise.all(machine.pending.slice().map(payPending));
  }
  casinoLock.changes.on("locked", () => {
    payAll().catch((error) => console.error("[megaways] Could not pay before the season:", error));
  });
  casinoLock.registerRunning("megaways", () => machine.pending.length > 0);
  inPlay.register("megaways", (name) => machine.pending.some((entry) => entry.name === name) || Date.now() - (lastSpin.get(name) || 0) < config.MEGAWAYS_SPIN + 500);

  // Debug (the admin's test world): the next spin starts the free spins
  let nextBonus = false;
  function forceBonus(on) {
    nextBonus = on !== false;
    return true;
  }

  return { machine, payAll, forceBonus };
};
