/* Tic Tac Toe XL: client. The server decides everything, this only draws the state. */
const socket = io("/tictactoe");

var params = new URLSearchParams(window.location.search);
var gameID = params.get("game") || sessionStorage.getItem("gameID");
var watchOnly = params.get("watch") == "1";

var SIZES = [1, 2, 3, 4];
var state = null;
var myName = null;
var selected = null; // selected piece size
var lastMoveShown = null; // to animate only new pieces
var sessionOver = false;
var shownRound = null; // round of the last "who starts" animation
var startBlockedUntil = 0; // no moves while the animation runs

/* ---------- Helpers ---------- */

// Used by chat.js
function chatUsername() {
  return myName;
}

function mySeat() {
  if (state == null || myName == null) return -1;
  return state.seats.findIndex((seat) => seat != null && seat.name == myName);
}

function isMyTurn() {
  return state != null && state.status == "playing" && state.turn == mySeat();
}

function canPlace(size, cell) {
  var seat = mySeat();
  if (!isMyTurn() || size == null || Date.now() < startBlockedUntil) return false;
  if (!(state.seats[seat].reserve[size] > 0)) return false;
  var piece = state.board[cell];
  return piece == null || piece.size < size;
}

// CSS class of a seat's color: p0 = red, p1 = blue (random per room)
function colorClass(seat) {
  return "p" + (state != null && state.swapColors ? 1 - seat : seat);
}

function createPiece(owner, size) {
  var piece = document.createElement("span");
  piece.className = "ttt-piece " + colorClass(owner) + " s" + size;
  piece.innerText = size;
  return piece;
}

function nameOf(seat) {
  return state.seats[seat] ? state.seats[seat].name : "Opponent";
}

function strong(text) {
  var element = document.createElement("strong");
  element.innerText = text;
  return element;
}

// Seconds a player who left still has to come back
var awayUntil = [null, null];

function awaySeconds(index) {
  return awayUntil[index] == null ? 0 : Math.max(0, Math.ceil((awayUntil[index] - Date.now()) / 1000));
}

function createSurrenderButton() {
  var button = document.createElement("button");
  button.type = "button";
  button.className = "player-surrender";
  button.title = "Surrender";
  button.append(createIcon("bi-flag-fill"), document.createTextNode("Surrender"));
  button.addEventListener("click", surrender);
  return button;
}

function surrender() {
  confirmDialog({
    title: "Surrender?",
    text: "Your opponent wins this round. You can still play a rematch.",
    confirmLabel: "Surrender",
    confirmIcon: "bi-flag-fill",
    danger: true,
  }).then((ok) => {
    if (ok) socket.emit("surrender");
  });
}

/* ---------- Rendering ---------- */

function render() {
  if (state == null) return;

  // The selected piece may be gone (used, game over, not my turn anymore)
  var seat = mySeat();
  if (selected != null && (!isMyTurn() || !(state.seats[seat].reserve[selected] > 0))) {
    selected = null;
  }
  // Pick the smallest piece that fits somewhere, so a click on the board just works
  if (selected == null && isMyTurn()) {
    selected = SIZES.find((size) => state.board.some((piece, cell) => canPlace(size, cell))) || null;
  }

  renderStatus();
  renderBoard();
  renderSeat(0);
  renderSeat(1);
  renderFooter();
}

function renderStatus() {
  var status = document.getElementById("status");
  var seat = mySeat();
  var parts = [];

  if (state.board == null) {
    parts.push("Waiting for an opponent...");
  } else if (Date.now() < startBlockedUntil) {
    parts.push("New round...");
  } else if (state.winner != null) {
    var loser = 1 - state.winner;
    // Why the round ended early
    if (state.forfeit == "surrender") {
      parts.push((loser == seat ? "You" : nameOf(loser)) + " surrendered - ");
    } else if (state.forfeit == "left") {
      parts.push((state.seats[loser] ? nameOf(loser) : "Your opponent") + " didn't come back - ");
    }
    if (state.winner == seat) {
      parts.push(strong(state.forfeit ? "you win!" : "You win!"));
    } else {
      parts.push(strong(nameOf(state.winner)), " wins this round.");
    }
    if (state.status == "waiting") parts.push(" Waiting for a new opponent...");
  } else if (state.draw) {
    parts.push(strong("Draw"), " - nobody can move anymore.");
  } else if (state.status == "waiting") {
    parts.push("Waiting for an opponent...");
  } else {
    // Somebody couldn't move and was skipped
    if (state.passed != null) {
      parts.push((state.passed == seat ? "You can't move" : nameOf(state.passed) + " can't move") + " - ");
    }
    var turnSeat = state.seats[state.turn];
    if (turnSeat != null && !turnSeat.connected && state.turn != seat) {
      // The player on turn left / lost the connection, they still have some time
      parts.push(strong(turnSeat.name), " left - " + awaySeconds(state.turn) + "s to come back");
    } else if (state.turn == seat) {
      parts.push(strong("Your turn"));
    } else {
      parts.push(strong(nameOf(state.turn)), "'s turn");
    }
  }
  status.replaceChildren(...parts.map((part) => (typeof part == "string" ? document.createTextNode(part) : part)));
}

function renderBoard() {
  var board = document.getElementById("board");
  var over = state.winner != null || state.draw;
  board.classList.toggle("over", over);
  // Hover on free cells in the own color
  board.classList.toggle("own-p0", mySeat() >= 0 && colorClass(mySeat()) == "p0");
  board.classList.toggle("own-p1", mySeat() >= 0 && colorClass(mySeat()) == "p1");
  board.classList.toggle("p0-won", state.winner != null && colorClass(state.winner) == "p0");
  board.classList.toggle("p1-won", state.winner != null && colorClass(state.winner) == "p1");

  board.querySelectorAll(".ttt-cell").forEach((cell, index) => {
    var piece = state.board != null ? state.board[index] : null;
    var legal = canPlace(selected, index);

    cell.classList.toggle("legal", legal);
    cell.classList.toggle("win", state.line != null && state.line.includes(index));
    cell.classList.toggle("last", state.lastMove == index && !over);
    cell.disabled = !legal;

    var children = [];
    if (piece != null) {
      var element = createPiece(piece.owner, piece.size);
      if (state.lastMove == index && lastMoveShown !== moveKey()) element.classList.add("placed");
      children.push(element);
    }
    if (legal) {
      var ghost = createPiece(mySeat(), selected);
      ghost.classList.add("ghost");
      children.push(ghost);
    }
    cell.replaceChildren(...children);
    cell.setAttribute(
      "aria-label",
      "Cell " + (index + 1) + (piece ? ": size " + piece.size + " of " + nameOf(piece.owner) : ": empty"),
    );
  });
  lastMoveShown = moveKey();
}

// Changes with every move, so the drop animation runs once
function moveKey() {
  if (state.board == null) return null;
  return state.lastMove + ":" + state.board.map((piece) => (piece ? piece.owner + "" + piece.size : "-")).join("");
}

function renderSeat(index) {
  var panel = document.getElementById("seat" + index);
  var seat = state.seats[index];
  var mine = index == mySeat();
  panel.classList.toggle("p0", colorClass(index) == "p0");
  panel.classList.toggle("p1", colorClass(index) == "p1");

  panel.classList.toggle("mine", mine || (mySeat() < 0 && index == 1));
  panel.classList.toggle(
    "turn",
    state.status == "playing" && state.turn == index && Date.now() >= startBlockedUntil,
  );
  panel.classList.toggle("offline", seat != null && !seat.connected);
  panel.classList.toggle("waiting", seat == null);

  if (seat == null) {
    panel.replaceChildren(...createInvite());
    return;
  }

  // Name, tags and wins
  var who = document.createElement("div");
  who.className = "ttt-who";
  var text = document.createElement("div");
  text.className = "ttt-who-text";
  var name = document.createElement("div");
  name.className = "ttt-name";
  var label = document.createElement("span");
  label.innerText = seat.name;
  var dot = document.createElement("span");
  dot.className = "ttt-dot";
  name.append(dot, label);
  if (mine) {
    var you = document.createElement("span");
    you.className = "you-tag";
    you.innerText = "You";
    name.appendChild(you);
    // Surrender right next to the own name, like in MemeMory
    if (state.status == "playing" && Date.now() >= startBlockedUntil) {
      name.appendChild(createSurrenderButton());
    }
  }
  var sub = document.createElement("div");
  sub.className = "ttt-sub";
  sub.innerText = !seat.connected
    ? "Away - " + awaySeconds(index) + "s to come back"
    : state.status == "finished" && seat.rematch
      ? "Wants a rematch"
      : seat.wins == 1
        ? "1 win"
        : seat.wins + " wins";
  text.append(name, sub);
  who.append(createAvatar(seat.name, "sm", seat.connected), text);

  // Pieces left
  var reserve = document.createElement("div");
  reserve.className = "ttt-reserve";
  SIZES.forEach((size) => {
    var count = seat.reserve != null ? seat.reserve[size] : 0;
    var stock = document.createElement("button");
    stock.type = "button";
    stock.className = "ttt-stock" + (count == 0 ? " empty" : "");
    var selectable = mine && isMyTurn() && count > 0;
    stock.disabled = !selectable;
    if (selectable) stock.classList.add("selectable");
    if (mine && selected == size && isMyTurn()) stock.classList.add("selected");
    stock.title = "Size " + size + " - " + count + " left" + (selectable ? " (key " + size + ")" : "");
    var amount = document.createElement("span");
    amount.innerText = "×" + count;
    stock.append(createPiece(index, size), amount);
    stock.addEventListener("click", () => select(size));
    reserve.appendChild(stock);
  });

  panel.replaceChildren(who, reserve);
}

// Free seat: code + invite link
function createInvite() {
  var title = document.createElement("div");
  title.className = "fw-semibold";
  title.innerText = "Waiting for an opponent";
  var code = document.createElement("p");
  code.className = "invite-code";
  code.innerText = gameID;
  var actions = document.createElement("div");
  actions.className = "ttt-invite-actions";
  var copyCode = document.createElement("button");
  copyCode.type = "button";
  copyCode.className = "mm-btn mm-btn-sm";
  copyCode.append(createIcon("bi-clipboard"), document.createTextNode("Copy code"));
  copyCode.addEventListener("click", () => copyText(gameID, copyCode));
  var copyLink = document.createElement("button");
  copyLink.type = "button";
  copyLink.className = "mm-btn mm-btn-sm mm-btn-primary";
  copyLink.append(createIcon("bi-link-45deg"), document.createTextNode("Copy invite link"));
  copyLink.addEventListener("click", () =>
    copyText(window.location.origin + "/tictactoe?game=" + encodeURIComponent(gameID), copyLink),
  );
  actions.append(copyCode, copyLink);
  return [title, code, actions];
}

function renderFooter() {
  var button = document.getElementById("rematchButton");
  var seat = mySeat();
  var show = state.status == "finished" && seat >= 0;
  button.hidden = !show;
  if (show) {
    var me = state.seats[seat];
    var other = state.seats[1 - seat];
    button.className = "mm-btn";
    button.replaceChildren(
      createIcon(me.rematch ? "bi-x" : "bi-arrow-repeat"),
      document.createTextNode(
        me.rematch ? "Cancel rematch" : other && other.rematch ? "Accept rematch" : "Rematch",
      ),
    );
  }

  var spectators = document.getElementById("spectatorInfo");
  spectators.hidden = state.spectators.length == 0;
  spectators.replaceChildren(
    createIcon("bi-eye me-1"),
    document.createTextNode(
      state.spectators.length == 1 ? state.spectators[0] + " is watching" : state.spectators.length + " watching",
    ),
  );
}

/* ---------- Actions ---------- */

function select(size) {
  if (!isMyTurn() || !(state.seats[mySeat()].reserve[size] > 0)) return;
  selected = size;
  render();
}

function place(cell) {
  if (!canPlace(selected, cell)) return;
  socket.emit("place", { size: selected, cell: cell });
}

/* ---------- Socket ---------- */

function join() {
  if (gameID == null) {
    showNotice("Game not found", "This game doesn't exist anymore.");
    return;
  }
  socket.emit("joinGame", { gameID: gameID, watch: watchOnly });
}

socket.on("connect", () => {
  document.getElementById("connectionBanner").hidden = true;
  join();
});

// Leaving the page (logo, menu, back button): disconnect right away, so the
// others see "Away" at once. Browsers can keep a page with an open connection
// in the back/forward cache; coming back reconnects (and rejoins).
window.addEventListener("pagehide", () => socket.disconnect());
window.addEventListener("pageshow", (event) => {
  if (event.persisted) socket.connect();
});

socket.on("disconnect", () => {
  if (!sessionOver) document.getElementById("connectionBanner").hidden = false;
});

socket.on("connect_error", (error) => {
  if (error && error.message == "unauthorized") window.location.href = "/";
});

socket.on("joined", (data) => {
  myName = data.username;
  // Reloads find the game again
  sessionStorage.setItem("gameID", gameID);
});

var awayTimer = null;

socket.on("state", (data) => {
  state = data;
  // Countdown for players who left (the server only sends the remaining time)
  awayUntil = state.seats.map((seat) =>
    seat != null && seat.awayLeft != null ? Date.now() + seat.awayLeft : null,
  );
  clearInterval(awayTimer);
  if (awayUntil.some((until) => until != null)) {
    awayTimer = setInterval(() => {
      renderStatus();
      renderSeat(0);
      renderSeat(1);
    }, 1000);
  }
  // New game: show who starts (once, also after a reload during the animation)
  if (state.status == "playing" && state.startIn > 0 && state.round !== shownRound) {
    shownRound = state.round;
    playStartAnimation(state.startIn);
  }
  render();
});

/* ---------- "Who starts?" animation (same reel as in MemeMory) ---------- */

function playStartAnimation(duration) {
  var overlay = document.getElementById("startOverlay");
  var track = document.getElementById("reelTrack");
  var result = document.getElementById("startResult");
  var reel = track.parentElement;
  var itemHeight = parseFloat(getComputedStyle(reel).getPropertyValue("--item")) || 72;
  var players = state.seats.map((seat) => seat.name);
  var starter = state.turn;

  startBlockedUntil = Date.now() + duration;
  setTimeout(render, duration + 50);

  // Long list of names, the starter is the second to last one -> slot machine
  var names = [];
  for (var r = 0; r < 12; r++) names.push(...players);
  names.push(...players.slice(0, starter + 1));
  names.push(players[(starter + 1) % 2]);

  track.replaceChildren();
  names.forEach((name) => {
    var item = document.createElement("div");
    item.className = "reel-item";
    item.append(createAvatar(name), document.createTextNode(name));
    track.appendChild(item);
  });

  var target = names.length - 2;
  var spin = Math.max(800, duration - 1300);

  result.classList.remove("show");
  result.innerText = "";
  track.style.transition = "none";
  track.style.transform = "translateY(0)";
  overlay.hidden = false;

  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      track.style.transition = `transform ${spin}ms cubic-bezier(0.12, 0.75, 0.18, 1)`;
      // The marker is the second row of the reel
      track.style.transform = `translateY(${-(target - 1) * itemHeight}px)`;
    }),
  );

  setTimeout(() => {
    track.children[target].classList.add("chosen");
    var name = players[starter];
    result.innerText = name == myName ? "You start" : `${name} starts`;
    result.classList.add("show");
  }, spin);

  setTimeout(() => (overlay.hidden = true), duration + 200);
}

socket.on("moveError", (message) => showToast(message, "error"));

socket.on("noGameFound", () => {
  sessionOver = true;
  showNotice("Game not found", "This game doesn't exist anymore.");
});

socket.on("sessionReplaced", () => {
  sessionOver = true;
  showNotice("Opened in another tab", "You are playing in another tab or window now.", "Play here", () =>
    window.location.reload(),
  );
});

function showNotice(title, text, actionLabel, action) {
  document.getElementById("noticeTitle").innerText = title;
  document.getElementById("noticeText").innerText = text;
  var button = document.getElementById("noticeAction");
  button.hidden = actionLabel == null;
  button.innerText = actionLabel || "";
  button.onclick = action || null;
  document.getElementById("connectionBanner").hidden = true;
  document.getElementById("noticeOverlay").hidden = false;
}

/* ---------- Page setup ---------- */

document.addEventListener("DOMContentLoaded", () => {
  setupChat();

  var board = document.getElementById("board");
  for (var index = 0; index < 9; index++) {
    var cell = document.createElement("button");
    cell.type = "button";
    cell.className = "ttt-cell";
    cell.disabled = true;
    cell.addEventListener("click", place.bind(null, index));
    board.appendChild(cell);
  }

  document.getElementById("rematchButton").addEventListener("click", () => socket.emit("rematch"));

  document.getElementById("leaveButton").addEventListener("click", async () => {
    var playing = state != null && state.status == "playing" && mySeat() >= 0;
    if (playing) {
      var ok = await confirmDialog({
        title: "Leave the game?",
        text:
          "You can rejoin from the lobby within " +
          state.rejoinSeconds +
          " seconds. After that, your opponent wins this round.",
        confirmLabel: "Leave",
        confirmIcon: "bi-box-arrow-left",
        danger: true,
      });
      if (!ok) return;
    }
    sessionOver = true;
    socket.emit("leave");
    sessionStorage.removeItem("gameID");
    window.location.href = "/lobby";
  });

  // Keys 1-4 pick a piece
  document.addEventListener("keydown", (event) => {
    if (event.target.closest("input, textarea") || event.ctrlKey || event.metaKey || event.altKey) return;
    var size = Number(event.key);
    if (SIZES.includes(size)) select(size);
  });
});
