const config = require("../game/config");
const coins = require("../game/coins");
const inPlay = require("../game/in_play");
const casinoLock = require("../game/casino_lock");
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
module.exports = function (io, options = {}) {
  // The real casino - or the admin's test world (game/worlds.js): its own namespace, nothing saved
  const world = options.world || "";
  const { coins, persist, live, inPlay, casinoLock, casinoChat, limits } = require("../game/worlds").services(world);
  const room = io.of(world + "/slots");
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
    return config.SLOTS_SPIN + sweat(result.grid, 1, result.stops) + restTime(bet, result, 0, config.SLOTS_BONUS_TIME);
  }

  // 🎁 on reels 1 and 3 - or the coin game still possible (see slots.coinSweat, only normal spins):
  // the last reel turns longer on the page (the sweat)
  function sweat(grid, share = 1, stops = null) {
    const gifts = grid[0].includes("bonus") && grid[2].includes("bonus");
    if (gifts) return config.SLOTS_SWEAT * share;
    // (the coin sweat can start a reel earlier: then two reels sweat)
    return stops ? slots.sweatShare(slots.coinSweatReels(grid, stops)) * config.SLOTS_SWEAT * share : 0;
  }

  // The show from free spin (or respin of the coin game) `shown` on (after `intro`: the wheels,
  // the coins locking in, "welcome back" or nothing)
  function restTime(bet, result, shown, intro) {
    let time = config.SLOTS_COUNT_TIME;
    if (result.coinGame) {
      time += intro + result.coinGame.respins.slice(Math.max(0, shown)).length * config.SLOTS_RESPIN + config.SLOTS_BONUS_END;
      if (result.coinGame.ultra) time += config.SLOTS_ULTRA_TIME;
    }
    if (result.bonus) {
      const left = result.bonus.freeSpins.slice(Math.max(0, shown));
      const retriggers = left.filter((free) => free.retrigger > 0).length;
      time += intro + left.reduce((sum, free) => sum + config.SLOTS_FREE_SPIN + sweat(free.grid, 0.6), 0) + retriggers * config.SLOTS_RETRIGGER_TIME + config.SLOTS_BONUS_END;
    }
    if (result.win >= bet * config.SLOTS_BIG_WIN) time += config.SLOTS_BIG_TIME;
    return time;
  }

  // What the page shows before the free spins / respins: the wheels, or the coins locking in
  const introTime = (result) => (result.coinGame ? config.SLOTS_COIN_INTRO : config.SLOTS_BONUS_TIME);
  // How many steps the bonus game has: free spins or respins
  const steps = (result) => (result.coinGame ? result.coinGame.respins.length : result.bonus.freeSpins.length);

  /*
   * A bonus game (free spins or the coin game) is paid only when it was played on the page: it waits for
   * the player's click ("waiting"), then the wheels and the free spins play
   * ("playing"). A player who leaves meanwhile finds it again - waiting,
   * or held where it was ("paused"). After SLOTS_HOLD it is paid anyway.
   */
  function hold(entry, state) {
    entry.state = state;
    entry.at = Date.now() + config.SLOTS_HOLD;
    schedulePay(entry, config.SLOTS_HOLD);
    persist.changed("slots");
  }

  function play(entry, intro) {
    entry.state = "playing";
    const rest = restTime(entry.result.bet, entry.result, entry.shown, intro);
    entry.at = Date.now() + rest;
    schedulePay(entry, rest);
    persist.changed("slots");
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
        socket.emit("slotsResume", { ...entry.result, id: entry.id, shown: entry.shown, started: true, payIn: rest });
      } else if (entry.state === "waiting") {
        socket.emit("slotsResume", { ...entry.result, id: entry.id, shown: 0, started: false });
      }
    }
  }

  /*
   * A 🧰 of the coin game opened: the box the player picked (0 - 2) - what is behind it was shuffled at the
   * spin and stays on the server until then. Pays its prize; the answer shows every box.
   */
  function openChest(entry, chest, pick) {
    chest.pick = pick;
    const prize = chest.boxes[pick];
    const more = slots.openChest(entry.result, entry.result.bet, chest.reel, chest.row, prize);
    entry.win += more;
    if (entry.feed) entry.feed.win = entry.win;
    entry.note += ` · chest ${prize.toUpperCase()}`;
    persist.changed("slots");
    return { id: entry.id, reel: chest.reel, row: chest.row, boxes: chest.boxes, pick: pick, prize: prize, x: entry.result.coinGame.x, gameWin: entry.result.coinGame.win, win: entry.win };
  }

  async function payPending(entry) {
    // (a chest nobody picked: a box at random - every box is worth the same on average)
    (entry.chests || []).filter((chest) => chest.pick == null).forEach((chest) => openChest(entry, chest, Math.floor(Math.random() * chest.boxes.length)));
    clearTimeout(timers.get(entry.id));
    timers.delete(entry.id);
    const index = machine.pending.indexOf(entry);
    if (index < 0) return;
    machine.pending.splice(index, 1);
    persist.changed("slots");
    try {
      if (entry.win > 0) await coins.add(entry.name, entry.win, { reason: "slots win", note: entry.note });
    } catch (error) {
      console.error("[slots] Could not pay a win:", error);
    }
    if (entry.feed && entry.win > 0) {
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
    return { minBet: limits.SLOTS_MIN_BET, maxBet: limits.SLOTS_MAX_BET, lines: slots.LINE_COUNT, spinTime: config.SLOTS_SPIN, pauseTime: config.SLOTS_PAUSE, minGap: config.SLOTS_MIN_GAP, bonusTime: config.SLOTS_BONUS_TIME, freeSpinTime: config.SLOTS_FREE_SPIN, respinTime: config.SLOTS_RESPIN, coinIntroTime: config.SLOTS_COIN_INTRO, ultraTime: config.SLOTS_ULTRA_TIME, bonusEndTime: config.SLOTS_BONUS_END, resumeTime: config.SLOTS_RESUME_TIME, sweatTime: config.SLOTS_SWEAT, retriggerTime: config.SLOTS_RETRIGGER_TIME, bigWin: config.SLOTS_BIG_WIN, bigTime: config.SLOTS_BIG_TIME, countTime: config.SLOTS_COUNT_TIME };
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
    // A bonus game that waited for the player: on with it
    resume(socket, username);

    // The player clicked "start": the free spins play (and are paid when they are over)
    socket.on(
      "bonusStart",
      safe("bonusStart", (data) => {
        const entry = machine.pending.find((e) => e.id === (data && data.id) && e.name === username);
        // (the wheels come first, then the free spins)
        if (entry && entry.result && entry.state === "waiting") play(entry, introTime(entry.result));
      }),
    );

    // A 🧰 is on the screen: the coin game waits for the pick (paid anyway after SLOTS_HOLD, a box at random)
    socket.on(
      "chestShow",
      safe("chestShow", (data) => {
        const entry = machine.pending.find((e) => e.id === (data && data.id) && e.name === username);
        if (!entry || !entry.result || !(entry.chests || []).some((chest) => chest.pick == null)) return;
        if (entry.state === "playing") hold(entry, "paused");
      }),
    );

    // The player picked a box of a 🧰: what is behind every box, the prize paid
    socket.on(
      "chestPick",
      safe("chestPick", (data) => {
        if (data == null || !Number.isInteger(data.pick)) return;
        const entry = machine.pending.find((e) => e.id === data.id && e.name === username);
        const chest = entry && (entry.chests || []).find((c) => c.reel === data.reel && c.row === data.row);
        if (!chest || chest.pick != null || data.pick < 0 || data.pick >= chest.boxes.length) return;
        socket.emit("chestOpened", openChest(entry, chest, data.pick));
        // On with the coin game (from where the page is)
        if (entry.state === "paused") play(entry, 0);
      }),
    );

    // How far the page is in a bonus game (to go on there after a break)
    socket.on(
      "bonusProgress",
      safe("bonusProgress", (data) => {
        const entry = machine.pending.find((e) => e.id === (data && data.id) && e.name === username);
        if (!entry || !entry.result || !Number.isInteger(data.shown)) return;
        entry.shown = Math.max(entry.shown, Math.min(data.shown, steps(entry.result)));
        persist.changed("slots");
      }),
    );

    // The page played the bonus game to its end (the player went on): paid now - SLOTS_COUNT_TIME, while it
    // is counted up - not only when the time reckoned for the show is over
    socket.on(
      "bonusDone",
      safe("bonusDone", (data) => {
        const entry = machine.pending.find((e) => e.id === (data && data.id) && e.name === username);
        if (!entry || !entry.result || entry.state !== "playing") return;
        if (Date.now() + config.SLOTS_COUNT_TIME >= entry.at) return;
        entry.at = Date.now() + config.SLOTS_COUNT_TIME;
        schedulePay(entry, config.SLOTS_COUNT_TIME);
        persist.changed("slots");
      }),
    );

    // The last slots page of the player is gone: a running bonus game waits
    socket.on("disconnect", () => {
      if (![...room.sockets.values()].some((other) => other !== socket && other.data.username === username)) pause(username);
    });

    socket.on(
      "spin",
      safe("spin", async (data) => {
        const bet = data != null ? data.bet : null;
        if (!Number.isInteger(bet)) return;
        if (bet < limits.SLOTS_MIN_BET || bet > limits.SLOTS_MAX_BET) {
          return error(`A spin is ${limits.SLOTS_MIN_BET.toLocaleString("en-US")} to ${limits.SLOTS_MAX_BET.toLocaleString("en-US")} coins.`);
        }
        // Closing time before a season: no new spins
        if (casinoLock.locked()) return error(casinoLock.message());
        // One spin at a time - and not faster than the reels turn. A spin a moment too early
        // (the clocks of page and server) waits for the gap; one far too early is refused - the page
        // always hears back (it never waits for nothing)
        if (busy.has(username)) return socket.emit("slotsSkip");
        const early = config.SLOTS_MIN_GAP - (Date.now() - (lastSpin.get(username) || 0));
        if (early > 1000) return socket.emit("slotsSkip");
        busy.add(username);
        try {
          if (early > 0) await new Promise((resolve) => setTimeout(resolve, early));
          if (!(await coins.spend(username, bet, { reason: "slots bet" }))) return error(coins.refusal(username) || "You don't have enough coins.");
          lastSpin.set(username, Date.now());
          // (debug, the test world only: the next spin starts the bonus the admin picked)
          const test = nextBonus || config.SLOTS_TEST_BONUS;
          nextBonus = null;
          const result = slots.spin(bet, undefined, { forceBonus: ["free", "coins", "chest"].includes(test) ? test : test === true ? "free" : null });
          machine.spins++;
          const payIn = showTime(bet, result);
          let id = null;
          // Every win - and every bonus game (also one without a win: it can be held and resumed)
          const special = result.bonus || result.coinGame;
          if (result.win > 0 || special) {
            const best = result.lines.length ? result.lines.reduce((a, b) => (b.multiplier > a.multiplier ? b : a)) : null;
            const game = result.coinGame;
            const note = result.bonus ? `bonus ${result.bonus.spins} free spins x${result.bonus.multiplier}` : game ? `coin game ${game.coins.length} coins${game.ultra ? " ULTRA" : ""}` : `${best.count}x ${best.symbol}`;
            id = ++pendingId + ":" + Date.now();
            const entry = {
              id: id,
              name: username,
              win: result.win,
              note: note,
              at: Date.now() + payIn,
              // A bonus game: everything to show it again, how far it was seen
              result: special ? { bet: bet, grid: result.grid, stops: result.stops, lines: result.lines, lineWin: result.lineWin, coins: result.coins, bonus: result.bonus, coinGame: result.coinGame, win: result.win, capped: result.capped } : null,
              shown: 0,
              state: null,
              feed: { name: username, bet: bet, win: result.win, symbol: best ? best.symbol : game ? "coin" : "bonus", count: best ? best.count : 3, bonus: result.bonus ? result.bonus.spins : null, coins: game ? game.coins.length : null, ultra: game ? game.ultra : false, at: Date.now() },
            };
            // The 🧰 of the coin game: their boxes, shuffled now - nobody sees them before the pick
            if (game) {
              entry.chests = game.coins.filter((coin) => coin.chest).map((coin) => ({ reel: coin.reel, row: coin.row, boxes: slots.chestBoxes(), pick: null }));
              if (!entry.chests.length) delete entry.chests;
            }
            machine.pending.push(entry);
            persist.changed("slots");
            // A bonus game waits for the player's click
            if (entry.result) hold(entry, "waiting");
            else schedulePay(entry, payIn);
          }
          socket.emit("slotsResult", { id: id, bet: bet, grid: result.grid, stops: result.stops, lines: result.lines, lineWin: result.lineWin, coins: result.coins, bonus: result.bonus, coinGame: result.coinGame, win: result.win, capped: result.capped, payIn: payIn });
        } finally {
          busy.delete(username);
        }
      }),
    );

    socket.on(
      "claimBonus",
      safe("claimBonus", async () => {
        const paid = await coins.claim(username);
        if (paid) socket.emit("bonusClaimed", paid);
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
      // (a held bonus game keeps waiting - until the player comes back, or SLOTS_HOLD is over)
      machine.pending.forEach((entry) => schedulePay(entry, (entry.at || 0) - Date.now()));
      room.to(ROOM).emit("slotsFeed", machine.feed);
    },
  );

  // The server stops: every win that is still waiting is paid
  async function payAll() {
    await Promise.all(machine.pending.slice().map(payPending));
  }

  // Coins in play: a win (or a bonus game) not paid yet
  // Closing time before a season: every win (and bonus game) still waiting is paid now
  casinoLock.changes.on("locked", () => {
    payAll().catch((error) => console.error("[slots] Could not pay before the season:", error));
  });
  casinoLock.registerRunning("slots", () => machine.pending.length > 0);
  // (a spin without a win too, while its reels still turn on the page)
  inPlay.register("slots", (name) => machine.pending.some((entry) => entry.name === name) || Date.now() - (lastSpin.get(name) || 0) < config.SLOTS_SPIN + 500);

  // Debug (the admin's test world): the next spin starts the free spins ("free"), the coin game ("coins") or the coin game with a 🧰 ("chest")
  let nextBonus = null;
  function forceBonus(kind) {
    nextBonus = ["free", "coins", "chest"].includes(kind) ? kind : null;
    return true;
  }

  return { machine, payAll, forceBonus };
};
