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

/* ---------- Helpers ---------- */

function mySeat() {
  if (state == null || myName == null) return -1;
  return state.seats.findIndex((seat) => seat != null && seat.name == myName);
}

function isMyTurn() {
  return state != null && state.status == "playing" && state.turn == mySeat();
}

function canPlace(size, cell) {
  var seat = mySeat();
  if (!isMyTurn() || size == null) return false;
  if (!(state.seats[seat].reserve[size] > 0)) return false;
  var piece = state.board[cell];
  return piece == null || piece.size < size;
}

function createPiece(owner, size) {
  var piece = document.createElement("span");
  piece.className = "ttt-piece p" + owner + " s" + size;
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
  } else if (state.winner != null) {
    if (state.forfeit && state.winner == seat) {
      parts.push("Your opponent left - ", strong("you win!"));
    } else if (state.winner == seat) {
      parts.push(strong("You win!"));
    } else if (seat >= 0) {
      parts.push(strong(nameOf(state.winner)), " wins this round.");
    } else {
      parts.push(strong(nameOf(state.winner)), " wins" + (state.forfeit ? " (opponent left)." : "."));
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
    if (state.turn == seat) {
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
  board.classList.toggle("p0-won", state.winner == 0);
  board.classList.toggle("p1-won", state.winner == 1);

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

  panel.classList.toggle("mine", mine || (mySeat() < 0 && index == 1));
  panel.classList.toggle("turn", state.status == "playing" && state.turn == index);
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
  text.className = "overflow-hidden";
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
  }
  var sub = document.createElement("div");
  sub.className = "ttt-sub";
  sub.innerText = !seat.connected
    ? "Reconnecting..."
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
    button.className = "mm-btn" + (me.rematch ? "" : " mm-btn-primary");
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

socket.on("state", (data) => {
  state = data;
  render();
});

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
        text: "Your opponent wins this round.",
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
