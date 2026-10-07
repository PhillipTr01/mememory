/* Hidden slots: the server rolls the reels and pays, this page only shows the spin. */
const socket = io("/slots");

var myName = null;
var myCoins = 0;
var setup = null; // {symbols, lines, strips, rules}
var spinning = false;
var lineTimer = null;
var BET_KEY = "slotsBet";
var PRESETS = [10, 50, 100, 250, 500, 1000];
var TILE = 0; // height of one symbol (from the page)

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

/* ---------- Socket ---------- */

socket.on("connect", () => (document.getElementById("connectionBanner").hidden = true));
socket.on("disconnect", () => {
  document.getElementById("connectionBanner").hidden = false;
  spinning = false;
  renderControls();
});
socket.on("connect_error", (error) => {
  if (error && error.message == "unauthorized") window.location.href = "/";
});
// The admin took the access away
socket.on("casinoClosed", () => (window.location.href = "/"));
// The admin turned this game off: on to another one
socket.on("gameOff", () => (window.location.href = "./"));

window.addEventListener("pagehide", () => socket.disconnect());
window.addEventListener("pageshow", (event) => {
  if (event.persisted) socket.connect();
});

socket.on("joined", (data) => (myName = data.username));
socket.on("coins", (data) => {
  myCoins = data.coins;
  // While the reels turn, the balance shows the coins before the win
  // (during a spin the old balance stays - but a page that comes back into a bonus game needs one)
  if (!spinning || document.getElementById("slCoins").innerText == "-") renderCoins(myCoins);
  renderControls();
});
socket.on("slotsError", (message) => {
  showToast(message, "error");
  spinning = false;
  renderControls();
});

socket.on("slotsSetup", (data) => {
  setup = data;
  buildMachine();
  renderPresets();
  setBet(Number(readBet()) || 100);
});

socket.on("slotsResult", (result) => playSpin(result));

// Back on the page: a bonus game that waited goes on where it was
var activeBonus = null; // id of the bonus game playing on this page
socket.on("slotsResume", (result) => {
  if (setup == null) return setTimeout(() => socket.listeners("slotsResume")[0](result), 200);
  // (only a short break in the connection: it is still playing here)
  if (activeBonus == result.id) return;
  resumeBonus(result);
});

async function resumeBonus(result) {
  spinning = true;
  clearTimeout(lineTimer);
  clearLines();
  renderControls();
  result.grid.forEach((symbols, reel) => showGrid(reel, symbols));
  await playBonus(result, result.shown, result.started);
  await showResult(result);
  spinning = false;
  renderCoins(myCoins);
  renderControls();
}
socket.on("slotsFeed", renderFeed);

/* ---------- The machine ---------- */

function cell(id) {
  var symbol = symbolOf(id);
  var box = el("div", "sl-cell" + (symbol && symbol.wild ? " wild" : "") + (symbol && symbol.scatter ? " scatter" : ""));
  box.dataset.symbol = id;
  box.appendChild(el("span", "sl-symbol", symbol ? symbol.icon : "?"));
  return box;
}

// Three symbols of a strip around a place (top, middle, bottom)
function windowAt(strip, stop) {
  var at = (i) => strip[(i + strip.length) % strip.length];
  return [at(stop - 1), at(stop), at(stop + 1)];
}

function buildMachine() {
  var reels = document.getElementById("slReels");
  reels.replaceChildren(
    ...setup.strips.map((strip) => {
      var reel = el("div", "sl-reel");
      var track = el("div", "sl-track");
      var start = Math.floor(Math.random() * strip.length);
      track.append(...windowAt(strip, start).map(cell));
      reel.appendChild(track);
      return reel;
    }),
  );
  TILE = reels.querySelector(".sl-cell").offsetHeight;
  buildNumbers();
}

// The numbers of the lines next to the reels: where a line starts / ends; hover shows it
function buildNumbers() {
  var sides = { left: document.getElementById("slNumbersLeft"), right: document.getElementById("slNumbersRight") };
  ["left", "right"].forEach((side) => {
    var column = sides[side];
    column.replaceChildren(
      ...[0, 1, 2].map((row) => {
        var group = el("div", "sl-number-row");
        setup.lines.forEach((rows, line) => {
          if (rows[side == "left" ? 0 : rows.length - 1] != row) return;
          var badge = el("span", "sl-number", line + 1);
          badge.dataset.line = line;
          badge.addEventListener("mouseenter", () => !spinning && showLines([line], false));
          badge.addEventListener("mouseleave", () => !spinning && clearLines());
          group.appendChild(badge);
        });
        return group;
      }),
    );
  });
}

// Lines over the reels (SVG): through the middle of the cells
function linePoints(line) {
  var reels = [...document.querySelectorAll(".sl-reel")];
  var window_ = document.querySelector(".sl-window").getBoundingClientRect();
  return setup.lines[line]
    .map((row, reel) => {
      var box = reels[reel].getBoundingClientRect();
      var x = box.left - window_.left + box.width / 2;
      var y = box.top - window_.top + TILE * row + TILE / 2;
      return x + "," + y;
    })
    .join(" ");
}

function showLines(lines, win) {
  var svg = document.getElementById("slLines");
  var window_ = document.querySelector(".sl-window");
  svg.setAttribute("viewBox", "0 0 " + window_.clientWidth + " " + window_.clientHeight);
  svg.replaceChildren(
    ...lines.map((line) => {
      var polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      polyline.setAttribute("points", linePoints(line));
      polyline.setAttribute("class", "sl-line" + (win ? " win" : ""));
      return polyline;
    }),
  );
  document.querySelectorAll(".sl-number").forEach((badge) => badge.classList.toggle("on", lines.includes(Number(badge.dataset.line))));
}

function clearLines() {
  document.getElementById("slLines").replaceChildren();
  document.querySelectorAll(".sl-number.on").forEach((badge) => badge.classList.remove("on"));
  document.querySelectorAll(".sl-cell.hit").forEach((cell) => cell.classList.remove("hit"));
}

/* ---------- A spin ---------- */

function spin() {
  if (spinning || setup == null) return;
  var bet = currentBet();
  if (!Number.isInteger(bet) || bet < setup.rules.minBet || bet > setup.rules.maxBet) {
    return showToast("A spin is " + formatCoins(setup.rules.minBet) + " to " + formatCoins(setup.rules.maxBet) + " coins.", "error");
  }
  if (bet > myCoins) return showToast("You don't have enough coins.", "error");
  spinning = true;
  clearTimeout(lineTimer);
  clearLines();
  document.getElementById("slWinBar").className = "sl-winbar";
  document.getElementById("slWinText").innerText = "Good luck!";
  document.getElementById("slWinDetail").innerText = "";
  // Right away: the coins go, the reels start (the result comes in a moment)
  renderCoins(myCoins - bet);
  renderControls();
  document.querySelectorAll(".sl-reel").forEach((reel) => reel.classList.add("spinning"));
  socket.emit("spin", { bet: bet });
}

// The reels turn and stop on `grid` (one after the other); `time`: how long the first reel turns
function animateReels(grid, time, tease, sweatTime) {
  var reels = [...document.querySelectorAll(".sl-reel")];
  // The size of a symbol now (full screen or not)
  TILE = document.querySelector(".sl-cell").offsetHeight;
  // The sweat: 🎁 on reels 1 and 3 - the last reel turns longer, slower, lit up
  var sweat = sweatTime > 0 && hasTwoGifts(grid) ? sweatTime : 0;
  return Promise.all(
    reels.map((reel, i) => {
      var strip = setup.strips[i];
      var track = reel.querySelector(".sl-track");
      reel.classList.add("spinning");
      var count = Math.round((14 + i * 5) * Math.min(1, time / setup.rules.spinTime)) + 4 + (tease && i == 4 ? 10 : 0) + (sweat && i == 4 ? Math.round(sweat / 90) : 0);
      var ids = [];
      // The faces on top now, then random ones, then the result
      var now = [...track.children].map((c) => c.dataset.symbol);
      ids.push(...now);
      for (var n = 0; n < count; n++) ids.push(strip[Math.floor(Math.random() * strip.length)]);
      ids.push(...grid[i]);
      track.getAnimations().forEach((a) => a.cancel());
      track.replaceChildren(...ids.map(cell));
      track.style.transform = "translateY(0px)";
      var end = -(ids.length - 3) * TILE;
      var duration = time * (0.5 + i * 0.12) + (tease && i == 4 ? 700 : 0) + (sweat && i == 4 ? sweat : 0);
      var animation = track.animate(
        [
          { transform: "translateY(0px)", easing: "cubic-bezier(0.45, 0, 0.6, 1)" },
          { transform: `translateY(${end - TILE * 0.18}px)`, offset: 0.93, easing: "ease-out" },
          { transform: `translateY(${end}px)` },
        ],
        { duration: duration, fill: "forwards" },
      );
      return animation.finished.then(() => {
        reel.classList.remove("spinning");
        reel.classList.remove("sweat");
        // Two 🎁 in sight: they light up, the last reel sweats
        if (sweat && i == 2) {
          [0, 2].forEach((r) => reels[r].querySelectorAll(".sl-cell.scatter").forEach((c) => c.classList.add("hit")));
          reels[4].classList.add("sweat");
        }
        // Keep only the 3 symbols that are shown
        showGrid(i, grid[i]);
      });
    }),
  );
}

// One reel shows these 3 symbols (no animation)
function showGrid(reel, symbols) {
  var track = document.querySelectorAll(".sl-reel")[reel].querySelector(".sl-track");
  track.getAnimations().forEach((a) => a.cancel());
  track.replaceChildren(...symbols.map(cell));
  track.style.transform = "translateY(0px)";
}

// 🎁 in sight on reels 1 and 3 (the third would start the bonus)
function hasTwoGifts(grid) {
  return grid[0].includes("bonus") && grid[2].includes("bonus");
}

async function playSpin(result) {
  // Two wilds or the start of a big line on the first reels: the last reel takes longer
  var tease = result.grid.slice(0, 3).flat().filter((id) => id == "wild" || id == "diamond").length >= 2;
  await animateReels(result.grid, setup.rules.spinTime, tease, setup.rules.sweatTime);
  // Three 🎁: the bonus game first
  if (result.bonus) await playBonus(result);
  await showResult(result);
  spinning = false;
  // The win comes with the next "coins" from the server (after the count)
  renderCoins(myCoins);
  renderControls();
}

/* ---------- Bonus game: two wheels (free spins, multiplier), then the free spins ---------- */

// The fields of the two rings (every value at least once, the small ones more often)
var SPIN_FIELDS = [5, 8, 6, 10, 5, 6, 12, 5, 8, 6];
var MULTIPLIER_FIELDS = [1, 2, 1, 3, 1, 5, 2, 1, 3, 2];
var RING_COLORS = ["#2b2b2b", "#363636"];

function polar(r, angle) {
  var a = ((angle - 90) * Math.PI) / 180;
  return [50 + r * Math.cos(a), 50 + r * Math.sin(a)];
}

// A ring of fields (outer radius r1, inner r2) with a label in every field
function ringSvg(fields, r1, r2, label, gold) {
  var NS = "http://www.w3.org/2000/svg";
  var svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("class", "sl-ring-svg");
  var step = 360 / fields.length;
  fields.forEach((value, i) => {
    var [ax, ay] = polar(r1, i * step);
    var [bx, by] = polar(r1, (i + 1) * step);
    var [cx, cy] = polar(r2, (i + 1) * step);
    var [dx, dy] = polar(r2, i * step);
    var path = document.createElementNS(NS, "path");
    path.setAttribute("d", `M${ax} ${ay} A${r1} ${r1} 0 0 1 ${bx} ${by} L${cx} ${cy} A${r2} ${r2} 0 0 0 ${dx} ${dy} Z`);
    path.setAttribute("fill", gold(value) ? "#a8742a" : RING_COLORS[i % 2]);
    path.setAttribute("stroke", "#141414");
    path.setAttribute("stroke-width", "0.5");
    svg.appendChild(path);
    var [tx, ty] = polar((r1 + r2) / 2, (i + 0.5) * step);
    var text = document.createElementNS(NS, "text");
    text.setAttribute("x", tx);
    text.setAttribute("y", ty);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "central");
    text.setAttribute("transform", `rotate(${(i + 0.5) * step} ${tx} ${ty})`);
    text.setAttribute("class", "sl-ring-text");
    text.textContent = label(value);
    svg.appendChild(text);
  });
  return svg;
}

// Turns a ring so a field with `value` stops under the pointer (top) - only one way, slowing down
function spinRing(ring, fields, value, turns, direction, time) {
  var options = fields.map((v, i) => (v == value ? i : -1)).filter((i) => i >= 0);
  var field = options[Math.floor(Math.random() * options.length)];
  var step = 360 / fields.length;
  var inside = (0.25 + Math.random() * 0.5) * step;
  // Clockwise (1): the field at angle a comes to the top at -a; the other way at 360 - a
  var at = field * step + inside;
  var end = direction > 0 ? 360 * turns - at : -(360 * turns) + (360 - at);
  return ring.animate([{ transform: "rotate(0deg)" }, { transform: `rotate(${end}deg)` }], { duration: time, easing: "cubic-bezier(0.12, 0.6, 0.15, 1)", fill: "forwards" }).finished;
}

/*
 * The bonus game. Fresh: "you won free spins" waits for a click, then the
 * wheels decide how many and the multiplier. Back after a break (`from`:
 * free spins seen, `started`: clicked before): the start screen again, or
 * "welcome back" and on from there.
 */
async function playBonus(result, from, started) {
  var bonus = result.bonus;
  var stage = document.getElementById("slStage");
  var time = setup.rules.bonusTime;
  activeBonus = result.id;
  // The server keeps how far this page got (to go on there after a break)
  var progress = (shown) => result.id && socket.emit("bonusProgress", { id: result.id, shown: shown });
  var resumed = from != null;
  from = Math.max(0, from || 0);
  if (!resumed || !started) {
    await startScreen(result, stage);
    if (result.id) socket.emit("bonusStart", { id: result.id });
    await playWheels(result, stage, time);
  } else {
    // Back after a break: a moment to see where it goes on
    stage.hidden = false;
    stage.className = "sl-stage bonus";
    var at = Math.min(from + 1, bonus.freeSpins.length);
    stage.replaceChildren(el("div", "sl-stage-title", "BONUS GAME"), el("div", "sl-big-title", "WELCOME BACK"), el("div", "sl-stage-sub won", "Free spin " + at + " of " + (from > 0 ? bonus.freeSpins[from - 1].spins : bonus.startSpins) + " · start × " + bonus.multiplier));
    await wait(setup.rules.resumeTime);
    stage.hidden = true;
    stage.replaceChildren();
  }
  progress(from);
  await playFreeSpins(result, from, progress);
  activeBonus = null;
}

// "You won free spins": waits for the player's click (or Enter / space) - then the wheels
function startScreen(result, stage) {
  return new Promise((resolve) => {
    // The 🎁 light up behind it
    document.querySelectorAll(".sl-cell.scatter").forEach((c) => c.classList.add("hit"));
    stage.hidden = false;
    stage.className = "sl-stage bonus start";
    var start = el("button", "sl-start-btn", "Spin the wheels");
    start.type = "button";
    stage.replaceChildren(
      el("div", "sl-stage-title", "🎁 🎁 🎁"),
      el("div", "sl-big-title", "YOU WON FREE SPINS"),
      el("div", "sl-stage-sub won", "The wheels decide how many - and your multiplier"),
      start,
    );
    coinShower(stage, 25);
    var go = () => {
      document.removeEventListener("keydown", onKey, true);
      stage.hidden = true;
      stage.replaceChildren();
      resolve();
    };
    var onKey = (event) => {
      if (event.key == "Enter" || event.code == "Space") {
        event.preventDefault();
        event.stopPropagation();
        go();
      }
    };
    start.addEventListener("click", go);
    document.addEventListener("keydown", onKey, true);
    start.focus();
  });
}

// 1. The two wheels: outer = free spins, inner = start multiplier (turning the other way)
async function playWheels(result, stage, time) {
  var bonus = result.bonus;
  // The 🎁 light up
  document.querySelectorAll(".sl-cell.scatter").forEach((c) => c.classList.add("hit"));
  await wait(Math.min(900, time * 0.15));

  // 1. The two wheels: outer = free spins, inner = start multiplier (turning the other way)
  stage.hidden = false;
  stage.className = "sl-stage bonus";
  var wheel = el("div", "sl-wheel");
  var outer = el("div", "sl-ring outer");
  outer.appendChild(ringSvg(SPIN_FIELDS, 49, 33, (v) => v, (v) => v >= 10));
  var inner = el("div", "sl-ring inner");
  inner.appendChild(ringSvg(MULTIPLIER_FIELDS, 49, 22, (v) => "×" + v, (v) => v >= 5));
  var hub = el("div", "sl-ring-hub", "🎁");
  wheel.append(el("div", "sl-wheel-pointer"), outer, inner, hub);
  var label = el("div", "sl-stage-sub", "Free spins and multiplier...");
  stage.replaceChildren(el("div", "sl-stage-title", "BONUS GAME"), wheel, label);
  var spinTime = time * 0.62;
  await Promise.all([
    spinRing(outer, SPIN_FIELDS, bonus.startSpins, 4, 1, spinTime),
    spinRing(inner, MULTIPLIER_FIELDS, bonus.multiplier, 3, -1, spinTime * 0.86).then(() => {
      label.innerText = "Start × " + bonus.multiplier + " ...";
    }),
  ]);
  label.innerText = bonus.startSpins + " free spins · start × " + bonus.multiplier;
  label.classList.add("won");
  await wait(time * 0.2);
  stage.hidden = true;
  stage.replaceChildren();
}

// 2. The free spins (from free spin `from` on): the multiplier climbs after every spin
async function playFreeSpins(result, from, progress) {
  var bonus = result.bonus;
  var stage = document.getElementById("slStage");
  var machine = document.querySelector(".sl-machine");
  machine.classList.add("bonus-mode");
  var bar = document.getElementById("slWinBar");
  var text = document.getElementById("slWinText");
  var detail = document.getElementById("slWinDetail");
  bar.className = "sl-winbar bonus";
  // What the free spins before paid (after a break)
  var total = bonus.freeSpins.slice(0, from).reduce((sum, free) => sum + free.win, 0);
  var spinTime = setup.rules.freeSpinTime;
  var counter = document.getElementById("slFreeCounter");
  var count = document.getElementById("slFreeCount");
  var spins = from > 0 ? bonus.freeSpins[from - 1].spins : bonus.startSpins;
  counter.hidden = false;
  detail.innerText = "Bonus win";
  for (var n = from; n < bonus.freeSpins.length; n++) {
    var free = bonus.freeSpins[n];
    clearLines();
    count.innerText = n + 1 + " / " + spins;
    text.innerText = "🪙 " + formatCoins(total);
    await animateReels(free.grid, spinTime * 0.5, false, setup.rules.sweatTime * 0.6);
    // Three 🎁 again: more free spins
    if (free.retrigger > 0) {
      document.querySelectorAll(".sl-cell.scatter").forEach((c) => c.classList.add("hit"));
      floatWin("+" + free.retrigger + " FREE SPINS");
      spins = free.spins;
      count.innerText = n + 1 + " / " + spins;
      counter.animate([{ transform: "scale(1)" }, { transform: "scale(1.25)" }, { transform: "scale(1)" }], { duration: 600, easing: "ease-out" });
      await wait(setup.rules.retriggerTime);
    }
    if (free.win > 0) {
      var reels = [...document.querySelectorAll(".sl-reel")];
      free.lines.forEach((line) => setup.lines[line.line].slice(0, line.count).forEach((row, reel) => reels[reel].querySelectorAll(".sl-cell")[row].classList.add("hit")));
      showLines(
        free.lines.map((l) => l.line),
        true,
      );
      floatWin("+🪙 " + formatCoins(free.win) + (free.multiplier > 1 ? "  (× " + free.multiplier + ")" : ""));
      countUp(text, total + free.win, spinTime * 0.3, total);
      total += free.win;
    }
    await wait(spinTime * (free.win > 0 ? 0.5 : 0.3));
    progress(n + 1);
  }
  if (result.capped) detail.innerText = "Max win reached!";
  counter.hidden = true;
  clearLines();
  machine.classList.remove("bonus-mode");

  // 3. What the free spins paid: counted up from 0, with a glow and falling coins (not given away below)
  text.innerText = "";
  detail.innerText = "";
  var end = setup.rules.bonusEndTime;
  stage.hidden = false;
  stage.className = "sl-stage big bonus-end" + (result.capped ? " epic" : "");
  var times = bonus.win / result.bet;
  var amount = el("div", "sl-big-amount sl-bonus-amount", "🪙 0");
  var sub = el("div", "sl-stage-sub sl-bonus-sub", bonus.freeSpins.length + " free spins");
  stage.replaceChildren(el("div", "sl-bonus-glow"), el("div", "sl-big-title", result.capped ? "MAX WIN" : "BONUS WIN"), amount, sub);
  coinShower(stage, Math.min(80, 15 + Math.round(times)));
  var counting = end * 0.55;
  countUp(amount, bonus.win, counting);
  await wait(counting);
  // Done counting: the amount pops, the details come
  amount.animate([{ transform: "scale(1)" }, { transform: "scale(1.18)" }, { transform: "scale(1)" }], { duration: 450, easing: "ease-out" });
  sub.classList.add("show");
  await wait(end - counting);
  stage.hidden = true;
  stage.replaceChildren();
  // Back to the spin that started it
  result.grid.forEach((symbols, reel) => showGrid(reel, symbols));
}

// "+ 🪙 120" rises over the reels
function floatWin(label) {
  var tag = el("div", "sl-float", label);
  document.querySelector(".sl-window").appendChild(tag);
  tag.animate(
    [
      { transform: "translate(-50%, 0) scale(0.8)", opacity: 0 },
      { transform: "translate(-50%, -18px) scale(1)", opacity: 1, offset: 0.25 },
      { transform: "translate(-50%, -46px) scale(1)", opacity: 0 },
    ],
    { duration: 1200, easing: "ease-out" },
  ).finished.then(() => tag.remove());
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ---------- Big wins ---------- */

function coinShower(root, count) {
  for (var i = 0; i < count; i++) {
    var coin = el("span", "sl-coin", "🪙");
    coin.style.left = Math.random() * 100 + "%";
    root.appendChild(coin);
    var drop = 160 + Math.random() * 200;
    // Falls: faster and faster (gravity), turning
    coin.animate(
      [
        { transform: "translateY(-30px) rotate(0deg)", opacity: 0 },
        { opacity: 1, offset: 0.05 },
        { transform: `translateY(${drop}px) rotate(${Math.random() * 720 - 360}deg)`, opacity: 0.9, offset: 0.85 },
        { transform: `translateY(${drop + 20}px) rotate(0deg)`, opacity: 0 },
      ],
      { duration: 1100 + Math.random() * 900, delay: Math.random() * 600, easing: "cubic-bezier(0.55, 0, 1, 0.45)", fill: "both" },
    ).finished.then(((c) => () => c.remove())(coin));
  }
}

// BIG / MEGA / EPIC: the win counted up big over the reels
async function bigWin(result) {
  var times = result.win / result.bet;
  var stage = document.getElementById("slStage");
  stage.hidden = false;
  stage.className = "sl-stage big" + (times >= 100 ? " epic" : times >= 50 ? " mega" : "");
  var amount = el("div", "sl-big-amount", "🪙 0");
  stage.replaceChildren(el("div", "sl-big-title", times >= 100 ? "EPIC WIN" : times >= 50 ? "MEGA WIN" : "BIG WIN"), amount, el("div", "sl-stage-sub", Math.round(times) + "× your bet"));
  coinShower(stage, times >= 50 ? 70 : 40);
  countUp(amount, result.win, setup.rules.bigTime * 0.7);
  await wait(setup.rules.bigTime);
  stage.hidden = true;
  stage.replaceChildren();
}

// The win: every winning line, the cells pulse; then line after line with its win
async function showResult(result) {
  var bar = document.getElementById("slWinBar");
  var text = document.getElementById("slWinText");
  var detail = document.getElementById("slWinDetail");
  if (result.win == 0) {
    bar.className = "sl-winbar";
    text.innerText = "No win";
    detail.innerText = "Try again!";
    return;
  }
  var big = result.win >= result.bet * setup.rules.bigWin;
  bar.className = "sl-winbar won" + (big ? " big" : "");
  text.innerText = "";
  // (after a bonus game its own win screen was shown already)
  if (big && !result.bonus) await bigWin(result);
  countUp(text, result.win, big ? 300 : Math.min(900, setup.rules.countTime));
  detail.innerText = result.bonus ? "Bonus game · " + result.bonus.freeSpins.length + " free spins" : result.lines.length == 1 ? "1 line" : result.lines.length + " lines";
  var reels = [...document.querySelectorAll(".sl-reel")];
  var hit = (line) =>
    setup.lines[line.line].slice(0, line.count).forEach((row, reel) => reels[reel].querySelectorAll(".sl-cell")[row].classList.add("hit"));
  result.lines.forEach(hit);
  showLines(
    result.lines.map((l) => l.line),
    true,
  );
  if (result.lines.length == 0 || result.bonus) return;
  // Then one line after the other, with what it paid
  if (result.lines.length > 1) {
    var index = 0;
    var next = () => {
      if (spinning) return;
      var line = result.lines[index % result.lines.length];
      document.querySelectorAll(".sl-cell.hit").forEach((cell) => cell.classList.remove("hit"));
      hit(line);
      showLines([line.line], true);
      detail.innerText = "Line " + (line.line + 1) + " · " + line.count + "× " + symbolOf(line.symbol).icon + " · 🪙 " + formatCoins(line.win);
      index++;
      lineTimer = setTimeout(next, 1300);
    };
    lineTimer = setTimeout(next, 1600);
  } else {
    var only = result.lines[0];
    detail.innerText = "Line " + (only.line + 1) + " · " + only.count + "× " + symbolOf(only.symbol).icon;
  }
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
  return Number(document.getElementById("slBet").value);
}

function setBet(value) {
  if (setup == null) return;
  var bet = Math.max(setup.rules.minBet, Math.min(setup.rules.maxBet, Math.round(value)));
  document.getElementById("slBet").value = bet;
  try {
    localStorage.setItem(BET_KEY, bet);
  } catch (error) {
    // not remembered
  }
  renderControls();
}

function renderPresets() {
  var box = document.getElementById("slPresets");
  box.replaceChildren(
    ...PRESETS.filter((value) => value >= setup.rules.minBet && value <= setup.rules.maxBet).map((value) => {
      var button = el("button", "sl-preset", value >= 1000 ? value / 1000 + "K" : String(value));
      button.type = "button";
      button.dataset.value = value;
      button.addEventListener("click", () => setBet(value));
      return button;
    }),
  );
}

function renderCoins(value) {
  document.getElementById("slCoins").innerText = "🪙 " + formatCoins(value);
}

function renderControls() {
  if (setup == null) return;
  var bet = currentBet();
  var button = document.getElementById("slSpin");
  button.disabled = spinning || bet > myCoins;
  button.classList.toggle("busy", spinning);
  button.title = bet > myCoins ? "Not enough coins" : "Spin (space)";
  document.querySelectorAll(".sl-preset").forEach((preset) => preset.classList.toggle("active", Number(preset.dataset.value) == bet));
  document.getElementById("slLess").disabled = spinning || bet <= setup.rules.minBet;
  document.getElementById("slMore").disabled = spinning || bet >= setup.rules.maxBet;
}

// Next / previous step of the bet (the presets, in between: tens)
function stepBet(direction) {
  var bet = currentBet();
  var values = PRESETS.filter((value) => value >= setup.rules.minBet && value <= setup.rules.maxBet);
  var next = direction > 0 ? values.find((value) => value > bet) : values.slice().reverse().find((value) => value < bet);
  setBet(next != null ? next : direction > 0 ? setup.rules.maxBet : setup.rules.minBet);
}

/* ---------- Last wins (everybody) ---------- */

function renderFeed(feed) {
  var list = document.getElementById("slFeed");
  document.getElementById("slFeedEmpty").hidden = feed.length > 0;
  if (setup == null) return setTimeout(() => renderFeed(feed), 200);
  list.replaceChildren(
    ...feed.map((entry) => {
      var symbol = symbolOf(entry.symbol);
      var multiple = entry.win / entry.bet;
      // A win from a bonus game: said so (with its free spins)
      var what = entry.bonus ? "🎁 Bonus · " + entry.bonus + " free spins" : entry.count + "× " + (symbol ? symbol.icon : "");
      var sub = what + " · bet 🪙 " + formatCoins(entry.bet) + " · " + (multiple >= 10 ? Math.round(multiple) : multiple.toFixed(1)) + "x";
      var item = historyItem(createAvatar(entry.name, "sm"), entry.name, sub, "🪙 " + formatCoins(entry.win));
      if (entry.bonus) item.classList.add("sl-feed-bonus");
      return item;
    }),
  );
}

/* ---------- Paytable ---------- */

function showPaytable() {
  var backdrop = el("div", "mm-dialog-backdrop");
  var dialog = el("div", "mm-dialog sl-paytable");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  var bet = currentBet();
  dialog.append(el("h2", "mm-dialog-title", "Paytable"), el("p", "mm-dialog-text", "Wins for a bet of 🪙 " + formatCoins(bet) + " per spin - 3, 4 or 5 in a row on a line, from the left. 👑 stands for every symbol."));
  var table = el("div", "sl-pays");
  table.append(el("span", "sl-pays-head", ""), el("span", "sl-pays-head", "3×"), el("span", "sl-pays-head", "4×"), el("span", "sl-pays-head", "5×"));
  setup.symbols
    .filter((symbol) => !symbol.scatter)
    .reverse()
    .forEach((symbol) => {
      var name = el("span", "sl-pays-symbol");
      name.append(el("span", "sl-pays-icon", symbol.icon), el("span", "", symbol.name));
      table.appendChild(name);
      symbol.pays.forEach((pay) => table.appendChild(el("span", "sl-pays-value", formatCoins(Math.floor((bet * pay) / setup.rules.lines)))));
    });
  // The 9 lines as little pictures
  var lines = el("div", "sl-line-maps");
  setup.lines.forEach((rows, line) => {
    var map = el("div", "sl-line-map");
    map.appendChild(el("span", "sl-line-map-number", line + 1));
    var grid = el("div", "sl-line-map-grid");
    for (var row = 0; row < 3; row++) for (var reel = 0; reel < 5; reel++) grid.appendChild(el("i", rows[reel] == row ? "on" : ""));
    map.appendChild(grid);
    lines.appendChild(map);
  });
  var close = el("button", "mm-btn w-100", "Close");
  close.type = "button";
  var bonus = el(
    "p",
    "sl-pays-bonus",
    "🎁 on reels 1, 3 and 5 at the same time start the bonus game. Two wheels decide your free spins (" +
      setup.bonus.spins.join(", ") +
      ") and the start multiplier (×" +
      setup.bonus.multipliers.join(", ×") +
      "). The multiplier grows by " +
      setup.bonus.step +
      " after every free spin. Three 🎁 in a free spin: " +
      setup.bonus.retrigger +
      " free spins more. A spin with its bonus pays at most " +
      setup.maxWin +
      "× the bet.",
  );
  dialog.append(table, el("h3", "sl-pays-title", "Bonus"), bonus, el("h3", "sl-pays-title", "The 9 lines"), lines, close);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  var done = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
  };
  var onKey = (event) => event.key == "Escape" && done();
  document.addEventListener("keydown", onKey);
  close.addEventListener("click", done);
  backdrop.addEventListener("click", (event) => event.target == backdrop && done());
  close.focus();
}

/* ---------- Setup ---------- */

document.addEventListener("DOMContentLoaded", () => {
  setupChat();
  document.getElementById("slSpin").addEventListener("click", spin);
  document.getElementById("slLess").addEventListener("click", () => stepBet(-1));
  document.getElementById("slMore").addEventListener("click", () => stepBet(1));
  document.getElementById("slBet").addEventListener("change", (event) => setBet(Number(event.target.value) || 0));
  document.getElementById("slPaytable").addEventListener("click", () => setup && showPaytable());
  // Space spins (not while typing)
  document.addEventListener("keydown", (event) => {
    if (event.code != "Space" || event.repeat) return;
    var tag = document.activeElement && document.activeElement.tagName;
    if (tag == "INPUT" || tag == "TEXTAREA" || tag == "BUTTON" || document.querySelector(".mm-dialog-backdrop")) return;
    event.preventDefault();
    spin();
  });
  // Full screen (casino_fullscreen.js): the symbols change their size
  document.addEventListener("fullscreenchange", () => {
    if (setup && !spinning) TILE = document.querySelector(".sl-cell").offsetHeight;
  });
  window.addEventListener("resize", () => {
    if (setup && !spinning) TILE = document.querySelector(".sl-cell").offsetHeight;
  });
});
