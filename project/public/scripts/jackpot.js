/* Hidden jackpot: the server decides everything, this page only shows the pot. */
const socket = io("/jackpot");

var state = null;
var myName = null;
var myCoins = 0;
var animatedRound = null; // the roulette runs once per round
var spinning = false;
var countdownTimer = null;

// Used by chat.js
function chatUsername() {
  return myName;
}

// Same hue as the avatar, but brighter, so the shares are easy to tell apart
function shareColor(name) {
  var hash = 0;
  for (var i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(hash) % 360}, 45%, 52%)`;
}

function formatCoins(value) {
  return Number(value).toLocaleString("en-US");
}

function chance(entry) {
  return state.total > 0 ? Math.round((entry.coins / state.total) * 100) : 0;
}

/* ---------- Socket ---------- */

socket.on("connect", () => (document.getElementById("connectionBanner").hidden = true));
socket.on("disconnect", () => (document.getElementById("connectionBanner").hidden = false));
socket.on("connect_error", (error) => {
  if (error && error.message == "unauthorized") window.location.href = "/";
});

window.addEventListener("pagehide", () => socket.disconnect());
window.addEventListener("pageshow", (event) => {
  if (event.persisted) socket.connect();
});

socket.on("joined", (data) => (myName = data.username));

socket.on("coins", (data) => {
  myCoins = data.coins;
  document.getElementById("jpCoins").innerText = "🪙 " + formatCoins(data.coins);
  document.getElementById("jpBonus").hidden = !data.bonus;
  renderBet();
});

socket.on("bonusClaimed", (amount) => showError("+" + amount + " free coins - good luck!", true));
socket.on("betError", (message) => showError(message));

socket.on("jackpotState", (data) => {
  var previous = state;
  state = data;
  // Somebody won: show the roulette (once per round)
  if (state.phase == "drawing" && state.draw && animatedRound !== state.round) {
    animatedRound = state.round;
    // Opened in the middle of the draw: no long spin
    playRoulette(previous == null || previous.round !== state.round || previous.phase != "countdown");
  }
  render();
});

/* ---------- Rendering ---------- */

function render() {
  if (state == null) return;
  document.getElementById("jpRound").innerText = "Round " + state.round;
  document.getElementById("jpTotal").innerText = "🪙 " + formatCoins(state.total);
  document.getElementById("jpViewers").innerText = state.viewers + " here";
  renderStatus();
  renderShares();
  renderPlayers();
  renderHistory();
  renderBet();
  renderCountdown();
}

function renderStatus() {
  var status = document.getElementById("jpStatus");
  if (state.phase == "open") {
    status.innerText =
      state.entries.length == 0
        ? "Put in coins - the more you put in, the higher your chance."
        : "Waiting for a second player...";
  } else if (state.phase == "countdown") {
    var seconds = Math.ceil(timeLeft() / 1000);
    status.innerText = "The draw starts in " + seconds + "s";
  } else if (spinning) {
    status.innerText = "Drawing...";
  } else if (state.draw) {
    status.innerText = "Next round in a moment...";
  }
}

// The bar with everybody's share of the pot
function renderShares() {
  var shares = document.getElementById("jpShares");
  shares.hidden = state.phase == "drawing";
  if (state.entries.length == 0) {
    shares.replaceChildren(Object.assign(document.createElement("div"), { className: "jp-share empty" }));
    return;
  }
  shares.replaceChildren(
    ...state.entries.map((entry) => {
      var part = document.createElement("div");
      part.className = "jp-share";
      part.style.flexGrow = entry.coins;
      part.style.background = shareColor(entry.name);
      part.title = entry.name + ": " + formatCoins(entry.coins) + " coins (" + chance(entry) + "%)";
      return part;
    }),
  );
}

function renderPlayers() {
  var list = document.getElementById("jpPlayers");
  document.getElementById("jpEmpty").hidden = state.entries.length > 0;
  var entries = state.entries.slice().sort((a, b) => b.coins - a.coins);
  list.replaceChildren(
    ...entries.map((entry) => {
      var item = document.createElement("div");
      item.className = "player-item jp-player";
      if (state.draw && !spinning && state.draw.winner == entry.name) item.classList.add("winner");
      item.style.setProperty("--share", shareColor(entry.name));

      var info = document.createElement("div");
      info.className = "player-info";
      var name = document.createElement("div");
      name.className = "player-name";
      var text = document.createElement("span");
      text.className = "player-name-text";
      text.innerText = entry.name;
      name.appendChild(text);
      if (entry.name == myName) {
        var you = document.createElement("span");
        you.className = "player-tag";
        you.innerText = "You";
        name.appendChild(you);
      }
      var sub = document.createElement("div");
      sub.className = "player-sub";
      sub.innerText = chance(entry) + "% chance";
      info.append(name, sub);

      var points = document.createElement("div");
      points.className = "player-points jp-player-coins";
      points.innerText = formatCoins(entry.coins);

      item.append(createAvatar(entry.name), info, points);
      return item;
    }),
  );
}

function renderHistory() {
  var list = document.getElementById("jpHistory");
  document.getElementById("jpHistoryEmpty").hidden = state.history.length > 0;
  list.replaceChildren(
    ...state.history.map((round) => {
      var item = document.createElement("li");
      var name = document.createElement("span");
      name.className = "jp-history-name";
      name.append(createAvatar(round.winner, "sm"), document.createTextNode(round.winner));
      var won = document.createElement("span");
      won.className = "jp-history-won";
      won.innerText = "🪙 " + formatCoins(round.total);
      var odds = document.createElement("span");
      odds.className = "jp-history-odds";
      odds.innerText = Math.round((round.coins / round.total) * 100) + "%";
      item.append(name, odds, won);
      return item;
    }),
  );
}

function myEntry() {
  return state ? state.entries.find((entry) => entry.name == myName) : null;
}

function renderBet() {
  if (state == null) return;
  var mine = myEntry();
  var inPot = mine ? mine.coins : 0;
  var room = Math.max(0, Math.min(myCoins, state.maxBet - inPot));
  var open = state.phase != "drawing";
  document.getElementById("jpChance").innerText = mine
    ? "In the pot: " + formatCoins(inPot) + " · " + chance(mine) + "% chance"
    : "";
  document.getElementById("jpAmount").max = room;
  document.getElementById("jpAmount").disabled = !open || room == 0;
  document.getElementById("jpBetButton").disabled = !open || room == 0;
  document.querySelectorAll(".jp-quick button").forEach((button) => (button.disabled = !open || room == 0));
}

/* ---------- Countdown ---------- */

var countdownEnd = null;

function timeLeft() {
  return countdownEnd == null ? 0 : Math.max(0, countdownEnd - Date.now());
}

function renderCountdown() {
  var bar = document.getElementById("jpTimer");
  clearInterval(countdownTimer);
  if (state.phase != "countdown" || state.endsIn == null) {
    countdownEnd = null;
    bar.classList.remove("running");
    return;
  }
  countdownEnd = Date.now() + state.endsIn;
  bar.classList.add("running");
  var full = state.endsIn;
  var tick = () => {
    var left = timeLeft();
    bar.firstElementChild.style.width = (left / Math.max(full, 1)) * 100 + "%";
    bar.classList.toggle("urgent", left <= 5000);
    renderStatus();
    if (left <= 0) clearInterval(countdownTimer);
  };
  tick();
  countdownTimer = setInterval(tick, 100);
}

/* ---------- The draw: roulette with the players' tiles ---------- */

function playRoulette(short) {
  var roulette = document.getElementById("jpRoulette");
  var track = document.getElementById("jpTrack");
  var result = document.getElementById("jpResult");
  var draw = state.draw;
  var entries = state.entries;

  // Many tiles, each player as often as their share; the winner stops under the marker
  var count = 64;
  var target = 56;
  var names = [];
  for (var i = 0; i < count; i++) {
    var ticket = Math.random() * state.total;
    var counted = 0;
    names.push(entries.find((entry) => (counted += entry.coins) > ticket).name);
  }
  names[target] = draw.winner;

  track.replaceChildren(
    ...names.map((name, index) => {
      var tile = document.createElement("div");
      tile.className = "jp-tile";
      tile.style.setProperty("--share", shareColor(name));
      if (index == target) tile.dataset.winner = "1";
      var label = document.createElement("span");
      label.innerText = name;
      tile.append(createAvatar(name), label);
      return tile;
    }),
  );

  roulette.hidden = false;
  result.hidden = true;
  spinning = true;
  var spin = short ? 900 : state.spin - 900;

  requestAnimationFrame(() => {
    var tile = track.children[target];
    var tileWidth = tile.offsetWidth + 8; // + gap
    // A random point on the winner's tile, so it doesn't always stop in the middle
    var offset = target * tileWidth + tile.offsetWidth * (0.2 + Math.random() * 0.6);
    var center = roulette.clientWidth / 2;
    track.style.transition = "none";
    track.style.transform = "translateX(0)";
    requestAnimationFrame(() => {
      track.style.transition = `transform ${spin}ms cubic-bezier(0.1, 0.7, 0.15, 1)`;
      track.style.transform = `translateX(${center - offset}px)`;
    });
  });

  setTimeout(() => {
    spinning = false;
    track.children[target].classList.add("chosen");
    var won = draw.winner == myName;
    result.innerText = won
      ? "You win " + formatCoins(draw.total) + " coins!"
      : draw.winner + " wins " + formatCoins(draw.total) + " coins";
    result.classList.toggle("won", won);
    result.hidden = false;
    render();
  }, spin);
}

// A new round: the roulette makes room for the shares again
function resetRoulette() {
  document.getElementById("jpRoulette").hidden = true;
  document.getElementById("jpResult").hidden = true;
}

socket.on("jackpotState", (data) => {
  if (data.phase == "open") resetRoulette();
});

/* ---------- Betting ---------- */

function showError(message, good) {
  var error = document.getElementById("jpError");
  error.innerText = message;
  error.classList.toggle("good", good === true);
  error.hidden = false;
  clearTimeout(showError.timer);
  showError.timer = setTimeout(() => (error.hidden = true), 3500);
}

function bet() {
  var input = document.getElementById("jpAmount");
  var amount = Number(input.value);
  if (!Number.isInteger(amount) || amount <= 0) {
    showError("Enter a number of coins.");
    return;
  }
  socket.emit("bet", { amount: amount });
  input.value = "";
}

document.addEventListener("DOMContentLoaded", () => {
  setupChat();

  document.getElementById("jpForm").addEventListener("submit", (event) => {
    event.preventDefault();
    bet();
  });

  // +10 / +50 / +100 add up, Max = everything that is still allowed
  document.querySelectorAll(".jp-quick button").forEach((button) => {
    button.addEventListener("click", () => {
      var input = document.getElementById("jpAmount");
      var max = Number(input.max) || 0;
      var value = button.dataset.add == "max" ? max : (Number(input.value) || 0) + Number(button.dataset.add);
      input.value = Math.min(value, max);
      input.focus();
    });
  });

  document.getElementById("jpBonus").addEventListener("click", () => socket.emit("claimBonus"));
});
