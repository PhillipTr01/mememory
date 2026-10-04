const socket = io("/lobby");

function playSingleplayer(difficulty) {
  socket.emit("playSingleplayer", {
    difficulty: difficulty,
  });
}

function playMultiplayer() {
  var button = document.getElementById("createGameButton");
  button.disabled = true;
  setTimeout(() => (button.disabled = false), 3000);
  socket.emit("playMultiplayer");
}

function joinMultiplayer(gameID) {
  gameID = (gameID || document.getElementById("joinLobbyTag").value).trim();
  if (gameID == "") return;
  socket.emit("joinMultiplayer", gameID);
}

// Join with Enter in the game ID field
document.getElementById("joinLobbyTag").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    joinMultiplayer();
  }
});

socket.on("saveGameID", (data) => {
  sessionStorage.setItem("gameID", data.gameID);
  window.location.href =
    data.url == "/play" ? "/play?game=" + encodeURIComponent(data.gameID) : data.url;
});

// List of open multiplayer rooms (updated live)
socket.on("roomList", (rooms) => {
  var list = document.getElementById("roomList");
  list.replaceChildren();
  document.getElementById("noRooms").hidden = rooms.length > 0;

  rooms.forEach((room) => {
    var item = document.createElement("li");
    item.className = "d-flex align-items-center rounded px-3 py-2 mb-2 bg-dark";

    var host = document.createElement("span");
    host.className = "flex-grow-1 text-break";
    host.innerText = room.host + "'s room";

    var players = document.createElement("span");
    players.className = "text-secondary mx-3";
    players.innerText = room.players + " / " + room.maxPlayers;

    var button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-sm multiplayer-button";
    button.innerText = "Join";
    button.addEventListener("click", () => joinMultiplayer(room.gameID));

    item.append(host, players, button);
    list.appendChild(item);
  });
});

socket.on("gameError", (message) => {
  alert(message);
});

socket.on("connect_error", (error) => {
  // Not logged in (anymore)
  if (error && error.message == "unauthorized") {
    window.location.href = "/";
  }
});
