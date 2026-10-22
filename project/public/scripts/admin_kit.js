/*
 * The season sandbox in the season form (game/season_kit.js): the games of the season, its currencies
 * (with milestones - a season pass), its goals (steps with conditions), boosts, a shop, teams, rules and
 * what the leaderboard counts - with modes and templates to start from. seasonKit.catalog(data): the
 * building blocks from the server; seasonKit.load(kit): the kit of a season into the form;
 * seasonKit.value(): what is saved.
 */
var seasonKit = (function () {
  var catalog = null; // {games: [{id, name, fields}], common, outcomes, measures, repeats, stats, limits, ...}
  var kit = empty();
  var root = null;
  var previewTimer = null;

  function empty() {
    return { games: null, currencies: [], quests: [], board: "coins", boosts: [], shop: [], teams: null, rules: { gifts: true } };
  }
  function make(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.innerText = text;
    return element;
  }
  var clone = (value) => JSON.parse(JSON.stringify(value));
  var newId = (prefix) => prefix + Math.random().toString(36).slice(2, 8);
  var gameIds = () => catalog.games.map((g) => g.id);
  var gameName = (id) => (id == "any" ? "Any game" : (catalog.games.find((g) => g.id == id) || { name: id }).name);
  var fieldsOf = (game) => catalog.common.concat((catalog.games.find((g) => g.id == game) || { fields: [] }).fields);
  var seasonGames = () => catalog.games.filter((g) => !kit.games || kit.games.includes(g.id));
  // What the leaderboard and the teams can count: the coins, a currency, a stat
  var metrics = (withCoins) =>
    (withCoins ? [["coins", "The season's coins"]] : [])
      .concat(kit.currencies.filter((c) => c.name).map((c) => [c.id, c.icon + " " + c.name]))
      .concat(catalog.stats.map((s) => [s.id, s.icon + " " + s.name]));

  var OUTCOMES = { any: "Any result", win: "Won", loss: "Lost", even: "Bet back" };
  var MEASURES = { plays: "Plays", bet: "Coins wagered", win: "Coins won", profit: "Profit", loss: "Coins lost" };
  var REPEATS = { once: "Once per season", daily: "Every day", weekly: "Every week" };
  var OPS = { eq: "is", ne: "is not", gte: "≥", lte: "≤", gt: ">", lt: "<" };
  var BOOST_KINDS = { winBonus: "More coins on wins", currencyX: "More of a currency" };
  var BOOST_TIMES = { always: "All season", hours: "At set hours", dates: "Between two dates", golden: "Golden minutes (random)" };
  var DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

  /* ---------- Modes and templates ---------- */

  var step = (game, fields) => Object.assign({ game: game, outcome: "any", where: [], need: 1, measure: "plays", inRow: false, next: false }, fields || {});
  var cond = (field, op, value) => ({ field: field, op: op, value: value });
  var currency = (id, name, icon, earn) => {
    var found = kit.currencies.find((c) => c.id == id);
    if (found) return found;
    found = { id: id, name: name, icon: icon, earn: earn || null, milestones: [] };
    kit.currencies.push(found);
    return found;
  };

  var TEMPLATES = [
    { label: "Empty goal", quest: () => ({ icon: "🎯", repeat: "once", steps: [step("any", { need: 10 })] }) },
    { label: "Daily: 30 spins", quest: () => ({ icon: "🎰", repeat: "daily", steps: [step("slots", { need: 30 })], reward: { coins: 2500 } }) },
    { label: "Red 10× lost, then green", quest: () => ({ icon: "🎡", repeat: "once", steps: [step("roulette", { outcome: "loss", where: [cond("on", "eq", "red")], need: 10, inRow: true }), step("roulette", { outcome: "win", where: [cond("on", "eq", "green")], next: true })], reward: { coins: 25000 } }) },
    { label: "Jackpot with 5% or less", quest: () => ({ icon: "🍀", repeat: "once", steps: [step("jackpot", { outcome: "win", where: [cond("chance", "lte", 5)] })], reward: { coins: 20000, badge: { icon: "🍀", name: "Lucky" } } }) },
    { label: "3 blackjacks in a row", quest: () => ({ icon: "🃏", repeat: "once", steps: [step("blackjack", { where: [cond("result", "eq", "blackjack")], need: 3, inRow: true })], reward: { coins: 15000 } }) },
    { label: "Slots win of 100×", quest: () => ({ icon: "🚀", repeat: "once", steps: [step("slots", { where: [cond("x", "gte", 100)] })], reward: { coins: 30000, badge: { icon: "🚀", name: "To the moon" } } }) },
    { label: "Weekly: wager 100,000", quest: () => ({ icon: "📈", repeat: "weekly", steps: [step("any", { measure: "bet", need: 100000 })], reward: { coins: 10000 } }) },
    { label: "Poker: win with a flush", quest: () => ({ icon: "♠️", repeat: "once", steps: [step("poker", { outcome: "win", where: [cond("hand", "eq", "flush")] })], reward: { coins: 10000 } }) },
    { label: "Runner: 1,000 m", quest: () => ({ icon: "🏃", repeat: "daily", steps: [step("runner", { where: [cond("distance", "gte", 1000)] })], reward: { coins: 5000 } }) },
    { label: "Battles: win in crazy mode", quest: () => ({ icon: "⚔️", repeat: "once", steps: [step("battles", { outcome: "win", where: [cond("mode", "eq", "crazy")], need: 3 })], reward: { coins: 15000 } }) },
    { label: "All together: 1,000 spins", quest: () => ({ icon: "🤝", repeat: "daily", scope: "everyone", steps: [step("slots", { need: 1000 })], reward: { coins: 2000 } }) },
    { label: "Secret: lose 5 times in a row", quest: () => ({ icon: "🤫", repeat: "once", hidden: true, steps: [step("any", { outcome: "loss", need: 5, inRow: true })], reward: { coins: 5000, badge: { icon: "🫠", name: "Unlucky" } } }) },
    { label: "Weekend: double up", quest: () => ({ icon: "🎉", repeat: "weekly", steps: [step("any", { outcome: "win", where: [cond("x", "gte", 2)], need: 20 })], reward: { coins: 8000 } }) },
  ];

  var BOOSTS = [
    { label: "Happy hour", boost: () => ({ name: "Happy hour", icon: "🍹", kind: "winBonus", amount: 25, game: "any", when: { type: "hours", from: 20, to: 22, days: [0, 1, 2, 3, 4, 5, 6] } }) },
    { label: "Golden minutes", boost: () => ({ name: "Golden minute", icon: "✨", kind: "winBonus", amount: 100, game: "any", when: { type: "golden", times: 3, minutes: 2 } }) },
    { label: "Game of the day", boost: () => ({ name: "Game of the day", icon: "📅", kind: "winBonus", amount: 15, game: "daily", when: { type: "always" } }) },
    { label: "Weekend double currency", boost: () => ({ name: "Weekend", icon: "🎉", kind: "currencyX", currency: "all", amount: 100, game: "any", when: { type: "hours", from: 0, to: 24, days: [5, 6] } }) },
    { label: "Final days", boost: () => ({ name: "Final days", icon: "🔥", kind: "winBonus", amount: 20, game: "any", when: { type: "dates", from: Date.now() + 5 * 86400000, to: Date.now() + 7 * 86400000 } }) },
  ];

  var MODES = [
    { label: "Everything", about: "Every game, the coins count.", apply: () => (kit.games = null) },
    { label: "Slots only", about: "Only the slots.", apply: () => (kit.games = ["slots"]) },
    { label: "Table games", about: "Poker, blackjack, roulette and Bầu Cua.", apply: () => (kit.games = ["poker", "blackjack", "roulette", "baucua"]) },
    { label: "Jackpot only", about: "Only the jackpot.", apply: () => (kit.games = ["jackpot"]) },
    {
      label: "Quest marathon",
      about: "Goals give points, the points count.",
      apply: () => {
        currency("points", "Points", "⭐");
        kit.board = "points";
        [1, 2, 3, 6].forEach((i, n) => {
          var quest = TEMPLATES[i].quest();
          quest.reward = { coins: 0, currencies: { points: [10, 50, 40, 20][n] }, items: [] };
          kit.quests.push(quest);
        });
      },
    },
    {
      label: "Season pass",
      about: "XP for every coin wagered, a reward at every level.",
      apply: () => {
        var xp = currency("xp", "XP", "✨", { on: true, game: "any", outcome: "any", where: [], measure: "bet", per: 1000, amount: 10 });
        xp.milestones = [100, 250, 500, 1000, 2000, 3500, 5000, 7500, 10000, 15000].map((at, i) => ({ at: at, name: "Level " + (i + 1), reward: { coins: 1000 * (i + 1), currencies: {}, items: [], badge: i == 9 ? { icon: "🏅", name: "Pass complete" } : null } }));
      },
    },
    {
      label: "Team battle",
      about: "Two teams, the points of their players count, the best team gets a badge.",
      apply: () => {
        currency("points", "Points", "⭐", { on: true, game: "any", outcome: "win", where: [], measure: "plays", per: 1, amount: 1 });
        kit.teams = { on: true, list: [{ id: "red", name: "Red", icon: "🔴", color: "#e05252" }, { id: "blue", name: "Blue", icon: "🔵", color: "#4f8cff" }], score: "points", reward: { coins: 0, currencies: {}, items: [], badge: { icon: "🏆", name: "Team champion" } } };
      },
    },
    { label: "Happy hours", about: "Wins pay more every evening.", apply: () => kit.boosts.push(BOOSTS[0].boost()) },
    {
      label: "Shop",
      about: "Stars from goals, things to buy with them.",
      apply: () => {
        currency("stars", "Stars", "⭐", { on: true, game: "any", outcome: "any", where: [], measure: "plays", per: 10, amount: 1 });
        kit.shop.push({ icon: "💰", name: "Coin bag", price: { currency: "stars", amount: 50 }, reward: { coins: 5000, currencies: {}, items: [] }, limit: 0 });
        kit.shop.push({ icon: "🏅", name: "Star badge", price: { currency: "stars", amount: 200 }, reward: { coins: 0, currencies: {}, items: [], badge: { icon: "🌟", name: "Star" } }, limit: 1 });
      },
    },
    { label: "Big wins count", about: "The biggest multiplier decides the places.", apply: () => (kit.board = "biggestX") },
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
  // A date and time (ms) - empty: none
  function when(value, onChange, label) {
    var input = Object.assign(make("input", "mm-input"), { type: "datetime-local" });
    input.setAttribute("aria-label", label);
    if (value != null) {
      var d = new Date(value - new Date(value).getTimezoneOffset() * 60000);
      input.value = d.toISOString().slice(0, 16);
    }
    input.addEventListener("change", () => onChange(input.value ? new Date(input.value).getTime() : null));
    return input;
  }
  function labeled(label, input) {
    var box = make("label", "ad-kit-need");
    box.append(make("span", null, label), input);
    return box;
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
  function said(kind, i) {
    var p = make("p", "ad-kit-said");
    p.dataset[kind] = i;
    return p;
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
  function playEditor(owner) {
    var row = make("div", "ad-kit-play");
    var games = [["any", "Any game"]].concat(seasonGames().map((g) => [g.id, g.name]));
    if (!games.some(([id]) => id == owner.game)) games.push([owner.game, gameName(owner.game) + " (not in the season)"]);
    row.appendChild(
      select(games, owner.game, (game) => {
        owner.game = game;
        // (conditions another game doesn't know: gone)
        var known = fieldsOf(game).map((f) => f.id);
        owner.where = (owner.where || []).filter((c) => known.includes(c.field));
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
    line.appendChild(labeled("Goal", number(s.need, (v) => ((s.need = v), changed()), { min: 1 })));
    box.appendChild(line);
    box.appendChild(whereEditor(s));
    if (quest.scope != "everyone") {
      var flags = make("div", "ad-kit-flags");
      flags.appendChild(check("In a row (a miss starts the step over)", s.inRow, (v) => ((s.inRow = v), changed())));
      if (i > 0) flags.appendChild(check("Right after the step before (a miss starts the goal over)", s.next, (v) => ((s.next = v), changed())));
      box.appendChild(flags);
    }
    return box;
  }

  // A reward: season coins, currencies, shop items, a badge
  function rewardEditor(owner, title) {
    owner.reward = owner.reward || { coins: 0, currencies: {}, items: [] };
    var reward = owner.reward;
    reward.currencies = reward.currencies || {};
    reward.items = reward.items || [];
    var box = make("div", "ad-kit-reward");
    box.appendChild(make("span", "ad-label", title || "Reward"));
    var row = make("div", "ad-kit-reward-row");
    row.appendChild(labeled("Season coins", number(reward.coins || "", (v) => ((reward.coins = v || 0), changed()), { step: 1000, placeholder: "0" })));
    kit.currencies.forEach((c) => row.appendChild(labeled(c.icon + " " + (c.name || ""), number(reward.currencies[c.id] || "", (v) => ((reward.currencies[c.id] = v || 0), changed()), { placeholder: "0" }))));
    // Shop items (frames, animations, backgrounds) - when the shop is loaded
    if (typeof itemSelect == "function" && typeof shopSaved != "undefined" && shopSaved) {
      var kindOf = (id) => (shopSaved.items.find((item) => item.id == id) || {}).kind;
      [
        ["frame", "Frame"],
        ["effect", "Animation"],
        ["background", "Background"],
      ].forEach(([kind, label]) => {
        var pick = itemSelect(kind, label, reward.items.find((id) => kindOf(id) == kind) || "");
        pick.addEventListener("change", () => {
          reward.items = reward.items.filter((id) => kindOf(id) != kind).concat(pick.value ? [pick.value] : []);
          changed();
        });
        row.appendChild(pick);
      });
    }
    // A badge: next to the name on the leaderboard
    var badge = reward.badge || { icon: "", name: "" };
    var badgeBox = make("div", "ad-kit-badge");
    badgeBox.append(
      make("span", null, "Badge"),
      text(badge.icon, (v) => ((badge.icon = v), (reward.badge = badge), changed()), { className: "mm-input ad-kit-icon", maxLength: 8, placeholder: "🏅" }),
      text(badge.name, (v) => ((badge.name = v), (reward.badge = badge), changed()), { maxLength: 30, placeholder: "Badge name (optional)" }),
    );
    row.appendChild(badgeBox);
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
    card.appendChild(said("quest", i));
    // Options: for everybody together, secret, after another goal, only for a while
    var opts = make("div", "ad-kit-options");
    opts.appendChild(select([["player", "Every player on their own"], ["everyone", "All players together"]], quest.scope || "player", (v) => ((quest.scope = v), render()), "Who"));
    var others = kit.quests.filter((q) => q !== quest && q.id);
    opts.appendChild(select([["", "No goal before it"]].concat(others.map((q) => [q.id, "After: " + (q.name || q.icon + " goal " + (kit.quests.indexOf(q) + 1))])), quest.requires || "", (v) => ((quest.requires = v || null), changed()), "After another goal"));
    opts.appendChild(labeled("From", when(quest.from, (v) => ((quest.from = v), changed()), "From")));
    opts.appendChild(labeled("Until", when(quest.until, (v) => ((quest.until = v), changed()), "Until")));
    opts.appendChild(check("Secret until done", quest.hidden, (v) => ((quest.hidden = v), changed())));
    card.appendChild(opts);
    quest.steps.forEach((s, j) => card.appendChild(stepEditor(quest, s, j)));
    if (quest.steps.length < catalog.limits.steps) card.appendChild(button("+ Step", () => (quest.steps.push(step(quest.steps[quest.steps.length - 1].game)), render()), "ad-kit-add"));
    var own = text(quest.text, (v) => ((quest.text = v), changed()), { maxLength: 300, placeholder: "Own text for the players (optional - otherwise the line above)" });
    own.classList.add("ad-kit-own");
    card.appendChild(own);
    card.appendChild(rewardEditor(quest, quest.scope == "everyone" ? "Reward (for everybody who helped)" : "Reward"));
    return card;
  }

  function currencyEditor(c, i) {
    c.milestones = c.milestones || [];
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
        if (kit.teams && kit.teams.score == c.id) kit.teams.score = "goals";
        kit.shop = kit.shop.filter((o) => o.price.currency != c.id);
        kit.boosts.forEach((b) => b.currency == c.id && (b.currency = "all"));
        var drop = (r) => r && r.currencies && delete r.currencies[c.id];
        kit.quests.forEach((q) => drop(q.reward));
        kit.shop.forEach((o) => drop(o.reward));
        kit.currencies.forEach((other) => (other.milestones || []).forEach((m) => drop(m.reward)));
        render();
      }),
    );
    card.appendChild(head);
    if (c.earn && c.earn.on) {
      var line = playEditor(c.earn);
      line.append(labeled("For every", number(c.earn.per, (v) => ((c.earn.per = v), changed()), { min: 1, step: "any" })), labeled("give " + (c.icon || ""), number(c.earn.amount, (v) => ((c.earn.amount = v), changed()), { min: 1 })));
      card.appendChild(line);
      card.appendChild(whereEditor(c.earn));
      card.appendChild(said("currency", i));
    }
    // Milestones: a reward when this many were earned (a season pass)
    var list = make("div", "ad-kit-milestones");
    c.milestones.forEach((m, j) => {
      var row = make("div", "ad-kit-milestone");
      var top = make("div", "ad-kit-milestone-head");
      top.append(labeled("At " + (c.icon || ""), number(m.at, (v) => ((m.at = v), changed()), { min: 1 })), text(m.name, (v) => ((m.name = v), changed()), { maxLength: 40, placeholder: "Name, e.g. Level " + (j + 1) }), removeButton(() => (c.milestones.splice(j, 1), render())));
      row.append(top, rewardEditor(m, "Milestone reward"));
      list.appendChild(row);
    });
    if (c.milestones.length < catalog.limits.milestones) {
      list.appendChild(
        button("+ Milestone (season pass)", () => {
          var last = c.milestones[c.milestones.length - 1];
          c.milestones.push({ at: last ? Number(last.at) * 2 : 100, name: "Level " + (c.milestones.length + 1), reward: { coins: 1000, currencies: {}, items: [] } });
          render();
        }, "ad-kit-add"),
      );
    }
    card.appendChild(list);
    return card;
  }

  function boostEditor(b, i) {
    var card = make("div", "ad-kit-currency");
    var head = make("div", "ad-kit-quest-head");
    head.append(
      text(b.icon, (v) => ((b.icon = v), changed()), { className: "mm-input ad-kit-icon", maxLength: 8, ariaLabel: "Icon" }),
      text(b.name, (v) => ((b.name = v), changed()), { maxLength: 40, placeholder: "Name, e.g. Happy hour" }),
      select(Object.entries(BOOST_KINDS), b.kind, (v) => ((b.kind = v), v == "currencyX" && !b.currency && (b.currency = "all"), render()), "Kind"),
      removeButton(() => (kit.boosts.splice(i, 1), render())),
    );
    card.appendChild(head);
    var line = make("div", "ad-kit-play");
    var games = [["any", "Every game"], ["daily", "The game of the day"]].concat(seasonGames().map((g) => [g.id, g.name]));
    line.appendChild(select(games, b.game, (v) => ((b.game = v), changed()), "Game"));
    if (b.kind == "currencyX") line.appendChild(select([["all", "Every currency"]].concat(kit.currencies.map((c) => [c.id, c.icon + " " + c.name])), b.currency || "all", (v) => ((b.currency = v), changed()), "Currency"));
    line.appendChild(labeled("+ %", number(b.amount, (v) => ((b.amount = v), changed()), { min: 1, max: 1000 })));
    line.appendChild(select(Object.entries(BOOST_TIMES), b.when.type, (v) => ((b.when = defaultsWhen(v)), render()), "When"));
    card.appendChild(line);
    var w = b.when;
    var times = make("div", "ad-kit-play");
    if (w.type == "hours") {
      times.append(labeled("From", number(w.from, (v) => ((w.from = v), changed()), { min: 0, max: 24 })), labeled("to (h)", number(w.to, (v) => ((w.to = v), changed()), { min: 0, max: 24 })));
      var dayRow = make("div", "ad-kit-chips");
      DAYS.forEach((d, n) =>
        dayRow.appendChild(
          check(d, (w.days || []).includes(n), (on) => {
            w.days = on ? (w.days || []).concat([n]) : (w.days || []).filter((x) => x != n);
            changed();
          }),
        ),
      );
      times.appendChild(dayRow);
    } else if (w.type == "dates") {
      times.append(labeled("From", when(w.from, (v) => ((w.from = v), changed()), "From")), labeled("Until", when(w.to, (v) => ((w.to = v), changed()), "Until")));
    } else if (w.type == "golden") {
      times.append(labeled("Times a day", number(w.times, (v) => ((w.times = v), changed()), { min: 1, max: 24 })), labeled("Minutes each", number(w.minutes, (v) => ((w.minutes = v), changed()), { min: 1, max: 60 })));
    }
    if (times.children.length) card.appendChild(times);
    card.appendChild(said("boost", i));
    return card;
  }
  function defaultsWhen(type) {
    if (type == "hours") return { type: type, from: 20, to: 22, days: [0, 1, 2, 3, 4, 5, 6] };
    if (type == "dates") return { type: type, from: Date.now() + 86400000, to: Date.now() + 2 * 86400000 };
    if (type == "golden") return { type: type, times: 3, minutes: 2 };
    return { type: "always" };
  }

  function offerEditor(o, i) {
    var card = make("div", "ad-kit-currency");
    var head = make("div", "ad-kit-quest-head");
    head.append(
      text(o.icon, (v) => ((o.icon = v), changed()), { className: "mm-input ad-kit-icon", maxLength: 8, ariaLabel: "Icon" }),
      text(o.name, (v) => ((o.name = v), changed()), { maxLength: 40, placeholder: "Name, e.g. Coin bag" }),
      button("Copy", () => (kit.shop.splice(i + 1, 0, clone(Object.assign({}, o, { id: undefined }))), render())),
      removeButton(() => (kit.shop.splice(i, 1), render())),
    );
    card.appendChild(head);
    var line = make("div", "ad-kit-play");
    line.append(
      select(kit.currencies.map((c) => [c.id, c.icon + " " + c.name]), o.price.currency, (v) => ((o.price.currency = v), changed()), "Paid with"),
      labeled("Price", number(o.price.amount, (v) => ((o.price.amount = v), changed()), { min: 1 })),
      labeled("Per player (0: no limit)", number(o.limit || 0, (v) => ((o.limit = v || 0), changed()), { min: 0 })),
    );
    card.appendChild(line);
    card.appendChild(rewardEditor(o, "It gives"));
    return card;
  }

  function teamsEditor() {
    var box = make("div", "ad-kit-currency");
    var t = kit.teams;
    t.list.forEach((team, i) => {
      var row = make("div", "ad-kit-team");
      var color = Object.assign(make("input", "ad-color-input"), { type: "color", value: team.color || "#d4a64a" });
      color.addEventListener("input", () => ((team.color = color.value), changed()));
      row.append(text(team.icon, (v) => ((team.icon = v), changed()), { className: "mm-input ad-kit-icon", maxLength: 8 }), text(team.name, (v) => ((team.name = v), changed()), { maxLength: 20, placeholder: "Team name" }), color, t.list.length > 2 ? removeButton(() => (t.list.splice(i, 1), render())) : make("span"));
      box.appendChild(row);
    });
    if (t.list.length < catalog.limits.teams) box.appendChild(button("+ Team", () => (t.list.push({ id: newId("t"), name: "", icon: "🟢", color: "#3fbf7f" }), render()), "ad-kit-add"));
    box.appendChild(labeled("The team score counts", select(metrics(false), t.score, (v) => ((t.score = v), changed()), "Team score")));
    box.appendChild(rewardEditor(t, "Reward for every player of the best team at the end (items and badge)"));
    return box;
  }

  /* ---------- The whole sandbox ---------- */

  function render() {
    if (!root || !catalog) return;
    var scroll = window.scrollY;
    root.replaceChildren();

    var modes = section("Mode", "Starting points. Each one adds to what is there; everything stays editable below.");
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

    var currencies = section("Currencies", "Up to " + catalog.limits.currencies + " of the season's own, next to its coins. Goals give them, players earn them while playing, the shop takes them. Milestones turn one into a season pass.");
    kit.currencies.forEach((c, i) => currencies.appendChild(currencyEditor(c, i)));
    if (kit.currencies.length < catalog.limits.currencies) currencies.appendChild(button("+ Currency", () => (kit.currencies.push({ id: newId("c"), name: "", icon: "⭐", earn: null, milestones: [] }), render()), "ad-kit-add"));
    root.appendChild(currencies);

    var board = section("Leaderboard", "What the places of the season go by (and the prizes).");
    board.appendChild(select(metrics(true), kit.board, (v) => ((kit.board = v), changed()), "Leaderboard counts"));
    root.appendChild(board);

    var quests = section("Goals", "Steps one after the other; every step counts the plays of a game that match its conditions. Daily and weekly goals start over at midnight and on Monday.");
    kit.quests.forEach((q, i) => {
      // (an id right away: other goals can point at it)
      if (!q.id) q.id = newId("q");
      quests.appendChild(questEditor(q, i));
    });
    if (kit.quests.length < catalog.limits.quests) {
      var add = make("div", "ad-kit-chips");
      add.appendChild(make("span", "ad-label", "+ Goal"));
      TEMPLATES.forEach((t) => add.appendChild(button(t.label, () => (kit.quests.push(t.quest()), render()))));
      quests.appendChild(add);
    }
    root.appendChild(quests);

    var boosts = section("Boosts", "More coins on wins or more of a currency, all season, at set hours, between two dates or in golden minutes at random moments. Everybody in the season hears when one starts.");
    kit.boosts.forEach((b, i) => {
      if (!b.id) b.id = newId("b");
      boosts.appendChild(boostEditor(b, i));
    });
    if (kit.boosts.length < catalog.limits.boosts) {
      var addBoost = make("div", "ad-kit-chips");
      addBoost.appendChild(make("span", "ad-label", "+ Boost"));
      BOOSTS.forEach((t) => addBoost.appendChild(button(t.label, () => (kit.boosts.push(t.boost()), render()))));
      boosts.appendChild(addBoost);
    }
    root.appendChild(boosts);

    var shop = section("Shop", "Things the players buy with a currency of the season.");
    kit.shop.forEach((o, i) => shop.appendChild(offerEditor(o, i)));
    if (kit.currencies.length == 0) shop.appendChild(make("p", "ad-setting-hint", "Add a currency first."));
    else if (kit.shop.length < catalog.limits.offers) shop.appendChild(button("+ Offer", () => (kit.shop.push({ icon: "🛍️", name: "", price: { currency: kit.currencies[0].id, amount: 100 }, reward: { coins: 1000, currencies: {}, items: [] }, limit: 0 }), render()), "ad-kit-add"));
    root.appendChild(shop);

    var teams = section("Teams", "The players are split up when they first play. Their score shows next to the leaderboard.");
    teams.appendChild(
      check("Teams", kit.teams && kit.teams.on, (on) => {
        kit.teams = on ? kit.teams || { on: true, list: [{ id: "red", name: "Red", icon: "🔴", color: "#e05252" }, { id: "blue", name: "Blue", icon: "🔵", color: "#4f8cff" }], score: "goals", reward: { coins: 0, currencies: {}, items: [] } } : null;
        if (kit.teams) kit.teams.on = true;
        render();
      }),
    );
    if (kit.teams && kit.teams.on) teams.appendChild(teamsEditor());
    root.appendChild(teams);

    var rules = section("Rules");
    rules.appendChild(check("Players may give each other coins", kit.rules.gifts !== false, (v) => ((kit.rules.gifts = v), changed())));
    root.appendChild(rules);

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
        var show = (selector, key, list, own) =>
          root.querySelectorAll(selector).forEach((p) => {
            var i = p.dataset[key];
            p.innerText = "Players read: " + ((own && own(i)) || list[i] || "");
          });
        show("[data-quest]", "quest", data.quests, (i) => kit.quests[i] && kit.quests[i].text);
        show("[data-currency]", "currency", data.currencies);
        show("[data-boost]", "boost", data.boosts || []);
      } catch (error) {
        // (no preview - saving says what is wrong)
      }
    }, 350);
  }

  // What is saved (an empty badge: none)
  function value() {
    var out = clone(kit);
    var clean = (r) => r && r.badge && !(r.badge.name || "").trim() && !(r.badge.icon || "").trim() && (r.badge = null);
    out.quests.forEach((q) => clean(q.reward));
    out.shop.forEach((o) => clean(o.reward));
    out.currencies.forEach((c) => (c.milestones || []).forEach((m) => clean(m.reward)));
    if (out.teams) clean(out.teams.reward);
    return out;
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
      kit = Object.assign(empty(), saved ? clone(saved) : {});
      kit.currencies = kit.currencies || [];
      kit.quests = kit.quests || [];
      kit.boosts = kit.boosts || [];
      kit.shop = kit.shop || [];
      kit.rules = kit.rules || { gifts: true };
      kit.board = kit.board || "coins";
      render();
    },
    value: value,
  };
})();
