/* Hidden blackjack: the server deals and decides, this page only shows the table. */
const socket = io("/blackjack");

var myName = null;
var myCoins = 0;
var state = null;
var previous = null;
var selected = null; // the seat to bet on

var SUITS = { s: "♠", h: "♥", d: "♦", c: "♣" };
var RESULTS = { win: "Win", lose: "Lose", push: "Push", bust: "Bust", blackjack: "Blackjack!" };

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
// The admin took the access away
socket.on("casinoClosed", () => (window.location.href = "/"));

window.addEventListener("pagehide", () => socket.disconnect());
window.addEventListener("pageshow", (event) => {
  if (event.persisted) socket.connect();
});

socket.on("joined", (data) => (myName = data.username));
socket.on("coins", (data) => {
  myCoins = data.coins;
  if (state) renderBars();
});
socket.on("blackjackError", (message) => showToast(message, "error"));

socket.on("blackjackState", (data) => {
  previous = state;
  state = data;
  render();
});

/* ---------- Cards ---------- */

var DEAL_STEP = 280; // ms between two cards of the first deal

function cardElement(card, fresh, delay) {
  var element;
  if (card == null) {
    element = el("div", "pk-card back" + (fresh ? " deal" : ""));
  } else {
    var red = card[1] == "h" || card[1] == "d";
    element = el("div", "pk-card" + (red ? " red" : "") + (fresh ? " deal" : ""));
    var rank = card[0] == "T" ? "10" : card[0];
    element.append(el("span", "pk-rank", rank), el("span", "pk-suit", SUITS[card[1]]));
  }
  if (fresh && delay > 0) element.style.animationDelay = delay + "ms";
  return element;
}

function valueText(value, blackjack) {
  if (blackjack) return "BJ";
  return value.soft && value.total <= 21 ? value.total - 10 + "/" + value.total : String(value.total);
}

/*
 * The first deal goes round clockwise: from the right seat (seat 1) to the
 * left one, then the dealer - two times. Delay of card `n` of seat position `p`.
 */
function firstDeal() {
  return previous != null && previous.round == state.round && previous.phase == "betting" && state.phase != "betting";
}

function dealOrder() {
  return state.seats.map((seat, i) => (seat && seat.hands.length ? i : -1)).filter((i) => i >= 0);
}

function dealDelay(n, position, count) {
  return (n * (count + 1) + position) * DEAL_STEP;
}

/* ---------- Rendering ---------- */

function mySeats() {
  return state.seats.map((seat, i) => (seat && seat.name == myName ? i : -1)).filter((i) => i >= 0);
}

// A seat of mine without a bet: first a bet there, then another seat
function myEmptySeat() {
  return mySeats().find((i) => state.seats[i].bet == 0 && state.seats[i].hands.length == 0);
}

function render() {
  if (state == null) return;
  document.getElementById("bjLimits").innerText = formatCoins(state.rules.minBet) + " - " + formatCoins(state.rules.maxBet) + " per seat";
  document.getElementById("bjViewers").innerText = state.viewers == 1 ? "1 here" : state.viewers + " here";
  // The seat to bet on: one of mine (the one without a bet first)
  if (selected != null && !(state.seats[selected] && state.seats[selected].name == myName)) selected = null;
  var empty = myEmptySeat();
  if (empty != null && (selected == null || state.seats[selected].bet > 0)) selected = empty;
  renderDealer();
  renderSeats();
  renderStatus();
  renderBars();
  renderHistory();
}

function renderDealer() {
  var before = previous && previous.round == state.round ? previous.dealer.cards : [];
  var dealing = firstDeal();
  var count = dealOrder().length;
  var cards = document.getElementById("bjDealerCards");
  cards.replaceChildren(
    ...state.dealer.cards.map((card, i) => {
      // New, or just turned over
      var fresh = i >= before.length || (before[i] == null && card != null);
      var delay = dealing && i < 2 ? dealDelay(i, count, count) : (i - before.length) * 90;
      return cardElement(card, fresh, delay);
    }),
  );
  var value = document.getElementById("bjDealerValue");
  value.hidden = state.dealer.value == null;
  if (state.dealer.value) {
    var total = state.dealer.value.total;
    value.innerText = state.dealer.hidden ? String(total) + " + ?" : total > 21 ? "Bust " + total : valueText(state.dealer.value, !state.dealer.hidden && state.dealer.cards.length == 2 && total == 21);
    value.classList.toggle("bust", total > 21);
    // Shown when the dealer's cards are there
    value.classList.remove("bj-late");
    value.style.animationDelay = "";
    if (dealing) {
      void value.offsetWidth;
      value.classList.add("bj-late");
      value.style.animationDelay = dealDelay(1, count, count) + "ms";
    }
  }
}

function renderSeats() {
  var container = document.getElementById("bjSeats");
  var betting = state.phase == "betting";
  var dealing = firstDeal();
  var order = dealOrder();
  var blocked = myEmptySeat() != null;
  container.replaceChildren(
    ...state.seats.map((seat, i) => {
      var spot = el("div", "bj-seat");
      // Seat 1 on the right: the cards go round clockwise from there
      spot.style.gridColumn = String(state.seats.length - i);
      spot.style.gridRow = "1";
      spot.style.setProperty("--lift", [0, 26, 36, 26, 0][i % 5] + "px");
      if (selected == i && betting) spot.classList.add("selected");

      if (seat == null) {
        spot.classList.add("empty");
        var take = el("button", "bj-seat-empty");
        take.type = "button";
        take.append(el("span", "bj-seat-chair", "🪑"), el("span", "", "Sit down"));
        take.disabled = blocked;
        take.title = blocked ? "Bet on your seat first" : "Seat " + (i + 1);
        take.addEventListener("click", () => {
          selected = i;
          socket.emit("sit", i);
        });
        spot.append(take, el("span", "bj-seat-no", String(i + 1)));
        return spot;
      }

      var mine = seat.name == myName;
      if (mine) spot.classList.add("mine");
      if (state.current && state.current.seat == i) spot.classList.add("turn");

      // The hands (more than one after a split)
      var hands = el("div", "bj-hands");
      var old = previous && previous.round == state.round && previous.seats[i] ? previous.seats[i].hands : [];
      var position = order.indexOf(i);
      seat.hands.forEach((hand, h) => {
        var box = el("div", "bj-hand");
        if (state.current && state.current.seat == i && state.current.hand == h) box.classList.add("active");
        if (hand.result) box.classList.add(hand.result);
        var cards = el("div", "bj-cards small");
        var seen = old[h] ? old[h].cards.length : 0;
        cards.append(...hand.cards.map((card, n) => cardElement(card, n >= seen, dealing && n < 2 ? dealDelay(n, position, order.length) : (n - seen) * 90)));
        var value = el("span", "bj-value" + (hand.value.total > 21 ? " bust" : ""), hand.value.total > 21 ? "Bust" : valueText(hand.value, hand.blackjack));
        if (dealing) {
          value.classList.add("bj-late");
          value.style.animationDelay = dealDelay(1, position, order.length) + "ms";
        }
        box.append(cards, value);
        if (hand.result && hand.result != "bust") {
          var gain = hand.payout - hand.bet;
          box.appendChild(el("span", "bj-result " + hand.result, RESULTS[hand.result] + (gain > 0 ? " +" + formatCoins(gain) : "")));
        }
        hands.appendChild(box);
      });

      var bet = seat.hands.length ? seat.hands.reduce((sum, hand) => sum + hand.bet, 0) : seat.bet;
      var chip = el("span", "bj-bet" + (bet > 0 ? "" : " empty"), bet > 0 ? "🪙 " + formatCoins(bet) : mine ? "Place a bet" : "No bet");
      // No bet yet: the seat is free again soon
      if (seat.standIn != null && bet == 0) {
        var stand = el("span", "bj-stand");
        stand.dataset.end = Date.now() + seat.standIn;
        hands.appendChild(stand);
      }
      var who = el("div", "bj-who");
      who.append(createAvatar(seat.name, "sm"), el("span", "bj-name", mine ? "You" : seat.name));
      spot.append(hands, chip, who);
      // The own seats: click to bet more on them
      if (mine && betting) {
        spot.classList.add("clickable");
        spot.addEventListener("click", () => {
          selected = i;
          render();
        });
      }
      return spot;
    }),
  );
  tickStand();
}

// "Stands up in 12s" under the seats without a bet
function tickStand() {
  document.querySelectorAll(".bj-stand").forEach((element) => {
    var left = Math.max(0, Math.ceil((Number(element.dataset.end) - Date.now()) / 1000));
    element.innerText = "Stands up in " + left + "s";
    element.classList.toggle("hurry", left <= 5);
  });
}

function myTurn() {
  if (!state.current) return null;
  var seat = state.seats[state.current.seat];
  if (!seat || seat.name != myName) return null;
  return { seat: seat, hand: seat.hands[state.current.hand] };
}

// The big clock in the middle of the table while the bets come in
function renderClock() {
  var clock = document.getElementById("bjClock");
  var running = state.phase == "betting" && renderStatus.end != null;
  clock.hidden = !running;
  if (!running) return;
  var left = Math.max(0, renderStatus.end - Date.now());
  var seconds = Math.ceil(left / 1000);
  document.getElementById("bjClockNum").innerText = seconds;
  var ring = document.getElementById("bjClockRing");
  var length = 2 * Math.PI * 26;
  ring.style.strokeDasharray = length;
  ring.style.strokeDashoffset = length * (1 - left / state.rules.betting);
  clock.classList.toggle("hurry", seconds <= 3);
}

function renderStatus() {
  var status = document.getElementById("bjStatus");
  clearInterval(renderStatus.timer);
  renderStatus.end = state.phase == "betting" && state.startIn != null ? Date.now() + state.startIn : null;
  var tick = () => {
    if (renderStatus.end != null) {
      var left = Math.max(0, Math.ceil((renderStatus.end - Date.now()) / 1000));
      status.innerText = "Place your bets - cards in " + left + "s";
    }
    renderClock();
    tickStand();
  };
  if (state.phase == "betting") {
    if (renderStatus.end == null) status.innerText = "Sit down and place a bet to start the round";
    tick();
    renderStatus.timer = setInterval(tick, 100);
    return;
  }
  renderClock();
  if (state.phase == "playing") {
    var turn = myTurn();
    var seat = state.current ? state.seats[state.current.seat] : null;
    status.innerText = turn ? "Your turn!" : seat ? seat.name + " is playing..." : "";
  } else if (state.phase == "dealer") {
    status.innerText = "The dealer plays...";
  } else {
    status.innerText = "Round over - next round in a moment";
  }
}

function renderBars() {
  var betBar = document.getElementById("bjBetBar");
  var canBet = state.phase == "betting" && selected != null;
  betBar.hidden = !canBet;
  if (canBet) {
    var seat = state.seats[selected];
    var already = seat ? seat.bet : 0;
    document.getElementById("bjBetSeat").innerText = "Seat " + (selected + 1) + (already ? " · 🪙 " + formatCoins(already) + " on it" : "");
    var room = Math.min(state.rules.maxBet - already, myCoins);
    document.getElementById("bjAmount").max = room;
    document.querySelectorAll(".bj-chip").forEach((chip) => (chip.disabled = Number(chip.dataset.chip) > room));
  }

  var actions = document.getElementById("bjActions");
  var turn = myTurn();
  actions.hidden = !(state.phase == "playing" && turn);
  if (turn) {
    var hand = turn.hand;
    document.getElementById("bjActionLabel").innerText = "Seat " + (state.current.seat + 1) + (turn.seat.hands.length > 1 ? " · hand " + (state.current.hand + 1) : "") + " · " + valueText(hand.value, false);
    var two = hand.cards.length == 2;
    var value = (card) => ("TJQK".includes(card[0]) ? 10 : card[0] == "A" ? 11 : Number(card[0]));
    document.querySelector('[data-action="double"]').disabled = !two || myCoins < hand.bet;
    document.querySelector('[data-action="split"]').disabled = !two || value(hand.cards[0]) != value(hand.cards[1]) || turn.seat.hands.length >= 4 || myCoins < hand.bet;
    // The time for the move runs out
    var fill = document.getElementById("bjTurnFill");
    fill.style.transition = "none";
    fill.style.width = (100 * state.turnIn) / state.rules.turn + "%";
    void fill.offsetWidth;
    fill.style.transition = "width " + state.turnIn + "ms linear";
    fill.style.width = "0%";
  }
}

function renderHistory() {
  var list = document.getElementById("bjHistory");
  document.getElementById("bjHistoryEmpty").hidden = state.history.length > 0;
  list.replaceChildren(
    ...state.history.map((round) => {
      var item = el("li");
      var mine = round.results.filter((r) => r.name == myName);
      var gain = mine.reduce((sum, r) => sum + r.payout - r.bet, 0);
      item.append(
        el("span", "jp-history-name", "Dealer " + (round.dealer > 21 ? "bust" : round.dealer)),
        el("span", "jp-history-odds", round.results.length + (round.results.length == 1 ? " hand" : " hands")),
        el("span", "jp-history-won" + (gain < 0 ? " minus" : ""), mine.length ? (gain >= 0 ? "+" : "") + formatCoins(gain) : "-"),
      );
      return item;
    }),
  );
}

/* ---------- Setup ---------- */

document.addEventListener("DOMContentLoaded", () => {
  setupChat();
  var amount = document.getElementById("bjAmount");
  document.querySelectorAll(".bj-chip").forEach((chip) =>
    chip.addEventListener("click", () => {
      amount.value = Math.min(Number(amount.max) || Infinity, (Number(amount.value) || 0) + Number(chip.dataset.chip));
    }),
  );
  document.getElementById("bjBet").addEventListener("click", () => {
    var value = Number(amount.value);
    if (!Number.isInteger(value) || value <= 0 || selected == null) return showToast("Enter the coins for the seat.", "error");
    socket.emit("bet", { seat: selected, amount: value });
    amount.value = "";
  });
  // Stand up: the bet on the seat comes back
  document.getElementById("bjClear").addEventListener("click", () => {
    socket.emit("clearBet", selected);
    selected = null;
  });
  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => socket.emit("action", button.dataset.action)));
});
