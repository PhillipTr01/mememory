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
  if (state.turnPowerUsed || state.checkingCards) return false;
  // Moving cards only works when no card is open, second chance before the second card
  if (["shuffle", "swap", "rotate"].includes(id) && state.openedCount > 0) return false;
  if (id == "secondChance" && state.openedCount > 1) return false;
  return true;
}

/* ---------- Own hand ---------- */

var endTurnReady = false; // for opening the bar when the turn can be ended
var barTurnKey = null; // a new turn closes the bar

/*
 * Floating action bar:
 * - power-up mode: power-ups + End turn, can be opened and closed
 * - classic: only End turn, it pops up when the turn can be ended
 */
function renderPowerups(state) {
  var bar = document.getElementById("actionBar");
  var mine = getMyPlayer(state);
  var player = state.status == "playing" && mine != null && mine.active && !me.spectator;
  var ready = player && isMyTurn(state) && state.checkingCards && state.openedCount == 2;
  var powerMode = state.mode == "powerups";
  var show = player && (powerMode || (state.mode == "classic" && ready));
  bar.hidden = !show;
  bar.classList.toggle("end-only", !powerMode);
  document.body.classList.toggle("has-action-bar", show);

  // Fog: the cards I open in my turn are blurred (see isFogged / turnCard)
  var fogged = !!(mine && mine.fog && isMyTurn(state));
  document.getElementById("board").classList.toggle("fogged", fogged);
  if (!fogged) clearFog();
  if (!show) {
    cancelTargeting();
    endTurnReady = false;
    return;
  }

  var endButton = document.getElementById("actionEndTurn");
  if (!powerMode) {
    // Classic: the bar only exists while the turn can be ended
    setActionBarOpen(true);
    endButton.disabled = false;
    endButton.classList.add("mm-btn-primary", "ready");
    endTurnReady = true;
    return;
  }
  if (targeting && !canUsePowerup(state, targeting.id)) cancelTargeting();

  // Every new turn starts with the bar closed, so it doesn't cover the board
  var turnKey = state.turn + ":" + state.players.map((p) => p.name).join(",");
  if (turnKey != barTurnKey) {
    barTurnKey = turnKey;
    setActionBarOpen(false);
  }

  // Two wrong cards: End turn right away (the bar opens if it was closed)
  endButton.disabled = !ready;
  endButton.classList.toggle("mm-btn-primary", ready);
  endButton.classList.toggle("ready", ready);
  if (ready && !endTurnReady) setActionBarOpen(true);
  endTurnReady = ready;

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
    var button = document.createElement("button");
    button.type = "button";
    button.className =
      "powerup-slot rarity-" + info.rarity + (targeting && targeting.id == id ? " active" : "");
    button.disabled = !canUsePowerup(state, id);
    button.title = info.name + " (" + info.rarity + ") - " + info.description;
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

/* ---------- Action bar: open / close ---------- */

function setActionBarOpen(open) {
  var bar = document.getElementById("actionBar");
  bar.classList.toggle("collapsed", !open);
  document.getElementById("actionToggle").setAttribute("aria-expanded", open);
}

document.addEventListener("DOMContentLoaded", () => {
  setActionBarOpen(false);

  document.getElementById("actionToggle").addEventListener("click", () => {
    setActionBarOpen(document.getElementById("actionBar").classList.contains("collapsed"));
  });
  document.getElementById("actionEndTurn").addEventListener("click", () => {
    if (endTurnReady) emitEndTurn();
  });
});

// Enter ends the turn when it can be ended (not while typing in the chat)
document.addEventListener("keydown", (event) => {
  if (event.key != "Enter" || !endTurnReady || event.target.closest("input, textarea, button")) return;
  emitEndTurn();
});

/* ---------- Using power-ups ---------- */

function startPowerup(id) {
  if (!room || !canUsePowerup(room, id)) return;
  var info = powerupInfo(id);
  if (targeting && targeting.id == id) {
    cancelTargeting();
    return;
  }
  cancelTargeting();
  if (info.target == "card" || info.target == "cards") {
    targeting = { id: id, needed: info.target == "cards" ? 2 : 1, picked: [] };
    document.getElementById("board").classList.add("targeting");
    // Click the power-up again or press Escape to cancel
    showToast(targeting.needed == 2 ? "Choose two closed cards" : "Choose a closed card");
    renderPowerups(room);
    return;
  }
  socket.emit("usePowerup", { id: id });
}

// Called by openCard(): while choosing, a click picks the card instead
function handlePowerupTarget(id) {
  if (!targeting) return false;
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
  if (targeting.picked.length == targeting.needed) {
    socket.emit("usePowerup", { id: targeting.id, targets: targeting.picked });
    cancelTargeting();
  }
  return true;
}

function cancelTargeting() {
  targeting = null;
  document.getElementById("board").classList.remove("targeting");
  document.querySelectorAll(".card.target-picked").forEach((card) => card.classList.remove("target-picked"));
  if (room && !document.getElementById("actionBar").hidden) renderPowerups(room);
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

// Shuffle / Rotate: a short animation, the new board follows as boardState
socket.on("boardChanged", (data) => {
  var board = document.getElementById("memoryTable");
  var name = data.type == "rotate" ? "rotating" : "shuffling";
  board.classList.remove(name);
  void board.offsetWidth; // restart the animation
  board.classList.add(name);
  setTimeout(() => board.classList.remove(name), 700);
});
