/* Hidden jackpot: the server decides everything, this page only shows the pot. */
const socket = io("/jackpot");

var state = null;
var myName = null;
var myCoins = 0;
var spunRound = null; // the draw animation runs once per round
var spinning = false;
var countdownTimer = null;
var countdownEnd = null;

// Used by chat.js
function chatUsername() {
  return myName;
}

// Every player of the round gets a clearly different color (in the order they
// joined the pot); names that are not in the pot get one from their name
var SHARE_COLORS = ["#e0675a", "#3b82f6", "#3fae6b", "#d4a64a", "#a855f7", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#94a3b8"];

function shareColor(name) {
  var index = state ? state.entries.findIndex((entry) => entry.name == name) : -1;
  if (index >= 0) return SHARE_COLORS[index % SHARE_COLORS.length];
  var hash = 0;
  for (var i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return SHARE_COLORS[Math.abs(hash) % SHARE_COLORS.length];
}

function formatCoins(value) {
  return Number(value).toLocaleString("en-US");
}

function chanceOf(coins, total) {
  return total > 0 ? Math.round((coins / total) * 100) : 0;
}

function chance(entry) {
  return chanceOf(entry.coins, state.total);
}

/* ---------- Socket ---------- */

socket.on("connect", () => (document.getElementById("connectionBanner").hidden = true));
socket.on("disconnect", () => (document.getElementById("connectionBanner").hidden = false));
socket.on("connect_error", (error) => {
  if (error && error.message == "unauthorized") window.location.href = "/";
});
// The admin took the access away
socket.on("casinoClosed", () => (window.location.href = "/"));

window.addEventListener("pagehide", () => socket.disconnect());
window.addEventListener("pageshow", (event) => {
  if (event.persisted) socket.connect();
});

socket.on("joined", (data) => (myName = data.username));

socket.on("coins", (data) => {
  myCoins = data.coins;
  document.getElementById("jpCoins").innerText = "🪙 " + formatCoins(data.coins);
  renderBet();
});

socket.on("betError", (message) => showError(message));
socket.on("betInfo", (message) => showError(message, true));

socket.on("jackpotState", (data) => {
  var previous = state;
  state = data;
  if (state.phase == "drawing" && state.draw && spunRound !== state.round) {
    spunRound = state.round;
    // Opened in the middle of the draw: no long spin
    var short = previous == null || previous.round !== state.round || previous.phase != "countdown";
    playDraw(short);
    return;
  }
  if (state.phase == "open" && previous && previous.round !== state.round) {
    document.getElementById("jpResult").hidden = true;
    document.getElementById("jpStage").replaceChildren();
  }
  render();
});

/* ---------- Rendering ---------- */

function render() {
  if (state == null) return;
  document.getElementById("jpRound").innerText = "Round " + state.round;
  document.getElementById("jpTotal").innerText = "🪙 " + formatCoins(state.total);
  // The pot is in the middle of the wheel, the other draws show it above
  document.getElementById("jpPotbar").hidden = state.mode == "wheel";
  // A running animation keeps its scene, a finished one stays until the next round
  if (!spinning && !(state.phase == "drawing" && spunRound == state.round)) currentDraw().idle(document.getElementById("jpStage"));
  renderStatus();
  renderPlayers();
  renderBets();
  renderRecords();
  renderHistory();
  renderFair();
  renderBet();
  renderCountdown();
}

function renderStatus() {
  var status = document.getElementById("jpStatus");
  var center = document.getElementById("jpCenter");
  if (state.phase == "open") {
    var ghostSeconds = ghostEnd != null ? Math.max(0, Math.ceil((ghostEnd - Date.now()) / 1000)) : null;
    status.innerText =
      state.entries.length == 0
        ? "Put in coins - the more you put in, the higher your chance."
        : ghostSeconds != null
          ? "Waiting for a second player - a 👻 ghost bet joins in " + ghostSeconds + "s"
          : "Waiting for a second player...";
    center.innerText = state.entries.length == 0 ? "Waiting for players" : "Waiting for a 2nd player";
    center.className = "jp-center-status";
  } else if (state.phase == "countdown") {
    var seconds = Math.ceil(timeLeft() / 1000);
    status.innerText = "The draw starts in " + seconds + "s";
    center.innerText = "0:" + String(seconds).padStart(2, "0");
    center.className = "jp-center-status timer" + (seconds <= 5 ? " urgent" : "");
  } else if (spinning) {
    status.innerText = "Drawing...";
    center.innerText = "Drawing...";
    center.className = "jp-center-status";
  } else if (state.draw) {
    status.innerText = "Next round in a moment...";
    center.innerText = state.draw.winner;
    center.className = "jp-center-status winner";
  }
  // The wheel shows the pot and the status in its middle
  document.querySelectorAll(".jp-mirror-total").forEach((total) => (total.innerText = document.getElementById("jpTotal").innerText));
  document.querySelectorAll(".jp-mirror-status").forEach((mirror) => {
    mirror.innerText = center.innerText;
    mirror.className = center.className + " jp-mirror-status";
  });
}

/* ---------- The draw (see jackpot_draws.js) ---------- */

// The animation of the round: chosen by the server, the same for everybody
function currentDraw() {
  return DRAWS[state.mode] || DRAWS.wheel;
}

// The pot as the draws need it: one piece per bet, in the order of the bets
function drawBets() {
  return (state.bets || []).map((bet) => ({ name: bet.name, coins: bet.amount, from: bet.from, to: bet.to }));
}

function playDraw(short) {
  var draw = state.draw;
  var duration = short ? 900 : state.spin - 900;
  var stage = document.getElementById("jpStage");
  spinning = true;
  document.getElementById("jpResult").hidden = true;
  render();
  currentDraw()
    .play(stage, draw, duration, short)
    .catch((error) => console.error("Draw animation failed:", error))
    .finally(() => {
      spinning = false;
      var result = document.getElementById("jpResult");
      var won = draw.winner == myName;
      result.innerText = won
        ? "You win " + formatCoins(draw.total) + " coins!"
        : draw.winner + " wins " + formatCoins(draw.total) + " coins";
      result.classList.toggle("won", won);
      result.hidden = false;
      render();
    });
}

/* ---------- Players, deposits, records ---------- */

function personRow(name, extraClass) {
  var item = document.createElement("div");
  item.className = "player-item jp-player" + (extraClass ? " " + extraClass : "");
  item.style.setProperty("--share", shareColor(name));
  var info = document.createElement("div");
  info.className = "player-info";
  var line = document.createElement("div");
  line.className = "player-name";
  var text = document.createElement("span");
  text.className = "player-name-text";
  text.innerText = name;
  line.appendChild(text);
  if (name == myName) {
    var you = document.createElement("span");
    you.className = "player-tag";
    you.innerText = "You";
    line.appendChild(you);
  }
  var sub = document.createElement("div");
  sub.className = "player-sub";
  info.append(line, sub);
  var points = document.createElement("div");
  points.className = "player-points jp-player-coins";
  item.append(createAvatar(name), info, points);
  return { item: item, sub: sub, points: points };
}

function renderPlayers() {
  var list = document.getElementById("jpPlayers");
  document.getElementById("jpEmpty").hidden = state.entries.length > 0;
  var entries = state.entries.slice().sort((a, b) => b.coins - a.coins);
  list.replaceChildren(
    ...entries.map((entry) => {
      var winner = state.draw && !spinning && state.draw.winner == entry.name;
      var row = personRow(entry.name, winner ? "winner" : "");
      row.sub.innerText = chance(entry) + "% chance";
      row.points.innerText = formatCoins(entry.coins);
      return row.item;
    }),
  );
}

function percent(value) {
  var number = (value / state.total) * 100;
  return (number >= 10 || number == 0 ? Math.round(number) : number.toFixed(1)) + "%";
}

// Every bet of the round, newest first, with its tickets (from..to)
function renderBets() {
  var list = document.getElementById("jpBets");
  var bets = state.bets || [];
  var pending = state.pending || [];
  var count = bets.length + pending.length;
  document.getElementById("jpBetsEmpty").hidden = count > 0;
  document.getElementById("jpBetCount").innerText = count == 1 ? "1 bet" : count + " bets";
  // Own bets on their way to the pot (in it after a few seconds): on top, without tickets
  var hidden = pending.map((bet) => {
    var row = personRow(bet.name, "pending");
    row.sub.innerText = bet.next ? "Waiting for the next pot" : "On its way - in the pot in a few seconds";
    row.points.innerText = "+" + formatCoins(bet.amount);
    var li = document.createElement("li");
    li.appendChild(row.item);
    return li;
  });
  list.replaceChildren(
    ...hidden,
    ...bets
      .slice()
      .reverse()
      .map((bet) => {
        // The winning bet is the one with the drawn ticket
        var won = state.draw && !spinning && state.draw.ticket + 1 >= bet.from && state.draw.ticket + 1 <= bet.to;
        var row = personRow(bet.name, won ? "winner" : "");
        row.sub.innerText = "Tickets #" + formatCoins(bet.from) + " - #" + formatCoins(bet.to);
        row.sub.title = "If the drawn ticket is in this range, this bet wins the pot";
        row.points.innerText = "+" + formatCoins(bet.amount);
        var li = document.createElement("li");
        li.appendChild(row.item);
        return li;
      }),
  );
}

function recordCard(id, label, round) {
  var card = document.getElementById(id);
  var title = document.createElement("span");
  title.className = "jp-record-label";
  title.innerText = label;
  if (round == null) {
    var none = document.createElement("span");
    none.className = "jp-record-none";
    none.innerText = "-";
    card.replaceChildren(title, none);
    return;
  }
  var who = document.createElement("div");
  who.className = "jp-record-who";
  var name = document.createElement("span");
  name.className = "player-name-text";
  name.innerText = round.winner;
  who.append(createAvatar(round.winner, "sm"), name);
  var amount = document.createElement("span");
  amount.className = "jp-record-amount";
  amount.innerText = "🪙 " + formatCoins(round.total) + " · " + chanceOf(round.coins, round.total) + "%";
  card.replaceChildren(title, who, amount);
}

function renderRecords() {
  // While the wheel spins, the last winner is still the one before
  recordCard("jpLastWinner", "Last winner", state.history[0] || null);
  var records = state.records || {};
  recordCard("jpBiggest", "Biggest pot today", records.biggest || null);
  recordCard("jpLuckiest", "Luckiest win today", records.luckiest || null);
}

function renderHistory() {
  var list = document.getElementById("jpHistory");
  document.getElementById("jpHistoryEmpty").hidden = state.history.length > 0;
  // Only the last three winners
  list.replaceChildren(
    ...state.history.slice(0, 3).map((round) => {
      var item = document.createElement("li");
      var name = document.createElement("span");
      name.className = "jp-history-name";
      name.append(createAvatar(round.winner, "sm"), document.createTextNode(round.winner));
      var won = document.createElement("span");
      won.className = "jp-history-won";
      won.innerText = "🪙 " + formatCoins(round.total);
      var odds = document.createElement("span");
      odds.className = "jp-history-odds";
      odds.innerText = chanceOf(round.coins, round.total) + "%";
      item.append(name, odds, won);
      return item;
    }),
  );
}

// Provably fair: the hash before, the number and the secret after the draw
function renderFair() {
  var fair = document.getElementById("jpFair");
  var parts = [createIcon("bi-shield-check"), fairPart("Round hash", state.fair.hash)];
  if (state.fair.number != null && !spinning) {
    parts.push(fairPart("Number", state.fair.number), fairPart("Secret", state.fair.secret));
  }
  fair.title = "Provably fair: the winning number is chosen before the round. sha256(number + \":\" + secret) = round hash";
  fair.replaceChildren(...parts);
}

function fairPart(label, value) {
  var part = document.createElement("span");
  part.className = "jp-fair-part";
  var name = document.createElement("span");
  name.className = "jp-fair-label";
  name.innerText = label;
  var code = document.createElement("code");
  code.innerText = value;
  part.append(name, code);
  return part;
}

function myEntry() {
  return state ? state.entries.find((entry) => entry.name == myName) : null;
}

function renderBet() {
  if (state == null) return;
  var mine = myEntry();
  var inPot = mine ? mine.coins : 0;
  var myBets = (state.bets || []).concat(state.pending || []).filter((bet) => bet.name == myName).length;
  var betsLeft = Math.max(0, state.maxBets - myBets);
  var room = betsLeft > 0 ? myCoins : 0;
  var open = state.phase != "drawing";
  document.getElementById("jpChance").innerText = mine
    ? "In the pot: " + formatCoins(inPot) + " · " + chance(mine) + "% chance · " +
      (betsLeft == 0 ? "no bets left" : betsLeft == 1 ? "1 bet left" : betsLeft + " bets left")
    : "";
  document.getElementById("jpAmount").max = room;
  document.getElementById("jpAmount").disabled = !open || room == 0;
  document.getElementById("jpBetButton").disabled = !open || room == 0;
  document.querySelectorAll(".jp-quick button").forEach((button) => (button.disabled = !open || room == 0));
}

/* ---------- Countdown ---------- */

function timeLeft() {
  return countdownEnd == null ? 0 : Math.max(0, countdownEnd - Date.now());
}

var ghostEnd = null; // alone in the pot: when the ghost bet comes

function renderCountdown() {
  clearInterval(countdownTimer);
  ghostEnd = state.phase == "open" && state.ghostIn != null ? Date.now() + state.ghostIn : null;
  if (ghostEnd != null) {
    countdownEnd = null;
    countdownTimer = setInterval(() => {
      renderStatus();
      if (Date.now() >= ghostEnd) clearInterval(countdownTimer);
    }, 250);
    return;
  }
  if (state.phase != "countdown" || state.endsIn == null) {
    countdownEnd = null;
    return;
  }
  countdownEnd = Date.now() + state.endsIn;
  countdownTimer = setInterval(() => {
    renderStatus();
    if (timeLeft() <= 0) clearInterval(countdownTimer);
  }, 250);
}

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

});
