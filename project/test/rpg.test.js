const { test, before, after } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const rpg = require("../game/rpg");
const testMode = require("../game/test_mode");

test("rpg: upgrades and floors get dearer, a floor opens after the one before; the first room a fight, then three hidden doors (mostly fights), the guarded gate last", () => {
  assert.strictEqual(rpg.upgradeCost(0), 2000);
  assert.ok(rpg.upgradeCost(5) > rpg.upgradeCost(4));
  assert.strictEqual(rpg.upgradeCost(rpg.LEVEL_MAX), null);
  assert.strictEqual(rpg.entryCost(1), 1000);
  assert.ok(rpg.entryCost(10) > rpg.entryCost(9));
  // A new hero: no class yet - the first one free, every other one a character of its own for CLASS_PRICE
  const fresh = rpg.newHero();
  assert.strictEqual(fresh.cls, null);
  assert.strictEqual(rpg.classPrice(fresh), 0);
  const hero = rpg.newHero("warrior");
  assert.deepStrictEqual([hero.cls, hero.unlocked, rpg.classPrice(hero)], ["warrior", ["warrior"], rpg.CLASS_PRICE]);
  assert.strictEqual(rpg.maxFloor(hero), 1);
  rpg.charOf(hero).deepest = 4;
  assert.strictEqual(rpg.maxFloor(hero), 5);
  rpg.unlock(hero, "rogue");
  assert.strictEqual(rpg.maxFloor(hero), 1, "the rogue: a character of its own");
  rpg.charOf(hero).levels.agi = 3;
  rpg.unlock(hero, "warrior");
  assert.strictEqual(rpg.maxFloor(hero), 5);
  assert.strictEqual(rpg.charOf(hero).levels.agi, 0);
  rpg.charOf(hero).deepest = rpg.FLOORS;
  assert.strictEqual(rpg.maxFloor(hero), rpg.FLOORS);
  assert.strictEqual(rpg.BOSS_EVERY, 0);
  // The rooms: a fight first, then three hidden doors (mostly fights), the guarded gate last
  const run = rpg.newRun(3, [{ name: "a", hero: rpg.newHero("warrior") }]);
  assert.deepStrictEqual(run.doors.map((d) => d.kind), ["fight"]);
  run.rooms = [{ kind: "fight", done: true }];
  const kinds = new Map();
  for (let i = 0; i < 400; i++) {
    const doors = rpg.doorsFor(run);
    assert.strictEqual(doors.length, rpg.DOORS);
    doors.forEach((door) => kinds.set(door.kind, (kinds.get(door.kind) || 0) + 1));
    assert.ok(doors.every((door) => rpg.ROOM_KINDS[door.kind] && door.kind != "elite" && !door.open));
  }
  const fights = (kinds.get("fight") || 0) + (kinds.get("hard") || 0);
  assert.ok(fights > 1200 * 0.55, `fights ${fights}`);
  assert.ok((kinds.get("rest") || 0) < 1200 * 0.1 && (kinds.get("merchant") || 0) < 1200 * 0.06);
  // What is behind a hidden door: not on the page
  run.doors = rpg.doorsFor(run);
  assert.ok(rpg.runView(run).doors.every((door) => door.kind == null));
  run.rooms = Array.from({ length: rpg.ROOMS - 1 }, () => ({ kind: "chest", done: true }));
  assert.deepStrictEqual(rpg.doorsFor(run).map((d) => [d.kind, d.open]), [["elite", true]]);
  // The classes: a main stat, two signature cards in the starter deck, five cards of their own
  for (const id of rpg.CLASS_IDS) {
    assert.ok(rpg.STATS[rpg.CLASSES[id].main], id);
    assert.strictEqual(rpg.CLASSES[id].cards.length, 5);
    rpg.CLASSES[id].cards.forEach((card) => assert.ok(rpg.CARDS[card], card));
    assert.deepStrictEqual(rpg.starterDeck(id).slice(8), rpg.CLASSES[id].signature);
  }
  const tank = rpg.statsOf(rpg.newHero("warrior"));
  const mage = rpg.statsOf(rpg.newHero("mage"));
  assert.ok(tank.maxHp > mage.maxHp && mage.luck > tank.luck);
  // A level in the main stat of the class counts 1.5x: Strength for the warrior, Luck for the mage
  const strong = rpg.newHero("warrior");
  rpg.charOf(strong).levels = { hp: 0, atk: 4, def: 0, luck: 4, agi: 0 };
  const lucky = rpg.newHero("mage");
  rpg.charOf(lucky).levels = { hp: 0, atk: 4, def: 0, luck: 4, agi: 0 };
  assert.strictEqual(rpg.statsOf(strong).atk, Math.round((10 + 3 * 4 * rpg.MAIN_BONUS) * rpg.CLASSES.warrior.atk));
  assert.strictEqual(rpg.statsOf(lucky).luck, Math.round(5 + 2 * 4 * rpg.MAIN_BONUS + rpg.CLASSES.mage.luck));
  assert.strictEqual(rpg.statsOf(strong).luck, Math.round(5 + 2 * 4 + rpg.CLASSES.warrior.luck));
  // Gear makes a hero stronger
  const before = rpg.statsOf(hero);
  rpg.charOf(hero).gear.weapon = { slot: "weapon", atk: 7 };
  rpg.charOf(hero).gear.armor = { slot: "armor", def: 3, hp: 20 };
  const now = rpg.statsOf(hero);
  assert.ok(now.atk >= before.atk + 7);
  assert.strictEqual(now.def, before.def + 3);
  assert.ok(now.maxHp >= before.maxHp + 20);
  const item = rpg.makeGear(6, Math.random, 20);
  assert.ok(Object.keys(rpg.SLOTS).includes(item.slot) && rpg.RARITIES.some((r) => r.id == item.rarity) && item.value > 0);
});

test("rpg: a new hero clears floor 1 but not floor 8 - upgrades take it deeper; a full clear pays less than 1.5x the entry", () => {
  const weak = rpg.newHero("warrior");
  assert.ok(rpg.simulate(weak, 1, 200).cleared > 0.85);
  assert.ok(rpg.simulate(weak, 8, 200).cleared < 0.05);
  const strong = rpg.newHero("warrior");
  for (const id of rpg.STAT_IDS) rpg.charOf(strong).levels[id] = 8;
  const deep = rpg.simulate(strong, 8, 200);
  assert.ok(deep.cleared > 0.9, JSON.stringify(deep));
  assert.ok(deep.payback < 1.5, JSON.stringify(deep));
});

// A fight with one monster of fixed numbers (the tests decide what it does) and the hand the tests give
function duel(cls, move, hand) {
  const hero = rpg.newHero(cls);
  const run = rpg.newRun(1, [{ name: "a", hero }]);
  rpg.enterRoom(run, 0);
  run.monsters = [{ id: "m1", name: "Dummy", icon: "🎯", hp: 1000, maxHp: 1000, atk: 20, dodge: 0, undead: false, moves: [move], rank: "normal", effects: {}, intent: { move, target: "a" } }];
  const me = run.heroes[0];
  me.discard.push(...me.hand.map((c) => c.id));
  me.hand = hand.map((id, i) => ({ uid: "t" + i, id }));
  return run;
}

test("rpg: cards - energy, targets, block takes a smash, a stun skips it; the turn: the monsters act when every hero ended it", () => {
  const run = duel("warrior", "smash", ["strike", "defend", "defend", "bash", "cleave"]);
  const me = run.heroes[0];
  assert.strictEqual(me.energy, rpg.ENERGY);
  assert.match(rpg.play(run, "a", { uid: "nope" }), /isn't in your hand/);
  assert.match(rpg.play(run, "a", { uid: "t0" }), /Pick a foe/);
  const view = rpg.runView(run);
  assert.deepStrictEqual([view.monsters[0].intent.move, view.monsters[0].intent.target], ["smash", "a"]);
  const smash = view.monsters[0].intent.damage;
  // Two defends: the smash mostly blocked
  assert.strictEqual(rpg.play(run, "a", { uid: "t1" }), null);
  assert.strictEqual(rpg.play(run, "a", { uid: "t2" }), null);
  assert.strictEqual(me.block, 2 * (6 + me.def));
  assert.strictEqual(me.energy, 1);
  assert.match(rpg.play(run, "a", { uid: "t3", target: "m1" }), /needs 2 mana/);
  const fresh = me.hp;
  assert.strictEqual(rpg.endTurn(run, "a"), true);
  rpg.monsterTurn(run, () => 0.5);
  // (armor first, then the block)
  assert.strictEqual(fresh - me.hp, Math.round(smash - me.def) - 2 * (6 + me.def));
  // The next turn: block gone, full energy, five new cards (the old hand to the discard pile)
  assert.strictEqual(me.block, 0);
  assert.strictEqual(me.energy, rpg.ENERGY);
  assert.strictEqual(me.hand.length, 5);
  assert.strictEqual(run.turn, 2);
  // A stun: no smash at all
  run.monsters[0].intent = { move: "smash", target: "a" };
  me.hand = [{ uid: "s1", id: "bash" }];
  const hp = me.hp;
  assert.strictEqual(rpg.play(run, "a", { uid: "s1", target: "m1" }), null);
  assert.ok(run.monsters[0].hp < 1000 && run.monsters[0].effects.stun);
  rpg.endTurn(run, "a");
  rpg.monsterTurn(run, () => 0.5);
  assert.strictEqual(me.hp, hp);
});

test("rpg: poison makes the backstab hurt 3x; the cleric heals, brings the fallen back; a fight won: a card to pick; all down: the pot is lost", () => {
  const run = duel("rogue", "defend", ["poisonblade", "backstab"]);
  rpg.play(run, "a", { uid: "t0", target: "m1" });
  const foe = run.monsters[0];
  assert.ok(foe.effects.poison && foe.effects.poison.turns == 3, JSON.stringify(foe.effects));
  const before = foe.hp;
  rpg.play(run, "a", { uid: "t1", target: "m1" });
  // (defending: half - still far more than a strike)
  assert.ok(before - foe.hp > run.heroes[0].atk * 1.2, `${before - foe.hp}`);

  // The cleric
  const party = rpg.newRun(1, [{ name: "c", hero: rpg.newHero("cleric") }, { name: "w", hero: rpg.newHero("warrior") }]);
  rpg.enterRoom(party, 0);
  party.monsters = [{ id: "m1", name: "Dummy", icon: "🎯", hp: 1000, maxHp: 1000, atk: 1, dodge: 0, moves: ["defend"], rank: "normal", effects: {}, intent: { move: "defend" } }];
  const [cleric, warrior] = party.heroes;
  cleric.hand = [{ uid: "h", id: "heal" }, { uid: "r", id: "revive" }];
  warrior.hp = 10;
  assert.strictEqual(rpg.play(party, "c", { uid: "h", ally: "w" }), null);
  assert.ok(warrior.hp > 10);
  // (the turn waits for both)
  assert.strictEqual(rpg.endTurn(party, "c"), false);
  warrior.down = true;
  warrior.hp = 0;
  cleric.ended = false;
  cleric.energy = 3;
  assert.strictEqual(rpg.play(party, "c", { uid: "r", ally: "w" }), null);
  assert.ok(!warrior.down && warrior.hp > 0);
  // Won: a card to pick (one of three) for the deck
  party.monsters[0].hp = 1;
  cleric.hand = [{ uid: "x", id: "strike" }];
  cleric.energy = 1;
  rpg.play(party, "c", { uid: "x", target: "m1" });
  assert.strictEqual(party.phase, "between");
  assert.strictEqual(cleric.reward.length, 3);
  assert.match(rpg.pickReward(party, "c", "nonsense"), /Not one of your cards/);
  const card = cleric.reward[0];
  assert.strictEqual(rpg.pickReward(party, "c", card), null);
  assert.strictEqual(cleric.deck[cleric.deck.length - 1], card);
  // Votes: the most win, a tie goes with the leader, nobody: leave
  assert.strictEqual(rpg.tally(party, "c"), "leave");
  rpg.vote(party, "c", 1);
  rpg.vote(party, "w", 2);
  assert.strictEqual(rpg.tally(party, "c"), 1);
  rpg.vote(party, "w", 1);
  assert.strictEqual(rpg.tally(party, "w"), 1);
  assert.match(rpg.vote(party, "w", 9), /Unknown door/);
  // Far too strong monsters: the party goes down, the pot with it
  party.doors = [{ kind: "fight", hint: null, open: true }];
  rpg.enterRoom(party, 0);
  party.monsters = [{ id: "m9", name: "Doom", icon: "🎯", hp: 1000, maxHp: 1000, atk: 100000, dodge: 0, moves: ["burn"], rank: "normal", effects: {}, intent: { move: "burn" } }];
  party.heroes.forEach((h) => (h.agi = 0));
  party.pot = 500;
  rpg.endTurn(party, "c");
  rpg.endTurn(party, "w");
  rpg.monsterTurn(party, () => 0.5);
  assert.strictEqual(party.phase, "lost");
  assert.strictEqual(party.pot, 0);
});

test("rpg: doors - only luck senses danger or calm; rooms say what happened; the merchant sells a potion and cards", () => {
  const run = rpg.newRun(1, [{ name: "a", hero: rpg.newHero("warrior") }]);
  rpg.enterRoom(run, 0);
  run.rooms = [{ kind: "fight", done: true }];
  // No luck: nothing sensed - lucky: sensed, and right
  run.heroes[0].luck = 0;
  assert.ok(rpg.doorsFor(run).every((door) => door.sense == null));
  run.heroes[0].luck = 60;
  let sensed = 0;
  for (let i = 0; i < 300; i++) {
    for (const door of rpg.doorsFor(run)) {
      if (!door.sense) continue;
      sensed++;
      assert.strictEqual(door.sense, ["fight", "hard", "trap"].includes(door.kind) ? "danger" : "calm");
    }
  }
  assert.ok(sensed > 900 * 0.8 && sensed < 900 * 0.97, String(sensed));
  // A camp fire: rest (heal) or smith (a card of the deck upgraded) - what happened is shown
  run.phase = "between";
  run.doors = [{ kind: "rest", sense: null, open: false }];
  run.heroes[0].hp = 10;
  rpg.enterRoom(run, 0);
  assert.strictEqual(run.event.kind, "rest");
  assert.match(rpg.campfire(run, "a", { choice: "smith", card: 99 }), /Pick a card/);
  assert.strictEqual(rpg.campfire(run, "a", { choice: "rest" }), null);
  assert.ok(run.heroes[0].hp > 10);
  assert.match(run.event.lines[run.event.lines.length - 1], /rests/);
  assert.match(rpg.campfire(run, "a", { choice: "rest" }), /chose already/);
  run.phase = "between";
  run.doors = [{ kind: "rest", sense: null, open: false }];
  rpg.enterRoom(run, 0);
  assert.strictEqual(rpg.campfire(run, "a", { choice: "smith", card: 0 }), null);
  assert.strictEqual(run.heroes[0].deck[0], "strike+");
  assert.strictEqual(rpg.cardInfo("strike+").name, "Strike+");
  // The merchant: three cards and a potion, for coins (the server takes them)
  run.doors = [{ kind: "merchant", sense: null, open: false }];
  rpg.enterRoom(run, 0);
  const offer = run.event.offers.a;
  assert.strictEqual(offer.cards.length, 3);
  assert.strictEqual(rpg.canBuy(run, "a", "potion").price, rpg.merchantPrices(1).potion);
  // (a mage's card: never in the warrior's offer)
  assert.match(rpg.canBuy(run, "a", "meteor").error, /doesn't sell/);
  const card = offer.cards[0];
  assert.strictEqual(rpg.canBuy(run, "a", card).price, rpg.merchantPrices(1).card);
  const deck = run.heroes[0].deck.length;
  rpg.bought(run, "a", card);
  assert.strictEqual(run.heroes[0].deck.length, deck + 1);
  assert.match(rpg.canBuy(run, "a", card).error, /Sold/);
  // Through the next door: the room's panel is gone
  run.doors = [{ kind: "fight", sense: null, open: false }];
  rpg.enterRoom(run, 0);
  assert.notStrictEqual(run.event && run.event.kind, "merchant");
});

test("rpg: progression - XP and hero levels (a stat point each), talents at 3/6/10, relics and an upgraded card make a hero stronger", () => {
  const hero = rpg.newHero("warrior");
  const char = rpg.charOf(hero);
  assert.deepStrictEqual([char.level, char.xp, char.points], [1, 0, 0]);
  assert.strictEqual(rpg.gainXp(char, rpg.xpNeed(1) + rpg.xpNeed(2)), 2);
  assert.deepStrictEqual([char.level, char.points], [3, 2]);
  assert.ok(rpg.xpFor("elite", 5) > rpg.xpFor("fight", 5) && rpg.xpFor("fight", 5) > rpg.xpFor("fight", 1));
  // Talents: open at level 3 - one of two, for good
  assert.match(rpg.pickTalent(hero, 1, "berserk"), /level 6/);
  assert.match(rpg.pickTalent(hero, 0, "nonsense"), /Unknown/);
  assert.strictEqual(rpg.pickTalent(hero, 0, "ironskin"), null);
  assert.match(rpg.pickTalent(hero, 0, "rhythm"), /already/);
  assert.deepStrictEqual(rpg.talentPerks(hero), { startBlock: 8 });
  // In a fight: the talent's block at the start, a relic's damage, an upgraded strike
  const run = rpg.newRun(1, [{ name: "a", hero }]);
  rpg.enterRoom(run, 0);
  const me = run.heroes[0];
  assert.strictEqual(me.block, 8);
  run.monsters = [{ id: "m1", name: "Dummy", icon: "🎯", hp: 10000, maxHp: 10000, atk: 1, dodge: 0, moves: ["defend"], rank: "normal", effects: {}, intent: { move: "attack", target: "a" } }];
  const hit = (id) => {
    me.hand = [{ uid: "x", id }];
    me.energy = 3;
    const before = run.monsters[0].hp;
    rpg.play(run, "a", { uid: "x", target: "m1" }, () => 0.5);
    return before - run.monsters[0].hp;
  };
  me.luck = 0;
  me.attacked = true;
  const plain = hit("strike");
  assert.strictEqual(hit("strike+"), Math.round(me.atk * rpg.UPGRADE));
  rpg.giveRelic(run, me, "whetstone");
  assert.strictEqual(hit("strike"), Math.round(me.atk * 1.15));
  assert.ok(plain < hit("strike"));
  // Thorns: who hits pays
  rpg.giveRelic(run, me, "thornmail");
  run.monsters[0].intent = { move: "attack", target: "a" };
  const foeHp = run.monsters[0].hp;
  rpg.endTurn(run, "a");
  rpg.monsterTurn(run, () => 0.5);
  assert.strictEqual(run.monsters[0].hp, foeHp - 4);
  // Elites from floor 3 on: a trait
  const elites = rpg.monstersFor(3, 1, "elite").filter((m) => m.rank == "elite");
  assert.ok(elites.every((m) => rpg.AFFIXES[m.affix]));
  assert.ok(rpg.monstersFor(1, 1, "elite").every((m) => !m.affix));
});

test("rpg: collection and deck - the starter deck owned, packs bring cards (spare copies sold), the deck from 10 to deckMax, eternal cards once a run", () => {
  const hero = rpg.newHero("rogue");
  const char = rpg.charOf(hero);
  assert.strictEqual(char.deck.length, 10);
  assert.deepStrictEqual([char.collection.strike, char.collection.defend, char.collection.poisonblade], [4, 4, 1]);
  // The deck: not below DECK_MIN, only owned cards, only the class's
  assert.match(rpg.deckRemove(hero, "strike"), /At least 10/);
  assert.match(rpg.deckAdd(hero, "smoke"), /don't own/);
  assert.match(rpg.deckAdd(hero, "meteor"), /Not a card of your class/);
  // A pack: 5 cards of the class (never a basic one), the last rare or better
  for (let i = 0; i < 40; i++) {
    const pack = rpg.openPack(hero);
    assert.strictEqual(pack.length, rpg.PACK_SIZE);
    for (const card of pack) {
      assert.ok(rpg.poolOf("rogue").includes(card.id) && rpg.CARDS[card.id].rarity != "basic", card.id);
      assert.ok(card.fresh ? card.coins == 0 : card.coins > 0);
    }
    assert.notStrictEqual(rpg.CARDS[pack[4].id].rarity, "common");
  }
  // (the collection never holds more than the copies of a rarity)
  for (const [id, n] of Object.entries(char.collection)) assert.ok(n <= rpg.CARD_RARITIES[rpg.CARDS[id].rarity].copies, id);
  assert.strictEqual(rpg.deckAdd(hero, "smoke"), null);
  assert.strictEqual(rpg.deckRemove(hero, "strike"), null);
  while (char.deck.length < rpg.deckMax(char.level)) char.deck.push("defend");
  assert.match(rpg.deckAdd(hero, "flurry"), /At most/);
  assert.ok(rpg.deckMax(9) > rpg.deckMax(1));
  // An eternal card: played once - gone from the run's deck
  const run = rpg.newRun(1, [{ name: "a", hero }]);
  rpg.enterRoom(run, 0);
  const me = run.heroes[0];
  me.deck.push("timewarp");
  me.hand = [{ uid: "e", id: "timewarp" }];
  const mana = me.energy;
  assert.strictEqual(rpg.play(run, "a", { uid: "e" }), null);
  assert.strictEqual(me.energy, mana + 4);
  assert.ok(!me.deck.includes("timewarp") && me.exhausted.includes("timewarp"));
  assert.ok(!char.deck.includes("timewarp"), "the character's deck stays as it was");
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

// A player: attacks the first foe with every card it can pay (each card once - the updates may come late), then
// ends the turn (once a turn); skips the card reward; votes for the first door (options.vote)
function autoplay(socket, name, options) {
  const sent = new Set();
  const done = new Set();
  socket.on("rpgParty", (p) => {
    if (!p || !p.run || p.result) return;
    const run = p.run;
    const me = run.heroes.find((h) => h.name == name);
    if (!me) return;
    const turn = run.rooms.length + ":" + run.turn;
    if (run.phase == "fight" && !me.down && !me.ended && !done.has(turn)) {
      const foe = run.monsters.find((m) => !m.down);
      const spent = me.hand.filter((c) => sent.has(c.uid)).reduce((sum, c) => sum + rpg.CARDS[c.id].cost, 0);
      const card = me.hand.find((c) => !sent.has(c.uid) && rpg.CARDS[c.id].type == "attack" && rpg.CARDS[c.id].cost <= me.energy - spent);
      if (card && foe) {
        sent.add(card.uid);
        socket.emit("play", { uid: card.uid, target: foe.id });
      } else if (!me.hand.some((c) => sent.has(c.uid))) {
        // (every card sent was played - nothing more to do)
        done.add(turn);
        socket.emit("endTurn");
      }
    }
    if (run.phase == "between") {
      if (me.reward && !done.has("pick" + turn)) {
        done.add("pick" + turn);
        socket.emit("pick", { card: null });
      }
      if (options.vote && !(name in run.votes) && !done.has("vote" + turn)) {
        done.add("vote" + turn);
        socket.emit("vote", { door: 0 });
      }
    }
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
  assert.strictEqual(hero.cls, null);
  const noClass = h.once(alice, "rpgError");
  alice.emit("create", { floor: 1, size: 1 });
  assert.match(await noClass, /Pick a class first/);
  // The first class: free
  alice.emit("unlock", { id: "warrior" });
  const warrior = await waitFor(alice, "rpgHero", (view) => view.cls == "warrior");
  assert.strictEqual(testMode.balance("rpg_alice"), 1000000);
  assert.strictEqual(warrior.levels.atk, 0);
  alice.emit("upgrade", { stat: "atk" });
  const up = await waitFor(alice, "rpgHero", (view) => view.levels.atk == 1);
  assert.strictEqual(up.stats.atk, Math.round((rpg.STATS.atk.base + rpg.STATS.atk.per * rpg.MAIN_BONUS) * rpg.CLASSES.warrior.atk));
  assert.strictEqual(testMode.balance("rpg_alice"), 1000000 - rpg.upgradeCost(0));
  alice.emit("potion");
  await waitFor(alice, "rpgHero", (view) => view.potions == 3);
  // Another class: locked - bought, a character of its own (its own levels)
  const locked = h.once(alice, "rpgError");
  alice.emit("class", { id: "mage" });
  assert.match(await locked, /Unlock/);
  const coinsBefore = testMode.balance("rpg_alice");
  alice.emit("unlock", { id: "mage" });
  const mage = await waitFor(alice, "rpgHero", (view) => view.cls == "mage");
  assert.strictEqual(testMode.balance("rpg_alice"), coinsBefore - rpg.CLASS_PRICE);
  assert.strictEqual(mage.levels.atk, 0);
  assert.deepStrictEqual(mage.unlocked, ["warrior", "mage"]);
  alice.emit("class", { id: "warrior" });
  const back = await waitFor(alice, "rpgHero", (view) => view.cls == "warrior");
  assert.strictEqual(back.levels.atk, 1);
  // A floor not open yet
  const refused = h.once(alice, "rpgError");
  alice.emit("create", { floor: 2, size: 1 });
  assert.match(await refused, /isn't open/);

  // (strong enough to clear floor 1 for sure)
  const mine = server.test.rpg.heroOf("rpg_alice");
  for (const id of rpg.STAT_IDS) rpg.charOf(mine).levels[id] = 30;
  const before = testMode.balance("rpg_alice");
  alice.emit("create", { floor: 1, size: 1 });
  const fight = await waitFor(alice, "rpgParty", (p) => p && p.run && p.run.phase == "fight");
  assert.strictEqual(testMode.balance("rpg_alice"), before - rpg.entryCost(1));
  assert.ok(fight.run.monsters.length >= 1);
  // Not during a run
  const busy = h.once(alice, "rpgError");
  alice.emit("upgrade", { stat: "hp" });
  assert.match(await busy, /Not during a run/);
  autoplay(alice, "rpg_alice", { vote: false });
  const between = await waitFor(alice, "rpgParty", (p) => p && p.run && p.run.phase == "between");
  assert.ok(between.run.pot > 0);
  // Nobody decides: out with the loot
  const done = await waitFor(alice, "rpgParty", (p) => p && p.result == "left");
  assert.strictEqual(testMode.balance("rpg_alice"), before - rpg.entryCost(1) + done.run.pot);
  // Back to the hero (the party closes)
  alice.emit("leave");
  await waitFor(alice, "rpgParty", (p) => p == null);
  // (this tab plays no more)
  alice.close();
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
    if (!hero.cls) rpg.unlock(hero, "warrior");
    for (const id of rpg.STAT_IDS) rpg.charOf(hero).levels[id] = 30;
  }
  Object.assign(server.test.rpg.timing, { turn: 1500, decide: 3000 });
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
  alice.emit("endTurn");
  const waiting = await waitFor(bob, "rpgParty", (p) => p && p.run.heroes.find((h) => h.name == "rpg_alice").ended);
  assert.strictEqual(waiting.run.turn, 1);
  assert.ok(!waiting.run.heroes.find((h) => h.name == "rpg_bob").ended);
  // (the cards of a hero who ended the turn wait)
  const ended = h.once(alice, "rpgError");
  alice.emit("play", { uid: waiting.run.heroes.find((h) => h.name == "rpg_alice").hand[0].uid, target: waiting.run.monsters[0].id });
  assert.match(await ended, /ended your turn/);

  // Fight on - both vote for the doors (a tie: the leader), both play their cards
  autoplay(alice, "rpg_alice", { vote: true });
  autoplay(bob, "rpg_bob", { vote: true });
  bob.emit("endTurn");
  const won = await waitFor(alice, "rpgParty", (p) => p && p.result == "won", 20000);
  assert.ok(won.run.pot > 0);
  const hero = await waitFor(bob, "rpgHero", (view) => view.deepest == 1);
  assert.strictEqual(hero.maxFloor, 2);
  // (the first clear of a floor: a bonus - and XP for the character)
  assert.strictEqual(won.summary.rpg_bob.firstClear, rpg.entryCost(1));
  assert.ok(won.summary.rpg_bob.xp > 0);
  assert.strictEqual(testMode.balance("rpg_bob"), bobBefore - rpg.entryCost(1) + won.run.pot + rpg.entryCost(1));
});
