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
  if (!spinning) renderCoins(myCoins);
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

async function playSpin(result) {
  var time = setup.rules.spinTime;
  var reels = [...document.querySelectorAll(".sl-reel")];
  // Two wilds or the start of a big line on the first reels: the last reel takes longer
  var tease = result.grid.slice(0, 3).flat().filter((id) => id == "wild" || id == "diamond").length >= 2;
  var stops = reels.map((reel, i) => {
    var strip = setup.strips[i];
    var track = reel.querySelector(".sl-track");
    var count = 14 + i * 5 + (tease && i == 4 ? 10 : 0);
    var ids = [];
    // The faces on top now, then random ones, then the result
    var now = [...track.children].map((c) => c.dataset.symbol);
    ids.push(...now);
    for (var n = 0; n < count; n++) ids.push(strip[Math.floor(Math.random() * strip.length)]);
    ids.push(...result.grid[i]);
    track.getAnimations().forEach((a) => a.cancel());
    track.replaceChildren(...ids.map(cell));
    track.style.transform = "translateY(0px)";
    var end = -(ids.length - 3) * TILE;
    var duration = time * (0.5 + i * 0.12) + (tease && i == 4 ? 700 : 0);
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
      // Keep only the 3 symbols that are shown
      track.getAnimations().forEach((a) => a.cancel());
      track.replaceChildren(...result.grid[i].map(cell));
      track.style.transform = "translateY(0px)";
    });
  });
  await Promise.all(stops);
  // Three 🎁: the bonus wheel first
  if (result.bonus) await playBonus(result);
  await showResult(result);
  spinning = false;
  // The win comes with the next "coins" from the server (after the count)
  renderCoins(myCoins);
  renderControls();
}

/* ---------- Bonus: the wheel of multipliers ---------- */

// The fields on the wheel (every multiplier at least once, the small ones more often)
var WHEEL_FIELDS = [2, 5, 3, 10, 2, 20, 3, 5, 2, 50, 3, 10, 2, 100, 5, 250];
var WHEEL_COLORS = { 2: "#3b3b3b", 3: "#454545", 5: "#2f5d8a", 10: "#2f7a55", 20: "#7a4ea0", 50: "#a8742a", 100: "#b0413e", 250: "#d4a017" };

function polar(r, angle) {
  var a = ((angle - 90) * Math.PI) / 180;
  return [50 + r * Math.cos(a), 50 + r * Math.sin(a)];
}

function wheelSvg() {
  var NS = "http://www.w3.org/2000/svg";
  var svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("class", "sl-wheel-svg");
  var step = 360 / WHEEL_FIELDS.length;
  WHEEL_FIELDS.forEach((value, i) => {
    var [x1, y1] = polar(48, i * step);
    var [x2, y2] = polar(48, (i + 1) * step);
    var path = document.createElementNS(NS, "path");
    path.setAttribute("d", `M50 50 L${x1} ${y1} A48 48 0 0 1 ${x2} ${y2} Z`);
    path.setAttribute("fill", WHEEL_COLORS[value]);
    path.setAttribute("stroke", "#1a1a1a");
    path.setAttribute("stroke-width", "0.6");
    svg.appendChild(path);
    var [tx, ty] = polar(36, (i + 0.5) * step);
    var text = document.createElementNS(NS, "text");
    text.setAttribute("x", tx);
    text.setAttribute("y", ty);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "central");
    text.setAttribute("transform", `rotate(${(i + 0.5) * step} ${tx} ${ty})`);
    text.setAttribute("class", "sl-wheel-text" + (value >= 100 ? " big" : ""));
    text.textContent = value + "×";
    svg.appendChild(text);
  });
  var hub = document.createElementNS(NS, "circle");
  hub.setAttribute("cx", 50);
  hub.setAttribute("cy", 50);
  hub.setAttribute("r", 9);
  hub.setAttribute("fill", "#1f1f1f");
  hub.setAttribute("stroke", "#d4a017");
  hub.setAttribute("stroke-width", "1.5");
  svg.appendChild(hub);
  return svg;
}

async function playBonus(result) {
  var stage = document.getElementById("slStage");
  var time = setup.rules.bonusTime;
  // The 🎁 light up
  document.querySelectorAll(".sl-cell.scatter").forEach((c) => c.classList.add("hit"));
  await wait(Math.min(900, time * 0.15));
  stage.hidden = false;
  stage.className = "sl-stage bonus";
  var title = el("div", "sl-stage-title", "🎁 BONUS");
  var wheel = el("div", "sl-wheel");
  var disc = el("div", "sl-wheel-disc");
  disc.appendChild(wheelSvg());
  wheel.append(el("div", "sl-wheel-pointer"), disc);
  var label = el("div", "sl-stage-sub", "Spinning for a multiplier...");
  stage.replaceChildren(title, wheel, label);
  // One field with this multiplier, under the pointer at the top - only forward, slowing down
  var fields = WHEEL_FIELDS.map((v, i) => (v == result.bonus.multiplier ? i : -1)).filter((i) => i >= 0);
  var field = fields[Math.floor(Math.random() * fields.length)];
  var step = 360 / WHEEL_FIELDS.length;
  var inside = (0.2 + Math.random() * 0.6) * step;
  var end = 360 * (5 + Math.floor(Math.random() * 2)) - (field * step + inside);
  var spinTime = time * 0.6;
  await disc.animate([{ transform: "rotate(0deg)" }, { transform: `rotate(${end}deg)` }], { duration: spinTime, easing: "cubic-bezier(0.12, 0.6, 0.15, 1)", fill: "forwards" }).finished;
  label.innerText = "× " + result.bonus.multiplier + " = 🪙 " + formatCoins(result.bonus.win);
  label.classList.add("won");
  if (result.bonus.multiplier >= 50) coinShower(stage, 50);
  await wait(time * 0.25);
  stage.hidden = true;
  stage.replaceChildren();
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
  if (big) await bigWin(result);
  countUp(text, result.win, big ? 300 : Math.min(900, setup.rules.countTime));
  detail.innerText = result.bonus && result.lines.length == 0 ? "Bonus × " + result.bonus.multiplier : result.lines.length == 1 ? "1 line" : result.lines.length + " lines";
  var reels = [...document.querySelectorAll(".sl-reel")];
  var hit = (line) =>
    setup.lines[line.line].slice(0, line.count).forEach((row, reel) => reels[reel].querySelectorAll(".sl-cell")[row].classList.add("hit"));
  result.lines.forEach(hit);
  showLines(
    result.lines.map((l) => l.line),
    true,
  );
  if (result.lines.length == 0) return;
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

function countUp(element, value, time) {
  var start = performance.now();
  var step = (now) => {
    var t = Math.min(1, (now - start) / time);
    element.innerText = "🪙 " + formatCoins(Math.round(value * (1 - Math.pow(1 - t, 3))));
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
      var sub = entry.count + "× " + (symbol ? symbol.icon : "") + " · bet 🪙 " + formatCoins(entry.bet) + " · " + (multiple >= 10 ? Math.round(multiple) : multiple.toFixed(1)) + "x";
      return historyItem(createAvatar(entry.name, "sm"), entry.name, sub, "🪙 " + formatCoins(entry.win));
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
  var bonus = el("p", "sl-pays-bonus", "🎁 on reels 1, 3 and 5 at the same time: the bonus wheel spins for a multiplier of your bet - " + setup.wheel.map((m) => m + "×").join(", ") + ". A spin pays at most " + setup.maxWin + "× the bet.");
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
  window.addEventListener("resize", () => {
    if (setup && !spinning) TILE = document.querySelector(".sl-cell").offsetHeight;
  });
});
