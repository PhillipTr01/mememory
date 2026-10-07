/* Admin panel: balances, payouts, leaderboard, the history of every coin change, the casino chat and the settings. */

var REASONS = [
  "start coins",
  "jackpot bet",
  "jackpot win",
  "jackpot refund",
  "secret word",
  "battle",
  "battle win",
  "battle refund",
  "poker buy-in",
  "poker chips",
  "poker cash-out",
  "poker refund",
  "game win",
  "daily bonus",
  "slots bet",
  "slots win",
  "withdrawal",
  "withdrawal refund",
  "admin",
];

var knownOpen = null; // ids of the open payouts already seen (new ones get a note)
var knownWaiting = null; // players waiting for access at the last look
var players = [];

function formatCoins(value) {
  return Number(value).toLocaleString("en-US");
}

function el(tag, className, text) {
  var element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.innerText = text;
  return element;
}

function time(value) {
  return new Date(value).toLocaleString(undefined, { dateStyle: "short", timeStyle: "medium" });
}

// The API next to this page; logged out (session over): back to the login
async function api(path, body) {
  var res = await fetch("api/" + path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  if (res.status == 401) {
    window.location.reload();
    throw new Error("logged out");
  }
  var data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function fail(error) {
  if (error.message != "logged out") showToast(error.message, "error");
}

/* ---------- Tabs ---------- */

var PAGES = {
  overview: ["Overview", "Everything at a glance - what needs you, and what is going on right now."],
  access: ["Access", "Who may play in the casino, and who may pay coins out."],
  players: ["Players", "Balances of every player - change one by hand."],
  payouts: ["Payouts", "Coins players took off to be paid out."],
  history: ["History", "Every change of a balance, newest first."],
  chat: ["Chat", "The chat of the casino - delete messages, ban players."],
  seasons: ["Seasons", "Plan seasons: everybody starts with the same budget, the best win."],
  settings: ["Settings", "Values of the games, and the hard reset."],
};

// The pages of the settings: general and one per game
var SETTING_GROUPS = {
  general: ["General settings", "Coins for everybody - and the hard reset."],
  jackpot: ["Jackpot", "Turn the jackpot on or off, its bets and timing."],
  battles: ["Case battles", "Turn case battles on or off, how big a battle can be."],
  poker: ["Poker", "Turn poker on or off, the buy-ins."],
  blackjack: ["Blackjack", "Turn blackjack on or off, the seats and the limits of every table."],
  slots: ["Slots", "Turn slots on or off, the bet per spin."],
};
var settingsGroup = "general";

function showTab() {
  var parts = (location.hash || "#overview").slice(1).split("/");
  var tab = parts[0];
  if (!PAGES[tab]) tab = "overview";
  settingsGroup = SETTING_GROUPS[parts[1]] ? parts[1] : "general";
  document.querySelectorAll(".ad-tab").forEach((section) => (section.hidden = section.id != "tab-" + tab));
  document.querySelectorAll(".ad-nav-item[data-tab]").forEach((link) => link.classList.toggle("active", link.dataset.tab == tab));
  document.getElementById("adPageTitle").innerText = tab == "settings" ? SETTING_GROUPS[settingsGroup][0] : PAGES[tab][0];
  document.getElementById("adPageSub").innerText = tab == "settings" ? SETTING_GROUPS[settingsGroup][1] : PAGES[tab][1];
  document.getElementById("adSettingsNav").classList.toggle("open", tab == "settings");
  document.querySelectorAll(".ad-sub").forEach((link) => link.classList.toggle("active", tab == "settings" && link.dataset.group == settingsGroup));
  document.getElementById("adDanger").hidden = settingsGroup != "general";
  if (tab == "access") loadAccess();
  if (tab == "players") loadPlayers();
  if (tab == "payouts") loadPayouts();
  if (tab == "history") loadHistory();
  if (tab == "chat") loadChat();
  if (tab == "seasons") loadSeasons();
  if (tab == "settings") loadSettings();
}

window.addEventListener("hashchange", showTab);

// Keeps the open page up to date (the chat has its own timer, the settings stay as they are while editing)
var REFRESH = { access: () => loadAccess(), players: () => loadPlayers(), payouts: () => loadPayouts(), history: () => loadHistory(), seasons: () => loadSeasons(true) };

function refresh() {
  if (document.visibilityState != "visible") return;
  loadOverview();
  var tab = (location.hash || "#overview").slice(1).split("/")[0];
  // Not while typing in the page (a field in a row would lose what is typed)
  var focus = document.activeElement;
  if (focus && focus.closest(".ad-tab") && /^(INPUT|SELECT|TEXTAREA)$/.test(focus.tagName)) return;
  if (REFRESH[tab]) REFRESH[tab]();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState == "visible") refresh();
});

/* ---------- Overview (every few seconds) ---------- */

function payoutRow(w) {
  var row = el("div", "ad-row ad-payout " + w.status);
  var info = el("div", "ad-row-main ad-payout-info");
  info.append(el("b", "", w.username), el("span", "ad-row-meta", time(w.createdAt) + (w.note ? " · " + w.note : "")));
  var amount = el("span", "ad-row-value", "🪙 " + formatCoins(w.amount));
  row.append(info, amount);
  if (w.status == "open") {
    var paid = el("button", "mm-btn mm-btn-sm mm-btn-primary", "Paid");
    paid.type = "button";
    paid.title = "The coins were paid out";
    paid.addEventListener("click", () => handle(w, "paid"));
    var reject = el("button", "mm-btn mm-btn-sm", "Reject");
    reject.type = "button";
    reject.title = "Reject - the coins go back to the player";
    reject.addEventListener("click", () => handle(w, "reject"));
    row.append(paid, reject);
  } else {
    row.appendChild(el("span", "ad-pill " + (w.status == "paid" ? "success" : "danger"), w.status));
  }
  return row;
}

async function handle(w, action) {
  var note = action == "reject" ? prompt("Why? (the player gets the coins back)", "") : "";
  if (note == null) return;
  try {
    await api("withdrawals/" + w.id, { action: action, note: note || undefined });
    showToast(action == "paid" ? "Marked as paid" : "Rejected - the coins are back");
    loadOverview();
    if (!document.getElementById("tab-payouts").hidden) loadPayouts();
  } catch (error) {
    fail(error);
  }
}

async function loadOverview() {
  try {
    var data = await api("overview");
    document.getElementById("adPlayers").innerText = formatCoins(data.players);
    document.getElementById("adCoins").innerText = "🪙 " + formatCoins(data.coins);
    document.getElementById("adOpen").innerText = data.open.length;
    document.getElementById("adOpenCoins").innerText = "🪙 " + formatCoins(data.openCoins);
    document.getElementById("adWaiting").innerText = data.requests.length;
    document.getElementById("adOnline").innerText = data.online.length;
    document.getElementById("adOnlineNames").innerText = data.online.length ? data.online.slice(0, 3).join(", ") + (data.online.length > 3 ? " +" + (data.online.length - 3) : "") : "nobody in the casino";
    var requests = document.getElementById("adRequestList");
    requests.replaceChildren(...(data.requests.length ? data.requests.map(requestRow) : [el("p", "ad-empty", "Nobody is waiting.")]));
    var list = document.getElementById("adOpenList");
    list.replaceChildren(...(data.open.length ? data.open.map(payoutRow) : [el("p", "ad-empty", "Nothing to pay out.")]));
    renderLive(data.games || {});
    document.getElementById("adTopList").replaceChildren(
      ...(data.leaderboard.length
        ? data.leaderboard.slice(0, 5).map((p, i) => {
            var row = el("div", "ad-row");
            row.append(el("span", "ad-rank", i + 1), el("span", "ad-row-main fw-semibold", p.username), el("span", "ad-row-value", "🪙 " + formatCoins(p.coins)));
            return row;
          })
        : [el("p", "ad-empty", "No players yet.")]),
    );
    document.getElementById("adActivity").replaceChildren(
      ...(data.activity && data.activity.length
        ? data.activity.map((a) => {
            var row = el("div", "ad-row");
            var main = el("div", "ad-row-main");
            main.append(el("b", "", a.username), el("span", "ad-reason", a.reason));
            row.append(main, el("span", "ad-row-meta", new Date(a.at).toLocaleTimeString(undefined, { timeStyle: "short" })), el("span", "ad-row-value " + (a.amount < 0 ? "minus" : "plus"), (a.amount > 0 ? "+" : "") + formatCoins(a.amount)));
            return row;
          })
        : [el("p", "ad-empty", "Nothing yet.")]),
    );

    // New payouts since the last look: a note
    var ids = data.open.map((w) => w.id);
    if (knownOpen != null) {
      var fresh = data.open.filter((w) => !knownOpen.includes(w.id));
      fresh.forEach((w) => showToast("💸 New payout: " + w.username + " - " + formatCoins(w.amount) + " coins"));
    }
    knownOpen = ids;
    var badge = document.getElementById("adOpenBadge");
    badge.hidden = ids.length == 0;
    // Players who want into the casino
    if (knownWaiting != null && data.waiting > knownWaiting) {
      showToast("🔑 " + (data.waiting - knownWaiting == 1 ? "A player wants" : data.waiting - knownWaiting + " players want") + " into the casino");
      if (!document.getElementById("tab-access").hidden) loadAccess();
    }
    knownWaiting = data.waiting;
    var waitingBadge = document.getElementById("adWaitingBadge");
    waitingBadge.hidden = data.waiting == 0;
    waitingBadge.innerText = data.waiting;
    // Something to do on the overview (requests, payouts): a count on its tab
    var overviewBadge = document.getElementById("adOverviewBadge");
    overviewBadge.hidden = ids.length + data.waiting == 0;
    overviewBadge.innerText = ids.length + data.waiting;
    overviewBadge.title = data.waiting + " request" + (data.waiting == 1 ? "" : "s") + ", " + ids.length + " payout" + (ids.length == 1 ? "" : "s");
    badge.hidden = ids.length + data.waiting == 0;
    badge.innerText = [data.waiting ? data.waiting + (data.waiting == 1 ? " request" : " requests") : "", ids.length ? ids.length + " open" : ""].filter(Boolean).join(" · ");
    var todo = ids.length + data.waiting;
    document.title = (todo ? "(" + todo + ") " : "") + "Admin - MemeMory";
    if (!players.length) {
      players = data.leaderboard;
      fillUserList();
    }
  } catch (error) {
    fail(error);
  }
}

// What the games are doing right now
var PHASE_TEXT = { open: "waiting for bets", countdown: "countdown", drawing: "drawing", betting: "taking bets", playing: "playing", dealer: "dealer's turn", result: "paying out", waiting: "waiting", preflop: "pre-flop", flop: "flop", turn: "turn", river: "river", showdown: "showdown" };

function liveRow(icon, name, detail, value, active) {
  var row = el("div", "ad-row");
  var main = el("div", "ad-row-main");
  main.append(el("b", "", name), el("span", "ad-row-meta", detail));
  row.append(el("span", "ad-row-icon", icon), main, el("span", "ad-dot" + (active ? " on" : ""), ""), el("span", "ad-row-value", value));
  return row;
}

function renderLive(games) {
  var rows = [];
  var jp = games.jackpot;
  if (jp) rows.push(liveRow("🪙", "Jackpot", "Round " + jp.round + " · " + (PHASE_TEXT[jp.phase] || jp.phase) + " · " + jp.players + (jp.players == 1 ? " player" : " players"), "🪙 " + formatCoins(jp.total), jp.total > 0));
  var bt = games.battles;
  if (bt) rows.push(liveRow("⚔️", "Case battles", bt.waiting + " waiting · " + bt.running + " running", "🪙 " + formatCoins(bt.pot), bt.running > 0));
  var pk = games.poker;
  if (pk) rows.push(liveRow("🃏", "Poker", (PHASE_TEXT[pk.phase] || pk.phase) + (pk.hand ? " · hand " + pk.hand : ""), pk.seated + " / " + pk.seats + " seats", pk.seated > 0));
  var sl = games.slots;
  if (sl) rows.push(liveRow("🎰", "Slots", sl.playing + (sl.playing == 1 ? " player" : " players") + " at the machines", formatCoins(sl.spins) + " spins", sl.playing > 0));
  (games.blackjack || []).forEach((t) => rows.push(liveRow(t.icon, "Blackjack · " + t.name, (PHASE_TEXT[t.phase] || t.phase) + " · round " + t.round, t.taken + " / " + t.seats + " seats", t.taken > 0)));
  document.getElementById("adLive").replaceChildren(...(rows.length ? rows : [el("p", "ad-empty", "No game is running.")]));
}

/* ---------- Access ---------- */

// A player who asked for access (overview): let in or say no
function requestRow(request) {
  var row = el("div", "ad-row ad-payout open");
  var info = el("div", "ad-row-main ad-payout-info");
  info.append(el("b", "", request.username), el("span", "ad-row-meta", "asked " + time(request.requestedAt)));
  var approve = el("button", "mm-btn mm-btn-sm mm-btn-primary", "Approve");
  approve.type = "button";
  approve.addEventListener("click", () => setAccess({ username: request.username, approved: false }, true, approve));
  var decline = el("button", "mm-btn mm-btn-sm", "Decline");
  decline.type = "button";
  decline.title = "Say no - the player can ask again";
  decline.addEventListener("click", async () => {
    decline.disabled = true;
    try {
      await api("access/decline", { username: request.username });
      showToast(request.username + "'s request is declined");
      loadOverview();
      if (!document.getElementById("tab-access").hidden) loadAccess();
    } catch (error) {
      decline.disabled = false;
      fail(error);
    }
  });
  row.append(el("span", "ad-row-icon", "🔑"), info, approve, decline);
  return row;
}

function day(value) {
  return new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" });
}

async function loadAccess() {
  try {
    var data = await api("access?q=" + encodeURIComponent(document.getElementById("adAccessSearch").value.trim()));
    var info = document.getElementById("adAccessInfo");
    info.replaceChildren(
      el("span", "", "Approving a player now gives "),
      el("b", "", "🪙 " + formatCoins(data.startCoins)),
      el(
        "span",
        "mm-muted",
        // In a running season: its budget and the daily bonuses missed since it started
        data.since
          ? " (" + formatCoins(data.baseCoins) + " + " + data.missed + " missed daily bonus" + (data.missed == 1 ? "" : "es") + " since the season started " + day(data.since) + ")"
          : " - the start coins (in a season: its budget plus the daily bonuses missed since it started)",
      ),
    );
    var list = document.getElementById("adAccessList");
    if (data.players.length == 0) {
      var empty = el("tr");
      var cell = el("td", "mm-muted", "No players.");
      cell.colSpan = 4;
      empty.appendChild(cell);
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(
      ...data.players.map((p) => {
        var row = el("tr", p.approved ? "" : p.requestedAt ? "ad-waiting" : "");
        var status = p.approved
          ? el("span", "ad-pill success", "approved" + (p.approvedAt ? " · " + day(p.approvedAt) : ""))
          : p.requestedAt
            ? el("span", "ad-pill accent", "wants in · " + time(p.requestedAt))
            : el("span", "ad-pill", "no access");
        var button = el("button", "mm-btn mm-btn-sm" + (p.approved ? "" : " mm-btn-primary"), p.approved ? "Revoke" : "Approve");
        button.type = "button";
        button.addEventListener("click", () => setAccess(p, !p.approved, button));
        var actions = el("td", "ad-actions");
        actions.appendChild(button);
        // May the player pay coins out? (otherwise there is no payout for them)
        var payout = el("label", "ad-switch");
        payout.title = "May " + p.username + " pay coins out?";
        var box = document.createElement("input");
        box.type = "checkbox";
        box.checked = p.payout;
        box.setAttribute("aria-label", "Payout for " + p.username);
        var text = el("span", "ad-switch-text", p.payout ? "On" : "Off");
        box.addEventListener("change", () => setPayout(p, box, text));
        payout.append(box, el("span", "ad-switch-track"), text);
        var payoutCell = el("td");
        payoutCell.appendChild(payout);
        var statusCell = el("td");
        statusCell.appendChild(status);
        row.append(el("td", "fw-semibold", p.username), statusCell, payoutCell, actions);
        return row;
      }),
    );
  } catch (error) {
    fail(error);
  }
}

async function setAccess(player, approve, button) {
  if (!approve && !(await confirmDialog({ title: "Take " + player.username + "'s access away?", text: "Their open casino pages close right away. The coins stay for a later approval.", confirmLabel: "Revoke access", danger: true }))) return;
  button.disabled = true;
  try {
    var result = await api("access", { username: player.username, approve: approve });
    if (!approve) showToast(player.username + " has no access any more");
    else if (result.again) showToast(player.username + " is back in (with the old coins)");
    else showToast(player.username + " is in - 🪙 " + formatCoins(result.coins) + " start coins");
    loadAccess();
    loadOverview();
    players = [];
  } catch (error) {
    button.disabled = false;
    fail(error);
  }
}

async function setPayout(player, box, text) {
  box.disabled = true;
  text.innerText = box.checked ? "On" : "Off";
  try {
    await api("payout", { username: player.username, allowed: box.checked });
    player.payout = box.checked;
    showToast(player.username + (box.checked ? " can pay out now" : " can't pay out any more"));
  } catch (error) {
    box.checked = !box.checked;
    text.innerText = box.checked ? "On" : "Off";
    fail(error);
  } finally {
    box.disabled = false;
  }
}

/* ---------- Players ---------- */

function fillUserList() {
  document.getElementById("adUserList").replaceChildren(...players.map((p) => Object.assign(document.createElement("option"), { value: p.username })));
}

async function loadPlayers() {
  try {
    players = await api("users?q=" + encodeURIComponent(document.getElementById("adSearch").value.trim()));
    fillUserList();
    document.getElementById("adBoard").replaceChildren(
      ...players.map((p, i) => {
        var row = el("tr");
        var edit = el("button", "mm-btn mm-btn-sm", "Edit");
        edit.type = "button";
        edit.addEventListener("click", () => {
          document.getElementById("adBalUser").value = p.username;
          document.getElementById("adBalMode").value = "set";
          document.getElementById("adBalAmount").value = p.coins;
          document.getElementById("adBalAmount").focus();
        });
        var history = el("button", "mm-btn mm-btn-sm", "History");
        history.type = "button";
        history.addEventListener("click", () => {
          document.getElementById("adHistUser").value = p.username;
          location.hash = "#history";
        });
        var actions = el("td", "ad-actions");
        actions.append(edit, history);
        row.append(el("td", "mm-muted", i + 1), el("td", "fw-semibold", p.username), el("td", "num", "🪙 " + formatCoins(p.coins)), actions);
        return row;
      }),
    );
  } catch (error) {
    fail(error);
  }
}

async function saveBalance(event) {
  event.preventDefault();
  var username = document.getElementById("adBalUser").value.trim();
  var mode = document.getElementById("adBalMode").value;
  var amount = Number(document.getElementById("adBalAmount").value);
  var note = document.getElementById("adBalNote").value.trim();
  if (!Number.isInteger(amount)) return showToast("A whole number, please.", "error");
  try {
    var result = await api("balance", { username: username, mode: mode, amount: amount, note: note || undefined });
    showToast(result.username + " has 🪙 " + formatCoins(result.coins) + " now");
    document.getElementById("adBalAmount").value = "";
    document.getElementById("adBalNote").value = "";
    loadPlayers();
    loadOverview();
  } catch (error) {
    fail(error);
  }
}

/* ---------- Payouts ---------- */

async function loadPayouts() {
  try {
    var status = document.getElementById("adPayoutStatus").value;
    var list = await api("withdrawals" + (status ? "?status=" + status : ""));
    document.getElementById("adPayoutList").replaceChildren(...(list.length ? list.map(payoutRow) : [el("p", "ad-empty", "No payouts.")]));
  } catch (error) {
    fail(error);
  }
}

/* ---------- History ---------- */

async function loadHistory(event) {
  if (event) event.preventDefault();
  var params = new URLSearchParams();
  var user = document.getElementById("adHistUser").value.trim();
  var reason = document.getElementById("adHistReason").value;
  if (user) params.set("username", user);
  if (reason) params.set("reason", reason);
  try {
    var rows = await api("history?" + params.toString());
    var body = document.getElementById("adHistory");
    if (rows.length == 0) {
      var empty = el("tr");
      var cell = el("td", "mm-muted", "Nothing yet.");
      cell.colSpan = 4;
      empty.appendChild(cell);
      body.replaceChildren(empty);
      return;
    }
    body.replaceChildren(
      ...rows.map((row) => {
        var tr = el("tr");
        var what = el("td", "");
        what.append(el("span", "ad-reason", row.reason));
        if (row.note) what.append(el("span", "mm-muted small", " " + row.note));
        tr.append(el("td", "mm-muted small", time(row.at)), el("td", "fw-semibold", row.username), what, el("td", "num " + (row.amount < 0 ? "minus" : "plus"), (row.amount > 0 ? "+" : "") + formatCoins(row.amount)));
        return tr;
      }),
    );
  } catch (error) {
    fail(error);
  }
}

/* ---------- Seasons ---------- */

var seasonList = [];
var dailyBonusSetting = 2500; // the daily bonus of the settings (a new season starts with it)
var editingSeason = null; // id of the season in the form (null: a new one)
var SEASON_COLORS = ["#d4a64a", "#e0675a", "#e8913a", "#6fa784", "#4fb3a9", "#5b8fd6", "#9d84c2", "#d77fb0"];
var GOLD = "#d4a64a";
var SEASON_ICONS = ["🏆", "🔥", "❄️", "🌸", "☀️", "🍂", "🎃", "🎄", "💎", "🚀", "👑", "🐸"];
var EVERY_NAMES = { 0: "live", 5: "every 5 min", 15: "every 15 min", 60: "every hour", 360: "every 6 hours", 1440: "once a day" };
var STATUS_NAMES = { planned: "Planned", running: "Running", ended: "Over" };

function dateText(value) {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// "3d 4h" / "5h 12m" / "8m"
function span(ms) {
  var minutes = Math.max(0, Math.round(ms / 60000));
  var d = Math.floor(minutes / 1440);
  var h = Math.floor((minutes % 1440) / 60);
  var m = minutes % 60;
  return d > 0 ? d + "d " + h + "h" : h > 0 ? h + "h " + m + "m" : m + "m";
}

// For <input type="datetime-local">: the local time without seconds
function localInput(value) {
  var d = new Date(value);
  var pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

// quiet: the refresh every few seconds - the form stays as it is
async function loadSeasons(quiet) {
  try {
    var data = await api("seasons");
    seasonList = data.seasons;
    dailyBonusSetting = data.dailyBonus;
    renderSeasons();
    if (!quiet && editingSeason == null && !document.getElementById("adSeasonName").value) seasonDefaults();
  } catch (error) {
    fail(error);
  }
}

function renderSeasons() {
  var running = seasonList.find((s) => s.status == "running");
  var next = seasonList.filter((s) => s.status == "planned").sort((a, b) => a.start - b.start)[0];
  document.getElementById("adSeasonBadge").hidden = !running;
  // Now: the running season (with how far it is), the next one - or the normal leaderboard
  var now = document.getElementById("adSeasonNow");
  if (running) {
    var done = Math.min(1, (Date.now() - running.start) / (running.end - running.start));
    var bar = el("div", "ad-season-progress");
    var fill = el("span");
    fill.style.width = (done * 100).toFixed(1) + "%";
    bar.appendChild(fill);
    now.replaceChildren(el("span", "ad-label", "Running now"), seasonHead(running), bar, el("p", "ad-note", "Ends in " + span(running.end - Date.now()) + " · " + dateText(running.end) + " · leaderboard " + EVERY_NAMES[running.every]));
  } else {
    now.replaceChildren(
      el("span", "ad-label", "No season running"),
      el("p", "ad-season-idle", "The leaderboard is the normal one - live, all the time."),
      el("p", "ad-note", next ? "Next: " + next.icon + " " + next.name + " starts in " + span(next.start - Date.now()) + " (" + dateText(next.start) + ")." : "Plan a season on the right."),
    );
  }
  var list = document.getElementById("adSeasonList");
  list.replaceChildren(...(seasonList.length ? seasonList.map(seasonRow) : [el("p", "ad-empty", "No seasons yet.")]));
}

function seasonHead(season) {
  var head = el("div", "ad-season-head");
  var text = el("div", "ad-row-main");
  text.append(el("b", "", season.name), el("span", "ad-row-meta", dateText(season.start) + " → " + dateText(season.end)));
  var icon = el("span", "ad-season-icon", season.icon);
  // (the accent color of the season around the icon)
  icon.style.boxShadow = "inset 0 0 0 2px " + (season.color || GOLD);
  head.append(icon, text, el("span", "ad-pill " + (season.status == "running" ? "success" : season.status == "planned" ? "accent" : ""), STATUS_NAMES[season.status]));
  return head;
}

function seasonRow(season) {
  var row = el("div", "ad-season-row " + season.status);
  row.appendChild(seasonHead(season));
  var facts = el("div", "ad-season-facts");
  facts.append(el("span", "", "🪙 " + formatCoins(season.budget) + " start"), el("span", "", "🎁 " + formatCoins(season.dailyBonus != null ? season.dailyBonus : dailyBonusSetting) + " a day"), el("span", "", "🔁 " + (season.secondChances || 0) + " second chance" + (season.secondChances == 1 ? "" : "s")), el("span", "", "📊 " + EVERY_NAMES[season.every]), el("span", "", season.prizesOn ? "🏅 " + season.prizes.length + (season.prizes.length == 1 ? " prize" : " prizes") : "no prizes"));
  if (season.status == "ended" && season.winner) facts.append(el("span", "ad-season-winner", "🥇 " + season.winner.username + " · 🪙 " + formatCoins(season.winner.coins)));
  row.appendChild(facts);
  if (season.prizesOn && season.prizes.length) {
    var prizes = el("div", "ad-season-prizes");
    season.prizes.forEach((p) => prizes.appendChild(el("span", "ad-pill", "#" + p.place + " " + p.prize)));
    row.appendChild(prizes);
  }
  var actions = el("div", "ad-actions");
  var button = (label, cls, handler) => {
    var b = el("button", "mm-btn mm-btn-sm " + (cls || ""), label);
    b.type = "button";
    b.addEventListener("click", handler);
    actions.appendChild(b);
  };
  if (season.status != "ended") button("Edit", "", () => editSeason(season));
  if (season.status == "running") button("End now", "mm-btn-danger", () => endSeason(season));
  if (season.status != "running") button("Delete", "", () => deleteSeason(season));
  row.appendChild(actions);
  return row;
}

// The form for a new season: starts at the next full hour, runs a week
function seasonDefaults() {
  editingSeason = null;
  var start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  var last = seasonList.filter((s) => s.status != "ended").sort((a, b) => b.end - a.end)[0];
  if (last && last.end > start.getTime()) start = new Date(last.end);
  fillSeasonForm({ name: "Season " + (seasonList.length + 1), icon: "🏆", start: start.getTime(), end: start.getTime() + 7 * 24 * 3600 * 1000, budget: 25000, dailyBonus: dailyBonusSetting, every: 0, prizesOn: false, prizes: [] });
}

function fillSeasonForm(season) {
  document.getElementById("adSeasonName").value = season.name;
  document.getElementById("adSeasonIcon").value = season.icon;
  document.getElementById("adSeasonStart").value = localInput(season.start);
  document.getElementById("adSeasonEnd").value = localInput(season.end);
  document.getElementById("adSeasonBudget").value = season.budget;
  document.getElementById("adSeasonBonus").value = season.dailyBonus != null ? season.dailyBonus : dailyBonusSetting;
  document.getElementById("adSeasonChances").value = season.secondChances || 0;
  document.getElementById("adSeasonColor").value = season.color || GOLD;
  markColor();
  document.getElementById("adSeasonEvery").value = season.every;
  document.getElementById("adSeasonPrizesOn").checked = season.prizesOn;
  // A running season: start and budget happened already
  var running = season.status == "running";
  document.getElementById("adSeasonStart").disabled = running;
  document.getElementById("adSeasonBudget").disabled = running;
  syncDates();
  document.getElementById("adSeasonPrizes").replaceChildren(...season.prizes.map(prizeRow));
  if (season.prizes.length == 0) document.getElementById("adSeasonPrizes").appendChild(prizeRow({ place: 1, prize: "" }));
  showPrizes();
  document.getElementById("adSeasonFormTitle").innerText = editingSeason == null ? "New season" : "Edit " + season.name;
  document.getElementById("adSeasonSave").innerText = editingSeason == null ? "Plan the season" : "Save";
  document.getElementById("adSeasonCancel").hidden = editingSeason == null;
  markIcon();
}

/* ---------- Date picker (in the style of the site) ---------- */

var WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
var picker = null; // {input, button, month (Date of the 1st), box}

function dateOf(input) {
  return input.value ? new Date(input.value) : new Date();
}

// The buttons show the dates of their inputs (and can't be used when the input is disabled)
function syncDates() {
  document.querySelectorAll(".ad-date-btn").forEach((button) => {
    var input = document.getElementById(button.dataset.for);
    button.disabled = input.disabled;
    button.replaceChildren(el("span", "ad-date-icon", "📅"), el("span", "", input.value ? dateText(dateOf(input)) : "Choose..."));
  });
}

function setDate(input, date) {
  input.value = localInput(date);
  syncDates();
}

function openPicker(button) {
  closePicker();
  var input = document.getElementById(button.dataset.for);
  var current = dateOf(input);
  var box = el("div", "ad-picker");
  box.setAttribute("role", "dialog");
  picker = { input: input, button: button, month: new Date(current.getFullYear(), current.getMonth(), 1), box: box };
  button.parentElement.appendChild(box);
  button.classList.add("open");
  renderPicker();
}

function closePicker() {
  if (!picker) return;
  picker.box.remove();
  picker.button.classList.remove("open");
  picker = null;
}

function renderPicker() {
  var p = picker;
  var value = dateOf(p.input);
  var head = el("div", "ad-picker-head");
  var prev = el("button", "ad-picker-nav", "‹");
  var next = el("button", "ad-picker-nav", "›");
  prev.type = next.type = "button";
  prev.setAttribute("aria-label", "Previous month");
  next.setAttribute("aria-label", "Next month");
  prev.addEventListener("click", () => {
    p.month = new Date(p.month.getFullYear(), p.month.getMonth() - 1, 1);
    renderPicker();
  });
  next.addEventListener("click", () => {
    p.month = new Date(p.month.getFullYear(), p.month.getMonth() + 1, 1);
    renderPicker();
  });
  head.append(prev, el("span", "ad-picker-month", p.month.toLocaleDateString(undefined, { month: "long", year: "numeric" })), next);

  var grid = el("div", "ad-picker-grid");
  WEEKDAYS.forEach((d) => grid.appendChild(el("span", "ad-picker-wd", d)));
  // From the Monday of the first week
  var first = new Date(p.month);
  first.setDate(1 - ((first.getDay() + 6) % 7));
  var today = new Date();
  for (var i = 0; i < 42; i++) {
    var day = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i);
    var cell = el("button", "ad-picker-day", day.getDate());
    cell.type = "button";
    if (day.getMonth() != p.month.getMonth()) cell.classList.add("other");
    if (day.toDateString() == today.toDateString()) cell.classList.add("today");
    if (day.toDateString() == value.toDateString()) cell.classList.add("picked");
    cell.addEventListener(
      "click",
      ((d) => () => {
        var v = dateOf(p.input);
        setDate(p.input, new Date(d.getFullYear(), d.getMonth(), d.getDate(), v.getHours(), v.getMinutes()));
        p.month = new Date(d.getFullYear(), d.getMonth(), 1);
        renderPicker();
      })(day),
    );
    grid.appendChild(cell);
  }

  // The time: hour and minute (5-minute steps)
  var time = el("div", "ad-picker-time");
  var hours = el("select", "mm-input ad-picker-select");
  var minutes = el("select", "mm-input ad-picker-select");
  for (var h = 0; h < 24; h++) hours.appendChild(new Option(String(h).padStart(2, "0"), h));
  for (var m = 0; m < 60; m += 5) minutes.appendChild(new Option(String(m).padStart(2, "0"), m));
  hours.value = value.getHours();
  minutes.value = Math.floor(value.getMinutes() / 5) * 5;
  var setTime = () => {
    var v = dateOf(p.input);
    setDate(p.input, new Date(v.getFullYear(), v.getMonth(), v.getDate(), Number(hours.value), Number(minutes.value)));
  };
  hours.addEventListener("change", setTime);
  minutes.addEventListener("change", setTime);
  time.append(el("span", "ad-label", "Time"), hours, el("span", "ad-picker-colon", ":"), minutes);

  var foot = el("div", "ad-picker-foot");
  var now = el("button", "mm-btn mm-btn-sm", "Now");
  var done = el("button", "mm-btn mm-btn-sm mm-btn-primary", "Done");
  now.type = done.type = "button";
  now.addEventListener("click", () => {
    var d = new Date();
    d.setSeconds(0, 0);
    d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5);
    setDate(p.input, d);
    p.month = new Date(d.getFullYear(), d.getMonth(), 1);
    renderPicker();
  });
  done.addEventListener("click", closePicker);
  foot.append(now, done);
  p.box.replaceChildren(head, grid, time, foot);
}

document.addEventListener("click", (event) => {
  var button = event.target.closest(".ad-date-btn");
  if (button) {
    if (picker && picker.button == button) closePicker();
    else if (!button.disabled) openPicker(button);
    return;
  }
  // (a click in the picker draws it anew - its button is gone then, but it was inside)
  if (picker && event.target.isConnected && !event.target.closest(".ad-picker")) closePicker();
});

document.addEventListener("keydown", (event) => {
  if (event.key == "Escape") closePicker();
});

function prizeRow(prize) {
  var row = el("div", "ad-prize-row");
  var place = el("input", "mm-input ad-prize-place");
  place.type = "number";
  place.min = 1;
  place.value = prize.place;
  place.setAttribute("aria-label", "Place");
  var text = el("input", "mm-input");
  text.maxLength = 80;
  text.placeholder = "The prize";
  text.value = prize.prize;
  var remove = el("button", "ad-icon-btn", "✕");
  remove.type = "button";
  remove.title = "Remove";
  remove.addEventListener("click", () => {
    row.remove();
    if (!document.querySelector("#adSeasonPrizes .ad-prize-row")) document.getElementById("adSeasonPrizesOn").checked = false;
    showPrizes();
  });
  row.append(el("span", "ad-prize-hash", "#"), place, text, remove);
  return row;
}

function showPrizes() {
  var on = document.getElementById("adSeasonPrizesOn").checked;
  var list = document.getElementById("adSeasonPrizes");
  if (on && !list.children.length) list.appendChild(prizeRow({ place: 1, prize: "" }));
  list.hidden = !on;
  document.getElementById("adSeasonAddPrize").hidden = !on;
}

function markColor() {
  var color = document.getElementById("adSeasonColor").value.toLowerCase();
  // (the hex field shows it too - any color can be typed in there)
  if (document.activeElement != document.getElementById("adSeasonHex")) document.getElementById("adSeasonHex").value = color;
  document.querySelectorAll("#adSeasonColors button").forEach((b) => b.classList.toggle("active", b.dataset.color == color));
}

function markIcon() {
  var icon = document.getElementById("adSeasonIcon").value.trim();
  document.querySelectorAll("#adSeasonIcons button").forEach((b) => b.classList.toggle("active", b.innerText == icon));
}

function editSeason(season) {
  editingSeason = season.id;
  fillSeasonForm(season);
  document.getElementById("adSeasonName").focus();
}

async function saveSeason(event) {
  event.preventDefault();
  var prizes = [...document.querySelectorAll("#adSeasonPrizes .ad-prize-row")]
    .map((row) => ({ place: Number(row.querySelector(".ad-prize-place").value), prize: row.querySelector("input:not(.ad-prize-place)").value.trim() }))
    .filter((p) => p.prize);
  var body = {
    name: document.getElementById("adSeasonName").value.trim(),
    icon: document.getElementById("adSeasonIcon").value.trim(),
    start: new Date(document.getElementById("adSeasonStart").value).getTime(),
    end: new Date(document.getElementById("adSeasonEnd").value).getTime(),
    budget: Number(document.getElementById("adSeasonBudget").value),
    dailyBonus: Number(document.getElementById("adSeasonBonus").value),
    secondChances: Number(document.getElementById("adSeasonChances").value) || 0,
    // The gold of the casino: no own color
    color: document.getElementById("adSeasonColor").value.toLowerCase() == GOLD ? null : document.getElementById("adSeasonColor").value,
    every: Number(document.getElementById("adSeasonEvery").value),
    prizesOn: document.getElementById("adSeasonPrizesOn").checked,
    prizes: prizes,
  };
  // A running season keeps its start and budget
  var current = seasonList.find((s) => s.id == editingSeason);
  if (current && current.status == "running") Object.assign(body, { start: current.start, budget: current.budget });
  try {
    var data = await api(editingSeason == null ? "seasons" : "seasons/" + editingSeason, body);
    seasonList = data.seasons;
    showToast(editingSeason == null ? body.icon + " " + body.name + " is planned" : "Saved");
    seasonDefaults();
    renderSeasons();
  } catch (error) {
    fail(error);
  }
}

async function endSeason(season) {
  if (!(await confirmDialog({ title: "End " + season.name + " now?", text: "The places right now are final - the winner page shows them, with the prizes.", confirmLabel: "End now", danger: true }))) return;
  try {
    seasonList = (await api("seasons/" + season.id + "/end", {})).seasons;
    renderSeasons();
    showToast(season.name + " is over");
  } catch (error) {
    fail(error);
  }
}

async function deleteSeason(season) {
  if (!(await confirmDialog({ title: "Delete " + season.name + "?", text: season.status == "ended" ? "Its winner page is gone too." : "It won't start.", confirmLabel: "Delete", danger: true }))) return;
  try {
    seasonList = (await api("seasons/" + season.id + "/delete", {})).seasons;
    if (editingSeason == season.id) seasonDefaults();
    renderSeasons();
  } catch (error) {
    fail(error);
  }
}

/* ---------- Chat ---------- */

var chatTimer = null;

async function loadChat() {
  clearTimeout(chatTimer);
  if (document.getElementById("tab-chat").hidden) return;
  try {
    var data = await api("chat");
    var banned = new Set(data.bans.map((b) => b.username));
    document.getElementById("adChatCount").innerText = data.messages.length;
    var list = document.getElementById("adChatList");
    var atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.replaceChildren(
      ...(data.messages.length
        ? data.messages.map((m) => {
            var row = el("div", "ad-chat-msg" + (banned.has(m.name) ? " banned" : ""));
            var body = el("div", "");
            body.append(el("span", "ad-chat-name", m.name), el("span", "ad-chat-text", m.text));
            var actions = el("div", "ad-chat-actions");
            var del = el("button", "ad-icon-btn", "🗑️");
            del.type = "button";
            del.title = "Delete this message";
            del.addEventListener("click", () => chatAction("chat/delete", { id: m.id }, "Message deleted"));
            actions.appendChild(del);
            if (!banned.has(m.name)) {
              var ban = el("button", "ad-icon-btn", "🚫");
              ban.type = "button";
              ban.title = "Ban " + m.name + " from the chat";
              ban.addEventListener("click", () => {
                document.getElementById("adBanUser").value = m.name;
                document.getElementById("adBanTime").focus();
              });
              actions.appendChild(ban);
            }
            row.append(el("span", "ad-chat-time", new Date(m.time).toLocaleTimeString(undefined, { timeStyle: "short" })), body, actions);
            return row;
          })
        : [el("p", "ad-empty", "No messages.")]),
    );
    if (atBottom) list.scrollTop = list.scrollHeight;

    document.getElementById("adBanList").replaceChildren(
      ...(data.bans.length
        ? data.bans.map((b) => {
            var row = el("div", "ad-row");
            var info = el("div", "");
            info.className = "ad-row-main";
            info.append(el("b", "", b.username), el("span", "ad-row-meta", b.until ? "until " + time(b.until) : "for good"));
            var unban = el("button", "mm-btn mm-btn-sm", "Unban");
            unban.type = "button";
            unban.addEventListener("click", () => chatAction("chat/unban", { username: b.username }, b.username + " can write again"));
            row.append(info, unban);
            return row;
          })
        : [el("p", "ad-empty", "Nobody is banned.")]),
    );
    document.getElementById("adOnlineCount").innerText = data.online.length;
    document.getElementById("adOnlineList").replaceChildren(...(data.online.length ? data.online.map((name) => el("span", "", name)) : [el("p", "ad-empty", "Nobody is in the casino.")]));
  } catch (error) {
    fail(error);
  }
  // New messages show up by themselves
  chatTimer = setTimeout(loadChat, 4000);
}

async function chatAction(path, body, done) {
  try {
    await api(path, body);
    showToast(done);
    loadChat();
  } catch (error) {
    fail(error);
  }
}

/* ---------- Settings ---------- */

var settingsList = [];

async function loadSettings() {
  try {
    settingsList = (await api("settings")).settings;
    renderSettings();
  } catch (error) {
    fail(error);
  }
}

function renderSettings() {
  // On / off of every game in the navigation
  document.querySelectorAll(".ad-state[data-game]").forEach((dot) => {
    var field = settingsList.find((f) => f.key == dot.dataset.game);
    dot.classList.toggle("off", field != null && field.value === false);
    dot.title = field && field.value === false ? "Off" : "On";
  });
  var sections = [];
  settingsList
    .filter((field) => field.group == settingsGroup)
    .forEach((field) => {
      var section = sections.find((s) => s.name == field.section);
      if (!section) sections.push((section = { name: field.section, fields: [] }));
      section.fields.push(field);
    });
  document.getElementById("adSettings").replaceChildren(
    ...sections.map((section) => {
      // A game on / off: a card of its own, over the whole width
      var toggle = section.fields.find((field) => field.type == "toggle");
      if (toggle) return toggleCard(toggle);
      var choice = section.fields.find((field) => field.type == "choice");
      if (choice) return choiceCard(choice);
      var card = el("div", "ad-card");
      var head = el("div", "ad-card-head");
      head.appendChild(el("h2", "ad-title", section.name));
      card.appendChild(head);
      section.fields.forEach((field) => {
        var row = el("label", "ad-setting");
        var label = el("span", "ad-setting-label", field.label);
        if (field.value != field.default) label.appendChild(el("span", "changed", "default " + formatCoins(field.default)));
        var input = el("input", "mm-input");
        input.type = "number";
        input.step = 1;
        input.min = field.min;
        input.max = field.max;
        input.value = field.value;
        input.dataset.key = field.key;
        var box = el("span", "ad-setting-input");
        box.appendChild(input);
        if (field.unit) box.appendChild(el("span", "ad-setting-unit", field.unit));
        row.append(label, box);
        if (field.hint) row.appendChild(el("span", "ad-setting-hint", field.hint));
        card.appendChild(row);
      });
      return card;
    }),
  );
  // Nothing to save on a page without numbers
  document.querySelector(".ad-settings-bar").hidden = !settingsList.some((field) => field.group == settingsGroup && field.type == "number");
}

// One of a few options (like the test bonus of the slots): saved right away
function choiceCard(field) {
  var on = field.value != field.default;
  var card = el("div", "ad-card ad-toggle-card ad-toggle-test" + (on ? " on" : " off"));
  var info = el("div", "ad-toggle-info");
  info.append(el("h2", "ad-title", field.label), el("p", "ad-note", field.hint || ""));
  var options = el("div", "ad-choice");
  options.setAttribute("role", "radiogroup");
  options.setAttribute("aria-label", field.label);
  field.options.forEach((option) => {
    var button = el("button", "ad-choice-option" + (option.value == field.value ? " active" : ""), option.label);
    button.type = "button";
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", option.value == field.value);
    button.addEventListener("click", async () => {
      if (option.value == field.value) return;
      options.querySelectorAll("button").forEach((b) => (b.disabled = true));
      try {
        settingsList = (await api("settings", { values: { [field.key]: option.value } })).settings;
      } catch (error) {
        fail(error);
      }
      renderSettings();
    });
    options.appendChild(button);
  });
  card.append(info, options);
  return card;
}

// A game on / off (or another switch, like a test mode): saved right away
function toggleCard(field) {
  var on = field.value !== false;
  var game = field.key.startsWith("GAME_");
  var card = el("div", "ad-card ad-toggle-card" + (on ? " on" : " off") + (game ? "" : " ad-toggle-test"));
  var info = el("div", "ad-toggle-info");
  if (game) info.append(el("h2", "ad-title", on ? field.label : field.label.replace(/ (is|are) on$/, " $1 off")), el("p", "ad-note", on ? "Players can find and play it." : "Hidden: no tab, the page leads to another game."));
  else info.append(el("h2", "ad-title", field.label), el("p", "ad-note", field.hint || ""));
  var label = el("label", "ad-switch ad-switch-big");
  var box = document.createElement("input");
  box.type = "checkbox";
  box.checked = on;
  box.setAttribute("aria-label", field.label);
  label.append(box, el("span", "ad-switch-track"), el("span", "ad-switch-text", on ? "On" : "Off"));
  box.addEventListener("change", async () => {
    if (game && !box.checked && !(await confirmDialog({ title: "Turn " + field.label.replace(/ (is|are) on$/, "") + " off?", text: "It disappears from the game bar. Players on it right now are sent to another game - seats are given up, bets come back.", confirmLabel: "Turn off", danger: true }))) {
      box.checked = true;
      return;
    }
    box.disabled = true;
    try {
      settingsList = (await api("settings", { values: { [field.key]: box.checked } })).settings;
      // (a test switch shows its state on the card - no toast)
      if (game) showToast(box.checked ? "It's on again" : "It's off now");
    } catch (error) {
      fail(error);
    }
    renderSettings();
  });
  card.append(info, label);
  return card;
}

async function saveSettings(event) {
  event.preventDefault();
  var values = {};
  var problem = null;
  document.querySelectorAll("#adSettings input[data-key]").forEach((input) => {
    var field = settingsList.find((f) => f.key == input.dataset.key);
    var value = Number(input.value);
    if (!Number.isInteger(value)) problem = field.label + ": a whole number, please.";
    else if (value != field.value) values[field.key] = value;
  });
  if (problem) return showToast(problem, "error");
  if (Object.keys(values).length == 0) return showToast("Nothing changed.");
  try {
    settingsList = (await api("settings", { values: values })).settings;
    renderSettings();
    showToast("Saved - " + Object.keys(values).length + (Object.keys(values).length == 1 ? " setting" : " settings") + " changed");
  } catch (error) {
    fail(error);
  }
}

async function settingsDefaults() {
  if (!(await confirmDialog({ title: "Back to the defaults?", text: "Every setting (and every game on / off) goes back to how it was at the start.", confirmLabel: "Reset settings" }))) return;
  try {
    settingsList = (await api("settings", { defaults: true })).settings;
    renderSettings();
    showToast("Back to the defaults");
  } catch (error) {
    fail(error);
  }
}

async function hardReset(event) {
  event.preventDefault();
  var input = document.getElementById("adResetConfirm");
  if (input.value != "RESET") return;
  if (!(await confirmDialog({ title: "Delete everything?", text: "The whole coin history, every payout, every access, all coins and every season (planned, running and over) are deleted, every game starts anew. This can't be undone.", confirmLabel: "Reset everything", danger: true }))) return;
  var button = document.getElementById("adResetButton");
  button.disabled = true;
  try {
    var result = await api("reset", { confirm: "RESET" });
    input.value = "";
    showToast("Everything is reset - " + formatCoins(result.history) + " history rows and " + formatCoins(result.payouts) + " payouts deleted");
    players = [];
    loadOverview();
  } catch (error) {
    fail(error);
  } finally {
    button.disabled = input.value != "RESET";
  }
}

/* ---------- Setup ---------- */

document.addEventListener("DOMContentLoaded", () => {
  var reasons = document.getElementById("adHistReason");
  REASONS.forEach((reason) => reasons.appendChild(Object.assign(document.createElement("option"), { value: reason, innerText: reason })));

  document.getElementById("adBalance").addEventListener("submit", saveBalance);
  var searchTimer = null;
  document.getElementById("adSearch").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadPlayers, 250);
  });
  var accessTimer = null;
  document.getElementById("adAccessSearch").addEventListener("input", () => {
    clearTimeout(accessTimer);
    accessTimer = setTimeout(loadAccess, 250);
  });
  document.getElementById("adPayoutStatus").addEventListener("change", loadPayouts);
  document.getElementById("adHistoryFilter").addEventListener("submit", loadHistory);
  document.getElementById("adLogout").addEventListener("click", async () => {
    await fetch("logout", { method: "POST" });
    window.location.reload();
  });

  document.getElementById("adChatClear").addEventListener("click", async () => {
    if (await confirmDialog({ title: "Clear the chat?", text: "Every message of the casino chat is deleted for everybody.", confirmLabel: "Clear the chat", danger: true })) chatAction("chat/clear", {}, "The chat is empty");
  });
  document.getElementById("adBanForm").addEventListener("submit", (event) => {
    event.preventDefault();
    var username = document.getElementById("adBanUser").value.trim();
    var minutes = document.getElementById("adBanTime").value;
    chatAction("chat/ban", { username: username, minutes: minutes ? Number(minutes) : null }, username + " is banned from the chat");
    document.getElementById("adBanUser").value = "";
  });
  document.getElementById("adSettingsForm").addEventListener("submit", saveSettings);
  document.getElementById("adSettingsDefaults").addEventListener("click", settingsDefaults);
  document.getElementById("adResetConfirm").addEventListener("input", (event) => {
    document.getElementById("adResetButton").disabled = event.target.value != "RESET";
  });
  document.getElementById("adResetForm").addEventListener("submit", hardReset);
  // Seasons
  document.getElementById("adSeasonForm").addEventListener("submit", saveSeason);
  document.getElementById("adSeasonCancel").addEventListener("click", seasonDefaults);
  document.getElementById("adSeasonPrizesOn").addEventListener("change", showPrizes);
  document.getElementById("adSeasonAddPrize").addEventListener("click", () => {
    var rows = document.querySelectorAll("#adSeasonPrizes .ad-prize-row");
    var last = rows.length ? Number(rows[rows.length - 1].querySelector(".ad-prize-place").value) || rows.length : 0;
    var row = prizeRow({ place: last + 1, prize: "" });
    document.getElementById("adSeasonPrizes").appendChild(row);
    row.querySelector("input:not(.ad-prize-place)").focus();
  });
  document.getElementById("adSeasonIcons").replaceChildren(
    ...SEASON_ICONS.map((icon) => {
      var b = el("button", "ad-icon-pick", icon);
      b.type = "button";
      b.addEventListener("click", () => {
        document.getElementById("adSeasonIcon").value = icon;
        markIcon();
      });
      return b;
    }),
  );
  document.getElementById("adSeasonIcon").addEventListener("input", markIcon);
  document.getElementById("adSeasonColors").replaceChildren(
    ...SEASON_COLORS.map((color) => {
      var b = el("button", "ad-color-pick");
      b.type = "button";
      b.dataset.color = color;
      b.style.background = color;
      b.title = color;
      b.addEventListener("click", () => {
        document.getElementById("adSeasonColor").value = color;
        markColor();
      });
      return b;
    }),
  );
  document.getElementById("adSeasonColor").addEventListener("input", markColor);
  document.getElementById("adSeasonHex").addEventListener("input", (event) => {
    var value = event.target.value.trim();
    if (!value.startsWith("#")) value = "#" + value;
    // #abc -> #aabbcc
    if (/^#[0-9a-f]{3}$/i.test(value)) value = "#" + [...value.slice(1)].map((c) => c + c).join("");
    if (!/^#[0-9a-f]{6}$/i.test(value)) return;
    document.getElementById("adSeasonColor").value = value.toLowerCase();
    markColor();
  });

  showTab();
  loadOverview();
  // New payouts, balances and history show up by themselves
  setInterval(refresh, 5000);
});
