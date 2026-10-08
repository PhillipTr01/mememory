const socket = io("/singleplayer");

var modal;
var game;
var backImage = "/static/images/logo_small.png";

var gameOver = false;

// Same notice as in the multiplayer (instead of the browser's alert)
function showNotice(title, text) {
  document.getElementById("noticeTitle").innerText = title;
  document.getElementById("noticeText").innerText = text;
  document.getElementById("startOverlay").hidden = true;
  document.getElementById("noticeOverlay").hidden = false;
}

// Something went wrong on the server (e.g. not enough memes)
socket.on("gameError", (message) => {
  sessionOver = true;
  showNotice("Something went wrong", message || "Please try again.");
});

var sessionOver = false; // other tab, error: don't come back

// Reload or lost connection: the game pauses on the server and goes on
// when the page is back (within the rejoin time, like in the multiplayer)
socket.on("disconnect", () => {
  if (!sessionOver) document.getElementById("connectionBanner").hidden = false;
});

socket.on("connect", () => {
  document.getElementById("connectionBanner").hidden = true;
  if (!sessionOver) socket.emit("initializingGame", { gameID: sessionStorage.getItem("gameID") });
});

// Leaving the page (logo, menu, back button): disconnect right away.
// Coming back with the back button reconnects.
window.addEventListener("pagehide", () => socket.disconnect());
window.addEventListener("pageshow", (event) => {
  if (event.persisted) socket.connect();
});

socket.on("sessionReplaced", () => {
  sessionOver = true;
  showNotice("Opened in another tab", "You are playing in another tab or window now.");
});

// Back in the game after a reload / lost connection: the whole board again
socket.on("resumeGame", (data) => {
  document.getElementById("startOverlay").hidden = true;
  document.getElementById("resultOverlay").hidden = true;
  document.getElementById("board").classList.remove("revealed");
  for (var i = 0; i < 66; i++) {
    var card = document.getElementById("card-" + i);
    card.classList.remove("flip");
    understateCard(i);
    clearCardImage(card, 0);
    document.getElementById(`cardcount-${i}`).innerText = "";
  }
  data.found.forEach((item) => {
    var card = document.getElementById("card-" + item.id);
    setCardImage(card, item.src);
    card.classList.add("flip");
  });
  document.getElementById("user1Score").innerText = data.points[0];
  document.getElementById("user2Score").innerText = data.points[1];
  document.getElementById("pairsLeft").innerText = 33 - data.points[0] - data.points[1] + " pairs left";
  ["user1Item", "user2Item"].forEach((id) => document.getElementById(id).classList.remove("winner", "inactive"));
  gameOver = data.finished;
  renderGameActions(!data.finished);
});

socket.on("connect_error", (error) => {
  // Not logged in (anymore)
  if (error && error.message == "unauthorized") {
    window.location.href = "/?next=" + encodeURIComponent(location.pathname + location.search);
  }
});

document.addEventListener(
  "DOMContentLoaded",
  function () {
    // Fill board with cards
    var board = document.getElementById("memoryTable");
    board.innerHTML = "";
    for (var index = 0; index < 66; index++) {
      var div = ` <div class="card-size">
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
  },
  false,
);

// Initialize Game - the server picks the memes
// (the game is joined in "connect", also after a reload)

var BOT_AVATARS = {
  "Easy Bot": "easy",
  "Medium Bot": "medium",
  "Hard Bot": "hard",
  "Expert Bot": "expert",
};

// Own name + avatar in the player panel
userPromise.then((username) => {
  if (!username) return;
  document.getElementById("user1Username").innerText = username;
  document.getElementById("user1Avatar").replaceWith(createAvatar(username));
});

// Set computername on the scoreboard
socket.on("setComputername", (name) => {
  document.getElementById("user2Username").innerText = name;
  document.getElementById("botAvatar").src =
    "/static/images/avatar_" + (BOT_AVATARS[name] || "easy") + "_200.png";
});

// "Who starts?" - the same reel as in the multiplayer and Tic Tac Toe
socket.on("gameStarting", (data) => {
  var bot = data.players[1];
  playStartReel({
    players: data.players,
    starter: data.starter,
    duration: data.duration,
    myName: data.players[0],
    avatar: (name) => {
      if (name != bot) return createAvatar(name);
      var image = document.createElement("img");
      image.className = "bot-avatar-small";
      image.src = "/static/images/avatar_" + (BOT_AVATARS[name] || "easy") + "_200.png";
      image.alt = "";
      return image;
    },
  });
});

// Show which player's turn it is
socket.on("highlightPlayer", (data) => {
  document.getElementById("user1Username").innerText = data.user;
  document.getElementById("user2Username").innerText = data.computer;
  document.getElementById("user1Item").classList.toggle("turn", data.turn == 0);
  document.getElementById("user2Item").classList.toggle("turn", data.turn == 1);
  document.getElementById("board").classList.toggle("my-turn", data.turn == 0);
});

socket.on("noGameFound", () => {
  sessionOver = true;
  window.location.href = "/lobby";
});

function openCard(id) {
  // Open cards are zoomed in right away, closed ones are turned by the server
  if (zoomCard(id)) return;
  socket.emit("openCard", id);
}

socket.on("turnCard", (data) => {
  var card = document.getElementById("card-" + data.id);
  if (card == null) return;
  setCardImage(card, data.src);
  card.classList.add("flip");

  // Highlighting a card - It gets bigger and gets a border
  document.getElementById("card-" + data.id).classList.add("border");
  document.getElementById("card-" + data.id).classList.add("border-3");
  document.getElementById("card-" + data.id).classList.add("zoom-card-on-turn");
});

// If the card is already open, you can zoom in to read the meme
socket.on("zoomImage", (id) => {
  var src = document.getElementById("card-" + id).childNodes[1].childNodes[1]
    .src;
  document.getElementById("imgModal").src = src;
  modal.style.display = "block";
});

// Increase Points if a match was found
socket.on("increasePoints", (data) => {
  var score = document.getElementById(data.turn == 0 ? "user1Score" : "user2Score");
  var delta = data.points - Number(score.innerText);
  score.innerText = data.points;
  if (delta != 0) showPointsDelta(score, delta);
  score.classList.remove("bump");
  void score.offsetWidth; // restart the animation
  score.classList.add("bump");

  var found = Number(document.getElementById("user1Score").innerText) + Number(document.getElementById("user2Score").innerText);
  document.getElementById("pairsLeft").innerText = 33 - found + " pairs left";
});

// Remove the zoom and the border of a card (if highlighted)
socket.on("understateCard", (id) => {
  understateCard(id);
});

function understateCard(id) {
  var card = document.getElementById("card-" + id);
  if (card == null) return;
  card.classList.remove("zoom-card-on-turn");
  card.classList.remove("border");
  card.classList.remove("border-3");
}

// Close opened cards
socket.on("closeCards", (data) => {
  [data[1], data[2]].forEach((id) => {
    var card = document.getElementById("card-" + id);
    if (card == null) return;

    card.classList.remove("flip");
    clearCardImage(card, 600);
    understateCard(id);
  });
});


// Surrender (flag, only while playing) and leave (door) next to "pairs left"
var gameRunning = true;

function renderGameActions(running) {
  gameRunning = running;
  var buttons = [];
  if (running) buttons.push(createIconButton("bi-flag-fill", "Surrender", "danger", surrender));
  buttons.push(createIconButton("bi-box-arrow-left", "Leave", "", leaveGame));
  document.getElementById("gameActions").replaceChildren(...buttons);
}

// Leaving a running game ends it - the bot wins
function leaveGame() {
  if (!gameRunning) {
    window.location.href = "/lobby";
    return;
  }
  confirmDialog({
    title: "Leave the game?",
    text: "The bot wins this game and it counts as a loss in your statistics.",
    confirmLabel: "Leave",
    confirmIcon: "bi-box-arrow-left",
    danger: true,
  }).then((ok) => {
    if (!ok) return;
    // Counts right away (a reload would only pause the game)
    socket.once("getWinner", () => (window.location.href = "/lobby"));
    socket.emit("surrender");
    setTimeout(() => (window.location.href = "/lobby"), 1500);
  });
}

function surrender() {
  confirmDialog({
    title: "Surrender?",
    text: "The bot wins this game and it counts as a loss in your statistics.",
    cancelLabel: "Keep playing",
    confirmLabel: "Surrender",
    confirmIcon: "bi-flag-fill",
    danger: true,
  }).then((ok) => {
    if (ok) socket.emit("surrender");
  });
}

socket.on("getWinner", (data) => {
  gameOver = true;
  // Visual change for winner
  document.getElementById(data.winner == 0 ? "user1Item" : "user2Item").classList.add("winner");
  document.getElementById(data.winner == 0 ? "user2Item" : "user1Item").classList.add("inactive");
  document.getElementById("user1Item").classList.remove("turn");
  document.getElementById("user2Item").classList.remove("turn");
  document.getElementById("board").classList.remove("my-turn");

  // All cards are shown normally now (found pairs are not dimmed anymore)
  document.getElementById("board").classList.add("revealed");

  // Remove all highlights
  for (var i = 0; i < 66; i++) {
    document.getElementById(`cardcount-${i}`).innerText = data.cardCounter[i];
    understateCard(i);
  }

  // Rematch / Back to lobby
  document.getElementById("rematchButton").hidden = false;
  document.getElementById("lobbyButton").hidden = false;
  renderGameActions(false);
  showResult(data);

  // All cards are shown after the game
  (data.cards || []).forEach((src, id) => {
    var card = document.getElementById("card-" + id);
    if (card == null || card.classList.contains("flip")) return;
    setCardImage(card, src);
    card.classList.add("flip");
  });
});

function requestRematch() {
  document.getElementById("rematchButton").disabled = true;
  document.getElementById("resultRematchButton").disabled = true;
  socket.emit("rematch");
}

// Rematch: new board against the same bot
socket.on("rematch", () => {
  gameOver = false;
  document.getElementById("resultOverlay").hidden = true;
  document.getElementById("board").classList.remove("revealed");
  for (var i = 0; i < 66; i++) {
    var card = document.getElementById("card-" + i);
    card.classList.remove("flip");
    understateCard(i);
    clearCardImage(card, 0);
    document.getElementById(`cardcount-${i}`).innerText = "";
  }
  ["user1Score", "user2Score"].forEach((id) => (document.getElementById(id).innerText = "0"));
  document.getElementById("pairsLeft").innerText = "33 pairs left";
  ["user1Item", "user2Item"].forEach((id) => document.getElementById(id).classList.remove("winner", "inactive"));
  renderGameActions(true);

  ["rematchButton", "resultRematchButton"].forEach((id) => (document.getElementById(id).disabled = false));
  document.getElementById("rematchButton").hidden = true;
  document.getElementById("lobbyButton").hidden = true;
});

// Surrender button next to the own name
document.addEventListener("DOMContentLoaded", () => {
  renderGameActions(true);

  var overlay = document.getElementById("resultOverlay");
  document.getElementById("resultBoardButton").addEventListener("click", () => (overlay.hidden = true));
  document.getElementById("rematchButton").addEventListener("click", requestRematch);
  document.getElementById("resultRematchButton").addEventListener("click", requestRematch);
  // A click next to the result closes it and opens the card below
  overlay.addEventListener("click", (event) => {
    if (event.target != overlay) return;
    overlay.hidden = true;
    var below = document.elementFromPoint(event.clientX, event.clientY);
    var card = below && below.closest(".card");
    if (card) zoomCard(Number(card.id.replace("card-", "")));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key == "Escape") overlay.hidden = true;
  });
});

// Same result as in the multiplayer: title + ranking with the points
function showResult(data) {
  var won = data.winner == 0;
  document.getElementById("resultOverlay").classList.toggle("lost", !won);
  document.getElementById("resultTitle").innerText = won ? "You win!" : `${data.computer} wins!`;

  var players = [
    { name: data.user, points: document.getElementById("user1Score").innerText, avatar: createAvatar(data.user, "sm") },
    {
      name: data.computer,
      points: document.getElementById("user2Score").innerText,
      avatar: document.getElementById("botAvatar").cloneNode(),
    },
  ];
  if (!won) players.reverse();
  var list = document.getElementById("resultList");
  list.replaceChildren();
  players.forEach((player, index) => {
    var item = document.createElement("li");
    if (index == 0) item.classList.add("winner");
    var rank = document.createElement("span");
    rank.className = "rank";
    rank.innerText = index + 1 + ".";
    var name = document.createElement("span");
    name.className = "name";
    var nameText = document.createElement("span");
    nameText.className = "player-name-text";
    nameText.innerText = player.name;
    name.appendChild(nameText);
    // Surrendered / left: the flag, like in the multiplayer
    if (data.surrendered && player.name == data.user) name.appendChild(createSurrenderedTag());
    var points = document.createElement("span");
    points.className = "points";
    points.innerText = player.points;
    player.avatar.removeAttribute("id");
    item.append(rank, player.avatar, name, points);
    list.appendChild(item);
  });
  document.getElementById("resultOverlay").hidden = false;
}
