const config = require("../game/config");
const coins = require("../game/coins");
const { newFairRound, fairWinner } = require("../game/jackpot");
const casinoChat = require("../game/casino_chat");
const socketAuth = require("./socket_auth");
const safe = require("./safe_handler");
const version = require("../game/version");

const ROOM = "jackpot"; // everybody is in the same (socket.io) room
const PHASE = {
  OPEN: "open", // waiting for a second player
  COUNTDOWN: "countdown", // the draw starts at endsAt
  DRAWING: "drawing", // the roulette spins, the winner is known on the server
};

/*
 * Hidden jackpot: one pot for everybody. Players put in coins, as soon as two
 * players are in, a countdown starts. Then a random ticket decides who wins
 * the whole pot - the more coins somebody put in, the higher the chance.
 */
module.exports = function (io) {
  const jackpot = io.of("/jackpot");
  jackpot.use(socketAuth);
  casinoChat.attach(jackpot, ROOM);

  const pot = {
    round: 1,
    phase: PHASE.OPEN,
    entries: [], // [{name, coins}] in the order of the first bet
    endsAt: null,
    draw: null, // {winner, ticket, total} while drawing
    mode: randomMode(), // the animation of this round (the same for everybody)
    timer: null,
    history: [], // [{round, winner, total, coins}] newest first
    // Every bet in the pot, oldest first. Each bet has its own tickets
    // (from..to, counted from 1) in the order of the bets: a later bet gets
    // the tickets at the end of the pot.
    bets: [], // [{name, amount, from, to}]
    // Bets on their way: they get into the pot only after a few seconds (no
    // sniping). Too late for the draw: the coins go back.
    incoming: [], // [{name, amount, landsAt, timer}]
    fair: newFairRound(), // winning number of the round, only its hash is public
    // Records of the day: biggest pot, luckiest win (smallest chance)
    records: { day: today(), biggest: null, luckiest: null },
  };

  function randomMode() {
    const modes = config.JACKPOT_DRAWS;
    return modes[Math.floor(Math.random() * modes.length)];
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }
  const betting = new Set(); // users with a bet in progress (two tabs, fast clicks)

  /*
   * What a player sees: the pot (only bets that arrived) and the own bets
   * that are still on their way.
   */
  function serialize(viewer) {
    const now = Date.now();
    return {
      round: pot.round,
      phase: pot.phase,
      mode: pot.mode,
      entries: pot.entries.map((entry) => ({ name: entry.name, coins: entry.coins })),
      total: total(),
      // Time left (ms) instead of a timestamp: the clocks of the clients may differ
      endsIn: pot.endsAt != null ? Math.max(0, pot.endsAt - now) : null,
      draw: pot.draw,
      bets: pot.bets,
      pending: pot.incoming.filter((bet) => bet.name === viewer).map((bet) => ({ name: bet.name, amount: bet.amount, in: Math.max(0, bet.landsAt - now) })),
      // The number and the secret are shown after the draw (provably fair)
      fair: pot.phase === PHASE.DRAWING ? pot.fair : { hash: pot.fair.hash },
      records: pot.records,
      spin: config.JACKPOT_SPIN,
      maxBets: config.JACKPOT_MAX_BETS,
      history: pot.history,
      viewers: jackpot.sockets.size,
    };
  }

  function total() {
    return pot.entries.reduce((sum, entry) => sum + entry.coins, 0);
  }

  function tellUser(username, event, data) {
    for (const socket of jackpot.sockets.values()) if (socket.data.username === username) socket.emit(event, data);
  }

  // A bet arrives in the pot (gets its tickets now)
  function land(bet) {
    pot.incoming.splice(pot.incoming.indexOf(bet), 1);
    const current = pot.entries.find((e) => e.name === bet.name);
    if (current != null) current.coins += bet.amount;
    else pot.entries.push({ name: bet.name, coins: bet.amount });
    const before = pot.bets.length > 0 ? pot.bets[pot.bets.length - 1].to : 0;
    pot.bets.push({ name: bet.name, amount: bet.amount, from: before + 1, to: before + bet.amount });
    if (pot.phase === PHASE.OPEN && pot.entries.length >= 2) startCountdown();
    emitState();
  }

  // The draw starts: bets still on their way are too late, their coins go back
  function bounceIncoming() {
    for (const bet of pot.incoming.splice(0)) {
      clearTimeout(bet.timer);
      coins.add(bet.name, bet.amount, { reason: "jackpot refund", note: "too late for the draw" }).catch((error) => console.error("[jackpot] Could not refund:", error));
      tellUser(bet.name, "betError", "Too late - your bet didn't arrive before the draw. The coins are back.");
    }
  }

  // Any change of a balance (here, in a game, on another page): the open tabs get it
  coins.changes.on("change", (username) => sendCoins(username).catch(() => {}));

  function emitState() {
    for (const socket of jackpot.sockets.values()) socket.emit("jackpotState", serialize(socket.data.username));
  }


  // Sends the balance to every open tab of the user
  async function sendCoins(username) {
    const data = await coins.get(username);
    for (const socket of jackpot.sockets.values()) {
      if (socket.data.username === username) socket.emit("coins", data);
    }
  }

  /* ---------- Round ---------- */

  function startCountdown() {
    pot.phase = PHASE.COUNTDOWN;
    pot.endsAt = Date.now() + config.JACKPOT_COUNTDOWN;
    clearTimeout(pot.timer);
    pot.timer = setTimeout(() => runDraw().catch((error) => console.error("[jackpot] Draw failed:", error)), config.JACKPOT_COUNTDOWN);
  }

  async function runDraw() {
    if (pot.phase !== PHASE.COUNTDOWN) return;
    pot.phase = PHASE.DRAWING;
    pot.endsAt = null;
    bounceIncoming();

    // The ticket decides: every coin is one ticket, so the chance is the share of
    // the pot. Which ticket was fixed at the start of the round (provably fair).
    // The tickets go through the bets in their order (not per player).
    pot.draw = fairWinner(pot.bets.map((bet) => ({ name: bet.name, coins: bet.amount })), pot.fair.number);
    const sum = pot.draw.total;
    const winner = pot.entries.find((entry) => entry.name === pot.draw.winner);

    // Paid right away, so nothing is lost if the page (or the server) goes away
    // during the animation
    try {
      await coins.add(winner.name, sum, { quiet: true, reason: "jackpot win" });
    } catch (error) {
      console.error("[jackpot] Could not pay the winner:", error);
    }
    emitState();

    // Announced after the roulette, so the chat doesn't spoil it
    pot.timer = setTimeout(() => {
      const result = { round: pot.round, winner: winner.name, total: sum, coins: winner.coins };
      pot.history.unshift(result);
      if (pot.records.day !== today()) pot.records = { day: today(), biggest: null, luckiest: null };
      if (pot.records.biggest == null || sum > pot.records.biggest.total) pot.records.biggest = result;
      if (pot.records.luckiest == null || winner.coins / sum < pot.records.luckiest.coins / pot.records.luckiest.total) {
        pot.records.luckiest = result;
      }
      pot.history.length = Math.min(pot.history.length, config.JACKPOT_HISTORY);
      coins.notify(winner.name);
      emitState();
      pot.timer = setTimeout(newRound, config.JACKPOT_PAUSE);
    }, config.JACKPOT_SPIN);
  }

  function newRound() {
    pot.round++;
    pot.phase = PHASE.OPEN;
    pot.entries = [];
    pot.bets = [];
    pot.fair = newFairRound();
    pot.mode = randomMode();
    pot.endsAt = null;
    pot.draw = null;
    emitState();
  }

  /* ---------- Connection ---------- */

  jackpot.on("connection", (socket) => {
    version.announce(socket);
    const username = socket.data.username;
    socket.gameID = ROOM; // for the chat
    socket.join(ROOM);
    socket.emit("joined", { username: username });
    casinoChat.join(socket);
    emitState();
    sendCoins(username).catch((error) => console.error("[jackpot] Could not load coins:", error));

    // Put coins into the pot (more than once per round is fine, up to the limit)
    socket.on(
      "bet",
      safe("bet", async (data) => {
        const amount = data != null ? data.amount : null;
        if (!Number.isInteger(amount) || amount <= 0) return;
        if (pot.phase === PHASE.DRAWING) {
          socket.emit("betError", "The draw is running - wait for the next round.");
          return;
        }
        // One bet at a time per user (two tabs, fast clicks)
        if (betting.has(username)) return;
        // Any amount, but at most a few separate bets per round
        if (pot.bets.concat(pot.incoming).filter((bet) => bet.name === username).length >= config.JACKPOT_MAX_BETS) {
          socket.emit("betError", `At most ${config.JACKPOT_MAX_BETS} bets per round.`);
          return;
        }
        betting.add(username);
        const round = pot.round;
        try {
          if (!(await coins.spend(username, amount, { reason: "jackpot bet" }))) {
            socket.emit("betError", "You don't have enough coins.");
            return;
          }
          // The round changed (draw started) while the coins were taken: give them back
          if (pot.round !== round || pot.phase === PHASE.DRAWING) {
            await coins.add(username, amount, { reason: "jackpot refund" });
            socket.emit("betError", "Too late - the draw already started.");
            return;
          }
          // On its way: in the pot only after a few seconds (nobody can answer a bet in the last second)
          const [low, high] = config.JACKPOT_BET_DELAY;
          const delay = Math.round(low + Math.random() * (high - low));
          const bet = { name: username, amount: amount, landsAt: Date.now() + delay, timer: null };
          pot.incoming.push(bet);
          bet.timer = setTimeout(() => land(bet), delay);
          emitState();
        } finally {
          betting.delete(username);
          sendCoins(username).catch(() => {});
        }
      }),
    );

    /*
     * Secret code: the page sends the last letters typed on it, the server
     * checks them (the word itself is not in the page's code).
     */
    socket.on(
      "typed",
      safe("typed", async (letters) => {
        if (typeof letters !== "string" || letters.length > 32) return;
        if (!letters.toLowerCase().endsWith(config.JACKPOT_SECRET)) return;
        const now = Date.now();
        if (now - (socket.data.secretAt || 0) < config.JACKPOT_SECRET_COOLDOWN) return;
        socket.data.secretAt = now;
        if (await coins.add(username, config.JACKPOT_SECRET_COINS, { reason: "secret word" })) {
          socket.emit("secretCoins", config.JACKPOT_SECRET_COINS);
        }
      }),
    );

    // Free coins once a day when (almost) broke
    socket.on(
      "claimBonus",
      safe("claimBonus", async () => {
        if (await coins.claimBonus(username)) {
          socket.emit("bonusClaimed", config.DAILY_BONUS);
        }
        await sendCoins(username);
      }),
    );

    socket.on(
      "sendChatMessage",
      safe("sendChatMessage", (data) => casinoChat.fromUser(socket, data)),
    );

    socket.on(
      "disconnect",
      safe("disconnect", () => emitState()),
    );
  });

  return { pot };
};
