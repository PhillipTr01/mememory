const { test, before, after } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const rpg = require("../game/rpg");
const config = require("../game/config");
const testMode = require("../game/test_mode");

test("rpg: upgrades and floors get dearer, a floor opens after the one before; the map: rows of rooms (mostly fights) and paths, a fight first, the guarded gate last", () => {
  assert.strictEqual(rpg.upgradeCost(0), Math.round((config.RPG_STAT_SHARE / 100) * rpg.entryCost(1) / 100) * 100);
  assert.strictEqual(rpg.LEVEL_MAX, 100);
  assert.ok(rpg.upgradeCost(5) > rpg.upgradeCost(4));
  assert.strictEqual(rpg.upgradeCost(rpg.LEVEL_MAX), null);
  assert.strictEqual(rpg.upgradeCost(rpg.LEVEL_MAX - 1), Math.round((config.RPG_STAT_SHARE / 100) * rpg.entryCost(rpg.FLOORS) / 100) * 100);
  assert.strictEqual(rpg.entryCost(1), 10000);
  assert.strictEqual(rpg.potionPrice(1), Math.round((config.RPG_POTION_SHARE / 100) * rpg.entryCost(1) / 100) * 100);
  assert.ok(rpg.potionPrice(10) > rpg.potionPrice(9));
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
  // (every 5th floor: its boss at the end)
  assert.strictEqual(rpg.BOSS_EVERY, 5);
  const bossRun = rpg.newRun(5, [{ name: "a", hero: rpg.newHero("warrior") }]);
  assert.strictEqual(bossRun.map[bossRun.map.length - 1][0].kind, "boss");
  // The map: ROOMS rows - a fight first, the guarded gate last, 2 to 4 rooms a row between;
  // every room leads on, every room is reached, the paths never cross
  const kinds = new Map();
  for (let i = 0; i < 300; i++) {
    const run = rpg.newRun(3, [{ name: "a", hero: rpg.newHero("warrior") }]);
    const map = run.map;
    assert.strictEqual(map.length, rpg.ROOMS);
    assert.deepStrictEqual([map[0].length, map[0][0].kind, map[rpg.ROOMS - 1].length, map[rpg.ROOMS - 1][0].kind], [1, "fight", 1, "elite"]);
    assert.deepStrictEqual(run.doors, map[0]);
    for (let r = 1; r < rpg.ROOMS - 1; r++) {
      assert.ok(map[r].length >= 2 && map[r].length <= rpg.LANES);
      map[r].forEach((node) => kinds.set(node.kind, (kinds.get(node.kind) || 0) + 1));
      assert.ok(map[r].every((node) => rpg.ROOM_KINDS[node.kind] && node.kind != "elite" && !node.open));
      assert.ok(map[r].every((node) => map[r - 1].some((from) => from.next.includes(node.index))), "every room reached");
    }
    for (let r = 0; r < rpg.ROOMS - 1; r++) {
      assert.ok(map[r].every((node) => node.next.length > 0), "every room leads on");
      const edges = map[r].flatMap((node) => node.next.map((n) => [node.col, map[r + 1][n].col]));
      for (const [a, b] of edges) for (const [c, d] of edges) assert.ok(!((a < c && b > d) || (a > c && b < d)), "no crossing");
    }
    // (no camp fire or merchant right after the first fight)
    assert.ok(map[1].every((node) => node.kind != "rest" && node.kind != "merchant"));
  }
  const all = [...kinds.values()].reduce((a, b) => a + b, 0);
  const fights = (kinds.get("fight") || 0) + (kinds.get("hard") || 0);
  assert.ok(fights > all * 0.5, `fights ${fights} of ${all}`);
  assert.ok((kinds.get("rest") || 0) < all * 0.1 && (kinds.get("merchant") || 0) < all * 0.06);
  // Going through: the next rooms are the ones the room leads to
  const run = rpg.newRun(3, [{ name: "a", hero: rpg.newHero("warrior") }]);
  rpg.enterRoom(run, 0);
  run.monsters = [];
  run.phase = "between";
  run.doors = rpg.doorsFor(run);
  assert.deepStrictEqual(run.doors, run.map[0][0].next.map((i) => run.map[1][i]));
  // What a room is: not on the page - unless sensed or gone through
  const view = rpg.runView(run);
  view.map[1].forEach((node, i) => assert.strictEqual(node.kind, run.map[1][i].sensed ? run.map[1][i].kind : null));
  assert.strictEqual(view.map[0][0].kind, "fight");
  // The classes: a main stat, two signature cards in the starter deck, 43 cards of their own - more than 50 to collect
  for (const id of rpg.CLASS_IDS) {
    assert.ok(rpg.STATS[rpg.CLASSES[id].main], id);
    assert.ok(rpg.CLASSES[id].cards.length >= 45, id);
    assert.ok(rpg.poolOf(id).length >= 50, id);
    rpg.CLASSES[id].cards.forEach((card) => assert.ok(rpg.CARDS[card], card));
    assert.deepStrictEqual(rpg.starterDeck(id).slice(8), rpg.CLASSES[id].signature);
  }
  const tank = rpg.statsOf(rpg.newHero("paladin"));
  const mage = rpg.statsOf(rpg.newHero("mage"));
  assert.ok(tank.def > mage.def && mage.luck > tank.luck);
  // A level in the main stat of the class counts more (its own bonus): Strength for the warrior, Luck for the mage
  const strong = rpg.newHero("warrior");
  rpg.charOf(strong).levels = { hp: 0, atk: 4, def: 0, luck: 4, agi: 0 };
  const lucky = rpg.newHero("mage");
  rpg.charOf(lucky).levels = { hp: 0, atk: 4, def: 0, luck: 4, agi: 0 };
  const W = rpg.CLASSES.warrior, M = rpg.CLASSES.mage;
  assert.strictEqual(rpg.statsOf(strong).atk, Math.round((10 + rpg.STATS.atk.per * 4 * W.mainBonus) * W.atk + (W.atkPlus || 0)));
  assert.strictEqual(rpg.statsOf(lucky).luck, Math.round(5 + rpg.STATS.luck.per * 4 * M.mainBonus + M.luck));
  assert.strictEqual(rpg.statsOf(strong).luck, Math.round(5 + rpg.STATS.luck.per * 4 + rpg.CLASSES.warrior.luck));
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
  // Every weapon gives attack and agility, armor armor and HP, a charm luck; epic and legendary: a named bonus
  for (let i = 0; i < 300; i++) {
    const gear = rpg.makeGear(1 + (i % 30));
    if (gear.slot == "weapon") assert.ok(gear.atk > 0 && gear.agi > 0, JSON.stringify(gear));
    if (gear.slot == "armor") assert.ok(gear.def > 0 && gear.hp > 0, JSON.stringify(gear));
    if (gear.slot == "charm") assert.ok(gear.luck > 0, JSON.stringify(gear));
    if (gear.rarity == "epic" || gear.rarity == "legendary") assert.match(gear.name, / of /);
  }
  const quick = rpg.newHero("rogue");
  const dodge = rpg.statsOf(quick).agi;
  rpg.charOf(quick).gear.weapon = { slot: "weapon", atk: 3, agi: 4 };
  assert.strictEqual(rpg.statsOf(quick).agi, dodge + 4);
});

test("rpg: a new hero clears floor 1 but not floor 8 - upgrades take it deeper; a full clear pays about 1.9x the entry", () => {
  const weak = rpg.newHero("warrior");
  assert.ok(rpg.simulate(weak, 1, 200).cleared > 0.75);
  assert.ok(rpg.simulate(weak, 8, 200).cleared < 0.05);
  const strong = rpg.newHero("warrior");
  for (const id of rpg.STAT_IDS) rpg.charOf(strong).levels[id] = 35;
  const deep = rpg.simulate(strong, 8, 200);
  assert.ok(deep.cleared > 0.9, JSON.stringify(deep));
  assert.ok(deep.payback > 1.5 && deep.payback < 2.4, JSON.stringify(deep));
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
  assert.strictEqual(me.block, 2 * Math.round(5 + 0.7 * me.def));
  assert.strictEqual(me.energy, 1);
  assert.match(rpg.play(run, "a", { uid: "t3", target: "m1" }), /needs 2 mana/);
  const fresh = me.hp;
  assert.strictEqual(rpg.endTurn(run, "a"), true);
  rpg.monsterTurn(run, () => 0.5);
  // (armor first, then the block)
  assert.strictEqual(fresh - me.hp, Math.round(smash - me.def) - 2 * Math.round(5 + 0.7 * me.def));
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
  // Votes: the most win, a tie at random, nobody: leave
  assert.strictEqual(rpg.tally(party), "leave");
  rpg.vote(party, "c", 1);
  rpg.vote(party, "w", 0);
  assert.strictEqual(rpg.tally(party, () => 0), 1);
  assert.strictEqual(rpg.tally(party, () => 0.99), 0);
  rpg.vote(party, "w", 1);
  assert.strictEqual(rpg.tally(party), 1);
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

// Into a room of the kind (a door of it)
function into(run, kind) {
  run.phase = "between";
  // (never the last room of the floor)
  run.rooms = [];
  run.doors = [{ kind, sensed: false, open: false, visited: false }];
  rpg.enterRoom(run, 0);
}

test("rpg: the map - a Rogue's instinct senses what a room is; rooms to choose in (camp fire, shrine, trap, chest, encounters), the merchant sells cards, relics, potions and takes a card", () => {
  const run = rpg.newRun(1, [{ name: "a", hero: rpg.newHero("warrior") }]);
  // Sensed: everybody a little (more with instinct) - a Rogue far more
  const sensed = (cls, agi) => {
    run.heroes[0].cls = cls;
    run.heroes[0].agi = agi;
    let n = 0;
    let all = 0;
    for (let i = 0; i < 200; i++) {
      for (const row of rpg.makeMap(run).slice(1, -1)) {
        all += row.length;
        n += row.filter((node) => node.sensed).length;
      }
    }
    return n / all;
  };
  const none = sensed("warrior", 40);
  const young = sensed("rogue", 10);
  const scout = sensed("rogue", 40);
  assert.ok(none > 0.2 && none < 0.4 && none < young, String(none));
  assert.ok(young > 0.3 && young < 0.5, String(young));
  assert.ok(scout > 0.75 && scout < 0.95, String(scout));
  run.heroes[0].cls = "warrior";
  run.heroes[0].agi = 0;
  rpg.enterRoom(run, 0);
  const me = run.heroes[0];
  // A camp fire: rest (heal) or smith (a card of the deck upgraded) - one choice, what happened is shown
  into(run, "rest");
  assert.strictEqual(run.event.kind, "rest");
  assert.strictEqual(run.phase, "between");
  me.hp = 10;
  assert.match(rpg.choose(run, "a", { option: "smith", card: 99 }), /Pick a card/);
  assert.match(rpg.choose(run, "a", { option: "pray" }), /Not one of the choices/);
  assert.strictEqual(rpg.choose(run, "a", { option: "rest" }), null);
  assert.ok(me.hp > 10);
  assert.match(run.event.lines[run.event.lines.length - 1], /rests/);
  assert.match(rpg.choose(run, "a", { option: "rest" }), /chose already/);
  into(run, "rest");
  assert.strictEqual(rpg.choose(run, "a", { option: "smith", card: 0 }), null);
  assert.strictEqual(me.deck[0], "strike+");
  assert.strictEqual(rpg.cardInfo("strike+").name, "Strike+");
  // A shrine: pray (HP for damage) or walk on
  into(run, "shrine");
  me.hp = me.maxHp;
  assert.strictEqual(rpg.choose(run, "a", { option: "leave" }), null);
  assert.ok(!me.blessed && me.hp == me.maxHp);
  into(run, "shrine");
  assert.strictEqual(rpg.choose(run, "a", { option: "pray" }), null);
  assert.ok(me.blessed && me.hp < me.maxHp);
  // A trap: disarmed (luck) - gear; sneaked past - 10% damage
  into(run, "trap");
  assert.strictEqual(rpg.choose(run, "a", { option: "disarm" }, () => 0), null);
  assert.strictEqual(run.loot.a.length, 1);
  into(run, "trap");
  me.hp = me.maxHp;
  rpg.choose(run, "a", { option: "sneak" });
  assert.strictEqual(me.hp, me.maxHp - Math.round(me.maxHp * 0.1));
  // A chest: coins for the pot when the party comes in, gear when opened
  const pot = run.pot;
  into(run, "chest");
  assert.ok(run.pot > pot);
  rpg.choose(run, "a", { option: "open" }, () => 0);
  assert.strictEqual(run.loot.a.length, 2);
  // Encounters: one at random, never twice a run - the hermit takes a card, the library gives one
  const ids = new Set();
  for (let i = 0; i < Object.keys(rpg.ENCOUNTERS).length; i++) {
    into(run, "event");
    assert.ok(!ids.has(run.event.id), run.event.id);
    ids.add(run.event.id);
    const view = rpg.runView(run).event;
    assert.deepStrictEqual(view.options, rpg.ENCOUNTERS[run.event.id].options);
    const size = me.deck.length;
    if (run.event.id == "hermit") {
      assert.strictEqual(rpg.choose(run, "a", { option: "purge", card: 1 }), null);
      assert.strictEqual(me.deck.length, size - 1);
    } else if (run.event.id == "library") {
      const offer = run.event.offers.a;
      assert.strictEqual(offer.length, 5);
      assert.match(rpg.choose(run, "a", { option: "read", card: "meteor" }), /Pick one of the cards/);
      assert.strictEqual(rpg.choose(run, "a", { option: "read", card: offer[2] }), null);
      assert.strictEqual(me.deck[me.deck.length - 1], offer[2]);
    } else assert.strictEqual(rpg.choose(run, "a", { option: rpg.ENCOUNTERS[run.event.id].options[0].id }), null);
  }
  // The merchant: cards (rarer: dearer), relics, a potion, a card out of the deck - for coins (the server takes them)
  into(run, "merchant");
  const offer = run.event.offers.a;
  assert.strictEqual(offer.cards.length, 5);
  assert.strictEqual(offer.relics.length, 2);
  assert.match(rpg.choose(run, "a", { option: "rest" }), /Nothing to choose/);
  assert.strictEqual(rpg.canBuy(run, "a", "potion").price, rpg.potionPrice(1));
  // (a mage's card: never in the warrior's offer)
  assert.match(rpg.canBuy(run, "a", "meteor").error, /doesn't sell/);
  const card = offer.cards[0];
  assert.ok(rpg.canBuy(run, "a", card).price >= rpg.merchantPrices(1).card);
  const deck = me.deck.length;
  rpg.bought(run, "a", card);
  assert.strictEqual(me.deck.length, deck + 1);
  assert.match(rpg.canBuy(run, "a", card).error, /Sold/);
  rpg.bought(run, "a", offer.relics[0]);
  assert.ok(me.relics.includes(offer.relics[0]));
  // (a visit: one relic, two cards - potions up to the max)
  assert.match(rpg.canBuy(run, "a", offer.relics[1]).error, /One relic/);
  rpg.bought(run, "a", offer.cards[1]);
  assert.match(rpg.canBuy(run, "a", offer.cards[2]).error, /2 cards/);
  me.deck.pop();
  assert.strictEqual(rpg.canBuy(run, "a", "remove:0").price, rpg.merchantPrices(1).remove);
  assert.deepStrictEqual(rpg.merchantPrices(1), { card: 2500, relic: 5000, remove: 2500 }, "floor 1: 2,500 a card - growing with the entry");
  assert.ok(rpg.merchantPrices(5).card > rpg.merchantPrices(4).card);
  rpg.bought(run, "a", "remove:1");
  assert.strictEqual(me.deck.length, deck);
  assert.match(rpg.canBuy(run, "a", "remove:0").error, /one card a visit/);
  // Into the next room: the merchant is gone
  into(run, "fight");
  assert.strictEqual(run.event, null);
});

test("rpg: every card of the base set plays - on a foe, an ally, a fallen one", () => {
  for (const cls of rpg.CLASS_IDS) {
    for (const id of rpg.poolOf(cls)) {
      for (const upgraded of ["", "+"]) {
        const run = rpg.newRun(1, [{ name: "a", hero: rpg.newHero(cls) }, { name: "b", hero: rpg.newHero("warrior") }]);
        rpg.enterRoom(run, 0);
        run.monsters = [0, 1].map((i) => ({ id: "m" + i, name: "Dummy", icon: "🎯", hp: 100000, maxHp: 100000, atk: 5, dodge: 0, undead: i == 1, moves: ["attack"], rank: "normal", effects: { poison: { turns: 2, dmg: 3 } }, intent: { move: "attack", target: "a" } }));
        const me = run.heroes[0];
        if (rpg.CARDS[id].target == "fallen") {
          run.heroes[1].down = true;
          run.heroes[1].hp = 0;
        }
        me.hand = [{ uid: "x", id: id + upgraded }];
        me.energy = 9;
        me.deck.push(id + upgraded);
        const before = run.monsters.reduce((sum, m) => sum + m.hp, 0);
        assert.strictEqual(rpg.play(run, "a", { uid: "x", target: "m0", ally: "b" }), null, id + upgraded);
        if (rpg.CARDS[id].type == "attack") assert.ok(run.monsters.reduce((sum, m) => sum + m.hp, 0) < before, id + " hurts");
      }
    }
  }
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
  // (the class strength - the warrior breaks armor - and the talent)
  assert.deepStrictEqual(rpg.talentPerks(hero), { pierce: rpg.strengthOf("warrior", rpg.charOf(hero).level).perks.pierce, startBlock: 8 });
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

test("rpg: collection and deck - the starter deck owned, packs bring cards (duplicates kept), the deck from 10 to deckMax, mythic cards once a run", () => {
  const hero = rpg.newHero("rogue");
  const char = rpg.charOf(hero);
  assert.strictEqual(char.deck.length, 10);
  assert.deepStrictEqual([char.collection.strike, char.collection.defend, char.collection.poisonblade], [4, 4, 1]);
  // The deck: only owned cards, only the class's - built freely, but a run needs DECK_MIN cards
  assert.strictEqual(rpg.deckReady(hero), null);
  assert.strictEqual(rpg.deckRemove(hero, "strike"), null);
  assert.match(rpg.deckReady(hero), /at least 10/);
  assert.match(rpg.deckSet(hero, ["strike", "strike", "strike", "strike", "strike"]), /don't own that many/);
  assert.match(rpg.deckSet(hero, ["meteor"]), /Not a card of your class/);
  assert.strictEqual(rpg.deckSet(hero, []), null);
  assert.strictEqual(rpg.deckSet(hero, rpg.starterDeck("rogue")), null);
  assert.match(rpg.deckAdd(hero, "smoke"), /don't own/);
  assert.match(rpg.deckAdd(hero, "meteor"), /Not a card of your class/);
  // A pack: 5 cards of the class (never a basic one), the last rare or better
  for (let i = 0; i < 40; i++) {
    const pack = rpg.openPack(hero);
    assert.strictEqual(pack.length, rpg.PACK_SIZE);
    for (const card of pack) {
      // (another class's card: marked with its class)
      assert.ok((card.cls ? rpg.cardClass(card.id) == card.cls : rpg.poolOf("rogue").includes(card.id)) && rpg.CARDS[card.id].rarity != "basic", card.id);
      assert.strictEqual(card.coins, 0);
    }
    assert.notStrictEqual(rpg.CARDS[pack[4].id].rarity, "common");
  }
  // The shop: the base set has 50 cards and more; a hero pack: all rare or better, a mythic pack: all epic
  // or better; three at once: 10% off
  assert.ok(Object.keys(rpg.CARDS).length >= 50);
  const rank = (id) => ["basic", "common", "rare", "epic", "legendary", "mythic"].indexOf(rpg.CARDS[id].rarity);
  for (let i = 0; i < 40; i++) {
    const hero2 = rpg.newHero("mage");
    const premium = rpg.openPack(hero2, Math.random, "premium");
    assert.strictEqual(premium.length, 5);
    assert.ok(premium.every((c) => rank(c.id) >= 2));
    const mythic = rpg.openPack(hero2, Math.random, "mythic");
    assert.strictEqual(mythic.length, 4);
    assert.ok(mythic.every((c) => rank(c.id) >= 3));
  }
  assert.strictEqual(rpg.packPrice("standard", 3), rpg.PACKS.standard.price * 3, "no bundle discount");
  assert.strictEqual(rpg.packPrice("nope"), null);
  // (duplicates stay in the collection - a deck holds only the copies of a rarity)
  assert.ok(Object.entries(char.collection).some(([id, n]) => n > rpg.CARD_RARITIES[rpg.CARDS[id].rarity].copies));
  const many = Object.keys(char.collection).find((id) => rpg.CARDS[id].rarity == "legendary" && char.collection[id] > 1);
  if (many) {
    rpg.deckAdd(hero, many);
    assert.match(rpg.deckAdd(hero, many), /At most 1/);
    rpg.deckRemove(hero, many);
  }
  // (a pack's cards are random: owned for sure)
  rpg.collect(char, "smoke");
  assert.strictEqual(rpg.deckAdd(hero, "smoke"), null);
  // 10 to 15 cards - a charm makes room for more, or lets the deck go down with fewer
  assert.deepStrictEqual(rpg.deckLimits(hero), { min: 10, max: 15 });
  while (char.deck.length < 15) char.deck.push("defend");
  // (owned - the packs are random)
  if (!char.collection.flurry) rpg.collect(char, "flurry");
  assert.match(rpg.deckAdd(hero, "flurry"), /At most 15/);
  char.gear.charm = { slot: "charm", luck: 1, deckMax: 3 };
  assert.deepStrictEqual(rpg.deckLimits(hero), { min: 10, max: 18 });
  rpg.collect(char, "flurry");
  assert.strictEqual(rpg.deckAdd(hero, "flurry"), null);
  char.gear.charm = { slot: "charm", luck: 1, deckMin: 3 };
  assert.deepStrictEqual(rpg.deckLimits(hero), { min: 7, max: 15 });
  assert.match(rpg.deckReady(hero), /at most 15/);
  char.deck.splice(9);
  assert.strictEqual(rpg.deckReady(hero), null, "9 cards: fine with the charm");
  char.gear.charm = null;
  assert.match(rpg.deckReady(hero), /at least 10/);
  while (char.deck.length < 10) char.deck.push("defend");
  // The shop's cart: 3 or more of a kind 10% off - the packs wait unopened, opened one after the other
  assert.strictEqual(rpg.cartPrice({ standard: 2, mythic: 3 }).total, 2 * rpg.PACKS.standard.price + rpg.packPrice("mythic", 3));
  assert.match(rpg.cartPrice({}).error, /empty/);
  assert.match(rpg.cartPrice({ nope: 1 }).error, /Unknown/);
  assert.match(rpg.cartPrice({ standard: 1.5 }).error, /1 to/);
  rpg.addPacks(hero, [["premium", 2]]);
  assert.strictEqual(rpg.openStored(hero, "premium").length, 5);
  assert.strictEqual(hero.packs.premium, 1);
  rpg.openStored(hero, "premium");
  assert.match(rpg.openStored(hero, "premium"), /No such pack/);
  // Open all: every pack waiting
  rpg.addPacks(hero, [["standard", 2], ["mythic", 1]]);
  const all = rpg.openAll(hero);
  assert.strictEqual(all.count, 3);
  assert.strictEqual(all.cards.length, 2 * 5 + 4);
  assert.deepStrictEqual([hero.packs.standard, hero.packs.mythic], [0, 0]);
  assert.match(rpg.openAll(hero), /No packs/);
  // A mythic card: played once - gone from the run's deck
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
  // (a play refused - the foe down meanwhile: the turn ends - alone there is no clock to end it)
  let last = null;
  socket.on("rpgError", () => {
    if (!last || done.has(last)) return;
    done.add(last);
    socket.emit("endTurn");
  });
  socket.on("rpgParty", (p) => {
    if (!p || !p.run || p.result) return;
    const run = p.run;
    const me = run.heroes.find((h) => h.name == name);
    if (!me) return;
    const turn = run.rooms.length + ":" + run.turn;
    if (run.phase == "fight") last = turn;
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
  Object.assign(server.test.rpg.timing, { turn: 300, away: 300, close: 300 });
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

test("rpg: alone - upgrades and potions cost test coins, the entry too; between rooms no clock - out with the loot; dead: revived for coins", async () => {
  testMode.start("rpg_alice", 5000000);
  const alice = client("rpg_alice");
  const hero = await h.once(alice, "rpgHero");
  assert.strictEqual(hero.cls, null);
  const noClass = h.once(alice, "rpgError");
  alice.emit("create", { floor: 1, size: 1 });
  assert.match(await noClass, /Pick a class first/);
  // The first class: free
  alice.emit("unlock", { id: "warrior" });
  const warrior = await waitFor(alice, "rpgHero", (view) => view.cls == "warrior");
  assert.strictEqual(testMode.balance("rpg_alice"), 5000000);
  assert.strictEqual(warrior.levels.atk, 0);
  alice.emit("upgrade", { stat: "atk" });
  const up = await waitFor(alice, "rpgHero", (view) => view.levels.atk == 1);
  assert.strictEqual(up.stats.atk, Math.round((rpg.STATS.atk.base + rpg.STATS.atk.per * rpg.MAIN_BONUS) * rpg.CLASSES.warrior.atk));
  assert.strictEqual(testMode.balance("rpg_alice"), 5000000 - rpg.upgradeCost(0));
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
  assert.strictEqual(fight.timeLeft, null, "alone: no turn clock");
  // Not during a run
  const busy = h.once(alice, "rpgError");
  alice.emit("upgrade", { stat: "hp" });
  assert.match(await busy, /Not during a run/);
  autoplay(alice, "rpg_alice", { vote: false });
  // (alone: no clock - the first turn ended by hand, the next ones by the autoplay)
  alice.emit("endTurn");
  const between = await waitFor(alice, "rpgParty", (p) => p && p.run && p.run.phase == "between");
  assert.ok(between.run.pot > 0);
  // No clock between the rooms: out with the loot when the hero says so
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.ok(!server.test.rpg.parties.get(between.id).result);
  alice.emit("vote", { door: "leave" });
  const done = await waitFor(alice, "rpgParty", (p) => p && p.result == "left");
  assert.strictEqual(testMode.balance("rpg_alice"), before - rpg.entryCost(1) + done.run.pot);
  // Back to the hero (the party closes)
  alice.emit("leave");
  await waitFor(alice, "rpgParty", (p) => p == null);
  // Dead (the party went down): no run for 6 hours - or a revive for coins, dearer the next time today
  rpg.die(mine, "warrior");
  const dead = h.once(alice, "rpgError");
  alice.emit("create", { floor: 1, size: 1 });
  assert.match(await dead, /dead/);
  const price = rpg.revivePrice(mine);
  const coinsDead = testMode.balance("rpg_alice");
  alice.emit("revive");
  await waitFor(alice, "rpgHero", (view) => view.deadFor == 0);
  assert.strictEqual(testMode.balance("rpg_alice"), coinsDead - price);
  assert.strictEqual(rpg.revivePrice(mine), price * 2);
  // (this tab plays no more)
  alice.close();
});

test("rpg: co-op - one opens a party, another joins, the leader starts (both pay); a turn waits for both, the floor cleared opens the next", async () => {
  testMode.start("rpg_alice", 5000000);
  testMode.start("rpg_bob", 5000000);
  const alice = client("rpg_alice");
  const bob = client("rpg_bob");
  await h.once(alice, "rpgHero");
  await h.once(bob, "rpgHero");
  for (const name of ["rpg_alice", "rpg_bob"]) {
    const hero = server.test.rpg.heroOf(name);
    if (!hero.cls) rpg.unlock(hero, "warrior");
    for (const id of rpg.STAT_IDS) rpg.charOf(hero).levels[id] = 30;
  }
  Object.assign(server.test.rpg.timing, { turn: 1500 });
  alice.emit("create", { floor: 1, size: 2 });
  const open = await waitFor(bob, "rpgParties", (list) => list.some((p) => p.leader == "rpg_alice" && !p.started));
  const id = open.find((p) => p.leader == "rpg_alice").id;
  // (a party starts with two at least - alone is "Go alone")
  const alone = h.once(alice, "rpgError");
  alice.emit("start");
  assert.match(await alone, /second hero/);
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
  assert.ok(fight.timeLeft > 0, "with others: the turn clock");

  // The turn waits for both heroes
  alice.emit("endTurn");
  const waiting = await waitFor(bob, "rpgParty", (p) => p && p.run.heroes.find((h) => h.name == "rpg_alice").ended);
  assert.strictEqual(waiting.run.turn, 1);
  assert.ok(!waiting.run.heroes.find((h) => h.name == "rpg_bob").ended);
  // (the cards of a hero who ended the turn wait - a late click on one: ignored, no message)
  let told = null;
  const tell = (message) => (told = message);
  alice.on("rpgError", tell);
  alice.emit("play", { uid: waiting.run.heroes.find((h) => h.name == "rpg_alice").hand[0].uid, target: waiting.run.monsters[0].id });
  await new Promise((resolve) => setTimeout(resolve, 300));
  alice.off("rpgError", tell);
  assert.strictEqual(told, null);
  assert.strictEqual(rpg.play(server.test.rpg.parties.get(waiting.id).run, "rpg_alice", { uid: "x" }), "You ended your turn.");

  // Fight on - both vote for the doors (a tie: the leader), both play their cards
  autoplay(alice, "rpg_alice", { vote: true });
  autoplay(bob, "rpg_bob", { vote: true });
  bob.emit("endTurn");
  const won = await waitFor(alice, "rpgParty", (p) => p && p.result == "won", 20000);
  assert.ok(won.run.pot > 0);
  const hero = await waitFor(bob, "rpgHero", (view) => view.deepest == 1);
  assert.strictEqual(hero.maxFloor, 2);
  // (the first clear of a floor: a bonus - and XP for the character)
  // (a party of 2: 20% more loot and first clear bonus)
  assert.strictEqual(won.summary.rpg_bob.firstClear, Math.round((rpg.entryCost(1) * rpg.FIRST_CLEAR * rpg.partyBonus(2)) / 100) * 100);
  assert.ok(won.summary.rpg_bob.xp > 0);
  assert.strictEqual(testMode.balance("rpg_bob"), bobBefore - rpg.entryCost(1) + won.run.pot + won.summary.rpg_bob.firstClear);
});

test("rpg: the fight rules - the hand stays (filled up to 5), poison stacks and burns don't, class strengths, cards with the character's numbers", () => {
  const foe = { effects: {} };
  rpg.afflict(foe, "poison", 3, 10);
  rpg.afflict(foe, "poison", 2, 5);
  assert.deepStrictEqual(foe.effects.poison, { turns: 3, dmg: 15 });
  rpg.afflict(foe, "burn", 2, 8);
  rpg.afflict(foe, "burn", 1, 6);
  assert.deepStrictEqual(foe.effects.burn, { turns: 2, dmg: 8 });
  // (the strengths: the paladin's thorns grow with the armor)
  assert.strictEqual(rpg.thornsOf({ def: 20, perks: rpg.CLASSES.paladin.strength.perks }), 17);
  assert.ok(rpg.CLASSES.warrior.strength.perks.pierce > 0 && rpg.CLASSES.mage.strength.perks.aoe > 0);
  // (the texts: numbers, no shares)
  const texts = rpg.liveTexts({ atk: 50, def: 10, agi: 0, maxHp: 200, perks: {} }, ["strike", "defend", "heavyslash", "mend", "strike+"]);
  assert.strictEqual(texts.strike, "Deal 50 damage.");
  assert.strictEqual(texts["strike+"], "Deal 70 damage.");
  assert.match(texts.defend, /block 12\./);
  assert.match(texts.mend, /heals? \d+ HP/);
  // The hand stays from turn to turn - drawn up to 5
  const hero = rpg.newHero("warrior");
  const run = rpg.newRun(1, [{ name: "a", hero }]);
  rpg.enterRoom(run, 0, () => 0.5);
  const me = run.heroes[0];
  assert.strictEqual(me.hand.length, 5);
  me.energy = 99;
  rpg.play(run, "a", { uid: me.hand.find((c) => rpg.cardInfo(c.id).target != "foe").uid, ally: "a" }, () => 0.5);
  const kept = me.hand.map((c) => c.uid);
  run.monsters.forEach((m) => (m.atk = 0));
  rpg.monsterTurn(run, () => 0.5);
  assert.strictEqual(me.hand.length, 5);
  assert.deepStrictEqual(me.hand.slice(0, 4).map((c) => c.uid), kept);
});

test("rpg: leaving - one away doesn't hold the party up, one out of the run loses the share; dead: 6 hours or a revive, dearer the same day", () => {
  const run = rpg.newRun(1, [{ name: "a", hero: rpg.newHero("warrior") }, { name: "b", hero: rpg.newHero("mage") }]);
  rpg.enterRoom(run, 0, () => 0.5);
  rpg.endTurn(run, "a");
  assert.ok(!rpg.turnDone(run));
  rpg.setAway(run, "b", true);
  assert.ok(rpg.turnDone(run));
  run.phase = "between";
  run.votes = { a: 0 };
  assert.ok(rpg.allVoted(run));
  rpg.abandon(run, "b");
  assert.deepStrictEqual(run.heroes.map((h) => h.name), ["a"]);
  assert.strictEqual(run.gone[0].name, "b");
  rpg.abandon(run, "a");
  assert.strictEqual(run.phase, "left");
  // Death
  const hero = rpg.newHero("warrior");
  const now = new Date(2026, 5, 1, 12).getTime();
  rpg.die(hero, "warrior", now);
  assert.strictEqual(rpg.deadFor(hero, now + 1000), rpg.DEATH_COOLDOWN - 1000);
  const price = rpg.revivePrice(hero, now);
  assert.strictEqual(rpg.revive(hero, now), null);
  assert.strictEqual(rpg.deadFor(hero, now), 0);
  assert.strictEqual(rpg.revivePrice(hero, now), price * 2);
  // (midnight: the price back to the start)
  assert.strictEqual(rpg.revivePrice(hero, now + 24 * 3600 * 1000), price);
  assert.match(rpg.revive(hero, now), /isn't dead/);
  // Instinct past the knee: still grows, slower - never the max
  rpg.charOf(hero).levels.agi = 99;
  const before = rpg.statsOf(hero).agi;
  rpg.charOf(hero).levels.agi = 100;
  assert.ok(!rpg.statFull(hero, "agi"));
  assert.ok(rpg.statsOf(hero).agi > 30 && rpg.statsOf(hero).agi < 60);
  assert.ok(rpg.statsOf(hero).agi >= before);
  // The floor cooldown: a cleared floor only - the next one always open
  rpg.charOf(hero).deepest = 3;
  rpg.coolFloor(hero, 2, "warrior", now);
  rpg.coolFloor(hero, 4, "warrior", now);
  assert.ok(rpg.floorCooldown(hero, 2, now + 1000) > 0);
  assert.strictEqual(rpg.floorCooldown(hero, 3, now), 0);
  assert.strictEqual(rpg.floorCooldown(hero, 4, now), 0);
  assert.strictEqual(rpg.floorCooldown(hero, 2, now + 24 * 3600 * 1000), 0);
  // Low floors: the full loot near the deepest floor - less far under it, never under the least
  assert.strictEqual(rpg.lootShare(10, 11), 1);
  assert.strictEqual(rpg.lootShare(10, 8), 1);
  assert.ok(Math.abs(rpg.lootShare(10, 7) - 0.85) < 1e-9);
  assert.strictEqual(rpg.lootShare(30, 1), 0.1);
  // Out-of-fight abilities: the class in the party, its main-stat level
  const team = [rpg.newHero("warrior"), rpg.newHero("mage")];
  rpg.charOf(team[0]).levels.atk = 40;
  rpg.charOf(team[1]).levels.luck = 50;
  const abRun = rpg.newRun(1, team.map((hero, i) => ({ name: "h" + i, hero })));
  assert.strictEqual(rpg.abilityLevel(abRun, "warrior"), 40);
  assert.strictEqual(rpg.abilityLevel(abRun, "cleric"), null);
  assert.match(rpg.abilityOf("warrior", 40).text, /\+40% coins/);
  abRun.heroes[0].reward = ["jab", "brace", "dash"];
  for (let i = 0; i < 3; i++) assert.strictEqual(rpg.rerollReward(abRun, "h0"), null);
  assert.match(rpg.rerollReward(abRun, "h0"), /No rerolls left/);
  // Longer maps deeper down and on boss floors
  for (let i = 0; i < 20; i++) {
    assert.strictEqual(rpg.rowsFor(1), rpg.ROOMS);
    assert.strictEqual(rpg.rowsFor(5), rpg.ROOMS + 1);
    assert.ok(rpg.rowsFor(25) >= rpg.ROOMS + 2 && rpg.rowsFor(25) <= rpg.ROOMS + 4);
  }
  // A player's later characters: dearer stats, stronger monsters
  const multi = rpg.newHero("warrior");
  rpg.unlock(multi, "mage");
  assert.strictEqual(rpg.charIndex(multi), 1);
  assert.ok(rpg.statPrice(multi, 0) > rpg.upgradeCost(0));
  assert.ok(rpg.newRun(1, [{ name: "a", hero: multi }]).harder > 1);
  assert.strictEqual(rpg.newRun(1, [{ name: "a", hero: rpg.newHero("warrior") }]).harder, 1);
  // Class relics: only for their classes
  for (let i = 0; i < 30; i++) assert.ok(!rpg.relicOffer({ cls: "warrior", relics: [] }, Math.random, 5).includes("vial"));
  assert.ok(rpg.relicOffer({ cls: "rogue", relics: [] }, Math.random, 99).includes("vial"));
  // A party: the levels at most RPG_PARTY_GAP apart
  assert.strictEqual(rpg.levelGap([10, 15], 20), null);
  assert.strictEqual(rpg.levelGap([10, 15], 21), 11);
  assert.strictEqual(rpg.levelGap([], 30), null);
});

test("rpg: the bag - 5 slots, more bought up to 15, every one dearer", () => {
  const hero = rpg.newHero("warrior");
  assert.strictEqual(rpg.bagSize(hero), 5);
  const first = rpg.bagSlotPrice(hero);
  hero.bagSlots = 1;
  assert.ok(rpg.bagSlotPrice(hero) > first);
  hero.bagSlots = 10;
  assert.strictEqual(rpg.bagSize(hero), 15);
  assert.strictEqual(rpg.bagSlotPrice(hero), null);
});

test("rpg: class strengths grow with the level - the base at 1, its top times it at the highest level", () => {
  assert.strictEqual(rpg.strengthOf("warrior", 1).perks.pierce, 0.4);
  assert.strictEqual(rpg.strengthOf("warrior", rpg.HERO_LEVEL_MAX).perks.pierce, 0.6);
  assert.match(rpg.strengthOf("paladin", 1).text, /equal to 85% of your armor\. Your block cards block 17% more/);
  assert.match(rpg.strengthOf("rogue", rpg.HERO_LEVEL_MAX).text, /crit 30% more often/);
});

test("rpg: cards fit their rarity - the rarer, the more a mana buys", () => {
  // (the same kind of card: a plain hit - a legendary one hits much harder per mana than a common one)
  const perMana = (id) => rpg.CARDS[id].fx[0].hit / rpg.CARDS[id].cost;
  assert.ok(perMana("bludgeon") > perMana("heavyslash") * 1.3);
});

test("rpg: monsters - traits counter some heroes, a boss turns at half HP, summons and curses", () => {
  // Venomproof: no poison; fireproof: no burn
  assert.strictEqual(rpg.afflict({ effects: {}, traits: ["venomproof"] }, "poison", 3, 10), false);
  assert.strictEqual(rpg.afflict({ effects: {}, traits: ["fireproof"] }, "burn", 3, 10), false);
  // A boss: its own name, a second phase at half HP
  const run = rpg.newRun(5, [{ name: "a", hero: rpg.newHero("warrior") }]);
  run.doors = [run.map[run.map.length - 1][0]];
  rpg.enterRoom(run, 0, () => 0.5);
  const boss = run.monsters[0];
  assert.strictEqual(boss.name, rpg.BOSSES[0].name);
  const atk = boss.atk;
  const me = run.heroes[0];
  me.hand = [{ uid: "x", id: "strike" }];
  me.energy = 1;
  boss.hp = Math.round(boss.maxHp * 0.52);
  boss.armor = 0;
  me.atk = boss.maxHp;
  rpg.play(run, "a", { uid: "x", target: boss.id }, () => 0.5);
  assert.ok(boss.down || (boss.phased && boss.atk > atk));
  // A summon: more monsters, at most 4 standing
  const run2 = rpg.newRun(5, [{ name: "a", hero: rpg.newHero("warrior") }]);
  run2.doors = [run2.map[run2.map.length - 1][0]];
  rpg.enterRoom(run2, 0, () => 0.5);
  const lead = run2.monsters[0];
  run2.monsters.forEach((m) => (m.intent = { move: "defend" }));
  lead.intent = { move: "summon" };
  const before = run2.monsters.filter((m) => !m.down).length;
  run2.heroes[0].ended = true;
  rpg.monsterTurn(run2, () => 0.5);
  assert.ok(run2.monsters.filter((m) => !m.down).length > before && run2.monsters.filter((m) => !m.down).length <= 4);
});

test("rpg: the practice run - three rooms, one weak monster first, no coins", () => {
  const hero = rpg.newHero("warrior");
  const run = rpg.newRun(1, [{ name: "a", hero }], Math.random, { tutorial: true });
  assert.deepStrictEqual(run.map.map((row) => row[0].kind), ["fight", "rest", "fight"]);
  rpg.enterRoom(run, 0, () => 0.5);
  assert.strictEqual(run.monsters.length, 1);
  const normal = rpg.newRun(1, [{ name: "b", hero: rpg.newHero("warrior") }]);
  rpg.enterRoom(normal, 0, () => 0.5);
  assert.ok(run.monsters[0].maxHp < normal.monsters[0].maxHp);
  // (won: nothing for the pot)
  run.monsters[0].hp = 1;
  const me = run.heroes[0];
  me.hand = [{ uid: "x", id: "strike" }];
  me.energy = 1;
  rpg.play(run, "a", { uid: "x", target: run.monsters[0].id }, () => 0.5);
  assert.strictEqual(run.pot, 0);
  assert.strictEqual(run.phase, "between");
});

test("rpg: the normal casino's dungeon listens on /rpg - not a second server on the test world's (every click handled twice)", () => {
  const names = [];
  const fake = { of: (name) => (names.push(name), { use() {}, on() {}, sockets: new Map(), to: () => ({ emit() {} }), emit() {} }) };
  const live = require("../sockets/rpg_server")(fake, { world: "" });
  live.stop();
  assert.strictEqual(names[0], "/rpg");
});

test("rpg: deck slots - one at first, more bought (up to 5), each keeps its own deck", () => {
  const hero = rpg.newHero("warrior");
  assert.strictEqual(rpg.deckSlots(hero), 1);
  assert.match(rpg.useDeck(hero, 1), /No such/);
  const price = rpg.deckSlotPrice(hero);
  assert.ok(price > 0);
  hero.deckSlots = 1;
  assert.ok(rpg.deckSlotPrice(hero) > price, "dearer every time");
  const first = [...rpg.charOf(hero).deck];
  assert.strictEqual(rpg.useDeck(hero, 1), null);
  assert.deepStrictEqual(rpg.charOf(hero).deck, [], "a new slot: an empty deck");
  assert.ok(rpg.deckReady(hero), "not ready");
  rpg.charOf(hero).deck.push("strike");
  assert.strictEqual(rpg.useDeck(hero, 0), null);
  assert.deepStrictEqual(rpg.charOf(hero).deck, first);
  assert.strictEqual(rpg.useDeck(hero, 1), null);
  assert.deepStrictEqual(rpg.charOf(hero).deck, ["strike"]);
  assert.deepStrictEqual(rpg.heroView(hero).decks, [first.length, 1]);
  hero.deckSlots = 4;
  assert.strictEqual(rpg.deckSlotPrice(hero), null, "5 at most");
});

test("rpg: AURA cards - a type of their own, their block, healing or mana at the start of the next turns", () => {
  assert.strictEqual(rpg.CARDS.stoneskin.type, "aura");
  assert.strictEqual(rpg.CARDS.battlecry.type, "aura", "more damage for 2 turns: an aura too");
  assert.match(rpg.CARDS.stoneskin.text, /every turn for 3 turns/);
  const hero = rpg.newHero("warrior");
  const run = rpg.newRun(1, [{ name: "a", hero }]);
  rpg.enterRoom(run, 0);
  const me = run.heroes[0];
  me.hand.push({ uid: "aura1", id: "stoneskin" });
  me.energy = 3;
  run.monsters.forEach((m) => (m.hp = m.maxHp = 9999));
  assert.strictEqual(rpg.play(run, "a", { uid: "aura1" }), null);
  assert.strictEqual(me.auras.length, 1);
  const value = me.auras[0].value;
  rpg.endTurn(run, "a");
  rpg.monsterTurn(run, () => 0.99);
  assert.strictEqual(me.block, value, "the turn after: its block");
  assert.strictEqual(me.auras[0].turns, 2);
  assert.strictEqual(rpg.runView(run).heroes[0].auras[0].turns, 2);
  // (more mana: every class has cheap mana cards now)
  for (const cls of rpg.CLASS_IDS) assert.ok(rpg.poolOf(cls).filter((id) => rpg.CARDS[id].fx.some((f) => f.mana || f.aura == "focus") && ["common", "rare"].includes(rpg.CARDS[id].rarity)).length >= 3, cls);
});

// A deterministic random source for the balance checks
function seeded(seed) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
}

test("rpg: no fight lasts forever - from the furious turn on the monsters stop healing and hit harder every turn", () => {
  const hero = rpg.newHero("cleric");
  const run = rpg.newRun(5, [{ name: "a", hero }], seeded(7));
  rpg.enterRoom(run, 0, seeded(7));
  const me = run.heroes[0];
  // (a monster nobody can kill: it regenerates - the hero only waits)
  for (const m of run.monsters) {
    m.maxHp = m.hp = 1e6;
    m.affix = "regen";
  }
  // (a hero hard to hurt: lots of armor)
  me.def = 2000;
  const first = rpg.runView(run).monsters[0];
  let turns = 0;
  while (run.phase == "fight" && turns++ < 80) {
    rpg.endTurn(run, "a");
    rpg.monsterTurn(run, seeded(turns));
  }
  assert.strictEqual(run.phase, "lost", "the fight ended");
  assert.ok(turns < 60, `ended after ${turns} turns`);
  assert.ok(first, "a monster to look at");
  assert.ok(me.hp == 0 || me.down);
});

test("rpg: every card plays on every class without broken numbers (NaN, negative HP, endless loops)", () => {
  const rng = seeded(42);
  for (const cls of rpg.CLASS_IDS) {
    const hero = rpg.newHero(cls);
    for (const s of rpg.STAT_IDS) rpg.charOf(hero).levels[s] = 40;
    for (const id of rpg.poolOf(cls)) {
      const run = rpg.newRun(10, [{ name: "a", hero }], rng);
      rpg.enterRoom(run, 0, rng);
      const me = run.heroes[0];
      me.energy = 9;
      me.hand.push({ uid: "t", id }, { uid: "u", id: id + "+" });
      for (const uid of ["t", "u"]) {
        const card = rpg.CARDS[id];
        const foe = run.monsters.find((m) => !m.down);
        if (run.phase != "fight") break;
        rpg.play(run, "a", { uid, target: foe && foe.id, ally: "a" }, rng);
      }
      for (const one of [...run.heroes, ...run.monsters]) for (const key of ["hp", "maxHp", "block", "atk"]) assert.ok(Number.isFinite(one[key] || 0) && (one[key] || 0) >= 0, `${cls} ${id}: ${key}=${one[key]}`);
      assert.ok(Number.isFinite(run.pot) && run.pot >= 0, id);
      // (the monsters' turn after it too)
      if (run.phase == "fight") rpg.monsterTurn(run, rng);
      assert.ok(Number.isFinite(me.hp) && me.hp >= 0, `${cls} ${id}: after the monsters`);
    }
  }
});

test("rpg: the cleric's heals smite a random foe", () => {
  const hero = rpg.newHero("cleric");
  const run = rpg.newRun(1, [{ name: "a", hero }], seeded(3));
  rpg.enterRoom(run, 0, seeded(3));
  const me = run.heroes[0];
  me.perks.healHit = 0.5;
  run.monsters.forEach((m) => (m.maxHp = m.hp = 5000));
  me.hp = Math.round(me.maxHp / 2);
  me.hand.push({ uid: "h", id: "heal" });
  me.energy = 3;
  const before = run.monsters.reduce((sum, m) => sum + m.hp, 0);
  assert.strictEqual(rpg.play(run, "a", { uid: "h", ally: "a" }, seeded(3)), null);
  assert.ok(run.monsters.reduce((sum, m) => sum + m.hp, 0) < before, "a foe took the smite");
  assert.match(rpg.strengthOf("cleric", 1).text, /smites a random foe/);
});

test("rpg: balance - every class on the curve of its floor clears early, mid and late floors; far under it, deep floors are hard", () => {
  // (a character as the loot of its floor buys it: stat levels, its level, talents, gear of the stage, a deck of it)
  const stage = (floor) => (floor <= 3 ? ["common"] : floor <= 15 ? ["rare", "epic"] : ["epic", "legendary"]);
  const rarities = (floor) => (floor <= 3 ? ["basic", "common"] : floor <= 15 ? ["basic", "common", "rare", "epic"] : ["common", "rare", "epic", "legendary", "mythic"]);
  function heroFor(cls, floor, curve, rng) {
    const hero = rpg.newHero(cls);
    const char = rpg.charOf(hero);
    const lv = Math.round(Math.min(100, Math.round(((floor - 1) * 99) / 29) + 2) * curve);
    for (const s of rpg.STAT_IDS) char.levels[s] = Math.min(100, s == rpg.CLASSES[cls].main ? lv + 6 : lv);
    char.level = Math.min(rpg.HERO_LEVEL_MAX, Math.round(2 + floor * 1.6));
    rpg.TALENT_LEVELS.forEach((need, tier) => char.level >= need && (char.talents[tier] = rpg.TALENTS[cls][tier][tier % 2].id));
    for (const slot of ["weapon", "armor", "charm"])
      for (let i = 0; i < 400; i++) {
        const g = rpg.makeGear(floor, rng, 0, cls);
        if (g.slot == slot && stage(floor).includes(g.rarity) && !rpg.canWear(g, cls)) {
          char.gear[slot] = g;
          break;
        }
      }
    const pool = rpg.poolOf(cls).filter((id) => rarities(floor).includes(rpg.CARDS[id].rarity) && rpg.CARDS[id].cost < 4);
    char.deck = pool.sort(() => rng() - 0.5).slice(0, floor <= 3 ? 4 : 15);
    if (floor <= 3) char.deck.unshift(...rpg.starterDeck(cls).slice(0, 8));
    return hero;
  }
  const clear = (cls, floor, curve) => {
    const rng = seeded(floor * 97 + cls.length);
    let won = 0;
    const runs = 24;
    for (let i = 0; i < runs; i++) won += rpg.simulate(heroFor(cls, floor, curve, rng), floor, 1, rng).cleared;
    return won / runs;
  };
  for (const cls of rpg.CLASS_IDS) {
    for (const floor of [2, 12, 27]) {
      const rate = clear(cls, floor, 1);
      assert.ok(rate >= (floor == 27 ? 0.45 : 0.75), `${cls} on floor ${floor}, on its curve: ${Math.round(rate * 100)}%`);
    }
    const under = clear(cls, 27, 0.2);
    assert.ok(under <= 0.6, `${cls} far under its curve on floor 27: ${Math.round(under * 100)}%`);
  }
});

test("rpg: a party heal of the cleric smites once - not once for every hero it heals", () => {
  const cleric = rpg.newHero("cleric");
  const other = rpg.newHero("warrior");
  const run = rpg.newRun(1, [{ name: "c", hero: cleric }, { name: "w", hero: other }], seeded(5));
  rpg.enterRoom(run, 0, seeded(5));
  const me = run.heroes[0];
  me.perks.healHit = 0.5;
  run.monsters.forEach((m) => (m.maxHp = m.hp = 50000));
  me.hand.push({ uid: "p", id: "prayer" });
  me.energy = 3;
  const seen = run.fxSeq || 0;
  assert.strictEqual(rpg.play(run, "c", { uid: "p" }, seeded(5)), null);
  const hits = run.fx.filter((e) => e.id > seen && e.k == "hit");
  assert.strictEqual(hits.length, 1);
});

test("rpg: a boss calls at most 4 monsters a fight - none once the monsters are furious", () => {
  const hero = rpg.newHero("warrior");
  const run = rpg.newRun(10, [{ name: "a", hero }], seeded(11));
  rpg.enterRoom(run, 0, seeded(11));
  const boss = run.monsters[0];
  boss.moves = ["summon"];
  boss.maxHp = boss.hp = 1e6;
  run.heroes[0].def = 5000;
  run.heroes[0].maxHp = run.heroes[0].hp = 1e7;
  const start = run.monsters.length;
  let calls = 0;
  for (let turn = 0; turn < 10 && run.phase == "fight"; turn++) {
    run.monsters.filter((m) => m != boss).forEach((m) => ((m.hp = 0), (m.down = true)));
    rpg.endTurn(run, "a");
    rpg.monsterTurn(run, seeded(turn));
    calls = run.monsters.length - start;
  }
  assert.ok(boss.summoned > 0 && boss.summoned <= 4, `summoned ${boss.summoned}`);
  assert.ok(calls <= 4, `called ${calls}`);
});
