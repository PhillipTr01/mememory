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
    feed: [], // [{name, bet, win, symbol, count, at}] newest first
    spins: 0, // spins since the start (for the admin overview)
  };
  const busy = new Set(); // a spin in progress (two tabs, fast clicks)
  const lastSpin = new Map(); // username -> time of the last spin

  function rules() {
    return { minBet: config.SLOTS_MIN_BET, maxBet: config.SLOTS_MAX_BET, lines: slots.LINE_COUNT, spinTime: config.SLOTS_SPIN };
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
          const result = slots.spin(bet);
          machine.spins++;
          if (result.win > 0) {
            const best = result.lines.reduce((a, b) => (b.multiplier > a.multiplier ? b : a));
            await coins.add(username, result.win, { reason: "slots win", note: `${best.count}x ${best.symbol}` });
            machine.feed.unshift({ name: username, bet: bet, win: result.win, symbol: best.symbol, count: best.count, at: Date.now() });
            machine.feed.length = Math.min(machine.feed.length, config.SLOTS_FEED);
          }
          socket.emit("slotsResult", { bet: bet, grid: result.grid, stops: result.stops, lines: result.lines, win: result.win });
          // The others see the win when the reels of the player have stopped
          if (result.win > 0) {
            const feed = machine.feed.slice();
            setTimeout(() => room.to(ROOM).emit("slotsFeed", feed), config.SLOTS_SPIN).unref();
            persist.changed("slots");
          }
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
    () => ({ feed: machine.feed, spins: machine.spins }),
    (saved) => {
      machine.feed = Array.isArray(saved.feed) ? saved.feed : [];
      machine.spins = saved.spins || 0;
      room.to(ROOM).emit("slotsFeed", machine.feed);
    },
  );

  return { machine };
};
