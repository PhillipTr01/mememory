const crypto = require("crypto");
const config = require("../game/config");
const coins = require("../game/coins");
const inPlay = require("../game/in_play");
const casinoLock = require("../game/casino_lock");
const cases = require("../game/cases");
const casinoChat = require("../game/casino_chat");
const socketAuth = require("./socket_auth");
const notices = require("../game/notices");
const persist = require("../game/persist");
const live = require("../game/live");
const safe = require("./safe_handler");
const version = require("../game/version");

const ROOM = "battles"; // everybody sees every battle
const PHASE = {
  WAITING: "waiting", // seats are free
  RUNNING: "running", // full: one case after the other is opened
  DONE: "done",
  CANCELLED: "cancelled",
};
const SIZES = [2, 3, 4];
const MODES = ["classic", "crazy", "random"];
const BOT_NAMES = ["Bot Pepe", "Bot Doge", "Bot Wojak"];

/*
 * Hidden case battles (like on csgofast): 2-4 players pay the same cases, every
 * round all of them open the same case. Whoever has the most worth in items at
 * the end gets everything (crazy mode: the least). Paid out in coins.
 * The mode: classic (most wins), crazy (least wins) or random - one of the
 * two, decided by the seed (provably fair) and shown only at the end.
 */
module.exports = function (io) {
  const battles = io.of("/battles");
  battles.use(socketAuth.casino);
  casinoChat.attach(battles, ROOM);

  const lobby = {
    list: new Map(), // id -> battle
    history: [], // [{id, winner, total, price}] newest first
  };
  const busy = new Set(); // users with a payment in progress (two tabs, fast clicks)

  function newId() {
    return crypto.randomBytes(4).toString("hex");
  }

  function humans(battle) {
    return battle.seats.filter((seat) => seat != null && !seat.bot);
  }

  // Items worth per seat, from the rounds that are already shown
  function totals(battle, rounds) {
    return battle.seats.map((_, seat) =>
      rounds.reduce((sum, round, index) => sum + cases.caseById(battle.cases[index]).items[round[seat]].value, 0),
    );
  }

  // classic | crazy | random (battles from before there were modes: from crazy)
  function modeOf(battle) {
    return battle.mode || (battle.crazy ? "crazy" : "classic");
  }

  function serialize(battle) {
    const done = battle.phase === PHASE.DONE;
    const rounds = battle.results.slice(0, battle.revealed);
    return {
      id: battle.id,
      creator: battle.creator,
      size: battle.size,
      mode: modeOf(battle),
      // Random: which mode it is only comes out at the end
      crazy: modeOf(battle) === "random" && !done ? null : battle.crazy,
      cases: battle.cases,
      price: battle.price,
      seats: battle.seats,
      phase: battle.phase,
      revealed: battle.revealed,
      rounds: rounds, // [[item index per seat] per shown round]
      totals: totals(battle, rounds),
      nextIn: battle.nextAt != null ? Math.max(0, battle.nextAt - Date.now()) : null,
      winner: done ? battle.winner : null, // seat (the first one of a tie)
      winners: done ? winnersOf(battle) : null, // seats - a tie: all of them, they split the pot
      shares: done ? sharesOf(battle) : null, // what each of them gets
      payout: done ? battle.payout : null,
      // The seed is shown after the battle (provably fair)
      fair: done ? battle.fair : { hash: battle.fair.hash },
    };
  }

  function emitList() {
    const order = { running: 0, waiting: 1, done: 2 };
    const list = [...lobby.list.values()]
      .filter((battle) => battle.phase !== PHASE.CANCELLED)
      .sort((a, b) => order[a.phase] - order[b.phase] || b.createdAt - a.createdAt)
      .map(serialize);
    battles.to(ROOM).emit("battles", { list: list, history: lobby.history, round: config.BATTLE_ROUND });
    persist.changed("battles");
  }

  // Sends the balance to every open tab of the user
  async function sendCoins(username) {
    const data = await coins.get(username);
    for (const socket of battles.sockets.values()) {
      if (socket.data.username === username) socket.emit("coins", data);
    }
  }

  // Any change of a balance (here, in a game, on another page): the open tabs get it
  coins.changes.on("change", (username) => sendCoins(username).catch(() => {}));

  function refund(battle) {
    for (const seat of humans(battle)) {
      coins.add(seat.name, battle.price, { reason: "battle refund" }).catch((error) => console.error("[battles] Could not refund:", error));
    }
  }

  function remove(battle, after) {
    battle.timer = setTimeout(() => {
      lobby.list.delete(battle.id);
      emitList();
    }, after);
  }

  /* ---------- Battle ---------- */

  function cancel(battle) {
    if (battle.phase !== PHASE.WAITING) return;
    clearTimeout(battle.timer);
    battle.phase = PHASE.CANCELLED;
    refund(battle);
    lobby.list.delete(battle.id);
    emitList();
  }

  async function start(battle) {
    clearTimeout(battle.timer);
    battle.phase = PHASE.RUNNING;

    // Every item comes from the seed: round r, seat s
    battle.results = battle.cases.map((id, round) =>
      battle.seats.map((_, seat) => cases.itemFor(cases.caseById(id), cases.roll(battle.fair.seed, `${battle.id}:${round}:${seat}`))),
    );
    // Random: the seed decides the mode (and nobody sees it before the end)
    if (modeOf(battle) === "random") battle.crazy = cases.roll(battle.fair.seed, `${battle.id}:mode`) < 0.5;
    const all = totals(battle, battle.results);
    const best = battle.crazy ? Math.min(...all) : Math.max(...all);
    const tied = all.map((total, seat) => (total === best ? seat : -1)).filter((seat) => seat >= 0);
    // A tie: every one of them wins - the pot is split (a coin left over goes to the first)
    battle.winners = tied;
    battle.winner = tied[0];
    battle.payout = all.reduce((sum, total) => sum + total, 0);
    battle.shares = tied.map((_, i) => Math.floor(battle.payout / tied.length) + (i < battle.payout % tied.length ? 1 : 0));

    // The winner is paid when the battle is over (see finish) - not before:
    // the coins can't be played elsewhere while the cases are still opened
    battle.payAtEnd = true;
    battle.paid = false;

    // A short countdown, then one round after the other
    battle.begin = Date.now() + config.BATTLE_START;
    battle.nextAt = battle.begin;
    emitList();
    // Everybody in it hears it, on whatever casino page they are
    const players = battle.seats.map((seat) => seat.name);
    for (const seat of humans(battle)) {
      notices.send(seat.name, "battleStarted", { id: battle.id, price: battle.price, cases: battle.cases.length, players: players, crazy: modeOf(battle) === "random" ? null : battle.crazy, mode: modeOf(battle) });
    }
    scheduleReveal(battle);
  }

  // One round after the other (round r is shown at begin + r * BATTLE_ROUND), then the end
  function scheduleReveal(battle) {
    const reveal = () => {
      battle.revealed++;
      battle.nextAt = battle.begin + battle.revealed * config.BATTLE_ROUND;
      if (battle.revealed < battle.cases.length) battle.timer = setTimeout(reveal, battle.nextAt - Date.now());
      else battle.timer = setTimeout(() => finish(battle), battle.nextAt - Date.now());
      emitList();
    };
    if (battle.revealed < battle.cases.length) battle.timer = setTimeout(reveal, battle.nextAt - Date.now());
    else battle.timer = setTimeout(() => finish(battle), battle.nextAt - Date.now());
  }

  // Who won (a tie: all of them) and what each gets
  function winnersOf(battle) {
    return Array.isArray(battle.winners) ? battle.winners : [battle.winner];
  }
  function sharesOf(battle) {
    return Array.isArray(battle.shares) ? battle.shares : [battle.payout];
  }

  // The pot goes to the winner(s) - once (battles from before payAtEnd were paid at the start)
  async function payWinner(battle) {
    if (!battle.payAtEnd || battle.paid || battle.payout <= 0) return;
    battle.paid = true;
    persist.changed("battles");
    const shares = sharesOf(battle);
    await Promise.all(
      winnersOf(battle).map(async (seat, i) => {
        const winner = battle.seats[seat];
        // (a bot's share stays in the house)
        if (winner.bot || shares[i] <= 0) return;
        try {
          await coins.add(winner.name, shares[i], { reason: "battle win", note: shares.length > 1 ? "split pot" : undefined });
        } catch (error) {
          console.error("[battles] Could not pay a winner:", error);
        }
      }),
    );
  }

  function finish(battle) {
    battle.phase = PHASE.DONE;
    battle.nextAt = null;
    battle.doneAt = Date.now();
    // Random: the pages show which mode it was first - then the coins come
    if (modeOf(battle) === "random") setTimeout(() => payWinner(battle), config.BATTLE_MODE_REVEAL).unref();
    else payWinner(battle);
    const winners = winnersOf(battle).map((seat) => battle.seats[seat]);
    lobby.history.unshift({ id: battle.id, winner: winners[0].name, winners: winners.map((w) => w.name), bot: winners.every((w) => w.bot), total: battle.payout, price: battle.price });
    lobby.history.length = Math.min(lobby.history.length, config.BATTLE_HISTORY);

    emitList();
    remove(battle, config.BATTLE_KEEP);
  }

  // Takes the coins and puts the user (or a bot) into a free seat
  async function sit(socket, battle, username) {
    if (busy.has(username)) return false;
    busy.add(username);
    try {
      if (!(await coins.spend(username, battle.price, { reason: "battle" }))) {
        socket.emit("battleError", "You don't have enough coins.");
        return false;
      }
      const seat = battle.seats.indexOf(null);
      // Somebody else was faster (or the battle was cancelled): coins back
      if (battle.phase !== PHASE.WAITING || seat < 0 || battle.seats.some((s) => s && s.name === username)) {
        await coins.add(username, battle.price, { reason: "battle refund" });
        socket.emit("battleError", "Too late - the battle is full.");
        return false;
      }
      battle.seats[seat] = { name: username, bot: false };
      return true;
    } finally {
      busy.delete(username);
      sendCoins(username).catch(() => {});
    }
  }

  function startIfFull(battle) {
    if (battle.seats.includes(null)) {
      emitList();
      return;
    }
    start(battle).catch((error) => console.error("[battles] Start failed:", error));
  }

  /* ---------- Connection ---------- */

  // The admin turned cases on or off: every open page gets the new list
  require("../game/settings").changes.on("change", (values) => {
    if ("BATTLE_CASES_OFF" in values) battles.emit("cases", cases.catalog());
  });

  battles.on("connection", (socket) => {
    version.announce(socket);
    const username = socket.data.username;
    socket.gameID = ROOM; // for the chat
    socket.join(ROOM);
    socket.emit("joined", { username: username });
    socket.emit("cases", cases.catalog());
    socket.emit("battleRules", { maxCases: config.BATTLE_MAX_CASES });
    casinoChat.join(socket);
    emitList();
    sendCoins(username).catch((error) => console.error("[battles] Could not load coins:", error));

    socket.on(
      "createBattle",
      safe("createBattle", async (data) => {
        if (data == null || !Array.isArray(data.cases)) return;
        if (casinoLock.locked()) return socket.emit("battleError", casinoLock.message());
        const ids = data.cases;
        // Up to BATTLE_MAX_CASES cases (one round each)
        if (ids.length < 1 || !ids.every((id) => cases.caseById(id))) return;
        if (!ids.every((id) => cases.enabled(id))) return socket.emit("battleError", "One of these cases is not available anymore.");
        if (ids.length > config.BATTLE_MAX_CASES) {
          socket.emit("battleError", `At most ${config.BATTLE_MAX_CASES} cases per battle.`);
          return;
        }
        if (!SIZES.includes(data.size)) return;
        const open = [...lobby.list.values()].filter((b) => b.creator === username && b.phase === PHASE.WAITING);
        if (open.length >= config.BATTLE_MAX_OPEN) {
          socket.emit("battleError", `At most ${config.BATTLE_MAX_OPEN} open battles at a time.`);
          return;
        }
        const battle = {
          id: newId(),
          creator: username,
          size: data.size,
          mode: MODES.includes(data.mode) ? data.mode : data.crazy === true ? "crazy" : "classic",
          crazy: data.mode === "crazy" || (data.mode == null && data.crazy === true),
          cases: ids.slice(),
          price: ids.reduce((sum, id) => sum + cases.caseById(id).price, 0),
          seats: new Array(data.size).fill(null),
          phase: PHASE.WAITING,
          fair: cases.newSeed(),
          results: [],
          revealed: 0,
          nextAt: null,
          createdAt: Date.now(),
          timer: null,
        };
        if (!(await sit(socket, battle, username))) return;
        lobby.list.set(battle.id, battle);
        battle.timer = setTimeout(() => cancel(battle), config.BATTLE_EXPIRE);
        battle.timer.unref(); // a waiting battle doesn't keep the process alive
        socket.emit("battleCreated", battle.id);
        emitList();
      }),
    );

    socket.on(
      "joinBattle",
      safe("joinBattle", async (id) => {
        const battle = lobby.list.get(id);
        if (battle == null || battle.phase !== PHASE.WAITING) return;
        if (casinoLock.locked()) return socket.emit("battleError", casinoLock.message());
        if (battle.seats.some((seat) => seat && seat.name === username)) return;
        if (await sit(socket, battle, username)) startIfFull(battle);
      }),
    );

    // Only the creator: fills one free seat with a bot (its items go to the winner)
    socket.on(
      "addBot",
      safe("addBot", (id) => {
        const battle = lobby.list.get(id);
        if (battle == null || battle.phase !== PHASE.WAITING || battle.creator !== username) return;
        if (casinoLock.locked()) return socket.emit("battleError", casinoLock.message());
        const seat = battle.seats.indexOf(null);
        if (seat < 0) return;
        const name = BOT_NAMES.find((bot) => !battle.seats.some((s) => s && s.name === bot));
        battle.seats[seat] = { name: name, bot: true };
        startIfFull(battle);
      }),
    );

    // Only the creator, only while waiting: everybody gets the coins back
    socket.on(
      "cancelBattle",
      safe("cancelBattle", (id) => {
        const battle = lobby.list.get(id);
        if (battle == null || battle.creator !== username) return;
        cancel(battle);
      }),
    );

    // Free coins once a day when (almost) broke - the same as on the jackpot page
    socket.on(
      "claimBonus",
      safe("claimBonus", async () => {
        if (await coins.claimBonus(username)) socket.emit("bonusClaimed", coins.dailyBonus());
        await sendCoins(username);
      }),
    );

    socket.on(
      "sendChatMessage",
      safe("sendChatMessage", (data) => casinoChat.fromUser(socket, data)),
    );
  });

  live.register("battles", () => {
    const list = [...lobby.list.values()];
    const count = (phase) => list.filter((battle) => battle.phase === phase).length;
    return { waiting: count(PHASE.WAITING), running: count(PHASE.RUNNING), pot: list.filter((b) => b.phase === PHASE.RUNNING).reduce((sum, b) => sum + b.price * b.size, 0) };
  });

  /* ---------- Restart of the server ---------- */

  persist.register(
    "battles",
    () => ({ list: [...lobby.list.values()].filter((battle) => battle.phase !== PHASE.CANCELLED), history: lobby.history }),
    restore,
  );

  // The saved battles again: waiting ones wait on, running ones go on (after a short pause)
  function restore(saved) {
    for (const battle of lobby.list.values()) clearTimeout(battle.timer);
    lobby.list = new Map();
    lobby.history = saved.history || [];
    const now = Date.now();
    for (const battle of saved.list || []) {
      battle.timer = null;
      lobby.list.set(battle.id, battle);
      if (battle.phase === PHASE.WAITING) {
        battle.timer = setTimeout(() => cancel(battle), Math.max(config.RESTORE_GRACE, battle.createdAt + config.BATTLE_EXPIRE - now));
      } else if (battle.phase === PHASE.RUNNING) {
        // The next round a few seconds after the start, the rest as planned from there
        const shift = Math.max(0, now + 3000 - battle.nextAt);
        battle.begin += shift;
        battle.nextAt += shift;
        scheduleReveal(battle);
      } else if (battle.phase === PHASE.DONE) {
        payWinner(battle);
        remove(battle, Math.max(config.RESTORE_GRACE, (battle.doneAt || now) + config.BATTLE_KEEP - now));
      }
    }
    emitList();
  }

  // Coins in play: a seat in a battle that is not over - or a win not paid yet
  // Closing time before a season: open battles are cancelled (the coins back), running ones go on
  casinoLock.changes.on("locked", () => {
    for (const battle of [...lobby.list.values()]) if (battle.phase === PHASE.WAITING) cancel(battle);
  });
  casinoLock.registerRunning("battles", () => [...lobby.list.values()].some((b) => b.phase === PHASE.WAITING || b.phase === PHASE.RUNNING || (b.phase === PHASE.DONE && b.payAtEnd && !b.paid)));

  inPlay.register("battles", (name) =>
    [...lobby.list.values()].some((battle) => {
      if (!battle.seats.some((seat) => seat && seat.name === name)) return false;
      if (battle.phase === PHASE.WAITING || battle.phase === PHASE.RUNNING) return true;
      return battle.phase === PHASE.DONE && battle.payAtEnd && !battle.paid && winnersOf(battle).some((seat) => battle.seats[seat].name === name);
    }),
  );

  return { lobby };
};
