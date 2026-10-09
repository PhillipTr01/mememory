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

  socket.on("bonusClaimed", () => {
    bonusButton.classList.remove("claimed");
    void bonusButton.offsetWidth; // restart the animation
    bonusButton.classList.add("claimed");
  });

  // Test mode started or stopped meanwhile: the page again (it connects to the right world then)
  socket.on("connect_error", (error) => {
    if (error && error.message == "testMode") window.location.reload();
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
    button.removeAttribute("title");
    document.getElementById("navCoinsValue").innerText = format(coins);
    // The admin's test mode: test coins (nothing is saved)
    button.classList.toggle("test", data.test === true);
    if (data.test) button.title = "🧪 Test mode - test coins, nothing is saved";
    // The season world: the normal 🪙 next to the season's coins (they stay in the normal casino)
    var stored = document.getElementById("navCoinsStored");
    if (data.normal != null) {
      if (!stored) {
        stored = el("span", "nav-coins-stored");
        stored.id = "navCoinsStored";
        button.appendChild(stored);
      }
      // (the 🪙 stays a 🪙: the money of the normal casino - the season has a coin of its own)
      stored.dataset.coin = "real";
      stored.innerText = "🪙 " + format(data.normal);
      stored.title = "Your coins in the normal casino - your season coins go on top when the season is over";
    } else if (stored) stored.remove();
    // Everything lost: a second chance (if the season has one) - after a moment
    if (window.CASINO_WORLD == "season") watchChance(coins);
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
        showHint("💸 " + format(amount) + " coins are on their way", "success", ok);
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
      // (no tooltips here: the list says it all)
      var quiet = (avatar) => {
        avatar.removeAttribute("title");
        return avatar;
      };
      names.slice(0, 3).forEach((name) => faces.appendChild(quiet(createAvatar(name, "sm"))));
      onlineButton.replaceChildren(faces, el("span", "chat-online-dot"), el("span", "chat-online-count", names.length + " online"));
      onlineButton.removeAttribute("title");
      onlineButton.removeAttribute("data-tip");
      onlineButton.setAttribute("aria-label", names.length + " online: " + names.join(", "));
      onlineList.replaceChildren(
        el("div", "chat-online-title", "Online in the casino"),
        ...names.map((name) => {
          var row = el("div", "chat-online-row");
          row.append(quiet(createAvatar(name, "sm")), el("span", "", name));
          if (name == myName) row.appendChild(el("span", "you-tag", "You"));
          // Somebody else: a click - coins for them
          else {
            row.classList.add("clickable");
            row.addEventListener("click", () => {
              toggle(false);
              showGift(name);
            });
          }
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

  function watchBattle(id) {
    // On the battles page: open it right there
    if (typeof openBattle == "function") openBattle(id);
    else window.location.href = "battles#" + id;
  }

  socket.on("battleStarted", (data) => {
    // Already watching it
    if (typeof viewId != "undefined" && viewId == data.id && !document.hidden) return;
    casinoNotice({
      icon: data.mode == "random" ? "❓" : data.crazy ? "🤡" : "⚔️",
      title: data.mode == "random" ? "Your random battle starts!" : data.crazy ? "Your crazy battle starts!" : "Your case battle starts!",
      text: data.players.join(" vs ") + " · " + data.cases + (data.cases == 1 ? " case" : " cases") + " · 🪙 " + format(data.price),
      action: { label: "Watch", run: () => watchBattle(data.id) },
      ms: 12000,
      key: "battle",
    });

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
      // (the title of the tab stays as it is)
    }
  });

  /* ---------- Second chance (in a season): 0 coins, nothing in play - start again ---------- */

  var chanceTimer = null;
  var chanceShown = false;
  // The pill next to the free coins: a second chance now - or when the next one comes (only at 0 coins)
  var chancePill = document.getElementById("navChance");
  var chanceStatus = null;
  var chanceTick = null;

  function renderChancePill() {
    clearInterval(chanceTick);
    var status = chanceStatus;
    var show = coins == 0 && status != null && (status.can || status.reason == "cooldown");
    if (!chancePill) return;
    chancePill.hidden = !show;
    if (!show) return;
    var text = document.getElementById("navChanceText");
    chancePill.classList.toggle("ready", status.can);
    if (status.can) {
      text.innerText = "Second chance";
      chancePill.title = "Start again with 🪙 " + format(status.budget);
      return;
    }
    // Cooldown: how long until the next one (then look again)
    var update = () => {
      var left = Math.max(0, status.nextAt - Date.now());
      var minutes = Math.ceil(left / 60000);
      text.innerText = minutes >= 60 ? Math.floor(minutes / 60) + "h " + String(minutes % 60).padStart(2, "0") + "m" : minutes + "m";
      chancePill.title = "Your next second chance comes in " + text.innerText;
      if (left == 0) {
        clearInterval(chanceTick);
        checkChance();
      }
    };
    update();
    chanceTick = setInterval(update, 30000);
  }

  if (chancePill) chancePill.addEventListener("click", () => chanceStatus && showChance(chanceStatus));

  function watchChance(value) {
    clearTimeout(chanceTimer);
    if (value > 0) {
      settledAt = null;
      chanceShown = false;
      chanceStatus = null;
      renderChancePill();
      document.querySelectorAll(".cs-chance").forEach((n) => n.remove());
      return;
    }
    // Right away (a bet still in a game: checkChance looks again in a moment)
    chanceTimer = setTimeout(checkChance, 0);
  }

  // The prompt comes only 3 s after the last bet is over (0 coins and nothing in a game anymore)
  var CHANCE_SETTLE = 3000;
  var settledAt = null;
  async function checkChance() {
    if (coins > 0) return (settledAt = null);
    var status;
    try {
      var res = await fetch("second-chance", { cache: "no-store" });
      if (!res.ok) return;
      status = await res.json();
    } catch (e) {
      return;
    }
    // Coins still in a game: look again in a moment
    if (status.reason == "inPlay") {
      settledAt = null;
      return (chanceTimer = setTimeout(checkChance, 1000));
    }
    // The pill right away - only the prompt waits until the last bet is over for a moment
    chanceStatus = status;
    renderChancePill();
    if (settledAt == null) settledAt = Date.now();
    if (Date.now() - settledAt < CHANCE_SETTLE) return (chanceTimer = setTimeout(checkChance, CHANCE_SETTLE - (Date.now() - settledAt)));
    // The prompt by itself only once - for this cooldown, for this second chance (the pill opens it again)
    if ((status.can || status.reason == "cooldown") && !chanceShown && !promptSeen(status)) showChance(status);
  }

  // Which prompt was shown already (in this browser): the same one doesn't come by itself again
  var SEEN_KEY = "csChanceSeen";
  function promptKey(status) {
    return status.can ? "can:" + status.left : "cooldown:" + status.nextAt;
  }
  function promptSeen(status) {
    try {
      return localStorage.getItem(SEEN_KEY) == promptKey(status);
    } catch (e) {
      return false;
    }
  }

  function showChance(status) {
    chanceShown = true;
    try {
      localStorage.setItem(SEEN_KEY, promptKey(status));
    } catch (e) {
      // only this time
    }
    var box = el("div", "cs-chance" + (status.can ? "" : " cs-chance-wait"));
    var card = el("div", "cs-chance-card");
    document.querySelectorAll(".cs-chance").forEach((n) => n.remove());
    card.append(el("div", "cs-chance-icon", status.can ? "💔" : "⏳"), el("h2", "cs-chance-title", status.can ? "Second chance!" : "Out of coins"));
    if (status.can) {
      card.append(
        el("p", "cs-chance-text", "You lost everything - start again with 🪙 " + format(status.budget) + " and fight your way back to the top."),
        el("p", "cs-chance-left", status.left + " of " + status.total + " second chance" + (status.total == 1 ? "" : "s") + " left"),
      );
      var take = el("button", "cs-chance-btn", "Start again · 🪙 " + format(status.budget));
      take.type = "button";
      take.addEventListener("click", async () => {
        take.disabled = true;
        try {
          var res = await fetch("second-chance", { method: "POST" });
          var data = await res.json();
          if (!res.ok) throw new Error(data.error || "No second chance right now.");
          box.remove();
          chanceStatus = null;
          renderChancePill();
          casinoNotice({ icon: "💔", title: "Back in the game!", text: "🪙 " + format(data.coins) + " to play with - good luck!", key: "chance" });
        } catch (error) {
          box.remove();
          showHint(error.message, "error", document.getElementById("navCoins"));
          chanceShown = false;
        }
      });
      card.appendChild(take);
    } else {
      var at = new Date(status.nextAt).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
      card.append(el("p", "cs-chance-text", "Your next second chance comes " + at + ". Until then, use the daily bonus or watch the others."), el("p", "cs-chance-left", status.left + " of " + status.total + " left"));
    }
    // Not now: the second chance waits - the 💔 in the top bar takes it any time
    var later = el("button", "cs-chance-later", status.can ? "Not now" : "OK");
    later.type = "button";
    later.addEventListener("click", () => box.remove());
    card.appendChild(later);
    box.appendChild(card);
    document.body.appendChild(box);
  }

  /* ---------- Seasons: a world of their own - the pill at the top is the join button and the switch ---------- */

  var board = document.getElementById("navBoard");
  var seasonData = null; // the last answer of "season"
  var pillTimer = null;
  var inSeasonWorld = window.CASINO_WORLD == "season";
  if (inSeasonWorld) document.body.classList.add("cs-season-world");

  // How long until a time: "6d 23h 12m", the last hour to the second
  function countdown(at) {
    var left = Math.max(0, at - Date.now());
    var s = Math.floor(left / 1000);
    var d = Math.floor(s / 86400);
    var h = Math.floor((s % 86400) / 3600);
    var m = Math.floor((s % 3600) / 60);
    var pad = (n) => String(n).padStart(2, "0");
    return { left: left, text: d > 0 ? d + "d " + h + "h " + pad(m) + "m" : h > 0 ? h + "h " + pad(m) + "m " + pad(s % 60) + "s" : m + "m " + pad(s % 60) + "s" };
  }

  // The pill: only when a season runs (or a planned one is highlighted) - who can't play in it doesn't see it
  function showSeason(data) {
    seasonData = data;
    clearInterval(pillTimer);
    if (!board) return;
    var season = data && data.season;
    var upcoming = data && data.upcoming;
    var shown = season || upcoming;
    board.classList.add("ready");
    board.hidden = !shown;
    document.body.classList.toggle("cs-has-season-pill", !!shown);
    if (!shown) return;
    document.getElementById("navBoardIcon").innerText = shown.icon || "🏆";
    document.getElementById("navBoardText").innerText = shown.name;
    board.classList.add("season");
    board.classList.toggle("upcoming", !season);
    board.classList.toggle("in-season", !!season && inSeasonWorld);
    var state = document.getElementById("navBoardState");
    if (!state) {
      state = el("span", "nav-board-state");
      state.id = "navBoardState";
      board.appendChild(state);
    }
    state.innerText = !season ? "Info" : inSeasonWorld ? "Playing" : data.joined ? "Switch" : "Join";
    state.className = "nav-board-state" + (!season ? " info" : inSeasonWorld ? " playing" : data.joined ? " switch" : " join");
    board.title = !season
      ? shown.name + " - starts " + new Date(shown.start).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
      : inSeasonWorld
        ? "You're playing in " + shown.name + " - click to switch back to the normal casino"
        : data.joined
          ? "Switch to " + shown.name
          : "Join " + shown.name;
    var timer = document.getElementById("navBoardTimer");
    timer.hidden = false;
    var tick = () => {
      var c = countdown(season ? season.end : upcoming.start);
      timer.innerText = season ? (c.left == 0 ? "ending..." : "ends in " + c.text) : c.left == 0 ? "starting..." : "starts in " + c.text;
      timer.classList.toggle("soon", c.left < 3600 * 1000);
    };
    tick();
    pillTimer = setInterval(tick, 1000);
  }

  // The pill opens the season (join - switch - or what is coming)
  if (board) {
    board.addEventListener("click", (event) => {
      event.preventDefault();
      if (!seasonData) return;
      if (seasonData.season) showJoin(seasonData, seasonData.joined ? "switch" : "join");
      else if (seasonData.upcoming) showJoin({ season: seasonData.upcoming }, "upcoming");
    });
  }

  // Into the other world: the page loads again there (the server sends "worldChanged")
  var WORLD_KEY = "csWorldNotice";
  async function switchWorld(to) {
    try {
      var res = await fetch("season/world", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: to }) });
      var result = await res.json();
      if (!res.ok) throw new Error(result.error || "Could not switch.");
      worldChanged({ world: to });
    } catch (error) {
      showHint(error.message, "error", board || document.getElementById("navCoins"));
    }
  }

  function worldChanged(data) {
    try {
      sessionStorage.setItem(WORLD_KEY, data.world);
    } catch (e) {
      // no notice after the reload
    }
    location.reload();
  }
  socket.on("worldChanged", worldChanged);
  // (the page of the other world: refused - it loads again in the right one)
  socket.on("connect_error", (error) => {
    if (error && error.message == "world") location.reload();
  });

  function loadSeason() {
    return fetch("season", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
  }

  // The popup when a season runs that the player hasn't joined: once per season (Later: the pill or the menu)
  var LATER_KEY = "csSeasonLater";
  function laterFor(season) {
    try {
      return localStorage.getItem(LATER_KEY) == String(season.id);
    } catch (e) {
      return false;
    }
  }

  loadSeason().then((data) => {
    showSeason(data);
    if (data && data.closing) showClosing(data.closing);
    else if (data && data.season && data.joined === false && !laterFor(data.season)) showJoin(data, "join");
    // Just switched: where the player is now
    try {
      var moved = sessionStorage.getItem(WORLD_KEY);
      if (moved) {
        sessionStorage.removeItem(WORLD_KEY);
        var season = data && data.season;
        if (moved == "season" && season) casinoNotice({ icon: season.icon || "🏆", title: "You're playing in " + season.name, text: "Season coins, season games, the season's leaderboard - switch back any time at the top.", key: "world" });
        else casinoNotice({ icon: "🪙", title: "You're in the normal casino", text: season ? "Your season coins wait for you - switch back any time at the top." : "Your 🪙 coins.", key: "world" });
      }
    } catch (e) {
      // no storage
    }
  });

  // The running season to look at (the season on the leaderboard)
  window.showSeasonInfo = () =>
    loadSeason().then((data) => {
      if (data && data.season) showJoin(data, "view");
    });

  // How long a time is: "12 days 5 hours", "5 hours 20 minutes", "20 minutes"
  function duration(ms) {
    var m = Math.max(0, Math.round(ms / 60000));
    var d = Math.floor(m / 1440);
    var h = Math.floor((m % 1440) / 60);
    var part = (n, word) => n + " " + word + (n == 1 ? "" : "s");
    if (d > 0) return part(d, "day") + (h > 0 ? " " + part(h, "hour") : "");
    if (h > 0) return part(h, "hour") + (m % 60 > 0 ? " " + part(m % 60, "minute") : "");
    return part(m % 60, "minute");
  }

  // The season card. mode: "join" (join or later), "switch" (into the other world), "upcoming" (what is
  // coming - planned and highlighted), "view" (only to look at it)
  function showJoin(data, mode) {
    var season = data.season;
    var coin = season.coinIcon || "💎";
    document.querySelectorAll(".cs-join").forEach((n) => n.remove());
    var box = el("div", "cs-join");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    var card = el("div", "cs-join-card");
    // In the color of the season
    if (season.color && /^#[0-9a-f]{6}$/i.test(season.color)) {
      card.style.setProperty("--mm-accent", season.color);
      card.style.setProperty("--mm-accent-rgb", [1, 3, 5].map((i) => parseInt(season.color.slice(i, i + 2), 16)).join(", "));
    }
    var when = (t) => new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    var upcoming = mode == "upcoming";
    card.append(
      el("div", "cs-join-icon", season.icon || "🏆"),
      el("div", "cs-join-kicker", upcoming ? "Coming soon" : season.closed ? "Closed season" : "Season"),
      el("h2", "cs-join-title", season.name),
      el("p", "cs-join-time", upcoming ? "Starts " + when(season.start) + " · in " + duration(season.start - Date.now()) + " · runs " + duration(season.end - season.start) : "Runs until " + when(season.end) + " · " + duration(season.end - Date.now()) + " left"),
    );
    // What the season is: the coins, the bonus, the second chances, the players so far
    var facts = el("div", "cs-join-facts");
    var chanceWait = (hours) => (hours == null ? " (one a day)" : hours == 0 ? "" : " (" + (hours % 24 == 0 && hours >= 48 ? hours / 24 + " days" : hours + (hours == 1 ? " hour" : " hours")) + " apart)");
    var fact = (icon, value, label) => {
      var row = el("div", "cs-join-fact");
      row.append(el("span", "cs-join-fact-icon", icon), el("b", "", value), el("span", "", label));
      facts.appendChild(row);
    };
    var start = (mode == "join" && data.joinCoins) || { coins: season.budget, missed: 0 };
    fact(coin, format(start.coins), start.missed > 0 ? "to start (with " + start.missed + " missed daily bonus" + (start.missed == 1 ? "" : "es") + ")" : "to start with");
    fact("🎁", format(season.dailyBonus), "free every day");
    if (season.secondChances > 0) fact("💔", season.secondChances, "second chance" + (season.secondChances == 1 ? "" : "s") + " if you lose it all" + (season.secondChances > 1 ? chanceWait(season.chanceDelay) : ""));
    if (!upcoming) fact("👥", season.players, "player" + (season.players == 1 ? "" : "s") + " in so far");
    card.appendChild(facts);
    if (season.prizes && season.prizes.length) {
      var prizes = el("div", "cs-join-prizes");
      prizes.appendChild(el("div", "cs-join-prizes-title", "🏆 Prizes"));
      var medal = (place) => ["🥇", "🥈", "🥉"][place - 1] || "#" + place;
      season.prizes.forEach((p) => {
        var row = el("div", "cs-join-prize");
        row.append(el("span", "cs-join-place", medal(p.place)), el("span", "", p.prize));
        prizes.appendChild(row);
      });
      card.appendChild(prizes);
    }
    var about = card.appendChild(el("p", "cs-join-text", "A world of its own: everybody starts with the same " + coin + " coins and plays the games of the season - the most coins at the end wins. Your 🪙 stay in the normal casino, you can switch between both any time. When the season is over, your season coins go to your 🪙 on top."));
    about.dataset.coin = "real";

    var close = () => {
      box.remove();
      document.removeEventListener("keydown", onKey);
    };
    var onKey = (event) => {
      if (event.key == "Escape") later();
    };
    // Later: the popup doesn't come by itself again for this season
    var later = () => {
      if (mode == "join") {
        try {
          localStorage.setItem(LATER_KEY, String(season.id));
        } catch (e) {
          // only this time
        }
      }
      close();
    };
    box.addEventListener("click", (event) => {
      if (event.target == box) later();
    });
    document.addEventListener("keydown", onKey);
    var buttons = el("div", "cs-join-actions");
    if (mode == "join") {
      var go = el("button", "cs-join-btn", "Join · " + coin + " " + format(start.coins));
      go.type = "button";
      go.addEventListener("click", async () => {
        go.disabled = true;
        try {
          var res = await fetch("season/join", { method: "POST" });
          var result = await res.json();
          if (!res.ok) throw new Error(result.error || "Could not join the season.");
          // (into the season world: the page loads again)
          worldChanged({ world: "season" });
        } catch (error) {
          showHint(error.message, "error", go);
          go.disabled = false;
        }
      });
      buttons.appendChild(go);
    } else if (mode == "switch") {
      var sw = el("button", "cs-join-btn", inSeasonWorld ? "🪙 Back to the normal casino" : "Play in " + season.name);
      sw.type = "button";
      sw.dataset.coin = "real";
      sw.addEventListener("click", () => {
        sw.disabled = true;
        switchWorld(inSeasonWorld ? "normal" : "season");
      });
      buttons.appendChild(sw);
    }
    var no = el("button", "cs-join-later", mode == "join" ? "Later" : "Close");
    no.type = "button";
    no.addEventListener("click", later);
    buttons.appendChild(no);
    card.appendChild(buttons);
    box.appendChild(card);
    document.body.appendChild(box);
    (buttons.querySelector(".cs-join-btn") || no).focus();
  }

  // A season starts soon (the countdown) - or the season world closes before its end (open rounds
  // finish, no new bets, then a countdown). A notice like a battle starting.
  var closing = null;
  var closingTimer = null;
  function showClosing(info) {
    clearInterval(closingTimer);
    if (!info) {
      if (closing) closing.remove();
      closing = null;
      return;
    }
    if (!closing) {
      closing = el("div", "bt-notice cs-closing-notice");
      closing.setAttribute("role", "status");
      var text = el("div", "bt-notice-text");
      text.append(el("b", "cs-closing-title"), el("span", "cs-closing-text"));
      closing.append(el("span", "bt-notice-icon cs-closing-icon"), text, el("span", "cs-closing-count"));
      // (on top of the other notifications)
      noticeStack().prepend(closing);
    }
    closing.querySelector(".cs-closing-icon").innerText = info.icon || "🏆";
    var rgb = info.color && /^#[0-9a-f]{6}$/i.test(info.color) ? [1, 3, 5].map((i) => parseInt(info.color.slice(i, i + 2), 16)) : null;
    closing.style.setProperty("--mm-accent", rgb ? info.color : "");
    closing.style.setProperty("--mm-accent-rgb", rgb ? rgb.join(", ") : "");
    var ending = info.kind == "end";
    var maint = info.kind == "maintenance";
    closing.querySelector(".cs-closing-title").innerText = maint ? info.name + " soon" : info.name + (ending ? " ends soon!" : " starts soon!");
    var count = closing.querySelector(".cs-closing-count");
    var text = closing.querySelector(".cs-closing-text");
    if (info.startsIn == null) {
      count.innerText = "⏳";
      text.innerText = maint ? "Open games are finishing - no new bets, then the casino closes for a while." : "The season's games are finishing - no new bets there, the final places come next.";
      return;
    }
    text.innerText = maint ? "All games closed - the casino closes for a while then." : ending ? "The season's games are closed - the final places are counted then." : "Get ready - you can join right when it starts.";
    var startsAt = Date.now() + info.startsIn;
    var show = () => {
      var left = Math.max(0, Math.ceil((startsAt - Date.now()) / 1000));
      count.innerText = Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0");
    };
    show();
    closingTimer = setInterval(show, 250);
  }
  socket.on("seasonClosing", showClosing);

  // A new season: the popup to join it (or later) - nothing else changes
  socket.on("seasonStarted", () => {
    showClosing(null);
    loadSeason().then((data) => {
      showSeason(data);
      if (data && data.season && data.joined === false) showJoin(data, "join");
    });
  });

  // A season is over: a notice with the way to the winners (the season world: the page loads again
  // in the normal casino - with the season's coins in the wallet)
  var ENDED_KEY = "csSeasonEnded";
  socket.on("seasonEnded", (season) => {
    showClosing(null);
    if (inSeasonWorld || !window.showWinners) {
      try {
        sessionStorage.setItem(ENDED_KEY, JSON.stringify(season));
      } catch (e) {
        // no storage: the notice right here
      }
      if (inSeasonWorld) return;
    }
    try {
      sessionStorage.removeItem(ENDED_KEY);
    } catch (e) {
      // no storage
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
    text.append(el("b", "", (season.icon || "🏆") + " " + season.name + " is over!"), el("span", "", season.winner ? "🥇 " + season.winner.username + " wins with " + format(season.winner.coins) + " - your season coins are in your 🪙 now" : "The final places are in - your season coins are in your 🪙 now."));
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
  /* ---------- A money rain of the admin: coins fall, a notice says how many ---------- */

  socket.on("moneyRain", (rain) => {
    casinoNotice({ icon: "💸", title: "Money rain! +🪙 " + format(rain.amount), text: rain.note || "Coins for you - have fun!", key: "rain" });
    var sky = el("div", "cs-rain");
    sky.setAttribute("aria-hidden", "true");
    for (var i = 0; i < 36; i++) {
      var drop = el("span", "cs-rain-drop", i % 5 == 0 ? "💸" : "🪙");
      drop.style.left = Math.random() * 100 + "%";
      drop.style.animationDelay = (Math.random() * 1.6).toFixed(2) + "s";
      drop.style.animationDuration = (1.6 + Math.random() * 1.4).toFixed(2) + "s";
      drop.style.fontSize = (18 + Math.random() * 18).toFixed(0) + "px";
      sky.appendChild(drop);
    }
    document.body.appendChild(sky);
    setTimeout(() => sky.remove(), 4800);
  });

  // The side column (second chance, free coins, coins, profile - and the cards below them) comes
  // along when scrolling as one piece: the right part of the bar stays as far above the cards as it is
  (function columnInSight() {
    var coinsPill = document.getElementById("navCoins");
    var side = document.querySelector(".room-side");
    var layout = document.querySelector(".room-layout");
    if (!coinsPill || !side || !layout) return;
    var bar = coinsPill.parentNode;
    var spot = el("div", "nav-right-spot"); // keeps its place in the bar
    var right = el("div", "nav-right");
    ["navChance", "navBonus", "navCoins", "profileMenu"].forEach((id) => {
      var node = document.getElementById(id);
      if (node && node.parentNode == bar) right.appendChild(node);
    });
    spot.appendChild(right);
    bar.appendChild(spot);
    var TOP = 12;
    var fromRight = 0; // how far the pills are from the right edge in the bar
    var place = () => {
      var wide = window.innerWidth >= 992;
      var at = spot.getBoundingClientRect();
      var gap = layout.getBoundingClientRect().top - at.top; // from the pills to the cards
      var sideTop = wide ? TOP + gap + "px" : "";
      if (side.style.top != sideTop) side.style.top = sideTop;
      // The pills stay right above the cards (also when the end of the page pushes the cards up)
      var top = side.getBoundingClientRect().top - gap;
      var follow = wide && at.top < top - 0.5;
      if (!right.classList.contains("floating")) fromRight = document.documentElement.clientWidth - right.getBoundingClientRect().right;
      if (follow && !right.classList.contains("floating")) {
        spot.style.minWidth = right.offsetWidth + "px";
        spot.style.height = right.offsetHeight + "px";
      }
      right.classList.toggle("floating", follow);
      right.style.top = follow ? top + "px" : "";
      right.style.right = follow ? fromRight + "px" : "";
      if (!follow) spot.style.minWidth = spot.style.height = "";
    };
    // As high as the screen has room for between the pills and the end of the page - so the end of
    // the page never pushes the column up
    var size = () => {
      side.style.height = "";
      if (window.innerWidth < 992) return;
      var gap = layout.getBoundingClientRect().top - spot.getBoundingClientRect().top;
      var below = document.documentElement.scrollHeight - (layout.getBoundingClientRect().bottom + window.scrollY);
      side.style.height = Math.max(420, window.innerHeight - TOP - gap - below) + "px";
    };
    // At most once a frame (scroll events come more often than that on phones)
    var queued = false;
    window.addEventListener(
      "scroll",
      () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          place();
        });
      },
      { passive: true },
    );
    window.addEventListener("resize", () => {
      size();
      place();
    });
    size();
    place();
  })();

  /* ---------- Gifts: a click on a name in the chat - coins for that player ---------- */

  window.chatNameClick = function (name) {
    showGift(name);
  };

  async function showGift(name) {
    document.querySelectorAll(".cs-gift-backdrop").forEach((n) => n.remove());
    var backdrop = el("div", "mm-dialog-backdrop cs-gift-backdrop");
    var dialog = el("form", "mm-dialog cs-gift");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.noValidate = true;
    var close = () => backdrop.remove();
    var x = el("button", "cs-gift-close", "✕");
    x.type = "button";
    x.setAttribute("aria-label", "Close");
    x.addEventListener("click", close);

    var head = el("div", "cs-gift-head");
    var pic = el("div", "cs-gift-pic");
    pic.append(createAvatar(name, "lg"), el("span", "cs-gift-bow", "🎁"));
    head.append(pic, el("span", "cs-gift-label", "Send coins to"), el("b", "cs-gift-name", name));

    var input = el("input", "mm-input cs-gift-amount");
    input.type = "number";
    input.min = 1;
    input.step = 1;
    input.inputMode = "numeric";
    input.placeholder = "Coins";
    input.setAttribute("aria-label", "Coins");
    var quick = el("div", "cs-gift-quick");
    var info = el("p", "cs-gift-info", "…");
    var error = el("p", "cs-gift-error");
    error.hidden = true;
    var sendButton = el("button", "cs-gift-send", "Send");
    sendButton.type = "submit";

    var left = 0;
    var most = () => Math.max(0, Math.min(left, coins));
    var render = () => {
      var amount = Math.floor(Number(input.value) || 0);
      sendButton.disabled = amount < 1 || amount > most();
      sendButton.innerText = amount > 0 ? "🎁 Send 🪙 " + format(amount) : "Send";
      quick.querySelectorAll("button").forEach((b) => (b.disabled = Number(b.dataset.value || most()) > most() || most() < 1));
    };
    [100, 500, 1000, 5000].forEach((value) => {
      var b = el("button", "", format(value));
      b.type = "button";
      b.dataset.value = value;
      b.addEventListener("click", () => {
        input.value = Math.min(value, most());
        render();
      });
      quick.appendChild(b);
    });
    var max = el("button", "", "Max");
    max.type = "button";
    max.addEventListener("click", () => {
      input.value = most();
      render();
    });
    quick.appendChild(max);
    input.addEventListener("input", render);

    dialog.append(x, head, input, quick, info, error, sendButton);
    dialog.addEventListener("submit", async (event) => {
      event.preventDefault();
      var amount = Math.floor(Number(input.value) || 0);
      if (amount < 1) return;
      sendButton.disabled = true;
      error.hidden = true;
      try {
        var res = await fetch("gift", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: name, amount: amount }) });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || "That didn't work.");
        close();
      } catch (e) {
        error.innerText = e.message;
        error.hidden = false;
        render();
      }
    });
    backdrop.appendChild(dialog);
    backdrop.addEventListener("click", (event) => event.target == backdrop && close());
    document.addEventListener("keydown", function onKey(event) {
      if (event.key != "Escape") return;
      close();
      document.removeEventListener("keydown", onKey);
    });
    document.body.appendChild(backdrop);
    input.focus();

    // How much is left to give (of the limit) - and the own coins
    try {
      var status = await (await fetch("gift", { cache: "no-store" })).json();
      left = status.left;
      // (the amounts never break in the middle - the own coins on a line of their own)
      info.replaceChildren(
        document.createTextNode("You can give "),
        el("b", "", "🪙 " + format(left)),
        document.createTextNode(" more today (of " + format(status.limit) + " a day)"),
        el("span", "cs-gift-have", "You have 🪙 " + format(coins)),
      );
      if (left < 1) info.classList.add("used");
    } catch (e) {
      info.innerText = "";
    }
    render();
  }

  // A gift came: a popup on every open casino page (more gifts at once: one after the other)
  var giftsWaiting = [];
  socket.on("giftReceived", (gift) => {
    giftsWaiting.push(gift);
    if (!document.querySelector(".cs-got-backdrop")) showReceived();
  });

  function showReceived() {
    var gift = giftsWaiting.shift();
    if (!gift) return;
    var backdrop = el("div", "mm-dialog-backdrop cs-gift-backdrop cs-got-backdrop");
    var dialog = el("div", "mm-dialog cs-gift cs-got");
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-modal", "true");
    var close = () => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
      showReceived();
    };
    var onKey = (event) => (event.key == "Escape" || event.key == "Enter") && close();
    var head = el("div", "cs-gift-head");
    var pic = el("div", "cs-gift-pic");
    pic.append(createAvatar(gift.from, "lg"), el("span", "cs-gift-bow", "🎁"));
    head.append(pic, el("span", "cs-gift-label", "You got a gift!"), el("b", "cs-gift-name", gift.from));
    var amount = el("div", "cs-got-amount", "🪙 " + format(gift.amount));
    var text = el("p", "cs-gift-info", gift.from + " sent you coins - they are on your balance already.");
    var ok = el("button", "cs-gift-send", "Nice, thanks! 🎉");
    ok.type = "button";
    ok.addEventListener("click", close);
    dialog.append(head, amount, text, ok);
    backdrop.appendChild(dialog);
    backdrop.addEventListener("click", (event) => event.target == backdrop && close());
    document.addEventListener("keydown", onKey);
    document.body.appendChild(backdrop);
    ok.focus();
  }
})();
