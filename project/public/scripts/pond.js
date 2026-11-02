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
    frog.dataset.look = "frog";
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
    // (an eaten frog: its card above is grey)
    if (frogBoxes[family]) frogBoxes[family].frog.classList.toggle("eaten", !spot);
    if (!spot) return;
    frogLook(frog, spot, size);
    frog.dataset.x = spot[0] * size;
    frog.dataset.y = spot[1] * size;
    frog.style.transform = frogTransform(frog);
  });
}

// A frog as its spot says: an evil one is big (2x2), with horns and a spot of every colour it ate
function frogLook(frog, spot, size) {
  var n = spot[2] || 1;
  var evil = !!spot[3];
  frog.style.width = frog.style.height = n * size + "px";
  var look = evil ? "evil:" + spot[3].join(",") : "frog";
  if (frog.dataset.look == look) return;
  frog.dataset.look = look;
  frog.classList.toggle("evil", evil);
  frog.innerHTML = evil ? evilFrogSvg(spot[3]) : FROG_SVG;
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
var FROG_SVG = '<svg viewBox="9 8 30 30" aria-hidden="true"><ellipse class="pd-frog-glow" cx="24" cy="35.5" rx="14" ry="3" fill="var(--fam)" /><ellipse cx="24" cy="36.6" rx="11.5" ry="1.9" fill="#000" fill-opacity=".35" /><ellipse cx="24" cy="26" rx="13" ry="10.5" fill="var(--fam)" /><circle cx="16" cy="15" r="5.8" fill="var(--fam)" /><circle cx="32" cy="15" r="5.8" fill="var(--fam)" /><circle cx="16" cy="15" r="3.2" fill="#fff" /><circle cx="32" cy="15" r="3.2" fill="#fff" /><circle cx="16.7" cy="15.5" r="1.7" fill="#111827" /><circle cx="32.7" cy="15.5" r="1.7" fill="#111827" /><path d="M17 27.5 Q24 33 31 27.5" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="2" stroke-linecap="round" /></svg>';
// An evil frog: grey with a hint of its colour, small red eyes under angry lids, a belly in the colours it holds
// (its own and every frog it ate)
var evilCount = 0;
function evilFrogSvg(colours) {
  var id = "pdEvil" + evilCount++;
  var width = 16 / colours.length;
  var stripes = colours.map((family, i) => '<rect x="' + (16 + i * width) + '" y="20" width="' + (width + 0.2) + '" height="16" style="fill: color-mix(in srgb, ' + familyInfo(family).color + ' 80%, #4b5563)" />').join("");
  return (
    '<svg viewBox="9 6 30 32" aria-hidden="true"><defs><clipPath id="' + id + '"><ellipse cx="24" cy="29" rx="7.5" ry="5.6" /></clipPath></defs>' +
    '<ellipse class="pd-frog-glow" cx="24" cy="35.5" rx="14" ry="3" fill="#dc2626" /><ellipse cx="24" cy="36.6" rx="11.5" ry="1.9" fill="#000" fill-opacity=".35" />' +
    '<g style="fill: color-mix(in srgb, var(--fam) 30%, #6b7280)"><ellipse cx="24" cy="26" rx="13" ry="10.5" /><circle cx="16" cy="15" r="5.8" /><circle cx="32" cy="15" r="5.8" /></g>' +
    '<g clip-path="url(#' + id + ')">' + stripes + "</g>" +
    '<circle cx="16" cy="15" r="3.2" fill="#fff" /><circle cx="32" cy="15" r="3.2" fill="#fff" /><circle cx="16.4" cy="15.6" r="1.8" fill="#dc2626" /><circle cx="31.6" cy="15.6" r="1.8" fill="#dc2626" />' +
    // (the angry lids: slanting down to the middle)
    '<path d="M11.5 11.5 L20.5 14 L20.5 10 Z M36.5 11.5 L27.5 14 L27.5 10 Z" style="fill: color-mix(in srgb, var(--fam) 30%, #6b7280)" /><path d="M12 12 L20.3 14.2 M36 12 L27.7 14.2" stroke="#1f2937" stroke-width="1.6" stroke-linecap="round" />' +
    '<path d="M18.5 22.5 Q24 21 29.5 22.5" fill="none" stroke="rgba(0,0,0,.55)" stroke-width="1.8" stroke-linecap="round" />' +
    "</svg>"
  );
}

// The gem of a colour (--fam): one shape, the facets lighter and darker
var GEM_SVG = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M14 11.5h20l10 11-20 22L4 22.5z" fill="#000" fill-opacity=".3" /><path d="M14 9h20l10 11-20 22L4 20z" fill="var(--fam)" /><path d="M14 9h20l-4 11H18z" fill="#fff" fill-opacity=".38" /><path d="M4 20 14 9l4 11z" fill="#fff" fill-opacity=".2" /><path d="M34 9l10 11H30z" fill="#000" fill-opacity=".12" /><path d="M4 20h14l6 22z" fill="#fff" fill-opacity=".12" /><path d="M30 20h14L24 42z" fill="#000" fill-opacity=".22" /><path d="M17 12.5h6" stroke="#fff" stroke-opacity=".8" stroke-width="2" stroke-linecap="round" /></svg>';
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
  evil: (e) => (e.none ? "😈 The curse fades" : "😈 The " + frogName(e.family) + " turns evil"),
  rock: (e) => (e.jumps && e.jumps.length ? "🪨 A rock falls and the frogs jump away" : "🪨 A rock falls into the pond"),
  moon: (e) => "🌕 A full moon",
};

function cellAt(spot) {
  return cells[spot[0]] && cells[spot[0]][spot[1]];
}

function frogName(family) {
  return familyInfo(family).frog.toLowerCase();
}

// A frog moves to a spot of the pond (`time`: an arc there, a little jump up in the middle; `size`: of a spot)
function jumpFrog(frog, spot, time, size) {
  size = size || boardSize() / shown.length;
  var [x0, y0] = [Number(frog.dataset.x), Number(frog.dataset.y)];
  var [x1, y1] = [spot[0] * size, spot[1] * size];
  frog.dataset.x = x1;
  frog.dataset.y = y1;
  frog.style.transform = frogTransform(frog);
  if (skipping) return;
  // (halfway: up in the air and a bit bigger)
  var at = (x, y, scale) => ({ transform: "translate(" + x + "px, " + y + "px) scale(" + scale + ")" });
  frog.animate([{ ...at(x0, y0, 1), easing: "ease-out" }, { ...at((x0 + x1) / 2, (y0 + y1) / 2 - size * 0.25, 1.2), easing: "ease-in" }, at(x1, y1, 1)], { duration: time });
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
  var size = boardSize() / shown.length;
  var start = frogSpots[move.family] || move.path[0];
  // (an evil frog: big, it collects the colours it ate)
  var n = start[2] || 1;
  var colours = start[3] ? start[3].slice() : [move.family];
  var eatsAfter = (i) => (move.eats || []).filter((e) => e.after == i);
  // What the frog takes from a spot: the gem pays (by the level of its colour; the wild by the frog's)
  var take = (cellSpot) => {
    var id = shown[cellSpot[0]][cellSpot[1]];
    var collected = colours.includes(id) || id == "wild" || id == "fly" || (id != null && symbolOf(id) && symbolOf(id).feature);
    if (!collected) return;
    var cell = cellAt(cellSpot);
    cell.classList.add("collected");
    cell.animate([{ transform: "scale(1)", opacity: 1 }, { transform: "scale(1.3)", opacity: 0.8, offset: 0.3 }, { transform: "scale(0.2)", opacity: 0 }], { duration: Math.max(80, hop * 0.5), easing: "ease-in", fill: "forwards" });
    shown[cellSpot[0]][cellSpot[1]] = null;
    if (colours.includes(id) || id == "wild") {
      var amber = setup.amberValues[levelsShown[id == "wild" ? move.family : id] || 0] * bet;
      amberCount++;
      detail.innerText = "🐸 The " + name + " collects " + amberCount + (amberCount == 1 ? " gem" : " gems");
      floatNote(cellSpot, "+" + shortCoins(amber), "pd-note-win", Math.max(700, hop * 2));
      countUp(document.getElementById("pdWinText"), Math.floor(win.amount + amber), hop * 0.3, Math.floor(win.amount));
      win.amount += amber;
    }
  };
  // (an evil frog licks up what touches its body: its tongue grabs one spot after the other)
  var licksAfter = async (i) => {
    for (var lickAt of (move.licks || []).filter((l) => l.after == i))
      for (var cellSpot of lickAt.cells) {
        await tongueTo(frog, cellSpot, size, hop * 0.5);
        take(cellSpot);
      }
  };
  var swirlsAfter = async (i) => {
    for (var swirl of (move.swirls || []).filter((sw) => sw.after == i && !sw.shown)) {
      swirl.shown = true;
      detail.innerText = FEATURE_TEXT.swirl({ from: swirl.from, family: move.family });
      (swirl.cells || []).forEach((cellSpot) => setSpot(cellSpot, move.family, bet));
      await wait(setup.rules.effectTime * 0.6);
    }
  };
  for (var e of eatsAfter(0)) await eatFrog(move.family, e.family, colours, size);
  await licksAfter(0);
  await swirlsAfter(0);
  for (var i = 1; i < move.path.length; i++) {
    var spot = move.path[i];
    // (one hop flows into the next: no stop between them)
    jumpFrog(frog, spot, hop, size);
    await wait(hop * 0.7);
    for (var cellSpot of move.cells ? move.cells[i] : [spot]) take(cellSpot);
    // (a swirl: the gems of another colour turn into the frog's right away)
    await swirlsAfter(i);
    for (var eaten of eatsAfter(i)) await eatFrog(move.family, eaten.family, colours, size);
    await licksAfter(i);
    await swirlsAfter(i);
    await wait(hop * 0.3);
  }
  frog.classList.remove("moving");
  if (box) box.frog.classList.remove("active");
  var end = move.path[move.path.length - 1];
  frogSpots[move.family] = start[3] ? [end[0], end[1], n, colours] : end;
}

// The evil frog's tongue shoots to a spot and back
async function tongueTo(frog, spot, size, time) {
  if (skipping) return;
  var n = Math.round(parseFloat(frog.style.width) / size) || 1;
  var mouth = [Number(frog.dataset.x) + (n * size) / 2, Number(frog.dataset.y) + n * size * 0.68];
  var target = [(spot[0] + 0.5) * size, (spot[1] + 0.5) * size];
  var tongue = el("div", "pd-tongue");
  tongue.style.left = mouth[0] + "px";
  tongue.style.top = mouth[1] + "px";
  tongue.style.width = Math.hypot(target[0] - mouth[0], target[1] - mouth[1]) + "px";
  tongue.style.transform = "rotate(" + Math.atan2(target[1] - mouth[1], target[0] - mouth[0]) + "rad)";
  document.querySelector(".pd-frog-layer").append(tongue);
  await tongue.animate([{ scale: "0 1" }, { scale: "1 1" }], { duration: time * 0.5, easing: "ease-out", fill: "forwards" }).finished;
  tongue.animate([{ scale: "1 1" }, { scale: "0 1" }], { duration: time * 0.5, easing: "ease-in", fill: "forwards" }).finished.then(() => tongue.remove());
}

// The evil frog eats a frog next to it: its tongue shoots out, pulls the frog in, a gulp and a burst in its colour
async function eatFrog(family, eaten, colours, size) {
  var evil = frogEls[family];
  var prey = frogEls[eaten];
  document.getElementById("pdWinDetail").innerText = "😈 The " + frogName(family) + " eats the " + frogName(eaten);
  colours.push(eaten);
  var time = setup.rules.meetTime * 0.6;
  var spot = frogSpots[family];
  var n = (spot && spot[2]) || 1;
  if (prey && !skipping) {
    // (from the evil frog's mouth to the middle of the prey)
    var mouth = [Number(evil.dataset.x) + (n * size) / 2, Number(evil.dataset.y) + n * size * 0.68];
    var target = [Number(prey.dataset.x) + size / 2, Number(prey.dataset.y) + size / 2];
    var length = Math.hypot(target[0] - mouth[0], target[1] - mouth[1]);
    var tongue = el("div", "pd-tongue");
    tongue.style.left = mouth[0] + "px";
    tongue.style.top = mouth[1] + "px";
    tongue.style.width = length + "px";
    tongue.style.transform = "rotate(" + Math.atan2(target[1] - mouth[1], target[0] - mouth[0]) + "rad)";
    document.querySelector(".pd-frog-layer").append(tongue);
    await tongue.animate([{ scale: "0 1" }, { scale: "1 1" }], { duration: time * 0.25, easing: "ease-out", fill: "forwards" }).finished;
    // (the tongue and the frog come back together)
    var pull = { duration: time * 0.35, easing: "ease-in", fill: "forwards" };
    tongue.animate([{ scale: "1 1" }, { scale: "0 1" }], pull);
    await prey
      .animate([{ transform: frogTransform(prey) + " scale(1)" }, { transform: "translate(" + (mouth[0] - size / 2) + "px, " + (mouth[1] - size / 2) + "px) scale(0.25)", opacity: 0.6 }], pull)
      .finished;
    tongue.remove();
    prey.hidden = true;
    // (a gulp and a ring in the colour it ate)
    evil.animate([{ transform: frogTransform(evil) + " scale(1)" }, { transform: frogTransform(evil) + " scale(1.15, 0.9)" }, { transform: frogTransform(evil) + " scale(1)" }], { duration: time * 0.3, easing: "ease-out" });
    var ring = el("div", "pd-eat-ring");
    ring.style.setProperty("--fam", familyInfo(eaten).color);
    ring.style.left = mouth[0] + "px";
    ring.style.top = mouth[1] - (n * size) / 4 + "px";
    ring.style.width = ring.style.height = n * size + "px";
    document.querySelector(".pd-frog-layer").append(ring);
    ring.animate([{ transform: "translate(-50%, -50%) scale(0.3)", opacity: 0.9 }, { transform: "translate(-50%, -50%) scale(1.4)", opacity: 0 }], { duration: time * 0.45, easing: "ease-out", fill: "forwards" }).finished.then(() => ring.remove());
  }
  delete frogSpots[eaten];
  if (prey) prey.hidden = true;
  if (frogBoxes[eaten]) frogBoxes[eaten].frog.classList.add("eaten");
  var mine = frogSpots[family];
  if (mine && mine[3]) {
    frogSpots[family] = [mine[0], mine[1], mine[2], colours.slice()];
    frogLook(evil, frogSpots[family], size);
  }
  await wait(time * 0.4);
}

// The curse: the frog turns evil, eats the frogs next to it and grows to 2x2 (the spots it covers are crushed)
async function turnEvil(effect, bet) {
  var family = effect.family;
  var frog = frogEls[family];
  var size = boardSize() / shown.length;
  var spot = frogSpots[family];
  var colours = [family];
  frogSpots[family] = [spot[0], spot[1], 1, colours.slice()];
  frogLook(frog, frogSpots[family], size);
  if (!skipping) frog.animate([{ transform: frogTransform(frog) + " scale(1)" }, { transform: frogTransform(frog) + " scale(1.3) rotate(-8deg)" }, { transform: frogTransform(frog) + " scale(1)" }], { duration: 450 });
  await wait(450);
  for (var eaten of effect.eats || []) await eatFrog(family, eaten, colours, size);
  (effect.cleared || []).forEach((cell) => setSpot(cell, null, bet));
  frogSpots[family] = effect.spot;
  frog.dataset.x = effect.spot[0] * size;
  frog.dataset.y = effect.spot[1] * size;
  frogLook(frog, effect.spot, size);
  frog.style.transform = frogTransform(frog);
  if (!skipping && effect.spot[2] > 1) frog.animate([{ transform: frogTransform(frog) + " scale(0.5)" }, { transform: frogTransform(frog) + " scale(1)" }], { duration: 400, easing: "cubic-bezier(.3,1.6,.5,1)" });
}

// Two frogs meet: they trade spots, or two of them argue and new symbols land around them
async function playMeet(meet, next, bet, win, step, inBonus) {
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
  // (two want to trade, a third frog argues: the three riot)
  var rioters = meet.rioters || [a, b];
  var third = meet.over;
  detail.innerText = "💢 The " + frogName(third) + " argues and a riot breaks out";
  floatNote(frogSpots[a], "🤝", "pd-note-bubble", time * 0.6);
  floatNote(frogSpots[b], "🤝", "pd-note-bubble", time * 0.6);
  await wait(time * 0.3);
  rioters.forEach((family) => {
    floatNote(frogSpots[family], "💢", "pd-note-bubble", time * 0.6);
    if (!skipping && frogEls[family]) frogEls[family].animate([{ translate: "0 0" }, { translate: "-6% 0" }, { translate: "6% 0" }, { translate: "-6% 0" }, { translate: "6% 0" }, { translate: "0 0" }], { duration: time * 0.45 });
  });
  await wait(time * 0.5);
  var size = boardSize() / shown.length;
  // (a long riot faster: about 3 seconds at most)
  var hop = Math.min(setup.rules.hopTime * 0.5, 3000 / Math.max(1, (meet.collected || []).length));
  rioters.forEach((family) => frogEls[family] && frogEls[family].classList.add("moving"));
  // They rumble over the pond by turns and take every symbol that is not a gem (a firefly pays as a gem)
  for (var one of meet.collected || []) {
    jumpFrog(frogEls[one.family], one.at, hop, size);
    await wait(hop * 0.8);
    var cell = cellAt(one.at);
    if (cell) cell.animate([{ transform: "scale(1)", opacity: 1 }, { transform: "scale(0.2)", opacity: 0 }], { duration: hop * 0.5, easing: "ease-in", fill: "forwards" });
    shown[one.at[0]][one.at[1]] = null;
    if (one.id == "wild") {
      var amber = setup.amberValues[levelsShown[one.family] || 0] * bet;
      floatNote(one.at, "+" + shortCoins(amber), "pd-note-win", 900);
      countUp(document.getElementById("pdWinText"), Math.floor(win.amount + amber), hop * 0.3, Math.floor(win.amount));
      win.amount += amber;
    }
    await wait(hop * 0.2);
  }
  // ... run off the pond at the bottom ...
  var height = boardSize();
  if (!skipping)
    await Promise.all(
      rioters.map((family, i) => {
        var frog = frogEls[family];
        if (!frog) return null;
        return frog.animate([{ transform: frogTransform(frog) }, { transform: "translate(" + frog.dataset.x + "px, " + (height + size) + "px)" }], { duration: 450, delay: i * 90, easing: "ease-in", fill: "forwards" }).finished;
      }),
    );
  rioters.forEach((family) => frogEls[family] && frogEls[family].classList.remove("moving"));
  // ... and drop back in from the top, each on a new spot
  rioters.forEach((family, i) => {
    var frog = frogEls[family];
    var spot = meet.spots && meet.spots[family];
    if (!frog || !spot) return;
    frogSpots[family] = spot;
    frog.getAnimations().forEach((animation) => animation.cancel());
    frog.dataset.x = spot[0] * size;
    frog.dataset.y = spot[1] * size;
    frog.style.transform = frogTransform(frog);
    if (!skipping) frog.animate([{ transform: "translate(" + frog.dataset.x + "px, " + -size * 1.5 + "px)" }, { transform: frogTransform(frog) }], { duration: 500, delay: i * 120, easing: "cubic-bezier(.3,1.4,.5,1)", fill: "backwards" });
  });
  await wait(500 + rioters.length * 120);
  // ... new symbols fall into the empty spots ...
  (meet.refill || []).forEach(({ at, id }) => {
    var cell = cellAt(at);
    if (!cell) return;
    shown[at[0]][at[1]] = id;
    cell.getAnimations().forEach((animation) => animation.cancel());
    fillCell(cell, id, bet);
    if (!skipping) cell.animate([{ transform: "translateY(" + -(at[1] + 1) * size + "px)", opacity: 0 }, { opacity: 1, offset: 0.3 }, { transform: "translateY(0)", opacity: 1 }], { duration: 450, delay: at[0] * 30, easing: "cubic-bezier(.25,.9,.35,1.15)", fill: "backwards" });
  });
  await wait(650);
  // ... and what they collected acts
  for (var effect of meet.effects || []) await playEffect(effect, step, next, bet, win, inBonus);
}

// The full meter: three chests open, each with a feature symbol
async function openChests(chests) {
  var card = el("div", "pd-intro pd-chests");
  var row = el("div", "pd-chest-row");
  chests.forEach((chest) => {
    // (a chest: what is in it, for which frog)
    var item = el("div", "pd-chest-item");
    item.style.setProperty("--fam", familyInfo(chest.family).color);
    var box = el("div", "pd-chest");
    box.append(el("span", "pd-chest-lid", "🧰"), el("span", "pd-chest-prize", featureIcon(chest.id)));
    var frog = el("span", "pd-chest-frog");
    frog.innerHTML = FROG_SVG;
    var label = el("div", "pd-chest-label");
    label.append(el("span", "pd-chest-name", featureName(chest.id)), frog);
    item.append(box, label);
    row.append(item);
  });
  card.append(el("div", "pd-intro-title", "Meter full"), el("p", "pd-intro-text", "Every chest holds a feature symbol for the frog below it."), row);
  stage(card);
  var time = setup.rules.chestTime;
  await wait(time * 0.3);
  [...row.querySelectorAll(".pd-chest")].forEach((box, i) => setTimeout(() => box.classList.add("open"), i * time * 0.15));
  await wait(time * 0.6);
  stage(null);
  await wait(time * 0.1);
}

function featureName(id) {
  var feature = setup.features.find((f) => f.id == id);
  return feature ? feature.name : "";
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
  showActivation(effect);
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
  } else if (effect.id == "evil" && !effect.none) {
    await turnEvil(effect, bet);
  } else if (effect.id == "rock" && effect.at) {
    await rockFalls(effect, bet);
  } else if (effect.id == "moon") {
    setMoons(effect.moons, inBonus);
    document.getElementById("pdMoons").animate([{ transform: "scale(1)" }, { transform: "scale(1.2)" }, { transform: "scale(1)" }], { duration: 450 });
  }
  await wait(setup.rules.effectTime);
}

// A rock falls on a spot: the spots around it splash new symbols, a frog hit jumps to its new spot
async function rockFalls(effect, bet) {
  var time = setup.rules.effectTime;
  var size = boardSize() / shown.length;
  if (!skipping) {
    var rock = el("div", "pd-falling-rock", "🪨");
    rock.style.left = effect.at[0] * size + "px";
    rock.style.top = effect.at[1] * size + "px";
    rock.style.width = rock.style.height = size + "px";
    document.querySelector(".pd-frog-layer").append(rock);
    await rock.animate([{ transform: "translateY(" + -(effect.at[1] + 1.5) * size + "px) scale(1.4)", opacity: 0.6 }, { transform: "translateY(0) scale(1)", opacity: 1 }], { duration: time * 0.45, easing: "cubic-bezier(.5,0,1,1)", fill: "forwards" }).finished;
    document.getElementById("pdBoard").animate([{ transform: "translateY(0)" }, { transform: "translateY(4px)" }, { transform: "translateY(-2px)" }, { transform: "translateY(0)" }], { duration: 220 });
    rock.animate([{ opacity: 1 }, { opacity: 0, transform: "scale(1.6)" }], { duration: time * 0.3, fill: "forwards" }).finished.then(() => rock.remove());
  }
  (effect.cells || []).forEach((spot, i) => setSpot(spot, effect.ids[i], bet));
  (effect.jumps || []).forEach((jump) => {
    frogSpots[jump.family] = jump.to;
    jumpFrog(frogEls[jump.family], jump.to, time * 0.4, size);
  });
}

// The symbol a frog sets off: it pops up over the frog (a chest's over the frog it is for), the frog lights up
function showActivation(effect) {
  var frog = frogEls[effect.family];
  var spot = frogSpots[effect.family];
  if (!frog || !spot || skipping) return;
  var time = setup.rules.effectTime;
  var icon = effect.id == "coin" ? "🪙" : featureIcon(effect.id);
  var n = spot[2] || 1;
  var size = boardSize() / shown.length;
  var badge = el("div", "pd-activation", icon);
  badge.style.left = (spot[0] + n / 2) * size + "px";
  badge.style.top = spot[1] * size + "px";
  document.querySelector(".pd-frog-layer").append(badge);
  badge
    .animate(
      [
        { transform: "translate(-50%, -20%) scale(0.3)", opacity: 0 },
        { transform: "translate(-50%, -75%) scale(1.15)", opacity: 1, offset: 0.25 },
        { transform: "translate(-50%, -70%) scale(1)", opacity: 1, offset: 0.75 },
        { transform: "translate(-50%, -90%) scale(1)", opacity: 0 },
      ],
      { duration: time, easing: "ease-out", fill: "forwards" },
    )
    .finished.then(() => badge.remove());
  frog.classList.add("moving");
  setTimeout(() => frog.classList.remove("moving"), time);
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
  for (var meet of step.meets || []) await playMeet(meet, next, bet, win, step, inBonus);
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
  // (a bonus buy: the moons it bought fill up, one after the other)
  for (var moon = Math.min(result.moons, setup.free.trigger) + 1; moon <= setup.free.trigger; moon++) {
    setMoons(moon, false);
    document.getElementById("pdMoons").animate([{ transform: "scale(1)" }, { transform: "scale(1.2)" }, { transform: "scale(1)" }], { duration: 300 });
    await wait(320);
  }
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
  line("🪨", "A rock clears the spots around where it lands, and a frog it hits jumps somewhere else.");
  line("😈", "The curse turns a frog evil. It grows, eats the frogs next to it and licks up the gems of their colours too.");
  line("🌕", "Collect " + setup.free.trigger + " full moons in one spin for " + setup.free.spins + " free spins.");
  dialog.append(
    x,
    el("h2", "mm-dialog-title", "Paytable"),
    el("p", "mm-dialog-text", "What one gem pays with your bet of 🪙 " + formatCoins(bet) + ". The sun upgrades gems up to " + setup.maxLevel + " times."),
    table,
    el("p", "mm-dialog-text", "Every frog collects the touching gems of its own colour, hopping on from each one it takes. Wilds and feature symbols next to its path are collected too."),
    features,
    el("p", "mm-dialog-text", "When no frog can move any more, frogs side by side may trade places. Sometimes a third frog argues, and the three riot through the pond, take every symbol that is not a gem and drop back in somewhere new."),
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
