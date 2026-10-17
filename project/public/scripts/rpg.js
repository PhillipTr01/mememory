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
var filters = { type: "all", cost: "all", rarity: "all", owned: false, pool: "all" }; // the deck builder's
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

var EFFECT_ICONS = { poison: "☠️", burn: "🔥", stun: "💫", steady: "🪨", ambush: "🌫️", chill: "❄️", rage: "😡", might: "📯", weak: "🕯️" };
var EFFECT_NAMES = { poison: "Poisoned", burn: "Burning", stun: "Stunned: skips a move", steady: "Steady: stuns often fail until it acts again, less often with luck", ambush: "Ambush: its next attack deals 50% more", chill: "Chilled: half damage", rage: "Raging: more damage", might: "Might: +30% damage", weak: "Cursed: -30% damage" };
var RARITY_NAMES = { common: "Common", rare: "Rare", epic: "Epic", legendary: "Legendary", mythic: "Mythic" };
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

// A card by its id - "strike+": upgraded at a camp fire (rules.upgrades); base: its text as written (the collection:
// percents) - not with my numbers
// (a card that lets nothing hit me: not two turns in a row)
function hidden(me, card) {
  return !!me.smokeLocked && (card.fx || []).some((f) => f.evade);
}

function cardOf(id, base) {
  var plus = /\+$/.test(id);
  var card = rules.cards[id.replace(/\+$/, "")];
  var live = base ? null : liveText(id);
  if (plus) {
    var up = (rules.upgrades && rules.upgrades[id.replace(/\+$/, "")]) || { cost: card.cost, text: card.text, note: "" };
    return Object.assign({}, card, { name: card.name + "+", cost: up.cost, text: live || up.text, note: up.note, upgraded: true });
  }
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
  line.append(el("span", "rpg-cardx-kind", card.type == "attack" ? "⚔ Attack" : card.type == "aura" ? "✺ Aura" : "✦ Skill"));
  var rarity = (rules.cardRarities[card.rarity] || {}).name;
  if (rarity && card.rarity != "basic") line.append(" · " + rarity);
  return line;
}

// A card (of the hand, a reward, the deck): the cost, the picture, the name, what it does
function cardEl(id, options) {
  options = options || {};
  var card = cardOf(id, options.base);
  var node = el(options.tag || "div", "rpg-cardx type-" + card.type + " rarity-" + (card.rarity || "basic") + (card.upgraded ? " upgraded" : "") + (card.mythic ? " mythic" : "") + (options.className ? " " + options.className : ""));
  if (options.act) {
    node.dataset.act = options.act;
    node.dataset.id = options.id != null ? options.id : id;
  }
  if (options.tag == "button") node.type = "button";
  if (options.disabled) node.classList.add("off");
  if (card.upgraded && card.note) node.title = card.note;
  var cost = el("span", "rpg-cardx-cost");
  cost.dataset.cost = String(card.cost);
  cost.title = card.cost + " mana";
  var art = el("span", "rpg-cardx-art", card.icon);
  if (card.rarity && card.rarity != "basic") art.appendChild(el("i", "rpg-cardx-gem"));
  node.append(cost, art, el("span", "rpg-cardx-name", card.name), cardType(card), cardText(card));
  // (a class card: its class icon on top - another class's one dimmed, this character can't use it)
  if (card.cls && rules.classes[card.cls]) {
    var owner = rules.classes[card.cls];
    var other = hero && hero.cls && card.cls != hero.cls;
    var mark = el("span", "rpg-card-class", owner.icon);
    mark.title = owner.name + " card" + (other ? ". This character can't use it." : "");
    node.classList.add("has-class");
    if (other) node.classList.add("other-class");
    node.appendChild(mark);
  }
  return node;
}

// A card's text - "Exhaust" and "Once a run" as a tag of their own
function cardText(card) {
  var box = el("span", "rpg-cardx-text", card.text.replace(/ ?(Exhaust|Mythic)\.$/, ""));
  var once = card.mythic || / Mythic\.$/.test(card.text);
  if (once || card.exhaust) {
    var tag = el("span", "rpg-cardx-tag " + (once ? "once" : "exhaust"), once ? "✦ Once a run" : "🔥 Exhaust");
    tag.title = once ? "Can be played once per run." : "Once played, the card is gone until the fight ends.";
    box.appendChild(tag);
  }
  return box;
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
// (turned off in the admin panel)
socket.on("gameOff", () => (window.location.href = "./"));
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
socket.on("rpgError", (message) => {
  sentPlays.clear();
  showToast(message, "error");
});
socket.on("rpgRules", (data) => {
  rules = data;
  render();
});
var floorPicked = false; // the floor set to the deepest one when the page opens
socket.on("rpgHero", (data) => {
  hero = data;
  heroAt = Date.now();
  if (!floorPicked && data.cls) {
    floorPicked = true;
    floor = data.maxFloor;
  }
  render();
});
// The info board of the dungeon: at its end, starting over (a danger zone - "RESET" typed to confirm)
window.casinoInfoFooter = (game, close) => {
  if (game != "rpg" || !hero || !hero.unlocked || !hero.unlocked.length) return null;
  var box = el("div", "rpg-reset-zone");
  var text = el("div", "rpg-reset-text");
  var wait = Math.max(0, (hero.resetLeft || 0) - (Date.now() - heroAt));
  text.append(el("b", "", "Start over"), el("span", "", wait ? "You can reset again in " + duration(wait) + "." : "Delete your whole dungeon progress and begin from the start. You can do this once every " + (rules.resetCooldown % 86400000 ? Math.round(rules.resetCooldown / 3600000) + " hours." : rules.resetCooldown / 86400000 + " days.")));
  var go = el("button", "mm-btn mm-btn-danger-solid rpg-reset-btn", "Reset my progress");
  go.type = "button";
  go.disabled = wait > 0;
  go.addEventListener("click", () => {
    close();
    confirmDialog({
      title: "Reset your dungeon progress?",
      text: "Your characters, levels, talents, gear, cards, dust and packs are gone for good. Sell your gear first if you want coins for it. Type RESET to confirm.",
      confirmLabel: "Reset",
      danger: true,
      input: { placeholder: "RESET", require: "RESET", maxLength: 5 },
    }).then((typed) => typed === "RESET" && socket.emit("resetHero", { confirm: "RESET" }));
  });
  box.append(text, go);
  return box;
};

// Trades: the offers made and received, the players to trade with, the one picked and what they have, what is picked
var trades = [];
var deckMenu = false; // the deck builder's deck dropdown open
var playerMenu = false; // the trade's player dropdown open
var craftMode = false;
var payDust = false; // the shop's cart paid with dust // the deck builder in craft mode: cards made and dusted, not built into the deck
var tradePlayers = [];
var tradeWith = "";
var tradeTheirs = null;
var tradePick = { give: {}, take: {} };
var tradeCoinPick = { give: 0, take: 0 }; // (coins on each side of the new offer)
socket.on("rpgTrades", (list) => {
  trades = list;
  // (a trade done or gone: what the other player has may have changed)
  if (tradeWith) socket.emit("tradeLook", { name: tradeWith });
  render();
});
socket.on("rpgTradePlayers", (list) => {
  tradePlayers = list;
  render();
});
socket.on("rpgTradeLook", (data) => {
  if (data.name != tradeWith) return;
  tradeTheirs = data;
  render();
});
socket.on("rpgToast", (message) => showToast(message, "success"));
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

// Cards sent to be played, not yet gone from the hand (a double click, a click during the monsters' turn: sent once)
var sentPlays = new Set();
function playCard(data) {
  if (sentPlays.has(data.uid)) return;
  sentPlays.add(data.uid);
  socket.emit("play", data);
}

// The room the party is in (rooms done, the phase) and since when
var roomKey = "";
var roomSince = 0;
var DOOR_DELAY = 800; // ms
function receiveParty(data) {
  // (an update of another run than the one shown, while that one goes on: not this page's - dropped, and told)
  var shown = party && party.run;
  if (shown && !party.result && data && data.run && data.run.uid != shown.uid && data.id == party.id) {
    socket.emit("stray", { party: party.id, run: shown.uid, got: data.run.uid, phase: data.run.phase });
    return;
  }
  if (shown && !party.result && data && data.run && data.id != party.id && shown.phase == "fight") {
    socket.emit("stray", { party: party.id, run: shown.uid, gotParty: data.id, got: data.run.uid, phase: data.run.phase });
    return;
  }
  // (a card I played that is gone in the new state - the final blow: the victory plays back over the old scene,
  // the card leaves the hand right away)
  var newMe = data && data.run && data.run.heroes.find((h) => h.name == myName);
  var kept = new Set(newMe ? newMe.hand.map((c) => c.uid) : []);
  sentPlays.forEach((uid) => {
    if (kept.has(uid)) return;
    var node = document.querySelector('#rpgRun [data-act="card"][data-id="' + uid + '"]');
    if (node) node.classList.add("rpg-card-gone");
  });
  sentPlays.clear();
  // (a new room: when - a door clicked right after doesn't count, see the votes)
  var where = data && data.run ? data.run.rooms.length + ":" + data.run.phase : "";
  if (where != roomKey) {
    roomKey = where;
    roomSince = Date.now();
  }
  var events = freshFx(data);
  // The monsters' turn, a fight won or lost: played back over the scene as it was - then the new state
  if (events.some((e) => e.k == "turn" && e.side == "foes") || events.some((e) => e.k == "victory" || e.k == "defeat") || multiHit(events)) {
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
var fxSeen = null; // the last event shown - {run (its uid), id}
var holdModal = 0; // (the rewards wait for the victory banner: until then)

// The events new since the last update (a new party, a new page: none - nothing to play back)
function freshFx(data) {
  var list = (data && data.run && data.run.fx) || [];
  var last = list.length ? list[list.length - 1].id : 0;
  var same = fxSeen && data && data.run && fxSeen.run == data.run.uid;
  var fresh = same ? list.filter((e) => e.id > fxSeen.id) : [];
  // (a run just begun: its first fight's banner)
  if (!same && data && data.run && data.run.phase == "fight" && data.run.turn == 1 && data.run.rooms.length == 1) fresh = list.filter((e) => e.k == "turn" && e.first);
  fxSeen = data && data.run ? { run: data.run.uid, id: last } : null;
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

// The block of a hero going down hit by hit (its badge on the HP bar)
function blockTo(id, left) {
  var node = unitNode(id);
  var badge = node && node.querySelector(".rpg-block");
  if (!badge) return;
  if (left > 0) badge.innerText = "🛡️ " + left;
  else badge.remove();
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
  if (window.sfx) window.sfx(e.k == "hit" ? (e.dot ? "dot" : e.crit ? "crit" : "hit") : e.k == "turn" && e.side == "foes" ? null : e.k);
  if (e.k == "card") showPlayed(e);
  else if (e.k == "hit") {
    if (e.n > 0 || !e.b) floatOver(e.to, "-" + e.n + (e.crit ? "!" : ""), e.dot ? "dot " + e.dot : e.crit ? "crit" : "hit");
    if (e.b) floatOver(e.to, "🛡️ -" + e.b, "blocked");
    if (e.a) floatOver(e.to, "-" + e.a + " armor", "armored");
    flash(e.to, "rpg-hit", 420);
    if (!live) barBy(e.to, -e.n);
    if (!live && e.left != null) blockTo(e.to, e.left);
  } else if (e.k == "miss") floatOver(e.to, e.dodge ? "Dodge" : "Miss", "miss");
  else if (e.k == "heal") {
    floatOver(e.to, "+" + e.n, "heal");
    if (!live) barBy(e.to, e.n);
  } else if (e.k == "block") floatOver(e.to, "🛡️ +" + e.n, "block");
  else if (e.k == "mana") floatOver(e.to, "💧 +" + e.n + " mana", "mana");
  else if (e.k == "taunt") {
    // (the foes turn to the one taunting: their badge points at the new target)
    (e.foes || []).forEach((id) => {
      flash(id, "rpg-retargeted", 1200);
      floatOver(id, "📣 → " + e.by, "move");
    });
  } else if (e.k == "steal") {
    // (a card stolen from the hand: plain to see, on both sides)
    var stolen = cardOf(e.card);
    floatOver(e.to, "🫳 " + stolen.name + " stolen", "stolen");
    floatOver(e.by, "🫳 " + stolen.icon, "move");
    flash(e.by, "rpg-acting", 520);
    banner("🫳 " + stolen.name + " was stolen from " + (e.to == myName ? "you" : e.to), "foes", 1300);
  }
  else if (e.k == "down") flash(e.to, "rpg-dying", 0);
  else if (e.k == "move") {
    // (a move on itself - defend, regenerate, howl ...: no lunge, only its name)
    var self = rules.moves[e.move] && rules.moves[e.move].self;
    if (e.move == "stunned") {
      flash(e.by, "rpg-stunned-act", 520);
      floatOver(e.by, "💫 Stunned", "miss");
    } else if (self) floatOver(e.by, rules.moves[e.move].icon + " " + rules.moves[e.move].name, "move");
    else flash(e.by, "rpg-acting", 520);
  } else if (e.k == "turn") {
    if (e.side == "foes") banner("Monsters' turn", "foes", 900);
    else banner(e.first ? "⚔️ Fight!" : "Your turn", "heroes", 900);
  } else if (e.k == "victory") {
    banner("Victory!", "victory", 1500);
    holdModal = Date.now() + 1500;
  } else if (e.k == "defeat") banner("Defeat", "defeat", 1800);
  else if (e.k == "phase") {
    flash(e.by, "rpg-acting", 700);
    banner("💢 " + e.text, "foes", 1300);
  }
}

// Several hits at once (a card or a move): "×N" over the one hitting
function markHits(beat, hits) {
  var by = beat[0].k == "move" ? beat[0].by : (beat.find((e) => e.k == "card") || {}).by;
  if (by != null) floatOver(by, "×" + hits, "multi");
}

// Several hits in one go (a card hitting more than once): played back hit by hit, the state waits
function multiHit(events) {
  var hits = 0;
  for (var e of events) {
    if (e.k == "card") hits = 0;
    else if (e.k == "hit" && !e.dot && ++hits > 1) return true;
  }
  return false;
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
    // (one hit after the other - a card or a move that hits several times: a beat between the hits, the HP going
    // down hit by hit)
    var offset = beat[0].k == "move" ? 240 : 0;
    var hits = 0;
    var times = beat.map((e, i) => {
      if (i == 0 && e.k == "move") return 0;
      var multi = e.k == "hit" && !e.dot;
      if (multi && hits++ > 0) offset += 340;
      else if (i > 0) offset += 90;
      return offset;
    });
    setTimeout(() => {
      if (hits > 1) markHits(beat, hits);
      beat.forEach((e, i) => setTimeout(() => showFx(e, false), times[i]));
    }, at);
    var first = beat[0];
    var base = first.k == "move" ? 650 : first.k == "turn" ? (first.side == "foes" ? 750 : 0) : first.k == "victory" ? 1500 : first.k == "defeat" ? 1800 : 450;
    at += Math.max(base, offset + 400);
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

// Who can wear a piece: "For every class" - or the classes it is made for
function wearers(item) {
  if (!item.classes) return "For every class";
  var names = item.classes.map((id) => rules.classes[id].icon + " " + rules.classes[id].name);
  return "Only for " + (names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1] : names[0]);
}

var SLOT_ICONS = { weapon: "⚔️", armor: "🛡️", charm: "💍" };

// A piece of gear as a tile: the slot, the picture, the name, its stats (better / worse than the one worn), the
// classes it fits, the buttons
function gearTile(item, slot, actions) {
  var tile = el("div", "rpg-gear-tile rarity-" + item.rarity);
  // (the floor it is from: its stats and its price are that floor's)
  tile.appendChild(el("span", "rpg-gear-slot", (slot ? SLOT_NAMES[slot] : SLOT_NAMES[item.slot]) + " · " + RARITY_NAMES[item.rarity] + (item.floor ? " · Floor " + item.floor : "")));
  tile.append(el("span", "rpg-gear-icon", item.icon), el("span", "rpg-gear-name", item.name));
  var chips = el("div", "rpg-gear-stats");
  var worn = !slot && hero.gear[item.slot];
  [["atk", "💪", ""], ["def", "🛡️", ""], ["hp", "❤️", ""], ["agi", "🦊", "%"], ["luck", "🍀", "%"]].forEach(([key, icon, unit]) => {
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
  text.append(el("div", "rpg-item-name", item.name), el("div", "rpg-item-bonus", RARITY_NAMES[item.rarity] + (item.floor ? " · Floor " + item.floor : "") + " · " + bonusOf(item)));
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
  ["gear", "🎒 Inventory"],
  ["deck", "🃏 Deck"],
  ["trade", "🤝 Trade"],
  ["shop", "🛒 Shop"],
];

// What waits for the player in a section (a badge on its button): [text, "warn" | "new"] or null
function viewBadge(id) {
  if (!hero.cls) return null;
  if (id == "hero" && hero.points) return ["+" + hero.points, "new"];
  if (id == "talents" && rules.talentLevels.some((lv, tier) => hero.level >= lv && !hero.talents[tier])) return ["!", "new"];
  if (id == "gear") {
    // (packs to open first - they wait here)
    var packs = Object.values(hero.packs || {}).reduce((a, b) => a + b, 0);
    if (packs) return [packs + " 🎴", "new"];
    return hero.bag.length ? [String(hero.bag.length), ""] : null;
  }
  if (id == "deck") return [String(hero.deck.length), hero.deck.length < hero.deckMin || hero.deck.length > hero.deckMax ? "warn" : ""];
  if (id == "trade") {
    var waiting = trades.filter((offer) => offer.to == myName).length;
    return waiting ? [String(waiting), "new"] : null;
  }
  return null;
}

function setView(id) {
  view = id;
  // (the play tab: always the deepest floor open)
  if (id == "play" && hero && hero.cls) floor = hero.maxFloor;
  if (id == "trade") socket.emit("tradePlayers");
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
  // (the deepest floor cleared: a pill)
  morphChildren(document.getElementById("rpgHeroSub"), picked ? [el("span", "rpg-deepest" + (hero.deepest ? "" : " none"), hero.deepest ? "🏰 Deepest floor " + hero.deepest : "🏰 No floor cleared yet")] : []);
  // The hero's level: XP from the fights - every level a stat point, talents at levels 3 to 50
  var xpBox = document.getElementById("rpgXp");
  xpBox.hidden = !picked;
  xpBox.title = "Fights and floors give XP. Every level gives a stat point and talents unlock at levels " + rules.talentLevels.join(", ") + ".";
  var top = hero.level >= rules.heroLevelMax;
  if (picked) morphChildren(xpBox, [el("span", "rpg-level", "Lv " + hero.level), top ? el("span", "rpg-max mm-muted small", "Max level") : bar(hero.xp, hero.xpNeed, "xp", " XP"), hero.points ? el("span", "rpg-points", "+" + hero.points + " point" + (hero.points == 1 ? "" : "s")) : null]);
  morphChildren(document.getElementById("rpgPotions"), [flask(), el("span", "", hero.potions + " / " + hero.potionsMax)]);
  var buy = document.getElementById("rpgBuyPotion");
  buy.innerText = "+ 🪙 " + formatCoins(hero.potionPrice);
  buy.title = "A potion heals " + Math.round(rules.potionHeal * 100) + "% of your HP.";
  buy.disabled = hero.potions >= hero.potionsMax || myCoins < hero.potionPrice;
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
  // (an i to the right of it: every class side by side)
  var classInfo = el("button", "cs-info-btn rpg-class-help", "i");
  classInfo.type = "button";
  classInfo.title = "All classes";
  classInfo.dataset.act = "classHelp";
  var pickRow = el("div", "rpg-class-row");
  pickRow.append(current, classInfo);
  var pickNodes = [pickRow];
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
    var mineStrength = hero.strength || mine.strength;
    strength.append(el("span", "rpg-strength-icon", mineStrength.icon), el("b", "", mineStrength.name), el("span", "", mineStrength.text), el("span", "rpg-strength-grow", "grows with your level"));
    info.push(el("div", "rpg-class-about", mine.about), strength);
    // (out of the fights: the class's help for the party - grows with the main stat)
    if (hero.ability) {
      var ability = el("div", "rpg-class-strength ability");
      ability.append(el("span", "rpg-strength-icon", hero.ability.icon), el("b", "", hero.ability.name), el("span", "", hero.ability.text), el("span", "rpg-strength-grow", "grows with " + rules.stats[mine.main].name));
      info.push(ability);
    }
    // (a later character of the player: dearer stats, stronger monsters)
    if (hero.charIndex > 0) {
      var later = el("div", "rpg-class-later", "Character #" + (hero.charIndex + 1) + ": stats +" + rules.charPrice * hero.charIndex + "% · monsters +" + rules.charHarder * hero.charIndex + "%");
      later.title = "Every character after your first costs more and fights stronger monsters.";
      info.push(later);
    }
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
    name.append(el("span", "rpg-stat-icon", stat.icon), el("span", "", stat.name), el("span", "rpg-stat-level", "Lv " + hero.levels[id] + " / " + rules.levelMax));
    if (main) {
      var star = el("span", "rpg-stat-main", "★ " + mine.name);
      star.title = "Your main stat counts " + (mine.mainBonus || rules.mainBonus) + "x.";
      name.appendChild(star);
    }
    var head = el("div", "rpg-stat-head");
    head.append(name);
    row.append(head, el("div", "rpg-stat-value", statValue(id)));
    // (a stat point: a free level - else coins)
    if (cost == null) {
      var max = el("span", "rpg-stat-max mm-muted", "Max");
      max.title = "This is the highest level.";
      row.appendChild(max);
    }
    else if (hero.points > 0) row.appendChild(button("+1 free", "point", { id: id, className: "small point", title: stat.about }));
    else row.appendChild(button("+ 🪙 " + formatCoins(cost), "upgrade", { id: id, className: "small", disabled: cost > myCoins, title: stat.about }));
    // (the description: a line of its own under the row - a long price doesn't squeeze it)
    row.appendChild(el("div", "rpg-stat-desc", stat.desc));
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
    : [el("div", "rpg-empty mm-muted", "Empty.")];
  document.getElementById("rpgBagLabel").innerText = "Bag · " + hero.bag.length + " / " + hero.bagSize;
  morphChildren(document.getElementById("rpgBag"), bag);
  if (view == "gear" && picked) renderOwnedPacks();

  if (view == "play" && picked) renderReady();
  if (view == "trade" && picked) renderTrade();
}

/* ---------- Trades ---------- */

// A thing to trade as a key: a card of a character ("c:cls:id"), a piece of gear ("g:id")
var tradeKey = (one) => (one.k == "card" ? "c:" + one.cls + ":" + one.id : "g:" + (one.item ? one.item.id : one.id));
var tradeAsked = false;

// The value of a side picked
function pickValue(list, picks) {
  return list.reduce((sum, one) => sum + (picks[tradeKey(one)] || 0) * one.value, 0);
}

// A legendary or mythic among the picks: the trade always needs nearly the same value
function topPicked(list, picks) {
  return list.some((one) => picks[tradeKey(one)] && ["legendary", "mythic"].includes(one.k == "card" ? cardOf(one.id).rarity : one.item.rarity));
}

// Is a trade fair: small ones always, bigger ones nearly even -> null or what is missing
function tradeGap(give, take, top) {
  var high = Math.max(give, take);
  var low = Math.min(give, take);
  if (high <= rules.tradeFree && !top) return null;
  var need = Math.ceil(high * (1 - rules.tradeDeviation / 100));
  return low >= need ? null : need - low;
}

// What the new trade is about: "card", "gear" or null (nothing picked yet)
function tradeKind() {
  var keys = Object.keys(tradePick.give).concat(Object.keys(tradePick.take));
  return keys.length ? (keys[0].startsWith("c:") ? "card" : "gear") : null;
}

// A tile of something to trade: a card (its art, name, rarity) or a piece of gear - a click picks one more
function tradeRow(one, side, picks, act) {
  var key = tradeKey(one);
  var picked = picks[key] || 0;
  // (cards only for cards, gear only for gear: the other kind dimmed once something is picked)
  var other = act && tradeKind() && tradeKind() != (one.k == "card" ? "card" : "gear");
  var row = el(act ? "button" : "div", "rpg-trade-row" + (picked ? " picked" : "") + (other ? " other" : ""));
  if (act) {
    row.type = "button";
    row.dataset.act = act;
    row.dataset.id = side + "|" + key;
  }
  var icon = el("span", "rpg-trade-icon");
  var name = el("span", "rpg-trade-name");
  var sub = el("span", "rpg-trade-sub");
  if (one.k == "card") {
    var card = cardOf(one.id);
    var owner = card.cls && rules.classes[card.cls];
    row.classList.add("rarity-" + card.rarity);
    icon.innerText = card.icon;
    name.innerText = card.name;
    sub.innerText = rules.cardRarities[card.rarity].name + (owner ? " · " + owner.icon + " " + owner.name : " · Neutral");
    row.title = other ? "Cards trade only for cards." : card.text;
  } else if (one.gone) {
    icon.innerText = "❔";
    name.innerText = "Gone";
  } else {
    row.classList.add("rarity-" + one.item.rarity);
    icon.innerText = one.item.icon;
    name.innerText = one.item.name;
    sub.innerText = RARITY_NAMES[one.item.rarity] + " " + SLOT_NAMES[one.item.slot].toLowerCase();
    row.title = other ? "Gear trades only for gear." : bonusOf(one.item).split(" · ").join("\n") + "\n" + wearers(one.item);
  }
  var text = el("span", "rpg-trade-text");
  text.append(name, sub);
  var right = el("span", "rpg-trade-right");
  right.appendChild(el("span", "rpg-trade-value", "🪙 " + formatCoins(one.value)));
  // (picked: how many of how many - shown in a gold badge; a list of an offer: how many)
  if (act && (picked || one.n > 1)) right.appendChild(el("span", "rpg-trade-n" + (picked ? " on" : ""), picked ? picked + " / " + (one.n || 1) : "×" + one.n));
  else if (!act && one.n > 1) right.appendChild(el("span", "rpg-trade-n on", "×" + one.n));
  row.append(icon, text, right);
  return row;
}

// A side of the trade: its title and total, the cards and the gear in groups
function tradePanel(title, list, side, picks, act, empty, coins) {
  var panel = el("div", "rpg-trade-col " + side);
  var head = el("div", "rpg-trade-col-head");
  var total = (act ? pickValue(list, picks) : list.reduce((sum, one) => sum + one.value, 0)) + (coins || 0);
  head.append(el("span", "", title), el("span", "rpg-trade-total", "🪙 " + formatCoins(total)));
  // (the head stays, the list under it scrolls)
  var body = el("div", "rpg-trade-scroll");
  panel.append(head, body);
  // (coins along with the cards or the gear: a field in a new offer, a line in an offer)
  if (act) {
    var field = el("label", "rpg-trade-coins");
    var input = el("input", "mm-input");
    Object.assign(input, { type: "number", min: 0, step: 100, placeholder: "0" });
    input.dataset.side = side;
    field.append(el("span", "", "🪙 Coins"), input);
    body.appendChild(field);
  } else if (coins) body.appendChild(el("div", "rpg-trade-coins shown", "🪙 " + formatCoins(coins) + " coins"));
  if (!list.length && !(coins && !act)) body.appendChild(el("div", "rpg-trade-empty", empty));
  [
    ["Cards", list.filter((one) => one.k == "card")],
    ["Gear", list.filter((one) => one.k != "card")],
  ].forEach(([label, group]) => {
    if (!group.length) return;
    if (act) body.appendChild(el("div", "rpg-trade-group", label));
    var grid = el("div", "rpg-trade-grid");
    group.forEach((one) => grid.appendChild(tradeRow(one, side, picks, act)));
    body.appendChild(grid);
  });
  return panel;
}

// Two arrows: the swap between the two sides
function swapIcon() {
  var box = el("div", "rpg-trade-swap");
  box.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h14m0 0-4-4m4 4-4 4M20 16H6m0 0 4-4m-4 4 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  return box;
}

// The balance between the two sides: a scale - fair, or how much is missing on which side
function tradeScale(give, take, top) {
  var gap = tradeGap(give, take, top);
  var box = el("div", "rpg-trade-scale" + (give + take == 0 ? "" : gap ? " bad" : " good"));
  var high = Math.max(give, take, 1);
  var beam = el("div", "rpg-trade-beam");
  var left = el("i", "give");
  var right = el("i", "take");
  left.style.width = (give / high) * 50 + "%";
  right.style.width = (take / high) * 50 + "%";
  beam.append(left, right);
  var state = give + take == 0 ? "⚖️" : gap ? "⚖️ " + (give < take ? "Add 🪙 " + formatCoins(gap) + " on your side" : "Ask for 🪙 " + formatCoins(gap) + " more") : "⚖️ Fair";
  box.append(el("span", "rpg-trade-state", state), beam);
  return box;
}

function renderTrade() {
  if (!tradeAsked) {
    tradeAsked = true;
    socket.emit("tradePlayers");
  }
  var nodes = [];
  // The offers: received ones to take or turn down, made ones to take back
  if (trades.length) {
    var offers = el("div", "rpg-trade-offers");
    offers.appendChild(el("div", "rpg-label", "Offers"));
    trades.forEach((offer) => {
      var mine = offer.from == myName;
      var other = mine ? offer.to : offer.from;
      var box = el("div", "rpg-trade-offer" + (mine ? " mine" : ""));
      var head = el("div", "rpg-trade-offer-head");
      head.append(createAvatar(other, "sm"), el("b", "", mine ? "Your offer to " + other : other + " offers you a trade"));
      var give = mine ? offer.give : offer.take;
      var take = mine ? offer.take : offer.give;
      var payCoins = mine ? offer.giveCoins : offer.takeCoins;
      var getCoins = mine ? offer.takeCoins : offer.giveCoins;
      var sides = el("div", "rpg-trade-board");
      sides.append(tradePanel("You give", give, "give", {}, null, "Nothing.", payCoins), swapIcon(), tradePanel("You get", take, "take", {}, null, "Nothing.", getCoins));
      var actions = el("div", "rpg-trade-actions");
      if (mine) actions.append(el("span", "mm-muted small", "Waiting for " + other + "."), button("Take back", "tradeCancel", { id: offer.id, className: "small" }));
      else {
        // (the gear coming in has no room in the bag: no accepting until there is)
        var gearOf = (side) => side.filter((one) => one.k == "gear").length;
        var full = hero.bag.length - gearOf(give) + gearOf(take) > hero.bagSize;
        var broke = payCoins > myCoins;
        var accept = button("✓ Accept", "tradeAccept", { id: offer.id, className: "small primary", disabled: full || broke });
        if (full) accept.title = "Your bag is full. Make room in it to accept this trade.";
        else if (broke) accept.title = "You don't have enough coins for this trade.";
        actions.append(button("Decline", "tradeDecline", { id: offer.id, className: "small" }), accept);
      }
      box.append(head, sides, actions);
      offers.appendChild(box);
    });
    nodes.push(offers);
  }
  // A new offer: the player (a chip each), what you give, what you get
  nodes.push(el("div", "rpg-label", "New trade"));
  // (the player: a dropdown - avatar, name, class and level)
  var who = el("div", "rpg-deck-drop rpg-trade-who" + (playerMenu ? " open" : ""));
  var picked = tradePlayers.find((p) => p.name == tradeWith);
  var playerLine = (p, node) => {
    var cls = rules.classes[p.cls] || { icon: "", name: "" };
    var text = el("span", "rpg-trade-player-text");
    text.append(el("b", "", p.name), el("span", "", cls.icon + " " + cls.name + " · Lv " + p.level));
    node.append(createAvatar(p.name, "sm"), text);
  };
  var pick = button("", "playerMenu", { className: "rpg-deck-drop-btn rpg-trade-pick" });
  if (picked) playerLine(picked, pick);
  else pick.appendChild(el("b", "", tradePlayers.length ? "Pick a player" : "Nobody to trade with yet"));
  pick.appendChild(el("span", "rpg-deck-drop-caret", "▾"));
  if (!tradePlayers.length) pick.disabled = true;
  who.appendChild(pick);
  if (playerMenu) {
    var list = el("div", "rpg-deck-drop-menu");
    tradePlayers.forEach((p) => {
      var item = button("", "tradeWho", { id: p.name, className: "rpg-deck-drop-item rpg-trade-player" + (p.name == tradeWith ? " active" : "") });
      playerLine(p, item);
      list.appendChild(item);
    });
    who.appendChild(list);
  }
  nodes.push(who);
  var mineList = hero.tradeable || [];
  var theirList = tradeTheirs ? tradeTheirs.list : [];
  var give = pickValue(mineList, tradePick.give) + tradeCoinPick.give;
  var take = pickValue(theirList, tradePick.take) + tradeCoinPick.take;
  var top = topPicked(mineList, tradePick.give) || topPicked(theirList, tradePick.take);
  var board = el("div", "rpg-trade-board");
  var middle = el("div", "rpg-trade-middle");
  middle.append(swapIcon(), tradeScale(give, take, top));
  board.append(
    tradePanel("You give", mineList, "give", tradePick.give, "tradePick", "You have no spare cards or gear.", tradeCoinPick.give),
    middle,
    tradePanel(tradeWith ? "You get from " + tradeWith : "You get", theirList, "take", tradePick.take, "tradePick", tradeWith ? (tradeTheirs ? "They have nothing to trade." : "Loading…") : "Pick a player first.", tradeCoinPick.take),
  );
  nodes.push(board);
  var gap = tradeGap(give, take, top);
  var any = Object.keys(tradePick.give).length + Object.keys(tradePick.take).length > 0;
  var coinsOnly = !any && tradeCoinPick.give + tradeCoinPick.take > 0;
  var broke = tradeCoinPick.give > myCoins;
  var note = coinsOnly ? "Add a card or a piece of gear. Coins alone can't be traded." : broke ? "You don't have that many coins." : any && gap ? (top ? "Trades with a legendary or mythic need nearly the same value on both sides." : "Bigger trades need nearly the same value on both sides.") : any ? "" : tradeWith ? "Click what you give and what you want." : "";
  var foot = el("div", "rpg-trade-foot");
  foot.append(el("span", "rpg-trade-note", note), button("Send offer", "tradeSend", { className: "primary", disabled: !tradeWith || !any || !!gap || broke }));
  nodes.push(foot);
  morphChildren(document.getElementById("rpgTrade"), nodes);
}

// What is picked, as the server takes it
function tradeSide(list, picks) {
  return list
    .filter((one) => picks[tradeKey(one)])
    .map((one) => (one.k == "card" ? { k: "card", cls: one.cls, id: one.id, n: picks[tradeKey(one)] } : { k: "gear", id: one.item.id }));
}

// The practice run: a word for every step - what to do now
function renderCoach(run, me) {
  var box = document.getElementById("rpgCoach");
  box.hidden = !run.tutorial;
  if (!run.tutorial) return;
  var text;
  var event = run.event;
  if (party.result || run.phase == "won") text = "🎉 Done! Real floors cost an entry and pay out coins. Good luck!";
  else if (run.phase == "lost") text = "💀 You fell, but it is only practice. Use Defend against big hits.";
  else if (run.phase == "fight" && me) {
    if (me.ended) text = "⏳ Monsters' turn.";
    else if (run.turn == 1 && me.energy == rules.energy) text = "🃏 Drag a card onto the monster. Cards cost 💧 mana and you have " + rules.energy + " every turn.";
    else if (me.energy > 0 && me.hand.some((c) => cardOf(c.id).cost <= me.energy)) text = "🛡️ The badge shows the monster's next move. Defend blocks the hit.";
    else text = "⏭️ You are out of mana. Press End turn.";
  } else if (me && me.reward) text = "🎁 You won! Pick a card for this run.";
  else if (event && event.kind == "rest" && event.choices && !event.choices[myName]) text = "🔥 At the camp fire, Rest heals you and Smith upgrades a card.";
  else text = "🗺️ Pick the next room on the map.";
  if (box.innerText != text) box.innerText = text;
}


// My buffs in a fight (top left): an icon each, the turns left on it - what it does on hover
var AURA_ICONS = { guard: "🛡️", regen: "💚", focus: "💧" };
function renderBuffs(run, me) {
  var list = [];
  if (me && run.phase == "fight" && !me.down) {
    (me.auras || []).forEach((a) => {
      var card = rules.cards[a.card] || { name: "Aura" };
      var what = a.kind == "guard" ? "Block " + a.value : a.kind == "regen" ? "+" + a.value + " HP" : "+" + a.value + " mana";
      list.push([AURA_ICONS[a.kind], a.turns, card.name + ": " + what + " at the start of your turn · " + a.turns + " turn" + (a.turns == 1 ? "" : "s") + " left", "good"]);
    });
    var fx = me.effects || {};
    // (might stacks: the icon shows the stacks, the hover the whole boost)
    if (fx.might) list.push([EFFECT_ICONS.might + (me.might > 1 ? "×" + me.might : ""), fx.might.turns || fx.might, "You deal " + 30 * (me.might || 1) + "% more damage.", "good"]);
    if (me.blessed) list.push(["✨", "", "Blessed: 25% more damage this run", "good"]);
    if (fx.weak) list.push([EFFECT_ICONS.weak, fx.weak.turns || fx.weak, "Cursed: 30% less damage", "bad"]);
    if (fx.poison) list.push([EFFECT_ICONS.poison, fx.poison.turns || "", "Poisoned: damage at the end of every turn", "bad"]);
    if (fx.burn) list.push([EFFECT_ICONS.burn, fx.burn.turns || "", "Burning: damage at the end of every turn", "bad"]);
  }
  morphChildren(
    document.getElementById("rpgBuffs"),
    list.map(([icon, n, tip, kind]) => {
      var b = el("span", "rpg-buff " + kind);
      b.append(el("span", "rpg-buff-icon", icon));
      if (n !== "" && n != null) b.appendChild(el("b", "rpg-buff-n", String(n)));
      b.title = tip;
      return b;
    }),
  );
}

// The deck slots: a numbered pill each - the one played lit (only with more than one slot)
function deckSwitch() {
  if (!hero.decks || hero.decks.length < 2) return null;
  var box = el("span", "rpg-deck-switch");
  hero.decks.forEach((n, i) => {
    var name = (hero.deckNames || [])[i];
    var pill = el("span", "rpg-deck-slot" + (i == hero.deckAt ? " active" : "") + (n ? "" : " empty") + (name ? " named" : ""), name || String(i + 1));
    pill.dataset.act = "deckUse";
    pill.dataset.id = String(i);
    pill.title = (name || "Deck " + (i + 1)) + " has " + n + " cards" + (i == hero.deckAt ? " and is in use." : ".");
    box.appendChild(pill);
  });
  return box;
}

// Ready to go down? Every thing that still waits - with a button to it
function renderReady() {
  var items = [];
  // (a row: a picture, what it is, a line under it, a button - state: ok / warn / new)
  var item = (icon, title, sub, state, act, id, label, extra) => {
    var row = el("div", "rpg-ready-item " + state);
    var text = el("div", "rpg-ready-text");
    text.append(el("b", "", title));
    if (sub) text.appendChild(el("span", "rpg-ready-sub", sub));
    if (extra) text.appendChild(extra);
    var bubble = el("span", "rpg-ready-icon");
    if (typeof icon == "string") bubble.innerText = icon;
    else bubble.appendChild(icon);
    row.append(bubble, text);
    if (act) row.appendChild(button(label, act, { id: id, className: "small" + (state == "warn" ? " primary" : "") }));
    items.push(row);
  };
  // The loadout - what counts in the dungeon: the deck, the potions, the gear worn - a soft row each
  var n = hero.deck.length;
  var deckOk = n >= hero.deckMin && n <= hero.deckMax;
  var loadout = el("div", "rpg-loadout");
  // (tag: "div" for a row with a button of its own inside)
  var line = (icon, title, value, state, act, id, tip, extra, tag) => {
    var row = el(tag || "button", "rpg-load " + state);
    if (!tag) row.type = "button";
    if (act) row.dataset.act = act;
    if (id) row.dataset.id = id;
    if (tip) row.title = tip;
    var pic = el("span", "rpg-load-icon");
    if (typeof icon == "string") pic.innerText = icon;
    else pic.appendChild(icon);
    var text = el("span", "rpg-load-text");
    text.append(el("span", "rpg-load-title", title), el("span", "rpg-load-value", value));
    row.append(pic, text);
    if (extra) row.appendChild(extra);
    row.appendChild(el("span", "rpg-load-state", state == "ok" ? "✓" : "!"));
    return row;
  };
  // (the deck: a meter between the fewest and the most cards)
  var meter = el("span", "rpg-load-meter");
  var fill = el("i");
  fill.style.width = Math.min(100, (n / hero.deckMax) * 100) + "%";
  meter.appendChild(fill);
  var deckRow = line("🃏", "Deck" + (hero.decks && hero.decks.length > 1 ? " " + (hero.deckAt + 1) : ""), n + " cards", deckOk ? "ok" : "warn", "view", "deck", hero.deckMin + " to " + hero.deckMax + " cards", meter);
  var sw = deckSwitch();
  if (sw) deckRow.insertBefore(sw, deckRow.lastChild);
  loadout.appendChild(deckRow);
  // (the potions: a small flask each)
  var flasks = el("span", "rpg-load-flasks");
  for (var i = 0; i < hero.potionsMax; i++) flasks.appendChild(flask(i < hero.potions ? "" : "off"));
  var full = hero.potions >= hero.potionsMax;
  var potRow = line(flask(), "Potions", hero.potions + " / " + hero.potionsMax, hero.potions ? "ok" : "warn", full ? null : "potion", null, full ? "Full" : "Buy one: 🪙 " + formatCoins(hero.potionPrice), flasks, "div");
  // (the auto refill: after every run the potions bought up to the most - a switch in the row)
  var refill = button("", "autoPotions", { className: "rpg-toggle rpg-auto-potions" + (hero.autoPotions ? " on" : ""), title: "After every run, potions are bought for 🪙 " + formatCoins(hero.potionPrice) + " each until you carry the most you can." });
  refill.append(el("i", "rpg-toggle-knob"), el("span", "", "Auto refill"));
  potRow.querySelector(".rpg-load-text").appendChild(refill);
  loadout.appendChild(potRow);
  // (the gear: the three slots - what is worn)
  var slots = el("span", "rpg-load-slots");
  ["weapon", "armor", "charm"].forEach((slot) => {
    var item = hero.gear[slot];
    var mark = el("span", "rpg-load-slot" + (item ? " rarity-" + item.rarity : " empty"), item ? item.icon : SLOT_ICONS[slot]);
    mark.title = item ? item.name + "\n" + bonusOf(item).split(" · ").join("\n") + "\n" + wearers(item) : "No " + SLOT_NAMES[slot].toLowerCase() + " worn.";
    slots.appendChild(mark);
  });
  var worn = ["weapon", "armor", "charm"].filter((slot) => hero.gear[slot]).length;
  loadout.appendChild(line("🎒", "Gear", worn + " / 3 worn", worn ? "ok" : "warn", "view", "gear", null, slots));
  items.push(loadout);
  // (what still waits: a row each - a new character's practice run first, with a Skip)
  if (!hero.tutorialDone && hero.cls) {
    item("🎓", "Practice run", "Free · 3 rooms", "new", "tutorial", null, "Start");
    items[items.length - 1].appendChild(button("Skip", "skipTutorial", { className: "small" }));
  }
  if (hero.deadFor > 0) item("💀", "Dead", "Back in " + duration(hero.deadFor - (Date.now() - heroAt)), "warn", "revive", null, (hero.revivePrice ? "Revive · 🪙 " + formatCoins(hero.revivePrice) : "Revive · Free"));
  if (hero.points) item("⬆️", hero.points + " stat point" + (hero.points == 1 ? "" : "s"), "To spend", "new", "view", "hero", "Spend");
  if (rules.talentLevels.some((lv, tier) => hero.level >= lv && !hero.talents[tier])) item("⭐", "A talent", "To pick", "new", "view", "talents", "Pick");
  var packs = Object.values(hero.packs || {}).reduce((a, b) => a + b, 0);
  if (packs) item("🎴", packs + " pack" + (packs == 1 ? "" : "s"), "To open", "new", "view", "gear", "Open");
  morphChildren(document.getElementById("rpgReady"), items);
}

// The deck in short: the mana curve, attacks and skills - too few cards: a warning
function deckSummary(deck) {
  var attacks = deck.filter((id) => cardOf(id).type == "attack").length;
  var nodes = [curve(deck), el("div", "mm-muted small", attacks + " attacks · " + (deck.length - attacks) + " skills")];
  if (deck.length < hero.deckMin) nodes.push(el("div", "rpg-warn", "⚠️ Need " + (hero.deckMin - deck.length) + " more cards (min " + hero.deckMin + ")"));
  if (deck.length > hero.deckMax) nodes.push(el("div", "rpg-warn", "⚠️ Remove " + (deck.length - hero.deckMax) + " cards (max " + hero.deckMax + ")"));
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
    col.title = n + " card" + (n == 1 ? "" : "s") + " cost " + (cost == 3 ? "3 or more" : cost) + " mana.";
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

// A class at a glance (the first pick, the class overview): main stat, strength, out-of-fight ability, HP and
// attack against the average class, the starting bonuses, the signature cards
function classTile(id, pick) {
  var cls = rules.classes[id];
  var main = rules.stats[cls.main];
  var tile = el(pick ? "button" : "div", "rpg-first-class" + (pick ? "" : " info"));
  if (pick) {
    tile.type = "button";
    tile.dataset.act = "unlock";
    tile.dataset.id = id;
  }
  // (HP and attack against the average class - the baseline: above it green, below it red)
  var all = Object.values(rules.classes);
  var chips = el("div", "rpg-first-chips");
  var chip = (text, good, tip) => {
    var c = el("span", "rpg-first-chip" + (good ? " good" : good === false ? " bad" : ""), text);
    if (tip) c.title = tip;
    chips.appendChild(c);
  };
  [["❤️", "HP", "hp"], ["💪", "attack", "atk"]].forEach(([icon, name, key]) => {
    var average = all.reduce((sum, c) => sum + c[key], 0) / all.length;
    var diff = Math.round((cls[key] / average - 1) * 100);
    chip(icon + " " + (diff > 0 ? "+" : diff < 0 ? "−" : "±") + Math.abs(diff) + "% " + name, diff > 0 ? true : diff < 0 ? false : null);
  });
  if (cls.hpPlus) chip("❤️ +" + cls.hpPlus + " HP", true, "Extra HP from the start");
  if (cls.atkPlus) chip("💪 +" + cls.atkPlus + " attack", true, "Extra attack from the start");
  if (cls.def) chip("🛡️ +" + cls.def + " armor", true, "Armor from the start");
  if (cls.luck) chip("🍀 +" + cls.luck + "% luck", true, "Crits, loot");
  if (cls.agi) chip("🦊 +" + cls.agi + "% instinct", true, "Dodge attacks");
  var ability = rules.abilities[id];
  var strength = cls.strength.text.replace(/\{(\w+)\}/g, (_, key) => (key == "crit" || key == "thorns" ? Math.round(cls.strength.perks[key]) : Math.round(cls.strength.perks[key] * 100)));
  // (the signature cards: whole cards in the class overview - chips in the picker, it fits the screen; hover: the text)
  var cards = el("div", pick ? "rpg-first-sigs" : "rpg-first-cards");
  cls.signature.forEach((id) => {
    if (!pick) return cards.appendChild(cardEl(id, { className: "small" }));
    var card = cardOf(id, true);
    var sig = el("span", "rpg-first-sig type-" + card.type, card.icon + " " + card.name);
    sig.title = card.text;
    cards.appendChild(sig);
  });
  tile.append(
    el("span", "rpg-first-icon", cls.icon),
    el("span", "rpg-first-name", cls.name),
    el("span", "rpg-first-main", "★ " + main.icon + " " + main.name),
    el("span", "rpg-first-about", cls.about),
    el("span", "rpg-first-strength", cls.strength.icon + " " + cls.strength.name + ": " + strength),
    el("span", "rpg-first-strength ability", ability.icon + " " + ability.name + ": " + ability.about),
    chips,
    el("span", "rpg-label", "Signature cards"),
    cards,
  );
  if (pick) tile.appendChild(el("span", "rpg-first-pick", "Choose " + cls.name));
  return tile;
}

function renderFirst() {
  var grid = el("div", "rpg-first-grid");
  Object.keys(rules.classes).forEach((id) => grid.appendChild(classTile(id, true)));
  // (not now: the X - back to the casino, the jackpot)
  var close = el("a", "rpg-first-close", "✕");
  close.href = "./";
  close.title = "Back to the casino";
  close.setAttribute("aria-label", "Back to the casino");
  morphChildren(document.getElementById("rpgFirstBox"), [
    close,
    el("div", "rpg-first-title", "⚔️ Choose your class"),
    el("div", "rpg-first-sub mm-muted", "Your first class is free."),
    grid,
  ]);
}

// A popup of tiles like the class picker (the classes, how cards work) - closed by its button or a click outside
function showBoard(title, sub, nodes) {
  var modal = el("div", "rpg-modal rpg-board");
  var box = el("div", "rpg-modal-box rpg-first-box");
  var close = button("Got it", "", { className: "primary rpg-board-close" });
  box.append(el("div", "rpg-first-title", title), el("div", "rpg-first-sub mm-muted", sub));
  nodes.forEach((node) => box.appendChild(node));
  box.appendChild(close);
  modal.appendChild(box);
  modal.addEventListener("click", (event) => {
    if (event.target == modal || event.target == close) modal.remove();
  });
  // (next to the class picker - the page's colors, and inside the full screen if the page is in it)
  document.getElementById("rpgFirst").parentNode.appendChild(modal);
}

/* ---------- The card shop: booster packs of the base set ---------- */

// The chance of every rarity on a card of a pack (not the guaranteed ones) - by the weights of my class's cards
function packOdds(pack) {
  var shares = {};
  var cards = hero.pool.filter((id) => cardOf(id).rarity != "basic");
  // (every card of the pack: the last ones only of their rarity or better)
  for (var i = 0; i < pack.size; i++) {
    var better = i >= pack.size - pack.better;
    var choices = cards.filter((id) => !better || RARITY_ORDER.indexOf(cardOf(id).rarity) >= RARITY_ORDER.indexOf(pack.least));
    var weights = choices.map((id) => rules.cardRarities[cardOf(id).rarity].weight * (pack.boost[cardOf(id).rarity] || 1));
    var total = weights.reduce((a, b) => a + b, 0);
    choices.forEach((id, j) => {
      var rarity = cardOf(id).rarity;
      shares[rarity] = (shares[rarity] || 0) + (weights[j] / total / pack.size) * 100;
    });
  }
  return RARITY_ORDER.filter((r) => shares[r]).map((r) => [r, shares[r]]);
}

var cart = {}; // the shop's cart: {pack id: count}

// The price of packs of a kind
// A pack's price: in coins and in dust
function packPrice(pack) {
  var line = el("div", "rpg-pack-price");
  line.append(el("span", "", "🪙 " + formatCoins(pack.price)), el("span", "rpg-pack-dot", "·"), el("span", "rpg-pack-dust", "✨ " + formatCoins(pack.dust)));
  return line;
}

function packCost(id, n) {
  return rules.packs[id].price * n;
}

// A sealed pack (the art): the shop, the packs waiting, the opening
function packArt(id, className) {
  var pack = rules.packs[id];
  var art = el("div", "rpg-pack-art tier-" + id + (className ? " " + className : ""));
  art.append(el("span", "rpg-pack-set", "BASE SET"), el("span", "rpg-pack-icon", pack.icon), el("span", "rpg-pack-count", pack.size + " cards"));
  return art;
}

// The collection: the cards found, the copies (the deck builder)
function renderCollectionBar() {
  // (the whole set - every class's cards, all characters' copies)
  var cards = Object.keys(rules.cards).filter((id) => cardOf(id).rarity != "basic");
  var owned = hero.owned || {};
  var found = cards.filter((id) => owned[id]).length;
  var copies = cards.reduce((sum, id) => sum + Math.min(owned[id] || 0, rules.cardRarities[cardOf(id).rarity].copies), 0);
  var most = cards.reduce((sum, id) => sum + rules.cardRarities[cardOf(id).rarity].copies, 0);
  var progress = el("div", "rpg-shop-bar");
  progress.append(el("span", "", "📚 Collection"), bar(found, cards.length, "xp", " cards"), el("span", "mm-muted small", copies + " / " + most + " copies"));
  // (dust: from spare cards - it makes the cards still missing)
  var dust = el("div", "rpg-dust-bar");
  var crafting = button(craftMode ? "✓ Craft mode" : "✨ Craft mode", "craftMode", { className: "small rpg-craft-toggle" + (craftMode ? " on" : "") });
  crafting.title = craftMode ? "Back to building your deck." : "Make missing cards with dust and dust spare ones.";
  dust.appendChild(crafting);
  var spare = (hero.dustable || []).reduce((sum, one) => sum + one.n, 0);
  if (spare) dust.appendChild(button("Dust " + spare + " spare card" + (spare == 1 ? "" : "s"), "dustAll", { className: "small" }));
  progress.appendChild(dust);
  morphChildren(document.getElementById("rpgShopProgress"), [progress]);

}

// The packs bought, waiting to be opened (the inventory)
function renderOwnedPacks() {
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
      : [el("div", "rpg-empty mm-muted", "No packs waiting.")],
  );
  var waiting = Object.values(hero.packs || {}).reduce((a, b) => a + b, 0);
  // (open all: in the heading of the packs waiting)
  morphChildren(document.getElementById("rpgOpenAllSlot"), waiting > 1 ? [button("🎴 Open all (" + waiting + ")", "openAll", { className: "small primary" })] : []);

}

function renderShop() {
  var cls = rules.classes[hero.cls];
  // Upgrades: more room in the bag - a slot per cell (the ones bought gold)
  var slot = el("div", "rpg-upgrade");
  var price = hero.bagSlotPrice;
  var cells = el("div", "rpg-upgrade-cells");
  for (var c = 0; c < rules.bagTop; c++) cells.appendChild(el("i", c < rules.bagMax ? "base" : c < hero.bagSize ? "on" : ""));
  var words = el("div", "rpg-upgrade-text");
  words.append(el("b", "", "Bag slot"), el("span", "mm-muted small", hero.bagSize + " / " + rules.bagTop + " slots"), cells);
  slot.append(el("span", "rpg-upgrade-icon", "🎒"), words);
  slot.appendChild(price == null ? el("span", "rpg-upgrade-max", "✓ Max") : button("+1 slot · 🪙 " + formatCoins(price), "bagSlot", { className: "primary", disabled: price > myCoins }));
  // (more potions to carry - dearer still)
  var flasks = el("div", "rpg-upgrade");
  var fprice = hero.potionSlotPrice;
  var fcells = el("div", "rpg-upgrade-cells");
  for (var f = 0; f < rules.potionsTop; f++) fcells.appendChild(el("i", f < rules.potionsMax ? "base" : f < hero.potionsMax ? "on" : ""));
  var fwords = el("div", "rpg-upgrade-text");
  fwords.append(el("b", "", "Potion slot"), el("span", "mm-muted small", hero.potionsMax + " / " + rules.potionsTop + " potions"), fcells);
  flasks.append(withFlask(el("span", "rpg-upgrade-icon", "")), fwords);
  flasks.appendChild(fprice == null ? el("span", "rpg-upgrade-max", "✓ Max") : button("+1 slot · 🪙 " + formatCoins(fprice), "potionSlot", { className: "primary", disabled: fprice > myCoins }));
  // (deck slots: more decks kept ready)
  var decks = el("div", "rpg-upgrade");
  var dprice = hero.deckSlotPrice;
  var dcells = el("div", "rpg-upgrade-cells");
  for (var d = 0; d < rules.decksTop; d++) dcells.appendChild(el("i", d < 1 ? "base" : d < hero.decks.length ? "on" : ""));
  var dwords = el("div", "rpg-upgrade-text");
  dwords.append(el("b", "", "Deck slot"), el("span", "mm-muted small", hero.decks.length + " / " + rules.decksTop + " decks"), dcells);
  decks.append(el("span", "rpg-upgrade-icon", "🗂️"), dwords);
  decks.appendChild(dprice == null ? el("span", "rpg-upgrade-max", "✓ Max") : button("+1 slot · 🪙 " + formatCoins(dprice), "deckSlot", { className: "primary", disabled: dprice > myCoins }));
  morphChildren(document.getElementById("rpgShopUpgrades"), [slot, flasks, decks]);
  document.getElementById("rpgShopTitle").innerText = "🛒 Card shop";
  var dustTag = document.getElementById("rpgShopDust");
  dustTag.innerText = "✨ " + formatCoins(hero.dust || 0) + " dust";
  dustTag.title = "Dust comes from cards you turn into dust. It buys packs and makes cards.";
  // The packs to buy: into the cart
  morphChildren(
    document.getElementById("rpgShopPacks"),
    Object.keys(rules.packs).map((id) => {
      var pack = rules.packs[id];
      var tile = el("div", "rpg-pack-tile tier-" + id);
      var odds = el("div", "rpg-pack-odds");
      packOdds(pack).forEach(([rarity, pct]) => {
        var row = el("div", "rpg-odd rarity-" + rarity);
        row.append(el("span", "", rules.cardRarities[rarity].name), el("b", "", (pct < 0.1 ? pct.toFixed(2) : pct < 1 ? pct.toFixed(1) : Math.round(pct)) + "%"));
        odds.appendChild(row);
      });
      var inCart = cart[id] || 0;
      tile.append(
        packArt(id),
        el("div", "rpg-pack-name", pack.name),
        packPrice(pack),
        el("div", "mm-muted small", pack.about),
        el("div", "rpg-label", "Odds per card"),
        odds,
        button("🛒 Add to cart", "cartAdd", { id: id, className: "primary" }),
      );
      return tile;
    }),
  );

  // The cart: the lines, the total - buy
  var lines = Object.keys(cart).filter((id) => cart[id] > 0);
  // (paid with coins or with dust - the cart's switch)
  var cost = (id, n) => (payDust ? rules.packs[id].dust * n : packCost(id, n));
  var money = (n) => (payDust ? "✨ " : "🪙 ") + formatCoins(n);
  var total = lines.reduce((sum, id) => sum + cost(id, cart[id]), 0);
  var have = payDust ? hero.dust || 0 : myCoins;
  var nodes = [el("div", "rpg-cart-title", "🛒 Your cart")];
  var pay = el("div", "rpg-seg rpg-pay");
  pay.append(button("🪙 Coins", "payWith", { id: "coins", className: "rpg-seg-opt" + (payDust ? "" : " active") }), button("✨ Dust", "payWith", { id: "dust", className: "rpg-seg-opt" + (payDust ? " active" : "") }));
  pay.title = "You have " + formatCoins(hero.dust || 0) + " dust.";
  nodes.push(pay);
  if (!lines.length) nodes.push(el("div", "rpg-empty mm-muted", "Empty"));
  lines.forEach((id) => {
    var pack = rules.packs[id];
    var row = el("div", "rpg-cart-line");
    var step = el("div", "rpg-stepper");
    step.append(button("−", "cartLess", { id: id, className: "small" }), el("b", "", String(cart[id])), button("+", "cartAdd", { id: id, className: "small", disabled: cart[id] >= rules.cartMax }));
    var price = el("div", "rpg-cart-price");
    price.appendChild(el("b", "", money(cost(id, cart[id]))));
    row.append(el("span", "rpg-cart-icon", pack.icon), el("span", "rpg-cart-name", pack.name), step, price);
    nodes.push(row);
  });
  if (lines.length) {
    var sum = el("div", "rpg-cart-total");
    sum.append(el("span", "", "Total"), el("b", "", money(total)));
    nodes.push(sum, button("Buy · " + money(total), "cartBuy", { className: "primary", disabled: total > have }), button("Empty the cart", "cartClear", { className: "small" }));
    if (total > have) nodes.push(el("div", "rpg-warn", payDust ? "Not enough dust." : "Not enough coins."));
  }
  morphChildren(document.getElementById("rpgCart"), nodes);
  document.getElementById("rpgCart").classList.toggle("dust", payDust);

}

/* ---------- Opening a pack: the pack bursts, the cards lie face down - one flip after the other */

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
    } else stacks.push({ id: c.id, n: 1, fresh: c.fresh, cls: c.cls });
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

// The note under a turned card: new or a duplicate - another class's card: its class
function flipNote(c) {
  var text = c.fresh ? "New!" : "Duplicate";
  return el("span", "rpg-flip-note" + (c.fresh ? " fresh" : ""), text);
}


// A card turned over - in place (the others stay as they are)
function flipSlot(slot) {
  var i = Number(slot.dataset.flip);
  if (window.sfx) window.sfx("flip", cardOf(opening.cards[i].id).rarity);
  opening.flipped[i] = true;
  slot.classList.add("flipped");
  var c = opening.cards[i];
  if (!slot.querySelector(".rpg-flip-note")) slot.appendChild(flipNote(c));
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
      if (opening.flipped[i]) slot.appendChild(flipNote(c));
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
    if (window.sfx) window.sfx("burst");
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

// The starter deck of my class: 4 strikes, 4 defends (two of them the class's guard card), the two signature cards
function starterDeck() {
  var cls = rules.classes[hero.cls];
  var guard = cls.guard || "defend";
  return ["strike", "strike", "strike", "strike", "defend", "defend", guard, guard].concat(cls.signature);
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

// [key, label of the row, the options]
var FILTERS = [
  ["pool", "Cards", [["all", "All cards"], ["class", "Class"], ["neutral", "Neutral"], ["both", "Class + neutral"]]],
  ["type", "Type", [["all", "All"], ["attack", "Attacks"], ["skill", "Skills"], ["aura", "Auras"]]],
  ["cost", "Cost", [["all", "Any"], ["0", "0"], ["1", "1"], ["2", "2"], ["3", "3+"]]],
  ["rarity", "Rarity", [["all", "Any"], ["basic", "Basic"], ["common", "Common"], ["rare", "Rare"], ["epic", "Epic"], ["legendary", "Legendary"], ["mythic", "Mythic"]]],
];
var RARITY_ORDER = ["basic", "common", "rare", "epic", "legendary", "mythic"];
// By rarity (common first, mythic last) - then the cost, the name
var byRarity = (a, b) => RARITY_ORDER.indexOf(cardOf(a).rarity) - RARITY_ORDER.indexOf(cardOf(b).rarity) || cardOf(a).cost - cardOf(b).cost || cardOf(a).name.localeCompare(cardOf(b).name);
var byCost = (a, b) => cardOf(a).cost - cardOf(b).cost || RARITY_ORDER.indexOf(cardOf(a).rarity) - RARITY_ORDER.indexOf(cardOf(b).rarity) || cardOf(a).name.localeCompare(cardOf(b).name);

// Craft mode: a card with what can be done with it under it - made of dust, or a spare copy dusted
function craftCell(card, id) {
  var info = cardOf(id);
  var cost = rules.dust[info.rarity] || {};
  var copies = rules.cardRarities[info.rarity].copies;
  var mine = hero.pool.includes(id);
  var have = mine ? hero.collection[id] || 0 : (hero.owned || {})[id] || 0;
  var spare = (hero.dustable || []).find((one) => one.id == id);
  var any = (hero.dustAny || []).find((one) => one.id == id);
  var cell = el("div", "rpg-craft-cell" + (spare ? " spare" : ""));
  var bar = el("div", "rpg-craft-bar");
  bar.appendChild(el("span", "rpg-craft-have", info.rarity == "basic" ? "Basic card" : mine ? have + " of " + copies + " for a deck" + (have > copies ? " · " + (have - copies) + " spare" : "") : have ? have + " owned · another class" : "Another class"));
  var buttons = el("div", "rpg-craft-buttons");
  if (cost.craft && mine) {
    var full = have >= copies;
    var make = button("✨ Craft · " + cost.craft, "craft", { id: id, className: "rpg-craft-btn make", disabled: full || (hero.dust || 0) < cost.craft });
    make.title = full ? "You have every copy a deck can hold." : (hero.dust || 0) < cost.craft ? "You need " + cost.craft + " dust." : "Make a copy for " + cost.craft + " dust.";
    buttons.appendChild(make);
  }
  if (cost.get) {
    // (a spare copy: right away - a copy you need: asked first)
    var from = spare || any;
    var dust = button("💨 Dust · +" + cost.get, spare ? "dustOne" : "dustNeeded", { id: from ? from.cls + "|" + id : "", className: "rpg-craft-btn dust", disabled: !from });
    dust.title = spare ? "Turn one spare copy into " + cost.get + " dust." : from ? "Turn one copy into " + cost.get + " dust. You need it for a full deck." : have ? "Starter copies can't be dusted." : "You have no copy to dust.";
    buttons.appendChild(dust);
  }
  bar.appendChild(buttons);
  cell.append(card, bar);
  return cell;
}

// The builder's grid with no card: a calm note in the middle - and the way back to every card
function emptyGrid() {
  var box = el("div", "rpg-grid-empty");
  var filtered = search || Object.keys(filters).some((key) => filters[key] != (key == "owned" ? false : "all"));
  box.append(el("span", "rpg-grid-empty-icon", "🔍"), el("b", "", "No card fits the filters."), el("span", "mm-muted small", filtered ? "Try another search or show every card again." : "Open packs to find more cards."));
  if (filtered) box.appendChild(button("Show all cards", "filtersReset", { className: "small" }));
  return box;
}

function renderBuilder() {
  renderCollectionBar();
  var cls = rules.classes[hero.cls];
  var info = el("button", "cs-info-btn", "i");
  info.type = "button";
  info.title = "How cards work";
  info.dataset.act = "deckHelp";
  var dustTag = el("span", "rpg-dust-tag rpg-builder-dust", "✨ " + formatCoins(hero.dust || 0) + " dust");
  dustTag.title = "Turn cards into dust and make the cards you miss with it.";
  morphChildren(document.getElementById("rpgBuilderTitle"), [el("span", "", "🃏 Deck builder"), info, dustTag]);
  // (the decks: a dropdown - the one in use on its button, the others to switch to, a rename)
  var decks = hero.decks || [hero.deck.length];
  var at = hero.deckAt || 0;
  var deckLabel = (i) => (hero.deckNames || [])[i] || "Deck " + (i + 1);
  var drop = el("div", "rpg-deck-drop" + (deckMenu ? " open" : ""));
  var current = button("", "deckMenu", { className: "rpg-deck-drop-btn" });
  current.append(el("b", "", deckLabel(at)), el("span", "rpg-deck-drop-n", decks[at] + (decks[at] == 1 ? " card" : " cards")), el("span", "rpg-deck-drop-caret", "▾"));
  drop.appendChild(current);
  if (deckMenu) {
    var menu = el("div", "rpg-deck-drop-menu");
    decks.forEach((n, i) => {
      var item = button("", i == at ? "deckMenu" : "deckUse", { id: String(i), className: "rpg-deck-drop-item" + (i == at ? " active" : "") + (n ? "" : " empty") });
      item.append(el("b", "", deckLabel(i)), el("span", "", n + (n == 1 ? " card" : " cards")));
      menu.appendChild(item);
    });
    var rename = button("✏️ Rename this deck", "deckRename", { className: "rpg-deck-drop-item rename" });
    menu.appendChild(rename);
    drop.appendChild(menu);
  }
  morphChildren(document.getElementById("rpgDeckTabs"), [drop]);
  document.getElementById("rpgBuilder").classList.toggle("crafting", craftMode);
  // (the deck in use: its name)
  var deckName = (hero.deckNames || [])[hero.deckAt || 0];
  morphChildren(document.getElementById("rpgDeckName"), [el("b", "", deckName || "Deck " + ((hero.deckAt || 0) + 1))]);
  var deck = hero.deck;
  var counts = {};
  deck.forEach((id) => (counts[id] = (counts[id] || 0) + 1));
  var short = deck.length < hero.deckMin || deck.length > hero.deckMax;
  var count = document.getElementById("rpgBuilderCount");
  count.innerText = deck.length + " / " + hero.deckMax;
  count.className = "rpg-builder-count" + (short ? " bad" : deck.length >= hero.deckMax ? " full" : " ok");
  count.title = "Your deck holds " + hero.deckMin + " to " + hero.deckMax + " cards.";

  // The filters: a segmented control each (type, cost, rarity) - and two toggles
  var chips = [];
  FILTERS.forEach(([key, name, options]) => {
    var group = el("div", "rpg-seg-filter " + key);
    group.title = name;
    options.forEach(([value, label]) => {
      var chip = button(value == "all" ? (key == "type" || key == "pool" ? label : "Any " + name.toLowerCase()) : label, "filter", { id: key + ":" + value, className: "rpg-seg-opt" + (filters[key] == value ? " active" : "") });
      if (key == "cost" && value != "all") {
        chip.innerText = "";
        var drop = el("span", "rpg-row-cost");
        drop.dataset.cost = label;
        chip.appendChild(drop);
        chip.title = "Cards that cost " + label + " mana";
      }
      // (a rarity: its colored dot)
      if (key == "rarity" && value != "all") {
        chip.classList.add("rarity-" + value);
        chip.prepend(el("i", "rpg-seg-dot"));
      }
      group.appendChild(chip);
    });
    chips.push(group);
  });
  var toggles = el("div", "rpg-filter-toggles");
  [["owned", "Owned"]].forEach(([key, label]) => {
    var toggle = button("", "filter", { id: key + ":toggle", className: "rpg-toggle" + (filters[key] ? " on" : "") });
    toggle.append(el("i", "rpg-toggle-knob"), el("span", "", label));
    toggles.appendChild(toggle);
  });
  chips.push(toggles);
  morphChildren(document.getElementById("rpgFilterChips"), chips);

  // The collection: every card of the class - owned (spare copies: into the deck) or locked
  var text = search.trim().toLowerCase();
  // (every card of the set - or the class's, the neutral ones (the basics too), both: what this deck can take)
  var mine = {};
  hero.pool.forEach((id) => (mine[id] = true));
  var ownedAll = hero.owned || {};
  var shown = Object.keys(rules.cards)
    .filter((id) => {
      var card = cardOf(id);
      if (card.rarity == "basic" && !mine[id]) return false;
      var own = card.cls && card.cls == hero.cls;
      if (filters.pool == "class" && !own) return false;
      if (filters.pool == "neutral" && card.cls) return false;
      if (filters.pool == "both" && !mine[id]) return false;
      if (filters.type != "all" && card.type != filters.type) return false;
      if (filters.cost != "all" && Math.min(3, card.cost) != Number(filters.cost)) return false;
      if (filters.rarity != "all" && card.rarity != filters.rarity) return false;
      if (filters.owned && !(mine[id] ? hero.collection[id] : ownedAll[id])) return false;
      return !text || (card.name + " " + card.text).toLowerCase().includes(text);
    })
    .sort(byRarity);
  morphChildren(
    document.getElementById("rpgBuilderGrid"),
    shown.length
      ? shown.map((id) => {
          // (another class's card: only to look at - how many of it the player has)
          if (!mine[id]) {
            var have = ownedAll[id] || 0;
            var other = cardEl(id, { base: true, className: (have ? "" : "unowned") + " spent" });
            other.appendChild(el("span", "rpg-cardx-count", have ? "×" + have : "🔒"));
            other.title = (have ? "You own " + have + ". " : "Not owned yet. ") + "This card belongs to another class.";
            return craftMode ? craftCell(other, id) : other;
          }
          var all = hero.collection[id] || 0;
          var owned = Math.min(all, rules.cardRarities[cardOf(id).rarity].copies);
          var spare = owned - (counts[id] || 0);
          var full = deck.length >= hero.deckMax;
          var node = cardEl(id, { base: true, act: spare > 0 && !full ? "deckAdd" : "", className: (owned ? "" : "unowned") + (spare > 0 && !full ? " pickable" : " spent") });
          if (spare > 0) node.dataset.drag = "in:" + id;
          node.draggable = spare > 0;
          var pips = el("span", "rpg-copies");
          for (var i = 0; i < Math.max(owned, 1); i++) pips.appendChild(el("i", i < (counts[id] || 0) ? "used" : i < owned ? "" : "none"));
          node.appendChild(pips);
          node.appendChild(el("span", "rpg-cardx-count", owned ? (counts[id] || 0) + " / " + owned + (all > owned ? " · +" + (all - owned) : "") : "🔒"));
          node.title = !owned ? "Not owned yet." : spare <= 0 ? "All your copies are in the deck." : full ? "Your deck is full." : "Click or drag it into your deck.";
          // (a copy missing: made of dust - spare copies: to dust)
          if (craftMode) {
            // (craft mode: the card only to look at - the actions under it)
            var plain = cardEl(id, { base: true, className: owned ? "" : "unowned" });
            plain.appendChild(el("span", "rpg-cardx-count", all ? "×" + all : "🔒"));
            return craftCell(plain, id);
          }
          return node;
        })
      : [emptyGrid()],
  );

  // The deck: rows (cheapest first) - a click takes one out
  morphChildren(document.getElementById("rpgBuilderCurve"), [curve(deck)]);
  var order = Object.keys(counts).sort(byCost);
  morphChildren(
    document.getElementById("rpgBuilderList"),
    order.length
      ? order.map((id) => {
          var card = cardOf(id);
          var row = el("div", "rpg-deck-row type-" + card.type + " rarity-" + card.rarity + (card.mythic ? " mythic" : ""));
          row.dataset.act = "deckRemove";
          row.dataset.id = id;
          row.dataset.drag = "out:" + id;
          row.draggable = true;
          row.title = card.text + " Click to remove it.";
          var cost = el("span", "rpg-row-cost");
          cost.dataset.cost = String(card.cost);
          row.append(cost, el("span", "rpg-row-icon", card.icon), el("span", "rpg-row-name", card.name));
          // (a class card: the class's icon)
          if (card.cls && rules.classes[card.cls]) {
            var mark = el("span", "rpg-row-class", rules.classes[card.cls].icon);
            mark.title = rules.classes[card.cls].name + " card";
            row.appendChild(mark);
          }
          row.appendChild(el("span", "rpg-row-count", counts[id] > 1 ? "×" + counts[id] : card.mythic ? "★" : ""));
          return row;
        })
      : [el("div", "rpg-empty mm-muted", "Empty")],
  );
  var attacks = deck.filter((id) => cardOf(id).type == "attack").length;
  var split = el("div", "rpg-deck-split");
  split.append(el("span", "rpg-split-attack", "⚔ " + attacks + " attacks"), el("span", "rpg-split-skill", "✦ " + (deck.length - attacks) + " skills"));
  morphChildren(document.getElementById("rpgBuilderNote"), [
    split,
    deck.length < hero.deckMin
      ? el("div", "rpg-warn", "⚠️ Need " + (hero.deckMin - deck.length) + " more cards (min " + hero.deckMin + ")")
      : deck.length > hero.deckMax
        ? el("div", "rpg-warn", "⚠️ Remove " + (deck.length - hero.deckMax) + " cards (max " + hero.deckMax + ")")
        : el("div", "rpg-ok", "✓ Ready"),
  ]);
}

var coolTimer = null;

// My share of the loot pot on a floor: far under my deepest cleared floor - less (as the server counts it)
function shareOf(n) {
  var low = rules.low || { free: 0, cut: 0, min: 100 };
  var under = (hero.deepest || 0) - n - low.free;
  // (and the same floor again today: less each time)
  return (under <= 0 ? 1 : Math.max(low.min / 100, 1 - (low.cut / 100) * under)) * ((hero.repeatPay || {})[n] || 1);
}

// A party's levels and mine: too far apart to join?
function gapOf(p) {
  var all = (p.levels || []).concat([hero.level || 1]);
  return Math.max.apply(null, all) - Math.min.apply(null, all) > rules.partyGap;
}

// The pot - what of it is mine in this run
function myPot(run) {
  var me = run.heroes.find((h) => h.name == myName);
  return Math.round(run.pot * (me && me.share != null ? me.share : 1));
}

// A floor's cooldown left (ms) - counted down from when the hero came
function cooldownOf(n) {
  return Math.max(0, ((hero.cooldowns || {})[n] || 0) - (Date.now() - heroAt));
}

// How long the character played is still dead (ms, 0: alive)
function deadNow() {
  return hero && hero.deadFor > 0 ? Math.max(0, hero.deadFor - (Date.now() - heroAt)) : 0;
}

function renderDoor() {
  floor = Math.max(1, Math.min(hero.maxFloor, floor));
  var entry = rules.entries[floor - 1];
  document.getElementById("rpgFloor").innerText = "Floor " + floor;
  var cleared = floor <= hero.deepest;
  // (a cleared floor run lately: cooling down - only another one's party goes there)
  var cool = cooldownOf(floor);
  var tag = cool
    ? el("span", "rpg-floor-tag cool", "⏳ Cooldown " + duration(cool))
    : el("span", "rpg-floor-tag " + (cleared ? "cleared" : "new"), cleared ? "✓ Cleared" : "✦ New");
  if (cool) tag.title = "Open again in " + duration(cool) + ".";
  // (the time on the tag counts down - the buttons back when it's over)
  clearTimeout(coolTimer);
  if (cool) coolTimer = setTimeout(renderDoor, Math.min(cool + 50, 30000));
  var info = [tag];
  // (how often this character already ran the floor today)
  var runs = (hero.runsToday || {})[floor] || 0;
  if (runs) {
    var again = el("span", "rpg-floor-tag runs", "🔁 " + runs + "× today");
    again.title = "You ran this floor " + (runs == 1 ? "once" : runs + " times") + " today. Each run on the same day gives a little less loot.";
    info.push(again);
  }
  // (far under my best floor: less loot - said right here)
  var share = shareOf(floor);
  if (share < 1) {
    var low = el("span", "rpg-floor-tag low", "🪙 " + Math.round(share * 100) + "% loot");
    // (both cuts multiply: a floor far below the best - and the same floor again today)
    var repeat = (hero.repeatPay || {})[floor];
    var below = share < (repeat || 1) - 0.001;
    low.title = (below && repeat ? "This floor is far below your best and you already ran it today" : repeat ? "You already ran this floor today" : "This floor is far below your best") + ", so you get " + Math.round(share * 100) + "% of the pot.";
    info.push(low);
  }
  document.getElementById("rpgFloorInfo").innerText = "Entry 🪙 " + formatCoins(entry) + " each";
  morphChildren(document.getElementById("rpgFloorTags"), info);
  document.getElementById("rpgFloorDown").disabled = floor <= 1;
  document.getElementById("rpgFloorUp").disabled = floor >= hero.maxFloor;
  document.getElementById("rpgSolo").disabled = myCoins < entry || !hero.cls || cool > 0;
  document.getElementById("rpgOpen").disabled = !hero.cls || cool > 0;
  // (the character dead: the ways down greyed - why on hover, a click does nothing)
  var deadTip = deadNow() ? "Your character is dead. It is back in " + duration(deadNow()) + "." : "";
  ["rpgSolo", "rpgOpen"].forEach((id) => {
    var b = document.getElementById(id);
    b.classList.toggle("dead", !!deadTip);
    if (deadTip) b.title = deadTip;
    else b.removeAttribute("title");
  });
  var sizes = [];
  // (the party size: a segment each - its number, a figure for every hero)
  for (var n = 2; n <= rules.partyMax; n++) {
    var seg = button("", "size", { id: n, className: "rpg-seg-btn" + (n == size ? " active" : ""), title: n + " heroes" });
    seg.append(el("b", "", String(n)), el("span", "rpg-seg-figs", "👤".repeat(n)));
    seg.title = "A party of " + n + " gets " + Math.round(rules.partyLoot * 100 * (n - 1)) + "% more loot.";
    sizes.push(seg);
  }
  morphChildren(document.getElementById("rpgSize"), sizes);

  var list = parties.length
    ? parties.map((p) => {
        var row = el("div", "rpg-party");
        var faces = el("div", "rpg-party-faces");
        p.members.forEach((name) => faces.appendChild(createAvatar(name, "sm")));
        // (the floor the party goes down to: a badge in front - out of reach: dimmed)
        var badge = el("div", "rpg-party-floor" + (p.floor > hero.maxFloor || cooldownOf(p.floor) || gapOf(p) ? " locked" : ""));
        badge.append(el("span", "rpg-party-floor-label", "Floor"), el("b", "", String(p.floor)));
        badge.title = "Every hero pays 🪙 " + formatCoins(rules.entries[p.floor - 1]) + " to enter.";
        var text = el("div", "rpg-party-text");
        var lowShare = shareOf(p.floor);
        var lv = p.levels && p.levels.length ? " · Lv " + Math.min.apply(null, p.levels) + (Math.max.apply(null, p.levels) > Math.min.apply(null, p.levels) ? "–" + Math.max.apply(null, p.levels) : "") : "";
        text.append(el("div", "rpg-party-name", p.leader + "'s party" + lv), el("div", "mm-muted small", p.members.length + " / " + p.size + " heroes · entry 🪙 " + formatCoins(rules.entries[p.floor - 1]) + " · loot +" + Math.round(rules.partyLoot * 100 * (p.size - 1)) + "%" + (lowShare < 1 ? " · yours " + Math.round(lowShare * 100) + "%" : "")));
        row.append(badge, faces, text);
        if (p.started) row.appendChild(el("span", "mm-muted small", "in the dungeon"));
        else if (p.floor > hero.maxFloor) row.appendChild(el("span", "mm-muted small", "floor not open"));
        else if (cooldownOf(p.floor)) row.appendChild(el("span", "mm-muted small", "⏳ " + duration(cooldownOf(p.floor))));
        else if (gapOf(p)) row.appendChild(el("span", "mm-muted small", "level gap too big"));
        else if (deadNow()) row.appendChild(button("Join", "", { className: "small dead", title: deadTip }));
        else row.appendChild(button("Join", "join", { id: p.id, className: "small", disabled: p.members.length >= p.size }));
        return row;
      })
    : [el("div", "rpg-empty mm-muted", "No open parties.")];
  morphChildren(document.getElementById("rpgParties"), list);
}

function renderLobby() {
  var title = document.getElementById("rpgLobbyTitle");
  morphChildren(title, [el("span", "rpg-lobby-floor", "Floor " + party.floor), el("span", "rpg-lobby-sub", party.leader + "'s party · 🪙 " + formatCoins(party.entry) + " each · " + party.members.length + " / " + party.size)]);
  var seats = [];
  for (var i = 0; i < party.size; i++) {
    var name = party.members[i];
    var seat = el("div", "rpg-seat" + (name ? "" : " empty") + (name == myName ? " me" : ""));
    if (name) {
      var who = (party.who || {})[name] || {};
      var cls = rules.classes[who.cls] || { icon: "❔", name: "" };
      if (name == party.leader) seat.appendChild(el("span", "rpg-seat-crown", "👑"));
      seat.append(createAvatar(name, "lg"), el("div", "rpg-seat-name", name), el("div", "rpg-seat-class", cls.icon + " " + cls.name + (who.level ? " · Lv " + who.level : "")));
      // (what the member brings: the stats the run starts with, the deepest floor cleared)
      if (who.hp) {
        var stats = el("div", "rpg-seat-stats");
        [
          ["💚", formatCoins(who.hp), "Max HP"],
          ["💪", who.atk, "Attack"],
          ["🛡️", who.def, "Armor"],
          ["🍀", who.crit + "%", "Chance of a critical hit"],
          ["🦊", who.dodge + "%", "Chance to dodge a hit"],
        ].forEach(([icon, value, tip]) => {
          var chip = el("span", "rpg-seat-stat", icon + " " + value);
          chip.title = tip;
          stats.appendChild(chip);
        });
        seat.append(stats, el("div", "rpg-seat-deepest", who.deepest ? "🏰 Deepest floor " + who.deepest : "🏰 No floor cleared yet"));
      }
    } else seat.append(el("div", "rpg-seat-free", "…"), el("div", "rpg-seat-name mm-muted", "Waiting"));
    seats.push(seat);
  }
  morphChildren(document.getElementById("rpgLobbySeats"), seats);
  var leader = party.leader == myName;
  var start = document.getElementById("rpgStart");
  start.hidden = !leader;
  // (a party: at least two - alone is "Go alone")
  var few = party.members.length < 2;
  start.disabled = few;
  start.innerText = few || party.members.length == party.size ? "⚔️ Start" : "⚔️ Start with " + party.members.length;
  document.getElementById("rpgLobbyNote").innerText = leader ? (few ? "Waiting for a second hero." : "") : "Waiting for " + party.leader + " to start.";
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
  // (on guard this turn: half of every hit blocked)
  else if (m.intent.move == "defend") text += "Blocks 50%";
  else text += move.name;
  badge.innerText = text;
  badge.title = m.intent.stunned ? "Stunned, it skips its next move." : move.name + (m.intent.target ? " on " + m.intent.target : "") + ". " + (move.text || "");
  if (m.intent.target == myName && m.intent.damage && !m.intent.stunned) badge.classList.add("at-me");
  return badge;
}

function renderRun() {
  var run = party.run;
  var me = run.heroes.find((h) => h.name == myName);
  document.getElementById("rpgRunFloor").innerText = run.tutorial ? "🎓 Practice" : "Floor " + run.floor;
  renderCoach(run, me);
  var pot = document.getElementById("rpgPot");
  pot.innerText = me && me.share < 1 ? "🪙 " + formatCoins(myPot(run)) + " for you (" + Math.round(me.share * 100) + "%)" : "🪙 " + formatCoins(run.pot) + " each";
  pot.title = me && me.share < 1 ? "This floor is far below your best, so you get " + Math.round(me.share * 100) + "% of the pot." : "";
  var quit = document.getElementById("rpgQuit");
  quit.hidden = !!party.result;

  var current = run.rooms[run.rooms.length - 1];
  document.getElementById("rpgRunRoom").innerText = current ? "Room " + run.rooms.length + " / " + run.map.length + " · " + rules.roomKinds[current.kind].icon + " " + rules.roomKinds[current.kind].name : "";
  renderMap(run);
  var fighting = run.phase == "fight";
  var arena = document.querySelector(".rpg-arena");
  arena.classList.toggle("aiming-foe", !!aiming && aiming.target == "foe");
  arena.classList.toggle("aiming-ally", !!aiming && (aiming.target == "ally" || aiming.target == "fallen"));

  renderModal(run, me);
  renderPartyStats(run);
  renderBuffs(run, me);

  var scene;
  if (fighting) {
    scene = run.monsters.map((m) => {
      var card = el("div", "rpg-monster rank-" + m.rank + (m.boss ? " boss" : "") + (m.phased ? " phased" : "") + (m.down ? " down" : "") + (m.id == target ? " target" : ""));
      card.dataset.act = m.down ? "" : "target";
      card.dataset.id = m.id;
      if (m.intent) card.appendChild(intentBadge(m));
      var name = el("div", "rpg-monster-name", m.name);
      if (m.affix) name.title = rules.affixes[m.affix].text;
      var art = el("div", "rpg-monster-art");
      art.append(el("div", "rpg-monster-icon", m.icon), el("i", "rpg-monster-ground"));
      // (what it is: a beast, the undead ... - a badge on the bottom edge, like a card's class)
      var type = m.type && rules.monsterTypes && rules.monsterTypes[m.type];
      var badge = null;
      if (type) {
        badge = el("span", "rpg-monster-type", type.icon);
        badge.title = type.name;
      }
      // (its armor: the share of every hit it takes off)
      if (m.armor) {
        var armor = el("span", "rpg-monster-armor", "🛡 " + Math.round(m.armor * 100) + "%");
        armor.title = "Its armor blocks " + Math.round(m.armor * 100) + "% of your damage.";
        art.appendChild(armor);
      }
      card.append(art, name, bar(m.hp, m.maxHp, "foe"), effectsRow(m.effects));
      // (what makes it hard: venomproof, fireproof, bulky, spiked)
      if ((m.traits || []).length) {
        var traits = el("div", "rpg-traits");
        m.traits.forEach((id) => {
          var t = rules.monsterTraits[id];
          var chip = el("span", "rpg-trait", t.icon + " " + t.name);
          chip.title = t.text;
          traits.appendChild(chip);
        });
        card.appendChild(traits);
      }
      // (an elite's affix and a chest's curse: a badge on top - what it does under its name)
      var marks = [];
      if (m.affix) marks.push([rules.affixes[m.affix].icon + " " + rules.affixes[m.affix].name, rules.affixes[m.affix].text, "affix-" + m.affix]);
      if (m.cursed) marks.push(["⛓️ Cursed", "Cursed by the chest. It hits far harder.", "affix-cursed"]);
      marks.forEach(([label, text, kind]) => {
        var mark = el("div", "rpg-affix " + kind);
        mark.append(el("b", "rpg-affix-name", label), el("span", "rpg-affix-text", text));
        card.appendChild(mark);
      });
      if (badge) card.appendChild(badge);
      // (summoned in this fight: a mark in its corner)
      if (m.called) {
        var called = el("span", "rpg-summoned", "🌀");
        called.title = "Summoned in this fight.";
        card.appendChild(called);
      }
      return card;
    });
  } else if (run.phase == "between") scene = [];
  else scene = [el("div", "rpg-quiet", sceneText(run))];
  morphChildren(document.getElementById("rpgMonsters"), scene);
  // (six or seven monsters: smaller cards - two rows)
  document.getElementById("rpgMonsters").classList.toggle("many", run.phase == "fight" && run.monsters.length >= 6);
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
    var armor = el("span", "rpg-armor", "🛡️ " + (h.def || 0));
    armor.title = "Armor takes part of every hit.";
    info.append(el("span", "", cls.icon + " " + (rules.classes[h.cls] || {}).name), armor, withFlask(el("span", "", " " + h.potions + (h.blessed ? " · ⛩️" : ""))));
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
  fitFullscreen();
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

// The rewards of a fight: a list - the coins (in the pot already), a card to add, a relic
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
  row("🪙", formatCoins(spoils.coins) + " coins each to the pot", null, null, true);
  row("⭐", "+" + spoils.xp + " XP", null, null, true);
  if (me.relicChoice) row("🏺", "Choose a relic", "rewardView", "relic");
  if (me.reward) row("🃏", "Add a card to your deck", "rewardView", "card");
  var left = !!(me.reward || me.relicChoice);
  return [el("div", "rpg-reward-title big", "⚔️ Victory!"), el("div", "rpg-reward-note mm-muted small", "Your rewards"), list, button(left ? "Skip the rest · Proceed" : "Proceed →", "spoilsDone", { id: String(spoils.room), className: left ? "small" : "primary" })];
}

// The party: every hero's stats, perks (talents, relics) and relics
var PERK_TEXT = {
  healHit: (v) => Math.round(v * 100) + "% of heals smite",
  startBlock: (v) => "+" + Math.round(v) + " block every turn",
  firstMana: (v) => "+" + v + " mana on turn one",
  draw: (v) => "+" + v + " card a turn",
  attack: (v) => "+" + Math.round(v * 100) + "% damage",
  firstStrike: (v) => "+" + Math.round(v * 100) + "% first attack",
  lowHp: (v) => "+" + Math.round(v * 100) + "% damage below half HP",
  crit: (v) => "+" + Math.round(v) + "% crit",
  lifesteal: (v) => Math.round(v * 100) + "% lifesteal",
  thorns: (v) => Math.round(v) + " thorns",
  block: (v) => "+" + Math.round(v * 100) + "% block",
  heal: (v) => "+" + Math.round(v * 100) + "% healing",
  afterFight: (v) => "heal " + Math.round(v * 100) + "% after a fight",
  poison: (v) => "+" + Math.round(v * 100) + "% poison",
  maxHp: (v) => "+" + Math.round(v * 100) + "% max HP",
  agi: (v) => "+" + Math.round(v) + "% dodge",
};
function renderPartyStats(run) {
  morphChildren(
    document.getElementById("rpgPartyStats"),
    run.heroes.map((h) => {
      var cls = rules.classes[h.cls] || { icon: "", name: "" };
      var row = el("div", "rpg-pstat cls-" + h.cls + (h.name == myName ? " me" : ""));
      var head = el("div", "rpg-pstat-head");
      var who = el("div", "rpg-pstat-who");
      who.append(el("b", "", h.name), el("span", "rpg-pstat-class", cls.icon + " " + cls.name));
      head.append(createAvatar(h.name, "md"), who);
      // (the HP as a bar on top - then a tile for every stat)
      head.appendChild(bar(h.hp, h.maxHp, "hero"));
      var stats = el("div", "rpg-pstat-stats");
      [
        ["💪", h.atk, "Attack", "Damage of your attacks"],
        ["🛡️", h.def, "Armor", "Less damage taken, more block"],
        ["🍀", Math.round(h.luck + (h.perks.crit || 0)) + "%", "Crit", "Chance of a critical hit"],
        ["🦊", Math.round(h.agi) + "%", "Dodge", h.cls == "rogue" ? "Dodge hits, sense rooms (far better)" : "Dodge hits, sense rooms"],
        [null, h.potions + " / " + (h.potionsMax || rules.potionsMax), "Potions", "Heal " + Math.round(rules.potionHeal * 100) + "% HP"],
      ].forEach(([icon, value, label, tip]) => {
        var tile = el("div", "rpg-pstat-tile");
        var pic = el("span", "rpg-pstat-icon", icon || "");
        if (!icon) pic.appendChild(flask());
        tile.append(pic, el("span", "rpg-pstat-value", String(value)), el("span", "rpg-pstat-label", label));
        tile.title = tip;
        stats.appendChild(tile);
      });
      var extras = el("div", "rpg-pstat-extras");
      (h.relics || []).forEach((id) => {
        var relic = rules.relics[id];
        var chip = el("span", "rpg-pstat-tag relic", relic.icon + " " + relic.name);
        chip.title = relic.text;
        extras.appendChild(chip);
      });
      // (thorns: the whole of it - the flat part and the share of the armor)
      if (h.thorns) {
        var thorns = el("span", "rpg-pstat-tag", "🌵 " + h.thorns + " thorns");
        thorns.title = "Who hits you takes " + h.thorns + " damage. It grows with your armor and your block.";
        extras.appendChild(thorns);
      }
      Object.keys(h.perks || {})
        .filter((k) => h.perks[k] && PERK_TEXT[k] && k != "thorns")
        .forEach((k) => extras.appendChild(el("span", "rpg-pstat-tag", "✦ " + PERK_TEXT[k](h.perks[k]))));
      if (!extras.childNodes.length) extras.appendChild(el("span", "rpg-pstat-tag none", "No relics or perks yet"));
      row.append(head, stats, extras);
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
  return [el("div", "rpg-reward-title", "🏺 Pick a relic"), row, button("‹ Back", "rewardView", { id: "list", className: "small" })];
}

// The card won in a fight: one of three for the deck
function rewardPanel(me) {
  var cards = el("div", "rpg-reward-cards");
  me.reward.forEach((id) => cards.appendChild(cardEl(id, { tag: "button", act: "pick", className: "pickable" })));
  return [
    el("div", "rpg-reward-title", "🃏 Add a card to your deck"),
    el("div", "rpg-reward-note mm-muted small", "The card stays in your deck for this run."),
    cards,
    // (a mage: other cards - a few times a run, only its own)
    party.run.rerolls != null && me.cls == "mage" ? button("🔮 Reroll (" + party.run.rerolls + " left)", "reroll", { className: "small", disabled: party.run.rerolls <= 0 }) : null,
    button("Skip this card", "pick", { id: "", className: "small" }),
    button("‹ Back", "rewardView", { id: "list", className: "small" }),
  ];
}

// The rooms that aren't fights: a picture, a story, the choices - what happened
var ROOM_STORY = {
  chest: "A heavy chest, its lock rusted through.",
  trap: "Thin wires across the floor. A trap.",
  rest: "A quiet corner and a crackling fire.",
  shrine: "An old shrine, dark with dried blood. It whispers of power - for a price.",
  merchant: 'A hooded merchant opens his pack. "Coins first, friend."',
};

function roomScene(run, me) {
  var ev = run.event;
  if (!ev && run.cleared) {
    // (the deep stairs: the floor is cleared - a stairway down to a far stronger guardian)
    var deep = el("div", "rpg-scene kind-deep");
    var body = el("div", "rpg-scene-body center");
    body.append(
      el("div", "rpg-deep-icon", "🕳️"),
      el("div", "rpg-scene-title", "The floor is cleared, but a dark stairway leads deeper"),
      el("div", "rpg-scene-story", "Going down costs nothing. A guardian far stronger than this floor waits below. Beat it and your pot " + (run.deepPay == 2 ? "doubles" : "grows " + run.deepPay + " times") + " to 🪙 " + formatCoins(myPot(run) * run.deepPay) + ". Fall and you lose the whole pot."),
    );
    deep.appendChild(body);
    return [deep];
  }
  if (!ev) {
    var done = el("div", "rpg-scene kind-cleared");
    var plain = el("div", "rpg-scene-body center");
    plain.append(el("div", "rpg-scene-title", "⚔️ The room is cleared"), el("div", "rpg-scene-story", "Pick the next room on the map 🗺️" + (run.heroes.length > 1 ? " - the party votes." : ".")));
    done.appendChild(plain);
    return [done];
  }
  var kind = rules.roomKinds[ev.kind];
  var enc = ev.encounter;
  var scene = el("div", "rpg-scene kind-" + ev.kind + (enc ? " enc-" + ev.id : ""));
  var art = el("div", "rpg-scene-art");
  art.appendChild(el("span", "rpg-scene-icon", enc ? enc.icon : kind.icon));
  var head = el("div", "rpg-scene-head");
  head.append(el("div", "rpg-scene-title", enc ? enc.name : kind.name), el("div", "rpg-scene-story", enc ? enc.story : ev.cursed ? "A heavy chest bound in black chains. Something hums inside." : ROOM_STORY[ev.kind] || kind.about));
  var body = el("div", "rpg-scene-body");
  if (ev.kind == "merchant") body.append(...shopNodes(run, me));
  else if (me && ev.choices && myName in ev.choices) body.append(...choiceNodes(run, me));
  // What happened in the room: cards of what I got (hover: the stats) - the others' in small (not at the merchant:
  // "Sold ✓" shows it - the battle log keeps every buy)
  var results = ev.results || {};
  var shared = ev.shared || [];
  if (ev.kind != "merchant" && (shared.length || Object.keys(results).length)) {
    var box = el("div", "rpg-event-box");
    var mine = shared.concat(results[myName] || []);
    var others = Object.keys(results).filter((name) => name != myName && results[name].length);
    if (!others.length) {
      if (mine.length) {
        var row = el("div", "rpg-results");
        mine.forEach((r) => row.appendChild(resultCard(r)));
        box.append(el("div", "rpg-label", run.heroes.length > 1 ? "You got" : "What happened"), row);
      }
    } else {
      // (a party: everyone's in one line - the faces of who got it on the top right; the very same loot once, with
      // all their faces; the pot's coins once, for everyone)
      var line = el("div", "rpg-results rpg-results-party");
      var sameAs = (r) => JSON.stringify(r.k == "gear" ? { k: "gear", name: r.item.name, rarity: r.item.rarity, slot: r.item.slot } : r);
      var groups = [];
      [myName].concat(others).forEach((name) => {
        var list = results[name] || [];
        if (!list.length) return;
        var key = list.map(sameAs).join("|");
        var same = groups.find((g) => g.key == key);
        if (same) same.names.push(name);
        else groups.push({ key: key, list: list, names: [name] });
      });
      // (the pot's coins of a room: one tile, summed)
      var pot = shared.filter((r) => r.k == "coins").reduce((sum, r) => sum + r.n, 0);
      var common = shared.filter((r) => r.k != "coins");
      if (pot) common.unshift({ k: "coins", n: pot });
      if (common.length) {
        var all = el("div", "rpg-got-group");
        common.forEach((r) => all.appendChild(resultCard(r)));
        line.appendChild(all);
      }
      // (every tile carries the faces of who got it)
      groups.forEach((group) => {
        group.list.forEach((r) => {
          var g = el("div", "rpg-got-group" + (group.names.includes(myName) ? " mine" : ""));
          var faces = el("div", "rpg-got-faces");
          group.names.forEach((name) => faces.appendChild(createAvatar(name, "sm")));
          g.append(resultCard(r), faces);
          line.appendChild(g);
        });
      });
      box.append(el("div", "rpg-label", "What the party got"), line);
    }
    body.appendChild(box);
  }
  // Who has chosen
  if (ev.choices && run.heroes.length > 1) {
    var who = el("div", "rpg-scene-party");
    Object.keys(ev.choices).forEach((name) => {
      var done = ev.choices[name] || (ev.votes || {})[name];
      var chip = el("span", "rpg-chose" + (done ? " done" : ""));
      chip.append(createAvatar(name, "sm"), el("span", "", done ? "✓" : "…"));
      chip.title = name + (done ? " has voted." : " is still choosing.");
      who.appendChild(chip);
    });
    body.appendChild(who);
  }
  scene.append(art, head, body);
  return [scene];
}

// The faces of a die - and the rolls already shown (a die rolls once)
var DICE = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
var rolled = new Set();

// What a room gave (or took): a small card - its stats on hover
function resultCard(r) {
  var node = el("div", "rpg-got");
  var icon = "✦";
  var name = "";
  var tip = "";
  if (r.k == "gear") {
    node.classList.add("rarity-" + r.item.rarity);
    icon = r.item.icon;
    name = r.item.name;
    tip = RARITY_NAMES[r.item.rarity] + " " + SLOT_NAMES[r.item.slot].toLowerCase() + "\n" + bonusOf(r.item).split(" · ").join("\n") + "\n" + wearers(r.item);
  } else if (r.k == "relic") {
    var relic = rules.relics[r.id] || { icon: "🏺", name: r.id, text: "" };
    node.classList.add("relic");
    icon = relic.icon;
    name = relic.name;
    tip = relic.text + " Lasts for this run.";
  } else if (r.k == "card") {
    var card = cardEl(r.id, { className: "small" + (r.lost ? " off" : "") });
    if (r.lost) card.appendChild(el("span", "rpg-got-tag bad", "Given away"));
    // (a card for the collection: a calm note under the card, not on it)
    if (r.loot) {
      var kept = el("div", "rpg-got-upgrade loot");
      kept.append(card, el("div", "rpg-got-note", "🎴 New card"));
      kept.title = "This card joins your collection when the run ends.";
      return kept;
    }
    // (an upgrade: what it changed, under the card)
    if (!r.lost && /\+$/.test(r.id)) {
      var up = el("div", "rpg-got-upgrade");
      up.append(card, el("div", "rpg-got-note", "🔨 " + cardOf(r.id).note));
      return up;
    }
    return card;
  } else if (r.k == "dice") {
    // (the imp's die: it tumbles, then the face lands)
    node.classList.add("dice", r.win ? "good" : "bad");
    var die = el("span", "rpg-die", DICE[r.n - 1]);
    var key = (party && party.run ? party.run.uid + ":" + party.run.rooms.length : "") + ":" + r.n;
    if (!rolled.has(key)) {
      rolled.add(key);
      die.classList.add("rolling");
      var turns = 0;
      var spin = setInterval(() => {
        die.innerText = DICE[Math.floor(Math.random() * 6)];
        if (++turns >= 9) {
          clearInterval(spin);
          die.innerText = DICE[r.n - 1];
          die.classList.remove("rolling");
          die.classList.add("landed");
        }
      }, 90);
    }
    node.appendChild(die);
    icon = null;
    name = "Rolled " + r.n + (r.win ? ", you win" : ", you lose");
  } else if (r.k == "coins") {
    node.classList.add("coins");
    icon = "🪙";
    name = formatCoins(r.n);
    tip = "Goes into the pot and is paid out at the end.";
  } else if (r.k == "hp") {
    node.classList.add("bad");
    icon = "💔";
    name = "-" + formatCoins(r.n) + " HP";
  } else if (r.k == "heal") {
    node.classList.add("good");
    icon = "💚";
    name = "+" + formatCoins(r.n) + " HP";
  } else if (r.k == "potion") {
    node.classList.add("good");
    node.appendChild(flask());
    name = "+1 potion";
    icon = null;
  } else if (r.k == "buff") {
    node.classList.add(r.bad ? "bad" : "good");
    icon = r.icon;
    name = r.text;
  } else {
    node.classList.add("none");
    icon = r.walked ? "🚶" : "🕸️";
    name = r.walked ? "Walked on" : "Nothing";
  }
  // (what kind of thing it is: a small label on top)
  var kind = { gear: r.item ? SLOT_NAMES[r.item.slot] : "Gear", relic: "Relic", coins: "Coins", hp: "Damage", heal: "Healing", potion: "Potion", buff: r.bad ? "Curse" : "Stat boost", dice: "Dice" }[r.k];
  if (kind) node.prepend(el("span", "rpg-got-kind", kind));
  if (icon) node.appendChild(el("span", "rpg-got-icon", icon));
  node.appendChild(el("span", "rpg-got-name", name));
  if (tip) node.title = tip;
  return node;
}

// A picture for every choice of a room
var OPTION_ICONS = { seal: "⛓️", rest: "💤", smith: "🔨", open: "🗝️", disarm: "🛠️", sneak: "👣", pray: "🙏", leave: "🚶", bottle: "⚗️", drink: "🍶", nap: "😴", purge: "🎁", read: "📖", roll: "🎲", take: "✋", temper: "🔥" };

// The choices of a room: big buttons - one of them (a card to pick: of the deck, or of the cards offered)
function choiceNodes(run, me) {
  var ev = run.event;
  var chosen = ev.choices[myName];
  // (a party: a vote - who voted for what on every option; a card the choice needs: picked after the vote)
  var votes = ev.votes || {};
  var voted = votes[myName] || null;
  var party = Object.keys(ev.choices).length > 1 && ev.kind != "merchant";
  var won = party && ev.chosen ? ev.options.find((o) => o.id == ev.chosen) : null;
  var voting = party && !won;
  var nodes = [];
  var row = el("div", "rpg-options");
  ev.options.forEach((o) => {
    var text = o.text;
    if (o.id == "disarm" && ev.disarm) text += " (🍀 " + ev.disarm[myName] + "%)";
    var mine = chosen == o.id || voted == o.id || (won && won.id == o.id);
    var b = el("button", "rpg-option" + (mine ? " chosen" : "") + (picking == o.id ? " picking" : "") + (o.card == "offer" && !voting ? " offer" : ""));
    b.type = "button";
    if (chosen || voted || won || (o.card == "offer" && !voting)) b.disabled = true;
    else {
      // (alone: a card option opens the deck to pick from - in a party's vote it is only a vote)
      b.dataset.act = o.card && !voting ? "pickMode" : "choose";
      b.dataset.id = o.id;
    }
    b.append(el("span", "rpg-option-icon", OPTION_ICONS[o.id] || "✦"), el("b", "", o.label + (o.card == "offer" && !chosen && !voting ? " ↓" : "")), el("span", "", text));
    if (mine) b.appendChild(el("i", "rpg-option-check", "✓"));
    var backers = Object.keys(votes).filter((n) => votes[n] == o.id);
    if (party && backers.length && !chosen) {
      var faces = el("span", "rpg-option-votes");
      backers.forEach((n) => faces.appendChild(createAvatar(n, "sm")));
      b.appendChild(faces);
    }
    row.appendChild(b);
  });
  nodes.push(row);
  if (chosen) {
    nodes.push(el("div", "rpg-scene-done", "Pick the next room on the map 🗺️"));
    return nodes;
  }
  if (voting) {
    nodes.push(el("div", voted ? "rpg-scene-done" : "rpg-label", "The party votes. The choice with the most votes happens for everyone."));
    return nodes;
  }
  // The card to pick: alone after choosing - in a party after the vote, for the option that won
  var cardOption = won ? (won.card ? won : null) : null;
  if (won && cardOption) nodes.push(el("div", "rpg-label", "The party chose " + won.label + "."));
  var offer = cardOption ? (cardOption.card == "offer" ? cardOption : null) : ev.options.find((o) => o.card == "offer");
  if (offer && ev.offers && ev.offers[myName]) {
    var cards = el("div", "rpg-reward-cards");
    ev.offers[myName].forEach((id) => cards.appendChild(cardEl(id, { tag: "button", act: "chooseCard", id: offer.id + ":" + id, className: "pickable" })));
    nodes.push(el("div", "rpg-label", "Pick one card for your deck."), cards);
  }
  var deckOption = cardOption && cardOption.card != "offer" ? cardOption.id : picking && ev.options.some((o) => o.id == picking) ? picking : null;
  if (deckOption) nodes.push(...deckPicker(me, deckOption == "smith" ? "Pick a card to upgrade. Hover a card to see what changes." : "Pick a card to give", deckOption));
  return nodes;
}

// The deck of this run to pick a card from (smith, give away, remove)
function deckPicker(me, text, option) {
  var deck = el("div", "rpg-reward-cards rpg-deck-pick");
  me.deck.forEach((id, i) => {
    var off = option == "smith" && /\+$/.test(id);
    var node = cardEl(id, { tag: "button", act: off ? "" : "chooseCard", id: option + ":" + i, className: "small" + (off ? " off" : " pickable") });
    if (option == "smith" && !off) node.title = cardOf(id + "+").note;
    deck.appendChild(node);
  });
  return [el("div", "rpg-label", text), deck];
}

// The merchant: cards, relics, a potion, a card taken out of the deck - with the own coins
function shopNodes(run, me) {
  var offer = me && run.event.offers && run.event.offers[myName];
  if (!offer) return [];
  var price = (id) => offer.prices[id];
  var tag = (id, sold) => el("span", "rpg-price" + (!sold && price(id) > myCoins ? " dear" : ""), sold ? "Sold ✓" : "🪙 " + formatCoins(price(id)));
  // (a visit: a few cards, one relic - the rest stays on the table)
  var limit = rules.merchantBuy || { cards: 2, relics: 1 };
  var cardsLeft = limit.cards - offer.bought.filter((id) => offer.cards.includes(id)).length;
  var relicsLeft = limit.relics - offer.bought.filter((id) => offer.relics.includes(id)).length;
  var cards = el("div", "rpg-shop-row");
  offer.cards.forEach((id) => {
    var sold = offer.bought.includes(id);
    var shut = !sold && cardsLeft <= 0;
    var card = cardEl(id, { tag: "button", act: sold || shut ? "" : "buy", className: "pickable" + (sold || shut ? " off" : "") });
    card.appendChild(tag(id, sold));
    cards.appendChild(card);
  });
  var relics = el("div", "rpg-shop-row");
  offer.relics.forEach((id) => {
    var relic = rules.relics[id];
    var sold = offer.bought.includes(id);
    var shut = !sold && relicsLeft <= 0;
    var tile = el("button", "rpg-relic-tile" + (sold || shut ? " off" : ""));
    tile.type = "button";
    if (!sold && !shut) {
      tile.dataset.act = "buy";
      tile.dataset.id = id;
    }
    tile.append(el("span", "rpg-relic-icon", relic.icon), el("b", "", relic.name), el("span", "mm-muted small", relic.text), tag(id, sold));
    relics.appendChild(tile);
  });
  var services = el("div", "rpg-shop-services");
  services.append(
    withFlask(button(" Potion · 🪙 " + formatCoins(price("potion")) + " (" + me.potions + "/" + (me.potionsMax || rules.potionsMax) + ")", "buy", { id: "potion", disabled: me.potions >= (me.potionsMax || rules.potionsMax) || myCoins < price("potion") })),
    button(offer.removed ? "🗑️ Card removed ✓" : "🗑️ Remove a card · 🪙 " + formatCoins(price("remove")), "pickMode", { id: "remove", className: picking == "remove" ? "voted" : "", disabled: offer.removed || myCoins < price("remove") || me.deck.length <= rules.deckLeast, title: "Remove a card for this run" }),
  );
  var nodes = [el("div", "rpg-shop-coins", "Your coins: 🪙 " + formatCoins(myCoins)), el("div", "rpg-label", "Cards · this run · " + Math.max(0, cardsLeft) + " of " + limit.cards + " left"), cards, el("div", "rpg-label", "Relics · this run · " + Math.max(0, relicsLeft) + " of " + limit.relics + " left"), relics, el("div", "rpg-label", "Services"), services];
  if (picking == "remove" && !offer.removed) nodes.push(...deckPicker(me, "Pick a card to remove", "remove"));
  return nodes;
}

// The map of the floor: rows from the bottom up - the rooms gone through, the ones to pick
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
      b.title = kind ? kind.name + ". " + kind.about + "." : "A hidden room.";
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
  // (the chance to sense a room: instinct raises it - a Rogue far more)
  var sense = document.getElementById("rpgMapSense");
  sense.innerText = "🦊 " + run.sense + "%";
  sense.title = "Your chance to sense a room. It scales with the instinct attribute, a Rogue senses far better.";
  var count = Object.keys(run.votes).length;
  document.getElementById("rpgMapNote").innerText = party.result ? "" : between ? (run.heroes.length > 1 ? count + " / " + run.heroes.length + " voted · a tie: random" : "Pick a lit room") : "";
}

// A pile of my cards to look at: the draw pile (in no order), the discard pile, the exhausted cards
function showPile(kind) {
  var me = party && party.run && party.run.heroes.find((h) => h.name == myName);
  if (!me || !me.piles) return;
  var names = { draw: "🂠 Draw pile", discard: "♻️ Discard pile", exhausted: "🔥 Exhausted" };
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
// How cards work: the (i) of the deck builder

// Every class side by side: its main stat, its strength in fights, its help out of them
function showClassHelp() {
  var grid = el("div", "rpg-first-grid");
  Object.keys(rules.classes).forEach((id) => grid.appendChild(classTile(id, false)));
  showBoard("Classes", "Strength in fights, an ability out of them - both grow.", [grid]);
}

// How cards work - shown with cards: the deck, a turn, attacks and skills, the cost, the monsters' turn, rarities
function showDeckHelp() {
  var cls = hero && hero.cls ? rules.classes[hero.cls] : rules.classes.warrior;
  var ids = Object.keys(rules.cards);
  var mine = (id) => !rules.cards[id].cls || rules.cards[id].cls == (hero && hero.cls);
  var find = (test) => ids.find((id) => mine(id) && test(rules.cards[id])) || ids.find((id) => test(rules.cards[id]));
  var attack = find((c) => c.type == "attack" && c.cost == 1 && (c.rarity || "basic") == "basic") || cls.signature[0];
  var skill = find((c) => c.type == "skill" && c.cost == 1 && (c.rarity || "basic") == "basic") || cls.signature[1];
  var dear = find((c) => c.cost == 2) || attack;
  var card = (id, extra) => cardEl(id, { className: "small" + (extra ? " " + extra : "") });
  var row = (nodes, extra) => {
    var box = el("div", "rpg-help-cards" + (extra ? " " + extra : ""));
    nodes.forEach((n) => box.appendChild(n));
    return box;
  };
  var tile = (title, visual, text) => {
    var t = el("div", "rpg-help-tile");
    t.append(el("div", "rpg-help-title", title), visual, el("div", "rpg-help-text", text));
    return t;
  };
  // (a monster's badge: what it does next)
  var intent = el("div", "rpg-help-intent");
  var badge = el("div", "rpg-intent move-attack", "⚔️ 9");
  intent.append(badge, el("div", "rpg-help-monster", "🐺"), el("div", "rpg-help-note", "Its badge: an attack for 9 next"));
  var mana = el("div", "rpg-help-mana");
  for (var i = 0; i < 3; i++) mana.appendChild(el("span", "rpg-help-gem", ""));
  var turn = el("div", "rpg-help-turn");
  turn.append(row([card(attack), card(skill), card(attack), card(skill), card(cls.signature[0])], "hand"), mana);
  var costCard = card(dear, "cost-call");
  var cost = el("div", "rpg-help-cost");
  cost.append(costCard, el("div", "rpg-help-note", "The drop in the corner: its mana cost"));
  var rarities = ["common", "rare", "epic", "legendary"].map((r) => find((c) => (c.rarity || "basic") == r)).filter(Boolean);
  var grid = el("div", "rpg-help-grid");
  grid.append(
    tile("🃏 Your deck", row(cls.signature.concat([attack]).map((id) => card(id)), "fan"), "Shuffled at the start of every fight."),
    tile("✋ A turn", turn, "5 cards, 3 mana - every card costs some."),
    tile("⚔️ Attack or 🛡️ skill", row([card(attack), card(skill)]), "Attacks hit. Skills block, heal or help."),
    tile("💧 The cost", cost, "Play what your mana pays for."),
    tile("⏭️ End the turn", intent, "Cards you keep stay in your hand. Then the monsters act."),
    tile("🎁 Grow it", row(rarities.map((id) => card(id)), "fan"), "A won fight: a card for the run. Packs: your collection."),
  );
  showBoard("How cards work", "Play cards with mana - the monsters show what they do next.", [grid]);
}

// A dialog just opened (on the body): into the full screen, if the page is in it - else it would stay hidden
function intoFullscreen() {
  var screen = document.fullscreenElement;
  var dialogs = document.querySelectorAll("body > .mm-dialog-backdrop");
  if (screen && dialogs.length) screen.appendChild(dialogs[dialogs.length - 1]);
}

function sceneText(run) {
  if (run.phase == "won") return "🎉 Floor " + run.floor + " cleared!";
  if (run.phase == "lost") return "💀 The party fell. Loot lost.";
  if (run.phase == "left") return "🚪 You left the dungeon with the loot.";
  return "";
}

// The bar under the scene: the hand in a fight, the vote between the rooms, the result at the end
function handBar(run, me) {
  if (party.result) {
    var box = el("div", "rpg-result");
    var loot = party.result == "lost" ? [] : run.loot[myName] || [];
    var lost = party.result == "lost";
    box.classList.add(lost ? "lost" : party.result == "won" ? "won" : "left");
    box.append(
      el("div", "rpg-result-icon", lost ? "💀" : party.result == "won" ? "🎉" : "🚪"),
      el("div", "rpg-result-title", lost ? "The party fell" : party.result == "won" ? "Floor cleared" : "You left the dungeon"),
      el("div", "rpg-result-coins", lost ? "The loot is lost." : "You get 🪙 " + formatCoins(party.summary && party.summary[myName] && party.summary[myName].pot != null ? party.summary[myName].pot : myPot(run)) + "."),
    );
    var sum = party.summary && party.summary[myName];
    if (sum) {
      var gains = el("div", "rpg-summary");
      gains.appendChild(el("span", "rpg-gain", "+" + sum.xp + " XP"));
      if (sum.ups) gains.appendChild(el("span", "rpg-gain up", "⬆️ Level " + sum.level + " and " + sum.ups + " new stat point" + (sum.ups == 1 ? "" : "s")));
      if (sum.firstClear) gains.appendChild(el("span", "rpg-gain first", "🏆 First clear bonus of 🪙 " + formatCoins(sum.firstClear)));
      box.appendChild(gains);
      if (lost) box.appendChild(el("div", "rpg-result-note", "You keep half of the XP."));
    }
    if (loot.length) {
      // (gear for the bag first - the cards for the collection in a row of their own below)
      var list = el("div", "rpg-result-loot");
      loot.filter((item) => !item.card).forEach((item) => list.appendChild(itemCard(item)));
      if (list.children.length) box.appendChild(list);
      var cards = el("div", "rpg-result-cards");
      loot.filter((item) => item.card).forEach((item) => {
        var won = el("div", "rpg-got-upgrade loot");
        won.append(cardEl(item.card, { className: "small" }), el("div", "rpg-got-note", "🎴 New card"));
        cards.appendChild(won);
      });
      if (cards.children.length) box.appendChild(cards);
    }
    box.appendChild(button("Back", "leave", { className: "primary" }));
    return [box];
  }
  var potion = potionButton(me, run);
  if (run.phase == "between") {
    var voted = run.votes[myName];
    var count = Object.keys(run.votes).length;
    var leave = button("🚪 Leave with 🪙 " + formatCoins(myPot(run)), "vote", { id: "leave", className: voted === "leave" ? "voted" : "" });
    var leavers = Object.keys(run.votes).filter((name) => run.votes[name] === "leave");
    if (leavers.length) leave.innerText += " (" + leavers.length + ")";
    // (the deep stairs: down for twice the pot - or out with it)
    var deep = null;
    if (run.cleared) {
      deep = button("🕳️ Go deeper to win 🪙 " + formatCoins(myPot(run) * run.deepPay), "vote", { id: "0", className: "danger" + (voted === 0 ? " voted" : "") });
      deep.title = "Free to enter. Win and you leave with 🪙 " + formatCoins(myPot(run) * run.deepPay) + ". Lose and you get nothing.";
      var divers = Object.keys(run.votes).filter((name) => run.votes[name] === 0);
      if (divers.length) deep.innerText += " (" + divers.length + ")";
    }
    if (deep) {
      var both = el("div", "rpg-deep-pick");
      both.append(deep, leave);
      leave = both;
    }
    if (run.heroes.length < 2) return deep ? [potion, leave] : [potion, el("div", "rpg-wait mm-muted", "🗺️ Pick the next room on the map"), leave];
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
  if (!me || me.down) return [el("div", "rpg-wait mm-muted", "💤 You are down until the fight ends.")];
  var energy = el("div", "rpg-energy" + (me.energy <= 0 ? " empty" : ""));
  energy.dataset.mana = me.energy + "/" + rules.energy;
  energy.title = "Your mana refills every turn.";
  var draw = pileButton("draw", "", me.drawCount, "Draw pile");
  var left = el("div", "rpg-hand-side");
  left.append(energy, draw);
  var hand = el("div", "rpg-hand" + (me.ended ? " ended" : ""));
  // (cards new in the hand: drawn - they fly in from the draw pile, one after the other)
  var handKey = run.uid + ":" + run.rooms.length;
  if (handSeen.key != handKey) handSeen = { key: handKey, uids: new Set() };
  var drawn = 0;
  me.hand.forEach((c, i) => {
    var card = cardOf(c.id);
    var node = cardEl(c.id, { tag: "button", act: "card", id: c.uid, disabled: me.ended || card.cost > me.energy || hidden(me, card), className: aiming && aiming.uid == c.uid ? "aimed" : "" });
    if (hidden(me, card)) node.title = "You can't hide in the smoke two turns in a row.";
    // (fanned a little)
    var mid = (me.hand.length - 1) / 2;
    node.style.setProperty("--tilt", (i - mid) * 3 + "deg");
    node.style.setProperty("--lift", Math.abs(i - mid) * 4 + "px");
    if (!handSeen.uids.has(c.uid)) {
      handSeen.uids.add(c.uid);
      node.classList.add("rpg-drawn");
      node.style.setProperty("--draw-delay", drawn++ * 110 + "ms");
    }
    hand.appendChild(node);
  });
  if (!me.hand.length) hand.appendChild(el("div", "rpg-wait mm-muted", "No cards left"));
  var waiting = run.heroes.filter((h) => !h.down && !h.ended).length;
  var end = button(me.ended ? "Waiting… (" + waiting + ")" : "End turn", "endTurn", { className: "primary rpg-end", disabled: me.ended });
  var discard = pileButton("discard", "♻", me.discardCount, "Discard pile");
  var exhausted = me.piles && me.piles.exhausted.length ? pileButton("exhausted", "🔥", me.piles.exhausted.length, "Exhausted") : null;
  var tools = el("div", "rpg-hand-tools");
  tools.append(potion, discard);
  if (exhausted) tools.appendChild(exhausted);
  var right = el("div", "rpg-hand-side");
  right.append(end, tools);
  var nodes = [left, hand, right];
  if (aiming) nodes.unshift(el("div", "rpg-aim-hint", aiming.target == "foe" ? "🎯 Pick a foe" : "🎯 Pick an ally"));
  return nodes;
}

var handSeen = { key: null, uids: new Set() }; // the cards of the hand shown already (the new ones: drawn)

// A health potion: a red flask - its count, its mana in a fight
var POTION_SVG =
  '<svg viewBox="0 0 32 40" aria-hidden="true"><rect x="12" y="2" width="8" height="5" rx="1.5" fill="#a0703c"/><path d="M13 7h6v6.5a11 11 0 1 1-6 0z" fill="rgba(255,255,255,.18)" stroke="rgba(255,255,255,.55)" stroke-width="1.4"/><path d="M6.2 24a9.8 9.8 0 0 0 19.6 0z" fill="#e0344a"/><path d="M6.6 22.2c3-1.6 6.3 1.1 9.4 0s6.4-1.6 9.4 0A9.8 9.8 0 0 1 25.8 24H6.2c0-.6.1-1.2.4-1.8z" fill="#ff5a6e"/><path d="M14.2 27.6h3.6M16 25.8v3.6" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><ellipse cx="11" cy="19" rx="1.6" ry="3" fill="rgba(255,255,255,.55)" transform="rotate(25 11 19)"/></svg>';
// A small health flask (instead of an emoji): {className} - "off": an empty one
function flask(className) {
  var span = el("span", "rpg-flask" + (className ? " " + className : ""));
  span.innerHTML = POTION_SVG;
  return span;
}

function withFlask(node) {
  node.prepend(flask());
  return node;
}

function potionButton(me, run) {
  var fight = run.phase == "fight";
  var b = el("button", "rpg-potion-btn");
  b.type = "button";
  b.dataset.act = "drink";
  b.disabled = !me || me.down || me.potions <= 0 || me.hp >= me.maxHp || (fight && (me.ended || me.energy < rules.potionMana));
  b.title = "A potion heals " + Math.round(rules.potionHeal * 100) + "% of your HP" + (fight ? " and costs " + rules.potionMana + " mana in a fight." : ".");
  b.innerHTML = POTION_SVG;
  b.appendChild(el("span", "rpg-potion-count", String(me ? me.potions : 0)));
  if (fight) b.appendChild(el("span", "rpg-potion-mana", String(rules.potionMana)));
  return b;
}

// A pile to look into: its icon, its count
// A pile beside the hand: a little stack of card backs, its count - a click looks into it
var PILE_LABELS = { draw: "Draw", discard: "Discard", exhausted: "Exhausted" };
function pileButton(id, icon, count, title) {
  var b = button("", "pile", { id: id, className: "rpg-pile pile-" + id + (count ? "" : " empty"), title: title + " - click to look" });
  var stack = el("span", "rpg-pile-stack");
  stack.append(el("i", ""), el("i", ""), el("span", "rpg-pile-icon", icon));
  b.append(stack, el("b", "rpg-pile-count", String(count)), el("span", "rpg-pile-label", PILE_LABELS[id] || title));
  return b;
}

// The hand fanned into the room it has: the cards overlap more the less room there is
function fitHand() {
  var hand = document.querySelector("#rpgHandBar .rpg-hand");
  var first = hand && hand.querySelector(".rpg-cardx");
  if (!first) return;
  var n = hand.querySelectorAll(".rpg-cardx").length;
  // (room left for the tilt of the outer cards)
  var squeeze = Math.max(1, (n * first.offsetWidth - (hand.clientWidth - 48)) / (2 * n));
  hand.style.setProperty("--squeeze", squeeze + "px");
}
window.addEventListener("resize", fitHand);

// Full screen: the fight as high as the screen below the header (the hand never under its edge)
function fitFullscreen() {
  var main = document.querySelector(".rpg-main");
  var stage = document.querySelector(".rpg-stage");
  if (!main || !stage || document.fullscreenElement != main || stage.offsetParent == null) return;
  var top = stage.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop;
  main.style.setProperty("--rpg-fs-top", Math.ceil(top + parseFloat(getComputedStyle(main).paddingBottom)) + "px");
}
window.addEventListener("resize", fitFullscreen);
document.addEventListener("fullscreenchange", () => setTimeout(fitFullscreen, 50));

// The time of a turn (only with others), counting down
function tick() {
  var clock = document.getElementById("rpgClock");
  var text = "";
  if (party && party.run && !party.result && party.timeLeft != null) {
    var left = Math.max(0, Math.ceil((party.timeLeft - (Date.now() - partyAt)) / 1000));
    text = "⏱ " + left + "s";
    clock.classList.toggle("low", left <= 10);
    clock.title = "Time left for this turn.";
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
  if (card.cost > me.energy || me.ended || hidden(me, card)) return;
  var foes = run.monsters.filter((m) => !m.down);
  var standing = run.heroes.filter((h) => !h.down);
  var fallen = run.heroes.filter((h) => h.down);
  if (card.target == "foe") {
    var aimed = foes.find((m) => m.id == target) || (foes.length == 1 ? foes[0] : null);
    if (aimed) return playCard({ uid: uid, target: aimed.id });
  } else if (card.target == "ally") {
    if (standing.length == 1) return playCard({ uid: uid, ally: myName });
  } else if (card.target == "fallen") {
    if (fallen.length == 1) return playCard({ uid: uid, ally: fallen[0].name });
    if (!fallen.length) return showToast("Nobody to bring back.", "error");
  } else return playCard({ uid: uid });
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
    // (no text marked while dragging)
    document.body.classList.add("rpg-dragging");
    var marked = window.getSelection && window.getSelection();
    if (marked) marked.removeAllRanges();
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
  document.body.classList.remove("rpg-dragging");
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
    if (t == "foe" && over.kind == "foe") playCard({ uid: current.uid, target: over.id });
    else if ((t == "ally" || t == "fallen") && over.kind == "hero") playCard({ uid: current.uid, ally: over.id });
    else if (t == "ally" && over.kind != "foe") playCard({ uid: current.uid, ally: myName });
    else if (t == "none") playCard({ uid: current.uid });
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
  if ((deckMenu || playerMenu) && !event.target.closest(".rpg-deck-drop")) {
    deckMenu = playerMenu = false;
    render();
  }
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
  else if (act == "tradeWho") {
    playerMenu = false;
    tradeWith = id;
    tradeTheirs = null;
    tradePick = { give: tradePick.give, take: {} };
    if (tradeWith) socket.emit("tradeLook", { name: tradeWith });
    render();
  } else if (act == "tradePick") {
    var [side, key] = id.split("|");
    var list = side == "give" ? hero.tradeable || [] : tradeTheirs ? tradeTheirs.list : [];
    var one = list.find((entry) => tradeKey(entry) == key);
    if (!one) return;
    if (tradeKind() && tradeKind() != (one.k == "card" ? "card" : "gear")) return;
    var next = (tradePick[side][key] || 0) + 1;
    if (next > (one.k == "card" ? one.n : 1)) delete tradePick[side][key];
    else tradePick[side][key] = next;
    render();
  } else if (act == "tradeSend") {
    socket.emit("tradeOffer", { to: tradeWith, give: tradeSide(hero.tradeable || [], tradePick.give), take: tradeSide(tradeTheirs ? tradeTheirs.list : [], tradePick.take), giveCoins: tradeCoinPick.give, takeCoins: tradeCoinPick.take });
    tradePick = { give: {}, take: {} };
    tradeCoinPick = { give: 0, take: 0 };
    document.querySelectorAll(".rpg-trade-coins input").forEach((input) => (input.value = ""));
  } else if (act == "tradeAccept") socket.emit("tradeAnswer", { id: id, accept: true });
  else if (act == "tradeDecline") socket.emit("tradeAnswer", { id: id, accept: false });
  else if (act == "tradeCancel") socket.emit("tradeCancel", { id: id });
  else if (act == "dustAll") {
    var spare = hero.dustable || [];
    var total = spare.reduce((sum, one) => sum + one.dust, 0);
    var count = spare.reduce((sum, one) => sum + one.n, 0);
    confirmDialog({ title: "Dust " + count + " spare card" + (count == 1 ? "" : "s") + "?", text: "Only copies past what a deck can hold are dusted, for every class. You get " + total + " dust.", confirmLabel: "Dust them" }).then((sure) => sure && socket.emit("dustAll"));
  } else if (act == "dustNeeded") {
    var [needCls, needId] = id.split("|");
    var needCard = cardOf(needId);
    confirmDialog({ title: "Dust " + needCard.name + "?", text: "This copy is not spare. It leaves every deck that uses it and you get " + rules.dust[needCard.rarity].get + " dust.", confirmLabel: "Dust it", danger: true }).then((sure) => sure && socket.emit("dust", { cls: needCls, id: needId, n: 1, any: true }));
  } else if (act == "dustOne") {
    var [cls, cardId] = id.split("|");
    socket.emit("dust", { cls: cls, id: cardId, n: 1 });
  } else if (act == "craft") socket.emit("craft", { id: id });
  else if (act == "packDust") socket.emit("packDust", { id: id });
  else if (act == "playerMenu") {
    playerMenu = !playerMenu;
    render();
  } else if (act == "deckMenu") {
    deckMenu = !deckMenu;
    render();
  } else if (act == "craftMode") {
    craftMode = !craftMode;
    render();
  } else if (act == "deckRename") {
    deckMenu = false;
    render();
    var slot = hero.deckAt || 0;
    confirmDialog({ title: "Rename this deck", text: "Give it a short name, or leave it empty for its number.", confirmLabel: "Save", input: { value: (hero.deckNames || [])[slot] || "", placeholder: "Deck " + (slot + 1), maxLength: 20 } }).then((name) => name !== false && socket.emit("deckName", { slot: slot, name: name }));
  }
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
  else if (act == "autoPotions") socket.emit("autoPotions", { on: !hero.autoPotions });
  else if (act == "revive") socket.emit("revive");
  else if (act == "bagSlot") socket.emit("bagSlot");
  else if (act == "potionSlot") socket.emit("potionSlot");
  else if (act == "deckSlot") socket.emit("deckSlot");
  else if (act == "deckUse") {
    deckMenu = false;
    socket.emit("deckUse", { slot: Number(id) });
  }
  else if (act == "tutorial") socket.emit("tutorial");
  else if (act == "skipTutorial") socket.emit("skipTutorial");
  else if (act == "deckHelp") showDeckHelp();
  else if (act == "classHelp") showClassHelp();
  else if (act == "quitRun") {
    var asked = confirmDialog({ title: "Leave the run?", text: "You lose your share of the pot and your loot.", confirmLabel: "Leave", danger: true });
    intoFullscreen();
    asked.then((sure) => sure && socket.emit("leave"));
  } else if (act == "cartAdd") {
    cart[id] = Math.min(rules.cartMax, (cart[id] || 0) + 1);
    render();
  } else if (act == "cartLess") {
    cart[id] = Math.max(0, (cart[id] || 0) - 1);
    render();
  } else if (act == "cartClear") {
    cart = {};
    render();
  } else if (act == "cartBuy") socket.emit("buyPacks", { cart: cart, dust: payDust });
  else if (act == "filtersReset") {
    filters = { type: "all", cost: "all", rarity: "all", owned: false, pool: "all" };
    search = "";
    document.getElementById("rpgSearch").value = "";
    render();
  } else if (act == "payWith") {
    payDust = id == "dust";
    render();
  }
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
      playCard({ uid: aiming.uid, target: id });
      aiming = null;
    } else target = id;
    render();
  } else if (act == "ally") {
    if (aiming && aiming.target != "foe") {
      playCard({ uid: aiming.uid, ally: id });
      aiming = null;
      render();
    }
  } else if (act == "endTurn") {
    aiming = null;
    socket.emit("endTurn");
  } else if (act == "drink") socket.emit("drink");
  else if (act == "reroll") socket.emit("reroll");
  else if (act == "pick") {
    socket.emit("pick", { card: id || null });
    rewardView = "list";
  }
  else if (act == "vote") {
    // (only between two rooms - and not the second click of a double click that just opened this room)
    if (!party || !party.run || party.run.phase != "between" || Date.now() - roomSince < DOOR_DELAY) return;
    socket.emit("vote", { door: id == "leave" ? "leave" : Number(id) });
  }
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
      text: "🪙 " + formatCoins(price) + " - a new character. " + cls.about + ".",
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
document.getElementById("rpgSolo").addEventListener("click", () => deadNow() || socket.emit("create", { floor: floor, size: 1 }));
document.getElementById("rpgOpen").addEventListener("click", () => deadNow() || socket.emit("create", { floor: floor, size: size }));
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
  if (window.sfx) window.sfx("coins");
  var n = data.items.reduce((sum, [, count]) => sum + count, 0);
  render();
  // (the hint on the Inventory tab - it glows a moment: the packs wait there)
  var tab = document.querySelector('#rpgNav [data-id="gear"]');
  showHint("🎴 " + n + " pack" + (n == 1 ? "" : "s") + " in your Inventory", "", tab);
  if (tab) {
    tab.classList.remove("rpg-glow");
    void tab.offsetWidth;
    tab.classList.add("rpg-glow");
  }
});
document.getElementById("rpgStart").addEventListener("click", () => socket.emit("start"));
document.getElementById("rpgLeave").addEventListener("click", () => socket.emit("leave"));

// The shop's sections: a click flips to one; the one in view is marked (the window or the full screen scrolls)
(function setupShopSections() {
  var buttons = [...document.querySelectorAll("#rpgShopSections [data-section]")];
  var mark = (id) => buttons.forEach((b) => b.classList.toggle("active", b.dataset.section == id));
  buttons.forEach((b) =>
    b.addEventListener("click", () => {
      document.getElementById(b.dataset.section).scrollIntoView({ behavior: "smooth", block: "start" });
      mark(b.dataset.section);
    }),
  );
  // (the section whose top passed the upper third of the screen last)
  var pick = () => {
    var current = buttons[0].dataset.section;
    // (at the very top: the first one)
    var scroller = document.fullscreenElement || document.scrollingElement;
    if (scroller.scrollTop < 40) return mark(current);
    buttons.forEach((b) => {
      if (document.getElementById(b.dataset.section).getBoundingClientRect().top < window.innerHeight / 3) current = b.dataset.section;
    });
    mark(current);
  };
  var queued = false;
  document.addEventListener(
    "scroll",
    () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        pick();
      });
    },
    { passive: true, capture: true },
  );
  pick();
})();

document.addEventListener("DOMContentLoaded", () => setupChat());

// The coins of a new trade offer typed in: counted on their side right away
document.addEventListener("input", (event) => {
  var input = event.target.closest(".rpg-trade-coins input");
  if (!input) return;
  var n = Math.floor(Number(input.value));
  tradeCoinPick[input.dataset.side] = Number.isFinite(n) && n > 0 ? n : 0;
  renderTrade();
});
