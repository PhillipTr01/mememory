/*
 * The goals of the season (game/season_kit.js) on every casino page of the season world: a button in the
 * bar at the top (done / all), a popup with every goal and its progress and the season's currencies, a
 * notice when a goal is done. Loaded by casino_wallet.js in a season world only.
 */
(function () {
  var anchor = document.getElementById("navBonus") || document.getElementById("navCoins");
  if (!anchor || document.getElementById("navGoals")) return;
  var data = null;
  var popup = null; // the open popup: its list
  var loading = null;

  function make(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.innerText = text;
    return element;
  }
  var format = (n) => Number(n).toLocaleString("en-US");

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

  // "in 5 h", "in 2 days"
  function left(ms) {
    var hours = Math.ceil(ms / 3600000);
    if (hours < 1) return "in less than an hour";
    if (hours < 48) return "in " + hours + " h";
    return "in " + Math.ceil(hours / 24) + " days";
  }

  function render() {
    var quests = (data && data.quests) || [];
    var currencies = (data && data.currencies) || [];
    button.hidden = quests.length == 0 && currencies.length == 0;
    var done = quests.filter((q) => q.done).length;
    button.replaceChildren(document.createTextNode("🎯 "), make("span", "nav-goals-text", quests.length ? done + "/" + quests.length : "Goals"));
    button.classList.toggle("ready", quests.some((q) => !q.done && q.count > 0));
    button.title = "Goals of the season";
    if (popup) fill(popup);
  }

  function fill(list) {
    var quests = data.quests || [];
    var currencies = data.currencies || [];
    var parts = [];
    if (currencies.length) {
      var wallet = make("div", "goals-currencies");
      currencies.forEach((c) => {
        var chip = make("div", "goals-currency");
        chip.append(make("span", "goals-currency-icon", c.icon), make("b", null, format(c.amount)), make("span", "goals-currency-name", c.name));
        if (c.earn) chip.title = c.earn;
        wallet.appendChild(chip);
      });
      parts.push(wallet);
      currencies.filter((c) => c.earn).forEach((c) => parts.push(make("p", "goals-earn", c.earn)));
    }
    if (data.board && data.board != "coins") {
      var board = currencies.find((c) => c.id == data.board);
      if (board) parts.push(make("p", "goals-earn", "The leaderboard counts your " + board.name.toLowerCase() + " " + board.icon + "."));
    }
    // Open goals first, the done ones after them
    quests
      .slice()
      .sort((a, b) => a.done - b.done)
      .forEach((q) => {
        var row = make("div", "goals-quest" + (q.done ? " done" : ""));
        var head = make("div", "goals-quest-head");
        head.append(make("span", "goals-quest-icon", q.done ? "✅" : q.icon), make("b", "goals-quest-name", q.name || q.text));
        if (q.repeat != "once") head.appendChild(make("span", "goals-repeat", q.repeat == "daily" ? "Daily" : "Weekly"));
        row.appendChild(head);
        if (q.name) row.appendChild(make("p", "goals-quest-text", q.text));
        if (!q.done) {
          var bar = make("div", "goals-bar");
          var fillBar = make("div", "goals-bar-fill");
          fillBar.style.width = Math.min(100, (q.count / q.need) * 100) + "%";
          bar.appendChild(fillBar);
          row.appendChild(bar);
          var info = (q.steps > 1 ? "Step " + (q.step + 1) + " of " + q.steps + ", " : "") + format(Math.floor(q.count)) + " of " + format(q.need);
          row.appendChild(make("span", "goals-progress", info));
        }
        var foot = make("div", "goals-quest-foot");
        if (q.reward) foot.appendChild(make("span", "goals-reward", "🎁 " + q.reward));
        if (q.resetIn != null) foot.appendChild(make("span", "goals-reset", (q.done ? "Again " : "Starts over ") + left(q.resetIn)));
        row.appendChild(foot);
        parts.push(row);
      });
    if (!quests.length && !currencies.length) parts.push(make("p", "goals-earn", "This season has no goals."));
    list.replaceChildren(...parts);
  }

  function open() {
    var backdrop = make("div", "mm-dialog-backdrop");
    var dialog = make("div", "mm-dialog goals-dialog");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "Goals of the season");
    var season = data && data.season;
    dialog.appendChild(make("h2", "mm-dialog-title", (season ? season.icon + " " : "") + "Goals"));
    var list = make("div", "goals-list");
    dialog.appendChild(list);
    var actions = make("div", "mm-dialog-actions single");
    var close = make("button", "mm-btn mm-btn-primary", "Close");
    close.type = "button";
    actions.appendChild(close);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    popup = list;
    fill(list);
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
      if (typeof casinoNotice == "function") casinoNotice({ icon: goal.icon || "🎯", title: "Goal done!", text: (goal.name || goal.text) + (goal.reward ? " You got " + goal.reward + "." : ""), ms: 8000, action: { label: "Goals", run: () => data && open() } });
      load();
    });
  }
  load();
  // (daily goals start over at midnight: once in a while again)
  setInterval(load, 5 * 60 * 1000);
})();
