/*
 * The season sandbox for the players (game/season_kit.js) on every casino page of the season world: a
 * button in the bar at the top (goals done / all), a popup with tabs - the goals, the season pass (the
 * milestones of a currency), the shop, the teams and the boosts - and notices when a goal is done or a
 * boost starts. Loaded by casino_wallet.js in a season world only.
 */
(function () {
  var anchor = document.getElementById("navBonus") || document.getElementById("navCoins");
  if (!anchor || document.getElementById("navGoals")) return;
  var data = null;
  var popup = null; // the open popup: {list, tabs}
  var tab = "goals";
  var loading = null;

  function make(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.innerText = text;
    return element;
  }
  // "Stars" -> "stars", "XP" stays
  var lower = (name) => (name == name.toUpperCase() ? name : name.toLowerCase());
  var format = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });

  var button = make("button", "nav-bonus nav-goals");
  button.type = "button";
  button.id = "navGoals";
  button.hidden = true;
  anchor.parentNode.insertBefore(button, anchor);

  function load() {
    if (loading) return loading;
    loading = fetch("goals")
      .then((res) => (res.ok ? res.json() : null))
      .then((fresh) => {
        loading = null;
        if (!fresh) return;
        data = fresh;
        render();
      })
      .catch(() => (loading = null));
    return loading;
  }

  // "in 5 h", "in 2 days", "in 12 min"
  function left(ms) {
    var minutes = Math.ceil(ms / 60000);
    if (minutes < 60) return "in " + minutes + " min";
    var hours = Math.ceil(ms / 3600000);
    if (hours < 48) return "in " + hours + " h";
    return "in " + Math.ceil(hours / 24) + " days";
  }

  var has = {
    goals: () => data.quests.length > 0,
    pass: () => data.currencies.some((c) => c.milestones && c.milestones.length),
    shop: () => data.shop && data.shop.length > 0,
    teams: () => !!data.teams,
    boosts: () => data.boosts && data.boosts.length > 0,
  };
  var TABS = [
    ["goals", "🎯 Goals"],
    ["pass", "🎟️ Pass"],
    ["shop", "🛍️ Shop"],
    ["teams", "🚩 Teams"],
    ["boosts", "⚡ Boosts"],
  ];

  function render() {
    var quests = data.quests || [];
    var any = TABS.some(([id]) => has[id]()) || data.currencies.length > 0;
    button.hidden = !any;
    var done = quests.filter((q) => q.done).length;
    var boosting = (data.boosts || []).some((b) => b.on);
    button.replaceChildren(document.createTextNode(boosting ? "⚡ " : "🎯 "), make("span", "nav-goals-text", quests.length ? done + "/" + quests.length : "Season"));
    button.classList.toggle("ready", boosting);
    button.title = boosting ? "A boost is on" : "Goals of the season";
    if (popup) fill();
  }

  /* ---------- The tabs ---------- */

  function wallet() {
    var parts = [];
    if (data.currencies.length) {
      var row = make("div", "goals-currencies");
      data.currencies.forEach((c) => {
        var chip = make("div", "goals-currency");
        chip.append(make("span", "goals-currency-icon", c.icon), make("b", null, format(c.amount)), make("span", "goals-currency-name", c.name));
        if (c.earn) chip.title = c.earn;
        row.appendChild(chip);
      });
      parts.push(row);
    }
    if (data.badges && data.badges.length) {
      var badges = make("div", "goals-badges");
      data.badges.forEach((b) => {
        var chip = make("span", "goals-badge", b.icon + " " + b.name);
        badges.appendChild(chip);
      });
      parts.push(badges);
    }
    return parts;
  }

  function goalsTab() {
    var parts = [];
    data.currencies.filter((c) => c.earn).forEach((c) => parts.push(make("p", "goals-earn", c.earn)));
    if (data.boardInfo) parts.push(make("p", "goals-earn", "The leaderboard counts your " + lower(data.boardInfo.name) + " " + data.boardInfo.icon + "."));
    var on = (data.boosts || []).filter((b) => b.on);
    on.forEach((b) => parts.push(boostRow(b)));
    if (data.gameOfDay) parts.push(make("p", "goals-day", "📅 The game of the day is " + data.gameOfDay.name + "."));
    // Open goals first, then the ones still locked, the done ones last
    var order = (q) => (q.done ? 3 : q.locked || q.startsIn != null || q.over ? 2 : 1);
    data.quests
      .slice()
      .sort((a, b) => order(a) - order(b))
      .forEach((q) => {
        var row = make("div", "goals-quest" + (q.done ? " done" : "") + (q.locked || q.startsIn != null || q.over ? " locked" : ""));
        var head = make("div", "goals-quest-head");
        head.append(make("span", "goals-quest-icon", q.done ? "✅" : q.locked ? "🔒" : q.icon), make("b", "goals-quest-name", q.name || q.text));
        if (q.together) head.appendChild(make("span", "goals-repeat", "Together"));
        if (q.repeat != "once") head.appendChild(make("span", "goals-repeat", q.repeat == "daily" ? "Daily" : "Weekly"));
        row.appendChild(head);
        if (q.name) row.appendChild(make("p", "goals-quest-text", q.text));
        if (q.locked) row.appendChild(make("p", "goals-quest-text", "Opens after this goal: " + q.after));
        else if (q.startsIn != null) row.appendChild(make("p", "goals-quest-text", "Opens " + left(q.startsIn) + "."));
        else if (q.over) row.appendChild(make("p", "goals-quest-text", "This goal is over."));
        else if (!q.done) {
          var bar = make("div", "goals-bar");
          var fillBar = make("div", "goals-bar-fill");
          fillBar.style.width = Math.min(100, (q.count / q.need) * 100) + "%";
          bar.appendChild(fillBar);
          row.appendChild(bar);
          var info = (q.steps > 1 ? "Step " + (q.step + 1) + " of " + q.steps + ", " : "") + format(Math.floor(q.count)) + " of " + format(q.need) + (q.together ? (q.helped ? ". You are helping." : ". Play along to get the reward.") : "");
          row.appendChild(make("span", "goals-progress", info));
        }
        var foot = make("div", "goals-quest-foot");
        if (q.reward) foot.appendChild(make("span", "goals-reward", "🎁 " + q.reward));
        if (q.endsIn != null && !q.done) foot.appendChild(make("span", "goals-reset", "Ends " + left(q.endsIn)));
        else if (q.resetIn != null) foot.appendChild(make("span", "goals-reset", (q.done ? "Again " : "Starts over ") + left(q.resetIn)));
        row.appendChild(foot);
        parts.push(row);
      });
    if (!data.quests.length) parts.push(make("p", "goals-earn", "This season has no goals."));
    return parts;
  }

  function passTab() {
    var parts = [];
    data.currencies
      .filter((c) => c.milestones && c.milestones.length)
      .forEach((c) => {
        var next = c.milestones.find((m) => !m.reached);
        parts.push(make("p", "goals-earn", next ? "You have earned " + format(c.earned) + " " + c.icon + ". The next level comes at " + format(next.at) + "." : "You reached every level with " + c.icon + "."));
        var track = make("div", "goals-pass");
        c.milestones.forEach((m, i) => {
          var step = make("div", "goals-level" + (m.reached ? " reached" : m === next ? " next" : ""));
          var bar = make("div", "goals-bar");
          var prev = i ? c.milestones[i - 1].at : 0;
          var fillBar = make("div", "goals-bar-fill");
          fillBar.style.width = (m.reached ? 100 : m === next ? Math.max(0, Math.min(100, ((c.earned - prev) / (m.at - prev)) * 100)) : 0) + "%";
          bar.appendChild(fillBar);
          step.append(make("span", "goals-level-mark", m.reached ? "✅" : c.icon), make("b", "goals-level-name", m.name || format(m.at) + " " + c.icon), make("span", "goals-level-at", format(m.at)), bar, make("span", "goals-reward", "🎁 " + m.reward));
          track.appendChild(step);
        });
        parts.push(track);
      });
    return parts;
  }

  function shopTab() {
    var parts = [];
    data.shop.forEach((o) => {
      var row = make("div", "goals-offer");
      var buy = make("button", "mm-btn mm-btn-sm" + (o.afford && o.left !== 0 ? " mm-btn-primary" : ""), o.left === 0 ? "Bought" : o.priceIcon + " " + format(o.price));
      buy.type = "button";
      buy.disabled = !o.afford || o.left === 0;
      buy.addEventListener("click", () => purchase(o, buy));
      var info = make("div", "goals-offer-info");
      info.append(make("b", null, o.name), make("span", "goals-reward", "🎁 " + o.reward));
      if (o.left != null && o.left > 0) info.appendChild(make("span", "goals-reset", o.left == 1 ? "One left for you." : o.left + " left for you."));
      row.append(make("span", "goals-quest-icon", o.icon), info, buy);
      parts.push(row);
    });
    return parts;
  }

  async function purchase(offer, buy) {
    buy.disabled = true;
    try {
      var res = await fetch("goals/buy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: offer.id }) });
      var body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "That didn't work.");
      data = body;
      render();
    } catch (error) {
      if (typeof showHint == "function") showHint(error.message, "error");
      buy.disabled = false;
    }
  }

  function teamsTab() {
    var t = data.teams;
    var parts = [];
    var mine = t.list.find((team) => team.id == t.mine);
    if (mine) parts.push(make("p", "goals-day", "You play for " + mine.icon + " " + mine.name + "."));
    if (t.score) parts.push(make("p", "goals-earn", "The team with the most " + lower(t.score.name) + " " + t.score.icon + " wins the season." + (t.reward ? " Its players get " + t.reward + "." : "")));
    var top = t.list.length ? t.list[0].score : 0;
    t.list.forEach((team, i) => {
      var row = make("div", "goals-team" + (team.id == t.mine ? " mine" : ""));
      if (team.color) row.style.setProperty("--team", team.color);
      var bar = make("div", "goals-bar");
      var fillBar = make("div", "goals-bar-fill");
      fillBar.style.width = (top > 0 ? (team.score / top) * 100 : 0) + "%";
      bar.appendChild(fillBar);
      var head = make("div", "goals-quest-head");
      head.append(make("span", "goals-quest-icon", i == 0 && top > 0 ? "👑" : team.icon), make("b", "goals-quest-name", team.icon + " " + team.name), make("span", "goals-team-score", format(team.score) + " " + (t.score ? t.score.icon : "")));
      row.append(head, bar, make("span", "goals-progress", team.members == 1 ? "1 player" : team.members + " players"));
      parts.push(row);
    });
    return parts;
  }

  function boostRow(b) {
    var row = make("div", "goals-boost" + (b.on ? " on" : ""));
    var head = make("div", "goals-quest-head");
    head.append(make("span", "goals-quest-icon", b.icon), make("b", "goals-quest-name", b.name || "Boost"), make("span", "goals-repeat", b.on ? "On now" : b.startsIn != null ? "Starts " + left(b.startsIn) : "Off"));
    row.append(head, make("p", "goals-quest-text", b.text));
    if (b.on && b.endsIn != null) row.appendChild(make("span", "goals-reset", "Ends " + left(b.endsIn)));
    return row;
  }

  function boostsTab() {
    var parts = [];
    if (data.gameOfDay) parts.push(make("p", "goals-day", "📅 The game of the day is " + data.gameOfDay.name + "."));
    data.boosts
      .slice()
      .sort((a, b) => b.on - a.on)
      .forEach((b) => parts.push(boostRow(b)));
    return parts;
  }

  var FILL = { goals: goalsTab, pass: passTab, shop: shopTab, teams: teamsTab, boosts: boostsTab };

  function fill() {
    var shown = TABS.filter(([id]) => has[id]());
    if (!shown.some(([id]) => id == tab)) tab = shown.length ? shown[0][0] : "goals";
    popup.tabs.replaceChildren(
      ...shown.map(([id, label]) => {
        var b = make("button", "goals-tab" + (id == tab ? " active" : ""), label);
        b.type = "button";
        b.addEventListener("click", () => {
          tab = id;
          fill();
        });
        return b;
      }),
    );
    popup.tabs.hidden = shown.length < 2;
    popup.list.replaceChildren(...wallet(), ...FILL[tab]());
  }

  function open(which) {
    if (popup) return;
    if (which) tab = which;
    var backdrop = make("div", "mm-dialog-backdrop");
    var dialog = make("div", "mm-dialog goals-dialog");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "The season");
    var season = data && data.season;
    dialog.appendChild(make("h2", "mm-dialog-title", (season ? season.icon + " " + season.name : "The season")));
    var tabs = make("div", "goals-tabs");
    var list = make("div", "goals-list");
    dialog.append(tabs, list);
    var actions = make("div", "mm-dialog-actions single");
    var close = make("button", "mm-btn mm-btn-primary", "Close");
    close.type = "button";
    actions.appendChild(close);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    popup = { list: list, tabs: tabs };
    fill();
    load();
    var shut = () => {
      popup = null;
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
    };
    var onKey = (event) => event.key == "Escape" && shut();
    document.addEventListener("keydown", onKey);
    close.addEventListener("click", shut);
    backdrop.addEventListener("click", (event) => event.target == backdrop && shut());
  }

  button.addEventListener("click", () => data && open());

  if (typeof socket != "undefined") {
    socket.on("goalsChanged", () => load());
    socket.on("goalDone", (goal) => {
      var titles = { milestone: "Level reached!", offer: "Bought!", team: "Your team won!" };
      if (typeof casinoNotice == "function") casinoNotice({ icon: goal.icon || "🎯", title: titles[goal.kind] || "Goal done!", text: (goal.name || goal.text) + (goal.reward ? " You got " + goal.reward + "." : ""), ms: 8000, action: { label: "Season", run: () => data && open(goal.kind == "milestone" ? "pass" : "goals") } });
      load();
    });
    socket.on("boostOn", (boost) => {
      if (typeof casinoNotice == "function") casinoNotice({ icon: boost.icon || "⚡", title: (boost.name || "A boost") + " started!", text: boost.text, ms: 10000, key: "boost", action: { label: "Boosts", run: () => data && open("boosts") } });
      load();
    });
  }
  load();
  // (daily goals start over at midnight, boosts come and go: once in a while again)
  setInterval(load, 60 * 1000);
})();
