const Statistic = require("../models/Statistic");
const rooms = require("../game/rooms");
const config = require("../game/config");
const { CARD_COUNT, createBoard, isValidCardId } = require("../game/board");
const socketAuth = require("./socket_auth");
const safe = require("./safe_handler");

const DIFFICULTIES = ["easy", "medium", "hard", "expert"];

module.exports = function (io) {
  const singlePlayer = io.of("/singleplayer");
  singlePlayer.use(socketAuth);

  singlePlayer.on("connection", (socket) => {
    socket.on(
      "initializingGame",
      safe("initializingGame", async (data) => {
        // A socket can only play one game
        if (socket.game != null || socket.initializing) return;

        const gameID = data != null ? data.gameID : null;
        const room = rooms.get(gameID, "singleplayer");

        // Check if game exists and belongs to this user
        if (room == null || room.used || room.username !== socket.data.username) {
          socket.emit("noGameFound");
          return;
        }

        // Mark the room as used right away, so it can't be started twice.
        rooms.touch(room);
        socket.initializing = true;

        let board;
        try {
          board = await createBoard();
        } catch (error) {
          rooms.remove(gameID);
          socket.emit("gameError", error.message);
          return;
        } finally {
          socket.initializing = false;
        }

        // The game state lives on the socket, the room isn't needed anymore.
        rooms.remove(gameID);

        if (socket.disconnected) return;

        // Kept for rematches against the same bot
        socket.settings = {
          difficulty: room.difficulty,
          username: room.username,
          computername: room.computername,
          moveMemory: room.moveMemory,
        };
        socket.emit("setComputername", room.computername);
        startGame(socket, board);
      }),
    );

    // Rematch: a new board against the same bot
    socket.on(
      "rematch",
      safe("rematch", async () => {
        if (socket.game == null || !socket.game.finished || socket.settings == null || socket.initializing) return;
        socket.initializing = true;
        let board;
        try {
          board = await createBoard();
        } catch (error) {
          socket.emit("gameError", error.message);
          return;
        } finally {
          socket.initializing = false;
        }
        if (socket.disconnected) return;
        socket.emit("rematch");
        startGame(socket, board);
      }),
    );

    socket.on(
      "openCard",
      safe("openCard", (id) => {
        const game = socket.game;
        if (game == null || game.finished || !isValidCardId(id)) return;

        if (!game.openedCards.includes(id) && !game.foundMatches.includes(id)) {
          // Not during the "who starts" animation
          if (game.turn == 0 && game.openedCards.length < 2 && Date.now() >= game.startsAt) {
            game.openedCards.push(id);
            game.cardCounter[id]++;
            socket.emit("turnCard", {
              id: id,
              src: game.cardImages[id],
            });
          }
        } else {
          socket.emit("zoomImage", id);
        }
      }),
    );

    // surrender
    socket.on(
      "surrender",
      safe("surrender", async () => {
        const game = socket.game;
        if (game == null || game.finished) return;

        for (var i = 0; i < CARD_COUNT; i++) {
          socket.emit("turnCard", {
            id: i,
            src: game.cardImages[i],
          });
        }

        await surrendGame(socket);
      }),
    );

    // disconnect
    socket.on(
      "disconnect",
      safe("disconnect", async () => {
        await surrendGame(socket);
        stopTimers(socket.game);
      }),
    );
  });
};

// Starts a game on the socket. Who begins is random (player or bot).
function startGame(socket, board) {
  const settings = socket.settings;
  const game = {
    difficulty: settings.difficulty,
    user: { name: settings.username, points: 0 },
    computer: {
      name: settings.computername,
      moveMemory: settings.moveMemory,
      points: 0,
    },
    status: 0,
    turn: config.SINGLEPLAYER_STARTER != null ? config.SINGLEPLAYER_STARTER : Math.random() < 0.5 ? 0 : 1,
    finished: false,
    openedCards: [],
    cardPairs: board.cardPairs,
    cardImages: board.cardImages,
    foundMatches: [],
    // Defines how many cards the computer can remember.
    previousMoves: Array(settings.moveMemory * 2).fill(-1),
    cardCounter: Array(CARD_COUNT).fill(0),
    timeouts: [],
    interval: null,
    // The game begins after the "who starts" animation (like in the multiplayer)
    startsAt: Date.now() + config.START_ANIMATION,
  };
  socket.game = game;

  socket.emit("gameStarting", {
    players: [game.user.name, game.computer.name],
    starter: game.turn,
    duration: config.START_ANIMATION,
  });
  later(
    game,
    () => {
      socket.emit("highlightPlayer", {
        turn: game.turn,
        computer: game.computer.name,
        user: game.user.name,
      });
      checkGame(socket);
    },
    config.START_ANIMATION,
  );
}

// Like setTimeout, but the timer is cancelled when the game ends.
function later(game, fn, ms) {
  const timeout = setTimeout(() => {
    game.timeouts = game.timeouts.filter((t) => t !== timeout);
    if (!game.finished) {
      fn();
    }
  }, ms);
  game.timeouts.push(timeout);
}

function stopTimers(game) {
  if (game == null) return;
  clearInterval(game.interval);
  game.timeouts.forEach(clearTimeout);
  game.timeouts = [];
}

function checkGame(socket) {
  const game = socket.game;

  game.interval = setInterval(() => {
    try {
      if (game.finished) {
        stopTimers(game);
        return;
      }

      // Status: 0 - Doing nothing; 1 - Computer running; 2 - Checking Cards;
      // Turn: 0 - Turn of player; 1 - Turn of computer;

      if (game.turn == 1 && game.status == 0) {
        // Change status so that socket doesn't call the computerLogic twice (or more).
        game.status = 1;
        computerLogic(socket);
      }

      // If both cards are open check if those are a match.
      if (game.openedCards.length == 2 && game.status < 2) {
        game.status = 2;

        if (!checkCards(socket)) {
          // No match: the turn passes on its own after a short look at the cards
          // (for the player and the computer)
          later(game, () => endTurn(socket), config.SINGLEPLAYER_MISS_DELAY);
        }
      }

      // Check for winner
      if (game.foundMatches.length == CARD_COUNT) {
        getWinner(socket).catch((error) =>
          console.error("[singleplayer] Could not finish game:", error),
        );
      }
    } catch (error) {
      console.error("[singleplayer] Error in game loop:", error);
    }
  }, 100);
}

function computerLogic(socket) {
  const game = socket.game;
  const pre = game.previousMoves;
  const pairs = game.cardPairs;
  const foundMatches = game.foundMatches;
  var id = -1;
  var id2 = -1;

  // Check if there is a match in previousMoves
  for (var i = 0; i < pre.length; i++) {
    if (
      pre[i] >= 0 &&
      pre.includes(pairs[pre[i]]) &&
      !foundMatches.includes(pairs[pre[i]]) &&
      !foundMatches.includes(pre[i])
    ) {
      id = pre[i];
      id2 = pairs[pre[i]];
    }
  }

  if (id == -1 && id2 == -1) {
    // Get random card -> if pair is in previousMoves open it -> if not get another random card.
    id = getRandomCard(game);
    id2 = pairs[id];

    if (!pre.includes(id2)) {
      id2 = getRandomCard(game, id);
    }
  }

  // Should never happen, but never let the computer get stuck.
  if (id == null || id2 == null) {
    endTurn(socket);
    return;
  }

  // Push cards to openedCards, so that they get checked in checkGame-method
  game.openedCards.push(id);
  later(game, () => socket.emit("turnCard", { id: id, src: game.cardImages[id] }), 1250);
  later(game, () => socket.emit("turnCard", { id: id2, src: game.cardImages[id2] }), 1750);
  later(game, () => game.openedCards.push(id2), 2250);
}

// Random card which isn't in the computer's memory and hasn't been found yet.
// Falls back to any card that is still in the game, so this can't loop forever.
function getRandomCard(game, exclude) {
  const open = [];
  const unknown = [];

  for (var i = 0; i < CARD_COUNT; i++) {
    if (i === exclude || game.foundMatches.includes(i)) continue;
    open.push(i);
    if (!game.previousMoves.includes(i)) unknown.push(i);
  }

  const candidates = unknown.length > 0 ? unknown : open;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function checkCards(socket) {
  const game = socket.game;
  var id = game.openedCards[0];
  var id2 = game.openedCards[1];

  // Check if cards match
  var cardsMatch = game.cardPairs[id] == id2;

  if (cardsMatch) {
    // Push to foundMatches -> So it can't be opened again
    game.foundMatches.push(id);
    game.foundMatches.push(id2);

    // understateCard - remove Zoom and Border on cards
    later(game, () => socket.emit("understateCard", id), 500);
    later(game, () => socket.emit("understateCard", id2), 500);

    // Increase Points
    if (game.turn == 0) {
      game.user.points++;
      socket.emit("increasePoints", {
        turn: game.turn,
        points: game.user.points,
      });
    } else {
      game.computer.points++;
      socket.emit("increasePoints", {
        turn: game.turn,
        points: game.computer.points,
      });
    }

    // Reset turn
    game.openedCards = [];
    game.status = 0;
  }

  // Push last 2 cards to previousMoves
  if (game.previousMoves.length >= 2) {
    game.previousMoves.pop();
    game.previousMoves.pop();
    game.previousMoves.unshift(id);
    game.previousMoves.unshift(id2);
  }

  return cardsMatch;
}

function endTurn(socket) {
  const game = socket.game;
  if (game == null || game.finished) return;

  var id = game.openedCards[0];
  var id2 = game.openedCards[1];

  // Close both cards
  socket.emit("closeCards", {
    1: id,
    2: id2,
  });

  // Switch turns
  game.turn = game.turn == 1 ? 0 : 1;
  // Reset turn
  game.openedCards = [];
  game.status = 0;

  // Change highlight of player
  socket.emit("highlightPlayer", {
    turn: game.turn,
    computer: game.computer.name,
    user: game.user.name,
  });
}

async function surrendGame(socket) {
  const game = socket.game;

  // Does this game exist? Is it finished?
  if (game != null && !game.finished) {
    // Set points above possible range. => No need to implement surrend function, if you declare computer as winner.
    game.computer.points = 50;
    game.surrendered = true;
    await getWinner(socket);
  }
}

async function getWinner(socket) {
  const game = socket.game;

  // Only finish a game once (the game loop runs every 100ms).
  if (game == null || game.finished) return;

  // Change gameState to finish
  game.finished = true;
  stopTimers(game);

  const winner = game.user.points > game.computer.points ? 0 : 1;
  const field = DIFFICULTIES[game.difficulty] + (winner == 0 ? "Win" : "Lose");

  // Change Statistic in Database - a database problem must not stop the game from ending.
  try {
    await Statistic.increment(game.user.name, field);
  } catch (error) {
    console.error("[singleplayer] Could not update statistic:", error);
  }

  socket.emit("getWinner", {
    winner: winner,
    cardCounter: game.cardCounter,
    computer: game.computer.name,
    user: game.user.name,
    surrendered: game.surrendered === true,
  });
}
