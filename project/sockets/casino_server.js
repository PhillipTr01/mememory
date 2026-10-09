const access = require("../game/access");
const settings = require("../game/settings");
const games = require("../game/games");
const { notices } = require("../game/notices");
const seasons = require("../game/seasons");
const maintenance = require("../game/maintenance");

const GAMES = ["/jackpot", "/battles", "/poker", "/blackjack", "/slots", "/roulette"];

function socketsOf(io, username) {
  const list = [];
  for (const name of GAMES) for (const socket of io.of(name).sockets.values()) if (socket.data.username === username) list.push(socket);
  return list;
}

/*
 * What all hidden games share: notices for a player on every open casino page
 * (a case battle starts), and when the admin takes a player's access away,
 * every open casino page of the player is closed.
 */
module.exports = function (io) {
  notices.on("notice", (username, event, data) => {
    for (const socket of socketsOf(io, username)) socket.emit(event, data);
  });

  // A game turned off (admin panel): its open pages go to another game
  settings.changes.on("change", (values) => {
    for (const game of games.GAMES) {
      if (values[game.key] !== false) continue;
      for (const socket of io.of(game.namespace).sockets.values()) {
        socket.emit("gameOff");
        socket.disconnect(true);
      }
    }
  });

  // Hard reset (admin panel): every open casino page is closed
  access.changes.on("closeAll", () => {
    for (const name of GAMES) {
      for (const socket of io.of(name).sockets.values()) {
        socket.emit("casinoClosed");
        socket.disconnect(true);
      }
    }
  });

  // A season starts: every open casino page loads anew (new coins, the games start anew)
  seasons.changes.on("started", (season) => {
    for (const name of GAMES) for (const socket of io.of(name).sockets.values()) socket.emit("seasonStarted", season);
  });

  // The casino closes for a season (and the countdown to its start): every open casino page shows it
  seasons.changes.on("closing", (info) => {
    for (const name of GAMES) for (const socket of io.of(name).sockets.values()) socket.emit("seasonClosing", info);
  });

  // A season is over: every open casino page shows it (with a link to the winners)
  seasons.changes.on("ended", (season) => {
    for (const name of GAMES) for (const socket of io.of(name).sockets.values()) socket.emit("seasonEnded", { id: season.id, name: season.name, icon: season.icon, winner: season.winner });
  });

  // A maintenance comes: every open casino page shows it (like before a season) - over: the season's again, if any
  maintenance.changes.on("closing", (info) => {
    const shown = info || seasons.closingInfo();
    for (const name of GAMES) for (const socket of io.of(name).sockets.values()) socket.emit("seasonClosing", shown);
  });

  // Maintenance: every open casino page of a player not on the whitelist is closed (it shows the maintenance page)
  maintenance.changes.on("change", () => {
    for (const name of GAMES) {
      for (const socket of io.of(name).sockets.values()) {
        if (maintenance.allowed(socket.data.username)) continue;
        socket.emit("casinoClosed");
        socket.disconnect(true);
      }
    }
  });

  // Access taken away: every open casino page of the player is closed
  access.changes.on("revoked", (username) => {
    for (const socket of socketsOf(io, username)) {
      socket.emit("casinoClosed");
      socket.disconnect(true);
    }
  });
};
