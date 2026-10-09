/* Hidden case battles: the server decides every item, this page only shows them. */
const socket = io((window.CASINO_NS || "") + "/battles");

var myName = null;
var myCoins = 0;
var myCap = null; // the most one bet may take with my balance (null: no cap - the max bet by balance)
var CASES = []; // catalog from the server
var battles = []; // every battle the server knows
var lastBattles = []; // finished battles, newest first
var roundTime = 4500;

var picked = []; // the new battle: case ids, one per round, in their order
var size = 2;
var filter = "all";
var sort = "price-asc";
var mode = "classic"; // classic | crazy | random | jackpot | bestof | worstof
var MODES = { classic: { icon: "👑", name: "Classic" }, crazy: { icon: "🤡", name: "Crazy" }, random: { icon: "❓", name: "Random" }, jackpot: { icon: "🎰", name: "Jackpot" }, bestof: { icon: "🏅", name: "Best of" }, worstof: { icon: "🥄", name: "Worst of" } };
var modeShown = {}; // battle id -> the mode of a random battle was revealed on this page
var seenRunning = {}; // battle id -> this page saw it running (so the reveal is played)
var drawShown = {}; // battle id -> the jackpot roulette was played on this page
var heroShown = {}; // battle id -> its result popped in on this page already
var lastCaseAt = {}; // battle id -> when the animation of its last case ended on this page

// The rule that counts: the mode - or, in random, the one picked (null while it is still hidden)
function ruleOf(battle) {
  if (battle.mode != "random") return battle.mode || (battle.crazy ? "crazy" : "classic");
  if (battle.picked) return battle.picked;
  return battle.crazy == null ? null : battle.crazy ? "crazy" : "classic";
}

// The mode of a battle as a short label ("❓ Random", after the end "❓ → 🤡 Crazy")
function modeLabel(battle) {
  var m = battle.mode || (battle.crazy ? "crazy" : "classic");
  var picked = ruleOf(battle);
  if (m == "random" && picked && modeShown[battle.id] !== false) return "❓ → " + MODES[picked].icon + " " + MODES[picked].name;
  return MODES[m].icon + " " + MODES[m].name;
}

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

// The case as it is now: an old version (changed in the admin panel since) - its newest one
function currentId(id) {
  var box = caseById(id);
  if (!box || !box.retired) return id;
  var now = CASES.find((other) => other.caseId == box.caseId && !other.retired);
  return now ? now.id : id;
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
  myCap = data.betCap != null ? data.betCap : null;
  renderCreate();
  renderList();
  if (!spinning) renderBattle();
});

socket.on("battleRules", (data) => {
  MAX_CASES = data.maxCases;
  MAX_COST = data.maxCost || MAX_COST;
});

socket.on("cases", (data) => {
  CASES = data;
  // A case turned off (admin panel): out of the new battle too
  picked = picked.map(currentId).filter((id) => caseById(id) && !caseById(id).off);
  renderCases();
  renderCreate();
});

socket.on("battleError", (message) => showHint(message, "error"));
socket.on("battleLeft", (id) => {
  var battle = battles.find((b) => b.id == id);
  casinoNotice({ icon: "🚪", title: "You left the battle", text: (battle ? "🪙 " + formatCoins(battle.price) : "Your coins") + " are back in your balance", key: "battle" });
});

// The new battle of this page: open it
socket.on("battleCreated", (id) => {
  // Opened right away - the list with the new battle may come a moment later
  justCreated = id;
  picked = [];
  renderCreate();
  // Back from the battle: the open battles (with the new one)
  showPane("battles");
  openBattle(id);
});

var listTimer = null;

socket.on("battles", (data) => {
  battles = data.list;
  // The end still plays in the battle (the mode reveal, the jackpot roulette): until then no winner in the list
  battles.forEach((battle) => (battle.endAt = battle.endLeft > 0 ? Date.now() + battle.endLeft : 0));
  var ending = battles.filter((battle) => battle.endAt > 0).map((battle) => battle.endLeft);
  clearTimeout(listTimer);
  if (ending.length) listTimer = setTimeout(renderList, Math.min(...ending) + 50);
  battlesLoaded = true;
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
    if (battle.id == viewId) catchUp(battle);
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

/*
 * A battle opened in the middle (a reload, a link): what still rolls for the
 * others rolls here too - the case of this round (the rest of its spin), the
 * mode reveal and the roulette at the end. Nothing shows a result before it.
 * true: it plays (and renders) by itself.
 */
function catchUp(battle) {
  if (battle.phase == "running" && battle.revealed > 0 && battle.roundAgo != null && battle.roundAgo < roundTime - 900 && !spinning) {
    shown[battle.id] = battle.revealed - 1;
    seenRunning[battle.id] = true;
    playRound(battle, battle.revealed - 1, battle.roundAgo);
    return true;
  }
  if (battle.phase == "done" && battle.endLeft > 0) {
    // The end still plays: from where it is now (the last case was seen this long ago)
    seenRunning[battle.id] = true;
    // (the last case stopped about half a second before the server's end)
    lastCaseAt[battle.id] = Date.now() - (battle.doneAgo || 0) - 480;
    joinedLate[battle.id] = true;
  }
  return false;
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
  // (not known yet - a reload: the first list decides, see track)
  if (viewId && battles.some((b) => b.id == viewId)) shown[viewId] = battles.find((b) => b.id == viewId).revealed;
  spinning = false;
  // (first the right view - a battle caught up in the middle plays in it right away)
  document.getElementById("btListView").hidden = viewId != null;
  document.getElementById("btBattleView").hidden = viewId == null;
  var open = viewId && battles.find((b) => b.id == viewId);
  if (open && catchUp(open)) return;
  // Main page: no status of a battle
  if (viewId == null) {
    clearInterval(statusTimer);
    document.getElementById("btStatus").innerText = "";
  }
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
var MAX_CASES = 25; // cases per battle (from the server, which checks it too)
var MAX_COST = 20000; // what one seat may cost, all cases together (from the server, which checks it too)

function setCount(id, count) {
  count = Math.max(0, Math.floor(Number(count)) || 0);
  var diff = count - countOf(id);
  if (diff > 0 && picked.length + diff > MAX_CASES) {
    diff = MAX_CASES - picked.length;
    showHint("At most " + MAX_CASES + " cases per battle.", "error");
  }
  // (and at most MAX_COST for all of them)
  var price = caseById(id) ? caseById(id).price : 0;
  var cost = picked.reduce((sum, other) => sum + (caseById(other) ? caseById(other).price : 0), 0);
  if (diff > 0 && price > 0 && cost + diff * price > MAX_COST) {
    diff = Math.max(0, Math.floor((MAX_COST - cost) / price));
    showHint("A battle costs at most 🪙 " + formatCoins(MAX_COST) + " per player.", "error");
  }
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
  var list = CASES.filter((box) => !box.off && (filter == "all" || box.risk == filter));
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
  var overCap = myCap != null && cost > myCap;
  button.disabled = ids.length == 0 || cost > myCoins || overCap;
  button.title = cost > myCoins ? "Not enough coins" : overCap ? "With your balance a bet is at most 🪙 " + formatCoins(myCap) : "";
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
    var item = el(box ? "button" : "span", "bt-strip-case", box ? box.icon : "?");
    item.title = box ? box.name + " · 🪙 " + formatCoins(box.price) : id;
    // A click shows what's inside (the odds)
    if (box) {
      item.type = "button";
      item.setAttribute("aria-label", "What's inside " + box.name);
      item.addEventListener("click", (event) => {
        event.stopPropagation();
        showContents(box);
      });
    }
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

// Best of: the rounds every seat won in the first `rounds` (the best item of a round - equal: all of them)
// (worst of - least: the least item wins the round)
function pointsOf(battle, rounds, least) {
  var points = battle.seats.map(() => 0);
  for (var n = 0; n < rounds; n++) {
    var values = battle.seats.map((_, seat) => itemOf(battle, n, seat).value);
    var top = least ? Math.min(...values) : Math.max(...values);
    values.forEach((value, seat) => {
      if (value == top) points[seat]++;
    });
  }
  return points;
}

// The winners (a tie: all of them - they split the pot) and what each gets
function winnersOf(battle) {
  return battle.winners || [battle.winner];
}
function shareOf(battle, seat) {
  var index = winnersOf(battle).indexOf(seat);
  return index < 0 ? 0 : battle.shares ? battle.shares[index] : battle.payout;
}

function phaseText(battle) {
  if (battle.phase == "waiting") return battle.seats.filter((s) => s == null).length + " seat(s) free";
  if (battle.phase == "running") return battle.revealed == 0 ? "Starting..." : "Round " + battle.revealed + " / " + battle.cases.length;
  if (battle.endAt > Date.now()) return (battle.mode || "classic") == "random" ? "Revealing the mode..." : "Drawing the winner...";
  var winners = winnersOf(battle).map((seat) => battle.seats[seat].name);
  if (winners.length > 1) return "Split: " + winners.join(" & ") + " · 🪙 " + formatCoins(shareOf(battle, winnersOf(battle)[0])) + " each";
  return (winners[0] == myName ? "You won" : winners[0] + " won") + " 🪙 " + formatCoins(battle.payout);
}

/* ---------- The two parts of the main page: open battles / create a battle ---------- */

var pane = "battles";

function showPane(name) {
  pane = name;
  document.getElementById("btPaneBattles").hidden = name != "battles";
  document.getElementById("btPaneCreate").hidden = name != "create";
  document.querySelectorAll("#btPanes button").forEach((button) => {
    button.classList.toggle("active", button.dataset.pane == name);
    button.setAttribute("aria-selected", button.dataset.pane == name);
  });
}

// How many players (2 to 4)
var MIN_SIZE = 2;
var MAX_SIZE = 4;
function setSize(value) {
  size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, value));
  var box = document.getElementById("btSizeValue");
  box.replaceChildren(el("b", "", size));
  document.getElementById("btSizeMinus").disabled = size <= MIN_SIZE;
  document.getElementById("btSizePlus").disabled = size >= MAX_SIZE;
}

// Back on the main page to create a battle - with these cases already chosen
function createAgain(battle) {
  // (without cases that are turned off now)
  picked = battle.cases.map(currentId).filter((id) => caseById(id) && !caseById(id).off);
  size = battle.size;
  mode = battle.mode || (battle.crazy ? "crazy" : "classic");
  setSize(size);
  document.querySelectorAll("#btModes button").forEach((b) => b.classList.toggle("active", b.dataset.mode == mode));
  renderCreate();
  pushView(null);
  showView();
  showPane("create");
}

function renderList() {
  var list = document.getElementById("btBattles");
  document.getElementById("btBattlesEmpty").hidden = battles.length > 0;
  var open = battles.filter((b) => b.phase == "waiting").length;
  var count = document.getElementById("btOpenCount");
  count.hidden = open == 0;
  count.innerText = open;
  list.replaceChildren(
    ...battles.map((battle) => {
      var row = el("div", "bt-row phase-" + battle.phase + (isIn(battle) ? " mine" : ""));
      var info = el("div", "bt-row-info");
      var tags = el("div", "bt-row-tags");
      tags.append(el("span", "bt-row-price", "🪙 " + formatCoins(battle.price)), el("span", "mm-muted", battle.cases.length + (battle.cases.length == 1 ? " case" : " cases")));
      if ((battle.mode || "classic") != "classic" || battle.crazy) tags.appendChild(el("span", "bt-crazy-tag", modeLabel(battle)));
      info.append(caseStrip(battle), tags);
      var actions = el("div", "bt-row-actions");
      actions.appendChild(el("span", "bt-row-phase", phaseText(battle)));
      if (battle.phase == "waiting" && !isIn(battle)) {
        var join = el("button", "mm-btn mm-btn-sm mm-btn-primary", "Join");
        join.type = "button";
        join.disabled = battle.price > myCoins || (myCap != null && battle.price > myCap);
        join.addEventListener("click", (event) => {
          event.stopPropagation();
          askForNotifications();
          socket.emit("joinBattle", battle.id);
          openBattle(battle.id);
        });
        actions.appendChild(join);
      }
      // A link: a middle click (or ctrl / cmd) opens the battle in a new tab
      var view = el("a", "mm-btn mm-btn-sm", "View");
      view.href = "#" + battle.id;
      view.addEventListener("click", (event) => {
        if (event.button != 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
        event.preventDefault();
        openBattle(battle.id);
      });
      actions.appendChild(view);
      row.append(seatAvatars(battle), info, actions);
      return row;
    }),
  );
}

function renderHistory() {
  var list = document.getElementById("btHistory");
  document.getElementById("btHistoryEmpty").hidden = lastBattles.length > 0;
  // (phones: no empty card over the chat)
  document.getElementById("btHistoryCard").classList.toggle("empty", lastBattles.length == 0);
  list.replaceChildren(
    ...lastBattles.map((entry) => {
      var multiple = entry.price > 0 ? entry.total / entry.price : 0;
      var sub = "Paid 🪙 " + formatCoins(entry.price) + (multiple >= 1 ? " · " + (multiple >= 10 ? Math.round(multiple) : multiple.toFixed(1)) + "x" : "");
      // A split pot: every winner named
      var names = entry.winners && entry.winners.length > 1 ? entry.winners.join(" & ") : entry.winner;
      return historyItem(createAvatar(entry.winner, "sm"), names, entry.winners && entry.winners.length > 1 ? "Split pot · " + sub : sub, "🪙 " + formatCoins(entry.total));
    }),
  );
}

/* ---------- One battle ---------- */

var battlesLoaded = false; // the first list came: an unknown battle is gone, not loading
var lastViewed = null; // the open battle: a finished one stays open after the server drops it
var justCreated = null; // the battle just created: opened even before the list has it

function currentBattle() {
  var battle = battles.find((battle) => battle.id == viewId) || null;
  if (battle) {
    lastViewed = battle;
    if (battle.id == justCreated) justCreated = null;
  } else if (lastViewed && lastViewed.id == viewId && lastViewed.phase == "done") {
    battle = lastViewed;
  }
  return battle;
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
  var headBar = document.getElementById("btHeadBar");
  headBar.replaceChildren();
  if (viewId == null) return;
  var battle = currentBattle();
  clearInterval(statusTimer);
  // Leave the battle (back to all battles): an icon on the far right
  var back = el("button", "bt-leave");
  back.type = "button";
  back.title = "Back to all battles";
  back.setAttribute("aria-label", "Back to all battles");
  back.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>';
  back.addEventListener("click", () => {
    pushView(null);
    showView();
  });
  if (battle == null && (!battlesLoaded || viewId == justCreated)) {
    view.replaceChildren();
    headBar.replaceChildren(back);
    return;
  }
  if (battle == null) {
    // Cancelled (or unknown): back to all battles
    history.replaceState(null, "", location.pathname);
    showView();
    return;
  }

  var rounds = shownRounds(battle);
  var over = battle.phase == "done" && rounds == battle.cases.length && !spinning;
  // Random: the mode is revealed first (on a page that saw the battle run), then the end
  if (battle.phase == "running") seenRunning[battle.id] = true;
  var reveal = over && battle.mode == "random" && seenRunning[battle.id] && !modeShown[battle.id];
  if (reveal) over = false;
  // Jackpot: then the roulette draws the winner
  var drawing = over && ruleOf(battle) == "jackpot" && seenRunning[battle.id] && !drawShown[battle.id];
  if (drawing) over = false;

  // One quiet line: price, cases, crazy - then the pot (gold) and leaving
  var top = el("div", "bt-battle-top");
  var facts = el("div", "bt-top-facts");
  var price = el("span", "", "🪙 " + formatCoins(battle.price));
  price.title = "Price to join";
  facts.append(price, el("span", "", battle.cases.length + (battle.cases.length == 1 ? " case" : " cases")));
  facts.appendChild(el("span", battle.crazy || battle.mode == "random" ? "bt-top-crazy" : "", reveal ? "❓ Random" : modeLabel(battle)));
  var pot = 0;
  battle.seats.forEach((_, seat) => (pot += totalOf(battle, seat, rounds)));
  var potBox = el("span", "bt-top-pot");
  potBox.append(el("span", "bt-top-pot-label", "Pot"), document.createTextNode("🪙 " + formatCoins(pot)));
  top.append(facts, back);

  var strip = caseStrip(battle, battle.phase == "running" ? rounds : null);
  strip.classList.add("big");

  var grid = el("div", "bt-arena" + (over ? " over" : ""));
  grid.style.setProperty("--seats", battle.size);
  var totals = battle.seats.map((_, seat) => totalOf(battle, seat, rounds));
  var best = battle.crazy ? Math.min(...totals) : Math.max(...totals);
  // (random while it runs: no leader - nobody knows yet what counts)
  if (battle.crazy == null || reveal) best = null;
  // Best of: the rounds won so far lead; jackpot: every one's chance (its share of the pot)
  var rule = reveal ? null : ruleOf(battle);
  // Random while the mode is hidden: the chance and the rounds won side by side (it may be either)
  var hidden = battle.mode == "random" && (reveal || !battle.picked);
  var points = rule == "bestof" || rule == "worstof" ? pointsOf(battle, rounds, rule == "worstof") : null;
  var hiddenPoints = hidden ? pointsOf(battle, rounds) : null;
  var hiddenWorst = hidden ? pointsOf(battle, rounds, true) : null;
  var mostPoints = points ? Math.max(...points) : null;
  var pot = totals.reduce((sum, t) => sum + t, 0);
  var places = over ? placesOf(battle, totals) : null;
  battle.seats.forEach((seat, index) => {
    var column = el("div", "bt-seat");
    column.dataset.seat = index;
    if (over) column.classList.add(winnersOf(battle).includes(index) ? "winner" : "lost");
    else if (rounds > 0 && (points ? points[index] == mostPoints && mostPoints > 0 : totals[index] == best)) column.classList.add("leading");
    var head = el("div", "bt-seat-head");
    if (seat == null) {
      head.classList.add("empty");
      head.appendChild(el("span", "bt-empty-seat"));
      if (battle.phase == "waiting" && !isIn(battle)) {
        var join = el("button", "mm-btn mm-btn-sm mm-btn-primary", "Join 🪙 " + formatCoins(battle.price));
        join.type = "button";
        join.disabled = battle.price > myCoins || (myCap != null && battle.price > myCap);
        join.addEventListener("click", () => {
          askForNotifications();
          socket.emit("joinBattle", battle.id);
        });
        head.appendChild(join);
      } else if (battle.creator == myName) {
        var bot = el("button", "bt-add-bot");
        bot.type = "button";
        bot.append(el("span", "bt-add-bot-icon", "🤖"), document.createTextNode("Add bot"));
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
      // Best of: rounds won - jackpot: the chance to get it all
      if (points) head.appendChild(el("span", "bt-seat-extra", (rule == "worstof" ? "🥄 " : "🏅 ") + points[index] + (points[index] == 1 ? " round" : " rounds")));
      if (rule == "jackpot" && pot > 0) head.appendChild(el("span", "bt-seat-extra", "🎰 " + ((totals[index] / pot) * 100).toFixed(1) + "% chance"));
      if (hidden && pot > 0) {
        var both = el("span", "bt-seat-extra bt-seat-both");
        both.append(el("span", "", "🎰 " + ((totals[index] / pot) * 100).toFixed(1) + "%"));
        // The rounds won as the best (🏅) and as the worst (🥄)
        both.append(el("span", "", "🏅 " + hiddenPoints[index]), el("span", "", "🥄 " + hiddenWorst[index]));
        both.title = "Chance in jackpot mode · rounds won with the best item (best of) · with the worst item (worst of)";
        head.appendChild(both);
      }
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

  headBar.replaceChildren(top);
  // The cases in the middle, the pot beside them on the right
  var stripRow = el("div", "bt-strip-row");
  stripRow.append(el("span"), strip, potBox);
  var parts = over ? [resultHero(battle), stripRow, grid] : [stripRow, grid];
  if (reveal) playModeReveal(battle, grid);
  if (drawing) playJackpotDraw(battle, grid);
  if (battle.phase == "waiting" && battle.creator == myName) {
    var cancel = el("button", "bt-cancel");
    cancel.type = "button";
    cancel.append(createIcon("bi-x-circle"), document.createTextNode(" Cancel battle"));
    cancel.addEventListener("click", () => {
      socket.emit("cancelBattle", battle.id);
      createAgain(battle);
    });
    parts.push(cancel);
  }
  // Everybody else who sits in it: out again, the coins back (only before it starts)
  if (battle.phase == "waiting" && battle.creator != myName && battle.seats.some((seat) => seat && !seat.bot && seat.name == myName)) {
    var leave = el("button", "bt-cancel bt-leave-battle");
    leave.type = "button";
    leave.append(document.createTextNode("🚪 Leave battle · 🪙 " + formatCoins(battle.price) + " back"));
    leave.addEventListener("click", () => {
      leave.disabled = true;
      socket.emit("leaveBattle", battle.id);
    });
    parts.push(leave);
  }
  parts.push(fairLine(battle));
  view.replaceChildren(...parts);

  renderBattleStatus(battle, reveal ? "reveal" : drawing ? "draw" : null);
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

// Place of every seat: the winners first (a tie: all of them 1st), then by the totals
function placesOf(battle, totals) {
  var winners = winnersOf(battle);
  var order = battle.seats.map((_, seat) => seat);
  var rule = ruleOf(battle);
  var points = rule == "bestof" || rule == "worstof" ? pointsOf(battle, battle.rounds.length, rule == "worstof") : null;
  // (worst of: equal rounds - the smaller total first)
  var low = battle.crazy || rule == "worstof";
  order.sort((a, b) => (winners.includes(a) && !winners.includes(b) ? -1 : winners.includes(b) && !winners.includes(a) ? 1 : points && points[a] != points[b] ? points[b] - points[a] : low ? totals[a] - totals[b] : totals[b] - totals[a]));
  var places = [];
  order.forEach((seat, place) => (places[seat] = winners.includes(seat) ? 0 : place));
  return places;
}

/*
 * Random mode, at the very end: a reel of crowns and clowns rolls, slows down
 * smoothly and stops on the mode the seed chose - then the winner is shown.
 * (A new render of the page picks the reel up where it was.)
 */
/*
 * How a reel lands - a few ways, picked by the battle (the same on every page):
 * smooth, a little too far and back, a whole slot too far and falling back,
 * or creeping onto it at the very end. `to` and `slot` in `unit`.
 */
// stayOn: never past the slot it stops on (the roulette: no other picture on the way back)
function landing(prop, unit, to, slot, key, stayOn) {
  var hash = [...String(key)].reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, 5381);
  var at = (v) => prop + "(" + -v + unit + ")";
  var kind = hash % 4;
  if (stayOn && kind == 2) kind = 3;
  switch (kind) {
    case 1: // a bit too far, back
      return [
        { transform: at(0), offset: 0, easing: "cubic-bezier(0.15, 0.55, 0.2, 1)" },
        { transform: at(to + slot * 0.35), offset: 0.9, easing: "ease-in-out" },
        { transform: at(to), offset: 1 },
      ];
    case 2: // a whole slot too far - and falling back
      return [
        { transform: at(0), offset: 0, easing: "cubic-bezier(0.12, 0.6, 0.2, 1)" },
        { transform: at(to + slot * 1.1), offset: 0.8, easing: "cubic-bezier(0.5, 0, 0.3, 1)" },
        { transform: at(to), offset: 1 },
      ];
    case 3: // creeping onto it
      return [
        { transform: at(0), offset: 0, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" },
        { transform: at(to - slot * 0.55), offset: 0.75, easing: "cubic-bezier(0.4, 0, 0.6, 1)" },
        { transform: at(to), offset: 1 },
      ];
    default: // smooth
      return [
        { transform: at(0), offset: 0, easing: "cubic-bezier(0.12, 0.6, 0.1, 1)" },
        { transform: at(to), offset: 1 },
      ];
  }
}

/*
 * Jackpot, at the very end: a roulette of the players - everybody as many
 * slots as their share of the pot - rolls, slows down and stops on the winner
 * the seed drew. Then the end.
 */
var DRAW_SPIN = 10000; // the roulette rolls this long
var DRAW_HOLD = 2000; // the winner is shown this long before the end
var DRAW_SLOTS = 40; // slots of one round of the roulette
var DRAW_LAPS = 5;
var SLOT_WIDTH = 66;
var SEAT_COLORS = ["#d4a64a", "#3b82f6", "#e0675a", "#3fae6b"];
var drawing = {}; // battle id -> when the roulette started
var drawBoxes = {}; // battle id -> its roulette (the same one through every render)

// The slots of one round: every seat by its share (at least one), mixed - the same on every page
function drawSlots(battle) {
  var pot = battle.totals.reduce((sum, t) => sum + t, 0);
  var slots = [];
  battle.seats.forEach((_, seat) => {
    var n = pot > 0 ? Math.max(1, Math.round((battle.totals[seat] / pot) * DRAW_SLOTS)) : 1;
    for (var i = 0; i < n; i++) slots.push(seat);
  });
  // Mixed by the id of the battle (a small random of its own)
  var seed = [...String(battle.id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  var random = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  for (var i = slots.length - 1; i > 0; i--) {
    var j = Math.floor(random() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  return slots;
}

function playJackpotDraw(battle, grid) {
  // The first render after the last case: the roulette after the same pause as the random reveal
  // (after a random reveal it comes right away), the end after it
  if (!drawing[battle.id]) {
    var wait = battle.mode == "random" ? 0 : (lastCaseAt[battle.id] || Date.now()) + REVEAL_WAIT - Date.now();
    // (opened while it rolled: it goes on where it is - wait is below 0 then)
    if (joinedLate[battle.id] && battle.mode == "random") wait = (revealing[battle.id] || Date.now()) + REVEAL_SPIN + REVEAL_HOLD - Date.now();
    else if (!joinedLate[battle.id]) wait = Math.max(0, wait);
    drawing[battle.id] = Date.now() + wait;
    if (wait > 0) setTimeout(renderBattle, wait);
    setTimeout(() => {
      drawShown[battle.id] = true;
      renderBattle();
      celebrate(battle);
    }, Math.max(0, wait + DRAW_SPIN + DRAW_HOLD));
  }
  var started = drawing[battle.id];
  if (Date.now() < started) return;
  // Already rolling on this page: the same roulette goes on (a new one would start a frame at the
  // first picture)
  if (drawBoxes[battle.id]) return grid.appendChild(drawBoxes[battle.id]);
  var winner = winnersOf(battle)[0];
  var lap = drawSlots(battle);
  var box = el("div", "bt-mode-reveal bt-draw");
  var windowBox = el("div", "bt-draw-window");
  var track = el("div", "bt-draw-track");
  // (one lap more after the one it stops in: the window is never empty on the right)
  for (var l = 0; l <= DRAW_LAPS; l++) {
    lap.forEach((seat) => {
      var slot = el("div", "bt-draw-slot");
      slot.style.setProperty("--seat", SEAT_COLORS[seat % SEAT_COLORS.length]);
      slot.appendChild(createAvatar(battle.seats[seat].name, "sm"));
      track.appendChild(slot);
    });
  }
  windowBox.append(track, el("span", "bt-draw-pointer"));
  var name = el("span", "bt-mode-name", "Who gets it all?");
  box.append(el("span", "bt-mode-title", "THE JACKPOT GOES TO..."), windowBox, name);
  grid.appendChild(box);
  drawBoxes[battle.id] = box;
  // The stop: a slot of the winner in the last round, in the middle of the window
  var target = (DRAW_LAPS - 1) * lap.length + Math.max(0, lap.indexOf(winner));
  var finish = () => {
    var share = battle.totals.reduce((sum, t) => sum + t, 0);
    name.innerText = battle.seats[winner].name + " · " + (share > 0 ? ((battle.totals[winner] / share) * 100).toFixed(1) : "0") + "% chance";
    box.classList.add("done");
  };
  requestAnimationFrame(() => {
    // (the slots as wide as they really are - with their border)
    var slotWidth = track.firstChild ? track.firstChild.getBoundingClientRect().width : SLOT_WIDTH;
    var offset = target * slotWidth + slotWidth / 2 - windowBox.clientWidth / 2;
    var spin = track.animate(landing("translateX", "px", offset, slotWidth, battle.id + ":draw", true), { duration: DRAW_SPIN, fill: "forwards" });
    spin.currentTime = Math.min(DRAW_SPIN, Date.now() - started);
    if (Date.now() - started >= DRAW_SPIN) return finish();
    spin.finished.then(finish, () => {});
  });
}

// What the picked mode means (the end of the random reveal)
var RULE_TEXT = {
  classic: "Classic - the highest total wins!",
  crazy: "Crazy - the lowest total wins!",
  jackpot: "Jackpot - a draw, your worth is your chance!",
  bestof: "Best of - the most rounds won win!",
  worstof: "Worst of - the most rounds with the worst item win!",
};
var REVEAL_WAIT = 1500; // the last case is seen this long before the reel comes
var REVEAL_SPIN = 7000; // the reel rolls this long
var REVEAL_HOLD = 1600; // the mode is shown this long before the winner
var revealing = {}; // battle id -> when the reel starts
var joinedLate = {}; // battle id -> opened while its end played: the reel / roulette go on where they are (not from the start)
var revealBoxes = {}; // battle id -> its reel (the same one through every render)
function playModeReveal(battle, grid) {
  // The first render after the last case: the reel in REVEAL_WAIT, the winner after it
  if (!revealing[battle.id]) {
    // (3 s after the animation of the last case - or right away, if that was longer ago)
    var start = (lastCaseAt[battle.id] || Date.now()) + REVEAL_WAIT;
    if (!joinedLate[battle.id]) start = Math.max(Date.now(), start);
    revealing[battle.id] = start;
    setTimeout(renderBattle, Math.max(0, start - Date.now()));
    setTimeout(() => {
      modeShown[battle.id] = true;
      renderBattle();
      celebrate(battle);
    }, Math.max(0, start - Date.now() + REVEAL_SPIN + REVEAL_HOLD));
  }
  var started = revealing[battle.id];
  if (Date.now() < started) return;
  // Already rolling on this page: the same reel goes on (a new one flickered at every update)
  if (revealBoxes[battle.id]) return grid.appendChild(revealBoxes[battle.id]);
  var box = el("div", "bt-mode-reveal");
  revealBoxes[battle.id] = box;
  var face = el("span", "bt-mode-face");
  var track = el("span", "bt-mode-track");
  // Many icons in turn, the last one is the mode (even: crown, odd: clown)
  // Every mode it could be in turn - the last one is the one the seed picked
  var options = ["classic", "crazy", "jackpot", "bestof", "worstof"];
  var at = Math.max(0, options.indexOf(ruleOf(battle)));
  var count = 28 + ((at - (28 % options.length) + options.length) % options.length);
  // (a few more after the one it stops on: when it rolls a bit too far and back, there are icons - never an empty spot)
  for (var n = 0; n <= count + 3; n++) track.appendChild(el("span", "bt-mode-icon", MODES[options[n % options.length]].icon));
  face.appendChild(track);
  var name = el("span", "bt-mode-name", "Which mode?");
  box.append(el("span", "bt-mode-title", "THE MODE IS..."), face, name);
  grid.appendChild(box);
  var spin = track.animate(landing("translateY", "%", count * 100, 100, battle.id), { duration: REVEAL_SPIN, fill: "forwards" });
  spin.currentTime = Math.min(REVEAL_SPIN, Date.now() - started);
  var stopped = () => {
    name.innerText = RULE_TEXT[ruleOf(battle)] || "";
    box.classList.add("done");
  };
  if (Date.now() - started >= REVEAL_SPIN) return stopped();
  spin.finished.then(stopped, () => {});
}

function finalTile(battle, seat, place, total) {
  var tile = el("div", "bt-final place-" + (place + 1));
  tile.append(el("span", "bt-final-medal", MEDALS[place]), el("span", "bt-final-place", PLACE_NAMES[place]));
  var value = el("span", "bt-final-total", "🪙 " + formatCoins(total));
  tile.appendChild(value);
  if (winnersOf(battle).includes(seat)) tile.appendChild(el("span", "bt-final-gain", (winnersOf(battle).length > 1 ? "Splits · 🪙 " : "Takes 🪙 ") + formatCoins(shareOf(battle, seat))));
  return tile;
}

// Jackpot: the winner's chance ("drawn with 23.4%")
function jackpotChance(battle, seat) {
  var pot = battle.totals.reduce((sum, t) => sum + t, 0);
  return pot > 0 ? "drawn with " + ((battle.totals[seat] / pot) * 100).toFixed(1) + "%" : "drawn";
}

// The big result on top: who won, the pot, what it was for me - and the same battle again
function resultHero(battle) {
  var seats = winnersOf(battle);
  var split = seats.length > 1;
  var mySeat = seats.find((seat) => battle.seats[seat].name == myName);
  var mine = isIn(battle);
  var won = mySeat != null;
  // (it pops in once - a later new drawing of the page, like the list coming again, leaves it be)
  var hero = el("div", "bt-hero" + (won ? " won" : mine ? " lost" : "") + (heroShown[battle.id] ? " seen" : ""));
  heroShown[battle.id] = true;
  hero.appendChild(el("span", "bt-hero-trophy", split ? "🤝" : won ? "🏆" : mine ? "💀" : "🏆"));
  var main = el("div", "bt-hero-main");
  var how = ruleOf(battle) == "jackpot" ? jackpotChance(battle, seats[0]) : ruleOf(battle) == "bestof" ? "most rounds won" : ruleOf(battle) == "worstof" ? "most rounds with the worst item" : battle.crazy ? "lowest total" : null;
  var label = el("span", "bt-hero-label", split ? (won ? "A tie - you split the pot!" : "A tie - the pot is split") : (won ? "You won the battle!" : "Winner") + (how ? " · " + how : ""));
  var name = el("div", "bt-hero-name");
  seats.forEach((seat, i) => {
    var winner = battle.seats[seat];
    if (i > 0) name.appendChild(el("span", "bt-hero-and", "&"));
    name.append(createAvatar(winner.name), el("span", "", winner.name));
    if (winner.bot) name.appendChild(el("span", "player-tag", "Bot"));
  });
  main.append(label, name);
  var pot = el("div", "bt-hero-pot");
  pot.append(el("span", "bt-hero-label", "Pot"), el("b", "", "🪙 " + formatCoins(battle.payout)));
  hero.append(main, pot);
  if (mine) {
    var profit = (won ? shareOf(battle, mySeat) : 0) - battle.price;
    var me = el("div", "bt-hero-me " + (profit >= 0 ? "plus" : "minus"));
    me.append(el("span", "bt-hero-label", "You"), el("b", "", (profit >= 0 ? "+" : "−") + formatCoins(Math.abs(profit))));
    hero.appendChild(me);
  }
  // The same battle again: only for who made this one
  if (battle.creator != myName) return hero;
  var again = el("button", "mm-btn mm-btn-primary mm-btn-sm bt-again");
  again.type = "button";
  again.append(createIcon("bi-arrow-repeat"), document.createTextNode(" Battle again · 🪙 " + formatCoins(battle.price)));
  again.disabled = battle.price > myCoins;
  again.title = "The same cases again, a new battle";
  again.addEventListener("click", () => socket.emit("createBattle", { cases: battle.cases.slice(), size: battle.size, mode: battle.mode || (battle.crazy ? "crazy" : "classic") }));
  hero.appendChild(again);
  return hero;
}

// after: still to come at the end - "reveal" (random: the mode), "draw" (jackpot: the roulette)
function renderBattleStatus(battle, after) {
  var status = document.getElementById("btStatus");
  if (battle.phase == "waiting") status.innerText = "Waiting for players";
  else if (battle.phase == "running") status.innerText = battle.revealed == 0 ? "Starting..." : "Round " + Math.max(1, battle.revealed) + " of " + battle.cases.length;
  else if (after == "reveal") status.innerText = "All cases open - which mode counts?";
  else if (after == "draw") status.innerText = "All cases open - the jackpot is drawn";
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

// elapsed: the round started this long ago (a page opened in the middle of it) - the rest of the spin
async function playRound(battle, round, elapsed) {
  spinning = true;
  renderBattle();
  document.getElementById("btStatus").innerText = "Round " + (round + 1) + " of " + battle.cases.length;
  var box = caseById(battle.cases[round]);
  // Opened in the middle of a round: the same spin as for everybody else, from where it is now
  // (not the whole reel in the rest of the time - that raced past like a flicker)
  var duration = Math.max(1200, roundTime - 1100);
  var skip = Math.min(elapsed || 0, duration - 500);
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
    var roll = reel.animate([{ transform: "translateY(0)" }, { transform: `translateY(${-offset}px)` }], { duration: duration + seat * 120, easing: SLOW_END, fill: "forwards" });
    roll.currentTime = skip;
    stops.push(
      roll.finished.catch(() => {}).then(() =>
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
  // The last case is seen: the reveal / roulette counts its pause from now
  if (round == battle.cases.length - 1) lastCaseAt[battle.id] = Date.now();
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
  // Random: first the mode (the reveal celebrates when it is over)
  if (battle.mode == "random" && seenRunning[battle.id] && !modeShown[battle.id]) return;
  // Jackpot: first the roulette
  if (ruleOf(battle) == "jackpot" && seenRunning[battle.id] && !drawShown[battle.id]) return;
  if (shownRounds(battle) < battle.cases.length) return;
  celebrated.add(battle.id);
  // After the page has drawn the end of the battle
  setTimeout(() => party(battle), 30);
}

function party(battle) {
  if (battle.id != viewId) return;
  var column = document.querySelector(`#btBattleView .bt-seat[data-seat="${winnersOf(battle)[0]}"]`);
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

  document.getElementById("btSizeMinus").addEventListener("click", () => setSize(size - 1));
  document.getElementById("btSizePlus").addEventListener("click", () => setSize(size + 1));
  setSize(size);


  document.getElementById("btCreate").addEventListener("click", () => {
    if (picked.length == 0) return;
    askForNotifications();
    socket.emit("createBattle", { cases: pickedIds(), size: size, mode: mode });
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

  // Who wins: classic, crazy or random
  document.querySelectorAll("#btModes button").forEach((button) =>
    button.addEventListener("click", () => {
      mode = button.dataset.mode;
      document.querySelectorAll("#btModes button").forEach((b) => b.classList.toggle("active", b == button));
      renderCreate();
    }),
  );

  document.querySelectorAll("[data-pane]").forEach((button) => button.addEventListener("click", () => showPane(button.dataset.pane)));
  showPane("battles");
  showView();
});
