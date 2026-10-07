/*
 * Secret casino pages: the own coins in the bar at the top. A click opens the
 * payout: the coins come off the balance, the admin pays them out.
 * Uses the `socket` of the page (it sends "coins").
 */
(function () {
  var button = document.getElementById("navCoins");
  var bonusButton = document.getElementById("navBonus");
  var coins = 0;
  var payout = false; // the admin allowed payouts for this player
  var bonusAt = null; // when the next free coins can be claimed (null: now)
  var bonusAmount = 0;
  var bonusTimer = null;

  function format(value) {
    return Number(value).toLocaleString("en-US");
  }

  /* ---------- Free coins once a day ---------- */

  function renderBonus() {
    var text = document.getElementById("navBonusText");
    var ready = bonusAt == null || Date.now() >= bonusAt;
    bonusButton.hidden = false;
    bonusButton.classList.toggle("ready", ready);
    bonusButton.disabled = !ready;
    if (ready) {
      text.innerText = "+" + format(bonusAmount);
      bonusButton.title = "Your free coins for today";
    } else {
      var minutes = Math.ceil((bonusAt - Date.now()) / 60000);
      text.innerText = minutes >= 60 ? Math.floor(minutes / 60) + "h " + String(minutes % 60).padStart(2, "0") + "m" : minutes + "m";
      bonusButton.title = "The next free coins come in " + text.innerText;
    }
  }

  bonusButton.addEventListener("click", () => {
    bonusButton.disabled = true;
    socket.emit("claimBonus");
  });

  socket.on("bonusClaimed", (amount) => {
    showToast("🎁 +" + format(amount) + " free coins - see you tomorrow!");
    bonusButton.classList.remove("claimed");
    void bonusButton.offsetWidth; // restart the animation
    bonusButton.classList.add("claimed");
  });

  socket.on("coins", (data) => {
    if (data.bonusIn != null) {
      bonusAt = data.bonus ? null : Date.now() + data.bonusIn;
      bonusAmount = data.bonusAmount || bonusAmount;
      renderBonus();
      clearInterval(bonusTimer);
      bonusTimer = setInterval(renderBonus, 30000);
    }
    var before = coins;
    coins = data.coins;
    payout = data.payout === true;
    button.hidden = false;
    button.classList.toggle("no-payout", !payout);
    button.title = payout ? "Your coins - click to pay out" : "Your coins";
    document.getElementById("navCoinsValue").innerText = format(coins);
    if (before && coins != before) {
      button.classList.remove("up", "down");
      void button.offsetWidth; // restart the animation
      button.classList.add(coins > before ? "up" : "down");
    }
  });

  function el(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.innerText = text;
    return element;
  }

  var STATUS = { open: "Waiting", paid: "Paid", rejected: "Rejected" };
  var STATUS_HINT = { open: "The admin pays it out soon", paid: "Paid out", rejected: "The coins are back on your balance" };

  async function payoutDialog() {
    var backdrop = el("div", "mm-dialog-backdrop");
    var dialog = el("div", "mm-dialog nav-payout");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    var title = el("h2", "mm-dialog-title", "💸 Pay out coins");
    var text = el("p", "mm-dialog-text", "At least 5,000 coins, in steps of 1,000. The coins come off your balance right away and are paid out by the admin.");
    var balance = el("div", "nav-payout-balance", "Your coins: 🪙 " + format(coins));
    var input = el("input", "mm-input");
    input.type = "number";
    input.min = 5000;
    input.max = Math.floor(coins / 1000) * 1000;
    input.step = 1000;
    input.value = coins >= 5000 ? 5000 : "";
    input.placeholder = "5,000, 6,000, ...";
    input.setAttribute("aria-label", "Coins to pay out");
    var error = el("p", "jp-error");
    error.hidden = true;
    var list = el("div", "nav-payout-list");
    var buttons = el("div", "mm-dialog-actions");
    var cancel = el("button", "mm-btn", "Close");
    cancel.type = "button";
    var ok = el("button", "mm-btn mm-btn-primary", "Pay out");
    ok.type = "button";
    buttons.append(cancel, ok);
    dialog.append(title, text, balance, input, error, buttons, list);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    var close = () => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
    };
    var onKey = (event) => event.key == "Escape" && close();
    document.addEventListener("keydown", onKey);
    cancel.addEventListener("click", close);
    backdrop.addEventListener("click", (event) => event.target == backdrop && close());

    // The own last payouts (relative: next to the page, under the secret address)
    async function loadList() {
      try {
        var rows = await (await fetch("withdrawals")).json();
        list.replaceChildren(
          ...(rows.length ? [el("div", "nav-payout-head", "Your last payouts")] : []),
          ...rows.map((w) => {
            var row = el("div", "nav-payout-row " + w.status);
            var amount = el("span", "nav-payout-amount", "🪙 " + format(w.amount));
            var badge = el("span", "nav-payout-status " + w.status, STATUS[w.status]);
            badge.title = STATUS_HINT[w.status];
            var date = el("span", "nav-payout-date", new Date(w.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }));
            var side = el("div", "nav-payout-side");
            side.append(badge, date);
            row.append(amount, side);
            if (w.note) row.appendChild(el("span", "nav-payout-note", "“" + w.note + "”"));
            return row;
          }),
        );
      } catch (e) {
        // the list is only a bonus
      }
    }

    ok.addEventListener("click", async () => {
      var amount = Number(input.value);
      error.hidden = true;
      ok.disabled = true;
      try {
        var res = await fetch("withdraw", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: amount }) });
        var data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "That didn't work.");
        showToast("💸 " + format(amount) + " coins are on their way");
        input.value = "";
        loadList();
      } catch (e) {
        error.innerText = e.message;
        error.hidden = false;
      } finally {
        ok.disabled = false;
      }
    });
    input.focus();
    loadList();
  }

  // Only for players with payouts: otherwise the coins are just shown
  button.addEventListener("click", () => payout && payoutDialog());

  /* ---------- Who is online in the casino (in the chat head) ---------- */

  var onlineButton = document.getElementById("chatOnline");
  var onlineList = document.getElementById("chatOnlineList");
  if (onlineButton) {
    socket.on("casinoOnline", (data) => {
      var names = data.names || [];
      onlineButton.hidden = names.length == 0;
      var faces = el("span", "chat-online-faces");
      names.slice(0, 3).forEach((name) => faces.appendChild(createAvatar(name, "sm")));
      onlineButton.replaceChildren(faces, el("span", "chat-online-dot"), el("span", "chat-online-count", names.length + " online"));
      onlineButton.title = names.join(", ");
      onlineList.replaceChildren(
        el("div", "chat-online-title", "Online in the casino"),
        ...names.map((name) => {
          var row = el("div", "chat-online-row");
          row.append(createAvatar(name, "sm"), el("span", "", name));
          if (name == myName) row.appendChild(el("span", "you-tag", "You"));
          return row;
        }),
      );
    });
    var toggle = (open) => {
      onlineList.hidden = !open;
      onlineButton.setAttribute("aria-expanded", open);
    };
    onlineButton.addEventListener("click", (event) => {
      event.stopPropagation();
      toggle(onlineList.hidden);
    });
    document.addEventListener("click", (event) => !onlineList.contains(event.target) && toggle(false));
    document.addEventListener("keydown", (event) => event.key == "Escape" && toggle(false));
  }

  /* ---------- A case battle of mine starts (on every casino page) ---------- */

  var notice = null;
  var titleTimer = null;

  function watchBattle(id) {
    // On the battles page: open it right there
    if (typeof openBattle == "function") openBattle(id);
    else window.location.href = "battles#" + id;
  }

  socket.on("battleStarted", (data) => {
    // Already watching it
    if (typeof viewId != "undefined" && viewId == data.id && !document.hidden) return;
    if (notice) notice.remove();
    notice = el("div", "bt-notice");
    notice.setAttribute("role", "status");
    var text = el("div", "bt-notice-text");
    text.append(
      el("b", "", data.mode == "random" ? "Your random battle starts!" : data.crazy ? "Your crazy battle starts!" : "Your case battle starts!"),
      el("span", "", data.players.join(" vs ") + " · " + data.cases + (data.cases == 1 ? " case" : " cases") + " · 🪙 " + format(data.price)),
    );
    var watch = el("button", "mm-btn mm-btn-primary mm-btn-sm", "Watch");
    watch.type = "button";
    var close = el("button", "bt-notice-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    var shown = notice;
    var hide = () => {
      shown.classList.add("out");
      setTimeout(() => shown.remove(), 250);
      if (notice == shown) notice = null;
    };
    watch.addEventListener("click", () => {
      hide();
      watchBattle(data.id);
    });
    close.addEventListener("click", hide);
    notice.append(el("span", "bt-notice-icon", data.mode == "random" ? "❓" : data.crazy ? "🤡" : "⚔️"), text, watch, close);
    document.body.appendChild(notice);
    setTimeout(hide, 12000);

    // Another tab in front: the browser shows it, the title blinks
    if (document.hidden) {
      if (window.Notification && Notification.permission == "granted") {
        try {
          var note = new Notification("Your case battle starts!", { body: data.players.join(" vs "), tag: "battle-" + data.id });
          note.onclick = () => {
            window.focus();
            watchBattle(data.id);
          };
        } catch (e) {
          // not everywhere (mobile)
        }
      }
      var original = document.title;
      var on = false;
      clearInterval(titleTimer);
      titleTimer = setInterval(() => {
        on = !on;
        document.title = on ? "⚔️ Battle starts!" : original;
        if (!document.hidden) {
          clearInterval(titleTimer);
          document.title = original;
        }
      }, 900);
    }
  });

  /* ---------- Seasons: the link to the leaderboard, a season starting or ending ---------- */

  var board = document.getElementById("navBoard");
  var seasonEnd = null;
  var seasonTimer = null;

  // How long the season still runs: "6d 23h 12m", the last hour to the second
  function seasonLeft() {
    var timer = document.getElementById("navBoardTimer");
    if (seasonEnd == null) return;
    var left = Math.max(0, seasonEnd - Date.now());
    var s = Math.floor(left / 1000);
    var d = Math.floor(s / 86400);
    var h = Math.floor((s % 86400) / 3600);
    var m = Math.floor((s % 3600) / 60);
    var pad = (n) => String(n).padStart(2, "0");
    timer.innerText = left == 0 ? "ending..." : d > 0 ? d + "d " + h + "h " + pad(m) + "m" : h > 0 ? h + "h " + pad(m) + "m " + pad(s % 60) + "s" : m + "m " + pad(s % 60) + "s";
    timer.classList.toggle("soon", left < 3600 * 1000);
  }

  function showSeason(data) {
    if (!board) return;
    var season = data && data.season;
    document.getElementById("navBoardIcon").innerText = season ? season.icon : "🏆";
    document.getElementById("navBoardText").innerText = season ? season.name : "Leaderboard";
    board.classList.toggle("season", !!season);
    board.title = season ? season.name + " - ends " + new Date(season.end).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Leaderboard";
    // The countdown to the end of the season, inside the pill
    seasonEnd = season ? season.end : null;
    document.getElementById("navBoardTimer").hidden = !season;
    clearInterval(seasonTimer);
    if (season) {
      seasonLeft();
      seasonTimer = setInterval(seasonLeft, 1000);
    }
  }
  if (board) {
    // The leaderboard page itself: marked
    if (/\/leaderboard\/?$/.test(location.pathname)) board.classList.add("active");
    fetch("season", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then(showSeason)
      .catch(() => {});
  }

  // A new season: the casino starts anew - the page loads again (new coins, the games from the start)
  socket.on("seasonStarted", (season) => {
    showToast((season.icon || "🏆") + " " + season.name + " starts - everybody has 🪙 " + format(season.budget) + "!");
    setTimeout(() => location.reload(), 2500);
  });

  // A season is over: everything is as before it - the page loads again (a game page), then a notice
  // with the way to the winners
  var ENDED_KEY = "csSeasonEnded";
  socket.on("seasonEnded", (season) => {
    if (!window.showWinners) {
      try {
        sessionStorage.setItem(ENDED_KEY, JSON.stringify(season));
        return location.reload();
      } catch (e) {
        // no storage: the notice right here
      }
    }
    seasonOver(season);
  });
  try {
    var ended = sessionStorage.getItem(ENDED_KEY);
    if (ended) {
      sessionStorage.removeItem(ENDED_KEY);
      setTimeout(() => seasonOver(JSON.parse(ended)), 400);
    }
  } catch (e) {
    // no storage
  }

  function seasonOver(season) {
    showSeason(null);
    var notice = el("div", "cs-season-notice");
    var text = el("div", "cs-season-notice-text");
    text.append(el("b", "", (season.icon || "🏆") + " " + season.name + " is over!"), el("span", "", season.winner ? "🥇 " + season.winner.username + " wins with 🪙 " + format(season.winner.coins) : "The final places are in."));
    var link = el("a", "cs-season-notice-link", "See the winners");
    link.href = "leaderboard?season=" + season.id;
    var close = el("button", "cs-season-notice-close", "✕");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", () => notice.remove());
    notice.append(text, link, close);
    document.body.appendChild(notice);
    // On the leaderboard: the winner page right away
    if (window.showWinners) window.showWinners(season.id);
  }
})();
