/* The dungeon (an RPG): the server runs the heroes, the parties and the fights - this page shows them. */
const socket = io((window.CASINO_NS || "") + "/rpg");

var myName = null;
var myCoins = 0;
var rules = null;
var hero = null; // my hero (heroView of game/rpg.js)
var parties = []; // the open parties
var party = null; // my party (with its run) - null: none
var partyAt = 0; // when it came (its timeLeft counts from then)
var target = null; // the monster I aim at
var ally = null; // the hero my heals and shields go to (null: myself)
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

var EFFECT_ICONS = { poison: "☠️", burn: "🔥", stun: "💫", chill: "❄️", shield: "🔰", rage: "😡" };
var EFFECT_NAMES = { poison: "Poisoned", burn: "Burning", stun: "Stunned - loses its next move", chill: "Chilled - half damage", shield: "Shield", rage: "Raging - more damage" };
var RARITY_NAMES = { common: "Common", rare: "Rare", epic: "Epic", legendary: "Legendary" };
var SLOT_NAMES = { weapon: "Weapon", armor: "Armor", charm: "Charm" };

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

function bar(value, max, className) {
  var outer = el("div", "rpg-bar " + (className || ""));
  var inner = el("div", "rpg-bar-fill");
  inner.style.width = Math.max(0, Math.min(100, (value / max) * 100)) + "%";
  outer.append(inner, el("span", "rpg-bar-text", formatCoins(value) + " / " + formatCoins(max)));
  return outer;
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
  if (!party || !party.run || !party.run.monsters.some((m) => m.id == target && !m.down)) target = null;
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

function statValue(id) {
  if (id == "hp") return hero.stats.maxHp + " HP";
  if (id == "luck") return hero.stats.luck + "%";
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
  var classes = Object.keys(rules.classes).map((id) => {
    var cls = rules.classes[id];
    var tile = el("button", "rpg-class" + (hero.cls == id ? " active" : ""));
    tile.type = "button";
    tile.dataset.act = "class";
    tile.dataset.id = id;
    tile.title = cls.about + "\n" + cls.skills.map((s) => rules.skills[s].icon + " " + rules.skills[s].name + " (" + rules.skills[s].cost + "⚡): " + rules.skills[s].about).join("\n");
    tile.append(el("span", "rpg-class-icon", cls.icon), el("span", "rpg-class-name", cls.name));
    return tile;
  });
  morphChildren(document.getElementById("rpgClasses"), classes);
  var mine = rules.classes[hero.cls];
  morphChildren(
    document.getElementById("rpgClassInfo"),
    [el("div", "rpg-class-about", mine.about)].concat(mine.skills.map((id) => {
      var skill = rules.skills[id];
      var row = el("div", "rpg-skill-row");
      row.append(el("span", "rpg-skill-icon", skill.icon), el("b", "", skill.name), el("span", "rpg-energy-cost", skill.cost + "⚡"), el("span", "mm-muted", skill.about));
      return row;
    })),
  );
  document.getElementById("rpgHeroSub").innerText = "Deepest floor " + hero.deepest + " · " + hero.cleared + " cleared of " + hero.runs + " runs";
  var stats = Object.keys(rules.stats).map((id) => {
    var stat = rules.stats[id];
    var cost = hero.upgrades[id];
    var row = el("div", "rpg-stat");
    var name = el("div", "rpg-stat-name");
    name.append(el("span", "rpg-stat-icon", stat.icon), el("span", "", stat.name), el("span", "rpg-stat-level", "Lv " + hero.levels[id]));
    row.append(name, el("div", "rpg-stat-value", statValue(id)));
    row.appendChild(
      cost == null
        ? el("span", "rpg-stat-max mm-muted", "Max")
        : button("+ 🪙 " + formatCoins(cost), "upgrade", { id: id, className: "small", disabled: cost > myCoins, title: stat.about }),
    );
    return row;
  });
  morphChildren(document.getElementById("rpgStats"), stats);

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

  document.getElementById("rpgBagCount").innerText = hero.bag.length + " / " + rules.bagMax;
  var bag = hero.bag.length
    ? hero.bag.map((item) => itemCard(item, [button("Equip", "equip", { id: item.id, className: "small" }), button("Sell 🪙 " + formatCoins(item.value), "sell", { id: item.id, className: "small" })]))
    : [el("div", "rpg-empty mm-muted", "Empty - chests in the dungeon drop gear.")];
  morphChildren(document.getElementById("rpgBag"), bag);

  document.getElementById("rpgPotions").innerText = "🧪 Potions " + hero.potions + " / " + rules.potionsMax;
  var buy = document.getElementById("rpgBuyPotion");
  buy.innerText = "Buy · 🪙 " + formatCoins(rules.potionPrice);
  buy.disabled = hero.potions >= rules.potionsMax || myCoins < rules.potionPrice;
}

function renderDoor() {
  floor = Math.max(1, Math.min(hero.maxFloor, floor));
  var entry = rules.entries[floor - 1];
  document.getElementById("rpgFloor").innerText = "Floor " + floor;
  document.getElementById("rpgFloorInfo").innerText = "Entry 🪙 " + formatCoins(entry) + " each · " + (floor <= hero.deepest ? "cleared ✓" : "new");
  document.getElementById("rpgFloorDown").disabled = floor <= 1;
  document.getElementById("rpgFloorUp").disabled = floor >= hero.maxFloor;
  document.getElementById("rpgSolo").disabled = myCoins < entry;
  var sizes = [];
  for (var n = 2; n <= rules.partyMax; n++) {
    var chip = button(n + " heroes", "size", { id: n, className: "chip" + (n == size ? " active" : "") });
    sizes.push(chip);
  }
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
    if (name) {
      seat.append(createAvatar(name, "lg"), el("div", "rpg-seat-name", (name == party.leader ? "👑 " : "") + name));
    } else seat.append(el("div", "rpg-seat-free", "?"), el("div", "rpg-seat-name mm-muted", "free"));
    seats.push(seat);
  }
  morphChildren(document.getElementById("rpgLobbySeats"), seats);
  var leader = party.leader == myName;
  var start = document.getElementById("rpgStart");
  start.hidden = !leader;
  start.innerText = party.members.length < party.size ? "Start with " + party.members.length : "Start";
  document.getElementById("rpgLobbyNote").innerText = leader ? "Start when you like - every hero pays the entry then." : "Waiting for " + party.leader + " to start.";
}

function effectsRow(effects) {
  var row = el("div", "rpg-effects");
  Object.keys(effects).forEach((kind) => {
    var chip = el("span", "rpg-effect " + kind, EFFECT_ICONS[kind] + (effects[kind] > 1 || kind == "shield" ? " " + effects[kind] : ""));
    chip.title = EFFECT_NAMES[kind];
    row.appendChild(chip);
  });
  return row;
}

function energyPips(energy) {
  var pips = el("span", "rpg-pips");
  for (var i = 0; i < rules.energyMax; i++) pips.appendChild(el("span", "rpg-pip" + (i < energy ? " on" : "")));
  pips.title = energy + " energy";
  return pips;
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
  if (ally && !run.heroes.some((h) => h.name == ally)) ally = null;
  document.getElementById("rpgRunFloor").innerText = "Floor " + run.floor;
  document.getElementById("rpgPot").innerText = "Loot 🪙 " + formatCoins(run.pot) + " each";

  var track = [];
  for (var i = 0; i < rules.rooms; i++) {
    var room = run.rooms[i];
    var last = i == rules.rooms - 1;
    var kind = room ? room.kind : last ? "elite" : null;
    var dot = el("span", "rpg-room" + (room && room.done ? " done" : "") + (room && !room.done ? " now" : ""), kind ? rules.roomKinds[kind].icon : "·");
    dot.title = "Room " + (i + 1) + ": " + (kind ? rules.roomKinds[kind].name : "?");
    track.push(dot);
  }
  morphChildren(document.getElementById("rpgTrack"), track);

  var fighting = run.phase == "fight";
  var scene;
  if (fighting) {
    scene = run.monsters.map((m) => {
      var card = el("div", "rpg-monster rank-" + m.rank + (m.down ? " down" : "") + (m.id == target ? " target" : ""));
      card.dataset.act = m.down ? "" : "target";
      card.dataset.id = m.id;
      if (m.intent) card.appendChild(intentBadge(m));
      card.append(el("div", "rpg-monster-icon", m.icon), el("div", "rpg-monster-name", m.name + (m.undead ? " 🦴" : "")), bar(m.hp, m.maxHp, "foe"), effectsRow(m.effects), el("div", "rpg-monster-atk mm-muted small", "⚔️ " + m.atk));
      return card;
    });
  } else if (run.phase == "between") scene = doorCards(run);
  else scene = [el("div", "rpg-quiet", sceneText(run))];
  morphChildren(document.getElementById("rpgMonsters"), scene);

  var heroes = run.heroes.map((h) => {
    var cls = rules.classes[h.cls] || { icon: "" };
    var picked = h.name == (ally || myName) && fighting;
    var card = el("div", "rpg-fighter" + (h.down ? " down" : "") + (h.name == myName ? " me" : "") + (picked ? " ally" : ""));
    card.dataset.act = "ally";
    card.dataset.id = h.name;
    var state = h.down ? "💤" : fighting ? (h.chose ? "✓" : "…") : "";
    var head = el("div", "rpg-fighter-head");
    head.append(createAvatar(h.name, "sm"), el("span", "rpg-fighter-name", (h.name == party.leader ? "👑 " : "") + h.name), el("span", "rpg-fighter-state", state));
    var info = el("div", "rpg-fighter-info mm-muted small");
    info.append(el("span", "", cls.icon + " · ⚔️ " + h.atk + " · 🛡️ " + h.def + " · 🧪 " + h.potions + (h.blessed ? " · ⛩️" : "")), energyPips(h.energy));
    card.append(head, bar(h.hp, h.maxHp, "hero"), effectsRow(h.effects), info);
    return card;
  });
  morphChildren(document.getElementById("rpgHeroes"), heroes);

  morphChildren(document.getElementById("rpgActions"), actionsOf(run, me));

  var log = document.getElementById("rpgLog");
  morphChildren(
    log,
    run.log.slice(-14).map((line) => el("li", "", line)),
  );
  log.scrollTop = log.scrollHeight;
}

// The doors to the next room (the leader picks one)
function doorCards(run) {
  var leader = party.leader == myName;
  return run.doors.map((kind, i) => {
    var info = rules.roomKinds[kind];
    var door = el("div", "rpg-door-card kind-" + kind + (leader ? "" : " locked"));
    door.dataset.act = leader ? "door" : "";
    door.dataset.id = i;
    door.append(el("div", "rpg-door-icon", info.icon), el("div", "rpg-door-name", info.name), el("div", "rpg-door-about mm-muted small", info.about));
    return door;
  });
}

function sceneText(run) {
  if (run.phase == "won") return "🎉 Floor " + run.floor + " cleared!";
  if (run.phase == "lost") return "💀 The party fell - the loot is lost.";
  if (run.phase == "left") return "🚪 You left the dungeon with the loot.";
  return "";
}

function actionsOf(run, me) {
  var leader = party.leader == myName;
  if (party.result) {
    var box = el("div", "rpg-result");
    var loot = (run.loot[myName] || []).filter(() => party.result != "lost");
    box.append(el("div", "rpg-result-title", party.result == "lost" ? "💀 Lost" : party.result == "won" ? "🎉 Cleared - 🪙 " + formatCoins(run.pot) + " for you" : "🚪 Left - 🪙 " + formatCoins(run.pot) + " for you"));
    if (loot.length) {
      var list = el("div", "rpg-result-loot");
      loot.forEach((item) => list.appendChild(itemCard(item)));
      box.appendChild(list);
    }
    box.appendChild(button("Back", "leave", { className: "primary" }));
    return [box];
  }
  if (run.phase == "between") {
    if (!leader) return [el("div", "rpg-wait mm-muted", "⏳ " + party.leader + " picks a door - or leaves with the loot.")];
    return [el("div", "rpg-wait mm-muted", "Pick a door above"), button("Leave with 🪙 " + formatCoins(run.pot), "exit")];
  }
  if (!me || me.down) return [el("div", "rpg-wait mm-muted", "💤 You're down - back up after the fight (or a Cleric's revive).")];
  if (me.chose) return [el("div", "rpg-wait mm-muted", "✓ Waiting for the others…")];
  var cls = rules.classes[me.cls];
  var buttons = [button("⚔️ Attack", "attack", { className: "primary", title: "A plain hit on the foe you aim at" }), button("🛡️ Guard +1⚡", "guard", { title: "Takes much less damage this turn - and 1 more energy" })];
  cls.skills.forEach((id) => {
    var skill = rules.skills[id];
    var needs = skill.target == "ally" ? " (on " + (ally || "you") + ")" : skill.target == "foe" ? "" : "";
    var noneDown = skill.target == "fallen" && !run.heroes.some((h) => h.down);
    buttons.push(button(skill.icon + " " + skill.name + " " + skill.cost + "⚡" + needs, "skill", { id: id, className: "skill", disabled: me.energy < skill.cost || noneDown, title: skill.about }));
  });
  buttons.push(button("🧪 Potion (" + me.potions + ")", "potion", { disabled: me.potions <= 0 || me.hp >= me.maxHp }));
  return buttons;
}

// The time of the turn / the decision, running down
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

document.querySelector(".rpg-main").addEventListener("click", (event) => {
  var node = event.target.closest("[data-act]");
  if (!node || node.disabled || !node.dataset.act) return;
  var act = node.dataset.act;
  var id = node.dataset.id;
  if (act == "upgrade") socket.emit("upgrade", { stat: id });
  else if (act == "equip" || act == "sell") socket.emit(act, { id: id });
  else if (act == "unequip") socket.emit("unequip", { slot: id });
  else if (act == "join") socket.emit("join", { id: id });
  else if (act == "leave") socket.emit("leave");
  else if (act == "exit") socket.emit("exit");
  else if (act == "size") {
    size = Number(id);
    remember(SIZE_KEY, size);
    render();
  } else if (act == "target") {
    target = id;
    render();
  } else if (act == "ally") {
    ally = id == myName ? null : id;
    render();
  } else if (act == "class") socket.emit("class", { id: id });
  else if (act == "door") socket.emit("next", { door: Number(id) });
  else if (act == "attack") socket.emit("act", { action: "attack", target: target });
  else if (act == "skill") {
    // (a revive: the ally picked if down - else the first one down)
    var run = party && party.run;
    var fallen = run ? run.heroes.filter((h) => h.down) : [];
    var friend = rules.skills[id].target == "fallen" ? (fallen.find((h) => h.name == ally) || fallen[0] || {}).name : ally || myName;
    socket.emit("act", { action: "skill", skill: id, target: target, ally: friend });
  }
  else if (act == "guard" || act == "potion") socket.emit("act", { action: act });
});

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
