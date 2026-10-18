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
var stake = 0; // the entry picked (0: practice)
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
  renderStakes();
});
socket.on("runnerSetup", (data) => {
  rules = data.rules;
  best = data.best || 0;
  try {
    var saved = Number(localStorage.getItem(STAKE_KEY));
    if (saved === 0 || rules.stakes.includes(saved)) stake = saved;
  } catch (error) {}
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

// What a score pays (the same curve as the server's game/runner.js)
function multiplier(score) {
  var t = rules.table;
  if (score < t.min) return 0;
  if (score < t.even) return Math.round((score / t.even) * 1000) / 1000;
  return Math.min(t.max, Math.round((1 + rules.slope * (score / t.even - 1)) * 1000) / 1000);
}

function renderStakes() {
  if (!rules) return;
  var box = document.getElementById("rnStakes");
  var buttons = [0].concat(rules.stakes).map((value) => {
    var b = el("button", "rn-stake" + (value == stake ? " active" : ""), value == 0 ? "Practice" : "🪙 " + formatCoins(value));
    b.type = "button";
    b.disabled = value > myCoins;
    b.addEventListener("click", () => {
      stake = value;
      try {
        localStorage.setItem(STAKE_KEY, String(value));
      } catch (error) {}
      renderPanel();
    });
    return b;
  });
  box.replaceChildren(...buttons);
}

function renderPanel() {
  if (!rules) return;
  var panel = document.getElementById("rnPanel");
  var running = game && !game.over;
  panel.hidden = running;
  document.getElementById("rnHud").hidden = !game;
  renderStakes();
  // The pay table: where it starts, the entry back, the most
  var t = rules.table;
  var table = document.getElementById("rnTable");
  table.replaceChildren(
    ...[
      [formatCoins(t.min) + " m", t.minMult + "×", ""],
      [formatCoins(t.even) + " m", "1×", "even"],
      [formatCoins(t.top) + " m", t.max + "×", "top"],
    ].map(([at, x, kind]) => {
      var row = el("span", "rn-table-item " + kind);
      row.append(el("span", "rn-table-at", at), el("span", "rn-table-x", x));
      return row;
    }),
  );
  table.hidden = stake == 0;
  var start = document.getElementById("rnStart");
  start.innerText = game && game.over ? (stake == 0 ? "Practice again" : "Run again for 🪙 " + formatCoins(stake)) : stake == 0 ? "Start practice" : "Run for 🪙 " + formatCoins(stake);
  start.disabled = (stake > 0 && stake > myCoins) || (game && game.over && !game.result);
  document.getElementById("rnBest").innerText = best ? "Your best: " + formatCoins(best) + " points" : "";
  // The result of the last run
  var result = document.getElementById("rnResult");
  var r = game && game.over ? game.result : null;
  result.hidden = !(game && game.over);
  if (game && game.over && !r) {
    result.replaceChildren(el("div", "rn-result-wait mm-muted", "Checking your run..."));
  } else if (r) {
    var head = el("div", "rn-result-score", formatCoins(r.score) + " points");
    var sub = el("div", "rn-result-sub mm-muted", formatCoins(r.distance) + " m and " + r.coins + (r.coins == 1 ? " coin" : " coins"));
    var pay = r.practice ? el("div", "rn-result-pay mm-muted", "Practice run") : el("div", "rn-result-pay" + (r.win >= r.stake ? " won" : r.win > 0 ? " part" : " lost"), r.win > 0 ? "You get 🪙 " + formatCoins(r.win) + " (" + r.multiplier + "×)" : "No payout this time");
    result.replaceChildren(head, sub, pay);
    if (r.record) result.appendChild(el("div", "rn-result-record", "🏆 New best"));
  }
}

document.getElementById("rnStart").addEventListener("click", () => {
  if (!rules || (game && !game.over)) return;
  game = { pending: true };
  document.getElementById("rnStart").disabled = true;
  socket.emit("runStart", { stake: stake });
});

/* ---------- A run ---------- */

function startRun(data) {
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

function tickTo(now) {
  if (!game || game.over || !game.run || now < game.startAt) return;
  var target = Math.floor(((now - game.startAt) / 1000) * E.TPS);
  // (a long stall - never more than half a second at once)
  var steps = 0;
  while (game.run.tick < target && steps < 30 && !game.run.dead) {
    var move = game.queue.length ? game.queue.shift() : null;
    if (move) game.moves.push([game.run.tick, move]);
    E.step(game.run, move);
    steps++;
  }
  if (game.run.dead) crash(false);
}

/* ---------- Controls: keys and swipes ---------- */

var KEYS = { ArrowLeft: "L", KeyA: "L", ArrowRight: "R", KeyD: "R", ArrowUp: "J", KeyW: "J", Space: "J", ArrowDown: "D", KeyS: "D" };
document.addEventListener("keydown", (event) => {
  if (event.target && (event.target.tagName == "INPUT" || event.target.tagName == "TEXTAREA")) return;
  var move = KEYS[event.code];
  if (!move) {
    // (Enter: run again)
    if (event.code == "Enter" && (!game || game.over) && !document.getElementById("rnStart").disabled && stageVisible()) document.getElementById("rnStart").click();
    return;
  }
  if (game && !game.over && game.run) {
    event.preventDefault();
    if (!event.repeat) input(move);
  }
});

var touch = null;
var stage = document.getElementById("rnStage");
stage.addEventListener(
  "touchstart",
  (event) => {
    if (!game || game.over) return;
    var t = event.changedTouches[0];
    touch = { x: t.clientX, y: t.clientY, done: false };
  },
  { passive: true },
);
stage.addEventListener(
  "touchmove",
  (event) => {
    if (!touch || touch.done || !game || game.over) return;
    event.preventDefault();
    var t = event.changedTouches[0];
    var dx = t.clientX - touch.x;
    var dy = t.clientY - touch.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    touch.done = true;
    input(Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "L" : "R") : dy < 0 ? "J" : "D");
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
var CAM_BACK = 4.2; // the camera: this far behind the runner ...
var CAM_H = 3.1; // ... this high
var VIEW = 110; // m seen ahead
var TRAIN_COLORS = [
  ["#c2410c", "#ea580c", "#fdba74"],
  ["#1d4ed8", "#3b82f6", "#bfdbfe"],
  ["#15803d", "#22c55e", "#bbf7d0"],
  ["#7e22ce", "#a855f7", "#e9d5ff"],
];

function resize() {
  var rect = canvas.getBoundingClientRect();
  var dpr = Math.min(2, window.devicePixelRatio || 1);
  W = rect.width;
  H = rect.height;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resize);

// The view of the moment: where the camera is
function view(run) {
  // (the ground at the runner near the bottom - and all three lanes in the picture on a narrow screen too)
  var focal = Math.min((H * 0.7 * 0.82 * CAM_BACK) / CAM_H, (W * CAM_BACK) / (LANE * 2.5));
  var horizon = Math.min(H * 0.42, H * 0.9 - (CAM_H * focal) / CAM_BACK);
  return { horizon: horizon, focal: focal, camZ: run.z - CAM_BACK, camX: (run.x - 1) * LANE * 0.55 };
}

// A point of the world (x across, y up, z along the track) on the screen - null: behind the camera
function project(v, x, y, z) {
  var d = z - v.camZ;
  if (d < 0.4) return null;
  var s = v.focal / d;
  return { x: W / 2 + (x - v.camX) * s, y: v.horizon + (CAM_H - y) * s, s: s };
}

function quad(v, points, fill) {
  var p = points.map((pt) => project(v, pt[0], pt[1], pt[2]));
  if (p.some((pt) => pt == null)) return;
  ctx.beginPath();
  ctx.moveTo(p[0].x, p[0].y);
  for (var i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawWorld(run) {
  var v = view(run);
  // Sky and the city far away
  var sky = ctx.createLinearGradient(0, 0, 0, v.horizon);
  sky.addColorStop(0, "#1e1b4b");
  sky.addColorStop(1, "#f59e0b");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, v.horizon + 1);
  ctx.fillStyle = "#312e81";
  var shift = -v.camX * 6;
  for (var b = -2; b < 24; b++) {
    var bw = W / 14;
    var bh = (0.25 + ((b * 37) % 11) / 18) * v.horizon * 0.8;
    ctx.fillRect(((b * bw + shift) % (W + bw * 4)) - bw * 2, v.horizon - bh, bw * 0.9, bh);
  }
  // The ground
  ctx.fillStyle = "#3f3a36";
  ctx.fillRect(0, v.horizon, W, H - v.horizon);
  var far = run.z + VIEW;
  // Lanes: gravel beds, sleepers, two rails each
  for (var lane = 0; lane < 3; lane++) {
    var cx = (lane - 1) * LANE;
    quad(v, [[cx - 1.15, 0, v.camZ + 0.5], [cx + 1.15, 0, v.camZ + 0.5], [cx + 1.15, 0, far], [cx - 1.15, 0, far]], "#57504a");
    var first = Math.ceil((v.camZ + 0.5) / 1.6) * 1.6;
    for (var z = first; z < far; z += 1.6) quad(v, [[cx - 0.95, 0, z], [cx + 0.95, 0, z], [cx + 0.95, 0, z + 0.35], [cx - 0.95, 0, z + 0.35]], "#6b4f3a");
    [-0.55, 0.55].forEach((off) => quad(v, [[cx + off - 0.06, 0.05, v.camZ + 0.5], [cx + off + 0.06, 0.05, v.camZ + 0.5], [cx + off + 0.06, 0.05, far], [cx + off - 0.06, 0.05, far]], "#c7ccd4"));
  }
  // Haze toward the horizon
  var haze = ctx.createLinearGradient(0, v.horizon, 0, v.horizon + H * 0.18);
  haze.addColorStop(0, "rgba(245, 158, 11, 0.45)");
  haze.addColorStop(1, "rgba(245, 158, 11, 0)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, v.horizon, W, H * 0.18);

  // The things on the track: far ones first
  var things = [];
  run.rows.forEach((row) =>
    row.lanes.forEach((o, lane) => {
      if (o && o.z1 > v.camZ + 0.5 && o.z0 < far) things.push({ z: Math.max(o.z0, v.camZ + 0.6), o: o, lane: lane, row: row });
    }),
  );
  run.coins.forEach((coin) => {
    if (!coin.taken && coin.z > v.camZ + 0.6 && coin.z < far) things.push({ z: coin.z, coin: coin });
  });
  things.sort((a, b) => b.z - a.z);
  things.forEach((thing) => {
    if (thing.coin) drawCoin(v, thing.coin, run);
    else if (thing.o.kind == "train") drawTrain(v, thing.o, thing.lane, thing.row);
    else if (thing.o.kind == "low") drawLow(v, thing.o, thing.lane);
    else drawHigh(v, thing.o, thing.lane);
  });
  drawRunner(v, run);
}

function drawTrain(v, o, lane, row) {
  var cx = (lane - 1) * LANE;
  var hw = 1.1;
  var top = 3.2;
  var near = Math.max(o.z0, v.camZ + 0.6);
  var colors = TRAIN_COLORS[Math.floor(row.z) % TRAIN_COLORS.length];
  // (the side the camera sees)
  var side = cx - v.camX > 0 ? cx - hw : cx + hw;
  quad(v, [[side, 0, near], [side, top, near], [side, top, o.z1], [side, 0, o.z1]], colors[0]);
  quad(v, [[cx - hw, top, near], [cx + hw, top, near], [cx + hw, top, o.z1], [cx - hw, top, o.z1]], colors[1]);
  if (o.z0 < v.camZ + 0.6) return;
  // The back of the train: windows, lights
  quad(v, [[cx - hw, 0, o.z0], [cx + hw, 0, o.z0], [cx + hw, top, o.z0], [cx - hw, top, o.z0]], colors[1]);
  quad(v, [[cx - 0.85, 1.7, o.z0 - 0.01], [cx - 0.1, 1.7, o.z0 - 0.01], [cx - 0.1, 2.7, o.z0 - 0.01], [cx - 0.85, 2.7, o.z0 - 0.01]], "#1e293b");
  quad(v, [[cx + 0.1, 1.7, o.z0 - 0.01], [cx + 0.85, 1.7, o.z0 - 0.01], [cx + 0.85, 2.7, o.z0 - 0.01], [cx + 0.1, 2.7, o.z0 - 0.01]], "#1e293b");
  quad(v, [[cx - hw, 0.25, o.z0 - 0.01], [cx + hw, 0.25, o.z0 - 0.01], [cx + hw, 0.5, o.z0 - 0.01], [cx - hw, 0.5, o.z0 - 0.01]], colors[2]);
  [-0.75, 0.75].forEach((off) => {
    var p = project(v, cx + off, 0.95, o.z0 - 0.02);
    if (!p) return;
    ctx.fillStyle = "#fde68a";
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(1.5, 0.16 * p.s), 0, Math.PI * 2);
    ctx.fill();
  });
}

// A low barrier: jump over it - red and white stripes near the ground
function drawLow(v, o, lane) {
  var cx = (lane - 1) * LANE;
  [-1.05, 0.95].forEach((off) => quad(v, [[cx + off, 0, o.z0], [cx + off + 0.1, 0, o.z0], [cx + off + 0.1, 0.9, o.z0], [cx + off, 0.9, o.z0]], "#9ca3af"));
  for (var i = 0; i < 6; i++) {
    var x0 = cx - 1.1 + (i * 2.2) / 6;
    quad(v, [[x0, 0.45, o.z0], [x0 + 2.2 / 6, 0.45, o.z0], [x0 + 2.2 / 6, 0.9, o.z0], [x0, 0.9, o.z0]], i % 2 ? "#f8fafc" : "#dc2626");
  }
}

// A high bar: roll under it - yellow and black up high, posts at the sides
function drawHigh(v, o, lane) {
  var cx = (lane - 1) * LANE;
  [-1.15, 1.05].forEach((off) => quad(v, [[cx + off, 0, o.z0], [cx + off + 0.1, 0, o.z0], [cx + off + 0.1, 2.3, o.z0], [cx + off, 2.3, o.z0]], "#64748b"));
  for (var i = 0; i < 8; i++) {
    var x0 = cx - 1.15 + (i * 2.3) / 8;
    quad(v, [[x0, 1.25, o.z0], [x0 + 2.3 / 8, 1.25, o.z0], [x0 + 2.3 / 8, 2.1, o.z0], [x0, 2.1, o.z0]], i % 2 ? "#111827" : "#facc15");
  }
}

function drawCoin(v, coin, run) {
  var p = project(v, (coin.lane - 1) * LANE, 0.7, coin.z);
  if (!p) return;
  var r = 0.32 * p.s;
  var spin = Math.abs(Math.cos(run.tick / 9 + coin.z));
  ctx.fillStyle = "#b45309";
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, Math.max(1, r * spin), r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#facc15";
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, Math.max(0.6, r * spin * 0.75), r * 0.75, 0, 0, Math.PI * 2);
  ctx.fill();
}

// The runner from behind: a hoodie, a cap, legs going - in the air when jumping, a ball when rolling
function drawRunner(v, run) {
  var x = (run.x - 1) * LANE;
  var y = E.height(run);
  var ground = project(v, x, 0, run.z);
  var p = project(v, x, y, run.z);
  if (!ground || !p) return;
  var s = p.s;
  // (the shadow on the ground)
  ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
  ctx.beginPath();
  ctx.ellipse(ground.x, ground.y, 0.45 * s * (1 - y / 4), 0.12 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  var dead = run.dead;
  if (run.roll && !dead) {
    ctx.fillStyle = "#f97316";
    ctx.beginPath();
    ctx.arc(p.x, p.y - 0.42 * s, 0.42 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#7c2d12";
    ctx.lineWidth = Math.max(1, 0.06 * s);
    ctx.beginPath();
    ctx.arc(p.x, p.y - 0.42 * s, 0.28 * s, run.tick / 3, run.tick / 3 + 2);
    ctx.stroke();
    return;
  }
  var phase = (run.z * 1.6) % (Math.PI * 2);
  var stride = y > 0 ? 0.15 : Math.sin(phase) * 0.22;
  ctx.lineCap = "round";
  // Legs
  ctx.strokeStyle = "#1e3a8a";
  ctx.lineWidth = 0.17 * s;
  [-1, 1].forEach((side) => {
    ctx.beginPath();
    ctx.moveTo(p.x + side * 0.14 * s, p.y - 0.85 * s);
    ctx.lineTo(p.x + side * 0.16 * s, p.y - (0.12 + side * stride) * s);
    ctx.stroke();
  });
  // Shoes
  ctx.fillStyle = "#f8fafc";
  [-1, 1].forEach((side) => ctx.fillRect(p.x + side * 0.16 * s - 0.1 * s, p.y - (0.14 + side * stride) * s, 0.2 * s, 0.12 * s));
  // Body
  ctx.fillStyle = dead ? "#9a3412" : "#f97316";
  roundRect(p.x - 0.3 * s, p.y - 1.55 * s, 0.6 * s, 0.75 * s, 0.14 * s);
  // Arms
  ctx.strokeStyle = dead ? "#9a3412" : "#ea580c";
  ctx.lineWidth = 0.13 * s;
  [-1, 1].forEach((side) => {
    ctx.beginPath();
    ctx.moveTo(p.x + side * 0.28 * s, p.y - 1.45 * s);
    ctx.lineTo(p.x + side * 0.4 * s, p.y - (1.0 - side * stride * 0.8) * s);
    ctx.stroke();
  });
  // Head with a cap (from behind)
  ctx.fillStyle = "#7c4a2d";
  ctx.beginPath();
  ctx.arc(p.x, p.y - 1.78 * s, 0.22 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#2563eb";
  ctx.beginPath();
  ctx.arc(p.x, p.y - 1.84 * s, 0.22 * s, Math.PI, 0);
  ctx.fill();
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

// Between runs: a quiet track with the runner standing
var idle = E.create(7);
function frame(now) {
  if (!W || canvas.width == 0) resize();
  tickTo(now);
  var run = game && game.run ? game.run : idle;
  if (!game || !game.run) {
    // (the waiting track moves slowly)
    idle.z += 0.04;
    idle.tick++;
    while (idle.next < idle.z + 120) {
      idle.rows.length = 0;
      idle.next += 25;
    }
  }
  ctx.save();
  // (a crash: the screen shakes a moment)
  if (game && game.over && game.deadAt && now - game.deadAt < 400) ctx.translate((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
  drawWorld(run);
  ctx.restore();
  if (game && game.over && game.deadAt && now - game.deadAt < 500) {
    ctx.fillStyle = "rgba(220, 38, 38, " + (0.35 * (1 - (now - game.deadAt) / 500)) + ")";
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
  if (left > 0) count.innerText = String(Math.ceil((left / rules.countdown) * 3));
  var score = E.score(game.run);
  document.getElementById("rnDistance").innerText = formatCoins(Math.floor(game.run.z)) + " m";
  document.getElementById("rnCoins").innerText = String(game.run.taken);
  var pay = document.getElementById("rnPay");
  if (game.stake > 0) {
    var x = multiplier(score);
    document.getElementById("rnPayLabel").innerText = "Payout";
    pay.innerText = x > 0 ? "🪙 " + formatCoins(Math.floor(game.stake * x)) + " · " + x.toFixed(2) + "×" : "🪙 0";
    pay.classList.toggle("even", x >= 1);
  } else {
    document.getElementById("rnPayLabel").innerText = "Practice";
    pay.innerText = formatCoins(score) + " points";
    pay.classList.remove("even");
  }
}

resize();
requestAnimationFrame(frame);
