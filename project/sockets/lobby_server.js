const rooms = require("../game/rooms");
const { createBoard } = require("../game/board");
const multiplayerRoom = require("../game/multiplayer_room");
const socketAuth = require("./socket_auth");
const safe = require("./safe_handler");

// Name & how much the computer can remember for every difficulty
const BOTS = [
  { computername: "Easy Bot", moveMemory: 3 },
  { computername: "Medium Bot", moveMemory: 7 },
  { computername: "Hard Bot", moveMemory: 12 },
  { computername: "Expert Bot", moveMemory: 50 },
];

module.exports = function (io) {
  const lobby = io.of("/lobby");
  lobby.use(socketAuth);
  multiplayerRoom.attachLobby(lobby);

  lobby.on("connection", (socket) => {
    // Open multiplayer rooms
    socket.emit("roomList", multiplayerRoom.publicRooms(socket.data.username));

    socket.on(
      "playSingleplayer",
      safe("playSingleplayer", (data) => {
        const difficulty = data != null ? data.difficulty : undefined;

        // Check if difficulty is in range
        if (!Number.isInteger(difficulty) || BOTS[difficulty] == null) {
          return;
        }

        const gameID = rooms.create("singleplayer", {
          difficulty: difficulty,
          username: socket.data.username,
          computername: BOTS[difficulty].computername,
          moveMemory: BOTS[difficulty].moveMemory,
        });

        socket.emit("saveGameID", { gameID: gameID, url: "/singleplayer" });
      }),
    );

    socket.on(
      "playMultiplayer",
      safe("playMultiplayer", async () => {
        // One room per click
        if (socket.creatingRoom) return;
        socket.creatingRoom = true;

        try {
          // The board is created right away, so the room is ready to start.
          const board = await createBoard();
          const gameID = multiplayerRoom.createRoom(socket.data.username, board);
          socket.emit("saveGameID", { gameID: gameID, url: "/play" });
        } catch (error) {
          socket.emit("gameError", error.message);
        } finally {
          socket.creatingRoom = false;
        }
      }),
    );

    socket.on(
      "joinMultiplayer",
      safe("joinMultiplayer", (gameID) => {
        if (typeof gameID !== "string") return;
        gameID = gameID.trim();

        if (rooms.get(gameID, "multiplayer") == null) {
          socket.emit("gameError", "No game found with this ID.");
          return;
        }

        socket.emit("saveGameID", { gameID: gameID, url: "/play" });
      }),
    );
  });
};
