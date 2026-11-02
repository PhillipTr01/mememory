/* Frog Pond: the server fills the pond, moves the frogs, lets the features act and pays, this page only shows the spin. */
const socket = io((window.CASINO_NS || "") + "/pond");

var myName = null;
var myCoins = 0;
var myCapRule = null; // the max bet by balance of a spin ({floor, share} - null: no cap), see casinoCapLeft
var myBuyCapRule = null; // ... of a bonus buy (counts like a bet at a table)
var setup = null; // {symbols, families, features, amberValues, size, maxLevel, meter, chests, free, maxWin, buy, rules}
var spinning = false;
var pausedUntil = 0; // after a spin: the next one only from then on
var spinWatch = null; // no answer from the server: the spin button comes back
var activeBonus = null; // the id of the free spins playing on this page
var skipping = false; // the player skips the rest of the free spins
var BET_KEY = "pondBet";
var maxMode = false;
var PRESET_COUNT = 6;
var autoLeft = 0; // auto spins left (Infinity: until stopped)

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

function symbolOf(id) {
  return setup.symbols.find((symbol) => symbol.id == id);
}
function iconOf(id) {
  var symbol = setup && symbolOf(id);
  return symbol ? symbol.icon : "";
}

// (skipping the free spins: no more waiting)
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, skipping ? 0 : Math.max(0, ms)));

// The note of a win in the best wins (casino_best.js): "9 berry" -> "9 × 🍓", "free spins 12" -> "🌕 12 free spins"
function pondNote(text) {
  if (!setup) return text;
  var amber = /^(\d+) (\w+)/.exec(text);
  if (amber && setup.families.some((family) => family.id == amber[2])) return amber[1] + " × " + familyIcon(amber[2]);
  var free = /^free spins (\d+)/.exec(text);
  if (free) return "🌕 " + free[1] + " free spins";
  if (/^coins/.test(text)) return "🪙 Coins";
  if (/^frog leap/.test(text)) return "🐸 Frog leap";
  return text;
}

/* ---------- Socket ---------- */

socket.on("connect", () => (document.getElementById("connectionBanner").hidden = true));
socket.on("disconnect", () => {
  document.getElementById("connectionBanner").hidden = false;
  spinning = false;
  renderControls();
});
socket.on("connect_error", (error) => {
  if (error && error.message == "unauthorized") window.location.href = "/?next=" + encodeURIComponent(location.pathname + location.search);
});
socket.on("casinoClosed", () => window.location.reload());
socket.on("gameOff", () => (window.location.href = "./"));
window.addEventListener("pagehide", () => socket.disconnect());

// A phone puts the page away during the free spins: the server holds them - back on the page they go on
var awayInBonus = false;
document.addEventListener("visibilitychange", () => {
  if (document.hidden && activeBonus) {
    awayInBonus = true;
    socket.disconnect();
  } else if (!document.hidden && awayInBonus) {
    location.reload();
  }
});

socket.on("joined", (data) => (myName = data.username));
socket.on("coins", (data) => {
  myCoins = data.coins;
  myCapRule = data.capRules && "pond" in data.capRules ? data.capRules.pond : data.betCapRule || null;
  myBuyCapRule = data.capRules && "pond:buy" in data.capRules ? data.capRules["pond:buy"] : data.betCapRule || null;
  if (!spinning || document.getElementById("pdCoins").innerText == "-") renderCoins(myCoins);
  followMax();
  renderControls();
});
socket.on("pdError", (message) => {
  clearTimeout(spinWatch);
  if (autoLeft) stopAuto();
  showHint(message, "error", document.getElementById("pdSpin"));
  spinning = false;
  renderControls();
});
// Too early (the server wants a gap between two spins): once more in a moment
socket.on("pdSkip", () => {
  clearTimeout(spinWatch);
  setTimeout(() => {
    if (spinning) socket.emit("spin", lastRequest);
  }, 400);
});

socket.on("pdSetup", (data) => {
  var first = setup == null;
  setup = data;
  if (first) {
    renderFrogs();
    renderPresets();
    if (readBet() == "max") pickMax();
    else setBet(Number(readBet()) || 100);
    resetPanel(null, 0, 0, null, false);
    showGrid(startScreen(), false, { frogs: startFrogs() });
  }
  renderControls();
});

socket.on("pdResult", (result) => {
  clearTimeout(spinWatch);
  playSpin(result);
});

// Back on the page: free spins that waited go on where they were
socket.on("pdResume", (result) => {
  if (setup == null) return setTimeout(() => socket.listeners("pdResume")[0](result), 200);
  if (activeBonus == result.id) return;
  resumeBonus(result);
});
socket.on("pdFeed", renderFeed);

/* ---------- The pond ---------- */

var shown = null; // the pond on the screen
var cells = []; // cells[column][row] - the elements
var frogSpots = {}; // where the frogs sit on the screen: {leaf: [c, r], ...}
var frogEls = {}; // the frogs on the pond

function familyInfo(id) {
  return setup.families.find((family) => family.id == id);
}
// The icon in the amber of a colour
function familyIcon(id) {
  var family = setup && familyInfo(id);
  return family ? family.icon : "";
}
function zeros() {
  return Object.fromEntries(setup.families.map((family) => [family.id, 0]));
}

// A pond to start with: the colours and a few features mixed, empty spots between them
function startScreen() {
  var ids = setup.families.map((family) => family.id).concat([null, null, "coin1", null, "wild"]);
  var n = setup.size[0];
  return Array.from({ length: n }, (_, c) => Array.from({ length: n }, (_, r) => ids[(c * 5 + r * 7) % ids.length]));
}
function startFrogs() {
  var n = setup.size[0];
  var spots = [[1, 1], [n - 2, 1], [1, n - 2], [n - 2, n - 2]];
  return Object.fromEntries(setup.families.map((family, i) => [family.id, spots[i]]));
}

function boardSize() {
  var box = document.getElementById("pdBoard");
  return box.clientWidth || 360;
}

var levelsShown = {};
// The content of a spot: an amber (its colour, its level), a coin (its win), a feature, a fly or nothing
function fillCell(cell, id, bet) {
  var symbol = id == null ? null : symbolOf(id);
  cell.className = "pd-sym" + (symbol == null ? " pd-empty" : symbol.family ? " pd-amber" : symbol.fly ? " pd-fly" : " pd-feature pd-" + symbol.feature);
  cell.replaceChildren();
  cell.style.removeProperty("--fam");
  if (symbol == null) return;
  if (symbol.family) {
    cell.style.setProperty("--fam", familyInfo(symbol.family).color);
    var level = levelsShown[symbol.family] || 0;
    cell.dataset.level = level;
    var gem = el("span", "pd-sym-icon pd-gem");
    gem.innerHTML = GEM_SVG;
    cell.append(gem);
    if (level > 0) cell.append(el("span", "pd-sym-level", "★" + level));
    return;
  }
  cell.append(el("span", "pd-sym-icon", symbol.icon));
  if (symbol.coin != null) cell.append(el("span", "pd-sym-coin", shortCoins(symbol.coin * (bet || currentBet() || 0))));
}

// A win on the pond: short (12.5K), small ones with their cents (1.99)
function shortCoins(value) {
  if (value < 100) return formatCoins(Math.round(value * 100) / 100);
  value = Math.floor(value);
  if (value >= 1000000) return Math.round(value / 100000) / 10 + "M";
  if (value >= 10000) return Math.round(value / 100) / 10 + "K";
  return formatCoins(value);
}

// The pond on the screen: square spots, the frogs on top (drop: the symbols fall in, by column)
function showGrid(grid, drop, options) {
  options = options || {};
  var box = document.getElementById("pdBoard");
  var width = boardSize();
  var n = grid.length;
  var size = width / n;
  box.style.setProperty("--cell", size + "px");
  cells = [];
  var columns = grid.map((column, c) => {
    var columnBox = el("div", "pd-column");
    columnBox.style.left = c * size + "px";
    columnBox.style.width = size + "px";
    cells[c] = column.map((id, r) => {
      var cell = el("div", "pd-sym");
      cell.style.top = r * size + "px";
      cell.style.height = size + "px";
      fillCell(cell, id, options.bet);
      columnBox.appendChild(cell);
      return cell;
    });
    return columnBox;
  });
  var layer = el("div", "pd-frog-layer");
  frogEls = {};
  setup.families.forEach((family) => {
    var frog = el("div", "pd-board-frog");
    frog.style.setProperty("--fam", family.color);
    frog.style.width = frog.style.height = size + "px";
    frog.innerHTML = FROG_SVG;
    frog.title = family.frog;
    layer.append(frog);
    frogEls[family.id] = frog;
  });
  box.replaceChildren(...columns, layer);
  shown = grid;
  renderSize(n);
  if (options.frogs) frogSpots = JSON.parse(JSON.stringify(options.frogs));
  placeFrogs();
  if (!drop) return Promise.resolve();
  var time = options.time || setup.rules.spinTime * 0.75;
  var animations = [];
  cells.forEach((column, c) =>
    column.forEach((cell, r) => {
      animations.push(
        cell.animate([{ transform: "translateY(" + -(width + 40) + "px)" }, { transform: "translateY(0)" }], {
          duration: time * 0.55,
          delay: c * time * 0.06 + (column.length - r) * 16,
          easing: "cubic-bezier(.25,.9,.35,1.15)",
          fill: "backwards",
        }).finished,
      );
    }),
  );
  Object.values(frogEls).forEach((frog, i) => animations.push(frog.animate([{ transform: frogTransform(frog) + " scale(0)" }, { transform: frogTransform(frog) + " scale(1)" }], { duration: time * 0.35, delay: time * 0.5 + i * 60, easing: "cubic-bezier(.3,1.6,.5,1)", fill: "backwards" }).finished));
  return Promise.all(animations);
}

function frogTransform(frog) {
  return "translate(" + frog.dataset.x + "px, " + frog.dataset.y + "px)";
}

function placeFrogs() {
  var size = boardSize() / (shown ? shown.length : setup.size[0]);
  Object.entries(frogEls).forEach(([family, frog]) => {
    var spot = frogSpots[family];
    frog.hidden = !spot;
    if (!spot) return;
    frog.dataset.x = spot[0] * size;
    frog.dataset.y = spot[1] * size;
    frog.style.transform = frogTransform(frog);
  });
}

// The symbols on the pond fall out at the bottom, the frogs dive (before the next spin drops in)
function dropOut() {
  var width = boardSize();
  var animations = [];
  cells.forEach((column, c) =>
    column.forEach((cell) => {
      animations.push(cell.animate([{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(" + (width + 20) + "px)", opacity: 0.3 }], { duration: 260, delay: c * 30, easing: "ease-in", fill: "forwards" }).finished);
    }),
  );
  Object.values(frogEls).forEach((frog) => animations.push(frog.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: "forwards" }).finished));
  return Promise.all(animations);
}

function renderSize(n) {
  var box = document.getElementById("pdSize");
  box.querySelector(".pd-size-value").innerText = n + "×" + n;
  box.classList.toggle("max", setup && n >= setup.size[1]);
}

/* ---------- The frogs, the meter, the moons ---------- */

// A frog in its colour (--fam)
var FROG_SVG = '<svg viewBox="9 8 30 30" aria-hidden="true"><ellipse cx="24" cy="26" rx="13" ry="10.5" fill="var(--fam)" /><circle cx="16" cy="15" r="5.8" fill="var(--fam)" /><circle cx="32" cy="15" r="5.8" fill="var(--fam)" /><circle cx="16" cy="15" r="3.2" fill="#fff" /><circle cx="32" cy="15" r="3.2" fill="#fff" /><circle cx="16.7" cy="15.5" r="1.7" fill="#111827" /><circle cx="32.7" cy="15.5" r="1.7" fill="#111827" /><path d="M17 27.5 Q24 33 31 27.5" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="2" stroke-linecap="round" /></svg>';
// The gem of a colour (--fam): one shape, the facets lighter and darker
var GEM_SVG = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M14 9h20l10 11-20 22L4 20z" fill="var(--fam)" /><path d="M14 9h20l-4 11H18z" fill="#fff" fill-opacity=".38" /><path d="M4 20 14 9l4 11z" fill="#fff" fill-opacity=".2" /><path d="M34 9l10 11H30z" fill="#000" fill-opacity=".12" /><path d="M4 20h14l6 22z" fill="#fff" fill-opacity=".12" /><path d="M30 20h14L24 42z" fill="#000" fill-opacity=".22" /><path d="M17 12.5h6" stroke="#fff" stroke-opacity=".8" stroke-width="2" stroke-linecap="round" /></svg>';
var frogBoxes = {};
function renderFrogs() {
  var box = document.getElementById("pdFrogs");
  frogBoxes = {};
  box.replaceChildren(
    ...setup.families.map((family) => {
      var frog = el("div", "pd-frog");
      frog.style.setProperty("--fam", family.color);
      frog.title = family.frog;
      var face = el("div", "pd-frog-face");
      face.innerHTML = FROG_SVG;
      var amber = el("div", "pd-frog-amber pd-gem");
      amber.innerHTML = GEM_SVG;
      var value = el("div", "pd-frog-value", "");
      var pips = el("div", "pd-frog-pips");
      for (var i = 0; i < setup.maxLevel; i++) pips.append(el("span", "pd-pip"));
      frog.append(face, amber, value, pips);
      frogBoxes[family.id] = { frog: frog, value: value, pips: pips };
      return frog;
    }),
  );
}

// The levels of the amber: the pips, what one amber pays with the bet
function setLevels(levels, bet) {
  levelsShown = Object.assign({}, levels);
  setup.families.forEach((family) => {
    var box = frogBoxes[family.id];
    if (!box) return;
    var level = levels[family.id] || 0;
    [...box.pips.children].forEach((pip, i) => pip.classList.toggle("on", i < level));
    box.value.innerText = "🪙 " + shortCoins(setup.amberValues[level] * (bet || currentBet() || 0));
    box.frog.classList.toggle("grown", level > 0);
  });
}

function setMeter(meter) {
  var fill = document.querySelector("#pdMeter .pd-meter-fill");
  fill.style.width = Math.min(100, (meter / setup.meter) * 100) + "%";
  document.querySelector("#pdMeter .pd-meter-count").innerText = meter + " / " + setup.meter;
}

function setMoons(moons, inBonus) {
  var box = document.getElementById("pdMoons");
  var part = inBonus ? moons % setup.free.trigger : Math.min(moons, setup.free.trigger);
  box.querySelector(".pd-moons-value").innerText = part + " / " + setup.free.trigger;
}

// The frogs, the meter and the moons as at the start of a spin
function resetPanel(levels, meter, moons, bet, inBonus) {
  setLevels(levels || zeros(), bet);
  setMeter(meter || 0);
  setMoons(moons || 0, inBonus);
}

/* ---------- A step: the frogs move, the features act ---------- */

var FEATURE_TEXT = {
  coin: (e) => "🪙 A coin win",
  sun: (e) => "☀️ The " + familyInfo(e.family).name.toLowerCase() + " are worth more",
  wild: (e) => "✨ A firefly lands on the pond",
  lotus: (e) => (e.grew ? "🪷 The pond grows" : "🪷 The pond is as big as it gets"),
  rain: (e) => "🌧️ Rain fills the empty spots",
  swirl: (e) => (e.from ? "🌀 The " + familyInfo(e.from).name.toLowerCase() + " turn " + familyInfo(e.family).name.split(" ")[0].toLowerCase() : "🌀 Nothing to turn"),
  flies: (e) => "🪰 Flies fill the empty spots",
  moon: (e) => "🌕 A full moon",
};

function cellAt(spot) {
  return cells[spot[0]] && cells[spot[0]][spot[1]];
}

function frogName(family) {
  return familyInfo(family).frog.toLowerCase();
}

// A frog moves to a spot of the pond (`time`: an arc there, a little jump up in the middle)
function jumpFrog(frog, spot, time) {
  var size = boardSize() / shown.length;
  var from = frogTransform(frog);
  frog.dataset.x = spot[0] * size;
  frog.dataset.y = spot[1] * size;
  var to = frogTransform(frog);
  frog.style.transform = to;
  if (!skipping) frog.animate([{ transform: from + " scale(1)" }, { transform: from + " translateY(-8%) scale(1.3)", offset: 0.4 }, { transform: to + " scale(1)" }], { duration: time, easing: "ease-in-out" });
}

// A short note over a spot of the pond that floats up (a win, a bubble of a frog)
function floatNote(spot, text, className, time) {
  if (skipping) return;
  var size = boardSize() / shown.length;
  var note = el("div", "pd-note " + (className || ""), text);
  note.style.left = (spot[0] + 0.5) * size + "px";
  // (on the top row a bit lower: the pond cuts off what is above it)
  note.style.top = (spot[1] + (spot[1] == 0 ? 0.35 : 0)) * size + "px";
  document.querySelector(".pd-frog-layer").append(note);
  note.animate([{ transform: "translate(-50%, 0) scale(0.6)", opacity: 0 }, { transform: "translate(-50%, -40%) scale(1)", opacity: 1, offset: 0.2 }, { transform: "translate(-50%, -60%) scale(1)", opacity: 1, offset: 0.8 }, { transform: "translate(-50%, -90%) scale(1)", opacity: 0 }], { duration: time, easing: "ease-out", fill: "forwards" }).finished.then(() => note.remove());
}

// A frog's turn: it lights up, hops along its path (`hop`: the time of a hop), collects what it lands on and eats
// the flies, the other colours stay
async function hopFrog(move, bet, win, hop) {
  var frog = frogEls[move.family];
  var box = frogBoxes[move.family];
  var detail = document.getElementById("pdWinDetail");
  var name = frogName(move.family);
  frog.classList.add("moving");
  if (box) box.frog.classList.add("active");
  detail.innerText = "🐸 The " + name + " hops";
  await wait(setup.rules.turnTime);
  var amberCount = 0;
  for (var i = 1; i < move.path.length; i++) {
    var spot = move.path[i];
    jumpFrog(frog, spot, hop * 0.8);
    await wait(hop * 0.7);
    var id = shown[spot[0]][spot[1]];
    var collected = id == move.family || id == "wild" || id == "fly" || (id != null && symbolOf(id) && symbolOf(id).feature);
    if (collected) {
      var cell = cellAt(spot);
      cell.classList.add("collected");
      cell.animate([{ transform: "scale(1)", opacity: 1 }, { transform: "scale(1.3)", opacity: 0.8, offset: 0.3 }, { transform: "scale(0.2)", opacity: 0 }], { duration: Math.max(80, hop * 0.5), easing: "ease-in", fill: "forwards" });
      shown[spot[0]][spot[1]] = null;
      if (id == move.family || id == "wild") {
        var amber = setup.amberValues[move.level] * bet;
        amberCount++;
        detail.innerText = "🐸 The " + name + " collects " + amberCount + (amberCount == 1 ? " gem" : " gems");
        floatNote(spot, "+" + shortCoins(amber), "pd-note-win", Math.max(700, hop * 2));
        countUp(document.getElementById("pdWinText"), Math.floor(win.amount + amber), hop * 0.3, Math.floor(win.amount));
        win.amount += amber;
      }
    }
    await wait(hop * 0.3);
  }
  frog.classList.remove("moving");
  if (box) box.frog.classList.remove("active");
  frogSpots[move.family] = move.path[move.path.length - 1];
}

// Two frogs meet: they trade spots, or two of them argue and new symbols land around them
async function playMeet(meet, next, bet) {
  var time = setup.rules.meetTime;
  var detail = document.getElementById("pdWinDetail");
  var [a, b] = meet.frogs;
  var names = familyInfo(a).frog.split(" ")[0].toLowerCase() + " and " + familyInfo(b).frog.split(" ")[0].toLowerCase() + " frogs";
  if (meet.id == "trade") {
    detail.innerText = "🤝 The " + names + " trade places";
    floatNote(frogSpots[a], "🤝", "pd-note-bubble", time * 0.5);
    floatNote(frogSpots[b], "🤝", "pd-note-bubble", time * 0.5);
    await wait(time * 0.45);
    var spotA = frogSpots[a];
    frogSpots[a] = frogSpots[b];
    frogSpots[b] = spotA;
    [a, b].forEach((family) => frogEls[family].classList.add("moving"));
    jumpFrog(frogEls[a], frogSpots[a], time * 0.4);
    jumpFrog(frogEls[b], frogSpots[b], time * 0.4);
    await wait(time * 0.45);
    [a, b].forEach((family) => frogEls[family].classList.remove("moving"));
    await wait(time * 0.1);
    return;
  }
  detail.innerText = "💢 The " + names + " argue and make room";
  [a, b].forEach((family) => {
    floatNote(frogSpots[family], "💢", "pd-note-bubble", time * 0.6);
    if (!skipping) frogEls[family].animate([{ translate: "0 0" }, { translate: "-6% 0" }, { translate: "6% 0" }, { translate: "-6% 0" }, { translate: "6% 0" }, { translate: "0 0" }], { duration: time * 0.45 });
  });
  await wait(time * 0.5);
  (meet.cells || []).forEach((spot) => setSpot(spot, next.grid[spot[0]] ? next.grid[spot[0]][spot[1]] : null, bet));
  await wait(time * 0.5);
}

// The full meter: three chests open, each with a feature symbol
async function openChests(chests) {
  var card = el("div", "pd-intro pd-chests");
  var row = el("div", "pd-chest-row");
  chests.forEach((chest) => {
    var box = el("div", "pd-chest");
    box.style.setProperty("--fam", familyInfo(chest.family).color);
    box.append(el("span", "pd-chest-lid", "🧰"), el("span", "pd-chest-prize", featureIcon(chest.id)));
    row.append(box);
  });
  card.append(el("div", "pd-intro-title", "Meter full"), row);
  stage(card);
  var time = setup.rules.chestTime;
  await wait(time * 0.3);
  [...row.children].forEach((box, i) => setTimeout(() => box.classList.add("open"), i * time * 0.15));
  await wait(time * 0.6);
  stage(null);
  await wait(time * 0.1);
}

function featureIcon(id) {
  var feature = setup.features.find((f) => f.id == id);
  return feature ? feature.icon : "";
}

// A feature acts on the screen (the pond itself is shown again after the step)
async function playEffect(effect, step, next, bet, win, inBonus) {
  var detail = document.getElementById("pdWinDetail");
  detail.innerText = (effect.chest ? "🧰 " : "") + FEATURE_TEXT[effect.id](effect);
  var frogBox = frogBoxes[effect.family];
  if (frogBox && !effect.chest) frogBox.frog.animate([{ transform: "scale(1)" }, { transform: "scale(1.08)" }, { transform: "scale(1)" }], { duration: 400 });
  if (effect.id == "coin") {
    countUp(document.getElementById("pdWinText"), Math.floor(win.amount + effect.pay * bet), setup.rules.effectTime * 0.5, Math.floor(win.amount));
    win.amount += effect.pay * bet;
  } else if (effect.id == "sun") {
    levelsShown[effect.family] = effect.level;
    setLevels(levelsShown, bet);
    redrawColour(effect.family, bet);
    frogBox.frog.classList.add("flash");
    setTimeout(() => frogBox.frog.classList.remove("flash"), setup.rules.effectTime);
  } else if (effect.id == "wild" && effect.at) {
    setSpot(effect.at, "wild", bet);
  } else if (effect.id == "swirl") {
    (effect.cells || []).forEach((spot) => setSpot(spot, effect.family, bet));
  } else if (effect.id == "rain") {
    (effect.cells || []).forEach((spot) => setSpot(spot, next.grid[spot[0]] ? next.grid[spot[0]][spot[1]] : null, bet));
  } else if (effect.id == "flies") {
    (effect.cells || []).forEach((spot) => setSpot(spot, "fly", bet));
  } else if (effect.id == "moon") {
    setMoons(effect.moons, inBonus);
    document.getElementById("pdMoons").animate([{ transform: "scale(1)" }, { transform: "scale(1.2)" }, { transform: "scale(1)" }], { duration: 450 });
  }
  await wait(setup.rules.effectTime);
}

function setSpot(spot, id, bet) {
  var cell = cellAt(spot);
  if (!cell) return;
  shown[spot[0]][spot[1]] = id;
  cell.getAnimations().forEach((animation) => animation.cancel());
  fillCell(cell, id, bet);
  cell.animate([{ transform: "scale(0.3)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: 260, easing: "cubic-bezier(.3,1.5,.5,1)" });
}

// An upgrade: the amber of a colour on the pond shows its new level
function redrawColour(family, bet) {
  shown.forEach((column, c) => column.forEach((id, r) => id == family && fillCell(cells[c][r], id, bet)));
}

/*
 * One step: the frogs hop all at once, the meter fills (full: the chests), the features act, then the pond
 * as it is now (`next`: {grid, frogs}). -> the win of the step
 */
async function playStep(step, next, bet, total, inBonus) {
  var time = setup.rules.stepTime;
  var win = { amount: total };
  await wait(time * 0.3);
  // The frogs one after the other (a long walk faster)
  for (var move of step.moves) {
    var hops = move.path.length - 1;
    await hopFrog(move, bet, win, Math.min(setup.rules.hopTime, setup.rules.walkTime / hops));
  }
  // (the exact win of the moves, rounding aside)
  win.amount = total + step.moves.reduce((sum, move) => sum + move.pay, 0) * bet;
  setMeter(step.chests.length ? setup.meter : step.meter);
  if (step.chests.length) {
    await openChests(step.chests);
    setMeter(step.meter);
  }
  for (var effect of step.effects) await playEffect(effect, step, next, bet, win, inBonus);
  for (var meet of step.meets || []) await playMeet(meet, next, bet);
  win.amount = total + step.pay * bet;
  document.getElementById("pdWinText").innerText = "🪙 " + formatCoins(Math.floor(win.amount));
  setLevels(step.levels, bet);
  setMoons(step.moons, inBonus);
  // The pond as it is now: new spots pop in
  var before = shown.map((column) => column.slice());
  frogSpots = JSON.parse(JSON.stringify(next.frogs));
  showGrid(next.grid.map((column) => column.slice()), false, { bet: bet });
  var pops = [];
  next.grid.forEach((column, c) =>
    column.forEach((id, r) => {
      if (id != null && (!before[c] || before[c][r] !== id)) pops.push(cells[c][r].animate([{ transform: "scale(0.3)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: time * 0.4, easing: "cubic-bezier(.3,1.5,.5,1)" }).finished);
    }),
  );
  await Promise.all(pops);
  await wait(time * 0.3);
  return step.pay * bet;
}

// The steps of a spin (or a free spin) one after the other -> the win
async function playSteps(steps, last, lastFrogs, bet, total, inBonus) {
  var won = 0;
  for (var i = 0; i < steps.length; i++) {
    var next = i + 1 < steps.length ? { grid: steps[i + 1].grid, frogs: steps[i + 1].frogs } : { grid: last, frogs: lastFrogs };
    won += await playStep(steps[i], next, bet, total + won, inBonus);
  }
  return won;
}

/* ---------- A spin ---------- */

var lastRequest = null;
function spin(buy) {
  if (setup == null || spinning || activeBonus) return;
  var bet = currentBet();
  if (!Number.isInteger(bet) || bet < setup.rules.minBet || bet > setup.rules.maxBet) return showHint("A spin is " + formatCoins(setup.rules.minBet) + " to " + formatCoins(setup.rules.maxBet) + " coins.", "error", document.getElementById("pdSpin"));
  var cost = buy ? bet * setup.buy : bet;
  if (cost > myCoins) {
    if (autoLeft) stopAuto();
    return showHint("You don't have enough coins.", "error", document.getElementById(buy ? "pdBuy" : "pdSpin"));
  }
  var left = casinoCapLeft(buy ? myBuyCapRule : myCapRule, myCoins, 0);
  if (cost > left) {
    if (autoLeft) stopAuto();
    return showHint("Your max " + (buy ? "buy" : "bet") + " right now is " + formatCoins(buy ? Math.floor(left / setup.buy) : left) + ".", "error", document.getElementById(buy ? "pdBuy" : "pdSpin"));
  }
  spinning = true;
  renderControls();
  lastRequest = { bet: bet, buy: !!buy };
  socket.emit("spin", lastRequest);
  // (no answer at all: the button comes back)
  clearTimeout(spinWatch);
  spinWatch = setTimeout(() => {
    spinning = false;
    renderControls();
  }, 10000);
}

async function playSpin(result) {
  var text = document.getElementById("pdWinText");
  var detail = document.getElementById("pdWinDetail");
  text.innerText = result.buy ? "🛒 Bonus buy" : "Good luck!";
  detail.innerText = "";
  resetPanel(null, 0, 0, result.bet, false);
  await dropOut();
  await showGrid(result.grid, true, { frogs: result.frogs, bet: result.bet });
  var total = await playSteps(result.steps, result.last, result.lastFrogs, result.bet, 0, false);
  if (result.bonus) {
    await moonsShow(result);
    activeBonus = result.id;
    await bonusIntro(result);
    await playFree(result, 0, total);
  } else {
    await showEnd(result, total);
  }
  finishSpin(result);
}

// After a spin: the win, the balance, the next spin (auto)
function finishSpin(result) {
  activeBonus = null;
  spinning = false;
  pausedUntil = Date.now() + setup.rules.pauseTime;
  renderCoins(myCoins);
  renderControls();
  if (autoLeft) {
    if (autoLeft !== Infinity) autoLeft--;
    renderAuto();
    if (autoLeft) setTimeout(() => autoLeft && spin(false), setup.rules.pauseTime + 150);
  }
}

// The base game's end: the win (a big one gets a show)
async function showEnd(result, total) {
  var text = document.getElementById("pdWinText");
  if (result.win <= 0) {
    text.innerText = "No win";
    return;
  }
  text.innerText = "🪙 " + formatCoins(result.win);
  if (result.win >= result.bet * setup.rules.bigWin) await bigWin(result.win, result.bet);
  else await wait(setup.rules.countTime);
}

// 3 🌕 collected: the full moon rises before the free spins
async function moonsShow(result) {
  document.getElementById("pdWinDetail").innerText = result.moons >= setup.free.trigger ? "🌕 The full moon rises!" : "🛒 The free spins";
  document.getElementById("pdMoons").classList.add("full");
  await wait(1100);
  document.getElementById("pdMoons").classList.remove("full");
}

/* ---------- The free spins ---------- */

function stage(content) {
  var box = document.getElementById("pdStage");
  if (!content) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  box.replaceChildren(content);
  box.hidden = false;
}

// "Full Moon: 8 free spins" - waits for the click (auto spins too)
function bonusIntro(result) {
  return new Promise((resolve) => {
    var card = el("div", "pd-intro");
    card.append(el("div", "pd-intro-moons", "🌕🌕🌕"), el("div", "pd-intro-title", "Full Moon"), el("div", "pd-intro-spins", result.bonus.start + " free spins"));
    card.append(el("p", "pd-intro-text", "The pond size, the meter, the gem levels and the moons you collect stay for all free spins. Every " + setup.free.trigger + " moons give " + setup.free.more + " more free spins."));
    var go = el("button", "mm-btn mm-btn-primary pd-intro-go", "Start");
    go.type = "button";
    card.append(go);
    stage(card);
    go.focus();
    go.addEventListener("click", () => {
      socket.emit("bonusStart", { id: result.id });
      stage(null);
      resolve();
    });
  });
}

// The free spins from `from` on (resumed: the ones seen before skipped) - the win so far: `before`
async function playFree(result, from, before) {
  var bonus = result.bonus;
  var bet = result.bet;
  var text = document.getElementById("pdWinText");
  var total = before + bonus.freeSpins.slice(0, from).reduce((sum, free) => sum + free.pay * bet, 0);
  var counter = document.getElementById("pdFreeCounter");
  counter.hidden = false;
  var skip = document.getElementById("pdSkip");
  skip.hidden = false;
  skip.disabled = false;
  document.getElementById("pdWindow").classList.add("free");
  for (var n = from; n < bonus.freeSpins.length && !skipping; n++) {
    var free = bonus.freeSpins[n];
    // (whatever goes wrong on the page: the free spins are skipped to their win, never stuck)
    try {
      document.getElementById("pdFreeCount").innerText = n + 1 + " / " + (free.spins - free.more);
      resetPanel(free.levels, free.meter, free.collected, bet, true);
      await dropOut();
      await showGrid(free.grid, true, { time: setup.rules.freeSpinTime * 0.8, frogs: free.frogs, bet: bet });
      total += await playSteps(free.steps, free.last, free.lastFrogs, bet, total, true);
      if (free.more) await moreSpins(free);
    } catch (error) {
      console.error("[pond] Free spin", n + 1, error);
      skipping = true;
      break;
    }
    socket.emit("bonusProgress", { id: result.id, shown: n + 1 });
    await wait(setup.rules.freeSpinTime * 0.2);
  }
  // Skipped: the pond of the last free spin, then the win
  if (skipping) {
    var last = bonus.freeSpins[bonus.freeSpins.length - 1];
    if (last) showGrid(last.last, false, { frogs: last.lastFrogs, bet: bet });
    socket.emit("bonusProgress", { id: result.id, shown: bonus.freeSpins.length });
    skipping = false;
  }
  skip.hidden = true;
  counter.hidden = true;
  document.getElementById("pdWindow").classList.remove("free");
  await bonusEnd(result);
  text.innerText = "🪙 " + formatCoins(result.win);
  socket.emit("bonusDone", { id: result.id });
}

// 🌕 collected in a free spin: spins more
async function moreSpins(free) {
  document.getElementById("pdWinDetail").innerText = "🌕 +" + free.more + " free spins";
  document.getElementById("pdFreeCount").innerText = document.getElementById("pdFreeCount").innerText.replace(/\/ \d+/, "/ " + free.spins);
  document.getElementById("pdMoons").classList.add("full");
  await wait(setup.rules.moonTime);
  document.getElementById("pdMoons").classList.remove("full");
}

async function bonusEnd(result) {
  var card = el("div", "pd-intro pd-end");
  var amount = el("div", "pd-end-win", "🪙 0");
  var spins = result.bonus.freeSpins;
  var last = spins.length ? spins[spins.length - 1].last.length : setup.size[0];
  card.append(el("div", "pd-intro-title", "Full Moon"), amount, el("div", "pd-intro-spins", spins.length + " free spins · " + last + "×" + last + " pond"));
  if (result.capped) card.append(el("p", "pd-intro-text", "The max win of " + formatCoins(setup.maxWin) + "× your bet is reached."));
  stage(card);
  countUp(amount, result.win, setup.rules.bonusEndTime * 0.6);
  await wait(setup.rules.bonusEndTime);
  stage(null);
}

async function bigWin(win, bet) {
  var card = el("div", "pd-intro pd-big");
  var amount = el("div", "pd-end-win", "🪙 0");
  var x = win / bet;
  card.append(el("div", "pd-intro-title", x >= 100 ? "Epic win" : x >= 40 ? "Mega win" : "Big win"), amount);
  stage(card);
  countUp(amount, win, setup.rules.bigTime * 0.7);
  await wait(setup.rules.bigTime);
  stage(null);
}

// Back on the page with free spins: waiting for the click, or on from where they were
async function resumeBonus(result) {
  spinning = true;
  renderControls();
  activeBonus = result.id;
  resetPanel(null, 0, result.moons, result.bet, false);
  showGrid(result.last, false, { frogs: result.lastFrogs, bet: result.bet });
  var before = result.lineX * result.bet;
  document.getElementById("pdWinText").innerText = "🪙 " + formatCoins(Math.floor(before));
  if (!result.started) await bonusIntro(result);
  else {
    var note = el("div", "pd-intro");
    note.append(el("div", "pd-intro-title", "Welcome back"), el("div", "pd-intro-spins", "The free spins go on"));
    stage(note);
    await wait(setup.rules.resumeTime);
    stage(null);
  }
  await playFree(result, result.started ? result.shown : 0, before);
  finishSpin(result);
}

function countUp(element, value, time, from) {
  var start = performance.now();
  from = from || 0;
  var step = (now) => {
    var t = Math.min(1, (now - start) / time);
    element.innerText = "🪙 " + formatCoins(Math.round(from + (value - from) * (1 - Math.pow(1 - t, 3))));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------- Bet ---------- */

function readBet() {
  try {
    return localStorage.getItem(BET_KEY);
  } catch (error) {
    return null;
  }
}

function currentBet() {
  return Number(document.getElementById("pdBet").value);
}

function setBet(value, keepMax, typed) {
  if (setup == null) return;
  if (!keepMax) maxMode = false;
  var bet = Math.max(setup.rules.minBet, Math.min(typed ? setup.rules.maxBet : maxNow(), Math.round(value)));
  document.getElementById("pdBet").value = bet;
  try {
    localStorage.setItem(BET_KEY, maxMode ? "max" : bet);
  } catch (error) {
    // not remembered
  }
  renderControls();
  // (the wins on the pond and of the frogs' amber are shown for the bet)
  if (shown && !spinning && !activeBonus) {
    setLevels(levelsShown);
    showGrid(shown, false);
  }
}

function pickMax() {
  maxMode = true;
  setBet(maxBetNow(), true);
}

function followMax() {
  if (!maxMode || setup == null || spinning) return;
  var bet = maxBetNow();
  if (bet != currentBet()) setBet(bet, true);
}

function maxNow() {
  return Math.max(setup.rules.minBet, Math.min(setup.rules.maxBet, casinoCapLeft(myCapRule, myCoins, 0)));
}

function maxBetNow() {
  var coins = typeof myCoins == "number" ? myCoins : Infinity;
  return Math.max(setup.rules.minBet, Math.min(maxNow(), coins));
}

// A round number near `value` (1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5 times a power of ten)
function niceBet(value) {
  var power = Math.pow(10, Math.floor(Math.log10(Math.max(1, value))));
  var best = null;
  [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 10].forEach((m) => {
    var candidate = Math.round(m * power);
    if (best == null || Math.abs(candidate - value) < Math.abs(best - value)) best = candidate;
  });
  return best;
}

function presets() {
  var lo = setup.rules.minBet;
  var hi = maxNow();
  if (hi <= lo) return [lo];
  var list = [lo];
  for (var i = 1; i < PRESET_COUNT - 1; i++) {
    var value = niceBet(lo * Math.pow(hi / lo, i / (PRESET_COUNT - 1)));
    if (value > list[list.length - 1] && value < hi) list.push(value);
  }
  list.push(hi);
  return list;
}

function renderPresets() {
  var box = document.getElementById("pdPresets");
  var max = el("button", "sl-preset sl-preset-max", "Max");
  max.type = "button";
  max.title = "The most you can bet per spin right now";
  max.addEventListener("click", pickMax);
  box.replaceChildren(
    ...presets().map((value) => {
      var button = el("button", "sl-preset", value >= 1000 ? value / 1000 + "K" : String(value));
      button.type = "button";
      button.dataset.value = value;
      button.addEventListener("click", () => setBet(value));
      return button;
    }),
    max,
  );
}

// The balance: a win counts up, a bet is taken off right away
var coinsShown = null;
var coinsAnimation = 0;
function renderCoins(value) {
  var box = document.getElementById("pdCoins");
  var from = coinsShown;
  coinsShown = value;
  var run = ++coinsAnimation;
  if (from == null || value <= from) {
    box.innerText = "🪙 " + formatCoins(value);
    return;
  }
  var start = performance.now();
  var step = (now) => {
    if (run != coinsAnimation) return;
    var t = Math.min(1, (now - start) / 700);
    box.innerText = "🪙 " + formatCoins(Math.round(from + (value - from) * (1 - Math.pow(1 - t, 3))));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

var lastPresets = "";
function renderControls() {
  if (setup == null) return;
  var busy = spinning || activeBonus != null;
  var bet = currentBet();
  document.getElementById("pdSpin").disabled = (busy && !autoLeft) || !(bet >= setup.rules.minBet);
  document.getElementById("pdSpin").classList.toggle("stop", !!autoLeft);
  document.getElementById("pdBuy").disabled = busy;
  document.getElementById("pdLess").disabled = busy || bet <= setup.rules.minBet;
  document.getElementById("pdMore").disabled = busy || bet >= maxNow();
  document.getElementById("pdBet").disabled = busy;
  document.querySelectorAll("#pdPresets .sl-preset").forEach((button) => {
    button.disabled = busy;
    button.classList.toggle("active", button.classList.contains("sl-preset-max") ? maxMode : !maxMode && Number(button.dataset.value) == bet);
  });
  var key = presets().join(",");
  if (key != lastPresets) {
    lastPresets = key;
    renderPresets();
  }
  document.getElementById("pdAuto").disabled = busy && !autoLeft;
}

/* ---------- Auto spins ---------- */

function renderAuto() {
  var left = document.getElementById("pdAutoLeft");
  left.hidden = !autoLeft;
  left.innerText = autoLeft === Infinity ? "∞" : String(autoLeft);
  document.querySelector("#pdSpin .sl-spin-label").innerText = autoLeft ? "Stop" : "Spin";
  renderControls();
}

function stopAuto() {
  autoLeft = 0;
  renderAuto();
}

function startAuto(count) {
  autoLeft = count;
  renderAuto();
  spin(false);
}

/* ---------- Feed and paytable ---------- */

function renderFeed(feed) {
  if (setup == null) return setTimeout(() => renderFeed(feed), 200);
  document.getElementById("pdFeedEmpty").hidden = feed.length > 0;
  document.getElementById("pdFeed").replaceChildren(
    ...feed.map((entry) => {
      var multiple = entry.win / (entry.buy || entry.bet);
      var what = entry.free ? "🌕 " + entry.free + " free spins" : entry.symbol && entry.symbol != "moon" ? entry.size + " × " + familyIcon(entry.symbol) : "🐸";
      var sub = what + (entry.buy ? " · 🛒 bought for 🪙 " + formatCoins(entry.buy) : " · bet 🪙 " + formatCoins(entry.bet)) + " · " + (multiple >= 10 ? Math.round(multiple) : multiple.toFixed(1)) + "x";
      return historyItem(createAvatar(entry.name, "sm"), entry.name, sub, "🪙 " + formatCoins(entry.win));
    }),
  );
}

function showPaytable() {
  if (setup == null) return;
  var backdrop = el("div", "mm-dialog-backdrop");
  var dialog = el("div", "mm-dialog sl-paytable pd-paytable");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  var bet = currentBet();
  var close = () => {
    document.removeEventListener("keydown", onKey);
    backdrop.remove();
  };
  var onKey = (event) => event.key == "Escape" && close();
  document.addEventListener("keydown", onKey);
  var x = el("button", "cs-gift-close", "✕");
  x.type = "button";
  x.setAttribute("aria-label", "Close");
  x.addEventListener("click", close);
  var money = (value) => formatCoins(Math.round(value * bet * 100) / 100);
  // One amber at every level
  var table = el("table", "pd-pays");
  var head = el("tr");
  head.append(el("th", "", ""), ...setup.amberValues.map((_, level) => el("th", "", level == 0 ? "Start" : "★" + level)));
  table.append(head);
  var row = el("tr");
  row.append(el("td", "pd-pays-label", "Gem"), ...setup.amberValues.map((value) => el("td", "", money(value))));
  table.append(row);
  var coins = setup.symbols.filter((symbol) => symbol.coin != null).map((symbol) => money(symbol.coin));
  var features = el("ul", "pd-feature-list");
  var line = (icon, text) => {
    var item = el("li");
    item.append(el("span", "pd-feature-icon", icon), el("span", "", text));
    features.append(item);
  };
  line("🪙", "A coin pays " + coins.slice(0, -1).join(", ") + " or " + coins[coins.length - 1] + " right away.");
  line("☀️", "The sun upgrades the gems of the frog that collects it.");
  line("✨", "The firefly is wild and counts as a gem for every frog.");
  line("🪷", "The lotus makes the pond one row and one column bigger.");
  line("🌧️", "Rain fills the empty spots with new symbols.");
  line("🌀", "The swirl turns the gems of another colour into the colour of its frog.");
  line("🪰", "Flies fill the empty spots, and a frog can cross each fly once by eating it.");
  line("🌕", "Collect " + setup.free.trigger + " full moons in one spin for " + setup.free.spins + " free spins.");
  dialog.append(
    x,
    el("h2", "mm-dialog-title", "Paytable"),
    el("p", "mm-dialog-text", "What one gem pays with your bet of 🪙 " + formatCoins(bet) + ". The sun upgrades gems up to " + setup.maxLevel + " times."),
    table,
    el("p", "mm-dialog-text", "Every frog collects the touching gems of its own colour, hopping on from each one it takes. Wilds and feature symbols next to its path are collected too."),
    features,
    el("p", "mm-dialog-text", "Two frogs side by side sometimes trade places. When two frogs want the same partner, they argue and new symbols land around them."),
    el("p", "mm-dialog-text", "Every gem collected fills the meter. A full meter opens " + setup.chests + " chests with feature symbols."),
  );
  backdrop.appendChild(dialog);
  backdrop.addEventListener("click", (event) => event.target == backdrop && close());
  document.body.appendChild(backdrop);
}

function buyBonus() {
  if (setup == null || spinning) return;
  var bet = currentBet();
  confirmDialog({
    title: "Buy the free spins?",
    text: "You get " + setup.free.spins + " free spins after this spin for 🪙 " + formatCoins(bet * setup.buy) + ", " + setup.buy + "× your bet.",
    confirmLabel: "Buy for 🪙 " + formatCoins(bet * setup.buy),
  }).then((sure) => sure && spin(true));
}

/* ---------- The controls ---------- */

document.getElementById("pdSpin").addEventListener("click", () => {
  if (autoLeft) return stopAuto();
  if (Date.now() < pausedUntil) return;
  spin(false);
});
document.getElementById("pdBuy").addEventListener("click", buyBonus);
// Skip: the rest of the free spins at once, then their win
document.getElementById("pdSkip").addEventListener("click", () => {
  if (!activeBonus) return;
  skipping = true;
  document.getElementById("pdSkip").disabled = true;
  stage(null);
});
document.getElementById("pdPaytable").addEventListener("click", showPaytable);
document.getElementById("pdLess").addEventListener("click", () => {
  var list = presets();
  var lower = list.filter((value) => value < currentBet());
  setBet(lower.length ? lower[lower.length - 1] : setup.rules.minBet);
});
document.getElementById("pdMore").addEventListener("click", () => {
  var higher = presets().filter((value) => value > currentBet());
  setBet(higher.length ? higher[0] : maxNow());
});
document.getElementById("pdBet").addEventListener("change", (event) => setBet(Number(event.target.value) || setup.rules.minBet, false, true));
document.getElementById("pdAuto").addEventListener("click", (event) => {
  event.stopPropagation();
  if (autoLeft) return stopAuto();
  var menu = document.getElementById("pdAutoMenu");
  menu.hidden = !menu.hidden;
  document.getElementById("pdAuto").setAttribute("aria-expanded", String(!menu.hidden));
});
document.querySelectorAll("#pdAutoMenu [data-auto]").forEach((button) =>
  button.addEventListener("click", () => {
    document.getElementById("pdAutoMenu").hidden = true;
    startAuto(button.dataset.auto == "infinite" ? Infinity : Number(button.dataset.auto));
  }),
);
document.addEventListener("click", (event) => {
  var menu = document.getElementById("pdAutoMenu");
  if (!menu.hidden && !menu.contains(event.target)) menu.hidden = true;
});
// Space: spin (not while typing)
document.addEventListener("keydown", (event) => {
  if (event.code != "Space" || event.repeat) return;
  var tag = (event.target && event.target.tagName) || "";
  if (/INPUT|TEXTAREA|BUTTON|SELECT/.test(tag) || document.querySelector(".mm-dialog-backdrop")) return;
  event.preventDefault();
  if (!spinning && !activeBonus && Date.now() >= pausedUntil) spin(false);
});
// The window changes size: the board again (its cells are measured in pixels)
window.addEventListener("resize", () => {
  if (shown && !spinning) showGrid(shown, false);
});
