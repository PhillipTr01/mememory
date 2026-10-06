const coins = require("../game/coins");
const config = require("../game/config");
const casinoChat = require("../game/casino_chat");
const socketAuth = require("./socket_auth");
const safe = require("./safe_handler");
const version = require("../game/version");

const ROOM = "casino";

/*
 * The start page of the hidden games: what is going on in every game, the
 * own coins and the chat of all games.
 */
module.exports = function (io, games) {
  const casino = io.of("/casino");
  casino.use(socketAuth);
  casinoChat.attach(casino, ROOM);

  function summary() {
    const pot = games.jackpot.pot;
    const now = Date.now();
    // Only the bets everybody can see already
    const shown = pot.bets.filter((bet) => pot.phase === "drawing" || bet.shownAt <= now);
    const battles = [...games.battles.lobby.list.values()];
    const seats = games.poker.table.seats;
    return {
      jackpot: { phase: pot.phase, total: shown.reduce((sum, bet) => sum + bet.amount, 0), players: new Set(shown.map((bet) => bet.name)).size },
      battles: { open: battles.filter((b) => b.phase === "waiting").length, running: battles.filter((b) => b.phase === "running").length },
      poker: { seated: seats.filter((seat) => seat != null).length, seats: seats.length, playing: games.poker.table.phase !== "waiting" },
    };
  }

  async function sendCoins(username) {
    const data = await coins.get(username);
    for (const socket of casino.sockets.values()) {
      if (socket.data.username === username) socket.emit("coins", data);
    }
  }

  coins.changes.on("change", (username) => sendCoins(username).catch(() => {}));

  // The numbers change all the time: every few seconds is enough
  const timer = setInterval(() => {
    if (casino.sockets.size > 0) casino.to(ROOM).emit("summary", summary());
  }, 2000);
  timer.unref();

  casino.on("connection", (socket) => {
    version.announce(socket);
    const username = socket.data.username;
    socket.join(ROOM);
    socket.emit("joined", { username: username });
    socket.emit("summary", summary());
    casinoChat.join(socket);
    sendCoins(username).catch((error) => console.error("[casino] Could not load coins:", error));

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

  return { summary };
};
