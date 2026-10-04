const Statistic = require("../models/Statistic");
const rooms = require("../game/rooms");
const { CARD_COUNT, createBoard, isValidCardId } = require("../game/board");
const socketAuth = require("./socket_auth");
const safe = require("./safe_handler");

const MAX_PLAYERS = 6;
const MAX_CHAT_LENGTH = 500;
const CHAT_COOLDOWN = 300; // ms between two chat messages of one socket

module.exports = function (io) {
  const multiPlayer = io.of("/multiplayer");
  multiPlayer.use(socketAuth);

  multiPlayer.on("connection", (socket) => {
    socket.on(
      "initializingGame",
      safe("initializingGame", async (data) => {
        const gameID = data != null ? data.gameID : null;
        const room = rooms.get(gameID, "multiplayer");

        // Check if game exists and this user is the creator
        if (
          room == null ||
          room.initialized ||
          room.status != 0 ||
          room.player.length == 0 ||
          room.player[0].name !== socket.data.username
        ) {
          socket.emit("noGameFound");
          return;
        }

        // Set synchronously, so the board can't be created twice.
        room.initialized = true;
        rooms.touch(room);

        socket.gameID = gameID;
        socket.username = socket.data.username;
        socket.spectator = false;
        socket.join(gameID);

        try {
          // Assign images and card pairs to cards
          const board = await createBoard();
          room.cardPairs = board.cardPairs;
          room.cardImages = board.cardImages;
          room.ready = true;
        } catch (error) {
          multiPlayer.to(gameID).emit("gameError", error.message);
          rooms.remove(gameID);
          return;
        }

        emitPlayers(multiPlayer, gameID, room);
        if (room.activePlayers.length >= 2) {
          socket.emit("enableStartGame");
        }
      }),
    );

    socket.on(
      "joinGame",
      safe("joinGame", (data) => {
        const gameID = data != null ? data.gameID : null;
        const room = rooms.get(gameID, "multiplayer");
        const username = socket.data.username;

        if (
          socket.gameID != null ||
          room == null ||
          room.player.some((obj) => obj.name === username)
        ) {
          socket.emit("noGameFound");
          return;
        }

        rooms.touch(room);
        socket.username = username;
        socket.gameID = gameID;
        socket.join(gameID);

        if (room.player.length < MAX_PLAYERS && room.status == 0) {
          socket.spectator = false;
          room.player.push({
            name: username,
            points: 0,
          });
          room.activePlayers.push(room.player.length);
          if (room.ready) {
            multiPlayer.to(gameID).emit("enableStartGame");
          }
        } else {
          socket.spectator = true;
          socket.emit("watchGame");

          // Show the spectator what has already been found.
          for (const id of room.foundMatches) {
            socket.emit("turnCard", { id: id, src: room.cardImages[id] });
            socket.emit("understateCard", id);
          }
        }

        emitPlayers(multiPlayer, gameID, room);
      }),
    );

    socket.on(
      "startGame",
      safe("startGame", () => {
        const room = rooms.get(socket.gameID, "multiplayer");

        if (
          room != null &&
          room.ready &&
          room.status == 0 &&
          room.player[0].name === socket.username &&
          room.activePlayers.length >= 2
        ) {
          rooms.touch(room);
          room.turn = Math.floor(Math.random() * room.player.length) + 1;
          room.status = 1;

          multiPlayer.to(socket.gameID).emit("highlightPlayer", {
            turn: room.turn,
            player: room.player,
          });
        }
      }),
    );

    socket.on(
      "openCard",
      safe("openCard", (id) => {
        const room = rooms.get(socket.gameID, "multiplayer");
        if (room == null || !isValidCardId(id)) return;

        if (
          room.status == 1 &&
          !room.openedCards.includes(id) &&
          !room.foundMatches.includes(id)
        ) {
          if (room.openedCards.length < 2 && isPlayersTurn(room, socket)) {
            rooms.touch(room);
            room.openedCards.push(id);
            room.cardCounter[id]++;
            multiPlayer.to(socket.gameID).emit("turnCard", {
              id: id,
              src: room.cardImages[id],
            });

            checkGame(multiPlayer, socket, room);
          }
        } else {
          socket.emit("zoomImage", id);
        }
      }),
    );

    socket.on(
      "sendChatMessage",
      safe("sendChatMessage", (data) => {
        if (socket.gameID == null || data == null || typeof data.message !== "string") {
          return;
        }

        const message = data.message.trim().slice(0, MAX_CHAT_LENGTH);
        const now = Date.now();
        if (message.length == 0 || now - (socket.lastChatMessage || 0) < CHAT_COOLDOWN) {
          return;
        }
        socket.lastChatMessage = now;

        socket.broadcast.to(socket.gameID).emit("receiveChatMessage", {
          name: socket.username,
          message: message,
          spectator: socket.spectator,
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
          room.status == 1 &&
          room.checkingCards &&
          room.openedCards.length == 2 &&
          isPlayersTurn(room, socket)
        ) {
          rooms.touch(room);
          socket.emit("disableEndTurn");
          nextTurn(multiPlayer, socket.gameID, room);
        }
      }),
    );

    // surrender - the player leaves the running game, but can keep watching
    socket.on(
      "surrender",
      safe("surrender", async () => {
        const room = rooms.get(socket.gameID, "multiplayer");
        if (room != null && room.status == 1) {
          await leaveGame(multiPlayer, socket);
        }
      }),
    );

    // disconnect
    socket.on(
      "disconnect",
      safe("disconnect", async () => {
        await leaveGame(multiPlayer, socket);
      }),
    );
  });
};

function isPlayersTurn(room, socket) {
  const player = room.player[room.turn - 1];
  return player != null && player.name === socket.username;
}

function emitPlayers(io, gameID, room) {
  io.to(gameID).emit("visualInitializing", {
    player: room.player,
    activePlayers: room.activePlayers,
  });

  io.to(gameID).emit("highlightPlayer", {
    turn: room.turn,
    player: room.player,
  });
}

function checkGame(io, socket, room) {
  // If both cards are open check if those are a match.
  if (room.openedCards.length == 2 && !room.checkingCards) {
    room.checkingCards = true;

    if (!checkCards(io, socket.gameID, room)) {
      socket.emit("activateEndTurn");
    }
  }

  // Check for winner
  if (room.foundMatches.length == CARD_COUNT) {
    getWinner(io, socket.gameID, room).catch((error) =>
      console.error("[multiplayer] Could not finish game:", error),
    );
  }
}

function checkCards(io, gameID, room) {
  var id = room.openedCards[0];
  var id2 = room.openedCards[1];
  var turn = room.turn;

  // Check if cards match
  var cardsMatch = room.cardPairs[id] == id2;

  if (cardsMatch) {
    // Push to foundMatches -> So it can't be opened again
    room.foundMatches.push(id, id2);

    // understateCard - remove Zoom and Border on cards
    setTimeout(() => io.to(gameID).emit("understateCard", id), 500);
    setTimeout(() => io.to(gameID).emit("understateCard", id2), 500);

    // Increase Points
    room.player[turn - 1].points++;
    io.to(gameID).emit("increasePoints", {
      turn: turn,
      points: room.player[turn - 1].points,
    });

    // Reset turn
    room.openedCards = [];
    room.checkingCards = false;
  }

  return cardsMatch;
}

// Closes the open cards and gives the turn to the next active player.
function nextTurn(io, gameID, room) {
  if (room.openedCards.length > 0) {
    io.to(gameID).emit("closeCards", {
      1: room.openedCards[0],
      2: room.openedCards[1],
    });
  }

  // Switch turns (the current player may already have left the game)
  const activePlayers = room.activePlayers;
  const next = activePlayers.find((number) => number > room.turn);
  room.turn = next != null ? next : activePlayers[0];

  // Reset turn
  room.openedCards = [];
  room.checkingCards = false;

  // Change highlight of player
  io.to(gameID).emit("highlightPlayer", {
    turn: room.turn,
    player: room.player,
  });
}

async function leaveGame(io, socket) {
  const gameID = socket.gameID;
  const room = rooms.get(gameID, "multiplayer");
  if (room == null || socket.spectator) return;

  const playerIndex = room.player.findIndex((obj) => obj.name === socket.username);
  if (playerIndex < 0) return;

  const playerNumber = playerIndex + 1;

  if (room.status == 0) {
    room.player.splice(playerIndex, 1);

    if (room.player.length == 0) {
      // Delete game
      rooms.remove(gameID);
      return;
    }

    // Before the start every player is active: 1..n
    room.activePlayers = room.player.map((_, i) => i + 1);

    if (room.activePlayers.length == 1) {
      io.to(gameID).emit("disableStartGame");
    }

    // The creator left, the next player can start the game now.
    if (playerIndex == 0) {
      io.to(gameID).emit("newCreator", { name: room.player[0].name });
      if (room.ready && room.activePlayers.length >= 2) {
        io.to(gameID).emit("enableStartGame");
      }
    }

    emitPlayers(io, gameID, room);
  } else if (room.status == 1) {
    // Already surrendered?
    if (!room.activePlayers.includes(playerNumber)) return;

    rooms.touch(room);

    if (room.turn == playerNumber) {
      nextTurn(io, gameID, room);
    }

    room.activePlayers = room.activePlayers.filter((number) => number !== playerNumber);

    // The leaving player might have been the only one left in the turn order.
    if (room.turn == playerNumber && room.activePlayers.length > 0) {
      room.turn = room.activePlayers[0];
    }

    io.to(gameID).emit("playerSurrendered", {
      playerName: socket.username,
      playerIndex: playerNumber,
    });

    if (room.activePlayers.length <= 1) {
      await getWinner(io, gameID, room);
    }
  }
}

async function getWinner(io, gameID, room) {
  // Only finish a game once
  if (room.status != 1) return;
  room.status = 2;

  // check if not one of the leavers get the win
  var highestPoints = -1;
  var winners = [];

  room.player.forEach((player, i) => {
    if (!room.activePlayers.includes(i + 1)) return;

    if (player.points > highestPoints) {
      highestPoints = player.points;
      winners = [player.name];
    } else if (player.points === highestPoints) {
      winners.push(player.name);
    }
  });

  for (var i = 0; i < CARD_COUNT; i++) {
    io.to(gameID).emit("turnCard", {
      id: i,
      src: room.cardImages[i],
    });
  }

  // Update all statistics. One failing update must not affect the others.
  const results = await Promise.allSettled(
    room.player.map((player) =>
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

  io.to(gameID).emit("getWinner", {
    winners: winners,
    player: room.player,
    cardCounter: room.cardCounter,
  });

  // Delete game
  rooms.remove(gameID);
}
