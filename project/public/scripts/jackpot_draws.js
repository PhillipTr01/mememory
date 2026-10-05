/*
 * The five ways to show who wins the jackpot. Only the show is different:
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
    var turns = short ? 1 : 3;
    await animate(wheel, [{ transform: "rotate(0deg)" }, { transform: `rotate(${turns * 360 - target}deg)` }], {
      duration: duration,
      easing: "cubic-bezier(0.3, 0.35, 0.2, 1)",
    });
    wheel.style.transform = `rotate(${turns * 360 - target}deg)`;
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
    var count = 64;
    var target = 56;
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
    await animate(track, [{ transform: "translateX(0)" }, { transform: `translateX(${end}px)` }], {
      duration: duration,
      easing: "cubic-bezier(0.1, 0.7, 0.15, 1)",
    });
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
      shout(root, "READY?", "small");
      await animate(
        ball,
        [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ transform: `translate(${i % 2 ? -3 : 3}px, ${i % 3 ? 2 : -2}px) scale(${1 + i * 0.02})` })),
        { duration: 1200 * t, easing: "linear" },
      );
      lane.classList.remove("charging");
      shout(root, "GO!", "small");
    }

    // 2. The roll: fast, then slow motion right before the pins (and zoom)
    var laneWidth = lane.clientWidth;
    var roll = animate(
      ball,
      [
        { transform: "translateX(0) rotate(0deg)" },
        { transform: `translateX(${laneWidth * 0.48}px) rotate(900deg)`, offset: 0.45 },
        { transform: `translateX(${laneWidth * 0.6}px) rotate(1100deg)`, offset: 0.85 },
        { transform: `translateX(${laneWidth * 0.66}px) rotate(1180deg)` },
      ],
      { duration: 2600 * t, easing: "ease-in" },
    );
    lane.classList.add("rolling");
    setTimeout(() => lane.classList.add("zoom"), 1300 * t);
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
    others.forEach((pin) => {
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
        { duration: 1500 * t + 300, easing: "ease-in-out" },
      );
      winnerPin.classList.add("standing");
    }
    lane.classList.remove("zoom");
    if (!short) {
      shout(root, "STRIKE!", "strike");
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
    var startX = width / 2 + randomBetween(-20, 20);
    var rowHeight = height * 0.09;
    var frames = [{ transform: `translate(${startX}px, 0px)`, offset: 0 }];
    var steps = this.ROWS + 1;
    var x = startX;
    for (var row = 0; row <= this.ROWS; row++) {
      // Bounce from peg to peg, a bit random, but always closer to the target
      var progress = (row + 1) / steps;
      var wanted = startX + (targetX - startX) * progress;
      var jitter = (1 - progress) * width * 0.09;
      var next = row == this.ROWS ? targetX : wanted + randomBetween(-jitter, jitter);
      var y = height * 0.12 + row * rowHeight;
      // Small hop up after each peg
      frames.push({ transform: `translate(${(x + next) / 2}px, ${y - rowHeight * 0.35}px)`, offset: (row + 0.5) / (steps + 1) });
      frames.push({ transform: `translate(${next}px, ${y}px)`, offset: (row + 1) / (steps + 1) });
      x = next;
    }
    frames.push({ transform: `translate(${targetX}px, ${height * 0.9}px)`, offset: 1 });
    await animate(parts.ball, frames, { duration: duration, easing: "ease-in" });

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
    var animations = parts.runners.map((runner) => {
      var isWinner = runner.dataset.name == draw.winner;
      var end = isWinner ? 1 : randomBetween(0.86, 0.985);
      var speeds = [];
      for (var i = 0; i < 8; i++) speeds.push(randomBetween(0.6, 1.4));
      var sum = speeds.reduce((a, b) => a + b, 0);
      var position = 0;
      var frames = [{ transform: "translateX(0px)", offset: 0 }];
      speeds.forEach((speed, index) => {
        position += (speed / sum) * end;
        frames.push({ transform: `translateX(${position * laneWidth}px)`, offset: (index + 1) / speeds.length });
      });
      if (isWinner) finishers.push(runner);
      return animate(runner, frames, { duration: raceTime, easing: "linear" });
    });
    // The last moment: the photo finish (the track gets darker at the edges)
    setTimeout(() => parts.track.classList.add("photo"), raceTime * 0.82);
    await Promise.all(animations);
    parts.track.classList.remove("photo");
    finishers.forEach((runner) => runner.parentElement.classList.add("won"));
    if (!short) {
      var flash = el("div", "jp-flash");
      root.appendChild(flash);
      animate(flash, [{ opacity: 0.8 }, { opacity: 0 }], { duration: 400 }).then(() => flash.remove());
      shout(root, "PHOTO FINISH!", "strike");
      confetti(root);
    }
    winnerLabel(root, draw);
  },
};

var DRAWS = {
  wheel: wheelDraw,
  roulette: rouletteDraw,
  bowling: bowlingDraw,
  plinko: plinkoDraw,
  race: raceDraw,
};
