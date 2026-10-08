/*
 * The leaderboard of the casino: live without a season, during a season as
 * often as the season says (the server decides). After a season: its winner page.
 */
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
var refreshTimer = null;
var EVERY_TEXT = { 5: "every 5 minutes", 15: "every 15 minutes", 60: "every hour", 360: "every 6 hours", 1440: "once a day at midnight" };
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
  spot.dataset.rank = row.rank;
  spot.append(el("span", "lb-medal", MEDALS[row.rank - 1]), createAvatar(row.username, "lg"), nameOf(row.username, "lb-name"), el("span", "lb-coins", "🪙 " + formatCoins(row.coins)), change(row));
  if (row.prize) spot.appendChild(el("span", "lb-prize", "🎁 " + row.prize));
  if (row.decided) spot.appendChild(decidedOf(row));
  spot.appendChild(el("div", "lb-step", String(row.rank)));
  return spot;
}

// The same coins on a prize place: what decided the prize (only then, only what made the difference)
function decidedOf(row) {
  if (!row.decided) return null;
  var parts = [];
  if (row.decided.chances != null) parts.push("💔 " + row.decided.chances + " second chance" + (row.decided.chances == 1 ? "" : "s"));
  if (row.decided.bets != null) parts.push("🎲 " + formatCoins(row.decided.bets) + " bet" + (row.decided.bets == 1 ? "" : "s"));
  var tag = el("span", "lb-decided", parts.join(" · "));
  tag.title = "The same coins as others - for the prize: fewer second chances first, then more bets";
  return tag;
}

// The name, with the "You" tag on your own row
function nameOf(username, className) {
  var name = el("span", className, username);
  if (username == myName) name.appendChild(el("span", "you-tag", "You"));
  return name;
}

function listRow(row) {
  var item = el("li", "lb-row" + (row.username == myName ? " mine" : ""));
  item.dataset.rank = row.rank;
  var who = el("span", "lb-who");
  who.append(createAvatar(row.username, "sm"), nameOf(row.username, "lb-name"));
  if (row.prize) who.appendChild(el("span", "lb-prize", "🎁 " + row.prize));
  if (row.decided) who.appendChild(decidedOf(row));
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
  var season = board.season;
  document.getElementById("lbStatus").innerText = board.live ? "Live - always up to date" : "As of " + when + " - updated " + (EVERY_TEXT[season && season.every] || "regularly");

  // The season: its name, how long it runs, the prizes
  var box = document.getElementById("lbSeason");
  box.hidden = !season;
  if (season) {
    var left = season.end - Date.now();
    var parts = [el("span", "lb-season-icon", season.icon)];
    var text = el("div", "lb-season-text");
    text.append(el("b", "", season.name), el("span", "", "ends in " + spanText(left)));
    parts.push(text);
    // The season to look at: like its start screen
    var info = el("button", "cs-info-btn lb-season-info", "i");
    info.type = "button";
    info.title = "About the season";
    info.setAttribute("aria-label", "About the season");
    parts.push(info);
    box.replaceChildren(...parts);
    box.onclick = () => window.showSeasonInfo && window.showSeasonInfo();
    box.title = "Ends " + new Date(season.end).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }
  // The last season that is over: the way to its winners
  var last = document.getElementById("lbLastSeason");
  last.hidden = !board.lastSeason || !!season;
  if (board.lastSeason) {
    last.replaceChildren(el("span", "lb-last-icon", board.lastSeason.icon), el("span", "", board.lastSeason.name + " is over - see the winners"), el("span", "lb-last-arrow", "→"));
    last.onclick = () => showWinners(board.lastSeason.id);
  }

  // The box on the right: when the next update comes
  document.getElementById("lbNextTitle").lastChild.textContent = board.live ? "Live" : "Next update";
  document.getElementById("lbNextNote").innerText = board.live
    ? "The places are counted all the time - the arrows show the change since midnight."
    : "The places of the season are counted " + (EVERY_TEXT[season && season.every] || "regularly") + " - the arrows show the change since the update before.";
}


// "3d 4h" / "5h 12m" / "8m"
function spanText(ms) {
  var minutes = Math.max(0, Math.round(ms / 60000));
  var d = Math.floor(minutes / 1440);
  var h = Math.floor((minutes % 1440) / 60);
  var m = minutes % 60;
  return d > 0 ? d + "d " + h + "h" : h > 0 ? h + "h " + String(m).padStart(2, "0") + "m" : m + "m";
}

function tick() {
  var next = document.getElementById("lbNext");
  if (board && board.live) {
    next.replaceChildren(el("span", "lb-live-dot"), document.createTextNode("Live"));
    return;
  }
  if (nextAt == null) return;
  var left = Math.max(0, nextAt - Date.now());
  next.innerText = left == 0 ? "Any moment now" : "in " + spanText(left + 59000);
}

// Live: every few seconds; otherwise at the next update
async function load(quiet) {
  clearTimeout(refreshTimer);
  try {
    var res = await fetch("leaderboard/data", { cache: "no-store" });
    if (!res.ok) throw new Error();
    board = await res.json();
    nextAt = board.nextIn == null ? null : Date.now() + board.nextIn;
    render();
    tick();
  } catch (error) {
    if (!quiet) showToast("The leaderboard couldn't be loaded.", "error");
  }
  var wait = board && board.live ? 10000 : nextAt ? Math.max(3000, nextAt - Date.now() + 2000) : 30000;
  refreshTimer = setTimeout(() => load(true), Math.min(wait, 10 * 60 * 1000));
}

/* ---------- The winner page of a season ---------- */

// Coloured bits falling (only a moment)
function confetti(root) {
  var colors = ["#c9a24a", "#6fa784", "#7895c4", "#9d84c2", "#c2706a", "#f3d27a"];
  for (var i = 0; i < 70; i++) {
    var bit = el("span", "lb-confetti");
    bit.style.left = Math.random() * 100 + "%";
    bit.style.background = colors[i % colors.length];
    root.appendChild(bit);
    var fall = 320 + Math.random() * 260;
    bit.animate(
      [
        { transform: "translateY(-20px) rotate(0deg)", opacity: 1 },
        { transform: `translate(${Math.random() * 80 - 40}px, ${fall}px) rotate(${Math.random() * 720 - 360}deg)`, opacity: 0 },
      ],
      { duration: 1800 + Math.random() * 1600, delay: Math.random() * 900, easing: "cubic-bezier(0.25, 0.4, 0.6, 1)", fill: "both" },
    ).finished.then(((b) => () => b.remove())(bit));
  }
}

function winnerSpot(row) {
  var spot = el("div", "lb-spot place-" + row.rank + (row.username == myName ? " mine" : ""));
  if (row.rank == 1) spot.appendChild(el("span", "lb-crown", "👑"));
  spot.append(el("span", "lb-medal", MEDALS[row.rank - 1]), createAvatar(row.username, "lg"), nameOf(row.username, "lb-name"), el("span", "lb-coins", "🪙 " + formatCoins(row.coins)));
  if (row.prize) spot.appendChild(el("span", "lb-prize", "🎁 " + row.prize));
  if (row.decided) spot.appendChild(decidedOf(row));
  spot.appendChild(el("div", "lb-step", String(row.rank)));
  return spot;
}

async function showWinners(id) {
  try {
    var res = await fetch("leaderboard/season/" + id, { cache: "no-store" });
    if (!res.ok) throw new Error();
    var data = await res.json();
  } catch (error) {
    return showToast("The winners couldn't be loaded.", "error");
  }
  var season = data.season;
  var page = document.getElementById("lbWinners");
  var head = el("div", "lb-win-head");
  var back = el("button", "lb-win-back", "← Leaderboard");
  back.type = "button";
  back.addEventListener("click", hideWinners);
  var title = el("div", "lb-win-title");
  title.append(el("span", "lb-win-label", "Season over"), el("h1", "", season.name), el("span", "lb-win-sub", new Date(season.endedAt || season.end).toLocaleDateString(undefined, { dateStyle: "long" }) + " · " + data.players + (data.players == 1 ? " player" : " players")));
  head.append(el("span", "lb-win-icon", season.icon), title, back);

  var parts = [head];
  if (data.rows.length) {
    var champ = data.rows[0];
    var hero = el("div", "lb-champion");
    hero.append(el("span", "lb-win-label", "The winner"), el("div", "lb-champion-name", champ.username + (champ.username == myName ? " (you!)" : "")), el("div", "lb-champion-coins", "🪙 " + formatCoins(champ.coins)));
    if (champ.prize) hero.appendChild(el("div", "lb-champion-prize", "🎁 " + champ.prize));
    parts.push(hero);
    var top = data.rows.slice(0, 3);
    var podium = el("div", "lb-podium lb-win-podium");
    podium.append(...[top[1], top[0], top[2]].filter(Boolean).map(winnerSpot));
    parts.push(podium);
  }
  if (data.me) {
    var me = el("div", "lb-me");
    me.append(el("span", "lb-me-label", "Your place"), el("span", "lb-me-rank", "#" + data.me.rank + " of " + data.players), el("span", "lb-coins", "🪙 " + formatCoins(data.me.coins)));
    if (data.me.prize) me.appendChild(el("span", "lb-prize", "🎁 " + data.me.prize));
    parts.push(me);
  }
  var list = el("ol", "lb-list");
  data.rows.slice(3).forEach((row) => {
    var item = el("li", "lb-row" + (row.username == myName ? " mine" : ""));
    var who = el("span", "lb-who");
    who.append(createAvatar(row.username, "sm"), nameOf(row.username, "lb-name"));
    if (row.decided) who.appendChild(decidedOf(row));
    item.append(el("span", "lb-rank", "#" + row.rank), who, row.prize ? el("span", "lb-prize", "🎁 " + row.prize) : el("span"), el("span", "lb-coins", "🪙 " + formatCoins(row.coins)));
    list.appendChild(item);
  });
  parts.push(list);
  if (!data.rows.length) parts.push(el("p", "jp-empty mm-muted", "Nobody played this season."));
  page.replaceChildren(...parts);
  page.hidden = false;
  document.getElementById("lbBoard").hidden = true;
  history.replaceState(null, "", "leaderboard?season=" + id);
  window.scrollTo({ top: 0 });
  confetti(page);
}

function hideWinners() {
  document.getElementById("lbWinners").hidden = true;
  document.getElementById("lbBoard").hidden = false;
  history.replaceState(null, "", "leaderboard");
}

// (casino_wallet.js: a season just ended - its winners right away)
window.showWinners = showWinners;

document.addEventListener("DOMContentLoaded", () => {
  setupChat();
  load();
  setInterval(tick, 20000);
  var season = new URLSearchParams(location.search).get("season");
  if (season) showWinners(season);
});
