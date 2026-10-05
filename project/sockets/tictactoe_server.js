const Statistic = require("../models/Statistic");
const coins = require("../game/coins");
const rooms = require("../game/rooms");
const config = require("../game/config");
const ttt = require("../game/tictactoe");
const { STATUS, seatOf, serialize, graceFor } = require("../game/tictactoe_room");
const { notifyLobby } = require("../game/multiplayer_room");
const socketAuth = require("./socket_auth");
const safe = require("./safe_handler");
const version = require("../game/version");
const chat = require("../game/chat");

module.exports = function (io) {
  const tictactoe = io.of("/tictactoe");
  tictactoe.use(socketAuth);

  /* ---------- Helpers ---------- */

  function emitState(gameID, room) {
    tictactoe.to(gameID).emit("state", serialize(gameID, room));
    notifyLobby();
  }

  /*
   * Statistics: every finished round counts once (win / loss / draw), also
   * when it ended early (surrender, didn't come back).
   */
  function recordRound(room) {
    if (room.game == null || room.recordedRound === room.round) return;
    room.recordedRound = room.round;
    const winner = room.game.winner;
    room.seats.forEach((seat, index) => {
      if (seat == null) return;
      const field = winner == null ? "tictactoeDraw" : winner === index ? "tictactoeWin" : "tictactoeLose";
      // A database problem must not stop the game
      Statistic.increment(seat.name, field).catch((error) =>
        console.error("[tictactoe] Could not update statistic:", error),
      );
    });
  }

  function systemMessage(gameID, room, text, icon) {
    chat.system(tictactoe, gameID, room, text, icon);
  }

  function startGame(gameID, room, starter) {
    room.starter = starter;
    room.game = ttt.newGame(starter);
    room.forfeit = false;
    room.status = STATUS.PLAYING;
    room.round++;
    // Clients show who starts first, moves are possible afterwards
    room.startsAt = Date.now() + config.START_ANIMATION;
    room.seats.forEach((seat) => (seat.rematch = false));
    // Announced after the animation, so the chat doesn't spoil it
    const round = room.round;
    const name = room.seats[starter].name;
    setTimeout(() => {
      if (rooms.get(gameID, "tictactoe") === room && room.round === round) {
        // Same wording as in MemeMory
        const text = round === 1 ? `The game has started. ${name} begins!` : `New round - ${name} begins!`;
        systemMessage(gameID, room, text, "start");
      }
    }, config.START_ANIMATION);
  }

  function isEmpty(room) {
    return !room.seats.some((seat) => seat != null && seat.connected) && room.spectators.size === 0;
  }

  // The round ends early: the other player wins (surrender, didn't come back)
  function forfeitRound(gameID, room, loser, reason) {
    if (room.status !== STATUS.PLAYING || room.game == null || ttt.isOver(room.game)) return;
    const winner = 1 - loser;
    room.game.winner = winner;
    room.forfeit = reason;
    room.status = STATUS.FINISHED;
    recordRound(room);
    if (room.seats[winner] != null) {
      room.seats[winner].wins++;
      systemMessage(gameID, room, `${room.seats[winner].name} wins the round!`, "trophy");
    }
  }

  /*
   * A player leaves for good (left after the game, or didn't come back in
   * time). During a game the opponent wins. The seat becomes free.
   */
  function vacateSeat(gameID, room, index, reason) {
    const seat = room.seats[index];
    if (seat == null) return;

    systemMessage(gameID, room, `${seat.name} ${reason}.`, "leave");
    forfeitRound(gameID, room, index, "left");

    room.seats[index] = null;
    room.status = STATUS.WAITING;

    // New opponent -> new score
    const other = room.seats[1 - index];
    if (other != null) {
      other.wins = 0;
      other.rematch = false;
      room.host = other.name;
    }

    if (isEmpty(room) && room.emptySince == null) room.emptySince = Date.now();
    emitState(gameID, room);
  }

  /*
   * Like in MemeMory: a player who leaves a running game (or loses the
   * connection) keeps the seat for a while and can rejoin from the lobby.
   * Only if they don't come back in time, the opponent wins.
   */
  function markAway(gameID, room, index, text, icon) {
    const seat = room.seats[index];
    seat.connected = false;
    seat.disconnectedAt = Date.now();
    systemMessage(gameID, room, text, icon);
  }

  function leave(socket) {
    const gameID = socket.gameID;
    const room = rooms.get(gameID, "tictactoe");
    socket.gameID = null;
    if (gameID != null) socket.leave(gameID);
    if (room == null) return;

    room.spectators.delete(socket.id);
    const index = seatOf(room, socket.data.username);
    if (index >= 0 && room.seats[index].socketId === socket.id && room.seats[index].connected) {
      if (room.status === STATUS.PLAYING) {
        const seconds = Math.round(config.REJOIN_GRACE_PLAYING / 1000);
        markAway(gameID, room, index, `${socket.data.username} left - ${seconds}s to come back.`, "disconnect");
      } else {
        vacateSeat(gameID, room, index, "left the game");
        return;
      }
    }
    if (isEmpty(room) && room.emptySince == null) room.emptySince = Date.now();
    emitState(gameID, room);
  }

  /* ---------- Connection ---------- */

  tictactoe.on("connection", (socket) => {
    version.announce(socket);
    const username = socket.data.username;

    socket.on(
      "joinGame",
      safe("joinGame", (data) => {
        const gameID = data != null ? data.gameID : null;
        const watch = data != null && data.watch === true;
        const room = rooms.get(gameID, "tictactoe");

        if (room == null) {
          socket.emit("noGameFound");
          return;
        }
        if (socket.gameID === gameID) return;
        if (socket.gameID != null) leave(socket);

        rooms.touch(room);
        let index = seatOf(room, username);
        const wasSeated = index >= 0;
        const rejoined = wasSeated && !room.seats[index].connected;

        if (index >= 0) {
          // Back after a reload / lost connection. Another open tab is replaced.
          const seat = room.seats[index];
          if (seat.connected && seat.socketId !== socket.id) {
            const old = tictactoe.sockets.get(seat.socketId);
            if (old != null) {
              old.gameID = null;
              old.leave(gameID);
              old.emit("sessionReplaced");
              old.disconnect(true);
            }
          }
          seat.connected = true;
          seat.socketId = socket.id;
          seat.disconnectedAt = null;
        } else if (!watch && room.status === STATUS.WAITING && room.seats.includes(null)) {
          index = room.seats.indexOf(null);
          room.seats[index] = {
            name: username,
            connected: true,
            socketId: socket.id,
            disconnectedAt: null,
            wins: 0,
            rematch: false,
          };
          if (room.host == null || seatOf(room, room.host) < 0) room.host = username;
        } else {
          room.spectators.set(socket.id, username);
        }

        socket.gameID = gameID;
        socket.join(gameID);
        room.emptySince = null;

        socket.emit("joined", { username: username, seat: index });
        socket.emit("chatHistory", room.chat);
        if (rejoined) {
          systemMessage(gameID, room, `${username} is back.`, "reconnect");
        } else if (!wasSeated) {
          systemMessage(
            gameID,
            room,
            index >= 0 ? `${username} joined the room.` : `${username} is watching.`,
            index >= 0 ? "join" : "watch",
          );
        }
        // Both seats taken -> play, random player starts
        if (room.status === STATUS.WAITING && !room.seats.includes(null)) {
          startGame(gameID, room, Math.random() < 0.5 ? 0 : 1);
        }
        emitState(gameID, room);
      }),
    );

    socket.on(
      "place",
      safe("place", (data) => {
        const room = rooms.get(socket.gameID, "tictactoe");
        if (room == null || data == null || room.status !== STATUS.PLAYING) return;

        const index = seatOf(room, username);
        if (index < 0 || room.seats[index].socketId !== socket.id) return;
        // The "who starts" animation is still running
        if (Date.now() < room.startsAt) return;

        const result = ttt.place(room.game, index, data.size, data.cell);
        if (result.error) {
          socket.emit("moveError", result.error);
          return;
        }

        rooms.touch(room);
        if (ttt.isOver(room.game)) {
          room.status = STATUS.FINISHED;
          recordRound(room);
          if (room.game.winner != null) {
            room.seats[room.game.winner].wins++;
            // Coins for the hidden jackpot (only for a real win, not a forfeit)
            coins.reward(username, "tictactoe");
            systemMessage(socket.gameID, room, `${username} wins the round!`, "trophy");
          } else {
            systemMessage(socket.gameID, room, "Draw - nobody can move anymore.", "info");
          }
        }
        emitState(socket.gameID, room);
      }),
    );

    /* Both players want a rematch -> new game, the other player starts */
    socket.on(
      "rematch",
      safe("rematch", () => {
        const room = rooms.get(socket.gameID, "tictactoe");
        if (room == null || room.status !== STATUS.FINISHED) return;

        const index = seatOf(room, username);
        if (index < 0 || room.seats[index].socketId !== socket.id) return;

        room.seats[index].rematch = !room.seats[index].rematch;
        if (room.seats.every((seat) => seat != null && seat.rematch)) {
          startGame(socket.gameID, room, 1 - room.starter);
        }
        rooms.touch(room);
        emitState(socket.gameID, room);
      }),
    );

    socket.on(
      "sendChatMessage",
      safe("sendChatMessage", (data) => {
        const room = rooms.get(socket.gameID, "tictactoe");
        chat.fromUser(tictactoe, socket, room, data, room != null && seatOf(room, username) < 0);
      }),
    );

    // Give up the running round, the opponent wins. Both stay for a rematch.
    socket.on(
      "surrender",
      safe("surrender", () => {
        const room = rooms.get(socket.gameID, "tictactoe");
        if (room == null || room.status !== STATUS.PLAYING) return;
        const index = seatOf(room, username);
        if (index < 0 || room.seats[index].socketId !== socket.id) return;

        rooms.touch(room);
        systemMessage(socket.gameID, room, `${username} surrendered.`, "leave");
        forfeitRound(socket.gameID, room, index, "surrender");
        emitState(socket.gameID, room);
      }),
    );

    socket.on(
      "leave",
      safe("leave", () => leave(socket)),
    );

    socket.on(
      "disconnect",
      safe("disconnect", () => {
        const gameID = socket.gameID;
        const room = rooms.get(gameID, "tictactoe");
        if (room == null) return;

        room.spectators.delete(socket.id);
        const index = seatOf(room, username);
        // Players get some time to come back (reload, lost connection)
        if (index >= 0 && room.seats[index].socketId === socket.id && room.seats[index].connected) {
          markAway(gameID, room, index, `${username} lost the connection...`, "disconnect");
        }
        if (isEmpty(room) && room.emptySince == null) room.emptySince = Date.now();
        emitState(gameID, room);
      }),
    );
  });

  /* Players that didn't come back lose their seat, empty rooms are removed */
  function tick(now = Date.now()) {
    for (const [gameID, room] of rooms.list("tictactoe")) {
      try {
        room.seats.forEach((seat, index) => {
          if (seat == null || seat.connected) return;
          if (now - seat.disconnectedAt >= graceFor(room)) vacateSeat(gameID, room, index, "didn't come back");
        });

        if (room.emptySince != null && room.seats.every((seat) => seat == null || !seat.connected)) {
          const nobodyLeft = room.seats.every((seat) => seat == null);
          if (nobodyLeft && room.spectators.size === 0 && now - room.emptySince >= config.EMPTY_ROOM_GRACE) {
            rooms.remove(gameID);
          }
        }
      } catch (error) {
        console.error("[tictactoe] Room check failed:", error);
      }
    }
  }

  const ticker = setInterval(() => {
    try {
      tick();
    } catch (error) {
      console.error("[tictactoe] Tick failed:", error);
    }
  }, config.TICK);
  ticker.unref();

  return { tick };
};
