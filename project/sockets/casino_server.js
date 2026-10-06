const access = require("../game/access");
const settings = require("../game/settings");
const games = require("../game/games");
const { notices } = require("../game/notices");

const GAMES = ["/jackpot", "/battles", "/poker", "/blackjack"];

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

  // Access taken away: every open casino page of the player is closed
  access.changes.on("revoked", (username) => {
    for (const socket of socketsOf(io, username)) {
      socket.emit("casinoClosed");
      socket.disconnect(true);
    }
  });
};
