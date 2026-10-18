/*
 * The runner: this page plays the run live (public/scripts/runner_engine.js) and sends its moves to the
 * server. The server plays the run again from the seed and the moves and pays what its replay says.
 */
const socket = io((window.CASINO_NS || "") + "/runner");
const E = window.RunnerEngine;

var myName = null;
var myCoins = 0;
var rules = null;
var best = 0;
var stake = 0; // the entry typed in
var STAKE_KEY = "runnerStake";
var game = null; // the run going: {id, seed, stake, run, startAt, queue, moves, sent, over}
var lastResult = null;

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

/* ---------- Socket ---------- */

socket.on("connect", () => {
  document.getElementById("connectionBanner").hidden = true;
  // (a run that ended while the connection was gone: its result went nowhere - the panel is free again)
  if (game && game.over && !game.result) {
    game = null;
    renderPanel();
  }
});
socket.on("disconnect", () => {
  document.getElementById("connectionBanner").hidden = false;
  // (the server ends a run when the page is gone: here too)
  if (game && !game.over) crash(true);
});
socket.on("connect_error", (error) => {
  if (error && error.message == "unauthorized") window.location.href = "/?next=" + encodeURIComponent(location.pathname + location.search);
});
socket.on("casinoClosed", () => window.location.reload());
socket.on("gameOff", () => (window.location.href = "./"));
window.addEventListener("pagehide", () => socket.disconnect());
window.addEventListener("pageshow", (event) => {
  if (event.persisted) socket.connect();
});

socket.on("joined", (data) => (myName = data.username));
socket.on("coins", (data) => {
  myCoins = data.coins;
  // (the runner's own max bet by balance - none when the admin lifted it)
  myCapRule = data.capRules && "runner" in data.capRules ? data.capRules.runner : data.betCapRule || null;
  renderPanel();
});
socket.on("runnerSetup", (data) => {
  rules = data.rules;
  best = data.best || 0;
  var saved = null;
  try {
    saved = Number(localStorage.getItem(STAKE_KEY));
  } catch (error) {}
  stake = saved > 0 ? saved : rules.minBet * 10;
  setAmount(stake);
  renderPanel();
});
socket.on("runnerError", (message) => {
  showToast(message);
  if (game && !game.run) game = null;
  renderPanel();
});
socket.on("runnerStarted", (data) => startRun(data));
socket.on("runnerResult", (data) => {
  lastResult = data;
  best = data.best || best;
  if (game && game.id == data.id) game.result = data;
  renderPanel();
});

function showToast(message) {
  var toast = el("div", "rn-toast", message);
  document.getElementById("rnStage").appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

/* ---------- The panel: the entry before a run, the result after it ---------- */

// What a distance pays (the same curve as the server's game/runner.js) - and what the coins add
function multiplier(meters) {
  var t = rules.table;
  if (meters < t.min) return 0;
  if (meters < t.even) return Math.round((meters / t.even) * 1000) / 1000;
  return Math.min(t.max, Math.round((1 + rules.slope * (meters / t.even - 1)) * 1000) / 1000);
}

// (a share as a percentage with one decimal: 0.005 - "0.5")
function pct(share) {
  return String(Math.round(share * 1000) / 10);
}

function coinBonus(coins) {
  return Math.min(rules.coinCap, coins * rules.coinBonus);
}

function payout(entry, meters, coins) {
  return Math.floor(entry * multiplier(meters) * (1 + coinBonus(coins)));
}

// The most an entry may be now: the max entry, the coins, the max bet by balance
var myCapRule = null;
function maxEntry() {
  return Math.max(0, Math.min(rules.maxBet, myCoins, casinoCapLeft(myCapRule, myCoins, 0)));
}

var amountInput = document.getElementById("rnAmount");
function setAmount(value) {
  if (!rules) return;
  stake = Math.max(rules.minBet, Math.min(rules.maxBet, Math.floor(Number(value) || 0)));
  amountInput.value = String(stake);
  try {
    localStorage.setItem(STAKE_KEY, String(stake));
  } catch (error) {}
  renderPanel();
}
amountInput.addEventListener("change", () => setAmount(amountInput.value));
amountInput.addEventListener("input", () => {
  stake = Math.floor(Number(amountInput.value) || 0);
  renderPanel();
});
document.querySelectorAll(".rn-chip").forEach((chip) =>
  chip.addEventListener("click", () => {
    var kind = chip.dataset.amount;
    setAmount(kind == "half" ? Math.floor(stake / 2) : kind == "double" ? stake * 2 : maxEntry());
  }),
);

function renderPanel() {
  if (!rules) return;
  var panel = document.getElementById("rnPanel");
  var running = game && !game.over;
  panel.hidden = running;
  document.getElementById("rnHud").hidden = !game;
  amountInput.min = rules.minBet;
  amountInput.max = rules.maxBet;
  amountInput.step = rules.minBet;
  // The pay table: where it starts, the entry back, the most - and the coins
  var t = rules.table;
  var table = document.getElementById("rnTable");
  table.replaceChildren(
    ...[
      [formatCoins(t.min) + " m", t.minMult + "×", ""],
      [formatCoins(t.even) + " m", "1×", "even"],
      [formatCoins(t.top) + " m", t.max + "×", "top"],
      ["each coin", "+" + pct(rules.coinBonus) + "%", "coin"],
    ].map(([at, x, kind]) => {
      var row = el("span", "rn-table-item " + kind);
      row.append(el("span", "rn-table-at", at), el("span", "rn-table-x", x));
      return row;
    }),
  );
  var valid = stake >= rules.minBet && stake <= rules.maxBet;
  var start = document.getElementById("rnStart");
  start.innerText = (game && game.over && game.stake > 0 ? "Run again for 🪙 " : "Run for 🪙 ") + formatCoins(Math.max(0, stake));
  var waiting = game && game.over && !game.result;
  start.disabled = !valid || stake > maxEntry() || waiting;
  start.title = !valid ? "An entry is " + formatCoins(rules.minBet) + " to " + formatCoins(rules.maxBet) + " coins." : stake > maxEntry() ? "Your max entry is " + formatCoins(maxEntry()) + "." : "";
  document.getElementById("rnPractice").disabled = waiting;
  document.getElementById("rnBest").innerText = best ? "Your best: " + formatCoins(best) + " m" : "";
  // The result of the last run
  var result = document.getElementById("rnResult");
  var r = game && game.over ? game.result : null;
  result.hidden = !(game && game.over);
  if (game && game.over && !r) {
    result.replaceChildren(el("div", "rn-result-wait mm-muted", "Checking your run..."));
  } else if (r) {
    var head = el("div", "rn-result-score", formatCoins(r.distance) + " m");
    var sub = el("div", "rn-result-sub mm-muted", r.coins + (r.coins == 1 ? " coin" : " coins") + (r.practice ? "" : " · +" + pct(r.bonus) + "% on the payout"));
    var pay = r.practice ? el("div", "rn-result-pay mm-muted", "Practice run") : el("div", "rn-result-pay" + (r.win >= r.stake ? " won" : r.win > 0 ? " part" : " lost"), r.win > 0 ? "You get 🪙 " + formatCoins(r.win) : "No payout this time");
    result.replaceChildren(head, sub, pay);
    if (r.record) result.appendChild(el("div", "rn-result-record", "🏆 New best"));
  }
}

function begin(entry) {
  if (!rules || (game && !game.over)) return;
  game = { pending: true };
  renderPanel();
  socket.emit("runStart", { stake: entry });
}
document.getElementById("rnStart").addEventListener("click", () => begin(stake));
document.getElementById("rnPractice").addEventListener("click", () => begin(0));

/* ---------- A run ---------- */

function startRun(data) {
  hudKey = null;
  game = { id: data.id, seed: data.seed, stake: data.stake, run: E.create(data.seed), queue: [], moves: [], sent: 0, over: false, result: null, startAt: performance.now() + rules.countdown, deadAt: null };
  renderPanel();
  focusStage();
}

// A move of the player: into the queue - the next tick takes it (one a tick)
function input(move) {
  if (!game || game.over || !game.run) return;
  if (game.queue.length < 3) game.queue.push(move);
}

function sendMoves(final) {
  if (!game || game.id == null) return;
  var fresh = game.moves.slice(game.sent);
  game.sent = game.moves.length;
  if (final) socket.emit("runEnd", { id: game.id, moves: fresh });
  else if (fresh.length) socket.emit("runMoves", { id: game.id, moves: fresh });
}
setInterval(() => game && !game.over && game.run && sendMoves(false), 400);

// The runner fell (or the page can't go on: hidden, offline): the server gets the last moves
function crash(quiet) {
  if (!game || game.over) return;
  game.over = true;
  game.deadAt = performance.now();
  if (!quiet) sendMoves(true);
  setTimeout(renderPanel, 700);
}

// (another tab, the window hidden: the run can't be played on - it ends)
document.addEventListener("visibilitychange", () => {
  if (document.hidden && game && !game.over && game.run && performance.now() > game.startAt) {
    crash(false);
  }
});

// The run up to now: the ticks that are due (the last state kept - the picture blends between the two)
function tickTo(now) {
  if (!game || game.over || !game.run || now < game.startAt) return;
  var run = game.run;
  var target = Math.floor(((now - game.startAt) / 1000) * E.TPS);
  // (a long stall - never more than half a second at once)
  var steps = 0;
  while (run.tick < target && steps < 30 && !run.dead) {
    var move = game.queue.length ? game.queue.shift() : null;
    if (move) game.moves.push([run.tick, move]);
    var before = { z: run.z, x: run.x, h: E.height(run), taken: run.taken, air: run.jump > 0 };
    E.step(run, move);
    game.prev = before;
    // What the picture adds: sparkles for a coin, dust for a landing
    if (run.taken > before.taken) coinBurst(run);
    if (before.air && !run.jump && !run.dead) dust(run);
    steps++;
  }
  // (how far the moment is into the tick after the last one: the picture shows the runner that far from the last state)
  game.alpha = Math.max(0, Math.min(1, ((now - game.startAt) / 1000) * E.TPS - run.tick));
  if (run.dead) crash(false);
}

/* ---------- Controls: keys and swipes ---------- */

var KEYS = { ArrowLeft: "L", KeyA: "L", ArrowRight: "R", KeyD: "R", ArrowUp: "J", KeyW: "J", Space: "J", ArrowDown: "D", KeyS: "D" };
document.addEventListener("keydown", (event) => {
  if (event.target && (event.target.tagName == "INPUT" || event.target.tagName == "TEXTAREA")) return;
  var move = KEYS[event.code];
  if (!move) {
    // (Enter: run again)
    if (event.code == "Enter" && (!game || game.over) && stageVisible() && event.target != amountInput) {
      var again = game && game.stake === 0 ? document.getElementById("rnPractice") : document.getElementById("rnStart");
      if (!again.disabled) again.click();
    }
    return;
  }
  if (game && !game.over && game.run) {
    event.preventDefault();
    if (!event.repeat) input(move);
  }
});

// Swipes: one move as soon as the finger went far enough - then the next one from there (left and up in one go)
var touch = null;
var stage = document.getElementById("rnStage");
stage.addEventListener(
  "touchstart",
  (event) => {
    if (!game || game.over) return;
    var t = event.changedTouches[0];
    touch = { x: t.clientX, y: t.clientY };
  },
  { passive: true },
);
stage.addEventListener(
  "touchmove",
  (event) => {
    if (!touch || !game || game.over) return;
    event.preventDefault();
    var t = event.changedTouches[0];
    var dx = t.clientX - touch.x;
    var dy = t.clientY - touch.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 22) return;
    input(Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "L" : "R") : dy < 0 ? "J" : "D");
    touch = { x: t.clientX, y: t.clientY };
  },
  { passive: false },
);
stage.addEventListener("touchend", () => (touch = null));

function focusStage() {
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
}

function stageVisible() {
  var r = stage.getBoundingClientRect();
  return r.bottom > 0 && r.top < window.innerHeight;
}

/* ---------- Drawing: the track from behind the runner ---------- */

var canvas = document.getElementById("rnCanvas");
var ctx = canvas.getContext("2d");
var W = 0;
var H = 0;
var LANE = 2.6; // m between two lanes
var CAM_BACK = 4.4; // the camera: this far behind the runner ...
var CAM_H = 3.2; // ... this high
var VIEW = 120; // m seen ahead
var WALL = LANE * 1.5 + 0.7; // the walls at the sides
var FOG = [255, 170, 110]; // the haze toward the horizon
var TRAINS = [
  { body: [234, 88, 12], light: [253, 186, 116], stripe: [255, 247, 237] },
  { body: [37, 99, 235], light: [147, 197, 253], stripe: [239, 246, 255] },
  { body: [22, 163, 74], light: [134, 239, 172], stripe: [240, 253, 244] },
  { body: [147, 51, 234], light: [216, 180, 254], stripe: [250, 245, 255] },
];
var cam = { x: 0, tilt: 0 }; // the camera glides after the runner
var particles = []; // {x, y, z, vx, vy, vz, life, max, color, size, text}
var lastFrame = 0;

function resize() {
  var rect = canvas.getBoundingClientRect();
  // (at most 1.5 pixels a point: twice as sharp costs twice the painting every frame - the picture moves anyway)
  var dpr = Math.min(1.5, window.devicePixelRatio || 1);
  W = rect.width;
  H = rect.height;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // (the pictures made once: new for the new size)
  cache = {};
}
var cache = {};

// A picture made once and drawn again every frame (an offscreen canvas) - in points, sharp like the canvas
function made(name, w, h, paint) {
  var key = name + ":" + Math.round(w) + "x" + Math.round(h);
  if (cache[name] && cache[name].key == key) return cache[name].canvas;
  var dpr = canvas.width / Math.max(1, W);
  var c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * dpr));
  c.height = Math.max(1, Math.round(h * dpr));
  var g = c.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  paint(g, w, h);
  cache[name] = { key: key, canvas: c };
  return c;
}

// A soft round glow (white - tinted by the color of what is drawn under it): drawn scaled wherever a light shines
var GLOW = (function () {
  var c = document.createElement("canvas");
  c.width = c.height = 64;
  var g = c.getContext("2d");
  var r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255, 236, 180, 1)");
  r.addColorStop(0.35, "rgba(255, 220, 150, 0.45)");
  r.addColorStop(1, "rgba(255, 220, 150, 0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return c;
})();
function glow(x, y, radius, alpha) {
  if (radius < 0.5 || alpha <= 0) return;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(GLOW, x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalAlpha = 1;
}
window.addEventListener("resize", resize);

// A color with the haze of its distance (d: m from the camera)
function shade(c, d, k) {
  var f = Math.min(0.88, Math.pow(Math.max(0, d - 12) / (VIEW - 12), 1.25) * 0.95);
  var m = k == null ? 1 : k;
  return "rgb(" + Math.round((c[0] * (1 - f) + FOG[0] * f) * m) + "," + Math.round((c[1] * (1 - f) + FOG[1] * f) * m) + "," + Math.round((c[2] * (1 - f) + FOG[2] * f) * m) + ")";
}

// The view of the moment: the camera behind the runner (where it is between two ticks)
function view(pos, speed) {
  // (the ground at the runner near the bottom - all three lanes in the picture on a narrow screen too - a little wider when fast)
  var focal = Math.min((H * 0.7 * 0.82 * CAM_BACK) / CAM_H, (W * CAM_BACK) / (LANE * 2.5)) * (1 - ((speed - E.V0) / E.VMAX) * 0.12);
  var horizon = Math.min(H * 0.42, H * 0.9 - (CAM_H * focal) / CAM_BACK);
  return { horizon: horizon, focal: focal, camZ: pos.z - CAM_BACK, camX: cam.x, camY: CAM_H + pos.h * 0.25 };
}

// A point of the world (x across, y up, z along the track) on the screen - null: behind the camera
function project(v, x, y, z) {
  var d = z - v.camZ;
  if (d < 0.35) return null;
  var s = v.focal / d;
  return { x: W / 2 + (x - v.camX) * s, y: v.horizon + (v.camY - y) * s, s: s, d: d };
}

function poly(v, points, fill) {
  var p = [];
  for (var i = 0; i < points.length; i++) {
    var q = project(v, points[i][0], points[i][1], points[i][2]);
    if (!q) return;
    p.push(q);
  }
  ctx.beginPath();
  ctx.moveTo(p[0].x, p[0].y);
  for (var j = 1; j < p.length; j++) ctx.lineTo(p[j].x, p[j].y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

// A flat face across the track (x0..x1, y0..y1) at z
function face(v, x0, x1, y0, y1, z, fill) {
  poly(v, [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], fill);
}

/* The sky: a dusk, the sun, clouds, two rows of houses with lit windows - painted once, moved every frame */
var SKY_H = 400; // the sky picture: drawn stretched down to the horizon
function drawSky(v, pos) {
  var hz = v.horizon;
  var sky = made("sky", W, SKY_H, (g, w, h) => {
    var grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#0b1026");
    grad.addColorStop(0.45, "#3b1d6e");
    grad.addColorStop(0.8, "#c2416b");
    grad.addColorStop(1, "#ffaa6e");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
  ctx.drawImage(sky, 0, 0, W, hz + 2);
  // The sun, low and big, with its glow
  var size = Math.min(W, H);
  var sx = W * 0.68 - v.camX * 4;
  var sy = hz - size * 0.06;
  glow(sx, sy, size * 0.42, 0.75);
  ctx.fillStyle = "#ffe2a8";
  ctx.beginPath();
  ctx.arc(sx, sy, size * 0.075, 0, Math.PI * 2);
  ctx.fill();
  // Clouds drifting
  ctx.fillStyle = "rgba(255, 190, 210, 0.1)";
  for (var c = 0; c < 5; c++) {
    var cx = (((c * 0.29 + pos.z * 0.0006 + performance.now() * 0.000004) % 1.3) - 0.15) * W;
    var cy = hz * (0.14 + ((c * 37) % 5) * 0.07);
    var cw = W * (0.07 + ((c * 13) % 4) * 0.025);
    ctx.beginPath();
    ctx.ellipse(cx, cy, cw, cw * 0.12, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + cw * 0.35, cy - cw * 0.06, cw * 0.5, cw * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  skyline(v, pos, 0.35, "#4a2468", "rgba(255, 200, 120, 0.55)", 0.62, 11);
  skyline(v, pos, 0.8, "#2a1640", "rgba(255, 214, 140, 0.8)", 0.42, 23);
}

// A row of houses (far ones slower - parallax), lit windows here and there: a strip of 24 houses painted once,
// repeated across the screen and moved
function skyline(v, pos, depth, color, lights, height, seed) {
  // (painted for a horizon at 42% of the height - drawn scaled to where it is now: no new painting when it moves)
  var hz = H * 0.42;
  var k = v.horizon / hz;
  var bw = Math.max(26, W / (9 + depth * 6));
  var count = 24;
  var top = Math.ceil(hz * height + bw * 0.3);
  var strip = made("skyline" + seed, bw * count, top, (g, w, h) => {
    for (var i = 0; i < count; i++) {
      var r = Math.abs(Math.sin(i * 12.9898 + seed) * 43758.5453) % 1;
      var bh = (0.25 + r * 0.75) * hz * height;
      var x = i * bw;
      g.fillStyle = color;
      g.fillRect(x, h - bh, bw * 0.92, bh);
      if (r > 0.55) g.fillRect(x + bw * 0.4, h - bh - bw * 0.25, bw * 0.08, bw * 0.25);
      g.fillStyle = lights;
      var wsz = bw * 0.12;
      for (var row = 0; row < Math.floor(bh / (wsz * 2.6)); row++) {
        for (var col = 0; col < 3; col++) {
          var on = Math.abs(Math.sin((i * 7 + row * 3 + col) * 78.233 + seed)) % 1;
          if (on > 0.72) g.fillRect(x + bw * 0.16 + col * bw * 0.26, h - bh + wsz * 1.5 + row * wsz * 2.6, wsz, wsz * 1.2);
        }
      }
    }
  });
  var width = bw * count;
  var shift = -(v.camX * 10 * depth + pos.z * 0.15 * depth);
  var x0 = ((shift % width) + width) % width - width;
  for (var x = x0; x < W; x += width) ctx.drawImage(strip, x, v.horizon - top * k, width, top * k);
}

/* The ground: walls and lamps at the sides, three beds of gravel with sleepers and rails */
function drawGround(v, pos) {
  var hz = v.horizon;
  var ground = ctx.createLinearGradient(0, hz, 0, H);
  ground.addColorStop(0, "rgb(" + FOG.join(",") + ")");
  ground.addColorStop(0.12, "#8a6a5e");
  ground.addColorStop(1, "#3b3232");
  ctx.fillStyle = ground;
  ctx.fillRect(0, hz, W, H - hz);
  var near = v.camZ + 0.4;
  var far = pos.z + VIEW;
  // Walls: in pieces of 6 m (a bit lighter every other one), so their speed shows
  for (var side = -1; side <= 1; side += 2) {
    var x = side * WALL;
    // (on a fixed grid of the track - never from the moving far end: no flicker)
    var start = Math.floor(near / 6) * 6;
    for (var z = Math.floor(far / 6) * 6; z >= start; z -= 6) {
      var z0 = Math.max(z, near);
      var z1 = z + 6;
      if (z1 <= z0) continue;
      var d = z0 - v.camZ;
      var k = (Math.floor(z / 6) % 2 ? 1 : 0.88);
      poly(v, [[x, 0, z0], [x, 1.6, z0], [x, 1.6, z1], [x, 0, z1]], shade([92, 78, 96], d, k));
      poly(v, [[x, 1.6, z0], [x + side * 0.3, 1.6, z0], [x + side * 0.3, 1.6, z1], [x, 1.6, z1]], shade([140, 120, 140], d));
    }
  }
  // Beds, sleepers, rails
  for (var lane = 0; lane < 3; lane++) {
    var cx = (lane - 1) * LANE;
    poly(v, [[cx - 1.18, 0, near], [cx + 1.18, 0, near], [cx + 1.18, 0, far], [cx - 1.18, 0, far]], "rgba(70, 60, 62, 0.55)");
  }
  var first = Math.ceil(near / 1.4);
  for (var n = Math.floor(far / 1.4); n >= first; n--) {
    var zz = n * 1.4;
    var dd = zz - v.camZ;
    var sleeper = shade([96, 66, 48], dd);
    for (var l = 0; l < 3; l++) {
      var lx = (l - 1) * LANE;
      poly(v, [[lx - 0.98, 0.01, zz], [lx + 0.98, 0.01, zz], [lx + 0.98, 0.01, zz + 0.32], [lx - 0.98, 0.01, zz + 0.32]], sleeper);
    }
  }
  for (var r = 0; r < 3; r++) {
    var rx = (r - 1) * LANE;
    [-0.55, 0.55].forEach((off) => {
      poly(v, [[rx + off - 0.07, 0.06, near], [rx + off + 0.07, 0.06, near], [rx + off + 0.07, 0.06, far], [rx + off - 0.07, 0.06, far]], "rgba(150, 156, 170, 0.95)");
      poly(v, [[rx + off - 0.025, 0.07, near], [rx + off + 0.025, 0.07, near], [rx + off + 0.025, 0.07, far], [rx + off - 0.025, 0.07, far]], "rgba(240, 244, 255, 0.85)");
    });
  }
}

// Lamps on the walls every 18 m: a post, a warm light, its glow
function drawLamps(v, pos) {
  var near = v.camZ + 0.6;
  var far = pos.z + VIEW;
  var start = Math.ceil(near / 18);
  for (var n = Math.floor(far / 18); n >= start; n--) {
    var z = n * 18;
    for (var side = -1; side <= 1; side += 2) {
      var x = side * (WALL - 0.1);
      var d = z - v.camZ;
      var base = project(v, x, 1.6, z);
      var top = project(v, x, 4.2, z);
      if (!base || !top) continue;
      ctx.strokeStyle = shade([60, 52, 70], d);
      ctx.lineWidth = Math.max(1, 0.12 * base.s);
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(top.x, top.y);
      ctx.lineTo(top.x - side * 0.7 * top.s, top.y);
      ctx.stroke();
      var lx = top.x - side * 0.7 * top.s;
      glow(lx, top.y, 1.6 * top.s, 0.6 * (1 - d / VIEW));
      ctx.fillStyle = "#fff4d6";
      ctx.beginPath();
      ctx.arc(lx, top.y + 0.05 * top.s, Math.max(1, 0.12 * top.s), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/* The things on the track */
function drawTrain(v, o, lane, row) {
  var cx = (lane - 1) * LANE;
  var hw = 1.12;
  var top = 3.3;
  var near = Math.max(o.z0, v.camZ + 0.45);
  var look = TRAINS[Math.floor(row.z) % TRAINS.length];
  var d = near - v.camZ;
  // (its shadow on the ground)
  poly(v, [[cx - hw - 0.15, 0.02, near], [cx + hw + 0.15, 0.02, near], [cx + hw + 0.15, 0.02, o.z1 + 0.6], [cx - hw - 0.15, 0.02, o.z1 + 0.6]], "rgba(20, 10, 20, 0.35)");
  // The side the camera sees: the body, a stripe, windows
  var side = cx - v.camX > 0 ? cx - hw : cx + hw;
  if (Math.abs(cx - v.camX) > 0.3) {
    poly(v, [[side, 0.15, near], [side, top, near], [side, top, o.z1], [side, 0.15, o.z1]], shade(look.body, d, 0.72));
    poly(v, [[side, 0.7, near], [side, 0.95, near], [side, 0.95, o.z1], [side, 0.7, o.z1]], shade(look.stripe, d, 0.8));
    for (var wz = o.z0 + 1.2; wz < o.z1 - 1; wz += 2.6) {
      if (wz + 1.6 < near) continue;
      poly(v, [[side, 1.65, Math.max(wz, near)], [side, 2.6, Math.max(wz, near)], [side, 2.6, wz + 1.6], [side, 1.65, wz + 1.6]], shade([30, 41, 59], wz - v.camZ));
    }
  }
  // The roof (with a box on it)
  poly(v, [[cx - hw, top, near], [cx + hw, top, near], [cx + hw, top, o.z1], [cx - hw, top, o.z1]], shade(look.light, d, 0.85));
  if (o.z1 - o.z0 > 7) {
    var rz = o.z0 + 2;
    if (rz > near) {
      face(v, cx - 0.6, cx + 0.6, top, top + 0.35, rz, shade([120, 113, 108], rz - v.camZ));
      poly(v, [[cx - 0.6, top + 0.35, rz], [cx + 0.6, top + 0.35, rz], [cx + 0.6, top + 0.35, rz + 2.4], [cx - 0.6, top + 0.35, rz + 2.4]], shade([168, 162, 158], rz - v.camZ));
    }
  }
  if (o.z0 < v.camZ + 0.45) return;
  // The back of the train: rounded windows, a stripe, lights
  var z = o.z0;
  d = z - v.camZ;
  face(v, cx - hw, cx + hw, 0.15, top, z, shade(look.body, d));
  face(v, cx - hw, cx + hw, 0.15, 0.4, z - 0.01, shade([40, 30, 40], d));
  face(v, cx - hw, cx + hw, 0.7, 0.95, z - 0.01, shade(look.stripe, d));
  face(v, cx - 0.85, cx - 0.12, 1.65, 2.75, z - 0.01, shade([30, 41, 59], d));
  face(v, cx + 0.12, cx + 0.85, 1.65, 2.75, z - 0.01, shade([30, 41, 59], d));
  face(v, cx - 0.8, cx - 0.5, 2.45, 2.7, z - 0.02, shade([120, 160, 220], d, 0.9));
  face(v, cx + 0.17, cx + 0.47, 2.45, 2.7, z - 0.02, shade([120, 160, 220], d, 0.9));
  [-0.72, 0.72].forEach((off) => {
    var p = project(v, cx + off, 1.25, z - 0.03);
    if (!p) return;
    var r = Math.max(1.5, 0.14 * p.s);
    glow(p.x, p.y, r * 3.5, 0.9);
    ctx.fillStyle = "#fffbe6";
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  });
}

// A low barrier: jump over it - posts and a board with red and white stripes
function drawLow(v, o, lane) {
  var cx = (lane - 1) * LANE;
  var z = o.z0;
  var d = z - v.camZ;
  face(v, cx - 1.08, cx - 0.92, 0, 0.95, z, shade([71, 85, 105], d));
  face(v, cx + 0.92, cx + 1.08, 0, 0.95, z, shade([71, 85, 105], d));
  for (var i = 0; i < 6; i++) {
    var x0 = cx - 1.1 + (i * 2.2) / 6;
    face(v, x0, x0 + 2.2 / 6, 0.45, 0.92, z - 0.01, shade(i % 2 ? [248, 250, 252] : [220, 38, 38], d));
  }
  poly(v, [[cx - 1.1, 0.92, z - 0.01], [cx + 1.1, 0.92, z - 0.01], [cx + 1.1, 0.92, z + 0.25], [cx - 1.1, 0.92, z + 0.25]], shade([255, 255, 255], d, 0.75));
}

// A high bar: roll under it - tall posts, a yellow and black board up high
function drawHigh(v, o, lane) {
  var cx = (lane - 1) * LANE;
  var z = o.z0;
  var d = z - v.camZ;
  face(v, cx - 1.2, cx - 1.04, 0, 2.3, z, shade([71, 85, 105], d));
  face(v, cx + 1.04, cx + 1.2, 0, 2.3, z, shade([71, 85, 105], d));
  for (var i = 0; i < 8; i++) {
    var x0 = cx - 1.16 + (i * 2.32) / 8;
    face(v, x0, x0 + 2.32 / 8, 1.3, 2.1, z - 0.01, shade(i % 2 ? [17, 24, 39] : [250, 204, 21], d));
  }
  poly(v, [[cx - 1.16, 2.1, z - 0.01], [cx + 1.16, 2.1, z - 0.01], [cx + 1.16, 2.1, z + 0.3], [cx - 1.16, 2.1, z + 0.3]], shade([254, 240, 138], d, 0.85));
  // (blinking lights on top)
  if (Math.floor(performance.now() / 400) % 2) {
    [-0.9, 0.9].forEach((off) => {
      var p = project(v, cx + off, 2.25, z - 0.02);
      if (!p) return;
      ctx.fillStyle = "rgba(255, 80, 60, 0.95)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(1.2, 0.09 * p.s), 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

function drawCoin(v, coin, tick) {
  var bob = Math.sin(tick / 10 + coin.z) * 0.08;
  var p = project(v, (coin.lane - 1) * LANE, 0.75 + bob, coin.z);
  if (!p) return;
  var r = 0.3 * p.s;
  var spin = Math.max(0.15, Math.abs(Math.cos(tick / 9 + coin.z)));
  glow(p.x, p.y, r * 2.2, 0.35);
  ctx.fillStyle = "#b45309";
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, r * spin, r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fbbf24";
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, r * spin * 0.8, r * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fef3c7";
  ctx.beginPath();
  ctx.ellipse(p.x - r * spin * 0.25, p.y - r * 0.3, r * spin * 0.22, r * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
}

/* The runner from behind: a hoodie, a cap the wrong way round, a little backpack - legs and arms going */
function drawRunner(v, pos, run) {
  var x = (pos.x - 1) * LANE;
  var y = pos.h;
  var ground = project(v, x, 0, pos.z);
  var p = project(v, x, y, pos.z);
  if (!ground || !p) return;
  var s = p.s;
  // (the shadow: smaller the higher it is)
  ctx.fillStyle = "rgba(15, 5, 15, 0.38)";
  ctx.beginPath();
  ctx.ellipse(ground.x, ground.y, 0.48 * s * (1 - y / 3), 0.13 * s * (1 - y / 3), 0, 0, Math.PI * 2);
  ctx.fill();
  var dead = run.dead;
  var hoodie = dead ? "#9a3412" : "#f97316";
  var dark = dead ? "#7c2d12" : "#c2410c";
  if (run.roll && !dead) {
    // A ball rolling, with a blur behind it
    var cy = p.y - 0.45 * s;
    ctx.fillStyle = "rgba(249, 115, 22, 0.25)";
    ctx.beginPath();
    ctx.ellipse(p.x, cy + 0.1 * s, 0.5 * s, 0.38 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    var ball = ctx.createRadialGradient(p.x - 0.12 * s, cy - 0.15 * s, 0.05 * s, p.x, cy, 0.45 * s);
    ball.addColorStop(0, "#fdba74");
    ball.addColorStop(1, "#c2410c");
    ctx.fillStyle = ball;
    ctx.beginPath();
    ctx.arc(p.x, cy, 0.44 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(124, 45, 18, 0.8)";
    ctx.lineWidth = Math.max(1, 0.07 * s);
    var a = run.tick / 2.5;
    ctx.beginPath();
    ctx.arc(p.x, cy, 0.3 * s, a, a + 1.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, cy, 0.3 * s, a + Math.PI, a + Math.PI + 1.6);
    ctx.stroke();
    return;
  }
  var air = y > 0.05;
  var phase = pos.z * 1.7;
  var bob = air ? 0 : Math.abs(Math.sin(phase)) * 0.06;
  ctx.save();
  // (leaning into a lane change)
  ctx.translate(p.x, p.y);
  ctx.rotate(cam.tilt * 0.6);
  ctx.translate(-p.x, -p.y);
  var hip = p.y - (0.9 + bob) * s;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Legs: thigh and shin, one foot up while the other is down (tucked in a jump)
  [-1, 1].forEach((side) => {
    var lift = air ? 0.32 : Math.max(0, Math.sin(phase + (side > 0 ? 0 : Math.PI))) * 0.32;
    var hx = p.x + side * 0.13 * s;
    var kx = hx + side * 0.04 * s;
    var ky = hip + (0.42 - lift * 0.6) * s;
    var fy = p.y - (0.06 + lift) * s;
    ctx.strokeStyle = "#1e3a8a";
    ctx.lineWidth = 0.19 * s;
    ctx.beginPath();
    ctx.moveTo(hx, hip);
    ctx.lineTo(kx, ky);
    ctx.lineTo(hx + side * 0.02 * s, fy);
    ctx.stroke();
    ctx.fillStyle = "#f8fafc";
    roundRect(hx + side * 0.02 * s - 0.11 * s, fy - 0.04 * s, 0.22 * s, 0.13 * s, 0.05 * s);
    ctx.fillStyle = "#ef4444";
    ctx.fillRect(hx + side * 0.02 * s - 0.11 * s, fy + 0.06 * s, 0.22 * s, 0.03 * s);
  });
  // Arms swing the other way
  [-1, 1].forEach((side) => {
    var swing = air ? -0.35 : Math.sin(phase + (side > 0 ? Math.PI : 0)) * 0.22;
    ctx.strokeStyle = dark;
    ctx.lineWidth = 0.14 * s;
    ctx.beginPath();
    ctx.moveTo(p.x + side * 0.27 * s, hip - 0.62 * s);
    ctx.lineTo(p.x + side * 0.4 * s, hip - (0.3 - swing) * s);
    ctx.lineTo(p.x + side * 0.36 * s, hip - (0.05 - swing * 1.4) * s);
    ctx.stroke();
  });
  // The hoodie, its hood and a little backpack
  var body = ctx.createLinearGradient(p.x - 0.32 * s, 0, p.x + 0.32 * s, 0);
  body.addColorStop(0, dark);
  body.addColorStop(0.5, hoodie);
  body.addColorStop(1, dark);
  ctx.fillStyle = body;
  roundRect(p.x - 0.31 * s, hip - 0.78 * s, 0.62 * s, 0.82 * s, 0.16 * s);
  ctx.fillStyle = "#334155";
  roundRect(p.x - 0.2 * s, hip - 0.62 * s, 0.4 * s, 0.42 * s, 0.08 * s);
  ctx.fillStyle = "#475569";
  ctx.fillRect(p.x - 0.14 * s, hip - 0.36 * s, 0.28 * s, 0.05 * s);
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.ellipse(p.x, hip - 0.8 * s, 0.2 * s, 0.1 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  // The head with a cap turned back
  ctx.fillStyle = "#6b3f26";
  ctx.beginPath();
  ctx.arc(p.x, hip - 1.02 * s, 0.21 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#2563eb";
  ctx.beginPath();
  ctx.arc(p.x, hip - 1.06 * s, 0.215 * s, Math.PI * 1.05, Math.PI * 1.95);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(p.x - 0.13 * s, hip - 1.0 * s, 0.26 * s, 0.07 * s);
  ctx.restore();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

/* Sparkles, dust and the "+2" of a coin - in the world, they stay where they happened */
function coinBurst(run) {
  var x = (run.x - 1) * LANE;
  for (var i = 0; i < 8; i++) {
    var a = (i / 8) * Math.PI * 2;
    particles.push({ x: x, y: 0.9, z: run.z + 0.6, vx: Math.cos(a) * 1.6, vy: Math.sin(a) * 1.6 + 1.2, vz: run.speed * 0.9, life: 0, max: 0.45, color: "255, 214, 90", size: 0.07 });
  }
  if (game && game.stake > 0 && coinBonus(run.taken) > coinBonus(run.taken - 1)) particles.push({ x: x, y: 1.6, z: run.z + 1, vx: 0, vy: 1.2, vz: run.speed, life: 0, max: 0.6, text: "+" + pct(rules.coinBonus) + "%" });
}

function dust(run) {
  var x = (run.x - 1) * LANE;
  for (var i = 0; i < 6; i++) particles.push({ x: x + (i - 2.5) * 0.12, y: 0.05, z: run.z, vx: (i - 2.5) * 0.6, vy: 0.5 + (i % 3) * 0.2, vz: run.speed * 0.7, life: 0, max: 0.4, color: "220, 200, 190", size: 0.1 });
}

function drawParticles(v, dt) {
  particles = particles.filter((q) => (q.life += dt) < q.max);
  particles.forEach((q) => {
    q.x += q.vx * dt;
    q.y = Math.max(0, q.y + q.vy * dt);
    q.vy -= 4 * dt;
    q.z += q.vz * dt;
    var p = project(v, q.x, q.y, q.z);
    if (!p) return;
    var fade = 1 - q.life / q.max;
    if (q.text) {
      ctx.font = "800 " + Math.max(12, 0.45 * p.s) + "px Poppins, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(255, 230, 120, " + fade + ")";
      ctx.fillText(q.text, p.x, p.y);
      return;
    }
    ctx.fillStyle = "rgba(" + q.color + ", " + fade + ")";
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(1, q.size * p.s), 0, Math.PI * 2);
    ctx.fill();
  });
}

// Fast: streaks at the edges
function drawSpeed(speed) {
  var k = (speed - 18) / (E.VMAX - 18);
  if (k <= 0) return;
  ctx.strokeStyle = "rgba(255, 255, 255, " + Math.min(0.35, k * 0.35) + ")";
  ctx.lineWidth = 1.5;
  var t = performance.now() / 70;
  for (var i = 0; i < 14; i++) {
    var a = (i / 14) * Math.PI * 2 + 0.3;
    var r0 = Math.max(W, H) * (0.45 + ((i * 37 + Math.floor(t)) % 10) * 0.03);
    var r1 = r0 + Math.max(W, H) * 0.12 * k;
    var cx = W / 2;
    var cy = H * 0.45;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.7);
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 * 0.7);
    ctx.stroke();
  }
}

function drawWorld(run, pos, dt) {
  // The camera glides after the runner and leans a little into a lane change
  var targetX = (pos.x - 1) * LANE * 0.6;
  var ease = 1 - Math.exp(-dt * 9);
  cam.x += (targetX - cam.x) * ease;
  cam.tilt += ((run.lane - pos.x) * 0.06 - cam.tilt) * ease;
  var v = view(pos, run.speed);
  drawSky(v, pos);
  ctx.save();
  // (the ground tilts with the camera)
  ctx.translate(W / 2, v.horizon);
  ctx.rotate(-cam.tilt * 0.35);
  ctx.translate(-W / 2, -v.horizon);
  drawGround(v, pos);
  drawLamps(v, pos);
  // The things on the track: far ones first
  var far = pos.z + VIEW;
  var things = [];
  run.rows.forEach((row) =>
    row.lanes.forEach((o, lane) => {
      if (o && o.z1 > v.camZ + 0.45 && o.z0 < far) things.push({ z: Math.max(o.z0, v.camZ + 0.5), o: o, lane: lane, row: row });
    }),
  );
  run.coins.forEach((coin) => {
    if (!coin.taken && coin.z > v.camZ + 0.5 && coin.z < far) things.push({ z: coin.z, coin: coin });
  });
  things.sort((a, b) => b.z - a.z);
  things.forEach((thing) => {
    if (thing.coin) drawCoin(v, thing.coin, run.tick);
    else if (thing.o.kind == "train") drawTrain(v, thing.o, thing.lane, thing.row);
    else if (thing.o.kind == "low") drawLow(v, thing.o, thing.lane);
    else drawHigh(v, thing.o, thing.lane);
  });
  drawRunner(v, pos, run);
  drawParticles(v, dt);
  ctx.restore();
  drawSpeed(run.speed);
  // A soft dark edge around the picture
  ctx.drawImage(
    made("vignette", W, H, (g, w, h) => {
      var vig = g.createRadialGradient(w / 2, h * 0.55, Math.min(w, h) * 0.35, w / 2, h * 0.55, Math.max(w, h) * 0.8);
      vig.addColorStop(0, "rgba(0, 0, 0, 0)");
      vig.addColorStop(1, "rgba(0, 0, 0, 0.45)");
      g.fillStyle = vig;
      g.fillRect(0, 0, w, h);
    }),
    0,
    0,
    W,
    H,
  );
}

// Between runs: the track goes by slowly, nobody on it
var idle = E.create(7);
idle.rows = [];
function frame(now) {
  if (!W || canvas.width == 0) resize();
  var dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 1 / 60;
  lastFrame = now;
  tickTo(now);
  var run = game && game.run ? game.run : idle;
  var pos;
  if (!game || !game.run) {
    idle.z += dt * 6;
    idle.tick++;
    pos = { z: idle.z, x: 1, h: 0 };
  } else {
    // (between the last two ticks: smooth on every screen)
    var a = game.over || !game.prev ? 1 : game.alpha;
    var prev = game.prev || { z: run.z, x: run.x, h: 0 };
    pos = { z: prev.z + (run.z - prev.z) * a, x: prev.x + (run.x - prev.x) * a, h: prev.h + (E.height(run) - prev.h) * a };
  }
  ctx.save();
  // (a crash: a short shake)
  var since = game && game.over && game.deadAt ? now - game.deadAt : Infinity;
  if (since < 300) ctx.translate((Math.random() - 0.5) * 8 * (1 - since / 300), (Math.random() - 0.5) * 8 * (1 - since / 300));
  drawWorld(run, pos, dt);
  ctx.restore();
  if (since < 600) {
    ctx.fillStyle = "rgba(220, 38, 38, " + 0.3 * (1 - since / 600) + ")";
    ctx.fillRect(0, 0, W, H);
  }
  drawHud(now);
  requestAnimationFrame(frame);
}

function drawHud(now) {
  var count = document.getElementById("rnCount");
  if (!game || !game.run) {
    count.hidden = true;
    return;
  }
  // 3 - 2 - 1 before the start
  var left = game.startAt - now;
  count.hidden = !(left > 0);
  if (left > 0) {
    var n = String(Math.ceil((left / rules.countdown) * 3));
    if (count.textContent != n) {
      count.textContent = n;
      count.classList.remove("pop");
      void count.offsetWidth;
      count.classList.add("pop");
    }
  }
  // (the numbers only when they change - writing the page every frame costs and flickers)
  var meters = Math.floor(game.run.z);
  var key = meters + ":" + game.run.taken;
  if (hudKey == key) return;
  hudKey = key;
  document.getElementById("rnDistance").innerText = formatCoins(meters) + " m";
  document.getElementById("rnCoins").innerText = game.run.taken + (game.stake > 0 ? " · +" + pct(coinBonus(game.run.taken)) + "%" : "");
  var pay = document.getElementById("rnPay");
  var bar = document.getElementById("rnBar");
  if (game.stake > 0) {
    var x = multiplier(meters);
    document.getElementById("rnPayLabel").innerText = "Payout";
    pay.innerText = "🪙 " + formatCoins(payout(game.stake, meters, game.run.taken));
    pay.classList.toggle("even", x >= 1);
    // (how far to the entry back - then to the most)
    var t = rules.table;
    var share = meters < t.even ? meters / t.even : (meters - t.even) / (t.top - t.even);
    bar.style.width = Math.min(100, share * 100) + "%";
    bar.classList.toggle("over", meters >= t.even);
    bar.parentNode.hidden = false;
  } else {
    document.getElementById("rnPayLabel").innerText = "Practice";
    pay.innerText = "No payout";
    pay.classList.remove("even");
    bar.parentNode.hidden = true;
  }
}
var hudKey = null;

resize();
requestAnimationFrame(frame);
