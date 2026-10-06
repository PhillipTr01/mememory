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
  // The seat to bet on is gone (taken by somebody else)
  if (selected != null && state.seats[selected] && state.seats[selected].name != myName) selected = null;
  render();
});

/* ---------- Cards ---------- */

function cardElement(card, fresh, index) {
  if (card == null) {
    var back = el("div", "pk-card back" + (fresh ? " deal" : ""));
    return back;
  }
  var red = card[1] == "h" || card[1] == "d";
  var element = el("div", "pk-card" + (red ? " red" : "") + (fresh ? " deal" : ""));
  if (fresh) element.style.animationDelay = index * 90 + "ms";
  var rank = card[0] == "T" ? "10" : card[0];
  element.append(el("span", "pk-rank", rank), el("span", "pk-suit", SUITS[card[1]]));
  return element;
}

function valueText(value, blackjack) {
  if (blackjack) return "BJ";
  return value.soft && value.total <= 21 ? value.total - 10 + "/" + value.total : String(value.total);
}

/* ---------- Rendering ---------- */

function render() {
  if (state == null) return;
  document.getElementById("bjLimits").innerText = formatCoins(state.rules.minBet) + " - " + formatCoins(state.rules.maxBet) + " per seat";
  document.getElementById("bjViewers").innerText = state.viewers == 1 ? "1 here" : state.viewers + " here";
  renderDealer();
  renderSeats();
  renderStatus();
  renderBars();
  renderHistory();
}

function renderDealer() {
  var before = previous && previous.round == state.round ? previous.dealer.cards : [];
  var cards = document.getElementById("bjDealerCards");
  cards.replaceChildren(
    ...state.dealer.cards.map((card, i) => {
      // New, or just turned over
      var fresh = i >= before.length || (before[i] == null && card != null);
      return cardElement(card, fresh, i - before.length);
    }),
  );
  var value = document.getElementById("bjDealerValue");
  value.hidden = state.dealer.value == null;
  if (state.dealer.value) {
    var total = state.dealer.value.total;
    value.innerText = state.dealer.hidden ? String(total) + " + ?" : total > 21 ? "Bust " + total : valueText(state.dealer.value, !state.dealer.hidden && state.dealer.cards.length == 2 && total == 21);
    value.classList.toggle("bust", total > 21);
  }
}

function renderSeats() {
  var container = document.getElementById("bjSeats");
  var betting = state.phase == "betting";
  container.replaceChildren(
    ...state.seats.map((seat, i) => {
      var spot = el("div", "bj-seat");
      // In an arc: the middle seats lower
      spot.style.setProperty("--lift", [0, 26, 36, 26, 0][i % 5] + "px");
      if (selected == i && betting) spot.classList.add("selected");

      if (seat == null) {
        spot.classList.add("empty");
        var take = el("button", "bj-seat-empty", betting ? "Bet here" : "");
        take.type = "button";
        take.disabled = !betting;
        take.addEventListener("click", () => {
          selected = i;
          render();
          document.getElementById("bjAmount").focus();
        });
        spot.appendChild(take);
        return spot;
      }

      var mine = seat.name == myName;
      if (mine) spot.classList.add("mine");
      if (state.current && state.current.seat == i) spot.classList.add("turn");

      // The hands (more than one after a split)
      var hands = el("div", "bj-hands");
      var old = previous && previous.round == state.round && previous.seats[i] ? previous.seats[i].hands : [];
      seat.hands.forEach((hand, h) => {
        var box = el("div", "bj-hand");
        if (state.current && state.current.seat == i && state.current.hand == h) box.classList.add("active");
        if (hand.result) box.classList.add(hand.result);
        var cards = el("div", "bj-cards small");
        var seen = old[h] ? old[h].cards.length : 0;
        cards.append(...hand.cards.map((card, n) => cardElement(card, n >= seen, n - seen)));
        var value = el("span", "bj-value" + (hand.value.total > 21 ? " bust" : ""), hand.value.total > 21 ? "Bust" : valueText(hand.value, hand.blackjack));
        box.append(cards, value);
        if (hand.result && hand.result != "bust") {
          var gain = hand.payout - hand.bet;
          box.appendChild(el("span", "bj-result " + hand.result, RESULTS[hand.result] + (gain > 0 ? " +" + formatCoins(gain) : "")));
        }
        hands.appendChild(box);
      });

      var bet = seat.hands.length ? seat.hands.reduce((sum, hand) => sum + hand.bet, 0) : seat.bet;
      var chip = el("span", "bj-bet", bet > 0 ? "🪙 " + formatCoins(bet) : "No bet");
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
}

function myTurn() {
  if (!state.current) return null;
  var seat = state.seats[state.current.seat];
  if (!seat || seat.name != myName) return null;
  return { seat: seat, hand: seat.hands[state.current.hand] };
}

function renderStatus() {
  var status = document.getElementById("bjStatus");
  if (state.phase == "betting") {
    if (state.startIn != null) {
      var end = Date.now() + state.startIn;
      clearInterval(renderStatus.timer);
      var tick = () => {
        var left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
        status.innerText = "Place your bets - cards in " + left + "s";
        if (left <= 0) clearInterval(renderStatus.timer);
      };
      tick();
      renderStatus.timer = setInterval(tick, 250);
      return;
    }
    clearInterval(renderStatus.timer);
    status.innerText = "Place a bet on a seat to start the round";
    return;
  }
  clearInterval(renderStatus.timer);
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
    var already = seat && seat.name == myName ? seat.bet : 0;
    document.getElementById("bjBetSeat").innerText = "Seat " + (selected + 1) + (already ? " · 🪙 " + formatCoins(already) + " on it" : "");
    document.getElementById("bjClear").hidden = !already;
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
  document.getElementById("bjClear").addEventListener("click", () => {
    socket.emit("clearBet", selected);
    selected = null;
  });
  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => socket.emit("action", button.dataset.action)));
});
