const socket = io("/multiplayer");

var modal;
var backImage = "/static/images/logo_small.png";

// Own name and role, sent by the server after joining
var me = { username: null, spectator: false };
// Last state of the room (players, host, turn, settings)
var room = null;

// The room can come from an invite link (/play?game=ID) or from the lobby
var urlGameID = new URLSearchParams(window.location.search).get("game");
if (urlGameID) {
  sessionStorage.setItem("gameID", urlGameID);
}
var gameID = sessionStorage.getItem("gameID");

if (!gameID) {
  window.location.href = "/lobby";
} else if (urlGameID !== gameID) {
  // Keep the room in the URL, so reloading or sharing the page works
  history.replaceState(null, "", "/play?game=" + encodeURIComponent(gameID));
}

/* ---------- Connection ---------- */

// (Re)join the room on every (re)connect
socket.on("connect", () => {
  socket.emit("joinRoom", { gameID: gameID });
});

// Something went wrong on the server (e.g. not enough memes) -> back to the lobby
socket.on("gameError", (message) => {
  alert(message || "Something went wrong. Please try again.");
  window.location.href = "/lobby";
});

socket.on("noGameFound", () => {
  alert("This room doesn't exist anymore.");
  window.location.href = "/lobby";
});

socket.on("connect_error", (error) => {
  // Not logged in (anymore)
  if (error && error.message == "unauthorized") {
    window.location.href = "/";
  }
});

socket.on("disconnect", () => {
  showChatError("Connection lost - reconnecting...");
});

/* ---------- Page setup ---------- */

document.addEventListener(
  "DOMContentLoaded",
  function () {
    // Fill board with cards
    var board = document.getElementById("memoryTable");
    board.innerHTML = "";
    for (var index = 0; index < 66; index++) {
      var div = `<div class="card-size">
                        <div id="card-${index}" class="col-1 card pos-abs w-100 h-100" onclick="openCard(${index}); false;">
                            <div class="card-back card-image">
                                <img src="" class="card-image">
                                <div id="cardcount-${index}" class="overlay"></div>
                            </div>
                            <div class="card-front card-image">
                                <img src="${backImage}" class="card-image">
                            </div>
                        </div>
                    </div>`;
      board.innerHTML += div;
    }

    modal = document.getElementById("cardModal");

    document.getElementById("roomCode").innerText = gameID;
    document.getElementById("copyCodeButton").addEventListener("click", (e) => copyText(gameID, e.currentTarget));
    document.getElementById("copyLinkButton").addEventListener("click", (e) =>
      copyText(window.location.origin + "/play?game=" + encodeURIComponent(gameID), e.currentTarget),
    );
    document.getElementById("startButton").addEventListener("click", startGame);
    document.getElementById("maxPlayersSelect").addEventListener("change", (e) => {
      socket.emit("updateSettings", { maxPlayers: Number(e.target.value) });
    });
    document.getElementById("publicSwitch").addEventListener("change", (e) => {
      socket.emit("updateSettings", { isPublic: e.target.checked });
    });
    document.getElementById("chat-form").addEventListener("submit", (e) => {
      e.preventDefault();
      sendChatMessage();
    });
  },
  false,
);

function copyText(text, button) {
  var done = () => {
    var label = button.innerHTML;
    button.innerText = "Copied!";
    setTimeout(() => (button.innerHTML = label), 1500);
  };

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done, () => prompt("Copy this:", text));
  } else {
    prompt("Copy this:", text);
  }
}

/* ---------- Room state ---------- */

socket.on("joinedRoom", (data) => {
  me = data;

  if (me.spectator) {
    var surrenderButton = document.getElementById("surrenderButton");
    surrenderButton.disabled = true;
    surrenderButton.innerText = "SPECTATING GAME";
    surrenderButton.classList.remove("btn-outline-danger");
    surrenderButton.classList.add("btn-outline-secondary");
  }
});

socket.on("roomState", (state) => {
  var previous = room;
  room = state;

  renderPlayerList(state);
  renderWaitingRoom(state);

  var waiting = state.status == "waiting";
  document.getElementById("waitingRoom").hidden = !waiting;
  document.getElementById("board").hidden = waiting;

  var player = getMyPlayer(state);
  var isPlaying = state.status == "playing" && player != null && player.active;
  document.getElementById("playButton").hidden = !isPlaying;
  if (!me.spectator && state.status != "finished") {
    document.getElementById("surrenderButton").disabled = !isPlaying;
  }

  // My turn is over -> the End Turn button can't be used anymore
  if (previous != null && !isMyTurn(state)) {
    document.getElementById("playButton").disabled = true;
  }
});

function getMyPlayer(state) {
  return state.players.find((player) => player.name == me.username) || null;
}

function isMyTurn(state) {
  var player = state.players[state.turn];
  return state.status == "playing" && player != null && player.name == me.username;
}

// Scoreboard on the right: one row per player, no fixed number of rows
function renderPlayerList(state) {
  var list = document.getElementById("playerList");
  list.replaceChildren();

  state.players.forEach((player, index) => {
    var row = document.createElement("div");
    row.className = "d-flex pb-2 player-row";
    if (!player.active) row.classList.add("inactive");

    var name = document.createElement("p");
    name.className = "flex-grow-1 m-0";
    name.innerText = player.name;

    if (player.name == state.host && state.status == "waiting") {
      name.appendChild(icon("bi-star-fill ps-2 text-warning", "Host"));
    }
    if (player.name == me.username) {
      var you = document.createElement("span");
      you.className = "you ps-2";
      you.innerText = "(you)";
      name.appendChild(you);
    }
    if (state.status == "playing" && state.turn == index) {
      row.classList.add("fw-bold");
      name.appendChild(icon("bi-hand-index-thumb ps-2 text-info", "Turn"));
    }

    var score = document.createElement("p");
    score.className = "m-0";
    score.innerText = player.points;

    row.append(name, score);
    list.appendChild(row);
  });
}

function icon(classes, title) {
  var i = document.createElement("i");
  i.className = "bi " + classes;
  i.title = title;
  return i;
}

function renderWaitingRoom(state) {
  var isHost = state.host == me.username;
  var count = state.players.length;

  document.getElementById("playerCount").innerText = `(${count} / ${state.maxPlayers})`;
  document.getElementById("waitingText").innerText = isHost
    ? "Invite your friends with the room code or link and start when everybody is here."
    : me.spectator
      ? "The room is full - you are watching this game."
      : `Waiting for ${state.host} to start the game...`;

  // Player slots
  var list = document.getElementById("waitingPlayers");
  list.replaceChildren();
  for (var i = 0; i < state.maxPlayers; i++) {
    var item = document.createElement("li");
    item.className = "waiting-player";
    var player = state.players[i];

    if (player) {
      var name = document.createElement("span");
      name.className = "flex-grow-1";
      name.innerText = player.name + (player.name == me.username ? " (you)" : "");
      item.appendChild(name);
      if (player.name == state.host) {
        item.appendChild(icon("bi-star-fill text-warning", "Host"));
      }
    } else {
      item.classList.add("empty");
      item.innerText = "Free slot";
    }
    list.appendChild(item);
  }

  // Host settings
  document.getElementById("hostSettings").hidden = !isHost;
  if (!isHost) return;

  var select = document.getElementById("maxPlayersSelect");
  select.replaceChildren();
  for (var n = Math.max(state.minPlayers, count); n <= state.maxPlayersLimit; n++) {
    var option = document.createElement("option");
    option.value = n;
    option.innerText = n;
    option.selected = n == state.maxPlayers;
    select.appendChild(option);
  }

  document.getElementById("publicSwitch").checked = state.isPublic;

  var canStart = count >= state.minPlayers;
  document.getElementById("startButton").disabled = !canStart;
  document.getElementById("startHint").innerText = canStart
    ? ""
    : `At least ${state.minPlayers} players are needed to start.`;
}

/* ---------- Game ---------- */

function startGame() {
  document.getElementById("startButton").disabled = true;
  socket.emit("startGame");
}

function openCard(id) {
  socket.emit("openCard", id);
}

function emitEndTurn() {
  socket.emit("endTurn");
}

function surrender() {
  if (confirm("Do you really want to surrender?")) {
    socket.emit("surrender");
  }
}

socket.on("turnCard", (data) => {
  var card = document.getElementById("card-" + data.id);
  if (card == null) return;
  card.childNodes[1].childNodes[1].src = data.src;

  // Highlighting a card - It gets bigger and gets a border
  card.classList.add("flip", "border", "border-3", "zoom-card-on-turn");
});

// If the card is already open, you can zoom in to read the meme
socket.on("zoomImage", (id) => {
  var card = document.getElementById("card-" + id);
  if (card != null && card.classList.contains("flip")) {
    openImageModal(card.childNodes[1].childNodes[1].src);
  }
});

function openImageModal(src) {
  document.getElementById("imgModal").src = src;
  modal.style.display = "block";
}

// Remove the zoom and the border of a card (if highlighted)
socket.on("understateCard", (id) => {
  understateCard(id);
});

function understateCard(id) {
  var card = document.getElementById("card-" + id);
  if (card == null) return;
  card.classList.remove("zoom-card-on-turn", "border", "border-3");
}

// Close opened cards
socket.on("closeCards", (data) => {
  [data[1], data[2]].forEach((id) => {
    var card = document.getElementById("card-" + id);
    if (card == null) return;

    card.classList.remove("flip");
    setTimeout(() => {
      card.childNodes[1].childNodes[1].src = "";
    }, 500);
    understateCard(id);
  });
});

// Activate endTurn-Button
socket.on("activateEndTurn", () => {
  document.getElementById("playButton").disabled = false;
});

// Disable endTurn-Button
socket.on("disableEndTurn", () => {
  document.getElementById("playButton").disabled = true;
});

socket.on("getWinner", (data) => {
  var playButton = document.getElementById("playButton");

  // Mark the winners in the scoreboard
  document.querySelectorAll("#playerList .player-row").forEach((row, index) => {
    var player = room && room.players[index];
    if (player && data.winners.includes(player.name)) {
      row.classList.add("fw-bold");
      row.firstChild.appendChild(icon("bi-trophy ps-2 text-warning", "Winner"));
    } else {
      row.classList.add("text-secondary");
    }
  });

  // Remove all highlights
  for (var i = 0; i < 66; i++) {
    document.getElementById(`cardcount-${i}`).innerText = data.cardCounter[i];
    understateCard(i);
  }

  // Change EndTurn-Button to Back to Lobby
  playButton.onclick = () => {
    window.location.href = "/lobby";
  };
  playButton.hidden = false;
  playButton.disabled = false;
  playButton.innerText = "Back to Lobby";
  document.getElementById("surrenderButton").disabled = true;

  // Reset storage
  sessionStorage.clear();
});

/* ---------- Chat ---------- */

function sendChatMessage() {
  var input = document.getElementById("chat-input");
  var message = input.value.trim();

  if (message == "") return;
  if (!socket.connected) {
    showChatError("Not connected - message not sent.");
    return;
  }

  // The message is shown when the server sends it back to everybody
  socket.emit("sendChatMessage", { message: message });
  input.value = "";
  input.focus();
}

socket.on("chatHistory", (messages) => {
  document.getElementById("chat-content").replaceChildren();
  messages.forEach(addChatMessage);
});

socket.on("chatMessage", (message) => {
  hideChatError();
  addChatMessage(message);
});

socket.on("chatError", (message) => {
  showChatError(message);
});

var chatErrorTimeout = null;

function showChatError(message) {
  var element = document.getElementById("chat-error");
  if (element == null) return;
  element.innerText = message;
  element.hidden = false;
  clearTimeout(chatErrorTimeout);
  chatErrorTimeout = setTimeout(hideChatError, 3000);
}

function hideChatError() {
  var element = document.getElementById("chat-error");
  if (element != null) element.hidden = true;
}

// Returns the link if the whole message is a link to an image (https only)
function getImageUrl(text) {
  if (!/^https:\/\/\S+\.(jpe?g|png|gif|webp)(\?\S*)?$/i.test(text)) return null;
  try {
    var url = new URL(text);
    return url.protocol == "https:" ? url.href : null;
  } catch (error) {
    return null;
  }
}

// Builds the message with DOM elements - no innerHTML, so nothing in a message can run as code
function addChatMessage(message) {
  var chat = document.getElementById("chat-content");
  if (chat == null) return;

  // Only scroll down if the user didn't scroll up to read older messages
  var atBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 40;

  var wrapper = document.createElement("div");

  if (message.type == "system") {
    wrapper.className = "system-message";
    wrapper.innerText = message.text;
  } else {
    var own = message.name == me.username;
    wrapper.className = "message " + (own ? "right-message" : "left-message");

    var bubble = document.createElement("p");

    var header = document.createElement("span");
    header.className = "chat-name";
    header.innerText = own ? "You" : message.name + (message.spectator ? " 👁" : "");
    var time = document.createElement("span");
    time.className = "chat-time fw-normal";
    time.innerText = new Date(message.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    header.appendChild(time);
    bubble.appendChild(header);

    var imageUrl = getImageUrl(message.text);
    if (imageUrl) {
      var image = document.createElement("img");
      image.className = "chat-image";
      image.src = imageUrl;
      image.alt = "Image from " + message.name;
      image.referrerPolicy = "no-referrer";
      image.addEventListener("click", () => openImageModal(imageUrl));
      // Show the link as text if the image can't be loaded
      image.addEventListener("error", () => image.replaceWith(document.createTextNode(message.text)));
      bubble.appendChild(image);
    } else {
      bubble.appendChild(document.createTextNode(message.text));
    }

    wrapper.appendChild(bubble);
  }

  chat.appendChild(wrapper);
  if (atBottom) {
    chat.scrollTop = chat.scrollHeight;
  }
}
