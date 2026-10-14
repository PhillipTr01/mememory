const { test, before, after } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const rpg = require("../game/rpg");
const testMode = require("../game/test_mode");

test("rpg: upgrades and floors get dearer, a floor opens after the one before; the first room a fight, then two doors, the last an elite", () => {
  assert.strictEqual(rpg.upgradeCost(0), 2000);
  assert.ok(rpg.upgradeCost(5) > rpg.upgradeCost(4));
  assert.strictEqual(rpg.upgradeCost(rpg.LEVEL_MAX), null);
  assert.strictEqual(rpg.entryCost(1), 1000);
  assert.ok(rpg.entryCost(10) > rpg.entryCost(9));
  const hero = rpg.newHero();
  assert.strictEqual(hero.cls, "warrior");
  assert.strictEqual(rpg.maxFloor(hero), 1);
  hero.deepest = 4;
  assert.strictEqual(rpg.maxFloor(hero), 5);
  hero.deepest = rpg.FLOORS;
  assert.strictEqual(rpg.maxFloor(hero), rpg.FLOORS);
  assert.strictEqual(rpg.BOSS_EVERY, 0);
  // The rooms: a fight first, then a choice of two different doors, the elite last
  const run = rpg.newRun(3, [{ name: "a", hero: rpg.newHero() }]);
  assert.deepStrictEqual(run.doors, ["fight"]);
  run.rooms = [{ kind: "fight", done: true }];
  for (let i = 0; i < 50; i++) {
    const doors = rpg.doorsFor(run);
    assert.strictEqual(doors.length, 2);
    assert.notStrictEqual(doors[0], doors[1]);
    assert.ok(doors.every((kind) => rpg.ROOM_KINDS[kind] && kind != "elite"));
  }
  run.rooms = Array.from({ length: rpg.ROOMS - 1 }, () => ({ kind: "chest", done: true }));
  assert.deepStrictEqual(rpg.doorsFor(run), ["elite"]);
  // The classes: their own stats and three skills each
  for (const id of rpg.CLASS_IDS) {
    assert.strictEqual(rpg.CLASSES[id].skills.length, 3);
    assert.ok(rpg.STATS[rpg.CLASSES[id].main], id);
    rpg.CLASSES[id].skills.forEach((skill) => assert.ok(rpg.SKILLS[skill], skill));
  }
  const tank = rpg.statsOf({ ...rpg.newHero(), cls: "warrior" });
  const mage = rpg.statsOf({ ...rpg.newHero(), cls: "mage" });
  assert.ok(tank.maxHp > mage.maxHp && mage.luck > tank.luck);
  // A level in the main stat of the class counts 1.5x: Strength for the warrior, Luck for the mage
  const strong = { ...rpg.newHero(), cls: "warrior", levels: { hp: 0, atk: 4, def: 0, luck: 4, agi: 0 } };
  const lucky = { ...strong, cls: "mage" };
  assert.strictEqual(rpg.statsOf(strong).atk, Math.round((10 + 3 * 4 * rpg.MAIN_BONUS) * rpg.CLASSES.warrior.atk));
  assert.strictEqual(rpg.statsOf(lucky).luck, Math.round(5 + 2 * 4 * rpg.MAIN_BONUS + rpg.CLASSES.mage.luck));
  assert.strictEqual(rpg.statsOf(strong).luck, Math.round(5 + 2 * 4 + rpg.CLASSES.warrior.luck));
  // Gear makes a hero stronger
  const before = rpg.statsOf(hero);
  hero.gear.weapon = { slot: "weapon", atk: 7 };
  hero.gear.armor = { slot: "armor", def: 3, hp: 20 };
  const now = rpg.statsOf(hero);
  assert.ok(now.atk >= before.atk + 7);
  assert.strictEqual(now.def, before.def + 3);
  assert.ok(now.maxHp >= before.maxHp + 20);
  const item = rpg.makeGear(6, Math.random, 20);
  assert.ok(Object.keys(rpg.SLOTS).includes(item.slot) && rpg.RARITIES.some((r) => r.id == item.rarity) && item.value > 0);
});

test("rpg: a new hero clears floor 1 but not floor 8 - upgrades take it deeper; a full clear pays less than 1.5x the entry", () => {
  const weak = rpg.newHero();
  assert.ok(rpg.simulate(weak, 1, 200).cleared > 0.85);
  assert.ok(rpg.simulate(weak, 8, 200).cleared < 0.05);
  const strong = rpg.newHero();
  for (const id of rpg.STAT_IDS) strong.levels[id] = 8;
  const deep = rpg.simulate(strong, 8, 200);
  assert.ok(deep.cleared > 0.9, JSON.stringify(deep));
  assert.ok(deep.payback < 1.5, JSON.stringify(deep));
});

// A fight with one monster of fixed numbers (the tests decide what it does)
function duel(cls, move) {
  const hero = { ...rpg.newHero(), cls };
  const run = rpg.newRun(1, [{ name: "a", hero }]);
  rpg.enterRoom(run, 0);
  run.monsters = [{ id: "m1", name: "Dummy", icon: "🎯", hp: 1000, maxHp: 1000, atk: 20, dodge: 0, undead: false, moves: [move], rank: "normal", effects: {}, intent: { move, target: "a" } }];
  return run;
}

test("rpg: monsters show their move first - guard takes the most of a smash, a stun skips it; skills cost energy, one more every turn", () => {
  const run = duel("warrior", "smash");
  assert.match(rpg.choose(run, "a", { action: "dance" }), /Unknown/);
  assert.match(rpg.choose(run, "a", { action: "potion" }), /full/);
  assert.match(rpg.choose(run, "a", { action: "skill", skill: "fireball" }), /Unknown skill/);
  assert.match(rpg.choose(run, "a", { action: "skill", skill: "cleave" }), /needs 2 energy/);
  const view = rpg.runView(run);
  assert.deepStrictEqual([view.monsters[0].intent.move, view.monsters[0].intent.target], ["smash", "a"]);
  const smash = view.monsters[0].intent.damage;
  assert.ok(smash >= 40, String(smash));
  const me = run.heroes[0];
  const fresh = me.hp;
  // Guarded: much less than the smash (and one more energy)
  assert.strictEqual(rpg.choose(run, "a", { action: "guard" }), null);
  rpg.resolveTurn(run, () => 0.5);
  assert.ok(fresh - me.hp < smash * 0.5, `${fresh - me.hp} of ${smash}`);
  assert.strictEqual(me.energy, 3);
  // Stunned by the bash: no smash at all
  run.monsters[0].intent = { move: "smash", target: "a" };
  const hp = me.hp;
  assert.strictEqual(rpg.choose(run, "a", { action: "skill", skill: "bash", target: "m1" }), null);
  rpg.resolveTurn(run, () => 0.5);
  assert.strictEqual(me.hp, hp);
  assert.ok(run.monsters[0].hp < 1000);
  assert.strictEqual(me.energy, 3);
});

test("rpg: poison ticks and makes the backstab hurt 3x; the cleric heals and brings the fallen back; all down: the pot is lost", () => {
  const run = duel("rogue", "defend");
  rpg.choose(run, "a", { action: "skill", skill: "poisonblade", target: "m1" });
  run.monsters[0].intent = { move: "attack", target: "a" };
  rpg.resolveTurn(run, () => 0.5);
  const foe = run.monsters[0];
  assert.ok(foe.effects.poison && foe.effects.poison.turns == 2, JSON.stringify(foe.effects));
  run.heroes[0].energy = 2;
  const before = foe.hp;
  rpg.choose(run, "a", { action: "skill", skill: "backstab", target: "m1" });
  foe.intent = { move: "defend" };
  rpg.resolveTurn(run, () => 0.5);
  // (defended: half - still far more than a plain hit)
  assert.ok(before - foe.hp > run.heroes[0].atk * 1.2, `${before - foe.hp}`);

  // The cleric: heal, revive
  const hero = { ...rpg.newHero(), cls: "cleric" };
  const party = rpg.newRun(1, [{ name: "c", hero }, { name: "w", hero: rpg.newHero() }]);
  rpg.enterRoom(party, 0);
  party.monsters = [{ id: "m1", name: "Dummy", icon: "🎯", hp: 1000, maxHp: 1000, atk: 1, dodge: 0, moves: ["defend"], rank: "normal", effects: {}, intent: { move: "defend" } }];
  const [cleric, warrior] = party.heroes;
  warrior.hp = 10;
  rpg.choose(party, "c", { action: "skill", skill: "heal", ally: "w" });
  rpg.choose(party, "w", { action: "guard" });
  rpg.resolveTurn(party, () => 0.5);
  assert.ok(warrior.hp > 10);
  warrior.down = true;
  warrior.hp = 0;
  cleric.energy = 3;
  assert.strictEqual(rpg.choose(party, "c", { action: "skill", skill: "revive", ally: "w" }), null);
  party.monsters[0].intent = { move: "defend" };
  rpg.resolveTurn(party, () => 0.5);
  assert.ok(!warrior.down && warrior.hp > 0);
  // Far too strong monsters: the party goes down, the pot with it
  party.pot = 500;
  party.monsters[0].atk = 100000;
  party.monsters[0].intent = { move: "burn" };
  rpg.choose(party, "c", { action: "attack" });
  rpg.choose(party, "w", { action: "attack" });
  rpg.resolveTurn(party, () => 0.5);
  assert.strictEqual(party.phase, "lost");
  assert.strictEqual(party.pot, 0);
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
  assert.strictEqual(up.stats.atk, Math.round((rpg.STATS.atk.base + rpg.STATS.atk.per * rpg.MAIN_BONUS) * rpg.CLASSES.warrior.atk));
  assert.strictEqual(testMode.balance("rpg_alice"), 1000000 - rpg.upgradeCost(0));
  alice.emit("potion");
  await waitFor(alice, "rpgHero", (view) => view.potions == 3);
  // A class: picked any time outside a run
  alice.emit("class", { id: "mage" });
  const mage = await waitFor(alice, "rpgHero", (view) => view.cls == "mage");
  assert.strictEqual(mage.stats.maxHp, Math.round(up.stats.maxHp / rpg.CLASSES.warrior.hp * rpg.CLASSES.mage.hp));
  alice.emit("class", { id: "warrior" });
  await waitFor(alice, "rpgHero", (view) => view.cls == "warrior");
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
