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

// Own name, to show "Rejoin" for rooms I'm already playing in
var myUsername = null;
var lastRooms = [];
userPromise.then((username) => {
  myUsername = username;
  renderRooms(lastRooms);
});

socket.on("roomList", (rooms) => {
  lastRooms = rooms;
  renderRooms(rooms);
});

function renderRooms(rooms) {
  var list = document.getElementById("roomList");
  list.replaceChildren();
  document.getElementById("noRooms").hidden = rooms.length > 0;
  list.closest("table").hidden = rooms.length == 0;
  document.getElementById("roomCount").innerText =
    rooms.length == 1 ? "1 game" : rooms.length + " games";

  rooms.forEach((room) => list.appendChild(createRoomRow(room)));
}

function actionButton(label, icon, primary, onClick) {
  var button = document.createElement("button");
  button.type = "button";
  button.className = "mm-btn mm-btn-sm" + (primary ? " mm-btn-primary" : "");
  button.append(createIcon(icon), document.createTextNode(label));
  button.addEventListener("click", onClick);
  return button;
}

// Opens a room from the list, optionally only as spectator
function openRoom(gameID, watch) {
  sessionStorage.setItem("gameID", gameID);
  window.location.href = "/play?game=" + encodeURIComponent(gameID) + (watch ? "&watch=1" : "");
}

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
  if (room.mode == "speed") {
    var speed = document.createElement("span");
    speed.className = "mode-badge ms-2";
    speed.append(
      createIcon("bi-lightning-charge-fill"),
      document.createTextNode(" Speed" + (room.turnTime ? " " + room.turnTime / 1000 + "s" : "")),
    );
    name.appendChild(speed);
  }
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

  // Rejoin (already a player), join (free seat) and watch
  var actionCell = document.createElement("td");
  actionCell.className = "text-end room-actions";
  var isMine = myUsername != null && (room.playerNames || []).includes(myUsername);

  if (isMine) {
    actionCell.appendChild(actionButton("Rejoin", "bi-arrow-repeat", true, () => openRoom(room.gameID, false)));
  } else {
    // Kicked by the host: only watching is possible
    if (waiting && !full && !room.kicked) {
      actionCell.appendChild(actionButton("Join", "bi-box-arrow-in-right", true, () => openRoom(room.gameID, false)));
    }
    actionCell.appendChild(actionButton("Watch", "bi-eye", false, () => openRoom(room.gameID, true)));
  }

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
