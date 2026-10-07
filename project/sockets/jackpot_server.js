const config = require("../game/config");
const coins = require("../game/coins");
const inPlay = require("../game/in_play");
const { newFairRound, fairWinner } = require("../game/jackpot");
const casinoChat = require("../game/casino_chat");
const socketAuth = require("./socket_auth");
const safe = require("./safe_handler");
const version = require("../game/version");
const persist = require("../game/persist");
const live = require("../game/live");

const ROOM = "jackpot"; // everybody is in the same (socket.io) room
// The house when a player is alone too long ("Ghost" can't be taken as a username)
const GHOST = "Ghost";
const OLD_GHOST = "Ghost bet"; // its name before (in a pot saved before the rename)
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
  jackpot.use(socketAuth.casino);
  casinoChat.attach(jackpot, ROOM);

  const pot = {
    round: 1,
    phase: PHASE.OPEN,
    entries: [], // [{name, coins}] in the order of the first bet
    endsAt: null,
    draw: null, // {winner, ticket, total} while drawing
    mode: randomMode(), // the animation of this round (the same for everybody)
    timer: null,
    ghostTimer: null, // a player alone in the pot: the ghost comes
    ghostAt: null,
    history: [], // [{round, winner, total, coins}] newest first
    // Every bet in the pot, oldest first. Each bet has its own tickets
    // (from..to, counted from 1) in the order of the bets: a later bet gets
    // the tickets at the end of the pot.
    bets: [], // [{name, amount, from, to}]
    // Bets on their way: they get into the pot only after a few seconds (no
    // sniping). Too late for the draw: the coins go back.
    incoming: [], // [{name, amount, landsAt, timer}]
    // Bets that arrived while the draw was running: they go into the next pot
    waiting: [], // [{name, amount}]
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
      entries: pot.entries.map((entry) => ({ name: entry.name, coins: entry.coins, ghost: entry.name === GHOST })),
      ghostIn: pot.ghostAt != null ? Math.max(0, pot.ghostAt - now) : null,
      total: total(),
      // Time left (ms) instead of a timestamp: the clocks of the clients may differ
      endsIn: pot.endsAt != null ? Math.max(0, pot.endsAt - now) : null,
      draw: pot.draw,
      bets: pot.bets,
      // Own bets that are not in the pot yet: on their way, or waiting for the next round
      pending: pot.incoming
        .map((bet) => ({ name: bet.name, amount: bet.amount, in: Math.max(0, bet.landsAt - now), next: pot.phase === PHASE.DRAWING }))
        .concat(pot.waiting.map((bet) => ({ name: bet.name, amount: bet.amount, in: 0, next: true })))
        .filter((bet) => bet.name === viewer),
      // The number and the secret are shown after the draw (provably fair)
      fair: pot.phase === PHASE.DRAWING ? pot.fair : { hash: pot.fair.hash },
      records: pot.records,
      spin: config.JACKPOT_SPIN,
      maxBets: config.JACKPOT_MAX_BETS,
      maxCoins: config.JACKPOT_MAX_COINS,
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

  // A bet arrives: in the pot (gets its tickets now) - or, while a draw is
  // running, it waits for the next pot
  function land(bet) {
    pot.incoming.splice(pot.incoming.indexOf(bet), 1);
    if (pot.phase === PHASE.DRAWING) {
      pot.waiting.push({ name: bet.name, amount: bet.amount });
      tellUser(bet.name, "betInfo", "The draw had already started - your bet goes into the next pot.");
      emitState();
      return;
    }
    addToPot(bet);
    emitState();
  }

  function addToPot(bet) {
    // A real player joins: the ghost is gone, the countdown goes on
    if (bet.name !== GHOST && hasGhost() && !pot.entries.some((e) => e.name === bet.name)) removeGhost();
    const current = pot.entries.find((e) => e.name === bet.name);
    if (current != null) current.coins += bet.amount;
    else pot.entries.push({ name: bet.name, coins: bet.amount });
    const before = pot.bets.length > 0 ? pot.bets[pot.bets.length - 1].to : 0;
    pot.bets.push({ name: bet.name, amount: bet.amount, from: before + 1, to: before + bet.amount });
    if (pot.phase === PHASE.OPEN && pot.entries.length >= 2) startCountdown();
    // Alone against the ghost and more coins in: the ghost answers (no sniping the pot)
    if (bet.name !== GHOST && current != null && hasGhost() && pot.entries.length === 2) addToPot({ name: GHOST, amount: ghostAmount(bet.amount) });
    // The first player: alone too long, the ghost comes
    if (pot.phase === PHASE.OPEN && pot.entries.length === 1 && pot.ghostTimer == null) startGhostTimer();
  }

  /* ---------- The ghost ---------- */

  function hasGhost() {
    return pot.entries.some((entry) => entry.name === GHOST);
  }

  function startGhostTimer(after = config.JACKPOT_GHOST_AFTER) {
    pot.ghostAt = Date.now() + after;
    pot.ghostTimer = setTimeout(addGhost, after);
    pot.ghostTimer.unref();
  }

  function stopGhostTimer() {
    clearTimeout(pot.ghostTimer);
    pot.ghostTimer = null;
    pot.ghostAt = null;
  }

  // 85-115% of the coins of the player who bet first (the house plays against them)
  function addGhost() {
    pot.ghostTimer = null;
    pot.ghostAt = null;
    if (pot.phase !== PHASE.OPEN || pot.entries.length !== 1) return;
    addToPot({ name: GHOST, amount: ghostAmount(pot.entries[0].coins) });
    emitState();
  }

  function ghostAmount(coins) {
    const [low, high] = config.JACKPOT_GHOST_SHARE;
    return Math.max(1, Math.round(coins * (low + Math.random() * (high - low))));
  }

  // The tickets are counted again without the ghost's
  function removeGhost() {
    pot.entries = pot.entries.filter((entry) => entry.name !== GHOST);
    let counted = 0;
    pot.bets = pot.bets
      .filter((bet) => bet.name !== GHOST)
      .map((bet) => {
        const renumbered = { name: bet.name, amount: bet.amount, from: counted + 1, to: counted + bet.amount };
        counted += bet.amount;
        return renumbered;
      });
  }

  // Any change of a balance (here, in a game, on another page): the open tabs get it
  coins.changes.on("change", (username) => sendCoins(username).catch(() => {}));

  function emitState() {
    for (const socket of jackpot.sockets.values()) socket.emit("jackpotState", serialize(socket.data.username));
    persist.changed("jackpot");
  }


  // Sends the balance to every open tab of the user
  async function sendCoins(username) {
    const data = await coins.get(username);
    for (const socket of jackpot.sockets.values()) {
      if (socket.data.username === username) socket.emit("coins", data);
    }
  }

  /* ---------- Round ---------- */

  function startCountdown(after = config.JACKPOT_COUNTDOWN) {
    pot.phase = PHASE.COUNTDOWN;
    pot.endsAt = Date.now() + after;
    clearTimeout(pot.timer);
    pot.timer = setTimeout(() => runDraw().catch((error) => console.error("[jackpot] Draw failed:", error)), after);
  }

  async function runDraw() {
    if (pot.phase !== PHASE.COUNTDOWN) return;
    stopGhostTimer();
    pot.phase = PHASE.DRAWING;
    pot.endsAt = null;
    pot.drawAt = Date.now();
    pot.paid = false;
    pot.announced = false;

    // The ticket decides: every coin is one ticket, so the chance is the share of
    // the pot. Which ticket was fixed at the start of the round (provably fair).
    // The tickets go through the bets in their order (not per player).
    pot.draw = fairWinner(pot.bets.map((bet) => ({ name: bet.name, coins: bet.amount })), pot.fair.number);
    emitState();

    // Announced after the roulette, so the chat doesn't spoil it
    pot.timer = setTimeout(announce, config.JACKPOT_SPIN);
  }

  // Paid when the animation is over (not before: the coins can't be played
  // elsewhere while the draw is still running). Once - a draw saved before this
  // was paid at its start (pot.paid). The ghost wins: the house keeps the pot.
  async function payWinner() {
    if (pot.paid) return;
    pot.paid = true;
    const winner = pot.entries.find((entry) => entry.name === pot.draw.winner);
    if (winner.name === GHOST) return;
    try {
      await coins.add(winner.name, pot.draw.total, { reason: "jackpot win", note: hasGhost() ? "against the ghost" : undefined });
    } catch (error) {
      console.error("[jackpot] Could not pay the winner:", error);
    }
  }

  // The animation is over: the winner in the history, then a new round
  function announce() {
    const sum = pot.draw.total;
    const winner = pot.entries.find((entry) => entry.name === pot.draw.winner);
    const ghostWon = winner.name === GHOST;
    pot.announced = true;
    const result = { round: pot.round, winner: winner.name, total: sum, coins: winner.coins };
    pot.history.unshift(result);
    if (pot.records.day !== today()) pot.records = { day: today(), biggest: null, luckiest: null };
    // Records only for players
    if (!ghostWon && (pot.records.biggest == null || sum > pot.records.biggest.total)) pot.records.biggest = result;
    if (!ghostWon && (pot.records.luckiest == null || winner.coins / sum < pot.records.luckiest.coins / pot.records.luckiest.total)) {
      pot.records.luckiest = result;
    }
    pot.history.length = Math.min(pot.history.length, config.JACKPOT_HISTORY);
    payWinner().catch(() => {});
    emitState();
    pot.timer = setTimeout(newRound, config.JACKPOT_PAUSE);
  }

  function newRound() {
    stopGhostTimer();
    pot.round++;
    pot.phase = PHASE.OPEN;
    pot.entries = [];
    pot.bets = [];
    pot.fair = newFairRound();
    pot.mode = randomMode();
    pot.endsAt = null;
    pot.draw = null;
    pot.drawAt = null;
    pot.paid = false;
    pot.announced = false;
    // The bets that came during the draw are the first ones in the new pot
    pot.waiting.splice(0).forEach(addToPot);
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
        // An old account with the name of the house can't play here
        if (username.toLowerCase() === GHOST.toLowerCase()) return socket.emit("betError", "This name is reserved.");
        // One bet at a time per user (two tabs, fast clicks)
        if (betting.has(username)) return;
        // Any amount, but at most a few separate bets per round (during a draw: for the next one)
        const round = pot.phase === PHASE.DRAWING ? [] : pot.bets;
        const mine = round.concat(pot.incoming, pot.waiting).filter((bet) => bet.name === username);
        if (mine.length >= config.JACKPOT_MAX_BETS) {
          socket.emit("betError", `At most ${config.JACKPOT_MAX_BETS} bets per round.`);
          return;
        }
        // All bets of a round together: at most JACKPOT_MAX_COINS
        const left = config.JACKPOT_MAX_COINS - mine.reduce((sum, bet) => sum + bet.amount, 0);
        if (amount > left) {
          socket.emit(
            "betError",
            left > 0
              ? `At most 🪙 ${config.JACKPOT_MAX_COINS.toLocaleString("en-US")} per round - you can put in 🪙 ${left.toLocaleString("en-US")} more.`
              : `At most 🪙 ${config.JACKPOT_MAX_COINS.toLocaleString("en-US")} per round.`,
          );
          return;
        }
        betting.add(username);
        try {
          if (!(await coins.spend(username, amount, { reason: "jackpot bet" }))) {
            socket.emit("betError", "You don't have enough coins.");
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

    // Free coins once a day (the button next to the balance at the top)
    socket.on(
      "claimBonus",
      safe("claimBonus", async () => {
        if (await coins.claimBonus(username)) {
          socket.emit("bonusClaimed", coins.dailyBonus());
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

  live.register("jackpot", () => ({ round: pot.round, phase: pot.phase, total: total(), players: pot.entries.length, mode: pot.mode }));

  /* ---------- Restart of the server ---------- */

  persist.register(
    "jackpot",
    () => ({
      round: pot.round,
      phase: pot.phase,
      entries: pot.entries,
      endsAt: pot.endsAt,
      draw: pot.draw,
      drawAt: pot.drawAt,
      paid: pot.paid,
      announced: pot.announced,
      mode: pot.mode,
      history: pot.history,
      bets: pot.bets,
      incoming: pot.incoming.map((bet) => ({ name: bet.name, amount: bet.amount, landsAt: bet.landsAt })),
      waiting: pot.waiting,
      fair: pot.fair,
      records: pot.records,
      ghostAt: pot.ghostAt,
    }),
    restore,
    // Hard reset: the first pot again, with a new secret number
    (initial) => {
      restore(initial);
      pot.fair = newFairRound();
      pot.mode = randomMode();
      pot.records = { day: today(), biggest: null, luckiest: null };
      emitState();
    },
  );

  // The saved pot again - the round goes on where it was (with a little time to come back)
  function restore(saved) {
    clearTimeout(pot.timer);
    stopGhostTimer();
    pot.incoming.forEach((bet) => clearTimeout(bet.timer));
    // Saved before the ghost was renamed
    const rename = (item) => item && item.name === OLD_GHOST && (item.name = GHOST);
    (saved.entries || []).forEach(rename);
    (saved.bets || []).forEach(rename);
    if (saved.draw && saved.draw.winner === OLD_GHOST) saved.draw.winner = GHOST;
    Object.assign(pot, saved, { timer: null, ghostTimer: null });
    const now = Date.now();
    const grace = config.RESTORE_GRACE;
    pot.incoming = (saved.incoming || []).map((bet) => ({ ...bet, landsAt: Math.max(bet.landsAt, now + 500) }));
    pot.incoming.forEach((bet) => (bet.timer = setTimeout(() => land(bet), bet.landsAt - now)));
    if (pot.phase === PHASE.OPEN) {
      if (pot.entries.length === 1) startGhostTimer(Math.max(grace, (saved.ghostAt || 0) - now));
    } else if (pot.phase === PHASE.COUNTDOWN) {
      startCountdown(Math.max(grace, (saved.endsAt || 0) - now));
    } else if (pot.phase === PHASE.DRAWING) {
      if (pot.announced) {
        pot.timer = setTimeout(newRound, config.JACKPOT_PAUSE);
      } else {
        pot.timer = setTimeout(announce, Math.max(1000, (pot.drawAt || 0) + config.JACKPOT_SPIN - now));
      }
    }
    emitState();
  }

  // Coins in play: a bet in the pot (until the next round starts), on its way or waiting for the next pot
  inPlay.register("jackpot", (name) => pot.entries.some((e) => e.name === name) || pot.incoming.some((b) => b.name === name) || pot.waiting.some((b) => b.name === name));

  return { pot };
};
