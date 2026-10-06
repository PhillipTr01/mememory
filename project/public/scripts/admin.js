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
  settings: ["Settings", "Values of the games, and the hard reset."],
};

function showTab() {
  var tab = (location.hash || "#overview").slice(1);
  if (!PAGES[tab]) tab = "overview";
  document.querySelectorAll(".ad-tab").forEach((section) => (section.hidden = section.id != "tab-" + tab));
  document.querySelectorAll(".ad-nav-item[data-tab]").forEach((link) => link.classList.toggle("active", link.dataset.tab == tab));
  document.getElementById("adPageTitle").innerText = PAGES[tab][0];
  document.getElementById("adPageSub").innerText = PAGES[tab][1];
  if (tab == "access") loadAccess();
  if (tab == "players") loadPlayers();
  if (tab == "payouts") loadPayouts();
  if (tab == "history") loadHistory();
  if (tab == "chat") loadChat();
  if (tab == "settings") loadSettings();
}

window.addEventListener("hashchange", showTab);

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
        data.firstApproval
          ? " (" + formatCoins(data.baseCoins) + " + " + data.missed + " missed daily bonus" + (data.missed == 1 ? "" : "es") + " since " + day(data.firstApproval) + ")"
          : " - nobody is approved yet, the daily bonuses count from the first approval",
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
  if (!approve && !confirm("Take " + player.username + "'s access away? Their open casino pages close, the coins stay.")) return;
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
  var sections = [];
  settingsList.forEach((field) => {
    var section = sections.find((s) => s.name == field.section);
    if (!section) sections.push((section = { name: field.section, fields: [] }));
    section.fields.push(field);
  });
  document.getElementById("adSettings").replaceChildren(
    ...sections.map((section) => {
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
  if (!confirm("Every setting back to its default?")) return;
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
  if (!confirm("Really delete everything and start the casino anew? This can't be undone.")) return;
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

  document.getElementById("adChatClear").addEventListener("click", () => {
    if (confirm("Delete every message of the casino chat?")) chatAction("chat/clear", {}, "The chat is empty");
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

  showTab();
  loadOverview();
  // New payouts show up by themselves
  setInterval(loadOverview, 5000);
});
