/* Admin panel: balances, payouts, leaderboard and the history of every coin change. */

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

function showTab() {
  var tab = (location.hash || "#overview").slice(1);
  document.querySelectorAll(".ad-tab").forEach((section) => (section.hidden = section.id != "tab-" + tab));
  document.querySelectorAll(".cs-tab").forEach((link) => link.classList.toggle("active", link.dataset.tab == tab));
  if (tab == "access") loadAccess();
  if (tab == "players") loadPlayers();
  if (tab == "payouts") loadPayouts();
  if (tab == "history") loadHistory();
}

window.addEventListener("hashchange", showTab);

/* ---------- Overview (every few seconds) ---------- */

function payoutRow(w) {
  var row = el("div", "ad-payout " + w.status);
  var info = el("div", "ad-payout-info");
  info.append(el("b", "", w.username), el("span", "mm-muted small", time(w.createdAt) + (w.note ? " · " + w.note : "")));
  var amount = el("span", "ad-payout-amount", "🪙 " + formatCoins(w.amount));
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
    row.appendChild(el("span", "ad-status " + w.status, w.status));
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
    var list = document.getElementById("adOpenList");
    list.replaceChildren(...(data.open.length ? data.open.map(payoutRow) : [el("p", "mm-muted mb-0", "Nothing to pay out.")]));

    // New payouts since the last look: a note
    var ids = data.open.map((w) => w.id);
    if (knownOpen != null) {
      var fresh = data.open.filter((w) => !knownOpen.includes(w.id));
      fresh.forEach((w) => showToast("💸 New payout: " + w.username + " - " + formatCoins(w.amount) + " coins"));
    }
    knownOpen = ids;
    var badge = document.getElementById("adOpenBadge");
    badge.hidden = ids.length == 0;
    badge.innerText = ids.length + " open";
    // Players who want into the casino
    if (knownWaiting != null && data.waiting > knownWaiting) {
      showToast("🔑 " + (data.waiting - knownWaiting == 1 ? "A player wants" : data.waiting - knownWaiting + " players want") + " into the casino");
      if (!document.getElementById("tab-access").hidden) loadAccess();
    }
    knownWaiting = data.waiting;
    var waitingBadge = document.getElementById("adWaitingBadge");
    waitingBadge.hidden = data.waiting == 0;
    waitingBadge.innerText = data.waiting;
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

/* ---------- Access ---------- */

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
          ? " (50,000 + " + data.missed + " missed daily bonus" + (data.missed == 1 ? "" : "es") + " since " + day(data.firstApproval) + ")"
          : " - nobody is approved yet, the daily bonuses count from the first approval",
      ),
    );
    var list = document.getElementById("adAccessList");
    if (data.players.length == 0) {
      var empty = el("tr");
      var cell = el("td", "mm-muted", "No players.");
      cell.colSpan = 3;
      empty.appendChild(cell);
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(
      ...data.players.map((p) => {
        var row = el("tr", p.approved ? "" : p.requestedAt ? "ad-waiting" : "");
        var status = p.approved
          ? el("span", "ad-status paid", "approved" + (p.approvedAt ? " · " + day(p.approvedAt) : ""))
          : p.requestedAt
            ? el("span", "ad-status open", "wants in · " + time(p.requestedAt))
            : el("span", "ad-status none", "no access");
        var button = el("button", "mm-btn mm-btn-sm" + (p.approved ? "" : " mm-btn-primary"), p.approved ? "Revoke" : "Approve");
        button.type = "button";
        button.addEventListener("click", () => setAccess(p, !p.approved, button));
        var actions = el("td", "ad-actions");
        actions.appendChild(button);
        row.append(el("td", "fw-semibold", p.username), el("td", "", ""), actions);
        row.children[1].appendChild(status);
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
    document.getElementById("adPayoutList").replaceChildren(...(list.length ? list.map(payoutRow) : [el("p", "mm-muted mb-0", "No payouts.")]));
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

  showTab();
  loadOverview();
  // New payouts show up by themselves
  setInterval(loadOverview, 5000);
});
