const socket = io("/multiplayer");

var modal;
var backImage = "/static/images/logo_small.png";

// Own name and role, sent by the server after joining
var me = { username: null, spectator: false };
// Last state of the room (players, host, turn, settings)
var room = null;
// Set when the session ended on purpose (game over, kicked, other tab) -> don't rejoin
var sessionOver = false;

// The room can come from an invite link (/play?game=ID) or from the lobby
var urlParams = new URLSearchParams(window.location.search);
var urlGameID = urlParams.get("game");
// "Watch" in the lobby: join as spectator even if there is a free seat
var watchOnly = urlParams.get("watch") == "1";
if (urlGameID) {
  sessionStorage.setItem("gameID", urlGameID);
}
var gameID = sessionStorage.getItem("gameID");

if (!gameID) {
  window.location.href = "/lobby";
} else if (urlGameID !== gameID) {
  // Keep the room in the URL, so reloading or sharing the page works
  history.replaceState(null, "", "/play?game=" + encodeURIComponent(gameID) + (watchOnly ? "&watch=1" : ""));
}

/* ---------- Connection & rejoin ---------- */

// (Re)join the room on every (re)connect - the server keeps the seat for a while
socket.on("connect", () => {
  document.getElementById("connectionBanner").hidden = true;
  if (!sessionOver) {
    socket.emit("joinRoom", { gameID: gameID, watch: watchOnly });
  }
});

socket.on("disconnect", (reason) => {
  // "io server disconnect" = we were removed on purpose, socket.io doesn't reconnect then
  if (!sessionOver && reason != "io server disconnect") {
    document.getElementById("connectionBanner").hidden = false;
  }
});

socket.on("connect_error", (error) => {
  // Not logged in (anymore)
  if (error && error.message == "unauthorized") {
    window.location.href = "/";
  }
});

// Something went wrong on the server (e.g. not enough memes) -> back to the lobby
socket.on("gameError", (message) => {
  showNotice("⚠️", "Something went wrong", message || "Please try again.", "Back to lobby", () => {
    window.location.href = "/lobby";
  });
});

socket.on("noGameFound", () => {
  sessionOver = true;
  showNotice("🚪", "Room not found", "This room doesn't exist anymore.", "Back to lobby", () => {
    window.location.href = "/lobby";
  });
});

// The room was opened in another tab
socket.on("sessionReplaced", () => {
  sessionOver = true;
  showNotice("📑", "Opened in another tab", "You are playing in another tab or window now.", "Play here", () => {
    window.location.reload();
  });
});

socket.on("kicked", () => {
  sessionOver = true;
  showNotice("👢", "Removed from the room", "The host removed you from this room.", "Back to lobby", () => {
    window.location.href = "/lobby";
  });
});

function showNotice(icon, title, text, actionLabel, action) {
  document.getElementById("noticeIcon").innerText = icon;
  document.getElementById("noticeTitle").innerText = title;
  document.getElementById("noticeText").innerText = text;
  var button = document.getElementById("noticeAction");
  button.innerText = actionLabel;
  button.onclick = action;
  document.getElementById("connectionBanner").hidden = true;
  document.getElementById("noticeOverlay").hidden = false;
}

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
                                <img class="card-image" alt="">
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
    document.getElementById("leaveButton").addEventListener("click", leaveRoom);
    document.getElementById("publicSwitch").addEventListener("change", (e) => {
      socket.emit("updateSettings", { isPublic: e.target.checked });
    });
    document.getElementById("resultBoardButton").addEventListener("click", closeResult);

    // The result must not block the board: a click next to it closes it,
    // and if there is a card under the click, its meme is opened right away
    document.getElementById("resultOverlay").addEventListener("click", (event) => {
      if (event.target.id != "resultOverlay") return;
      closeResult();
      var below = document.elementFromPoint(event.clientX, event.clientY);
      var card = below && below.closest(".card");
      if (card) zoomCard(Number(card.id.replace("card-", "")));
    });
    document.addEventListener("keydown", (event) => {
      if (event.key == "Escape") closeResult();
    });

    setupChat();
  },
  false,
);

function leaveRoom() {
  sessionOver = true;
  socket.emit("leaveRoom");
  window.location.href = "/lobby";
}

/* ---------- Room state ---------- */

socket.on("joinedRoom", (data) => {
  me = data;

  // Spectators (and players who surrendered) can't surrender
  if (room) renderPlayerList(room, room);
});

socket.on("roomState", (state) => {
  var previous = room;
  room = state;

  renderPlayerList(state, previous);
  renderWaitingRoom(state);
  renderTurn(state, previous);

  var waiting = state.status == "waiting";
  document.getElementById("waitingRoom").hidden = !waiting;
  document.getElementById("board").hidden = waiting;

  var pairs = document.getElementById("pairsLeft");
  pairs.hidden = waiting;
  pairs.innerText = state.pairsLeft + " pairs left";

  var player = getMyPlayer(state);
  var inGame = (state.status == "playing" || state.status == "starting") && player != null && player.active;
  // Speed round: the turn passes on its own after two wrong cards
  document.getElementById("playButton").hidden = !inGame || state.mode == "speed";
  updateTurnTimer(state);

  // My turn is over -> the End Turn button can't be used anymore
  if (!isMyTurn(state)) {
    document.getElementById("playButton").disabled = true;
  }

  document.getElementById("board").classList.toggle("locked", !isMyTurn(state));

  var online = state.players.filter((p) => p.connected).length + state.spectators.length;
  document.getElementById("onlineCount").innerText = online + " online";
});

function getMyPlayer(state) {
  return state.players.find((player) => player.name == me.username) || null;
}

function isMyTurn(state) {
  var player = state.players[state.turn];
  return state.status == "playing" && player != null && player.name == me.username;
}

// Scoreboard on the right: one entry per player, no fixed number of rows
function renderPlayerList(state, previous) {
  var list = document.getElementById("playerList");
  list.replaceChildren();

  state.players.forEach((player, index) => {
    var item = document.createElement("div");
    item.className = "player-item";
    if (!player.active) item.classList.add("inactive");
    if (state.status == "playing" && state.turn == index && player.active) item.classList.add("turn");

    var info = document.createElement("div");
    info.className = "player-info";
    var name = document.createElement("div");
    name.className = "player-name";
    var nameText = document.createElement("span");
    nameText.className = "player-name-text";
    nameText.innerText = player.name;
    name.appendChild(nameText);

    // Host: star, own entry: small "You" tag
    if (player.name == state.host) {
      name.appendChild(createIcon("bi-star-fill player-host", "Host"));
    }
    if (player.name == me.username) {
      var you = document.createElement("span");
      you.className = "player-tag";
      you.innerText = "You";
      name.appendChild(you);

      // Surrender right next to the own name while playing
      var playing = state.status == "playing" || state.status == "starting";
      if (playing && player.active && !me.spectator) {
        name.appendChild(createSurrenderButton());
      }
    }

    // Ready mark in the waiting room
    if (state.status == "waiting" && player.name != state.host && player.ready) {
      name.appendChild(createIcon("bi-check-circle-fill player-ready", "Ready"));
    }

    // Host can kick players while waiting
    if (state.status == "waiting" && state.host == me.username && player.name != me.username) {
      name.appendChild(createKickButton(player.name, "player-kick"));
    }

    // Out of the game: tag with a flag instead of a text
    if (!player.active) {
      name.appendChild(createSurrenderedTag());
    }

    var sub = document.createElement("div");
    sub.className = "player-sub";
    sub.innerText = !player.active
      ? ""
      : !player.connected
        ? "reconnecting..."
        : state.status == "playing" && state.turn == index
          ? "is playing"
          : "";
    info.append(name, sub);

    // Speed round: time left for the player whose turn it is
    if (state.mode == "speed" && state.status == "playing" && state.turn == index) {
      item.classList.add("timed");
      var bar = document.createElement("div");
      bar.className = "turn-timer";
      bar.appendChild(document.createElement("span"));
      item.appendChild(bar);
      sub.classList.add("turn-seconds");
    }

    var points = document.createElement("div");
    points.className = "player-points";
    points.innerText = player.points;

    // Small animation when a player scored
    var before = previous && previous.players.find((p) => p.name == player.name);
    if (before && before.points < player.points) {
      points.classList.add("bump");
    }

    item.append(createAvatar(player.name, "", player.connected), info, points);
    list.appendChild(item);
  });

  var spectators = document.getElementById("spectatorInfo");
  spectators.hidden = state.spectators.length == 0;
  spectators.replaceChildren(createIcon("bi-eye me-1"), document.createTextNode(state.spectators.join(", ")));
}

// The board glows when it's my turn, plus a short hint when the turn changes to me
function renderTurn(state, previous) {
  var mine = isMyTurn(state);
  document.getElementById("board").classList.toggle("my-turn", mine);

  if (mine && (previous == null || !isMyTurn(previous))) {
    showToast("Your turn");
  }
}

function renderWaitingRoom(state) {
  var isHost = state.host == me.username;
  var count = state.players.length;

  document.getElementById("playerCount").innerText = `${count} / ${state.maxPlayers}`;

  var waitingText = document.getElementById("waitingText");
  waitingText.classList.remove("waiting-dots");
  waitingText.innerText = isHost
    ? "Invite your friends and start when everybody is ready."
    : me.spectator
      ? "You are watching this game."
      : "Press \"I'm ready\" when you want to play.";

  // Mode badge for everybody
  var badge = document.getElementById("modeBadge");
  badge.hidden = state.mode != "speed";
  badge.replaceChildren(
    createIcon("bi-lightning-charge-fill"),
    document.createTextNode(` Speed round · ${state.turnTime / 1000}s`),
  );

  // Seats: players + free seats. Only redrawn when something about the seats
  // changed - otherwise e.g. switching the mode would make them flicker.
  var seatsKey = JSON.stringify([
    state.maxPlayers,
    state.host,
    me.username,
    state.players.map((p) => [p.name, p.connected, p.ready]),
  ]);
  var seats = document.getElementById("waitingPlayers");
  if (seats.dataset.key != seatsKey) {
    seats.dataset.key = seatsKey;
    seats.replaceChildren();
    for (var i = 0; i < state.maxPlayers; i++) {
      seats.appendChild(createSeat(state, state.players[i], isHost));
    }
  }

  // Host settings
  document.getElementById("hostSettings").hidden = !isHost;
  var startButton = document.getElementById("startButton");
  startButton.hidden = !isHost;

  // Ready button for everybody except the host
  var mine = getMyPlayer(state);
  var readyButton = document.getElementById("readyButton");
  readyButton.hidden = isHost || mine == null || me.spectator;
  if (mine != null) {
    readyButton.classList.toggle("is-ready", mine.ready);
    readyButton.replaceChildren(
      createIcon(mine.ready ? "bi-check-circle-fill" : "bi-circle"),
      document.createTextNode(mine.ready ? " Ready" : " I'm ready"),
    );
  }

  // The host can start when enough players are there and all of them are ready
  var connected = state.players.filter((p) => p.connected);
  var notReady = connected.filter((p) => p.name != state.host && !p.ready);
  var canStart = connected.length >= state.minPlayers && notReady.length == 0;
  startButton.disabled = !canStart;
  document.getElementById("startHint").innerText =
    connected.length < state.minPlayers
      ? `At least ${state.minPlayers} players are needed to start.`
      : notReady.length > 0
        ? `Waiting for ${notReady.map((p) => p.name).join(", ")} to be ready`
        : isHost
          ? "Everybody is ready!"
          : `Waiting for ${state.host} to start the game`;

  if (!isHost) return;

  // Max. players as buttons
  var picker = document.getElementById("maxPlayersPicker");
  picker.replaceChildren();
  for (var n = state.minPlayers; n <= state.maxPlayersLimit; n++) {
    var button = document.createElement("button");
    button.type = "button";
    button.innerText = n;
    button.disabled = n < count;
    button.classList.toggle("active", n == state.maxPlayers);
    button.addEventListener("click", ((value) => () => socket.emit("updateSettings", { maxPlayers: value }))(n));
    picker.appendChild(button);
  }

  document.getElementById("publicSwitch").checked = state.isPublic;

  document.querySelectorAll("#modePicker button").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode == state.mode);
  });

  // Seconds per turn (only in the speed round)
  var timePicker = document.getElementById("turnTimePicker");
  document.getElementById("turnTimeSetting").hidden = state.mode != "speed";
  timePicker.replaceChildren();
  (state.turnTimeOptions || []).forEach((seconds) => {
    var button = document.createElement("button");
    button.type = "button";
    button.innerText = seconds + "s";
    button.classList.toggle("active", seconds * 1000 == state.turnTime);
    button.addEventListener("click", () => socket.emit("updateSettings", { turnTime: seconds }));
    timePicker.appendChild(button);
  });
}

function createSeat(state, player, isHost) {
  var seat = document.createElement("div");
  seat.className = "seat";

  if (!player) {
    seat.classList.add("empty");
    seat.append(createIcon("bi-person-plus"), document.createTextNode("Free seat"));
    return seat;
  }

  if (player.name == me.username) seat.classList.add("me");
  if (!player.connected) seat.classList.add("offline");

  var name = document.createElement("div");
  name.className = "seat-name";
  name.innerText = player.name;

  var tags = document.createElement("div");
  tags.className = "seat-tags";
  if (player.name == state.host) {
    var host = document.createElement("span");
    host.className = "mm-badge host";
    host.append(createIcon("bi-star-fill"), document.createTextNode("Host"));
    tags.appendChild(host);
  }
  if (player.name == me.username) {
    var you = document.createElement("span");
    you.className = "mm-badge";
    you.innerText = "You";
    tags.appendChild(you);
  }
  if (player.name != state.host && player.connected) {
    var ready = document.createElement("span");
    ready.className = "mm-badge " + (player.ready ? "ready" : "not-ready");
    ready.append(createIcon(player.ready ? "bi-check2" : "bi-hourglass-split"), document.createTextNode(player.ready ? "Ready" : "Not ready"));
    tags.appendChild(ready);
  }
  if (!player.connected) {
    var offline = document.createElement("span");
    offline.className = "mm-badge playing";
    offline.innerText = "Reconnecting";
    tags.appendChild(offline);
  }

  seat.append(createAvatar(player.name, "lg", player.connected), name, tags);

  // The host can remove other players
  if (isHost && player.name != me.username) {
    seat.appendChild(createKickButton(player.name, "seat-kick"));
  }

  return seat;
}

// Button for the host to remove a player from the waiting room
function createKickButton(name, className) {
  var kick = document.createElement("button");
  kick.type = "button";
  kick.className = className;
  kick.title = "Remove " + name + " from the room";
  kick.setAttribute("aria-label", "Kick " + name);
  kick.appendChild(createIcon("bi-x"));
  kick.addEventListener("click", (event) => {
    event.stopPropagation();
    confirmDialog({
      title: `Remove ${name}?`,
      text: "The player can still watch, but can't take a seat in this room again.",
      confirmLabel: "Remove",
      danger: true,
    }).then((ok) => {
      if (ok) socket.emit("kickPlayer", { name: name });
    });
  });
  return kick;
}

/* ---------- "Who starts?" animation ---------- */

socket.on("gameStarting", (data) => {
  playStartAnimation(data.players, data.starter, data.duration);
});

function playStartAnimation(players, starter, duration) {
  var overlay = document.getElementById("startOverlay");
  var track = document.getElementById("reelTrack");
  var result = document.getElementById("startResult");
  var reel = track.parentElement;
  var itemHeight = parseFloat(getComputedStyle(reel).getPropertyValue("--item")) || 72;

  // Long list of names, the winner is the last one -> spinning slot machine
  var rounds = Math.max(4, Math.ceil(24 / players.length));
  var names = [];
  for (var r = 0; r < rounds; r++) names.push(...players);
  names.push(...players.slice(0, starter + 1));
  names.push(players[(starter + 1) % players.length]); // one more below the marker

  track.replaceChildren();
  names.forEach((name) => {
    var item = document.createElement("div");
    item.className = "reel-item";
    item.append(createAvatar(name), document.createTextNode(name));
    track.appendChild(item);
  });

  var target = names.length - 2; // the starter
  var spin = Math.max(1200, duration - 1300);

  result.classList.remove("show");
  result.innerText = "";
  track.style.transition = "none";
  track.style.transform = "translateY(0)";
  overlay.hidden = false;

  // Start the spin in the next frame so the transition is applied
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      track.style.transition = `transform ${spin}ms cubic-bezier(0.12, 0.75, 0.18, 1)`;
      // The marker is the second row of the reel
      track.style.transform = `translateY(${-(target - 1) * itemHeight}px)`;
    }),
  );

  setTimeout(() => {
    track.children[target].classList.add("chosen");
    var name = players[starter];
    result.innerText = name == me.username ? "You start" : `${name} starts`;
    result.classList.add("show");
  }, spin);

  setTimeout(() => {
    overlay.hidden = true;
    document.getElementById("confetti").replaceChildren();
  }, duration + 200);
}

function launchConfetti() {
  var container = document.getElementById("confetti");
  var colors = ["#48b0f7", "#8b5cf6", "#34d399", "#fbbf24", "#f87171", "#f472b6"];
  container.replaceChildren();

  for (var i = 0; i < 90; i++) {
    var piece = document.createElement("i");
    piece.style.left = Math.random() * 100 + "%";
    piece.style.background = colors[i % colors.length];
    piece.style.animationDuration = 1.4 + Math.random() * 1.4 + "s";
    piece.style.animationDelay = Math.random() * 0.3 + "s";
    piece.style.setProperty("--dx", (Math.random() - 0.5) * 300 + "px");
    piece.style.setProperty("--rot", Math.random() * 720 + "deg");
    container.appendChild(piece);
  }
}

/* ---------- Game ---------- */

function startGame() {
  document.getElementById("startButton").disabled = true;
  socket.emit("startGame");
}

function openCard(id) {
  // Open cards are zoomed in right away, closed ones are turned by the server
  if (zoomCard(id)) return;
  socket.emit("openCard", id);
}

function emitEndTurn() {
  socket.emit("endTurn");
}

function surrender() {
  confirmDialog({
    title: "Surrender?",
    text: "You leave the game and it counts as a loss. You can keep watching the others.",
    cancelLabel: "Keep playing",
    confirmLabel: "Surrender",
    danger: true,
  }).then((ok) => {
    if (ok) socket.emit("surrender");
  });
}

// Cards that are already open when (re)joining
socket.on("boardState", (data) => {
  for (var i = 0; i < 66; i++) {
    closeCard(i, true);
  }
  data.found.forEach((card) => {
    showCard(card);
    understateCard(card.id);
  });
  data.opened.forEach(showCard);
});

socket.on("turnCard", showCard);

function showCard(data) {
  var card = document.getElementById("card-" + data.id);
  if (card == null) return;
  setCardImage(card, data.src);

  // Highlighting a card - It gets bigger and gets a border
  card.classList.add("flip", "border", "border-3", "zoom-card-on-turn");
}

function closeCard(id, instant) {
  var card = document.getElementById("card-" + id);
  if (card == null) return;

  card.classList.remove("flip");
  understateCard(id);
  clearCardImage(card, instant ? 0 : 900);
}

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
  [data[1], data[2]].forEach((id) => closeCard(id, false));
});

socket.on("matchFound", (data) => {
  if (data.name == me.username) {
    showToast("Pair found");
  }
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
  sessionOver = true;

  // All cards are shown normally now (found pairs are not dimmed anymore)
  document.getElementById("board").classList.add("revealed");

  // Remove all highlights, show how often each card was opened
  for (var i = 0; i < 66; i++) {
    document.getElementById(`cardcount-${i}`).innerText = data.cardCounter[i];
    understateCard(i);
  }

  document.querySelectorAll("#playerList .player-item").forEach((item, index) => {
    var player = room && room.players[index];
    if (player && data.winners.includes(player.name)) {
      item.classList.add("winner");
    }
  });

  var playButton = document.getElementById("playButton");
  playButton.onclick = () => {
    window.location.href = "/lobby";
  };
  playButton.hidden = false;
  playButton.disabled = false;
  playButton.innerText = "Back to Lobby";

  showResult(data.winners);

  // Reset storage
  sessionStorage.clear();
});

function closeResult() {
  document.getElementById("resultOverlay").hidden = true;
}

function showResult(winners) {
  var won = winners.includes(me.username);
  document.getElementById("resultOverlay").classList.toggle("lost", !won);
  document.getElementById("resultTitle").innerText =
    winners.length > 1 ? "It's a draw!" : won ? "You win!" : `${winners[0]} wins!`;

  var list = document.getElementById("resultList");
  list.replaceChildren();
  // Winners first, then by points, players who left at the end
  var score = (p) => (winners.includes(p.name) ? 1e6 : 0) + (p.active ? 1e3 : 0) + p.points;
  var ranking = (room ? room.players : []).slice().sort((a, b) => score(b) - score(a));
  ranking.forEach((player, index) => {
    var item = document.createElement("li");
    if (winners.includes(player.name)) item.classList.add("winner");

    var rank = document.createElement("span");
    rank.className = "rank";
    rank.innerText = index + 1 + ".";
    var name = document.createElement("span");
    name.className = "name";
    var nameText = document.createElement("span");
    nameText.className = "player-name-text";
    nameText.innerText = player.name;
    name.appendChild(nameText);
    if (!player.active) name.appendChild(createSurrenderedTag());
    var points = document.createElement("span");
    points.className = "points";
    points.innerText = player.points;

    item.append(rank, createAvatar(player.name, "sm"), name, points);
    list.appendChild(item);
  });

  document.getElementById("resultOverlay").hidden = false;
}

/* ---------- Chat ---------- */

var lastMessage = null; // for grouping messages of the same person

function setupChat() {
  var form = document.getElementById("chat-form");
  var input = document.getElementById("chat-input");
  var send = document.getElementById("send-message-btn");
  var counter = document.getElementById("chat-counter");
  var chat = document.getElementById("chat-content");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    sendChatMessage();
  });

  input.addEventListener("input", () => {
    var length = input.value.length;
    send.disabled = input.value.trim() == "";
    counter.hidden = length < 250;
    counter.innerText = 300 - length;
    counter.classList.toggle("limit", length >= 290);
  });

  // Quick emojis are added to the message
  document.querySelectorAll(".chat-quick button").forEach((button) => {
    button.addEventListener("click", () => {
      var emoji = button.dataset.emoji;
      var start = input.selectionStart != null ? input.selectionStart : input.value.length;
      input.value = (input.value.slice(0, start) + emoji + input.value.slice(input.selectionEnd || start)).slice(0, 300);
      input.dispatchEvent(new Event("input"));
      input.focus();
    });
  });

  chat.addEventListener("scroll", () => {
    if (isChatAtBottom()) document.getElementById("newMessages").hidden = true;
  });

  document.getElementById("newMessages").addEventListener("click", () => {
    chat.scrollTop = chat.scrollHeight;
  });
}

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
  input.dispatchEvent(new Event("input"));
  input.focus();
}

socket.on("chatHistory", (messages) => {
  document.getElementById("chat-content").replaceChildren();
  lastMessage = null;
  messages.forEach((message) => addChatMessage(message, false));
  scrollChatDown();
});

socket.on("chatMessage", (message) => {
  hideChatError();
  addChatMessage(message, true);
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

function isChatAtBottom() {
  var chat = document.getElementById("chat-content");
  return chat.scrollHeight - chat.scrollTop - chat.clientHeight < 40;
}

function scrollChatDown() {
  var chat = document.getElementById("chat-content");
  chat.scrollTop = chat.scrollHeight;
  document.getElementById("newMessages").hidden = true;
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

// Only 1-3 emojis (no text) -> shown big. Longer emoji rows stay in a normal bubble.
function isJumboEmoji(text) {
  try {
    var compact = text.replace(/\s+/g, "");
    if (!/^(\p{Extended_Pictographic}|\p{Emoji_Component}|\u200d|\ufe0f)+$/u.test(compact)) return false;
    if (!/\p{Extended_Pictographic}/u.test(compact)) return false;

    var count = window.Intl && Intl.Segmenter
      ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(compact)].length
      : (compact.match(/\p{Extended_Pictographic}/gu) || []).length;
    return count <= 3;
  } catch (error) {
    return false;
  }
}

var SYSTEM_ICONS = {
  join: "bi-person-plus",
  timer: "bi-stopwatch",
  leave: "bi-box-arrow-left",
  watch: "bi-eye",
  host: "bi-star-fill",
  start: "bi-flag-fill",
  trophy: "bi-trophy-fill",
  disconnect: "bi-wifi-off",
  reconnect: "bi-wifi",
  info: "bi-info-circle",
};

// Builds the message with DOM elements - no innerHTML, so nothing in a message can run as code
function addChatMessage(message, live) {
  var chat = document.getElementById("chat-content");
  if (chat == null) return;
  document.getElementById("chat-empty").hidden = true;

  var atBottom = isChatAtBottom();
  var element;

  if (message.type == "system") {
    element = document.createElement("div");
    element.className = "sys-msg " + (message.icon || "info");
    element.append(createIcon(SYSTEM_ICONS[message.icon] || SYSTEM_ICONS.info), document.createTextNode(message.text));
    lastMessage = null;
  } else {
    var own = message.name == me.username;
    // Messages of the same person within 2 minutes are grouped
    var grouped = lastMessage != null && lastMessage.name == message.name && message.time - lastMessage.time < 120000;

    element = document.createElement("div");
    element.className = "msg" + (own ? " own" : "") + (grouped ? " grouped" : "");

    var avatarSlot = document.createElement("div");
    avatarSlot.className = "avatar-slot";
    avatarSlot.appendChild(createAvatar(message.name, "sm"));

    var body = document.createElement("div");
    body.className = "msg-body";

    var meta = document.createElement("div");
    meta.className = "msg-meta";
    var name = document.createElement("span");
    name.className = "msg-name";
    name.style.color = own ? "var(--mm-accent)" : avatarColor(message.name);
    name.innerText = own ? "You" : message.name;
    if (message.spectator) name.appendChild(createIcon("bi-eye ms-1", "Spectator"));
    var time = document.createElement("span");
    time.className = "msg-time";
    time.innerText = new Date(message.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    meta.append(name, time);

    var bubble = document.createElement("div");
    bubble.className = "msg-bubble";
    bubble.title = time.innerText;

    var imageUrl = getImageUrl(message.text);
    if (imageUrl) {
      bubble.classList.add("has-image");
      var image = document.createElement("img");
      image.className = "chat-image";
      image.src = imageUrl;
      image.alt = "Image from " + message.name;
      image.referrerPolicy = "no-referrer";
      image.addEventListener("click", () => openImageModal(imageUrl));
      // Show the link as text if the image can't be loaded
      image.addEventListener("error", () => {
        bubble.classList.remove("has-image");
        image.replaceWith(document.createTextNode(message.text));
      });
      image.addEventListener("load", () => {
        if (atBottom) scrollChatDown();
      });
      bubble.appendChild(image);
    } else {
      if (isJumboEmoji(message.text)) bubble.classList.add("jumbo");
      bubble.appendChild(document.createTextNode(message.text));
    }

    body.append(meta, bubble);
    element.append(avatarSlot, body);
    lastMessage = message;
  }

  chat.appendChild(element);

  // Only scroll down if the user didn't scroll up to read older messages
  if (!live || atBottom || message.name == me.username) {
    scrollChatDown();
  } else {
    document.getElementById("newMessages").hidden = false;
  }
}

/* ---------- Speed round: turn timer ---------- */

var turnDeadline = null;
var turnTimerInterval = null;

function updateTurnTimer(state) {
  clearInterval(turnTimerInterval);
  turnDeadline = state.turnRemaining != null ? Date.now() + state.turnRemaining : null;
  if (turnDeadline == null) return;

  var total = state.turnTime;
  var tick = () => {
    var left = Math.max(0, turnDeadline - Date.now());
    var fill = document.querySelector(".turn-timer span");
    var seconds = document.querySelector(".turn-seconds");
    if (fill) {
      fill.style.width = (left / total) * 100 + "%";
      fill.parentElement.classList.toggle("urgent", left <= 3000);
    }
    if (seconds) seconds.innerText = Math.ceil(left / 1000) + "s left";
    if (left <= 0) clearInterval(turnTimerInterval);
  };
  tick();
  turnTimerInterval = setInterval(tick, 100);
}

socket.on("turnTimeout", (data) => {
  if (data.name == me.username) showToast("Time's up!");
});

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("#modePicker button").forEach((button) => {
    button.addEventListener("click", () => socket.emit("updateSettings", { mode: button.dataset.mode }));
  });
});

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("readyButton").addEventListener("click", () => {
    var mine = room && getMyPlayer(room);
    if (mine) socket.emit("setReady", { ready: !mine.ready });
  });
});
