/* Hidden blackjack: the server deals and decides, this page only shows the table (or the lobby). */
// ?table=<id>: that table, without: the lobby with every table
var TABLE_ID = new URLSearchParams(location.search).get("table");
const socket = io("/blackjack", { query: { table: TABLE_ID || "lobby" } });

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
// The admin turned this game off: on to another one
socket.on("gameOff", () => (window.location.href = "./"));

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

socket.on("blackjackTables", renderLobby);

/* ---------- Lobby ---------- */

var PHASES = { betting: "Taking bets", playing: "Cards on the table", dealer: "Dealer's turn", result: "Paying out" };

function renderLobby(list) {
  var lobby = document.getElementById("bjLobby");
  lobby.replaceChildren(
    ...list.map((t) => {
      var card = el("a", "mm-card bj-lobby-card" + (t.free == 0 ? " full" : "") + (t.mine > 0 ? " mine" : ""));
      card.href = "blackjack?table=" + encodeURIComponent(t.id);
      var head = el("div", "bj-lobby-head");
      head.append(el("span", "bj-lobby-icon", t.icon), el("span", "bj-lobby-name", t.name));
      var limits = el("div", "bj-lobby-limits", "🪙 " + formatCoins(t.minBet) + " – " + formatCoins(t.maxBet));
      limits.appendChild(el("span", "mm-muted", " per seat"));
      // The seats: taken or free
      var seats = el("div", "bj-lobby-seats");
      for (var i = 0; i < t.seats; i++) seats.appendChild(el("span", "bj-lobby-seat" + (i < t.seats - t.free ? " taken" : "")));
      seats.appendChild(el("span", "bj-lobby-free", t.free == 0 ? "Full" : t.free + " of " + t.seats + " seats free"));
      var players = el("div", "bj-lobby-players");
      if (t.players.length) {
        t.players.slice(0, 5).forEach((name) => {
          var avatar = createAvatar(name, "sm");
          avatar.title = name;
          players.appendChild(avatar);
        });
        players.appendChild(el("span", "mm-muted small", t.players.length == 1 ? "1 player" : t.players.length + " players"));
      } else {
        players.appendChild(el("span", "mm-muted small", "Nobody here yet"));
      }
      var foot = el("div", "bj-lobby-foot");
      foot.append(
        el("span", "bj-lobby-phase " + t.phase, t.players.length ? PHASES[t.phase] + " · round " + t.round : "Waiting for players"),
        el("span", "mm-btn mm-btn-sm mm-btn-primary", t.mine > 0 ? "Back to your seat" : t.free == 0 ? "Watch" : "Take a seat"),
      );
      card.append(head, el("p", "bj-lobby-about", t.about), limits, seats, players, foot);
      return card;
    }),
  );
}

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

// The chip in the hand: a click on a bet field of an own seat puts it there
var CHIP_KEY = "bjChip";
var chipValue = 100;
try {
  chipValue = Number(localStorage.getItem(CHIP_KEY)) || 100;
} catch (error) {
  // only for now
}
var SIDE_NAMES = { pairs: "Perfect Pairs", plus3: "21+3" };

// Puts the chip in the hand on a bet field (main, pairs, plus3) of an own seat
function placeChip(seatIndex, field) {
  var seat = state.seats[seatIndex];
  if (!seat || seat.name != myName || state.phase != "betting") return;
  selected = seatIndex;
  if (field == "main") {
    // The first chip at least the table minimum
    var amount = seat.bet == 0 ? Math.max(chipValue, state.rules.minBet) : chipValue;
    amount = Math.min(amount, state.rules.maxBet - seat.bet);
    if (amount <= 0) return showToast("The most for this seat: 🪙 " + formatCoins(state.rules.maxBet) + ".", "error");
    socket.emit("bet", { seat: seatIndex, amount: amount });
  } else {
    if (seat.bet == 0) return showToast("Place the main bet first.", "error");
    var room = Math.floor(seat.bet * state.rules.sideShare) - seat.side[field];
    if (room <= 0) return showToast(SIDE_NAMES[field] + ": at most half the main bet.", "error");
    socket.emit("sideBet", { seat: seatIndex, type: field, amount: Math.min(chipValue, room) });
  }
}

// The three bet fields of an own seat while betting: Perfect Pairs, the bet, 21+3
// The chips on a field as a stack (the biggest at the bottom), like on a real table
var CHIPS = [5000, 1000, 500, 100, 50, 10];
function chipStack(amount) {
  var discs = [];
  var rest = amount;
  CHIPS.forEach((chip) => {
    while (rest >= chip && discs.length < 40) {
      discs.push(chip);
      rest -= chip;
    }
  });
  // Odd coins (a table minimum like 25): one more small chip
  if (rest > 0) discs.push(10);
  var stack = el("span", "bj-stack");
  // At most 8 to see - a high stack stays a stack
  discs.slice(0, 8).forEach((chip, n) => {
    var disc = el("span", "bj-disc");
    disc.dataset.chip = chip;
    disc.style.setProperty("--n", n);
    stack.appendChild(disc);
  });
  return stack;
}

function betFields(seat, i) {
  var fields = el("div", "bj-fields");
  [
    ["pairs", "PP"],
    ["main", "BET"],
    ["plus3", "21+3"],
  ].forEach(([field, label]) => {
    var value = field == "main" ? seat.bet : seat.side[field];
    var spot = el("button", "bj-field " + field + (value > 0 ? " filled" : ""));
    spot.type = "button";
    spot.title = field == "main" ? "Your bet - click to put the chip here" : SIDE_NAMES[field] + " - up to half the bet";
    spot.disabled = field != "main" && seat.bet == 0;
    if (value > 0) spot.append(chipStack(value), el("span", "bj-field-amount", formatCoins(value)));
    else spot.appendChild(el("span", "bj-field-label", label));
    spot.addEventListener("click", (event) => {
      event.stopPropagation();
      placeChip(i, field);
    });
    fields.appendChild(spot);
  });
  return fields;
}

function mySeats() {
  return state.seats.map((seat, i) => (seat && seat.name == myName ? i : -1)).filter((i) => i >= 0);
}

// A seat of mine without a bet: first a bet there, then another seat
function myEmptySeat() {
  return mySeats().find((i) => state.seats[i].bet == 0 && state.seats[i].hands.length == 0);
}

function render() {
  if (state == null) return;
  document.getElementById("bjTableName").innerText = "· " + state.table.icon + " " + state.table.name;
  document.getElementById("bjLimits").innerText = formatCoins(state.rules.minBet) + " - " + formatCoins(state.rules.maxBet) + " per seat";
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
  var full = mySeats().length >= state.rules.mySeats;
  var blocked = myEmptySeat() != null || full;
  container.style.setProperty("--seats", state.seats.length);
  container.replaceChildren(
    ...state.seats.map((seat, i) => {
      var spot = el("div", "bj-seat");
      // Seat 1 on the right: the cards go round clockwise from there
      spot.style.gridColumn = String(state.seats.length - i);
      spot.style.gridRow = "1";
      // In an arc: the middle seats lower
      spot.style.setProperty("--lift", Math.round(Math.sin((Math.PI * i) / (state.seats.length - 1)) * 36) + "px");
      if (selected == i && betting) spot.classList.add("selected");

      if (seat == null) {
        spot.classList.add("empty");
        var take = el("button", "bj-seat-empty");
        take.type = "button";
        take.append(el("span", "bj-seat-chair", "🪑"), el("span", "", "Sit down"));
        take.disabled = blocked;
        take.title = full ? "At most " + state.rules.mySeats + " seats" : blocked ? "Bet on your seat first" : "Seat " + (i + 1);
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
      var side = seat.side.pairs + seat.side.plus3;
      // One pill: the bet (and the side bets) - or, without a bet, how long the seat is kept
      var chip = el("span", "bj-bet" + (bet > 0 ? "" : " empty"), bet > 0 ? "🪙 " + formatCoins(bet) : mine ? "Place a bet" : "");
      if (bet > 0 && side > 0) chip.appendChild(el("span", "bj-bet-side", " +" + formatCoins(side)));
      if (seat.standIn != null && bet == 0) {
        chip.classList.add("bj-stand");
        chip.dataset.end = Date.now() + seat.standIn;
        chip.dataset.label = mine ? "Place a bet · " : "";
      }
      // Side bets that won (decided by the first cards)
      var sideWins = seat.sideResults.filter((r) => r.payout > 0);
      if (sideWins.length) hands.appendChild(el("span", "bj-side-win", sideWins.map((r) => r.name + " +" + formatCoins(r.payout - r.bet)).join(" · ")));
      var who = el("div", "bj-who");
      who.append(createAvatar(seat.name, "sm"), el("span", "bj-name", mine ? "You" : seat.name));
      // While betting the own seats show their bet fields (the time to bet is in the pill under them)
      if (mine && betting) {
        var timer = seat.standIn != null && bet == 0 ? chip : null;
        if (timer) timer.dataset.label = "";
        spot.append(hands, betFields(seat, i));
        if (timer) spot.appendChild(timer);
        spot.appendChild(who);
      } else spot.append(hands, chip, who);
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

// The seats without a bet: "Place a bet · 12s" (then the seat is free again)
function tickStand() {
  document.querySelectorAll(".bj-stand").forEach((element) => {
    var left = Math.max(0, Math.ceil((Number(element.dataset.end) - Date.now()) / 1000));
    element.innerText = element.dataset.label + left + "s";
    element.title = "Without a bet the seat is free again in " + left + "s";
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

// One click: the same bets as last round
function renderRebet() {
  var bar = document.getElementById("bjRebet");
  var last = state.lastBets;
  var betNow = mySeats().some((i) => state.seats[i].bet > 0);
  var total = last ? last.reduce((sum, bet) => sum + bet.amount, 0) : 0;
  bar.hidden = !(state.phase == "betting" && last && last.length && !betNow);
  if (bar.hidden) return;
  var button = document.getElementById("bjRebetButton");
  button.disabled = total > myCoins;
  document.getElementById("bjRebetText").innerText = "Same bet · 🪙 " + formatCoins(total) + (last.length > 1 ? " on " + last.length + " seats" : "");
}

function renderBars() {
  renderRebet();
  var betBar = document.getElementById("bjBetBar");
  var canBet = state.phase == "betting" && selected != null;
  betBar.hidden = !canBet;
  if (canBet) {
    var seat = state.seats[selected];
    document.querySelectorAll(".bj-chip").forEach((chip) => {
      var on = Number(chip.dataset.chip) == chipValue;
      chip.classList.toggle("active", on);
      chip.setAttribute("aria-checked", on ? "true" : "false");
      chip.disabled = Number(chip.dataset.chip) > myCoins;
    });
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
      var mine = round.results.filter((r) => r.name == myName);
      var gain = mine.reduce((sum, r) => sum + r.payout - r.bet, 0);
      // Hands (side bets count only for the own plus / minus)
      var hands = round.results.filter((r) => r.result != "side");
      var won = hands.filter((r) => r.payout > r.bet).length;
      var title = round.dealer > 21 ? "Dealer bust" : "Dealer " + round.dealer;
      var sub = "Round " + round.round + " · " + won + " of " + hands.length + (hands.length == 1 ? " hand" : " hands") + " won";
      // Own result: plus or minus; not played: nothing
      var value = mine.length ? (gain > 0 ? "+" : gain < 0 ? "−" : "±") + formatCoins(Math.abs(gain)) : "–";
      return historyItem(round.dealer > 21 ? "💥" : "🃏", title, sub, value, mine.length ? (gain > 0 ? "plus" : gain < 0 ? "minus" : "") : "muted");
    }),
  );
}

/* ---------- Setup ---------- */

document.addEventListener("DOMContentLoaded", () => {
  setupChat();
  // A table or the lobby
  document.getElementById("bjTableView").hidden = !TABLE_ID;
  document.getElementById("bjBackToLobby").hidden = !TABLE_ID;
  document.getElementById("bjLobby").hidden = !!TABLE_ID;
  document.getElementById("bjLimits").style.display = TABLE_ID ? "" : "none";
  // The last rounds belong to a table, not to the lobby
  document.getElementById("bjHistory").closest(".side-card").hidden = !TABLE_ID;
  if (!TABLE_ID) document.getElementById("bjStatus").innerText = "Pick a table - every table has its own stakes.";
  // Pick a chip (it stays picked) - by click or with the arrows
  var pickChip = (value) => {
    chipValue = value;
    try {
      localStorage.setItem(CHIP_KEY, String(chipValue));
    } catch (error) {
      // only for now
    }
    if (state) renderBars();
  };
  document.querySelectorAll(".bj-chip").forEach((chip) => chip.addEventListener("click", () => pickChip(Number(chip.dataset.chip))));
  document.querySelectorAll(".bj-chip-arrow").forEach((arrow) =>
    arrow.addEventListener("click", () => {
      var values = [...document.querySelectorAll(".bj-chip:not(:disabled)")].map((chip) => Number(chip.dataset.chip));
      if (values.length == 0) return;
      var at = values.indexOf(chipValue);
      var next = at < 0 ? 0 : Math.min(values.length - 1, Math.max(0, at + Number(arrow.dataset.step)));
      pickChip(values[next]);
    }),
  );
  // Stand up: the bet on the seat comes back
  document.getElementById("bjClear").addEventListener("click", () => {
    socket.emit("clearBet", selected);
    selected = null;
  });
  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => socket.emit("action", button.dataset.action)));
  document.getElementById("bjRebetButton").addEventListener("click", () => {
    selected = null;
    socket.emit("rebet");
  });
});
