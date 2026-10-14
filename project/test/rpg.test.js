const { test, before, after } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const rpg = require("../game/rpg");
const testMode = require("../game/test_mode");

test("rpg: upgrades and floors get dearer, a floor opens after the one before, six rooms - the last an elite (no bosses yet)", () => {
  assert.strictEqual(rpg.upgradeCost(0), 2000);
  assert.ok(rpg.upgradeCost(5) > rpg.upgradeCost(4));
  assert.strictEqual(rpg.upgradeCost(rpg.LEVEL_MAX), null);
  assert.strictEqual(rpg.entryCost(1), 1000);
  assert.ok(rpg.entryCost(10) > rpg.entryCost(9));
  const hero = rpg.newHero();
  assert.strictEqual(rpg.maxFloor(hero), 1);
  hero.deepest = 4;
  assert.strictEqual(rpg.maxFloor(hero), 5);
  hero.deepest = rpg.FLOORS;
  assert.strictEqual(rpg.maxFloor(hero), rpg.FLOORS);
  assert.strictEqual(rpg.BOSS_EVERY, 0);
  for (let floor = 1; floor <= 10; floor++) {
    const rooms = rpg.planRooms(floor);
    assert.strictEqual(rooms.length, rpg.ROOMS);
    assert.strictEqual(rooms[rooms.length - 1].kind, "elite");
    assert.ok(rooms.every((room) => room.kind != "boss"));
  }
  // Gear makes a hero stronger
  const before = rpg.statsOf(hero);
  hero.gear.weapon = { slot: "weapon", atk: 7 };
  hero.gear.armor = { slot: "armor", def: 3, hp: 20 };
  const now = rpg.statsOf(hero);
  assert.strictEqual(now.atk, before.atk + 7);
  assert.strictEqual(now.def, before.def + 3);
  assert.strictEqual(now.maxHp, before.maxHp + 20);
  const item = rpg.makeGear(6, Math.random, 20);
  assert.ok(Object.keys(rpg.SLOTS).includes(item.slot) && rpg.RARITIES.some((r) => r.id == item.rarity) && item.value > 0);
});

test("rpg: a new hero clears floor 1 but not floor 8 - upgrades take it deeper; a full clear pays less than 1.5x the entry", () => {
  const weak = rpg.newHero();
  assert.ok(rpg.simulate(weak, 1, 200).cleared > 0.9);
  assert.ok(rpg.simulate(weak, 8, 200).cleared < 0.05);
  const strong = rpg.newHero();
  for (const id of rpg.STAT_IDS) strong.levels[id] = 8;
  const deep = rpg.simulate(strong, 8, 200);
  assert.ok(deep.cleared > 0.9, JSON.stringify(deep));
  assert.ok(deep.payback < 1.5, JSON.stringify(deep));
});

test("rpg: a turn - actions checked, the power strike waits its turns, a potion heals; all down: the pot is lost", () => {
  const hero = rpg.newHero();
  const run = rpg.newRun(1, [{ name: "a", hero }]);
  assert.match(rpg.choose(run, "a", { action: "attack" }), /No fight/);
  // (the first room is a fight)
  rpg.enterRoom(run);
  assert.strictEqual(run.phase, "fight");
  assert.match(rpg.choose(run, "a", { action: "dance" }), /Unknown/);
  assert.match(rpg.choose(run, "a", { action: "potion" }), /full/);
  assert.strictEqual(rpg.choose(run, "a", { action: "skill" }), null);
  assert.ok(rpg.allChosen(run));
  run.monsters.forEach((m) => (m.hp = m.maxHp = 100000));
  rpg.resolveTurn(run);
  assert.strictEqual(run.heroes[0].cooldown, rpg.SKILL_COOLDOWN);
  assert.match(rpg.choose(run, "a", { action: "skill" }), /ready in/);
  run.heroes[0].hp = 10;
  assert.strictEqual(rpg.choose(run, "a", { action: "potion" }), null);
  run.monsters.forEach((m) => (m.atk = 1));
  rpg.resolveTurn(run);
  assert.ok(run.heroes[0].hp > 10);
  assert.strictEqual(run.heroes[0].potions, hero.potions - 1);
  // Monsters far too strong: the party goes down, the pot with it
  run.pot = 500;
  run.monsters.forEach((m) => (m.atk = 100000));
  rpg.resolveTurn(run);
  assert.strictEqual(run.phase, "lost");
  assert.strictEqual(run.pot, 0);
});

let server;
const sockets = [];
const tokens = {};

function client(name, namespace = "/test/rpg") {
  const socket = server.client(namespace, tokens[name]);
  sockets.push(socket);
  return socket;
}

function waitFor(socket, event, predicate, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timeout waiting for "${event}"`));
    }, timeout);
    function handler(data) {
      if (!predicate(data)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(data);
    }
    socket.on(event, handler);
  });
}

before(async () => {
  server = await h.startServer();
  for (const name of ["rpg_alice", "rpg_bob", "rpg_real"]) tokens[name] = h.addUser(name);
  Object.assign(server.test.rpg.timing, { turn: 300, decide: 300, close: 300 });
});

after(async () => {
  sockets.forEach((s) => s.close());
  server.test.rpg.stop();
  testMode.reset();
  await server.close();
});

test("rpg: only in the test world - a real player can't get in", async () => {
  const real = client("rpg_real");
  assert.strictEqual((await h.once(real, "connect_error")).message, "testMode");
});

test("rpg: alone - upgrades and potions cost test coins, the entry too; the time up between rooms: out with the loot", async () => {
  testMode.start("rpg_alice", 1000000);
  const alice = client("rpg_alice");
  const hero = await h.once(alice, "rpgHero");
  assert.strictEqual(hero.levels.atk, 0);
  alice.emit("upgrade", { stat: "atk" });
  const up = await waitFor(alice, "rpgHero", (view) => view.levels.atk == 1);
  assert.strictEqual(up.stats.atk, rpg.STATS.atk.base + rpg.STATS.atk.per);
  assert.strictEqual(testMode.balance("rpg_alice"), 1000000 - rpg.upgradeCost(0));
  alice.emit("potion");
  await waitFor(alice, "rpgHero", (view) => view.potions == 3);
  // A floor not open yet
  const refused = h.once(alice, "rpgError");
  alice.emit("create", { floor: 2, size: 1 });
  assert.match(await refused, /isn't open/);

  // (strong enough to clear floor 1 for sure)
  const mine = server.test.rpg.heroOf("rpg_alice");
  for (const id of rpg.STAT_IDS) mine.levels[id] = 30;
  const before = testMode.balance("rpg_alice");
  alice.emit("create", { floor: 1, size: 1 });
  const fight = await waitFor(alice, "rpgParty", (p) => p && p.run && p.run.phase == "fight");
  assert.strictEqual(testMode.balance("rpg_alice"), before - rpg.entryCost(1));
  assert.ok(fight.run.monsters.length >= 1);
  // Not during a run
  const busy = h.once(alice, "rpgError");
  alice.emit("upgrade", { stat: "hp" });
  assert.match(await busy, /Not during a run/);
  alice.emit("act", { action: "attack", target: fight.run.monsters[0].id });
  const between = await waitFor(alice, "rpgParty", (p) => p && p.run && p.run.phase == "between");
  assert.ok(between.run.pot > 0);
  // Nobody decides: out with the loot
  const done = await waitFor(alice, "rpgParty", (p) => p && p.result == "left");
  assert.strictEqual(testMode.balance("rpg_alice"), before - rpg.entryCost(1) + done.run.pot);
  // Back to the hero (the party closes)
  alice.emit("leave");
  await waitFor(alice, "rpgParty", (p) => p == null);
});

test("rpg: co-op - one opens a party, another joins, the leader starts (both pay); a turn waits for both, the floor cleared opens the next", async () => {
  testMode.start("rpg_alice", 1000000);
  testMode.start("rpg_bob", 1000000);
  const alice = client("rpg_alice");
  const bob = client("rpg_bob");
  await h.once(alice, "rpgHero");
  await h.once(bob, "rpgHero");
  for (const name of ["rpg_alice", "rpg_bob"]) {
    const hero = server.test.rpg.heroOf(name);
    for (const id of rpg.STAT_IDS) hero.levels[id] = 30;
  }
  Object.assign(server.test.rpg.timing, { turn: 5000, decide: 5000 });
  alice.emit("create", { floor: 1, size: 2 });
  const open = await waitFor(bob, "rpgParties", (list) => list.some((p) => p.leader == "rpg_alice" && !p.started));
  const id = open.find((p) => p.leader == "rpg_alice").id;
  bob.emit("join", { id });
  await waitFor(alice, "rpgParty", (p) => p && p.members.length == 2);
  // Only the leader starts
  const notLeader = h.once(bob, "rpgError");
  bob.emit("start");
  assert.match(await notLeader, /leader/);
  const aliceBefore = testMode.balance("rpg_alice");
  const bobBefore = testMode.balance("rpg_bob");
  alice.emit("start");
  const fight = await waitFor(bob, "rpgParty", (p) => p && p.run && p.run.phase == "fight");
  assert.strictEqual(testMode.balance("rpg_alice"), aliceBefore - rpg.entryCost(1));
  assert.strictEqual(testMode.balance("rpg_bob"), bobBefore - rpg.entryCost(1));
  assert.strictEqual(fight.run.heroes.length, 2);

  // The turn waits for both heroes
  alice.emit("act", { action: "guard" });
  const waiting = await waitFor(bob, "rpgParty", (p) => p && p.run.heroes.find((h) => h.name == "rpg_alice").chose);
  assert.strictEqual(waiting.run.turn, 1);
  assert.ok(!waiting.run.heroes.find((h) => h.name == "rpg_bob").chose);

  // Fight on (both act each turn) - the leader goes on through every room
  const play = (socket) =>
    socket.on("rpgParty", (p) => {
      if (!p || !p.run || p.result) return;
      if (p.run.phase == "fight") {
        const me = p.run.heroes.find((h) => h.name == (socket === alice ? "rpg_alice" : "rpg_bob"));
        if (me && !me.down && !me.chose) socket.emit("act", { action: "attack" });
      }
      if (p.run.phase == "between" && socket === alice) socket.emit("next");
    });
  play(alice);
  play(bob);
  bob.emit("act", { action: "attack" });
  const won = await waitFor(alice, "rpgParty", (p) => p && p.result == "won", 15000);
  assert.ok(won.run.pot > 0);
  const hero = await waitFor(bob, "rpgHero", (view) => view.deepest == 1);
  assert.strictEqual(hero.maxFloor, 2);
  assert.strictEqual(testMode.balance("rpg_bob"), bobBefore - rpg.entryCost(1) + won.run.pot);
});
