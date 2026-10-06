const crypto = require("crypto");
const config = require("../game/config");
const coins = require("../game/coins");
const cases = require("../game/cases");
const casinoChat = require("../game/casino_chat");
const socketAuth = require("./socket_auth");
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
const BOT_NAMES = ["Bot Pepe", "Bot Doge", "Bot Wojak"];

/*
 * Hidden case battles (like on csgofast): 2-4 players pay the same cases, every
 * round all of them open the same case. Whoever has the most worth in items at
 * the end gets everything (crazy mode: the least). Paid out in coins.
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

  function serialize(battle) {
    const done = battle.phase === PHASE.DONE;
    const rounds = battle.results.slice(0, battle.revealed);
    return {
      id: battle.id,
      creator: battle.creator,
      size: battle.size,
      crazy: battle.crazy,
      cases: battle.cases,
      price: battle.price,
      seats: battle.seats,
      phase: battle.phase,
      revealed: battle.revealed,
      rounds: rounds, // [[item index per seat] per shown round]
      totals: totals(battle, rounds),
      nextIn: battle.nextAt != null ? Math.max(0, battle.nextAt - Date.now()) : null,
      winner: done ? battle.winner : null, // seat
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
    const all = totals(battle, battle.results);
    const best = battle.crazy ? Math.min(...all) : Math.max(...all);
    const tied = all.map((total, seat) => (total === best ? seat : -1)).filter((seat) => seat >= 0);
    // A tie: the seed decides between them
    battle.winner = tied[Math.floor(cases.roll(battle.fair.seed, `${battle.id}:tie`) * tied.length)];
    battle.payout = all.reduce((sum, total) => sum + total, 0);

    // Paid right away (nothing is lost if the page goes away during the show),
    // the new balance is sent at the end so it doesn't spoil anything
    const winner = battle.seats[battle.winner];
    if (!winner.bot && battle.payout > 0) {
      try {
        await coins.add(winner.name, battle.payout, { quiet: true, reason: "battle win" });
      } catch (error) {
        console.error("[battles] Could not pay the winner:", error);
      }
    }

    // A short countdown, then one round after the other
    const begin = Date.now() + config.BATTLE_START;
    battle.nextAt = begin;
    emitList();
    const reveal = () => {
      battle.revealed++;
      if (battle.revealed < battle.cases.length) {
        battle.nextAt = begin + battle.revealed * config.BATTLE_ROUND;
        battle.timer = setTimeout(reveal, battle.nextAt - Date.now());
      } else {
        battle.nextAt = begin + battle.cases.length * config.BATTLE_ROUND;
        battle.timer = setTimeout(() => finish(battle), battle.nextAt - Date.now());
      }
      emitList();
    };
    battle.timer = setTimeout(reveal, config.BATTLE_START);
  }

  function finish(battle) {
    battle.phase = PHASE.DONE;
    battle.nextAt = null;
    const winner = battle.seats[battle.winner];
    lobby.history.unshift({ id: battle.id, winner: winner.name, bot: winner.bot, total: battle.payout, price: battle.price });
    lobby.history.length = Math.min(lobby.history.length, config.BATTLE_HISTORY);
    if (!winner.bot) coins.notify(winner.name);
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

  battles.on("connection", (socket) => {
    version.announce(socket);
    const username = socket.data.username;
    socket.gameID = ROOM; // for the chat
    socket.join(ROOM);
    socket.emit("joined", { username: username });
    socket.emit("cases", cases.catalog());
    casinoChat.join(socket);
    emitList();
    sendCoins(username).catch((error) => console.error("[battles] Could not load coins:", error));

    socket.on(
      "createBattle",
      safe("createBattle", async (data) => {
        if (data == null || !Array.isArray(data.cases)) return;
        const ids = data.cases;
        // Any number of cases (one round each)
        if (ids.length < 1 || !ids.every((id) => cases.caseById(id))) return;
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
          crazy: data.crazy === true,
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
        if (await coins.claimBonus(username)) socket.emit("bonusClaimed", config.DAILY_BONUS);
        await sendCoins(username);
      }),
    );

    socket.on(
      "sendChatMessage",
      safe("sendChatMessage", (data) => casinoChat.fromUser(socket, data)),
    );
  });

  return { lobby };
};
