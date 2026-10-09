/* Hidden roulette: the server takes the bets, rolls and pays - this page shows the round. */
const socket = io("/roulette");

var myName = null;
var myCoins = 0;
var table = null; // the last state of the round
var rules = null;
var rolledRound = null; // the round whose roll plays (or played) on this page
var rolling = false; // the reel rolls here right now
var reelAt = 0; // the reel's position (px) when it stands
var AMOUNT_KEY = "rouletteAmount";
var TILE = 76; // width of a slot with its gap (from the page)
var COPIES = 9; // the wheel this many times in a row: room to roll
var COLOR_NAMES = { red: "Red", blue: "Blue", green: "Green" };

// Used by chat.js
function chatUsername() {
  return myName;
}

function formatCoins(value) {
  return Number(value).toLocaleString("en-US");
}

function el(tag, className, text) {
  var element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.innerText = text;
  return element;
}

/* ---------- Socket ---------- */

socket.on("connect", () => (document.getElementById("connectionBanner").hidden = true));
socket.on("disconnect", () => (document.getElementById("connectionBanner").hidden = false));
socket.on("connect_error", (error) => {
  if (error && error.message == "unauthorized") window.location.href = "/?next=" + encodeURIComponent(location.pathname + location.search);
});
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
  // While the reel rolls the balance shows the coins before the win
  if (!rolling) renderCoins();
  renderControls();
});
socket.on("rouletteError", (message) => showHint(message, "error"));

socket.on("rouletteState", (state) => {
  var first = table == null;
  table = state;
  rules = state.rules;
  if (first) buildReel();
  if (state.phase == "rolling" && rolledRound != state.round) playRoll(state);
  else if (first && state.history.length) standOn(state.history[0].slot);
  renderBoards();
  renderHistory();
  renderRounds();
  renderFair();
  renderControls();
  renderStatus();
});

/* ---------- The reel ---------- */

function buildReel() {
  var track = document.getElementById("rlTrack");
  var tiles = [];
  for (var copy = 0; copy < COPIES; copy++) {
    rules.wheel.forEach((slot, index) => {
      var tile = el("div", "rl-tile " + slot.color, String(slot.number));
      tile.dataset.slot = index;
      tiles.push(tile);
    });
  }
  track.replaceChildren(...tiles);
  var first = tiles[0];
  var gap = tiles[1].getBoundingClientRect().left - first.getBoundingClientRect().right;
  TILE = first.getBoundingClientRect().width + gap;
  // Without a result yet: somewhere in the middle
  standOn(0);
  window.addEventListener("resize", () => standOn(lastSlot));
}

var lastSlot = 0;
// The x of the middle of tile `index` under the marker
function offsetFor(index, jitter) {
  var width = document.querySelector(".rl-reel").clientWidth;
  return index * TILE + TILE / 2 + (jitter || 0) - width / 2;
}

// The reel stands still on `slot` (in the middle copy)
function standOn(slot) {
  lastSlot = slot;
  if (rolling) return;
  var track = document.getElementById("rlTrack");
  track.getAnimations().forEach((animation) => animation.cancel());
  reelAt = offsetFor(rules.wheel.length * 2 + slot);
  track.style.transform = "translateX(" + -reelAt + "px)";
  markWinner(table && table.phase == "rolling" ? null : slot);
}

function markWinner(slot) {
  document.querySelectorAll(".rl-tile.won").forEach((tile) => tile.classList.remove("won"));
  if (slot == null) return;
  var middle = document.querySelectorAll(".rl-tile")[rules.wheel.length * 2 + slot];
  if (middle) middle.classList.add("won");
}

// The roll: from where the reel stands to the slot the server rolled (a page that comes in late joins in)
function playRoll(state) {
  rolledRound = state.round;
  rolling = true;
  var track = document.getElementById("rlTrack");
  markWinner(null);
  document.querySelectorAll(".rl-board").forEach((board) => board.classList.remove("won", "lost"));
  var n = rules.wheel.length;
  // Start in the first copy on the slot it stands on, stop in the second last copy
  var from = offsetFor(lastSlot + n);
  // (where in the slot it stops: the same on every page of this round)
  var jitter = (((state.round * 9301 + 49297) % 233280) / 233280 - 0.5) * TILE * 0.7;
  var to = offsetFor(n * (COPIES - 2) + state.slot, jitter);
  var duration = rules.spin - 900;
  var spin = track.animate(
    [
      { transform: "translateX(" + -from + "px)", easing: "cubic-bezier(0.1, 0.55, 0.12, 1)" },
      { transform: "translateX(" + -to + "px)" },
    ],
    { duration: duration, fill: "forwards" },
  );
  spin.currentTime = Math.max(0, Math.min(duration, rules.spin - (state.rollLeft || 0)));
  spin.finished
    .catch(() => {})
    .then(() => {
      // Settled: the reel jumps to the same spot in the middle copy (no visible change)
      rolling = false;
      spin.cancel();
      reelAt = offsetFor(n * 2 + state.slot, jitter);
      track.style.transform = "translateX(" + -reelAt + "px)";
      lastSlot = state.slot;
      markWinner(state.slot);
      showResult(state);
      renderHistory();
      renderRounds();
      renderFair();
      renderControls();
    });
}

// The reel stopped: the colors that won, what I won
function showResult(state) {
  var color = rules.wheel[state.slot].color;
  document.querySelectorAll(".rl-board").forEach((board) => {
    board.classList.toggle("won", board.dataset.color == color);
    board.classList.toggle("lost", board.dataset.color != color);
  });
  var mine = table.bets.filter((bet) => bet.name == myName);
  var won = mine.filter((bet) => bet.color == color).reduce((sum, bet) => sum + bet.amount * rules.payout[color], 0);
  var status = document.getElementById("rlStatus");
  status.className = "rl-status-text " + color;
  if (!mine.length) status.innerText = COLOR_NAMES[color] + " " + rules.wheel[state.slot].number;
  else if (won > 0) status.innerText = "You won 🪙 " + formatCoins(won) + "!";
  else status.innerText = COLOR_NAMES[color] + " " + rules.wheel[state.slot].number + " - not this time";
  renderCoins();
}

/* ---------- The round ---------- */

var statusTimer = null;
function renderStatus() {
  clearInterval(statusTimer);
  var status = document.getElementById("rlStatus");
  var bar = document.getElementById("rlTimer");
  if (table.phase == "idle") {
    status.className = "rl-status-text";
    status.innerText = "Place a bet to start the round";
    bar.style.width = "0%";
    return;
  }
  if (table.phase == "rolling") {
    bar.style.width = "0%";
    if (rolling) {
      status.className = "rl-status-text";
      status.innerText = "Rolling...";
    }
    return;
  }
  // Betting: the timer runs
  var endsAt = Date.now() + table.timeLeft;
  var tick = () => {
    var left = Math.max(0, endsAt - Date.now());
    status.className = "rl-status-text";
    status.innerText = "Rolling in " + (left / 1000).toFixed(1) + " s";
    bar.style.width = (left / rules.timer) * 100 + "%";
    if (left <= 0) clearInterval(statusTimer);
  };
  tick();
  statusTimer = setInterval(tick, 100);
}

// My bets this round: {red, blue, green}
function myBets() {
  var sums = { red: 0, blue: 0, green: 0 };
  if (table) table.bets.forEach((bet) => bet.name == myName && (sums[bet.color] += bet.amount));
  return sums;
}

function renderBoards() {
  ["red", "green", "blue"].forEach((color) => {
    var bets = table.bets.filter((bet) => bet.color == color);
    // One row per player (all their bets on the color together), the biggest first
    var players = new Map();
    bets.forEach((bet) => players.set(bet.name, (players.get(bet.name) || 0) + bet.amount));
    var rows = [...players].sort((a, b) => b[1] - a[1]);
    document.querySelector('[data-count="' + color + '"]').innerText = rows.length + (rows.length == 1 ? " player" : " players");
    document.querySelector('[data-total="' + color + '"]').innerText = "🪙 " + formatCoins(bets.reduce((sum, bet) => sum + bet.amount, 0));
    document.querySelector('[data-bets="' + color + '"]').replaceChildren(
      ...rows.map(([name, amount]) => {
        var row = el("li", "rl-bet" + (name == myName ? " mine" : ""));
        var who = el("span", "rl-bet-name");
        who.append(createAvatar(name, "sm"), el("span", "", name));
        if (name == myName) who.appendChild(el("span", "you-tag", "You"));
        row.append(who, el("span", "rl-bet-amount", "🪙 " + formatCoins(amount)));
        return row;
      }),
    );
  });
  // A new round: no colors that won
  if (table.phase != "rolling") document.querySelectorAll(".rl-board").forEach((board) => board.classList.remove("won", "lost"));
}

function renderHistory() {
  var list = document.getElementById("rlHistory");
  // (while the reel rolls the newest is not known on this page yet)
  var history = table.history.filter((entry) => !(rolling && entry.round == table.round));
  list.replaceChildren(...history.map((entry) => el("span", "rl-dot " + entry.color, String(entry.number))));
}

function renderRounds() {
  var list = document.getElementById("rlRounds");
  var history = table.history.filter((entry) => !(rolling && entry.round == table.round));
  document.getElementById("rlRoundsEmpty").hidden = history.length > 0;
  list.replaceChildren(
    ...history.slice(0, 10).map((entry) => {
      var item = el("li", "jp-history-item rl-round");
      item.appendChild(el("span", "rl-dot " + entry.color, String(entry.number)));
      var info = el("div", "jp-history-text");
      var top = entry.winners && entry.winners[0];
      info.append(
        el("b", "", top ? top.name + (entry.winners.length > 1 ? " +" + (entry.winners.length - 1) : "") : "Nobody won"),
        el("small", "", "Round " + entry.round + " · " + (entry.players || 0) + (entry.players == 1 ? " player" : " players") + " · 🪙 " + formatCoins(entry.total || 0) + " bet"),
      );
      item.appendChild(info);
      item.appendChild(el("span", "jp-history-won", top ? "🪙 " + formatCoins(top.win) : ""));
      return item;
    }),
  );
}

function renderFair() {
  var fair = document.getElementById("rlFair");
  var part = (label, value) => {
    var box = el("span", "jp-fair-part");
    box.append(el("span", "jp-fair-label", label), el("code", "", value));
    return box;
  };
  var parts = [el("i", "bi bi-shield-check"), part("Round hash", table.fair.hash)];
  if (table.fair.seed && !rolling) parts.push(part("Seed", table.fair.seed));
  fair.title = "Provably fair: the slot comes from the seed (hmac-sha256(seed, \"roulette:\" + round)). sha256(seed) = round hash";
  fair.replaceChildren(...parts);
}

/* ---------- Amount and bets ---------- */

function renderCoins() {
  document.getElementById("rlCoins").innerText = "🪙 " + formatCoins(myCoins);
}

function amount() {
  return Math.floor(Number(document.getElementById("rlAmount").value));
}

function setAmount(value) {
  var input = document.getElementById("rlAmount");
  input.value = Math.max(0, Math.floor(value)) || "";
  try {
    localStorage.setItem(AMOUNT_KEY, input.value);
  } catch (error) {
    // not remembered
  }
  renderControls();
}

// What is still allowed this round (all colors together)
function roomLeft() {
  var mine = myBets();
  return Math.max(0, rules.maxBet - mine.red - mine.blue - mine.green);
}

var CHIPS = [
  ["Clear", () => 0],
  ["+10", (v) => v + 10],
  ["+100", (v) => v + 100],
  ["+1K", (v) => v + 1000],
  ["½", (v) => v / 2],
  ["×2", (v) => v * 2],
  ["Max", () => Math.min(myCoins, roomLeft())],
];

function buildChips() {
  var box = document.getElementById("rlChips");
  box.replaceChildren(
    ...CHIPS.map(([label, change]) => {
      var chip = el("button", "rl-chip", label);
      chip.type = "button";
      chip.addEventListener("click", () => rules && setAmount(Math.min(change(amount() || 0), rules.maxBet)));
      return chip;
    }),
  );
}

function renderControls() {
  if (!table) return;
  var mine = myBets();
  var value = amount();
  var open = table.phase != "rolling";
  document.querySelectorAll(".rl-place").forEach((button) => {
    var color = button.dataset.color;
    var blocked = (color == "red" && mine.blue > 0) || (color == "blue" && mine.red > 0);
    button.disabled = !open || blocked || !(value >= rules.minBet) || value > myCoins || value > roomLeft();
    button.closest(".rl-board").classList.toggle("blocked", blocked);
    button.title = blocked ? "You bet on " + (color == "red" ? "blue" : "red") + " this round" : !open ? "The reel rolls - the next round soon" : value > roomLeft() ? "At most 🪙 " + formatCoins(rules.maxBet) + " per round" : value > myCoins ? "Not enough coins" : "Bet 🪙 " + formatCoins(value || 0) + " on " + COLOR_NAMES[color].toLowerCase();
    // My bet on the color
    var mineBox = button.querySelector(".rl-place-mine");
    if (mine[color] > 0) {
      if (!mineBox) button.appendChild((mineBox = el("span", "rl-place-mine")));
      mineBox.innerText = "You: 🪙 " + formatCoins(mine[color]);
    } else if (mineBox) mineBox.remove();
  });
}

function place(color) {
  if (!rules) return;
  var value = amount();
  if (!(value >= rules.minBet)) return showHint("At least 🪙 " + formatCoins(rules.minBet) + " per bet.", "error", document.getElementById("rlAmount"));
  socket.emit("bet", { color: color, amount: value });
}

document.addEventListener("DOMContentLoaded", () => {
  buildChips();
  var input = document.getElementById("rlAmount");
  var saved = null;
  try {
    saved = localStorage.getItem(AMOUNT_KEY);
  } catch (error) {
    // nothing saved
  }
  input.value = saved || 100;
  input.addEventListener("input", () => setAmount(amount()));
  document.querySelectorAll(".rl-place").forEach((button) => button.addEventListener("click", () => place(button.dataset.color)));
});
