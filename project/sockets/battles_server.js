const crypto = require("crypto");
const testMode = require("../game/test_mode");
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
const MODES = ["classic", "crazy", "random", "jackpot", "bestof", "worstof"];
const BOT_NAMES = ["Bot Pepe", "Bot Doge", "Bot Wojak"];
const TEAMS = [
  [0, 1],
  [2, 3],
]; // 2v2: the seats of team A and team B

/*
 * Hidden case battles (like on csgofast): 2-4 players pay the same cases, every
 * round all of them open the same case. Whoever has the most worth in items at
 * the end gets everything (crazy mode: the least). Paid out in coins.
 * Jackpot: one of the players gets everything - drawn from the seed, the
 * chance as big as the share of the pot the own items are worth. Best of:
 * every case is a round, the best item wins it - the most rounds win (equal:
 * the bigger total, still equal: split). Worst of: the same, but the least
 * item wins the round (equal rounds: the smaller total).
 * The mode: classic (most wins), crazy (least wins), jackpot, best of, worst of -
 * or random: one of all the others, decided by the seed (provably fair) and
 * shown only at the end.
 * 2v2 (teams, 4 players): seats 1-2 against seats 3-4 - every rule counts the two
 * of a team together (their totals, their items of a round added up; jackpot: the
 * team of the seat the ticket hits). The winning team splits the pot (a bot's half
 * stays in the house); a tie between the teams: all four split it.
 */
module.exports = function (io, options = {}) {
  // The real casino - or the admin's test world (game/worlds.js): its own namespace, nothing saved
  const world = options.world || "";
  const { coins, persist, live, inPlay, casinoLock, casinoChat, limits } = require("../game/worlds").services(world);
  const battles = io.of(world + "/battles");
  battles.use(socketAuth.casino);
  casinoChat.attach(battles, ROOM);
  // The biggest wins of the case battles (the side of the page)
  const best = require("../game/best_wins").attach(battles, "battle win", world);

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

  // Who plays together: 2v2 - [[0, 1], [2, 3]], otherwise every seat for itself
  function groupsOf(battle) {
    return battle.teams === true ? TEAMS : battle.seats.map((_, seat) => [seat]);
  }
  const groupSum = (group, values) => group.reduce((sum, seat) => sum + values[seat], 0);

  // Best of: the rounds every seat won (the best item of a round - equal: all of them)
  // (worst of: the least item wins the round). 2v2: a team's items of a round added up - both get its points
  function roundPoints(battle, rounds, least = false) {
    const points = battle.seats.map(() => 0);
    const groups = groupsOf(battle);
    rounds.forEach((round, index) => {
      const items = round.map((item) => cases.caseById(battle.cases[index]).items[item].value);
      const values = groups.map((group) => groupSum(group, items));
      const best = least ? Math.min(...values) : Math.max(...values);
      values.forEach((value, g) => {
        if (value === best) groups[g].forEach((seat) => points[seat]++);
      });
    });
    return points;
  }

  // Random: what the seed picks - every other mode
  function randomOptions() {
    return ["classic", "crazy", "jackpot", "bestof", "worstof"];
  }

  // Best of / worst of: the rounds won so far (null in the other modes)
  function pointsNow(battle, rounds, rule) {
    return rule === "bestof" || rule === "worstof" ? roundPoints(battle, rounds, rule === "worstof") : null;
  }

  // The rule that counts: the mode - or, in random, the one picked (battles from before: classic / crazy)
  function ruleOf(battle) {
    if (modeOf(battle) !== "random") return modeOf(battle);
    return battle.picked || (battle.crazy ? "crazy" : "classic");
  }

  // classic | crazy | random | jackpot | bestof (battles from before there were modes: from crazy)
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
      teams: battle.teams === true,
      mode: modeOf(battle),
      // Random: which mode it is only comes out at the end
      crazy: modeOf(battle) === "random" && !done ? null : battle.crazy,
      // Random: the mode it picked - only at the end
      picked: modeOf(battle) === "random" ? (done ? ruleOf(battle) : null) : null,
      cases: battle.cases,
      price: battle.price,
      seats: battle.seats,
      phase: battle.phase,
      revealed: battle.revealed,
      rounds: rounds, // [[item index per seat] per shown round]
      totals: totals(battle, rounds),
      // Best of: the rounds won so far
      points: pointsNow(battle, rounds, modeOf(battle) === "random" ? (done ? ruleOf(battle) : null) : modeOf(battle)),
      // Jackpot: the drawn ticket (in coins of the pot) - after the end
      ticket: done && ruleOf(battle) === "jackpot" ? battle.ticket : null,
      // (2v2 jackpot: the seat the ticket hit - its team won)
      ticketSeat: done && ruleOf(battle) === "jackpot" && battle.ticketSeat != null ? battle.ticketSeat : null,
      nextIn: battle.nextAt != null ? Math.max(0, battle.nextAt - Date.now()) : null,
      // A page opened in the middle: how long ago the last case started rolling, how long the end still plays
      roundAgo: battle.phase === PHASE.RUNNING && battle.revealed > 0 ? Math.max(0, Date.now() - (battle.begin + (battle.revealed - 1) * config.BATTLE_ROUND)) : null,
      endLeft: done && battle.doneAt ? Math.max(0, battle.doneAt + endWait(battle) - Date.now()) : null,
      doneAgo: done && battle.doneAt ? Math.max(0, Date.now() - battle.doneAt) : null,
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
    if (modeOf(battle) === "random") {
      const options = randomOptions(battle);
      battle.picked = options[Math.floor(cases.roll(battle.fair.seed, `${battle.id}:mode`) * options.length)];
      // (debug, the test world only: the mode the admin picked)
      if (forcedMode) {
        battle.picked = forcedMode;
        forcedMode = null;
      }
      battle.crazy = battle.picked === "crazy";
    }
    const all = totals(battle, battle.results);
    // (2v2: the two of a team count together - a seat stands for its team, the team wins)
    const groups = groupsOf(battle);
    const groupOf = (seat) => groups.findIndex((group) => group.includes(seat));
    const sums = groups.map((group) => groupSum(group, all));
    let tiedGroups;
    if (ruleOf(battle) === "jackpot") {
      // A ticket in the pot: who's worth covers it, wins it all (2v2: the seat's team)
      battle.crazy = false;
      const pot = all.reduce((sum, total) => sum + total, 0);
      battle.ticket = cases.roll(battle.fair.seed, `${battle.id}:jackpot`) * pot;
      let covered = 0;
      const winner = all.findIndex((total) => (covered += total) > battle.ticket);
      battle.ticketSeat = winner < 0 ? all.length - 1 : winner;
      tiedGroups = [groupOf(battle.ticketSeat)];
    } else if (ruleOf(battle) === "bestof" || ruleOf(battle) === "worstof") {
      // The most rounds - equal: the bigger total (worst of: the smaller) - still equal: all of them
      const least = ruleOf(battle) === "worstof";
      battle.crazy = false;
      const points = roundPoints(battle, battle.results, least);
      const groupPoints = groups.map((group) => points[group[0]]);
      const most = Math.max(...groupPoints);
      const leaders = groupPoints.map((p, g) => (p === most ? g : -1)).filter((g) => g >= 0);
      const top = least ? Math.min(...leaders.map((g) => sums[g])) : Math.max(...leaders.map((g) => sums[g]));
      tiedGroups = leaders.filter((g) => sums[g] === top);
    } else {
      const best = battle.crazy ? Math.min(...sums) : Math.max(...sums);
      tiedGroups = sums.map((total, g) => (total === best ? g : -1)).filter((g) => g >= 0);
    }
    const tied = tiedGroups.flatMap((g) => groups[g]);
    // A tie (2v2: the winning team - or both): every one of them wins - the pot is split (a coin left over goes to the first)
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
          // (the note: the mode and how many played - for the best wins)
          await coins.add(winner.name, shares[i], { reason: "battle win", bet: battle.price, note: [battle.mode, battle.teams ? "2v2" : battle.seats.length + " players", shares.length > 1 && !battle.teams ? "split pot" : null].filter(Boolean).join(" · ") });
          best.changed();
        } catch (error) {
          console.error("[battles] Could not pay a winner:", error);
        }
      }),
    );
  }

  // How long the pages play the end (random: the mode reveal, jackpot: the roulette) before the winner is paid
  function endWait(battle) {
    const random = modeOf(battle) === "random";
    return (random ? config.BATTLE_MODE_REVEAL : 0) + (ruleOf(battle) === "jackpot" ? Math.max(0, config.BATTLE_JACKPOT_DRAW - (random ? 3000 : 0)) : 0);
  }

  function finish(battle) {
    battle.phase = PHASE.DONE;
    battle.nextAt = null;
    battle.doneAt = Date.now();
    // Random: the pages show which mode it was first - then the coins come
    // (jackpot: the roulette rolls on the pages first)
    // (random -> jackpot: the roulette right after the reveal - without its own pause of 3 s)
    const wait = endWait(battle);
    // The last battles (with the winner) only when the pages showed it - not during a reveal
    const done = () => {
      payWinner(battle);
      const winners = winnersOf(battle).map((seat) => battle.seats[seat]);
      lobby.history.unshift({ id: battle.id, winner: winners[0].name, winners: winners.map((w) => w.name), bot: winners.every((w) => w.bot), total: battle.payout, price: battle.price, teams: battle.teams === true });
      lobby.history.length = Math.min(lobby.history.length, config.BATTLE_HISTORY);
      if (wait > 0) emitList();
    };
    if (wait > 0) setTimeout(done, wait).unref();
    else done();

    emitList();
    remove(battle, config.BATTLE_KEEP);
  }

  // Takes the coins and puts the user (or a bot) into a free seat
  // want: the seat the player picked (2v2: the team) - taken meanwhile or none: the first free one
  async function sit(socket, battle, username, want) {
    if (busy.has(username)) return false;
    // Test coins never play against real coins: a tester only with bots (and only alone among people)
    const others = battle.seats.filter((seat) => seat && !seat.bot && seat.name !== username);
    if (others.some((seat) => testMode.active(seat.name) !== testMode.active(username))) {
      socket.emit("battleError", testMode.active(username) ? testMode.MESSAGE : "🧪 This battle is a test of the admin - only bots can join it.");
      return false;
    }
    busy.add(username);
    try {
      // (the max bet by balance counts per battle - other open battles of the player don't count)
      if (!(await coins.spend(username, battle.price, { reason: "battle" }))) {
        socket.emit("battleError", coins.refusal(username) || "You don't have enough coins.");
        return false;
      }
      const seat = Number.isInteger(want) && want >= 0 && want < battle.seats.length && battle.seats[want] === null ? want : battle.seats.indexOf(null);
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
    // (the limits may have changed too - this world's)
    battles.emit("battleRules", { maxCases: limits.BATTLE_MAX_CASES, maxCost: limits.BATTLE_MAX_COST });
  });
  // ... or changed, added, deleted one in the case editor
  cases.changes.on("change", () => battles.emit("cases", cases.catalog()));

  battles.on("connection", (socket) => {
    version.announce(socket);
    const username = socket.data.username;
    socket.gameID = ROOM; // for the chat
    socket.join(ROOM);
    socket.emit("joined", { username: username });
    socket.emit("cases", cases.catalog());
    socket.emit("battleRules", { maxCases: limits.BATTLE_MAX_CASES, maxCost: limits.BATTLE_MAX_COST });
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
        if (ids.length > limits.BATTLE_MAX_CASES) {
          socket.emit("battleError", `At most ${limits.BATTLE_MAX_CASES} cases per battle.`);
          return;
        }
        // What one seat costs: all its cases together - at most BATTLE_MAX_COST
        const cost = ids.reduce((sum, id) => sum + cases.caseById(id).price, 0);
        if (cost > limits.BATTLE_MAX_COST) {
          socket.emit("battleError", `A battle costs at most 🪙 ${limits.BATTLE_MAX_COST.toLocaleString("en-US")} per player.`);
          return;
        }
        if (!SIZES.includes(data.size)) return;
        // Waiting and running battles of the creator count (a battle filled with bots is still one of theirs)
        const open = [...lobby.list.values()].filter((b) => b.creator === username && (b.phase === PHASE.WAITING || b.phase === PHASE.RUNNING));
        if (open.length >= limits.BATTLE_MAX_OPEN) {
          socket.emit("battleError", `At most ${limits.BATTLE_MAX_OPEN} battles of yours at a time - wait until one is over.`);
          return;
        }
        const battle = {
          id: newId(),
          creator: username,
          size: data.size,
          // 2v2: two teams of two (only with 4 players)
          teams: data.teams === true && data.size === 4,
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

    // id - or {id, seat}: a seat of its own (2v2: the team)
    socket.on(
      "joinBattle",
      safe("joinBattle", async (data) => {
        const id = data != null && typeof data === "object" ? data.id : data;
        const want = data != null && typeof data === "object" ? data.seat : null;
        const battle = lobby.list.get(id);
        if (battle == null || battle.phase !== PHASE.WAITING) return;
        if (casinoLock.locked()) return socket.emit("battleError", casinoLock.message());
        if (battle.seats.some((seat) => seat && seat.name === username)) return;
        if (await sit(socket, battle, username, want)) startIfFull(battle);
      }),
    );

    // Only the creator: fills one free seat with a bot (its items go to the winner)
    socket.on(
      "addBot",
      safe("addBot", (data) => {
        // id - or {id, seat}: the seat for the bot (2v2: the team)
        const id = data != null && typeof data === "object" ? data.id : data;
        const want = data != null && typeof data === "object" ? data.seat : null;
        const battle = lobby.list.get(id);
        if (battle == null || battle.phase !== PHASE.WAITING || battle.creator !== username) return;
        if (casinoLock.locked()) return socket.emit("battleError", casinoLock.message());
        const seat = Number.isInteger(want) && want >= 0 && want < battle.seats.length && battle.seats[want] === null ? want : battle.seats.indexOf(null);
        if (seat < 0) return;
        const name = BOT_NAMES.find((bot) => !battle.seats.some((s) => s && s.name === bot));
        battle.seats[seat] = { name: name, bot: true };
        startIfFull(battle);
      }),
    );

    // Everybody but the creator, only while waiting: the seat is free again, the coins come back
    socket.on(
      "leaveBattle",
      safe("leaveBattle", async (id) => {
        const battle = lobby.list.get(id);
        if (battle == null || battle.phase !== PHASE.WAITING || battle.creator === username || busy.has(username)) return;
        const seat = battle.seats.findIndex((s) => s && !s.bot && s.name === username);
        if (seat < 0) return;
        busy.add(username);
        try {
          battle.seats[seat] = null;
          emitList();
          await coins.add(username, battle.price, { reason: "battle refund", note: "left" });
        } finally {
          busy.delete(username);
          sendCoins(username).catch(() => {});
        }
        socket.emit("battleLeft", battle.id);
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

  // The case versions battles here still have (they can't be removed in the case editor)
  cases.setUsedLookup(() => new Set([...lobby.list.values()].flatMap((battle) => battle.cases)));

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
      // The end still plays on the pages (the mode reveal, the jackpot roulette): nobody lost yet
      if (battle.phase === PHASE.DONE && battle.doneAt && Date.now() < battle.doneAt + endWait(battle)) return true;
      return battle.phase === PHASE.DONE && battle.payAtEnd && !battle.paid && winnersOf(battle).some((seat) => battle.seats[seat].name === name);
    }),
  );

  // Debug (the admin's test world): the mode the next random battle picks; a waiting battle filled with bots
  let forcedMode = null;
  function forceMode(mode) {
    forcedMode = randomOptions().includes(mode) ? mode : null;
    return true;
  }
  async function fillWithBots(username) {
    const battle = [...lobby.list.values()].find((b) => b.phase === PHASE.WAITING && b.seats.some((s) => s && s.name === username));
    if (!battle) return false;
    while (battle.phase === PHASE.WAITING && battle.seats.includes(null)) {
      const name = BOT_NAMES.find((bot) => !battle.seats.some((s) => s && s.name === bot));
      battle.seats[battle.seats.indexOf(null)] = { name: name, bot: true };
    }
    startIfFull(battle);
    return true;
  }

  return { lobby, forceMode, fillWithBots };
};
