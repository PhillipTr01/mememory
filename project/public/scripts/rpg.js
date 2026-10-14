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
var picking = null; // in a room: the choice waiting for a card of the deck ("smith", "purge", "remove")
var building = false; // the deck builder open (instead of the home)
var filters = { type: "all", cost: "all", rarity: "all", owned: false }; // the deck builder's
var search = "";
var lastRoom = 0;
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

// A card by its id - "strike+": upgraded at a camp fire (40% stronger)
function cardOf(id) {
  var plus = /\+$/.test(id);
  var card = rules.cards[id.replace(/\+$/, "")];
  return plus ? Object.assign({}, card, { name: card.name + "+", text: card.text + " (+40%)", upgraded: true }) : card;
}

// A card (of the hand, a reward, the deck): the cost, the picture, the name, what it does
function cardEl(id, options) {
  options = options || {};
  var card = cardOf(id);
  var node = el(options.tag || "div", "rpg-cardx type-" + card.type + " rarity-" + (card.rarity || "basic") + (card.upgraded ? " upgraded" : "") + (card.eternal ? " eternal" : "") + (options.className ? " " + options.className : ""));
  if (options.act) {
    node.dataset.act = options.act;
    node.dataset.id = options.id != null ? options.id : id;
  }
  if (options.tag == "button") node.type = "button";
  if (options.disabled) node.classList.add("off");
  var cost = el("span", "rpg-cardx-cost");
  cost.dataset.cost = String(card.cost);
  cost.title = card.cost + " mana";
  node.append(cost, el("span", "rpg-cardx-art", card.icon), el("span", "rpg-cardx-name", card.name), el("span", "rpg-cardx-type", (card.type == "attack" ? "Attack" : "Skill") + " · " + ((rules.cardRarities[card.rarity] || {}).name || "")), el("span", "rpg-cardx-text", card.text));
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
  // (another room: nothing to pick there)
  var room = run ? run.rooms.length : 0;
  if (room != lastRoom) picking = null;
  lastRoom = room;
  render();
});

/* ---------- The page ---------- */

function render() {
  if (!rules || !hero) return;
  var home = party == null;
  var lobby = party != null && !party.started;
  if (!home || !hero.cls) building = false;
  document.getElementById("rpgHome").hidden = !home || building;
  document.getElementById("rpgBuilder").hidden = !building;
  document.getElementById("rpgLobby").hidden = !lobby;
  document.getElementById("rpgRun").hidden = home || lobby;
  if (home || lobby) document.getElementById("rpgModal").hidden = true;
  if (home && building) renderBuilder();
  else if (home) {
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
  document.getElementById("rpgHeroSub").innerText = picked ? "Deepest floor " + hero.deepest + " · " + hero.cleared + " / " + hero.runs + " runs cleared" : "";
  // The hero's level: XP from the fights - every level a stat point, talents at levels 3, 6, 10
  var xpBox = document.getElementById("rpgXp");
  xpBox.hidden = !picked;
  if (picked) morphChildren(xpBox, [el("span", "rpg-level", "Lv " + hero.level), bar(hero.xp, hero.xpNeed, "xp", " XP"), hero.points ? el("span", "rpg-points", "+" + hero.points + " point" + (hero.points == 1 ? "" : "s")) : null]);
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
    // (a stat point: a free level - else coins)
    if (cost == null) row.appendChild(el("span", "rpg-stat-max mm-muted", "Max"));
    else if (hero.points > 0) row.appendChild(button("+1 free", "point", { id: id, className: "small point", title: stat.about }));
    else row.appendChild(button("+ 🪙 " + formatCoins(cost), "upgrade", { id: id, className: "small", disabled: cost > myCoins, title: stat.about }));
    return row;
  });
  morphChildren(document.getElementById("rpgStats"), stats);

  // Talents: one of two per tier - open at hero levels 3, 6, 10
  document.getElementById("rpgTalentCount").innerText = picked && rules.talentLevels.some((lv, tier) => hero.level >= lv && !hero.talents[tier]) ? "!" : "";
  morphChildren(
    document.getElementById("rpgTalents"),
    picked
      ? (rules.talents[hero.cls] || []).map((options, tier) => {
          var lv = rules.talentLevels[tier];
          var open = hero.level >= lv;
          var row = el("div", "rpg-talent-tier" + (open ? "" : " closed"));
          row.appendChild(el("div", "rpg-label", "Level " + lv + (open ? (hero.talents[tier] ? "" : " - pick one") : " - " + (lv - hero.level) + " levels to go")));
          var pair = el("div", "rpg-talent-pair");
          options.forEach((t) => {
            var chosen = hero.talents[tier] == t.id;
            var other = hero.talents[tier] && !chosen;
            var tile = el("button", "rpg-talent" + (chosen ? " chosen" : "") + (other ? " other" : ""));
            tile.type = "button";
            if (open && !hero.talents[tier]) {
              tile.dataset.act = "talent";
              tile.dataset.id = tier + ":" + t.id;
            } else tile.disabled = true;
            tile.append(el("span", "rpg-talent-icon", t.icon), el("b", "", t.name), el("span", "mm-muted small", t.text));
            pair.appendChild(tile);
          });
          row.appendChild(pair);
          return row;
        })
      : [el("div", "rpg-empty mm-muted", "Pick a class first.")],
  );

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

  // The deck builder: the deck (click: out), the collection (click: in), booster packs
  morphChildren(document.getElementById("rpgDeckHelp"), deckHelp());
  document.getElementById("rpgDeckCount").innerText = picked ? String(hero.deck.length) : "";
  document.getElementById("rpgDeckSize").innerText = picked ? hero.deck.length + " cards · " + rules.deckMin + " to " + hero.deckMax + " (more room with hero levels)" : "";
  var pack = document.getElementById("rpgBuyPack");
  pack.innerText = "🎴 Booster pack · 🪙 " + formatCoins(rules.packPrice);
  pack.title = rules.packSize + " cards of your class - the last one rare or better; a card you own all copies of is sold";
  pack.disabled = !picked || myCoins < rules.packPrice;
  morphChildren(document.getElementById("rpgDeckSummary"), picked ? deckSummary(hero.deck) : []);
}

// The deck in short: the mana curve, attacks and skills - too few cards: a warning
function deckSummary(deck) {
  var attacks = deck.filter((id) => cardOf(id).type == "attack").length;
  var nodes = [curve(deck), el("div", "mm-muted small", attacks + " attacks · " + (deck.length - attacks) + " skills")];
  if (deck.length < rules.deckMin) nodes.push(el("div", "rpg-warn", "⚠️ At least " + rules.deckMin + " cards to go down - " + (rules.deckMin - deck.length) + " more"));
  return nodes;
}

// The mana curve of a deck: how many cards cost 0, 1, 2, 3+
function curve(deck) {
  var counts = [0, 0, 0, 0];
  deck.forEach((id) => counts[Math.min(3, cardOf(id).cost)]++);
  var most = Math.max(1, ...counts);
  var box = el("div", "rpg-curve");
  counts.forEach((n, cost) => {
    var col = el("div", "rpg-curve-col");
    col.title = n + " card" + (n == 1 ? "" : "s") + " costing " + (cost == 3 ? "3 or more" : cost);
    var barBox = el("div", "rpg-curve-bar");
    var fill = el("div", "rpg-curve-fill");
    fill.style.height = (n / most) * 100 + "%";
    barBox.appendChild(fill);
    var drop = el("span", "rpg-row-cost");
    drop.dataset.cost = cost == 3 ? "3+" : String(cost);
    col.append(el("span", "rpg-curve-n", String(n)), barBox, drop);
    box.appendChild(col);
  });
  return box;
}

/* ---------- The deck builder ---------- */

// The starter deck of my class: 4 strikes, 4 defends, the two signature cards
function starterDeck() {
  return ["strike", "strike", "strike", "strike", "defend", "defend", "defend", "defend"].concat(rules.classes[hero.cls].signature);
}

document.getElementById("rpgSearch").addEventListener("input", (event) => {
  search = event.target.value;
  render();
});

// Drag & drop in the builder: a card of the collection onto the deck - a row of the deck onto the collection
document.addEventListener("dragstart", (event) => {
  var node = event.target.closest && event.target.closest("[data-drag]");
  if (!node) return;
  event.dataTransfer.setData("text/plain", node.dataset.drag);
  event.dataTransfer.effectAllowed = "move";
  document.getElementById("rpgBuilder").classList.add(node.dataset.drag.startsWith("in:") ? "dragging-in" : "dragging-out");
});
document.addEventListener("dragend", () => {
  document.getElementById("rpgBuilder").classList.remove("dragging-in", "dragging-out");
  document.querySelectorAll(".drop-hover").forEach((n) => n.classList.remove("drop-hover"));
});
[
  ["rpgBuilderDrop", "in:", "deckAdd"],
  ["rpgBuilderGrid", "out:", "deckRemove"],
].forEach(([zoneId, prefix, act]) => {
  var zone = document.getElementById(zoneId);
  zone.addEventListener("dragover", (event) => {
    if (!document.getElementById("rpgBuilder").classList.contains(prefix == "in:" ? "dragging-in" : "dragging-out")) return;
    event.preventDefault();
    zone.classList.add("drop-hover");
  });
  zone.addEventListener("dragleave", (event) => {
    if (!zone.contains(event.relatedTarget)) zone.classList.remove("drop-hover");
  });
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("drop-hover");
    var data = event.dataTransfer.getData("text/plain");
    if (data.startsWith(prefix)) socket.emit(act, { id: data.slice(prefix.length) });
  });
});

var FILTERS = [
  ["type", [["all", "All"], ["attack", "Attacks"], ["skill", "Skills"]]],
  ["cost", [["all", "Any cost"], ["0", "0"], ["1", "1"], ["2", "2"], ["3", "3+"]]],
  ["rarity", [["all", "Any rarity"], ["basic", "Basic"], ["common", "Common"], ["rare", "Rare"], ["epic", "Epic"], ["eternal", "Eternal"]]],
];
var RARITY_ORDER = ["basic", "common", "rare", "epic", "eternal"];
var byCost = (a, b) => cardOf(a).cost - cardOf(b).cost || RARITY_ORDER.indexOf(cardOf(a).rarity) - RARITY_ORDER.indexOf(cardOf(b).rarity) || cardOf(a).name.localeCompare(cardOf(b).name);

function renderBuilder() {
  var cls = rules.classes[hero.cls];
  document.getElementById("rpgBuilderTitle").innerText = "🃏 Deck builder · " + cls.icon + " " + cls.name;
  var pack = document.getElementById("rpgBuilderPack");
  pack.innerText = "🎴 Booster pack · 🪙 " + formatCoins(rules.packPrice);
  pack.title = rules.packSize + " cards of your class - the last one rare or better; a card you own all copies of is sold";
  pack.disabled = myCoins < rules.packPrice;
  var deck = hero.deck;
  var counts = {};
  deck.forEach((id) => (counts[id] = (counts[id] || 0) + 1));
  var short = deck.length < rules.deckMin;
  var count = document.getElementById("rpgBuilderCount");
  count.innerText = deck.length + " / " + hero.deckMax;
  count.className = "rpg-builder-count" + (short ? " bad" : deck.length >= hero.deckMax ? " full" : " ok");
  count.title = "At least " + rules.deckMin + ", at most " + hero.deckMax + " cards (more room with hero levels)";

  // The filters
  var chips = [];
  FILTERS.forEach(([key, options]) => {
    var group = el("div", "rpg-chip-group");
    options.forEach(([value, label]) => {
      var chip = button(label, "filter", { id: key + ":" + value, className: "chip" + (filters[key] == value ? " active" : "") });
      if (key == "cost" && value != "all") {
        chip.innerText = "";
        chip.classList.add("cost-chip");
        var drop = el("span", "rpg-row-cost");
        drop.dataset.cost = label;
        chip.appendChild(drop);
        chip.title = "Costs " + label;
      }
      group.appendChild(chip);
    });
    chips.push(group);
  });
  chips.push(button((filters.owned ? "☑" : "☐") + " Owned only", "filter", { id: "owned:toggle", className: "chip" + (filters.owned ? " active" : "") }));
  morphChildren(document.getElementById("rpgFilterChips"), chips);

  // The collection: every card of the class - owned (spare copies: into the deck) or locked
  var text = search.trim().toLowerCase();
  var shown = hero.pool
    .filter((id) => {
      var card = cardOf(id);
      if (filters.type != "all" && card.type != filters.type) return false;
      if (filters.cost != "all" && Math.min(3, card.cost) != Number(filters.cost)) return false;
      if (filters.rarity != "all" && card.rarity != filters.rarity) return false;
      if (filters.owned && !hero.collection[id]) return false;
      return !text || (card.name + " " + card.text).toLowerCase().includes(text);
    })
    .sort(byCost);
  morphChildren(
    document.getElementById("rpgBuilderGrid"),
    shown.length
      ? shown.map((id) => {
          var owned = hero.collection[id] || 0;
          var spare = owned - (counts[id] || 0);
          var full = deck.length >= hero.deckMax;
          var node = cardEl(id, { act: spare > 0 && !full ? "deckAdd" : "", className: (owned ? "" : "unowned") + (spare > 0 && !full ? " pickable" : " spent") });
          if (spare > 0) node.dataset.drag = "in:" + id;
          node.draggable = spare > 0;
          var pips = el("span", "rpg-copies");
          for (var i = 0; i < Math.max(owned, 1); i++) pips.appendChild(el("i", i < (counts[id] || 0) ? "used" : i < owned ? "" : "none"));
          node.appendChild(pips);
          node.appendChild(el("span", "rpg-cardx-count", owned ? (counts[id] || 0) + " / " + owned : "🔒"));
          node.title = !owned ? "Not owned yet - booster packs, rewards in the dungeon, the merchant" : spare <= 0 ? "All your copies are in the deck" : full ? "Your deck is full" : "Click or drag: into the deck";
          return node;
        })
      : [el("div", "rpg-empty mm-muted", "No card fits the filters.")],
  );

  // The deck: Hearthstone rows (cheapest first) - a click takes one out
  morphChildren(document.getElementById("rpgBuilderCurve"), [curve(deck)]);
  var order = Object.keys(counts).sort(byCost);
  morphChildren(
    document.getElementById("rpgBuilderList"),
    order.length
      ? order.map((id) => {
          var card = cardOf(id);
          var row = el("div", "rpg-deck-row rarity-" + card.rarity + (card.eternal ? " eternal" : ""));
          row.dataset.act = "deckRemove";
          row.dataset.id = id;
          row.dataset.drag = "out:" + id;
          row.draggable = true;
          row.title = card.text + " - click or drag: out of the deck";
          var cost = el("span", "rpg-row-cost");
          cost.dataset.cost = String(card.cost);
          row.append(cost, el("span", "rpg-row-icon", card.icon), el("span", "rpg-row-name", card.name), el("span", "rpg-row-count", counts[id] > 1 ? "×" + counts[id] : card.eternal ? "★" : ""));
          return row;
        })
      : [el("div", "rpg-empty mm-muted", "Empty - click or drag cards in.")],
  );
  var attacks = deck.filter((id) => cardOf(id).type == "attack").length;
  morphChildren(document.getElementById("rpgBuilderNote"), [
    el("div", "mm-muted small", attacks + " attacks · " + (deck.length - attacks) + " skills"),
    short ? el("div", "rpg-warn", "⚠️ At least " + rules.deckMin + " cards to go down - " + (rules.deckMin - deck.length) + " more") : el("div", "rpg-ok", "✓ Ready for the dungeon"),
  ]);
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

  var current = run.rooms[run.rooms.length - 1];
  document.getElementById("rpgRunRoom").innerText = current ? "Room " + run.rooms.length + " / " + rules.rooms + " · " + rules.roomKinds[current.kind].icon + " " + rules.roomKinds[current.kind].name : "";
  renderMap(run);
  var fighting = run.phase == "fight";
  var arena = document.querySelector(".rpg-arena");
  arena.classList.toggle("aiming-foe", !!aiming && aiming.target == "foe");
  arena.classList.toggle("aiming-ally", !!aiming && (aiming.target == "ally" || aiming.target == "fallen"));

  renderModal(run, me);
  renderPartyStats(run);

  var scene;
  if (fighting) {
    scene = run.monsters.map((m) => {
      var card = el("div", "rpg-monster rank-" + m.rank + (m.down ? " down" : "") + (m.id == target ? " target" : ""));
      card.dataset.act = m.down ? "" : "target";
      card.dataset.id = m.id;
      if (m.intent) card.appendChild(intentBadge(m));
      var name = el("div", "rpg-monster-name", m.name + (m.undead ? " 🦴" : ""));
      if (m.affix) name.title = rules.affixes[m.affix].text;
      card.append(el("div", "rpg-monster-icon", m.icon), name, bar(m.hp, m.maxHp, "foe"), effectsRow(m.effects));
      if (m.affix) card.appendChild(el("div", "rpg-affix", rules.affixes[m.affix].icon + " " + rules.affixes[m.affix].text));
      return card;
    });
  } else if (run.phase == "between") scene = [];
  else scene = [el("div", "rpg-quiet", sceneText(run))];
  morphChildren(document.getElementById("rpgMonsters"), scene);
  // Between the rooms: the room the party is in (a camp fire, a merchant, an encounter ...) - its choices
  var roomBox = document.getElementById("rpgRoom");
  var inRoom = run.phase == "between" && !party.result;
  roomBox.hidden = !inRoom;
  arena.classList.toggle("in-room", inRoom);
  arena.dataset.room = inRoom && run.event ? run.event.kind : "";
  morphChildren(roomBox, inRoom ? roomScene(run, me) : []);

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
    var relics = el("div", "rpg-relics");
    (h.relics || []).forEach((id) => {
      var chip = el("span", "rpg-relic-chip", rules.relics[id].icon);
      chip.title = rules.relics[id].name + ": " + rules.relics[id].text;
      relics.appendChild(chip);
    });
    card.append(head, hp, effectsRow(h.effects), relics, info);
    return card;
  });
  morphChildren(document.getElementById("rpgHeroes"), heroes);

  morphChildren(document.getElementById("rpgHandBar"), handBar(run, me));
  fitHand();

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

// After a fight one popup at a time: the relic of a hard fight, then the card won - each skipped: the next one
// (the other rooms are rooms of their own: the scene)
function renderModal(run, me) {
  var modal = document.getElementById("rpgModal");
  var nodes = null;
  if (run.phase == "between" && me && !party.result) {
    if (me.relicChoice) nodes = relicPanel(me);
    else if (me.reward) nodes = rewardPanel(me);
  }
  modal.hidden = !nodes;
  if (nodes) morphChildren(document.getElementById("rpgModalBox"), nodes);
}

// The party: every hero's stats, perks (talents, relics) and relics
var PERK_TEXT = {
  startBlock: (v) => "+" + v + " block at the start",
  firstMana: (v) => "+" + v + " mana on turn one",
  draw: (v) => "+" + v + " card a turn",
  attack: (v) => "+" + Math.round(v * 100) + "% damage",
  firstStrike: (v) => "+" + Math.round(v * 100) + "% first attack",
  lowHp: (v) => "+" + Math.round(v * 100) + "% damage below half HP",
  crit: (v) => "+" + v + "% crit",
  lifesteal: (v) => Math.round(v * 100) + "% lifesteal",
  thorns: (v) => v + " thorns",
  block: (v) => "+" + Math.round(v * 100) + "% block",
  heal: (v) => "+" + Math.round(v * 100) + "% healing",
  afterFight: (v) => "heal " + Math.round(v * 100) + "% after a fight",
  poison: (v) => "+" + Math.round(v * 100) + "% poison",
  maxHp: (v) => "+" + Math.round(v * 100) + "% max HP",
  agi: (v) => "+" + v + "% dodge",
};
function renderPartyStats(run) {
  morphChildren(
    document.getElementById("rpgPartyStats"),
    run.heroes.map((h) => {
      var cls = rules.classes[h.cls] || { icon: "", name: "" };
      var row = el("div", "rpg-pstat" + (h.name == myName ? " me" : ""));
      var head = el("div", "rpg-pstat-head");
      head.append(createAvatar(h.name, "sm"), el("b", "", h.name), el("span", "mm-muted small", cls.icon + " " + cls.name));
      var stats = el("div", "rpg-pstat-stats");
      [
        ["❤️", h.hp + " / " + h.maxHp, "HP"],
        ["⚔️", h.atk, "Attack: 100% damage of a Strike"],
        ["🛡️", h.def, "Armor: taken off every hit (at most 75%), more block"],
        ["🍀", h.luck + (h.perks.crit || 0) + "%", "Critical hits (x1.8) - and sensing the doors"],
        ["🪶", h.agi + "%", "Dodge an attack"],
        ["🧪", h.potions, "Potions"],
      ].forEach(([icon, value, tip]) => {
        var chip = el("span", "rpg-pstat-chip", icon + " " + value);
        chip.title = tip;
        stats.appendChild(chip);
      });
      var perks = Object.keys(h.perks || {})
        .filter((k) => h.perks[k] && PERK_TEXT[k])
        .map((k) => PERK_TEXT[k](h.perks[k]));
      var relics = el("div", "rpg-relics");
      (h.relics || []).forEach((id) => {
        var relic = rules.relics[id];
        var chip = el("span", "rpg-relic-chip big", relic.icon + " " + relic.name);
        chip.title = relic.text;
        relics.appendChild(chip);
      });
      if (!(h.relics || []).length) relics.appendChild(el("span", "mm-muted small", "No relics yet - hard fights, chests, the merchant"));
      row.append(head, stats, relics, el("div", "mm-muted small", perks.length ? "Perks: " + perks.join(" · ") : "No perks yet - talents (hero levels 3, 6, 10) and relics"));
      return row;
    }),
  );
}

// A relic of a hard fight: one of three (for this run)
function relicPanel(me) {
  var row = el("div", "rpg-relic-pick");
  me.relicChoice.forEach((id) => {
    var relic = rules.relics[id];
    var tile = el("button", "rpg-relic-tile");
    tile.type = "button";
    tile.dataset.act = "relic";
    tile.dataset.id = id;
    tile.append(el("span", "rpg-relic-icon", relic.icon), el("b", "", relic.name), el("span", "mm-muted small", relic.text));
    row.appendChild(tile);
  });
  return [el("div", "rpg-reward-title", "☠️ A relic - pick one for this run"), row, button("Skip", "relic", { id: "", className: "small" })];
}

// The card won in a fight: one of three for the deck
function rewardPanel(me) {
  var cards = el("div", "rpg-reward-cards");
  me.reward.forEach((id) => cards.appendChild(cardEl(id, { tag: "button", act: "pick", className: "pickable" })));
  return [el("div", "rpg-reward-title", "Victory - pick a card for your deck"), el("div", "rpg-reward-note mm-muted small", "It goes into your deck for the rest of this run - you may draw it in the next fights."), cards, button("Skip", "pick", { id: "", className: "small" })];
}

// The rooms that aren't fights: a picture, a story, the choices - what happened
var ROOM_STORY = {
  chest: "A heavy chest in the middle of the room, its lock rusted through. Every hero may open it.",
  trap: "Thin wires across the floor, small holes in the walls. A trap - and the only way on is through it.",
  rest: "A quiet corner and a crackling fire. Time to catch your breath - or to work on your cards.",
  shrine: "An old shrine, dark with dried blood. It whispers of power - for a price.",
  merchant: 'A hooded merchant opens a heavy pack. "Coins first, friend. Your own - not the pot."',
};

function roomScene(run, me) {
  var ev = run.event;
  if (!ev) {
    var done = el("div", "rpg-scene kind-cleared");
    var plain = el("div", "rpg-scene-body center");
    plain.append(el("div", "rpg-scene-title", "⚔️ The room is cleared"), el("div", "rpg-scene-story", "The way on lies open. Pick the next room on the map 🗺️" + (run.heroes.length > 1 ? " - the party votes." : ".")));
    done.appendChild(plain);
    return [done];
  }
  var kind = rules.roomKinds[ev.kind];
  var enc = ev.encounter;
  var scene = el("div", "rpg-scene kind-" + ev.kind + (enc ? " enc-" + ev.id : ""));
  var art = el("div", "rpg-scene-art");
  art.appendChild(el("span", "rpg-scene-icon", enc ? enc.icon : kind.icon));
  var head = el("div", "rpg-scene-head");
  head.append(el("div", "rpg-scene-title", enc ? enc.name : kind.name), el("div", "rpg-scene-story", enc ? enc.story : ROOM_STORY[ev.kind] || kind.about));
  var body = el("div", "rpg-scene-body");
  if (ev.kind == "merchant") body.append(...shopNodes(run, me));
  else if (me && ev.choices && myName in ev.choices) body.append(...choiceNodes(run, me));
  if (ev.lines.length) {
    var lines = el("ul", "rpg-event-lines");
    ev.lines.forEach((line) => lines.appendChild(el("li", "", line)));
    body.appendChild(lines);
  }
  // Who has chosen
  if (ev.choices && run.heroes.length > 1) {
    var who = el("div", "rpg-scene-party");
    Object.keys(ev.choices).forEach((name) => {
      var chip = el("span", "rpg-chose" + (ev.choices[name] ? " done" : ""));
      chip.append(createAvatar(name, "sm"), el("span", "", ev.choices[name] ? "✓" : "…"));
      chip.title = name + (ev.choices[name] ? " has chosen" : " is choosing");
      who.appendChild(chip);
    });
    body.appendChild(who);
  }
  scene.append(art, head, body);
  return [scene];
}

// The choices of a room: big buttons - one of them (a card to pick: of the deck, or of the cards offered)
function choiceNodes(run, me) {
  var ev = run.event;
  var chosen = ev.choices[myName];
  var nodes = [];
  var row = el("div", "rpg-options");
  ev.options.forEach((o) => {
    var text = o.text;
    if (o.id == "disarm" && ev.disarm) text += " (🍀 " + ev.disarm[myName] + "%)";
    var b = el("button", "rpg-option" + (chosen == o.id ? " chosen" : "") + (picking == o.id ? " picking" : "") + (o.card == "offer" ? " offer" : ""));
    b.type = "button";
    if (chosen || o.card == "offer") b.disabled = true;
    else {
      b.dataset.act = o.card ? "pickMode" : "choose";
      b.dataset.id = o.id;
    }
    b.append(el("b", "", o.label + (o.card == "offer" && !chosen ? " ↓" : "")), el("span", "", text));
    row.appendChild(b);
  });
  nodes.push(row);
  if (chosen) {
    nodes.push(el("div", "rpg-scene-done", "✓ Done here - pick the next room on the map 🗺️"));
    return nodes;
  }
  // The library: the cards to study, right there
  var offer = ev.options.find((o) => o.card == "offer");
  if (offer && ev.offers && ev.offers[myName]) {
    var cards = el("div", "rpg-reward-cards");
    ev.offers[myName].forEach((id) => cards.appendChild(cardEl(id, { tag: "button", act: "chooseCard", id: offer.id + ":" + id, className: "pickable" })));
    nodes.push(el("div", "rpg-label", offer.label + " - pick one"), cards);
  }
  if (picking && ev.options.some((o) => o.id == picking)) nodes.push(...deckPicker(me, picking == "smith" ? "Pick the card to upgrade (40% stronger, for this run)" : "Pick the card to give away", picking));
  return nodes;
}

// The deck of this run to pick a card from (smith, give away, remove)
function deckPicker(me, text, option) {
  var deck = el("div", "rpg-reward-cards rpg-deck-pick");
  me.deck.forEach((id, i) => {
    var off = option == "smith" && /\+$/.test(id);
    deck.appendChild(cardEl(id, { tag: "button", act: off ? "" : "chooseCard", id: option + ":" + i, className: "small" + (off ? " off" : " pickable") }));
  });
  return [el("div", "rpg-label", text), deck];
}

// The merchant: cards, relics, a potion, a card taken out of the deck - with the own coins
function shopNodes(run, me) {
  var offer = me && run.event.offers && run.event.offers[myName];
  if (!offer) return [];
  var price = (id) => offer.prices[id];
  var tag = (id, sold) => el("span", "rpg-price" + (!sold && price(id) > myCoins ? " dear" : ""), sold ? "Sold ✓" : "🪙 " + formatCoins(price(id)));
  var cards = el("div", "rpg-shop-row");
  offer.cards.forEach((id) => {
    var sold = offer.bought.includes(id);
    var card = cardEl(id, { tag: "button", act: sold ? "" : "buy", className: "pickable" + (sold ? " off" : "") });
    card.appendChild(tag(id, sold));
    cards.appendChild(card);
  });
  var relics = el("div", "rpg-shop-row");
  offer.relics.forEach((id) => {
    var relic = rules.relics[id];
    var sold = offer.bought.includes(id);
    var tile = el("button", "rpg-relic-tile" + (sold ? " off" : ""));
    tile.type = "button";
    if (!sold) {
      tile.dataset.act = "buy";
      tile.dataset.id = id;
    }
    tile.append(el("span", "rpg-relic-icon", relic.icon), el("b", "", relic.name), el("span", "mm-muted small", relic.text), tag(id, sold));
    relics.appendChild(tile);
  });
  var services = el("div", "rpg-shop-services");
  services.append(
    button("🧪 Potion · 🪙 " + formatCoins(price("potion")) + " (" + me.potions + "/" + rules.potionsMax + ")", "buy", { id: "potion", disabled: me.potions >= rules.potionsMax || myCoins < price("potion") }),
    button(offer.removed ? "🗑️ Card removed ✓" : "🗑️ Remove a card · 🪙 " + formatCoins(price("remove")), "pickMode", { id: "remove", className: picking == "remove" ? "voted" : "", disabled: offer.removed || myCoins < price("remove") || me.deck.length <= rules.deckLeast, title: "The merchant takes a card out of your deck for this run" }),
  );
  var nodes = [el("div", "rpg-shop-coins", "Your coins: 🪙 " + formatCoins(myCoins)), el("div", "rpg-label", "Cards"), cards, el("div", "rpg-label", "Relics"), relics, el("div", "rpg-label", "Services"), services];
  if (picking == "remove" && !offer.removed) nodes.push(...deckPicker(me, "Pick the card he takes out of your deck", "remove"));
  return nodes;
}

// The map of the floor (like Slay the Spire): rows from the bottom up - the rooms gone through, the ones to pick
// next (a vote), what is hidden ("?" - unless the party sensed it)
var MAP_ROW = 62;
function renderMap(run) {
  var rows = run.map;
  var lanes = rules.lanes;
  var height = rows.length * MAP_ROW;
  var x = (col) => ((col + 0.5) / lanes) * 100;
  var y = (r) => height - (r + 0.5) * MAP_ROW;
  var between = run.phase == "between" && !party.result;
  var doorOf = (r, i) => run.doors.findIndex((d) => d.row == r && d.index == i);
  var svgNs = "http://www.w3.org/2000/svg";
  var svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("class", "rpg-map-lines");
  svg.setAttribute("viewBox", "0 0 100 " + height);
  svg.setAttribute("preserveAspectRatio", "none");
  var nodes = [svg];
  rows.forEach((row, r) => {
    row.forEach((node, i) => {
      node.next.forEach((n) => {
        var to = rows[r + 1][n];
        var line = document.createElementNS(svgNs, "line");
        var here = run.at && run.at.row == r && run.at.index == i;
        line.setAttribute("class", node.visited && to.visited ? "walked" : here && between ? "open" : "");
        line.setAttribute("x1", x(node.col));
        line.setAttribute("y1", y(r));
        line.setAttribute("x2", x(to.col));
        line.setAttribute("y2", y(r + 1));
        line.setAttribute("vector-effect", "non-scaling-stroke");
        svg.appendChild(line);
      });
    });
  });
  rows.forEach((row, r) => {
    row.forEach((node, i) => {
      var door = between ? doorOf(r, i) : -1;
      var here = run.at && run.at.row == r && run.at.index == i;
      var kind = node.kind ? rules.roomKinds[node.kind] : null;
      var mine = door >= 0 && run.votes[myName] === door;
      var b = el("button", "rpg-node" + (kind ? " kind-" + node.kind : " hidden") + (node.visited ? " visited" : "") + (here ? " here" : "") + (door >= 0 ? " choice" : "") + (mine ? " voted" : "") + (node.sensed && !node.visited ? " sensed" : ""));
      b.type = "button";
      b.style.left = x(node.col) + "%";
      b.style.top = y(r) + "px";
      b.appendChild(el("span", "rpg-node-icon", kind ? kind.icon : "?"));
      if (door >= 0) {
        b.dataset.act = "vote";
        b.dataset.id = door;
      } else b.disabled = true;
      b.title = (kind ? kind.name + " - " + kind.about : "Hidden - nobody senses what is in there") + (node.sensed && !node.visited ? " (sensed 🍀)" : "") + (door >= 0 ? " · click: go there" : "");
      var voters = door >= 0 ? Object.keys(run.votes).filter((name) => run.votes[name] === door) : [];
      if (voters.length) {
        var faces = el("span", "rpg-node-votes");
        voters.forEach((name) => faces.appendChild(createAvatar(name, "sm")));
        b.appendChild(faces);
      }
      nodes.push(b);
    });
  });
  var box = document.getElementById("rpgMap");
  box.style.height = height + "px";
  morphChildren(box, nodes);
  var sense = document.getElementById("rpgMapSense");
  sense.innerText = "🍀 " + run.sense + "% sensed";
  sense.title = "How often your party senses what a hidden room is: 20% + 1.5x the best luck";
  var count = Object.keys(run.votes).length;
  document.getElementById("rpgMapNote").innerText = party.result ? "" : between ? (run.heroes.length > 1 ? "Vote for the next room · " + count + " / " + run.heroes.length + " voted" : "Click one of the lit rooms") : run.phase == "fight" ? "Win the fight to go on." : "";
}

// A pile of my cards to look at: the draw pile (in no order), the discard pile, the exhausted cards
function showPile(kind) {
  var me = party && party.run && party.run.heroes.find((h) => h.name == myName);
  if (!me || !me.piles) return;
  var names = { draw: "🂠 Draw pile - in no order", discard: "♻️ Discard pile", exhausted: "🔥 Exhausted - gone for this fight" };
  var old = document.getElementById("rpgPackModal");
  if (old) old.remove();
  var modal = el("div", "rpg-modal");
  modal.id = "rpgPackModal";
  modal.dataset.act = "closePack";
  var box = el("div", "rpg-modal-box");
  var cards = el("div", "rpg-reward-cards");
  me.piles[kind].forEach((id) => cards.appendChild(cardEl(id, { className: "small" })));
  if (!me.piles[kind].length) cards.appendChild(el("div", "rpg-empty mm-muted", "Empty"));
  box.append(el("div", "rpg-reward-title", names[kind] + " · " + me.piles[kind].length), cards, button("Close", "closePack", { className: "small" }));
  modal.appendChild(box);
  document.querySelector(".rpg-main").appendChild(modal);
}

// How the cards work (the Deck tab)
function deckHelp() {
  var steps = [
    ["🃏", "Your deck", "Every run starts with this deck of 10 cards. Shuffled at the start of every fight."],
    ["✋", "A turn", "You draw 5 cards and get 3 💧 mana. A card costs the mana in its drop (top left)."],
    ["⚔️", "Play", "Attacks hit a foe (click the card, then the foe), skills block, heal or help. Block only lasts through the monsters' turn."],
    ["⏭️", "End turn", "The cards you didn't play go to the discard pile; the monsters do what their badges showed. An empty draw pile: the discard pile is shuffled in."],
    ["🎁", "Grow it", "Every fight won: pick one of three new cards - or study, buy them in the rooms. For the rest of that run - and your collection keeps them."],
    ["🗺️", "The map", "Pick your way room by room. What a room is stays hidden (?) - luck lets your party sense it."],
  ];
  return steps.map(([icon, title, text]) => {
    var row = el("div", "rpg-help-step");
    var body = el("div", "");
    body.append(el("b", "", title), el("div", "mm-muted small", text));
    row.append(el("span", "rpg-help-icon", icon), body);
    return row;
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
    var sum = party.summary && party.summary[myName];
    if (sum) {
      var gains = el("div", "rpg-summary");
      gains.appendChild(el("span", "rpg-gain", "+" + sum.xp + " XP" + (party.result == "lost" ? " (half - lost)" : "")));
      if (sum.ups) gains.appendChild(el("span", "rpg-gain up", "⬆️ Level " + sum.level + "! +" + sum.ups + " stat point" + (sum.ups == 1 ? "" : "s")));
      if (sum.firstClear) gains.appendChild(el("span", "rpg-gain first", "🏆 First clear: +🪙 " + formatCoins(sum.firstClear)));
      box.appendChild(gains);
    }
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
    var text = run.heroes.length > 1 ? "🗺️ Vote for the next room on the map - " + count + " / " + run.heroes.length + " voted" + (party.leader == myName ? "" : " (a tie: " + party.leader + " decides)") : "🗺️ Pick the next room on the map";
    return [potion, el("div", "rpg-wait mm-muted", text), leave];
  }
  if (!me || me.down) return [el("div", "rpg-wait mm-muted", "💤 You're down - back up after the fight (or a Cleric's revive).")];
  var energy = el("div", "rpg-energy" + (me.energy <= 0 ? " empty" : ""));
  energy.dataset.mana = me.energy + "/" + rules.energy;
  energy.title = "Mana - cards cost it, full again every turn";
  var draw = button("🂠 Draw " + me.drawCount, "pile", { id: "draw", className: "rpg-pile", title: "Draw pile: the cards still to come this fight - click to look" });
  var left = el("div", "rpg-hand-side");
  left.append(energy, draw);
  var hand = el("div", "rpg-hand" + (me.ended ? " ended" : ""));
  me.hand.forEach((c, i) => {
    var card = cardOf(c.id);
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
  var discard = button("♻️ Discard " + me.discardCount, "pile", { id: "discard", className: "rpg-pile", title: "Discard pile: played and unplayed cards of the turns before - shuffled back in when the draw pile is empty. Click to look" });
  var exhausted = me.piles && me.piles.exhausted.length ? button("🔥 " + me.piles.exhausted.length, "pile", { id: "exhausted", className: "rpg-pile", title: "Exhausted: gone for this fight (eternal ones: for the run)" }) : null;
  var right = el("div", "rpg-hand-side");
  right.append(end, potion, discard);
  if (exhausted) right.appendChild(exhausted);
  var nodes = [left, hand, right];
  if (aiming) nodes.unshift(el("div", "rpg-aim-hint", aiming.target == "foe" ? "🎯 Click a foe - or the card again to cancel" : "🎯 Click a hero - or the card again to cancel"));
  return nodes;
}

// The hand fanned into the room it has: the cards overlap more the less room there is
function fitHand() {
  var hand = document.querySelector("#rpgHandBar .rpg-hand");
  var first = hand && hand.querySelector(".rpg-cardx");
  if (!first) return;
  var n = hand.querySelectorAll(".rpg-cardx").length;
  var squeeze = Math.max(5.6, (n * first.offsetWidth - hand.clientWidth) / (2 * n) + 2);
  hand.style.setProperty("--squeeze", squeeze + "px");
}
window.addEventListener("resize", fitHand);

// The time of the turn / the vote, running down
// The time of the turn / the vote: seconds, counting down
function tick() {
  var clock = document.getElementById("rpgClock");
  var text = "";
  if (party && party.run && !party.result && party.timeLeft != null) {
    var left = Math.max(0, Math.ceil((party.timeLeft - (Date.now() - partyAt)) / 1000));
    text = "⏱ " + left + "s";
    clock.classList.toggle("low", left <= 10);
    clock.title = party.run.phase == "fight" ? "Time left for this turn" : "Time left for the vote";
  }
  if (clock.innerText != text) clock.innerText = text;
  setTimeout(tick, 250);
}
tick();

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
  var card = cardOf(entry.id);
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

// Drag & drop: a card of the hand dragged onto a foe (attacks), a hero (heals, shields) or the scene (the rest)
var drag = null;
var dragged = false; // (a drag just ended: the click after it is not a click)
document.addEventListener("pointerdown", (event) => {
  var card = event.target.closest(".rpg-hand button.rpg-cardx");
  if (!card || card.classList.contains("off") || event.button > 0) return;
  drag = { uid: card.dataset.id, x: event.clientX, y: event.clientY, ghost: null, source: card };
});
document.addEventListener("pointermove", (event) => {
  if (!drag) return;
  if (!drag.ghost) {
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 10) return;
    drag.ghost = drag.source.cloneNode(true);
    drag.ghost.classList.add("rpg-ghost");
    document.body.appendChild(drag.ghost);
    drag.source.classList.add("dragging");
    var entry = findInHand(drag.uid);
    var t = entry ? cardOf(entry.id).target : "none";
    var arena = document.querySelector(".rpg-arena");
    arena.classList.toggle("aiming-foe", t == "foe");
    arena.classList.toggle("aiming-ally", t == "ally" || t == "fallen");
    arena.classList.toggle("aiming-any", t == "none");
  }
  drag.ghost.style.left = event.clientX + "px";
  drag.ghost.style.top = event.clientY + "px";
  document.querySelectorAll(".drop-hover").forEach((n) => n.classList.remove("drop-hover"));
  var over = dropTarget(event);
  if (over) over.node.classList.add("drop-hover");
});
document.addEventListener("pointerup", (event) => {
  if (!drag) return;
  var current = drag;
  drag = null;
  if (!current.ghost) return;
  dragged = true;
  setTimeout(() => (dragged = false), 0);
  current.ghost.remove();
  current.source.classList.remove("dragging");
  document.querySelectorAll(".drop-hover").forEach((n) => n.classList.remove("drop-hover"));
  var over = dropTarget(event);
  var entry = findInHand(current.uid);
  if (over && entry) {
    var t = cardOf(entry.id).target;
    if (t == "foe" && over.kind == "foe") socket.emit("play", { uid: current.uid, target: over.id });
    else if ((t == "ally" || t == "fallen") && over.kind == "hero") socket.emit("play", { uid: current.uid, ally: over.id });
    else if (t == "none") socket.emit("play", { uid: current.uid });
  }
  aiming = null;
  render();
});

function findInHand(uid) {
  var me = party && party.run && party.run.heroes.find((h) => h.name == myName);
  return me ? me.hand.find((c) => c.uid == uid) : null;
}

// What is under the pointer: a foe, a hero - or the scene
function dropTarget(event) {
  var under = document.elementFromPoint(event.clientX, event.clientY);
  if (!under) return null;
  var foe = under.closest(".rpg-monster:not(.down)");
  if (foe) return { kind: "foe", id: foe.dataset.id, node: foe };
  var ally = under.closest(".rpg-fighter");
  if (ally) return { kind: "hero", id: ally.dataset.id, node: ally };
  var arena = under.closest(".rpg-arena");
  if (arena) return { kind: "scene", node: arena };
  return null;
}

document.querySelector(".rpg-main").addEventListener("click", (event) => {
  if (dragged) return;
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
  else if (act == "unlock") unlockClass(id);
  else if (act == "buy") socket.emit("buy", { item: id });
  else if (act == "point") socket.emit("point", { stat: id });
  else if (act == "deckAdd" || act == "deckRemove") socket.emit(act, { id: id });
  else if (act == "closePack") {
    if (node.id == "rpgPackModal" && event.target != node) return;
    document.getElementById("rpgPackModal").remove();
  } else if (act == "pile") showPile(id);
  else if (act == "builder") {
    building = true;
    render();
  } else if (act == "builderClose") {
    building = false;
    render();
  } else if (act == "pack") socket.emit("pack");
  else if (act == "filter") {
    var [key, value] = id.split(":");
    if (key == "owned") filters.owned = !filters.owned;
    else filters[key] = value;
    render();
  } else if (act == "deckClear") socket.emit("deckSet", { ids: [] });
  else if (act == "deckStarter") socket.emit("deckSet", { ids: starterDeck() });
  else if (act == "talent") socket.emit("talent", { tier: Number(id.split(":")[0]), id: id.split(":")[1] });
  else if (act == "relic") socket.emit("relic", { id: id || null });
  else if (act == "choose") {
    picking = null;
    socket.emit("choose", { option: id });
  } else if (act == "pickMode") {
    picking = picking == id ? null : id;
    render();
  } else if (act == "chooseCard") {
    // ("smith:3" - an index of the deck; "read:fireball" - a card offered; "remove:3" - the merchant's)
    var option = id.slice(0, id.indexOf(":"));
    var card = id.slice(id.indexOf(":") + 1);
    picking = null;
    if (option == "remove") socket.emit("buy", { item: "remove:" + card });
    else socket.emit("choose", { option: option, card: option == "read" ? card : Number(card) });
  }
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
document.getElementById("rpgBuyPack").addEventListener("click", () => socket.emit("pack"));

// A booster pack opened: its cards, one after the other
socket.on("rpgPack", (data) => {
  var old = document.getElementById("rpgPackModal");
  if (old) old.remove();
  var modal = el("div", "rpg-modal");
  modal.id = "rpgPackModal";
  var box = el("div", "rpg-modal-box");
  var cards = el("div", "rpg-reward-cards rpg-pack");
  data.cards.forEach((c, i) => {
    var node = cardEl(c.id, { className: "revealing" });
    node.style.animationDelay = i * 0.25 + "s";
    node.appendChild(el("span", "rpg-price", c.fresh ? "New!" : "Spare · +🪙 " + formatCoins(c.coins)));
    cards.appendChild(node);
  });
  box.append(el("div", "rpg-reward-title", "🎴 Booster pack"), cards, el("div", "mm-muted small", data.spare ? "Spare copies sold: +🪙 " + formatCoins(data.spare) : "Every card new for your collection - put them into your deck."), button("Nice", "closePack", { className: "primary" }));
  modal.appendChild(box);
  document.querySelector(".rpg-main").appendChild(modal);
});
document.getElementById("rpgStart").addEventListener("click", () => socket.emit("start"));
document.getElementById("rpgLeave").addEventListener("click", () => socket.emit("leave"));
