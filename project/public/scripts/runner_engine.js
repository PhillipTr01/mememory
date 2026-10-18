/*
 * The runner (Subway Surfers like): one engine for the page and the server. The page plays it live, the
 * server plays the same run again from its seed and the inputs the page sent (a tick and a move each) -
 * and pays what its own replay says. So everything here is deterministic: a seeded random number
 * generator, a fixed 60 ticks a second, only + - * / (the same on every browser and on the server).
 *
 * Three lanes, the runner always runs forward and gets faster. Rows of obstacles come: a train (change the
 * lane), a low barrier (jump), a high bar (roll under it). Coins on the free lanes add a little.
 */
(function (root) {
  var TPS = 60; // ticks a second
  var V0 = 11; // m/s at the start ...
  var ACC = 0.15; // ... and this much faster every second
  var VMAX = 38;
  var LANE_TICKS = 9; // one lane over
  var JUMP_TICKS = 40;
  var JUMP_HEIGHT = 1.3; // m
  var CLEAR_LOW = 0.6; // a low barrier: this high in the air at least
  var ROLL_TICKS = 40;
  var START = 45; // m without anything at the start
  var GAP = [16, 30]; // m between two rows
  var HIT_WIDTH = 0.55; // of a lane: closer to a lane's middle than this - in it
  var DEPTH = 1; // m: a barrier, a bar
  var COIN_SCORE = 2; // a coin: this many points (a meter: 1)
  var COIN_GAP = 2.5; // m between the coins of a line
  var MAX_TICKS = TPS * 60 * 15; // a run never goes longer (15 minutes)
  var KINDS = ["train", "low", "high"];

  // A small seeded random number generator (mulberry32 - integers only)
  function random(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function create(seed) {
    return {
      rng: random(seed),
      tick: 0,
      z: 0, // m run
      speed: V0,
      lane: 1, // where the runner goes (0 - 2)
      x: 1, // where it is (between two lanes while changing)
      jump: 0, // ticks of a jump done (0: on the ground)
      roll: 0, // ticks of a roll done (0: not rolling)
      rows: [], // {z, lanes: [{kind, z0, z1} | null x3]} - only the ones ahead (and just behind)
      coins: [], // {z, lane, taken}
      next: START, // z of the next row
      taken: 0,
      dead: false,
      cause: null,
    };
  }

  // The next row of obstacles: one to three lanes blocked - never three trains, always a way through
  function addRow(run) {
    var rng = run.rng;
    var z = run.next;
    var gap = GAP[0] + rng() * (GAP[1] - GAP[0]);
    var r = rng();
    var blocked = r < 0.4 ? 1 : r < 0.9 ? 2 : 3;
    var order = [0, 1, 2];
    for (var i = 2; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = order[i];
      order[i] = order[j];
      order[j] = t;
    }
    var lanes = [null, null, null];
    var trains = 0;
    // (a train ends early enough before the next row to get around it at this speed)
    var free = 4 + run.speed * 0.4;
    for (var k = 0; k < blocked; k++) {
      var p = rng();
      var kind = p < 0.45 ? "train" : p < 0.75 ? "low" : "high";
      if (kind === "train" && (trains === 2 || (blocked === 3 && trains === 1))) kind = rng() < 0.5 ? "low" : "high";
      if (kind === "train") trains++;
      var length = kind === "train" ? Math.max(6, Math.min(30, 8 + rng() * 22, gap - free)) : DEPTH;
      lanes[order[k]] = { kind: kind, z0: z, z1: z + length };
    }
    run.rows.push({ z: z, lanes: lanes });
    // Coins: a line on a free lane now and then
    if (rng() < 0.55) {
      var open = [0, 1, 2].filter(function (lane) {
        return lanes[lane] == null;
      });
      if (open.length) {
        var lane = open[Math.floor(rng() * open.length)];
        for (var c = 0; c < 5; c++) run.coins.push({ z: z - 4 + c * COIN_GAP, lane: lane, taken: false });
      }
    }
    run.next = z + gap;
  }

  // How high the runner is in a jump (m)
  function height(run) {
    if (!run.jump) return 0;
    var k = run.jump;
    return (4 * JUMP_HEIGHT * k * (JUMP_TICKS - k)) / (JUMP_TICKS * JUMP_TICKS);
  }

  // One tick: the move of the player now (or null) - then the run goes on
  function step(run, move) {
    if (run.dead) return run;
    if (move === "L" && run.lane > 0) run.lane--;
    else if (move === "R" && run.lane < 2) run.lane++;
    else if (move === "J" && !run.jump) {
      run.jump = 1;
      run.roll = 0;
    } else if (move === "D") {
      // (rolling in the air: straight down)
      run.jump = 0;
      run.roll = 1;
    }
    run.tick++;
    run.speed = Math.min(VMAX, V0 + (ACC * run.tick) / TPS);
    run.z += run.speed / TPS;
    if (run.x < run.lane) run.x = Math.min(run.lane, run.x + 1 / LANE_TICKS);
    else if (run.x > run.lane) run.x = Math.max(run.lane, run.x - 1 / LANE_TICKS);
    if (run.jump) run.jump = run.jump >= JUMP_TICKS ? 0 : run.jump + 1;
    if (run.roll) run.roll = run.roll >= ROLL_TICKS ? 0 : run.roll + 1;
    while (run.next < run.z + 120) addRow(run);
    // What the runner meets
    var h = height(run);
    for (var i = 0; i < run.rows.length && !run.dead; i++) {
      var row = run.rows[i];
      for (var lane = 0; lane < 3; lane++) {
        var o = row.lanes[lane];
        if (!o || run.z < o.z0 || run.z > o.z1) continue;
        if (Math.abs(run.x - lane) >= HIT_WIDTH) continue;
        if (o.kind === "low" && h > CLEAR_LOW) continue;
        if (o.kind === "high" && run.roll) continue;
        run.dead = true;
        run.cause = o.kind;
        break;
      }
    }
    for (var c = 0; c < run.coins.length; c++) {
      var coin = run.coins[c];
      if (!coin.taken && Math.abs(run.z - coin.z) < 0.8 && Math.abs(run.x - coin.lane) < HIT_WIDTH && h < 1) {
        coin.taken = true;
        run.taken++;
      }
    }
    // (what is behind: gone)
    while (run.rows.length && run.rows[0].z + 32 < run.z) run.rows.shift();
    while (run.coins.length && run.coins[0].z + 4 < run.z) run.coins.shift();
    if (run.tick >= MAX_TICKS) {
      run.dead = true;
      run.cause = "time";
    }
    return run;
  }

  function score(run) {
    return Math.floor(run.z) + COIN_SCORE * run.taken;
  }

  /*
   * The server's replay: the run of `seed` with the moves [[tick, move], ...] (ticks going up) - until the
   * runner falls or `limit` ticks (a run that claims more than the time it took: on from there without moves)
   * -> {ticks, distance, coins, score, cause}
   */
  function replay(seed, moves, limit) {
    var run = create(seed);
    var at = 0;
    var last = limit == null ? MAX_TICKS : Math.min(MAX_TICKS, limit);
    while (!run.dead) {
      var move = null;
      // (one move a tick - more on the same tick: the next ones are lost)
      while (at < moves.length && moves[at][0] < run.tick) at++;
      if (at < moves.length && moves[at][0] === run.tick && run.tick < last) {
        move = moves[at][1];
        at++;
      }
      step(run, move);
    }
    return { ticks: run.tick, distance: Math.floor(run.z), coins: run.taken, score: score(run), cause: run.cause };
  }

  // Moves as the page sends them: checked, in order - anything else is dropped
  function cleanMoves(moves) {
    if (!Array.isArray(moves)) return [];
    var out = [];
    var last = -1;
    for (var i = 0; i < moves.length && out.length < 20000; i++) {
      var m = moves[i];
      if (!Array.isArray(m) || !Number.isInteger(m[0]) || m[0] < 0 || m[0] > MAX_TICKS || "LRJD".indexOf(m[1]) < 0 || m[1].length !== 1) continue;
      if (m[0] <= last) continue;
      out.push([m[0], m[1]]);
      last = m[0];
    }
    return out;
  }

  var api = { TPS: TPS, V0: V0, VMAX: VMAX, JUMP_TICKS: JUMP_TICKS, ROLL_TICKS: ROLL_TICKS, LANE_TICKS: LANE_TICKS, JUMP_HEIGHT: JUMP_HEIGHT, COIN_SCORE: COIN_SCORE, MAX_TICKS: MAX_TICKS, KINDS: KINDS, create: create, step: step, height: height, score: score, replay: replay, cleanMoves: cleanMoves };
  if (typeof module !== "undefined") module.exports = api;
  else root.RunnerEngine = api;
})(this);
