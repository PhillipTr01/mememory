const coins = require("../game/coins");
const config = require("../game/config");
const casinoChat = require("../game/casino_chat");
const socketAuth = require("./socket_auth");
const safe = require("./safe_handler");
const version = require("../game/version");
const access = require("../game/access");

const ROOM = "casino";

/*
 * The start page of the hidden games: what is going on in every game, the
 * own coins and the chat of all games.
 */
module.exports = function (io, games) {
  const casino = io.of("/casino");
  casino.use(socketAuth.casino);
  casinoChat.attach(casino, ROOM);

  function summary() {
    const pot = games.jackpot.pot;
    const shown = pot.bets; // only bets that arrived
    const battles = [...games.battles.lobby.list.values()];
    const seats = games.poker.table.seats;
    const bjSeats = games.blackjack.table.seats.filter((seat) => seat != null);
    return {
      jackpot: { phase: pot.phase, total: shown.reduce((sum, bet) => sum + bet.amount, 0), players: new Set(shown.map((bet) => bet.name)).size },
      battles: { open: battles.filter((b) => b.phase === "waiting").length, running: battles.filter((b) => b.phase === "running").length },
      poker: { seated: seats.filter((seat) => seat != null).length, seats: seats.length, playing: games.poker.table.phase !== "waiting" },
      blackjack: { players: new Set(bjSeats.map((seat) => seat.name)).size, seats: bjSeats.length, phase: games.blackjack.table.phase },
    };
  }

  async function sendCoins(username) {
    const data = await coins.get(username);
    for (const socket of casino.sockets.values()) {
      if (socket.data.username === username) socket.emit("coins", data);
    }
  }

  coins.changes.on("change", (username) => sendCoins(username).catch(() => {}));

  // Access taken away: every open casino page of the player is closed
  access.changes.on("revoked", (username) => {
    for (const name of ["/casino", "/jackpot", "/battles", "/poker", "/blackjack"]) {
      for (const socket of io.of(name).sockets.values()) {
        if (socket.data.username !== username) continue;
        socket.emit("casinoClosed");
        socket.disconnect(true);
      }
    }
  });

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
