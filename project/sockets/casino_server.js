const access = require("../game/access");

/*
 * What all hidden games share: when the admin takes a player's access away,
 * every open casino page of the player is closed.
 */
module.exports = function (io) {
  // Access taken away: every open casino page of the player is closed
  access.changes.on("revoked", (username) => {
    for (const name of ["/jackpot", "/battles", "/poker", "/blackjack"]) {
      for (const socket of io.of(name).sockets.values()) {
        if (socket.data.username !== username) continue;
        socket.emit("casinoClosed");
        socket.disconnect(true);
      }
    }
  });
};
