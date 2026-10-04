const Statistic = require("../models/Statistic");
const rooms = require("../game/rooms");
const config = require("../game/config");
const { CARD_COUNT, isValidCardId } = require("../game/board");
const {
  STATUS,
  activePlayers,
  serialize,
  notifyLobby,
} = require("../game/multiplayer_room");
const socketAuth = require("./socket_auth");
const safe = require("./safe_handler");

module.exports = function (io) {
  const multiPlayer = io.of("/multiplayer");
  multiPlayer.use(socketAuth);

  // Sends the current room state (players, host, turn, settings) to everyone in the room.
  function emitRoomState(gameID, room) {
    multiPlayer.to(gameID).emit("roomState", serialize(gameID, room));
    notifyLobby();
  }

  // Chat message from the server itself (joins, leaves, game start, ...)
  function systemMessage(gameID, room, text) {
    addChatMessage(multiPlayer, gameID, room, { type: "system", text: text });
  }

  multiPlayer.on("connection", (socket) => {
    const username = socket.data.username;

    /* Enter a room - as player while it's waiting and not full, otherwise as spectator */
    socket.on(
      "joinRoom",
      safe("joinRoom", (data) => {
        const gameID = data != null ? data.gameID : null;
        const room = rooms.get(gameID, "multiplayer");

        if (socket.gameID != null) return;
        if (room == null || room.status === STATUS.FINISHED) {
          socket.emit("noGameFound");
          return;
        }

        const existing = room.players.find((player) => player.name === username);
        if (existing != null && existing.active) {
          socket.emit("gameError", "You are already in this room (maybe in another tab).");
          return;
        }

        rooms.touch(room);
        socket.gameID = gameID;
        socket.join(gameID);

        if (
          existing == null &&
          room.status === STATUS.WAITING &&
          room.players.length < room.maxPlayers
        ) {
          socket.spectator = false;
          room.players.push({ name: username, points: 0, active: true });
          systemMessage(gameID, room, `${username} joined the room.`);
        } else {
          socket.spectator = true;
          systemMessage(gameID, room, `${username} is watching.`);
        }

        socket.emit("joinedRoom", { username: username, spectator: socket.spectator });
        socket.emit("chatHistory", room.chat);

        // Show cards that have already been found
        for (const id of room.foundMatches) {
          socket.emit("turnCard", { id: id, src: room.cardImages[id] });
          socket.emit("understateCard", id);
        }

        emitRoomState(gameID, room);
      }),
    );

    /* Host settings in the waiting room */
    socket.on(
      "updateSettings",
      safe("updateSettings", (data) => {
        const room = rooms.get(socket.gameID, "multiplayer");
        if (room == null || data == null || room.status !== STATUS.WAITING || room.host !== username) {
          return;
        }

        if (data.maxPlayers !== undefined) {
          const maxPlayers = Number(data.maxPlayers);
          // Can't go below the players that are already in the room
          if (
            Number.isInteger(maxPlayers) &&
            maxPlayers >= Math.max(config.MIN_PLAYERS, room.players.length) &&
            maxPlayers <= config.MAX_PLAYERS
          ) {
            room.maxPlayers = maxPlayers;
          }
        }

        if (typeof data.isPublic === "boolean") {
          room.isPublic = data.isPublic;
        }

        rooms.touch(room);
        emitRoomState(socket.gameID, room);
      }),
    );

    socket.on(
      "startGame",
      safe("startGame", () => {
        const room = rooms.get(socket.gameID, "multiplayer");

        if (
          room == null ||
          room.status !== STATUS.WAITING ||
          room.host !== username ||
          room.players.length < config.MIN_PLAYERS
        ) {
          return;
        }

        rooms.touch(room);
        room.status = STATUS.PLAYING;
        room.turn = Math.floor(Math.random() * room.players.length);

        systemMessage(socket.gameID, room, `The game has started. ${room.players[room.turn].name} begins!`);
        emitRoomState(socket.gameID, room);
      }),
    );

    socket.on(
      "openCard",
      safe("openCard", (id) => {
        const room = rooms.get(socket.gameID, "multiplayer");
        if (room == null || !isValidCardId(id)) return;

        if (
          room.status === STATUS.PLAYING &&
          !room.openedCards.includes(id) &&
          !room.foundMatches.includes(id)
        ) {
          if (room.openedCards.length < 2 && isPlayersTurn(room, username)) {
            rooms.touch(room);
            room.openedCards.push(id);
            room.cardCounter[id]++;
            multiPlayer.to(socket.gameID).emit("turnCard", {
              id: id,
              src: room.cardImages[id],
            });

            checkGame(socket, room);
          }
        } else {
          socket.emit("zoomImage", id);
        }
      }),
    );

    socket.on(
      "sendChatMessage",
      safe("sendChatMessage", (data) => {
        const room = rooms.get(socket.gameID, "multiplayer");
        if (room == null || data == null || typeof data.message !== "string") return;

        const text = data.message.replace(/\s+/g, " ").trim().slice(0, config.MAX_CHAT_LENGTH);
        if (text.length == 0) return;

        const now = Date.now();
        if (now - (socket.lastChatMessage || 0) < config.CHAT_COOLDOWN) {
          socket.emit("chatError", "You are sending messages too fast.");
          return;
        }
        socket.lastChatMessage = now;

        addChatMessage(multiPlayer, socket.gameID, room, {
          type: "user",
          name: username,
          spectator: socket.spectator,
          text: text,
        });
      }),
    );

    // endTurn - only after two cards that don't match
    socket.on(
      "endTurn",
      safe("endTurn", () => {
        const room = rooms.get(socket.gameID, "multiplayer");

        if (
          room != null &&
          room.status === STATUS.PLAYING &&
          room.checkingCards &&
          room.openedCards.length == 2 &&
          isPlayersTurn(room, username)
        ) {
          rooms.touch(room);
          socket.emit("disableEndTurn");
          nextTurn(socket.gameID, room);
          emitRoomState(socket.gameID, room);
        }
      }),
    );

    // surrender - the player leaves the running game, but can keep watching
    socket.on(
      "surrender",
      safe("surrender", async () => {
        const room = rooms.get(socket.gameID, "multiplayer");
        if (room != null && room.status === STATUS.PLAYING) {
          await leaveGame(socket, "surrendered");
        }
      }),
    );

    // disconnect
    socket.on(
      "disconnect",
      safe("disconnect", async () => {
        await leaveGame(socket, "left the room");
      }),
    );
  });

  function checkGame(socket, room) {
    // If both cards are open check if those are a match.
    if (room.openedCards.length == 2 && !room.checkingCards) {
      room.checkingCards = true;

      if (!checkCards(socket.gameID, room)) {
        socket.emit("activateEndTurn");
      }
    }

    // Check for winner
    if (room.foundMatches.length == CARD_COUNT) {
      getWinner(socket.gameID, room).catch((error) =>
        console.error("[multiplayer] Could not finish game:", error),
      );
    }
  }

  function checkCards(gameID, room) {
    const id = room.openedCards[0];
    const id2 = room.openedCards[1];

    // Check if cards match
    const cardsMatch = room.cardPairs[id] == id2;

    if (cardsMatch) {
      // Push to foundMatches -> So it can't be opened again
      room.foundMatches.push(id, id2);

      // understateCard - remove Zoom and Border on cards
      setTimeout(() => multiPlayer.to(gameID).emit("understateCard", id), 500);
      setTimeout(() => multiPlayer.to(gameID).emit("understateCard", id2), 500);

      // Increase Points
      room.players[room.turn].points++;

      // Reset turn
      room.openedCards = [];
      room.checkingCards = false;
      emitRoomState(gameID, room);
    }

    return cardsMatch;
  }

  // Closes the open cards and gives the turn to the next active player.
  function nextTurn(gameID, room) {
    if (room.openedCards.length > 0) {
      multiPlayer.to(gameID).emit("closeCards", {
        1: room.openedCards[0],
        2: room.openedCards[1],
      });
    }

    const count = room.players.length;
    for (let step = 1; step <= count; step++) {
      const index = (room.turn + step) % count;
      if (room.players[index].active) {
        room.turn = index;
        break;
      }
    }

    // Reset turn
    room.openedCards = [];
    room.checkingCards = false;
  }

  async function leaveGame(socket, reason) {
    const gameID = socket.gameID;
    const room = rooms.get(gameID, "multiplayer");
    if (room == null || socket.spectator) return;

    const index = room.players.findIndex((player) => player.name === socket.data.username);
    if (index < 0) return;
    const player = room.players[index];

    if (room.status === STATUS.WAITING) {
      room.players.splice(index, 1);

      if (room.players.length == 0) {
        // Delete game
        rooms.remove(gameID);
        return;
      }

      systemMessage(gameID, room, `${player.name} ${reason}.`);

      // The host left, the next player takes over
      if (room.host === player.name) {
        room.host = room.players[0].name;
        systemMessage(gameID, room, `${room.host} is the new host.`);
      }

      emitRoomState(gameID, room);
    } else if (room.status === STATUS.PLAYING) {
      // Already surrendered?
      if (!player.active) return;

      rooms.touch(room);
      if (room.turn === index) {
        nextTurn(gameID, room);
      }
      player.active = false;

      systemMessage(gameID, room, `${player.name} ${reason}.`);

      if (activePlayers(room).length <= 1) {
        await getWinner(gameID, room);
      } else {
        emitRoomState(gameID, room);
      }
    }
  }

  async function getWinner(gameID, room) {
    // Only finish a game once
    if (room.status !== STATUS.PLAYING) return;
    room.status = STATUS.FINISHED;

    // Players who left can't win
    const active = activePlayers(room);
    const highestPoints = Math.max(...active.map((player) => player.points));
    const winners = active
      .filter((player) => player.points === highestPoints)
      .map((player) => player.name);

    for (let i = 0; i < CARD_COUNT; i++) {
      multiPlayer.to(gameID).emit("turnCard", {
        id: i,
        src: room.cardImages[i],
      });
    }

    // Update all statistics. One failing update must not affect the others.
    const results = await Promise.allSettled(
      room.players.map((player) =>
        Statistic.increment(
          player.name,
          winners.includes(player.name) ? "multiplayerWin" : "multiplayerLose",
        ),
      ),
    );
    results
      .filter((result) => result.status === "rejected")
      .forEach((result) =>
        console.error("[multiplayer] Could not update statistic:", result.reason),
      );

    systemMessage(
      gameID,
      room,
      winners.length > 1 ? `Draw between ${winners.join(", ")}!` : `${winners[0]} wins!`,
    );
    emitRoomState(gameID, room);
    multiPlayer.to(gameID).emit("getWinner", {
      winners: winners,
      cardCounter: room.cardCounter,
    });

    // Delete game
    rooms.remove(gameID);
  }
};

function isPlayersTurn(room, username) {
  const player = room.players[room.turn];
  return player != null && player.active && player.name === username;
}

let messageId = 0;

/* Adds a message to the room's chat history and sends it to everyone (sender included). */
function addChatMessage(io, gameID, room, message) {
  const entry = { id: ++messageId, time: Date.now(), ...message };
  room.chat.push(entry);
  if (room.chat.length > config.CHAT_HISTORY) {
    room.chat.splice(0, room.chat.length - config.CHAT_HISTORY);
  }
  io.to(gameID).emit("chatMessage", entry);
}
