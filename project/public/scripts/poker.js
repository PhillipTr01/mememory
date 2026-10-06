/* Hidden poker: the server deals and decides, this page only shows the table. */
const socket = io("/poker");

var myName = null;
var myCoins = 0;
var state = null;
var previous = null;
var timerFrame = null;

// Seat places around the table (in %), the own seat is always the first (bottom)
var PLACES = [
  { x: 50, y: 96 },
  { x: 6, y: 62 },
  { x: 22, y: 6 },
  { x: 78, y: 6 },
  { x: 94, y: 62 },
];
// Where the bet of a seat lies on the felt
var BET_PLACES = [
  { x: 63, y: 76 }, // next to the own cards (they are big)
  { x: 22, y: 58 },
  { x: 30, y: 30 },
  { x: 70, y: 30 },
  { x: 78, y: 58 },
];

// Phones: the table stands upright
var PLACES_NARROW = [
  { x: 50, y: 97 },
  { x: 8, y: 66 },
  { x: 14, y: 10 },
  { x: 86, y: 10 },
  { x: 92, y: 66 },
];
var BET_PLACES_NARROW = [
  { x: 50, y: 74 },
  { x: 28, y: 64 },
  { x: 32, y: 27 },
  { x: 68, y: 27 },
  { x: 72, y: 64 },
];
var narrow = window.matchMedia("(max-width: 767px)");
narrow.addEventListener("change", () => render());

function places() {
  return narrow.matches ? PLACES_NARROW : PLACES;
}

function betPlaces() {
  return narrow.matches ? BET_PLACES_NARROW : BET_PLACES;
}

var SUITS = { s: "♠", h: "♥", d: "♦", c: "♣" };

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

socket.on("connect", () => (document.getElementById("connectionBanner").hidden = true));
socket.on("disconnect", () => (document.getElementById("connectionBanner").hidden = false));
socket.on("connect_error", (error) => {
  if (error && error.message == "unauthorized") window.location.href = "/";
});

window.addEventListener("pagehide", () => socket.disconnect());
window.addEventListener("pageshow", (event) => {
  if (event.persisted) socket.connect();
});

socket.on("joined", (data) => (myName = data.username));

socket.on("coins", (data) => {
  myCoins = data.coins;
});

socket.on("pokerError", (message) => showToast(message, "error"));

socket.on("pokerState", (data) => {
  previous = state;
  state = data;
  render();
});

/* ---------- Helpers ---------- */

function mySeat() {
  return state ? state.seats.findIndex((seat) => seat && seat.name == myName) : -1;
}

// Place on the screen of a seat: the own seat (or seat 0) at the bottom
function placeOf(seat) {
  var me = mySeat();
  var offset = me >= 0 ? me : 0;
  return (seat - offset + state.seats.length) % state.seats.length;
}

function myTurn() {
  var me = mySeat();
  return me >= 0 && state.current == me;
}

function cardElement(card, extraClass) {
  if (card == null) return el("div", "pk-card back" + (extraClass ? " " + extraClass : ""));
  var red = card[1] == "h" || card[1] == "d";
  var element = el("div", "pk-card" + (red ? " red" : "") + (extraClass ? " " + extraClass : ""));
  var rank = card[0] == "T" ? "10" : card[0];
  element.append(el("span", "pk-rank", rank), el("span", "pk-suit", SUITS[card[1]]));
  element.title = rank + SUITS[card[1]];
  return element;
}

function winnerOf(seat) {
  return state.result ? state.result.winners.find((w) => w.seat == seat) : null;
}

function isWinningCard(card) {
  return state.result && state.result.showdown && state.result.winners.some((w) => w.cards && w.cards.includes(card));
}

/* ---------- Rendering ---------- */

function render() {
  if (state == null) return;
  document.getElementById("pkBlinds").innerText = "Blinds " + state.rules.smallBlind + " / " + state.rules.bigBlind;
  document.getElementById("pkViewers").innerText = state.viewers == 1 ? "1 here" : state.viewers + " here";
  renderSeats();
  renderBoard();
  renderStatus();
  renderActions();
  renderSeatBar();
  renderHistory();
  runTimer();
}

function renderSeats() {
  var container = document.getElementById("pkSeats");
  var me = mySeat();
  var newHand = previous && previous.hand != state.hand;
  container.replaceChildren(
    ...state.seats.map((seat, i) => {
      var place = places()[placeOf(i)];
      var spot = el("div", "pk-seat");
      spot.style.left = place.x + "%";
      spot.style.top = place.y + "%";
      spot.dataset.seat = i;

      if (seat == null) {
        spot.classList.add("empty");
        if (me < 0) {
          var sit = el("button", "mm-btn mm-btn-sm pk-sit", "Sit");
          sit.type = "button";
          sit.addEventListener("click", () => buyIn(i));
          spot.appendChild(sit);
        } else {
          spot.appendChild(el("span", "pk-empty", "Empty"));
        }
        return spot;
      }

      if (seat.folded) spot.classList.add("folded");
      if (!seat.inHand) spot.classList.add("out");
      if (state.current == i) spot.classList.add("turn");
      if (i == me) spot.classList.add("me");
      var won = winnerOf(i);
      if (won) spot.classList.add("winner");

      // Cards (own big, the others small)
      var cards = el("div", "pk-hole");
      seat.cards.forEach((card, n) => {
        var c = cardElement(card, (newHand ? "deal" : "") + (isWinningCard(card) ? " best" : ""));
        if (newHand) c.style.animationDelay = n * 120 + placeOf(i) * 60 + "ms";
        cards.appendChild(c);
      });

      var avatarWrap = el("div", "pk-avatar");
      avatarWrap.appendChild(createAvatar(seat.name));
      if (state.current == i) avatarWrap.appendChild(el("div", "pk-timer"));
      if (state.button == i) avatarWrap.appendChild(el("span", "pk-dealer", "D"));

      var info = el("div", "pk-info");
      var name = el("span", "pk-name", seat.name);
      if (seat.away) name.title = "Away";
      info.append(name, el("span", "pk-stack", "🪙 " + formatCoins(seat.stack)));

      var tag = null;
      if (won) tag = el("span", "pk-tag win", "+" + formatCoins(won.amount) + (won.hand ? " · " + won.hand : ""));
      else if (state.result && state.result.showdown && !seat.folded && seat.inHand) {
        var shown = state.result.hands.find((h) => h.seat == i);
        if (shown) tag = el("span", "pk-tag", shown.hand);
      } else if (seat.leaving) tag = el("span", "pk-tag", "Leaving");
      else if (seat.away) tag = el("span", "pk-tag", "Away");
      else if (seat.lastAction) tag = el("span", "pk-tag" + (seat.lastAction == "All-in" ? " allin" : ""), seat.lastAction);
      else if (!seat.inHand && state.phase != "waiting") tag = el("span", "pk-tag", "Next hand");

      spot.append(cards, avatarWrap, info);
      if (tag) spot.appendChild(tag);
      // What the player has right now (own cards, or cards that are shown) - not again at the end
      if (seat.handName && state.phase != "showdown") {
        var hand = el("span", "pk-handname", seat.handName);
        hand.title = i == me ? "Your hand right now" : seat.name + " has";
        spot.appendChild(hand);
      }
      return spot;
    }),
  );
  // The bets in front of the seats
  state.seats.forEach((seat, i) => {
    if (seat == null || seat.bet <= 0) return;
    var betPlace = betPlaces()[placeOf(i)];
    var bet = el("div", "pk-bet", "🪙 " + formatCoins(seat.bet));
    bet.style.left = betPlace.x + "%";
    bet.style.top = betPlace.y + "%";
    container.appendChild(bet);
  });
}

function renderBoard() {
  var board = document.getElementById("pkBoard");
  var before = previous && previous.hand == state.hand ? previous.board.length : 0;
  var cards = [];
  for (var n = 0; n < 5; n++) {
    var card = state.board[n];
    if (card == null) {
      cards.push(el("div", "pk-card slot"));
      continue;
    }
    var c = cardElement(card, (n >= before ? "flip" : "") + (isWinningCard(card) ? " best" : ""));
    if (n >= before) c.style.animationDelay = (n - before) * 150 + "ms";
    cards.push(c);
  }
  board.replaceChildren(...cards);

  // The pot - with side pots each one on its own (who plays for it: on hover)
  var pot = document.getElementById("pkPot");
  var bets = state.seats.reduce((sum, seat) => sum + (seat ? seat.bet : 0), 0);
  var pots = state.pots || [];
  if (pots.length > 1) {
    pot.replaceChildren(
      ...pots.map((p, n) => {
        var chip = el("span", "pk-pot-part" + (n ? " side" : ""), (n == 0 ? "Main pot" : pots.length > 2 ? "Side pot " + n : "Side pot") + " 🪙 " + formatCoins(p.amount));
        chip.title = "For " + p.players.join(", ");
        return chip;
      }),
    );
  } else {
    pot.innerText = state.pot + bets > 0 ? "Pot 🪙 " + formatCoins(state.pot + bets) : "";
  }

  // The result pot by pot: how big, who won it, with what
  var result = document.getElementById("pkResult");
  result.classList.toggle("won", Boolean(state.result && state.result.winners.some((w) => w.name == myName)));
  if (state.result && state.result.pots && state.result.pots.length) {
    var rows = state.result.pots.map((p, n) => {
      var row = el("div", "pk-result-pot" + (p.winners.some((w) => w.name == myName) ? " mine" : ""));
      var label = state.result.pots.length == 1 ? "Pot" : n == 0 ? "Main pot" : state.result.pots.length > 2 ? "Side pot " + n : "Side pot";
      row.appendChild(el("span", "pk-result-label", label + " 🪙 " + formatCoins(p.amount)));
      var who = p.winners.map((w) => (w.name == myName ? "You" : w.name)).join(" & ");
      var hand = p.winners[0] && p.winners[0].hand ? " · " + p.winners[0].hand : "";
      row.appendChild(el("span", "pk-result-who", (p.winners.length > 1 ? who + " split" : who) + hand));
      return row;
    });
    result.replaceChildren(...rows);
  } else {
    result.replaceChildren();
  }
}

function renderStatus() {
  var status = document.getElementById("pkStatus");
  var seated = state.seats.filter((seat) => seat != null).length;
  if (state.phase == "waiting") {
    if (state.startIn != null) status.innerText = "The next hand starts in a moment...";
    else status.innerText = seated < 2 ? "Waiting for players - take a seat (" + seated + " / " + state.seats.length + ")" : "Waiting...";
  } else if (state.phase == "showdown") {
    status.innerText = "Hand #" + state.hand + " is over";
  } else {
    var current = state.seats[state.current];
    var street = state.phase == "preflop" ? "Pre-flop" : state.phase[0].toUpperCase() + state.phase.slice(1);
    status.innerText = street + " · " + (myTurn() ? "Your turn!" : current ? current.name + " is thinking..." : "");
  }
}

/* ---------- Actions ---------- */

function limits() {
  var me = state.seats[mySeat()];
  var toCall = Math.max(0, state.highBet - me.bet);
  var max = me.bet + me.stack;
  var min = Math.min(max, state.highBet + state.minRaise);
  return { toCall: toCall, min: min, max: max, me: me };
}

function renderActions() {
  var box = document.getElementById("pkActions");
  var show = myTurn();
  box.hidden = !show;
  if (!show) return;
  var l = limits();
  var call = document.getElementById("pkCall");
  if (l.toCall == 0) call.innerText = "Check";
  else if (l.toCall >= l.me.stack) call.innerText = "Call all-in " + formatCoins(l.me.stack);
  else call.innerText = "Call " + formatCoins(l.toCall);

  // Raising is only possible with more chips than the call
  var canRaise = l.max > state.highBet && l.me.stack > l.toCall;
  document.getElementById("pkRaiseBox").hidden = !canRaise;
  document.getElementById("pkRaise").hidden = !canRaise;
  var slider = document.getElementById("pkSlider");
  var amount = document.getElementById("pkAmount");
  var keep = previous && previous.current == state.current && previous.hand == state.hand && previous.phase == state.phase;
  slider.min = l.min;
  slider.max = l.max;
  slider.step = 1;
  amount.min = l.min;
  amount.max = l.max;
  if (!keep || Number(amount.value) < l.min || Number(amount.value) > l.max) {
    slider.value = l.min;
    amount.value = l.min;
  }
  updateRaiseLabel();
}

function updateRaiseLabel() {
  var value = Number(document.getElementById("pkAmount").value) || 0;
  var l = limits();
  var label = value >= l.max ? "All-in " + formatCoins(l.max) : (state.highBet == 0 ? "Bet " : "Raise to ") + formatCoins(value);
  document.getElementById("pkRaise").innerText = label;
}

function setRaise(value) {
  var l = limits();
  value = Math.max(l.min, Math.min(l.max, Math.round(value)));
  document.getElementById("pkSlider").value = value;
  document.getElementById("pkAmount").value = value;
  updateRaiseLabel();
}

function preset(kind) {
  var l = limits();
  var bets = state.seats.reduce((sum, seat) => sum + (seat ? seat.bet : 0), 0);
  // Pot-sized raise: call first, then the whole pot on top
  var pot = state.pot + bets + l.toCall;
  if (kind == "min") setRaise(l.min);
  else if (kind == "half") setRaise(state.highBet + pot / 2);
  else if (kind == "pot") setRaise(state.highBet + pot);
  else setRaise(l.max);
}

function send(type, amount) {
  socket.emit("action", { type: type, amount: amount });
}

/* ---------- Seat ---------- */

function renderSeatBar() {
  var me = mySeat();
  var bar = document.getElementById("pkSeatBar");
  bar.hidden = me < 0;
  if (me < 0) return;
  var seat = state.seats[me];
  document.getElementById("pkMyInfo").innerText = "Your chips: 🪙 " + formatCoins(seat.stack) + (seat.leaving ? " · leaving after this hand" : "");
  document.getElementById("pkAddChips").disabled = (seat.inHand && state.phase != "showdown") || seat.stack >= state.rules.maxBuyIn;
  document.getElementById("pkStand").disabled = seat.leaving;
}

// Buy-in / more chips: a small dialog with a slider
function chipsDialog(options) {
  var backdrop = el("div", "mm-dialog-backdrop");
  var dialog = el("div", "mm-dialog pk-dialog");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  var title = el("h2", "mm-dialog-title", options.title);
  var text = el("p", "mm-dialog-text", options.text);
  var max = Math.min(options.max, myCoins);
  var slider = el("input", "pk-slider");
  slider.type = "range";
  slider.min = options.min;
  slider.max = Math.max(options.min, max);
  slider.value = Math.max(options.min, Math.min(max, options.value));
  var value = el("div", "pk-dialog-value", "🪙 " + formatCoins(slider.value));
  slider.addEventListener("input", () => (value.innerText = "🪙 " + formatCoins(slider.value)));
  var buttons = el("div", "mm-dialog-actions");
  var cancel = el("button", "mm-btn", "Cancel");
  cancel.type = "button";
  var ok = el("button", "mm-btn mm-btn-primary", options.button);
  ok.type = "button";
  ok.disabled = max < options.min;
  buttons.append(cancel, ok);
  dialog.append(title, text, value, slider, buttons);
  if (max < options.min) dialog.insertBefore(el("p", "pk-dialog-warning", "You need at least " + formatCoins(options.min) + " coins."), buttons);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  var close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
  };
  var onKey = (event) => event.key == "Escape" && close();
  document.addEventListener("keydown", onKey);
  cancel.addEventListener("click", close);
  backdrop.addEventListener("click", (event) => event.target == backdrop && close());
  ok.addEventListener("click", () => {
    options.done(Number(slider.value));
    close();
  });
  slider.focus();
}

function buyIn(seat) {
  chipsDialog({
    title: "Take a seat",
    text: "Your coins become chips. When you stand up, the chips are coins again.",
    min: state.rules.minBuyIn,
    max: state.rules.maxBuyIn,
    value: Math.min(1000, state.rules.maxBuyIn),
    button: "Sit down",
    done: (amount) => socket.emit("sit", { seat: seat, buyIn: amount }),
  });
}

function addChips() {
  var seat = state.seats[mySeat()];
  var room = state.rules.maxBuyIn - seat.stack;
  chipsDialog({
    title: "Add chips",
    text: "Up to " + formatCoins(state.rules.maxBuyIn) + " chips at the table.",
    min: 1,
    max: room,
    value: Math.min(room, state.rules.minBuyIn),
    button: "Add",
    done: (amount) => socket.emit("addChips", amount),
  });
}

/* ---------- History ---------- */

function renderHistory() {
  var list = document.getElementById("pkHistory");
  document.getElementById("pkHistoryEmpty").hidden = state.history.length > 0;
  list.replaceChildren(
    ...state.history.map((entry) => {
      var item = el("li");
      var first = entry.winners[0];
      var name = el("span", "jp-history-name");
      name.append(createAvatar(first.name, "sm"), document.createTextNode(entry.winners.map((w) => w.name).join(", ")));
      var hand = el("span", "jp-history-odds", first.hand || "no showdown");
      var won = el("span", "jp-history-won", "🪙 " + formatCoins(entry.winners.reduce((sum, w) => sum + w.amount, 0)));
      item.append(name, hand, won);
      return item;
    }),
  );
}

/* ---------- Turn timer ---------- */

function runTimer() {
  cancelAnimationFrame(timerFrame);
  if (state.turnIn == null) return;
  var end = Date.now() + state.turnIn;
  var total = state.rules.turn;
  var tick = () => {
    var ring = document.querySelector(".pk-timer");
    if (ring == null) return;
    var left = Math.max(0, end - Date.now());
    ring.style.setProperty("--left", Math.min(1, left / total));
    ring.classList.toggle("hurry", left < 5000);
    if (left > 0) timerFrame = requestAnimationFrame(tick);
  };
  tick();
}

/* ---------- Setup ---------- */

document.addEventListener("DOMContentLoaded", () => {
  setupChat();

  document.getElementById("pkFold").addEventListener("click", () => send("fold"));
  document.getElementById("pkCall").addEventListener("click", () => send(limits().toCall > 0 ? "call" : "check"));
  document.getElementById("pkRaise").addEventListener("click", () => {
    var value = Number(document.getElementById("pkAmount").value);
    var l = limits();
    if (value >= l.max) send("allin");
    else send("raise", value);
  });
  document.getElementById("pkSlider").addEventListener("input", (event) => setRaise(Number(event.target.value)));
  document.getElementById("pkAmount").addEventListener("change", (event) => setRaise(Number(event.target.value)));
  document.querySelectorAll("[data-preset]").forEach((button) => button.addEventListener("click", () => preset(button.dataset.preset)));

  document.getElementById("pkStand").addEventListener("click", () => socket.emit("stand"));
  document.getElementById("pkAddChips").addEventListener("click", addChips);
});
