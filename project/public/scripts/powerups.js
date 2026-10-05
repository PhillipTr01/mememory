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
  return powerupDefs[id] || { icon: "bi-stars", name: id, description: "" };
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

function renderPowerups(state) {
  var bar = document.getElementById("powerupBar");
  var mine = getMyPlayer(state);
  var show = state.mode == "powerups" && state.status == "playing" && mine != null && mine.active && !me.spectator;
  bar.hidden = !show;

  // Fog: my cards are blurred during my turn
  document.getElementById("board").classList.toggle("fogged", !!(mine && mine.fog && isMyTurn(state)));
  if (!show) {
    cancelTargeting();
    return;
  }
  if (targeting && !canUsePowerup(state, targeting.id)) cancelTargeting();

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
    button.className = "powerup-slot" + (targeting && targeting.id == id ? " active" : "");
    button.disabled = !canUsePowerup(state, id);
    button.title = info.name + " - " + info.description;
    var icon = createIcon(info.icon + " powerup-icon");
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
    icon.appendChild(createIcon(powerupInfo(id).icon));
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
    effect.appendChild(createIcon(powerupInfo(id).icon));
    effect.title = powerupInfo(id).name + ": " + label;
    icons.appendChild(effect);
  });
  return icons;
}

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
  if (room && !document.getElementById("powerupBar").hidden) renderPowerups(room);
}

document.addEventListener("keydown", (event) => {
  if (event.key == "Escape" && targeting) cancelTargeting();
});

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
