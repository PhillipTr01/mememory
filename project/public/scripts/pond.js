/* Frog Pond: the server fills the board, plays out the tumbles and the frogs and pays, this page only shows the spin. */
const socket = io((window.CASINO_NS || "") + "/pond");

var myName = null;
var myCoins = 0;
var myCapRule = null; // the max bet by balance of a spin ({floor, share} - null: no cap), see casinoCapLeft
var myBuyCapRule = null; // ... of a bonus buy (counts like a bet at a table)
var setup = null; // {symbols, families, sizeFactors, cluster, size, belly, freeBelly, maxLevel, free, maxWin, buy, rules}
var spinning = false;
var pausedUntil = 0; // after a spin: the next one only from then on
var spinWatch = null; // no answer from the server: the spin button comes back
var activeBonus = null; // the id of the free spins playing on this page
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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

// The note of a win in the best wins (casino_best.js): "9 berry" -> "9 × 🍓", "free spins 12" -> "🌕 12 free spins"
function pondNote(text) {
  if (!setup) return text;
  var cluster = /^(\d+) (\w+)/.exec(text);
  if (cluster && setup.families.some((family) => family.id == cluster[2])) return cluster[1] + " × " + familyIcon(cluster[2]);
  var free = /^free spins (\d+)/.exec(text);
  if (free) return "🌕 " + free[1] + " free spins";
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
    setFrogs(zeros(), zeros(), setup.belly);
    showGrid(startScreen(), false);
    renderPresets();
    if (readBet() == "max") pickMax();
    else setBet(Number(readBet()) || 100);
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

var shown = null; // the board on the screen
var cells = []; // cells[column][row] - the elements

function familyOf(id) {
  var symbol = setup && symbolOf(id);
  return symbol ? symbol.family : null;
}
function familyInfo(id) {
  return setup.families.find((family) => family.id == id);
}
// The best symbol of a family (its icon stands for the family)
function familyIcon(id) {
  var best = setup.symbols.filter((s) => s.family == id).sort((a, b) => b.tier - a.tier)[0];
  return best ? best.icon : "";
}

// A board to start with (nothing won): the families mixed
function startScreen() {
  var ids = setup.symbols.filter((s) => s.family && s.tier < 2).map((s) => s.id);
  var n = setup.size[0];
  return Array.from({ length: n }, (_, c) => Array.from({ length: n }, (_, r) => ids[(c * 5 + r * 7) % ids.length]));
}

function boardSize() {
  var box = document.getElementById("pdBoard");
  return box.clientWidth || 360;
}

// The board on the screen: square cells, the symbols fall in (drop: from above, by column)
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
      var family = familyOf(id);
      var cell = el("div", "pd-sym pd-" + id + (family ? " pd-fam-" + family : ""));
      cell.style.top = r * size + "px";
      cell.style.height = size + "px";
      if (family) cell.style.setProperty("--fam", familyInfo(family).color);
      cell.append(el("span", "pd-sym-icon", iconOf(id)));
      columnBox.appendChild(cell);
      return cell;
    });
    return columnBox;
  });
  box.replaceChildren(...columns);
  shown = grid;
  renderSize(n);
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
  return Promise.all(animations);
}

// The symbols on the board fall out at the bottom (before the next spin drops in)
function dropOut() {
  var width = boardSize();
  var animations = [];
  cells.forEach((column, c) =>
    column.forEach((cell) => {
      animations.push(cell.animate([{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(" + (width + 20) + "px)", opacity: 0.3 }], { duration: 260, delay: c * 30, easing: "ease-in", fill: "forwards" }).finished);
    }),
  );
  return Promise.all(animations);
}

function renderSize(n) {
  var box = document.getElementById("pdSize");
  box.querySelector(".pd-size-value").innerText = n + "×" + n;
  box.classList.toggle("max", setup && n >= setup.size[1]);
}

/* ---------- The frogs ---------- */

// A frog in the colour of its kind (--fam), sitting on its lily pad
var FROG_SVG = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 33 L44 38 A22 8 0 1 1 41 34 Z" fill="#15803d" /><path d="M24 33 L44 38 A22 8 0 1 1 41 34 Z" fill="none" stroke="#0f5132" stroke-width="1.2" /><path d="M24 38 L12 41 M24 38 L30 43 M24 38 L8 37" stroke="#166534" stroke-width="1" /><ellipse cx="24" cy="26" rx="13" ry="10.5" fill="var(--fam)" /><circle cx="16" cy="15" r="5.8" fill="var(--fam)" /><circle cx="32" cy="15" r="5.8" fill="var(--fam)" /><circle cx="16" cy="15" r="3.2" fill="#fff" /><circle cx="32" cy="15" r="3.2" fill="#fff" /><circle cx="16.7" cy="15.5" r="1.7" fill="#111827" /><circle cx="32.7" cy="15.5" r="1.7" fill="#111827" /><path d="M17 27.5 Q24 33 31 27.5" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="2" stroke-linecap="round" /><circle cx="13" cy="26" r="1.8" fill="rgba(255,255,255,.35)" /><circle cx="35" cy="26" r="1.8" fill="rgba(255,255,255,.35)" /></svg>';
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
      var food = el("div", "pd-frog-food", familyIcon(family.id));
      var belly = el("div", "pd-frog-belly");
      var fill = el("div", "pd-frog-fill");
      belly.append(fill);
      var stars = el("div", "pd-frog-stars", "");
      frog.append(face, food, belly, stars);
      frogBoxes[family.id] = { frog: frog, fill: fill, stars: stars, face: face };
      return frog;
    }),
  );
}

// The bellies (0 .. full) and the levels of the families
function setFrogs(bellies, levels, full) {
  setup.families.forEach((family) => {
    var box = frogBoxes[family.id];
    if (!box) return;
    var value = (bellies && bellies[family.id]) || 0;
    box.fill.style.width = Math.min(100, (value / full) * 100) + "%";
    var level = (levels && levels[family.id]) || 0;
    box.stars.innerText = "★".repeat(level) + "☆".repeat(setup.maxLevel - level);
    box.frog.classList.toggle("grown", level > 0);
  });
}

function zeros() {
  return Object.fromEntries(setup.families.map((family) => [family.id, 0]));
}

/*
 * One step: the clusters light up (or the specials act), the frogs fill up and may leap, the spots go, the rest
 * falls down and new symbols fall in from the top (the next board: `next`). -> the win of the step
 */
async function playStep(step, next, bet, total, full) {
  var time = setup.rules.tumbleTime;
  var board = document.getElementById("pdBoard");
  var gone = new Set(step.gone.map((spot) => spot[0] + ":" + spot[1]));
  var mark = (spot, name) => cells[spot[0]] && cells[spot[0]][spot[1]] && cells[spot[0]][spot[1]].classList.add(name);
  var detail = document.getElementById("pdWinDetail");
  var stepWin = step.pay * bet;
  if (step.kind == "win") {
    step.clusters.forEach((cluster) => cluster.cells.forEach((spot) => mark(spot, "win")));
    board.classList.add("winning");
    var clusterPay = step.clusters.reduce((sum, cluster) => sum + cluster.pay, 0) * bet;
    showWinDetail(step);
    countUp(document.getElementById("pdWinText"), Math.floor(total + clusterPay), time * 0.4, Math.floor(total));
    await wait(time * 0.45);
    setFrogs(step.bellies, step.levels, full);
    // A full frog leaps: it eats every symbol of its kind on the board
    for (var leap of step.leaps) {
      var box = frogBoxes[leap.family];
      if (box) box.frog.animate([{ transform: "translateY(0) scale(1)" }, { transform: "translateY(-14px) scale(1.25)" }, { transform: "translateY(0) scale(1)" }], { duration: setup.rules.leapTime * 0.6, easing: "ease-out" });
      leap.cells.forEach((spot) => mark(spot, "eaten"));
      detail.innerText = "🐸 The " + familyInfo(leap.family).frog.toLowerCase() + " leaps and eats " + leap.cells.length + "!";
      countUp(document.getElementById("pdWinText"), Math.floor(total + clusterPay + leap.pay * bet), setup.rules.leapTime * 0.5, Math.floor(total + clusterPay));
      clusterPay += leap.pay * bet;
      await wait(setup.rules.leapTime);
    }
  } else {
    step.specials.forEach((special) => {
      mark(special.at, "acting");
      special.cells.forEach((spot) => mark(spot, "splashed"));
    });
    var lotus = step.specials.some((special) => special.id == "lotus");
    var splash = step.specials.some((special) => special.id == "splash");
    detail.innerText = [lotus ? (step.grow ? "🪷 The pond grows" : "🪷 The pond is as big as it gets") : "", splash ? "🌊 Splash" : ""].filter(Boolean).join(" · ");
    await wait(time * 0.45);
  }
  // Burst
  var bursts = [];
  gone.forEach((key) => {
    var [c, r] = key.split(":").map(Number);
    var cell = cells[c] && cells[c][r];
    if (cell) bursts.push(cell.animate([{ transform: "scale(1)", opacity: 1 }, { transform: "scale(1.35)", opacity: 0 }], { duration: time * 0.18, easing: "ease-in", fill: "forwards" }).finished);
  });
  await Promise.all(bursts);
  board.classList.remove("winning");
  // Fall: the ones left from where they were, the new ones from above
  var width = boardSize();
  showGrid(next, false);
  var size = width / next.length;
  var falls = [];
  next.forEach((column, c) => {
    var old = step.grid[c] || [];
    var keptRows = old.map((_, r) => r).filter((r) => !gone.has(c + ":" + r));
    var fresh = column.length - keptRows.length;
    cells[c].forEach((cell, r) => {
      var from = r < fresh ? -(fresh - r) * size - 10 : (keptRows[r - fresh] - r) * size;
      if (from == 0) return;
      falls.push(cell.animate([{ transform: "translateY(" + from + "px)" }, { transform: "translateY(0)" }], { duration: time * 0.32, easing: "cubic-bezier(.3,.8,.4,1.1)", fill: "backwards" }).finished);
    });
  });
  await Promise.all(falls);
  return stepWin;
}

function showWinDetail(step) {
  var detail = document.getElementById("pdWinDetail");
  var best = step.clusters.reduce((a, b) => (b.pay > a.pay ? b : a));
  var text = step.clusters.length > 1 ? step.clusters.length + " clusters · best " : "";
  text += best.size + " × " + familyIcon(best.family);
  detail.innerText = text;
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
  setFrogs(zeros(), zeros(), setup.belly);
  await dropOut();
  await showGrid(result.grid, true);
  var total = 0;
  for (var i = 0; i < result.steps.length; i++) {
    var next = i + 1 < result.steps.length ? result.steps[i + 1].grid : result.last;
    total += await playStep(result.steps[i], next, result.bet, total, setup.belly);
  }
  if (result.bonus) {
    await moonsShow();
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

function glowMoons() {
  cells.forEach((column, c) => column.forEach((cell, r) => shown[c][r] == "moon" && cell.classList.add("moon-glow")));
}

// 3 🌕 or more: they glow before the free spins
async function moonsShow() {
  glowMoons();
  document.getElementById("pdWinDetail").innerText = "🌕 The full moon rises!";
  await wait(1100);
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
    card.append(el("div", "pd-intro-moons", Array(Math.min(8, result.moons)).fill("🌕").join("")), el("div", "pd-intro-title", "Full Moon"), el("div", "pd-intro-spins", result.bonus.start + " free spins"));
    card.append(el("p", "pd-intro-text", "The pond, the frogs and the better symbols stay for all free spins. Every moon gives one more free spin."));
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
  document.getElementById("pdWindow").classList.add("free");
  for (var n = from; n < bonus.freeSpins.length; n++) {
    var free = bonus.freeSpins[n];
    document.getElementById("pdFreeCount").innerText = n + 1 + " / " + free.spins;
    setFrogs(free.bellies, free.levels, setup.freeBelly);
    await dropOut();
    await showGrid(free.grid, true, { time: setup.rules.freeSpinTime * 0.8 });
    for (var i = 0; i < free.steps.length; i++) {
      var next = i + 1 < free.steps.length ? free.steps[i + 1].grid : free.last;
      total += await playStep(free.steps[i], next, bet, total, setup.freeBelly);
    }
    if (free.moons) await moreSpins(free);
    socket.emit("bonusProgress", { id: result.id, shown: n + 1 });
    await wait(setup.rules.freeSpinTime * 0.2);
  }
  counter.hidden = true;
  document.getElementById("pdWindow").classList.remove("free");
  await bonusEnd(result);
  text.innerText = "🪙 " + formatCoins(result.win);
  socket.emit("bonusDone", { id: result.id });
}

// A 🌕 in a free spin: spins more
async function moreSpins(free) {
  glowMoons();
  var detail = document.getElementById("pdWinDetail");
  detail.innerText = free.more ? "🌕 +" + free.more + (free.more == 1 ? " free spin" : " free spins") : "🌕 The most free spins are reached";
  document.getElementById("pdFreeCount").innerText = document.getElementById("pdFreeCount").innerText.replace(/\/ \d+/, "/ " + free.spins);
  await wait(setup.rules.moonTime);
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
  showGrid(result.last, false);
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
      var what = entry.free ? "🌕 " + entry.free + " free spins" : entry.symbol ? entry.size + " × " + familyIcon(entry.symbol) : "🐸";
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
  var table = el("table", "pd-pays");
  var sizes = [5, 8, 12, 16];
  var factor = (size) => setup.sizeFactors[Math.min(size - setup.cluster, setup.sizeFactors.length - 1)];
  var head = el("tr");
  head.append(el("th", "", ""), ...sizes.map((size, i) => el("th", "", size + (i == sizes.length - 1 ? "+" : ""))));
  table.append(head);
  setup.families.forEach((family) =>
    setup.symbols
      .filter((s) => s.family == family.id)
      .slice()
      .reverse()
      .forEach((symbol) => {
        var row = el("tr", symbol.tier == 2 ? "pd-pays-first" : "");
        row.append(el("td", "pd-pays-icon", symbol.icon));
        sizes.forEach((size) => row.append(el("td", "", formatCoins(Math.round(symbol.value * size * factor(size) * bet * 100) / 100))));
        table.append(row);
      }),
  );
  dialog.append(
    x,
    el("h2", "mm-dialog-title", "Paytable"),
    el("p", "mm-dialog-text", "Wins for a cluster of one symbol with your bet of 🪙 " + formatCoins(bet) + ". A mixed cluster pays for every symbol in it."),
    table,
    el("p", "mm-dialog-text", "A frog eats its kind from your clusters. A full frog eats all of its kind on the pond, and each pays " + setup.leapPay + " times its value."),
    el("p", "mm-dialog-text", iconOf("wild") + " joins every cluster it touches. " + setup.free.trigger + " or more " + iconOf("moon") + " start " + setup.free.spins + " free spins."),
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
    text: "You get " + setup.free.spins + " free spins right away for 🪙 " + formatCoins(bet * setup.buy) + ", " + setup.buy + "× your bet.",
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
