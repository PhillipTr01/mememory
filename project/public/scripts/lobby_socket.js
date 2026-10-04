const socket = io("/lobby");

function playSingleplayer(difficulty) {
  socket.emit("playSingleplayer", {
    difficulty: difficulty,
  });
}

function playMultiplayer() {
  var button = document.getElementById("createGameButton");
  button.disabled = true;
  // Enable again if the server doesn't answer
  setTimeout(() => (button.disabled = false), 5000);
  socket.emit("playMultiplayer");
}

function joinMultiplayer(gameID) {
  gameID = (gameID || document.getElementById("joinLobbyTag").value).trim();
  if (gameID == "") {
    showToast("Please enter a room code.", "error");
    return;
  }
  socket.emit("joinMultiplayer", gameID);
}

document.getElementById("joinForm").addEventListener("submit", (event) => {
  event.preventDefault();
  joinMultiplayer();
});

socket.on("saveGameID", (data) => {
  sessionStorage.setItem("gameID", data.gameID);
  window.location.href =
    data.url == "/play" ? "/play?game=" + encodeURIComponent(data.gameID) : data.url;
});

/* ---------- List of multiplayer games (updated live) ---------- */

socket.on("roomList", (rooms) => {
  var list = document.getElementById("roomList");
  list.replaceChildren();
  document.getElementById("noRooms").hidden = rooms.length > 0;
  list.closest("table").hidden = rooms.length == 0;
  document.getElementById("roomCount").innerText =
    rooms.length == 1 ? "1 game" : rooms.length + " games";

  rooms.forEach((room) => list.appendChild(createRoomRow(room)));
});

function createRoomRow(room) {
  var row = document.createElement("tr");
  var waiting = room.status == "waiting";
  var full = room.players >= room.maxPlayers;

  // Host + code
  var hostCell = document.createElement("td");
  var host = document.createElement("div");
  host.className = "room-host";
  var text = document.createElement("div");
  var name = document.createElement("div");
  name.className = "fw-semibold";
  name.innerText = room.host + "'s room";
  var code = document.createElement("div");
  code.className = "room-code-small";
  code.innerText = "#" + room.gameID;
  text.append(name, code);
  host.append(createAvatar(room.host), text);
  hostCell.appendChild(host);

  // Players with a small progress bar
  var playersCell = document.createElement("td");
  var bar = document.createElement("div");
  bar.className = "player-bar";
  var track = document.createElement("div");
  track.className = "bar";
  var fill = document.createElement("div");
  fill.className = "fill";
  fill.style.width = Math.min(100, (room.players / room.maxPlayers) * 100) + "%";
  track.appendChild(fill);
  var count = document.createElement("span");
  count.innerText = room.players + " / " + room.maxPlayers;
  bar.append(track, count);
  playersCell.appendChild(bar);

  var spectatorsCell = document.createElement("td");
  spectatorsCell.className = "d-none d-md-table-cell mm-muted";
  spectatorsCell.append(createIcon("bi-eye me-1"), document.createTextNode(room.spectators));

  // Status
  var statusCell = document.createElement("td");
  var badge = document.createElement("span");
  badge.className = "mm-badge " + (waiting ? "waiting" : "playing");
  badge.innerText = waiting ? (full ? "Full" : "Waiting") : room.status == "starting" ? "Starting" : "In game";
  statusCell.appendChild(badge);

  // Join or watch
  var actionCell = document.createElement("td");
  actionCell.className = "text-end";
  var button = document.createElement("button");
  button.type = "button";
  var canJoin = waiting && !full;
  button.className = "mm-btn mm-btn-sm " + (canJoin ? "mm-btn-primary" : "");
  button.append(createIcon(canJoin ? "bi-box-arrow-in-right" : "bi-eye"), document.createTextNode(canJoin ? "Join" : "Watch"));
  button.addEventListener("click", () => joinMultiplayer(room.gameID));
  actionCell.appendChild(button);

  row.append(hostCell, playersCell, spectatorsCell, statusCell, actionCell);
  return row;
}

/* ---------- Connection ---------- */

socket.on("gameError", (message) => {
  document.getElementById("createGameButton").disabled = false;
  showToast(message, "error");
});

socket.on("connect", () => {
  var status = document.getElementById("lobbyStatus");
  status.classList.remove("offline");
  status.innerText = "Live";
});

socket.on("disconnect", () => {
  var status = document.getElementById("lobbyStatus");
  status.classList.add("offline");
  status.innerText = "Reconnecting";
});

socket.on("connect_error", (error) => {
  // Not logged in (anymore)
  if (error && error.message == "unauthorized") {
    window.location.href = "/";
  }
});
