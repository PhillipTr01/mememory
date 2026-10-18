const { test, before, after } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const config = require("../game/config");
const engine = require("../public/scripts/runner_engine");
const runner = require("../game/runner");

/* ---------- The engine ---------- */

// A careful player: sees the next row in time, picks a lane it can pass (a free one best), jumps or rolls at the
// right moment
function autoPlay(seed) {
  const run = engine.create(seed);
  const moves = [];
  const handled = new Set();
  let plan = [];
  while (!run.dead) {
    let move = null;
    if (plan.length && plan[0].tick <= run.tick) move = plan.shift().move;
    if (!move) {
      const row = run.rows.find((r) => Math.max(...r.lanes.map((o) => (o ? o.z1 : r.z))) >= run.z);
      if (row && !handled.has(row.z) && row.z - run.z <= run.speed * 1.2 + 6) {
        handled.add(row.z);
        const passable = (l) => !row.lanes[l] || row.lanes[l].kind !== "train";
        const cost = (l) => (row.lanes[l] == null ? 0 : 1) + Math.abs(l - run.lane) * 0.6;
        const target = [0, 1, 2].filter(passable).sort((a, b) => cost(a) - cost(b))[0];
        let t = run.tick + 3;
        for (let lane = run.lane; lane !== target; lane += target > lane ? 1 : -1) {
          plan.push({ tick: t, move: target > run.lane ? "R" : "L" });
          t += 2;
        }
        const o = row.lanes[target];
        if (o) {
          const lead = o.kind === "low" ? (engine.JUMP_TICKS / 2 / engine.TPS) * run.speed : 0.25 * run.speed;
          plan.push({ tick: Math.max(t, run.tick + Math.max(1, Math.round(((row.z - run.z - lead) / run.speed) * engine.TPS))), move: o.kind === "low" ? "J" : "D" });
        }
        plan = plan.sort((a, b) => a.tick - b.tick);
      }
    }
    if (move) moves.push([run.tick, move]);
    engine.step(run, move);
  }
  return { run, moves };
}

test("runner engine: the same seed and moves make the same run - the server's replay is the run the page played", () => {
  const { run, moves } = autoPlay(12345);
  assert.ok(run.dead);
  const again = engine.replay(12345, moves);
  assert.deepStrictEqual([again.ticks, again.score, again.coins], [run.tick, engine.score(run), run.taken]);
  // (another seed: another track)
  assert.notStrictEqual(engine.replay(999, moves).score, again.score);
  // No moves: straight on until the first thing in the way
  const lazy = engine.replay(12345, []);
  assert.ok(lazy.ticks < run.tick && lazy.distance >= 45);
});

test("runner engine: every row leaves a way through - a careful player gets far, the track gets faster", () => {
  for (const seed of [7, 8, 9]) {
    const { run } = autoPlay(seed);
    assert.ok(engine.score(run) > 800, `seed ${seed}: ${engine.score(run)} (${run.cause})`);
    assert.ok(run.speed > engine.V0 + 5);
  }
  // Never three trains in a row: at least one lane to pass - never two low barriers in a lane too close for two jumps
  // (a runner that can't fall, through a long track)
  const run = engine.create(4242);
  for (let i = 0; i < 20000; i++) {
    for (const row of run.rows) assert.ok(row.lanes.some((o) => !o || o.kind !== "train"), JSON.stringify(row));
    for (let r = 1; r < run.rows.length; r++)
      for (let lane = 0; lane < 3; lane++) {
        const [a, b] = [run.rows[r - 1].lanes[lane], run.rows[r].lanes[lane]];
        if (a && b && a.kind === "low" && b.kind === "low") assert.ok(b.z0 - a.z0 >= (engine.V0 * engine.JUMP_TICKS) / engine.TPS + 2, `${a.z0} ${b.z0}`);
      }
    engine.step(run, null);
    run.dead = false;
  }
  assert.ok(run.z > 5000);
});

test("runner engine: a jump pressed just before landing jumps again on landing - one pressed too early doesn't", () => {
  const run = engine.create(1);
  engine.step(run, "J");
  while (run.jump && run.jump < engine.JUMP_TICKS - 5) engine.step(run, null);
  engine.step(run, "J");
  for (let i = 0; i < 8; i++) engine.step(run, null);
  assert.ok(run.jump > 0, "in the air again");
  const early = engine.create(1);
  engine.step(early, "J");
  engine.step(early, "J");
  for (let i = 0; i < engine.JUMP_TICKS + 2; i++) engine.step(early, null);
  assert.strictEqual(early.jump, 0, "landed and stayed down");
});

test("runner engine: moves from the page are checked - in order, known moves, one a tick", () => {
  assert.deepStrictEqual(engine.cleanMoves([[5, "L"], [3, "R"], [5, "J"], [6, "X"], ["7", "L"], [8, "LR"], [9, "D"], null, [-1, "L"]]), [[5, "L"], [9, "D"]]);
  assert.deepStrictEqual(engine.cleanMoves("nope"), []);
});

test("runner payout: nothing below the start, the share of the entry up to break-even, gently more above it, capped", () => {
  const was = { even: config.RUNNER_EVEN, min: config.RUNNER_MIN, slope: config.RUNNER_SLOPE, max: config.RUNNER_MAX };
  Object.assign(config, { RUNNER_EVEN: 1000, RUNNER_MIN: 0.25, RUNNER_SLOPE: 0.5, RUNNER_MAX: 3 });
  try {
    assert.strictEqual(runner.multiplier(249), 0);
    assert.strictEqual(runner.multiplier(250), 0.25);
    assert.strictEqual(runner.multiplier(500), 0.5);
    assert.strictEqual(runner.multiplier(1000), 1);
    assert.strictEqual(runner.multiplier(2000), 1.5);
    assert.strictEqual(runner.multiplier(50000), 3);
    assert.strictEqual(runner.payout(1000, 2000), 1500);
    assert.deepStrictEqual(runner.table(), { min: 250, even: 1000, max: 3, top: 5000, minMult: 0.25 });
  } finally {
    Object.assign(config, { RUNNER_EVEN: was.even, RUNNER_MIN: was.min, RUNNER_SLOPE: was.slope, RUNNER_MAX: was.max });
  }
});

/* ---------- The server ---------- */

let server;
const tokens = {};
const sockets = [];
const client = (user) => {
  const socket = server.client("/runner", tokens[user]);
  sockets.push(socket);
  return socket;
};

before(async () => {
  server = await h.startServer();
  for (const name of ["runa", "runb", "runc"]) tokens[name] = h.addUser(name);
});

after(async () => {
  sockets.forEach((s) => s.close());
  await server.close();
});

test("runner: a paid run costs the entry, the server's own replay decides the payout - a practice run is free", async () => {
  const was = config.RUNNER_EVEN;
  config.RUNNER_EVEN = 40;
  try {
    h.setCoins("runa", 5000);
    const a = client("runa");
    const setup = await h.once(a, "runnerSetup");
    assert.deepStrictEqual(setup.rules.stakes, config.RUNNER_STAKES);
    // Not one of the entries: nothing happens - an entry: the coins go
    a.emit("runStart", { stake: 123 });
    a.emit("runStart", { stake: 1000 });
    const started = await h.once(a, "runnerStarted");
    assert.strictEqual(started.stake, 1000);
    assert.ok(Number.isInteger(started.seed));
    assert.strictEqual(h.coinsOf("runa"), 4000);
    // One run at a time
    const busy = h.once(a, "runnerError");
    a.emit("runStart", { stake: 100 });
    assert.match(await busy, /Finish your run first/);
    // The page claims a far longer run than the time it took: those moves don't count - the server's replay pays
    const { moves } = autoPlay(started.seed);
    a.emit("runEnd", { id: started.id, moves: moves });
    const result = await h.once(a, "runnerResult");
    const own = engine.replay(started.seed, moves.filter((m) => m[0] <= ((config.RUNNER_SLACK + 1000) / 1000) * engine.TPS));
    assert.ok(Math.abs(result.score - own.score) <= 40, `${result.score} vs ${own.score}`);
    const full = engine.replay(started.seed, moves);
    if (full.ticks > ((config.RUNNER_SLACK + 1000) / 1000) * engine.TPS) assert.ok(result.score < full.score, "not the whole claimed run");
    assert.strictEqual(result.win, runner.payout(1000, result.score));
    await h.wait(30);
    assert.strictEqual(h.coinsOf("runa"), 4000 + result.win);
    assert.strictEqual(result.best, result.score);
    // Practice: free, nothing paid
    a.emit("runStart", { stake: 0 });
    const free = await h.once(a, "runnerStarted");
    assert.strictEqual(h.coinsOf("runa"), 4000 + result.win);
    a.emit("runEnd", { id: free.id, moves: [] });
    const practice = await h.once(a, "runnerResult");
    assert.strictEqual(practice.practice, true);
    assert.strictEqual(practice.win, 0);
    assert.strictEqual(h.coinsOf("runa"), 4000 + result.win);
  } finally {
    config.RUNNER_EVEN = was;
  }
});

test("runner: a page that plays slower than time (slow motion) loses its moves - leaving the page ends the run", async () => {
  h.setCoins("runb", 1000);
  const b = client("runb");
  await h.once(b, "runnerSetup");
  b.emit("runStart", { stake: 100 });
  const started = await h.once(b, "runnerStarted");
  // (the run started a minute ago on the server: moves for its first seconds come far too late now)
  const run = server.runner.state.runs.get("runb");
  run.startedAt -= 60000;
  b.emit("runMoves", { id: started.id, moves: [[10, "L"], [20, "J"]] });
  await h.wait(50);
  assert.deepStrictEqual(run.moves, []);
  // ... moves of about now count
  const now = Math.floor(((60000 - config.RUNNER_COUNTDOWN) / 1000) * engine.TPS);
  b.emit("runMoves", { id: started.id, moves: [[now, "L"]] });
  await h.wait(50);
  assert.deepStrictEqual(run.moves, [[now, "L"]]);
  // The page is gone: the run ends with what the server has (and is paid if it pays)
  b.close();
  await h.wait(100);
  assert.strictEqual(server.runner.state.runs.has("runb"), false);
  assert.ok(server.runner.state.bests.runb > 0);
});

test("runner: the paid runs of a day can be limited - practice stays free", async () => {
  const was = config.RUNNER_DAILY;
  config.RUNNER_DAILY = 1;
  try {
    h.setCoins("runc", 1000);
    const c = client("runc");
    await h.once(c, "runnerSetup");
    c.emit("runStart", { stake: 100 });
    const first = await h.once(c, "runnerStarted");
    c.emit("runEnd", { id: first.id, moves: [] });
    await h.once(c, "runnerResult");
    const limited = h.once(c, "runnerError");
    c.emit("runStart", { stake: 100 });
    assert.match(await limited, /1 runs for today/);
    c.emit("runStart", { stake: 0 });
    assert.strictEqual((await h.once(c, "runnerStarted")).stake, 0);
  } finally {
    config.RUNNER_DAILY = was;
  }
});
