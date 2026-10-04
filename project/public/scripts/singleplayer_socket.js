const socket = io("/singleplayer");

var modal;
var game;
var backImage = "/static/images/logo_small.png";

// Escape text before putting it into innerHTML (usernames, chat messages, ...)
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Something went wrong on the server (e.g. not enough memes) -> back to the lobby
socket.on("gameError", (message) => {
  alert(message || "Something went wrong. Please try again.");
  window.location.href = "/lobby";
});

socket.on("connect_error", (error) => {
  // Not logged in (anymore)
  if (error && error.message == "unauthorized") {
    window.location.href = "/";
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
  },
  false,
);

// Initialize Game - the server picks the memes
socket.emit("initializingGame", {
  gameID: sessionStorage.getItem("gameID"),
});

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

// Show which player's turn it is
socket.on("highlightPlayer", (data) => {
  document.getElementById("user1Username").innerText = data.user;
  document.getElementById("user2Username").innerText = data.computer;
  document.getElementById("user1Item").classList.toggle("turn", data.turn == 0);
  document.getElementById("user2Item").classList.toggle("turn", data.turn == 1);
  document.getElementById("board").classList.toggle("my-turn", data.turn == 0);
});

socket.on("noGameFound", () => {
  window.location.href = "/lobby";
});

function openCard(id) {
  socket.emit("openCard", id);
}

socket.on("turnCard", (data) => {
  var card = document.getElementById("card-" + data.id);
  card.childNodes[1].childNodes[1].src = data.src;
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
  score.innerText = data.points;
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

function emitEndTurn() {
  socket.emit("endTurn");
}

function surrender() {
  confirmDialog({
    title: "Surrender?",
    text: "The bot wins this game and it counts as a loss in your statistics.",
    cancelLabel: "Keep playing",
    confirmLabel: "Surrender",
    danger: true,
  }).then((ok) => {
    if (ok) socket.emit("surrender");
  });
}

socket.on("getWinner", (data) => {
  var playButton = document.getElementById("playButton");

  // Visual change for winner
  document.getElementById(data.winner == 0 ? "user1Item" : "user2Item").classList.add("winner");
  document.getElementById(data.winner == 0 ? "user2Item" : "user1Item").classList.add("inactive");
  document.getElementById("user1Item").classList.remove("turn");
  document.getElementById("user2Item").classList.remove("turn");
  document.getElementById("board").classList.remove("my-turn");
  showToast(data.winner == 0 ? "You win" : `${data.computer} wins`);

  // Remove all highlights
  for (var i = 0; i < 66; i++) {
    document.getElementById(`cardcount-${i}`).innerText = data.cardCounter[i];
    understateCard(i);
  }

  // Change EndTurn-Button to Back to Lobby
  playButton.onclick = () => {
    window.location.href = "/lobby";
  };
  playButton.disabled = false;
  playButton.innerText = "Back to Lobby";
  document.getElementById("surrenderButton").hidden = true;

  // Reset storage
  sessionStorage.clear();
});
