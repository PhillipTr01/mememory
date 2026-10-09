/* Admin panel: balances, payouts, leaderboard, the history of every coin change, the casino chat and the settings. */

// The kinds of coin changes for the history filter - by game (a whole game: all of its kinds)
var HISTORY_KINDS = [
  ["Casino", [["start coins", "Start coins"], ["daily bonus", "Daily bonus"], ["admin", "Admin"], ["withdrawal", "Payout"], ["withdrawal refund", "Payout refund"]]],
  ["Seasons", [["season start", "Season start"], ["second chance", "Second chance"]]],
  ["Gifts", [["gift sent", "Sent"], ["gift received", "Received"]]],
  ["Jackpot", [["jackpot bet", "Bet"], ["jackpot win", "Win"]]],
  ["Case battles", [["battle", "Bet"], ["battle win", "Win"], ["battle refund", "Refund"]]],
  ["Poker", [["poker buy-in", "Buy-in"], ["poker chips", "More chips"], ["poker cash-out", "Cash-out"], ["poker refund", "Refund"]]],
  ["Blackjack", [["blackjack bet", "Bet"], ["blackjack win", "Win"], ["blackjack refund", "Refund"]]],
  ["Slots", [["slots bet", "Bet"], ["slots win", "Win"]]],
  ["Roulette", [["roulette bet", "Bet"], ["roulette win", "Win"], ["roulette refund", "Refund"]]],
  ["Bầu Cua", [["baucua bet", "Bet"], ["baucua win", "Win"], ["baucua refund", "Refund"]]],
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

// A player: the avatar and the name (in a table cell or a row)
function playerTag(name, tag) {
  var box = el(tag || "span", "ad-player");
  box.append(createAvatar(name, "sm"), el("span", "ad-player-name", name));
  return box;
}

function playerCell(name) {
  var cell = el("td", "fw-semibold");
  cell.appendChild(playerTag(name));
  return cell;
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
  if (error.message != "logged out") showHint(error.message, "error");
}

/* ---------- Tabs ---------- */

var PAGES = {
  overview: ["Overview", "Everything at a glance - what needs you, and what is going on right now."],
  players: ["Players", "Who may play, who wants in, their coins and payouts."],
  payouts: ["Payouts", "Coins players took off to be paid out."],
  history: ["History", "Every coin change, newest first."],
  chat: ["Chat", "The chat of the casino - delete messages, ban players."],
  seasons: ["Seasons", "Plan seasons: everybody starts with the same budget, the best win."],
};

// The pages of the settings: general and one per game
var SETTING_GROUPS = {
  general: ["General settings", "Coins for everybody, gifts - and the hard reset."],
  test: ["Test mode", "Try the casino with a sandbox balance - nothing is saved, nobody else is touched."],
  rain: ["Money rain", "Coins for many players at once - now or planned, for everybody, who is online, the last of the leaderboard or who has little."],
  shop: ["Shop", "The frames and animations of the casino: on or off, the prices - and free for all to test them."],
  maintenance: ["Maintenance", "Close the casino for everybody but a whitelist - with when it is most likely over."],
  jackpot: ["Jackpot", "Turn the jackpot on or off, its bets and timing."],
  battles: ["Case battles", "Turn case battles on or off, their limits - and the cases."],
  poker: ["Poker", "Turn poker on or off, the buy-ins."],
  blackjack: ["Blackjack", "Turn blackjack on or off, the seats and the limits of every table."],
  slots: ["Slots", "Turn slots on or off, the bet per spin."],
  roulette: ["Roulette", "Turn the roulette on or off, the bets, the time to bet."],
  baucua: ["Bầu Cua", "Turn Bầu Cua on or off, the bets, the time to bet."],
};
var settingsGroup = "general";

var GAME_GROUPS = ["jackpot", "roulette", "baucua", "battles", "poker", "blackjack", "slots"];

// Old addresses (bookmarks): to where it is now
function redirect(parts) {
  if (parts[0] == "access") return "#players";
  if (parts[0] == "settings") return GAME_GROUPS.includes(parts[1]) ? "#games/" + parts[1] : "#casino/" + (parts[1] == "maintenance" ? "maintenance" : "general");
  if (parts[0] == "cases") return "#games/battles" + (parts[1] ? "/case/" + parts[1] : "");
  if (parts[0] == "games" && !GAME_GROUPS.includes(parts[1])) return "#games/jackpot";
  if (parts[0] == "casino" && !["maintenance", "general", "shop", "test", "rain"].includes(parts[1])) return "#casino/general";
  return null;
}

function showTab() {
  var parts = (location.hash || "#overview").slice(1).split("/");
  var moved = redirect(parts);
  if (moved) return location.replace(moved);
  var tab = parts[0];
  // Games and casino: the settings page of that group (case battles: with its cases)
  var settingsPage = tab == "games" || tab == "casino";
  if (settingsPage) settingsGroup = parts[1];
  var casePage = tab == "games" && parts[1] == "battles" && parts[2] == "case" && parts[3];
  if (!settingsPage && !PAGES[tab]) tab = "overview";
  var section = settingsPage ? "settings" : tab;
  document.querySelectorAll(".ad-tab").forEach((page) => {
    var show = page.id == "tab-" + section;
    if (page.id == "tab-settings") show = settingsPage && !casePage;
    if (page.id == "tab-cases") show = settingsPage && settingsGroup == "battles";
    page.hidden = !show;
  });
  document.querySelectorAll(".ad-nav-item[data-tab]").forEach((link) => link.classList.toggle("active", link.dataset.tab == tab));
  document.querySelectorAll(".ad-nav-item[data-group]").forEach((link) => link.classList.toggle("active", settingsPage && link.dataset.group == settingsGroup));
  document.getElementById("adPageTitle").innerText = settingsPage ? SETTING_GROUPS[settingsGroup][0] : PAGES[tab][0];
  document.getElementById("adPageSub").innerText = settingsPage ? SETTING_GROUPS[settingsGroup][1] : PAGES[tab][1];
  document.getElementById("adDanger").hidden = settingsGroup != "general";
  if (settingsPage && settingsGroup == "general") loadResetParts();
  // Maintenance: a page of its own (its own save) - the settings and their save bar on every other page
  var maintPage = settingsGroup == "maintenance";
  var shopPage = settingsPage && settingsGroup == "shop";
  var testPage = settingsPage && settingsGroup == "test";
  var rainPage = settingsPage && settingsGroup == "rain";
  document.getElementById("adRain").hidden = !rainPage;
  document.getElementById("adMaint").hidden = !maintPage;
  document.getElementById("adShop").hidden = !shopPage;
  document.getElementById("adTest").hidden = !testPage;
  document.getElementById("adSettingsForm").hidden = maintPage || shopPage || testPage || rainPage;
  document.getElementById("adSettingsBar").hidden = maintPage || shopPage || testPage || rainPage;
  if (tab == "players") loadPlayers();
  if (tab == "payouts") loadPayouts();
  if (tab == "history") loadHistory();
  if (tab == "chat") loadChat();
  if (tab == "seasons") {
    seasonView = parts[1] == "new" ? "new" : parts[1] ? Number(parts[1]) : null;
    // #seasons/<id>/edit: the form of the season (its page is only to look at)
    seasonEdit = parts[2] == "edit" && typeof seasonView == "number";
    seasonFormFor = undefined;
    boardLoaded = { id: null, at: 0 };
    closePicker();
    loadSeasons();
  }
  if (settingsPage) {
    loadSettings();
    if (maintPage) loadMaintenance();
    if (shopPage) loadShop();
    if (testPage) loadTest();
    if (rainPage) loadRains();
  }
  if (settingsPage && settingsGroup == "battles") {
    caseView = casePage ? decodeURIComponent(parts[3]) : null;
    caseDraft = null;
    loadCases();
  }
}

window.addEventListener("hashchange", showTab);

// Keeps the open page up to date (the chat has its own timer, the settings stay as they are while editing)
var REFRESH = { players: () => loadPlayers(), payouts: () => loadPayouts(), history: () => loadHistory(), seasons: () => loadSeasons(true) };

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
  info.append(playerTag(w.username, "b"), el("span", "ad-row-meta", time(w.createdAt) + (w.note ? " · " + w.note : "")));
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
            var name = playerTag(p.username);
            name.classList.add("ad-row-main", "fw-semibold");
            var value = el("span", "ad-row-value", "🪙 " + formatCoins(p.coins));
            row.append(el("span", "ad-rank", i + 1), name, value);
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
      if (fresh.length) {
        var sum = fresh.reduce((total, w) => total + w.amount, 0);
        casinoNotice({ icon: "💸", title: fresh.length == 1 ? "New payout" : fresh.length + " new payouts", text: (fresh.length == 1 ? fresh[0].username + " · " : "") + "🪙 " + formatCoins(sum), action: { label: "Open", run: () => (location.hash = "#payouts") }, ms: 10000, key: "payout" });
        if (!document.getElementById("tab-payouts").hidden) loadPayouts();
      }
    }
    knownOpen = ids;
    var badge = document.getElementById("adOpenBadge");
    badge.hidden = ids.length == 0;
    // Players who want into the casino
    if (knownWaiting != null && data.waiting > knownWaiting) {
      casinoNotice({ icon: "🔑", title: data.waiting - knownWaiting == 1 ? "A player wants in" : data.waiting - knownWaiting + " players want in", text: "Approve or decline them in Players", action: { label: "Open", run: () => (location.hash = "#players") }, ms: 10000, key: "access" });
      if (!document.getElementById("tab-players").hidden) loadPlayers();
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
  } catch (error) {
    fail(error);
  }
}

// What the games are doing right now
var PHASE_TEXT = { idle: "waiting for bets", rolling: "rolling", open: "waiting for bets", countdown: "countdown", drawing: "drawing", betting: "taking bets", playing: "playing", dealer: "dealer's turn", result: "paying out", waiting: "waiting", preflop: "pre-flop", flop: "flop", turn: "turn", river: "river", showdown: "showdown" };

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
  // The shared rounds: roulette and Bầu cua
  [
    ["roulette", "🎡", "Roulette"],
    ["baucua", "🦀", "Bầu Cua"],
  ].forEach(([key, icon, name]) => {
    var g = games[key];
    if (g) rows.push(liveRow(icon, name, "Round " + g.round + " · " + (PHASE_TEXT[g.phase] || g.phase) + " · " + g.players + (g.players == 1 ? " player" : " players"), "🪙 " + formatCoins(g.total), g.total > 0));
  });
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
  info.append(playerTag(request.username, "b"), el("span", "ad-row-meta", "asked " + time(request.requestedAt)));
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
      loadOverview();
      if (!document.getElementById("tab-players").hidden) loadPlayers();
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

// The players: every account with its access, its coins, its payout - one list
var playerFilter = "";
var playerRows = [];

async function loadPlayers() {
  try {
    var q = encodeURIComponent(document.getElementById("adSearch").value.trim());
    var [data, balances] = await Promise.all([api("access?q=" + q), api("users?q=" + q)]);
    players = balances;
    var coinsOf = new Map(balances.map((p) => [p.username, p.coins]));
    // What approving gives right now (a running season: what "Start" gives)
    var info = document.getElementById("adAccessInfo");
    info.replaceChildren(
      el("span", "", data.join ? "Approved now, a player hits Start in the season and gets " : "Approving a player now gives "),
      el("b", "", "🪙 " + formatCoins(data.join ? data.join.coins : data.startCoins)),
      el("span", "mm-muted", data.join ? " (the season's budget" + (data.join.missed > 0 ? " + " + data.join.missed + " missed daily bonus" + (data.join.missed == 1 ? "" : "es") : "") + ")" : " (the start coins)"),
    );
    // Who wants in first, then the players by coins, then the rest
    var kind = (p) => (p.approved ? "in" : p.requestedAt ? "waiting" : "none");
    playerRows = data.players
      .map((p) => ({ ...p, kind: kind(p), coins: coinsOf.has(p.username) ? coinsOf.get(p.username) : null }))
      .sort((x, y) => ["waiting", "in", "none"].indexOf(x.kind) - ["waiting", "in", "none"].indexOf(y.kind) || (y.coins || 0) - (x.coins || 0) || x.username.localeCompare(y.username));
    var count = (k) => playerRows.filter((p) => !k || p.kind == k).length;
    document.getElementById("adCountAll").innerText = count("");
    document.getElementById("adCountIn").innerText = count("in");
    document.getElementById("adCountWaiting").innerText = count("waiting") || "";
    document.getElementById("adCountNone").innerText = count("none");
    renderPlayers();
  } catch (error) {
    fail(error);
  }
}

function renderPlayers() {
  document.querySelectorAll("#adPlayerFilter button").forEach((b) => b.classList.toggle("active", b.dataset.filter == playerFilter));
  var rows = playerRows.filter((p) => !playerFilter || p.kind == playerFilter);
  var list = document.getElementById("adBoard");
  if (rows.length == 0) {
    var empty = el("tr");
    var cell = el("td", "mm-muted", playerFilter == "waiting" ? "Nobody is waiting." : "No players.");
    cell.colSpan = 5;
    empty.appendChild(cell);
    return list.replaceChildren(empty);
  }
  list.replaceChildren(...rows.map(playerRow));
}

function playerRow(p) {
  var row = el("tr", p.kind == "waiting" ? "ad-waiting" : p.kind == "none" ? "ad-noaccess" : "");
  var status =
    p.kind == "in"
      ? el("span", "ad-pill success", "in" + (p.approvedAt && new Date(p.approvedAt).getTime() > 0 ? " since " + day(p.approvedAt) : ""))
      : p.kind == "waiting"
        ? el("span", "ad-pill accent", "wants in · " + time(p.requestedAt))
        : el("span", "ad-pill", "no access");
  var statusCell = el("td");
  statusCell.appendChild(status);
  var coins = el("td", "num", p.coins != null && p.kind == "in" ? "🪙 " + formatCoins(p.coins) : "–");
  // May the player pay coins out? (only who is in)
  var payoutCell = el("td");
  if (p.kind == "in") {
    var payout = el("label", "ad-switch");
    var box = document.createElement("input");
    box.type = "checkbox";
    box.checked = p.payout;
    box.setAttribute("aria-label", "Payout for " + p.username);
    var text = el("span", "ad-switch-text", p.payout ? "On" : "Off");
    box.addEventListener("change", () => setPayout(p, box, text));
    payout.append(box, el("span", "ad-switch-track"), text);
    payoutCell.appendChild(payout);
  } else payoutCell.appendChild(el("span", "mm-muted", "–"));
  var actions = el("td", "ad-actions");
  var button = (label, cls, handler) => {
    var b = el("button", "mm-btn mm-btn-sm" + (cls ? " " + cls : ""), label);
    b.type = "button";
    b.addEventListener("click", () => handler(b));
    actions.appendChild(b);
    return b;
  };
  if (p.kind == "waiting") {
    button("Approve", "mm-btn-primary", (b) => setAccess(p, true, b));
    button("Decline", "", (b) => declineRequest(p.username, b));
  } else if (p.kind == "in") {
    button("Coins", "", () => editPlayerCoins(p));
    button("History", "", () => showHistoryOf(p.username));
    button("Revoke", "ad-btn-quiet-danger", (b) => setAccess(p, false, b));
  } else {
    button("Approve", "", (b) => setAccess(p, true, b));
    button("History", "", () => showHistoryOf(p.username));
  }
  row.append(playerCell(p.username), statusCell, coins, payoutCell, actions);
  return row;
}

function showHistoryOf(username) {
  document.getElementById("adHistUser").value = username;
  document.getElementById("adHistClear").hidden = false;
  location.hash = "#history";
}

async function declineRequest(username, button) {
  button.disabled = true;
  try {
    await api("access/decline", { username: username });
    loadOverview();
    if (!document.getElementById("tab-players").hidden) loadPlayers();
  } catch (error) {
    button.disabled = false;
    fail(error);
  }
}

async function setAccess(player, approve, button) {
  if (!approve && !(await confirmDialog({ title: "Take " + player.username + "'s access away?", text: "Their open casino pages close right away. The coins stay for a later approval.", confirmLabel: "Revoke access", danger: true }))) return;
  button.disabled = true;
  button.innerText = approve ? "Approving..." : "Revoking...";
  try {
    await api("access", { username: player.username, approve: approve });
    loadOverview();
    if (!document.getElementById("tab-players").hidden) loadPlayers();
  } catch (error) {
    button.disabled = false;
    button.innerText = approve ? "Approve" : "Revoke";
    fail(error);
  }
}

async function setPayout(player, box, text) {
  box.disabled = true;
  text.innerText = box.checked ? "On" : "Off";
  try {
    await api("payout", { username: player.username, allowed: box.checked });
    player.payout = box.checked;
  } catch (error) {
    box.checked = !box.checked;
    text.innerText = box.checked ? "On" : "Off";
    fail(error);
  } finally {
    box.disabled = false;
  }
}

// Coins of a player: set to / add (+/-), a note - in a small dialog; the error in it, not as a toast
// options: {title, text, current, step, save(mode, amount, note) -> Promise}
function coinsDialog(options) {
  var backdrop = el("div", "mm-dialog-backdrop");
  var dialog = el("form", "mm-dialog ad-coins-dialog");
  dialog.noValidate = true;
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  var mode = el("select", "mm-input");
  [["set", "Set to"], ["add", "Add (+/-)"]].forEach(([value, text]) => mode.appendChild(Object.assign(document.createElement("option"), { value: value, text: text })));
  var amount = Object.assign(el("input", "mm-input"), { type: "number", step: options.step || 1000, value: options.current });
  amount.setAttribute("aria-label", "Coins");
  var note = Object.assign(el("input", "mm-input"), { placeholder: "Note (optional) - shows in the history", maxLength: 300 });
  var error = el("p", "ad-form-error");
  error.hidden = true;
  mode.addEventListener("change", () => {
    amount.value = mode.value == "set" ? options.current : "";
    amount.focus();
  });
  var cancel = el("button", "mm-btn", "Cancel");
  cancel.type = "button";
  var save = el("button", "mm-btn mm-btn-primary", "Save");
  save.type = "submit";
  var actions = el("div", "mm-dialog-actions");
  actions.append(cancel, save);
  var fields = el("div", "ad-coins-fields");
  fields.append(mode, amount);
  dialog.append(el("h2", "mm-dialog-title", options.title), el("p", "mm-dialog-text", options.text), fields, note, error, actions);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  var close = () => {
    document.removeEventListener("keydown", onKey);
    backdrop.remove();
  };
  var onKey = (event) => event.key == "Escape" && close();
  document.addEventListener("keydown", onKey);
  cancel.addEventListener("click", close);
  backdrop.addEventListener("click", (event) => event.target == backdrop && close());
  dialog.addEventListener("submit", async (event) => {
    event.preventDefault();
    var value = Number(amount.value);
    error.hidden = true;
    if (!Number.isInteger(value)) {
      error.innerText = "A whole number, please.";
      error.hidden = false;
      return;
    }
    save.disabled = true;
    try {
      await options.save(mode.value, value, note.value.trim() || undefined);
      close();
    } catch (problem) {
      save.disabled = false;
      error.innerText = problem.message;
      error.hidden = false;
    }
  });
  amount.focus();
  amount.select();
}

function editPlayerCoins(p) {
  coinsDialog({
    title: p.username,
    text: "Normal coins now: 🪙 " + formatCoins(p.coins || 0) + (seasonList.some((s) => s.status == "running") ? " - the season coins are changed in the season's page." : ""),
    current: p.coins || 0,
    save: async (mode, amount, note) => {
      await api("balance", { username: p.username, mode: mode, amount: amount, note: note });
      loadPlayers();
      loadOverview();
    },
  });
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

// The page of the history (1: the newest) - a filter changed: back to the first
var historyPage = 1;
var historyFilter = "";

async function loadHistory(event) {
  if (event && event.preventDefault) event.preventDefault();
  var params = new URLSearchParams();
  var user = document.getElementById("adHistUser").value.trim();
  var reason = document.getElementById("adHistReason").value;
  var scope = document.getElementById("adHistScope");
  if (user) params.set("username", user);
  if (reason) params.set("reason", reason);
  if (!scope.hidden && scope.value) params.set("scope", scope.value);
  if (params.toString() != historyFilter) historyPage = 1;
  historyFilter = params.toString();
  params.set("page", historyPage);
  try {
    var data = await api("history?" + params.toString());
    historyPage = data.page;
    var pager = document.getElementById("adHistPager");
    pager.hidden = data.pages <= 1;
    document.getElementById("adHistPage").innerText = "Page " + data.page + " of " + data.pages + " · " + formatCoins(data.total) + " changes";
    document.getElementById("adHistPrev").disabled = data.page <= 1;
    document.getElementById("adHistNext").disabled = data.page >= data.pages;
    // The names to pick from - and in a season its own history
    historyNames = data.names;
    if (!document.getElementById("adHistNames").hidden) showPlayerPick();
    scope.hidden = !data.season;
    if (data.season) scope.options[1].text = data.season.icon + " " + data.season.name;
    else scope.value = "";
    var rows = data.rows;
    var body = document.getElementById("adHistory");
    if (rows.length == 0) {
      var empty = el("tr");
      var cell = el("td", "mm-muted", user || reason ? "Nothing found." : "Nothing yet.");
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
        tr.append(el("td", "mm-muted small", time(row.at)), playerCell(row.username), what, el("td", "num " + (row.amount < 0 ? "minus" : "plus"), (row.amount > 0 ? "+" : "") + formatCoins(row.amount)));
        return tr;
      }),
    );
  } catch (error) {
    fail(error);
  }
}

/* ---------- Maintenance: only the whitelist gets in ---------- */

var maint = null; // {on, whitelist, until, note} as saved
var maintForm = null; // the form while it is changed (whitelist, until, note)
var maintPlayers = [];

/* ---------- Test mode ---------- */

/* ---------- Money rains ---------- */

var RAIN_TARGETS = { all: "every player", online: "who is online", bottom: "the last %", below: "less than" };
var RAIN_REPEATS = { none: "", daily: " · every day", weekly: " · every week" };

function rainInput() {
  var target = document.getElementById("adRainTarget").value;
  var later = document.getElementById("adRainWhen").value == "later";
  var at = later && document.getElementById("adRainAt").value ? new Date(document.getElementById("adRainAt").value).getTime() : null;
  return {
    amount: Number(document.getElementById("adRainAmount").value),
    target: target,
    percent: Number(document.getElementById("adRainPercent").value),
    below: Number(document.getElementById("adRainBelow").value),
    world: document.getElementById("adRainWorld").value,
    repeat: document.getElementById("adRainRepeat").value,
    note: document.getElementById("adRainNote").value,
    at: at,
  };
}

function rainWho(rain) {
  var who = rain.target == "bottom" ? "the last " + rain.percent + "% of the leaderboard" : rain.target == "below" ? "everybody with less than 🪙 " + formatCoins(rain.below) : RAIN_TARGETS[rain.target];
  return who + (rain.world == "season" ? " (season)" : "");
}

var rainPreviewTimer = null;
function rainFormChanged() {
  var input = rainInput();
  document.getElementById("adRainPercentField").hidden = input.target != "bottom";
  document.getElementById("adRainBelowField").hidden = input.target != "below";
  var later = document.getElementById("adRainWhen").value == "later";
  document.getElementById("adRainAtField").hidden = !later;
  document.getElementById("adRainGo").innerText = later ? "📅 Plan the money rain" : "💸 Let it rain now";
  clearTimeout(rainPreviewTimer);
  rainPreviewTimer = setTimeout(async () => {
    var box = document.getElementById("adRainPreview");
    try {
      var p = await api("rains/preview", input);
      box.innerText = "Right now: " + p.players + (p.players == 1 ? " player" : " players") + " · 🪙 " + formatCoins(p.total) + " in total" + (input.target == "online" || later ? " (who gets it is decided when it rains)" : "");
      box.title = p.names.join(", ");
    } catch (error) {
      box.innerText = error.message;
      box.title = "";
    }
  }, 250);
}

function rainRow(rain, planned) {
  var row = el("div", "ad-rain-row");
  var main = el("div", "ad-rain-main");
  main.append(
    el("b", "", "🪙 " + formatCoins(rain.amount) + " for " + rainWho(rain)),
    el("span", "ad-note", planned ? new Date(rain.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) + RAIN_REPEATS[rain.repeat] + (rain.note ? " · “" + rain.note + "”" : "") : new Date(rain.doneAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) + " · " + rain.players + (rain.players == 1 ? " player" : " players") + " · 🪙 " + formatCoins(rain.paid) + (rain.note ? " · “" + rain.note + "”" : "")),
  );
  row.appendChild(main);
  if (planned) {
    var now = el("button", "mm-btn mm-btn-sm", "Now");
    now.type = "button";
    now.addEventListener("click", async () => {
      now.disabled = true;
      try {
        renderRains(await api("rains/" + rain.id + "/now", {}));
      } catch (error) {
        fail(error);
        now.disabled = false;
      }
    });
    var cancel = el("button", "mm-btn mm-btn-sm ad-danger-btn", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", async () => {
      if (!confirm("Cancel this money rain?")) return;
      try {
        renderRains(await api("rains/" + rain.id + "/cancel", {}));
      } catch (error) {
        fail(error);
      }
    });
    row.append(now, cancel);
  }
  return row;
}

function renderRains(data) {
  document.getElementById("adRainPlanned").replaceChildren(...(data.planned.length ? data.planned.map((r) => rainRow(r, true)) : [el("p", "ad-note", "Nothing planned.")]));
  document.getElementById("adRainDone").replaceChildren(...(data.done.length ? data.done.map((r) => rainRow(r, false)) : [el("p", "ad-note", "No money rain yet.")]));
  document.getElementById("adRainDot").hidden = !data.planned.length;
}

var rainWired = false;
async function loadRains() {
  if (!rainWired) {
    rainWired = true;
    ["adRainAmount", "adRainTarget", "adRainPercent", "adRainBelow", "adRainWorld", "adRainWhen", "adRainAt", "adRainRepeat"].forEach((id) => {
      document.getElementById(id).addEventListener("input", rainFormChanged);
      document.getElementById(id).addEventListener("change", rainFormChanged);
    });
    document.getElementById("adRainGo").addEventListener("click", async () => {
      var button = document.getElementById("adRainGo");
      var error = document.getElementById("adRainError");
      error.hidden = true;
      var input = rainInput();
      if (document.getElementById("adRainWhen").value == "later" && input.at == null) {
        error.innerText = "Pick a date and time.";
        error.hidden = false;
        return;
      }
      button.disabled = true;
      try {
        var result = await api("rains", input);
        renderRains(result);
        var rain = result.rain;
        showHint(rain.status == "done" ? "💸 It rained: " + rain.players + (rain.players == 1 ? " player" : " players") + " got 🪙 " + formatCoins(rain.amount) : "📅 Money rain planned", "success", button);
      } catch (e) {
        error.innerText = e.message;
        error.hidden = false;
      }
      button.disabled = false;
    });
  }
  var data;
  try {
    data = await api("rains");
  } catch (error) {
    return fail(error);
  }
  document.getElementById("adRainWorldField").hidden = !data.season;
  // The season: with its icon, name and coin
  if (data.season) document.querySelector('#adRainWorld option[value="season"]').textContent = data.season.icon + " " + data.season.name + " (" + data.season.coinIcon + ")";
  if (!data.season) document.getElementById("adRainWorld").value = "normal";
  // The time field: in an hour (rounded)
  var at = document.getElementById("adRainAt");
  if (!at.value) {
    var soon = new Date(Date.now() + 3600 * 1000);
    soon.setMinutes(0, 0, 0);
    at.value = new Date(soon.getTime() - soon.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  renderRains(data);
  rainFormChanged();
}

async function loadTest() {
  var data;
  try {
    data = await api("test");
  } catch (error) {
    return fail(error);
  }
  var select = document.getElementById("adTestPlayer");
  var picked = select.value;
  select.replaceChildren(...data.players.map((name) => new Option(name, name)));
  if (picked && data.players.includes(picked)) select.value = picked;
  var coins = document.getElementById("adTestCoins");
  if (!coins.value) coins.value = data.defaultCoins;
  renderTesters(data.testers);
  // The choices of the debug tools
  var fill = (id, values, label) => {
    var box = document.getElementById(id);
    if (box.options.length) return;
    box.replaceChildren(...values.map((value) => new Option(label ? label(value) : value, value)));
  };
  fill("adToolJackpotMode", data.options.draws);
  fill("adToolDeal", data.options.deals, (deal) => deal.replace("-", " "));
  fill("adToolBattleMode", data.options.modes);
}

function renderTesters(testers) {
  document.getElementById("adTestDot").hidden = testers.length == 0;
  document.getElementById("adTestEmpty").hidden = testers.length > 0;
  document.getElementById("adTestList").replaceChildren(
    ...testers.map((tester) => {
      var row = el("div", "ad-test-row");
      var who = el("div", "ad-test-who");
      who.append(createAvatar(tester.username, "sm"), el("b", "", tester.username), el("span", "ad-note", "🪙 " + formatCoins(tester.coins) + " now · started " + new Date(tester.since).toLocaleTimeString()));
      var refill = el("button", "mm-btn mm-btn-sm", "Refill");
      refill.type = "button";
      refill.title = "Back to 🪙 " + formatCoins(tester.start);
      refill.addEventListener("click", () => startTest(tester.username, tester.start, refill));
      var stop = el("button", "mm-btn mm-btn-sm mm-btn-danger-solid", "Stop");
      stop.type = "button";
      stop.addEventListener("click", async () => {
        stop.disabled = true;
        try {
          renderTesters((await api("test/stop", { username: tester.username })).testers);
          showHint("Test mode over - " + tester.username + " has the real coins again.", "success", document.getElementById("adTestStart"));
        } catch (error) {
          fail(error);
          stop.disabled = false;
        }
      });
      row.append(who, refill, stop);
      return row;
    }),
  );
}

async function startTest(username, coins, button) {
  button.disabled = true;
  try {
    renderTesters((await api("test", { username: username, coins: coins })).testers);
    showHint("🧪 " + username + " plays with test coins now.", "success", button);
  } catch (error) {
    fail(error);
  } finally {
    button.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-bots]").forEach((button) =>
    button.addEventListener("click", async () => {
      var game = button.dataset.bots;
      var body = { game: game, count: Number(button.dataset.count), amount: Math.floor(Number(document.getElementById(game == "jackpot" ? "adBotJackpotAmount" : game == "baucua" ? "adBotBaucuaAmount" : "adBotRouletteAmount").value)) };
      if (game == "roulette") body.color = document.getElementById("adBotRouletteColor").value;
      if (game == "baucua") body.animal = document.getElementById("adBotBaucuaAnimal").value;
      button.disabled = true;
      try {
        var data = await api("test/bots", body);
        showHint("🤖 " + data.added + (data.added == 1 ? " bot" : " bots") + " in the " + game + ".", "success", button);
      } catch (error) {
        showHint(error.message, "error", button);
      } finally {
        button.disabled = false;
      }
    }),
  );
  // A lever: data-lever="game:action[:value or #select]" ("me": the first tester)
  document.querySelectorAll("[data-lever]").forEach((button) =>
    button.addEventListener("click", async () => {
      var [game, action, ...rest] = button.dataset.lever.split(":");
      var value = rest.join(":");
      if (value.startsWith("#")) value = document.querySelector(value).value;
      var tester = document.querySelector(".ad-test-row b");
      if (value == "me") value = tester ? tester.innerText : "";
      button.disabled = true;
      try {
        await api("test/debug", { game: game, action: action, value: value || null });
        showHint("✓ " + button.innerText.replace(/^\W+\s*/, ""), "success", button);
      } catch (error) {
        showHint(error.message, "error", button);
      } finally {
        button.disabled = false;
      }
    }),
  );
  document.querySelectorAll("[data-now]").forEach((button) =>
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await api("test/now", { game: button.dataset.now });
        showHint("Done.", "success", button);
      } catch (error) {
        showHint(error.message, "error", button);
      } finally {
        button.disabled = false;
      }
    }),
  );
  document.getElementById("adTestStart").addEventListener("click", (event) => {
    startTest(document.getElementById("adTestPlayer").value, Math.floor(Number(document.getElementById("adTestCoins").value)), event.currentTarget);
  });
});

/* ---------- The accessory shop ---------- */

var shopSaved = null; // {items, free} as on the server
var shopDraft = null; // {items: {id: {on, price}}, free} - what changed here

async function loadShop() {
  try {
    shopSaved = await api("shop");
  } catch (error) {
    return fail(error);
  }
  shopDraft = { items: {}, free: shopSaved.free };
  renderShop();
}

function shopValue(item, key) {
  var change = shopDraft.items[item.id];
  return change && key in change ? change[key] : item[key];
}

function shopDirty() {
  return shopDraft.free != shopSaved.free || Object.keys(shopDraft.items).some((id) => {
    var item = shopSaved.items.find((i) => i.id == id);
    return Object.keys(shopDraft.items[id]).some((key) => shopDraft.items[id][key] !== item[key]);
  });
}

function setShop(id, key, value) {
  shopDraft.items[id] = Object.assign({}, shopDraft.items[id], { [key]: value });
  document.getElementById("adShopSave").disabled = !shopDirty();
}

function renderShop() {
  var free = document.getElementById("adShopFree");
  free.checked = shopDraft.free;
  document.getElementById("adShopFreeText").innerText = shopDraft.free ? "On" : "Off";
  document.getElementById("adShopDot").hidden = !shopSaved.free;
  ["frame", "effect"].forEach((kind) => {
    document.getElementById(kind == "frame" ? "adShopFrames" : "adShopEffects").replaceChildren(
      ...shopSaved.items
        .filter((item) => item.kind == kind)
        .map((item) => {
          var row = el("div", "ad-shop-row" + (shopValue(item, "on") ? "" : " off"));
          var name = el("div", "ad-shop-name");
          name.append(el("b", "", item.name), el("small", "ad-shop-rarity " + item.rarity, item.rarity));
          var price = el("span", "ad-inline-input");
          var input = el("input", "mm-input ad-shop-price");
          input.type = "number";
          input.min = 0;
          input.step = 500;
          input.value = shopValue(item, "price");
          input.setAttribute("aria-label", item.name + " price");
          input.addEventListener("input", () => setShop(item.id, "price", Math.max(0, Math.floor(Number(input.value) || 0))));
          price.append(el("span", "ad-setting-unit", "🪙"), input);
          if (shopValue(item, "price") != item.defaultPrice) price.title = "Normally " + formatCoins(item.defaultPrice);
          var toggle = el("label", "ad-switch");
          var box = el("input");
          box.type = "checkbox";
          box.checked = shopValue(item, "on");
          box.setAttribute("aria-label", item.name + " on");
          box.addEventListener("change", () => {
            setShop(item.id, "on", box.checked);
            row.classList.toggle("off", !box.checked);
          });
          toggle.append(box, el("span", "ad-switch-track"));
          row.append(toggle, name, price);
          return row;
        }),
    );
  });
  document.getElementById("adShopSave").disabled = !shopDirty();
}

async function saveShop() {
  var button = document.getElementById("adShopSave");
  button.disabled = true;
  var endsFree = shopSaved.free && !shopDraft.free;
  try {
    shopSaved = await api("shop", shopDraft);
    shopDraft = { items: {}, free: shopSaved.free };
    renderShop();
    showHint(endsFree ? "Saved - everything nobody bought came off." : "Saved.", "success", button);
  } catch (error) {
    fail(error);
    button.disabled = !shopDirty();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("adShopFree").addEventListener("change", (event) => {
    shopDraft.free = event.target.checked;
    document.getElementById("adShopFreeText").innerText = shopDraft.free ? "On" : "Off";
    document.getElementById("adShopSave").disabled = !shopDirty();
  });
  document.getElementById("adShopSave").addEventListener("click", saveShop);
});

async function loadMaintenance() {
  try {
    var data = await api("maintenance");
    maint = data.maintenance;
    maintPlayers = data.players;
    maintForm = { whitelist: maint.whitelist.slice() };
    renderMaintenance(true);
    watchMaintenance();
  } catch (error) {
    fail(error);
  }
}

// fill: the fields from what is saved (else they stay as typed)
function renderMaintenance(fill) {
  if (maint == null) return;
  var active = maint.on || maint.closing != null;
  var badge = document.getElementById("adMaintBadge");
  badge.hidden = !active;
  var dot = document.getElementById("adMaintDot");
  dot.hidden = !active;
  dot.title = maint.closing ? "Starting" : "On";
  badge.innerText = maint.closing ? "🔧 Maintenance starting" : "🔧 Maintenance on";
  badge.title = maint.until ? "Most likely over " + dateText(maint.until) : "No time given";
  var box = document.getElementById("adMaintOn");
  box.checked = active;
  document.getElementById("adMaintOnText").innerText = maint.on ? "On" : maint.closing ? "Starting" : "Off";
  document.getElementById("adMaint").classList.toggle("on", active);
  if (fill) {
    document.getElementById("adMaintUntil").value = maint.until ? localInput(maint.until) : "";
    document.getElementById("adMaintNote").value = maint.note || "";
    document.getElementById("adMaintWait").value = maint.wait != null ? maint.wait : 60;
  }
  // The players to add: everybody with access who is not on the list yet
  var select = document.getElementById("adMaintPlayer");
  var free = maintPlayers.filter((name) => !maintForm.whitelist.includes(name));
  select.replaceChildren(new Option(free.length ? "Choose a player..." : "Everybody is on it", ""), ...free.map((name) => new Option(name, name)));
  document.getElementById("adMaintAdd").disabled = !free.length;
  var list = document.getElementById("adMaintList");
  list.replaceChildren(
    ...(maintForm.whitelist.length
      ? maintForm.whitelist.map((name) => {
          // One row per player: the first letter, the name, remove
          var row = el("div", "ad-maint-row");
          var remove = el("button", "mm-btn mm-btn-sm", "Remove");
          remove.type = "button";
          remove.setAttribute("aria-label", "Remove " + name);
          remove.addEventListener("click", () => {
            maintForm.whitelist = maintForm.whitelist.filter((other) => other != name);
            renderMaintenance(false);
          });
          row.append(createAvatar(name, "sm"), el("span", "ad-maint-name", name), remove);
          return row;
        })
      : [el("div", "ad-maint-empty", "Nobody - only you (the admin panel) during the maintenance.")]),
  );
  var state = document.getElementById("adMaintState");
  var closing = maint.closing;
  state.innerText = closing
    ? closing.startsAt == null
      ? "Starting · the running games are finishing (no new bets)..."
      : "Starting · countdown: on in " + Math.max(0, Math.ceil((closing.startsAt - Date.now()) / 1000)) + " s"
    : maint.on
    ? "On" + (maint.until ? " · most likely over " + dateText(maint.until) + " (in " + span(maint.until - Date.now()) + ")" : " · no time given") + " · " + maint.whitelist.length + " on the whitelist"
    : "Off - the casino is open for everybody.";
}

function maintValues(on) {
  var until = document.getElementById("adMaintUntil").value;
  var wait = Number(document.getElementById("adMaintWait").value);
  return { on: on, whitelist: maintForm.whitelist, until: until ? new Date(until).getTime() : null, note: document.getElementById("adMaintNote").value, wait: Number.isFinite(wait) ? Math.round(wait) : 60 };
}

// While it starts: the state again every second (the form stays as it is typed)
var maintTimer = null;
function watchMaintenance() {
  clearTimeout(maintTimer);
  if (!maint || !maint.closing) return;
  maintTimer = setTimeout(async () => {
    try {
      maint = (await api("maintenance")).maintenance;
    } catch (error) {
      // the next try
    }
    renderMaintenance(false);
    watchMaintenance();
  }, 1000);
}

async function saveMaintenance(on, message) {
  try {
    maint = (await api("maintenance", maintValues(on))).maintenance;
    maintForm = { whitelist: maint.whitelist.slice() };
    renderMaintenance(true);
    watchMaintenance();
    if (message == "Saved") flashSaved(document.getElementById("adMaintSave"), "Save maintenance");
  } catch (error) {
    fail(error);
    renderMaintenance(false);
  }
}

function setupMaintenance() {
  var box = document.getElementById("adMaintOn");
  box.addEventListener("change", async () => {
    if (box.checked) {
      var who = maintForm.whitelist.length ? maintForm.whitelist.join(", ") + " can play during it" : "nobody can play during it";
      var wait = Number(document.getElementById("adMaintWait").value) || 0;
      if (!(await confirmDialog({ title: "Start the maintenance?", text: "No new bets from now on - the running games finish, then a countdown of " + wait + " s. After it every player not on the whitelist is out - " + who + ".", confirmLabel: "Start maintenance", danger: true }))) {
        box.checked = false;
        return;
      }
    }
    var was = maint && maint.closing;
    await saveMaintenance(box.checked, box.checked ? (maint.on ? "Maintenance is on" : "Maintenance starts - the games are finishing") : was ? "Maintenance called off" : "Maintenance is over - the casino is open");
  });
  document.getElementById("adMaintAdd").addEventListener("click", () => {
    var name = document.getElementById("adMaintPlayer").value;
    if (!name) return;
    maintForm.whitelist.push(name);
    renderMaintenance(false);
  });
  document.getElementById("adMaintSave").addEventListener("click", () => saveMaintenance(maint.on, "Saved"));
  // +30 min, +1 h, ...: from the time given (or from now)
  document.querySelectorAll(".ad-maint-quick button").forEach((button) =>
    button.addEventListener("click", () => {
      var input = document.getElementById("adMaintUntil");
      if (button.dataset.add == "clear") return (input.value = "");
      var from = input.value ? Math.max(Date.now(), new Date(input.value).getTime()) : Date.now();
      input.value = localInput(from + Number(button.dataset.add) * 60000);
    }),
  );
}

// The player of the history: a list of the players under the field - typing narrows it (a part of the name is enough)
var historyNames = [];
var pickActive = -1;
var pickTyped = false; // typed since the field got focus: the list narrowed to it (else: everybody)

function pickMatches() {
  var q = pickTyped ? document.getElementById("adHistUser").value.trim().toLowerCase() : "";
  return historyNames.filter((name) => name.toLowerCase().includes(q)).slice(0, 50);
}

function showPlayerPick() {
  var input = document.getElementById("adHistUser");
  var list = document.getElementById("adHistNames");
  var q = pickTyped ? input.value.trim().toLowerCase() : "";
  var current = input.value.trim().toLowerCase();
  var names = pickMatches();
  pickActive = Math.min(pickActive, names.length - 1);
  var item = (name, index) => {
    var li = el("li", "ad-pick-item" + (index == pickActive ? " active" : "") + (name.toLowerCase() == current ? " picked" : ""));
    li.setAttribute("role", "option");
    li.append(createAvatar(name, "sm"));
    var label = el("span", "ad-pick-name");
    var at = q ? name.toLowerCase().indexOf(q) : -1;
    // The typed part in bold
    if (at >= 0) label.append(name.slice(0, at), el("b", "", name.slice(at, at + q.length)), name.slice(at + q.length));
    else label.textContent = name;
    li.append(label);
    li.addEventListener("mousedown", (event) => {
      event.preventDefault();
      pickPlayer(name);
    });
    return li;
  };
  list.replaceChildren(...(names.length ? names.map(item) : [el("li", "ad-pick-empty", "No player like that")]));
  list.hidden = false;
  input.setAttribute("aria-expanded", "true");
  var active = list.querySelector(".active");
  if (active) active.scrollIntoView({ block: "nearest" });
}

function hidePlayerPick() {
  document.getElementById("adHistNames").hidden = true;
  document.getElementById("adHistUser").setAttribute("aria-expanded", "false");
  pickActive = -1;
}

function pickPlayer(name) {
  document.getElementById("adHistUser").value = name;
  document.getElementById("adHistClear").hidden = !name;
  hidePlayerPick();
  loadHistory();
}

function setupPlayerPick() {
  var input = document.getElementById("adHistUser");
  var typing = null;
  input.addEventListener("focus", () => {
    pickTyped = false;
    showPlayerPick();
  });
  input.addEventListener("blur", () => hidePlayerPick());
  input.addEventListener("input", () => {
    document.getElementById("adHistClear").hidden = !input.value;
    pickTyped = true;
    pickActive = -1;
    showPlayerPick();
    clearTimeout(typing);
    typing = setTimeout(loadHistory, 300);
  });
  input.addEventListener("keydown", (event) => {
    var names = pickMatches();
    if (event.key == "ArrowDown" || event.key == "ArrowUp") {
      event.preventDefault();
      if (!names.length) return;
      pickActive = (pickActive + (event.key == "ArrowDown" ? 1 : -1) + names.length) % names.length;
      showPlayerPick();
    } else if (event.key == "Enter") {
      event.preventDefault();
      if (pickActive >= 0 && names[pickActive]) pickPlayer(names[pickActive]);
      else if (names.length == 1) pickPlayer(names[0]);
      else {
        hidePlayerPick();
        loadHistory();
      }
    } else if (event.key == "Escape") {
      hidePlayerPick();
    }
  });
  document.getElementById("adHistClear").addEventListener("click", () => {
    pickPlayer("");
    input.focus();
  });
}

// The kinds in the filter: everything, then per game "all of it" and every kind of it
function fillHistoryKinds() {
  var select = document.getElementById("adHistReason");
  var option = (value, text) => Object.assign(document.createElement("option"), { value: value, text: text });
  select.replaceChildren(option("", "Every kind"));
  HISTORY_KINDS.forEach(([game, kinds]) => {
    var group = document.createElement("optgroup");
    group.label = game;
    if (kinds.length > 1) group.appendChild(option(kinds.map((k) => k[0]).join(","), "All of " + game));
    kinds.forEach(([value, text]) => group.appendChild(option(value, text)));
    select.appendChild(group);
  });
}

/* ---------- Seasons ---------- */

var seasonList = [];
var dailyBonusSetting = 2500; // the daily bonus of the settings (a new season starts with it)
var editingSeason = null; // id of the season in the form (null: a new one)
var SEASON_COLORS = ["#d4a64a", "#e0675a", "#e8913a", "#6fa784", "#4fb3a9", "#5b8fd6", "#9d84c2", "#d77fb0"];
var GOLD = "#d4a64a";
var SEASON_ICONS = ["🏆", "🔥", "❄️", "🌸", "☀️", "🍂", "🎃", "🎄", "💎", "🚀", "👑", "🐸"];
var EVERY_NAMES = { 0: "live", 5: "every 5 min", 15: "every 15 min", 60: "every hour", 360: "every 6 hours", 1440: "once a day" };
var STATUS_NAMES = { planned: "Planned", starting: "Starting", running: "Running", ended: "Over" };
var seasonView = null; // the page of the seasons: null (all of them), "new" or the id of one
var seasonEdit = false; // #seasons/<id>/edit: the form instead of the page of the season
var seasonFormFor = undefined; // the page the form was filled for (it stays as it is while editing)

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
    // The form: filled once per page (not by the refresh every few seconds)
    if (seasonFormFor !== seasonView + (seasonEdit ? ":edit" : "")) fillSeasonPage();
  } catch (error) {
    fail(error);
  }
}

// #seasons/new: an empty form; #seasons/<id>: the season in it (not one that is over)
function fillSeasonPage() {
  seasonFormFor = seasonView + (seasonEdit ? ":edit" : "");
  if (seasonView == null) return;
  if (seasonView == "new") return seasonDefaults();
  var season = seasonList.find((s) => s.id == seasonView);
  if (!season) {
    location.hash = "#seasons";
    return;
  }
  // (one that is over can't be changed: its page)
  if (seasonEdit && season.status == "ended") return location.replace("#seasons/" + season.id);
  if (seasonEdit) {
    editingSeason = season.id;
    fillSeasonForm(season);
  }
}

// The wait between two second chances of a season (hours - null: the next day)
function chanceDelayText(hours) {
  if (hours == null) return "the next day";
  if (hours == 0) return "none";
  if (hours % 24 == 0 && hours >= 48) return hours / 24 + " days";
  return hours + (hours == 1 ? " hour" : " hours");
}

// The leaderboard of a season - running: now (again at most every 15 s), over: the final places (once)
var boardLoaded = { id: null, at: 0 };
var BOARD_COLUMNS = [
  ["#", ""],
  ["Player", ""],
  ["🪙 Coins", "num"],
  ["Prize", ""],
  ["Started", ""],
  ["💔 2nd chances", "num"],
  ["🎁 Daily", "num"],
  ["🫴🏽 Wagered", "num"],
  ["Biggest win", "num"],
  ["From games", "num"],
  ["Favourite", ""],
  ["Last active", ""],
];

// Running: the season coins of a player can be set or changed
function editCell(season, row) {
  var cell = el("td", "ad-actions");
  var button = el("button", "mm-btn mm-btn-sm", "Edit");
  button.type = "button";
  button.addEventListener("click", () => editSeasonCoins(season, row));
  cell.appendChild(button);
  return cell;
}

// A small dialog: set to / add (+/-), the amount, a note
function editSeasonCoins(season, row) {
  coinsDialog({
    title: row.username,
    text: "Coins in " + season.name + " now: 🪙 " + formatCoins(row.coins),
    current: row.coins,
    save: async (mode, amount, note) => {
      await api("seasons/" + season.id + "/balance", { username: row.username, mode: mode, amount: amount, note: note });
      boardLoaded = { id: null, at: 0 };
      loadSeasonBoard(season);
    },
  });
}

async function loadSeasonBoard(season) {
  var ended = season.status == "ended";
  if (boardLoaded.id == season.id && (ended || Date.now() - boardLoaded.at < 15000)) return;
  boardLoaded = { id: season.id, at: Date.now() };
  var body = document.getElementById("adSeasonFinalRows");
  try {
    var data = await api("seasons/" + season.id + "/board");
    var withPrizes = data.rows.some((row) => row.prize);
    var columns = BOARD_COLUMNS.filter(([name]) => name != "Prize" || withPrizes).concat(ended ? [] : [["", "ad-actions"]]);
    document.getElementById("adSeasonBoardTitle").innerText = ended ? "Final leaderboard" : "Leaderboard";
    document.getElementById("adSeasonFinalCount").innerText = data.rows.length + (data.rows.length == 1 ? " player" : " players") + (ended ? "" : " · now");
    document.getElementById("adSeasonBoardHead").replaceChildren(...columns.map(([name, cls]) => el("th", cls, name)));
    if (!data.rows.length) {
      var empty = el("tr");
      var cell = el("td", "mm-muted", ended ? "Nobody played this season." : "Nobody hit Start yet.");
      cell.colSpan = columns.length;
      empty.appendChild(cell);
      return body.replaceChildren(empty);
    }
    var MEDALS = ["🥇", "🥈", "🥉"];
    var dash = (value, text) => (value ? text : "–");
    // The day over the time (narrower)
    var when = (t) => {
      if (!t) return "–";
      var date = new Date(t);
      return date.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + "\n" + date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
    };
    body.replaceChildren(
      ...data.rows.map((row) => {
        var tr = el("tr", row.rank <= 3 ? "ad-final-top" : "");
        var cells = {
          "#": el("td", "mm-muted", row.pending ? "–" : MEDALS[row.rank - 1] || row.rank),
          Player: playerCell(row.username),
          "🪙 Coins": el("td", "num", formatCoins(row.coins)),
          Prize: el("td", row.prize ? "" : "mm-muted", row.prize || "–"),
          Started: el("td", "small ad-when", when(row.joinedAt)),
          "💔 2nd chances": el("td", "num" + (row.chances ? "" : " mm-muted"), row.chances != null ? row.chances + (data.chancesTotal ? " / " + data.chancesTotal : "") : "–"),
          "🎁 Daily": el("td", "num mm-muted", row.dailyBonuses != null ? String(row.dailyBonuses) : "–"),
          // (the bets under it)
          "🫴🏽 Wagered": wageredCell(row),
          "Biggest win": el("td", "num", row.biggestWin != null ? dash(row.biggestWin, formatCoins(row.biggestWin)) : "–"),
          "From games": el("td", "num " + (row.fromGames > 0 ? "plus" : row.fromGames < 0 ? "minus" : "mm-muted"), row.fromGames != null ? (row.fromGames > 0 ? "+" : "") + formatCoins(row.fromGames) : "–"),
          Favourite: el("td", row.favourite ? "" : "mm-muted", row.favourite || "–"),
          "Last active": el("td", "small ad-when", when(row.lastActive)),
          "": editCell(season, row),
        };
        // (the name of the column on every cell - shown when the rows are cards)
        columns.forEach(([name]) => {
          if (name && name != "#" && name != "Player") cells[name].dataset.label = name;
        });
        tr.append(...columns.map(([name]) => cells[name]));
        return tr;
      }),
    );
  } catch (error) {
    boardLoaded = { id: null, at: 0 };
    fail(error);
  }
}

// The coins wagered of a player in a season - the number of bets under it
function wageredCell(row) {
  var cell = el("td", "num" + (row.pending ? " ad-wager-short" : ""));
  cell.append(row.wagered ? formatCoins(row.wagered) : "–");
  // (a place only after wagering enough - how much is still missing)
  if (row.wager && row.wager.need) {
    cell.appendChild(el("span", "ad-sub", row.pending ? "this chance " + formatCoins(row.wager.done) + " / " + formatCoins(row.wager.need) + " - no place yet" : "✓ this chance " + formatCoins(row.wager.need)));
    cell.title = "In the season: " + formatCoins(row.wagered || 0) + " · this chance: " + formatCoins(row.wager.done) + " of " + formatCoins(row.wager.need) + (row.bets ? " · " + formatCoins(row.bets) + (row.bets == 1 ? " bet" : " bets") : "");
  } else if (row.wagered) cell.appendChild(el("span", "ad-sub", formatCoins(row.bets || 0) + (row.bets == 1 ? " bet" : " bets")));
  return cell;
}

function renderSeasons() {
  var view = seasonView == null || seasonView == "new" ? null : seasonList.find((s) => s.id == seasonView);
  document.getElementById("adSeasonsMain").hidden = seasonView != null;
  document.getElementById("adSeasonPage").hidden = seasonView == null;
  if (seasonView != null) {
    document.getElementById("adPageTitle").innerText = view ? view.icon + " " + view.name + (seasonEdit ? " · Edit" : "") : "New season";
    document.getElementById("adPageSub").innerText = view ? STATUS_NAMES[view.status] + " · " + dateText(view.start) + " → " + dateText(view.end) : "Plan a season: everybody who hits Start begins with the same budget, the most coins win.";
    // The page of a season: only to look at; its form: a page of its own (#seasons/<id>/edit) - and for a new one
    var form = view == null || seasonEdit;
    document.getElementById("adSeasonFormCard").hidden = !form;
    document.getElementById("adSeasonDetail").hidden = view != null && seasonEdit;
    var back = document.getElementById("adSeasonBack");
    back.href = seasonEdit ? "#seasons/" + view.id : "#seasons";
    back.innerText = seasonEdit ? "‹ " + view.name : "‹ All seasons";
    // Running or over: the whole leaderboard
    var withBoard = view && !seasonEdit && (view.status == "running" || view.status == "ended");
    document.getElementById("adSeasonFinal").hidden = !withBoard;
    if (withBoard) loadSeasonBoard(view);
    var detail = document.getElementById("adSeasonDetail");
    if (view) detail.replaceChildren(...seasonDetail(view));
    else
      detail.replaceChildren(
        el("h2", "ad-title", "How a season goes"),
        el("p", "ad-note", "At the start the casino closes: no new bets, running rounds finish, then the countdown - and the season starts. Every player hits Start to join with the budget; only they are on the leaderboard. At the end the same closing, then the final places (with the prizes) - and everybody gets the coins from before back, with what they won on top."),
      );
  }
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
      el("p", "ad-note", next ? "Next: " + next.icon + " " + next.name + " starts in " + span(next.start - Date.now()) + " (" + dateText(next.start) + ")." : "Plan one with + New season."),
    );
  }
  var list = document.getElementById("adSeasonList");
  // In groups: open (running or starting), planned (the next first), over (the last first)
  var groups = [
    ["Open", seasonList.filter((s) => s.status == "running" || s.status == "starting")],
    ["Planned", seasonList.filter((s) => s.status == "planned").sort((a, b) => a.start - b.start)],
    ["Over", seasonList.filter((s) => s.status == "ended").sort((a, b) => (b.endedAt || b.end) - (a.endedAt || a.end))],
  ].filter((group) => group[1].length);
  list.replaceChildren(
    ...(groups.length
      ? groups.map(([name, seasons]) => {
          var group = el("div", "ad-season-group");
          var head = el("div", "ad-season-group-head");
          head.append(el("span", "ad-label", name), el("span", "ad-season-group-count", seasons.length));
          group.append(head, ...seasons.map((s) => seasonRow(s)));
          return group;
        })
      : [el("p", "ad-empty", "No seasons yet.")]),
  );
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

// The page of one season (only to look at): its head with what can be done, everything that is set as tiles, the prizes
/* ---------- Who may play in a season: the players picked (whitelist / banlist) ---------- */

var pickPlayers = null; // [{username, coins}]
async function loadPickPlayers() {
  if (pickPlayers) return;
  try {
    pickPlayers = await api("users?limit=1000");
  } catch (error) {
    pickPlayers = null;
    return;
  }
  renderPlayerPicks();
}

function pickedNames() {
  return document.getElementById("adSeasonNames").value.split(/[\s,;]+/).filter(Boolean);
}

function setPicked(names) {
  var seen = new Set();
  var clean = names.filter((name) => !seen.has(name.toLowerCase()) && seen.add(name.toLowerCase()));
  document.getElementById("adSeasonNames").value = clean.join(", ");
  renderPlayerPicks();
}

// A table of every player in the casino: a check for who is on the list (the picked first)
function renderPlayerPicks() {
  if (document.getElementById("adSeasonAccess").value == "all") return;
  if (!pickPlayers) return loadPickPlayers();
  var picked = new Set(pickedNames().map((n) => n.toLowerCase()));
  var q = document.getElementById("adSeasonPick").value.trim().toLowerCase();
  var rows = pickPlayers
    .filter((p) => !q || p.username.toLowerCase().includes(q))
    .sort((a, b) => picked.has(b.username.toLowerCase()) - picked.has(a.username.toLowerCase()) || a.username.localeCompare(b.username));
  document.getElementById("adSeasonPickCount").innerText = picked.size + " of " + pickPlayers.length + " picked";
  document.getElementById("adSeasonPickRows").replaceChildren(
    ...(rows.length
      ? rows.map((p) => {
          var tr = el("tr", picked.has(p.username.toLowerCase()) ? "picked" : "");
          var check = document.createElement("input");
          check.type = "checkbox";
          check.checked = picked.has(p.username.toLowerCase());
          check.setAttribute("aria-label", p.username);
          var toggle = () => setPicked(check.checked ? [...pickedNames(), p.username] : pickedNames().filter((n) => n.toLowerCase() != p.username.toLowerCase()));
          check.addEventListener("change", toggle);
          var box = el("td", "ad-pick-check");
          box.appendChild(check);
          var name = el("td", "");
          var who = el("span", "ad-pick-name");
          who.append(createAvatar(p.username, "sm"), el("span", "", p.username));
          name.appendChild(who);
          tr.append(box, name, el("td", "num mm-muted", "🪙 " + formatCoins(p.coins)));
          tr.addEventListener("click", (event) => {
            if (event.target == check) return;
            check.checked = !check.checked;
            toggle();
          });
          return tr;
        })
      : [el("tr", "", "")]),
  );
}

function seasonDetail(season) {
  var head = el("div", "ad-season-detail-head");
  head.appendChild(seasonHead(season));
  var actions = el("div", "ad-actions");
  var button = (label, cls, handler) => {
    var b = el("button", "mm-btn mm-btn-sm " + (cls || ""), label);
    b.type = "button";
    b.addEventListener("click", handler);
    actions.appendChild(b);
  };
  if (season.status != "ended") button("✏️ Edit", "mm-btn-primary", () => (location.hash = "#seasons/" + season.id + "/edit"));
  if (season.status == "running") button("End now", "mm-btn-danger", () => endSeason(season));
  if (season.status != "running" && season.status != "starting") button("Delete", "", () => deleteSeason(season));
  head.appendChild(actions);

  // One fact per line: the name on the left, the value on the right
  var tile = (icon, value, label, extra) => {
    var box = el("div", "ad-kv");
    var name = el("span", "ad-kv-label", label);
    var val = el("b", "ad-kv-value", value);
    if (extra) val.prepend(extra);
    box.append(name, val);
    box.title = label;
    return box;
  };
  var time =
    season.status == "planned" || season.status == "starting"
      ? tile("⏱️", span(season.start - Date.now()), "until the start")
      : season.status == "running"
        ? tile("⏱️", span(season.end - Date.now()), "left")
        : tile("🏁", new Date(season.endedAt || season.end).toLocaleDateString(undefined, { day: "numeric", month: "short" }), "over since");
  var swatch = el("span", "ad-season-swatch");
  swatch.style.background = season.color || GOLD;
  var section = (title, ...tiles) => {
    var box = el("div", "ad-kv-group");
    box.append(el("h3", "ad-label ad-sublabel", title), ...tiles);
    return box;
  };
  // At a glance: big numbers - and how far the season is
  var strip = el("div", "ad-season-strip");
  var stat = (icon, value, label) => {
    var box = el("div", "ad-season-stat");
    var text = el("div", "ad-season-stat-text");
    text.append(el("b", "", value), el("span", "", label));
    box.append(el("span", "ad-season-stat-icon", icon), text);
    return box;
  };
  var timeText = time.querySelector(".ad-kv-value").innerText + " " + time.querySelector(".ad-kv-label").innerText;
  strip.append(
    stat(season.status == "ended" ? "🏁" : "⏱️", time.querySelector(".ad-kv-value").innerText, time.querySelector(".ad-kv-label").innerText),
    stat("👥", formatCoins(season.players || 0), season.status == "ended" ? "in the final places" : "players joined"),
    stat(season.coinIcon || "💎", formatCoins(season.budget), "to start with"),
    stat("🎁", formatCoins(season.dailyBonus != null ? season.dailyBonus : dailyBonusSetting), "free every day"),
    ...(season.status == "ended" && season.winner ? [stat("🥇", season.winner.username, "won with " + formatCoins(season.winner.coins))] : []),
  );
  var progress = el("div", "ad-season-progress");
  var done = Math.min(1, Math.max(0, (Date.now() - season.start) / (season.end - season.start)));
  var fill = el("span", "ad-season-progress-fill");
  fill.style.width = (season.status == "ended" ? 100 : done * 100).toFixed(1) + "%";
  progress.append(fill);
  var progressRow = el("div", "ad-season-progress-row");
  progressRow.append(el("span", "", dateText(season.start)), progress, el("span", "", dateText(season.end)));
  void timeText;

  var grid = el("div", "ad-kv-grid");
  var card = (icon, title, ...rows) => {
    var box = el("div", "ad-kv-group");
    var titleRow = el("h3", "ad-kv-title");
    titleRow.append(el("span", "ad-kv-title-icon", icon), el("span", "", title));
    box.append(titleRow, ...rows);
    return box;
  };
  var accessMode = season.access ? season.access.mode : "all";
  // The players on the list: a small list that scrolls
  var accessList = (names) => {
    var list = el("div", "ad-kv-list");
    if (!names.length) list.appendChild(el("span", "ad-note", "Nobody on the list."));
    names
      .slice()
      .sort((x, y) => x.localeCompare(y))
      .forEach((name) => {
        var row = el("div", "ad-kv-list-row");
        row.append(createAvatar(name, "sm"), el("span", "", name));
        list.appendChild(row);
      });
    var box = el("div", "");
    box.append(el("div", "ad-kv-list-count", names.length + (names.length == 1 ? " player" : " players")), list);
    return box;
  };
  var parts = [
    head,
    strip,
    progressRow,
    grid,
    card(
      "🗓️",
      "Time",
      tile("", season.closeWait + " s", "countdown"),
      tile("", EVERY_NAMES[season.every], "leaderboard updates"),
      tile("", season.highlight ? "✨ yes" : "no", "highlighted before the start"),
    ),
    card(
      "🎲",
      "Rules",
      tile("", season.wagerX ? season.wagerX + "× the start" : "none", "wager for a place"),
      tile("", String(season.secondChances || 0), "second chances"),
      tile("", season.secondChances ? chanceDelayText(season.chanceDelay) : "–", "wait between them"),
    ),
    card(
      accessMode == "whitelist" ? "🔒" : accessMode == "banlist" ? "🚫" : "🌍",
      "Who may play",
      tile("", accessMode == "whitelist" ? "Whitelist" : accessMode == "banlist" ? "Banlist" : "Everybody", "mode"),
      ...(accessMode != "all" ? [accessList(season.access.names || [])] : []),
    ),
    card("🎨", "Look", tile("", (season.color || GOLD).toUpperCase(), "accent color", swatch), tile("", season.coinIcon || "💎", "coin")),
  ];
  // (the cards side by side in one grid)
  grid.append(...parts.splice(4));
  // The prizes: a place each, with its medal
  var prizes = el("div", "ad-season-section");
  prizes.appendChild(el("h3", "ad-label ad-sublabel", "Prizes"));
  if (season.prizesOn && season.prizes.length) {
    var list = el("div", "ad-season-prize-list");
    season.prizes
      .slice()
      .sort((a, b) => a.place - b.place)
      .forEach((p) => {
        var row = el("div", "ad-season-prize");
        row.append(el("span", "ad-season-prize-place", ["🥇", "🥈", "🥉"][p.place - 1] || "#" + p.place), el("span", "ad-season-prize-text", p.prize));
        list.appendChild(row);
      });
    prizes.appendChild(list);
  } else prizes.appendChild(el("p", "ad-note", "No prizes - the places only."));
  parts.push(prizes);
  return parts;
}

// A season in the list (a click opens its page) - or on its page (detail: more facts)
function seasonRow(season, detail) {
  var row = el("div", "ad-season-row " + season.status + (detail ? " detail" : ""));
  row.appendChild(seasonHead(season));
  if (!detail)
    row.addEventListener("click", (event) => {
      if (!event.target.closest("button")) location.hash = "#seasons/" + season.id;
    });
  var facts = el("div", "ad-season-facts");
  if (detail) {
    var left = season.status == "planned" || season.status == "starting" ? "starts in " + span(season.start - Date.now()) : season.status == "running" ? "ends in " + span(season.end - Date.now()) : "over " + dateText(season.endedAt || season.end);
    facts.append(el("span", "", "⏱️ " + left), el("span", "", "👥 " + (season.players || 0) + (season.players == 1 ? " player" : " players")), el("span", "", "⏳ " + season.closeWait + " s countdown"));
  }
  facts.append(el("span", "", "🪙 " + formatCoins(season.budget) + " start"), el("span", "", "🎁 " + formatCoins(season.dailyBonus != null ? season.dailyBonus : dailyBonusSetting) + " a day"), el("span", "", "💔 " + (season.secondChances || 0) + " second chance" + (season.secondChances == 1 ? "" : "s")), el("span", "", "📊 " + EVERY_NAMES[season.every]), el("span", "", season.prizesOn ? "🏅 " + season.prizes.length + (season.prizes.length == 1 ? " prize" : " prizes") : "no prizes"));
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
  if (!detail) button(season.status == "ended" ? "Details" : "Open", "", () => (location.hash = "#seasons/" + season.id));
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
  document.getElementById("adSeasonCoin").value = season.coinIcon || "💎";
  markCoin();
  document.getElementById("adSeasonStart").value = localInput(season.start);
  document.getElementById("adSeasonEnd").value = localInput(season.end);
  document.getElementById("adSeasonBudget").value = season.budget;
  document.getElementById("adSeasonBonus").value = season.dailyBonus != null ? season.dailyBonus : dailyBonusSetting;
  document.getElementById("adSeasonChances").value = season.secondChances || 0;
  document.getElementById("adSeasonWagerX").value = season.wagerX != null ? season.wagerX : 3;
  var delay = document.getElementById("adSeasonChanceDelay");
  var delayValue = season.chanceDelay == null ? "" : String(season.chanceDelay);
  // (a wait not in the list - set some other way: added to it)
  if (![...delay.options].some((option) => option.value == delayValue)) delay.appendChild(new Option(chanceDelayText(season.chanceDelay), delayValue));
  delay.value = delayValue;
  document.getElementById("adSeasonWait").value = season.closeWait != null ? season.closeWait : 60;
  document.getElementById("adSeasonColor").value = season.color || GOLD;
  markColor();
  document.getElementById("adSeasonEvery").value = season.every;
  document.getElementById("adSeasonPrizesOn").checked = season.prizesOn;
  var access = season.access || { mode: "all", names: [] };
  document.getElementById("adSeasonAccess").value = access.mode;
  document.getElementById("adSeasonNames").value = access.names.join(", ");
  document.getElementById("adSeasonPicker").hidden = access.mode == "all";
  renderPlayerPicks();
  document.getElementById("adSeasonHighlight").checked = season.highlight === true;
  // A running season: start and budget happened already
  var running = season.status == "running";
  document.getElementById("adSeasonStart").disabled = running;
  document.getElementById("adSeasonBudget").disabled = running;
  syncDates();
  document.getElementById("adSeasonPrizes").replaceChildren(...season.prizes.map(prizeRow));
  if (season.prizes.length == 0) document.getElementById("adSeasonPrizes").appendChild(prizeRow({ place: 1, prize: "" }));
  showPrizes();
  document.getElementById("adSeasonFormTitle").innerText = editingSeason == null ? "New season" : "Edit";
  document.getElementById("adSeasonSave").innerText = editingSeason == null ? "Plan the season" : "Save";
  markIcon();
}

/* ---------- Date picker (in the style of the site) ---------- */

var WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
var picker = null; // {input, button, month (Date of the 1st), box}

function dateOf(input) {
  return input.value ? new Date(input.value) : new Date();
}

// A date as it is typed: "07.10.2026, 18:00"
function typedDate(date) {
  var pad = (n) => String(n).padStart(2, "0");
  return pad(date.getDate()) + "." + pad(date.getMonth() + 1) + "." + date.getFullYear() + ", " + pad(date.getHours()) + ":" + pad(date.getMinutes());
}

// What was typed: "7.10.2026 18:00", "07.10.2026, 18:00" or "2026-10-07 18:00" - a Date, or null
function parseTyped(text) {
  var m = text.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4}),?\s*(\d{1,2})[:.](\d{2})$/);
  var iso = text.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T,]+(\d{1,2}):(\d{2})$/);
  var [d, mo, y, h, mi] = m ? m.slice(1).map(Number) : iso ? [iso[3], iso[2], iso[1], iso[4], iso[5]].map(Number) : [];
  if (y == null || h > 23 || mi > 59) return null;
  var date = new Date(y, mo - 1, d, h, mi);
  // (no 31.02.)
  return date.getDate() == d && date.getMonth() == mo - 1 ? date : null;
}

// The fields show the dates of their inputs (and can't be used when the input is disabled)
function syncDates() {
  document.querySelectorAll(".ad-date-text").forEach((text) => {
    var input = document.getElementById(text.dataset.for);
    text.disabled = input.disabled;
    text.closest(".ad-date-field").querySelector(".ad-date-btn").disabled = input.disabled;
    text.closest(".ad-date-field").classList.toggle("disabled", input.disabled);
    text.closest(".ad-date-field").classList.remove("invalid");
    // (not while it is being typed in)
    if (document.activeElement != text) text.value = input.value ? typedDate(dateOf(input)) : "";
  });
}

// Typed by hand: taken as soon as it is a date; leaving a wrong one shows the date before again
document.addEventListener("input", (event) => {
  var text = event.target.closest && event.target.closest(".ad-date-text");
  if (!text) return;
  var date = parseTyped(text.value);
  text.closest(".ad-date-field").classList.toggle("invalid", date == null && text.value.trim() != "");
  if (date) {
    document.getElementById(text.dataset.for).value = localInput(date);
    if (picker && picker.input.id == text.dataset.for) {
      picker.month = new Date(date.getFullYear(), date.getMonth(), 1);
      renderPicker();
    }
  }
});
document.addEventListener(
  "blur",
  (event) => {
    if (event.target.classList && event.target.classList.contains("ad-date-text")) setTimeout(syncDates);
  },
  true,
);
document.addEventListener("keydown", (event) => {
  if (event.key == "Enter" && event.target.classList && event.target.classList.contains("ad-date-text")) {
    event.preventDefault();
    event.target.blur();
  }
});

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
  button.closest(".ad-date").appendChild(box);
  button.closest(".ad-date-field").classList.add("open");
  renderPicker();
}

function closePicker() {
  if (!picker) return;
  picker.box.remove();
  picker.button.closest(".ad-date-field").classList.remove("open");
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
  if (picker && event.target.isConnected && !event.target.closest(".ad-picker") && !event.target.closest(".ad-date-field")) closePicker();
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

// The coins of a season: one of these or any emoji
// (never the 🪙 - that is the money outside seasons)
var COIN_ICONS = ["💎", "⭐", "🍬", "🎃", "❄️", "🌸", "🍀", "🔥", "🪐", "🍪", "🥚", "🧧"];
function markCoin() {
  var icon = document.getElementById("adSeasonCoin").value.trim();
  document.querySelectorAll("#adSeasonCoins button").forEach((b) => b.classList.toggle("active", b.innerText == icon));
}

function markIcon() {
  var icon = document.getElementById("adSeasonIcon").value.trim();
  document.querySelectorAll("#adSeasonIcons button").forEach((b) => b.classList.toggle("active", b.innerText == icon));
}

async function saveSeason(event) {
  event.preventDefault();
  var prizes = [...document.querySelectorAll("#adSeasonPrizes .ad-prize-row")]
    .map((row) => ({ place: Number(row.querySelector(".ad-prize-place").value), prize: row.querySelector("input:not(.ad-prize-place)").value.trim() }))
    .filter((p) => p.prize);
  var body = {
    name: document.getElementById("adSeasonName").value.trim(),
    icon: document.getElementById("adSeasonIcon").value.trim(),
    coinIcon: document.getElementById("adSeasonCoin").value.trim() || "💎",
    start: new Date(document.getElementById("adSeasonStart").value).getTime(),
    end: new Date(document.getElementById("adSeasonEnd").value).getTime(),
    budget: Number(document.getElementById("adSeasonBudget").value),
    dailyBonus: Number(document.getElementById("adSeasonBonus").value),
    secondChances: Number(document.getElementById("adSeasonChances").value) || 0,
    wagerX: Number(document.getElementById("adSeasonWagerX").value),
    chanceDelay: document.getElementById("adSeasonChanceDelay").value === "" ? null : Number(document.getElementById("adSeasonChanceDelay").value),
    closeWait: Number(document.getElementById("adSeasonWait").value),
    // The gold of the casino: no own color
    color: document.getElementById("adSeasonColor").value.toLowerCase() == GOLD ? null : document.getElementById("adSeasonColor").value,
    every: Number(document.getElementById("adSeasonEvery").value),
    prizesOn: document.getElementById("adSeasonPrizesOn").checked,
    prizes: prizes,
    accessMode: document.getElementById("adSeasonAccess").value,
    accessNames: document.getElementById("adSeasonAccess").value == "all" ? [] : document.getElementById("adSeasonNames").value,
    highlight: document.getElementById("adSeasonHighlight").checked,
  };
  // A running season keeps its start and budget
  var current = seasonList.find((s) => s.id == editingSeason);
  if (current && current.status == "running") Object.assign(body, { start: current.start, budget: current.budget });
  try {
    var data = await api(editingSeason == null ? "seasons" : "seasons/" + editingSeason, body);
    seasonList = data.seasons;
    document.getElementById("adSeasonError").hidden = true;
    // Saved: the page of the season (new or changed)
    var id = editingSeason != null ? editingSeason : data.season && data.season.id;
    if (id != null) location.hash = "#seasons/" + id;
    else renderSeasons();
  } catch (error) {
    // Next to the button - the form stays as it is
    var problem = document.getElementById("adSeasonError");
    problem.innerText = error.message;
    problem.hidden = false;
  }
}

async function endSeason(season) {
  if (!(await confirmDialog({ title: "End " + season.name + " now?", text: "The casino closes first: no new bets, running rounds finish, then one more minute. The places then are final - the winner page shows them, with the prizes.", confirmLabel: "End now", danger: true }))) return;
  try {
    seasonList = (await api("seasons/" + season.id + "/end", {})).seasons;
    renderSeasons();
  } catch (error) {
    fail(error);
  }
}

async function deleteSeason(season) {
  if (!(await confirmDialog({ title: "Delete " + season.name + "?", text: season.status == "ended" ? "Its winner page is gone too." : "It won't start.", confirmLabel: "Delete", danger: true }))) return;
  try {
    seasonList = (await api("seasons/" + season.id + "/delete", {})).seasons;
    if (seasonView != null) location.hash = "#seasons";
    else renderSeasons();
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
            var who = playerTag(m.name);
            who.classList.add("ad-chat-name");
            body.append(who, el("span", "ad-chat-text", m.text));
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
            info.append(playerTag(b.username, "b"), el("span", "ad-row-meta", b.until ? "until " + time(b.until) : "for good"));
            var unban = el("button", "mm-btn mm-btn-sm", "Unban");
            unban.type = "button";
            unban.addEventListener("click", () => chatAction("chat/unban", { username: b.username }, b.username + " can write again"));
            row.append(info, unban);
            return row;
          })
        : [el("p", "ad-empty", "Nobody is banned.")]),
    );
    document.getElementById("adOnlineCount").innerText = data.online.length;
    document.getElementById("adOnlineList").replaceChildren(...(data.online.length ? data.online.map((name) => playerTag(name)) : [el("p", "ad-empty", "Nobody is in the casino.")]));
  } catch (error) {
    fail(error);
  }
  // New messages show up by themselves
  chatTimer = setTimeout(loadChat, 4000);
}

async function chatAction(path, body, done) {
  try {
    await api(path, body);
    loadChat();
  } catch (error) {
    fail(error);
  }
}

/* ---------- Settings ---------- */

var settingsList = [];
// The values shown: the normal casino's - or the season world's own limits ("season": empty = the normal value)
var settingsWorld = "normal";
var seasonMode = () => settingsWorld == "season" && settingsList.some((field) => field.group == settingsGroup && field.season);
// What an input of the page holds now: the normal value - or the season's own one ("" for none)
var shownValue = (field) => (seasonMode() ? (field.seasonValue == null ? "" : field.seasonValue) : field.value);

async function loadSettings() {
  try {
    var [data, seasons] = await Promise.all([api("settings"), settingsGroup == "general" ? api("seasons") : null]);
    settingsList = data.settings;
    if (seasons) {
      seasonList = seasons.seasons;
      dailyBonusSetting = seasons.dailyBonus;
    }
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
    // (the cases: switched on / off in the case list under the settings)
    .filter((field) => field.group == settingsGroup && field.type != "cases" && (!seasonMode() || field.season))
    .forEach((field) => {
      var section = sections.find((s) => s.name == field.section);
      if (!section) sections.push((section = { name: field.section, fields: [] }));
      section.fields.push(field);
    });
  document.getElementById("adSettings").replaceChildren(
    ...scopeNote(),
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
        // Only outside of a season (in one: the season's own value)
        if (seasonMode()) label.appendChild(field.seasonValue == null ? el("span", "ad-scope ad-scope-same", "same as normal") : el("span", "changed ad-season-own", "normal " + formatCoins(field.value)));
        else {
          if (field.scope == "outside") label.appendChild(el("span", "ad-scope", "outside seasons"));
          if (field.value != field.default) label.appendChild(el("span", "changed", "default " + formatCoins(field.default)));
        }
        var input = el("input", "mm-input");
        input.type = "number";
        input.step = field.step || 1;
        input.min = field.min;
        input.max = field.max;
        input.value = shownValue(field);
        // (season: empty - the normal value counts, shown as the placeholder)
        if (seasonMode()) input.placeholder = formatCoins(field.value);
        input.dataset.key = field.key;
        var box = el("span", "ad-setting-input");
        box.appendChild(input);
        if (field.unit) box.appendChild(el("span", "ad-setting-unit", field.unit));
        row.append(label, box);
        if (field.hint) row.appendChild(el("span", "ad-setting-hint", field.hint));
        var error = el("span", "ad-setting-error");
        error.dataset.errorFor = field.key;
        error.hidden = true;
        row.appendChild(error);
        card.appendChild(row);
      });
      return card;
    }),
  );
  document.getElementById("adSettings").classList.toggle("ad-settings-season", seasonMode());
  // Nothing to save on a page without numbers (and maintenance has its own save)
  document.getElementById("adSettingsBar").hidden = settingsGroup == "maintenance" || !settingsList.some((field) => field.group == settingsGroup && field.type == "number");
  // Back to Default: only when something on this page is not its default
  var defaults = document.getElementById("adSettingsDefaults");
  if (!defaults.classList.contains("ad-saved")) defaults.disabled = pageChanges().length == 0;
  settingsDirty();
}

// Normal | Season: which values the page shows - the season world can have its own (stricter) limits
function worldSwitch() {
  var fields = settingsList.filter((field) => field.group == settingsGroup && field.season);
  if (!fields.length) return null;
  var card = el("div", "ad-card ad-scope-card ad-world-card" + (seasonMode() ? " season" : ""));
  var row = el("div", "ad-world-row");
  var options = el("div", "ad-choice");
  options.setAttribute("role", "radiogroup");
  options.setAttribute("aria-label", "Values for");
  var own = fields.filter((field) => field.seasonValue != null).length;
  [
    ["normal", "🪙 Normal"],
    ["season", "🏆 Season" + (own ? " · " + own : "")],
  ].forEach(([world, text]) => {
    var button = el("button", "ad-choice-option" + (settingsWorld == world ? " active" : ""), text);
    button.type = "button";
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", settingsWorld == world);
    button.addEventListener("click", async () => {
      if (settingsWorld == world) return;
      if (!document.getElementById("adSettingsDirty").hidden && !(await confirmDialog({ title: "Leave without saving?", text: "What you typed here is not saved yet.", confirmLabel: "Leave" }))) return;
      settingsWorld = world;
      settingsError(null, "");
      renderSettings();
    });
    options.appendChild(button);
  });
  var text = el(
    "p",
    "ad-note",
    seasonMode()
      ? "The season world's own limits. Empty: the normal value counts there too (shown in grey). Make them stricter than normal - seasons are a competition."
      : "The limits of the normal casino. Switch to Season to give the season world its own (stricter) ones" + (own ? " - " + own + " set." : "."),
  );
  row.append(options, text);
  card.appendChild(row);
  return card;
}

// What counts where: the games always, the coins of the general page only outside of a season
function scopeNote() {
  var world = worldSwitch();
  if (seasonMode()) return [world];
  var notes = scopeNotes();
  return world ? [world, ...notes] : notes;
}

function scopeNotes() {
  if (settingsGroup != "general") return [el("p", "ad-note ad-scope-note", "These settings count always - in a season and outside of one" + (settingsList.some((field) => field.group == settingsGroup && field.season) ? " (the limits: unless the season has its own)." : "."))];
  var note = el("div", "ad-card ad-scope-card");
  var running = seasonList.find((season) => season.status == "running");
  var text = el("p", "ad-note");
  text.append(el("span", "ad-scope", "outside seasons"), " Start coins and the daily bonus count only outside of a season - a season has its own budget and daily bonus. Gifts count always.");
  note.appendChild(text);
  if (running) {
    var now = el("div", "ad-scope-now");
    now.append(
      el("span", "", (running.icon || "🗓️") + " " + running.name + " is running: start 🪙 " + formatCoins(running.budget) + " · daily bonus 🪙 " + formatCoins(running.dailyBonus != null ? running.dailyBonus : dailyBonusSetting || 0)),
      Object.assign(el("a", "mm-btn mm-btn-sm", "Open the season ›"), { href: "#seasons/" + running.id }),
    );
    note.appendChild(now);
  }
  return [note];
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
    } catch (error) {
      fail(error);
    }
    renderSettings();
  });
  card.append(info, label);
  return card;
}

// Something typed that isn't saved yet: the save bar says so (and only then Save can be clicked)
function settingsDirty() {
  var dirty = [...document.querySelectorAll("#adSettings input[data-key]")].some((input) => {
    var field = settingsList.find((f) => f.key == input.dataset.key);
    return field && String(input.value) != String(shownValue(field));
  });
  document.getElementById("adSettingsDirty").hidden = !dirty;
  document.getElementById("adSettingsSave").disabled = !dirty;
  document.getElementById("adSettingsBar").classList.toggle("dirty", dirty);
}

// A problem with the settings: under the field (or next to Save, when it is about no single field)
function settingsError(key, text) {
  document.querySelectorAll("#adSettings [data-error-for]").forEach((error) => {
    error.hidden = error.dataset.errorFor != key;
    if (!error.hidden) error.innerText = text;
  });
  document.querySelectorAll("#adSettings input[data-key]").forEach((input) => input.classList.toggle("invalid", input.dataset.key == key));
  var general = document.getElementById("adSettingsError");
  general.hidden = key != null || !text;
  general.innerText = key == null ? text || "" : "";
}

async function saveSettings(event) {
  event.preventDefault();
  var values = {};
  var problem = null;
  document.querySelectorAll("#adSettings input[data-key]").forEach((input) => {
    if (problem) return;
    var field = settingsList.find((f) => f.key == input.dataset.key);
    var value = Number(input.value);
    // Season: empty - back to the normal value
    if (seasonMode() && input.value.trim() == "") {
      if (field.seasonValue != null) values[field.key] = null;
      return;
    }
    if (seasonMode() && value == field.seasonValue) return;
    if (input.value.trim() == "" || !Number.isInteger(value)) problem = [field.key, "A whole number, please."];
    else if (value < field.min || value > field.max) problem = [field.key, "From " + formatCoins(field.min) + " to " + formatCoins(field.max) + "."];
    else if (value != field.value) values[field.key] = value;
  });
  if (problem) {
    settingsError(problem[0], problem[1]);
    return document.querySelector('#adSettings input[data-key="' + problem[0] + '"]').focus();
  }
  settingsError(null, "");
  if (Object.keys(values).length == 0) return settingsDirty();
  var button = document.getElementById("adSettingsSave");
  button.disabled = true;
  button.innerText = "Saving...";
  try {
    settingsList = (await api("settings", seasonMode() ? { season: values } : { values: values })).settings;
    renderSettings();
    flashSaved(button, "Save");
  } catch (error) {
    button.innerText = "Save";
    button.disabled = false;
    // The server names the field by its label: under that field
    var message = error.message.replace(/^Season - /, "");
    var field = settingsList.find((f) => f.group == settingsGroup && f.type == "number" && message.startsWith(f.label));
    settingsError(field ? field.key : null, error.message);
  }
}

// Done: the button says so for a moment (instead of a toast)
function flashSaved(button, label, text) {
  button.innerText = text || "Saved ✓";
  button.classList.add("ad-saved");
  button.disabled = true;
  setTimeout(() => {
    button.innerText = label;
    button.classList.remove("ad-saved");
    if (button.id == "adSettingsSave") settingsDirty();
    else if (button.id == "adSettingsDefaults") button.disabled = pageChanges().length == 0;
    else button.disabled = false;
  }, 1800);
}

// The numbers of this page that are not their default (the on / off of the game stays as it is)
function pageChanges() {
  if (seasonMode()) return settingsList.filter((field) => field.group == settingsGroup && field.season && field.seasonValue != null);
  return settingsList.filter((field) => field.group == settingsGroup && field.type == "number" && field.value != field.default);
}

// Back to Default: only the numbers of this page
async function settingsDefaults() {
  var changed = pageChanges();
  if (!changed.length) return;
  var page = SETTING_GROUPS[settingsGroup][0];
  if (seasonMode()) {
    if (!(await confirmDialog({ title: "Season: back to normal?", text: changed.map((f) => f.label + ": " + formatCoins(f.seasonValue) + " → " + formatCoins(f.value) + " (normal)").join("\n") + "\n\nOnly " + page + " - the season world uses the normal values here again.", confirmLabel: "Back to normal" }))) return;
    try {
      settingsList = (await api("settings", { season: Object.fromEntries(changed.map((f) => [f.key, null])) })).settings;
      renderSettings();
      flashSaved(document.getElementById("adSettingsDefaults"), "Back to Default", "Back to Default ✓");
    } catch (error) {
      fail(error);
    }
    return;
  }
  if (!(await confirmDialog({ title: "Back to the defaults?", text: changed.map((f) => f.label + ": " + formatCoins(f.value) + " → " + formatCoins(f.default)).join("\n") + "\n\nOnly " + page + " - every other page stays as it is.", confirmLabel: "Back to Default" }))) return;
  try {
    settingsList = (await api("settings", { values: Object.fromEntries(changed.map((f) => [f.key, f.default])) })).settings;
    renderSettings();
    flashSaved(document.getElementById("adSettingsDefaults"), "Back to Default", "Back to Default ✓");
  } catch (error) {
    fail(error);
  }
}

// The parts of the hard reset (from the server): checkboxes in two groups - records ticked, the set-up not
var resetParts = [];
var RESET_GROUPS = { records: ["Records", "What was played - ticked to start with."], setup: ["What you set up", "Stays unless you tick it."] };

async function loadResetParts() {
  if (resetParts.length) return renderResetParts();
  try {
    resetParts = (await api("reset")).parts;
    renderResetParts(resetParts.filter((part) => part.group == "records").map((part) => part.id));
  } catch (error) {
    fail(error);
  }
}

function pickedResetParts() {
  return [...document.querySelectorAll("#adResetParts input:checked")].map((box) => box.value);
}

function renderResetParts(picked) {
  picked = picked || pickedResetParts();
  document.getElementById("adResetParts").replaceChildren(
    ...Object.entries(RESET_GROUPS).map(([group, [title, note]]) => {
      var box = el("div", "ad-reset-group " + group);
      var head = el("div", "ad-reset-group-head");
      head.append(el("b", "", title), el("span", "ad-note", note));
      box.appendChild(head);
      resetParts
        .filter((part) => part.group == group)
        .forEach((part) => {
          var row = el("label", "ad-reset-part");
          var check = document.createElement("input");
          check.type = "checkbox";
          check.value = part.id;
          check.checked = picked.includes(part.id);
          check.addEventListener("change", renderResetButton);
          var text = el("span", "ad-reset-part-text");
          text.append(el("b", "", part.label), el("span", "ad-note", part.about));
          row.append(check, text);
          box.appendChild(row);
        });
      return box;
    }),
  );
  renderResetButton();
}

function renderResetButton() {
  var picked = pickedResetParts();
  var button = document.getElementById("adResetButton");
  button.disabled = document.getElementById("adResetConfirm").value != "RESET" || picked.length == 0;
  button.innerText = picked.length == 0 ? "Pick something" : picked.length == resetParts.length ? "Reset everything" : "Reset " + picked.length + (picked.length == 1 ? " part" : " parts");
}

async function hardReset(event) {
  event.preventDefault();
  var input = document.getElementById("adResetConfirm");
  var picked = pickedResetParts();
  if (input.value != "RESET" || !picked.length) return;
  var parts = resetParts.filter((part) => picked.includes(part.id));
  var kept = resetParts.filter((part) => !picked.includes(part.id));
  var text = "Gone:\n" + parts.map((part) => "• " + part.label + " - " + part.about).join("\n") + (kept.length ? "\n\nStays: " + kept.map((part) => part.label).join(", ") + "." : "") + "\n\nThis can't be undone.";
  if (!(await confirmDialog({ title: picked.length == resetParts.length ? "Reset everything?" : "Reset " + parts.map((part) => part.label.toLowerCase()).join(", ") + "?", text: text, confirmLabel: "Reset", danger: true }))) return;
  var button = document.getElementById("adResetButton");
  button.disabled = true;
  try {
    var result = await api("reset", { confirm: "RESET", parts: picked });
    input.value = "";
    var details = [];
    if (result.done.includes("history")) details.push(formatCoins(result.history) + " history rows");
    if (result.done.includes("payouts")) details.push(formatCoins(result.payouts) + " payouts");
    document.getElementById("adResetDone").innerText = "✓ Reset: " + parts.map((part) => part.label).join(", ") + (details.length ? " - " + details.join(" and ") + " deleted." : ".");
    document.getElementById("adResetDone").hidden = false;
    players = [];
    loadOverview();
    if (result.done.includes("settings")) loadSettings();
  } catch (error) {
    fail(error);
  } finally {
    renderResetButton();
  }
}

/* ---------- Setup ---------- */

document.addEventListener("DOMContentLoaded", () => {
  fillHistoryKinds();

  var searchTimer = null;
  document.getElementById("adSearch").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadPlayers, 250);
  });
  document.getElementById("adPlayerFilter").addEventListener("click", (event) => {
    var chip = event.target.closest("button[data-filter]");
    if (!chip) return;
    playerFilter = chip.dataset.filter;
    renderPlayers();
  });
  document.getElementById("adPayoutStatus").addEventListener("change", loadPayouts);
  // The history filters right away (typing: after a short pause)
  document.getElementById("adHistoryFilter").addEventListener("submit", loadHistory);
  setupPlayerPick();
  // The pages: newer / older
  var toPage = (step) => {
    historyPage += step;
    loadHistory().then(() => document.getElementById("tab-history").scrollIntoView({ block: "start" }));
  };
  document.getElementById("adHistPrev").addEventListener("click", () => toPage(-1));
  document.getElementById("adHistNext").addEventListener("click", () => toPage(1));
  document.getElementById("adHistReason").addEventListener("change", () => loadHistory());
  document.getElementById("adHistScope").addEventListener("change", () => loadHistory());
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
  document.getElementById("adSettingsForm").addEventListener("input", settingsDirty);
  document.getElementById("adSettingsDefaults").addEventListener("click", settingsDefaults);
  setupMaintenance();
  loadMaintenance();
  document.querySelectorAll("[data-reset-preset]").forEach((button) =>
    button.addEventListener("click", () => {
      var preset = button.dataset.resetPreset;
      renderResetParts(resetParts.filter((part) => preset == "all" || (preset == "records" && part.group == "records")).map((part) => part.id));
    }),
  );
  document.getElementById("adResetConfirm").addEventListener("input", (event) => {
    renderResetButton();
  });
  document.getElementById("adResetForm").addEventListener("submit", hardReset);
  // Seasons
  document.getElementById("adSeasonForm").addEventListener("submit", saveSeason);
  document.getElementById("adSeasonAccess").addEventListener("change", (event) => {
    document.getElementById("adSeasonPicker").hidden = event.target.value == "all";
    if (event.target.value != "all") renderPlayerPicks();
  });
  // The player table: search, all (the ones shown) / none
  document.getElementById("adSeasonPick").addEventListener("input", renderPlayerPicks);
  document.getElementById("adSeasonPick").addEventListener("keydown", (event) => event.key == "Enter" && event.preventDefault());
  document.getElementById("adSeasonPickAll").addEventListener("click", () => {
    var q = document.getElementById("adSeasonPick").value.trim().toLowerCase();
    setPicked([...pickedNames(), ...(pickPlayers || []).filter((p) => !q || p.username.toLowerCase().includes(q)).map((p) => p.username)]);
  });
  document.getElementById("adSeasonPickNone").addEventListener("click", () => setPicked([]));
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
  document.getElementById("adSeasonCoins").replaceChildren(
    ...COIN_ICONS.map((icon) => {
      var b = el("button", "ad-icon-pick", icon);
      b.type = "button";
      b.addEventListener("click", () => {
        document.getElementById("adSeasonCoin").value = icon;
        markCoin();
      });
      return b;
    }),
  );
  document.getElementById("adSeasonCoin").addEventListener("input", markCoin);
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


/* ---------- Cases of the case battles: the list, a page per case (items, RTP balancer) ---------- */

var caseList = [];
var caseView = null; // null: the list, "new", or the id of a case
var caseDraft = null; // the case on its page, as it is being changed
var deletedCases = []; // deleted cases (their last version) - to bring back
var RISK_NAMES = { low: "🛡️ Low risk", balanced: "⚖️ Balanced", high: "🔥 High risk" };
var DEFAULT_TARGET = 0.9;

async function loadCases() {
  try {
    var data = await api("cases");
    caseList = data.cases;
    deletedCases = data.deleted || [];
    renderCases();
  } catch (error) {
    fail(error);
  }
}

// On / off of a case right in the list (in a link: the click does not open the case)
function caseSwitch(box) {
  var toggle = el("span", "ad-switch ad-case-switch");
  var input = document.createElement("input");
  input.type = "checkbox";
  input.checked = !box.off;
  input.tabIndex = -1;
  input.setAttribute("aria-hidden", "true");
  toggle.append(input, el("span", "ad-switch-track"));
  toggle.setAttribute("role", "switch");
  toggle.setAttribute("aria-checked", !box.off);
  toggle.setAttribute("aria-label", box.name + " on");
  toggle.tabIndex = 0;
  toggle.title = box.off ? "Off - click to turn on" : "On - click to turn off";
  var flip = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    var off = caseList.filter((other) => other.off).map((other) => other.id);
    var next = box.off ? off.filter((id) => id != box.id) : off.concat(box.id);
    if (next.length == caseList.length) return fail(new Error("At least one case stays on."));
    toggle.classList.add("busy");
    try {
      await api("settings", { values: { BATTLE_CASES_OFF: next } });
      await loadCases();
    } catch (error) {
      toggle.classList.remove("busy");
      fail(error);
    }
  };
  toggle.addEventListener("click", flip);
  toggle.addEventListener("keydown", (event) => (event.key == " " || event.key == "Enter") && flip(event));
  return toggle;
}

// The payback of items (chances in percent, values) for a price
function draftRtp(draft) {
  var total = draft.items.reduce((sum, item) => sum + (Number(item.chance) || 0), 0);
  if (!total || !draft.price) return 0;
  return draft.items.reduce((sum, item) => sum + ((Number(item.chance) || 0) / total) * (Number(item.value) || 0), 0) / draft.price;
}

function pct(value, digits) {
  return (value * 100).toFixed(digits == null ? 1 : digits) + "%";
}

function renderCases() {
  var onPage = caseView != null;
  document.getElementById("adCasesMain").hidden = onPage;
  document.getElementById("adCasePage").hidden = !onPage;
  if (!onPage) {
    var list = document.getElementById("adCaseList");
    list.replaceChildren(
      ...caseList.map((box) => {
        var row = el("a", "ad-case-row" + (box.off ? " off" : ""));
        row.href = "#games/battles/case/" + encodeURIComponent(box.id);
        var main = el("div", "ad-case-main");
        main.append(el("b", "", box.name), el("span", "ad-case-sub", RISK_NAMES[box.risk] + " · " + box.items.length + " items · up to " + Math.round(box.top) + "×"));
        var tags = el("div", "ad-case-tags");
        if (box.off) tags.appendChild(el("span", "ad-pill", "off"));
        if (!box.builtIn) tags.appendChild(el("span", "ad-pill accent", "new"));
        else if (box.changed) tags.appendChild(el("span", "ad-pill", "changed"));
        var rtp = el("span", "ad-case-rtp " + rtpClass(box.rtp), "RTP " + pct(box.rtp));
        row.append(el("span", "ad-case-icon", box.icon), main, tags, el("span", "ad-case-price", "🪙 " + formatCoins(box.price)), rtp, caseSwitch(box));
        return row;
      }),
      // Deleted ones: back with one click
      ...(deletedCases.length ? [el("h3", "ad-label ad-deleted-head", "Deleted")] : []),
      ...deletedCases.map((box) => {
        var row = el("div", "ad-case-row off");
        var main = el("div", "ad-case-main");
        main.append(el("b", "", box.name), el("span", "ad-case-sub", "deleted " + (box.retiredAt ? dateText(box.retiredAt) : "") + " · RTP " + pct(box.rtp)));
        var back = el("button", "mm-btn mm-btn-sm", "↺ Bring back");
        back.type = "button";
        back.addEventListener("click", async () => {
          try {
            caseList = (await api("cases/" + encodeURIComponent(box.id) + "/versions/" + encodeURIComponent(box.key), {})).cases;
            loadCases();
          } catch (error) {
            fail(error);
          }
        });
        row.append(el("span", "ad-case-icon", box.icon), main, el("span", ""), el("span", "ad-case-price", "🪙 " + formatCoins(box.price)), el("span", ""), back);
        return row;
      }),
    );
    return;
  }
  var box = caseView == "new" ? null : caseList.find((other) => other.id == caseView);
  if (caseView != "new" && !box) return (location.hash = "#games/battles");
  document.getElementById("adPageTitle").innerText = box ? box.icon + " " + box.name : "New case";
  document.getElementById("adPageSub").innerText = box ? (box.builtIn ? (box.changed ? "Built in - changed" : "Built in") : "Added in the admin panel") + " · " + (box.off ? "turned off" : "in the case battles") : "A new case for the case battles.";
  if (!caseDraft || caseDraft.id != (box ? box.id : "new")) caseDraft = draftOf(box);
  renderCaseEditor(box);
}

// The payback by color: very low red, normal green, above 100% (the house loses) red too
function rtpClass(rtp) {
  return rtp >= 1 ? "bad" : rtp < 0.75 ? "low" : "ok";
}

function draftOf(box) {
  if (!box)
    return {
      id: "new",
      name: "",
      icon: "🎁",
      price: 100,
      risk: "balanced",
      target: DEFAULT_TARGET,
      autoBalance: true,
      items: [
        { icon: "🪨", name: "Pebble", value: 20, chance: 40 },
        { icon: "🍕", name: "Pizza Slice", value: 70, chance: 35 },
        { icon: "🎮", name: "Controller", value: 150, chance: 20 },
        { icon: "💎", name: "Diamond", value: 600, chance: 5 },
      ],
    };
  return {
    id: box.id,
    name: box.name,
    icon: box.icon,
    price: box.price,
    risk: box.risk,
    target: box.target != null ? box.target : Math.round(box.rtp * 1000) / 1000,
    autoBalance: box.target != null,
    items: box.items.map((item) => ({ icon: item.icon, name: item.name, value: item.value, chance: Math.round(item.chance * 100000) / 1000 })),
  };
}

function renderCaseEditor(box) {
  var draft = caseDraft;
  var wrap = document.getElementById("adCaseEditor");

  // The numbers of the case: RTP (now / target), house edge, the top item, the chance to win more than the price
  var stats = el("div", "ad-card ad-case-stats");
  var statsRow = el("div", "ad-season-tiles");
  var rtpBox = el("div", "ad-case-stat-rtp");
  function refreshStats() {
    var rtp = draftRtp(draft);
    var total = draft.items.reduce((sum, item) => sum + (Number(item.chance) || 0), 0) || 1;
    var profit = draft.items.filter((item) => Number(item.value) > draft.price).reduce((sum, item) => sum + (Number(item.chance) || 0), 0) / total;
    var top = Math.max(...draft.items.map((item) => Number(item.value) || 0)) / (draft.price || 1);
    var stat = (icon, value, label, cls) => {
      var cell = el("div", "ad-season-tile" + (cls ? " " + cls : ""));
      cell.append(el("span", "ad-season-tile-icon", icon), el("b", "", value), el("span", "", label));
      return cell;
    };
    statsRow.replaceChildren(
      stat("🎯", pct(rtp, 2), "RTP now", "rtp " + rtpClass(rtp)),
      stat("🏠", pct(1 - rtp, 2), "house edge"),
      stat("📈", pct(profit, 1), "chance to win more than the price"),
      stat("🚀", Math.round(top * 10) / 10 + "×", "best item / price"),
      stat("∑", (Math.round(total * 1000) / 1000) + "%", "chances together" + (Math.abs(total - 100) > 0.001 ? " - scaled to 100% on saving" : "")),
    );
    // The RTP on a bar: 0 - 120 %, the target marked
    var bar = el("div", "ad-rtp-bar");
    var fill = el("span", "ad-rtp-fill " + rtpClass(rtp));
    fill.style.width = Math.min(100, (rtp / 1.2) * 100) + "%";
    var mark = el("span", "ad-rtp-target");
    mark.style.left = Math.min(100, (Number(draft.target) / 1.2) * 100) + "%";
    mark.title = "Target " + pct(Number(draft.target));
    var hundred = el("span", "ad-rtp-100");
    hundred.style.left = (1 / 1.2) * 100 + "%";
    bar.append(fill, mark, hundred);
    rtpBox.replaceChildren(
      el("div", "ad-rtp-label", "RTP " + pct(rtp, 2) + " · target " + pct(Number(draft.target) || 0, 1)),
      bar,
      el("p", "ad-note", "Of every 100 coins spent on this case, about " + (Math.round(rtp * 1000) / 10) + " come back as items" + (rtp < 1 ? " - " + (Math.round((1 - rtp) * 1000) / 10) + " stay with the house." : " - the house loses coins on it!")),
    );
  }
  stats.append(el("h2", "ad-title", "Payback"), statsRow, rtpBox);

  // Name, icon, price, risk
  var head = el("div", "ad-card");
  var fields = el("div", "ad-case-fields");
  var field = (label, input) => {
    var wrap = el("label", "ad-field");
    wrap.append(el("span", "ad-label", label), input);
    return wrap;
  };
  var input = (value, attrs, onInput) => {
    var node = Object.assign(el("input", "mm-input"), attrs);
    node.value = value;
    node.addEventListener("input", () => {
      onInput(node.value);
      refreshStats();
    });
    return node;
  };
  var risk = el("select", "mm-input");
  Object.keys(RISK_NAMES).forEach((key) => risk.appendChild(Object.assign(document.createElement("option"), { value: key, text: RISK_NAMES[key] })));
  risk.value = draft.risk;
  risk.addEventListener("change", () => (draft.risk = risk.value));
  fields.append(
    field("Icon", input(draft.icon, { maxLength: 8 }, (v) => (draft.icon = v))),
    field("Name", input(draft.name, { maxLength: 40, placeholder: "Meme Box" }, (v) => (draft.name = v))),
    field("Price", input(draft.price, { type: "number", min: 1, step: 10 }, (v) => (draft.price = Number(v)))),
    field("Risk", risk),
  );
  head.append(el("h2", "ad-title", "The case"), fields);

  // The items: icon, name, value (and × the price), chance in % - add and remove
  var itemsCard = el("div", "ad-card");
  var itemsHead = el("div", "ad-card-head");
  var add = el("button", "mm-btn mm-btn-sm", "+ Item");
  add.type = "button";
  add.addEventListener("click", () => {
    draft.items.push({ icon: "❓", name: "New item", value: draft.price, chance: 1 });
    renderCaseEditor(box);
  });
  // At most 20 items: the button says so
  add.disabled = draft.items.length >= 20;
  if (add.disabled) add.title = "At most 20 items";
  itemsHead.append(el("h2", "ad-title", "Items"), add);
  var table = el("div", "ad-items");
  function renderItems() {
    table.replaceChildren(
      el("div", "ad-item ad-item-head"),
      ...draft.items.map((item, index) => {
        var row = el("div", "ad-item");
        var times = el("span", "ad-item-times");
        var showTimes = () => (times.innerText = (Math.round(((Number(item.value) || 0) / (draft.price || 1)) * 100) / 100) + "×");
        showTimes();
        var remove = el("button", "ad-item-remove", "×");
        remove.type = "button";
        remove.title = "Remove the item";
        remove.disabled = draft.items.length <= 2;
        remove.addEventListener("click", () => {
          draft.items.splice(index, 1);
          renderCaseEditor(box);
        });
        row.append(
          input(item.icon, { maxLength: 8, className: "mm-input ad-item-icon", ariaLabel: "Icon" }, (v) => (item.icon = v)),
          input(item.name, { maxLength: 40, className: "mm-input ad-item-name", ariaLabel: "Name" }, (v) => (item.name = v)),
          input(item.value, { type: "number", min: 0, step: 5, className: "mm-input ad-item-value", ariaLabel: "Value" }, (v) => {
            item.value = Number(v);
            showTimes();
          }),
          times,
          input(item.chance, { type: "number", min: 0, step: 0.1, className: "mm-input ad-item-chance", ariaLabel: "Chance in %" }, (v) => (item.chance = Number(v))),
          remove,
          // (phones: no column titles - the units next to the fields)
          el("span", "ad-item-unit value", "coins"),
          el("span", "ad-item-unit chance", "% chance"),
        );
        return row;
      }),
    );
    table.firstChild.append(el("span", "", "Icon"), el("span", "", "Name"), el("span", "", "Value"), el("span", "", "× price"), el("span", "", "Chance %"), el("span", ""));
  }
  renderItems();
  itemsCard.append(itemsHead, table);

  // The RTP balancer: the chances move (the values stay) until the case pays back the target
  var balancer = el("div", "ad-card ad-balancer");
  var target = input(Math.round(Number(draft.target) * 1000) / 10, { type: "number", min: 10, max: 199, step: 0.5, className: "mm-input ad-target" }, (v) => (draft.target = Number(v) / 100));
  var balanceBtn = el("button", "mm-btn", "⚖️ Balance now");
  balanceBtn.type = "button";
  balanceBtn.addEventListener("click", async () => {
    try {
      var result = await api("case-balance", { price: draft.price, target: draft.target, items: draft.items.map((item) => ({ icon: item.icon, name: item.name, value: item.value, weight: item.chance })) });
      draft.items = result.items.map((item) => ({ icon: item.icon, name: item.name, value: item.value, chance: Math.round((item.weight / 100000) * 100000) / 1000 }));
      renderCaseEditor(box);
    } catch (error) {
      fail(error);
    }
  });
  var auto = Object.assign(document.createElement("input"), { type: "checkbox", checked: !!draft.autoBalance });
  auto.addEventListener("change", () => (draft.autoBalance = auto.checked));
  var autoLabel = el("label", "ad-check");
  autoLabel.append(auto, el("span", "", "Balance automatically when saving"));
  var targetRow = el("div", "ad-balancer-row");
  var targetField = el("label", "ad-field");
  targetField.append(el("span", "ad-label", "Target RTP %"), target);
  targetRow.append(targetField, balanceBtn, autoLabel);
  balancer.append(
    el("h2", "ad-title", "⚖️ RTP balancer"),
    el("p", "ad-note", "Sets the chances so the case pays back the target on average - the values stay. The order of the items stays too: a lower target makes the expensive items rarer, a higher one more common (every chance is scaled by the same factor per coin of value). The target has to lie between the cheapest and the most expensive item."),
    targetRow,
  );

  // Save, turn on / off, restore, delete
  var actions = el("div", "ad-card ad-case-actions");
  var save = el("button", "mm-btn mm-btn-primary", box ? "Save" : "Create case");
  save.type = "button";
  save.addEventListener("click", async () => {
    save.disabled = true;
    try {
      var body = { name: draft.name, icon: draft.icon, price: draft.price, risk: draft.risk, target: draft.target, autoBalance: draft.autoBalance, items: draft.items.map((item) => ({ icon: item.icon, name: item.name, value: item.value, weight: item.chance })) };
      var result = await api(box ? "cases/" + encodeURIComponent(box.id) : "cases", body);
      caseList = result.cases;
      caseDraft = null;
      if (box) renderCases();
      else location.hash = "#games/battles/case/" + encodeURIComponent(result.case.id);
    } catch (error) {
      fail(error);
    } finally {
      save.disabled = false;
    }
  });
  actions.appendChild(save);
  if (box) {
    var toggle = el("button", "mm-btn", box.off ? "Turn on" : "Turn off");
    toggle.type = "button";
    toggle.addEventListener("click", async () => {
      var off = caseList.filter((other) => other.off).map((other) => other.id);
      var next = box.off ? off.filter((id) => id != box.id) : off.concat(box.id);
      try {
        await api("settings", { values: { BATTLE_CASES_OFF: next } });
        loadCases();
      } catch (error) {
        fail(error);
      }
    });
    actions.appendChild(toggle);
    if (box.builtIn && box.changed) {
      var restore = el("button", "mm-btn", "↺ Back to the original");
      restore.type = "button";
      restore.addEventListener("click", async () => {
        if (!(await confirmDialog({ title: "Back to the original?", text: box.name + " gets its built-in items and chances again.", confirmLabel: "Restore" }))) return;
        try {
          caseList = (await api("cases/" + encodeURIComponent(box.id) + "/restore", {})).cases;
          caseDraft = null;
          renderCases();
        } catch (error) {
          fail(error);
        }
      });
      actions.appendChild(restore);
    }
    var remove = el("button", "mm-btn ad-danger-btn", "Delete");
    remove.type = "button";
    remove.addEventListener("click", async () => {
      if (!(await confirmDialog({ title: "Delete " + box.name + "?", text: "It is gone from the case battles. Battles that have it already stay as they are.", confirmLabel: "Delete", danger: true }))) return;
      try {
        caseList = (await api("cases/" + encodeURIComponent(box.id) + "/delete", {})).cases;
        location.hash = "#games/battles";
      } catch (error) {
        fail(error);
      }
    });
    actions.appendChild(remove);
  }
  actions.appendChild(el("span", "ad-note", "A change makes a new version: running battles and the history keep the one they have."));

  wrap.replaceChildren(stats, head, itemsCard, balancer, actions);
  if (box) wrap.appendChild(versionsCard(box));
  refreshStats();
}

// The earlier versions of a case: look at one in the editor, or bring it back right away
function versionsCard(box) {
  var card = el("div", "ad-card ad-versions");
  var list = el("div", "ad-version-list");
  card.append(el("div", "ad-card-head"), list);
  card.firstChild.append(el("h2", "ad-title", "🕘 Versions"), el("span", "ad-cases-count", box.versions ? box.versions + " earlier" : ""));
  list.appendChild(el("p", "ad-empty", "Loading..."));
  api("cases/" + encodeURIComponent(box.id) + "/versions")
    .then((data) => {
      var when = (t) => (t ? dateText(t) : "built in");
      var now = el("div", "ad-version now");
      now.append(el("span", "ad-version-when", "Now · " + (box.savedAt ? "since " + dateText(box.savedAt) : "built in")), el("span", "ad-version-sum", "🪙 " + formatCoins(box.price) + " · " + box.items.length + " items · RTP " + pct(box.rtp, 2)), el("span", "ad-pill success", "in use"));
      if (!data.versions.length) return list.replaceChildren(now, el("p", "ad-empty", "No earlier versions yet - every save keeps the one before."));
      list.replaceChildren(
        now,
        ...data.versions.map((version) => {
          var row = el("div", "ad-version");
          var load = el("button", "mm-btn mm-btn-sm", "Load into editor");
          load.type = "button";
          load.title = "Puts this version into the editor above - nothing is saved yet";
          load.addEventListener("click", () => {
            caseDraft = draftOf({ ...version, id: box.id });
            renderCaseEditor(box);
            window.scrollTo({ top: 0, behavior: "smooth" });
          });
          var back = el("button", "mm-btn mm-btn-sm mm-btn-primary", "Restore");
          back.type = "button";
          back.addEventListener("click", async () => {
            if (!(await confirmDialog({ title: "Restore this version?", text: "The case gets these items and chances again (as a new version - the one now is kept too).", confirmLabel: "Restore" }))) return;
            try {
              caseList = (await api("cases/" + encodeURIComponent(box.id) + "/versions/" + encodeURIComponent(version.key), {})).cases;
              caseDraft = null;
              renderCases();
            } catch (error) {
              fail(error);
            }
          });
          var buttons = el("div", "ad-version-buttons");
          buttons.append(load, back);
          // Not in any battle anymore: can go
          if (version.used) buttons.prepend(el("span", "ad-pill", "in a battle"));
          else {
            var drop = el("button", "mm-btn mm-btn-sm ad-danger-btn", "Remove");
            drop.type = "button";
            drop.title = "No battle has this version - remove it for good";
            drop.addEventListener("click", async () => {
              if (!(await confirmDialog({ title: "Remove this version?", text: "It is gone for good - it can't be restored anymore.", confirmLabel: "Remove", danger: true }))) return;
              try {
                caseList = (await api("cases/" + encodeURIComponent(box.id) + "/versions/" + encodeURIComponent(version.key) + "/delete", {})).cases;
                renderCases();
              } catch (error) {
                fail(error);
              }
            });
            buttons.appendChild(drop);
          }
          row.append(el("span", "ad-version-when", when(version.savedAt) + " → " + when(version.retiredAt)), el("span", "ad-version-sum", version.icon + " " + version.name + " · 🪙 " + formatCoins(version.price) + " · " + version.items.length + " items · RTP " + pct(version.rtp, 2)), buttons);
          return row;
        }),
      );
    })
    .catch(fail);
  return card;
}
