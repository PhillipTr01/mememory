const rooms = require("../game/rooms");
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

  lobby.on("connection", (socket) => {
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
      safe("playMultiplayer", () => {
        const gameID = rooms.create("multiplayer", {
          player: [{ name: socket.data.username, points: 0 }],
          activePlayers: [1],
          checkingCards: false,
          initialized: false,
          status: 0,
          turn: 0,
          openedCards: [],
          cardPairs: [],
          cardImages: [],
          foundMatches: [],
          cardCounter: Array(66).fill(0),
        });

        socket.emit("saveGameID", { gameID: gameID, url: "/play" });
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
