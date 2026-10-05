const Statistic = require("../models/Statistic");
const coins = require("../game/coins");
const rooms = require("../game/rooms");
const config = require("../game/config");
const { CARD_COUNT, isValidCardId, createBoard } = require("../game/board");
const {
  STATUS,
  activePlayers,
  connectedCount,
  serialize,
  notifyLobby,
} = require("../game/multiplayer_room");
const socketAuth = require("./socket_auth");
const safe = require("./safe_handler");
const version = require("../game/version");
const chat = require("../game/chat");
const powerups = require("../game/powerups");

module.exports = function (io) {
  const multiPlayer = io.of("/multiplayer");
  multiPlayer.use(socketAuth);

  /* ---------- Helpers ---------- */

  // Sends the current room state (players, host, turn, settings) to everyone in the room.
  function emitRoomState(gameID, room) {
    multiPlayer.to(gameID).emit("roomState", serialize(gameID, room));
    notifyLobby();
  }

  // Chat message from the server itself (joins, leaves, game start, ...)
  function systemMessage(gameID, room, text, icon) {
    chat.system(multiPlayer, gameID, room, text, icon);
  }

  // setTimeout that is cancelled when the room is removed
  function roomTimeout(room, fn, ms) {
    const timer = setTimeout(() => {
      room.timers = room.timers.filter((t) => t !== timer);
      try {
        fn();
      } catch (error) {
        console.error("[multiplayer] Timer failed:", error);
      }
    }, ms);
    room.timers.push(timer);
  }

  // Fisher-Yates shuffle (returns a new array)
  function shuffle(list) {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function findPlayer(room, name) {
    return room.players.find((player) => player.name === name) || null;
  }

  function isPlayersTurn(room, name) {
    const player = room.players[room.turn];
    return room.status === STATUS.PLAYING && player != null && player.active && player.name === name;
  }

  // Detaches a socket from its room without touching the game (e.g. replaced by a new tab)
  function detachSocket(socket) {
    if (socket.gameID != null) {
      socket.leave(socket.gameID);
    }
    socket.gameID = null;
    socket.spectator = false;
  }

  /* ---------- Connection ---------- */

  multiPlayer.on("connection", (socket) => {
    version.announce(socket);
    const username = socket.data.username;

    /*
     * Enter a room. Works for new players, spectators and for players
     * coming back after a reload or a lost connection (rejoin).
     */
    socket.on(
      "joinRoom",
      safe("joinRoom", (data) => {
        const gameID = data != null ? data.gameID : null;
        // Only watch, even if there is a free seat
        const watch = data != null && data.watch === true;
        const room = rooms.get(gameID, "multiplayer");

        // A finished room stays open for a rematch, but only for its players
        if (room == null || (room.status === STATUS.FINISHED && findPlayer(room, username) == null)) {
          socket.emit("noGameFound");
          return;
        }
        if (socket.gameID === gameID) return;
        if (socket.gameID != null) {
          leaveRoom(socket, false);
        }

        rooms.touch(room);
        const player = findPlayer(room, username);
        let rejoined = false;

        if (player != null) {
          // The same user is still connected in another tab -> that tab is replaced
          if (player.connected && player.socketId !== socket.id) {
            const old = multiPlayer.sockets.get(player.socketId);
            if (old != null) {
              detachSocket(old);
              old.emit("sessionReplaced");
              old.disconnect(true);
            }
          }

          rejoined = !player.connected;
          player.connected = true;
          player.socketId = socket.id;
          player.disconnectedAt = null;
          // Back in a finished room (e.g. reload after the game)
          if (room.status === STATUS.FINISHED) player.left = false;
          socket.spectator = !player.active;
        } else if (
          !watch &&
          room.status === STATUS.WAITING &&
          room.players.length < room.maxPlayers &&
          !room.banned.has(username)
        ) {
          room.players.push({
            name: username,
            points: 0,
            active: true,
            connected: true,
            ready: false, // set in the waiting room with the "Ready" button
            socketId: socket.id,
            disconnectedAt: null,
          });
          socket.spectator = false;
        } else {
          socket.spectator = true;
          room.spectators.set(socket.id, username);
        }

        socket.gameID = gameID;
        socket.join(gameID);
        room.emptySince = null;

        socket.emit("joinedRoom", { username: username, spectator: socket.spectator });
        socket.emit("chatHistory", room.chat);
        socket.emit("boardState", boardState(room));
        socket.emit("powerupDefs", powerups.POWERUPS);

        if (player != null && rejoined) {
          systemMessage(gameID, room, `${username} is back.`, "reconnect");
        } else if (player == null) {
          systemMessage(
            gameID,
            room,
            socket.spectator ? `${username} is watching.` : `${username} joined the room.`,
            socket.spectator ? "watch" : "join",
          );
        }

        emitRoomState(gameID, room);

        // Back in the middle of the own turn with two wrong cards open
        if (isPlayersTurn(room, username) && room.checkingCards) {
          socket.emit("activateEndTurn");
        }
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

        if (config.MODES.includes(data.mode)) {
          room.mode = data.mode;
        }

        // Seconds per turn in the speed round (only the offered options)
        if (data.turnTime !== undefined && config.SPEED_TURN_OPTIONS.includes(Number(data.turnTime))) {
          room.turnTime = Number(data.turnTime) * 1000;
        }

        if (typeof data.isPublic === "boolean") {
          room.isPublic = data.isPublic;
        }

        rooms.touch(room);
        emitRoomState(socket.gameID, room);
      }),
    );

    /* The host removes a player from the waiting room */
    socket.on(
      "kickPlayer",
      safe("kickPlayer", (data) => {
        const room = rooms.get(socket.gameID, "multiplayer");
        const name = data != null ? data.name : null;
        if (room == null || room.status !== STATUS.WAITING || room.host !== username || name === username) {
          return;
        }

        const index = room.players.findIndex((player) => player.name === name);
        if (index < 0) return;

        const [player] = room.players.splice(index, 1);
        // Can still watch, but not take a seat again
        room.banned.add(player.name);
        const target = multiPlayer.sockets.get(player.socketId);
        if (target != null) {
          detachSocket(target);
          target.emit("kicked");
        }

        systemMessage(socket.gameID, room, `${player.name} was removed by the host.`, "leave");
        emitRoomState(socket.gameID, room);
      }),
    );

    /* Players tell the host that they are ready to play */
    socket.on(
      "setReady",
      safe("setReady", (data) => {
        const room = rooms.get(socket.gameID, "multiplayer");
        const player = room != null ? findPlayer(room, username) : null;
        if (player == null || room.status !== STATUS.WAITING || data == null || typeof data.ready !== "boolean") {
          return;
        }

        player.ready = data.ready;
        rooms.touch(room);
        emitRoomState(socket.gameID, room);
      }),
    );

    socket.on(
      "startGame",
      safe("startGame", () => {
        const gameID = socket.gameID;
        const room = rooms.get(gameID, "multiplayer");
        const ready = room != null ? room.players.filter((player) => player.connected) : [];

        if (
          room == null ||
          room.status !== STATUS.WAITING ||
          room.host !== username ||
          ready.length < config.MIN_PLAYERS ||
          // Everybody except the host has to press "Ready"
          ready.some((player) => player.name !== room.host && !player.ready)
        ) {
          return;
        }

        // Players that are still reconnecting can't take part.
        // The order of the players is shuffled for every game.
        room.players = shuffle(ready);
        setupPowerups(room);
        room.status = STATUS.STARTING;
        room.turn = Math.floor(Math.random() * room.players.length);
        rooms.touch(room);
        const animation =
          room.mode === "speed"
            ? config.SPEED_START_ANIMATION
            : room.mode === "powerups"
              ? config.POWERUPS_START_ANIMATION
              : config.START_ANIMATION;

        multiPlayer.to(gameID).emit("gameStarting", {
          players: room.players.map((player) => player.name),
          starter: room.turn,
          duration: animation,
          // Power-up mode: the reels show which power-ups everybody gets
          powerups: room.mode === "powerups" ? room.players[0].powerups : null,
        });
        emitRoomState(gameID, room);

        // The game begins when the "who starts" animation is over
        roomTimeout(
          room,
          () => {
            if (room.status !== STATUS.STARTING) return;
            room.status = STATUS.PLAYING;

            // The starter left during the animation
            const starter = room.players[room.turn];
            if (!starter.active || !starter.connected) {
              nextTurn(gameID, room);
            }

            systemMessage(gameID, room, `The game has started. ${room.players[room.turn].name} begins!`, "start");
            // Power-up mode: which power-ups everybody starts with
            if (room.mode === "powerups") {
              const start = room.players[0].powerups.map(powerupLabel).join(" and ");
              systemMessage(gameID, room, `Everybody starts with ${start}. ${powerups.POWER_PAIRS} pairs hold a power-up (⚡).`, "info");
            }
            startTurnTimer(gameID, room);
            emitRoomState(gameID, room);
          },
          animation,
        );
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
          if (room.closingCard === id) return;
          if (room.openedCards.length < openLimit(room) && !room.checkingCards && isPlayersTurn(room, username)) {
            rooms.touch(room);
            room.openedCards.push(id);
            room.cardCounter[id]++;
            multiPlayer.to(socket.gameID).emit("turnCard", cardData(room, id));

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
        chat.fromUser(multiPlayer, socket, room, data, socket.spectator);
      }),
    );

    // endTurn - only after two cards that don't match
    socket.on(
      "endTurn",
      safe("endTurn", () => {
        const room = rooms.get(socket.gameID, "multiplayer");

        if (room != null && room.checkingCards && room.openedCards.length >= 2 && isPlayersTurn(room, username)) {
          rooms.touch(room);
          socket.emit("disableEndTurn");
          const player = room.players[room.turn];
          if (room.mode === "powerups" && player.armed.extraTurn) {
            // Extra turn: the cards close, but the player continues
            player.armed.extraTurn = false;
            closeOpenCards(socket.gameID, room);
            systemMessage(socket.gameID, room, `${player.name} uses the extra turn.`, "info");
          } else {
            nextTurn(socket.gameID, room);
          }
          emitRoomState(socket.gameID, room);
        }
      }),
    );

    // Power-up mode: use a power-up from the own hand
    socket.on(
      "usePowerup",
      safe("usePowerup", (data) => {
        const room = rooms.get(socket.gameID, "multiplayer");
        if (room == null || data == null) return;
        usePowerup(socket, room, data);
      }),
    );

    // surrender - the player leaves the running game, but can keep watching
    socket.on(
      "surrender",
      safe("surrender", async () => {
        const room = rooms.get(socket.gameID, "multiplayer");
        const player = room != null ? findPlayer(room, username) : null;

        if (player != null && player.active && room.status !== STATUS.WAITING && room.status !== STATUS.FINISHED) {
          await removePlayer(socket.gameID, room, player, "surrendered");
          socket.spectator = true;
          socket.emit("joinedRoom", { username: username, spectator: true });
        }
      }),
    );

    // After the game: everybody back to the waiting room with a new board
    socket.on(
      "rematch",
      safe("rematch", async () => {
        const room = rooms.get(socket.gameID, "multiplayer");
        const player = room != null ? findPlayer(room, username) : null;
        // Only the host decides about a rematch
        if (player == null || player.socketId !== socket.id || room.host !== username) return;
        try {
          await rematch(socket.gameID, room, username);
        } catch (error) {
          socket.emit("gameError", "Could not create a new board. Please try again.");
        }
      }),
    );

    // Leave button: leave right away, no rejoin grace
    socket.on(
      "leaveRoom",
      safe("leaveRoom", async () => {
        await leaveRoom(socket, true);
      }),
    );

    // Lost connection or closed tab: the seat is kept for a while
    socket.on(
      "disconnect",
      safe("disconnect", async () => {
        await leaveRoom(socket, false);
      }),
    );
  });

  /* ---------- Leaving & rejoining ---------- */

  async function leaveRoom(socket, intentional) {
    const gameID = socket.gameID;
    const room = rooms.get(gameID, "multiplayer");
    detachSocket(socket);
    if (room == null) return;

    // Spectator
    if (room.spectators.delete(socket.id)) {
      emitRoomState(gameID, room);
      return;
    }

    const player = findPlayer(room, socket.data.username);
    // Not this socket's seat (e.g. replaced by another tab)
    if (player == null || player.socketId !== socket.id || !player.connected) return;

    // After the game: gone, so not part of a rematch
    if (room.status === STATUS.FINISHED) {
      player.connected = false;
      player.left = true;
      player.disconnectedAt = Date.now();
      systemMessage(gameID, room, `${player.name} left the room.`, "leave");
      // The host left: somebody who is still here can start the rematch
      const next = room.players.find((p) => p.connected);
      if (room.host === player.name && next != null) {
        room.host = next.name;
        systemMessage(gameID, room, `${room.host} is the new host.`, "host");
      }
      emitRoomState(gameID, room);
      return;
    }

    // Surrendered players only watch, nothing to do for the game
    if (!player.active) {
      player.connected = false;
      emitRoomState(gameID, room);
      return;
    }

    if (intentional) {
      await removePlayer(gameID, room, player, "left the room");
      return;
    }

    player.connected = false;
    player.disconnectedAt = Date.now();

    if (room.status === STATUS.PLAYING && isPlayersTurn(room, player.name)) {
      // Don't let the others wait for somebody who is gone
      nextTurn(gameID, room);
    }

    systemMessage(gameID, room, `${player.name} lost the connection...`, "disconnect");
    emitRoomState(gameID, room);
  }

  // Removes a player for good (left, kicked out by the timeout, surrendered).
  async function removePlayer(gameID, room, player, reason) {
    const index = room.players.indexOf(player);
    if (index < 0) return;

    if (room.status === STATUS.WAITING) {
      room.players.splice(index, 1);
      systemMessage(gameID, room, `${player.name} ${reason}.`, "leave");

      // The host left, the next player takes over
      if (room.host === player.name && room.players.length > 0) {
        const next = room.players.find((p) => p.connected) || room.players[0];
        room.host = next.name;
        systemMessage(gameID, room, `${room.host} is the new host.`, "host");
      }

      emitRoomState(gameID, room);
      return;
    }

    if (!player.active || room.status === STATUS.FINISHED) return;

    rooms.touch(room);
    const wasTurn = room.turn === index;
    player.active = false;
    // Shown as "Left" instead of the surrender flag
    player.left = reason !== "surrendered";
    if (wasTurn && room.status === STATUS.PLAYING) {
      nextTurn(gameID, room);
    }

    systemMessage(gameID, room, `${player.name} ${reason}.`, "leave");

    if (activePlayers(room).length <= 1) {
      await getWinner(gameID, room);
    } else {
      emitRoomState(gameID, room);
    }
  }

  /*
   * Runs regularly: players who didn't come back in time lose their seat,
   * rooms without anybody in them are deleted.
   */
  async function tick(now = Date.now()) {
    for (const [gameID, room] of rooms.list("multiplayer")) {
      try {
        const grace = room.status === STATUS.WAITING ? config.REJOIN_GRACE_WAITING : config.REJOIN_GRACE_PLAYING;

        for (const player of [...room.players]) {
          if (!player.connected && player.active && now - player.disconnectedAt >= grace) {
            await removePlayer(gameID, room, player, "didn't come back");
          }
        }

        if (connectedCount(room) > 0) {
          room.emptySince = null;
        } else if (room.emptySince == null) {
          room.emptySince = now;
        } else if (now - room.emptySince >= Math.max(config.EMPTY_ROOM_GRACE, emptyGrace(room))) {
          rooms.remove(gameID);
        }
      } catch (error) {
        console.error("[multiplayer] Room check failed:", error);
      }
    }
  }

  // A running game isn't deleted while its players may still come back (reload)
  function emptyGrace(room) {
    const running = room.status === STATUS.PLAYING || room.status === STATUS.STARTING;
    return running && room.players.some((player) => player.active) ? config.REJOIN_GRACE_PLAYING : 0;
  }

  const ticker = setInterval(() => tick().catch(() => {}), config.TICK);
  ticker.unref();

  /* ---------- Power-ups (mode "powerups") ---------- */

  // A card as the clients get it (power: part of a power-up pair)
  function cardData(room, id) {
    const data = { id: id, src: room.cardImages[id] };
    if (room.mode === "powerups" && room.powerCards.includes(id)) data.power = true;
    return data;
  }

  // Found and open cards, e.g. for (re)joining players or after the board changed
  function boardState(room) {
    return {
      found: room.foundMatches.map((id) => cardData(room, id)),
      opened: room.openedCards.map((id) => cardData(room, id)),
    };
  }

  function setupPowerups(room) {
    room.powerCards = [];
    room.turnPowerUsed = false;
    room.turnPairs = 0;
    room.closingCard = null;
    const start = room.mode === "powerups" ? powerups.startPowerups() : [];
    for (const player of room.players) {
      player.powerups = start.slice();
      player.unlucky = 0;
      // How often the player got each power-up (it gets rarer every time)
      player.received = {};
      for (const id of start) player.received[id] = 1;
      player.shield = false;
      player.fog = false;
      player.skipNext = false;
      player.armed = noneArmed();
    }
    if (room.mode === "powerups") {
      room.powerCards = powerups.choosePowerCards(room.cardPairs);
    }
  }

  function noneArmed() {
    return { extraTurn: false, secondChance: false, combo: false, tripleFlip: false, doubleOrNothing: false };
  }

  // Triple flip: 3 cards can be open at once
  function openLimit(room) {
    const player = room.players[room.turn];
    return room.mode === "powerups" && player != null && player.armed.tripleFlip ? 3 : 2;
  }

  // Two of the open cards that belong together (or null)
  function findOpenPair(room) {
    const open = room.openedCards;
    for (let i = 0; i < open.length; i++) {
      for (let j = i + 1; j < open.length; j++) {
        if (room.cardPairs[open[i]] === open[j]) return [open[i], open[j]];
      }
    }
    return null;
  }

  function powerupLabel(id) {
    const info = powerups.POWERUPS[id];
    return info ? `${info.emoji} ${info.name}` : id;
  }

  function receive(player, id) {
    player.powerups.push(id);
    player.received = player.received || {};
    player.received[id] = (player.received[id] || 0) + 1;
  }

  // A random power-up for the player, if there is a free slot
  function grantPowerup(gameID, room, player, reason) {
    if (player.powerups.length >= powerups.HAND_LIMIT) {
      systemMessage(gameID, room, `${player.name} ${reason}, but has no free slot.`, "info");
      return;
    }
    const id = powerups.randomPowerup(player.received);
    receive(player, id);
    systemMessage(gameID, room, `${player.name} ${reason}: ${powerupLabel(id)}`, "start");
  }

  // The turn of the current player ends: unlucky bonus, effects run out
  function endPowerupTurn(gameID, room) {
    const player = room.players[room.turn];
    if (player != null && room.status === STATUS.PLAYING) {
      if (room.turnPairs === 0) {
        player.unlucky++;
        if (player.unlucky >= powerups.UNLUCKY_TURNS) {
          player.unlucky = 0;
          grantPowerup(gameID, room, player, "had bad luck and gets");
        }
      } else {
        player.unlucky = 0;
      }
      player.fog = false;
      player.armed = noneArmed();
    }
    room.turnPowerUsed = false;
    room.turnPairs = 0;
  }

  function isClosed(room, id) {
    return isValidCardId(id) && !room.foundMatches.includes(id) && !room.openedCards.includes(id) && room.closingCard !== id;
  }

  // Shows cards for a moment: only to one socket, or to everybody in the room
  function reveal(target, ids, room, duration, type) {
    target.emit("powerupReveal", { type: type, duration: duration, cards: ids.map((id) => cardData(room, id)) });
  }

  // The board changed (shuffle, rotate, ...): the cards move, everybody gets the new state
  function moveCards(gameID, room, type, perm) {
    powerups.applyPermutation(room, perm);
    multiPlayer.to(gameID).emit("boardChanged", { type: type, perm: perm });
    multiPlayer.to(gameID).emit("boardState", boardState(room));
  }

  function usePowerup(socket, room, data) {
    const username = socket.data.username;
    const gameID = socket.gameID;
    const id = data.id;
    const info = powerups.POWERUPS[id];
    const player = findPlayer(room, username);

    if (
      room.mode !== "powerups" ||
      info == null ||
      player == null ||
      player.socketId !== socket.id ||
      !isPlayersTurn(room, username) ||
      room.turnPowerUsed ||
      room.checkingCards ||
      !player.powerups.includes(id)
    ) {
      return;
    }

    // Attacks: the chosen opponent (or the only one there is)
    let victim = null;
    if (info.target === "player") {
      const opponents = room.players.filter((p) => p.active && p.name !== username);
      victim = opponents.length === 1 ? opponents[0] : opponents.find((p) => p.name === data.player) || null;
      if (victim == null) return;
    }

    // Cards to choose (validated here)
    const targets = Array.isArray(data.targets) ? data.targets : [];
    const needed = info.target === "card" ? 1 : info.target === "cards" ? 2 : 0;
    if (targets.length !== needed || !targets.every((card) => isClosed(room, card))) return;
    if (needed === 2 && targets[0] === targets[1]) return;

    // Moving cards only works when no card is open, second chance before the second card
    if (["shuffle", "swap", "rotate", "rowShift"].includes(id) && room.openedCards.length > 0) return;
    const rowPerm = id === "rowShift" ? powerups.rowShiftPermutation(room, targets[0]) : null;
    if (id === "rowShift" && rowPerm == null) return; // nothing would move
    if (id === "secondChance" && (room.openedCards.length > 1 || player.armed.secondChance)) return;

    player.powerups.splice(player.powerups.indexOf(id), 1);
    room.turnPowerUsed = true;
    rooms.touch(room);
    systemMessage(gameID, room, `${username} used ${powerupLabel(id)}.`, "info");

    switch (id) {
      case "map": {
        // Cards nobody has opened yet
        const fresh = [];
        for (let card = 0; card < CARD_COUNT; card++) {
          if (room.cardCounter[card] === 0 && !room.foundMatches.includes(card)) fresh.push(card);
        }
        socket.emit("powerupReveal", { type: "map", duration: 3000, cards: fresh.map((card) => ({ id: card })) });
        break;
      }
      case "peek":
        reveal(socket, targets, room, 1500, "peek");
        break;
      case "spotlight":
        reveal(socket, powerups.area(targets[0]).filter((card) => isClosed(room, card)), room, 1500, "peek");
        break;
      case "bomb":
        reveal(multiPlayer.to(gameID), powerups.area(targets[0]).filter((card) => isClosed(room, card)), room, 2000, "bomb");
        break;
      case "extraTurn":
      case "secondChance":
      case "combo":
      case "tripleFlip":
      case "doubleOrNothing":
        player.armed[id] = true;
        break;
      case "shield":
        player.shield = true;
        break;
      case "party":
        for (const p of room.players) {
          if (p.active) grantPowerup(gameID, room, p, "gets from the party");
        }
        break;
      case "mysteryBox": {
        // Mostly good, sometimes not
        const roll = Math.random();
        if (roll < 0.75) {
          const prize = powerups.randomPowerup(player.received, ["mysteryBox"]);
          receive(player, prize);
          systemMessage(gameID, room, `${username} finds ${powerupLabel(prize)} in the box.`, "start");
        } else if (roll < 0.875) {
          player.points -= 1;
          systemMessage(gameID, room, `The box bites! ${username} loses 1 point.`, "info");
        } else {
          player.skipNext = true;
          systemMessage(gameID, room, `The box is empty and ${username} misses their next turn.`, "info");
        }
        break;
      }
      case "fog":
      case "skip":
      case "steal": {
        if (victim.shield) {
          victim.shield = false;
          systemMessage(gameID, room, `${victim.name}'s shield blocked it.`, "info");
        } else if (id === "fog") {
          victim.fog = true;
          systemMessage(gameID, room, `${victim.name} is in the fog for their next turn.`, "info");
        } else if (id === "skip") {
          victim.skipNext = true;
          systemMessage(gameID, room, `${victim.name} misses their next turn.`, "info");
        } else if (victim.powerups.length === 0) {
          systemMessage(gameID, room, `${victim.name} has nothing to steal.`, "info");
        } else {
          const loot = victim.powerups.splice(Math.floor(Math.random() * victim.powerups.length), 1)[0];
          player.powerups.push(loot);
          systemMessage(gameID, room, `${username} steals ${powerupLabel(loot)} from ${victim.name}.`, "info");
        }
        break;
      }
      case "shuffle":
        moveCards(gameID, room, "shuffle", powerups.shufflePermutation(room));
        break;
      case "swap":
        moveCards(gameID, room, "swap", powerups.swapPermutation(targets[0], targets[1]));
        break;
      case "rowShift":
        moveCards(gameID, room, "rowShift", rowPerm);
        break;
      case "rotate":
        moveCards(gameID, room, "rotate", powerups.rotatePermutation());
        break;
    }

    emitRoomState(gameID, room);
  }

  /* ---------- Game ---------- */

  function checkGame(socket, room) {
    const gameID = socket.gameID;
    if (room.openedCards.length >= 2 && !room.checkingCards) {
      const pair = findOpenPair(room);
      if (pair != null) {
        foundPair(gameID, room, pair);
      } else if (room.openedCards.length < openLimit(room)) {
        // Triple flip: one more card to go
        emitRoomState(gameID, room);
      } else {
        room.checkingCards = true;
        missedPair(socket, room);
      }
    }

    // Check for winner
    if (room.foundMatches.length == CARD_COUNT) {
      getWinner(gameID, room).catch((error) =>
        console.error("[multiplayer] Could not finish game:", error),
      );
    }
  }

  // Lets a single open card close a moment later (it can't be opened until then)
  function closeLater(gameID, room, id) {
    room.closingCard = id;
    roomTimeout(
      room,
      () => {
        if (room.closingCard === id) room.closingCard = null;
        multiPlayer.to(gameID).emit("closeCards", { 1: id });
      },
      900,
    );
  }

  // The open cards don't contain a pair
  function missedPair(socket, room) {
    const gameID = socket.gameID;
    const player = room.players[room.turn];
    if (room.mode === "powerups" && player.armed.tripleFlip) player.armed.tripleFlip = false;
    if (room.mode === "powerups" && player.armed.doubleOrNothing) {
      // Double or nothing: nothing it is (points can go below 0)
      player.armed.doubleOrNothing = false;
      player.points -= 1;
      systemMessage(gameID, room, `Double or nothing: ${player.name} loses 1 point.`, "info");
    }
    if (room.mode === "powerups" && player.armed.secondChance) {
      // Second chance: only the second card closes, pick another one
      player.armed.secondChance = false;
      const second = room.openedCards.pop();
      room.checkingCards = false;
      closeLater(gameID, room, second);
      systemMessage(gameID, room, `${player.name} uses the second chance.`, "info");
      emitRoomState(gameID, room);
      return;
    }
    if (room.mode === "speed") {
      // Speed round: the clock stops, and the turn passes on its own
      // after a short look at the cards
      room.turnToken++;
      room.turnEndsAt = null;
      const token = room.turnToken;
      emitRoomState(gameID, room);
      roomTimeout(
        room,
        () => {
          if (room.status !== STATUS.PLAYING || room.turnToken !== token) return;
          nextTurn(gameID, room);
          emitRoomState(gameID, room);
        },
        config.SPEED_MISS_DELAY,
      );
    } else {
      socket.emit("activateEndTurn");
      // Everybody sees that two wrong cards are open (power-up mode: End turn in the bar)
      emitRoomState(gameID, room);
    }
  }

  function foundPair(gameID, room, [id, id2]) {
    // Push to foundMatches -> So it can't be opened again
    room.foundMatches.push(id, id2);

    // understateCard - remove Zoom and Border on cards
    roomTimeout(room, () => multiPlayer.to(gameID).emit("understateCard", id), 500);
    roomTimeout(room, () => multiPlayer.to(gameID).emit("understateCard", id2), 500);

    // Increase Points
    const player = room.players[room.turn];
    player.points++;
    multiPlayer.to(gameID).emit("matchFound", { name: player.name, ids: [id, id2] });

    if (room.mode === "powerups") {
      room.turnPairs++;
      // Combo: every further pair in this turn gives bonus points (+1, +2, ...)
      if (player.armed.combo && room.turnPairs > 1) {
        player.points += room.turnPairs - 1;
        systemMessage(gameID, room, `Combo! ${player.name} gets +${room.turnPairs - 1} bonus.`, "trophy");
      }
      if (player.armed.doubleOrNothing) {
        player.armed.doubleOrNothing = false;
        player.points++;
        systemMessage(gameID, room, `Double or nothing: ${player.name} gets double!`, "trophy");
      }
      if (room.powerCards.includes(id)) {
        grantPowerup(gameID, room, player, "found a power-up pair");
      }
      // Triple flip: the third card closes again, the triple flip is used up
      const rest = room.openedCards.filter((card) => card !== id && card !== id2);
      if (room.openedCards.length > 2) player.armed.tripleFlip = false;
      rest.forEach((card) => closeLater(gameID, room, card));
    }

    // Reset turn - a found pair gives another try with fresh time
    room.openedCards = [];
    room.checkingCards = false;
    startTurnTimer(gameID, room);
    emitRoomState(gameID, room);
  }

  // Closes the open cards (the turn stays)
  function closeOpenCards(gameID, room) {
    if (room.openedCards.length > 0) {
      multiPlayer.to(gameID).emit("closeCards", {
        1: room.openedCards[0],
        2: room.openedCards[1],
        3: room.openedCards[2],
      });
    }
    room.openedCards = [];
    room.checkingCards = false;
  }

  // Closes the open cards and gives the turn to the next active and connected player.
  function nextTurn(gameID, room) {
    closeOpenCards(gameID, room);
    if (room.mode === "powerups") endPowerupTurn(gameID, room);

    const count = room.players.length;
    let fallback = null;
    for (let step = 1; step <= count; step++) {
      const index = (room.turn + step) % count;
      const player = room.players[index];
      if (!player.active) continue;
      // Skip power-up: this player sits out once
      if (room.mode === "powerups" && player.skipNext && index !== room.turn) {
        player.skipNext = false;
        systemMessage(gameID, room, `${player.name} is skipped.`, "info");
        continue;
      }
      if (player.connected) {
        room.turn = index;
        fallback = null;
        break;
      }
      // Only disconnected players left: give it to one of them, they may come back
      if (fallback == null) fallback = index;
    }
    if (fallback != null) room.turn = fallback;

    // Reset turn
    room.openedCards = [];
    room.checkingCards = false;
    startTurnTimer(gameID, room);
  }

  /*
   * Speed round: every turn has a time limit. When it runs out, the open
   * cards are closed and the next player continues.
   */
  function startTurnTimer(gameID, room) {
    room.turnToken++;
    if (room.mode !== "speed" || room.status !== STATUS.PLAYING) {
      room.turnEndsAt = null;
      return;
    }

    const token = room.turnToken;
    // Animations (cards turning) don't count: the clock starts a bit later
    room.turnStartsAt = Date.now() + config.SPEED_ANIMATION_GRACE;
    room.turnEndsAt = room.turnStartsAt + room.turnTime;

    roomTimeout(
      room,
      () => {
        if (room.status !== STATUS.PLAYING || room.turnToken !== token) return;
        const player = room.players[room.turn];
        multiPlayer.to(gameID).emit("turnTimeout", { name: player.name });
        systemMessage(gameID, room, `${player.name} ran out of time.`, "timer");
        nextTurn(gameID, room);
        emitRoomState(gameID, room);
      },
      config.SPEED_ANIMATION_GRACE + room.turnTime,
    );
  }

  async function getWinner(gameID, room) {
    // Only finish a game once
    if (room.status !== STATUS.PLAYING && room.status !== STATUS.STARTING) return;
    room.status = STATUS.FINISHED;
    room.turnEndsAt = null;
    room.turnToken++;

    // Players who left can't win
    const active = activePlayers(room);
    const highestPoints = Math.max(...active.map((player) => player.points));
    const winners = active
      .filter((player) => player.points === highestPoints)
      .map((player) => player.name);

    // Coins for the hidden jackpot: only for a game that was played to the end
    // (not when the others surrendered or left)
    if (room.foundMatches.length === CARD_COUNT) {
      winners.forEach((name) => coins.reward(name, "multiplayer"));
    }

    for (let i = 0; i < CARD_COUNT; i++) {
      multiPlayer.to(gameID).emit("turnCard", cardData(room, i));
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
      winners.length > 1
        ? `Draw between ${winners.join(", ")}!`
        : winners.length == 1
          ? `${winners[0]} wins!`
          : "The game is over.", // nobody left in the game
      "trophy",
    );
    emitRoomState(gameID, room);
    multiPlayer.to(gameID).emit("getWinner", {
      winners: winners,
      cardCounter: room.cardCounter,
    });
    // The room stays for a rematch, it is removed once everybody is gone
  }

  /*
   * Rematch: everybody who is still in the room goes back to the waiting
   * room with a new board. The host starts the next game as usual.
   */
  async function rematch(gameID, room, by) {
    if (room.status !== STATUS.FINISHED || room.creatingRematch) return;
    room.creatingRematch = true;
    let board;
    try {
      board = await createBoard();
    } finally {
      room.creatingRematch = false;
    }
    // Somebody else was faster, or the room is gone
    if (room.status !== STATUS.FINISHED || rooms.get(gameID, "multiplayer") !== room) return;

    room.players = room.players
      .filter((player) => player.connected)
      .map((player) => ({ ...player, points: 0, active: true, ready: false, left: false, disconnectedAt: null }));
    if (findPlayer(room, room.host) == null && room.players.length > 0) {
      room.host = room.players[0].name;
    }
    room.status = STATUS.WAITING;
    room.turn = -1;
    room.turnEndsAt = null;
    room.turnToken++;
    room.openedCards = [];
    room.checkingCards = false;
    room.foundMatches = [];
    room.cardCounter = Array(CARD_COUNT).fill(0);
    room.cardPairs = board.cardPairs;
    room.cardImages = board.cardImages;
    rooms.touch(room);

    // Players who surrendered watched until now - they play again
    for (const player of room.players) {
      const playerSocket = multiPlayer.sockets.get(player.socketId);
      if (playerSocket != null && playerSocket.spectator) {
        playerSocket.spectator = false;
        playerSocket.emit("joinedRoom", { username: player.name, spectator: false });
      }
    }

    multiPlayer.to(gameID).emit("rematch");
    systemMessage(gameID, room, `${by} started a rematch.`, "start");
    emitRoomState(gameID, room);
  }

  return { tick };
};
