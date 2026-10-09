/* Hidden slots: the server rolls the reels and pays, this page only shows the spin. */
const socket = io((window.CASINO_NS || "") + "/slots");

var myName = null;
var myCoins = 0;
var myCapRule = null; // the max bet by balance ({floor, share} - null: no cap), see casinoCapLeft
// What more I may bet this round (`already`: my coins in it)
function capLeft(already) {
  return casinoCapLeft(myCapRule, myCoins, already);
}
var setup = null; // {symbols, lines, strips, rules}
var spinning = false;
var pausedUntil = 0; // after a spin: the next one only from then on (a short pause)
var spunAt = 0; // when the last spin started (the server wants a gap between two spins too)
var lineTimer = null;
var BET_KEY = "slotsBet";
// The bets to pick: from the lowest (left) to the highest (right) - made from the limits (presets())
var PRESET_COUNT = 6;
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
  if (error && error.message == "unauthorized") window.location.href = "/?next=" + encodeURIComponent(location.pathname + location.search);
});
// The admin took the access away
// The admin took the access away: the page again - it asks for access now
socket.on("casinoClosed", () => window.location.reload());
// The admin turned this game off: on to another one
socket.on("gameOff", () => (window.location.href = "./"));

window.addEventListener("pagehide", () => socket.disconnect());

// A phone puts the page away (other app, screen off) during a bonus game: the server holds it
// (as if the page was closed) - back on the page it goes on with "welcome back"
var awayInBonus = false;
document.addEventListener("visibilitychange", () => {
  if (document.hidden && activeBonus) {
    awayInBonus = true;
    socket.disconnect();
  } else if (!document.hidden && awayInBonus) {
    location.reload();
  }
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) socket.connect();
});

socket.on("joined", (data) => (myName = data.username));
socket.on("coins", (data) => {
  myCoins = data.coins;
  myCapRule = data.betCapRule || null;
  // While the reels turn, the balance shows the coins before the win
  // (during a spin the old balance stays - but a page that comes back into a bonus game needs one)
  if (!spinning || document.getElementById("slCoins").innerText == "-") renderCoins(myCoins);
  renderControls();
});
socket.on("slotsError", (message) => {
  clearTimeout(spinWatch);
  holding = false;
  if (autoOn()) stopAuto();
  showHint(message, "error", document.getElementById("slSpin"));
  spinning = false;
  renderControls();
});

socket.on("slotsSetup", (data) => {
  setup = data;
  buildMachine();
  renderPresets();
  setBet(Number(readBet()) || 100);
});

var reelsTurning = false; // the result came: the spin plays (no skip any more)
socket.on("slotsResult", (result) => {
  clearTimeout(spinWatch);
  reelsTurning = true;
  playSpin(result).finally(() => (reelsTurning = false));
});

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
  spunAt = Date.now();
  clearTimeout(lineTimer);
  clearLines();
  renderControls();
  result.grid.forEach((symbols, reel) => showGrid(reel, symbols));
  showCoins(result.coins, result.bet);
  if (result.coinGame) await playCoinGame(result, result.shown, result.started);
  else await playBonus(result, result.shown, result.started);
  await showResult(result);
  spinning = false;
  renderCoins(myCoins);
  renderControls();
}
socket.on("slotsFeed", renderFeed);

/* ---------- The machine ---------- */

function cell(id) {
  var symbol = symbolOf(id);
  var box = el("div", "sl-cell" + (symbol && symbol.wild ? " wild" : "") + (symbol && symbol.scatter ? " scatter" : "") + (symbol && symbol.coin ? " coin" : ""));
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
// (full screen zooms the machine: the screen positions back to its own size - the size of the SVG)
function linePoints(line) {
  var reels = [...document.querySelectorAll(".sl-reel")];
  var windowBox = document.querySelector(".sl-window");
  var window_ = windowBox.getBoundingClientRect();
  var zoom = windowBox.clientWidth ? window_.width / windowBox.clientWidth || 1 : 1;
  var tile = document.querySelector(".sl-cell") ? document.querySelector(".sl-cell").offsetHeight || TILE : TILE;
  return setup.lines[line]
    .map((row, reel) => {
      var box = reels[reel].getBoundingClientRect();
      var x = (box.left - window_.left + box.width / 2) / zoom;
      var y = (box.top - window_.top) / zoom + tile * row + tile / 2;
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

var queuedSpin = null; // a click in the short pause: the spin starts right after it

/*
 * Hold and auto: the spin button (or space) held down spins again and again until it is let go;
 * auto spins play a number of spins (or until stopped) - a bit slower, with a pause between them.
 * Holding stops at a bonus game; auto spins wait for it (its start and "continue" are clicks) and go on
 * afterwards. Both stop when the coins run out.
 */
var holding = false; // the button / space is held down
var autoLeft = 0; // auto spins still to play (0: off)
var AUTO_MAX = 100; // never more auto spins at once
var autoTimer = null;
var AUTO_GAP = 1100; // the extra pause between two auto spins

function autoOn() {
  return autoLeft > 0;
}

function startAuto(count) {
  if (!(count > 0)) return;
  autoLeft = Math.min(AUTO_MAX, Math.floor(count));
  document.getElementById("slAutoMenu").hidden = true;
  document.getElementById("slAuto").setAttribute("aria-expanded", "false");
  renderControls();
  if (!spinning) spin();
}

function stopAuto() {
  autoLeft = 0;
  clearTimeout(autoTimer);
  autoTimer = null;
  renderControls();
}

// A spin is over (shown): the next one when the button is held or auto spins run
function nextSpin(result) {
  // (a bonus game waited for the player - holding stops there; auto spins go on after its "continue", if any are left)
  if (result && (result.bonus || result.coinGame)) holding = false;
  if (holding) return spin();
  if (!autoOn()) return;
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    autoTimer = null;
    if (autoOn() && !spinning) spin();
  }, AUTO_GAP);
}

function spin() {
  if (spinning || setup == null) return;
  if (Date.now() < pausedUntil) {
    if (!queuedSpin) queuedSpin = setTimeout(() => ((queuedSpin = null), spin()), pausedUntil - Date.now() + 10);
    return;
  }
  var bet = currentBet();
  if (!Number.isInteger(bet) || bet < setup.rules.minBet || bet > setup.rules.maxBet) {
    return showHint("A spin is " + formatCoins(setup.rules.minBet) + " to " + formatCoins(setup.rules.maxBet) + " coins.", "error");
  }
  if (bet > myCoins) {
    holding = false;
    if (autoOn()) stopAuto();
    return showHint("You don't have enough coins.", "error");
  }
  spinning = true;
  // (an auto spin: one less to go)
  if (autoOn()) autoLeft--;
  clearTimeout(lineTimer);
  clearLines();
  document.getElementById("slWinBar").className = "sl-winbar";
  document.getElementById("slWinText").innerText = "Good luck!";
  document.getElementById("slWinDetail").innerText = "";
  // Right away: the coins go, the reels start (the result comes in a moment)
  renderCoins(myCoins - bet);
  renderControls();
  document.querySelectorAll(".sl-reel").forEach((reel) => reel.classList.add("spinning"));
  spunAt = Date.now();
  socket.emit("spin", { bet: bet });
  // No answer (the connection): the button works again after a while
  clearTimeout(spinWatch);
  spinWatch = setTimeout(skipSpin, 8000);
}

// The server didn't take the spin (too fast, another tab): as if nothing happened
var spinWatch = null;
function skipSpin() {
  clearTimeout(spinWatch);
  if (!spinning || reelsTurning) return;
  spinning = false;
  document.querySelectorAll(".sl-reel").forEach((reel) => reel.classList.remove("spinning"));
  document.getElementById("slWinText").innerText = "";
  renderCoins(myCoins);
  renderControls();
}
socket.on("slotsSkip", skipSpin);

// The reels turn and stop on `grid` (one after the other); `time`: how long the first reel turns
function animateReels(grid, time, sweatTime, stopped, strips, stops) {
  // (the free spins have their own strips: no 🪙)
  strips = strips || setup.strips;
  var reels = [...document.querySelectorAll(".sl-reel")];
  // The size of a symbol now (full screen or not)
  TILE = document.querySelector(".sl-cell").offsetHeight;
  // The sweat: 🎁 on reels 1 and 3, or the coin game still possible - the last reel(s) turn longer,
  // slower, they light up. `from`: the first reel that sweats (the coin sweat can start at reel 4)
  var coinReels = stops ? coinSweatReels(grid, stops) : 0;
  var kind = hasTwoGifts(grid) ? "gifts" : coinReels ? "coins" : null;
  var sweat = sweatTime > 0 && kind ? sweatTime : 0;
  var from = kind == "coins" ? 5 - coinReels : 4;
  // (the first sweating reel the sweat, every further one half of it more - the same as the server)
  var extra = (i) => (sweat && i >= from ? sweat * (1 + 0.5 * (i - from)) : 0);
  return Promise.all(
    reels.map((reel, i) => {
      var strip = strips[i];
      var track = reel.querySelector(".sl-track");
      reel.classList.add("spinning");
      // Not too many symbols: the reels turn at a speed the eye can follow
      var count = Math.round((8 + i * 3) * Math.min(1, time / setup.rules.spinTime)) + 3 + Math.round(extra(i) / 140);
      // The symbols fall from the top: the result on top, random ones, the faces now at the bottom -
      // the track starts at the bottom (what is shown now) and slides down to the result
      var ids = grid[i].slice();
      for (var n = 0; n < count; n++) ids.push(strip[Math.floor(Math.random() * strip.length)]);
      ids.push(...[...track.children].map((c) => c.dataset.symbol));
      track.getAnimations().forEach((a) => a.cancel());
      track.replaceChildren(...ids.map(cell));
      var start = -(ids.length - 3) * TILE;
      track.style.transform = `translateY(${start}px)`;
      var duration = time * (0.5 + i * 0.12) + extra(i);
      // (a little too far down at the end, then back: the reel settles)
      var animation = track.animate(
        [
          { transform: `translateY(${start}px)`, easing: "cubic-bezier(0.45, 0, 0.6, 1)" },
          { transform: `translateY(${TILE * 0.18}px)`, offset: 0.93, easing: "ease-out" },
          { transform: "translateY(0px)" },
        ],
        { duration: duration, fill: "forwards" },
      );
      return animation.finished.then(() => {
        reel.classList.remove("spinning");
        reel.classList.remove("sweat");
        // Keep only the 3 symbols that are shown
        showGrid(i, grid[i]);
        if (stopped) stopped(i);
        // Two 🎁 in sight (after reel 3) - or enough 🪙: they light up, the reels still turning sweat
        var light = kind == "gifts" ? ".sl-cell.scatter" : ".sl-cell.coin";
        if (sweat && i == (kind == "gifts" ? 2 : from - 1)) {
          reels.slice(0, i + 1).forEach((r) => r.querySelectorAll(light).forEach((c) => c.classList.add("hit")));
          reels.slice(from).forEach((r) => r.classList.add("sweat"));
        }
        // A coin on a sweating reel lights up too
        if (sweat && kind == "coins" && i >= from && i < 4) reel.querySelectorAll(light).forEach((c) => c.classList.add("hit"));
        // The sweat is over without the bonus: they stop glowing
        var made = kind == "gifts" ? grid[4].includes("bonus") : grid.flat().filter((id) => id == "coin").length >= setup.coins.trigger;
        if (sweat && i == 4 && !made) document.querySelectorAll(light + ".hit").forEach((c) => c.classList.remove("hit"));
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

// The coin game still possible (the same rule as the server, slots.coinSweat / coinSweatReels):
// 4 🪙 on the first four reels - or 3 (one on reel 4) in 2 of 5 spins (by the stops).
// How many reels sweat: from the reel after the one where 3 🪙 are in sight
function coinSweatReels(grid, stops) {
  var trigger = setup.coins.trigger;
  var coins = grid.slice(0, 4).flat().filter((id) => id == "coin").length;
  var sweat = coins == trigger - 1 || (coins == trigger - 2 && grid[3].includes("coin") && stops.reduce((sum, stop) => sum + stop, 0) % 5 < 2);
  if (!sweat) return 0;
  for (var reel = 2; reel <= 4; reel++) {
    if (grid.slice(0, reel).flat().filter((id) => id == "coin").length >= trigger - 2) return 5 - reel;
  }
  return 1;
}

async function playSpin(result) {
  // (only two 🎁 make the last reel turn longer - the sweat); a 🪙 shows its value when its reel stops
  var coins = result.coins || [];
  var shown = (reel) =>
    showCoins(
      coins.filter((c) => c.reel == reel),
      result.bet,
    );
  await animateReels(result.grid, setup.rules.spinTime, setup.rules.sweatTime, shown, null, result.stops);
  // The lines of this spin won something too: they count first (lit, counted up) - then the bonus game
  if ((result.bonus || result.coinGame) && result.lineWin > 0) await showLineWinFirst(result);
  // Three 🎁: the bonus game first - five 🪙: the coin game
  if (result.bonus) await playBonus(result);
  if (result.coinGame) await playCoinGame(result);
  await showResult(result);
  spinning = false;
  // A short pause before the next spin (at least the gap the server wants from the start of this one)
  var pause = Math.max(setup.rules.pauseTime || 0, spunAt + (setup.rules.minGap || 0) + 100 - Date.now());
  pausedUntil = Date.now() + pause;
  // The win comes with the next "coins" from the server (after the count)
  renderCoins(myCoins);
  renderControls();
  nextSpin(result);
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
  bonusDone(result);
  activeBonus = null;
}

// The bonus game was seen to its end (the player went on): the win is paid right away (countTime)
function bonusDone(result) {
  if (result.id) socket.emit("bonusDone", { id: result.id });
}

// "You won free spins" (or the coin game): waits for the player's click (or Enter / space) - then it starts
function startScreen(result, stage, texts) {
  texts = texts || { icons: "🎁 🎁 🎁", title: "YOU WON FREE SPINS", sub: "The wheels decide how many - and your multiplier", button: "Spin the wheels", light: ".sl-cell.scatter" };
  return new Promise((resolve) => {
    // The 🎁 (or the 🪙) light up behind it
    document.querySelectorAll(texts.light).forEach((c) => c.classList.add("hit"));
    stage.hidden = false;
    stage.className = "sl-stage bonus start" + (texts.coins ? " coin-start" : "");
    var start = el("button", "sl-start-btn", texts.button);
    start.type = "button";
    stage.replaceChildren(el("div", "sl-stage-title", texts.icons), el("div", "sl-big-title", texts.title), el("div", "sl-stage-sub won", texts.sub), start);
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
  var multCounter = document.getElementById("slMultCounter");
  var mult = document.getElementById("slMultCount");
  counter.hidden = false;
  multCounter.hidden = false;
  detail.innerText = "Bonus win";
  for (var n = from; n < bonus.freeSpins.length; n++) {
    var free = bonus.freeSpins[n];
    clearLines();
    count.innerText = n + 1 + " / " + spins;
    // The multiplier of this spin (it climbs after every spin)
    if (mult.innerText != "× " + free.multiplier) {
      mult.innerText = "× " + free.multiplier;
      if (n > from) mult.animate([{ transform: "scale(1)" }, { transform: "scale(1.3)" }, { transform: "scale(1)" }], { duration: 450, easing: "ease-out" });
    }
    text.innerText = "🪙 " + formatCoins(total);
    await animateReels(free.grid, spinTime * 0.55, setup.rules.sweatTime * 0.6, null, setup.freeStrips);
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
    await wait(spinTime * (free.win > 0 ? 0.45 : 0.3));
    progress(n + 1);
  }
  if (result.capped) detail.innerText = "Max win reached!";
  counter.hidden = true;
  multCounter.hidden = true;
  mult.innerText = "";
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
  // Stays until the player goes on
  await continueButton(stage);
  stage.hidden = true;
  stage.replaceChildren();
  // Back to the spin that started it
  result.grid.forEach((symbols, reel) => showGrid(reel, symbols));
}

/* ---------- Coin game: the coins stay, the empty spots spin again ---------- */

// A treasure chest, drawn (closed - or open, full of gold). No gradients: many of them can be on the page
var CHEST_BODY =
  '<path d="M7 31h50v21a4 4 0 0 1-4 4H11a4 4 0 0 1-4-4z" fill="#8a4b1f"/>' +
  '<path d="M7 39h50M7 47h50" stroke="#5b2e10" stroke-width="1.6"/>' +
  '<path d="M7 31h50v4H7z" fill="#5b2e10" opacity=".55"/>' +
  '<path d="M13 31h6v25h-6zM45 31h6v25h-6z" fill="#e9b949"/>' +
  '<path d="M13 31h2v25h-2zM45 31h2v25h-2z" fill="#fff3c4" opacity=".55"/>' +
  '<path d="M7 31h50v21a4 4 0 0 1-4 4H11a4 4 0 0 1-4-4z" fill="none" stroke="#3a1a07" stroke-width="2.2" stroke-linejoin="round"/>';
var CHEST_CLOSED =
  '<svg viewBox="0 0 64 64" aria-hidden="true">' +
  '<path d="M7 31V21C7 11 18 7 32 7s25 4 25 14v10z" fill="#a85a26"/>' +
  '<path d="M11 18c3-6 11-8 21-8s16 2 19 6" stroke="#d98a4a" stroke-width="2" fill="none" stroke-linecap="round" opacity=".7"/>' +
  '<path d="M13 31V13.5c1.8-1.3 4-2.3 6-2.9V31zM45 31V10.6c2.2.6 4.2 1.6 6 2.9V31z" fill="#e9b949"/>' +
  '<path d="M7 31V21C7 11 18 7 32 7s25 4 25 14v10z" fill="none" stroke="#3a1a07" stroke-width="2.2" stroke-linejoin="round"/>' +
  CHEST_BODY +
  '<path d="M5 28h54v6H5z" fill="#e9b949" stroke="#3a1a07" stroke-width="2" stroke-linejoin="round"/>' +
  '<rect x="26" y="26" width="12" height="14" rx="2.5" fill="#f4cd5c" stroke="#3a1a07" stroke-width="2"/>' +
  '<circle cx="32" cy="31.5" r="2.2" fill="#3a1a07"/><path d="M31 32.5h2l.6 4h-3.2z" fill="#3a1a07"/>' +
  "</svg>";
var CHEST_OPEN =
  '<svg viewBox="0 0 64 64" aria-hidden="true">' +
  '<path d="M9 27 13 5h38l4 22z" fill="#6e3814" stroke="#3a1a07" stroke-width="2.2" stroke-linejoin="round"/>' +
  '<path d="M13 9h38" stroke="#e9b949" stroke-width="3"/>' +
  '<ellipse cx="32" cy="30" rx="24" ry="7" fill="#ffd75e"/>' +
  '<circle cx="20" cy="26" r="4.5" fill="#ffe28a" stroke="#c98f1d" stroke-width="1.4"/><circle cx="31" cy="23" r="5" fill="#ffe28a" stroke="#c98f1d" stroke-width="1.4"/>' +
  '<circle cx="43" cy="26" r="4.5" fill="#ffe28a" stroke="#c98f1d" stroke-width="1.4"/><circle cx="37" cy="28" r="3.6" fill="#ffd040" stroke="#c98f1d" stroke-width="1.2"/>' +
  '<path d="M48 17l1.2 2.8 2.8 1.2-2.8 1.2L48 25l-1.2-2.8-2.8-1.2 2.8-1.2zM15 15l.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9z" fill="#fff8d6"/>' +
  CHEST_BODY +
  '<rect x="26" y="31" width="12" height="9" rx="2" fill="#f4cd5c" stroke="#3a1a07" stroke-width="2"/>' +
  "</svg>";

function chestIcon(open) {
  var icon = el("span", "sl-chest-svg");
  icon.innerHTML = open ? CHEST_OPEN : CHEST_CLOSED;
  return icon;
}

// A coin's value for this bet: coins (short) or the prize
function coinLabel(coin, bet) {
  if (coin.prize) return coin.prize.toUpperCase();
  if (coin.chest) return "CHEST";
  var value = Math.floor(coin.x * bet);
  return value >= 10000 ? (value / 1000).toFixed(value >= 100000 ? 0 : 1).replace(/\.0$/, "") + "K" : formatCoins(value);
}

// A 🪙 cell with its value
function coinCell(coin, bet) {
  var box = cell("coin");
  box.classList.add("valued");
  // A treasure chest (closed: 🧰 - opened: the prize it gave)
  if (coin.chest) {
    box.classList.add("chest");
    box.querySelector(".sl-symbol").replaceChildren(chestIcon(!!coin.prize));
  }
  if (coin.prize) box.classList.add("prize", "prize-" + coin.prize);
  box.appendChild(el("span", "sl-coin-value", coinLabel(coin, bet)));
  return box;
}

function cellsOf(reel) {
  return document.querySelectorAll(".sl-reel")[reel].querySelectorAll(".sl-track > .sl-cell");
}

// The 🪙 in sight get their values
function showCoins(coins, bet) {
  (coins || []).forEach((coin) => {
    var old = cellsOf(coin.reel)[coin.row];
    if (old && old.dataset.symbol == "coin") old.replaceWith(coinCell(coin, bet));
  });
}

// The prizes over the machine (for this bet)
function showPrizes(bet) {
  var bar = document.getElementById("slPrizes");
  bar.hidden = false;
  var c = setup.coins;
  bar.replaceChildren(
    ...c.prizes.concat([{ prize: "ultra", x: c.ultra }]).map((p) => {
      var pill = el("div", "sl-prize prize-" + p.prize);
      pill.dataset.prize = p.prize;
      pill.append(el("span", "sl-prize-name", p.prize.toUpperCase()), el("span", "sl-prize-value", "🪙 " + formatCoins(Math.floor(bet * p.x))));
      return pill;
    }),
  );
}

// The respins left as three dots
function showRespins(left, reset) {
  var count = document.getElementById("slFreeCount");
  count.replaceChildren(...[0, 1, 2].map((i) => el("i", "sl-respin-dot" + (i < left ? " on" : ""))));
  if (reset) count.animate([{ transform: "scale(1)" }, { transform: "scale(1.3)" }, { transform: "scale(1)" }], { duration: 500, easing: "ease-out" });
}

/*
 * The coin game. Fresh: "you won the coin game" waits for a click, the coins
 * lock in, then the respins. Back after a break (`from`: respins seen,
 * `started`: clicked before): the start screen again, or on from there.
 */
async function playCoinGame(result, from, started) {
  var game = result.coinGame;
  var bet = result.bet;
  var stage = document.getElementById("slStage");
  var machine = document.querySelector(".sl-machine");
  activeBonus = result.id;
  var progress = (shown) => result.id && socket.emit("bonusProgress", { id: result.id, shown: shown });
  var resumed = from != null;
  from = Math.max(0, from || 0);
  var fresh = !resumed || !started;
  if (fresh) {
    await startScreen(result, stage, { icons: "🪙 🪙 🪙 🪙 🪙", title: "COIN GAME", sub: "The coins stay · " + setup.coins.respins + " respins · every new coin resets them", button: "Start", light: ".sl-cell.coin", coins: true });
    if (result.id) socket.emit("bonusStart", { id: result.id });
  } else {
    stage.hidden = false;
    stage.className = "sl-stage bonus";
    stage.replaceChildren(el("div", "sl-stage-title", "COIN GAME"), el("div", "sl-big-title", "WELCOME BACK"), el("div", "sl-stage-sub won", "Respin " + Math.min(from + 1, game.respins.length) + " · " + (game.start.length + game.respins.slice(0, from).reduce((n, r) => n + r.coins.length, 0)) + " coins"));
    await wait(setup.rules.resumeTime);
    stage.hidden = true;
    stage.replaceChildren();
  }
  progress(from);

  // The board: the coins so far, every other spot empty
  clearLines();
  machine.classList.add("bonus-mode", "coin-mode");
  showPrizes(bet);
  var held = new Map(); // reel * 3 + row -> coin
  game.start.concat(...game.respins.slice(0, from).map((r) => r.coins)).forEach((coin) => held.set(coin.reel * 3 + coin.row, coin));
  document.querySelectorAll(".sl-reel").forEach((reel, i) => {
    var track = reel.querySelector(".sl-track");
    track.getAnimations().forEach((a) => a.cancel());
    track.style.transform = "translateY(0px)";
    track.replaceChildren(
      ...[0, 1, 2].map((row) => {
        var coin = held.get(i * 3 + row);
        if (!coin) return el("div", "sl-cell empty");
        var box = coinCell(coin, bet);
        box.classList.add("held");
        return box;
      }),
    );
  });
  var bar = document.getElementById("slWinBar");
  var text = document.getElementById("slWinText");
  var detail = document.getElementById("slWinDetail");
  var counter = document.getElementById("slFreeCounter");
  bar.className = "sl-winbar bonus";
  counter.querySelector(".sl-label").innerText = "Respins";
  counter.hidden = false;
  var sum = () => Math.floor([...held.values()].reduce((s, c) => s + c.x, 0) * bet);
  text.innerText = "🪙 " + formatCoins(sum());
  detail.innerText = held.size + " coins";
  showRespins(from > 0 ? game.respins[from - 1].left : setup.coins.respins);
  // The coins lock in, one after the other
  if (fresh) {
    var locks = [...document.querySelectorAll(".sl-cell.held")];
    // (one after the other, not too fast: every coin is seen)
    var gap = Math.min(220, (setup.rules.coinIntroTime * 0.9 - 700) / Math.max(1, locks.length));
    locks.forEach((box, n) => box.animate([{ transform: "scale(1)" }, { transform: "scale(1.18)", filter: "brightness(1.6)" }, { transform: "scale(1)" }], { duration: 600, delay: n * gap, easing: "ease-out" }));
    await wait(Math.min(setup.rules.coinIntroTime * 0.9, 700 + locks.length * gap));
  }
  // A 🧰 among the coins: the player picks a box
  var openAll = async (coins) => {
    for (var coin of coins) {
      if (!coin.chest || coin.prize) continue;
      await pickChest(result, coin);
      // The coin shows its prize now
      var old = cellsOf(coin.reel)[coin.row];
      var box = coinCell(coin, bet);
      box.classList.add("held");
      if (old) old.replaceWith(box);
      box.animate([{ transform: "scale(0.6)", filter: "brightness(2)" }, { transform: "scale(1.2)" }, { transform: "scale(1)" }], { duration: 700, easing: "ease-out" });
      flashPrize(coin.prize);
      text.innerText = "🪙 " + formatCoins(sum());
    }
  };
  await openAll([...held.values()]);

  var time = setup.rules.respinTime;
  for (var n = from; n < game.respins.length; n++) {
    var respin = game.respins[n];
    var landed = new Map(respin.coins.map((coin) => [coin.reel * 3 + coin.row, coin]));
    // Every empty spot spins on its own (a little reel), reel after reel they stop
    var spins = [];
    document.querySelectorAll(".sl-reel").forEach((reel, i) => {
      reel.querySelectorAll(".sl-track > .sl-cell").forEach((box, row) => {
        if (held.has(i * 3 + row)) return;
        var coin = landed.get(i * 3 + row);
        spins.push(miniSpin(box, coin ? coinCell(coin, bet) : null, time * (0.4 + i * 0.08)));
      });
    });
    await Promise.all(spins);
    landed.forEach((coin, spot) => held.set(spot, coin));
    if (landed.size) {
      floatWin("+" + landed.size + (landed.size == 1 ? " COIN" : " COINS"));
      text.innerText = "🪙 " + formatCoins(sum());
      detail.innerText = held.size + " coins";
      // A prize coin: its pill over the machine lights up
      landed.forEach((coin) => coin.prize && flashPrize(coin.prize));
    }
    showRespins(respin.left, landed.size > 0);
    progress(n + 1);
    await wait(time * 0.25);
    await openAll([...landed.values()]);
  }
  counter.hidden = true;
  counter.querySelector(".sl-label").innerText = "Free spins";
  document.getElementById("slFreeCount").replaceChildren();

  // All 15 spots: ULTRA
  if (game.ultra) await ultraShow(result);

  // What the coin game paid: counted up, the prizes listed
  text.innerText = "";
  detail.innerText = "";
  var end = setup.rules.bonusEndTime;
  stage.hidden = false;
  stage.className = "sl-stage big bonus-end coin-end" + (game.ultra ? " epic" : "");
  var amount = el("div", "sl-big-amount sl-bonus-amount", "🪙 0");
  var prizes = game.coins.filter((c) => c.prize).map((c) => c.prize.toUpperCase());
  var sub = el("div", "sl-stage-sub sl-bonus-sub", game.coins.length + " coins" + (prizes.length ? " · " + prizes.join(" · ") : "") + (game.ultra ? " · ULTRA" : ""));
  stage.replaceChildren(el("div", "sl-bonus-glow"), el("div", "sl-big-title", game.ultra ? "ULTRA WIN" : "COIN WIN"), amount, sub);
  coinShower(stage, Math.min(80, 15 + Math.round(game.win / bet)));
  var counting = end * 0.55;
  countUp(amount, game.win, counting);
  await wait(counting);
  amount.animate([{ transform: "scale(1)" }, { transform: "scale(1.18)" }, { transform: "scale(1)" }], { duration: 450, easing: "ease-out" });
  sub.classList.add("show");
  await wait(end - counting);
  // Stays until the player goes on
  await continueButton(stage);
  stage.hidden = true;
  stage.replaceChildren();
  machine.classList.remove("bonus-mode", "coin-mode");
  showPrizes(currentBet());
  // Back to the spin that started it
  result.grid.forEach((symbols, reel) => showGrid(reel, symbols));
  showCoins(result.coins, bet);
  bonusDone(result);
  activeBonus = null;
}

/*
 * A 🧰 landed: three closed chests - MINI, MAJOR and MEGA are behind them,
 * shuffled on the server. The player picks one, the server opens it (and
 * shows what the others had). Every copy of the coin gets the prize.
 */
var chestAnswers = new Map(); // "reel|row" -> the answer of the server
socket.on("chestOpened", (data) => {
  var waiting = chestAnswers.get(data.reel + "|" + data.row);
  if (typeof waiting == "function") waiting(data);
  else chestAnswers.set(data.reel + "|" + data.row, data);
});

function applyChest(result, data) {
  var game = result.coinGame;
  [result.coins || [], game.start, game.coins, ...game.respins.map((r) => r.coins)].forEach((list) =>
    list.forEach((coin) => {
      if (coin.reel == data.reel && coin.row == data.row && coin.chest) Object.assign(coin, { x: setup.coins.prizes.find((p) => p.prize == data.prize).x, prize: data.prize });
    }),
  );
  game.x = data.x;
  game.win = data.gameWin;
  result.win = data.win;
}

function pickChest(result, coin) {
  var stage = document.getElementById("slStage");
  if (result.id) socket.emit("chestShow", { id: result.id });
  return new Promise((resolve) => {
    stage.hidden = false;
    stage.className = "sl-stage bonus chest-stage";
    var row = el("div", "sl-chests");
    var boxes = [0, 1, 2].map((i) => {
      var box = el("button", "sl-chest");
      box.type = "button";
      box.setAttribute("aria-label", "Chest " + (i + 1));
      var icon = el("span", "sl-chest-icon");
      icon.appendChild(chestIcon(false));
      box.append(icon, el("span", "sl-chest-prize", "?"));
      box.addEventListener("click", () => choose(i));
      return box;
    });
    row.append(...boxes);
    // (empty until the pick: then the prize)
    var sub = el("div", "sl-stage-sub", "");
    stage.replaceChildren(el("div", "sl-bonus-glow"), el("div", "sl-stage-title", "TREASURE CHEST"), el("div", "sl-big-title", "PICK A CHEST"), row, sub);
    boxes[0].focus();
    var chosen = false;
    var key = coin.reel + "|" + coin.row;
    async function choose(pick) {
      if (chosen) return;
      chosen = true;
      boxes.forEach((box, i) => {
        box.disabled = true;
        box.classList.toggle("picked", i == pick);
      });
      boxes[pick].animate([{ transform: "rotate(0)" }, { transform: "rotate(-8deg)" }, { transform: "rotate(8deg)" }, { transform: "rotate(-5deg)" }, { transform: "rotate(0)" }], { duration: 650, iterations: 2 });
      socket.emit("chestPick", { id: result.id, reel: coin.reel, row: coin.row, pick: pick });
      // The answer (it may have come already) - or, without one, go on (the server picks at the payout)
      var data = chestAnswers.get(key);
      if (!data) data = await Promise.race([new Promise((done) => chestAnswers.set(key, done)), wait(8000).then(() => null)]);
      chestAnswers.delete(key);
      await wait(700);
      if (data) {
        applyChest(result, data);
        // The picked chest first, then what the others had
        var show = (i) => {
          var box = boxes[i];
          box.classList.add("open", "prize-" + data.boxes[i]);
          box.querySelector(".sl-chest-prize").innerText = data.boxes[i].toUpperCase();
          box.querySelector(".sl-chest-icon").replaceChildren(chestIcon(true));
        };
        show(pick);
        var prize = setup.coins.prizes.find((p) => p.prize == data.prize);
        sub.className = "sl-stage-sub won";
        sub.innerText = data.prize.toUpperCase() + " · 🪙 " + formatCoins(Math.floor(result.bet * prize.x));
        coinShower(stage, data.prize == "mega" ? 60 : data.prize == "major" ? 35 : 20);
        await wait(1100);
        boxes.forEach((_, i) => i != pick && show(i));
        await wait(1500);
      }
      stage.hidden = true;
      stage.replaceChildren();
      resolve(data);
    }
  });
}

// An empty spot spins: blanks and coins roll by, it stops on `result` (a coin cell) or stays empty
function miniSpin(box, result, time) {
  // (falls from the top: the result first, the track slides down to it)
  var strip = el("div", "sl-mini-track");
  var faces = 6 + Math.floor(Math.random() * 3);
  strip.appendChild(el("div", "sl-mini-face", result ? "🪙" : ""));
  // (the last one is empty - what the spot shows now)
  for (var i = 0; i < faces; i++) strip.appendChild(el("div", "sl-mini-face", i < faces - 1 && Math.random() < 0.4 ? "🪙" : ""));
  box.replaceChildren(strip);
  box.classList.add("rolling");
  return strip
    .animate([{ transform: "translateY(" + -faces * 100 + "%)" }, { transform: "translateY(0)" }], { duration: time, easing: "cubic-bezier(0.3, 0.1, 0.25, 1)", fill: "forwards" })
    .finished.then(() => {
      box.classList.remove("rolling");
      if (!result) return box.replaceChildren();
      result.classList.add("held");
      box.replaceWith(result);
      result.animate([{ transform: "scale(0.6)", filter: "brightness(2)" }, { transform: "scale(1.15)" }, { transform: "scale(1)" }], { duration: 650, easing: "ease-out" });
    });
}

function flashPrize(prize) {
  var pill = document.querySelector('.sl-prize[data-prize="' + prize + '"]');
  if (pill) pill.animate([{ transform: "scale(1)" }, { transform: "scale(1.25)", filter: "brightness(1.5)" }, { transform: "scale(1)" }], { duration: 700, easing: "ease-out" });
}

// All 15 spots are coins: the ULTRA show over the whole machine
async function ultraShow(result) {
  var stage = document.getElementById("slStage");
  var main = document.querySelector(".sl-main");
  main.classList.add("ultra");
  flashPrize("ultra");
  stage.hidden = false;
  stage.className = "sl-stage big ultra-show";
  var amount = el("div", "sl-big-amount", "🪙 0");
  stage.replaceChildren(el("div", "sl-bonus-glow"), el("div", "sl-stage-title", "ALL 15 SPOTS"), el("div", "sl-big-title sl-ultra-title", "ULTRA"), amount);
  coinShower(stage, 90);
  countUp(amount, result.bet * setup.coins.ultra, setup.rules.ultraTime * 0.6);
  await wait(setup.rules.ultraTime * 0.95);
  main.classList.remove("ultra");
  stage.hidden = true;
  stage.replaceChildren();
}

// A win screen stays until the player clicks on (or Enter / space)
// "Click to continue": a click anywhere on the screen of the win (or Enter / space) goes on
function continueButton(stage) {
  return new Promise((resolve) => {
    var button = el("div", "sl-continue-hint", "Click to continue");
    stage.appendChild(button);
    stage.classList.add("waiting-click");
    var done = () => {
      document.removeEventListener("keydown", onKey, true);
      stage.removeEventListener("click", done);
      stage.classList.remove("waiting-click");
      resolve();
    };
    var onKey = (event) => {
      if (event.key == "Enter" || event.code == "Space") {
        event.preventDefault();
        event.stopPropagation();
        done();
      }
    };
    stage.addEventListener("click", done);
    document.addEventListener("keydown", onKey, true);
  });
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
  await continueButton(stage);
  stage.hidden = true;
  stage.replaceChildren();
}

// Before a bonus game: what the lines of the spin itself won (it is paid with the rest)
async function showLineWinFirst(result) {
  var bar = document.getElementById("slWinBar");
  var text = document.getElementById("slWinText");
  var detail = document.getElementById("slWinDetail");
  bar.className = "sl-winbar won";
  var reels = [...document.querySelectorAll(".sl-reel")];
  result.lines.forEach((line) => setup.lines[line.line].slice(0, line.count).forEach((row, reel) => reels[reel].querySelectorAll(".sl-cell")[row].classList.add("hit")));
  showLines(
    result.lines.map((l) => l.line),
    true,
  );
  detail.innerText = (result.lines.length == 1 ? "1 line" : result.lines.length + " lines") + " · bonus next";
  countUp(text, result.lineWin, Math.min(900, setup.rules.countTime));
  await wait(1500);
  clearLines();
  document.querySelectorAll(".sl-cell.hit").forEach((c) => c.classList.remove("hit"));
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
  if (big && !result.bonus && !result.coinGame) await bigWin(result);
  // (the balance comes from the server meanwhile - setup.rules.countTime after the reels)
  var counting = big ? 300 : Math.min(900, setup.rules.countTime);
  countUp(text, result.win, counting);
  detail.innerText = result.bonus ? "Bonus game · " + result.bonus.freeSpins.length + " free spins" : result.coinGame ? "Coin game · " + result.coinGame.coins.length + " coins" + (result.coinGame.ultra ? " · ULTRA" : "") : result.lines.length == 1 ? "1 line" : result.lines.length + " lines";
  var reels = [...document.querySelectorAll(".sl-reel")];
  var hit = (line) =>
    setup.lines[line.line].slice(0, line.count).forEach((row, reel) => reels[reel].querySelectorAll(".sl-cell")[row].classList.add("hit"));
  result.lines.forEach(hit);
  showLines(
    result.lines.map((l) => l.line),
    true,
  );
  // The next spin only when the win is counted up (and seen a moment)
  await wait(counting + 350);
  if (result.lines.length == 0 || result.bonus || result.coinGame) return;
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
    lineTimer = setTimeout(next, 400);
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
  // (never more than the max bet by balance)
  var bet = Math.max(setup.rules.minBet, Math.min(maxNow(), Math.round(value)));
  document.getElementById("slBet").value = bet;
  // The prizes of the coin game for this bet (over the machine, always)
  if (!activeBonus) showPrizes(bet);
  try {
    localStorage.setItem(BET_KEY, bet);
  } catch (error) {
    // not remembered
  }
  renderControls();
}

// The highest bet now: the max bet per spin - or less, the max bet by balance
function maxNow() {
  return Math.max(setup.rules.minBet, Math.min(setup.rules.maxBet, capLeft(0)));
}

// A round number near `value`, divisible by 5 (1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5 times a power of ten)
function niceBet(value) {
  var power = Math.pow(10, Math.floor(Math.log10(Math.max(1, value))));
  var best = null;
  [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 10].forEach((m) => {
    var candidate = Math.round(m * power);
    if (candidate % 5 != 0) return;
    if (best == null || Math.abs(candidate - value) < Math.abs(best - value)) best = candidate;
  });
  return best != null ? best : Math.round(value / 5) * 5;
}

// The presets: the lowest and the highest bet (divisible by 5) and round steps in between, growing evenly
function presets() {
  var lo = Math.ceil(setup.rules.minBet / 5) * 5;
  var hi = Math.floor(maxNow() / 5) * 5;
  if (hi <= lo) return [Math.max(setup.rules.minBet, Math.min(lo, maxNow()))];
  var list = [lo];
  for (var i = 1; i < PRESET_COUNT - 1; i++) {
    var value = niceBet(lo * Math.pow(hi / lo, i / (PRESET_COUNT - 1)));
    if (value > list[list.length - 1] && value < hi) list.push(value);
  }
  list.push(hi);
  return list;
}

var shownPresets = "";
function renderPresets() {
  var box = document.getElementById("slPresets");
  var list = presets();
  shownPresets = list.join(",");
  box.replaceChildren(
    ...list.map((value) => {
      var button = el("button", "sl-preset", value >= 1000 ? value / 1000 + "K" : String(value));
      button.type = "button";
      button.dataset.value = value;
      button.addEventListener("click", () => setBet(value));
      return button;
    }),
  );
}

// The balance: a win counts up (like the win in the middle), a bet is taken off right away
var coinsShown = null;
var coinsAnimation = 0;
function renderCoins(value) {
  var box = document.getElementById("slCoins");
  var from = coinsShown;
  coinsShown = value;
  var run = ++coinsAnimation;
  if (from == null || value <= from) {
    box.innerText = "🪙 " + formatCoins(value);
    return;
  }
  var time = Math.min(900, setup && setup.rules ? setup.rules.countTime : 800);
  var start = performance.now();
  var step = (now) => {
    // (a newer balance came meanwhile: that one counts)
    if (run != coinsAnimation) return;
    var t = Math.min(1, (now - start) / time);
    box.innerText = "🪙 " + formatCoins(Math.round(from + (value - from) * (1 - Math.pow(1 - t, 3))));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderControls() {
  if (setup == null) return;
  var bet = currentBet();
  var button = document.getElementById("slSpin");
  // Auto spins running: the button stops them (with how many are left)
  var auto = autoOn();
  button.disabled = !auto && (spinning || bet > myCoins);
  button.classList.toggle("busy", spinning && !auto);
  button.classList.toggle("auto", auto);
  button.querySelector(".sl-spin-label").innerText = auto ? "Stop" : "Spin";
  var left = document.getElementById("slAutoLeft");
  left.hidden = !auto;
  left.innerText = String(autoLeft);
  button.title = auto ? "Stop the auto spins" : bet > myCoins ? "Not enough coins" : "Spin (space) - hold to keep spinning";
  document.getElementById("slAuto").disabled = auto || bet > myCoins;
  document.querySelectorAll(".sl-preset").forEach((preset) => preset.classList.toggle("active", Number(preset.dataset.value) == bet));
  document.getElementById("slLess").disabled = spinning || bet <= setup.rules.minBet;
  document.getElementById("slMore").disabled = spinning || bet >= maxNow();
  // (the balance changed the highest bet: other presets)
  if (presets().join(",") != shownPresets) renderPresets();
}

// − / +: to the next bet of the presets
function stepBet(direction) {
  var bet = currentBet();
  var steps = presets();
  var next = direction > 0 ? steps.find((value) => value > bet) : steps.slice().reverse().find((value) => value < bet);
  setBet(next != null ? next : direction > 0 ? maxNow() : setup.rules.minBet);
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
      var what = entry.bonus ? "🎁 Bonus · " + entry.bonus + " free spins" : entry.coins ? "🪙 Coin game · " + entry.coins + " coins" + (entry.ultra ? " · ULTRA" : "") : entry.count + "× " + (symbol ? symbol.icon : "");
      var sub = what + " · bet 🪙 " + formatCoins(entry.bet) + " · " + (multiple >= 10 ? Math.round(multiple) : multiple.toFixed(1)) + "x";
      var item = historyItem(createAvatar(entry.name, "sm"), entry.name, sub, "🪙 " + formatCoins(entry.win));
      if (entry.bonus || entry.coins) item.classList.add("sl-feed-bonus");
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
    .filter((symbol) => !symbol.scatter && !symbol.coin)
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
  var close = el("button", "mm-btn w-100 sl-paytable-close", "Close");
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
  // The coin game: how it works, then every prize as a colored badge with what it pays for this bet
  var c = setup.coins;
  var coinText = el(
    "p",
    "sl-pays-bonus",
    c.trigger + " or more 🪙 anywhere start the coin game. The coins stay, the empty spots spin again - " + c.respins + " respins, every new coin brings them back to " + c.respins + ". The coin game pays all its coins (at most " + c.maxWin + "× the bet).",
  );
  var prizeTable = el("div", "sl-prize-table");
  var row = (badge, amount) => prizeTable.append(badge, el("span", "sl-prize-amount", amount));
  var values = c.values;
  row(el("span", "sl-prize-badge plain", "🪙 coin"), "🪙 " + formatCoins(Math.floor(bet * values[0])) + " - " + formatCoins(Math.floor(bet * values[values.length - 1])));
  c.prizes.forEach((p) => row(el("span", "sl-prize-badge prize-" + p.prize, p.prize.toUpperCase()), "🪙 " + formatCoins(Math.floor(bet * p.x))));
  row(el("span", "sl-prize-badge prize-ultra", "ULTRA"), "🪙 " + formatCoins(bet * c.ultra));
  var chestBadge = el("span", "sl-prize-badge plain sl-chest-badge", " chest");
  chestBadge.prepend(chestIcon(false));
  row(chestBadge, "Pick 1 of 3 chests: MINI, MAJOR or MEGA");
  dialog.append(table, el("h3", "sl-pays-title", "Bonus"), bonus, el("h3", "sl-pays-title", "Coin game"), coinText, prizeTable, el("h3", "sl-pays-title", "The 9 lines"), lines, close);
  backdrop.appendChild(dialog);
  // (in full screen only the machine is seen: the paytable goes in there)
  (document.fullscreenElement || document.body).appendChild(backdrop);
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
  // Spin: a press spins - held down, it spins again and again (until let go); during auto spins it stops them
  var spinButton = document.getElementById("slSpin");
  var pressedByPointer = false;
  spinButton.addEventListener("pointerdown", (event) => {
    if (event.button != 0) return;
    pressedByPointer = true;
    if (autoOn()) return stopAuto();
    holding = true;
    spin();
  });
  // (let go anywhere - the button is disabled while it spins and hears nothing then)
  var letGo = () => (holding = false);
  ["pointerup", "pointercancel"].forEach((type) => window.addEventListener(type, letGo, true));
  window.addEventListener("blur", letGo);
  // (the keyboard: Enter on the button - a click without a pointer)
  spinButton.addEventListener("click", () => {
    if (pressedByPointer) return (pressedByPointer = false);
    if (autoOn()) return stopAuto();
    spin();
  });
  // Auto spins: the menu with the numbers
  var autoButton = document.getElementById("slAuto");
  var autoMenu = document.getElementById("slAutoMenu");
  autoButton.addEventListener("click", (event) => {
    event.stopPropagation();
    autoMenu.hidden = !autoMenu.hidden;
    autoButton.setAttribute("aria-expanded", autoMenu.hidden ? "false" : "true");
  });
  autoMenu.querySelectorAll("[data-auto]").forEach((option) => option.addEventListener("click", () => startAuto(Number(option.dataset.auto))));
  document.addEventListener("click", (event) => {
    if (!autoMenu.hidden && !event.target.closest(".sl-auto")) {
      autoMenu.hidden = true;
      autoButton.setAttribute("aria-expanded", "false");
    }
  });
  document.getElementById("slLess").addEventListener("click", () => stepBet(-1));
  document.getElementById("slMore").addEventListener("click", () => stepBet(1));
  document.getElementById("slBet").addEventListener("change", (event) => setBet(Number(event.target.value) || 0));
  document.getElementById("slPaytable").addEventListener("click", () => setup && showPaytable());
  // Space spins (not while typing) - held down, again and again; during auto spins it stops them
  document.addEventListener("keydown", (event) => {
    if (event.code != "Space" || event.repeat) return;
    var tag = document.activeElement && document.activeElement.tagName;
    if (tag == "INPUT" || tag == "TEXTAREA" || tag == "BUTTON" || document.querySelector(".mm-dialog-backdrop")) return;
    event.preventDefault();
    if (autoOn()) return stopAuto();
    holding = true;
    spin();
  });
  document.addEventListener("keyup", (event) => {
    if (event.code == "Space") holding = false;
  });
  // Full screen (casino_fullscreen.js): the symbols change their size
  document.addEventListener("fullscreenchange", () => {
    if (setup && !spinning) TILE = document.querySelector(".sl-cell").offsetHeight;
  });
  window.addEventListener("resize", () => {
    if (setup && !spinning) TILE = document.querySelector(".sl-cell").offsetHeight;
  });
  // The machine a bit smaller when the screen isn't high enough (casino_fullscreen.js) - the lines follow
  window.addEventListener("casinofit", () => {
    if (setup && !spinning) TILE = document.querySelector(".sl-cell").offsetHeight;
  });
  window.casinoFitGame(document.querySelector(".sl-machine"));
});
