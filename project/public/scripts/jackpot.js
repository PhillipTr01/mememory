/* Hidden jackpot: the server decides everything, this page only shows the pot. */
const socket = io((window.CASINO_NS || "") + "/jackpot");

var state = null;
var myName = null;
var myCoins = 0;
var myCapRule = null; // the max bet by balance ({floor, share} - null: no cap), see casinoCapLeft
// What more I may bet this round (`already`: my coins in it)
function capLeft(already) {
  return casinoCapLeft(myCapRule, myCoins, already);
}
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
  return total > 0 ? ((coins / total) * 100).toFixed(2) : "0.00";
}

function chance(entry) {
  return chanceOf(entry.coins, state.total);
}

/* ---------- Socket ---------- */

socket.on("connect", () => (document.getElementById("connectionBanner").hidden = true));
socket.on("disconnect", () => (document.getElementById("connectionBanner").hidden = false));
socket.on("connect_error", (error) => {
  if (error && error.message == "unauthorized") window.location.href = "/?next=" + encodeURIComponent(location.pathname + location.search);
});
// The admin took the access away
// The admin took the access away: the page again - it asks for access now
socket.on("casinoClosed", () => window.location.reload());
// The admin turned this game off: on to another one
socket.on("gameOff", () => (window.location.href = "./"));

window.addEventListener("pagehide", () => socket.disconnect());
window.addEventListener("pageshow", (event) => {
  if (event.persisted) socket.connect();
});

socket.on("joined", (data) => (myName = data.username));

socket.on("coins", (data) => {
  myCoins = data.coins;
  myCapRule = data.betCapRule || null;
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
    // Opened in the middle of the draw: the rest of it (the winner only when the draw is over) - only at its very end a short one
    var late = previous == null || previous.round !== state.round || previous.phase != "countdown";
    var left = state.spinLeft != null ? state.spinLeft : state.spin;
    playDraw(late && left < 2500, late ? Math.max(900, left - 900) : null);
    return;
  }
  if (state.phase == "open" && previous && previous.round !== state.round) {
    document.getElementById("jpResult").hidden = true;
    document.getElementById("jpStage").replaceChildren();
  }
  render();
});

/* ---------- Rendering ---------- */

// The scene before the draw - only built again when the pot changed (every update made it flicker)
var idleKey = null;
function showIdle() {
  var stage = document.getElementById("jpStage");
  var key = [state.mode, state.round, state.total, ...state.entries.map((entry) => entry.name + ":" + entry.coins)].join("|");
  if (key == idleKey && stage.firstElementChild) return;
  idleKey = key;
  currentDraw().idle(stage);
}

function render() {
  if (state == null) return;
  document.getElementById("jpRound").innerText = "Round " + state.round;
  // The coin in front of the number is drawn by the style (.jp-total::before)
  document.getElementById("jpTotal").innerText = formatCoins(state.total);
  document.getElementById("jpTotal").title = state.rake ? "The pot - the winner gets it minus " + state.rake + "% for the house" : "";
  var players = state.entries.length;
  document.getElementById("jpPlayerCount").innerText = players == 1 ? "1 player" : players + " players";
  // The pot is in the middle of the wheel, the other draws show it above
  document.getElementById("jpPotbar").hidden = state.mode == "wheel";
  // A running animation keeps its scene, a finished one stays until the next round
  if (!spinning && !(state.phase == "drawing" && spunRound == state.round)) showIdle();
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
  var center = document.getElementById("jpCenter");
  // Alone in the pot: a small 👻 countdown next to the players
  var ghost = document.getElementById("jpGhostIn");
  var ghostSeconds = state.phase == "open" && ghostEnd != null ? Math.max(0, Math.ceil((ghostEnd - Date.now()) / 1000)) : null;
  ghost.hidden = ghostSeconds == null;
  if (ghostSeconds != null) {
    ghost.innerText = ghostSeconds + "s";
    ghost.title = "The ghost joins in " + ghostSeconds + "s";
  }
  if (state.phase == "open") {
    center.innerText = state.entries.length == 0 ? "Waiting for players" : "Waiting for a 2nd player";
    center.className = "jp-center-status";
  } else if (state.phase == "countdown") {
    var seconds = Math.ceil(timeLeft() / 1000);
    center.innerText = "0:" + String(seconds).padStart(2, "0");
    center.className = "jp-center-status timer" + (seconds <= 5 ? " urgent" : "");
  } else if (spinning) {
    center.innerText = "Drawing...";
    center.className = "jp-center-status";
  } else if (state.draw) {
    center.innerText = state.draw.winner;
    center.className = "jp-center-status winner";
  }
  // The wheel shows the pot and the status in its middle
  document.querySelectorAll(".jp-mirror-total").forEach((total) => (total.innerText = document.getElementById("jpTotal").innerText));
  document.querySelectorAll(".jp-mirror-ghost").forEach((mirror) => {
    mirror.hidden = ghost.hidden;
    mirror.innerText = ghost.innerText;
    mirror.title = ghost.title;
  });
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

function playDraw(short, length) {
  var draw = state.draw;
  var duration = short ? 900 : length || state.spin - 900;
  var stage = document.getElementById("jpStage");
  spinning = true;
  // (after the draw the waiting scene is built again)
  idleKey = null;
  document.getElementById("jpResult").hidden = true;
  render();
  currentDraw()
    .play(stage, draw, duration, short)
    .catch((error) => console.error("Draw animation failed:", error))
    .finally(() => {
      spinning = false;
      // (no "X wins N coins" line under the draw - the draw shows the winner)
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
  return number.toFixed(2) + "%";
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

// One record: the picture left, what and who in the middle, the pot and the chance right
function recordCard(id, label, round, icon) {
  var card = document.getElementById(id);
  card.classList.toggle("empty", round == null);
  var picture = round ? createAvatar(round.winner, "lg") : el("span", "jp-record-placeholder", icon);
  picture.classList.add("jp-record-picture");
  var title = el("span", "jp-record-label", icon + " " + label);
  var name = el("span", "jp-record-name", round ? round.winner : "Nobody yet");
  var parts = [picture, title, name];
  if (round) parts.push(el("span", "jp-record-amount", formatCoins(round.total)), el("span", "jp-record-chance", chanceOf(round.coins, round.total) + "% chance"));
  card.replaceChildren(...parts);
  // A click: everybody who was in that round
  card.classList.toggle("clickable", round != null);
  card.onclick = round ? () => showRound(round, label) : null;
  card.title = round ? "Who was in this round?" : "";
}

// A round of the past: the winner on top, then everybody who was in the pot (biggest first) with their chance
function showRound(round, label) {
  var backdrop = el("div", "mm-dialog-backdrop jp-round-backdrop");
  var dialog = el("div", "mm-dialog jp-round");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  var close = () => backdrop.remove();
  var x = el("button", "jp-round-close", "✕");
  x.type = "button";
  x.setAttribute("aria-label", "Close");
  x.addEventListener("click", close);

  var head = el("div", "jp-round-head");
  var crown = el("div", "jp-round-crown");
  crown.append(createAvatar(round.winner, "lg"), el("span", "jp-round-crown-icon", "👑"));
  head.append(el("span", "jp-round-label", (label ? label + " · " : "") + "Round " + round.round), crown, el("b", "jp-round-winner", round.winner == "Ghost" ? "👻 Ghost" : round.winner), el("span", "jp-round-won", "won 🪙 " + formatCoins(round.payout != null ? round.payout : round.total)));
  var facts = el("div", "jp-round-facts");
  var fact = (value, text) => {
    var box = el("div", "jp-round-fact");
    box.append(el("b", "", value), el("span", "", text));
    return box;
  };
  var joined = round.players || [{ name: round.winner, coins: round.coins }];
  // (the colors of that round: in the order the players joined it)
  var colorOf = (name) => SHARE_COLORS[Math.max(0, joined.findIndex((p) => p.name == name)) % SHARE_COLORS.length];
  // (the biggest first - equal: the winner first)
  var players = joined.slice().sort((a, b) => b.coins - a.coins || (b.name == round.winner) - (a.name == round.winner));
  facts.append(fact("🪙 " + formatCoins(round.total), "in the pot"), fact(chanceOf(round.coins, round.total) + "%", "winner's chance"), fact(String(players.length), players.length == 1 ? "player" : "players"));

  var list = el("div", "jp-round-list");
  players.forEach((player) => {
    var row = el("div", "jp-round-row" + (player.name == round.winner ? " winner" : "") + (player.name == myName ? " me" : ""));
    var share = round.total > 0 ? player.coins / round.total : 0;
    var who = el("span", "jp-round-who");
    who.append(player.ghost ? el("span", "jp-round-ghost", "👻") : createAvatar(player.name, "sm"), el("span", "jp-round-name", player.ghost ? "Ghost" : player.name));
    if (player.name == myName) who.appendChild(el("span", "player-tag", "You"));
    if (player.name == round.winner) who.appendChild(el("span", "jp-round-tag", "👑 Winner"));
    var bar = el("span", "jp-round-bar");
    var fill = el("span", "jp-round-fill");
    fill.style.width = Math.max(2, share * 100) + "%";
    fill.style.background = player.ghost ? "" : colorOf(player.name);
    bar.appendChild(fill);
    row.append(who, el("span", "jp-round-coins", "🪙 " + formatCoins(player.coins)), el("span", "jp-round-chance", chanceOf(player.coins, round.total) + "%"), bar);
    list.appendChild(row);
  });
  if (!round.players) list.appendChild(el("p", "jp-round-old", "This round is from before - only the winner is known."));

  dialog.append(x, head, facts, list);
  backdrop.appendChild(dialog);
  backdrop.addEventListener("click", (event) => event.target == backdrop && close());
  document.addEventListener("keydown", function onKey(event) {
    if (event.key != "Escape") return;
    close();
    document.removeEventListener("keydown", onKey);
  });
  document.body.appendChild(backdrop);
  x.focus();
}

function renderRecords() {
  // While the wheel spins, the last winner is still the one before
  recordCard("jpLastWinner", "Last winner", state.history[0] || null, "👑");
  var records = state.records || {};
  recordCard("jpBiggest", "Biggest pot today", records.biggest || null, "💰");
  recordCard("jpLuckiest", "Luckiest win today", records.luckiest || null, "🍀");
}

function renderHistory() {
  var list = document.getElementById("jpHistory");
  document.getElementById("jpHistoryEmpty").hidden = state.history.length > 0;
  // Only the last three winners
  list.replaceChildren(
    ...state.history.slice(0, 3).map((round) => {
      var item = historyItem(createAvatar(round.winner, "sm"), round.winner, "Round " + round.round + " · " + chanceOf(round.coins, round.total) + "% chance", "🪙 " + formatCoins(round.payout != null ? round.payout : round.total));
      // A click: everybody who was in it
      item.classList.add("clickable");
      item.addEventListener("click", () => showRound(round));
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
  // During a draw a bet goes into the next pot: only the bets for that one count
  var drawing = state.phase == "drawing";
  var counted = drawing ? (state.pending || []).filter((bet) => bet.next) : (state.bets || []).concat(state.pending || []);
  var myBets = counted.filter((bet) => bet.name == myName).length;
  var betsLeft = Math.max(0, state.maxBets - myBets);
  // All bets of a round together: at most maxCoins
  var myAmount = counted.filter((bet) => bet.name == myName).reduce((sum, bet) => sum + bet.amount, 0);
  var coinsLeft = state.maxCoins != null ? Math.max(0, state.maxCoins - myAmount) : Infinity;
  // (and never more than the max bet by balance)
  var room = betsLeft > 0 ? Math.min(myCoins, coinsLeft, capLeft(myAmount)) : 0;
  var open = true;
  var button = document.getElementById("jpBetButton");
  button.lastChild.textContent = drawing ? " Next pot" : " Put in";
  button.title = drawing ? "The pot is being drawn - this goes into the next one" : "";
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

var ghostEnd = null; // alone in the pot: when the ghost comes

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

  // +100 / +500 / +1,000 add up, Max = everything that is still allowed
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
