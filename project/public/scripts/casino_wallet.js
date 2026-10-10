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
  var streak = null; // {on, day, next, rewards, after, grace, base} - the daily streak (none in test mode)
  var claiming = null; // the streak as it was when the coins were claimed (for the popup)

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
    // The streak: a flame with its days next to the gift
    var flame = document.getElementById("navBonusStreak");
    var shown = streak && streak.on ? (ready ? (streak.next > 1 ? streak.next - 1 : 0) : streak.day) : 0;
    if (shown > 0) {
      if (!flame) {
        flame = el("span", "nav-bonus-streak");
        flame.id = "navBonusStreak";
        bonusButton.appendChild(flame);
      }
      flame.innerText = "🔥" + shown;
    } else if (flame) flame.remove();
    if (ready) {
      text.innerText = "+" + format(bonusAmount);
      bonusButton.title = streak && streak.on && streak.next > 1 ? "Day " + streak.next + " of your streak - claim it before midnight" : "Your free coins for today";
    } else {
      var minutes = Math.ceil((bonusAt - Date.now()) / 60000);
      text.innerText = minutes >= 60 ? Math.floor(minutes / 60) + "h " + String(minutes % 60).padStart(2, "0") + "m" : minutes + "m";
      bonusButton.title = "The next free coins come in " + text.innerText;
    }
  }

  bonusButton.addEventListener("click", () => {
    bonusButton.disabled = true;
    claiming = streak;
    socket.emit("claimBonus");
  });

  socket.on("bonusClaimed", (paid) => {
    bonusButton.classList.remove("claimed");
    void bonusButton.offsetWidth; // restart the animation
    bonusButton.classList.add("claimed");
    if (claiming && claiming.on && typeof paid == "number") streakDialog(claiming, paid);
    claiming = null;
  });

  /* ---------- A reward: a season's place, or from the admin - items and / or coins ---------- */

  socket.on("reward", async (reward) => {
    var name = typeof userPromise != "undefined" ? await userPromise.catch(() => null) : null;
    var items = reward.items || [];
    var place = !reward.rank ? reward.icon || "🎁" : reward.rank == 1 ? "🥇" : reward.rank == 2 ? "🥈" : reward.rank == 3 ? "🥉" : "🏆";
    var backdrop = el("div", "mm-dialog-backdrop");
    var dialog = el("div", "mm-dialog nav-streak nav-reward");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "Season reward");
    dialog.appendChild(el("div", "nav-streak-flame nav-reward-medal", place));
    dialog.appendChild(el("h2", "mm-dialog-title", reward.rank ? "Place " + reward.rank + " in " + (reward.icon ? reward.icon + " " : "") + reward.source + "!" : reward.source || "A reward for you!"));
    dialog.appendChild(el("p", "mm-dialog-text nav-reward-text", (reward.rank ? "Your reward for the season" : "You got a reward") + ((reward.prizes || []).length ? " - the admin gets in touch about the prize:" : ":")));
    var row = el("div", "nav-reward-items");
    if (reward.coins > 0) {
      var cash = el("div", "nav-reward-item coins");
      cash.style.setProperty("--i", 0);
      cash.append(el("div", "nav-reward-stage nav-reward-coin", "🪙"), el("span", "nav-reward-kind", "Coins"), el("b", "nav-reward-name", "+" + format(reward.coins)));
      row.appendChild(cash);
    }
    // A prize of the admin's own (a voucher, a dinner): what it is
    var prizes = reward.prizes || [];
    prizes.forEach((prize) => {
      var card = el("div", "nav-reward-item prize");
      card.style.setProperty("--i", row.children.length);
      card.append(el("div", "nav-reward-stage nav-reward-coin", "🎁"), el("span", "nav-reward-kind", "Prize"), el("b", "nav-reward-name", prize));
      row.appendChild(card);
    });
    items.forEach((item, i) => {
      var card = el("div", "nav-reward-item");
      card.style.setProperty("--i", i + (reward.coins > 0 ? 1 : 0) + prizes.length);
      var stage = el("div", "nav-reward-stage");
      if (name && typeof createAvatar == "function") {
        var avatar = createAvatar(name, "lg");
        avatar.dataset.preview = "1";
        if (typeof wearLooks == "function") wearLooks(avatar, { [item.kind]: item.id });
        stage.appendChild(avatar);
      }
      card.append(stage, el("span", "nav-reward-kind", { frame: "Frame", effect: "Animation", background: "Background" }[item.kind] || "Item"), el("b", "nav-reward-name", item.name));
      row.appendChild(card);
    });
    dialog.appendChild(row);
    var buttons = el("div", "mm-dialog-actions");
    var later = el("button", "mm-btn" + (items.length ? "" : " mm-btn-primary"), items.length ? "Later" : "Nice!");
    later.type = "button";
    buttons.appendChild(later);
    // (items: to the shop to wear them)
    if (items.length) {
      var wear = el("a", "mm-btn mm-btn-primary", "Wear it");
      wear.href = "shop";
      buttons.appendChild(wear);
    } else buttons.classList.add("single");
    dialog.appendChild(buttons);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    var close = () => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
    };
    var onKey = (event) => event.key == "Escape" && close();
    document.addEventListener("keydown", onKey);
    later.addEventListener("click", close);
    backdrop.addEventListener("click", (event) => event.target == backdrop && close());
  });

  /* ---------- The daily streak: what today paid, what the next days pay ---------- */

  function rewardOf(info, day) {
    var list = info.rewards;
    var index = day <= list.length ? day - 1 : info.after == "restart" ? (day - 1) % list.length : list.length - 1;
    return Math.round((info.base * list[Math.max(0, index)]) / 100);
  }

  function streakDialog(info, paid) {
    var today = info.next || 1;
    var backdrop = el("div", "mm-dialog-backdrop");
    var dialog = el("div", "mm-dialog nav-streak");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "Daily streak");
    var flame = el("div", "nav-streak-flame", "🔥");
    var title = el("h2", "mm-dialog-title", today > 1 ? today + "-day streak!" : "Streak started!");
    var amount = el("div", "nav-streak-amount", "+" + format(paid));
    // The days around today (a long streak: a window of 7 - today in it)
    var count = Math.min(7, Math.max(info.rewards.length, 1));
    var first = Math.max(1, today - Math.max(0, count - 3));
    if (info.rewards.length <= 7 && info.after == "restart") first = today - ((today - 1) % info.rewards.length);
    else if (info.rewards.length <= 7 && today <= info.rewards.length) first = 1;
    var row = el("div", "nav-streak-days");
    for (var day = first; day < first + count; day++) {
      var state = day < today ? "done" : day == today ? "today" : "next";
      var tile = el("div", "nav-streak-day " + state);
      tile.style.setProperty("--i", day - first);
      tile.appendChild(el("span", "nav-streak-day-name", "Day " + day));
      tile.appendChild(el("span", "nav-streak-day-icon", state == "done" ? "✓" : state == "today" ? "🔥" : "🎁"));
      tile.appendChild(el("span", "nav-streak-day-coins", format(rewardOf(info, day))));
      row.appendChild(tile);
    }
    var tomorrow = rewardOf(info, today + 1);
    var text = el(
      "p",
      "mm-dialog-text nav-streak-text",
      "Tomorrow: +" + format(tomorrow) + ". " + (info.grace > 0 ? "Miss more than " + info.grace + " day" + (info.grace == 1 ? "" : "s") + " in a row and the streak starts over." : "Miss a day and the streak starts over."),
    );
    var buttons = el("div", "mm-dialog-actions");
    var ok = el("button", "mm-btn mm-btn-primary", "Nice!");
    ok.type = "button";
    buttons.appendChild(ok);
    dialog.append(flame, title, amount, row, text, buttons);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    var close = () => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
    };
    var onKey = (event) => (event.key == "Escape" || event.key == "Enter") && close();
    document.addEventListener("keydown", onKey);
    ok.addEventListener("click", close);
    backdrop.addEventListener("click", (event) => event.target == backdrop && close());
    ok.focus();
  }

  // Test mode started or stopped meanwhile: the page again (it connects to the right world then)
  socket.on("connect_error", (error) => {
    if (error && error.message == "testMode") window.location.reload();
  });

  socket.on("coins", (data) => {
    if (data.bonusIn != null) {
      bonusAt = data.bonus ? null : Date.now() + data.bonusIn;
      bonusAmount = data.bonusAmount || bonusAmount;
      streak = data.streak || null;
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
    // The season world: on hover, how much is still to wager for a place on the leaderboard
    var stored = document.getElementById("navCoinsStored");
    var wager = data.wager;
    if (wager && wager.need > 0) {
      if (!stored) {
        stored = el("span", "nav-coins-stored");
        stored.id = "navCoinsStored";
        button.appendChild(stored);
      }
      var left = Math.max(0, wager.need - wager.done);
      stored.classList.toggle("done", left == 0);
      stored.innerText = left == 0 ? "🫴🏽 Wagered enough - your place counts" : "🫴🏽 " + format(left) + " wager left";
      stored.title = format(wager.done) + " of " + format(wager.need) + " wagered";
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
      // Who plays in the season world: the season's icon next to their names in the chat
      var inSeason = new Set(data.season || []);
      window.casinoSeasonNames = inSeason;
      if (data.seasonIcon) document.body.style.setProperty("--season-icon", JSON.stringify(data.seasonIcon));
      document.querySelectorAll(".msg-name[data-name]").forEach((node) => {
        node.classList.toggle("in-season", inSeason.has(node.dataset.name));
        node.title = inSeason.has(node.dataset.name) ? "Plays in " + (data.seasonName || "the season") : "";
      });
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
          row.append(quiet(createAvatar(name, "sm")), el("span", inSeason.has(name) ? "in-season" : "", name));
          if (inSeason.has(name)) row.title = "Plays in " + (data.seasonName || "the season");
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
  // (the pill as on the last page: no jump when it turns out there is none)
  try {
    if (board && sessionStorage.getItem("csPill") == "0") board.hidden = true;
  } catch (e) {
    // no storage
  }
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
    try {
      sessionStorage.setItem("csPill", shown ? "1" : "0");
    } catch (e) {
      // no storage
    }
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
    state.innerText = !season ? "Info" : data.joined ? "" : "Join";
    // (joined: no label - a click switches; in the season world the glow and the line at the top show it)
    state.hidden = !!season && (inSeasonWorld || !!data.joined);
    state.className = "nav-board-state" + (!season ? " info" : inSeasonWorld ? " playing" : data.joined ? " switch" : " join");
    board.title = !season
      ? shown.name + " - starts " + new Date(shown.start).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
      : inSeasonWorld
        ? "You're playing in " + shown.name + " - click to switch to your 🪙 (come back any time)"
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
        else casinoNotice({ icon: "🪙", title: "You play with your 🪙 now", text: season ? "Your " + season.name + " coins wait for you - switch back any time at the top." : "Your season coins wait for you.", key: "world" });
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
    if (season.wagerX > 0) fact("🎲", season.wagerX + "×", "your start coins to wager for a place on the leaderboard" + (season.secondChances > 0 ? " (per chance)" : ""));
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
      var sw = el("button", "cs-join-btn", inSeasonWorld ? "Switch to your 🪙" : "Play in " + season.name);
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
    // (while away: a popup now - like a gift)
    if (rain.missed) return window.casinoShowMissed({ ...rain, type: "rain" });
    var coin = rain.world == "season" ? rain.coinIcon || "💎" : "🪙";
    casinoNotice({ icon: "💸", title: "Money rain! +" + coin + " " + format(rain.amount), text: (rain.note || "Coins for you - have fun!") + (rain.elsewhere ? (rain.world == "season" ? " (in the season)" : " (your 🪙 outside the season)") : ""), key: "rain" });
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
    // How much of the screen to keep free below a part of the page: above the menu where the menu
    // is under it - otherwise only a small margin (the menu doesn't cover it)
    var page = document.querySelector(".room-page");
    var dockBar = document.getElementById("csDockBar");
    var dockToggle = document.getElementById("csDockToggle");
    var roomBelow = (node) => {
      var dock = document.getElementById("csDock");
      if (!dockBar || !node || !dock) return 32;
      // (always where the open menu is - open or closed, the chat keeps its height)
      var bar = dockBar.getBoundingClientRect();
      var r = node.getBoundingClientRect();
      var under = bar.left < r.right && bar.right > r.left;
      var openTop = window.innerHeight - (parseFloat(getComputedStyle(dock).bottom) || 0) - dock.offsetHeight;
      return under ? Math.max(32, Math.ceil(window.innerHeight - openTop) + 20) : 32;
    };

    // Phones and small windows (the column under the game): the chat right down to the menu at the
    // end of the page - no empty space below it
    var chatCard = side.querySelector(".chat-card");
    var chatBody = document.getElementById("chat-content");
    var growChat = () => {
      if (!chatCard || !chatBody) return;
      chatBody.style.height = "";
      if (page) page.style.paddingBottom = "";
      if (window.innerWidth >= 992) return;
      var room = roomBelow(chatCard);
      if (page) page.style.paddingBottom = room + "px";
      var around = chatCard.offsetHeight - chatBody.offsetHeight;
      // At least a screen high (minus the menu) ...
      var height = Math.max(chatBody.offsetHeight, Math.round(window.innerHeight - around - room - 16));
      chatBody.style.height = height + "px";
      // ... and down to the room for the menu at the end of the page
      var gap = document.documentElement.scrollHeight - (chatCard.getBoundingClientRect().bottom + window.scrollY) - room;
      if (gap > 0) chatBody.style.height = height + gap + "px";
    };
    var size = () => {
      side.style.height = "";
      side.style.marginBottom = "";
      growChat();
      if (window.innerWidth < 992) return;
      var gap = layout.getBoundingClientRect().top - spot.getBoundingClientRect().top;
      var below = document.documentElement.scrollHeight - (layout.getBoundingClientRect().bottom + window.scrollY);
      // The menu not under the column: the column goes down to the end of the screen (into the room
      // kept for the menu below the page - that room doesn't grow the page)
      var room = Math.min(below, roomBelow(side));
      var height = Math.max(420, window.innerHeight - TOP - gap - room);
      side.style.height = height + "px";
      if (room < below) side.style.marginBottom = -(below - room) + "px";
      // Everything fits on the screen but the column: a little shorter - no page scroll for a few pixels
      var extra = document.documentElement.scrollHeight - window.innerHeight;
      // (the column is the longest part of the page only when no other part of the layout goes further down)
      var others = [...layout.children].filter((child) => child != side);
      var lowest = others.reduce((max, child) => Math.max(max, child.getBoundingClientRect().bottom), 0);
      var sideLongest = side.getBoundingClientRect().bottom >= lowest;
      if (extra > 0 && sideLongest && height - extra >= 420) {
        side.style.height = height - extra + "px";
        // (the page still scrolls - the game itself is that long: then the column keeps its full height)
        if (document.documentElement.scrollHeight > window.innerHeight) side.style.height = height + "px";
      }
    };
    window.casinoGrowChat = () => {
      size();
      place();
    };
    // The game was fitted to the screen (casino_fullscreen.js): the column to the new height of the page
    window.addEventListener("casinofit", () => requestAnimationFrame(window.casinoGrowChat));
    // The game's part of the page grows or shrinks (its state came, a list got longer): the column again
    if (window.ResizeObserver) {
      var lastHeight = null;
      var watch = new ResizeObserver(() => {
        var height = [...layout.children].filter((child) => child != side).reduce((sum, child) => sum + child.offsetHeight, 0);
        if (height == lastHeight) return;
        lastHeight = height;
        requestAnimationFrame(() => {
          size();
          place();
        });
      });
      [...layout.children].filter((child) => child != side).forEach((child) => watch.observe(child));
    }
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

  // A gift came: a popup on every open casino page (more gifts at once: one after the other) - also a
  // gift or a money rain from while the player was away (missed: on the next visit)
  var giftsWaiting = [];
  // The daily cashback came (after midnight - or while away: on the next visit)
  socket.on("cashback", (data) => {
    var coin = data.world == "season" ? data.coinIcon || "💎" : "🪙";
    casinoNotice({ icon: "💸", title: "Cashback +" + coin + " " + format(data.amount), text: data.percent + "% of what you lost yesterday (" + coin + " " + format(data.loss) + ")" + (data.world == "season" ? " - in the season" : ""), ms: 12000, key: "cashback" });
  });

  socket.on("giftReceived", (gift) => {
    giftsWaiting.push({ ...gift, type: "gift" });
    if (!document.querySelector(".cs-got-backdrop")) showReceived();
  });

  // The coins of a gift / rain: the 🪙 (normal casino) - or the season's coin
  function coinsText(item, amount) {
    var span = el("span", "", (item.world == "season" ? (item.coinIcon || "💎") : "🪙") + " " + format(amount));
    if (item.world != "season") span.dataset.coin = "real";
    return span;
  }

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
    var where = gift.world == "season" ? " (in the season)" : window.CASINO_WORLD == "season" ? " (your 🪙 outside the season)" : "";
    var text;
    if (gift.type == "rain") {
      pic.append(el("span", "cs-got-rain", "💸"));
      head.append(pic, el("span", "cs-gift-label", gift.missed ? "While you were away" : "Money rain!"), el("b", "cs-gift-name", "Money rain"));
      text = el("p", "cs-gift-info", (gift.note ? "“" + gift.note + "” - " : "") + "the coins are on your balance already" + where + ".");
    } else {
      pic.append(createAvatar(gift.from, "lg"), el("span", "cs-gift-bow", "🎁"));
      head.append(pic, el("span", "cs-gift-label", gift.missed ? "While you were away - a gift!" : "You got a gift!"), el("b", "cs-gift-name", gift.from));
      text = el("p", "cs-gift-info", gift.from + " sent you coins - they are on your balance already" + where + ".");
    }
    if (where.includes("🪙")) text.dataset.coin = "real";
    var amount = el("div", "cs-got-amount");
    amount.appendChild(coinsText(gift, gift.amount));
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
  window.casinoShowMissed = (item) => {
    giftsWaiting.push(item);
    if (!document.querySelector(".cs-got-backdrop")) showReceived();
  };
})();
