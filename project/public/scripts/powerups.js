/*
 * MemeMory power-ups (mode "powerups"): the own hand, choosing cards and the
 * effects on the board. Uses `socket`, `room` and `me` from multiplayer_socket.js.
 */
var powerupDefs = {};
var targeting = null; // { id, needed, picked: [] } while cards are chosen

socket.on("powerupDefs", (defs) => {
  powerupDefs = defs || {};
  if (room) renderPowerups(room);
});

function powerupInfo(id) {
  return powerupDefs[id] || { emoji: "✨", name: id, description: "" };
}

function canUsePowerup(state, id) {
  if (state.mode != "powerups" || state.status != "playing" || !isMyTurn(state)) return false;
  // Only before the first card of the turn (Steal is used in the turn of somebody else)
  if (state.turnPowerUsed || state.checkingCards || state.turnBegun) return false;
  if (powerupInfo(id).reactive) return false;
  // Moving cards only works when no card is open
  if (["shuffle", "swap", "rotate", "rowShift"].includes(id) && state.openedCount > 0) return false;
  return true;
}

// Steal: somebody else opened their first card - a moment to take the second guess
function canSnatch(state) {
  var mine = getMyPlayer(state);
  return state.mode == "powerups" && state.status == "playing" && !isMyTurn(state) && state.stealIn > 0 && mine != null && mine.active && mine.powerups.includes("snatch");
}

/* ---------- Own hand: the bar over the board, always open ---------- */

var stealTimer = null;

function renderPowerups(state) {
  var bar = document.getElementById("actionBar");
  var mine = getMyPlayer(state);
  var player = state.status == "playing" && mine != null && mine.active && !me.spectator;
  var show = player && state.mode == "powerups";
  bar.hidden = !show;

  // Fog: the cards I open in my turn are blurred (see isFogged / turnCard)
  var fogged = !!(mine && mine.fog && isMyTurn(state));
  document.getElementById("board").classList.toggle("fogged", fogged);
  if (!fogged) clearFog();
  if (!show) {
    cancelTargeting();
    return;
  }
  if (targeting && (targeting.snatch ? !canSnatch(state) : !canUsePowerup(state, targeting.id))) cancelTargeting();

  // The steal window ends by itself: draw the bar again then
  clearTimeout(stealTimer);
  if (state.stealIn > 0) stealTimer = setTimeout(() => room && renderPowerups(room), state.stealIn + 50);

  // What the player can do now
  var snatchNow = canSnatch(state);
  var hint = document.getElementById("powerHint");
  hint.innerText = targeting
    ? targeting.snatch
      ? "🦊 Quick - pick the second card!"
      : targeting.player
        ? "Choose a player in the list"
        : targeting.needed == 2
          ? "Choose two closed cards"
          : "Choose a closed card"
    : snatchNow
      ? "🦊 Steal the guess - now!"
      : !isMyTurn(state)
        ? "Use them at the start of your turn"
        : state.turnBegun || state.turnPowerUsed
          ? "Again next turn"
          : "Use one before your first card";
  bar.classList.toggle("ready", isMyTurn(state) && !state.turnBegun && !state.turnPowerUsed);
  bar.classList.toggle("stealing", snatchNow);

  var slots = document.getElementById("powerupSlots");
  slots.replaceChildren();
  for (var i = 0; i < 3; i++) {
    var id = mine.powerups[i];
    if (id == null) {
      var empty = document.createElement("div");
      empty.className = "powerup-slot empty";
      slots.appendChild(empty);
      continue;
    }
    var info = powerupInfo(id);
    var usable = id == "snatch" ? snatchNow : canUsePowerup(state, id);
    var button = document.createElement("button");
    button.type = "button";
    button.className = "powerup-slot rarity-" + info.rarity + (usable ? " usable" : "") + (targeting && targeting.id == id ? " active" : "");
    button.disabled = !usable;
    button.title = info.name + " (" + info.rarity + ") - " + info.description;
    button.setAttribute("aria-label", info.name);
    // Same emoji as in the chat
    var icon = document.createElement("span");
    icon.className = "powerup-icon";
    icon.innerText = info.emoji;
    var name = document.createElement("span");
    name.className = "powerup-name";
    name.innerText = info.name;
    button.append(icon, name);
    button.addEventListener("click", startPowerup.bind(null, id));
    slots.appendChild(button);
  }
}

// Small icons in the player list: power-ups in the hand and running effects
function createPowerupIcons(player) {
  var icons = document.createElement("div");
  icons.className = "player-powers";
  player.powerups.forEach((id) => {
    var icon = document.createElement("span");
    icon.className = "power-icon";
    icon.innerText = powerupInfo(id).emoji;
    icon.title = powerupInfo(id).name;
    icons.appendChild(icon);
  });
  var effects = [];
  if (player.shield) effects.push(["shield", "Shield up"]);
  if (player.fog) effects.push(["fog", "In the fog"]);
  if (player.skipNext) effects.push(["skip", "Skips the next turn"]);
  player.armed.forEach((id) => effects.push([id, "Active"]));
  effects.forEach(([id, label]) => {
    var effect = document.createElement("span");
    effect.className = "power-effect";
    effect.innerText = powerupInfo(id).emoji;
    effect.title = powerupInfo(id).name + ": " + label;
    icons.appendChild(effect);
  });
  return icons;
}

/* ---------- Using power-ups ---------- */

function startPowerup(id) {
  // Steal: the next click on a closed card is the second guess
  if (id == "snatch") {
    if (!room || !canSnatch(room)) return;
    if (targeting && targeting.snatch) return cancelTargeting();
    cancelTargeting();
    targeting = { id: id, needed: 1, picked: [], snatch: true };
    document.getElementById("board").classList.add("targeting");
    renderPowerups(room);
    return;
  }
  if (!room || !canUsePowerup(room, id)) return;
  var info = powerupInfo(id);
  if (targeting && targeting.id == id) {
    cancelTargeting();
    return;
  }
  cancelTargeting();
  if (info.target == "player") {
    // Only one opponent: no need to choose
    var opponents = room.players.filter((p) => p.active && p.name != me.username);
    if (opponents.length == 1) {
      socket.emit("usePowerup", { id: id, player: opponents[0].name });
      return;
    }
    targeting = { id: id, player: true };
    document.body.classList.add("targeting-player");
    renderPlayerList(room, room);
    renderPowerups(room);
    return;
  }
  if (info.target == "card" || info.target == "cards") {
    targeting = { id: id, needed: info.target == "cards" ? 2 : 1, picked: [] };
    document.getElementById("board").classList.add("targeting");
    // Click the power-up again or press Escape to cancel
    renderPowerups(room);
    return;
  }
  socket.emit("usePowerup", { id: id });
}

// Attacks: a click on an opponent in the player list picks the target
document.addEventListener("click", (event) => {
  if (!targeting || !targeting.player) return;
  var item = event.target.closest("#playerList .player-item.targetable");
  if (item == null) return;
  socket.emit("usePowerup", { id: targeting.id, player: item.dataset.name });
  cancelTargeting();
});

// Called by openCard(): while choosing, a click picks the card instead
function handlePowerupTarget(id) {
  if (!targeting || targeting.player) return false;
  var card = document.getElementById("card-" + id);
  if (card == null || card.classList.contains("flip")) return true; // only closed cards

  var index = targeting.picked.indexOf(id);
  if (index >= 0) {
    targeting.picked.splice(index, 1);
    card.classList.remove("target-picked");
    return true;
  }
  targeting.picked.push(id);
  card.classList.add("target-picked");
  if (targeting.snatch) {
    socket.emit("snatch", id);
    cancelTargeting();
    return true;
  }
  if (targeting.picked.length == targeting.needed) {
    socket.emit("usePowerup", { id: targeting.id, targets: targeting.picked });
    cancelTargeting();
  }
  return true;
}

function cancelTargeting() {
  var wasPlayer = targeting && targeting.player;
  targeting = null;
  document.body.classList.remove("targeting-player");
  if (wasPlayer && room) renderPlayerList(room, room);
  document.getElementById("board").classList.remove("targeting");
  document.querySelectorAll(".card.target-picked").forEach((card) => card.classList.remove("target-picked"));
  if (room && !document.getElementById("actionBar").hidden) renderPowerups(room);
  return undefined;
}

document.addEventListener("keydown", (event) => {
  if (event.key == "Escape" && targeting) cancelTargeting();
});

/* ---------- Start animation: two reels with the start power-ups ---------- */

function playPowerupReels(startPowerups) {
  // "Who starts?" is done, the power-up reels take its place
  document.getElementById("startWho").hidden = true;
  document.getElementById("startPowerups").hidden = false;
  startPowerups.forEach((id, index) => {
    var track = document.getElementById("powerReel" + index);
    var reel = track.parentElement;
    var itemHeight = parseFloat(getComputedStyle(reel).getPropertyValue("--item")) || 56;

    // Random power-ups, the chosen one second to last (under the marker)
    var ids = Object.keys(powerupDefs);
    var items = [];
    for (var i = 0; i < 16; i++) items.push(ids[Math.floor(Math.random() * ids.length)]);
    items.push(id, ids[Math.floor(Math.random() * ids.length)]);

    track.replaceChildren();
    items.forEach((item) => {
      var info = powerupInfo(item);
      var row = document.createElement("div");
      row.className = "reel-item reel-power rarity-" + info.rarity;
      var emoji = document.createElement("span");
      emoji.innerText = info.emoji;
      var name = document.createElement("span");
      name.innerText = info.name;
      row.append(emoji, name);
      track.appendChild(row);
    });

    var target = items.length - 2;
    // The second reel stops a bit later
    var spin = 1500 + index * 700;
    track.style.transition = "none";
    track.style.transform = "translateY(0)";
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        track.style.transition = `transform ${spin}ms cubic-bezier(0.12, 0.75, 0.18, 1)`;
        track.style.transform = `translateY(${-(target - 1) * itemHeight}px)`;
      }),
    );
    setTimeout(() => track.children[target].classList.add("chosen"), spin);
  });
}

/* ---------- Fog ---------- */

// The fog is on for me right now
function isFogged() {
  return document.getElementById("board").classList.contains("fogged");
}

// Cards opened during the fogged turn are blurred (only those)
function fogCard(id) {
  if (!isFogged()) return;
  var card = document.getElementById("card-" + id);
  if (card != null) card.classList.add("fog-card");
}

// Blurred cards can't be zoomed into
function isFogCard(id) {
  var card = document.getElementById("card-" + id);
  return isFogged() && card != null && card.classList.contains("fog-card");
}

// The fog is over: open cards are clear again, closing cards stay blurred
// until they are turned over (the flip takes 0.6s)
function clearFog() {
  document.querySelectorAll(".card.fog-card").forEach((card) => {
    if (card.classList.contains("flip")) card.classList.remove("fog-card");
    else setTimeout(() => card.classList.remove("fog-card"), 700);
  });
}

/* ---------- Effects ---------- */

// Peek, Spotlight, Bomb: cards are shown for a moment. Map: never opened cards glow.
socket.on("powerupReveal", (data) => {
  data.cards.forEach((item) => {
    var card = document.getElementById("card-" + item.id);
    if (card == null) return;

    if (data.type == "map") {
      card.classList.add("fresh");
      setTimeout(() => card.classList.remove("fresh"), data.duration);
      return;
    }
    if (card.classList.contains("flip")) return;
    setCardImage(card, item.src);
    card.classList.toggle("power-card", item.power === true);
    card.classList.add("flip", "peek");
    setTimeout(() => {
      // Still only peeked (not opened for real in the meantime)
      if (!card.classList.contains("peek")) return;
      card.classList.remove("flip", "peek");
      clearCardImage(card, 600);
    }, data.duration);
  });
});

/*
 * Shuffle, Swap, Row shift, Rotate: the cards fly from their old place to the
 * new one. perm[newPosition] = oldPosition; the new board follows as boardState,
 * then the cards start at their old places and move to the new ones.
 */
var pendingMove = null;

socket.on("boardChanged", (data) => {
  pendingMove = data;
});

function animateBoardMove() {
  var move = pendingMove;
  pendingMove = null;
  if (move == null || !Array.isArray(move.perm)) return;
  var table = document.getElementById("memoryTable");
  var cells = table.children;
  var rects = Array.from(cells, (cell) => cell.getBoundingClientRect());
  var box = table.getBoundingClientRect();
  var ratio = box.width / Math.max(box.height, 1);
  // Nothing flies over the page (and no scrollbars) while the cards move
  table.classList.add("moving");
  clearTimeout(animateBoardMove.timer);
  animateBoardMove.timer = setTimeout(() => table.classList.remove("moving"), 1200);
  var duration = move.type == "rotate" ? 900 : move.type == "shuffle" ? 750 : 650;

  move.perm.forEach((old, position) => {
    if (old == position || cells[position] == null) return;
    var dx = rects[old].left - rects[position].left;
    var dy = rects[old].top - rects[position].top;
    // Swap and row shift: the cards lift a bit on the way
    var lift = move.type == "swap" || move.type == "rowShift" ? 1.18 : 1.06;
    var delay = move.type == "shuffle" ? Math.random() * 160 : 0;
    var cell = cells[position];
    cell.style.zIndex = 5;
    var frames = [
      { transform: `translate(${dx}px, ${dy}px)` },
      { transform: `translate(${dx / 2}px, ${dy / 2}px) scale(${lift})`, offset: 0.5 },
      { transform: "translate(0, 0)" },
    ];
    if (move.type == "rotate") {
      // Around the middle of the board (upright), not all through the center
      // (an ellipse like the board, so the cards stay on it)
      var vx = dx / 2;
      var vy = dy / 2;
      frames = [];
      for (var step = 0; step <= 12; step++) {
        var angle = (Math.PI * step) / 12;
        var x = vx * Math.cos(angle) - vy * ratio * Math.sin(angle) + vx;
        var y = (vx / ratio) * Math.sin(angle) + vy * Math.cos(angle) + vy;
        frames.push({ transform: `translate(${x}px, ${y}px)` });
      }
    }
    var animation = cell.animate(
      frames,
      { duration: duration, delay: delay, easing: "cubic-bezier(0.45, 0, 0.25, 1)", fill: "backwards" },
    );
    animation.onfinish = animation.oncancel = () => (cell.style.zIndex = "");
  });
}
