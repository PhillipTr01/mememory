/* Megaways: the server rolls the reels and the tumbles and pays, this page only shows the spin. */
const socket = io((window.CASINO_NS || "") + "/megaways");

var myName = null;
var myCoins = 0;
var myCapRule = null; // the max bet by balance of a spin ({floor, share} - null: no cap), see casinoCapLeft
var myBuyCapRule = null; // ... of a bonus buy (counts like a bet at a table)
var setup = null; // {symbols, reels, rows, maxWays, free, maxWin, buy, rules}
var spinning = false;
var pausedUntil = 0; // after a spin: the next one only from then on
var spinWatch = null; // no answer from the server: the spin button comes back
var activeBonus = null; // the id of the free spins playing on this page
var BET_KEY = "megawaysBet";
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

// The note of a win in the best wins (casino_best.js): "4x crown 1296 ways" -> "4× 👑 · 1,296 ways"
function megawaysNote(text) {
  if (!setup) return text;
  var line = /^(\d)x (\w+) (\d+) ways/.exec(text);
  if (line) return line[1] + "× " + iconOf(line[2]) + " · " + formatCoins(line[3]) + " ways";
  var free = /^free spins (\d+) x(\d+)/.exec(text);
  if (free) return "🥚 " + free[1] + " free spins · ×" + free[2];
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
  myCapRule = data.capRules && "megaways" in data.capRules ? data.capRules.megaways : data.betCapRule || null;
  myBuyCapRule = data.capRules && "megaways:buy" in data.capRules ? data.capRules["megaways:buy"] : data.betCapRule || null;
  if (!spinning || document.getElementById("mwCoins").innerText == "-") renderCoins(myCoins);
  followMax();
  renderControls();
});
socket.on("mwError", (message) => {
  clearTimeout(spinWatch);
  if (autoLeft) stopAuto();
  showHint(message, "error", document.getElementById("mwSpin"));
  spinning = false;
  renderControls();
});
// Too early (the server wants a gap between two spins): once more in a moment
socket.on("mwSkip", () => {
  clearTimeout(spinWatch);
  setTimeout(() => {
    if (spinning) socket.emit("spin", lastRequest);
  }, 400);
});

socket.on("mwSetup", (data) => {
  var first = setup == null;
  setup = data;
  if (first) {
    showGrid(startScreen(), false);
    renderPresets();
    if (readBet() == "max") pickMax();
    else setBet(Number(readBet()) || 100);
  }
  renderControls();
});

socket.on("mwResult", (result) => {
  clearTimeout(spinWatch);
  playSpin(result);
});

// Back on the page: free spins that waited go on where they were
socket.on("mwResume", (result) => {
  if (setup == null) return setTimeout(() => socket.listeners("mwResume")[0](result), 200);
  if (activeBonus == result.id) return;
  resumeBonus(result);
});
socket.on("mwFeed", renderFeed);

/* ---------- The reels ---------- */

var shown = null; // the grid on the screen
var cells = []; // cells[reel][row] - the elements

// A screen to start with (nothing won): a few of every symbol
function startScreen() {
  var ids = setup.symbols.filter((s) => !s.wild && !s.scatter).map((s) => s.id);
  return Array.from({ length: setup.reels }, (_, reel) => Array.from({ length: 4 + (reel % 3) }, (_, row) => ids[(reel * 3 + row * 5) % ids.length]));
}

function reelHeight() {
  var reels = document.getElementById("mwReels");
  return reels.clientHeight || 300;
}

// The grid on the screen: every reel its own height of rows - the symbols fall in (drop: from above, by reel)
function showGrid(grid, drop, options) {
  options = options || {};
  var box = document.getElementById("mwReels");
  var height = reelHeight();
  // (the symbols never wider than a reel - narrow reels on a phone)
  box.style.setProperty("--col", (box.clientWidth || 600) / setup.reels + "px");
  cells = [];
  var columns = grid.map((column, reel) => {
    var reelBox = el("div", "mw-reel");
    var size = height / column.length;
    reelBox.style.setProperty("--cell", size + "px");
    cells[reel] = column.map((id, row) => {
      var cell = el("div", "mw-sym mw-" + id);
      cell.style.top = row * size + "px";
      cell.style.height = size + "px";
      cell.append(el("span", "mw-sym-icon", iconOf(id)));
      reelBox.appendChild(cell);
      return cell;
    });
    return reelBox;
  });
  box.replaceChildren(...columns);
  shown = grid;
  renderWays(grid);
  if (!drop) return Promise.resolve();
  // Every reel a bit later: the symbols fall from above the window, the lowest first
  var time = options.time || setup.rules.spinTime * 0.75;
  var animations = [];
  cells.forEach((column, reel) =>
    column.forEach((cell, row) => {
      animations.push(
        cell.animate([{ transform: "translateY(" + -(height + 40) + "px)" }, { transform: "translateY(0)" }], {
          duration: time * 0.55,
          delay: reel * time * 0.07 + (column.length - row) * 18,
          easing: "cubic-bezier(.25,.9,.35,1.15)",
          fill: "backwards",
        }).finished,
      );
    }),
  );
  return Promise.all(animations);
}

// The symbols on the screen fall out at the bottom (before the next spin drops in)
function dropOut() {
  var height = reelHeight();
  var animations = [];
  cells.forEach((column, reel) =>
    column.forEach((cell) => {
      animations.push(cell.animate([{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(" + (height + 20) + "px)", opacity: 0.3 }], { duration: 260, delay: reel * 30, easing: "ease-in", fill: "forwards" }).finished);
    }),
  );
  return Promise.all(animations);
}

function renderWays(grid) {
  var ways = grid.reduce((product, column) => product * column.length, 1);
  var box = document.getElementById("mwWays");
  box.querySelector(".mw-ways-value").innerText = formatCoins(ways);
  box.classList.toggle("max", setup && ways >= setup.maxWays);
}

/*
 * One tumble: the wins light up, the winning symbols burst, the rest falls down and new ones fall in from the top
 * (the next screen: `next`). step: {grid, wins, pay}; multiplier: the free spins' (1 in the base game)
 */
async function playTumble(step, next, bet, multiplier, total) {
  var time = setup.rules.tumbleTime;
  var gone = new Set();
  step.wins.forEach((win) => win.spots.forEach((spot) => gone.add(spot[0] + ":" + spot[1])));
  gone.forEach((key) => {
    var [reel, row] = key.split(":").map(Number);
    if (cells[reel] && cells[reel][row]) cells[reel][row].classList.add("win");
  });
  document.getElementById("mwReels").classList.add("winning");
  var stepWin = step.pay * multiplier * bet;
  showWinDetail(step, multiplier, bet);
  countUp(document.getElementById("mwWinText"), Math.floor(total + stepWin), time * 0.4, Math.floor(total));
  await wait(time * 0.45);
  // Burst
  var bursts = [];
  gone.forEach((key) => {
    var [reel, row] = key.split(":").map(Number);
    var cell = cells[reel] && cells[reel][row];
    if (cell) bursts.push(cell.animate([{ transform: "scale(1)", opacity: 1 }, { transform: "scale(1.35)", opacity: 0 }], { duration: time * 0.18, easing: "ease-in", fill: "forwards" }).finished);
  });
  await Promise.all(bursts);
  document.getElementById("mwReels").classList.remove("winning");
  // Fall: the ones left from where they were, the new ones from above
  var oldCells = cells;
  var height = reelHeight();
  showGrid(next, false);
  var falls = [];
  next.forEach((column, reel) => {
    var size = height / column.length;
    var old = step.grid[reel];
    var keptRows = old.map((_, row) => row).filter((row) => !gone.has(reel + ":" + row));
    var fresh = column.length - keptRows.length;
    cells[reel].forEach((cell, row) => {
      var from = row < fresh ? -(fresh - row) * size - 10 : (keptRows[row - fresh] - row) * size;
      if (from == 0) return;
      falls.push(cell.animate([{ transform: "translateY(" + from + "px)" }, { transform: "translateY(0)" }], { duration: time * 0.32, easing: "cubic-bezier(.3,.8,.4,1.1)", fill: "backwards" }).finished);
    });
  });
  oldCells.length = 0;
  await Promise.all(falls);
  return stepWin;
}

function showWinDetail(step, multiplier, bet) {
  var detail = document.getElementById("mwWinDetail");
  var best = step.wins.reduce((a, b) => (b.pay > a.pay ? b : a));
  var text = step.wins.length > 1 ? step.wins.length + " wins · best " : "";
  text += best.reels + "× " + iconOf(best.symbol) + " · " + formatCoins(best.ways) + (best.ways == 1 ? " way" : " ways");
  if (multiplier > 1) text += " · ×" + multiplier;
  detail.innerText = text;
}

/* ---------- A spin ---------- */

var lastRequest = null;
function spin(buy) {
  if (setup == null || spinning || activeBonus) return;
  var bet = currentBet();
  if (!Number.isInteger(bet) || bet < setup.rules.minBet || bet > setup.rules.maxBet) return showHint("A spin is " + formatCoins(setup.rules.minBet) + " to " + formatCoins(setup.rules.maxBet) + " coins.", "error", document.getElementById("mwSpin"));
  var cost = buy ? bet * setup.buy : bet;
  if (cost > myCoins) {
    if (autoLeft) stopAuto();
    return showHint("You don't have enough coins.", "error", document.getElementById(buy ? "mwBuy" : "mwSpin"));
  }
  var left = casinoCapLeft(buy ? myBuyCapRule : myCapRule, myCoins, 0);
  if (cost > left) {
    if (autoLeft) stopAuto();
    return showHint("Your max " + (buy ? "buy" : "bet") + " right now is " + formatCoins(buy ? Math.floor(left / setup.buy) : left) + ".", "error", document.getElementById(buy ? "mwBuy" : "mwSpin"));
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
  var text = document.getElementById("mwWinText");
  var detail = document.getElementById("mwWinDetail");
  text.innerText = result.buy ? "🛒 Bonus buy" : "Good luck!";
  detail.innerText = "";
  await dropOut();
  await showGrid(result.grid, true);
  var total = 0;
  // The tumbles of the base game
  for (var i = 0; i < result.steps.length; i++) {
    var next = i + 1 < result.steps.length ? result.steps[i + 1].grid : result.last;
    total += await playTumble(result.steps[i], next, result.bet, 1, total);
  }
  if (result.bonus) {
    await eggsShow();
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
  var text = document.getElementById("mwWinText");
  if (result.win <= 0) {
    text.innerText = "No win";
    return;
  }
  text.innerText = "🪙 " + formatCoins(result.win);
  if (result.win >= result.bet * setup.rules.bigWin) await bigWin(result.win, result.bet);
  else await wait(setup.rules.countTime);
}

// 4 🥚 or more: they glow before the free spins
async function eggsShow() {
  cells.forEach((column, reel) => column.forEach((cell, row) => shown[reel][row] == "egg" && cell.classList.add("egg-glow")));
  document.getElementById("mwWinDetail").innerText = "🥚 The dragon's eggs!";
  await wait(1100);
}

/* ---------- The free spins ---------- */

function stage(content) {
  var box = document.getElementById("mwStage");
  if (!content) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  box.replaceChildren(content);
  box.hidden = false;
}

// "Dragon's hoard: 8 free spins" - waits for the click (auto spins too)
function bonusIntro(result) {
  return new Promise((resolve) => {
    var card = el("div", "mw-intro");
    card.append(el("div", "mw-intro-eggs", Array(Math.min(8, result.eggs)).fill("🥚").join("")), el("div", "mw-intro-title", "Dragon's Hoard"), el("div", "mw-intro-spins", result.bonus.start + " free spins"));
    card.append(el("p", "mw-intro-text", "Every tumble raises the dragon multiplier. Every egg gives a free spin and makes the reels taller."));
    var go = el("button", "mm-btn mm-btn-primary mw-intro-go", "Start");
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
  var text = document.getElementById("mwWinText");
  var total = before + bonus.freeSpins.slice(0, from).reduce((sum, free) => sum + free.pay * bet, 0);
  var counter = document.getElementById("mwFreeCounter");
  var mult = document.getElementById("mwMult");
  counter.hidden = false;
  mult.hidden = false;
  document.getElementById("mwWindow").classList.add("free");
  for (var n = from; n < bonus.freeSpins.length; n++) {
    var free = bonus.freeSpins[n];
    document.getElementById("mwFreeCount").innerText = n + 1 + " / " + free.spins;
    setMultiplier(free.multiplier);
    await dropOut();
    await showGrid(free.grid, true, { time: setup.rules.freeSpinTime * 0.8 });
    var multiplier = free.multiplier;
    for (var i = 0; i < free.steps.length; i++) {
      var next = i + 1 < free.steps.length ? free.steps[i + 1].grid : free.last;
      total += await playTumble(free.steps[i], next, bet, multiplier, total);
      multiplier++;
      setMultiplier(multiplier, true);
    }
    if (free.eggs) await caveGrows(free);
    socket.emit("bonusProgress", { id: result.id, shown: n + 1 });
    await wait(setup.rules.freeSpinTime * 0.2);
  }
  counter.hidden = true;
  document.getElementById("mwWindow").classList.remove("free");
  // The end: the whole win of the spin
  await bonusEnd(result);
  mult.hidden = true;
  text.innerText = "🪙 " + formatCoins(result.win);
  socket.emit("bonusDone", { id: result.id });
}

function setMultiplier(value, bump) {
  var box = document.getElementById("mwMultValue");
  box.innerText = "×" + value;
  if (bump) box.animate([{ transform: "scale(1.5)" }, { transform: "scale(1)" }], { duration: 350, easing: "ease-out" });
}

// A 🥚 in a free spin: a spin more, the cave grows
async function caveGrows(free) {
  cells.forEach((column, reel) => column.forEach((cell, row) => shown[reel][row] == "egg" && cell.classList.add("egg-glow")));
  var detail = document.getElementById("mwWinDetail");
  var rows = Math.min(setup.rows[1], free.least + free.eggs);
  detail.innerText = "🥚 +" + free.more + (free.more == 1 ? " free spin" : " free spins") + " · the cave grows to " + rows + " rows";
  document.getElementById("mwFreeCount").innerText = document.getElementById("mwFreeCount").innerText.replace(/\/ \d+/, "/ " + free.spins);
  await wait(setup.rules.eggTime);
}

async function bonusEnd(result) {
  var card = el("div", "mw-intro mw-end");
  var amount = el("div", "mw-end-win", "🪙 0");
  card.append(el("div", "mw-intro-title", "Dragon's Hoard"), amount, el("div", "mw-intro-spins", result.bonus.freeSpins.length + " free spins · ×" + (result.bonus.freeSpins.length ? result.bonus.freeSpins[result.bonus.freeSpins.length - 1].multiplierAfter - 1 : 1)));
  if (result.capped) card.append(el("p", "mw-intro-text", "The max win of " + formatCoins(setup.maxWin) + "× your bet is reached."));
  stage(card);
  countUp(amount, result.win, setup.rules.bonusEndTime * 0.6);
  await wait(setup.rules.bonusEndTime);
  stage(null);
}

async function bigWin(win, bet) {
  var card = el("div", "mw-intro mw-big");
  var amount = el("div", "mw-end-win", "🪙 0");
  var x = win / bet;
  card.append(el("div", "mw-intro-title", x >= 100 ? "Epic win" : x >= 40 ? "Mega win" : "Big win"), amount);
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
  document.getElementById("mwWinText").innerText = "🪙 " + formatCoins(Math.floor(before));
  if (!result.started) await bonusIntro(result);
  else {
    var note = el("div", "mw-intro");
    note.append(el("div", "mw-intro-title", "Welcome back"), el("div", "mw-intro-spins", "The free spins go on"));
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
  return Number(document.getElementById("mwBet").value);
}

function setBet(value, keepMax, typed) {
  if (setup == null) return;
  if (!keepMax) maxMode = false;
  var bet = Math.max(setup.rules.minBet, Math.min(typed ? setup.rules.maxBet : maxNow(), Math.round(value)));
  document.getElementById("mwBet").value = bet;
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
  var box = document.getElementById("mwPresets");
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
  var box = document.getElementById("mwCoins");
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
  document.getElementById("mwSpin").disabled = (busy && !autoLeft) || !(bet >= setup.rules.minBet);
  document.getElementById("mwSpin").classList.toggle("stop", !!autoLeft);
  document.getElementById("mwBuy").disabled = busy;
  document.getElementById("mwLess").disabled = busy || bet <= setup.rules.minBet;
  document.getElementById("mwMore").disabled = busy || bet >= maxNow();
  document.getElementById("mwBet").disabled = busy;
  document.querySelectorAll("#mwPresets .sl-preset").forEach((button) => {
    button.disabled = busy;
    button.classList.toggle("active", button.classList.contains("sl-preset-max") ? maxMode : !maxMode && Number(button.dataset.value) == bet);
  });
  var key = presets().join(",");
  if (key != lastPresets) {
    lastPresets = key;
    renderPresets();
  }
  document.getElementById("mwAuto").disabled = busy && !autoLeft;
}

/* ---------- Auto spins ---------- */

function renderAuto() {
  var left = document.getElementById("mwAutoLeft");
  left.hidden = !autoLeft;
  left.innerText = autoLeft === Infinity ? "∞" : String(autoLeft);
  document.querySelector("#mwSpin .sl-spin-label").innerText = autoLeft ? "Stop" : "Spin";
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
  document.getElementById("mwFeedEmpty").hidden = feed.length > 0;
  document.getElementById("mwFeed").replaceChildren(
    ...feed.map((entry) => {
      var multiple = entry.win / (entry.buy || entry.bet);
      var what = entry.free ? "🥚 " + entry.free + " free spins" : iconOf(entry.symbol) + " · " + formatCoins(entry.ways) + " ways";
      var sub = what + (entry.buy ? " · 🛒 bought for 🪙 " + formatCoins(entry.buy) : " · bet 🪙 " + formatCoins(entry.bet)) + " · " + (multiple >= 10 ? Math.round(multiple) : multiple.toFixed(1)) + "x";
      return historyItem(createAvatar(entry.name, "sm"), entry.name, sub, "🪙 " + formatCoins(entry.win));
    }),
  );
}

function showPaytable() {
  if (setup == null) return;
  var backdrop = el("div", "mm-dialog-backdrop");
  var dialog = el("div", "mm-dialog sl-paytable mw-paytable");
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
  var table = el("table", "mw-pays");
  var head = el("tr");
  head.append(el("th", "", ""), el("th", "", "3 reels"), el("th", "", "4 reels"), el("th", "", "5 reels"), el("th", "", "6 reels"));
  table.append(head);
  setup.symbols
    .filter((s) => !s.wild && !s.scatter)
    .slice()
    .reverse()
    .forEach((symbol) => {
      var row = el("tr");
      row.append(el("td", "mw-pays-icon", symbol.icon));
      symbol.pays.forEach((pay) => row.append(el("td", "", formatCoins(Math.round(pay * bet * 100) / 100))));
      table.append(row);
    });
  dialog.append(
    x,
    el("h2", "mm-dialog-title", "Paytable"),
    el("p", "mm-dialog-text", "Wins per way for your bet of 🪙 " + formatCoins(bet) + ". Every way pays, so a symbol twice on a reel pays twice."),
    table,
    el("p", "mm-dialog-text", iconOf("wild") + " stands for every symbol but the egg. " + setup.free.trigger + " or more " + iconOf("egg") + " start " + setup.free.spins + " free spins."),
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

document.getElementById("mwSpin").addEventListener("click", () => {
  if (autoLeft) return stopAuto();
  if (Date.now() < pausedUntil) return;
  spin(false);
});
document.getElementById("mwBuy").addEventListener("click", buyBonus);
document.getElementById("mwPaytable").addEventListener("click", showPaytable);
document.getElementById("mwLess").addEventListener("click", () => {
  var list = presets();
  var lower = list.filter((value) => value < currentBet());
  setBet(lower.length ? lower[lower.length - 1] : setup.rules.minBet);
});
document.getElementById("mwMore").addEventListener("click", () => {
  var higher = presets().filter((value) => value > currentBet());
  setBet(higher.length ? higher[0] : maxNow());
});
document.getElementById("mwBet").addEventListener("change", (event) => setBet(Number(event.target.value) || setup.rules.minBet, false, true));
document.getElementById("mwAuto").addEventListener("click", (event) => {
  event.stopPropagation();
  if (autoLeft) return stopAuto();
  var menu = document.getElementById("mwAutoMenu");
  menu.hidden = !menu.hidden;
  document.getElementById("mwAuto").setAttribute("aria-expanded", String(!menu.hidden));
});
document.querySelectorAll("#mwAutoMenu [data-auto]").forEach((button) =>
  button.addEventListener("click", () => {
    document.getElementById("mwAutoMenu").hidden = true;
    startAuto(button.dataset.auto == "infinite" ? Infinity : Number(button.dataset.auto));
  }),
);
document.addEventListener("click", (event) => {
  var menu = document.getElementById("mwAutoMenu");
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
// The window changes size: the reels again (their cells are measured in pixels)
window.addEventListener("resize", () => {
  if (shown && !spinning) showGrid(shown, false);
});
