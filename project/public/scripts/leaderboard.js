/* The leaderboard of the casino: made once a day on the server, this page only shows it. */
// The connection of the jackpot: the chat, the coins at the top and the daily bonus
const socket = io("/jackpot");

var myName = null;

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

socket.on("connect", () => (document.getElementById("connectionBanner").hidden = true));
socket.on("disconnect", () => (document.getElementById("connectionBanner").hidden = false));
socket.on("connect_error", (error) => {
  if (error && error.message == "unauthorized") window.location.href = "/";
});
// The admin took the access away
socket.on("casinoClosed", () => (window.location.href = "/"));
socket.on("joined", (data) => {
  myName = data.username;
  if (board) render();
});

window.addEventListener("pagehide", () => socket.disconnect());
window.addEventListener("pageshow", (event) => {
  if (event.persisted) socket.connect();
});

/* ---------- The board ---------- */

var board = null;
var nextAt = null;
var MEDALS = ["🥇", "🥈", "🥉"];

// Up or down since the day before (new: no place the day before)
function change(row) {
  if (row.before == null) return el("span", "lb-change new", "new");
  var diff = row.before - row.rank;
  if (diff > 0) return el("span", "lb-change up", "▲ " + diff);
  if (diff < 0) return el("span", "lb-change down", "▼ " + -diff);
  return el("span", "lb-change same", "–");
}

function podiumSpot(row) {
  var spot = el("div", "lb-spot place-" + row.rank + (row.username == myName ? " mine" : ""));
  spot.append(el("span", "lb-medal", MEDALS[row.rank - 1]), createAvatar(row.username, "lg"), nameOf(row.username, "lb-name"), el("span", "lb-coins", "🪙 " + formatCoins(row.coins)), change(row));
  spot.appendChild(el("div", "lb-step", String(row.rank)));
  return spot;
}

// The name, with the "You" tag on your own row
function nameOf(username, className) {
  var name = el("span", className, username);
  if (username == myName) name.appendChild(el("span", "you-tag", "You"));
  return name;
}

function listRow(row) {
  var item = el("li", "lb-row" + (row.username == myName ? " mine" : ""));
  var who = el("span", "lb-who");
  who.append(createAvatar(row.username, "sm"), nameOf(row.username, "lb-name"));
  item.append(el("span", "lb-rank", "#" + row.rank), who, change(row), el("span", "lb-coins", "🪙 " + formatCoins(row.coins)));
  return item;
}

function render() {
  var rows = board.rows;
  document.getElementById("lbEmpty").hidden = rows.length > 0;
  // The podium: 2nd, 1st, 3rd
  var top = rows.slice(0, 3);
  var order = [top[1], top[0], top[2]].filter(Boolean);
  document.getElementById("lbPodium").replaceChildren(...order.map(podiumSpot));
  document.getElementById("lbList").replaceChildren(...rows.slice(3).map(listRow));

  // The own place, also when it is not in the list
  var me = document.getElementById("lbMe");
  me.hidden = board.me == null;
  if (board.me) {
    me.replaceChildren(el("span", "lb-me-label", "Your place"), el("span", "lb-me-rank", "#" + board.me.rank + " of " + board.players), change(board.me), el("span", "lb-coins", "🪙 " + formatCoins(board.me.coins)));
  }
  var when = new Date(board.updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  document.getElementById("lbStatus").innerText = "As of " + when + " - updated once a day at midnight";
}

function tick() {
  if (nextAt == null) return;
  var left = Math.max(0, nextAt - Date.now());
  var hours = Math.floor(left / 3600000);
  var minutes = Math.floor((left % 3600000) / 60000);
  document.getElementById("lbNext").innerText = left == 0 ? "Any moment now" : "in " + hours + "h " + String(minutes).padStart(2, "0") + "m";
  // A new day: the new leaderboard
  if (left == 0) setTimeout(load, 3000);
}

async function load() {
  try {
    var res = await fetch("leaderboard/data", { cache: "no-store" });
    if (!res.ok) throw new Error();
    board = await res.json();
    nextAt = Date.now() + board.nextIn;
    render();
    tick();
  } catch (error) {
    showToast("The leaderboard couldn't be loaded.", "error");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setupChat();
  load();
  setInterval(tick, 30000);
});
