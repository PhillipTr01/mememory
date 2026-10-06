/* Hidden case battles: the server decides every item, this page only shows them. */
const socket = io("/battles");

var myName = null;
var myCoins = 0;
var CASES = []; // catalog from the server
var battles = []; // every battle the server knows
var lastBattles = []; // finished battles, newest first
var roundTime = 4500;

var picked = []; // the new battle: case ids, one per round, in their order
var size = 2;
var filter = "all";
var sort = "price-asc";
var crazy = false;

var viewId = null; // the battle that is open (location.hash)
var seen = {}; // id -> {phase, revealed} the last state this page saw
var shown = {}; // id -> rounds already shown (the spin of a round runs first)
var spinning = false;
var celebrated = new Set();
var statusTimer = null;

var SLOW_END = "cubic-bezier(0.22, 0.61, 0.36, 1)";
var TILE = 72; // height of an item in the reel

// Used by chat.js
function chatUsername() {
  return myName;
}

function formatCoins(value) {
  return Number(value).toLocaleString("en-US");
}

function caseById(id) {
  return CASES.find((box) => box.id == id);
}

function el(tag, className, text) {
  var element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.innerText = text;
  return element;
}

function animate(element, frames, options) {
  return element.animate(frames, Object.assign({ fill: "forwards" }, options)).finished.catch(() => {});
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
  renderCreate();
  renderList();
  if (!spinning) renderBattle();
});

socket.on("cases", (data) => {
  CASES = data;
  renderCases();
  renderCreate();
});

socket.on("battleError", (message) => showToast(message, "error"));

// The new battle of this page: open it
socket.on("battleCreated", (id) => {
  picked = [];
  renderCreate();
  openBattle(id);
});

socket.on("battles", (data) => {
  battles = data.list;
  lastBattles = data.history;
  roundTime = data.round;
  battles.forEach(track);
  renderList();
  renderHistory();
  if (!spinning) renderBattle();
});

/*
 * What changed since the last state: a new round of the open battle is spun
 * (only when this page saw the round before it - opened in the middle of a
 * battle, the rounds so far are just shown).
 */
function track(battle) {
  var before = seen[battle.id];
  seen[battle.id] = { phase: battle.phase, revealed: battle.revealed };
  if (!(battle.id in shown)) {
    shown[battle.id] = battle.revealed;
    return;
  }
  if (battle.id != viewId) {
    shown[battle.id] = battle.revealed;
    return;
  }
  var live = before && battle.revealed == before.revealed + 1 && battle.revealed == shown[battle.id] + 1;
  if (live && !spinning) {
    playRound(battle, battle.revealed - 1);
  } else if (!spinning) {
    shown[battle.id] = battle.revealed;
  }
  if (battle.phase == "done" && before && before.phase == "running") celebrate(battle);
}

// Once: may the browser tell when a battle starts while another tab is open?
function askForNotifications() {
  try {
    if (window.Notification && Notification.permission == "default") Notification.requestPermission();
  } catch (e) {
    // not supported
  }
}

/* ---------- Views ---------- */

function openBattle(id) {
  if (location.hash != "#" + id) pushView(id);
  showView();
}

function pushView(id) {
  window.history.pushState(null, "", id ? "#" + id : location.pathname);
}

function showView() {
  viewId = location.hash.length > 1 ? location.hash.slice(1) : null;
  if (viewId) shown[viewId] = (battles.find((b) => b.id == viewId) || { revealed: 0 }).revealed;
  spinning = false;
  document.getElementById("btListView").hidden = viewId != null;
  document.getElementById("btBattleView").hidden = viewId == null;
  renderBattle();
}

window.addEventListener("popstate", showView);

/* ---------- Cases and the new battle ---------- */

var RISKS = { low: "🛡️ Low risk", balanced: "⚖️ Balanced", high: "🔥 High risk" };

function riskBadge(risk) {
  return el("span", "bt-risk " + risk, RISKS[risk] || risk);
}

function bestItem(box) {
  return box.items.reduce((best, item) => (item.value > best.value ? item : best), box.items[0]);
}

// Every round of the new battle, in order
function pickedIds() {
  return picked.slice();
}

function countOf(id) {
  return picked.filter((p) => p == id).length;
}

// A round to another place in the order
function movePicked(from, to) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from == to || from < 0 || from >= picked.length) return;
  to = Math.max(0, Math.min(picked.length - 1, to));
  var [id] = picked.splice(from, 1);
  picked.splice(to, 0, id);
  renderCreate();
}

function shufflePicked() {
  for (var i = picked.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    [picked[i], picked[j]] = [picked[j], picked[i]];
  }
  renderCreate();
}

/*
 * The card of a case: more = new rounds at the end (Whale, Vault, Whale is
 * possible), fewer = the last rounds of this case go.
 */
function setCount(id, count) {
  count = Math.max(0, Math.floor(Number(count)) || 0);
  var diff = count - countOf(id);
  for (; diff > 0; diff--) picked.push(id);
  for (var i = picked.length - 1; i >= 0 && diff < 0; i--) {
    if (picked[i] != id) continue;
    picked.splice(i, 1);
    diff++;
  }
  renderCreate();
}

// - count + on the card of a case
function stepper(id, extraClass) {
  var box = el("div", "bt-stepper" + (extraClass ? " " + extraClass : ""));
  box.addEventListener("click", (event) => event.stopPropagation());
  var minus = el("button", "", "−");
  minus.type = "button";
  minus.setAttribute("aria-label", "One less");
  minus.addEventListener("click", () => setCount(id, countOf(id) - 1));
  var input = el("input", "bt-stepper-count");
  input.type = "number";
  input.min = 0;
  input.inputMode = "numeric";
  input.dataset.id = id;
  input.setAttribute("aria-label", "How many");
  input.value = countOf(id);
  input.addEventListener("change", () => setCount(id, input.value));
  input.addEventListener("keydown", (event) => event.stopPropagation());
  var plus = el("button", "", "+");
  plus.type = "button";
  plus.setAttribute("aria-label", "One more");
  plus.addEventListener("click", () => setCount(id, countOf(id) + 1));
  box.append(minus, input, plus);
  return box;
}

function sortedCases() {
  var list = CASES.filter((box) => filter == "all" || box.risk == filter);
  var by = {
    "price-asc": (a, b) => a.price - b.price,
    "price-desc": (a, b) => b.price - a.price,
    "best-desc": (a, b) => bestItem(b).value - bestItem(a).value,
  }[sort];
  return list.slice().sort((a, b) => by(a, b) || a.name.localeCompare(b.name));
}

function renderCases() {
  var grid = document.getElementById("btCases");
  grid.replaceChildren(
    ...sortedCases().map((box) => {
      var card = el("div", "bt-case " + box.risk);
      card.dataset.id = box.id;
      card.tabIndex = 0;
      card.title = "Add " + box.name;
      var info = el("button", "bt-case-info");
      info.type = "button";
      info.title = "What's inside";
      info.setAttribute("aria-label", "What's inside " + box.name);
      info.appendChild(createIcon("bi-info"));
      info.addEventListener("click", (event) => {
        event.stopPropagation();
        showContents(box);
      });
      var best = bestItem(box);
      var top = el("span", "bt-case-best rarity-" + best.rarity);
      top.title = "Best item: " + best.name;
      top.append(el("span", "", best.icon), document.createTextNode(" up to 🪙 " + formatCoins(best.value)));
      card.append(
        info,
        el("span", "bt-case-icon", box.icon),
        el("span", "bt-case-name", box.name),
        riskBadge(box.risk),
        top,
        el("span", "bt-case-price", "🪙 " + formatCoins(box.price)),
        stepper(box.id, "on-card"),
      );
      var add = () => setCount(box.id, countOf(box.id) + 1);
      card.addEventListener("click", add);
      card.addEventListener("keydown", (event) => {
        if (event.key == "Enter" || event.key == " ") {
          event.preventDefault();
          add();
        }
      });
      return card;
    }),
  );
  renderCreate();
}

function price(ids) {
  return ids.reduce((sum, id) => sum + (caseById(id) ? caseById(id).price : 0), 0);
}

function renderCreate() {
  var ids = pickedIds();
  var list = document.getElementById("btPicked");
  if (picked.length == 0) {
    list.replaceChildren(el("span", "mm-muted small bt-picked-empty", "Click a case to add it - every case is one round, as many as you like."));
  } else {
    // One card per round, side by side: drag a card to another place, × takes it out
    list.replaceChildren(
      ...picked.map((id, index) => {
        var box = caseById(id);
        var card = el("div", "bt-round " + box.risk);
        card.draggable = true;
        card.title = "Round " + (index + 1) + " - drag to another place";
        var remove = el("button", "bt-round-remove", "×");
        remove.type = "button";
        remove.title = "Take this round out";
        remove.setAttribute("aria-label", "Take round " + (index + 1) + " out");
        remove.addEventListener("click", () => {
          picked.splice(index, 1);
          renderCreate();
        });
        var moves = el("div", "bt-round-moves");
        var left = el("button", "", "‹");
        left.type = "button";
        left.title = "Earlier";
        left.disabled = index == 0;
        left.addEventListener("click", () => movePicked(index, index - 1));
        var right = el("button", "", "›");
        right.type = "button";
        right.title = "Later";
        right.disabled = index == picked.length - 1;
        right.addEventListener("click", () => movePicked(index, index + 1));
        moves.append(left, right);
        card.append(
          el("span", "bt-round-number", index + 1),
          remove,
          el("span", "bt-round-icon", box.icon),
          el("span", "bt-round-name", box.name),
          el("span", "bt-round-price", "🪙 " + formatCoins(box.price)),
          moves,
        );
        card.addEventListener("dragstart", (event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", String(index));
          card.classList.add("dragging");
        });
        card.addEventListener("dragend", () => card.classList.remove("dragging"));
        card.addEventListener("dragover", (event) => {
          event.preventDefault();
          card.classList.add("drop");
        });
        card.addEventListener("dragleave", () => card.classList.remove("drop"));
        card.addEventListener("drop", (event) => {
          event.preventDefault();
          movePicked(Number(event.dataTransfer.getData("text/plain")), index);
        });
        return card;
      }),
    );
  }
  // The counters on the cards (not the one being typed in)
  document.querySelectorAll(".bt-case").forEach((card) => {
    var n = countOf(card.dataset.id);
    card.classList.toggle("picked", n > 0);
    var input = card.querySelector(".bt-stepper-count");
    if (input && document.activeElement != input) input.value = n;
  });
  var cost = price(ids);
  document.getElementById("btSummary").innerText = ids.length
    ? ids.length + (ids.length == 1 ? " round" : " rounds") + " · 🪙 " + formatCoins(cost) + " per player"
    : "";
  document.getElementById("btClear").hidden = ids.length == 0;
  document.getElementById("btShuffle").hidden = picked.length < 2;
  var button = document.getElementById("btCreate");
  document.getElementById("btCreateLabel").innerText = ids.length ? "Create for 🪙 " + formatCoins(cost) : "Create";
  button.disabled = ids.length == 0 || cost > myCoins;
  button.title = cost > myCoins ? "Not enough coins" : "";
}

function showContents(box) {
  var backdrop = el("div", "mm-dialog-backdrop");
  var dialog = el("div", "mm-dialog bt-contents");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  var title = el("h2", "mm-dialog-title");
  title.append(document.createTextNode(box.icon + " " + box.name + " "), riskBadge(box.risk));
  var sub = el("p", "mm-dialog-text", "🪙 " + formatCoins(box.price) + " per case");
  var rows = el("div", "bt-contents-list");
  box.items
    .slice()
    .sort((a, b) => b.value - a.value)
    .forEach((item) => {
      var row = el("div", "bt-contents-row rarity-" + item.rarity);
      row.append(el("span", "bt-contents-icon", item.icon), el("span", "bt-contents-name", item.name), el("span", "bt-contents-value", "🪙 " + formatCoins(item.value)), el("span", "bt-contents-chance", chanceText(item.chance)));
      rows.appendChild(row);
    });
  var close = el("button", "mm-btn w-100", "Close");
  close.type = "button";
  dialog.append(title, sub, rows, close);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  var done = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
  };
  var onKey = (event) => event.key == "Escape" && done();
  document.addEventListener("keydown", onKey);
  close.addEventListener("click", done);
  backdrop.addEventListener("click", (event) => event.target == backdrop && done());
  close.focus();
}

function chanceText(chance) {
  var value = chance * 100;
  return (value >= 1 ? value.toFixed(value >= 10 ? 0 : 1) : value.toFixed(2)) + "%";
}

/* ---------- List of battles ---------- */

function isIn(battle) {
  return battle.seats.some((seat) => seat && seat.name == myName);
}

// The cases of a battle; many cases: only a window (around the current round)
function caseStrip(battle, current) {
  var strip = el("div", "bt-strip");
  var size = current != null ? 13 : 10;
  var from = current != null ? Math.max(0, Math.min(current - 3, battle.cases.length - size)) : 0;
  var to = Math.min(battle.cases.length, from + size);
  if (from > 0) strip.appendChild(el("span", "bt-strip-more", "+" + from));
  battle.cases.slice(from, to).forEach((id, n) => {
    var index = from + n;
    var box = caseById(id);
    var item = el("span", "bt-strip-case", box ? box.icon : "?");
    item.title = box ? box.name + " · 🪙 " + box.price : id;
    if (current != null) {
      if (index < current) item.classList.add("done");
      if (index == current) item.classList.add("current");
    }
    strip.appendChild(item);
  });
  if (to < battle.cases.length) strip.appendChild(el("span", "bt-strip-more", "+" + (battle.cases.length - to)));
  return strip;
}

function seatAvatars(battle) {
  var seats = el("div", "bt-seats-mini");
  battle.seats.forEach((seat, index) => {
    if (index > 0) seats.appendChild(el("span", "bt-vs", "vs"));
    if (seat == null) {
      seats.appendChild(el("span", "bt-empty-seat"));
    } else {
      var avatar = createAvatar(seat.name, "sm");
      avatar.title = seat.name + (seat.bot ? " (bot)" : "");
      seats.appendChild(avatar);
    }
  });
  return seats;
}

function phaseText(battle) {
  if (battle.phase == "waiting") return battle.seats.filter((s) => s == null).length + " seat(s) free";
  if (battle.phase == "running") return battle.revealed == 0 ? "Starting..." : "Round " + battle.revealed + " / " + battle.cases.length;
  var winner = battle.seats[battle.winner];
  return (winner.name == myName ? "You won" : winner.name + " won") + " 🪙 " + formatCoins(battle.payout);
}

function renderList() {
  var list = document.getElementById("btBattles");
  document.getElementById("btBattlesEmpty").hidden = battles.length > 0;
  var open = battles.filter((b) => b.phase == "waiting").length;
  document.getElementById("btCount").innerText = open == 1 ? "1 open" : open + " open";
  list.replaceChildren(
    ...battles.map((battle) => {
      var row = el("div", "bt-row phase-" + battle.phase + (isIn(battle) ? " mine" : ""));
      var info = el("div", "bt-row-info");
      var tags = el("div", "bt-row-tags");
      tags.append(el("span", "bt-row-price", "🪙 " + formatCoins(battle.price)), el("span", "mm-muted", battle.cases.length + (battle.cases.length == 1 ? " case" : " cases")));
      if (battle.crazy) tags.appendChild(el("span", "bt-crazy-tag", "🤡 Crazy"));
      info.append(caseStrip(battle), tags);
      var actions = el("div", "bt-row-actions");
      actions.appendChild(el("span", "bt-row-phase", phaseText(battle)));
      if (battle.phase == "waiting" && !isIn(battle)) {
        var join = el("button", "mm-btn mm-btn-sm mm-btn-primary", "Join");
        join.type = "button";
        join.disabled = battle.price > myCoins;
        join.addEventListener("click", (event) => {
          event.stopPropagation();
          askForNotifications();
          socket.emit("joinBattle", battle.id);
          openBattle(battle.id);
        });
        actions.appendChild(join);
      }
      var view = el("button", "mm-btn mm-btn-sm", "View");
      view.type = "button";
      view.addEventListener("click", () => openBattle(battle.id));
      actions.appendChild(view);
      row.append(seatAvatars(battle), info, actions);
      return row;
    }),
  );
}

function renderHistory() {
  var list = document.getElementById("btHistory");
  document.getElementById("btHistoryEmpty").hidden = lastBattles.length > 0;
  list.replaceChildren(
    ...lastBattles.map((entry) => {
      var item = el("li");
      var name = el("span", "jp-history-name");
      name.append(createAvatar(entry.winner, "sm"), document.createTextNode(entry.winner));
      var odds = el("span", "jp-history-odds", "🪙 " + formatCoins(entry.price));
      odds.title = "Price of the battle";
      item.append(name, odds, el("span", "jp-history-won", "🪙 " + formatCoins(entry.total)));
      return item;
    }),
  );
}

/* ---------- One battle ---------- */

function currentBattle() {
  return battles.find((battle) => battle.id == viewId) || null;
}

function itemOf(battle, round, seat) {
  return caseById(battle.cases[round]).items[battle.rounds[round][seat]];
}

function shownRounds(battle) {
  return Math.min(battle.revealed, shown[battle.id] != null ? shown[battle.id] : battle.revealed);
}

function totalOf(battle, seat, rounds) {
  var sum = 0;
  for (var r = 0; r < rounds; r++) sum += itemOf(battle, r, seat).value;
  return sum;
}

function itemTile(item, extraClass) {
  var tile = el("div", "bt-item rarity-" + item.rarity + (extraClass ? " " + extraClass : ""));
  tile.title = item.name + " · 🪙 " + formatCoins(item.value);
  tile.append(el("span", "bt-item-icon", item.icon), el("span", "bt-item-value", formatCoins(item.value)));
  return tile;
}

function renderBattle() {
  var view = document.getElementById("btBattleView");
  if (viewId == null) return;
  var battle = currentBattle();
  clearInterval(statusTimer);
  var back = el("button", "mm-btn mm-btn-sm bt-back");
  back.type = "button";
  back.append(createIcon("bi-arrow-left"), document.createTextNode(" All battles"));
  back.addEventListener("click", () => {
    pushView(null);
    showView();
  });
  if (battle == null) {
    view.replaceChildren(back, el("p", "jp-empty mm-muted", "This battle is over or was cancelled."));
    document.getElementById("btStatus").innerText = "";
    return;
  }

  var rounds = shownRounds(battle);
  var over = battle.phase == "done" && rounds == battle.cases.length && !spinning;

  var top = el("div", "bt-battle-top");
  var badges = el("div", "bt-row-tags");
  badges.append(el("span", "bt-row-price", "🪙 " + formatCoins(battle.price) + " to join"));
  if (battle.crazy) badges.appendChild(el("span", "bt-crazy-tag", "🤡 Crazy - lowest wins"));
  var pot = 0;
  battle.seats.forEach((_, seat) => (pot += totalOf(battle, seat, rounds)));
  badges.appendChild(el("span", "bt-pot", "Pot 🪙 " + formatCoins(pot)));
  top.append(back, badges);

  var strip = caseStrip(battle, battle.phase == "running" ? rounds : null);
  strip.classList.add("big");

  var grid = el("div", "bt-arena" + (over ? " over" : ""));
  grid.style.setProperty("--seats", battle.size);
  var totals = battle.seats.map((_, seat) => totalOf(battle, seat, rounds));
  var best = battle.crazy ? Math.min(...totals) : Math.max(...totals);
  var places = over ? placesOf(battle, totals) : null;
  battle.seats.forEach((seat, index) => {
    var column = el("div", "bt-seat");
    column.dataset.seat = index;
    if (over) column.classList.add(battle.winner == index ? "winner" : "lost");
    else if (rounds > 0 && totals[index] == best) column.classList.add("leading");
    var head = el("div", "bt-seat-head");
    if (seat == null) {
      head.classList.add("empty");
      head.appendChild(el("span", "bt-empty-seat"));
      if (battle.phase == "waiting" && !isIn(battle)) {
        var join = el("button", "mm-btn mm-btn-sm mm-btn-primary", "Join 🪙 " + formatCoins(battle.price));
        join.type = "button";
        join.disabled = battle.price > myCoins;
        join.addEventListener("click", () => {
          askForNotifications();
          socket.emit("joinBattle", battle.id);
        });
        head.appendChild(join);
      } else if (battle.creator == myName) {
        var bot = el("button", "mm-btn mm-btn-sm");
        bot.type = "button";
        bot.innerText = "🤖 Add bot";
        bot.addEventListener("click", () => socket.emit("addBot", battle.id));
        head.appendChild(bot);
      } else {
        head.appendChild(el("span", "mm-muted small", "Waiting..."));
      }
    } else {
      var name = el("div", "bt-seat-name");
      name.append(createAvatar(seat.name), el("span", "player-name-text", seat.name));
      if (seat.bot) name.appendChild(el("span", "player-tag", "Bot"));
      else if (seat.name == myName) name.appendChild(el("span", "player-tag", "You"));
      head.append(name, el("span", "bt-seat-total", "🪙 " + formatCoins(totals[index])));
    }
    var items = el("div", "bt-won");
    if (over) {
      // The end: the place instead of the reel, the items in the order they came
      column.append(head, finalTile(battle, index, places[index], totals[index]));
      for (var n = 0; n < rounds; n++) items.appendChild(itemTile(itemOf(battle, n, index)));
      column.appendChild(items);
    } else {
      var reel = el("div", "bt-reel");
      var last = rounds > 0 ? itemOf(battle, rounds - 1, index) : null;
      var window_ = el("div", "bt-reel-window");
      if (last && !spinning) window_.appendChild(itemTile(last, "big"));
      else window_.appendChild(el("span", "bt-reel-idle", battle.phase == "waiting" ? "?" : ""));
      reel.appendChild(window_);
      for (var r = rounds - 1; r >= 0; r--) items.appendChild(itemTile(itemOf(battle, r, index)));
      column.append(head, reel, items);
    }
    grid.appendChild(column);
  });

  var parts = over ? [top, resultHero(battle), strip, grid] : [top, strip, grid];
  if (battle.phase == "waiting" && battle.creator == myName) {
    var cancel = el("button", "mm-btn mm-btn-sm bt-cancel");
    cancel.type = "button";
    cancel.append(createIcon("bi-x-circle"), document.createTextNode(" Cancel battle (coins back)"));
    cancel.addEventListener("click", () => socket.emit("cancelBattle", battle.id));
    parts.push(cancel);
  }
  parts.push(fairLine(battle));
  view.replaceChildren(...parts);

  renderBattleStatus(battle);
  if (battle.phase == "running" && battle.revealed == 0 && battle.nextIn != null) {
    var startAt = Date.now() + battle.nextIn;
    statusTimer = setInterval(() => {
      var left = Math.ceil((startAt - Date.now()) / 1000);
      document.getElementById("btStatus").innerText = left > 0 ? "Starting in " + left + "..." : "Opening...";
      if (left <= 0) clearInterval(statusTimer);
    }, 200);
  }
}

/* ---------- The end of a battle ---------- */

var MEDALS = ["🥇", "🥈", "🥉", "4"];
var PLACE_NAMES = ["1st", "2nd", "3rd", "4th"];

// Place of every seat: the winner first, then by the totals
function placesOf(battle, totals) {
  var order = battle.seats.map((_, seat) => seat);
  order.sort((a, b) => (a == battle.winner ? -1 : b == battle.winner ? 1 : battle.crazy ? totals[a] - totals[b] : totals[b] - totals[a]));
  var places = [];
  order.forEach((seat, place) => (places[seat] = place));
  return places;
}

function finalTile(battle, seat, place, total) {
  var tile = el("div", "bt-final place-" + (place + 1));
  tile.append(el("span", "bt-final-medal", MEDALS[place]), el("span", "bt-final-place", PLACE_NAMES[place]));
  var value = el("span", "bt-final-total", "🪙 " + formatCoins(total));
  tile.appendChild(value);
  if (seat == battle.winner) tile.appendChild(el("span", "bt-final-gain", "Takes 🪙 " + formatCoins(battle.payout)));
  return tile;
}

// The big result on top: who won, the pot, what it was for me - and the same battle again
function resultHero(battle) {
  var winner = battle.seats[battle.winner];
  var mine = isIn(battle);
  var won = winner.name == myName;
  var hero = el("div", "bt-hero" + (won ? " won" : mine ? " lost" : ""));
  hero.appendChild(el("span", "bt-hero-trophy", won ? "🏆" : mine ? "💀" : "🏆"));
  var main = el("div", "bt-hero-main");
  var label = el("span", "bt-hero-label", won ? "You won the battle!" : battle.crazy ? "Winner - lowest total" : "Winner");
  var name = el("div", "bt-hero-name");
  name.append(createAvatar(winner.name), el("span", "", winner.name));
  if (winner.bot) name.appendChild(el("span", "player-tag", "Bot"));
  main.append(label, name);
  var pot = el("div", "bt-hero-pot");
  pot.append(el("span", "bt-hero-label", "Pot"), el("b", "", "🪙 " + formatCoins(battle.payout)));
  hero.append(main, pot);
  if (mine) {
    var profit = (won ? battle.payout : 0) - battle.price;
    var me = el("div", "bt-hero-me " + (profit >= 0 ? "plus" : "minus"));
    me.append(el("span", "bt-hero-label", "You"), el("b", "", (profit >= 0 ? "+" : "−") + formatCoins(Math.abs(profit))));
    hero.appendChild(me);
  }
  var again = el("button", "mm-btn mm-btn-primary mm-btn-sm bt-again");
  again.type = "button";
  again.append(createIcon("bi-arrow-repeat"), document.createTextNode(" Battle again · 🪙 " + formatCoins(battle.price)));
  again.disabled = battle.price > myCoins;
  again.title = "The same cases again, a new battle";
  again.addEventListener("click", () => socket.emit("createBattle", { cases: battle.cases.slice(), size: battle.size, crazy: battle.crazy }));
  hero.appendChild(again);
  return hero;
}

function renderBattleStatus(battle) {
  var status = document.getElementById("btStatus");
  if (battle.phase == "waiting") status.innerText = "Waiting for players";
  else if (battle.phase == "running") status.innerText = battle.revealed == 0 ? "Starting..." : "Round " + Math.max(1, battle.revealed) + " of " + battle.cases.length;
  else status.innerText = "Battle over";
}

function fairLine(battle) {
  var fair = el("div", "jp-fair");
  fair.title = "Provably fair: every item comes from the seed. sha256(seed) = hash, the seed is shown after the battle";
  fair.append(createIcon("bi-shield-check"), fairPart("Hash", battle.fair.hash));
  if (battle.fair.seed && !spinning) fair.appendChild(fairPart("Seed", battle.fair.seed));
  return fair;
}

function fairPart(label, value) {
  var part = el("span", "jp-fair-part");
  var code = el("code", "", value);
  part.append(el("span", "jp-fair-label", label), code);
  return part;
}

/* ---------- The spin of a round ---------- */

// A random item of the case (rare ones are rare here too)
function randomItem(box) {
  var roll = Math.random();
  var counted = 0;
  return box.items.find((item) => (counted += item.chance) > roll) || box.items[0];
}

async function playRound(battle, round) {
  spinning = true;
  renderBattle();
  document.getElementById("btStatus").innerText = "Round " + (round + 1) + " of " + battle.cases.length;
  var box = caseById(battle.cases[round]);
  var duration = Math.max(1200, roundTime - 1100);
  var columns = document.querySelectorAll("#btBattleView .bt-seat");
  var stops = [];
  columns.forEach((column, seat) => {
    var win = itemOf(battle, round, seat);
    var window_ = column.querySelector(".bt-reel-window");
    var reel = el("div", "bt-reel-strip");
    var count = 34;
    var stop = count - 4;
    for (var i = 0; i < count; i++) {
      var item = i == stop ? win : randomItem(box);
      // Near miss now and then: the best item right after the stop
      if (i == stop + 1 && Math.random() < 0.15) item = box.items[box.items.length - 1];
      reel.appendChild(itemTile(item, i == stop ? "big winner-tile" : "big"));
    }
    window_.replaceChildren(reel);
    var height = window_.clientHeight;
    var offset = stop * TILE - (height - TILE) / 2 + (Math.random() - 0.5) * TILE * 0.6;
    stops.push(
      animate(reel, [{ transform: "translateY(0)" }, { transform: `translateY(${-offset}px)` }], { duration: duration + seat * 120, easing: SLOW_END }).then(() =>
        animate(reel, [{ transform: `translateY(${-offset}px)` }, { transform: `translateY(${-(stop * TILE - (height - TILE) / 2)}px)` }], { duration: 220, easing: "ease-out" }),
      ),
    );
  });
  await Promise.all(stops);
  // Rare items get a little show
  columns.forEach((column, seat) => {
    var item = itemOf(battle, round, seat);
    var tile = column.querySelector(".winner-tile");
    if (tile) tile.classList.add("hit");
    if (item.rarity == "gold" || item.rarity == "red") flash(column, item.rarity);
  });
  await new Promise((resolve) => setTimeout(resolve, 450));
  spinning = false;
  shown[battle.id] = round + 1;
  // The page may have moved on (another battle opened)
  if (viewId == battle.id) renderBattle();
  var latest = currentBattle();
  if (latest && latest.id == battle.id && latest.revealed > shown[battle.id]) shown[battle.id] = latest.revealed;
  if (latest && latest.phase == "done") celebrate(latest);
}

function flash(column, rarity) {
  var glow = el("div", "bt-flash " + rarity);
  column.appendChild(glow);
  animate(glow, [{ opacity: 0.9 }, { opacity: 0 }], { duration: 900 }).then(() => glow.remove());
  var label = el("div", "jp-shout small", rarity == "gold" ? "JACKPOT!" : "RARE!");
  label.style.top = "40%";
  column.appendChild(label);
  animate(
    label,
    [
      { transform: "translate(-50%, -50%) scale(0.4)", opacity: 0 },
      { transform: "translate(-50%, -50%) scale(1.1)", opacity: 1, offset: 0.3 },
      { transform: "translate(-50%, -50%) scale(1)", opacity: 0 },
    ],
    { duration: 1200 },
  ).then(() => label.remove());
}

// The winner: once per battle, only when it was seen live
function celebrate(battle) {
  if (celebrated.has(battle.id) || battle.id != viewId || spinning) return;
  if (shownRounds(battle) < battle.cases.length) return;
  celebrated.add(battle.id);
  // After the page has drawn the end of the battle
  setTimeout(() => party(battle), 30);
}

function party(battle) {
  if (battle.id != viewId) return;
  var column = document.querySelector(`#btBattleView .bt-seat[data-seat="${battle.winner}"]`);
  if (column == null) return;
  var colors = ["#d4a64a", "#e0675a", "#3b82f6", "#3fae6b", "#ec4899", "#f5d76e"];
  var arena = column.parentElement;
  for (var i = 0; i < 60; i++) {
    var piece = el("i", "jp-confetti");
    piece.style.left = Math.random() * 100 + "%";
    piece.style.background = colors[i % colors.length];
    arena.appendChild(piece);
    animate(
      piece,
      [
        { transform: "translate(0, 0) rotate(0deg)", opacity: 1 },
        { transform: `translate(${(Math.random() - 0.5) * 300}px, ${200 + Math.random() * 200}px) rotate(${(Math.random() - 0.5) * 1000}deg)`, opacity: 0 },
      ],
      { duration: 1400 + Math.random() * 700, delay: Math.random() * 250, easing: "cubic-bezier(.2,.6,.4,1)" },
    ).then(((p) => () => p.remove())(piece));
  }
}

/* ---------- Setup ---------- */

document.addEventListener("DOMContentLoaded", () => {
  setupChat();

  document.querySelectorAll("#btFilter button").forEach((button) =>
    button.addEventListener("click", () => {
      filter = button.dataset.risk;
      document.querySelectorAll("#btFilter button").forEach((b) => b.classList.toggle("active", b == button));
      renderCases();
    }),
  );

  document.querySelectorAll("#btSizes button").forEach((button) =>
    button.addEventListener("click", () => {
      size = Number(button.dataset.size);
      document.querySelectorAll("#btSizes button").forEach((b) => b.classList.toggle("active", b == button));
    }),
  );


  document.getElementById("btCreate").addEventListener("click", () => {
    if (picked.length == 0) return;
    askForNotifications();
    socket.emit("createBattle", { cases: pickedIds(), size: size, crazy: crazy });
  });

  document.getElementById("btSort").addEventListener("change", (event) => {
    sort = event.target.value;
    renderCases();
  });

  document.getElementById("btShuffle").addEventListener("click", shufflePicked);

  document.getElementById("btClear").addEventListener("click", () => {
    picked = [];
    renderCreate();
  });

  // Crazy mode: a switch with a clown
  var crazyButton = document.getElementById("btCrazy");
  crazyButton.addEventListener("click", () => {
    crazy = !crazy;
    crazyButton.classList.toggle("on", crazy);
    crazyButton.setAttribute("aria-pressed", crazy);
  });

  showView();
});
