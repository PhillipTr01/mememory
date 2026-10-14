/* The dungeon (an RPG): the server runs the heroes, the parties and the card fights - this page shows them. */
const socket = io((window.CASINO_NS || "") + "/rpg");

var myName = null;
var myCoins = 0;
var rules = null;
var hero = null; // my hero (heroView of game/rpg.js)
var parties = []; // the open parties
var party = null; // my party (with its run) - null: none
var partyAt = 0; // when it came (its timeLeft counts from then)
var target = null; // the monster I aim at
var aiming = null; // a card of my hand waiting for its target: {uid, target: "foe" | "ally" | "fallen"}
var tab = "hero"; // the tab of the hero card
var FLOOR_KEY = "rpgFloor";
var SIZE_KEY = "rpgSize";
var floor = 1;
var size = 2;
try {
  floor = Number(localStorage.getItem(FLOOR_KEY)) || 1;
  size = Number(localStorage.getItem(SIZE_KEY)) || 2;
} catch (error) {
  // no storage: the defaults
}

var EFFECT_ICONS = { poison: "☠️", burn: "🔥", stun: "💫", chill: "❄️", rage: "😡", might: "📯" };
var EFFECT_NAMES = { poison: "Poisoned", burn: "Burning", stun: "Stunned - loses its next move", chill: "Chilled - half damage", rage: "Raging - more damage", might: "Might - 30% more damage" };
var RARITY_NAMES = { common: "Common", rare: "Rare", epic: "Epic", legendary: "Legendary" };
var SLOT_NAMES = { weapon: "Weapon", armor: "Armor", charm: "Charm" };
var ROMAN = ["I", "II", "III", "IV"];

// Used by chat.js
function chatUsername() {
  return myName;
}

function formatCoins(value) {
  return Number(value).toLocaleString("en-US");
}

function el(tag, className, text) {
  var element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.innerText = text;
  return element;
}

// A button that says what it does (data-act, data-id - the clicks are caught on the page, see below)
function button(text, act, options) {
  options = options || {};
  var b = el("button", "rpg-btn" + (options.className ? " " + options.className : ""), text);
  b.type = "button";
  b.dataset.act = act;
  if (options.id != null) b.dataset.id = options.id;
  if (options.disabled) b.disabled = true;
  if (options.title) b.title = options.title;
  return b;
}

function bar(value, max, className, extra) {
  var outer = el("div", "rpg-bar " + (className || ""));
  var inner = el("div", "rpg-bar-fill");
  inner.style.width = Math.max(0, Math.min(100, (value / max) * 100)) + "%";
  outer.append(inner, el("span", "rpg-bar-text", formatCoins(value) + " / " + formatCoins(max) + (extra || "")));
  return outer;
}

// A card (of the hand, a reward, the deck): the cost, the picture, the name, what it does
function cardEl(id, options) {
  options = options || {};
  var card = rules.cards[id];
  var node = el(options.tag || "div", "rpg-cardx type-" + card.type + (options.className ? " " + options.className : ""));
  if (options.act) {
    node.dataset.act = options.act;
    node.dataset.id = options.id != null ? options.id : id;
  }
  if (options.tag == "button") node.type = "button";
  if (options.disabled) node.classList.add("off");
  var cost = el("span", "rpg-cardx-cost");
  cost.dataset.cost = String(card.cost);
  cost.title = card.cost + " mana";
  node.append(cost, el("span", "rpg-cardx-art", card.icon), el("span", "rpg-cardx-name", card.name), el("span", "rpg-cardx-type", card.type == "attack" ? "Attack" : "Skill"), el("span", "rpg-cardx-text", card.text));
  return node;
}

/* ---------- Socket ---------- */

socket.on("connect", () => (document.getElementById("connectionBanner").hidden = true));
socket.on("disconnect", () => (document.getElementById("connectionBanner").hidden = false));
socket.on("connect_error", (error) => {
  if (error && error.message == "unauthorized") window.location.href = "/?next=" + encodeURIComponent(location.pathname + location.search);
  // (out of test mode: the dungeon isn't there - the page sends on)
  if (error && (error.message == "testMode" || error.message == "world")) window.location.reload();
});
socket.on("casinoClosed", () => window.location.reload());
window.addEventListener("pagehide", () => socket.disconnect());
window.addEventListener("pageshow", (event) => {
  if (event.persisted) socket.connect();
});

socket.on("joined", (data) => {
  myName = data.username;
  var spot = document.getElementById("rpgHeroAvatar");
  var avatar = createAvatar(myName, "lg");
  avatar.id = "rpgHeroAvatar";
  avatar.dataset.looksLive = "";
  spot.replaceWith(avatar);
});
socket.on("coins", (data) => {
  myCoins = data.coins;
  render();
});
socket.on("rpgError", (message) => showToast(message, "error"));
socket.on("rpgRules", (data) => {
  rules = data;
  render();
});
socket.on("rpgHero", (data) => {
  hero = data;
  render();
});
socket.on("rpgParties", (list) => {
  parties = list;
  render();
});
socket.on("rpgParty", (data) => {
  party = data;
  partyAt = Date.now();
  var run = party && party.run;
  if (!run || !run.monsters.some((m) => m.id == target && !m.down)) target = null;
  // (the card aimed with is gone - played, the turn over)
  var me = run && run.heroes.find((h) => h.name == myName);
  if (aiming && !(me && run.phase == "fight" && me.hand.some((c) => c.uid == aiming.uid))) aiming = null;
  render();
});

/* ---------- The page ---------- */

function render() {
  if (!rules || !hero) return;
  var home = party == null;
  var lobby = party != null && !party.started;
  document.getElementById("rpgHome").hidden = !home;
  document.getElementById("rpgLobby").hidden = !lobby;
  document.getElementById("rpgRun").hidden = home || lobby;
  if (home) {
    renderHero();
    renderDoor();
  } else if (lobby) renderLobby();
  else renderRun();
}

/* ---------- Home: the hero ---------- */

function statValue(id) {
  if (id == "hp") return hero.stats.maxHp + " HP";
  if (id == "luck" || id == "agi") return hero.stats[id] + "%";
  return String(hero.stats[id]);
}

// The gear's bonus in words
function bonusOf(item) {
  var parts = [];
  if (item.atk) parts.push("+" + item.atk + " attack");
  if (item.def) parts.push("+" + item.def + " defense");
  if (item.hp) parts.push("+" + item.hp + " HP");
  if (item.luck) parts.push("+" + item.luck + "% luck");
  return parts.join(" · ");
}

function itemCard(item, actions) {
  var card = el("div", "rpg-item rarity-" + item.rarity);
  card.append(el("span", "rpg-item-icon", item.icon));
  var text = el("div", "rpg-item-text");
  text.append(el("div", "rpg-item-name", item.name), el("div", "rpg-item-bonus", RARITY_NAMES[item.rarity] + " · " + bonusOf(item)));
  card.appendChild(text);
  if (actions && actions.length) {
    var row = el("div", "rpg-item-actions");
    actions.forEach((a) => row.appendChild(a));
    card.appendChild(row);
  }
  return card;
}

function renderHero() {
  var picked = !!hero.cls;
  var mine = rules.classes[hero.cls || "warrior"];
  document.getElementById("rpgHeroName").innerText = picked ? mine.icon + " " + mine.name : "Pick your hero";
  document.getElementById("rpgHeroSub").innerText = "Deepest floor " + hero.deepest + " · " + hero.cleared + " cleared of " + hero.runs + " runs";
  document.getElementById("rpgPotions").innerText = "🧪 " + hero.potions + " / " + rules.potionsMax;
  var buy = document.getElementById("rpgBuyPotion");
  buy.innerText = "+ 🪙 " + formatCoins(rules.potionPrice);
  buy.title = "A potion: heals 40% HP - in a fight or between the rooms";
  buy.disabled = hero.potions >= rules.potionsMax || myCoins < rules.potionPrice;

  document.querySelectorAll(".rpg-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab == tab));
  document.querySelectorAll(".rpg-pane").forEach((p) => (p.hidden = p.dataset.pane != tab));
  document.getElementById("rpgBagCount").innerText = hero.bag.length ? String(hero.bag.length) : "";

  // The hero: the class, the stats
  // The classes: every one a character of its own - the first free, the others to unlock
  var classes = Object.keys(rules.classes).map((id) => {
    var cls = rules.classes[id];
    var open = hero.unlocked.includes(id);
    var tile = el("button", "rpg-class" + (hero.cls == id ? " active" : "") + (open ? "" : " locked"));
    tile.type = "button";
    tile.dataset.act = open ? "class" : "unlock";
    tile.dataset.id = id;
    tile.title = cls.about;
    var char = hero.chars[id];
    tile.append(el("span", "rpg-class-icon", cls.icon), el("span", "rpg-class-name", cls.name), el("span", "rpg-class-note", open ? "Lv " + char.level + " · floor " + char.deepest : hero.classPrice ? "🔒 🪙 " + formatCoins(hero.classPrice) : "Free"));
    return tile;
  });
  morphChildren(document.getElementById("rpgClasses"), classes);
  morphChildren(document.getElementById("rpgClassInfo"), [
    el(
      "div",
      "rpg-class-about" + (picked ? "" : " first"),
      picked ? mine.about + " - every class is a character of its own: its own levels, gear and floors." : "Pick your first class - it's free. Every class is a character of its own (its own levels, gear and floors); the others can be unlocked later for 🪙 " + formatCoins(rules.classPrice) + ".",
    ),
  ]);
  document.getElementById("rpgStats").hidden = !picked;
  var stats = Object.keys(rules.stats).map((id) => {
    var stat = rules.stats[id];
    var cost = hero.upgrades[id];
    // (the main stat of the class: its levels count more)
    var main = mine.main == id;
    var row = el("div", "rpg-stat" + (main ? " main" : ""));
    var name = el("div", "rpg-stat-name");
    name.append(el("span", "rpg-stat-icon", stat.icon), el("span", "", stat.name), el("span", "rpg-stat-level", "Lv " + hero.levels[id]));
    if (main) {
      var star = el("span", "rpg-stat-main", "★ " + mine.name);
      star.title = "The main stat of your class: its levels count " + rules.mainBonus + "x";
      name.appendChild(star);
    }
    row.append(name, el("div", "rpg-stat-value", statValue(id)));
    row.appendChild(cost == null ? el("span", "rpg-stat-max mm-muted", "Max") : button("+ 🪙 " + formatCoins(cost), "upgrade", { id: id, className: "small", disabled: cost > myCoins, title: stat.about }));
    return row;
  });
  morphChildren(document.getElementById("rpgStats"), stats);

  // Gear
  var gear = Object.keys(SLOT_NAMES).map((slot) => {
    var item = hero.gear[slot];
    if (!item) {
      var empty = el("div", "rpg-item empty");
      empty.append(el("span", "rpg-item-icon", "·"), el("div", "rpg-item-text mm-muted", SLOT_NAMES[slot] + ": nothing"));
      return empty;
    }
    return itemCard(item, [button("Take off", "unequip", { id: slot, className: "small" })]);
  });
  morphChildren(document.getElementById("rpgGear"), gear);
  var bag = hero.bag.length
    ? hero.bag.map((item) => itemCard(item, [button("Equip", "equip", { id: item.id, className: "small" }), button("Sell 🪙 " + formatCoins(item.value), "sell", { id: item.id, className: "small" })]))
    : [el("div", "rpg-empty mm-muted", "Empty - chests in the dungeon drop gear (" + rules.bagMax + " fit).")];
  morphChildren(document.getElementById("rpgBag"), bag);

  // The deck: the class's starter deck, the cards to win
  var deck = ["strike", "defend"].concat(mine.signature);
  morphChildren(document.getElementById("rpgDeckHelp"), deckHelp());
  var counts = { strike: 4, defend: 4 };
  document.getElementById("rpgDeckCount").innerText = String(8 + mine.signature.length);
  morphChildren(
    document.getElementById("rpgDeck"),
    deck.map((id) => {
      var card = cardEl(id, { className: "small" });
      if (counts[id]) card.appendChild(el("span", "rpg-cardx-count", "×" + counts[id]));
      return card;
    }),
  );
  var pool = mine.cards.filter((id) => !mine.signature.includes(id)).concat(["focus", "secondwind", "adrenaline", "quickslash"]);
  morphChildren(
    document.getElementById("rpgPool"),
    pool.map((id) => cardEl(id, { className: "small" })),
  );
}

function renderDoor() {
  floor = Math.max(1, Math.min(hero.maxFloor, floor));
  var entry = rules.entries[floor - 1];
  document.getElementById("rpgFloor").innerText = "Floor " + floor;
  document.getElementById("rpgFloorInfo").innerText = "Entry 🪙 " + formatCoins(entry) + " each · " + (floor <= hero.deepest ? "cleared ✓" : "new");
  document.getElementById("rpgFloorDown").disabled = floor <= 1;
  document.getElementById("rpgFloorUp").disabled = floor >= hero.maxFloor;
  document.getElementById("rpgSolo").disabled = myCoins < entry || !hero.cls;
  document.getElementById("rpgOpen").disabled = !hero.cls;
  var sizes = [];
  for (var n = 2; n <= rules.partyMax; n++) sizes.push(button(n + " heroes", "size", { id: n, className: "chip" + (n == size ? " active" : "") }));
  morphChildren(document.getElementById("rpgSize"), sizes);

  var list = parties.length
    ? parties.map((p) => {
        var row = el("div", "rpg-party");
        var faces = el("div", "rpg-party-faces");
        p.members.forEach((name) => faces.appendChild(createAvatar(name, "sm")));
        var text = el("div", "rpg-party-text");
        text.append(el("div", "rpg-party-name", p.leader + "'s party"), el("div", "mm-muted small", "Floor " + p.floor + " · " + p.members.length + " / " + p.size + " heroes"));
        row.append(faces, text);
        if (p.started) row.appendChild(el("span", "mm-muted small", "in the dungeon"));
        else if (p.floor > hero.maxFloor) row.appendChild(el("span", "mm-muted small", "floor not open"));
        else row.appendChild(button("Join", "join", { id: p.id, className: "small", disabled: p.members.length >= p.size }));
        return row;
      })
    : [el("div", "rpg-empty mm-muted", "No party open - open one, or go alone.")];
  morphChildren(document.getElementById("rpgParties"), list);
}

function renderLobby() {
  document.getElementById("rpgLobbyTitle").innerText = party.leader + "'s party · Floor " + party.floor + " · entry 🪙 " + formatCoins(party.entry) + " each";
  var seats = [];
  for (var i = 0; i < party.size; i++) {
    var name = party.members[i];
    var seat = el("div", "rpg-seat" + (name ? "" : " empty"));
    if (name) seat.append(createAvatar(name, "lg"), el("div", "rpg-seat-name", (name == party.leader ? "👑 " : "") + name));
    else seat.append(el("div", "rpg-seat-free", "?"), el("div", "rpg-seat-name mm-muted", "free"));
    seats.push(seat);
  }
  morphChildren(document.getElementById("rpgLobbySeats"), seats);
  var leader = party.leader == myName;
  var start = document.getElementById("rpgStart");
  start.hidden = !leader;
  start.innerText = party.members.length < party.size ? "Start with " + party.members.length : "Start";
  document.getElementById("rpgLobbyNote").innerText = leader ? "Start when you like - every hero pays the entry then." : "Waiting for " + party.leader + " to start.";
}

/* ---------- A run ---------- */

function effectsRow(effects) {
  var row = el("div", "rpg-effects");
  Object.keys(effects).forEach((kind) => {
    var chip = el("span", "rpg-effect " + kind, EFFECT_ICONS[kind] + (effects[kind] > 1 ? " " + effects[kind] : ""));
    chip.title = EFFECT_NAMES[kind];
    row.appendChild(chip);
  });
  return row;
}

// What a monster does next: a badge over it
function intentBadge(m) {
  var move = rules.moves[m.intent.move];
  var badge = el("div", "rpg-intent move-" + m.intent.move + (m.intent.stunned ? " stunned" : ""));
  var text = move.icon + " ";
  if (m.intent.stunned) text = "💫 stunned";
  else if (m.intent.damage) text += m.intent.damage + (move.all ? " to all" : m.intent.target ? " → " + m.intent.target : "");
  else text += move.name;
  badge.innerText = text;
  badge.title = m.intent.stunned ? "Stunned - it loses this move" : move.name + (m.intent.target ? " on " + m.intent.target : "");
  if (m.intent.target == myName && m.intent.damage && !m.intent.stunned) badge.classList.add("at-me");
  return badge;
}

function renderRun() {
  var run = party.run;
  var me = run.heroes.find((h) => h.name == myName);
  document.getElementById("rpgRunFloor").innerText = "Floor " + run.floor;
  document.getElementById("rpgPot").innerText = "🪙 " + formatCoins(run.pot) + " each";

  // The rooms of the floor: the ones gone through, the rest dark - the last the guarded gate
  var track = [];
  for (var i = 0; i < rules.rooms; i++) {
    var room = run.rooms[i];
    var last = i == rules.rooms - 1;
    var kind = room ? room.kind : last ? "elite" : null;
    var dot = el("span", "rpg-room" + (room && room.done ? " done" : "") + (room && !room.done ? " now" : "") + (!room ? " dark" : ""), kind ? rules.roomKinds[kind].icon : "");
    dot.title = "Room " + (i + 1) + ": " + (kind ? rules.roomKinds[kind].name : "behind a door");
    track.push(dot);
  }
  morphChildren(document.getElementById("rpgTrack"), track);

  var fighting = run.phase == "fight";
  var arena = document.querySelector(".rpg-arena");
  arena.classList.toggle("aiming-foe", !!aiming && aiming.target == "foe");
  arena.classList.toggle("aiming-ally", !!aiming && (aiming.target == "ally" || aiming.target == "fallen"));

  // Between the rooms: the card won in the last fight - or what happened in the last room (the merchant: his pack)
  var reward = document.getElementById("rpgReward");
  var panel = run.phase == "between" ? (me && me.reward ? rewardPanel(me) : run.event ? eventPanel(run, me) : null) : null;
  reward.hidden = !panel;
  if (panel) morphChildren(reward, panel);

  var scene;
  if (fighting) {
    scene = run.monsters.map((m) => {
      var card = el("div", "rpg-monster rank-" + m.rank + (m.down ? " down" : "") + (m.id == target ? " target" : ""));
      card.dataset.act = m.down ? "" : "target";
      card.dataset.id = m.id;
      if (m.intent) card.appendChild(intentBadge(m));
      card.append(el("div", "rpg-monster-icon", m.icon), el("div", "rpg-monster-name", m.name + (m.undead ? " 🦴" : "")), bar(m.hp, m.maxHp, "foe"), effectsRow(m.effects));
      return card;
    });
  } else if (run.phase == "between") scene = doorCards(run);
  else scene = [el("div", "rpg-quiet", sceneText(run))];
  morphChildren(document.getElementById("rpgMonsters"), scene);

  var heroes = run.heroes.map((h) => {
    var cls = rules.classes[h.cls] || { icon: "" };
    var card = el("div", "rpg-fighter" + (h.down ? " down" : "") + (h.name == myName ? " me" : ""));
    card.dataset.act = "ally";
    card.dataset.id = h.name;
    var state = h.down ? "💤" : fighting ? (h.ended ? "✓" : "…") : "";
    var head = el("div", "rpg-fighter-head");
    head.append(createAvatar(h.name, "sm"), el("span", "rpg-fighter-name", (h.name == party.leader ? "👑 " : "") + h.name), el("span", "rpg-fighter-state", state));
    var info = el("div", "rpg-fighter-info mm-muted small");
    info.append(el("span", "", cls.icon + " " + (rules.classes[h.cls] || {}).name), el("span", "", "🧪 " + h.potions + (h.blessed ? " · ⛩️" : "")));
    var hp = bar(h.hp, h.maxHp, "hero");
    if (h.block > 0) hp.appendChild(el("span", "rpg-block", "🛡️ " + h.block));
    card.append(head, hp, effectsRow(h.effects), info);
    return card;
  });
  morphChildren(document.getElementById("rpgHeroes"), heroes);

  morphChildren(document.getElementById("rpgHandBar"), handBar(run, me));

  if (me) {
    document.getElementById("rpgRunDeckCount").innerText = me.deck.length + " cards";
    var counts = {};
    me.deck.forEach((id) => (counts[id] = (counts[id] || 0) + 1));
    morphChildren(
      document.getElementById("rpgRunDeck"),
      Object.keys(counts).map((id) => {
        var card = cardEl(id, { className: "small" });
        if (counts[id] > 1) card.appendChild(el("span", "rpg-cardx-count", "×" + counts[id]));
        return card;
      }),
    );
  }

  var log = document.getElementById("rpgLog");
  morphChildren(
    log,
    run.log.slice(-20).map((line) => el("li", "", line)),
  );
  log.scrollTop = log.scrollHeight;
}

// The card won in a fight: one of three for the deck
function rewardPanel(me) {
  var cards = el("div", "rpg-reward-cards");
  me.reward.forEach((id) => cards.appendChild(cardEl(id, { tag: "button", act: "pick", className: "pickable" })));
  return [el("div", "rpg-reward-title", "Victory - pick a card for your deck"), el("div", "rpg-reward-note mm-muted small", "It goes into your deck for the rest of this run - you may draw it in the next fights."), cards, button("Skip", "pick", { id: "", className: "small" })];
}

// What happened in the last room (a chest, a camp fire, a shrine, a trap) - the merchant: what he sells
function eventPanel(run, me) {
  var kind = rules.roomKinds[run.event.kind];
  var nodes = [el("div", "rpg-reward-title", kind.icon + " " + kind.name)];
  var lines = el("ul", "rpg-event-lines");
  run.event.lines.forEach((line) => lines.appendChild(el("li", "", line)));
  nodes.push(lines);
  var offer = run.event.offers && me && run.event.offers[myName];
  if (offer) {
    var prices = run.event.prices;
    var wares = el("div", "rpg-reward-cards");
    offer.cards.forEach((id) => {
      var sold = offer.bought.includes(id);
      var card = cardEl(id, { tag: "button", act: sold ? "" : "buy", className: "pickable" + (sold ? " off" : "") });
      card.appendChild(el("span", "rpg-price", sold ? "Sold ✓" : "🪙 " + formatCoins(prices.card)));
      wares.appendChild(card);
    });
    nodes.push(wares, button("🧪 A potion · 🪙 " + formatCoins(prices.potion) + " (" + me.potions + "/" + rules.potionsMax + ")", "buy", { id: "potion", className: "small", disabled: me.potions >= rules.potionsMax || myCoins < prices.potion }));
  }
  return nodes;
}

// How the cards work (the Deck tab)
function deckHelp() {
  var steps = [
    ["🃏", "Your deck", "Every run starts with this deck of 10 cards. Shuffled at the start of every fight."],
    ["✋", "A turn", "You draw 5 cards and get 3 💧 mana. A card costs the mana in its drop (top left)."],
    ["⚔️", "Play", "Attacks hit a foe (click the card, then the foe), skills block, heal or help. Block only lasts through the monsters' turn."],
    ["⏭️", "End turn", "The cards you didn't play go to the discard pile; the monsters do what their badges showed. An empty draw pile: the discard pile is shuffled in."],
    ["🎁", "Grow it", "Every fight won: pick one of three new cards (or buy one at a merchant) - for the rest of that run."],
  ];
  return steps.map(([icon, title, text]) => {
    var row = el("div", "rpg-help-step");
    var body = el("div", "");
    body.append(el("b", "", title), el("div", "mm-muted small", text));
    row.append(el("span", "rpg-help-icon", icon), body);
    return row;
  });
}

// The doors to the next room: closed - only a lucky hero senses danger or calm behind one; everybody votes
function doorCards(run) {
  var mine = run.votes[myName];
  return run.doors.map((door, i) => {
    var node = el("div", "rpg-door-card" + (door.open ? " open kind-" + door.kind : "") + (mine === i ? " voted" : ""));
    node.dataset.act = "vote";
    node.dataset.id = i;
    var art = el("div", "rpg-door-art");
    art.appendChild(el("span", "rpg-door-mark", door.open ? rules.roomKinds[door.kind].icon : ROMAN[i] || String(i + 1)));
    node.append(art, el("div", "rpg-door-name", door.open ? rules.roomKinds[door.kind].name : "Door " + (ROMAN[i] || i + 1)));
    var feeling = door.open ? rules.roomKinds[door.kind].about : door.sense == "danger" ? "⚠️ You sense danger" : door.sense == "calm" ? "🕊️ It feels calm" : "❔ You sense nothing";
    node.appendChild(el("div", "rpg-door-hint " + (door.open ? "open" : door.sense || "none"), feeling));
    var voters = el("div", "rpg-voters");
    Object.keys(run.votes)
      .filter((name) => run.votes[name] === i)
      .forEach((name) => voters.appendChild(createAvatar(name, "sm")));
    node.appendChild(voters);
    return node;
  });
}

function sceneText(run) {
  if (run.phase == "won") return "🎉 Floor " + run.floor + " cleared!";
  if (run.phase == "lost") return "💀 The party fell - the loot is lost.";
  if (run.phase == "left") return "🚪 You left the dungeon with the loot.";
  return "";
}

// The bar under the scene: the hand in a fight, the vote between the rooms, the result at the end
function handBar(run, me) {
  if (party.result) {
    var box = el("div", "rpg-result");
    var loot = party.result == "lost" ? [] : run.loot[myName] || [];
    box.append(el("div", "rpg-result-title", party.result == "lost" ? "💀 Lost" : party.result == "won" ? "🎉 Cleared - 🪙 " + formatCoins(run.pot) + " for you" : "🚪 Left - 🪙 " + formatCoins(run.pot) + " for you"));
    if (loot.length) {
      var list = el("div", "rpg-result-loot");
      loot.forEach((item) => list.appendChild(itemCard(item)));
      box.appendChild(list);
    }
    box.appendChild(button("Back", "leave", { className: "primary" }));
    return [box];
  }
  var potion = button("🧪 " + (me ? me.potions : 0), "drink", { className: "rpg-potion-btn", disabled: !me || me.down || me.potions <= 0 || me.hp >= me.maxHp, title: "Drink a potion: 40% HP (no energy)" });
  if (run.phase == "between") {
    var voted = run.votes[myName];
    var count = Object.keys(run.votes).length;
    var leave = button("🚪 Leave with 🪙 " + formatCoins(run.pot), "vote", { id: "leave", className: voted === "leave" ? "voted" : "" });
    var leavers = Object.keys(run.votes).filter((name) => run.votes[name] === "leave");
    if (leavers.length) leave.innerText += " (" + leavers.length + ")";
    var text = (run.heroes.length > 1 ? "Vote for a door - " + count + " / " + run.heroes.length + " voted" + (party.leader == myName ? "" : " (a tie: " + party.leader + " decides)") : "Pick a door") + (run.doors.length > 1 ? " · 🍀 your party senses a door " + run.sense + "% of the time" : "");
    return [potion, el("div", "rpg-wait mm-muted", text), leave];
  }
  if (!me || me.down) return [el("div", "rpg-wait mm-muted", "💤 You're down - back up after the fight (or a Cleric's revive).")];
  var energy = el("div", "rpg-energy");
  energy.dataset.mana = me.energy + "/" + rules.energy;
  energy.title = "Mana - cards cost it, full again every turn";
  var draw = el("div", "rpg-pile", "🂠 " + me.drawCount);
  draw.title = "Draw pile";
  var left = el("div", "rpg-hand-side");
  left.append(energy, draw);
  var hand = el("div", "rpg-hand" + (me.ended ? " ended" : ""));
  me.hand.forEach((c, i) => {
    var card = rules.cards[c.id];
    var node = cardEl(c.id, { tag: "button", act: "card", id: c.uid, disabled: me.ended || card.cost > me.energy, className: aiming && aiming.uid == c.uid ? "aimed" : "" });
    // (fanned a little)
    var mid = (me.hand.length - 1) / 2;
    node.style.setProperty("--tilt", (i - mid) * 3 + "deg");
    node.style.setProperty("--lift", Math.abs(i - mid) * 4 + "px");
    hand.appendChild(node);
  });
  if (!me.hand.length) hand.appendChild(el("div", "rpg-wait mm-muted", "No cards left"));
  var waiting = run.heroes.filter((h) => !h.down && !h.ended).length;
  var end = button(me.ended ? "Waiting… (" + waiting + ")" : "End turn", "endTurn", { className: "primary rpg-end", disabled: me.ended });
  var discard = el("div", "rpg-pile", "♻ " + me.discardCount);
  discard.title = "Discard pile - shuffled back when the draw pile is empty";
  var right = el("div", "rpg-hand-side");
  right.append(end, potion, discard);
  var nodes = [left, hand, right];
  if (aiming) nodes.unshift(el("div", "rpg-aim-hint", aiming.target == "foe" ? "🎯 Click a foe - or the card again to cancel" : "🎯 Click a hero - or the card again to cancel"));
  return nodes;
}

// The time of the turn / the vote, running down
function tick() {
  var timer = document.getElementById("rpgTimer");
  if (party && party.run && !party.result && party.timeLeft != null) {
    var total = party.run.phase == "fight" ? rules.turn : rules.decide;
    var left = Math.max(0, party.timeLeft - (Date.now() - partyAt));
    timer.style.width = (left / total) * 100 + "%";
  } else timer.style.width = "0%";
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

/* ---------- Clicks ---------- */

// A card of the hand clicked: played right away - or (it needs a target) aimed first
function clickCard(uid) {
  var run = party && party.run;
  var me = run && run.heroes.find((h) => h.name == myName);
  if (!me) return;
  if (aiming && aiming.uid == uid) {
    aiming = null;
    return render();
  }
  var entry = me.hand.find((c) => c.uid == uid);
  if (!entry) return;
  var card = rules.cards[entry.id];
  if (card.cost > me.energy || me.ended) return;
  var foes = run.monsters.filter((m) => !m.down);
  var standing = run.heroes.filter((h) => !h.down);
  var fallen = run.heroes.filter((h) => h.down);
  if (card.target == "foe") {
    var aimed = foes.find((m) => m.id == target) || (foes.length == 1 ? foes[0] : null);
    if (aimed) return socket.emit("play", { uid: uid, target: aimed.id });
  } else if (card.target == "ally") {
    if (standing.length == 1) return socket.emit("play", { uid: uid, ally: myName });
  } else if (card.target == "fallen") {
    if (fallen.length == 1) return socket.emit("play", { uid: uid, ally: fallen[0].name });
    if (!fallen.length) return showToast("Nobody to bring back.", "error");
  } else return socket.emit("play", { uid: uid });
  aiming = { uid: uid, target: card.target };
  render();
}

document.querySelector(".rpg-main").addEventListener("click", (event) => {
  var node = event.target.closest("[data-act], [data-tab]");
  if (!node || node.disabled) return;
  if (node.dataset.tab) {
    tab = node.dataset.tab;
    return render();
  }
  var act = node.dataset.act;
  var id = node.dataset.id;
  if (!act) return;
  if (act == "upgrade") socket.emit("upgrade", { stat: id });
  else if (act == "equip" || act == "sell") socket.emit(act, { id: id });
  else if (act == "unequip") socket.emit("unequip", { slot: id });
  else if (act == "join") socket.emit("join", { id: id });
  else if (act == "leave") socket.emit("leave");
  else if (act == "class") socket.emit("class", { id: id });
  else if (act == "unlock") unlockClass(id); else if (act == "buy") socket.emit("buy", { item: id });
  else if (act == "size") {
    size = Number(id);
    remember(SIZE_KEY, size);
    render();
  } else if (act == "card") clickCard(id);
  else if (act == "target") {
    if (aiming && aiming.target == "foe") {
      socket.emit("play", { uid: aiming.uid, target: id });
      aiming = null;
    } else target = id;
    render();
  } else if (act == "ally") {
    if (aiming && aiming.target != "foe") {
      socket.emit("play", { uid: aiming.uid, ally: id });
      aiming = null;
      render();
    }
  } else if (act == "endTurn") {
    aiming = null;
    socket.emit("endTurn");
  } else if (act == "drink") socket.emit("drink");
  else if (act == "pick") socket.emit("pick", { card: id || null });
  else if (act == "vote") socket.emit("vote", { door: id == "leave" ? "leave" : Number(id) });
});

document.addEventListener("keydown", (event) => {
  if (event.key == "Escape" && aiming) {
    aiming = null;
    render();
  }
});

// A class unlocked: the first one free - every other one after asking (the casino's dialog)
async function unlockClass(id) {
  var cls = rules.classes[id];
  var price = hero.classPrice;
  if (price) {
    var sure = await confirmDialog({
      title: "Unlock the " + cls.icon + " " + cls.name + "?",
      text: "🪙 " + formatCoins(price) + " - a new character with its own levels, gear and floors. " + cls.about + ".",
      confirmLabel: "Unlock for 🪙 " + formatCoins(price),
    });
    if (!sure) return;
  }
  socket.emit("unlock", { id: id });
}

function remember(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch (error) {
    // not remembered
  }
}

document.getElementById("rpgFloorDown").addEventListener("click", () => {
  floor--;
  remember(FLOOR_KEY, floor);
  render();
});
document.getElementById("rpgFloorUp").addEventListener("click", () => {
  floor++;
  remember(FLOOR_KEY, floor);
  render();
});
document.getElementById("rpgSolo").addEventListener("click", () => socket.emit("create", { floor: floor, size: 1 }));
document.getElementById("rpgOpen").addEventListener("click", () => socket.emit("create", { floor: floor, size: size }));
document.getElementById("rpgBuyPotion").addEventListener("click", () => socket.emit("potion"));
document.getElementById("rpgStart").addEventListener("click", () => socket.emit("start"));
document.getElementById("rpgLeave").addEventListener("click", () => socket.emit("leave"));
