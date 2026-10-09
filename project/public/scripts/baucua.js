/* Bầu cua: the server takes the bets, rolls the three dice and pays - this page shows the round. */
const socket = io((window.CASINO_NS || "") + "/baucua");

var myName = null;
var myCoins = 0;
var myCapRule = null; // the max bet by balance ({floor, share} - null: no cap), see casinoCapLeft
// What more I may bet this round (`already`: my coins in it)
function capLeft(already) {
  return casinoCapLeft(myCapRule, myCoins, already);
}
var table = null; // the last state of the round
var rules = null;
var rolledRound = null; // the round whose roll plays (or played) on this page
var rolling = false; // the bowl shakes here right now
var AMOUNT_KEY = "baucuaAmount";
var shownRolls = null; // the rounds in the row of last rolls (a new one fades in)

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

function animalOf(id) {
  return rules.animals.find((animal) => animal.id == id);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ---------- Socket ---------- */

socket.on("connect", () => (document.getElementById("connectionBanner").hidden = true));
socket.on("disconnect", () => (document.getElementById("connectionBanner").hidden = false));
socket.on("connect_error", (error) => {
  if (error && error.message == "unauthorized") window.location.href = "/?next=" + encodeURIComponent(location.pathname + location.search);
});
// The admin took the access away: the page again - it asks for access now
socket.on("casinoClosed", () => window.location.reload());
// The admin turned this game off: on to another one
socket.on("gameOff", () => (window.location.href = "./"));
window.addEventListener("pagehide", () => socket.disconnect());
window.addEventListener("pageshow", (event) => {
  if (event.persisted) socket.connect();
});

socket.on("joined", (data) => (myName = data.username));
socket.on("coins", (data) => {
  myCoins = data.coins;
  myCapRule = data.betCapRule || null;
  // While the bowl shakes the balance shows the coins before the win
  if (!rolling) renderCoins();
  renderControls();
});
socket.on("baucuaError", (message) => showHint(message, "error"));

socket.on("baucuaState", (state) => {
  var first = table == null;
  table = state;
  rules = state.rules;
  if (first) {
    buildBoard();
    // The dice of the last round (or three to start with) - the bowl lifted
    showDice(state.history.length ? state.history[0].dice : ["crab", "fish", "tiger"], true);
  }
  if (state.phase == "rolling" && rolledRound != state.round) playRoll(state);
  renderBoard();
  renderHistory();
  renderRounds();
  renderFair();
  renderControls();
  renderStatus();
});

/* ---------- The plate: three dice under the bowl ---------- */

function dieFace(id) {
  var die = el("div", "bc-die");
  die.dataset.animal = id;
  die.appendChild(baucuaIcon(id));
  return die;
}

// The dice on the plate (idle: pale - an old roll or the start)
function showDice(dice, idle) {
  var box = document.getElementById("bcDice");
  box.replaceChildren(
    ...dice.map((id, i) => {
      var die = dieFace(id);
      die.style.setProperty("--tilt", [-8, 6, -3][i] + "deg");
      return die;
    }),
  );
  box.classList.toggle("idle", !!idle);
}

/*
 * The roll: the bowl comes down over the plate, shakes, and is lifted - the
 * new dice show. A page that comes in late joins in where the roll is.
 */
async function playRoll(state) {
  rolledRound = state.round;
  rolling = true;
  var bowl = document.getElementById("bcBowl");
  var plate = document.querySelector(".bc-plate");
  clearResult();
  var spin = rules.spin;
  var done = spin - (state.rollLeft || 0); // ms of the roll already over
  var cover = 450;
  var lift = spin - 1700; // the bowl goes up here
  bowl.getAnimations().forEach((a) => a.cancel());
  // Down
  bowl.classList.add("down");
  if (done < cover) {
    await bowl.animate([{ transform: "translate(-50%, -60%)", opacity: 0 }, { transform: "translate(-50%, 0)", opacity: 1 }], { duration: cover - done, easing: "cubic-bezier(0.3, 0.7, 0.4, 1)" }).finished.catch(() => {});
    done = cover;
  }
  // (the new dice wait under it)
  showDice(state.dice, false);
  document.getElementById("bcDice").classList.add("hidden");
  // Shake
  if (done < lift) {
    var shake = bowl.animate(
      [
        { transform: "translate(-50%, 0) rotate(0)" },
        { transform: "translate(calc(-50% - 9px), -4px) rotate(-6deg)" },
        { transform: "translate(calc(-50% + 8px), 2px) rotate(5deg)" },
        { transform: "translate(calc(-50% - 6px), -3px) rotate(-4deg)" },
        { transform: "translate(calc(-50% + 9px), 1px) rotate(6deg)" },
        { transform: "translate(-50%, 0) rotate(0)" },
      ],
      { duration: 520, iterations: Math.max(1, Math.round((lift - done) / 520)) },
    );
    plate.classList.add("shaking");
    await Promise.race([shake.finished.catch(() => {}), wait(lift - done)]);
    shake.cancel();
    plate.classList.remove("shaking");
    done = lift;
  }
  // Up: the dice
  document.getElementById("bcDice").classList.remove("hidden");
  var up = Math.max(0, Math.min(900, spin - done - 600));
  if (up > 0) {
    await bowl
      .animate([{ transform: "translate(-50%, 0) rotate(0)", opacity: 1 }, { transform: "translate(-50%, -14%) rotate(-4deg)", opacity: 1, offset: 0.35 }, { transform: "translate(-50%, -60%) rotate(-8deg)", opacity: 0 }], { duration: up, easing: "cubic-bezier(0.5, 0, 0.6, 1)" })
      .finished.catch(() => {});
  }
  bowl.classList.remove("down");
  document.querySelectorAll(".bc-die").forEach((die, i) => die.animate([{ transform: "scale(0.6) rotate(var(--tilt))", opacity: 0.3 }, { transform: "scale(1.15) rotate(var(--tilt))", opacity: 1 }, { transform: "scale(1) rotate(var(--tilt))", opacity: 1 }], { duration: 450, delay: i * 120, easing: "ease-out" }));
  await wait(Math.max(0, Math.min(600, spin - done - up)));
  rolling = false;
  showResult(state);
  renderHistory();
  renderRounds();
  renderFair();
  renderControls();
}

// The bowl is up: the animals that came light up (×2 / ×3 / ×10), what I won
function showResult(state) {
  var dice = state.dice;
  document.querySelectorAll(".bc-animal").forEach((tile) => {
    var k = dice.filter((id) => id == tile.dataset.animal).length;
    tile.classList.toggle("hit", k > 0);
    tile.classList.toggle("miss", k == 0);
    var badge = tile.querySelector(".bc-hit");
    badge.hidden = k == 0;
    badge.innerText = k ? "×" + rules.payout[k] : "";
    badge.classList.toggle("triple", k == 3);
  });
  document.querySelectorAll(".bc-die").forEach((die) => die.classList.toggle("mine", table.bets.some((bet) => bet.name == myName && bet.animal == die.dataset.animal)));
  var won = table.bets.filter((bet) => bet.name == myName).reduce((sum, bet) => sum + bet.amount * rules.payout[dice.filter((id) => id == bet.animal).length], 0);
  var status = document.getElementById("bcStatus");
  var triple = dice[0] == dice[1] && dice[1] == dice[2];
  status.className = "rl-status-text" + (won > 0 ? " bc-won" : "");
  status.innerText = won > 0 ? "You won 🪙 " + formatCoins(won) + "!" : triple ? "Three times " + animalOf(dice[0]).name + "!" : dice.map((id) => animalOf(id).name).join(" · ");
  document.querySelector(".bc-plate").classList.toggle("triple", triple);
  renderCoins();
}

function clearResult() {
  document.querySelectorAll(".bc-animal").forEach((tile) => {
    tile.classList.remove("hit", "miss");
    tile.querySelector(".bc-hit").hidden = true;
  });
  document.querySelectorAll(".bc-die").forEach((die) => die.classList.remove("mine"));
  document.querySelector(".bc-plate").classList.remove("triple");
}

/* ---------- The board: six animals ---------- */

function buildBoard() {
  document.getElementById("bcBoard").replaceChildren(
    ...rules.animals.map((animal) => {
      var tile = el("button", "bc-animal");
      tile.type = "button";
      tile.dataset.animal = animal.id;
      var art = el("span", "bc-animal-art");
      art.appendChild(baucuaIcon(animal.id));
      var name = el("span", "bc-animal-name");
      name.append(el("b", "", animal.vn), el("small", "", animal.name));
      var foot = el("span", "bc-animal-foot");
      foot.append(el("span", "bc-animal-players"), el("span", "bc-animal-total", ""));
      tile.append(el("span", "bc-hit"), art, name, el("span", "bc-animal-mine"), foot);
      tile.querySelector(".bc-hit").hidden = true;
      tile.addEventListener("click", () => place(animal.id));
      return tile;
    }),
  );
}

function renderBoard() {
  rules.animals.forEach((animal) => {
    var tile = document.querySelector('.bc-animal[data-animal="' + animal.id + '"]');
    var bets = table.bets.filter((bet) => bet.animal == animal.id);
    var players = new Map();
    bets.forEach((bet) => players.set(bet.name, (players.get(bet.name) || 0) + bet.amount));
    var names = [...players].sort((a, b) => b[1] - a[1]).map(([name]) => name);
    var total = bets.reduce((sum, bet) => sum + bet.amount, 0);
    tile.querySelector(".bc-animal-total").innerText = total ? "🪙 " + formatCoins(total) : "";
    var faces = tile.querySelector(".bc-animal-players");
    faces.replaceChildren(
      ...names.slice(0, 4).map((name) => {
        var face = createAvatar(name, "sm");
        face.title = name + ": 🪙 " + formatCoins(players.get(name));
        return face;
      }),
    );
    if (names.length > 4) faces.appendChild(el("span", "bc-more", "+" + (names.length - 4)));
    var mine = players.get(myName) || 0;
    tile.querySelector(".bc-animal-mine").innerText = mine ? "You: 🪙 " + formatCoins(mine) : "";
    tile.classList.toggle("has-mine", mine > 0);
  });
  // A new round (after the pause of the last one): the board is clean again, the dice of the last roll pale
  if (table.phase != "rolling" && !rolling) {
    clearResult();
    document.getElementById("bcDice").classList.add("idle");
  }
}

/* ---------- Last rolls ---------- */

function rollChip(entry, fresh) {
  var chip = el("span", "bc-roll" + (fresh ? " fresh" : "") + (entry.dice[0] == entry.dice[1] && entry.dice[1] == entry.dice[2] ? " triple" : ""));
  entry.dice.forEach((id) => chip.appendChild(baucuaIcon(id)));
  chip.title = "Round " + entry.round + ": " + entry.dice.map((id) => animalOf(id).name).join(", ");
  return chip;
}

function renderHistory() {
  var list = document.getElementById("bcHistory");
  // (while the bowl shakes the newest is not known on this page yet)
  var history = table.history.filter((entry) => !(rolling && entry.round == table.round));
  var before = shownRolls;
  shownRolls = new Set(history.map((entry) => entry.round));
  list.replaceChildren(...history.slice(0, 5).map((entry) => rollChip(entry, before && !before.has(entry.round))));
}

function renderRounds() {
  var list = document.getElementById("bcRounds");
  var history = table.history.filter((entry) => !(rolling && entry.round == table.round));
  document.getElementById("bcRoundsEmpty").hidden = history.length > 0;
  list.replaceChildren(
    ...history.slice(0, 10).map((entry) => {
      var item = el("li", "jp-history-item bc-round");
      item.appendChild(rollChip(entry, false));
      var info = el("div", "jp-history-text");
      var players = entry.players || 0;
      info.append(el("b", "", "Round " + entry.round), el("small", "", entry.won + " / " + players + (players == 1 ? " player" : " players") + " won"));
      item.appendChild(info);
      item.appendChild(el("span", "jp-history-won", entry.paid > 0 ? "🪙 " + formatCoins(entry.paid) : ""));
      return item;
    }),
  );
}

function renderFair() {
  var fair = document.getElementById("bcFair");
  var part = (label, value) => {
    var box = el("span", "jp-fair-part");
    box.append(el("span", "jp-fair-label", label), el("code", "", value));
    return box;
  };
  var parts = [el("i", "bi bi-shield-check"), part("Round hash", table.fair.hash)];
  if (table.fair.seed && !rolling) parts.push(part("Seed", table.fair.seed));
  fair.title = 'Provably fair: die i (0, 1, 2) comes from the seed (hmac-sha256(seed, "baucua:" + round + ":" + i)). sha256(seed) = round hash';
  fair.replaceChildren(...parts);
}

/* ---------- The round ---------- */

var statusFrame = null;
var barAnimation = null;
var timerRound = null;
var timerEndsAt = 0;
function renderStatus() {
  var status = document.getElementById("bcStatus");
  var bar = document.getElementById("bcTimer");
  if (table.phase != "betting") {
    cancelAnimationFrame(statusFrame);
    if (barAnimation) barAnimation.cancel();
    barAnimation = null;
    timerRound = null;
    bar.style.width = "0%";
    if (rolling) {
      status.className = "rl-status-text";
      status.innerText = "Shaking...";
    } else if (table.phase == "idle") {
      status.className = "rl-status-text";
      status.innerText = "Place a bet to start the round";
    }
    return;
  }
  // The timer of this round runs already: it goes on as it is (every new bet sends the state again)
  var endsAt = performance.now() + table.timeLeft;
  if (timerRound == table.round && barAnimation && Math.abs(endsAt - timerEndsAt) < 400) return;
  timerRound = table.round;
  timerEndsAt = endsAt;
  cancelAnimationFrame(statusFrame);
  var from = Math.min(1, table.timeLeft / rules.timer);
  if (barAnimation) barAnimation.cancel();
  bar.style.width = "100%";
  barAnimation = bar.animate([{ transform: "scaleX(" + from + ")" }, { transform: "scaleX(0)" }], { duration: table.timeLeft, easing: "linear", fill: "forwards" });
  var shown = null;
  var tick = () => {
    var left = Math.max(0, timerEndsAt - performance.now());
    var seconds = Math.ceil(left / 1000);
    if (seconds != shown) {
      shown = seconds;
      status.className = "rl-status-text";
      status.replaceChildren("Shaking in ", el("span", "rl-seconds" + (seconds <= 3 ? " soon" : ""), seconds + "s"));
    }
    if (left > 0) statusFrame = requestAnimationFrame(tick);
  };
  tick();
}

/* ---------- Amount and bets ---------- */

function renderCoins() {
  document.getElementById("bcCoins").innerText = "🪙 " + formatCoins(myCoins);
}

function amount() {
  return Math.floor(Number(document.getElementById("bcAmount").value));
}

function setAmount(value) {
  var input = document.getElementById("bcAmount");
  input.value = Math.max(0, Math.floor(value)) || "";
  try {
    localStorage.setItem(AMOUNT_KEY, input.value);
  } catch (error) {
    // not remembered
  }
  renderControls();
}

// My bets this round, all animals together
function myTotal() {
  return table ? table.bets.filter((bet) => bet.name == myName).reduce((sum, bet) => sum + bet.amount, 0) : 0;
}

// What is still allowed this round
function roomLeft() {
  return Math.max(0, rules.maxBet - myTotal());
}

var CHIPS = [
  ["Clear", () => 0],
  ["+10", (v) => v + 10],
  ["+100", (v) => v + 100],
  ["+1K", (v) => v + 1000],
  ["½", (v) => v / 2],
  ["×2", (v) => v * 2],
  ["Max", () => Math.min(myCoins, roomLeft(), capLeft(myTotal()))],
];

function buildChips() {
  var box = document.getElementById("bcChips");
  box.replaceChildren(
    ...CHIPS.map(([label, change]) => {
      var chip = el("button", "rl-chip", label);
      chip.type = "button";
      chip.addEventListener("click", () => rules && setAmount(Math.min(change(amount() || 0), rules.maxBet)));
      return chip;
    }),
  );
}

function renderControls() {
  if (!table) return;
  var value = amount();
  var open = table.phase != "rolling" && !rolling;
  document.querySelectorAll(".bc-animal").forEach((tile) => {
    var name = animalOf(tile.dataset.animal).name.toLowerCase();
    var overCap = value > capLeft(myTotal());
    tile.disabled = !open || !(value >= rules.minBet) || value > myCoins || value > roomLeft() || overCap;
    tile.title = !open ? "The dice are rolling - the next round soon" : value > roomLeft() ? "At most 🪙 " + formatCoins(rules.maxBet) + " per round" : value > myCoins ? "Not enough coins" : overCap ? "With your balance at most 🪙 " + formatCoins(capLeft(myTotal())) + " more this round" : "Bet 🪙 " + formatCoins(value || 0) + " on the " + name;
  });
}

function place(animal) {
  if (!rules) return;
  var value = amount();
  if (!(value >= rules.minBet)) return showHint("At least 🪙 " + formatCoins(rules.minBet) + " per bet.", "error", document.getElementById("bcAmount"));
  socket.emit("bet", { animal: animal, amount: value });
}

document.addEventListener("DOMContentLoaded", () => {
  setupChat();
  buildChips();
  var input = document.getElementById("bcAmount");
  var saved = null;
  try {
    saved = localStorage.getItem(AMOUNT_KEY);
  } catch (error) {
    // nothing saved
  }
  input.value = saved || 100;
  input.addEventListener("input", () => setAmount(amount()));
});

// The whole game a bit smaller when the screen isn't high enough (casino_fullscreen.js)
window.casinoFitGame(document.querySelector(".bc-game"));
