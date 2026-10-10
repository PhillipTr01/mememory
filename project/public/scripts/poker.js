/* Hidden poker: the server deals and decides, this page only shows the table. */
const socket = io((window.CASINO_NS || "") + "/poker");

var myName = null;
var myCoins = 0;
var myCapRule = null; // the max bet by balance ({floor, share} - null: no cap), see casinoCapLeft
// What more I may bet this round (`already`: my coins in it)
function capLeft(already) {
  return casinoCapLeft(myCapRule, myCoins, already);
}
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
// The sounds of the page (casino_sound.js)
function sound(name, options) {
  if (window.casinoSound) window.casinoSound.play(name, options);
}

function chatUsername() {
  return myName;
}

// Chips as coins - or in big blinds (the switch in the seat bar)
var BB_KEY = "pokerInBB";
var inBB = false;
try {
  inBB = localStorage.getItem(BB_KEY) == "1";
} catch (error) {
  // not remembered
}

// Chips as text: the number (or big blinds) - see chipsEl for one with the chip icon
function chips(value) {
  if (!inBB || !state) return formatCoins(value);
  var bb = value / state.rules.bigBlind;
  return (Number.isInteger(bb) ? bb : bb.toFixed(1)) + " BB";
}

// Chips with the poker chip in front (not the coin: chips are what is on the table)
function chipsEl(value, text) {
  var box = el("span", "pk-chips");
  box.append(el("i", "pk-chip-ico"), document.createTextNode((text || "") + chips(value)));
  return box;
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
  if (error && error.message == "unauthorized") window.location.href = "/?next=" + encodeURIComponent(location.pathname + location.search);
});
// The admin took the access away
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
});

socket.on("pokerError", (message) => {
  showHint(message, "error");
  sound("error");
});

socket.on("pokerState", (data) => {
  previous = state;
  state = data;
  render();
  hear();
});

// What changed since the last state: the cards, what the players did, my turn, the result
function hear() {
  if (!previous || !state) return;
  var me = mySeat();
  var sameHand = previous.hand == state.hand;
  // A new hand: my two cards
  if (!sameHand && me >= 0 && state.seats[me] && state.seats[me].inHand) {
    sound("deal");
    sound("deal", { delay: 0.16 });
  }
  // The board: card after card
  var before = sameHand ? previous.board.length : 0;
  for (var n = before; n < state.board.length; n++) sound("flip", { delay: (n - before) * 0.38 });
  // What a player just did
  if (sameHand) {
    state.seats.forEach((seat, i) => {
      var old = previous.seats[i];
      if (!seat || !old || !seat.lastAction || seat.lastAction == old.lastAction) return;
      var action = seat.lastAction.toLowerCase();
      if (action.startsWith("fold")) sound("fold");
      else if (action.startsWith("check")) sound("knock");
      else sound("chips");
    });
  }
  if (myTurn() && !(sameHand && previous.current == state.current && previous.phase == state.phase)) sound("notice");
  // The result of the hand (only for who played it)
  if (state.result && !(sameHand && previous.result)) {
    var won = state.result.winners.filter((w) => w.name == myName).reduce((sum, w) => sum + (w.amount || 0), 0);
    if (won > 0) sound(state.result.showdown ? "bigWin" : "win");
    else if (me >= 0 && previous.seats[me] && previous.seats[me].inHand) sound("lose");
  }
}

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

// A card of the winning hand: " best" (it makes the hand - the pair, the flush ...), " kicker" (one of
// the five, only counting when hands are equal) or ""
function winningClass(card) {
  if (!state.result || !state.result.showdown) return "";
  var winners = state.result.winners.filter((w) => w.cards && w.cards.includes(card));
  if (!winners.length) return "";
  return winners.some((w) => !w.made || w.made.includes(card)) ? " best" : " kicker";
}

/* ---------- Rendering ---------- */

function render() {
  if (state == null) return;
  renderBlinds();
  renderSeats();
  renderBoard();
  renderStatus();
  renderActions();
  renderDecide();
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
        // A chair: free to sit down (or just empty when I'm already at the table)
        var sit = el("button", "pk-sit");
        sit.type = "button";
        sit.append(el("span", "pk-sit-chair", "🪑"), el("span", "pk-sit-text", me < 0 ? "Sit down" : "Empty"));
        if (me < 0) {
          sit.title = "Sit down with your coins";
          sit.addEventListener("click", () => buyIn(i));
        } else {
          sit.disabled = true;
        }
        spot.appendChild(sit);
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
        var c = cardElement(card, (newHand ? "deal" : "") + winningClass(card));
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
      var stack = el("span", "pk-stack");
      stack.appendChild(chipsEl(seat.stack));
      info.append(name, stack);

      var tag = null;
      if (won) tag = el("span", "pk-tag win", "+" + chips(won.amount) + (won.hand ? " · " + won.hand : ""));
      else if (state.result && state.result.showdown && !seat.folded && seat.inHand) {
        var shown = state.result.hands.find((h) => h.seat == i);
        if (shown) tag = el("span", "pk-tag" + (shown.hand ? "" : " muted"), shown.deciding ? "Show or muck..." : shown.mucked ? "Mucked" : shown.hand);
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
    var bet = el("div", "pk-bet");
    bet.appendChild(chipsEl(seat.bet));
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
    var c = cardElement(card, (n >= before ? "flip" : "") + winningClass(card));
    // (the flop one card after the other, slowly)
    if (n >= before) c.style.animationDelay = (n - before) * 380 + "ms";
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
        var chip = el("span", "pk-pot-part" + (n ? " side" : ""), (n == 0 ? "Main pot" : pots.length > 2 ? "Side pot " + n : "Side pot") + " ");
        chip.appendChild(chipsEl(p.amount));
        chip.title = "For " + p.players.join(", ");
        return chip;
      }),
    );
  } else {
    pot.replaceChildren();
    if (state.pot + bets > 0) pot.append("Pot ", chipsEl(state.pot + bets));
  }

  // The result pot by pot: how big, who won it, with what
  var result = document.getElementById("pkResult");
  result.classList.toggle("won", Boolean(state.result && state.result.winners.some((w) => w.name == myName)));
  if (state.result && state.result.pots && state.result.pots.length) {
    var rows = state.result.pots.map((p, n) => {
      var row = el("div", "pk-result-pot" + (p.winners.some((w) => w.name == myName) ? " mine" : ""));
      var label = state.result.pots.length == 1 ? "Pot" : n == 0 ? "Main pot" : state.result.pots.length > 2 ? "Side pot " + n : "Side pot";
      var labelBox = el("span", "pk-result-label", label + " ");
      labelBox.appendChild(chipsEl(p.amount));
      row.appendChild(labelBox);
      var who = p.winners.map((w) => (w.name == myName ? "You" : w.name)).join(" & ");
      var hand = p.winners[0] && p.winners[0].hand ? " · " + p.winners[0].hand : "";
      row.appendChild(el("span", "pk-result-who", (p.winners.length > 1 ? who + " split" : who) + hand));
      return row;
    });
    // What the house kept (rake)
    if (state.result.rake > 0) {
      var rake = el("div", "pk-result-pot pk-result-rake");
      var rakeLabel = el("span", "pk-result-label", "Rake ");
      rakeLabel.appendChild(chipsEl(state.result.rake));
      rake.append(rakeLabel, el("span", "pk-result-who", "the house"));
      rows.push(rake);
    }
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

/* ---------- Blinds: up every few hands (back to the start when the table was empty a while) ---------- */

function renderBlinds() {
  var badge = document.getElementById("pkBlinds");
  var text = "Blinds " + formatCoins(state.rules.smallBlind) + " / " + formatCoins(state.rules.bigBlind);
  var level = state.level;
  if (level) text += " · Level " + level.number;
  // Up after a few more hands
  if (level && level.next && level.handsLeft != null) text += " · " + formatCoins(level.next.small) + " / " + formatCoins(level.next.big) + (level.handsLeft <= 0 ? " next hand" : " in " + level.handsLeft + (level.handsLeft == 1 ? " hand" : " hands"));
  badge.innerText = text;
  badge.title = "The blinds go up every few hands - and start low again when nobody played for a while";
}

/* ---------- Actions ---------- */

function limits() {
  var me = state.seats[mySeat()];
  var toCall = Math.max(0, state.highBet - me.bet);
  var max = me.bet + me.stack;
  var min = Math.min(max, state.highBet + state.minRaise);
  return { toCall: toCall, min: min, max: max, me: me };
}

// After the hand: show or muck - the bar runs out, then the cards are mucked
var decideAnimation = null;
var decideFor = null;
function renderDecide() {
  var me = mySeat();
  var seat = me >= 0 ? state.seats[me] : null;
  var box = document.getElementById("pkDecide");
  var show = seat != null && seat.deciding && state.decideIn != null;
  box.hidden = !show;
  if (!show) {
    decideFor = null;
    return;
  }
  document.getElementById("pkDecideHand").innerText = seat.handName ? "You have " + seat.handName : "";
  // The timer starts once per hand
  if (decideFor == state.hand) return;
  decideFor = state.hand;
  if (decideAnimation) decideAnimation.cancel();
  var start = 1 - state.decideIn / state.decideTime;
  decideAnimation = document.getElementById("pkDecideBar").animate([{ transform: `scaleX(${1 - start})` }, { transform: "scaleX(0)" }], { duration: state.decideIn, fill: "forwards" });
}

// The action bar is always there - quiet (and nothing to click) while it isn't the own turn
function renderActions() {
  var box = document.getElementById("pkActions");
  var show = myTurn();
  box.hidden = false;
  box.classList.toggle("idle", !show);
  box.querySelectorAll("button, input").forEach((control) => (control.disabled = !show));
  if (!show) {
    document.getElementById("pkCall").innerText = "Check";
    document.getElementById("pkRaise").innerText = "Raise";
    document.getElementById("pkRaise").hidden = false;
    document.getElementById("pkRaiseBox").hidden = false;
    return;
  }
  var l = limits();
  var call = document.getElementById("pkCall");
  if (l.toCall == 0) call.innerText = "Check";
  else if (l.toCall >= l.me.stack) call.innerText = "Call all-in " + chips(l.me.stack);
  else call.innerText = "Call " + chips(l.toCall);

  // Raising is only possible with more chips than the call
  var canRaise = l.max > state.highBet && l.me.stack > l.toCall;
  document.getElementById("pkRaiseBox").hidden = !canRaise;
  document.getElementById("pkRaise").hidden = !canRaise;
  var slider = document.getElementById("pkSlider");
  var amount = document.getElementById("pkAmount");
  var keep = previous && previous.current == state.current && previous.hand == state.hand && previous.phase == state.phase;
  slider.min = l.min;
  slider.max = l.max;
  slider.step = "any";
  if (!keep || raiseValue < l.min || raiseValue > l.max) raiseValue = l.min;
  slider.value = raiseValue;
  showAmount();
  updateRaiseLabel();
}

// The raise (in coins); the field shows it in coins or big blinds, like the chips at the table
var raiseValue = 0;
function showAmount() {
  var amount = document.getElementById("pkAmount");
  var bb = state.rules.bigBlind;
  amount.step = inBB ? 0.5 : 1;
  amount.value = inBB ? Math.round((raiseValue / bb) * 10) / 10 : raiseValue;
  amount.setAttribute("aria-label", inBB ? "Raise to (big blinds)" : "Raise to");
  amount.classList.toggle("in-bb", inBB);
}

// What is typed in the field: coins - or big blinds
function typedAmount(text) {
  var value = Number(text) || 0;
  return inBB ? value * state.rules.bigBlind : value;
}

function updateRaiseLabel() {
  var value = raiseValue;
  var l = limits();
  var label = value >= l.max ? "All-in " + chips(l.max) : (state.highBet == 0 ? "Bet " : "Raise to ") + chips(value);
  document.getElementById("pkRaise").innerText = label;
}

// A slider (and the mouse wheel) moves in steps of 50 (the ends - the least and all-in - are always possible)
var SLIDER_STEP = 50;
function snap(value, min, max) {
  if (value >= max - SLIDER_STEP / 2) return max;
  if (value <= min + SLIDER_STEP / 2) return min;
  return Math.max(min, Math.min(max, Math.round(value / SLIDER_STEP) * SLIDER_STEP));
}

function setRaise(value, fromSlider) {
  var l = limits();
  value = Math.max(l.min, Math.min(l.max, Math.round(value)));
  if (fromSlider) value = snap(value, l.min, l.max);
  raiseValue = value;
  document.getElementById("pkSlider").value = value;
  showAmount();
  updateRaiseLabel();
}

// The quick bets: every player picks their own four (the ⚙ next to them)
var PRESETS = {
  min: "Min",
  "pot-33": "⅓ Pot",
  "pot-50": "½ Pot",
  "pot-66": "⅔ Pot",
  "pot-75": "¾ Pot",
  "pot-100": "Pot",
  "pot-200": "2× Pot",
  "bb-2.5": "2.5 BB",
  "bb-3": "3 BB",
  "bb-4": "4 BB",
  "bb-5": "5 BB",
  max: "All-in",
};
var PRESETS_KEY = "pokerPresets";
var myPresets = ["min", "pot-50", "pot-100", "max"];
try {
  var saved = JSON.parse(localStorage.getItem(PRESETS_KEY));
  if (Array.isArray(saved) && saved.length == 4 && saved.every((kind) => PRESETS[kind])) myPresets = saved;
} catch (error) {
  // the default ones
}

function renderPresets() {
  var box = document.getElementById("pkPresets");
  box.replaceChildren(
    ...myPresets.map((kind) => {
      var button = el("button", "mm-btn mm-btn-sm", PRESETS[kind]);
      button.type = "button";
      button.addEventListener("click", () => preset(kind));
      return button;
    }),
  );
}

function preset(kind) {
  var l = limits();
  var bets = state.seats.reduce((sum, seat) => sum + (seat ? seat.bet : 0), 0);
  // Pot-sized raise: call first, then the pot on top
  var pot = state.pot + bets + l.toCall;
  if (kind == "min") return setRaise(l.min);
  if (kind == "max") return setRaise(l.max);
  var [type, size] = kind.split("-");
  if (type == "pot") setRaise(state.highBet + (pot * Number(size)) / 100);
  else setRaise(Number(size) * state.rules.bigBlind);
}

// The ⚙: four selects, saved in the browser
function editPresets() {
  var backdrop = el("div", "mm-dialog-backdrop");
  var dialog = el("div", "mm-dialog pk-dialog");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.append(el("h2", "mm-dialog-title", "Your quick bets"), el("p", "mm-dialog-text", "Pick the four buttons next to the raise slider."));
  var selects = myPresets.map((kind, n) => {
    var select = el("select", "mm-input pk-preset-select");
    select.setAttribute("aria-label", "Button " + (n + 1));
    Object.keys(PRESETS).forEach((key) => select.appendChild(Object.assign(document.createElement("option"), { value: key, innerText: PRESETS[key], selected: key == kind })));
    return select;
  });
  var grid = el("div", "pk-preset-grid");
  grid.append(...selects);
  var actions = el("div", "mm-dialog-actions");
  var cancel = el("button", "mm-btn", "Cancel");
  cancel.type = "button";
  var save = el("button", "mm-btn mm-btn-primary", "Save");
  save.type = "button";
  actions.append(cancel, save);
  dialog.append(grid, actions);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  var close = () => backdrop.remove();
  cancel.addEventListener("click", close);
  backdrop.addEventListener("click", (event) => event.target == backdrop && close());
  save.addEventListener("click", () => {
    myPresets = selects.map((select) => select.value);
    try {
      localStorage.setItem(PRESETS_KEY, JSON.stringify(myPresets));
    } catch (error) {
      // only for now
    }
    renderPresets();
    close();
  });
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
  document.getElementById("pkMyInfo").replaceChildren(chipsEl(seat.stack));
  document.getElementById("pkMyLabel").innerText = seat.leaving ? "Leaving after this hand" : "Your chips";
  document.getElementById("pkAddChips").disabled = (seat.inHand && state.phase != "showdown") || seat.stack >= state.rules.maxBuyIn;
  document.getElementById("pkStand").disabled = seat.leaving;
  document.getElementById("pkMyInfo").title = inBB ? "In big blinds - click for coins" : "In coins - click for big blinds";
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
  slider.step = "any";
  slider.value = Math.max(options.min, Math.min(max, options.value));
  var value = el("div", "pk-dialog-value", "🪙 " + formatCoins(slider.value));
  slider.addEventListener("input", () => {
    slider.value = snap(Number(slider.value), Number(slider.min), Number(slider.max));
    value.innerText = "🪙 " + formatCoins(slider.value);
  });
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
    // (never more than the max bet by balance)
    max: Math.max(state.rules.minBuyIn, Math.min(state.rules.maxBuyIn, capLeft(0))),
    // (10,000 to start with - or less, with fewer coins)
    value: Math.max(state.rules.minBuyIn, Math.min(state.rules.defaultBuyIn || 10000, state.rules.maxBuyIn, myCoins, capLeft(0))),
    button: "Sit down",
    done: (amount) => socket.emit("sit", { seat: seat, buyIn: amount }),
  });
}

function addChips() {
  var seat = state.seats[mySeat()];
  // (the chips at the table count for the max bet by balance)
  var room = Math.min(state.rules.maxBuyIn - seat.stack, capLeft(seat.stack));
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
      var first = entry.winners[0];
      var sub = "Hand " + entry.hand + " · " + (first.hand || "everybody folded");
      return historyItem(createAvatar(first.name, "sm"), entry.winners.map((w) => w.name).join(", "), sub, "🪙 " + formatCoins(entry.winners.reduce((sum, w) => sum + w.amount, 0)));
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
    var value = raiseValue;
    var l = limits();
    if (value >= l.max) send("allin");
    else send("raise", value);
  });
  document.getElementById("pkSlider").addEventListener("input", (event) => setRaise(Number(event.target.value), true));
  document.getElementById("pkAmount").addEventListener("change", (event) => setRaise(typedAmount(event.target.value)));
  renderPresets();
  document.getElementById("pkPresetEdit").addEventListener("click", editPresets);
  // The mouse wheel moves the raise (50 per step, like the slider)
  document.getElementById("pkRaiseBox").addEventListener(
    "wheel",
    (event) => {
      // (only on the own turn - otherwise the bar is there, but quiet)
      if (!state || document.getElementById("pkRaiseBox").hidden || !myTurn()) return;
      event.preventDefault();
      setRaise(raiseValue + (event.deltaY < 0 ? 1 : -1) * SLIDER_STEP, true);
    },
    { passive: false },
  );
  document.getElementById("pkShowNow").addEventListener("click", () => socket.emit("decide", { show: true }));
  document.getElementById("pkMuckNow").addEventListener("click", () => socket.emit("decide", { show: false }));
  // A click on my chips: coins or big blinds (everywhere at the table)
  document.getElementById("pkMyInfo").addEventListener("click", () => {
    inBB = !inBB;
    try {
      localStorage.setItem(BB_KEY, inBB ? "1" : "0");
    } catch (error) {
      // only for now
    }
    render();
  });

  document.getElementById("pkStand").addEventListener("click", () => socket.emit("stand"));
  document.getElementById("pkAddChips").addEventListener("click", addChips);
});

// The whole table (seats, cards, chips) a bit smaller when the screen isn't high enough (casino_fullscreen.js)
window.casinoFitGame(document.querySelector(".pk-table-wrap"), [document.getElementById("pkSeatBar"), document.getElementById("pkDecide")]);
