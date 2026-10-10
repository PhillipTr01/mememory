/* Hidden blackjack: the server deals and decides, this page only shows the table (or the lobby). */
// ?table=<id>: that table, without: the lobby with every table
var TABLE_ID = new URLSearchParams(location.search).get("table");
const socket = io((window.CASINO_NS || "") + "/blackjack", { query: { table: TABLE_ID || "lobby" } });

var myName = null;
var myCoins = 0;
var myCapRule = null; // the max bet by balance ({floor, share} - null: no cap), see casinoCapLeft
// What more I may bet this round (`already`: my coins in it)
function capLeft(already) {
  return casinoCapLeft(myCapRule, myCoins, already);
}
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
  if (state) renderBars();
});
socket.on("blackjackError", (message) => showHint(message, "error"));

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

/*
 * The chips of a table: from the side bet minimum or its min bet, the smaller (left - chips for the side bets and
 * to top a bet up) to its max bet (right), round steps in between that grow evenly, the min bet always one of them - so they fit
 * the limits the admin set. The colours go by place (the smallest grey ... the biggest copper).
 */
var CHIP_COUNT = 6;
var CHIPS = [1000, 500, 250, 100, 50, 10]; // the chips of the table now, the biggest first (for the stacks on the fields)

// A round number near `value` (1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5 times a power of ten)
function roundChip(value) {
  var power = Math.pow(10, Math.floor(Math.log10(Math.max(1, value))));
  var best = null;
  [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 10].forEach((m) => {
    var candidate = m * power;
    if (candidate != Math.round(candidate)) return;
    if (best == null || Math.abs(candidate - value) < Math.abs(best - value)) best = candidate;
  });
  return best != null ? best : Math.round(value);
}

function tableChips(min, max) {
  if (!(max >= min)) return [min];
  var low = Math.min(min, state && state.rules.sideMin ? state.rules.sideMin : min);
  if (!(max > low)) return [max];
  var list = [low];
  for (var i = 1; i < CHIP_COUNT - 1; i++) {
    var value = roundChip(low * Math.pow(max / low, i / (CHIP_COUNT - 1)));
    if (value > list[list.length - 1] && value < max) list.push(value);
  }
  list.push(max);
  // The min bet is a chip too: in place of the step nearest to it (never the smallest or the biggest)
  if (!list.includes(min)) {
    var inner = list.slice(1, -1);
    if (inner.length) {
      var near = inner.reduce((best, value) => (Math.abs(Math.log(value / min)) < Math.abs(Math.log(best / min)) ? value : best), inner[0]);
      list[list.indexOf(near)] = min;
    } else list.splice(list.length - 1, 0, min);
    list = list.filter((value, i) => i == 0 || value > list[i - 1]).sort((a, b) => a - b);
  }
  return list;
}

// The chip buttons for the limits of the table (built again only when they change)
var shownChips = "";
function renderChips() {
  var list = tableChips(state.rules.minBet, state.rules.maxBet);
  CHIPS = list.slice().reverse();
  // The chip in the hand: one of these (the nearest)
  if (!list.includes(chipValue)) chipValue = list.reduce((best, value) => (Math.abs(value - chipValue) < Math.abs(best - chipValue) ? value : best), list[0]);
  var key = list.join(",");
  if (key == shownChips) return;
  shownChips = key;
  document.querySelector(".bj-chips").replaceChildren(
    ...list.map((value, i) => {
      var chip = el("button", "bj-chip", shortCoins(value));
      chip.type = "button";
      chip.setAttribute("role", "radio");
      chip.dataset.chip = value;
      // (the colour by place - the biggest always copper)
      chip.dataset.rank = String(CHIP_COUNT - list.length + i);
      chip.title = "🪙 " + formatCoins(value);
      return chip;
    }),
  );
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
    // (all my coins on the table this round count for the max bet by balance)
    var onTable = state.seats.reduce((sum, s) => (s && s.name == myName ? sum + (s.bet || 0) + (s.side ? (s.side.pairs || 0) + (s.side.plus3 || 0) : 0) : sum), 0);
    amount = Math.min(amount, state.rules.maxBet - seat.bet, capLeft(onTable));
    if (amount <= 0 && capLeft(onTable) <= 0) return showHint("With your balance you can't bet more this round.", "error");
    if (amount <= 0) return showHint("The most for this seat: 🪙 " + formatCoins(state.rules.maxBet) + ".", "error");
    socket.emit("bet", { seat: seatIndex, amount: amount });
  } else {
    if (seat.bet == 0) return showHint("Place the main bet first.", "error");
    // At most half the table's max bet per side bet
    var room = Math.floor(state.rules.maxBet * state.rules.sideShare) - seat.side[field];
    if (room <= 0) return showHint(SIDE_NAMES[field] + ": at most 🪙 " + formatCoins(Math.floor(state.rules.maxBet * state.rules.sideShare)) + " (half the max bet).", "error");
    // The first chip at least the side bet minimum
    var side = seat.side[field] == 0 ? Math.max(chipValue, state.rules.sideMin || 0) : chipValue;
    socket.emit("sideBet", { seat: seatIndex, type: field, amount: Math.min(side, room) });
  }
}

// The three bet fields of an own seat while betting: Perfect Pairs, the bet, 21+3
// The coins on a field as one chip (the colour of the biggest chip of the table in it, the edge thicker for more chips)
function shortCoins(value) {
  if (value >= 1000) return (value / 1000).toFixed(value % 1000 ? 1 : 0).replace(".0", "") + "K";
  return String(value);
}

function chipFace(amount) {
  var top = CHIPS.find((chip) => chip <= amount) || CHIPS[CHIPS.length - 1];
  var count = 0;
  var rest = amount;
  CHIPS.forEach((chip) => {
    count += Math.floor(rest / chip);
    rest %= chip;
  });
  var face = el("span", "bj-chipface" + (count > 3 ? " tall" : count > 1 ? " stacked" : ""), shortCoins(amount));
  face.dataset.chip = top;
  face.dataset.rank = String(CHIP_COUNT - CHIPS.length + (CHIPS.length - 1 - CHIPS.indexOf(top)));
  face.title = "🪙 " + formatCoins(amount);
  return face;
}

// The bet with its side bets after the deal: PP left, 21+3 right
function sideRow(seat, i, chip, dealing, order) {
  var row = el("div", "bj-bet-row");
  var before = previous && previous.round == state.round && previous.seats[i];
  // Decided just now: the lost chips go to the dealer (after the cards are on the table)
  var fresh = !(before && before.sideResults && before.sideResults.length);
  var delay = dealing ? dealDelay(1, order.length, order.length) + 500 : 250;
  var slot = (type) => {
    var box = el("span", "bj-side-slot");
    var result = seat.sideResults.find((r) => r.type == type);
    if (!result) return box;
    var gain = result.payout - result.bet;
    if (result.payout > 0) {
      var won = el("span", "bj-side-chip won", "+" + shortCoins(gain));
      won.title = result.name + ": +" + formatCoins(gain);
      box.appendChild(won);
      if (fresh) won.animate([{ transform: "scale(0)", opacity: 0 }, { transform: "scale(1.25)", opacity: 1, offset: 0.6 }, { transform: "scale(1)" }], { duration: 500, delay: delay, fill: "backwards", easing: "ease-out" });
    } else if (fresh) {
      var lost = chipFace(result.bet);
      lost.classList.add("bj-side-chip", "lost");
      box.appendChild(lost);
      lost.animate([{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(-60px) scale(0.6)", opacity: 0 }], { duration: 700, delay: delay, easing: "ease-in", fill: "forwards" }).finished.then(() => lost.remove());
    }
    return box;
  };
  row.append(slot("pairs"), chip, slot("plus3"));
  return row;
}

function betFields(seat, i) {
  var fields = el("div", "bj-fields");
  [
    ["pairs", "PP"],
    ["main", "BET"],
    ["plus3", "21+3"],
  ].forEach(([field, label]) => {
    var value = field == "main" ? seat.bet : seat.side[field];
    var wrap = el("div", "bj-field-wrap " + field);
    var spot = el("button", "bj-field " + field + (value > 0 ? " filled" : ""));
    spot.type = "button";
    spot.title = field == "main" ? "Your bet - click to put the chip here" : SIDE_NAMES[field] + " - up to the bet";
    spot.disabled = field != "main" && seat.bet == 0;
    if (value > 0) spot.appendChild(chipFace(value));
    spot.addEventListener("click", (event) => {
      event.stopPropagation();
      placeChip(i, field);
    });
    spot.setAttribute("aria-label", label);
    wrap.append(spot, el("span", "bj-field-label", label));
    fields.appendChild(wrap);
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
      var element = cardElement(card, fresh, delay);
      // The dealer checks the hidden card (an ace or a 10 showing): it lifts at the corner
      if (card == null && state.peeking) {
        var peek = dealing ? dealDelay(1, count, count) + 500 : 0;
        element.classList.add("peek");
        // (two animations on the card: the deal, then the look)
        element.style.animationDelay = fresh ? delay + "ms, " + peek + "ms" : peek + "ms";
      }
      return element;
    }),
  );
  // The dealer's blackjack: a banner over the cards (when the card is turned)
  var dealerBJ = !state.dealer.hidden && state.dealer.cards.length == 2 && state.dealer.value && state.dealer.value.total == 21;
  var banner = document.getElementById("bjDealerBanner");
  if (dealerBJ && !banner) {
    banner = el("div", "bj-dealer-banner", "BLACKJACK");
    banner.id = "bjDealerBanner";
    document.querySelector(".bj-dealer").appendChild(banner);
  } else if (!dealerBJ && banner) banner.remove();
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
          // Lost against the dealer's blackjack: said so
          var dealerBJ = state.dealer.cards.length == 2 && state.dealer.value && state.dealer.value.total == 21;
          var label = hand.result == "lose" && dealerBJ ? "Dealer BJ" : RESULTS[hand.result];
          box.appendChild(el("span", "bj-result " + hand.result, label + (gain > 0 ? " +" + formatCoins(gain) : "")));
        }
        hands.appendChild(box);
      });

      var bet = seat.hands.length ? seat.hands.reduce((sum, hand) => sum + hand.bet, 0) : seat.bet;
      var side = seat.side.pairs + seat.side.plus3;
      // One pill: the bet (and the side bets) - or, without a bet, how long the seat is kept
      var chip = el("span", "bj-bet" + (bet > 0 ? "" : " empty"), bet > 0 ? "🪙 " + formatCoins(bet) : mine ? "Place a bet" : "");
      var decided = seat.sideResults.length > 0;
      if (bet > 0 && side > 0 && !decided) chip.appendChild(el("span", "bj-bet-side", " +" + formatCoins(side)));
      if (seat.standIn != null && bet == 0) {
        chip.classList.add("bj-stand");
        chip.dataset.end = Date.now() + seat.standIn;
        chip.dataset.label = mine ? "Place a bet · " : "";
      }
      // The side bets after the deal: left and right of the bet - a won one shows its win, a lost one is taken away
      if (decided) chip = sideRow(seat, i, chip, dealing, order);
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
// Text only when it changes (the timers tick 10 times a second - the page is laid out again only once a second)
function setText(element, text) {
  if (element.textContent !== text) element.textContent = text;
}

function tickStand() {
  document.querySelectorAll(".bj-stand").forEach((element) => {
    var left = Math.max(0, Math.ceil((Number(element.dataset.end) - Date.now()) / 1000));
    if (element.dataset.left == left) return;
    element.dataset.left = left;
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
  // Alone at the table with a bet: deal right away
  var seated = state.seats.filter(Boolean);
  document.getElementById("bjDealNow").hidden = !(seated.length && seated.every((seat) => seat.name == myName) && seated.some((seat) => seat.bet > 0));
  var left = Math.max(0, renderStatus.end - Date.now());
  var seconds = Math.ceil(left / 1000);
  setText(document.getElementById("bjClockNum"), String(seconds));
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
      setText(status, "Place your bets - cards in " + left + "s");
    }
    renderClock();
    tickStand();
  };
  if (state.phase == "betting") {
    if (renderStatus.end == null) status.innerText = "Sit down and place a bet to start the round";
    tick();
    // Only while something counts down (the clock, a seat that is freed without a bet)
    if (renderStatus.end != null || document.querySelector(".bj-stand")) renderStatus.timer = setInterval(tick, 100);
    return;
  }
  renderClock();
  if (state.phase == "playing") {
    var turn = myTurn();
    var seat = state.current ? state.seats[state.current.seat] : null;
    status.innerText = state.peeking ? "The dealer checks for blackjack..." : turn ? "Your turn!" : seat ? seat.name + " is playing..." : "";
  } else if (state.phase == "dealer") {
    var bjNow = state.dealer.cards.length == 2 && state.dealer.value && state.dealer.value.total == 21;
    status.innerText = bjNow ? "The dealer has Blackjack!" : "The dealer plays...";
  } else {
    status.innerText = "Round over - next round in a moment";
  }
}

// One click: the same bets as last round
// One click: the same bets as last round - only for a player at the table who hasn't bet yet
function renderRebet() {
  var button = document.getElementById("bjRebetButton");
  var last = state.lastBets;
  var betNow = mySeats().some((i) => state.seats[i].bet > 0);
  var sides = (bet) => (bet.side ? bet.side.pairs + bet.side.plus3 : 0);
  var total = last ? last.reduce((sum, bet) => sum + bet.amount + sides(bet), 0) : 0;
  button.hidden = !(state.phase == "betting" && mySeats().length > 0 && last && last.length && !betNow);
  if (button.hidden) return;
  button.disabled = total > myCoins;
  // The whole amount: bets and side bets
  document.getElementById("bjRebetText").innerText = "🪙 " + formatCoins(total) + (last.length > 1 ? " · " + last.length + " seats" : "");
  button.title = total > myCoins ? "Not enough coins" : "Same bet as last round";
  button.setAttribute("aria-label", "Same bet as last round: " + formatCoins(total) + " coins");
}

/*
 * The outline of a bump on a bar: the top with round corners, the sides go
 * down into soft shoulders that end on the line of the bar. One SVG path, so
 * it is smooth at every size (drawn again when the bump changes its size).
 */
var BUMP_SHOULDER = 12;
var BUMP_RADIUS = 12;
var bumpSizes = new ResizeObserver((entries) => entries.forEach((entry) => bumpShape(entry.target)));
function bumpShape(bump) {
  var w = bump.offsetWidth;
  var h = bump.offsetHeight;
  if (!w || !h) return;
  var NS = "http://www.w3.org/2000/svg";
  var svg = bump.querySelector(":scope > .bj-bump-shape");
  if (!svg) {
    svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "bj-bump-shape");
    svg.setAttribute("aria-hidden", "true");
    svg.append(document.createElementNS(NS, "path"), document.createElementNS(NS, "path"));
    svg.firstChild.setAttribute("class", "fill");
    svg.lastChild.setAttribute("class", "line");
    bump.prepend(svg);
    bumpSizes.observe(bump);
  }
  var s = BUMP_SHOULDER;
  var r = Math.min(BUMP_RADIUS, h / 2);
  var y = h - 0.5; // the middle of the bar's line (the bump's last pixel row)
  svg.setAttribute("width", w + 2 * s);
  svg.setAttribute("height", h);
  svg.style.left = -s + "px";
  var line = `M0 ${y} Q${s} ${y} ${s} ${y - s} V${r} Q${s} 0.5 ${s + r} 0.5 H${s + w - r} Q${s + w} 0.5 ${s + w} ${r} V${y - s} Q${s + w} ${y} ${w + 2 * s} ${y}`;
  svg.lastChild.setAttribute("d", line);
  // (the fill reaches a little into the bar: its top border never shows under the bump - also when zoomed)
  svg.firstChild.setAttribute("d", line + ` V${h + 3} H0 Z`);
}

// What the round brought me (the result phase): {total} - every hand and side bet of my seats together, null: not played
function roundNet() {
  var total = 0;
  var sides = 0;
  var played = false;
  state.seats.forEach((seat) => {
    if (!seat || seat.name != myName) return;
    seat.hands.forEach((hand) => {
      played = true;
      total += (hand.payout || 0) - hand.bet;
    });
    (seat.sideResults || []).forEach((result) => {
      played = true;
      sides += (result.payout || 0) - result.bet;
    });
  });
  return played ? { total: total + sides } : null;
}

// The own seats one can leave now (not while their cards are played)
function standable() {
  return mySeats().filter((i) => state.phase == "betting" || state.seats[i].hands.length == 0);
}

function renderBars() {
  renderRebet();
  requestAnimationFrame(() => document.querySelectorAll(".bj-bump:not([hidden])").forEach(bumpShape));
  // Leave: only the selected seat
  var stand = document.getElementById("bjStand");
  stand.hidden = selected == null || !standable().includes(selected);
  var betBar = document.getElementById("bjBetBar");
  var canBet = state.phase == "betting" && selected != null;
  betBar.hidden = !canBet;
  // Clear all bets: when there are own bets on the table
  document.getElementById("bjClearBets").hidden = !(state.phase == "betting" && mySeats().some((i) => state.seats[i].bet > 0));
  if (state.rules) renderChips();
  if (canBet) {
    var seat = state.seats[selected];
    document.querySelectorAll(".bj-chip").forEach((chip) => {
      var on = Number(chip.dataset.chip) == chipValue;
      chip.classList.toggle("active", on);
      chip.setAttribute("aria-checked", on ? "true" : "false");
      chip.disabled = Number(chip.dataset.chip) > myCoins;
    });
  }

  // The action bar is always there (when the bet bar isn't): the moves only on the own turn
  var actions = document.getElementById("bjActions");
  var turn = state.phase == "playing" ? myTurn() : null;
  actions.hidden = canBet;
  actions.classList.toggle("idle", !turn);
  var label = document.getElementById("bjActionLabel");
  label.classList.remove("plus", "minus");
  var net = state.phase == "result" ? roundNet() : null;
  if (!turn && net) {
    // The round is paid: what it really brought - every own hand and every side bet together
    label.innerText = (net.total > 0 ? "Win: " : net.total < 0 ? "Lose: " : "Push: ") + "🪙 " + formatCoins(Math.abs(net.total));
    label.classList.add(net.total > 0 ? "plus" : net.total < 0 ? "minus" : "even");
  } else if (!turn) {
    label.innerText = mySeats().length == 0 ? "Take a seat to play" : state.phase == "betting" ? "Pick your seat to bet" : "Waiting for your turn";
    document.querySelectorAll("#bjActions [data-action]").forEach((button) => (button.disabled = true));
    var idleFill = document.getElementById("bjTurnFill");
    idleFill.style.transition = "none";
    idleFill.style.width = "0%";
  }
  if (turn) {
    document.querySelectorAll("#bjActions [data-action]").forEach((button) => (button.disabled = false));
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
      var sub = "Round " + round.round + " · " + won + " / " + hands.length + (hands.length == 1 ? " hand" : " hands") + " won";
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
  // (the chips are made for every table: one listener for all of them)
  document.querySelector(".bj-chips").addEventListener("click", (event) => {
    var chip = event.target.closest(".bj-chip");
    if (chip && !chip.disabled) pickChip(Number(chip.dataset.chip));
  });
  document.querySelectorAll(".bj-chip-arrow").forEach((arrow) =>
    arrow.addEventListener("click", () => {
      var values = [...document.querySelectorAll(".bj-chip:not(:disabled)")].map((chip) => Number(chip.dataset.chip));
      if (values.length == 0) return;
      var at = values.indexOf(chipValue);
      var next = at < 0 ? 0 : Math.min(values.length - 1, Math.max(0, at + Number(arrow.dataset.step)));
      pickChip(values[next]);
    }),
  );
  // Stand up (every own seat that isn't dealt in): the bets come back
  // Leave the selected seat (its bet comes back) - the other own seats stay
  document.getElementById("bjStand").addEventListener("click", () => {
    if (selected == null || !standable().includes(selected)) return;
    socket.emit("clearBet", selected);
    selected = null;
  });
  // All own bets off the table, the seats stay
  document.getElementById("bjClearBets").addEventListener("click", () => socket.emit("clearBets"));
  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => socket.emit("action", button.dataset.action)));
  document.getElementById("bjDealNow").addEventListener("click", () => socket.emit("dealNow"));
  document.getElementById("bjRebetButton").addEventListener("click", () => {
    selected = null;
    socket.emit("rebet");
  });
});

// The whole table with its bars (seats, cards, chips, the buttons) a bit smaller when the screen isn't high enough (casino_fullscreen.js) -
// again when the bet bar / the action bar comes or goes, and from the lobby to a table
window.casinoFitGame(document.getElementById("bjTableView"), [document.getElementById("bjBetBar"), document.getElementById("bjActions"), document.getElementById("bjTableView")]);
