/* The dungeon (an RPG): the server runs the heroes, the parties and the card fights - this page shows them. */
const socket = io((window.CASINO_NS || "") + "/rpg");

var myName = null;
var myCoins = 0;
var rules = null;
var hero = null; // my hero (heroView of game/rpg.js)
var classMenu = false; // the class dropdown open
var heroAt = 0; // (when it came - the death's time counts down from it)
var parties = []; // the open parties
var party = null; // my party (with its run) - null: none
var partyAt = 0; // when it came (its timeLeft counts from then)
var target = null; // the monster I aim at
var aiming = null; // a card of my hand waiting for its target: {uid, target: "foe" | "ally" | "fallen"}
var VIEW_KEY = "rpgView";
var view = "play"; // the section of the home: play, hero, talents, gear, deck, shop
try {
  view = localStorage.getItem(VIEW_KEY) || "play";
} catch (error) {
  // no storage: play
}
var picking = null; // in a room: the choice waiting for a card of the deck ("smith", "purge", "remove")
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
  var live = liveText(id);
  if (plus) return Object.assign({}, card, { name: card.name + "+", text: live || card.text + " (+40%)", upgraded: true });
  return live ? Object.assign({}, card, { text: live }) : card;
}

// The text of a card with my numbers (the server writes them: my damage, block, healing)
function liveText(id) {
  var me = party && party.run && party.run.heroes.find((h) => h.name == myName);
  if (me && me.texts && me.texts[id]) return me.texts[id];
  return hero && hero.texts && hero.texts[id];
}

// The type line of a card: attack (⚔️ red) or skill (🛡️ blue) - and its rarity
function cardType(card) {
  var line = el("span", "rpg-cardx-type");
  line.append(el("span", "rpg-cardx-kind", card.type == "attack" ? "⚔ Attack" : "✦ Skill"));
  var rarity = (rules.cardRarities[card.rarity] || {}).name;
  if (rarity && card.rarity != "basic") line.append(" · " + rarity);
  return line;
}

// A card (of the hand, a reward, the deck): the cost, the picture, the name, what it does
function cardEl(id, options) {
  options = options || {};
  var card = cardOf(id);
  var node = el(options.tag || "div", "rpg-cardx type-" + card.type + " rarity-" + (card.rarity || "basic") + (card.upgraded ? " upgraded" : "") + (card.mystic ? " mystic" : "") + (options.className ? " " + options.className : ""));
  if (options.act) {
    node.dataset.act = options.act;
    node.dataset.id = options.id != null ? options.id : id;
  }
  if (options.tag == "button") node.type = "button";
  if (options.disabled) node.classList.add("off");
  var cost = el("span", "rpg-cardx-cost");
  cost.dataset.cost = String(card.cost);
  cost.title = card.cost + " mana";
  var art = el("span", "rpg-cardx-art", card.icon);
  if (card.rarity && card.rarity != "basic") art.appendChild(el("i", "rpg-cardx-gem"));
  node.append(cost, art, el("span", "rpg-cardx-name", card.name), cardType(card), el("span", "rpg-cardx-text", card.text));
  return node;
}

// A time left in short: "5h 12m", "3m"
function duration(ms) {
  var minutes = Math.max(1, Math.ceil(ms / 60000));
  return minutes >= 60 ? Math.floor(minutes / 60) + "h " + (minutes % 60) + "m" : minutes + "m";
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
  heroAt = Date.now();
  render();
});
socket.on("rpgParties", (list) => {
  parties = list;
  render();
});
socket.on("rpgParty", (data) => {
  // (a fight played back right now: the newest state waits for it)
  if (fxBusy) {
    fxQueued = { data: data };
    return;
  }
  receiveParty(data);
});

function receiveParty(data) {
  var events = freshFx(data);
  // The monsters' turn, a fight won or lost: played back over the scene as it was - then the new state
  if (events.some((e) => e.k == "turn" && e.side == "foes") || events.some((e) => e.k == "victory" || e.k == "defeat")) {
    fxBusy = true;
    playFx(events, () => {
      fxBusy = false;
      applyParty(data);
      var next = fxQueued;
      fxQueued = null;
      if (next) receiveParty(next.data);
    });
    return;
  }
  // A card played: the new state at once - the numbers fly over it
  applyParty(data);
  if (events.length) playFx(events, null);
}

function applyParty(data) {
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
}

/* ---------- A fight played back: cards, hits, blocks, heals, the monsters one after the other ---------- */

var fxBusy = false; // playing back (the state waits)
var fxQueued = null; // {data}: the newest state, waiting
var fxSeen = null; // the last event shown - {party, id}
var holdModal = 0; // (the rewards wait for the victory banner: until then)

// The events new since the last update (a new party, a new page: none - nothing to play back)
function freshFx(data) {
  var list = (data && data.run && data.run.fx) || [];
  var last = list.length ? list[list.length - 1].id : 0;
  var same = fxSeen && data && fxSeen.party == data.id;
  var fresh = same ? list.filter((e) => e.id > fxSeen.id) : [];
  // (a run just begun: its first fight's banner)
  if (!same && data && data.run && data.run.phase == "fight" && data.run.turn == 1 && data.run.rooms.length == 1) fresh = list.filter((e) => e.k == "turn" && e.first);
  fxSeen = data ? { party: data.id, id: last } : null;
  return fresh;
}

function unitNode(id) {
  if (id == null) return null;
  var esc = window.CSS && CSS.escape ? CSS.escape(String(id)) : String(id);
  return document.querySelector('.rpg-monster[data-id="' + esc + '"]') || document.querySelector('.rpg-fighter[data-id="' + esc + '"]');
}

// A number (or a word) flying up from a hero or a monster
function floatOver(id, text, kind) {
  var node = unitNode(id);
  var arena = document.querySelector(".rpg-arena");
  if (!node || !arena) return;
  var a = arena.getBoundingClientRect();
  var r = node.getBoundingClientRect();
  var f = el("div", "rpg-float " + kind, text);
  f.style.left = r.left - a.left + r.width / 2 + (Math.random() * 30 - 15) + "px";
  f.style.top = r.top - a.top + r.height * 0.35 + "px";
  arena.appendChild(f);
  setTimeout(() => f.remove(), 1100);
}

// A class for a moment (ms: 0 - it stays, the next state of the page takes it away)
function flash(id, className, ms) {
  var node = unitNode(id);
  if (!node) return;
  node.classList.remove(className);
  void node.offsetWidth;
  node.classList.add(className);
  if (ms !== 0) setTimeout(() => node.classList.remove(className), ms || 450);
}

// The HP bar of a unit, as the playback goes (the state shown is the old one until the end)
function barBy(id, delta) {
  var node = unitNode(id);
  var unit = party && party.run && (party.run.monsters.find((m) => m.id == id) || party.run.heroes.find((h) => h.name == id));
  if (!node || !unit) return;
  unit.hp = Math.max(0, Math.min(unit.maxHp, unit.hp + delta));
  var fill = node.querySelector(".rpg-bar-fill");
  var text = node.querySelector(".rpg-bar-text");
  if (fill) fill.style.width = (unit.hp / unit.maxHp) * 100 + "%";
  if (text) text.innerText = formatCoins(unit.hp) + " / " + formatCoins(unit.maxHp);
}

// A big word over the scene: "Monsters' turn", "Your turn", "Victory!"
function banner(text, kind, ms) {
  var arena = document.querySelector(".rpg-arena");
  if (!arena) return;
  arena.querySelectorAll(".rpg-banner").forEach((b) => b.remove());
  var b = el("div", "rpg-banner " + kind, text);
  b.style.animationDuration = (ms || 1000) + "ms";
  arena.appendChild(b);
  setTimeout(() => b.remove(), ms || 1000);
}

// A card played: it shows over the scene for a moment
function showPlayed(e) {
  var arena = document.querySelector(".rpg-arena");
  if (!arena || !rules.cards[e.card.replace(/\+$/, "")]) return;
  var node = cardEl(e.card, { className: "small rpg-played" + (e.by == myName ? " mine" : "") });
  if (e.by != myName) node.appendChild(el("span", "rpg-played-by", e.by));
  arena.appendChild(node);
  setTimeout(() => node.remove(), 900);
}

// One event shown
function showFx(e, live) {
  if (e.k == "card") showPlayed(e);
  else if (e.k == "hit") {
    floatOver(e.to, "-" + e.n + (e.crit ? "!" : ""), e.dot ? "dot " + e.dot : e.crit ? "crit" : "hit");
    if (e.b) floatOver(e.to, "🛡️ " + e.b, "blocked");
    flash(e.to, "rpg-hit", 420);
    if (!live) barBy(e.to, -e.n);
  } else if (e.k == "miss") floatOver(e.to, e.dodge ? "Dodge" : "Miss", "miss");
  else if (e.k == "heal") {
    floatOver(e.to, "+" + e.n, "heal");
    if (!live) barBy(e.to, e.n);
  } else if (e.k == "block") floatOver(e.to, "🛡️ +" + e.n, "block");
  else if (e.k == "down") flash(e.to, "rpg-dying", 0);
  else if (e.k == "move") {
    flash(e.by, e.move == "stunned" ? "rpg-stunned-act" : "rpg-acting", 520);
    if (e.move == "stunned") floatOver(e.by, "💫 Stunned", "miss");
    else if (rules.moves[e.move] && rules.moves[e.move].self) floatOver(e.by, rules.moves[e.move].icon + " " + rules.moves[e.move].name, "move");
  } else if (e.k == "turn") {
    if (e.side == "foes") banner("Monsters' turn", "foes", 900);
    else banner(e.first ? "⚔️ Fight!" : "Your turn", "heroes", 900);
  } else if (e.k == "victory") {
    banner("Victory!", "victory", 1500);
    holdModal = Date.now() + 1500;
  } else if (e.k == "defeat") banner("Defeat", "defeat", 1800);
}

// The events in beats: the hero's cards at once - every monster's move a beat of its own
function playFx(events, done) {
  var live = !done;
  if (live) {
    events.forEach((e) => showFx(e, true));
    return;
  }
  // (the hand waits meanwhile)
  var runNode = document.getElementById("rpgRun");
  runNode.classList.add("fx-busy");
  var finish = done;
  done = () => {
    runNode.classList.remove("fx-busy");
    finish();
  };
  var beats = [[]];
  events.forEach((e) => {
    if (e.k == "move" || e.k == "victory" || e.k == "defeat" || (e.k == "turn" && e.side == "heroes")) beats.push([]);
    beats[beats.length - 1].push(e);
  });
  beats = beats.filter((b) => b.length);
  var at = 0;
  beats.forEach((beat) => {
    setTimeout(() => {
      beat.forEach((e, i) => setTimeout(() => showFx(e, false), e.k == "move" ? 0 : i * 90 + (beat[0].k == "move" ? 240 : 0)));
    }, at);
    var first = beat[0];
    at += first.k == "move" ? 650 : first.k == "turn" ? (first.side == "foes" ? 750 : 0) : first.k == "victory" ? 1500 : first.k == "defeat" ? 1800 : 450;
  });
  setTimeout(done, at + 150);
}

/* ---------- The page ---------- */

function render() {
  if (!rules || !hero) return;
  var home = party == null;
  var lobby = party != null && !party.started;
  if (!VIEWS.some(([id]) => id == view) || !hero.cls) view = "play";
  var building = home && view == "deck";
  var shopping = home && view == "shop";
  document.getElementById("rpgTop").hidden = !home;
  var homeNode = document.getElementById("rpgHome");
  homeNode.hidden = !home || building || shopping;
  homeNode.dataset.view = view;
  document.getElementById("rpgBuilder").hidden = !building;
  document.getElementById("rpgShop").hidden = !shopping;
  document.getElementById("rpgLobby").hidden = !lobby;
  document.getElementById("rpgRun").hidden = home || lobby;
  if (home || lobby) document.getElementById("rpgModal").hidden = true;
  // (no class yet: the first one is picked in a popup)
  var first = home && !hero.cls;
  document.getElementById("rpgFirst").hidden = !first;
  if (first) renderFirst();
  if (home) renderTop();
  if (building) renderBuilder();
  else if (shopping) renderShop();
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
  if (item.agi) parts.push("+" + item.agi + "% dodge");
  if (item.luck) parts.push("+" + item.luck + "% luck");
  if (item.deckMax) parts.push("🃏 +" + item.deckMax + " deck size");
  if (item.deckMin) parts.push("🃏 -" + item.deckMin + " fewest cards");
  return parts.join(" · ");
}

var SLOT_ICONS = { weapon: "⚔️", armor: "🛡️", charm: "💍" };

// A piece of gear as a tile: the slot, the picture, the name, its stats (better / worse than the one worn), the
// classes it fits, the buttons
function gearTile(item, slot, actions) {
  var tile = el("div", "rpg-gear-tile rarity-" + item.rarity);
  tile.appendChild(el("span", "rpg-gear-slot", (slot ? SLOT_NAMES[slot] : SLOT_NAMES[item.slot]) + " · " + RARITY_NAMES[item.rarity]));
  tile.append(el("span", "rpg-gear-icon", item.icon), el("span", "rpg-gear-name", item.name));
  var chips = el("div", "rpg-gear-stats");
  var worn = !slot && hero.gear[item.slot];
  [["atk", "⚔️", ""], ["def", "🛡️", ""], ["hp", "❤️", ""], ["agi", "🪶", "%"], ["luck", "🍀", "%"]].forEach(([key, icon, unit]) => {
    if (!item[key] && !(worn && worn[key])) return;
    var diff = worn ? (item[key] || 0) - (worn[key] || 0) : 0;
    var chip = el("span", "rpg-gear-chip" + (!item[key] ? " none" : ""), icon + " " + (item[key] || 0) + unit);
    if (worn && diff) chip.appendChild(el("i", diff > 0 ? "up" : "down", (diff > 0 ? "▲" : "▼") + Math.abs(diff)));
    chips.appendChild(chip);
  });
  if (item.deckMax) chips.appendChild(el("span", "rpg-gear-chip", "🃏 +" + item.deckMax + " deck"));
  if (item.deckMin) chips.appendChild(el("span", "rpg-gear-chip", "🃏 -" + item.deckMin + " needed"));
  tile.appendChild(chips);
  if (item.classes) tile.appendChild(el("span", "rpg-gear-classes", item.classes.map((id) => rules.classes[id].icon + " " + rules.classes[id].name).join(" · ")));
  var row = el("div", "rpg-gear-actions");
  actions.forEach((a) => row.appendChild(a));
  tile.appendChild(row);
  return tile;
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

// The sections of the home: [id, the button]
var VIEWS = [
  ["play", "⚔️ Play"],
  ["hero", "🦸 Character"],
  ["talents", "⭐ Talents"],
  ["gear", "🎒 Gear"],
  ["deck", "🃏 Deck"],
  ["shop", "🛒 Shop"],
];

// What waits for the player in a section (a badge on its button): [text, "warn" | "new"] or null
function viewBadge(id) {
  if (!hero.cls) return null;
  if (id == "hero" && hero.points) return ["+" + hero.points, "new"];
  if (id == "talents" && rules.talentLevels.some((lv, tier) => hero.level >= lv && !hero.talents[tier])) return ["!", "new"];
  if (id == "gear" && hero.bag.length) return [String(hero.bag.length), ""];
  if (id == "deck") return [String(hero.deck.length), hero.deck.length < hero.deckMin || hero.deck.length > hero.deckMax ? "warn" : ""];
  if (id == "shop") {
    var packs = Object.values(hero.packs || {}).reduce((a, b) => a + b, 0);
    return packs ? [packs + " 🎴", "new"] : null;
  }
  return null;
}

function setView(id) {
  view = id;
  remember(VIEW_KEY, id);
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// On top of every section: the hero (class, level, potions) and the sections
function renderTop() {
  var picked = !!hero.cls;
  var mine = rules.classes[hero.cls || "warrior"];
  morphChildren(
    document.getElementById("rpgNav"),
    VIEWS.map(([id, label]) => {
      var b = button(label, "view", { id: id, className: "rpg-nav-btn" + (view == id ? " active" : "") });
      var badge = viewBadge(id);
      if (badge) b.appendChild(el("span", "rpg-nav-badge " + badge[1], badge[0]));
      return b;
    }),
  );
  document.getElementById("rpgHeroName").innerText = picked ? mine.icon + " " + mine.name : "Pick your class";
  document.getElementById("rpgHeroSub").innerText = picked ? "Deepest floor " + hero.deepest + " · " + hero.cleared + " / " + hero.runs + " runs cleared" : "";
  // The hero's level: XP from the fights - every level a stat point, talents at levels 3 to 50
  var xpBox = document.getElementById("rpgXp");
  xpBox.hidden = !picked;
  xpBox.title = "XP: every fight won (hard fights and the guarded gate more, deeper floors more) and every floor cleared (the first time: twice) - a run lost: half. Every level: a stat point; talents at levels " + rules.talentLevels.join(", ") + ". At most level " + rules.heroLevelMax + ".";
  var top = hero.level >= rules.heroLevelMax;
  if (picked) morphChildren(xpBox, [el("span", "rpg-level", "Lv " + hero.level), top ? el("span", "rpg-max mm-muted small", "Max level") : bar(hero.xp, hero.xpNeed, "xp", " XP"), hero.points ? el("span", "rpg-points", "+" + hero.points + " point" + (hero.points == 1 ? "" : "s")) : null]);
  document.getElementById("rpgPotions").innerText = "🧪 " + hero.potions + " / " + rules.potionsMax;
  var buy = document.getElementById("rpgBuyPotion");
  buy.innerText = "+ 🪙 " + formatCoins(hero.potionPrice);
  buy.title = "A potion: heals 40% HP - in a fight or between the rooms";
  buy.disabled = hero.potions >= rules.potionsMax || myCoins < hero.potionPrice;
}

function renderHero() {
  var picked = !!hero.cls;
  var mine = rules.classes[hero.cls || "warrior"];
  document.querySelectorAll(".rpg-pane").forEach((p) => (p.hidden = p.dataset.pane != view));

  // The class: a dropdown - every class a character of its own (the first free, the others to unlock)
  var current = el("button", "rpg-class-pick" + (classMenu ? " open" : ""));
  current.type = "button";
  current.dataset.act = "classMenu";
  current.append(el("span", "rpg-class-icon", picked ? mine.icon : "❔"), el("span", "rpg-class-name", picked ? mine.name : "Pick a class"), el("span", "rpg-class-note", picked ? "Lv " + hero.chars[hero.cls].level + " · floor " + hero.chars[hero.cls].deepest : ""), el("span", "rpg-class-caret", "▾"));
  var pickNodes = [current];
  if (classMenu) {
    var menu = el("div", "rpg-class-menu");
    Object.keys(rules.classes).forEach((id) => {
      var cls = rules.classes[id];
      var open = hero.unlocked.includes(id);
      var char = hero.chars[id];
      var row = el("button", "rpg-class-option" + (hero.cls == id ? " active" : "") + (open ? "" : " locked"));
      row.type = "button";
      row.dataset.act = open ? "class" : "unlock";
      row.dataset.id = id;
      row.append(el("span", "rpg-class-icon", cls.icon), el("span", "rpg-class-name", cls.name), el("span", "rpg-class-note", open ? "Lv " + char.level + " · floor " + char.deepest + (char.deadFor > 0 ? " · 💀" : "") : hero.classPrice ? "🔒 🪙 " + formatCoins(hero.classPrice) : "Free"));
      menu.appendChild(row);
    });
    pickNodes.push(menu);
  }
  morphChildren(document.getElementById("rpgClasses"), pickNodes);
  var info = [];
  if (picked) {
    var strength = el("div", "rpg-class-strength");
    strength.append(el("span", "rpg-strength-icon", mine.strength.icon), el("b", "", mine.strength.name), el("span", "", mine.strength.text));
    info.push(el("div", "rpg-class-about", mine.about), strength);
  } else info.push(el("div", "rpg-class-about first", "Your first class is free."));
  morphChildren(document.getElementById("rpgClassInfo"), info);
  document.getElementById("rpgStats").hidden = !picked;
  var stats = Object.keys(rules.stats).map((id) => {
    var stat = rules.stats[id];
    var cost = hero.upgrades[id];
    // (the main stat of the class: its levels count more)
    var main = mine.main == id;
    var row = el("div", "rpg-stat" + (main ? " main" : ""));
    var name = el("div", "rpg-stat-name");
    name.append(el("span", "rpg-stat-icon", stat.icon), el("span", "", stat.name), el("span", "rpg-stat-level", "Lv " + hero.levels[id]));
    name.title = stat.desc;
    if (main) {
      var star = el("span", "rpg-stat-main", "★ " + mine.name);
      star.title = "The main stat of your class: its levels count " + rules.mainBonus + "x";
      name.appendChild(star);
    }
    var head = el("div", "rpg-stat-head");
    head.append(name, el("div", "rpg-stat-desc", stat.desc));
    row.append(head, el("div", "rpg-stat-value", statValue(id)));
    // (a stat point: a free level - else coins)
    if (cost == null) row.appendChild(el("span", "rpg-stat-max mm-muted", "Max"));
    else if (hero.points > 0) row.appendChild(button("+1 free", "point", { id: id, className: "small point", title: stat.about }));
    else row.appendChild(button("+ 🪙 " + formatCoins(cost), "upgrade", { id: id, className: "small", disabled: cost > myCoins, title: stat.about }));
    return row;
  });
  morphChildren(document.getElementById("rpgStats"), stats);

  // Talents: one of two per tier - open at the talent levels (3 to 50)
  morphChildren(
    document.getElementById("rpgTalents"),
    picked
      ? (rules.talents[hero.cls] || []).map((options, tier) => {
          var lv = rules.talentLevels[tier];
          var open = hero.level >= lv;
          var row = el("div", "rpg-talent-tier" + (open ? "" : " closed") + (open && !hero.talents[tier] ? " ready" : ""));
          var level = el("div", "rpg-talent-level");
          level.append(el("b", "", String(lv)), el("span", "", open ? (hero.talents[tier] ? "✓" : "pick") : "Lv"));
          row.appendChild(level);
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
            var words = el("span", "rpg-talent-words");
            words.append(el("b", "", t.name), el("span", "", t.text));
            tile.append(el("span", "rpg-talent-icon", t.icon), words);
            pair.appendChild(tile);
          });
          row.appendChild(pair);
          return row;
        })
      : [el("div", "rpg-empty mm-muted", "Pick a class first.")],
  );

  // Gear: the three slots - the bag below (a piece of another class: only to sell)
  var gear = Object.keys(SLOT_NAMES).map((slot) => {
    var item = hero.gear[slot];
    if (!item) {
      var empty = el("div", "rpg-gear-tile empty");
      empty.append(el("span", "rpg-gear-slot", SLOT_NAMES[slot]), el("span", "rpg-gear-icon", SLOT_ICONS[slot]), el("span", "rpg-gear-name mm-muted", "Empty"));
      return empty;
    }
    return gearTile(item, slot, [button("Take off", "unequip", { id: slot, className: "small" })]);
  });
  morphChildren(document.getElementById("rpgGear"), gear);
  var bag = hero.bag.length
    ? hero.bag.map((item) => {
        var wrong = item.classes && !item.classes.includes(hero.cls);
        var tile = gearTile(item, null, [button("Equip", "equip", { id: item.id, className: "small", disabled: wrong }), button("Sell 🪙 " + formatCoins(item.value), "sell", { id: item.id, className: "small" })]);
        if (wrong) tile.classList.add("wrong");
        return tile;
      })
    : [el("div", "rpg-empty mm-muted", "Empty - chests drop gear.")];
  document.getElementById("rpgBagLabel").innerText = "Bag · " + hero.bag.length + " / " + hero.bagSize;
  morphChildren(document.getElementById("rpgBag"), bag);

  if (view == "play" && picked) renderReady();
}

// Ready to go down? Every thing that still waits - with a button to it
function renderReady() {
  var items = [];
  var item = (icon, text, state, act, id, label) => {
    var row = el("div", "rpg-ready-item " + state);
    row.append(el("span", "rpg-ready-icon", icon), el("span", "rpg-ready-text", text));
    if (act) row.appendChild(button(label, act, { id: id, className: "small" + (state == "warn" ? " primary" : "") }));
    items.push(row);
  };
  var n = hero.deck.length;
  if (n < hero.deckMin) item("🃏", "Your deck has " + n + " cards - it needs " + hero.deckMin + " to go down", "warn", "view", "deck", "Build it");
  else if (n > hero.deckMax) item("🃏", "Your deck has " + n + " cards - " + hero.deckMax + " at most", "warn", "view", "deck", "Build it");
  else item("🃏", "Deck ready: " + n + " cards (" + hero.deckMin + " to " + hero.deckMax + ")", "ok", "view", "deck", "Edit");
  if (hero.deadFor > 0) item("💀", "Dead - back in " + duration(hero.deadFor - (Date.now() - heroAt)), "warn", "revive", null, "Revive · 🪙 " + formatCoins(hero.revivePrice));
  item("🧪", hero.potions + " / " + rules.potionsMax + " potions - they heal 40% in a run", hero.potions ? "ok" : "warn", hero.potions < rules.potionsMax ? "potion" : null, null, "+1 · 🪙 " + formatCoins(hero.potionPrice));
  if (hero.points) item("⬆️", hero.points + " stat point" + (hero.points == 1 ? "" : "s") + " to spend", "new", "view", "hero", "Spend");
  if (rules.talentLevels.some((lv, tier) => hero.level >= lv && !hero.talents[tier])) item("⭐", "A talent to pick", "new", "view", "talents", "Pick");
  var packs = Object.values(hero.packs || {}).reduce((a, b) => a + b, 0);
  if (packs) item("🎴", packs + " pack" + (packs == 1 ? "" : "s") + " to open", "new", "view", "shop", "Open");
  if (hero.bag.length) item("🎒", hero.bag.length + " item" + (hero.bag.length == 1 ? "" : "s") + " in the bag", "", "view", "gear", "Look");
  var found = hero.pool.filter((id) => hero.collection[id]).length;
  item("📚", "Collection: " + found + " / " + hero.pool.length + " cards", "", "view", "shop", "Packs");
  morphChildren(document.getElementById("rpgReady"), items);
}

// The deck in short: the mana curve, attacks and skills - too few cards: a warning
function deckSummary(deck) {
  var attacks = deck.filter((id) => cardOf(id).type == "attack").length;
  var nodes = [curve(deck), el("div", "mm-muted small", attacks + " attacks · " + (deck.length - attacks) + " skills")];
  if (deck.length < hero.deckMin) nodes.push(el("div", "rpg-warn", "⚠️ At least " + hero.deckMin + " cards to go down - " + (hero.deckMin - deck.length) + " more"));
  if (deck.length > hero.deckMax) nodes.push(el("div", "rpg-warn", "⚠️ At most " + hero.deckMax + " cards - take " + (deck.length - hero.deckMax) + " out"));
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

/* ---------- The first class: a popup ---------- */

function renderFirst() {
  var stat = (id) => rules.stats[id];
  var tiles = Object.keys(rules.classes).map((id) => {
    var cls = rules.classes[id];
    var tile = el("button", "rpg-first-class");
    tile.type = "button";
    tile.dataset.act = "unlock";
    tile.dataset.id = id;
    var main = stat(cls.main);
    // What the class is good at: its main stat, how it differs
    var chips = el("div", "rpg-first-chips");
    var chip = (text, good, tip) => {
      var c = el("span", "rpg-first-chip" + (good ? " good" : good === false ? " bad" : ""), text);
      c.title = tip;
      chips.appendChild(c);
    };
    chip("❤️ " + Math.round(cls.hp * 100) + "% HP", cls.hp > 1 ? true : cls.hp < 1 ? false : null, "Max HP of the class");
    chip("⚔️ " + Math.round(cls.atk * 100) + "% attack", cls.atk > 1 ? true : cls.atk < 1 ? false : null, "Attack of the class");
    if (cls.def) chip("🛡️ +" + cls.def + " armor", true, "Armor from the start");
    if (cls.luck) chip("🍀 +" + cls.luck + "% luck", true, "Crits, sensing rooms, loot");
    if (cls.agi) chip("🪶 +" + cls.agi + "% dodge", true, "Dodge attacks");
    var cards = el("div", "rpg-first-cards");
    cls.signature.forEach((card) => cards.appendChild(cardEl(card, { className: "small" })));
    tile.append(
      el("span", "rpg-first-icon", cls.icon),
      el("span", "rpg-first-name", cls.name),
      el("span", "rpg-first-main", "★ " + main.icon + " " + main.name),
      el("span", "rpg-first-about", cls.about),
      el("span", "rpg-first-strength", cls.strength.icon + " " + cls.strength.name + ": " + cls.strength.text),
      chips,
      el("span", "rpg-label", "Signature cards"),
      cards,
      el("span", "rpg-first-pick", "Choose " + cls.name),
    );
    return tile;
  });
  var grid = el("div", "rpg-first-grid");
  tiles.forEach((t) => grid.appendChild(t));
  morphChildren(document.getElementById("rpgFirstBox"), [
    el("div", "rpg-first-title", "⚔️ Choose your class"),
    el("div", "rpg-first-sub mm-muted", "The first one is free - every other 🪙 " + formatCoins(rules.classPrice) + "."),
    grid,
  ]);
}

/* ---------- The card shop: booster packs of the base set ---------- */

// The chance of every rarity on a card of a pack (not the guaranteed ones) - by the weights of my class's cards
function packOdds(pack) {
  var weights = {};
  var total = 0;
  hero.pool.forEach((id) => {
    var rarity = cardOf(id).rarity;
    if (rarity == "basic") return;
    var w = rules.cardRarities[rarity].weight * (pack.boost[rarity] || 1);
    weights[rarity] = (weights[rarity] || 0) + w;
    total += w;
  });
  return RARITY_ORDER.filter((r) => weights[r]).map((r) => [r, (weights[r] / total) * 100]);
}

var cart = {}; // the shop's cart: {pack id: count}

// The price of packs of a kind (as the server counts it): 3 or more - 10% off
function packCost(id, n) {
  var price = rules.packs[id].price * n;
  return n >= rules.packBundle ? Math.round((price * (1 - rules.bundleOff)) / 100) * 100 : price;
}

// A sealed pack (the art): the shop, the packs waiting, the opening
function packArt(id, className) {
  var pack = rules.packs[id];
  var art = el("div", "rpg-pack-art tier-" + id + (className ? " " + className : ""));
  art.append(el("span", "rpg-pack-set", "BASE SET"), el("span", "rpg-pack-icon", pack.icon), el("span", "rpg-pack-count", pack.size + " cards"));
  return art;
}

function renderShop() {
  var cls = rules.classes[hero.cls];
  // Upgrades: more room in the bag
  var slot = el("div", "rpg-upgrade");
  var price = hero.bagSlotPrice;
  slot.append(el("span", "rpg-upgrade-icon", "🎒"), el("div", "rpg-upgrade-text"));
  slot.lastChild.append(el("b", "", "Bag slot"), el("span", "mm-muted small", hero.bagSize + " / " + rules.bagTop + " slots"));
  slot.appendChild(price == null ? el("span", "rpg-upgrade-max mm-muted", "Max") : button("+1 · 🪙 " + formatCoins(price), "bagSlot", { className: "small primary", disabled: price > myCoins }));
  morphChildren(document.getElementById("rpgShopUpgrades"), [slot]);
  document.getElementById("rpgShopTitle").innerText = "🛒 Card shop · " + cls.icon + " " + cls.name;
  // The collection: the cards found, the copies
  var cards = hero.pool.filter((id) => cardOf(id).rarity != "basic");
  var found = cards.filter((id) => hero.collection[id]).length;
  var copies = cards.reduce((sum, id) => sum + (hero.collection[id] || 0), 0);
  var most = cards.reduce((sum, id) => sum + rules.cardRarities[cardOf(id).rarity].copies, 0);
  var progress = el("div", "rpg-shop-bar");
  progress.append(el("span", "", "📚 Collection"), bar(found, cards.length, "xp", " cards"), el("span", "mm-muted small", copies + " / " + most + " copies"));
  morphChildren(document.getElementById("rpgShopProgress"), [progress]);

  // The packs bought, waiting to be opened
  var owned = Object.keys(rules.packs).filter((id) => hero.packs[id] > 0);
  morphChildren(
    document.getElementById("rpgShopOwned"),
    owned.length
      ? owned.map((id) => {
          var stack = el("button", "rpg-owned tier-" + id);
          stack.type = "button";
          stack.dataset.act = "openPack";
          stack.dataset.id = id;
          stack.title = "Open a " + rules.packs[id].name;
          var art = packArt(id, "small");
          art.appendChild(el("span", "rpg-owned-n", "×" + hero.packs[id]));
          stack.append(art, el("span", "rpg-owned-open", "Open"));
          return stack;
        })
      : [el("div", "rpg-empty mm-muted", "No packs waiting - put some into your cart and buy them.")],
  );
  var waiting = Object.values(hero.packs || {}).reduce((a, b) => a + b, 0);
  // (open all: in the heading of the packs waiting)
  morphChildren(document.getElementById("rpgOpenAllSlot"), waiting > 1 ? [button("🎴 Open all (" + waiting + ")", "openAll", { className: "small primary" })] : []);

  // The packs to buy: into the cart
  morphChildren(
    document.getElementById("rpgShopPacks"),
    Object.keys(rules.packs).map((id) => {
      var pack = rules.packs[id];
      var tile = el("div", "rpg-pack-tile tier-" + id);
      var odds = el("div", "rpg-pack-odds");
      packOdds(pack).forEach(([rarity, pct]) => {
        var row = el("div", "rpg-odd rarity-" + rarity);
        row.append(el("span", "", rules.cardRarities[rarity].name), el("b", "", (pct < 1 ? pct.toFixed(1) : Math.round(pct)) + "%"));
        odds.appendChild(row);
      });
      var inCart = cart[id] || 0;
      tile.append(
        packArt(id),
        el("div", "rpg-pack-name", pack.name),
        el("div", "rpg-pack-price", "🪙 " + formatCoins(pack.price)),
        el("div", "mm-muted small", pack.about),
        el("div", "rpg-label", "Every other card"),
        odds,
        button(inCart ? "+ One more (" + inCart + " in the cart)" : "🛒 Add to cart", "cartAdd", { id: id, className: "primary" }),
      );
      return tile;
    }),
  );

  // The cart: the lines, the total - buy
  var lines = Object.keys(cart).filter((id) => cart[id] > 0);
  var total = lines.reduce((sum, id) => sum + packCost(id, cart[id]), 0);
  var nodes = [el("div", "rpg-cart-title", "🛒 Your cart")];
  if (!lines.length) nodes.push(el("div", "rpg-empty mm-muted", "Empty - add packs. 3 or more of a kind: 10% off."));
  lines.forEach((id) => {
    var pack = rules.packs[id];
    var row = el("div", "rpg-cart-line");
    var step = el("div", "rpg-stepper");
    step.append(button("−", "cartLess", { id: id, className: "small" }), el("b", "", String(cart[id])), button("+", "cartAdd", { id: id, className: "small", disabled: cart[id] >= rules.cartMax }));
    var price = el("div", "rpg-cart-price");
    price.appendChild(el("b", "", "🪙 " + formatCoins(packCost(id, cart[id]))));
    if (cart[id] >= rules.packBundle) price.appendChild(el("span", "rpg-cart-off", "-10%"));
    row.append(el("span", "rpg-cart-icon", pack.icon), el("span", "rpg-cart-name", pack.name), step, price);
    nodes.push(row);
  });
  if (lines.length) {
    var sum = el("div", "rpg-cart-total");
    sum.append(el("span", "", "Total"), el("b", "", "🪙 " + formatCoins(total)));
    nodes.push(sum, button("Buy · 🪙 " + formatCoins(total), "cartBuy", { className: "primary", disabled: total > myCoins }), button("Empty the cart", "cartClear", { className: "small" }));
    if (total > myCoins) nodes.push(el("div", "rpg-warn", "Not enough coins."));
  }
  morphChildren(document.getElementById("rpgCart"), nodes);

}

/* ---------- Opening a pack (like Hearthstone): the pack bursts, the cards lie face down - one flip after the other */

var opening = null; // {pack, cards (null: the pack still sealed), flipped: {index: true}}

function openingNode() {
  var node = document.getElementById("rpgOpening");
  if (!node) {
    node = el("div", "rpg-opening");
    node.id = "rpgOpening";
    node.addEventListener("click", onOpeningClick);
  }
  // (full screen: inside it - else nothing of it would show)
  var host = document.fullscreenElement || document.body;
  if (node.parentNode != host) host.appendChild(node);
  return node;
}

// Every pack waiting at once: one big stack - a click opens them all
function startOpeningAll() {
  var count = Object.values(hero.packs || {}).reduce((a, b) => a + b, 0);
  if (!count) return;
  opening = { pack: "all", art: bestWaiting(), count: count, cards: null, flipped: {}, asked: false };
  renderOpening();
}

// The pack waits sealed: a click opens it (the server deals its cards)
function startOpening(id) {
  if (!(hero.packs[id] > 0)) return;
  opening = { pack: id, cards: null, flipped: {}, asked: false };
  renderOpening();
}

// The best kind of the packs waiting (the art of "open all")
function bestWaiting() {
  return Object.keys(rules.packs)
    .reverse()
    .find((id) => hero.packs[id] > 0) || "standard";
}

// The same card more than once in an opening: one card with a count (n) - new if one of them is
function stackCards(cards) {
  var stacks = [];
  cards.forEach((c) => {
    var same = stacks.find((one) => one.id == c.id);
    if (same) {
      same.n++;
      same.fresh = same.fresh || c.fresh;
    } else stacks.push({ id: c.id, n: 1, fresh: c.fresh });
  });
  return stacks;
}

// The buttons under the cards: "Turn all" - all turned: the next pack, the others, done
function openingFoot() {
  var all = opening.pack == "all";
  var pack = all ? { name: "packs" } : rules.packs[opening.pack];
  var turned = opening.cards.every((c, i) => opening.flipped[i]);
  var left = all ? 0 : hero.packs[opening.pack] || 0;
  var foot = el("div", "rpg-opening-foot");
  if (!turned) foot.appendChild(button("Turn all", "flipAll", { className: "small" }));
  else {
    if (left) foot.appendChild(button("Open the next " + pack.name + " (" + left + " left)", "openNext", { className: "primary" }));
    var rest = Object.values(hero.packs || {}).reduce((a, b) => a + b, 0);
    if (rest > 1) foot.appendChild(button("🎴 Open all the rest (" + rest + ")", "openAllNext", {}));
    Object.keys(rules.packs)
      .filter((id) => id != opening.pack && hero.packs[id] > 0)
      .forEach((id) => foot.appendChild(button("Open a " + rules.packs[id].name + " (" + hero.packs[id] + ")", "openOther", { id: id })));
    foot.appendChild(button("Done", "openDone", {}));
  }
  return foot;
}

// A card turned over - in place (the others stay as they are)
function flipSlot(slot) {
  var i = Number(slot.dataset.flip);
  opening.flipped[i] = true;
  slot.classList.add("flipped");
  var c = opening.cards[i];
  if (!slot.querySelector(".rpg-flip-note")) slot.appendChild(el("span", "rpg-flip-note" + (c.fresh ? " fresh" : ""), c.fresh ? "New!" : "Duplicate"));
}

function refreshOpeningFoot() {
  var old = openingNode().querySelector(".rpg-opening-foot");
  if (old) old.replaceWith(openingFoot());
}

function renderOpening() {
  var node = openingNode();
  if (!opening) {
    node.remove();
    return;
  }
  node.innerHTML = "";
  var all = opening.pack == "all";
  var pack = all ? { name: "All your packs" + (opening.count ? " (" + opening.count + ")" : ""), icon: "🎴" } : rules.packs[opening.pack];
  var stage = el("div", "rpg-opening-stage");
  if (!opening.cards) {
    var art = packArt(all ? opening.art : opening.pack, "big" + (opening.asked ? " bursting" : " waiting"));
    if (all) art.appendChild(el("span", "rpg-owned-n big", "×" + opening.count));
    art.dataset.open = "pack";
    stage.append(el("div", "rpg-opening-title", pack.icon + " " + pack.name), art);
  } else {
    var row = el("div", "rpg-opening-cards n" + opening.cards.length + (opening.cards.length > 10 ? " many" : ""));
    opening.cards.forEach((c, i) => {
      var rarity = cardOf(c.id).rarity;
      var slot = el("div", "rpg-flip rarity-" + rarity + (opening.flipped[i] ? " flipped" : ""));
      slot.style.animationDelay = Math.min(i * (opening.cards.length > 10 ? 0.025 : 0.08), 1.5) + "s";
      slot.dataset.flip = String(i);
      var inner = el("div", "rpg-flip-inner");
      var back = el("div", "rpg-flip-back");
      back.appendChild(el("span", "rpg-flip-emblem", "⚔️"));
      var front = el("div", "rpg-flip-front");
      var card = cardEl(c.id, {});
      if (c.n > 1) card.appendChild(el("span", "rpg-stack-n", "×" + c.n));
      front.appendChild(card);
      inner.append(back, front);
      slot.appendChild(inner);
      if (opening.flipped[i]) slot.appendChild(el("span", "rpg-flip-note" + (c.fresh ? " fresh" : ""), c.fresh ? "New!" : "Duplicate"));
      row.appendChild(slot);
    });
    var foot = openingFoot();
    stage.append(el("div", "rpg-opening-title", pack.icon + " " + pack.name), row, foot);
  }
  node.appendChild(stage);
}

function onOpeningClick(event) {
  if (!opening) return;
  var target = event.target.closest("[data-open], [data-flip], [data-act]");
  if (!target) return;
  if (target.dataset.open == "pack" && !opening.asked) {
    opening.asked = true;
    renderOpening();
    if (opening.pack == "all") socket.emit("openAll");
    else socket.emit("openPack", { pack: opening.pack });
    return;
  }
  if (target.dataset.flip != null) {
    // (turned already: nothing)
    if (opening.flipped[target.dataset.flip]) return;
    flipSlot(target);
    // (all turned: the buttons after a moment)
    if (opening.cards.every((one, i) => opening.flipped[i])) setTimeout(() => opening && refreshOpeningFoot(), 650);
    return;
  }
  var act = target.dataset.act;
  if (act == "flipAll") {
    openingNode().querySelectorAll(".rpg-flip:not(.flipped)").forEach(flipSlot);
    refreshOpeningFoot();
  } else if (act == "openNext") startOpening(opening.pack);
  else if (act == "openAllNext") startOpeningAll();
  else if (act == "openOther") startOpening(target.dataset.id);
  else if (act == "openDone") {
    opening = null;
    renderOpening();
  }
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
  ["rarity", [["all", "Any rarity"], ["basic", "Basic"], ["common", "Common"], ["rare", "Rare"], ["epic", "Epic"], ["legendary", "Legendary"], ["mystic", "Mystic"]]],
];
var RARITY_ORDER = ["basic", "common", "rare", "epic", "legendary", "mystic"];
// By rarity (common first, mystic last) - then the cost, the name
var byRarity = (a, b) => RARITY_ORDER.indexOf(cardOf(a).rarity) - RARITY_ORDER.indexOf(cardOf(b).rarity) || cardOf(a).cost - cardOf(b).cost || cardOf(a).name.localeCompare(cardOf(b).name);
var byCost = (a, b) => cardOf(a).cost - cardOf(b).cost || RARITY_ORDER.indexOf(cardOf(a).rarity) - RARITY_ORDER.indexOf(cardOf(b).rarity) || cardOf(a).name.localeCompare(cardOf(b).name);

function renderBuilder() {
  morphChildren(document.getElementById("rpgDeckHelp"), deckHelp());
  var cls = rules.classes[hero.cls];
  document.getElementById("rpgBuilderTitle").innerText = "🃏 Deck builder · " + cls.icon + " " + cls.name;
  var deck = hero.deck;
  var counts = {};
  deck.forEach((id) => (counts[id] = (counts[id] || 0) + 1));
  var short = deck.length < hero.deckMin || deck.length > hero.deckMax;
  var count = document.getElementById("rpgBuilderCount");
  count.innerText = deck.length + " / " + hero.deckMax;
  count.className = "rpg-builder-count" + (short ? " bad" : deck.length >= hero.deckMax ? " full" : " ok");
  count.title = "At least " + hero.deckMin + ", at most " + hero.deckMax + " cards - a charm can make room for more, or let you go down with fewer";

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
  chips.push(button("Owned only", "filter", { id: "owned:toggle", className: "chip" + (filters.owned ? " active" : "") }));
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
    .sort(byRarity);
  morphChildren(
    document.getElementById("rpgBuilderGrid"),
    shown.length
      ? shown.map((id) => {
          var all = hero.collection[id] || 0;
          var owned = Math.min(all, rules.cardRarities[cardOf(id).rarity].copies);
          var spare = owned - (counts[id] || 0);
          var full = deck.length >= hero.deckMax;
          var node = cardEl(id, { act: spare > 0 && !full ? "deckAdd" : "", className: (owned ? "" : "unowned") + (spare > 0 && !full ? " pickable" : " spent") });
          if (spare > 0) node.dataset.drag = "in:" + id;
          node.draggable = spare > 0;
          var pips = el("span", "rpg-copies");
          for (var i = 0; i < Math.max(owned, 1); i++) pips.appendChild(el("i", i < (counts[id] || 0) ? "used" : i < owned ? "" : "none"));
          node.appendChild(pips);
          node.appendChild(el("span", "rpg-cardx-count", owned ? (counts[id] || 0) + " / " + owned + (all > owned ? " · +" + (all - owned) : "") : "🔒"));
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
          var row = el("div", "rpg-deck-row rarity-" + card.rarity + (card.mystic ? " mystic" : ""));
          row.dataset.act = "deckRemove";
          row.dataset.id = id;
          row.dataset.drag = "out:" + id;
          row.draggable = true;
          row.title = card.text + " - click or drag: out of the deck";
          var cost = el("span", "rpg-row-cost");
          cost.dataset.cost = String(card.cost);
          row.append(cost, el("span", "rpg-row-icon", card.icon), el("span", "rpg-row-name", card.name), el("span", "rpg-row-count", counts[id] > 1 ? "×" + counts[id] : card.mystic ? "★" : ""));
          return row;
        })
      : [el("div", "rpg-empty mm-muted", "Empty - click or drag cards in.")],
  );
  var attacks = deck.filter((id) => cardOf(id).type == "attack").length;
  morphChildren(document.getElementById("rpgBuilderNote"), [
    el("div", "mm-muted small", attacks + " attacks · " + (deck.length - attacks) + " skills"),
    deck.length < hero.deckMin
      ? el("div", "rpg-warn", "⚠️ At least " + hero.deckMin + " cards to go down - " + (hero.deckMin - deck.length) + " more")
      : deck.length > hero.deckMax
        ? el("div", "rpg-warn", "⚠️ At most " + hero.deckMax + " cards - take " + (deck.length - hero.deckMax) + " out")
        : el("div", "rpg-ok", "✓ Ready for the dungeon"),
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
  // (the party size: a segment each - its number, a figure for every hero)
  for (var n = 2; n <= rules.partyMax; n++) {
    var seg = button("", "size", { id: n, className: "rpg-seg-btn" + (n == size ? " active" : ""), title: n + " heroes" });
    seg.append(el("b", "", String(n)), el("span", "rpg-seg-figs", "👤".repeat(n)));
    seg.title = n + " heroes - harder monsters, " + Math.round(rules.partyLoot * 100 * (n - 1)) + "% more loot";
    sizes.push(seg);
  }
  morphChildren(document.getElementById("rpgSize"), sizes);

  var list = parties.length
    ? parties.map((p) => {
        var row = el("div", "rpg-party");
        var faces = el("div", "rpg-party-faces");
        p.members.forEach((name) => faces.appendChild(createAvatar(name, "sm")));
        // (the floor the party goes down to: a badge in front - out of reach: dimmed)
        var badge = el("div", "rpg-party-floor" + (p.floor > hero.maxFloor ? " locked" : ""));
        badge.append(el("span", "rpg-party-floor-label", "Floor"), el("b", "", String(p.floor)));
        badge.title = "Entry 🪙 " + formatCoins(rules.entries[p.floor - 1]) + " each";
        var text = el("div", "rpg-party-text");
        text.append(el("div", "rpg-party-name", p.leader + "'s party"), el("div", "mm-muted small", p.members.length + " / " + p.size + " heroes · entry 🪙 " + formatCoins(rules.entries[p.floor - 1]) + " · loot +" + Math.round(rules.partyLoot * 100 * (p.size - 1)) + "%"));
        row.append(badge, faces, text);
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
  var quit = document.getElementById("rpgQuit");
  quit.hidden = !!party.result;

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
var rewardView = "list"; // the rewards of a fight: the list - or the card / relic to pick
var spoilsDone = {}; // the rewards closed (by the room)
function renderModal(run, me) {
  var modal = document.getElementById("rpgModal");
  var nodes = null;
  var spoils = run.spoils;
  var open = run.phase == "between" && me && !party.result && spoils && spoils.room == run.rooms.length && !spoilsDone[spoils.room];
  // (the victory banner first)
  if (open && Date.now() < holdModal) {
    setTimeout(render, holdModal - Date.now() + 20);
    open = false;
  }
  if (open) {
    if (rewardView == "card" && me.reward) nodes = rewardPanel(me);
    else if (rewardView == "relic" && me.relicChoice) nodes = relicPanel(me);
    else nodes = spoilsPanel(run, me, spoils);
  }
  modal.hidden = !nodes;
  if (nodes) morphChildren(document.getElementById("rpgModalBox"), nodes);
}

// The rewards of a fight (like Slay the Spire): a list - the coins (in the pot already), a card to add, a relic
function spoilsPanel(run, me, spoils) {
  var list = el("div", "rpg-spoils");
  var row = (icon, text, act, id, done) => {
    var b = el(act ? "button" : "div", "rpg-spoil" + (done ? " done" : "") + (act ? " open" : ""));
    if (act) {
      b.type = "button";
      b.dataset.act = act;
      b.dataset.id = id;
    }
    b.append(el("span", "rpg-spoil-icon", icon), el("span", "rpg-spoil-text", text), el("span", "rpg-spoil-mark", done ? "✓" : act ? "›" : ""));
    list.appendChild(b);
  };
  row("🪙", formatCoins(spoils.coins) + " coins each - into the loot pot", null, null, true);
  row("⭐", "+" + spoils.xp + " XP", null, null, true);
  if (me.relicChoice) row("🏺", "Choose a relic", "rewardView", "relic");
  if (me.reward) row("🃏", "Add a card to your deck", "rewardView", "card");
  var left = !!(me.reward || me.relicChoice);
  return [el("div", "rpg-reward-title big", "⚔️ Victory!"), el("div", "rpg-reward-note mm-muted small", "Your rewards"), list, button(left ? "Skip the rest · Proceed" : "Proceed →", "spoilsDone", { id: String(spoils.room), className: left ? "small" : "primary" })];
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
      row.append(head, stats, relics, el("div", "mm-muted small", perks.length ? "Perks: " + perks.join(" · ") : "No perks yet"));
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
  return [el("div", "rpg-reward-title", "🏺 A relic - pick one for this run"), row, button("‹ Back", "rewardView", { id: "list", className: "small" })];
}

// The card won in a fight: one of three for the deck
function rewardPanel(me) {
  var cards = el("div", "rpg-reward-cards");
  me.reward.forEach((id) => cards.appendChild(cardEl(id, { tag: "button", act: "pick", className: "pickable" })));
  return [
    el("div", "rpg-reward-title", "🃏 Add a card to your deck"),
    el("div", "rpg-reward-note mm-muted small", "Three of your class's cards, not of your deck: the one you pick joins your deck for the rest of this run."),
    cards,
    button("Skip this card", "pick", { id: "", className: "small" }),
    button("‹ Back", "rewardView", { id: "list", className: "small" }),
  ];
}

// The rooms that aren't fights: a picture, a story, the choices - what happened
var ROOM_STORY = {
  chest: "A heavy chest in the middle of the room, its lock rusted through. Everyone may open it.",
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
  // What happened in the room (not at the merchant: "Sold ✓" shows it - the battle log keeps every buy)
  if (ev.lines.length && ev.kind != "merchant") {
    var box = el("div", "rpg-event-box");
    var lines = el("ul", "rpg-event-lines");
    ev.lines.forEach((line) => lines.appendChild(el("li", "", line)));
    box.append(el("div", "rpg-label", "What happened"), lines);
    body.appendChild(box);
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
  var nodes = [el("div", "rpg-shop-coins", "Your coins: 🪙 " + formatCoins(myCoins)), el("div", "rpg-label", "Cards · for this run only"), cards, el("div", "rpg-label", "Relics · for this run only"), relics, el("div", "rpg-label", "Services"), services];
  if (picking == "remove" && !offer.removed) nodes.push(...deckPicker(me, "Pick the card he takes out of your deck", "remove"));
  return nodes;
}

// The map of the floor (like Slay the Spire): rows from the bottom up - the rooms gone through, the ones to pick
// next (a vote), what is hidden ("?" - unless the party sensed it)
var MAP_ROW = 62;
var MAP_ROW_BIG = 84; // (choosing the next room: the map bigger)
function renderMap(run) {
  var rows = run.map;
  var lanes = rules.lanes;
  var choosing = run.phase == "between" && !party.result;
  document.querySelector(".rpg-run-body").classList.toggle("choosing", choosing);
  var rowH = choosing ? MAP_ROW_BIG : MAP_ROW;
  var height = rows.length * rowH;
  var x = (col) => ((col + 0.5) / lanes) * 100;
  var y = (r) => height - (r + 0.5) * rowH;
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
        if (run.heroes.length > 1) b.appendChild(el("span", "rpg-node-count", String(voters.length)));
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
  document.getElementById("rpgMapNote").innerText = party.result ? "" : between ? (run.heroes.length > 1 ? count + " / " + run.heroes.length + " voted · a tie: random" : "Pick a lit room") : "";
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
    ["🎁", "Grow it", "Every fight won: pick one of three new cards - or study, buy them in the rooms. They stay for the rest of that run; your collection grows with booster packs."],
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
  var potion = potionButton(me, run);
  if (run.phase == "between") {
    var voted = run.votes[myName];
    var count = Object.keys(run.votes).length;
    var leave = button("🚪 Leave with 🪙 " + formatCoins(run.pot), "vote", { id: "leave", className: voted === "leave" ? "voted" : "" });
    var leavers = Object.keys(run.votes).filter((name) => run.votes[name] === "leave");
    if (leavers.length) leave.innerText += " (" + leavers.length + ")";
    if (run.heroes.length < 2) return [potion, el("div", "rpg-wait mm-muted", "🗺️ Pick the next room on the map"), leave];
    // (who voted for what - a tie: random)
    var votes = el("div", "rpg-votes");
    run.heroes.forEach((h) => {
      var v = run.votes[h.name];
      var chip = el("span", "rpg-vote-chip" + (v != null ? " done" : "") + (h.away ? " away" : ""));
      var what = v == null ? (h.away ? "away" : "choosing…") : v === "leave" ? "🚪 leave" : (rules.roomKinds[run.doors[v].kind] || { icon: "?" }).icon + " " + ((rules.roomKinds[run.doors[v].kind] || {}).name || "Hidden");
      chip.append(createAvatar(h.name, "sm"), el("b", "", h.name), el("span", "", what));
      votes.appendChild(chip);
    });
    votes.appendChild(el("span", "rpg-votes-note mm-muted small", count + " / " + run.heroes.length + " · a tie: random"));
    return [potion, votes, leave];
  }
  if (!me || me.down) return [el("div", "rpg-wait mm-muted", "💤 You're down - back up after the fight (or a Cleric's revive).")];
  var energy = el("div", "rpg-energy" + (me.energy <= 0 ? " empty" : ""));
  energy.dataset.mana = me.energy + "/" + rules.energy;
  energy.title = "Mana - cards cost it, full again every turn";
  var draw = pileButton("draw", "🂠", me.drawCount, "Draw pile");
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
  var discard = pileButton("discard", "♻️", me.discardCount, "Discard pile");
  var exhausted = me.piles && me.piles.exhausted.length ? pileButton("exhausted", "🔥", me.piles.exhausted.length, "Exhausted - gone for this fight") : null;
  var tools = el("div", "rpg-hand-tools");
  tools.append(potion, discard);
  if (exhausted) tools.appendChild(exhausted);
  var right = el("div", "rpg-hand-side");
  right.append(end, tools);
  var nodes = [left, hand, right];
  if (aiming) nodes.unshift(el("div", "rpg-aim-hint", aiming.target == "foe" ? "🎯 Pick a foe" : "🎯 Pick an ally"));
  return nodes;
}

// A health potion: a red flask - its count, its mana in a fight
var POTION_SVG =
  '<svg viewBox="0 0 32 40" aria-hidden="true"><rect x="12" y="2" width="8" height="5" rx="1.5" fill="#a0703c"/><path d="M13 7h6v6.5a11 11 0 1 1-6 0z" fill="rgba(255,255,255,.18)" stroke="rgba(255,255,255,.55)" stroke-width="1.4"/><path d="M6.2 24a9.8 9.8 0 0 0 19.6 0z" fill="#e0344a"/><path d="M6.6 22.2c3-1.6 6.3 1.1 9.4 0s6.4-1.6 9.4 0A9.8 9.8 0 0 1 25.8 24H6.2c0-.6.1-1.2.4-1.8z" fill="#ff5a6e"/><path d="M14.2 27.6h3.6M16 25.8v3.6" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><ellipse cx="11" cy="19" rx="1.6" ry="3" fill="rgba(255,255,255,.55)" transform="rotate(25 11 19)"/></svg>';
function potionButton(me, run) {
  var fight = run.phase == "fight";
  var b = el("button", "rpg-potion-btn");
  b.type = "button";
  b.dataset.act = "drink";
  b.disabled = !me || me.down || me.potions <= 0 || me.hp >= me.maxHp || (fight && (me.ended || me.energy < rules.potionMana));
  b.title = "Health potion: +40% HP" + (fight ? " · " + rules.potionMana + " mana" : "");
  b.innerHTML = POTION_SVG;
  b.appendChild(el("span", "rpg-potion-count", String(me ? me.potions : 0)));
  if (fight) b.appendChild(el("span", "rpg-potion-mana", String(rules.potionMana)));
  return b;
}

// A pile to look into: its icon, its count
function pileButton(id, icon, count, title) {
  var b = button("", "pile", { id: id, className: "rpg-pile", title: title + " - click to look" });
  b.append(el("span", "rpg-pile-icon", icon), el("b", "", String(count)));
  return b;
}

// The hand fanned into the room it has: the cards overlap more the less room there is
function fitHand() {
  var hand = document.querySelector("#rpgHandBar .rpg-hand");
  var first = hand && hand.querySelector(".rpg-cardx");
  if (!first) return;
  var n = hand.querySelectorAll(".rpg-cardx").length;
  // (room left for the tilt of the outer cards)
  var squeeze = Math.max(5.6, (n * first.offsetWidth - (hand.clientWidth - 48)) / (2 * n));
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
    clock.title = "Time left for this turn";
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
    else if (t == "ally" && over.kind != "foe") socket.emit("play", { uid: current.uid, ally: myName });
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

// (a click anywhere else: the class dropdown closes)
document.addEventListener("click", (event) => {
  if (classMenu && !event.target.closest(".rpg-classes")) {
    classMenu = false;
    render();
  }
});

document.querySelector(".rpg-main").addEventListener("click", (event) => {
  if (dragged) return;
  var node = event.target.closest("[data-act]");
  if (!node || node.disabled) return;
  var act = node.dataset.act;
  var id = node.dataset.id;
  if (!act) return;
  if (act == "upgrade") socket.emit("upgrade", { stat: id });
  else if (act == "equip" || act == "sell") socket.emit(act, { id: id });
  else if (act == "unequip") socket.emit("unequip", { slot: id });
  else if (act == "join") socket.emit("join", { id: id });
  else if (act == "leave") socket.emit("leave");
  else if (act == "classMenu") {
    classMenu = !classMenu;
    render();
  } else if (act == "class") {
    classMenu = false;
    socket.emit("class", { id: id });
    render();
  } else if (act == "unlock") {
    classMenu = false;
    unlockClass(id);
  }
  else if (act == "buy") socket.emit("buy", { item: id });
  else if (act == "point") socket.emit("point", { stat: id });
  else if (act == "deckAdd" || act == "deckRemove") socket.emit(act, { id: id });
  else if (act == "closePack") {
    if (node.id == "rpgPackModal" && event.target != node) return;
    document.getElementById("rpgPackModal").remove();
  } else if (act == "pile") showPile(id);
  else if (act == "view") setView(id);
  else if (act == "rewardView") {
    rewardView = id;
    render();
  } else if (act == "spoilsDone") {
    // (what is left: skipped)
    var me = party && party.run && party.run.heroes.find((h) => h.name == myName);
    if (me && me.reward) socket.emit("pick", { card: null });
    if (me && me.relicChoice) socket.emit("relic", { id: null });
    spoilsDone[id] = true;
    rewardView = "list";
    render();
  }
  else if (act == "builder") setView("deck");
  else if (act == "shop") setView("shop");
  else if (act == "potion") socket.emit("potion");
  else if (act == "revive") socket.emit("revive");
  else if (act == "bagSlot") socket.emit("bagSlot");
  else if (act == "quitRun") {
    if (confirm("Leave the run? You lose your share of the pot and the loot.")) socket.emit("leave");
  } else if (act == "cartAdd") {
    cart[id] = Math.min(rules.cartMax, (cart[id] || 0) + 1);
    render();
  } else if (act == "cartLess") {
    cart[id] = Math.max(0, (cart[id] || 0) - 1);
    render();
  } else if (act == "cartClear") {
    cart = {};
    render();
  } else if (act == "cartBuy") socket.emit("buyPacks", { cart: cart });
  else if (act == "openPack") startOpening(id);
  else if (act == "openAll") startOpeningAll();
  else if (act == "filter") {
    var [key, value] = id.split(":");
    if (key == "owned") filters.owned = !filters.owned;
    else filters[key] = value;
    render();
  } else if (act == "deckClear") socket.emit("deckSet", { ids: [] });
  else if (act == "deckStarter") socket.emit("deckSet", { ids: starterDeck() });
  else if (act == "talent") socket.emit("talent", { tier: Number(id.split(":")[0]), id: id.split(":")[1] });
  else if (act == "relic") {
    socket.emit("relic", { id: id || null });
    rewardView = "list";
  }
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
  else if (act == "pick") {
    socket.emit("pick", { card: id || null });
    rewardView = "list";
  }
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

// A pack opened (the server dealt its cards): they lie face down - the pack's burst first
socket.on("rpgPack", (data) => {
  if (!opening || opening.pack != data.pack) opening = { pack: data.pack, cards: null, flipped: {}, asked: true };
  var cards = data.cards;
  setTimeout(() => {
    if (!opening || opening.cards) return;
    // (open all: the cards by rarity - the best come last)
    opening.cards = stackCards(data.pack == "all" ? cards.slice().sort((a, b) => byRarity(a.id, b.id)) : cards);
    renderOpening();
  }, 650);
});

// Packs bought: into "your packs"
socket.on("rpgBought", (data) => {
  cart = {};
  var n = data.items.reduce((sum, [, count]) => sum + count, 0);
  showToast(n + " pack" + (n == 1 ? "" : "s") + " bought - open them above!");
  render();
});
document.getElementById("rpgStart").addEventListener("click", () => socket.emit("start"));
document.getElementById("rpgLeave").addEventListener("click", () => socket.emit("leave"));
