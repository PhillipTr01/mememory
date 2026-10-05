const Statistic = require("../models/Statistic");
const coins = require("../game/coins");
const rooms = require("../game/rooms");
const config = require("../game/config");
const { CARD_COUNT, createBoard, isValidCardId } = require("../game/board");
const socketAuth = require("./socket_auth");
const safe = require("./safe_handler");
const version = require("../game/version");

const DIFFICULTIES = ["easy", "medium", "hard", "expert"];

/*
 * Singleplayer against a bot. The game lives in the room (not on the socket),
 * so a reload or a lost connection doesn't end it: the game pauses and the
 * player has REJOIN_GRACE_PLAYING to come back, like in the multiplayer.
 */
module.exports = function (io) {
  const singlePlayer = io.of("/singleplayer");
  singlePlayer.use(socketAuth);

  // A removed room (e.g. idle for too long) must not keep the bot running
  rooms.onRemove((gameID, room) => {
    if (room.type !== "singleplayer") return;
    clearTimeout(room.awayTimer);
    if (room.game != null) {
      room.game.finished = true;
      stopTimers(room.game);
    }
  });

  singlePlayer.on("connection", (socket) => {
    version.announce(socket);
    const username = socket.data.username;

    socket.on(
      "initializingGame",
      safe("initializingGame", async (data) => {
        const gameID = data != null ? data.gameID : null;
        const room = rooms.get(gameID, "singleplayer");

        // Check if game exists and belongs to this user
        if (room == null || room.username !== username) {
          socket.emit("noGameFound");
          return;
        }

        attach(room, socket, gameID);

        // Back in a running game (reload, lost connection, other tab)
        if (room.game != null) {
          resume(room);
          return;
        }

        // A new game: the board is created once
        if (room.initializing) return;
        room.initializing = true;
        rooms.touch(room);
        let board;
        try {
          board = await createBoard();
        } catch (error) {
          rooms.remove(gameID);
          socket.emit("gameError", error.message);
          return;
        } finally {
          room.initializing = false;
        }
        // Left (or another tab took over) while the board was created
        if (room.socketId !== socket.id || rooms.get(gameID, "singleplayer") !== room) {
          if (room.socketId == null) rooms.remove(gameID);
          return;
        }

        send(room, "setComputername", room.computername);
        startGame(room, board);
      }),
    );

    // Rematch: a new board against the same bot
    socket.on(
      "rematch",
      safe("rematch", async () => {
        const room = ownRoom(socket);
        if (room == null || room.game == null || !room.game.finished || room.initializing) return;
        room.initializing = true;
        let board;
        try {
          board = await createBoard();
        } catch (error) {
          socket.emit("gameError", error.message);
          return;
        } finally {
          room.initializing = false;
        }
        if (room.socketId !== socket.id) return;
        rooms.touch(room);
        send(room, "rematch");
        startGame(room, board);
      }),
    );

    socket.on(
      "openCard",
      safe("openCard", (id) => {
        const room = ownRoom(socket);
        const game = room != null ? room.game : null;
        if (game == null || game.finished || !isValidCardId(id)) return;

        if (!game.openedCards.includes(id) && !game.foundMatches.includes(id)) {
          // Not during the "who starts" animation
          if (game.turn == 0 && game.openedCards.length < 2 && game.started) {
            rooms.touch(room);
            game.openedCards.push(id);
            game.cardCounter[id]++;
            send(room, "turnCard", { id: id, src: game.cardImages[id] });
          }
        } else {
          socket.emit("zoomImage", id);
        }
      }),
    );

    socket.on(
      "surrender",
      safe("surrender", async () => {
        const room = ownRoom(socket);
        if (room == null || room.game == null || room.game.finished) return;
        await surrender(room);
      }),
    );

    // Lost connection or reload: the game pauses, the player can come back
    socket.on(
      "disconnect",
      safe("disconnect", async () => {
        const gameID = socket.gameID;
        const room = ownRoom(socket);
        if (room == null) return;
        room.socketId = null;

        const game = room.game;
        if (game == null || game.finished) {
          // Nothing running: the room isn't needed anymore
          if (!room.initializing) rooms.remove(gameID);
          return;
        }
        stopTimers(game);
        clearTimeout(room.awayTimer);
        room.awayTimer = setTimeout(() => {
          if (room.socketId != null || game.finished || room.game !== game) return;
          // Didn't come back in time: counts as a loss, like surrendering
          surrender(room)
            .catch((error) => console.error("[singleplayer] Could not end game:", error))
            .finally(() => {
              if (room.socketId == null) rooms.remove(gameID);
            });
        }, config.REJOIN_GRACE_PLAYING);
      }),
    );
  });

  /* ---------- Connection ---------- */

  // The room of this socket, only while the socket is the one playing
  function ownRoom(socket) {
    const room = rooms.get(socket.gameID, "singleplayer");
    return room != null && room.socketId === socket.id ? room : null;
  }

  function attach(room, socket, gameID) {
    // Opened in another tab: the old one stops playing
    if (room.socketId != null && room.socketId !== socket.id) {
      const old = singlePlayer.sockets.get(room.socketId);
      if (old != null) {
        old.gameID = null;
        old.emit("sessionReplaced");
        old.disconnect(true);
      }
    }
    clearTimeout(room.awayTimer);
    room.socketId = socket.id;
    socket.gameID = gameID;
  }

  // Sends to the player, if connected
  function send(room, event, data) {
    if (room.socketId == null) return;
    const socket = singlePlayer.sockets.get(room.socketId);
    if (socket != null) socket.emit(event, data);
  }

  /* ---------- Game ---------- */

  // Starts a game in the room. Who begins is random (player or bot).
  function startGame(room, board) {
    if (room.game != null) stopTimers(room.game);
    const game = {
      difficulty: room.difficulty,
      user: { name: room.username, points: 0 },
      computer: { name: room.computername, moveMemory: room.moveMemory, points: 0 },
      status: 0,
      turn: config.SINGLEPLAYER_STARTER != null ? config.SINGLEPLAYER_STARTER : Math.random() < 0.5 ? 0 : 1,
      finished: false,
      surrendered: false,
      // The game begins after the "who starts" animation (like in the multiplayer)
      started: false,
      openedCards: [],
      cardPairs: board.cardPairs,
      cardImages: board.cardImages,
      foundMatches: [],
      // Defines how many cards the computer can remember.
      previousMoves: Array(room.moveMemory * 2).fill(-1),
      cardCounter: Array(CARD_COUNT).fill(0),
      timeouts: [],
      interval: null,
    };
    room.game = game;

    send(room, "gameStarting", {
      players: [game.user.name, game.computer.name],
      starter: game.turn,
      duration: config.START_ANIMATION,
    });
    later(game, () => begin(room), config.START_ANIMATION);
  }

  // After the animation (or right away when coming back): the game runs
  function begin(room) {
    room.game.started = true;
    highlight(room);
    checkGame(room);
  }

  function highlight(room) {
    const game = room.game;
    send(room, "highlightPlayer", { turn: game.turn, computer: game.computer.name, user: game.user.name });
  }

  // Back in the game: the page gets the whole board, the game goes on
  function resume(room) {
    const game = room.game;
    rooms.touch(room);
    send(room, "setComputername", game.computer.name);

    if (!game.finished) {
      stopTimers(game);
      if (game.status === 2) {
        // Two wrong cards were open: the turn passes now
        game.turn = game.turn == 1 ? 0 : 1;
      }
      // Half done moves (a bot move, one open card) start again
      game.openedCards = [];
      game.status = 0;
    }

    send(room, "resumeGame", {
      user: game.user.name,
      computer: game.computer.name,
      points: [game.user.points, game.computer.points],
      found: game.foundMatches.map((id) => ({ id: id, src: game.cardImages[id] })),
      finished: game.finished,
    });
    if (game.finished) {
      // Back on the result (e.g. reload after the game)
      sendWinner(room);
    } else {
      begin(room);
    }
  }

  // Like setTimeout, but the timer is cancelled when the game ends or pauses.
  function later(game, fn, ms) {
    const timeout = setTimeout(() => {
      game.timeouts = game.timeouts.filter((t) => t !== timeout);
      if (!game.finished) fn();
    }, ms);
    game.timeouts.push(timeout);
  }

  function stopTimers(game) {
    if (game == null) return;
    clearInterval(game.interval);
    game.interval = null;
    game.timeouts.forEach(clearTimeout);
    game.timeouts = [];
  }

  function checkGame(room) {
    const game = room.game;
    clearInterval(game.interval);

    game.interval = setInterval(() => {
      try {
        if (game.finished || room.game !== game) {
          stopTimers(game);
          return;
        }

        // Status: 0 - Doing nothing; 1 - Computer running; 2 - Checking Cards;
        // Turn: 0 - Turn of player; 1 - Turn of computer;

        if (game.turn == 1 && game.status == 0) {
          // Change status so that the computer doesn't move twice (or more).
          game.status = 1;
          computerLogic(room);
        }

        // If both cards are open check if those are a match.
        if (game.openedCards.length == 2 && game.status < 2) {
          game.status = 2;

          if (!checkCards(room)) {
            // No match: the turn passes on its own after a short look at the cards
            // (for the player and the computer)
            later(game, () => endTurn(room), config.SINGLEPLAYER_MISS_DELAY);
          }
        }

        // Check for winner
        if (game.foundMatches.length == CARD_COUNT) {
          getWinner(room).catch((error) => console.error("[singleplayer] Could not finish game:", error));
        }
      } catch (error) {
        console.error("[singleplayer] Error in game loop:", error);
      }
    }, 100);
  }

  function computerLogic(room) {
    const game = room.game;
    const pre = game.previousMoves;
    const pairs = game.cardPairs;
    const foundMatches = game.foundMatches;
    let id = -1;
    let id2 = -1;

    // Check if there is a match in previousMoves
    for (let i = 0; i < pre.length; i++) {
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
      endTurn(room);
      return;
    }

    // Push cards to openedCards, so that they get checked in checkGame
    game.openedCards.push(id);
    game.cardCounter[id]++;
    later(game, () => send(room, "turnCard", { id: id, src: game.cardImages[id] }), 1250);
    later(game, () => send(room, "turnCard", { id: id2, src: game.cardImages[id2] }), 1750);
    later(
      game,
      () => {
        game.openedCards.push(id2);
        game.cardCounter[id2]++;
      },
      2250,
    );
  }

  function checkCards(room) {
    const game = room.game;
    const id = game.openedCards[0];
    const id2 = game.openedCards[1];

    // Check if cards match
    const cardsMatch = game.cardPairs[id] == id2;

    if (cardsMatch) {
      // Push to foundMatches -> So it can't be opened again
      game.foundMatches.push(id, id2);

      // understateCard - remove Zoom and Border on cards
      later(game, () => send(room, "understateCard", id), 500);
      later(game, () => send(room, "understateCard", id2), 500);

      // Increase Points
      const player = game.turn == 0 ? game.user : game.computer;
      player.points++;
      send(room, "increasePoints", { turn: game.turn, points: player.points });

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

  function endTurn(room) {
    const game = room.game;
    if (game == null || game.finished) return;

    // Close both cards
    send(room, "closeCards", { 1: game.openedCards[0], 2: game.openedCards[1] });

    // Switch turns
    game.turn = game.turn == 1 ? 0 : 1;
    game.openedCards = [];
    game.status = 0;
    highlight(room);
  }

  // Surrender (or didn't come back): the bot wins, all cards are shown
  async function surrender(room) {
    const game = room.game;
    if (game == null || game.finished) return;
    game.surrendered = true;
    for (let i = 0; i < CARD_COUNT; i++) {
      send(room, "turnCard", { id: i, src: game.cardImages[i] });
    }
    await getWinner(room);
  }

  async function getWinner(room) {
    const game = room.game;

    // Only finish a game once (the game loop runs every 100ms).
    if (game == null || game.finished) return;
    game.finished = true;
    stopTimers(game);
    rooms.touch(room);

    // A surrender always loses (there are 33 pairs, so no draw otherwise)
    game.winner = !game.surrendered && game.user.points > game.computer.points ? 0 : 1;
    const field = DIFFICULTIES[game.difficulty] + (game.winner == 0 ? "Win" : "Lose");
    // Coins for the hidden jackpot
    if (game.winner == 0) coins.reward(game.user.name, DIFFICULTIES[game.difficulty]);

    // Change Statistic in Database - a database problem must not stop the game from ending.
    try {
      await Statistic.increment(game.user.name, field);
    } catch (error) {
      console.error("[singleplayer] Could not update statistic:", error);
    }

    sendWinner(room);
  }

  function sendWinner(room) {
    const game = room.game;
    send(room, "getWinner", {
      winner: game.winner,
      cardCounter: game.cardCounter,
      computer: game.computer.name,
      user: game.user.name,
      surrendered: game.surrendered,
      // All cards (shown after the game, also after a reload)
      cards: game.cardImages,
    });
  }
};

// Random card which isn't in the computer's memory and hasn't been found yet.
// Falls back to any card that is still in the game, so this can't loop forever.
function getRandomCard(game, exclude) {
  const open = [];
  const unknown = [];

  for (let i = 0; i < CARD_COUNT; i++) {
    if (i === exclude || game.foundMatches.includes(i)) continue;
    open.push(i);
    if (!game.previousMoves.includes(i)) unknown.push(i);
  }

  const candidates = unknown.length > 0 ? unknown : open;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
