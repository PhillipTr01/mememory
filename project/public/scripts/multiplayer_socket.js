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

// Leaving the page (logo, menu, back button): disconnect right away, so the
// others see "Away" at once. Browsers can keep a page with an open connection
// in the back/forward cache; coming back reconnects (and rejoins).
window.addEventListener("pagehide", () => socket.disconnect());
window.addEventListener("pageshow", (event) => {
  if (event.persisted) socket.connect();
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
  showNotice("⚠️", "Something went wrong", message || "Please try again.");
});

socket.on("noGameFound", () => {
  sessionOver = true;
  showNotice("🚪", "Room not found", "This room doesn't exist anymore.");
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
  showNotice("👢", "Removed from the room", "The host removed you from this room.");
});

function showNotice(icon, title, text, actionLabel, action) {
  document.getElementById("noticeIcon").innerText = icon;
  document.getElementById("noticeTitle").innerText = title;
  document.getElementById("noticeText").innerText = text;
  // Extra action (e.g. "Play here"), the lobby button is always there
  var button = document.getElementById("noticeAction");
  button.hidden = actionLabel == null;
  button.innerText = actionLabel || "";
  button.onclick = action || null;
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
    document.getElementById("rematchButton").addEventListener("click", requestRematch);
    document.getElementById("resultRematchButton").addEventListener("click", requestRematch);

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

// Players who are away: when their time to come back runs out (local clock)
var awayUntil = {};
var awayTimer = null;

function awaySeconds(player) {
  var until = awayUntil[player.name];
  return until == null ? null : Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

function createAwayTag() {
  var tag = document.createElement("span");
  tag.className = "player-tag away";
  tag.title = "Left - can still come back";
  tag.innerText = "Away";
  return tag;
}

socket.on("roomState", (state) => {
  var previous = room;
  room = state;

  awayUntil = {};
  state.players.forEach((player) => {
    if (player.awayLeft != null) awayUntil[player.name] = Date.now() + player.awayLeft;
  });
  clearInterval(awayTimer);
  if (Object.keys(awayUntil).length > 0 && state.status != "waiting") {
    // Count down once a second
    awayTimer = setInterval(() => room && renderPlayerList(room, room), 1000);
  }

  // Speed round: yellow / orange accent color for the whole room
  document.body.classList.toggle("mode-speed", state.mode == "speed");
  // Power-up mode: room for the power-up bar under the board
  document.body.classList.toggle("mode-powerups", state.mode == "powerups");

  renderPlayerList(state, previous);
  renderWaitingRoom(state);
  renderTurn(state);
  renderGameActions(state);
  renderPowerups(state);

  var waiting = state.status == "waiting";
  document.getElementById("waitingRoom").hidden = !waiting;
  document.getElementById("board").hidden = waiting;

  var pairs = document.getElementById("pairsLeft");
  pairs.hidden = waiting;
  pairs.innerText = state.pairsLeft + " pairs left";

  // End turn is in the floating action bar (classic, power-ups); the speed round has none
  document.getElementById("playButton").hidden = true;
  updateTurnTimer(state);

  // My turn is over -> the End Turn button can't be used anymore
  if (!isMyTurn(state)) {
    document.getElementById("playButton").disabled = true;
  }

  document.getElementById("board").classList.toggle("locked", !isMyTurn(state));
  // The host can change after the game (the old host left)
  if (state.status == "finished") updateRematchButtons(state);
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
    item.dataset.name = player.name;
    // Power-up attacks: opponents can be picked as the target
    if (typeof targeting != "undefined" && targeting && targeting.player && player.active && player.name != me.username) {
      item.classList.add("targetable");
    }
    if (!player.active || player.left) item.classList.add("inactive");
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
    }

    // Ready mark in the waiting room
    if (state.status == "waiting" && player.name != state.host && player.ready) {
      name.appendChild(createIcon("bi-check-circle-fill player-ready", "Ready"));
    }

    // Host can kick players while waiting
    if (state.status == "waiting" && state.host == me.username && player.name != me.username) {
      name.appendChild(createKickButton(player.name, "player-kick"));
    }

    // Out of the game: "Left" or the surrender flag, "Away" while they can come back
    if (player.left) {
      name.appendChild(createLeftTag());
    } else if (!player.active) {
      name.appendChild(createSurrenderedTag());
    } else if (awaySeconds(player) != null) {
      name.appendChild(createAwayTag());
    }

    var sub = document.createElement("div");
    sub.className = "player-sub";
    sub.innerText = !player.active || player.left
      ? ""
      : awaySeconds(player) != null
        ? awaySeconds(player) + "s to come back"
        : !player.connected
          ? "reconnecting..."
          : "";
    info.append(name, sub);
    // Power-up mode: power-ups in the hand and running effects, in the line
    // under the name (hidden during the start animation, the reels show them)
    if (state.mode == "powerups" && state.status != "waiting" && state.status != "starting") {
      sub.classList.add("with-powers");
      sub.appendChild(createPowerupIcons(player));
    }

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

    // Small animation when the points changed: "+1" floats up
    var before = previous && previous.players.find((p) => p.name == player.name);
    if (before && before.points != player.points) {
      points.classList.add("bump");
      var delta = player.points - before.points;
      requestAnimationFrame(() => showPointsDelta(points, delta));
    }

    item.append(createAvatar(player.name, "", player.connected), info, points);
    list.appendChild(item);
  });

  var spectators = document.getElementById("spectatorInfo");
  spectators.hidden = state.spectators.length == 0;
  spectators.replaceChildren(createIcon("bi-eye me-1"), document.createTextNode(state.spectators.join(", ")));
}

// The board glows when it's my turn
function renderTurn(state) {
  document.getElementById("board").classList.toggle("my-turn", isMyTurn(state));
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
  badge.hidden = state.mode == "classic";
  badge.classList.toggle("powerups-badge", state.mode == "powerups");
  badge.replaceChildren(
    ...(state.mode == "powerups"
      ? [createIcon("bi-stars"), document.createTextNode(" Power-ups")]
      : [createIcon("bi-lightning-charge-fill"), document.createTextNode(` Speed round · ${state.turnTime / 1000}s`)]),
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

  // Max. players as a small stepper: [-] 4 [+]
  var lowest = Math.max(state.minPlayers, count);
  document.getElementById("maxPlayersValue").innerText = state.maxPlayers;
  document.getElementById("maxPlayersMinus").disabled = state.maxPlayers <= lowest;
  document.getElementById("maxPlayersPlus").disabled = state.maxPlayers >= state.maxPlayersLimit;

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
    offline.innerText = "Away";
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
  playStartAnimation(data.players, data.starter, data.duration, data.powerups);
});

function playStartAnimation(players, starter, duration, startPowerups) {
  // Power-up mode: the player reel is faster, the power-up reels follow
  var spin = startPowerups ? 2200 : Math.max(1200, duration - 1300);
  document.getElementById("startPowerups").hidden = true;
  document.getElementById("startWho").hidden = false;
  // Power-up mode: after the result, the power-up reels replace "Who starts?"
  if (startPowerups) setTimeout(() => playPowerupReels(startPowerups), spin + 1300);

  playStartReel({ players: players, starter: starter, duration: duration, spin: spin, myName: me.username });
  setTimeout(() => document.getElementById("confetti").replaceChildren(), duration + 200);
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
  // Power-up mode: choosing a card for Peek, Swap, ...
  if (handlePowerupTarget(id)) return;
  // Fog: my blurred cards can't be zoomed into
  if (isFogCard(id)) return;
  // Open cards are zoomed in right away, closed ones are turned by the server
  if (zoomCard(id)) return;
  socket.emit("openCard", id);
}

function emitEndTurn() {
  socket.emit("endTurn");
}

// Surrender (flag) and leave (door) next to "pairs left"
function renderGameActions(state) {
  var actions = document.getElementById("gameActions");
  var running = state.status == "playing" || state.status == "starting";
  var mine = getMyPlayer(state);
  var playing = running && mine != null && mine.active && !me.spectator;
  var key = [state.status, playing].join(":");
  if (actions.dataset.key == key) return; // nothing changed, no flicker
  actions.dataset.key = key;

  var buttons = [];
  if (playing) buttons.push(createIconButton("bi-flag-fill", "Surrender", "danger", surrender));
  if (state.status != "waiting") buttons.push(createIconButton("bi-box-arrow-left", "Leave", "", leaveGame));
  actions.replaceChildren(...buttons);
}

// Leaving a running game: the seat is kept for a while, like after a lost connection
function leaveGame() {
  var mine = room && getMyPlayer(room);
  var playing = room && (room.status == "playing" || room.status == "starting") && mine && mine.active && !me.spectator;
  if (!playing) {
    window.location.href = "/lobby";
    return;
  }
  confirmDialog({
    title: "Leave the game?",
    text: "You can rejoin from the lobby within " + room.rejoinSeconds + " seconds. After that, you are out of the game.",
    confirmLabel: "Leave",
    confirmIcon: "bi-box-arrow-left",
    danger: true,
  }).then((ok) => {
    if (ok) window.location.href = "/lobby";
  });
}

function surrender() {
  confirmDialog({
    title: "Surrender?",
    text: "You leave the game and it counts as a loss. You can keep watching the others.",
    cancelLabel: "Keep playing",
    confirmLabel: "Surrender",
    confirmIcon: "bi-flag-fill",
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
  // Power-ups: cards that moved fly to their new place
  if (typeof animateBoardMove == "function") animateBoardMove();
});

socket.on("turnCard", showCard);

function showCard(data) {
  var card = document.getElementById("card-" + data.id);
  if (card == null) return;
  setCardImage(card, data.src);
  // Opened for real (not only peeked); power-up pairs get a small badge
  card.classList.remove("peek");
  card.classList.toggle("power-card", data.power === true);
  fogCard(data.id);

  // Highlighting a card - It gets bigger and gets a border
  card.classList.add("flip", "border", "border-3", "zoom-card-on-turn");
}

function closeCard(id, instant) {
  var card = document.getElementById("card-" + id);
  if (card == null) return;

  card.classList.remove("flip");
  understateCard(id);
  // After the flip (0.6s, see play.css)
  clearCardImage(card, instant ? 0 : 600);
}

// If the card is already open, you can zoom in to read the meme
socket.on("zoomImage", (id) => {
  if (isFogCard(id)) return;
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
  [data[1], data[2], data[3]].forEach((id) => id != null && closeCard(id, false));
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

  // Rematch (only the host) or back to the lobby
  document.getElementById("playButton").hidden = true;
  document.getElementById("lobbyButton").hidden = false;
  updateRematchButtons(room);

  showResult(data.winners);
});

// Only the host can start a rematch, the other players see a note
function updateRematchButtons(state) {
  var finished = state != null && state.status == "finished";
  var isHost = finished && state.host == me.username;
  var isPlayer = finished && getMyPlayer(state) != null;
  document.getElementById("rematchButton").hidden = !isHost;
  document.getElementById("resultRematchButton").hidden = !isHost;
  document.getElementById("rematchHint").hidden = !isPlayer || isHost;
}

function requestRematch() {
  document.getElementById("rematchButton").disabled = true;
  document.getElementById("resultRematchButton").disabled = true;
  socket.emit("rematch");
}

// Rematch: back to the waiting room with a new board
socket.on("rematch", () => {
  sessionOver = false;
  sessionStorage.setItem("gameID", gameID);
  closeResult();
  document.getElementById("board").classList.remove("revealed");
  for (var i = 0; i < 66; i++) {
    closeCard(i, true);
    document.getElementById(`cardcount-${i}`).innerText = "";
  }
  document.getElementById("rematchHint").hidden = true;
  ["rematchButton", "resultRematchButton", "lobbyButton"].forEach((id) => {
    var element = document.getElementById(id);
    element.hidden = true;
    element.disabled = false;
  });
  document.querySelectorAll("#playerList .player-item.winner").forEach((item) => item.classList.remove("winner"));
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
    if (player.left) name.appendChild(createLeftTag());
    else if (!player.active) name.appendChild(createSurrenderedTag());
    var points = document.createElement("span");
    points.className = "points";
    points.innerText = player.points;

    item.append(rank, createAvatar(player.name, "sm"), name, points);
    list.appendChild(item);
  });

  document.getElementById("resultOverlay").hidden = false;
}

/* ---------- Chat (see chat.js) ---------- */

function chatUsername() {
  return me.username;
}

/* ---------- Speed round: turn timer ---------- */

var turnDeadline = null;
var turnTimerInterval = null;

var lastTimerLeft = null; // shown while the clock is stopped

function updateTurnTimer(state) {
  clearInterval(turnTimerInterval);
  var total = state.turnTime;

  var draw = (left) => {
    var fill = document.querySelector(".turn-timer span");
    var seconds = document.querySelector(".turn-seconds");
    if (fill) {
      fill.style.width = (left / total) * 100 + "%";
      fill.parentElement.classList.toggle("urgent", left <= 3000);
    }
    if (seconds) seconds.innerText = Math.ceil(left / 1000) + "s left";
  };

  // Clock stopped (two wrong cards): keep the bar where it was
  if (state.turnRemaining == null) {
    turnDeadline = null;
    if (state.mode == "speed" && state.status == "playing" && lastTimerLeft != null) {
      // Just stop: bar and seconds stay where they were
      draw(lastTimerLeft);
    }
    return;
  }

  // The clock starts after the card animations - until then the bar stays full
  var start = Date.now() + (state.turnStartsIn || 0);
  turnDeadline = start + state.turnRemaining;

  var tick = () => {
    var left = Math.min(total, Math.max(0, turnDeadline - Math.max(Date.now(), start)));
    lastTimerLeft = left;
    draw(left);
    if (left <= 0) clearInterval(turnTimerInterval);
  };
  tick();
  turnTimerInterval = setInterval(tick, 100);
}


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

document.addEventListener("DOMContentLoaded", () => {
  var change = (delta) => {
    if (room) socket.emit("updateSettings", { maxPlayers: room.maxPlayers + delta });
  };
  document.getElementById("maxPlayersMinus").addEventListener("click", () => change(-1));
  document.getElementById("maxPlayersPlus").addEventListener("click", () => change(1));
});
