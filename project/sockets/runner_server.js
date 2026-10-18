const crypto = require("crypto");
const config = require("../game/config");
const runner = require("../game/runner");
const days = require("../game/days");
const socketAuth = require("./socket_auth");
const safe = require("./safe_handler");
const version = require("../game/version");

const ROOM = "runner";
const engine = runner.engine;

/*
 * The runner: every player alone. A run costs an entry (RUNNER_MIN_BET - RUNNER_MAX_BET - or nothing: practice). The
 * server gives the page a seed, the page plays the run live and sends its moves (a tick and a move each).
 * At the end the server plays the run again from the seed and the moves (public/scripts/runner_engine.js) -
 * its own replay decides the score, never the page. A run can't claim more time than it took here.
 * The page gone, silent too long, the server stopping: the run ends with the moves it has - the runner
 * runs on without them until it falls.
 */
module.exports = function (io, options = {}) {
  // The real casino - or the admin's test world (game/worlds.js): its own namespace, nothing saved
  const world = options.world || "";
  const { coins, persist, live, inPlay, casinoLock, casinoChat, limits } = require("../game/worlds").services(world);
  const room = io.of(world + "/runner");
  room.use(socketAuth.casino);
  casinoChat.attach(room, ROOM);
  // The biggest wins (the side of the page)
  const best = require("../game/best_wins").attach(room, "runner win", world);

  const state = {
    runs: new Map(), // username -> {id, seed, stake, startedAt, lastAt, moves}
    feed: [], // the last runs that paid: [{name, stake, score, win, at}] newest first
    bests: {}, // username -> the best score (paid or practice)
    daily: {}, // username -> {day, count} - paid runs today
    played: 0,
  };
  let nextId = 0;
  const timers = new Map(); // username -> the idle timer of the run

  const rules = () => ({ minBet: limits.RUNNER_MIN_BET, maxBet: limits.RUNNER_MAX_BET, coinBonus: config.RUNNER_COIN_BONUS, coinCap: config.RUNNER_COIN_CAP, table: runner.table(), daily: config.RUNNER_DAILY, tps: engine.TPS, countdown: config.RUNNER_COUNTDOWN, slope: config.RUNNER_SLOPE });

  async function sendCoins(username) {
    const data = await coins.get(username);
    for (const socket of room.sockets.values()) if (socket.data.username === username) socket.emit("coins", data);
  }
  coins.changes.on("change", (username) => sendCoins(username).catch(() => {}));

  const toUser = (username, event, data) => {
    for (const socket of room.sockets.values()) if (socket.data.username === username) socket.emit(event, data);
  };

  const today = () => days.dayNumber(Date.now());
  const usedToday = (username) => (state.daily[username] && state.daily[username].day === today() ? state.daily[username].count : 0);

  // The ticks a run may have now: the time since it started (and a little more)
  const allowed = (run, now = Date.now()) => Math.floor(((now - run.startedAt + config.RUNNER_SLACK) / 1000) * engine.TPS);

  /*
   * New moves of the page: in order, never ahead of the time the run took - and never far behind it: a
   * move has to reach the server about when it was made (the countdown and RUNNER_LATE for the network).
   * A page that plays the run slower than time goes (slow motion) loses its moves.
   */
  function addMoves(run, moves, now = Date.now()) {
    const high = allowed(run, now);
    const low = Math.floor(((now - run.startedAt - config.RUNNER_COUNTDOWN - config.RUNNER_LATE) / 1000) * engine.TPS);
    for (const move of engine.cleanMoves(moves)) {
      const last = run.moves.length ? run.moves[run.moves.length - 1][0] : -1;
      if (move[0] > last && move[0] <= high && move[0] >= low) run.moves.push(move);
    }
  }

  function watch(username) {
    clearTimeout(timers.get(username));
    const timer = setTimeout(() => finish(username).catch((error) => console.error("[runner] Could not end a run:", error)), config.RUNNER_IDLE);
    timer.unref();
    timers.set(username, timer);
  }

  // The end of a run: the server's replay, the payout
  async function finish(username) {
    const run = state.runs.get(username);
    if (!run) return null;
    state.runs.delete(username);
    clearTimeout(timers.get(username));
    timers.delete(username);
    persist.changed("runner");
    const result = engine.replay(run.seed, run.moves, allowed(run));
    const multiplier = run.stake > 0 ? runner.multiplier(result.distance) : 0;
    const win = runner.payout(run.stake, result.distance, result.coins);
    state.played++;
    const record = result.distance > (state.bests[username] || 0);
    if (record) state.bests[username] = result.distance;
    if (win > 0) {
      try {
        await coins.add(username, win, { reason: "runner win", note: `${result.distance.toLocaleString("en-US")} m · x${multiplier} · ${result.coins} coins +${Math.round(runner.coinBonus(result.coins) * 1000) / 10}%`, bet: run.stake });
        best.changed();
      } catch (error) {
        console.error("[runner] Could not pay a run:", error);
      }
      state.feed.unshift({ name: username, stake: run.stake, distance: result.distance, win: win, at: Date.now() });
      state.feed.length = Math.min(state.feed.length, 10);
      room.to(ROOM).emit("runnerFeed", state.feed);
    }
    persist.changed("runner");
    const answer = { id: run.id, practice: run.stake === 0, stake: run.stake, ...result, multiplier: multiplier, bonus: runner.coinBonus(result.coins), win: win, best: state.bests[username], record: record };
    toUser(username, "runnerResult", answer);
    return answer;
  }

  live.register("runner", () => ({ running: state.runs.size, played: state.played }));

  room.on("connection", (socket) => {
    version.announce(socket);
    const username = socket.data.username;
    socket.join(ROOM);
    socket.emit("joined", { username: username });
    socket.emit("runnerSetup", { rules: rules(), best: state.bests[username] || 0, today: usedToday(username) });
    socket.emit("runnerFeed", state.feed);
    casinoChat.join(socket);
    sendCoins(username).catch((error) => console.error("[runner] Could not load coins:", error));
    const error = (message) => socket.emit("runnerError", message);
    // (a run of an older page - a reload: it ended there, it ends here too)
    if (state.runs.has(username)) finish(username).catch(() => {});

    socket.on(
      "runStart",
      safe("runStart", async (data) => {
        const stake = data != null ? data.stake : null;
        if (!Number.isInteger(stake) || stake < 0) return;
        if (stake !== 0 && (stake < limits.RUNNER_MIN_BET || stake > limits.RUNNER_MAX_BET)) return error(`An entry is ${limits.RUNNER_MIN_BET.toLocaleString("en-US")} to ${limits.RUNNER_MAX_BET.toLocaleString("en-US")} coins.`);
        if (state.runs.has(username)) return error("Finish your run first.");
        if (stake > 0 && casinoLock.locked()) return error(casinoLock.message());
        if (stake > 0 && config.RUNNER_DAILY > 0 && usedToday(username) >= config.RUNNER_DAILY) return error(`You have played your ${config.RUNNER_DAILY} runs for today. Practice is still free.`);
        // (one start at a time: the coins first)
        state.runs.set(username, { pending: true });
        try {
          if (stake > 0 && !(await coins.spend(username, stake, { reason: "runner bet" }))) {
            state.runs.delete(username);
            return error(coins.refusal(username) || "You don't have enough coins.");
          }
        } catch (spendError) {
          state.runs.delete(username);
          throw spendError;
        }
        if (stake > 0) state.daily[username] = { day: today(), count: usedToday(username) + 1 };
        const run = { id: ++nextId + ":" + Date.now(), seed: crypto.randomInt(0, 2 ** 32), stake: stake, startedAt: Date.now(), moves: [] };
        state.runs.set(username, run);
        persist.changed("runner");
        watch(username);
        socket.emit("runnerStarted", { id: run.id, seed: run.seed, stake: stake, today: usedToday(username) });
      }),
    );

    // The moves so far (the page sends them every moment - a lost page loses none of them)
    socket.on(
      "runMoves",
      safe("runMoves", (data) => {
        const run = state.runs.get(username);
        if (!run || run.pending || !data || data.id !== run.id) return;
        addMoves(run, data.moves);
        watch(username);
      }),
    );

    // The runner fell on the page: the last moves - the server plays it again and pays
    socket.on(
      "runEnd",
      safe("runEnd", async (data) => {
        const run = state.runs.get(username);
        if (!run || run.pending || !data || data.id !== run.id) return;
        addMoves(run, data.moves);
        await finish(username);
      }),
    );

    socket.on(
      "sendChatMessage",
      safe("sendChatMessage", (data) => casinoChat.fromUser(socket, data)),
    );

    // The last page of the player is gone: the run ends where it is
    socket.on("disconnect", () => {
      if ([...room.sockets.values()].some((other) => other !== socket && other.data.username === username)) return;
      const run = state.runs.get(username);
      if (run && !run.pending) finish(username).catch((error) => console.error("[runner] Could not end a run:", error));
    });
  });

  // Every run still going ends now (the server stops, closing time before a season)
  async function finishAll() {
    await Promise.all([...state.runs.keys()].filter((name) => !state.runs.get(name).pending).map(finish));
  }
  casinoLock.changes.on("locked", () => finishAll().catch((error) => console.error("[runner] Could not end the runs:", error)));
  casinoLock.registerRunning("runner", () => state.runs.size > 0);
  inPlay.register("runner", (name) => state.runs.has(name));

  persist.register(
    "runner",
    () => ({ runs: [...state.runs.entries()].filter(([, run]) => !run.pending), feed: state.feed, bests: state.bests, daily: state.daily, played: state.played }),
    (saved) => {
      state.feed = Array.isArray(saved.feed) ? saved.feed : [];
      state.bests = saved.bests || {};
      state.daily = saved.daily || {};
      state.played = saved.played || 0;
      // Runs that were going at the stop: they end with the moves the server had
      state.runs = new Map(Array.isArray(saved.runs) ? saved.runs : []);
      for (const name of state.runs.keys()) finish(name).catch((error) => console.error("[runner] Could not end a run:", error));
    },
  );

  return { state, finish, finishAll };
};
