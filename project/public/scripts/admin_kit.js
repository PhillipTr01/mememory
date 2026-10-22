/*
 * The season sandbox in the season form (game/season_kit.js): the games of the season, its currencies,
 * its goals (steps with conditions) and what the leaderboard counts - with modes and goal templates to
 * start from. seasonKit.catalog(data): the building blocks from the server; seasonKit.load(kit): the
 * kit of a season into the form; seasonKit.value(): what is saved.
 */
var seasonKit = (function () {
  var catalog = null; // {games: [{id, name, fields}], common, outcomes, measures, repeats, limits}
  var kit = empty();
  var root = null;
  var previewTimer = null;

  function empty() {
    return { games: null, currencies: [], quests: [], board: "coins" };
  }
  function make(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.innerText = text;
    return element;
  }
  var clone = (value) => JSON.parse(JSON.stringify(value));
  var gameIds = () => catalog.games.map((g) => g.id);
  var gameName = (id) => (id == "any" ? "Any game" : (catalog.games.find((g) => g.id == id) || { name: id }).name);
  var fieldsOf = (game) => catalog.common.concat((catalog.games.find((g) => g.id == game) || { fields: [] }).fields);

  var OUTCOMES = { any: "Any result", win: "Won", loss: "Lost", even: "Bet back" };
  var MEASURES = { plays: "Plays", bet: "Coins wagered", win: "Coins won", profit: "Profit", loss: "Coins lost" };
  var REPEATS = { once: "Once per season", daily: "Every day", weekly: "Every week" };
  var OPS = { eq: "is", ne: "is not", gte: "≥", lte: "≤", gt: ">", lt: "<" };

  /* ---------- Modes and templates ---------- */

  var step = (game, fields) => Object.assign({ game: game, outcome: "any", where: [], need: 1, measure: "plays", inRow: false, next: false }, fields || {});
  var cond = (field, op, value) => ({ field: field, op: op, value: value });

  var TEMPLATES = [
    { label: "Empty goal", quest: () => ({ icon: "🎯", repeat: "once", steps: [step("any", { need: 10 })] }) },
    { label: "Daily: 30 spins", quest: () => ({ icon: "🎰", repeat: "daily", steps: [step("slots", { need: 30 })], reward: { coins: 2500 } }) },
    { label: "Red 10× lost, then green", quest: () => ({ icon: "🎡", repeat: "once", steps: [step("roulette", { outcome: "loss", where: [cond("on", "eq", "red")], need: 10, inRow: true }), step("roulette", { outcome: "win", where: [cond("on", "eq", "green")], next: true })], reward: { coins: 25000 } }) },
    { label: "Jackpot with 5% or less", quest: () => ({ icon: "🍀", repeat: "once", steps: [step("jackpot", { outcome: "win", where: [cond("chance", "lte", 5)] })], reward: { coins: 20000 } }) },
    { label: "3 blackjacks in a row", quest: () => ({ icon: "🃏", repeat: "once", steps: [step("blackjack", { where: [cond("result", "eq", "blackjack")], need: 3, inRow: true })], reward: { coins: 15000 } }) },
    { label: "Slots win of 100×", quest: () => ({ icon: "🚀", repeat: "once", steps: [step("slots", { where: [cond("x", "gte", 100)] })], reward: { coins: 30000 } }) },
    { label: "Weekly: wager 100,000", quest: () => ({ icon: "📈", repeat: "weekly", steps: [step("any", { measure: "bet", need: 100000 })], reward: { coins: 10000 } }) },
    { label: "Poker: win with a flush", quest: () => ({ icon: "♠️", repeat: "once", steps: [step("poker", { outcome: "win", where: [cond("hand", "eq", "flush")] })], reward: { coins: 10000 } }) },
    { label: "Runner: 1,000 m", quest: () => ({ icon: "🏃", repeat: "daily", steps: [step("runner", { where: [cond("distance", "gte", 1000)] })], reward: { coins: 5000 } }) },
    { label: "Battles: win in crazy mode", quest: () => ({ icon: "⚔️", repeat: "once", steps: [step("battles", { outcome: "win", where: [cond("mode", "eq", "crazy")], need: 3 })], reward: { coins: 15000 } }) },
  ];

  var MODES = [
    { label: "Everything", about: "Every game, the coins count.", apply: () => Object.assign(kit, { games: null, board: kit.board }) },
    { label: "Slots only", about: "Only the slots.", apply: () => (kit.games = ["slots"]) },
    { label: "Table games", about: "Poker, blackjack, roulette and Bầu Cua.", apply: () => (kit.games = ["poker", "blackjack", "roulette", "baucua"]) },
    { label: "Jackpot only", about: "Only the jackpot.", apply: () => (kit.games = ["jackpot"]) },
    {
      label: "Quest marathon",
      about: "Every game, goals give points, the points count.",
      apply: () => {
        kit.games = null;
        if (!kit.currencies.some((c) => c.id == "points")) kit.currencies.push({ id: "points", name: "Points", icon: "⭐", earn: null });
        kit.board = "points";
        [1, 2, 3, 6].forEach((i) => {
          var quest = TEMPLATES[i].quest();
          quest.reward = { coins: 0, currencies: { points: [10, 50, 40, 20][[1, 2, 3, 6].indexOf(i)] }, items: [] };
          kit.quests.push(quest);
        });
      },
    },
  ];

  /* ---------- Small inputs ---------- */

  function select(options, value, onChange, label) {
    var box = make("select", "mm-input");
    if (label) box.setAttribute("aria-label", label);
    options.forEach(([id, name]) => box.appendChild(Object.assign(make("option", null, name), { value: id })));
    box.value = value;
    box.addEventListener("change", () => onChange(box.value));
    return box;
  }
  function number(value, onInput, attrs) {
    var input = Object.assign(make("input", "mm-input"), { type: "number", min: 0, step: 1 }, attrs || {});
    input.value = value == null ? "" : value;
    input.addEventListener("input", () => onInput(input.value === "" ? "" : Number(input.value)));
    return input;
  }
  function text(value, onInput, attrs) {
    var input = Object.assign(make("input", "mm-input"), attrs || {});
    input.value = value || "";
    input.addEventListener("input", () => onInput(input.value));
    return input;
  }
  function check(label, value, onChange) {
    var box = make("label", "ad-kit-check");
    var input = Object.assign(make("input"), { type: "checkbox", checked: !!value });
    input.addEventListener("change", () => onChange(input.checked));
    box.append(input, make("span", null, label));
    return box;
  }
  function button(label, onClick, className) {
    var b = make("button", "mm-btn mm-btn-sm " + (className || ""), label);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }
  function removeButton(onClick) {
    var b = make("button", "ad-icon-btn ad-kit-remove", "✕");
    b.type = "button";
    b.title = "Remove";
    b.addEventListener("click", onClick);
    return b;
  }
  function section(title, hint) {
    var box = make("div", "ad-kit-section");
    var head = make("div", "ad-kit-head");
    head.appendChild(make("h3", "ad-kit-title", title));
    box.appendChild(head);
    if (hint) box.appendChild(make("p", "ad-setting-hint", hint));
    return box;
  }

  /* ---------- Conditions and steps ---------- */

  // The conditions of a step (or of earning a currency) on what the game knows of a play
  function whereEditor(owner) {
    var box = make("div", "ad-kit-where");
    owner.where = owner.where || [];
    owner.where.forEach((c, i) => {
      var fields = fieldsOf(owner.game);
      var field = fields.find((f) => f.id == c.field) || fields[0];
      var row = make("div", "ad-kit-cond");
      row.appendChild(
        select(fields.map((f) => [f.id, f.name]), field.id, (id) => {
          var f = fields.find((x) => x.id == id);
          owner.where[i] = { field: id, op: "eq", value: f.type == "number" ? 0 : f.options[0].id };
          render();
        }, "Condition"),
      );
      var ops = field.type == "number" ? ["eq", "ne", "gte", "lte", "gt", "lt"] : ["eq", "ne"];
      row.appendChild(select(ops.map((op) => [op, OPS[op]]), ops.includes(c.op) ? c.op : "eq", (op) => ((c.op = op), changed()), "Comparison"));
      if (field.type == "number") row.appendChild(number(c.value, (v) => ((c.value = v), changed()), { step: "any" }));
      else row.appendChild(select(field.options.map((o) => [o.id, o.name]), c.value, (v) => ((c.value = v), changed()), field.name));
      row.appendChild(removeButton(() => (owner.where.splice(i, 1), render())));
      box.appendChild(row);
    });
    if (owner.where.length < catalog.limits.where) {
      box.appendChild(
        button("+ Condition", () => {
          var f = fieldsOf(owner.game).slice(-1)[0];
          owner.where.push({ field: f.id, op: "eq", value: f.type == "number" ? 0 : f.options[0].id });
          render();
        }, "ad-kit-add"),
      );
    }
    return box;
  }

  // Which game, which result, what is counted
  function playEditor(owner, onGame) {
    var row = make("div", "ad-kit-play");
    var games = [["any", "Any game"]].concat(catalog.games.filter((g) => !kit.games || kit.games.includes(g.id)).map((g) => [g.id, g.name]));
    if (!games.some(([id]) => id == owner.game)) games.push([owner.game, gameName(owner.game) + " (not in the season)"]);
    row.appendChild(
      select(games, owner.game, (game) => {
        owner.game = game;
        // (conditions another game doesn't know: gone)
        var known = fieldsOf(game).map((f) => f.id);
        owner.where = (owner.where || []).filter((c) => known.includes(c.field));
        if (onGame) onGame();
        render();
      }, "Game"),
    );
    row.appendChild(select(catalog.outcomes.map((o) => [o, OUTCOMES[o]]), owner.outcome, (v) => ((owner.outcome = v), changed()), "Result"));
    row.appendChild(select(catalog.measures.map((m) => [m, MEASURES[m]]), owner.measure, (v) => ((owner.measure = v), changed()), "Counts"));
    return row;
  }

  function stepEditor(quest, s, i) {
    var box = make("div", "ad-kit-step");
    var head = make("div", "ad-kit-step-head");
    head.appendChild(make("b", "ad-kit-step-no", "Step " + (i + 1)));
    if (quest.steps.length > 1) head.appendChild(removeButton(() => (quest.steps.splice(i, 1), render())));
    box.appendChild(head);
    var line = playEditor(s);
    var need = make("label", "ad-kit-need");
    need.append(make("span", null, "Goal"), number(s.need, (v) => ((s.need = v), changed()), { min: 1 }));
    line.appendChild(need);
    box.appendChild(line);
    box.appendChild(whereEditor(s));
    var flags = make("div", "ad-kit-flags");
    flags.appendChild(check("In a row (a miss starts the step over)", s.inRow, (v) => ((s.inRow = v), changed())));
    if (i > 0) flags.appendChild(check("Right after the step before (a miss starts the goal over)", s.next, (v) => ((s.next = v), changed())));
    box.appendChild(flags);
    return box;
  }

  function rewardEditor(quest) {
    quest.reward = quest.reward || { coins: 0, currencies: {}, items: [] };
    quest.reward.currencies = quest.reward.currencies || {};
    quest.reward.items = quest.reward.items || [];
    var box = make("div", "ad-kit-reward");
    box.appendChild(make("span", "ad-label", "Reward"));
    var row = make("div", "ad-kit-reward-row");
    var coinsBox = make("label", "ad-kit-need");
    coinsBox.append(make("span", null, "Season coins"), number(quest.reward.coins || "", (v) => ((quest.reward.coins = v || 0), changed()), { step: 1000, placeholder: "0" }));
    row.appendChild(coinsBox);
    kit.currencies.forEach((c) => {
      var cur = make("label", "ad-kit-need");
      cur.append(make("span", null, c.icon + " " + (c.name || "")), number(quest.reward.currencies[c.id] || "", (v) => ((quest.reward.currencies[c.id] = v || 0), changed()), { placeholder: "0" }));
      row.appendChild(cur);
    });
    // Shop items (frames, animations, backgrounds) - when the shop is loaded
    if (typeof itemSelect == "function" && typeof shopSaved != "undefined" && shopSaved) {
      var kindOf = (id) => (shopSaved.items.find((item) => item.id == id) || {}).kind;
      [
        ["frame", "Frame"],
        ["effect", "Animation"],
        ["background", "Background"],
      ].forEach(([kind, label]) => {
        var pick = itemSelect(kind, label, quest.reward.items.find((id) => kindOf(id) == kind) || "");
        pick.addEventListener("change", () => {
          quest.reward.items = quest.reward.items.filter((id) => kindOf(id) != kind).concat(pick.value ? [pick.value] : []);
          changed();
        });
        row.appendChild(pick);
      });
    }
    box.appendChild(row);
    return box;
  }

  function questEditor(quest, i) {
    var card = make("div", "ad-kit-quest");
    var head = make("div", "ad-kit-quest-head");
    head.append(
      text(quest.icon, (v) => ((quest.icon = v), changed()), { className: "mm-input ad-kit-icon", maxLength: 8, ariaLabel: "Icon" }),
      text(quest.name, (v) => ((quest.name = v), changed()), { maxLength: 60, placeholder: "Name (optional)" }),
      select(catalog.repeats.map((r) => [r, REPEATS[r]]), quest.repeat || "once", (v) => ((quest.repeat = v), changed()), "Repeats"),
      button("Copy", () => (kit.quests.splice(i + 1, 0, clone(Object.assign({}, quest, { id: undefined }))), render())),
      removeButton(() => (kit.quests.splice(i, 1), render())),
    );
    card.appendChild(head);
    var said = make("p", "ad-kit-said");
    said.dataset.quest = i;
    card.appendChild(said);
    quest.steps.forEach((s, j) => card.appendChild(stepEditor(quest, s, j)));
    if (quest.steps.length < catalog.limits.steps) card.appendChild(button("+ Step", () => (quest.steps.push(step(quest.steps[quest.steps.length - 1].game)), render()), "ad-kit-add"));
    var own = text(quest.text, (v) => ((quest.text = v), changed()), { maxLength: 300, placeholder: "Own text for the players (optional - otherwise the line above)" });
    own.classList.add("ad-kit-own");
    card.appendChild(own);
    card.appendChild(rewardEditor(quest));
    return card;
  }

  function currencyEditor(c, i) {
    var card = make("div", "ad-kit-currency");
    var head = make("div", "ad-kit-quest-head");
    head.append(
      text(c.icon, (v) => ((c.icon = v), changed()), { className: "mm-input ad-kit-icon", maxLength: 8, ariaLabel: "Icon" }),
      text(c.name, (v) => ((c.name = v), changed()), { maxLength: 20, placeholder: "Name, e.g. Stars" }),
      check("Earned while playing", c.earn && c.earn.on, (on) => {
        c.earn = on ? Object.assign({ on: true, game: "any", outcome: "any", where: [], measure: "bet", per: 1000, amount: 1 }, c.earn || {}, { on: true }) : null;
        render();
      }),
      removeButton(() => {
        kit.currencies.splice(i, 1);
        if (kit.board == c.id) kit.board = "coins";
        kit.quests.forEach((q) => q.reward && q.reward.currencies && delete q.reward.currencies[c.id]);
        render();
      }),
    );
    card.appendChild(head);
    if (c.earn && c.earn.on) {
      var line = playEditor(c.earn);
      var per = make("label", "ad-kit-need");
      per.append(make("span", null, "For every"), number(c.earn.per, (v) => ((c.earn.per = v), changed()), { min: 1, step: "any" }));
      var amount = make("label", "ad-kit-need");
      amount.append(make("span", null, "give " + (c.icon || "")), number(c.earn.amount, (v) => ((c.earn.amount = v), changed()), { min: 1 }));
      line.append(per, amount);
      card.appendChild(line);
      card.appendChild(whereEditor(c.earn));
      var said = make("p", "ad-kit-said");
      said.dataset.currency = i;
      card.appendChild(said);
    }
    return card;
  }

  /* ---------- The whole sandbox ---------- */

  function render() {
    if (!root || !catalog) return;
    var scroll = window.scrollY;
    root.replaceChildren();

    var modes = section("Mode", "A starting point. It changes the games (and for the quest marathon adds points and goals); everything stays editable below.");
    var modeRow = make("div", "ad-kit-chips");
    MODES.forEach((mode) => {
      var b = button(mode.label, () => (mode.apply(), render()));
      b.title = mode.about;
      modeRow.appendChild(b);
    });
    modes.appendChild(modeRow);
    root.appendChild(modes);

    var games = section("Games", "Only these games are open in the season world. Pages of a game taken out go to another game.");
    var gameRow = make("div", "ad-kit-chips");
    catalog.games.forEach((g) => {
      var on = !kit.games || kit.games.includes(g.id);
      gameRow.appendChild(
        check(g.name, on, (v) => {
          var list = kit.games ? kit.games.slice() : gameIds();
          list = v ? list.concat([g.id]) : list.filter((id) => id != g.id);
          kit.games = list.length == catalog.games.length ? null : list;
          render();
        }),
      );
    });
    games.appendChild(gameRow);
    root.appendChild(games);

    var currencies = section("Currencies", "Up to " + catalog.limits.currencies + " of the season's own, next to its coins. Goals give them, or players earn them while playing.");
    kit.currencies.forEach((c, i) => currencies.appendChild(currencyEditor(c, i)));
    if (kit.currencies.length < catalog.limits.currencies) currencies.appendChild(button("+ Currency", () => (kit.currencies.push({ id: "c" + Math.random().toString(36).slice(2, 8), name: "", icon: "⭐", earn: null }), render()), "ad-kit-add"));
    root.appendChild(currencies);

    var board = section("Leaderboard", "What the places of the season go by (and the prizes).");
    board.appendChild(
      select(
        [["coins", "The season's coins"]].concat(kit.currencies.filter((c) => c.name).map((c) => [c.id, c.icon + " " + c.name])),
        kit.board,
        (v) => ((kit.board = v), changed()),
        "Leaderboard counts",
      ),
    );
    root.appendChild(board);

    var quests = section("Goals", "Steps one after the other; every step counts the plays of a game that match its conditions. Daily and weekly goals start over at midnight and on Monday.");
    kit.quests.forEach((q, i) => quests.appendChild(questEditor(q, i)));
    if (kit.quests.length < catalog.limits.quests) {
      var add = make("div", "ad-kit-chips");
      add.appendChild(make("span", "ad-label", "+ Goal"));
      TEMPLATES.forEach((t) => add.appendChild(button(t.label, () => (kit.quests.push(t.quest()), render()))));
      quests.appendChild(add);
    }
    root.appendChild(quests);

    var problem = make("p", "ad-form-error ad-kit-error");
    problem.hidden = true;
    root.appendChild(problem);
    window.scrollTo(0, scroll);
    changed();
  }

  // Something changed: what the goals say (and what is wrong) - from the server, a moment later
  function changed() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      try {
        var res = await fetch("api/seasons/kit-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kit: value() }) });
        var data = await res.json();
        var problem = root.querySelector(".ad-kit-error");
        if (problem) {
          problem.hidden = !data.error;
          problem.innerText = data.error || "";
        }
        if (data.error) return;
        root.querySelectorAll("[data-quest]").forEach((p) => (p.innerText = "Players read: " + (kit.quests[p.dataset.quest].text || data.quests[p.dataset.quest] || "")));
        root.querySelectorAll("[data-currency]").forEach((p) => (p.innerText = "Players read: " + (data.currencies[p.dataset.currency] || "")));
      } catch (error) {
        // (no preview - saving says what is wrong)
      }
    }, 350);
  }

  function value() {
    return clone(kit);
  }

  return {
    mount(element) {
      root = element;
      render();
    },
    catalog(data) {
      var first = catalog == null;
      catalog = data;
      if (first) render();
    },
    load(saved) {
      kit = saved ? clone(saved) : empty();
      kit.currencies = kit.currencies || [];
      kit.quests = kit.quests || [];
      kit.board = kit.board || "coins";
      render();
    },
    value: value,
  };
})();
