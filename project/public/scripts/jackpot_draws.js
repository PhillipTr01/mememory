/*
 * The ways to show who wins the jackpot. Only the show is different:
 * the winner (draw.ticket / draw.winner) always comes from the server.
 *
 * Every draw has
 *   idle(stage)                          - the scene before the draw (current pot)
 *   play(stage, draw, duration, short)   - the animation, resolves when it is over
 * Uses state, shareColor, formatCoins, percent, drawBets and myName from jackpot.js.
 */
var DRAW_MODES = [
  { id: "wheel", icon: "🎡", label: "Wheel", description: "A wheel with everybody's tickets - the pointer picks the winner" },
  { id: "roulette", icon: "🖼️", label: "Roulette", description: "A strip of pictures runs past the marker" },
  { id: "bowling", icon: "🎳", label: "Bowling", description: "Every player is a pin - only the winner stays standing" },
  { id: "plinko", icon: "🔻", label: "Plinko", description: "A ball falls through the pegs into the winning slot" },
  { id: "race", icon: "🏇", label: "Race", description: "Every player runs - the winner crosses the line first" },
  { id: "claw", icon: "🕹️", label: "Claw", description: "The claw machine grabs the winner out of the pile" },
  { id: "royale", icon: "🪂", label: "Royale", description: "Battle royale - the zone shrinks, the last one standing wins" },
  { id: "coinrain", icon: "🪙", label: "Coins", description: "Coins rain into everybody's jar - the first one to overflow wins" },
  { id: "revolver", icon: "🔫", label: "Revolver", description: "Russian roulette - the revolver goes round, the last one alive wins" },
  { id: "slots", icon: "🎰", label: "Slots", description: "Three reels of faces - three of a kind wins" },
  { id: "launch", icon: "🚀", label: "Launch", description: "Every player gets a rocket - only one reaches orbit" },
  { id: "scratch", icon: "🎟️", label: "Scratch", description: "A scratch card full of faces - the first to match three wins" },
  { id: "ghosthunt", icon: "🔦", label: "Ghost hunt", description: "Lights out - the ghost takes them one by one, the last one wins" },
];

/* ---------- Helpers ---------- */

function el(tag, className, text) {
  var element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.innerText = text;
  return element;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function animate(element, frames, options) {
  return element.animate(frames, Object.assign({ fill: "forwards" }, options)).finished.catch(() => {});
}

function randomBetween(a, b) {
  return a + Math.random() * (b - a);
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/*
 * The end of a spin, different every time: straight to the stop, a bit too
 * far and back, or nearly stopping before it and creeping on.
 * Keyframes of a value (deg / px) from `from` to `to` (step: size of one
 * field, so "nearly" means one field before).
 */
function spinEnding(from, to, step) {
  var way = to - from;
  var kind = pick(["overshoot", "creep", "creep"]);
  if (kind == "overshoot") {
    return [
      { value: from, offset: 0, easing: SLOW_END },
      { value: to + Math.sign(way) * step * randomBetween(0.25, 0.45), offset: 0.9, easing: "ease-in-out" },
      { value: to, offset: 1 },
    ];
  }
  if (kind == "creep") {
    return [
      { value: from, offset: 0, easing: SLOW_END },
      { value: to - Math.sign(way) * step * randomBetween(0.55, 0.9), offset: randomBetween(0.78, 0.86), easing: "linear" },
      { value: to, offset: 1 },
    ];
  }
  return [
    { value: from, offset: 0, easing: SLOW_END },
    { value: to, offset: 1 },
  ];
}

// Every draw slows down at the end: fast start, long, soft stop
var SLOW_END = "cubic-bezier(0.22, 0.61, 0.36, 1)";

// Scene container of a draw (built again when another draw was shown before)
function scene(stage, name) {
  var current = stage.firstElementChild;
  if (current && current.dataset.scene == name) return current;
  var root = el("div", "jp-scene jp-scene-" + name);
  root.dataset.scene = name;
  stage.replaceChildren(root);
  return root;
}

function emptyNote(root, text) {
  root.appendChild(el("p", "jp-scene-empty", text));
}

// The players of the round, at most `limit`, the winner always among them
function playersFor(limit, winner) {
  var players = state.entries.slice();
  if (players.length <= limit) return players;
  var top = players
    .slice()
    .sort((a, b) => b.coins - a.coins)
    .filter((p) => p.name != winner)
    .slice(0, limit - (winner ? 1 : 0));
  var keep = new Set(top.map((p) => p.name));
  if (winner) keep.add(winner);
  return players.filter((p) => keep.has(p.name));
}

// Big text over the scene ("STRIKE!", "GO!")
function shout(root, text, extraClass) {
  var label = el("div", "jp-shout " + (extraClass || ""), text);
  root.appendChild(label);
  animate(
    label,
    [
      { transform: "translate(-50%, -50%) scale(0.4)", opacity: 0 },
      { transform: "translate(-50%, -50%) scale(1.15)", opacity: 1, offset: 0.25 },
      { transform: "translate(-50%, -50%) scale(1)", opacity: 1, offset: 0.7 },
      { transform: "translate(-50%, -50%) scale(1.05)", opacity: 0 },
    ],
    { duration: 1100, easing: "ease-out" },
  ).then(() => label.remove());
}

function confetti(root) {
  var colors = ["#d4a64a", "#e0675a", "#3b82f6", "#3fae6b", "#ec4899", "#f5d76e"];
  for (var i = 0; i < 70; i++) {
    var piece = el("i", "jp-confetti");
    piece.style.left = randomBetween(10, 90) + "%";
    piece.style.background = colors[i % colors.length];
    root.appendChild(piece);
    var dx = randomBetween(-160, 160);
    animate(
      piece,
      [
        { transform: "translate(0, 0) rotate(0deg)", opacity: 1 },
        { transform: `translate(${dx}px, ${randomBetween(180, 320)}px) rotate(${randomBetween(-540, 540)}deg)`, opacity: 0 },
      ],
      { duration: randomBetween(1200, 2000), delay: randomBetween(0, 250), easing: "cubic-bezier(.2,.6,.4,1)" },
    ).then(((p) => () => p.remove())(piece));
  }
}

function winnerLabel(root, draw) {
  var label = el("div", "jp-scene-winner");
  label.append(createAvatar(draw.winner, "sm"), el("span", "", draw.winner == myName ? "You win!" : draw.winner + " wins!"));
  root.appendChild(label);
  animate(label, [{ opacity: 0, transform: "translate(-50%, 10px)" }, { opacity: 1, transform: "translate(-50%, 0)" }], {
    duration: 350,
    easing: "ease-out",
  });
}

/* ---------- 1. Wheel ---------- */

var SVG_NS_JP = "http://www.w3.org/2000/svg";

// Point on the circle: angle 0 = top, clockwise
function wheelPoint(radius, angle) {
  var rad = ((angle - 90) * Math.PI) / 180;
  return [100 + radius * Math.cos(rad), 100 + radius * Math.sin(rad)];
}

// A piece of the ring from angle a to angle b
function ringPath(a, b, outer, inner) {
  var large = b - a > 180 ? 1 : 0;
  var p1 = wheelPoint(outer, a);
  var p2 = wheelPoint(outer, b);
  var p3 = wheelPoint(inner, b);
  var p4 = wheelPoint(inner, a);
  return (
    "M" + p1.join(" ") + " A" + outer + " " + outer + " 0 " + large + " 1 " + p2.join(" ") +
    " L" + p3.join(" ") + " A" + inner + " " + inner + " 0 " + large + " 0 " + p4.join(" ") + " Z"
  );
}

function svgNode(name, attributes) {
  var node = document.createElementNS(SVG_NS_JP, name);
  Object.keys(attributes).forEach((key) => node.setAttribute(key, attributes[key]));
  return node;
}

var wheelDraw = {
  idle(stage) {
    var root = scene(stage, "wheel");
    if (root.childElementCount == 0) {
      var wrap = el("div", "jp-wheel-wrap");
      var wheel = el("div", "jp-wheel");
      wheel.appendChild(svgNode("svg", { viewBox: "0 0 200 200", "aria-hidden": "true" }));
      wheel.appendChild(el("div", "jp-wheel-avatars"));
      var center = el("div", "jp-wheel-center");
      center.append(el("span", "jp-total jp-mirror-total"), el("span", "jp-pot-label", "coins in the pot"), el("span", "jp-center-status jp-mirror-status"));
      wrap.append(el("div", "jp-pointer"), wheel, center);
      root.appendChild(wrap);
    }
    var wheelElement = root.querySelector(".jp-wheel");
    wheelElement.style.transition = "none";
    wheelElement.style.transform = "rotate(0deg)";
    this.paint(root);
  },

  paint(root) {
    var svg = root.querySelector("svg");
    var avatars = root.querySelector(".jp-wheel-avatars");
    var outer = 96;
    var inner = 70;
    var children = [
      svgNode("circle", { cx: 100, cy: 100, r: (outer + inner) / 2, fill: "none", stroke: "#2a2a2a", "stroke-width": outer - inner }),
    ];
    var items = [];
    var angle = 0;
    drawBets().forEach((bet) => {
      var size = (bet.coins / state.total) * 360;
      var piece =
        size >= 359.99
          ? svgNode("circle", { cx: 100, cy: 100, r: (outer + inner) / 2, fill: "none", stroke: shareColor(bet.name), "stroke-width": outer - inner })
          : svgNode("path", { d: ringPath(angle, angle + size, outer, inner), fill: shareColor(bet.name), stroke: "#1b1b1b", "stroke-width": 1.2 });
      var tip = svgNode("title", {});
      tip.textContent = bet.name + ": tickets #" + bet.from + " - #" + bet.to;
      piece.appendChild(tip);
      children.push(piece);
      if (size >= 14) {
        var middle = wheelPoint((outer + inner) / 2, angle + size / 2);
        var avatar = createAvatar(bet.name, "sm");
        avatar.classList.add("jp-wheel-avatar");
        avatar.style.left = middle[0] / 2 + "%";
        avatar.style.top = middle[1] / 2 + "%";
        items.push(avatar);
      }
      angle += size;
    });
    svg.replaceChildren(...children);
    avatars.replaceChildren(...items);
  },

  async play(stage, draw, duration, short) {
    this.idle(stage);
    var wheel = stage.querySelector(".jp-wheel");
    var target = ((draw.ticket + 0.5) / draw.total) * 360;
    // Not too fast: a very fast wheel looks like it turns backwards (wagon-wheel effect)
    var turns = short ? 1 : randomBetween(2.5, 4);
    var end = Math.round(turns) * 360 - target;
    if (short) {
      await animate(wheel, [{ transform: "rotate(0deg)" }, { transform: `rotate(${end}deg)` }], { duration: duration, easing: SLOW_END });
    } else {
      // A different ending every time (the size of the winner's field: how far "nearly" is)
      var bet = drawBets().find((b) => b.from <= draw.ticket + 1 && b.to >= draw.ticket + 1);
      var field = Math.min(40, bet ? (bet.coins / draw.total) * 360 : 20);
      var frames = spinEnding(0, end, field).map((f) => ({ transform: `rotate(${f.value}deg)`, offset: f.offset, easing: f.easing }));
      await animate(wheel, frames, { duration: duration });
    }
    wheel.style.transform = `rotate(${end}deg)`;
    if (!short) confetti(stage.firstElementChild);
  },
};

/* ---------- 2. Roulette (pictures) ---------- */

var rouletteDraw = {
  tile(name, winner) {
    var tile = el("div", "jp-tile");
    tile.style.setProperty("--share", shareColor(name));
    if (winner) tile.dataset.winner = "1";
    tile.append(createAvatar(name), el("span", "", name));
    return tile;
  },

  idle(stage) {
    var root = scene(stage, "roulette");
    root.replaceChildren();
    if (state.entries.length == 0) {
      emptyNote(root, "Nobody is in yet - the pictures appear here.");
      return;
    }
    var strip = el("div", "jp-roulette");
    var track = el("div", "jp-track");
    // Every player as often as their share (about 12 pictures)
    var tiles = [];
    state.entries.forEach((entry) => {
      var count = Math.max(1, Math.round((entry.coins / state.total) * 12));
      for (var i = 0; i < count; i++) tiles.push(entry.name);
    });
    // Mixed, but the same order every time (no jumping while the pot grows)
    tiles = tiles.map((name, index) => ({ name: name, key: (index * 7919) % 101 })).sort((a, b) => a.key - b.key).map((t) => t.name);
    track.append(...tiles.map((name) => this.tile(name)));
    strip.append(el("div", "jp-marker"), track);
    root.appendChild(strip);
  },

  async play(stage, draw, duration) {
    var root = scene(stage, "roulette");
    root.replaceChildren();
    var strip = el("div", "jp-roulette");
    var track = el("div", "jp-track");
    strip.append(el("div", "jp-marker"), track);
    root.appendChild(strip);

    // Many pictures, each player as often as their share; the winner stops under the marker
    var bets = drawBets();
    var count = Math.round(randomBetween(48, 80));
    var target = count - Math.round(randomBetween(5, 9));
    var names = [];
    for (var i = 0; i < count; i++) {
      var ticket = Math.random() * state.total;
      names.push(bets.find((bet) => bet.to > ticket).name);
    }
    names[target] = draw.winner;
    track.append(...names.map((name, index) => this.tile(name, index == target)));

    var tile = track.children[target];
    var tileWidth = tile.offsetWidth + 8;
    var offset = target * tileWidth + tile.offsetWidth * randomBetween(0.2, 0.8);
    var end = strip.clientWidth / 2 - offset;
    var frames = spinEnding(0, end, tileWidth).map((f) => ({ transform: `translateX(${f.value}px)`, offset: f.offset, easing: f.easing }));
    await animate(track, frames, { duration: duration });
    tile.classList.add("chosen");
  },
};

/* ---------- 3. Bowling: everything falls, only the winner stays ---------- */

var bowlingDraw = {
  // Triangle like in bowling: 1, 2, 3, 4 pins (from the front)
  positions(count) {
    var spots = [];
    for (var row = 0; row < 4 && spots.length < count; row++) {
      for (var i = 0; i <= row && spots.length < count; i++) {
        spots.push({ x: 72 + row * 7, y: 50 + (i - row / 2) * 17 });
      }
    }
    return spots;
  },

  build(stage, winner) {
    var root = scene(stage, "bowling");
    root.replaceChildren();
    var lane = el("div", "jp-lane");
    lane.append(el("div", "jp-lane-gutter top"), el("div", "jp-lane-gutter bottom"), el("div", "jp-lane-arrows"));
    var ball = el("div", "jp-ball");
    lane.appendChild(ball);
    var players = playersFor(10, winner);
    var spots = this.positions(players.length);
    var pins = players.map((player, index) => {
      var pin = el("div", "jp-pin");
      pin.dataset.name = player.name;
      pin.style.left = spots[index].x + "%";
      pin.style.top = spots[index].y + "%";
      pin.style.setProperty("--share", shareColor(player.name));
      pin.append(createAvatar(player.name, "sm"), el("span", "jp-pin-body"));
      lane.appendChild(pin);
      return pin;
    });
    root.appendChild(lane);
    return { root: root, lane: lane, ball: ball, pins: pins };
  },

  idle(stage) {
    var parts = this.build(stage);
    if (parts.pins.length == 0) emptyNote(parts.lane, "No pins yet - every player is a pin.");
  },

  async play(stage, draw, duration, short) {
    var parts = this.build(stage, draw.winner);
    var root = parts.root;
    var lane = parts.lane;
    var ball = parts.ball;
    var winnerPin = parts.pins.find((pin) => pin.dataset.name == draw.winner);
    var others = parts.pins.filter((pin) => pin != winnerPin);
    var t = short ? 0.15 : duration / 7100; // all times are for a 7.1s draw

    // 1. Charging up: the ball shakes, the lane flashes
    if (!short) {
      lane.classList.add("charging");
      shout(root, pick(["READY?", "AIM...", "HERE IT COMES"]), "small");
      await animate(
        ball,
        [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ transform: `translate(${i % 2 ? -3 : 3}px, ${i % 3 ? 2 : -2}px) scale(${1 + i * 0.02})` })),
        { duration: 1200 * t, easing: "linear" },
      );
      lane.classList.remove("charging");
      shout(root, pick(["GO!", "ROLL!", "SEND IT!"]), "small");
    }

    // 2. The roll: fast, then slow motion right before the pins (and zoom)
    var laneWidth = lane.clientWidth;
    // The roll slows down right before the pins (slow motion)
    // Straight or with a hook (a curve to the side and back)
    var hook = Math.random() < 0.5 ? 0 : randomBetween(-34, 34);
    var rollTime = randomBetween(2200, 3000) * t;
    var roll = animate(
      ball,
      [
        { transform: "translate(0, 0) rotate(0deg)" },
        { transform: `translate(${laneWidth * 0.33}px, ${hook}px) rotate(600deg)`, offset: 0.55 },
        { transform: `translate(${laneWidth * 0.66}px, 0) rotate(1180deg)` },
      ],
      { duration: rollTime, easing: SLOW_END },
    );
    lane.classList.add("rolling");
    setTimeout(() => lane.classList.add("zoom"), rollTime / 2);
    await roll;
    lane.classList.remove("rolling");

    // 3. Impact: flash, shake, the pins fly
    var flash = el("div", "jp-flash");
    root.appendChild(flash);
    animate(flash, [{ opacity: 0.9 }, { opacity: 0 }], { duration: 450 }).then(() => flash.remove());
    animate(
      root,
      [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ transform: `translate(${(i % 2 ? -1 : 1) * (10 - i)}px, ${(i % 3 ? 1 : -1) * (6 - i / 2)}px)` })),
      { duration: 500, fill: "none" },
    );
    animate(ball, [{ transform: getComputedStyle(ball).transform }, { transform: `translateX(${laneWidth * 1.1}px) rotate(1500deg)`, opacity: 0 }], {
      duration: 700 * t + 200,
      easing: "ease-out",
    });
    // A few pins wobble like the winner's ... and fall one after the other, the last one right at the end
    var wobblers = short ? [] : others.slice().sort(() => Math.random() - 0.5).slice(0, Math.min(others.length, Math.round(randomBetween(1, 3))));
    wobblers.forEach((pin, n) => {
      var wobble = (1300 * t + 300) * ((n + 1) / wobblers.length) * randomBetween(0.85, 1);
      animate(
        pin,
        [0, 1, 2, 3, 4, 5, 6].map((i) => ({ transform: `translate(-50%, -50%) rotate(${(i % 2 ? -1 : 1) * (24 - i * 3)}deg)` })),
        { duration: wobble, fill: "none" },
      ).then(() =>
        animate(pin, [{ transform: "translate(-50%, -50%) rotate(0deg)", opacity: 1 }, { transform: `translate(calc(-50% + 40px), calc(-50% + 60px)) rotate(95deg)`, opacity: 0 }], {
          duration: 450,
          easing: "ease-in",
        }),
      );
    });
    others.forEach((pin) => {
      if (wobblers.includes(pin)) return;
      animate(
        pin,
        [
          { transform: "translate(-50%, -50%) rotate(0deg)", opacity: 1 },
          {
            transform: `translate(calc(-50% + ${randomBetween(60, 260)}px), calc(-50% + ${randomBetween(-180, 180)}px)) rotate(${randomBetween(-720, 720)}deg)`,
            opacity: 0,
          },
        ],
        { duration: randomBetween(700, 1100), delay: randomBetween(0, 180), easing: "cubic-bezier(.2,.8,.3,1)" },
      );
    });

    // 4. The winner's pin wobbles ... and stays!
    if (winnerPin) {
      await animate(
        winnerPin,
        [
          { transform: "translate(-50%, -50%) rotate(0deg)" },
          { transform: "translate(-50%, -50%) rotate(18deg)" },
          { transform: "translate(-50%, -50%) rotate(-14deg)" },
          { transform: "translate(-50%, -50%) rotate(9deg)" },
          { transform: "translate(-50%, -50%) rotate(-5deg)" },
          { transform: "translate(-50%, -50%) rotate(0deg)" },
        ],
        { duration: 1500 * t + 300, easing: SLOW_END },
      );
      winnerPin.classList.add("standing");
    }
    lane.classList.remove("zoom");
    if (!short) {
      shout(root, pick(["STRIKE!", "SPARE!", "BOOM!"]), "strike");
      confetti(root);
    }
    winnerLabel(root, draw);
    await wait(short ? 0 : 400);
  },
};

/* ---------- 4. Plinko: the ball falls into the winning slot ---------- */

var plinkoDraw = {
  ROWS: 8,

  build(stage) {
    var root = scene(stage, "plinko");
    root.replaceChildren();
    var board = el("div", "jp-plinko");
    // Pegs: rows of dots, every other row shifted
    for (var row = 0; row < this.ROWS; row++) {
      var count = row % 2 ? 11 : 12;
      for (var i = 0; i < count; i++) {
        var peg = el("i", "jp-peg");
        peg.style.left = ((i + (row % 2 ? 1 : 0.5)) / 12) * 100 + "%";
        peg.style.top = 12 + row * 9 + "%";
        board.appendChild(peg);
      }
    }
    // Slots at the bottom: one per bet, as wide as its tickets
    var slots = el("div", "jp-slots");
    var bets = drawBets();
    bets.forEach((bet) => {
      var slot = el("div", "jp-slot");
      slot.style.flexGrow = bet.coins;
      slot.style.setProperty("--share", shareColor(bet.name));
      slot.title = bet.name + ": tickets #" + bet.from + " - #" + bet.to;
      if (bet.coins / state.total > 0.06) slot.appendChild(createAvatar(bet.name, "sm"));
      slot.dataset.from = bet.from;
      slot.dataset.to = bet.to;
      slots.appendChild(slot);
    });
    board.appendChild(slots);
    var ball = el("div", "jp-plinko-ball");
    board.appendChild(ball);
    root.appendChild(board);
    if (bets.length == 0) emptyNote(board, "The slots appear with the first coins.");
    return { root: root, board: board, ball: ball, slots: slots };
  },

  idle(stage) {
    this.build(stage);
  },

  async play(stage, draw, duration, short) {
    var parts = this.build(stage);
    var board = parts.board;
    var width = board.clientWidth;
    var height = board.clientHeight;
    // Where the winning ticket is at the bottom
    var targetX = ((draw.ticket + 0.5) / draw.total) * width;
    var startX = randomBetween(width * 0.15, width * 0.85);
    var rowHeight = height * 0.09;
    var frames = [{ transform: `translate(${startX}px, 0px)`, offset: 0 }];
    var steps = this.ROWS + 1;
    var x = startX;
    for (var row = 0; row <= this.ROWS; row++) {
      // Bounce from peg to peg at random - only the last rows lead to the slot
      var left = this.ROWS - row; // rows still to come
      var next;
      if (left >= 3) {
        next = Math.max(width * 0.06, Math.min(width * 0.94, x + randomBetween(-1, 1) * width * 0.09));
      } else {
        next = left == 0 ? targetX : x + (targetX - x) / (left + 1) + randomBetween(-1, 1) * width * 0.03;
      }
      var y = height * 0.12 + row * rowHeight;
      // Small hop up after each peg
      frames.push({ transform: `translate(${(x + next) / 2}px, ${y - rowHeight * 0.35}px)`, offset: (row + 0.5) / (steps + 1) });
      frames.push({ transform: `translate(${next}px, ${y}px)`, offset: (row + 1) / (steps + 1) });
      x = next;
    }
    // Sometimes it jumps over into the slot next to it ... and back
    if (!short && Math.random() < 0.45) {
      var side = targetX + (Math.random() < 0.5 ? -1 : 1) * width * randomBetween(0.05, 0.09);
      frames.forEach((f) => (f.offset *= 0.86));
      frames.push({ transform: `translate(${(targetX + side) / 2}px, ${height * 0.78}px)`, offset: 0.9 });
      frames.push({ transform: `translate(${side}px, ${height * 0.86}px)`, offset: 0.93 });
      frames.push({ transform: `translate(${targetX}px, ${height * 0.8}px)`, offset: 0.97 });
    }
    frames.push({ transform: `translate(${targetX}px, ${height * 0.9}px)`, offset: 1 });
    await animate(parts.ball, frames, { duration: duration, easing: SLOW_END });

    // The slot of the winning ticket lights up
    var winner = [...parts.slots.children].find(
      (slot) => Number(slot.dataset.from) <= draw.ticket + 1 && Number(slot.dataset.to) >= draw.ticket + 1,
    );
    if (winner) winner.classList.add("won");
    if (!short) confetti(parts.root);
    winnerLabel(parts.root, draw);
  },
};

/* ---------- 5. Race: the winner crosses the line first ---------- */

var raceDraw = {
  build(stage, winner) {
    var root = scene(stage, "race");
    root.replaceChildren();
    var track = el("div", "jp-race");
    var players = playersFor(6, winner);
    var runners = players.map((player) => {
      var lane = el("div", "jp-race-lane");
      lane.style.setProperty("--share", shareColor(player.name));
      var runner = el("div", "jp-runner");
      runner.dataset.name = player.name;
      runner.append(createAvatar(player.name, "sm"), el("span", "jp-runner-horse", "🏇"));
      lane.append(el("span", "jp-race-chance", Math.round((player.coins / state.total) * 100) + "%"), runner);
      track.appendChild(lane);
      return runner;
    });
    track.appendChild(el("div", "jp-finish"));
    root.appendChild(track);
    if (players.length == 0) emptyNote(track, "No runners yet - every player gets a lane.");
    return { root: root, track: track, runners: runners };
  },

  idle(stage) {
    this.build(stage);
  },

  async play(stage, draw, duration, short) {
    var parts = this.build(stage, draw.winner);
    var root = parts.root;
    // From the start to the finish line (the runner's nose touches it)
    var runnerWidth = parts.runners.length ? parts.runners[0].offsetWidth : 60;
    var laneWidth = parts.track.clientWidth - 40 - 34 - runnerWidth;
    var countdown = short ? 0 : 900;
    if (!short) {
      shout(root, "On your marks...", "small");
      await wait(countdown);
      shout(root, "GO!", "small");
    }
    var raceTime = duration - countdown;

    // Every runner: random speed in every part of the race (so they overtake).
    // The winner reaches the line at the end, the others just before (photo finish).
    var finishers = [];
    // The story of the race: a late sprint, start to finish, or a stumble
    var story = pick(["sprint", "sprint", "stumble", "open", "leader"]);
    var stumbler = pick(parts.runners);
    var others = parts.runners.filter((runner) => runner.dataset.name != draw.winner);
    var rival = others.length ? pick(others) : null; // leads for a long time
    var animations = parts.runners.map((runner) => {
      var isWinner = runner.dataset.name == draw.winner;
      var end = isWinner ? 1 : runner == rival ? randomBetween(0.975, 0.993) : randomBetween(story == "leader" ? 0.8 : 0.88, 0.985);
      var speeds = [];
      for (var i = 0; i < 8; i++) speeds.push(randomBetween(0.6, 1.4));
      if (isWinner && story == "sprint") speeds = [0.4, 0.5, 0.6, 0.7, 0.9, 1.4, 1.9, 2.3].map((v) => v * randomBetween(0.85, 1.15));
      if (isWinner && story == "leader") speeds = [2, 1.7, 1.4, 1.1, 0.9, 0.8, 0.7, 0.7].map((v) => v * randomBetween(0.85, 1.15));
      // The rival is in front until the last part
      if (runner == rival && story != "leader") speeds = [1.6, 1.5, 1.3, 1.2, 1.1, 1, 0.7, 0.35].map((v) => v * randomBetween(0.9, 1.1));
      // A stumble: almost standing still for a moment
      if (story == "stumble" && runner == stumbler) speeds[Math.floor(randomBetween(2, 6))] = 0.05;
      var sum = speeds.reduce((a, b) => a + b, 0);
      var position = 0;
      var frames = [{ transform: "translateX(0px)", offset: 0 }];
      speeds.forEach((speed, index) => {
        position += (speed / sum) * end;
        frames.push({ transform: `translateX(${position * laneWidth}px)`, offset: (index + 1) / speeds.length });
      });
      if (isWinner) finishers.push(runner);
      // Everybody slows down towards the line (the winner still arrives first)
      return animate(runner, frames, { duration: raceTime, easing: SLOW_END });
    });
    // The last moment: the photo finish (the track gets darker at the edges)
    setTimeout(() => parts.track.classList.add("photo"), raceTime * randomBetween(0.76, 0.86));
    if (!short && story == "stumble") setTimeout(() => shout(root, pick(["OOPS!", "STUMBLE!"]), "small"), raceTime * 0.4);
    if (!short && story == "sprint") setTimeout(() => shout(root, pick(["FINAL SPRINT!", "HERE COMES..."]), "small"), raceTime * 0.62);
    await Promise.all(animations);
    parts.track.classList.remove("photo");
    finishers.forEach((runner) => runner.parentElement.classList.add("won"));
    if (!short) {
      var flash = el("div", "jp-flash");
      root.appendChild(flash);
      animate(flash, [{ opacity: 0.8 }, { opacity: 0 }], { duration: 400 }).then(() => flash.remove());
      shout(root, story == "leader" ? pick(["WIRE TO WIRE!", "UNTOUCHABLE!"]) : pick(["PHOTO FINISH!", "BY A NOSE!"]), "strike");
      confetti(root);
    }
    winnerLabel(root, draw);
  },
};

/* ---------- 6. Claw machine: the claw grabs the winner ---------- */

var clawDraw = {
  build(stage, winner) {
    var root = scene(stage, "claw");
    root.replaceChildren();
    var machine = el("div", "jp-claw-machine");
    var chute = el("div", "jp-claw-chute");
    chute.appendChild(el("span", "", "WIN"));
    var rail = el("div", "jp-claw-rail");
    var claw = el("div", "jp-claw");
    claw.append(el("div", "jp-claw-rope"), el("div", "jp-claw-head"), el("div", "jp-claw-arm left"), el("div", "jp-claw-arm right"));
    var pile = el("div", "jp-claw-pile");
    // One plush per player, at a random place in the pile (the same place for
    // everybody while the pot doesn't change)
    var players = playersFor(12, winner);
    var plushes = players.map((player, index) => {
      var plush = el("div", "jp-plush");
      plush.dataset.name = player.name;
      plush.style.setProperty("--share", shareColor(player.name));
      var column = index % 6;
      var row = Math.floor(index / 6);
      plush.style.left = 30 + column * 11 + (row % 2) * 5 + "%";
      plush.style.bottom = 6 + row * 22 + "%";
      plush.appendChild(createAvatar(player.name));
      pile.appendChild(plush);
      return plush;
    });
    machine.append(chute, rail, pile, claw);
    root.appendChild(machine);
    // The claw waits above the chute
    claw.style.transform = `translate(${machine.clientWidth * 0.11}px, 0px)`;
    if (players.length == 0) emptyNote(machine, "The plushies drop in with the first coins.");
    return { root: root, machine: machine, claw: claw, plushes: plushes };
  },

  idle(stage) {
    this.build(stage);
  },

  async play(stage, draw, duration, short) {
    var parts = this.build(stage, draw.winner);
    var machine = parts.machine;
    var claw = parts.claw;
    var prize = parts.plushes.find((plush) => plush.dataset.name == draw.winner);
    var width = machine.clientWidth;
    var height = machine.clientHeight;
    var target = prize.offsetLeft + prize.offsetWidth / 2;
    var prizeTop = prize.offsetTop;
    var chuteX = width * 0.11;
    var start = width * 0.11;
    var t = duration / 7100;
    var setClaw = (x, drop) => ({ transform: `translate(${x}px, ${drop}px)` });

    // 1. Searching: left and right over the pile, slower and slower, then above the winner
    var search = [setClaw(start, 0)];
    var spots = [];
    if (!short) for (var n = Math.round(randomBetween(2, 5)); n > 0; n--) spots.push(randomBetween(width * 0.3, width * 0.85));
    spots.forEach((x) => search.push(setClaw(x, 0)));
    search.push(setClaw(target, 0));

    // Sometimes it goes for the wrong plush first ... and it slips out
    var others = parts.plushes.filter((plush) => plush != prize);
    var decoy = !short && others.length && Math.random() < 0.65 ? pick(others) : null;
    // Before going down: back and forth between the prize and another one
    if (!short && others.length && !decoy) {
      var other = pick(others);
      var otherX = other.offsetLeft + other.offsetWidth / 2;
      search.splice(search.length - 1, 0, setClaw(otherX, 0), setClaw(target, 0), setClaw(otherX, 0));
    }
    if (decoy) {
      var decoyX = decoy.offsetLeft + decoy.offsetWidth / 2;
      search[search.length - 1] = setClaw(decoyX, 0);
      await animate(claw, search, { duration: 1500 * t, easing: SLOW_END });
      var decoyDrop = decoy.offsetTop - 40;
      await animate(claw, [setClaw(decoyX, 0), setClaw(decoyX, decoyDrop)], { duration: 700 * t, easing: SLOW_END });
      claw.classList.add("closed");
      await animate(claw, [setClaw(decoyX, decoyDrop), setClaw(decoyX, decoyDrop * 0.4)], { duration: 500 * t, easing: "ease-out" });
      claw.classList.remove("closed");
      shout(parts.root, pick(["SLIPPED!", "NOPE!", "SO CLOSE!"]), "small");
      animate(decoy, [{ transform: "rotate(0deg)" }, { transform: "rotate(20deg)" }, { transform: "rotate(-12deg)" }, { transform: "rotate(0deg)" }], { duration: 500, fill: "none" });
      await animate(claw, [setClaw(decoyX, decoyDrop * 0.4), setClaw(target, 0)], { duration: 700 * t, easing: SLOW_END });
    } else {
      await animate(claw, search, { duration: 2600 * t, easing: SLOW_END });
    }

    // 2. Down to the prize, the claw closes
    var drop = prizeTop - 40;
    await animate(claw, [setClaw(target, 0), setClaw(target, drop)], { duration: 1100 * t, easing: SLOW_END });
    claw.classList.add("closed");
    await wait(350 * t);

    // 3. Up with the prize ... it wobbles dangerously
    var hold = el("div", "jp-plush held");
    hold.style.setProperty("--share", shareColor(draw.winner));
    hold.appendChild(createAvatar(draw.winner));
    prize.style.visibility = "hidden";
    claw.appendChild(hold);
    await animate(claw, [setClaw(target, drop), setClaw(target, 0)], { duration: 1000 * t, easing: SLOW_END });
    if (!short) {
      await animate(
        hold,
        [0, 1, 2, 3, 4, 5].map((i) => ({ transform: `translateX(-50%) rotate(${(i % 2 ? -1 : 1) * (14 - i * 2)}deg)` })),
        { duration: 700, easing: SLOW_END },
      );
    }

    // 4. Over to the chute, open, it falls in
    await animate(claw, [setClaw(target, 0), setClaw(chuteX, 0)], { duration: 1100 * t, easing: SLOW_END });
    claw.classList.remove("closed");
    var fall = animate(
      hold,
      [{ transform: "translateX(-50%) translateY(0)" }, { transform: `translateX(-50%) translateY(${height * 0.62}px)`, opacity: 0.2 }],
      { duration: 600, easing: "ease-in" },
    );
    await fall;
    parts.machine.querySelector(".jp-claw-chute").classList.add("won");
    if (!short) {
      shout(parts.root, pick(["GOT IT!", "JACKPOT!", "PRIZE!"]), "strike");
      confetti(parts.root);
    }
    winnerLabel(parts.root, draw);
  },
};

/* ---------- 7. Battle royale: the last one standing wins ---------- */

var royaleDraw = {
  // Places in the arena: the same while waiting (no jumping), new ones for every draw
  place(index, count, spin) {
    var angle = (index / Math.max(1, count)) * Math.PI * 2 + (spin == null ? 0.6 : spin);
    var radius = spin == null ? 0.32 + ((index * 37) % 10) / 100 : randomBetween(0.3, 0.42);
    // Not too close to the edges, so the zone around everybody stays visible
    return { x: 50 + Math.cos(angle) * radius * 100 * 0.62, y: 54 + Math.sin(angle) * radius * 70 };
  },

  build(stage, winner, shuffle) {
    var root = scene(stage, "royale");
    root.replaceChildren();
    var arena = el("div", "jp-arena-map");
    var zone = el("div", "jp-zone");
    arena.appendChild(zone);
    var feed = el("div", "jp-killfeed");
    var players = playersFor(12, winner);
    var spin = shuffle ? randomBetween(0, Math.PI * 2) : null;
    if (shuffle) players = players.slice().sort(() => Math.random() - 0.5);
    var fighters = players.map((player, index) => {
      var spot = this.place(index, players.length, spin);
      var fighter = el("div", "jp-fighter");
      fighter.dataset.name = player.name;
      fighter.style.left = spot.x + "%";
      fighter.style.top = spot.y + "%";
      fighter.style.setProperty("--share", shareColor(player.name));
      fighter.appendChild(createAvatar(player.name));
      arena.appendChild(fighter);
      return fighter;
    });
    root.append(arena, feed);
    if (players.length == 0) emptyNote(arena, "The arena fills with the first coins.");
    return { root: root, arena: arena, zone: zone, feed: feed, fighters: fighters };
  },

  idle(stage) {
    this.build(stage);
  },

  async play(stage, draw, duration, short) {
    var parts = this.build(stage, draw.winner, !short);
    var winner = parts.fighters.find((fighter) => fighter.dataset.name == draw.winner);
    // Who is out when: the smaller the share, the earlier (with a lot of luck), the winner last
    var losers = parts.fighters
      .filter((fighter) => fighter != winner)
      .map((fighter) => {
        var entry = state.entries.find((e) => e.name == fighter.dataset.name);
        return { fighter: fighter, order: (entry ? entry.coins / state.total : 0) + Math.random() * 1.2 };
      })
      .sort((a, b) => a.order - b.order)
      .map((item) => item.fighter);

    // The zone closes in on the winner (slower at the end)
    var zone = parts.zone;
    var winnerX = parseFloat(winner.style.left);
    var winnerY = parseFloat(winner.style.top);
    // First it wanders somewhere else, then it closes in on the last two -
    // between them, so nobody knows who is left in the end
    var last = losers[losers.length - 1];
    var lastX = last ? parseFloat(last.style.left) : winnerX;
    var lastY = last ? parseFloat(last.style.top) : winnerY;
    var playTime = duration * (short ? 1 : 0.88);
    animate(
      zone,
      [
        { left: "50%", top: "50%", width: "120%", height: "190%" },
        { left: randomBetween(30, 70) + "%", top: randomBetween(35, 70) + "%", width: randomBetween(55, 75) + "%", height: randomBetween(90, 120) + "%", offset: randomBetween(0.35, 0.55) },
        {
          left: (winnerX + lastX) / 2 + "%",
          top: (winnerY + lastY) / 2 + "%",
          width: Math.abs(winnerX - lastX) + 22 + "%",
          height: Math.abs(winnerY - lastY) * 1.6 + 40 + "%",
        },
      ],
      { duration: playTime, easing: SLOW_END },
    );

    // Everybody moves a little (they fight)
    parts.fighters.forEach((fighter) => {
      animate(
        fighter,
        [0, 1, 2, 3].map((i) => ({ transform: `translate(calc(-50% + ${randomBetween(-14, 14)}px), calc(-50% + ${randomBetween(-10, 10)}px))` })),
        { duration: duration, easing: "ease-in-out", fill: "none" },
      );
    });

    // Eliminations: quick at first, longer and longer pauses (the final duel is the longest)
    var count = losers.length;
    var weights = losers.map((_, i) => (1 + i * 0.7) * randomBetween(0.6, 1.4));
    var sum = weights.reduce((a, b) => a + b, 0);
    for (var i = 0; i < count; i++) {
      await wait((weights[i] / sum) * playTime);
      this.eliminate(parts, losers[i], short);
      if (count - i - 1 == 1 && !short) shout(parts.root, pick(["FINAL DUEL", "LAST TWO!", "1 VS 1"]), "small");
    }
    // Only now the zone closes around the one who is left
    animate(zone, [{ left: winnerX + "%", top: winnerY + "%", width: "16%", height: "30%" }], { duration: short ? 1 : 450, easing: "ease-out" });
    await wait(short ? 0 : 300);
    winner.classList.add("champion");
    if (!short) {
      shout(parts.root, pick(["WINNER WINNER", "VICTORY ROYALE", "LAST ONE STANDING"]), "strike");
      confetti(parts.root);
    }
    winnerLabel(parts.root, draw);
  },

  eliminate(parts, fighter, short) {
    var boom = el("span", "jp-boom", "💥");
    boom.style.left = fighter.style.left;
    boom.style.top = fighter.style.top;
    parts.arena.appendChild(boom);
    animate(boom, [{ transform: "translate(-50%, -50%) scale(0.3)", opacity: 1 }, { transform: "translate(-50%, -50%) scale(1.6)", opacity: 0 }], {
      duration: 600,
    }).then(() => boom.remove());
    fighter.classList.add("out");
    // Kill feed (the newest on top, at most 4)
    var line = el("div", "jp-kill");
    line.append(el("b", "", fighter.dataset.name), document.createTextNode(pick([" was eliminated", " got knocked out", " was caught by the storm", " was sniped", " fell off the map"])));
    parts.feed.prepend(line);
    while (parts.feed.childElementCount > 4) parts.feed.lastElementChild.remove();
    if (!short) animate(parts.root, [{ transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "translateX(0)" }], { duration: 180, fill: "none" });
  },
};

/* ---------- 8. Coin rain: the first jar that overflows wins ---------- */

var coinRainDraw = {
  build(stage, winner) {
    var root = scene(stage, "coinrain");
    root.replaceChildren();
    var shelf = el("div", "jp-shelf");
    var jars = playersFor(8, winner).map((player) => {
      var column = el("div", "jp-jar-col");
      column.style.setProperty("--share", shareColor(player.name));
      var jar = el("div", "jp-jar");
      var fill = el("div", "jp-jar-fill");
      jar.appendChild(fill);
      var label = el("div", "jp-jar-name");
      label.append(createAvatar(player.name, "sm"), el("span", "", player.name));
      column.append(jar, label);
      shelf.appendChild(column);
      return { name: player.name, column: column, jar: jar, fill: fill, level: 0, debt: 0 };
    });
    var crown = el("div", "jp-jar-crown", "👑");
    root.append(shelf, crown);
    if (jars.length == 0) emptyNote(root, "The jars fill with the first coins.");
    return { root: root, jars: jars, crown: crown };
  },

  idle(stage) {
    this.build(stage);
  },

  setLevel(jar, level) {
    jar.level = level;
    jar.fill.style.height = level * 100 + "%";
  },

  // Where the coins land in a jar (px in the scene)
  spot(parts, jar) {
    var root = parts.root.getBoundingClientRect();
    var box = jar.jar.getBoundingClientRect();
    return {
      x: box.left - root.left + box.width / 2,
      half: box.width / 2,
      top: box.top - root.top,
      surface: box.bottom - root.top - jar.level * box.height,
      floor: root.height,
    };
  },

  coin(parts, x, size) {
    var coin = el("i", "jp-coin");
    coin.style.left = x + "px";
    if (size) coin.style.setProperty("--coin", size + "px");
    parts.root.appendChild(coin);
    return coin;
  },

  // One coin falls from the sky into a jar
  drop(parts, jar, fall) {
    var spot = this.spot(parts, jar);
    var x = spot.x + randomBetween(-spot.half + 9, spot.half - 9);
    var coin = this.coin(parts, x);
    return animate(
      coin,
      [
        { transform: `translate(calc(-50% + ${randomBetween(-18, 18)}px), -24px) rotate(0deg)` },
        { transform: `translate(-50%, ${spot.surface - 10}px) rotate(${randomBetween(-300, 300)}deg)` },
      ],
      { duration: fall || randomBetween(380, 560), easing: "cubic-bezier(.45,0,1,1)" },
    ).then(() => coin.remove());
  },

  // The crown sits on the jar that is the most full
  crownOn(parts, jar) {
    var spot = this.spot(parts, jar);
    parts.crown.style.left = spot.x + "px";
    parts.crown.style.top = spot.top - 30 + "px";
    parts.crown.classList.add("on");
    animate(parts.crown, [{ transform: "translate(-50%, -8px) scale(1.3)" }, { transform: "translate(-50%, 0) scale(1)" }], {
      duration: 260,
      easing: "ease-out",
      fill: "none",
    });
  },

  async play(stage, draw, duration, short) {
    var parts = this.build(stage, draw.winner);
    var jars = parts.jars;
    var winner = jars.find((jar) => jar.name == draw.winner);
    if (winner == null) return winnerLabel(parts.root, draw);

    // A different story every time: how full each jar ends and how fast it gets there
    var rivals = jars.filter((jar) => jar != winner);
    var plan = this.plan(winner, rivals);

    if (short) {
      jars.forEach((jar) => this.setLevel(jar, jar.final));
      return this.overflow(parts, winner, draw, true);
    }

    // The rain: fast at first, slower and slower at the end
    var rainTime = duration - 1000;
    var start = performance.now();
    var leader = null;
    var shouted = 0;
    await new Promise((resolve) => {
      var frame = (now) => {
        // The first frame can be a little older than start
        var t = Math.min(1, Math.max(0, (now - start) / rainTime));
        var p = 1 - Math.pow(1 - t, 1.5);
        jars.forEach((jar) => {
          // The winner stays just below the rim until the last coin
          var target = jar.final * jar.pace(p) * (jar == winner ? 0.985 : 1);
          var level = Math.max(jar.level, target);
          jar.debt = Math.min(jar.debt + (level - jar.level) * 36, 3);
          for (; jar.debt >= 1; jar.debt--) this.drop(parts, jar);
          this.setLevel(jar, level);
          jar.column.classList.toggle("brim", level > 0.84);
        });
        var top = jars.reduce((best, jar) => (jar.level > best.level ? jar : best), jars[0]);
        if (top != leader && top.level > 0.15) {
          leader = top;
          this.crownOn(parts, top);
        }
        if (shouted < plan.shouts.length && t > plan.shouts[shouted].at) {
          shout(parts.root, plan.shouts[shouted].text, "small");
          shouted++;
        }
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });

    // The last coin, big and slow - and not always straight in
    jars.forEach((jar) => jar.column.classList.remove("brim"));
    winner.column.classList.add("brim");
    var last = await this.lastCoin(parts, winner, plan.decoy);
    last.remove();
    this.setLevel(winner, 1);
    this.overflow(parts, winner, draw, false);
  },

  // How fast a jar fills over the time: random speeds for a few parts of the rain
  pace(speeds) {
    var total = speeds.reduce((a, b) => a + b, 0);
    var sums = [0];
    speeds.forEach((speed) => sums.push(sums[sums.length - 1] + speed / total));
    var n = speeds.length;
    return (p) => {
      var i = Math.min(n - 1, Math.floor(p * n));
      return sums[i] + (sums[i + 1] - sums[i]) * (p * n - i);
    };
  },

  randomSpeeds(low, high) {
    return [0, 1, 2, 3, 4].map(() => randomBetween(low, high));
  },

  /*
   * The story of this draw (random): a comeback, a runaway leader, a photo
   * finish, a back and forth or an underdog. The winner is fixed (server),
   * only the way there changes.
   */
  plan(winner, rivals) {
    var pick = (list) => list[Math.floor(Math.random() * list.length)];
    var stories = ["comeback", "photo", "photo", "seesaw", "underdog", "comeback", "runaway"];
    var story = rivals.length ? pick(stories) : "runaway";
    var threat = rivals.length ? pick(rivals) : null; // not always the biggest one
    var jitter = (speeds) => speeds.map((speed) => speed * randomBetween(0.85, 1.15));

    rivals.forEach((jar) => {
      jar.final = randomBetween(0.5, 0.88);
      jar.pace = this.pace(this.randomSpeeds(0.4, 1.6));
    });
    winner.final = 1;
    winner.pace = this.pace(this.randomSpeeds(0.6, 1.4));
    var shouts = [];

    if (story == "comeback") {
      winner.pace = this.pace(jitter([0.4, 0.6, 0.9, 1.4, 1.9]));
      Object.assign(threat, { final: randomBetween(0.95, 0.975), pace: this.pace(jitter([1.8, 1.4, 1, 0.7, 0.4])) });
      shouts.push({ at: randomBetween(0.55, 0.7), text: pick(["COMEBACK?", "HERE IT COMES…", "NOT OVER YET!"]) });
    } else if (story == "runaway") {
      winner.pace = this.pace(jitter([1.9, 1.3, 0.9, 0.7, 0.6]));
      rivals.forEach((jar) => (jar.final = randomBetween(0.55, 0.85)));
      if (threat) Object.assign(threat, { final: randomBetween(0.88, 0.94), pace: this.pace(jitter([0.5, 0.8, 1.1, 1.4, 1.5])) });
      shouts.push({ at: randomBetween(0.5, 0.65), text: pick(["CAN ANYONE CATCH UP?", "WAY AHEAD!", "RUNAWAY!"]) });
    } else if (story == "photo") {
      rivals.slice(0, 3).forEach((jar) => {
        jar.final = randomBetween(0.955, 0.98);
        jar.pace = this.pace(this.randomSpeeds(0.8, 1.2));
      });
      winner.pace = this.pace(this.randomSpeeds(0.8, 1.2));
      shouts.push({ at: randomBetween(0.6, 0.72), text: pick(["NECK AND NECK!", "PHOTO FINISH!", "SO CLOSE…"]) });
    } else if (story == "seesaw") {
      winner.pace = this.pace(jitter([1.6, 0.5, 1.6, 0.5, 1.4]));
      Object.assign(threat, { final: randomBetween(0.96, 0.978), pace: this.pace(jitter([0.6, 1.6, 0.6, 1.6, 0.6])) });
      shouts.push({ at: randomBetween(0.45, 0.6), text: pick(["BACK AND FORTH!", "WHO WILL IT BE?"]) });
    } else {
      winner.pace = this.pace(jitter([0.2, 0.3, 0.6, 1.6, 2.8]));
      rivals.forEach((jar) => {
        jar.final = randomBetween(0.72, 0.95);
        jar.pace = this.pace(jitter([1.6, 1.4, 1.1, 0.8, 0.5]));
      });
      shouts.push({ at: randomBetween(0.6, 0.75), text: pick(["WHAT IS HAPPENING?!", "THE UNDERDOG!", "OUT OF NOWHERE!"]) });
    }
    if (Math.random() < 0.5) shouts.push({ at: randomBetween(0.86, 0.93), text: pick(["ALMOST…", "ONE MORE COIN…", "WAIT FOR IT…"]) });

    // The last coin teases another jar first (if there is one that is almost full)
    var close = rivals.filter((jar) => jar.final > 0.85);
    var decoy = close.length && Math.random() < 0.6 ? pick(close) : null;
    return { story: story, shouts: shouts, decoy: decoy };
  },

  // Straight in, off the rim of another jar, or hovering over another jar first
  async lastCoin(parts, winner, decoy) {
    var spot = this.spot(parts, winner);
    var last = this.coin(parts, spot.x, 26);
    var end = { transform: `translate(-50%, ${spot.surface - 18}px) rotate(720deg)` };
    var way;
    if (decoy == null) {
      way = [
        { transform: "translate(-50%, -40px) rotate(0deg)" },
        { transform: `translate(-50%, ${spot.top - 20}px) rotate(540deg)`, offset: 0.85 },
        end,
      ];
    } else {
      var other = this.spot(parts, decoy);
      var dx = other.x - spot.x;
      if (Math.random() < 0.5) {
        // Hits the rim of the other jar and jumps over
        way = [
          { transform: `translate(calc(-50% + ${dx}px), -40px) rotate(0deg)` },
          { transform: `translate(calc(-50% + ${dx}px), ${other.top - 14}px) rotate(300deg)`, offset: 0.45 },
          { transform: `translate(calc(-50% + ${dx / 2}px), ${Math.min(other.top, spot.top) - 90}px) rotate(500deg)`, offset: 0.7 },
          { transform: `translate(-50%, ${spot.top - 20}px) rotate(640deg)`, offset: 0.9 },
          end,
        ];
      } else {
        // Hangs over the other jar ... and drifts away
        way = [
          { transform: `translate(calc(-50% + ${dx}px), -40px) rotate(0deg)` },
          { transform: `translate(calc(-50% + ${dx}px), ${other.top - 60}px) rotate(200deg)`, offset: 0.4 },
          { transform: `translate(calc(-50% + ${dx}px), ${other.top - 50}px) rotate(260deg)`, offset: 0.6 },
          { transform: `translate(-50%, ${spot.top - 30}px) rotate(560deg)`, offset: 0.88 },
          end,
        ];
      }
    }
    await animate(last, way, { duration: decoy ? 1150 : 850, easing: "cubic-bezier(.4,0,.9,.6)" });
    return last;
  },

  overflow(parts, winner, draw, short) {
    parts.jars.forEach((jar) => jar.column.classList.toggle("lost", jar != winner));
    winner.column.classList.remove("brim");
    winner.column.classList.add("overflow");
    parts.crown.classList.remove("on");
    if (!short) {
      var flash = el("div", "jp-flash");
      parts.root.appendChild(flash);
      animate(flash, [{ opacity: 0.75 }, { opacity: 0 }], { duration: 450 }).then(() => flash.remove());
      animate(parts.root, [-6, 6, -4, 4, 0].map((x) => ({ transform: `translate(${x}px, ${-x / 2}px)` })), { duration: 320, fill: "none" });
      // Coins spill over the rim and roll away
      var spot = this.spot(parts, winner);
      for (var i = 0; i < 30; i++) {
        var side = i % 2 ? 1 : -1;
        var coin = this.coin(parts, spot.x + randomBetween(-spot.half, spot.half) * 0.6);
        var dx = side * randomBetween(30, 170);
        animate(
          coin,
          [
            { transform: `translate(-50%, ${spot.top - 6}px) rotate(0deg)` },
            { transform: `translate(calc(-50% + ${dx * 0.4}px), ${spot.top - randomBetween(30, 90)}px) rotate(${side * 180}deg)`, offset: 0.35 },
            { transform: `translate(calc(-50% + ${dx}px), ${spot.floor - 14}px) rotate(${side * 520}deg)` },
          ],
          { duration: randomBetween(700, 1100), delay: randomBetween(0, 500), easing: "cubic-bezier(.3,.5,.6,1)", fill: "both" },
        ).then(((c) => () => c.remove())(coin));
      }
      // And a gold shower over everything
      var width = parts.root.getBoundingClientRect().width;
      for (var j = 0; j < 45; j++) {
        var drop = this.coin(parts, randomBetween(0, width));
        animate(drop, [{ transform: "translate(-50%, -24px)" }, { transform: `translate(-50%, ${spot.floor + 10}px) rotate(${randomBetween(-400, 400)}deg)` }], {
          duration: randomBetween(700, 1300),
          delay: randomBetween(100, 900),
          easing: "cubic-bezier(.45,0,1,1)",
          fill: "both",
        }).then(((c) => () => c.remove())(drop));
      }
      shout(parts.root, "JACKPOT!", "strike");
      confetti(parts.root);
    }
    winnerLabel(parts.root, draw);
  },
};

/* ---------- 9. Russian roulette: the revolver goes round, the last one wins ---------- */

var revolverDraw = {
  build(stage, winner) {
    var root = scene(stage, "revolver");
    root.replaceChildren();
    var table = el("div", "jp-table");
    var players = playersFor(8, winner);
    var seats = players.map((player, index) => {
      // Around the table, the first player at the top
      var angle = (index / players.length) * Math.PI * 2;
      var seat = el("div", "jp-seat");
      seat.dataset.name = player.name;
      // A little lower, so the top seat stays free of the winner label
      seat.style.left = 50 + Math.sin(angle) * 40 + "%";
      seat.style.top = 56 - Math.cos(angle) * 33 + "%";
      seat.style.setProperty("--share", shareColor(player.name));
      seat.append(createAvatar(player.name), el("span", "jp-seat-name", player.name));
      table.appendChild(seat);
      return seat;
    });
    // The gun: a barrel and a cylinder with six chambers (one bullet per shot)
    var gun = el("div", "jp-gun");
    var barrel = el("div", "jp-barrel");
    var cylinder = el("div", "jp-cylinder");
    for (var i = 0; i < 6; i++) {
      var chamber = el("i", "jp-chamber");
      chamber.style.setProperty("--a", i * 60 + "deg");
      cylinder.appendChild(chamber);
    }
    gun.append(barrel, cylinder);
    table.appendChild(gun);
    root.appendChild(table);
    if (players.length == 0) emptyNote(table, "The players take their seats with the first coins.");
    return { root: root, table: table, seats: seats, gun: gun, cylinder: cylinder, aim: 0, spin: 0 };
  },

  idle(stage) {
    this.build(stage);
  },

  // Angle (clockwise from the top) from the middle of the table to a seat
  angleTo(parts, seat) {
    var table = parts.table.getBoundingClientRect();
    var box = seat.getBoundingClientRect();
    var dx = box.left + box.width / 2 - (table.left + table.width / 2);
    var dy = box.top + box.height / 2 - (table.top + table.height / 2);
    return (Math.atan2(dx, -dy) * 180) / Math.PI;
  },

  // Turns the gun (always clockwise, at least `extra` more turns) to a seat
  aimAt(parts, seat, time, extra) {
    var target = this.angleTo(parts, seat);
    var turn = (((target - parts.aim) % 360) + 360) % 360 + 360 * (extra || 0);
    if (turn < 20) turn += 360;
    parts.aim += turn;
    return animate(parts.gun, [{ transform: `translate(-50%, -50%) rotate(${parts.aim}deg)` }], { duration: time, easing: SLOW_END });
  },

  // The order of the shots: the losers go out one after the other (small shares
  // first, with luck), with empty clicks in between, the final duel is long
  plan(seats, winner) {
    var losers = seats
      .filter((seat) => seat != winner)
      .map((seat) => {
        var entry = state.entries.find((e) => e.name == seat.dataset.name);
        return { seat: seat, order: (entry ? entry.coins / state.total : 0) + Math.random() * 1.2 };
      })
      .sort((a, b) => a.order - b.order)
      .map((item) => item.seat);
    var shots = [];
    var nerves = randomBetween(0.3, 0.8); // how many empty clicks this time
    losers.forEach((loser, index) => {
      var alive = [winner].concat(losers.slice(index));
      if (index == losers.length - 1) {
        // Final duel: click, click, click ... bang
        var clicks = 1 + Math.floor(Math.random() * 5);
        var first = Math.random() < 0.5 ? 0 : 1;
        for (var i = 0; i < clicks; i++) shots.push({ seat: [winner, loser][(first + i) % 2], bang: false, duel: true });
        shots.push({ seat: loser, bang: true, duel: true });
      } else {
        while (Math.random() < nerves && shots.length < 14) shots.push({ seat: alive[Math.floor(Math.random() * alive.length)], bang: false });
        shots.push({ seat: loser, bang: true });
      }
    });
    return shots;
  },

  async play(stage, draw, duration, short) {
    var parts = this.build(stage, draw.winner);
    var winner = parts.seats.find((seat) => seat.dataset.name == draw.winner);
    if (winner == null) return winnerLabel(parts.root, draw);
    var shots = this.plan(parts.seats, winner);

    if (short) {
      shots.filter((shot) => shot.bang).forEach((shot) => shot.seat.classList.add("out"));
      return this.survive(parts, winner, draw, true);
    }

    // The first spin is wild, every shot takes a little longer than the last
    var weights = shots.map((shot, i) => (i == 0 ? randomBetween(1.6, 2.8) : 1 + i * 0.35) * (shot.duel ? 1.5 : 1) * randomBetween(0.7, 1.3));
    var sum = weights.reduce((a, b) => a + b, 0);
    var playTime = duration - 600;
    var duelShouted = false;
    for (var i = 0; i < shots.length; i++) {
      var shot = shots[i];
      var time = (weights[i] / sum) * playTime;
      if (shot.duel && !duelShouted) {
        duelShouted = true;
        shout(parts.root, pick(["FINAL DUEL", "ONE OF YOU...", "LAST TWO"]), "small");
      }
      // Spin the cylinder, aim, wait (the target trembles), pull
      parts.spin += 60 * (i == 0 ? 5 + Math.floor(Math.random() * 6) : 1 + Math.floor(Math.random() * 3));
      animate(parts.cylinder, [{ transform: `translate(-50%, -50%) rotate(${parts.spin}deg)` }], { duration: time * 0.55, easing: SLOW_END });
      // Aim and hold: sometimes a long, nervous hold
      var aim = randomBetween(0.4, 0.65);
      await this.aimAt(parts, shot.seat, time * aim, i == 0 ? Math.round(randomBetween(1, 3)) : 0);
      shot.seat.classList.add("aimed");
      await wait(time * (1 - aim));
      shot.seat.classList.remove("aimed");
      if (shot.bang) this.bang(parts, shot.seat);
      else this.click(parts, shot.seat);
    }
    await wait(450);
    this.survive(parts, winner, draw, false);
  },

  // Empty chamber: a small "click" and a sigh of relief
  click(parts, seat) {
    var label = el("span", "jp-click", "click");
    label.style.left = seat.style.left;
    label.style.top = seat.style.top;
    parts.table.appendChild(label);
    animate(label, [{ transform: "translate(-50%, -150%) scale(0.6)", opacity: 1 }, { transform: "translate(-50%, -260%) scale(1)", opacity: 0 }], {
      duration: 700,
      easing: "ease-out",
    }).then(() => label.remove());
    animate(parts.gun, [{ translate: "0 0" }, { translate: "0 3px" }, { translate: "0 0" }], { duration: 120, fill: "none" });
  },

  bang(parts, seat) {
    var boom = el("span", "jp-boom", "💥");
    boom.style.left = seat.style.left;
    boom.style.top = seat.style.top;
    parts.table.appendChild(boom);
    animate(boom, [{ transform: "translate(-50%, -50%) scale(0.3)", opacity: 1 }, { transform: "translate(-50%, -50%) scale(1.8)", opacity: 0 }], {
      duration: 650,
    }).then(() => boom.remove());
    var flash = el("div", "jp-flash");
    parts.root.appendChild(flash);
    animate(flash, [{ opacity: 0.45 }, { opacity: 0 }], { duration: 250 }).then(() => flash.remove());
    animate(parts.root, [{ transform: "translate(-5px, 2px)" }, { transform: "translate(5px, -2px)" }, { transform: "translate(0, 0)" }], {
      duration: 200,
      fill: "none",
    });
    seat.classList.add("out");
    var mark = el("span", "jp-seat-x", "✖");
    seat.appendChild(mark);
  },

  survive(parts, winner, draw, short) {
    winner.classList.add("champion");
    if (!short) {
      this.aimAt(parts, winner, 900, 1);
      shout(parts.root, pick(["SURVIVED!", "STILL STANDING!", "LUCKY ONE!"]), "strike");
      confetti(parts.root);
    }
    winnerLabel(parts.root, draw);
  },
};

/* ---------- Helpers of the newer draws ---------- */

// A random player, as likely as their share of the pot
function weightedName() {
  var bets = drawBets();
  if (bets.length == 0) return state.entries.length ? state.entries[0].name : "";
  var ticket = Math.random() * state.total;
  return (bets.find((bet) => bet.to > ticket) || bets[bets.length - 1]).name;
}

function shuffled(list) {
  var copy = list.slice();
  for (var i = copy.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = copy[i];
    copy[i] = copy[j];
    copy[j] = t;
  }
  return copy;
}

/* ---------- 10. Slot machine: three of a kind ---------- */

var slotsDraw = {
  build(stage) {
    var root = scene(stage, "slots");
    root.replaceChildren();
    var machine = el("div", "jp-slotm");
    var top = el("div", "jp-slots-top");
    top.append(el("span", "jp-slots-bulbs"), el("span", "jp-slots-title", "JACKPOT"), el("span", "jp-slots-bulbs"));
    var window_ = el("div", "jp-slots-window");
    var reels = [0, 1, 2].map(() => {
      var reel = el("div", "jp-reel");
      var track = el("div", "jp-reel-track");
      reel.appendChild(track);
      window_.appendChild(reel);
      return { reel: reel, track: track };
    });
    window_.appendChild(el("div", "jp-slots-line"));
    var lever = el("div", "jp-slots-lever");
    lever.appendChild(el("span", "jp-slots-knob"));
    machine.append(top, window_, lever);
    root.appendChild(machine);
    return { root: root, machine: machine, reels: reels, lever: lever };
  },

  tile(name) {
    var tile = el("div", "jp-reel-tile");
    tile.dataset.name = name;
    tile.style.setProperty("--share", shareColor(name));
    tile.appendChild(createAvatar(name));
    return tile;
  },

  // A reel with these names; `center` is the one on the line
  show(reel, names, center) {
    reel.track.replaceChildren(...names.map((name) => this.tile(name)));
    var height = reel.track.firstElementChild.offsetHeight;
    reel.track.style.transform = `translateY(${height * (1 - center)}px)`;
    return height;
  },

  idle(stage) {
    var parts = this.build(stage);
    if (state.entries.length == 0) {
      parts.reels.forEach((reel) => reel.track.replaceChildren());
      emptyNote(parts.root, "The faces appear on the reels with the first coins.");
      return;
    }
    var names = state.entries.map((entry) => entry.name);
    parts.reels.forEach((reel, i) => this.show(reel, [0, 1, 2].map((n) => names[(n + i) % names.length]), 1));
  },

  pull(parts) {
    animate(parts.lever, [{ transform: "rotate(0deg)" }, { transform: "rotate(38deg)", offset: 0.35 }, { transform: "rotate(0deg)" }], {
      duration: 700,
      easing: "ease-in-out",
      fill: "none",
    });
  },

  // One spin: every reel stops on its name of `finals`, from left to right
  async spin(parts, finals, time, tease) {
    var spins = parts.reels.map((reel, i) => {
      var count = Math.round(randomBetween(26, 34) + i * 10 + (tease && i == 2 ? 10 : 0));
      var names = [];
      for (var n = 0; n < count; n++) names.push(weightedName());
      var target = count - 2;
      names[target] = finals[i];
      // The faces next to the line: the last ones of the old reel
      var height = this.show(reel, names, 1);
      var from = 0;
      var to = height * (1 - target);
      var reelTime = time * (i == 2 ? 1 : 0.5 + i * 0.22);
      var frames = (i == 2 && tease ? spinEnding(from, to, height) : [{ value: from, offset: 0, easing: SLOW_END }, { value: to, offset: 1 }]).map((f) => ({
        transform: `translateY(${f.value}px)`,
        offset: f.offset,
        easing: f.easing,
      }));
      reel.reel.classList.add("spinning");
      return animate(reel.track, frames, { duration: reelTime }).then(() => {
        reel.reel.classList.remove("spinning");
        reel.track.style.transform = `translateY(${to}px)`;
        reel.track.getAnimations().forEach((a) => a.cancel());
        var landed = reel.track.children[target];
        landed.classList.add("landed");
        return landed;
      });
    });
    return Promise.all(spins);
  },

  async play(stage, draw, duration, short) {
    var parts = this.build(stage);
    var winner = draw.winner;
    if (short) {
      var names = state.entries.map((entry) => entry.name);
      parts.reels.forEach((reel) => this.show(reel, [pick(names), winner, pick(names)], 1).toString());
      parts.reels.forEach((reel) => reel.track.children[1].classList.add("win"));
      return winnerLabel(parts.root, draw);
    }
    var others = state.entries.map((entry) => entry.name).filter((name) => name != winner);
    var rival = others.length ? pick(others) : winner;
    var story = pick(["tease", "tease", "respin", "straight"]);
    var time = duration - 700;

    if (story == "respin" && rival != winner) {
      // First pull: so close - two of a kind, the third one doesn't fit
      this.pull(parts);
      var first = time * 0.38;
      await this.spin(parts, [rival, rival, winner], first, false);
      shout(parts.root, pick(["SO CLOSE!", "ALMOST!", "NOT YET..."]), "small");
      await wait(700);
      time = time - first - 700;
    }
    this.pull(parts);
    // Two in a row: the last reel takes its time
    if (story != "straight") setTimeout(() => shout(parts.root, pick(["TWO IN A ROW...", "ONE MORE...", "COME ON..."]), "small"), time * 0.78);
    var landed = await this.spin(parts, [winner, winner, winner], time, story != "straight");
    landed.forEach((tile) => tile.classList.add("win"));
    parts.machine.classList.add("jackpot");
    shout(parts.root, pick(["JACKPOT!", "777!", "THREE OF A KIND!"]), "strike");
    confetti(parts.root);
    winnerLabel(parts.root, draw);
  },
};

/* ---------- 11. Space launch: only one rocket reaches orbit ---------- */

var launchDraw = {
  build(stage, winner) {
    var root = scene(stage, "launch");
    root.replaceChildren();
    var sky = el("div", "jp-launch");
    for (var i = 0; i < 28; i++) {
      var star = el("i", "jp-star");
      star.style.left = randomBetween(0, 100) + "%";
      star.style.top = randomBetween(0, 70) + "%";
      star.style.animationDelay = randomBetween(0, 3) + "s";
      sky.appendChild(star);
    }
    sky.appendChild(el("div", "jp-orbit", "ORBIT"));
    var players = playersFor(6, winner);
    var rockets = players.map((player) => {
      var lane = el("div", "jp-launch-lane");
      var rocket = el("div", "jp-rocket");
      rocket.dataset.name = player.name;
      rocket.style.setProperty("--share", shareColor(player.name));
      var ship = el("span", "jp-rocket-ship", "🚀");
      rocket.append(el("span", "jp-rocket-flame"), ship, createAvatar(player.name, "sm"));
      lane.append(rocket, el("span", "jp-launch-pad", Math.round((player.coins / state.total) * 100) + "%"));
      sky.appendChild(lane);
      return rocket;
    });
    root.appendChild(sky);
    if (players.length == 0) emptyNote(sky, "Every player gets a rocket on the launch pad.");
    return { root: root, sky: sky, rockets: rockets };
  },

  idle(stage) {
    this.build(stage);
  },

  // Height a rocket can fly (to the orbit line)
  ceiling(parts, rocket) {
    return rocket.parentElement.clientHeight - rocket.offsetHeight - 34;
  },

  async play(stage, draw, duration, short) {
    var parts = this.build(stage, draw.winner);
    var winner = parts.rockets.find((rocket) => rocket.dataset.name == draw.winner);
    if (winner == null) return winnerLabel(parts.root, draw);
    var losers = parts.rockets.filter((rocket) => rocket != winner);
    if (short) {
      losers.forEach((rocket) => rocket.classList.add("lost"));
      winner.classList.add("orbit");
      winner.style.transform = `translateY(${-this.ceiling(parts, winner)}px)`;
      return winnerLabel(parts.root, draw);
    }

    // 3, 2, 1 ...
    var count = 0;
    for (var n of ["3", "2", "1"]) {
      shout(parts.root, n, "small");
      await wait(380);
      count += 380;
    }
    shout(parts.root, "LIFTOFF!", "small");
    parts.sky.classList.add("flying");
    var flight = duration - count - 600;

    // When which rocket fails: spread over the flight, the last one just before the orbit
    var story = pick(["close", "close", "chaos", "fizzle"]);
    var order = shuffled(losers);
    var fails = order.map((_, i) => {
      if (story == "chaos" && i < order.length - 1) return randomBetween(0.12, 0.45);
      return 0.2 + (0.7 * (i + 1)) / order.length + randomBetween(-0.05, 0.03);
    });
    if (order.length) fails[fails.length - 1] = story == "close" ? randomBetween(0.86, 0.93) : Math.max(fails[fails.length - 1], 0.7);

    var flights = parts.rockets.map((rocket) => {
      rocket.classList.add("burning");
      var top = this.ceiling(parts, rocket);
      // Random thrust in every part: they overtake each other
      var speeds = [];
      for (var i = 0; i < 6; i++) speeds.push(randomBetween(0.6, 1.5));
      var reach = rocket == winner ? 1 : randomBetween(0.85, 1.05);
      if (rocket == order[order.length - 1] && story == "close") speeds = speeds.map((v, i) => v * (1.5 - i * 0.12));
      var sum = speeds.reduce((a, b) => a + b, 0);
      var height = 0;
      var frames = [{ transform: "translateY(0px)", offset: 0 }];
      speeds.forEach((speed, i) => {
        height += (speed / sum) * reach;
        frames.push({ transform: `translateY(${-Math.min(1, height) * top}px)`, offset: (i + 1) / speeds.length });
      });
      return rocket.animate(frames, { duration: flight, easing: "cubic-bezier(0.45, 0.05, 0.55, 0.95)", fill: "forwards" });
    });

    order.forEach((rocket, i) => {
      setTimeout(() => {
        var flightAnimation = flights[parts.rockets.indexOf(rocket)];
        flightAnimation.pause();
        var fizzle = story == "fizzle" && i % 2 == 0;
        this.fail(parts, rocket, fizzle);
        if (i == order.length - 1 && story == "close") shout(parts.root, pick(["SO CLOSE!", "HOUSTON...", "NOOO!"]), "small");
      }, flight * fails[i]);
    });
    if (story == "chaos") setTimeout(() => shout(parts.root, pick(["MAYDAY!", "CHAOS!"]), "small"), flight * 0.3);

    await flights[parts.rockets.indexOf(winner)].finished.catch(() => {});
    winner.classList.remove("burning");
    winner.classList.add("orbit");
    shout(parts.root, pick(["ORBIT!", "TO THE MOON!", "WE HAVE LIFTOFF!"]), "strike");
    confetti(parts.root);
    winnerLabel(parts.root, draw);
  },

  // A rocket fails: it explodes, or the engine dies and it falls back
  fail(parts, rocket, fizzle) {
    rocket.classList.remove("burning");
    if (fizzle) {
      var now = new DOMMatrixReadOnly(getComputedStyle(rocket).transform).m42;
      rocket.getAnimations().forEach((a) => a.cancel());
      rocket.style.transform = `translateY(${now}px)`;
      animate(rocket, [{ transform: `translateY(${now}px) rotate(0deg)` }, { transform: "translateY(0px) rotate(160deg)", opacity: 0.35 }], {
        duration: 1200,
        easing: "cubic-bezier(0.5, 0, 1, 1)",
      }).then(() => rocket.classList.add("lost"));
      return;
    }
    var boom = el("span", "jp-boom", "💥");
    rocket.appendChild(boom);
    animate(boom, [{ transform: "translate(-50%, -50%) scale(0.3)", opacity: 1 }, { transform: "translate(-50%, -50%) scale(2)", opacity: 0 }], { duration: 700 }).then(() =>
      boom.remove(),
    );
    animate(parts.root, [{ transform: "translate(-4px, 2px)" }, { transform: "translate(4px, -2px)" }, { transform: "translate(0, 0)" }], { duration: 180, fill: "none" });
    rocket.classList.add("lost");
  },
};

/* ---------- 12. Scratch card: the first to match three wins ---------- */

var scratchDraw = {
  build(stage) {
    var root = scene(stage, "scratch");
    root.replaceChildren();
    var card = el("div", "jp-scratch");
    var head = el("div", "jp-scratch-head");
    head.append(el("span", "", "🍀 LUCKY CARD"), el("span", "jp-scratch-rule", "Match 3 to win"));
    var grid = el("div", "jp-scratch-grid");
    var fields = [];
    for (var i = 0; i < 9; i++) {
      var field = el("div", "jp-scratch-field");
      var foil = el("div", "jp-scratch-foil");
      foil.appendChild(el("span", "", "?"));
      field.appendChild(foil);
      grid.appendChild(field);
      fields.push(field);
    }
    var coin = el("span", "jp-scratch-coin", "🪙");
    card.append(head, grid, coin);
    root.appendChild(card);
    return { root: root, card: card, fields: fields, coin: coin };
  },

  idle(stage) {
    var parts = this.build(stage);
    if (state.entries.length == 0) emptyNote(parts.root, "The faces hide under the foil.");
  },

  // What is under the fields, in the order they are scratched: the winner's
  // third face comes last, nobody else gets more than two
  plan(winner) {
    var others = shuffled(state.entries.map((entry) => entry.name).filter((name) => name != winner));
    var pool = [];
    others.forEach((name) => pool.push(name, name));
    var most = Math.min(6, pool.length);
    var rivals = shuffled(pool).slice(0, Math.round(randomBetween(Math.min(3, most), most)));
    var order = shuffled(rivals.concat([winner, winner]));
    // A rival on two before the end: who gets the third one?
    order.push(winner);
    return order;
  },

  async scratch(parts, field, time) {
    var foil = field.querySelector(".jp-scratch-foil");
    var x = field.offsetLeft;
    var y = field.offsetTop;
    var w = field.offsetWidth;
    var h = field.offsetHeight;
    var coin = parts.coin;
    coin.style.opacity = 1;
    // Zig-zag over the field, the foil goes with it
    animate(
      coin,
      [
        { transform: `translate(${x}px, ${y}px)` },
        { transform: `translate(${x + w * 0.8}px, ${y + h * 0.15}px)` },
        { transform: `translate(${x}px, ${y + h * 0.45}px)` },
        { transform: `translate(${x + w * 0.8}px, ${y + h * 0.6}px)` },
        { transform: `translate(${x + w * 0.1}px, ${y + h * 0.8}px)` },
      ],
      { duration: time, easing: "linear" },
    );
    await animate(
      foil,
      [
        { clipPath: "inset(0 0 0 0)", opacity: 1 },
        { clipPath: "inset(30% 0 0 0)", opacity: 1, offset: 0.3 },
        { clipPath: "inset(60% 0 0 0)", opacity: 0.9, offset: 0.65 },
        { clipPath: "inset(100% 0 0 0)", opacity: 0.6 },
      ],
      { duration: time, easing: "linear" },
    );
    foil.remove();
  },

  async play(stage, draw, duration, short) {
    var parts = this.build(stage);
    var order = this.plan(draw.winner);
    var cells = shuffled(parts.fields).slice(0, order.length);
    cells.forEach((field, i) => {
      var face = el("div", "jp-scratch-face");
      face.style.setProperty("--share", shareColor(order[i]));
      face.dataset.name = order[i];
      face.append(createAvatar(order[i]));
      field.insertBefore(face, field.firstChild);
    });
    var mark = () => cells.filter((field) => field.firstChild.dataset.name == draw.winner).forEach((field) => field.classList.add("match"));
    if (short) {
      cells.forEach((field) => field.querySelector(".jp-scratch-foil").remove());
      mark();
      return winnerLabel(parts.root, draw);
    }
    // Slower and slower, the last field very slowly
    var weights = order.map((_, i) => (i == order.length - 1 ? 2.6 : 1 + i * 0.08));
    var sum = weights.reduce((a, b) => a + b, 0);
    var time = duration - 600;
    var counts = {};
    var tense = false;
    for (var i = 0; i < order.length; i++) {
      var name = order[i];
      await this.scratch(parts, cells[i], ((weights[i] / sum) * time) * 0.82);
      counts[name] = (counts[name] || 0) + 1;
      if (counts[name] == 2) cells.filter((field, n) => n <= i && field.firstChild.dataset.name == name).forEach((field) => field.classList.add("two"));
      // Two players on two: the next face decides
      var onTwo = Object.keys(counts).filter((key) => counts[key] == 2).length;
      if (!tense && onTwo >= 2 && i < order.length - 1) {
        tense = true;
        shout(parts.root, pick(["WHO GETS THREE?", "NECK AND NECK!"]), "small");
      }
      await wait(((weights[i] / sum) * time) * 0.18);
    }
    parts.coin.style.opacity = 0;
    mark();
    shout(parts.root, pick(["MATCH 3!", "WINNER!", "LUCKY!"]), "strike");
    confetti(parts.root);
    winnerLabel(parts.root, draw);
  },
};

/* ---------- 13. Ghost hunt: lights out, the last one left wins ---------- */

var ghostHuntDraw = {
  build(stage, winner) {
    var root = scene(stage, "ghosthunt");
    root.replaceChildren();
    var room = el("div", "jp-haunt");
    var players = playersFor(8, winner);
    var columns = Math.ceil(players.length / 2) || 1;
    var hiders = players.map((player, index) => {
      var hider = el("div", "jp-hider");
      hider.dataset.name = player.name;
      hider.style.setProperty("--share", shareColor(player.name));
      // Two rows, a bit out of line (the same places while the pot doesn't change)
      var column = Math.floor(index / 2);
      var row = index % 2;
      var jitter = ((index * 37) % 9) - 4;
      hider.style.left = ((column + 0.5) / columns) * 84 + 8 + jitter * 0.6 + "%";
      hider.style.top = (row ? 70 : 36) + jitter + "%";
      hider.append(createAvatar(player.name), el("span", "jp-hider-name", player.name));
      room.appendChild(hider);
      return hider;
    });
    var light = el("div", "jp-flashlight");
    room.appendChild(light);
    root.appendChild(room);
    if (players.length == 0) emptyNote(room, "Somebody has to be in the dark house first...");
    return { root: root, room: room, hiders: hiders, light: light, x: room.clientWidth / 2, y: room.clientHeight / 2 };
  },

  idle(stage) {
    var parts = this.build(stage);
    parts.light.classList.add("wander");
    this.place(parts, parts.x, parts.y);
  },

  place(parts, x, y) {
    parts.x = x;
    parts.y = y;
    parts.light.style.transform = `translate(${x}px, ${y}px)`;
  },

  // The light moves to a point (over a curve, a bit nervous)
  async move(parts, x, y, time) {
    var from = { x: parts.x, y: parts.y };
    var mid = { x: (from.x + x) / 2 + randomBetween(-60, 60), y: (from.y + y) / 2 + randomBetween(-40, 40) };
    parts.x = x;
    parts.y = y;
    await animate(
      parts.light,
      [{ transform: `translate(${from.x}px, ${from.y}px)` }, { transform: `translate(${mid.x}px, ${mid.y}px)`, offset: 0.55 }, { transform: `translate(${x}px, ${y}px)` }],
      { duration: time, easing: "ease-in-out" },
    );
    parts.light.style.transform = `translate(${x}px, ${y}px)`;
    parts.light.getAnimations().forEach((a) => a.cancel());
  },

  at(hider) {
    return { x: hider.offsetLeft, y: hider.offsetTop };
  },

  take(parts, hider) {
    var ghost = el("span", "jp-ghost", "👻");
    ghost.style.left = hider.style.left;
    ghost.style.top = hider.style.top;
    parts.room.appendChild(ghost);
    animate(ghost, [{ transform: "translate(-50%, -20%) scale(0.3)", opacity: 0 }, { transform: "translate(-50%, -90%) scale(1.3)", opacity: 1, offset: 0.4 }, { transform: "translate(-50%, -160%) scale(1)", opacity: 0 }], {
      duration: 1100,
      easing: "ease-out",
    }).then(() => ghost.remove());
    var boo = el("span", "jp-boo", "BOO!");
    boo.style.left = hider.style.left;
    boo.style.top = hider.style.top;
    parts.room.appendChild(boo);
    animate(boo, [{ transform: "translate(-50%, -50%) scale(0.5)", opacity: 1 }, { transform: "translate(-50%, -180%) scale(1.2)", opacity: 0 }], { duration: 900 }).then(() => boo.remove());
    hider.classList.add("taken");
  },

  async play(stage, draw, duration, short) {
    var parts = this.build(stage, draw.winner);
    var winner = parts.hiders.find((hider) => hider.dataset.name == draw.winner);
    if (winner == null) return winnerLabel(parts.root, draw);
    var losers = shuffled(parts.hiders.filter((hider) => hider != winner));
    if (short) {
      losers.forEach((hider) => hider.classList.add("taken"));
      parts.room.classList.add("lit");
      winner.classList.add("survivor");
      return winnerLabel(parts.root, draw);
    }
    this.place(parts, parts.room.clientWidth / 2, -40);
    shout(parts.root, pick(["LIGHTS OUT...", "WHO'S THERE?"]), "small");
    var story = pick(["steady", "flicker", "flicker", "double"]);
    var steps = losers.map((hider) => [hider]);
    // Two at once: the ghost takes a pair
    if (story == "double" && steps.length >= 3) {
      var pair = steps.splice(1, 2);
      steps.splice(1, 0, pair[0].concat(pair[1]));
    }
    var time = duration - 1300;
    var weights = steps.map((_, i) => 1 + i * 0.25).concat([1.4]);
    var sum = weights.reduce((a, b) => a + b, 0);
    var flickerAt = story == "flicker" ? Math.floor(randomBetween(0, steps.length)) : -1;
    for (var i = 0; i < steps.length; i++) {
      var stepTime = (weights[i] / sum) * time;
      var targets = steps[i];
      // First past somebody else (phew), then to the one the ghost takes
      var decoys = parts.hiders.filter((hider) => !hider.classList.contains("taken") && !targets.includes(hider));
      if (decoys.length && Math.random() < 0.6) {
        var decoy = this.at(pick(decoys));
        await this.move(parts, decoy.x, decoy.y, stepTime * 0.3);
        await wait(stepTime * 0.08);
      }
      var spot = this.at(targets[0]);
      await this.move(parts, spot.x, spot.y, stepTime * 0.32);
      if (i == flickerAt) {
        // The light dies for a moment - and somebody is gone
        parts.room.classList.add("blackout");
        await wait(Math.min(700, stepTime * 0.25));
        targets.forEach((hider) => hider.classList.add("taken"));
        parts.room.classList.remove("blackout");
        shout(parts.root, pick(["GONE!", "WHERE DID THEY GO?"]), "small");
        await wait(stepTime * 0.1);
      } else {
        await wait(stepTime * 0.15);
        targets.forEach((hider) => this.take(parts, hider));
        if (targets.length > 1) shout(parts.root, "DOUBLE BOO!", "small");
        await wait(stepTime * 0.2);
      }
    }
    // The last one in the light - then the lights go on
    var last = this.at(winner);
    await this.move(parts, last.x, last.y, (weights[weights.length - 1] / sum) * time * 0.6);
    await wait(300);
    parts.room.classList.add("lit");
    winner.classList.add("survivor");
    shout(parts.root, pick(["SURVIVED!", "NOT AFRAID!", "LAST ONE STANDING!"]), "strike");
    confetti(parts.root);
    winnerLabel(parts.root, draw);
  },
};

var DRAWS = {
  coinrain: coinRainDraw,
  revolver: revolverDraw,
  claw: clawDraw,
  royale: royaleDraw,
  wheel: wheelDraw,
  roulette: rouletteDraw,
  bowling: bowlingDraw,
  plinko: plinkoDraw,
  race: raceDraw,
  slots: slotsDraw,
  launch: launchDraw,
  scratch: scratchDraw,
  ghosthunt: ghostHuntDraw,
};
