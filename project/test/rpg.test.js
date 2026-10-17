const { test, before, after } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const rpg = require("../game/rpg");
const config = require("../game/config");
const testMode = require("../game/test_mode");
// (a price as the game rounds it: to 10 under 1,000, to 50 under 10,000, else to 100)
const price = (v) => { const step = v < 1000 ? 10 : v < 10000 ? 50 : 100; return Math.max(10, Math.round(v / step) * step); };

test("rpg: upgrades and floors get dearer, a floor opens after the one before; the map: rows of rooms (mostly fights) and paths, a fight first, the guarded gate last", () => {
  assert.strictEqual(rpg.upgradeCost(0), price((config.RPG_STAT_SHARE / 100) * rpg.entryCost(1)));
  assert.strictEqual(rpg.LEVEL_MAX, 100);
  assert.ok(rpg.upgradeCost(5) > rpg.upgradeCost(4));
  assert.strictEqual(rpg.upgradeCost(rpg.LEVEL_MAX), null);
  assert.strictEqual(rpg.upgradeCost(rpg.LEVEL_MAX - 1), price((config.RPG_STAT_SHARE / 100) * rpg.entryCost(rpg.FLOORS)));
  assert.strictEqual(rpg.entryCost(1), 2500);
  assert.strictEqual(rpg.potionPrice(1), price((config.RPG_POTION_SHARE / 100) * rpg.entryCost(1)));
  assert.ok(rpg.potionPrice(10) > rpg.potionPrice(9));
  assert.ok(rpg.entryCost(10) > rpg.entryCost(9));
  // A new hero: no class yet - the first one free, every other one a character of its own for CLASS_PRICE
  const fresh = rpg.newHero();
  assert.strictEqual(fresh.cls, null);
  assert.strictEqual(rpg.classPrice(fresh), 0);
  const hero = rpg.newHero("warrior");
  assert.deepStrictEqual([hero.cls, hero.unlocked, rpg.classPrice(hero)], ["warrior", ["warrior"], rpg.CLASS_PRICE]);
  // (every next character: twice as much)
  const many = rpg.newHero("warrior");
  rpg.unlock(many, "rogue");
  assert.strictEqual(rpg.classPrice(many), rpg.CLASS_PRICE * 2);
  rpg.unlock(many, "mage");
  assert.strictEqual(rpg.classPrice(many), rpg.CLASS_PRICE * 4);
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
    if (["epic", "legendary", "mythic"].includes(gear.rarity)) assert.match(gear.name, / of /);
  }
  const quick = rpg.newHero("rogue");
  const dodge = rpg.statsOf(quick).agi;
  rpg.charOf(quick).gear.weapon = { slot: "weapon", atk: 3, agi: 4 };
  assert.strictEqual(rpg.statsOf(quick).agi, dodge + 4);
});

test("rpg: a new hero clears floor 1 most of the time but not floor 8 - upgrades take it deeper; a full clear pays about 3x the entry (2.5x on average with the losses)", () => {
  const weak = rpg.newHero("warrior");
  const first = rpg.simulate(weak, 1, 300).cleared;
  assert.ok(first > 0.55 && first < 0.9, String(first));
  assert.ok(rpg.simulate(weak, 8, 200).cleared < 0.05);
  const strong = rpg.newHero("warrior");
  for (const id of rpg.STAT_IDS) rpg.charOf(strong).levels[id] = 70;
  const deep = rpg.simulate(strong, 8, 200);
  assert.ok(deep.cleared > 0.9, JSON.stringify(deep));
  assert.ok(deep.payback > 2.6 && deep.payback < 3.8, JSON.stringify(deep));
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
  assert.ok(none > 0.24 && none < 0.36 && none < scout, String(none));
  assert.ok(young > 0.14 && young < 0.24, String(young));
  assert.ok(scout > 0.4 && scout < 0.52, String(scout));
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
  // (gear - and, with luck, a card for the collection)
  assert.strictEqual(run.loot.a.filter((item) => !item.card).length, 2);
  assert.ok(run.loot.a.some((item) => item.card));
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
  assert.deepStrictEqual(rpg.merchantPrices(1), { card: 630, relic: 1260, remove: 630 }, "floor 1: a quarter of the entry a card - growing with the entry");
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
  assert.deepStrictEqual(rpg.talentPerks(hero), { pierce: rpg.strengthOf("warrior", rpg.charOf(hero).level).perks.pierce, ...rpg.TALENTS.warrior[0][0].perks });
  // In a fight: the talent's block at the start, a relic's damage, an upgraded strike
  const run = rpg.newRun(1, [{ name: "a", hero }]);
  rpg.enterRoom(run, 0);
  const me = run.heroes[0];
  assert.strictEqual(me.block, rpg.TALENTS.warrior[0][0].perks.startBlock);
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
  assert.deepStrictEqual([hero.packs.premium, hero.packs.standard], [1, 2], "a Hero Pack and two Base Set Packs to start with");
  assert.strictEqual(char.deck.length, 10);
  assert.deepStrictEqual([char.collection.strike, char.collection.defend, char.collection.dodgeroll, char.collection.poisonblade], [4, 2, 2, 1]);
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
  assert.strictEqual(hero.packs.premium, 2);
  rpg.openStored(hero, "premium");
  rpg.openStored(hero, "premium");
  assert.match(rpg.openStored(hero, "premium"), /No such pack/);
  // Open all: every pack waiting
  rpg.addPacks(hero, [["standard", 2], ["mythic", 1]]);
  const all = rpg.openAll(hero);
  // (the two Base Set Packs every new character starts with too)
  assert.strictEqual(all.count, 5);
  assert.strictEqual(all.cards.length, 4 * 5 + 4);
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
  // (where it waited from - a timeout says which wait it was)
  const from = (new Error().stack.split("\n")[2] || "").trim();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timeout waiting for "${event}" ${from}`));
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
    // (a new turn: what was sent before is forgotten - the hand stays, a card the clock beat stays in it)
    if (run.phase == "fight" && last != turn) sent.clear();
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
        // (the floor cleared, the deep stairs waiting: out with the loot)
        socket.emit("vote", { door: run.cleared ? "leave" : 0 });
      }
    }
  });
}

before(async () => {
  server = await h.startServer();
  for (const name of ["rpg_alice", "rpg_bob", "rpg_real", "rpg_tia", "rpg_tom", "rpg_rex"]) tokens[name] = h.addUser(name);
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
  const cls = rpg.CLASSES.warrior;
  assert.strictEqual(up.stats.atk, Math.round((rpg.STATS.atk.base + rpg.STATS.atk.per * cls.mainBonus) * cls.atk + cls.atkPlus));
  assert.strictEqual(testMode.balance("rpg_alice"), 5000000 - rpg.upgradeCost(0));
  alice.emit("potion");
  await waitFor(alice, "rpgHero", (view) => view.potions == 3);
  // The auto refill: on - filled up right away (each at the potion price), off again
  const mine0 = server.test.rpg.heroOf("rpg_alice");
  const wallet = testMode.balance("rpg_alice");
  alice.emit("autoPotions", { on: true });
  const full = await waitFor(alice, "rpgHero", (view) => view.autoPotions && view.potions == view.potionsMax);
  assert.strictEqual(testMode.balance("rpg_alice"), wallet - (full.potionsMax - 3) * rpg.potionPrice(rpg.maxFloor(mine0)));
  alice.emit("autoPotions", { on: false });
  await waitFor(alice, "rpgHero", (view) => !view.autoPotions);
  mine0.potions = 3;
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
  // (left before the floor was cleared: the run does not count for today)
  assert.strictEqual(rpg.runsToday(mine, 1), 0);
  // Back to the hero (the party closes)
  alice.emit("leave");
  await waitFor(alice, "rpgParty", (p) => p == null);
  // Dead (the party went down): no run for 3 hours - or a revive for coins, dearer the next time today
  rpg.die(mine, "warrior");
  const dead = h.once(alice, "rpgError");
  alice.emit("create", { floor: 1, size: 1 });
  assert.match(await dead, /dead/);
  // (the first revive of the day: free)
  assert.strictEqual(rpg.revivePrice(mine), 0);
  const coinsDead = testMode.balance("rpg_alice");
  alice.emit("revive");
  await waitFor(alice, "rpgHero", (view) => view.deadFor == 0);
  assert.strictEqual(testMode.balance("rpg_alice"), coinsDead);
  // (the second one costs)
  rpg.die(mine, "warrior");
  const price = rpg.revivePrice(mine);
  assert.ok(price > 0);
  alice.emit("revive");
  await waitFor(alice, "rpgHero", (view) => view.deadFor == 0);
  assert.strictEqual(testMode.balance("rpg_alice"), coinsDead - price);
  // (1.25 times as much - rounded to the price steps)
  assert.ok(Math.abs(rpg.revivePrice(mine) - price * 1.25) <= 50, String(rpg.revivePrice(mine)));
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
  assert.strictEqual(rpg.thornsOf({ def: 20, perks: rpg.CLASSES.paladin.strength.perks }), 11);
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

test("rpg: leaving - one away doesn't hold the party up, one out of the run loses the share; dead: 3 hours or a revive, dearer the same day", () => {
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
  // (the first of the day free, then dearer every time)
  assert.strictEqual(rpg.revivePrice(hero, now), 0);
  assert.strictEqual(rpg.revive(hero, now), null);
  assert.strictEqual(rpg.deadFor(hero, now), 0);
  const price = rpg.revivePrice(hero, now);
  assert.ok(price > 0);
  rpg.die(hero, "warrior", now);
  assert.strictEqual(rpg.revive(hero, now), null);
  assert.ok(Math.abs(rpg.revivePrice(hero, now) - price * 1.25) <= 50, String(rpg.revivePrice(hero, now)));
  // (midnight: free again)
  assert.strictEqual(rpg.revivePrice(hero, now + 24 * 3600 * 1000), 0);
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
  // (the party fell on floor 4: no cooldown on top of the death)
  rpg.warmFloor(hero, 4, "warrior");
  assert.ok(!rpg.charOf(hero, "warrior").cooldowns[4]);
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
  // (the reroll: only the mage's own reward)
  abRun.heroes[0].reward = ["jab", "brace", "dash"];
  assert.match(rpg.rerollReward(abRun, "h0"), /Only a mage/);
  abRun.heroes[1].reward = ["jab", "brace", "dash"];
  for (let i = 0; i < 3; i++) assert.strictEqual(rpg.rerollReward(abRun, "h1"), null);
  assert.match(rpg.rerollReward(abRun, "h1"), /No rerolls left/);
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
  assert.strictEqual(rpg.strengthOf("warrior", 1).perks.pierce, 0.15);
  assert.strictEqual(rpg.strengthOf("warrior", rpg.HERO_LEVEL_MAX).perks.pierce, Math.round(0.15 * rpg.CLASSES.warrior.strength.top * 1000) / 1000);
  assert.match(rpg.strengthOf("paladin", 1).text, /equal to 55% of your armor\. Your block cards block 11% more/);
  assert.match(rpg.strengthOf("mage", rpg.HERO_LEVEL_MAX).text, /crit 30% more often/);
});

test("rpg: cards fit their rarity - the rarer, the more a mana buys", () => {
  // (the same kind of card: a plain hit - a legendary one hits much harder per mana than a common one)
  const perMana = (id) => rpg.CARDS[id].fx[0].hit / rpg.CARDS[id].cost;
  assert.ok(perMana("bludgeon") > perMana("heavyslash") * 1.3);
});

test("rpg: monsters - traits counter some heroes, a boss turns at half HP, summons and curses", () => {
  // Venomproof: half the poison; fireproof: half the burn
  const proof = { effects: {}, traits: ["venomproof", "fireproof"] };
  rpg.afflict(proof, "poison", 3, 10);
  rpg.afflict(proof, "burn", 3, 10);
  assert.deepStrictEqual(proof.effects, { poison: { turns: 3, dmg: 5 }, burn: { turns: 3, dmg: 5 } });
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
  assert.match(rpg.CARDS.stoneskin.text, /at the start of your next 3 turns/);
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

test("rpg: the cleric's heals smite every foe", () => {
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
  assert.match(rpg.strengthOf("cleric", 1).text, /smites every foe/);
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
  // (far under the curve: more runs - a few lucky ones don't tip it)
  const clear = (cls, floor, curve) => {
    const rng = seeded(floor * 97 + cls.length);
    let won = 0;
    const runs = curve < 1 ? 48 : 24;
    for (let i = 0; i < runs; i++) won += rpg.simulate(heroFor(cls, floor, curve, rng), floor, 1, rng).cleared;
    return won / runs;
  };
  // (every class has a fair chance, the classes together clear about three of four runs)
  const rates = [];
  for (const cls of rpg.CLASS_IDS) {
    for (const floor of [2, 12, 27]) {
      const rate = clear(cls, floor, 1);
      rates.push(rate);
      assert.ok(rate >= (floor == 27 ? 0.4 : 0.45), `${cls} on floor ${floor}, on its curve: ${Math.round(rate * 100)}%`);
    }
    const under = clear(cls, 27, 0.2);
    assert.ok(under <= 0.4, `${cls} far under its curve on floor 27: ${Math.round(under * 100)}%`);
  }
  const average = rates.reduce((a, b) => a + b, 0) / rates.length;
  assert.ok(average > 0.65 && average < 0.95, `on the curve: ${Math.round(average * 100)}%`);
});

test("rpg: a party heal of the cleric smites every foe once - not once for every hero it heals", () => {
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
  // (one smite on every foe - not one for every hero healed)
  assert.strictEqual(hits.length, run.monsters.filter((m) => !m.down).length);
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

test("rpg: a hit on a hero tells what its armor took and how much block is left", () => {
  const run = { log: [], heroes: [] };
  const hero = { name: "a", hp: 100, maxHp: 100, def: 10, block: 5, agi: 0, perks: {}, effects: {} };
  rpg.hurt(run, hero, 20, "Rat", () => 0.99);
  const hit = run.fx.find((e) => e.k == "hit");
  // (20 against 10 armor: 13 come through - 7 taken by the armor, 5 by the block, 8 hurt)
  assert.deepStrictEqual([hit.n, hit.b, hit.a, hit.left], [8, 5, 7, 0]);
  assert.strictEqual(hero.hp, 92);
});

test("rpg: the frail classes start with their own guard card - older characters get its copies", () => {
  for (const id of ["rogue", "mage"]) {
    const guard = rpg.CLASSES[id].guard;
    assert.ok(rpg.poolOf(id).includes(guard), id);
    const n = rpg.CLASSES[id].guardCount || 2;
    assert.strictEqual(rpg.starterDeck(id).filter((c) => c == guard).length, n);
    assert.strictEqual(rpg.starterDeck(id).filter((c) => c == "defend").length, 4 - n);
    // (an old character with the old starter deck)
    const hero = rpg.newHero(id);
    const old = ["strike", "strike", "strike", "strike", "defend", "defend", "defend", "defend", ...rpg.CLASSES[id].signature];
    const counts = {};
    old.forEach((c) => (counts[c] = (counts[c] || 0) + 1));
    hero.chars[id] = { ...rpg.charOf(hero, id), deck: [...old], collection: counts, guarded: false };
    const char = rpg.charOf(hero, id);
    assert.strictEqual(char.collection[guard], n);
    assert.deepStrictEqual(char.deck, rpg.starterDeck(id));
  }
  assert.strictEqual(rpg.starterDeck("paladin").filter((c) => c == "defend").length, 4);
});

test("rpg: every card gets better when upgraded - and the page can say how", () => {
  for (const id of Object.keys(rpg.CARDS)) {
    const card = rpg.CARDS[id];
    const up = rpg.cardInfo(id + "+");
    const stronger = card.fx.some((f) => f.status == "poison" || f.status == "burn");
    assert.ok(up.text != card.text || up.cost < card.cost || stronger, id);
    assert.ok(rpg.upgradeNote(id).length > 0, id);
  }
  // (a card of draws: one more card; a card without a number: 1 mana less)
  assert.strictEqual(rpg.cardInfo("focus+").fx[0].draw, rpg.CARDS.focus.fx[0].draw + 1);
  assert.strictEqual(rpg.cardInfo("smoke+").cost, rpg.CARDS.smoke.cost - 1);
  assert.match(rpg.upgradeNote("strike"), /40% more damage/);
});

test("rpg: the deck rule - a basic card up to 4 times, a legendary or mythic card once, any other twice", () => {
  const legendary = Object.keys(rpg.CARDS).find((id) => rpg.CARDS[id].rarity == "legendary");
  const common = Object.keys(rpg.CARDS).find((id) => rpg.CARDS[id].rarity == "common");
  assert.strictEqual(rpg.deckRule(["strike", "strike", "strike"], "strike"), null);
  assert.match(rpg.deckRule(["strike", "strike", "strike", "strike+"], "strike"), /At most 4/);
  assert.strictEqual(rpg.deckRule([common], common + "+"), null);
  assert.match(rpg.deckRule([common, common + "+"], common), /At most 2/);
  assert.match(rpg.deckRule([legendary], legendary), /Only one/);
  // (an old deck: cut to the rule when the character loads, the cards stay owned)
  const hero = rpg.newHero("warrior");
  hero.chars.warrior = { ...rpg.charOf(hero), deck: [common, common, common, "strike"], collection: { [common]: 3, strike: 1 }, ruled: false };
  assert.deepStrictEqual(rpg.charOf(hero).deck, [common, common, "strike"]);
  assert.strictEqual(rpg.charOf(hero).collection[common], 3);
});

test("rpg: the deep stairs - sometimes the end of a floor leads deeper; won, the pot doubles", () => {
  const hero = rpg.newHero("warrior");
  const run = rpg.newRun(3, [{ name: "a", hero }], seeded(9), { deeper: 1 });
  // (the last room of the floor won)
  run.rooms = run.map.map(() => ({ kind: "fight", done: true }));
  run.at = { row: run.map.length - 1, index: 0 };
  run.pot = 1000;
  rpg.afterRoom(run, () => 0);
  assert.strictEqual(run.phase, "between");
  assert.strictEqual(run.cleared, true);
  assert.deepStrictEqual(run.doors.map((d) => d.kind), ["deep"]);
  assert.strictEqual(rpg.runView(run).cleared, true);
  // (down: the floor's boss risen from the deep, stronger than the floor's boss)
  rpg.enterRoom(run, 0, seeded(3));
  assert.strictEqual(run.phase, "fight");
  assert.match(run.monsters[0].name, /^Deep /);
  const boss = rpg.monstersFor(3, 1, "boss", seeded(3))[0];
  assert.ok(run.monsters[0].maxHp > boss.maxHp * 0.9);
  // (won: the pot twice)
  run.monsters = [];
  rpg.afterRoom(run, () => 0);
  assert.strictEqual(run.phase, "won");
  assert.strictEqual(run.pot, 2000);
  // (no stairs without the option - the simulations, the practice run)
  const plain = rpg.newRun(3, [{ name: "a", hero }], seeded(9));
  plain.rooms = plain.map.map(() => ({ kind: "fight", done: true }));
  rpg.afterRoom(plain, () => 0);
  assert.strictEqual(plain.phase, "won");
});

test("rpg: a cursed chest - breaking the seal triples the coins, the next fight is far harder", () => {
  const hero = rpg.newHero("warrior");
  const run = rpg.newRun(3, [{ name: "a", hero }, { name: "b", hero: rpg.newHero("mage") }], seeded(4));
  run.doors = [{ kind: "chest", row: 0, index: 0, open: true }];
  rpg.enterRoom(run, 0, () => 0.01);
  assert.strictEqual(run.event.cursed, true);
  assert.ok(rpg.runView(run).event.options.some((o) => o.id == "seal"));
  const pot = run.pot;
  // (a party votes: nothing happens before everyone voted - then once, for everyone)
  assert.strictEqual(rpg.choose(run, "a", { option: "seal" }, seeded(1)), null);
  assert.strictEqual(run.pot, pot);
  assert.strictEqual(rpg.choose(run, "b", { option: "seal" }, seeded(1)), null);
  assert.strictEqual(run.pot, pot + run.event.coins * 2);
  assert.deepStrictEqual(run.event.choices, { a: "seal", b: "seal" });
  // (the next fight: cursed monsters)
  run.doors = [{ kind: "fight", row: 1, index: 0, open: true }];
  rpg.enterRoom(run, 0, seeded(2));
  assert.ok(run.monsters.every((m) => m.cursed));
  assert.strictEqual(run.curse, false);
});

test("rpg: combo cards hit far harder after a skill this turn - the next turn starts fresh", () => {
  const hit = (hand, skillFirst) => {
    const run = duel("warrior", "defend", hand);
    const me = run.heroes[0];
    me.luck = 0;
    me.energy = 3;
    if (skillFirst) assert.strictEqual(rpg.play(run, "a", { uid: "t1" }, () => 0.5), null);
    const before = run.monsters[0].hp;
    assert.strictEqual(rpg.play(run, "a", { uid: "t0", target: "m1" }, () => 0.5), null);
    return before - run.monsters[0].hp;
  };
  const plain = hit(["followthrough", "defend"], false);
  const combo = hit(["followthrough", "defend"], true);
  assert.ok(combo > plain * 2, `${plain} -> ${combo}`);
  assert.match(rpg.CARDS.followthrough.text, /if you played a skill this turn/);
});

test("rpg: elite affixes - splitting at half HP, thieving cards, acting twice", () => {
  // Splitting: at half HP two of it, the HP shared
  let run = duel("warrior", "defend", ["strike"]);
  let foe = run.monsters[0];
  foe.affix = "splitter";
  foe.hp = 400;
  rpg.splitCheck(run, foe);
  assert.strictEqual(run.monsters.length, 2);
  assert.deepStrictEqual(run.monsters.map((m) => m.hp), [200, 200]);
  rpg.splitCheck(run, foe);
  assert.strictEqual(run.monsters.length, 2, "once");
  // Thieving: a hit takes a card of the hand for the fight
  run = duel("warrior", "attack", ["strike", "defend"]);
  foe = run.monsters[0];
  foe.affix = "thief";
  const me = run.heroes[0];
  me.block = 0;
  me.agi = 0;
  rpg.monsterMove(run, foe, () => 0.5);
  assert.strictEqual(me.hand.length, 1);
  assert.strictEqual(me.exhausted.length, 1);
  // Hasty: two moves a turn
  run = duel("warrior", "attack", ["strike"]);
  run.monsters[0].affix = "hasty";
  run.heroes[0].agi = 0;
  rpg.monsterTurn(run, () => 0.5);
  assert.strictEqual(run.fx.filter((e) => e.k == "move" && e.by == "m1").length, 2);
});

test("rpg: a party votes in a room - the most votes happen for everyone, a card picked for who voted otherwise", () => {
  const run = rpg.newRun(3, [{ name: "a", hero: rpg.newHero("warrior") }, { name: "b", hero: rpg.newHero("mage") }, { name: "c", hero: rpg.newHero("rogue") }], seeded(4));
  run.doors = [{ kind: "rest", row: 0, index: 0, open: true }];
  rpg.enterRoom(run, 0, seeded(1));
  for (const h of run.heroes) h.hp = Math.round(h.maxHp / 2);
  // (the vote: the option first - no card yet)
  assert.strictEqual(rpg.choose(run, "a", { option: "smith" }, seeded(1)), null);
  assert.strictEqual(rpg.choose(run, "b", { option: "rest" }, seeded(1)), null);
  assert.match(rpg.choose(run, "b", { option: "smith" }, seeded(1)), /already/);
  assert.ok(run.heroes.every((h) => h.hp == Math.round(h.maxHp / 2)), "nothing yet");
  assert.strictEqual(rpg.choose(run, "c", { option: "smith" }, seeded(1)), null);
  // (smith won 2:1 - now every hero picks its own card to upgrade, b too)
  assert.strictEqual(run.event.chosen, "smith");
  assert.deepStrictEqual(Object.values(run.event.choices), [null, null, null]);
  assert.match(rpg.choose(run, "b", { option: "rest" }, seeded(1)), /another option/);
  assert.strictEqual(rpg.choose(run, "a", { option: "smith", card: 0 }, seeded(1)), null);
  assert.strictEqual(rpg.choose(run, "b", { option: "smith", card: 2 }, seeded(1)), null);
  assert.strictEqual(rpg.choose(run, "c", { option: "smith", card: 1 }, seeded(1)), null);
  assert.deepStrictEqual(Object.values(run.event.choices), ["smith", "smith", "smith"]);
  assert.ok(run.heroes[0].deck[0].endsWith("+") && run.heroes[1].deck[2].endsWith("+") && run.heroes[2].deck[1].endsWith("+"));
  assert.ok(run.heroes.every((h) => h.hp == Math.round(h.maxHp / 2)), "nobody rested");
});

test("rpg: a taunt turns the foes about to hit another hero to the one taunting - the page sees the switch", () => {
  const run = rpg.newRun(1, [{ name: "a", hero: rpg.newHero("paladin") }, { name: "b", hero: rpg.newHero("mage") }], seeded(3));
  rpg.enterRoom(run, 0, seeded(3));
  run.monsters = [{ id: "m1", name: "Dummy", icon: "🎯", hp: 500, maxHp: 500, atk: 10, dodge: 0, moves: ["attack"], rank: "normal", effects: {}, intent: { move: "attack", target: "b" } }];
  const me = run.heroes[0];
  me.hand = [{ uid: "t", id: "taunt" }];
  me.energy = 3;
  assert.strictEqual(rpg.play(run, "a", { uid: "t" }, () => 0.5), null);
  assert.strictEqual(run.monsters[0].intent.target, "a");
  assert.deepStrictEqual(run.fx.find((e) => e.k == "taunt").foes, ["m1"]);
});

test("rpg: every card's bonus can happen - its class has a common or rare card for the state it needs", () => {
  for (const cls of rpg.CLASS_IDS) {
    const pool = rpg.poolOf(cls);
    const makes = new Set();
    for (const id of pool) if (["basic", "common", "rare"].includes(rpg.CARDS[id].rarity)) for (const f of rpg.CARDS[id].fx) if (f.status) makes.add(f.status);
    for (const id of pool)
      for (const f of rpg.CARDS[id].fx) {
        if (!f.bonusIf) continue;
        const states = f.bonusIf.split("|");
        // (the foe's own kind, a boss, summoned, the hero's HP or a skill played: always possible)
        const free = states.some((k) => !["poison", "burn", "chill", "stun"].includes(k));
        assert.ok(free || states.some((k) => makes.has(k)), `${cls}: ${id} needs ${f.bonusIf}`);
      }
  }
  // Every monster move says what it does
  for (const [id, move] of Object.entries(rpg.MOVES)) assert.ok(move.text, id);
});

test("rpg: gear gets rarer the shallower the floor - legendary items are a deep floors' find", () => {
  const share = (floor, rarity) => {
    let n = 0;
    const rng = seeded(floor * 7);
    for (let i = 0; i < 3000; i++) if (rpg.makeGear(floor, rng, 5).rarity == rarity) n++;
    return n / 3000;
  };
  assert.ok(share(1, "legendary") < 0.015);
  assert.ok(share(30, "legendary") > share(1, "legendary") * 2.5);
  assert.ok(share(30, "epic") > share(1, "epic") * 1.8);
});

test("rpg: a mana aura pays at the start of the next turns - the page sees it", () => {
  // (a fixed dummy that only guards: nothing random in the way)
  const run = duel("warrior", "defend", ["steadybreath"]);
  const me = run.heroes[0];
  me.energy = rpg.ENERGY;
  assert.strictEqual(rpg.play(run, "a", { uid: "t0" }), null);
  assert.strictEqual(me.energy, rpg.ENERGY - 1);
  rpg.endTurn(run, "a");
  rpg.monsterTurn(run);
  assert.strictEqual(me.energy, rpg.ENERGY + 1);
  assert.ok(run.fx.some((e) => e.k == "mana" && e.to == "a" && e.n == 1));
  rpg.endTurn(run, "a");
  rpg.monsterTurn(run);
  assert.strictEqual(me.energy, rpg.ENERGY + 1);
  rpg.endTurn(run, "a");
  rpg.monsterTurn(run);
  assert.strictEqual(me.energy, rpg.ENERGY);
});

test("rpg: cards as loot - a boss always drops one, rare or better, for the collection", () => {
  const hero = rpg.newHero("mage");
  for (let i = 0; i < 50; i++) {
    const { card } = rpg.lootCard(hero, Math.random, "rare");
    assert.ok(!["basic", "common", "mythic"].includes(rpg.CARDS[card].rarity), card);
  }
  // A boss won: a card in the loot of every hero standing
  const run = rpg.newRun(5, [{ name: "a", hero }], seeded(2));
  run.doors = [{ kind: "boss", row: 0, index: 0, open: true }];
  rpg.enterRoom(run, 0, seeded(2));
  for (const m of run.monsters) {
    m.hp = 0;
    m.down = true;
  }
  rpg.winFight(run, seeded(3));
  assert.ok(run.loot.a.some((item) => item.card && rpg.CARDS[item.card]));
});

test("rpg: might stacks - every play 30% more, the longest turns count, the card numbers show it", () => {
  const run = duel("warrior", "attack", ["battlecry", "battlecry", "strike"]);
  const me = run.heroes[0];
  const before = rpg.runView(run).heroes[0].texts.strike;
  assert.strictEqual(rpg.play(run, "a", { uid: "t0" }), null);
  assert.strictEqual(rpg.play(run, "a", { uid: "t1" }), null);
  assert.deepStrictEqual(me.effects.might, { turns: 2, n: 2 });
  const view = rpg.runView(run).heroes[0];
  assert.strictEqual(view.might, 2);
  const number = (text) => Number(text.match(/(\d+) damage/)[1]);
  assert.ok(Math.abs(number(view.texts.strike) - number(before) * 1.6) <= 1, view.texts.strike + " vs " + before);
  me.energy = 5;
  const hp = run.monsters[0].hp;
  rpg.play(run, "a", { uid: "t2", target: "m1" });
  assert.ok(hp - run.monsters[0].hp >= Math.floor(number(before) * 0.9 * 1.6), "the hit is 60% stronger");
});

test("rpg: dust - copies past what a deck holds and cards no character can use; never a copy a deck needs; dust makes cards", () => {
  const hero = rpg.newHero("warrior");
  const char = rpg.charOf(hero);
  // (a common of the class: 2 fit a deck - 5 owned, 3 to dust)
  char.collection.ironwave = 5;
  // (a mage's legendary from a pack: the mage isn't unlocked - one copy is no spare, a second one is)
  rpg.charOf(hero, "mage").collection.pyroblast = 2;
  const list = rpg.dustList(hero);
  assert.deepStrictEqual(list.find((one) => one.id == "ironwave"), { cls: "warrior", id: "ironwave", n: 3, dust: 3 * rpg.DUST.common.get });
  assert.strictEqual(list.find((one) => one.id == "pyroblast").n, 1);
  // (the starter cards every character gets for free - also the mage's, made by the pack: never dust)
  assert.deepStrictEqual(list.map((one) => one.id).sort(), ["ironwave", "pyroblast"]);
  assert.match(rpg.dustCard(hero, "warrior", "ironwave", 4).error, /Only 3/);
  assert.strictEqual(rpg.dustCard(hero, "warrior", "ironwave", 3).dust, 3 * rpg.DUST.common.get);
  assert.strictEqual(char.collection.ironwave, 2);
  assert.match(rpg.dustCard(hero, "warrior", "ironwave", 1).error, /every copy/);
  assert.strictEqual(rpg.dustAll(hero), rpg.DUST.legendary.get);
  assert.strictEqual(hero.dust, 3 * rpg.DUST.common.get + rpg.DUST.legendary.get);
  assert.strictEqual(rpg.charOf(hero, "mage").collection.pyroblast, 1);
  // Made of dust: a card of the class, not past what a deck holds, not a mythic one
  assert.match(rpg.craftCard(hero, "pyroblast"), /Not a card of your class/);
  assert.match(rpg.craftCard(hero, "ironwave"), /already have every copy/);
  hero.dust = 0;
  assert.match(rpg.craftCard(hero, "impervious"), new RegExp("You need " + rpg.DUST.epic.craft + " dust"));
  hero.dust = rpg.DUST.epic.craft;
  assert.strictEqual(rpg.craftCard(hero, "impervious"), null);
  assert.strictEqual(char.collection.impervious, 1);
  assert.strictEqual(hero.dust, 0);
  // Hearthstone's numbers: an epic dusts for a rare, a legendary for an epic
  assert.strictEqual(rpg.DUST.epic.get, rpg.DUST.rare.craft);
  assert.strictEqual(rpg.DUST.legendary.get, rpg.DUST.epic.craft);
  assert.strictEqual(rpg.DUST.mythic.craft, null);
  // Packs for dust: into the inventory - dearer than what their cards give as dust
  // (a dust: 20 coins - the pack's coin price in dust)
  assert.strictEqual(rpg.PACKS.standard.dust, Math.round(rpg.PACKS.standard.price / 20));
  assert.match(rpg.buyPackDust(hero, "standard"), new RegExp("You need " + rpg.PACKS.standard.dust + " dust"));
  hero.dust = rpg.PACKS.standard.dust + 100;
  const before = hero.packs.standard || 0;
  assert.strictEqual(rpg.buyPackDust(hero, "standard"), null);
  assert.strictEqual(hero.packs.standard, before + 1);
  assert.strictEqual(hero.dust, 100);
  let out = 0;
  for (let i = 0; i < 300; i++) for (const card of rpg.openPack(rpg.newHero("warrior"), Math.random, "standard")) out += rpg.DUST[rpg.CARDS[card.id].rarity].get;
  assert.ok(out / 300 < rpg.PACKS.standard.dust / 2, String(out / 300));
});

test("rpg: trades - spare cards and the bag's gear; big trades nearly even; a card goes to the character of its class", () => {
  const a = rpg.newHero("warrior");
  const b = rpg.newHero("paladin");
  rpg.charOf(a).collection.ironwave = 3;
  rpg.charOf(a).deck.push("ironwave");
  rpg.charOf(a, "mage").collection.pyroblast = 1;
  // (what a can trade: the copies of bash outside the deck, the mage's card - never a basic card)
  const list = rpg.tradeList(a);
  assert.strictEqual(list.find((one) => one.id == "ironwave").n, 2);
  assert.ok(list.find((one) => one.id == "pyroblast"));
  assert.deepStrictEqual(list.map((one) => one.id).sort(), ["ironwave", "pyroblast"]);
  // Small trades: anything goes - a common for nothing
  assert.strictEqual(rpg.tradeFair(500, 0), null);
  assert.strictEqual(rpg.tradeFair(2500, 0), null);
  assert.match(rpg.tradeFair(3000, 0), /nearly the same value/);
  // (a legendary or mythic in it: always nearly the same value, however small)
  assert.match(rpg.tradeFair(1000, 0, true), /nearly the same value/);
  assert.strictEqual(rpg.tradeFair(1000, 900, true), null);
  // Big ones: the smaller side at most 25% under
  assert.match(rpg.tradeFair(50000, 10000), /nearly the same value/);
  assert.strictEqual(rpg.tradeFair(50000, 40000), null);
  // A legendary for a few commons: refused
  const commons = [{ k: "card", cls: "warrior", id: "ironwave", n: 2 }];
  assert.match(rpg.trade(b, a, [], [{ k: "card", cls: "mage", id: "pyroblast", n: 1 }]), /nearly the same value/);
  // Gear for a card: never (cards only for cards, gear only for gear)
  const gear = { ...rpg.makeGear(30, () => 0.99), id: "gx" };
  gear.value = 45000;
  b.bag.push(gear);
  assert.match(rpg.trade(b, a, [{ k: "gear", id: "gx" }], [{ k: "card", cls: "mage", id: "pyroblast", n: 1 }]), /cards for cards/);
  // A legendary card for it: done
  rpg.charOf(b, "paladin").collection.verdict = 1;
  assert.strictEqual(rpg.trade(b, a, [{ k: "card", cls: "paladin", id: "verdict", n: 1 }], [{ k: "card", cls: "mage", id: "pyroblast", n: 1 }]), null);
  assert.strictEqual(rpg.charOf(a, "paladin").collection.verdict, 1);
  // (the mage's card: to b's mage - b plays a paladin)
  assert.strictEqual(rpg.charOf(b, "mage").collection.pyroblast, 1);
  assert.ok(!rpg.charOf(a, "mage").collection.pyroblast);
  // Gone already: refused
  assert.match(rpg.trade(a, b, [{ k: "card", cls: "mage", id: "pyroblast", n: 1 }], []), /isn't there/);
  // Commons as a gift: fine
  assert.strictEqual(rpg.trade(a, b, commons, []), null);
  assert.strictEqual(rpg.charOf(b, "warrior").collection.ironwave, 2);
  assert.strictEqual(rpg.charOf(a).collection.ironwave, 1);
});

test("rpg: trades over the sockets - an offer, a refused unfair one, accepted: the cards swap; dust over the sockets", async () => {
  testMode.start("rpg_tia", 1000000);
  testMode.start("rpg_tom", 1000000);
  const tia = client("rpg_tia");
  const tom = client("rpg_tom");
  await h.once(tia, "rpgHero");
  await h.once(tom, "rpgHero");
  tia.emit("unlock", { id: "warrior" });
  tom.emit("unlock", { id: "mage" });
  await waitFor(tia, "rpgHero", (view) => view.cls == "warrior");
  await waitFor(tom, "rpgHero", (view) => view.cls == "mage");
  const a = server.test.rpg.heroOf("rpg_tia");
  const b = server.test.rpg.heroOf("rpg_tom");
  rpg.charOf(a, "mage").collection.pyroblast = 1;
  rpg.charOf(b, "warrior").collection.impervious = 5;
  // Unfair: a legendary for an epic
  const unfair = h.once(tia, "rpgError");
  tia.emit("tradeOffer", { to: "rpg_tom", give: [{ k: "card", cls: "mage", id: "pyroblast", n: 1 }], take: [{ k: "card", cls: "warrior", id: "impervious", n: 1 }] });
  assert.match(await unfair, /nearly the same value/);
  // Fair: the legendary for four epics
  tia.emit("tradeOffer", { to: "rpg_tom", give: [{ k: "card", cls: "mage", id: "pyroblast", n: 1 }], take: [{ k: "card", cls: "warrior", id: "impervious", n: 4 }] });
  const offer = await waitFor(tom, "rpgTrades", (list) => list.length == 1);
  assert.strictEqual(offer[0].from, "rpg_tia");
  // (only the one it is for takes it)
  tia.emit("tradeAnswer", { id: offer[0].id, accept: true });
  tom.emit("tradeAnswer", { id: offer[0].id, accept: true });
  await waitFor(tom, "rpgTrades", (list) => list.length == 0);
  assert.strictEqual(rpg.charOf(b, "mage").collection.pyroblast, 1);
  assert.strictEqual(rpg.charOf(a, "warrior").collection.impervious, 4);
  assert.strictEqual(rpg.charOf(b, "warrior").collection.impervious, 1);
  // Dust: the epics past what a deck holds
  tia.emit("dust", { cls: "warrior", id: "impervious", n: 2 });
  const dusted = await waitFor(tia, "rpgHero", (view) => view.dust == 2 * rpg.DUST.epic.get);
  assert.ok(!dusted.dustable.some((one) => one.id == "impervious"));
  // Coins: never alone - with a card they count for its side
  const alone = h.once(tia, "rpgError");
  tia.emit("tradeOffer", { to: "rpg_tom", give: [], take: [], takeCoins: 5000 });
  assert.match(await alone, /Coins alone/);
  const tiaCoins = testMode.balance("rpg_tia");
  const tomCoins = testMode.balance("rpg_tom");
  tia.emit("tradeOffer", { to: "rpg_tom", give: [{ k: "card", cls: "warrior", id: "impervious", n: 1 }], take: [], takeCoins: 8000 });
  const sale = await waitFor(tom, "rpgTrades", (list) => list.length == 1);
  assert.strictEqual(sale[0].takeCoins, 8000);
  tom.emit("tradeAnswer", { id: sale[0].id, accept: true });
  await waitFor(tom, "rpgTrades", (list) => list.length == 0);
  assert.strictEqual(testMode.balance("rpg_tia"), tiaCoins + 8000);
  assert.strictEqual(testMode.balance("rpg_tom"), tomCoins - 8000);
  assert.strictEqual(rpg.charOf(b, "warrior").collection.impervious, 2);
  tia.disconnect();
  tom.disconnect();
});

test("rpg: deck slots get names - empty: back to the number, long ones cut", () => {
  const hero = rpg.newHero("warrior");
  hero.deckSlots = 1;
  assert.strictEqual(rpg.nameDeck(hero, 1, "  Big   Hitters "), null);
  assert.strictEqual(rpg.heroView(hero).deckNames[1], "Big Hitters");
  assert.strictEqual(rpg.heroView(hero).deckNames[0], null);
  rpg.nameDeck(hero, 1, "x".repeat(50));
  assert.strictEqual(rpg.heroView(hero).deckNames[1].length, 20);
  rpg.nameDeck(hero, 1, "");
  assert.strictEqual(rpg.heroView(hero).deckNames[1], null);
  assert.match(rpg.nameDeck(hero, 2, "Nope"), /No such deck slot/);
});

test("rpg: the shop's cart paid with dust - each pack its dust price, not without enough dust", () => {
  const hero = rpg.newHero("warrior");
  const before = hero.packs.standard || 0;
  const heroPacks = hero.packs.premium || 0;
  const cost = rpg.PACKS.standard.dust * 2 + rpg.PACKS.premium.dust;
  hero.dust = cost - 1;
  assert.match(rpg.buyCartDust(hero, { standard: 2, premium: 1 }), new RegExp("You need " + cost + " dust"));
  hero.dust = cost;
  assert.strictEqual(rpg.buyCartDust(hero, { standard: 2, premium: 1 }), null);
  assert.strictEqual(hero.dust, 0);
  assert.strictEqual(hero.packs.standard, before + 2);
  assert.strictEqual(hero.packs.premium, heroPacks + 1);
});

test("rpg: dust a copy that isn't spare - only when asked for, it leaves the decks; the free starter copies never", () => {
  const hero = rpg.newHero("warrior");
  const char = rpg.charOf(hero);
  char.collection.ironwave = 2;
  char.deck.push("ironwave", "ironwave");
  char.decks = [null, ["ironwave", "ironwave", "strike"]];
  // (not spare: refused - unless asked for)
  assert.match(rpg.dustCard(hero, "warrior", "ironwave", 1).error, /every copy/);
  assert.strictEqual(rpg.dustCard(hero, "warrior", "ironwave", 1, true).dust, rpg.DUST.common.get);
  assert.strictEqual(char.collection.ironwave, 1);
  assert.strictEqual(char.deck.filter((id) => id == "ironwave").length, 1);
  assert.deepStrictEqual(char.decks[1], ["ironwave", "strike"]);
  // (the starter's own copies - the ones every character gets for free: never dust)
  const starter = Object.keys(char.collection).find((id) => rpg.CARDS[id].rarity != "basic" && rpg.dustableAny(hero, "warrior", id) == 0);
  assert.ok(starter);
  assert.match(rpg.dustCard(hero, "warrior", starter, 1, true).error, /can't be dusted/);
});

test("rpg: gear names fit the rarity - legendary and mythic pieces are never rusty; mythic pieces are rare and the strongest", () => {
  const seen = {};
  let mythic = null;
  for (let i = 0; i < 40000; i++) {
    const item = rpg.makeGear(1, Math.random, 50);
    seen[item.rarity] = (seen[item.rarity] || 0) + 1;
    if (["legendary", "mythic"].includes(item.rarity)) assert.ok(!/^(Rusty|Iron|Steel)/.test(item.name), item.name);
    if (item.rarity == "mythic") mythic = item;
  }
  assert.ok(mythic, "a mythic piece drops now and then");
  assert.ok(seen.mythic < seen.legendary, JSON.stringify(seen));
  assert.ok(mythic.value > rpg.makeGear(1, () => 0).value * 4);
});

test("rpg: starting over - everything gone, nothing sold for it; once in three days", async () => {
  const hero = rpg.newHero("warrior");
  hero.bag.push(rpg.makeGear(5));
  hero.dust = 500;
  const now = Date.now();
  const done = rpg.resetHero(hero, now);
  assert.deepStrictEqual([done.hero.cls, done.hero.unlocked.length, done.hero.bag.length, done.hero.dust || 0], [null, 0, 0, 0]);
  assert.match(rpg.resetHero(done.hero, now + 3600000).error, /reset again in 71 hours/);
  assert.ok(!rpg.resetHero(done.hero, now + 3 * 24 * 3600000).error);
  // Over the sockets: RESET typed - the hero fresh, no coins for the gear
  testMode.start("rpg_rex", 1000000);
  const rex = client("rpg_rex");
  await h.once(rex, "rpgHero");
  rex.emit("unlock", { id: "warrior" });
  await waitFor(rex, "rpgHero", (view) => view.cls == "warrior");
  server.test.rpg.heroOf("rpg_rex").bag.push(rpg.makeGear(5));
  const coins = testMode.balance("rpg_rex");
  rex.emit("resetHero", { confirm: "nope" });
  rex.emit("resetHero", { confirm: "RESET" });
  const fresh = await waitFor(rex, "rpgHero", (view) => view.cls == null);
  assert.strictEqual(fresh.bag.length, 0);
  assert.ok(fresh.resetLeft > 0);
  assert.strictEqual(testMode.balance("rpg_rex"), coins);
  const again = h.once(rex, "rpgError");
  rex.emit("resetHero", { confirm: "RESET" });
  assert.match(await again, /reset again/);
  rex.disconnect();
});

test("rpg: a cleared floor never pays less than 1.1 times its entry - a low share included; leaving early or falling: as it is", () => {
  const run = { floor: 6, pot: 1000 };
  const entry = rpg.entryCost(6);
  assert.strictEqual(rpg.payout(run, { share: 0.5 }, "won"), Math.round(entry * 1.1 / 100) * 100);
  assert.strictEqual(rpg.payout({ floor: 6, pot: entry * 3 }, {}, "won"), entry * 3);
  assert.strictEqual(rpg.payout(run, {}, "left"), 1000);
  assert.strictEqual(rpg.payout(run, { share: 0.5 }, "left"), 500);
});

test("rpg: loot cards like a pack's - any class's, the own class and the neutral ones more often; a boss's rare or better", () => {
  const hero = rpg.newHero("warrior");
  let own = 0;
  let other = 0;
  for (let i = 0; i < 3000; i++) {
    const { card } = rpg.lootCard(hero, Math.random, i % 2 ? "rare" : "common");
    assert.ok(!["basic", "mythic"].includes(rpg.CARDS[card].rarity), card);
    if (i % 2) assert.ok(rpg.CARDS[card].rarity != "common", card);
    if (rpg.poolOf("warrior").includes(card)) own++;
    else other++;
  }
  assert.ok(other > 300, String(other));
  assert.ok(own > 900, String(own));
});
test("rpg: the same floor again on the same day pays less - 100, 85, 70, 60, 50, then 45%; midnight starts over", () => {
  const hero = rpg.newHero("warrior");
  const now = new Date(2026, 5, 1, 12).getTime();
  assert.strictEqual(rpg.repeatPay(hero, 3, "warrior", now), 1);
  const pays = [];
  for (let i = 0; i < 6; i++) {
    rpg.countRun(hero, 3, "warrior", now);
    pays.push(rpg.repeatPay(hero, 3, "warrior", now));
  }
  assert.deepStrictEqual(pays, [0.85, 0.7, 0.6, 0.5, 0.45, 0.45]);
  // (another floor: its own count - the next day: all again)
  assert.strictEqual(rpg.repeatPay(hero, 4, "warrior", now), 1);
  assert.strictEqual(rpg.repeatPay(hero, 3, "warrior", now + 24 * 3600 * 1000), 1);
  // A run on it: the share of the pot that small
  hero.chars.warrior.floorRuns.day = new Date().toDateString();
  const run = rpg.newRun(3, [{ name: "a", hero }]);
  assert.strictEqual(run.heroes[0].share, 0.45);
});
test("rpg: the hero's view counts the runs of each floor today", () => {
  const hero = rpg.newHero("warrior");
  rpg.countRun(hero, 2, "warrior");
  rpg.countRun(hero, 2, "warrior");
  const view = rpg.heroView(hero);
  assert.deepStrictEqual(view.runsToday, { 2: 2 });
});
test("rpg: a charm needing fewer cards in the deck is rare - rarer on worse pieces", () => {
  const rate = { common: [0, 0], epic: [0, 0] };
  for (let i = 0; i < 40000; i++) {
    const item = rpg.makeGear(15);
    if (item.slot != "charm" || !rate[item.rarity]) continue;
    rate[item.rarity][1]++;
    if (item.deckMin) rate[item.rarity][0]++;
  }
  const common = rate.common[0] / rate.common[1];
  const epic = rate.epic[0] / rate.epic[1];
  assert.ok(common < 0.04, "common " + common);
  assert.ok(epic > common && epic < 0.15, "epic " + epic);
});
test("rpg: a cheap legendary piece still needs a fair trade, a full bag takes no gear", () => {
  const a = rpg.newHero("warrior");
  const b = rpg.newHero("mage");
  a.bag.push({ id: "gL", slot: "charm", rarity: "legendary", value: 1000 });
  assert.match(rpg.trade(a, b, [{ k: "gear", id: "gL" }], []), /nearly the same value/);
  b.bag.push({ id: "gR", slot: "charm", rarity: "rare", value: 1000 });
  assert.strictEqual(rpg.trade(a, b, [{ k: "gear", id: "gL" }], [{ k: "gear", id: "gR" }]), null);
  // (a common piece that cheap: a gift is fine - unless the bag is full)
  while (b.bag.length < rpg.bagSize(b)) b.bag.push({ id: "f" + b.bag.length, slot: "charm", rarity: "common", value: 100 });
  a.bag.push({ id: "gC", slot: "charm", rarity: "common", value: 1000 });
  assert.match(rpg.trade(a, b, [{ k: "gear", id: "gC" }], []), /bag is full/);
});
test("rpg: free drawing cards never loop - a card never draws itself, only a new turn reshuffles the discard pile", () => {
  // Quick Slash alone with an empty deck: played once, it doesn't come back
  let run = duel("rogue", "defend", ["quickslash"]);
  let me = run.heroes[0];
  me.draw = [];
  me.discard = [];
  assert.strictEqual(rpg.play(run, "a", { uid: "t0", target: "m1" }), null);
  assert.strictEqual(me.hand.length, 0);
  // Two of them drawing each other: a few plays, then the hand runs dry
  run = duel("cleric", "defend", ["quickslash", "meditate"]);
  me = run.heroes[0];
  me.draw = [];
  me.discard = [];
  let plays = 0;
  while (me.hand.length && plays < 50) {
    const card = me.hand[0];
    assert.strictEqual(rpg.play(run, "a", { uid: card.uid, target: "m1" }), null);
    plays++;
  }
  assert.strictEqual(plays, 2);
  // (both wait on the discard pile for the next turn)
  assert.strictEqual(me.draw.length + me.hand.length, 0);
  assert.strictEqual(me.discard.length, 2);
});
test("rpg: a stunned foe is steady afterwards - no stun again before it acted", () => {
  const run = duel("warrior", "attack", ["huntersmark", "huntersmark"]);
  const me = run.heroes[0];
  me.energy = 5;
  assert.strictEqual(rpg.play(run, "a", { uid: "t0", target: "m1" }), null);
  assert.ok(run.monsters[0].effects.stun);
  rpg.monsterTurn(run);
  // (it skipped its move - now steady: the next stun does nothing)
  assert.ok(run.monsters[0].effects.steady);
  me.hand = [{ uid: "x", id: "huntersmark" }];
  me.energy = 5;
  me.ended = false;
  // (steady: the stun mostly fails - with a roll under the chance always)
  assert.strictEqual(rpg.play(run, "a", { uid: "x", target: "m1" }, () => 0), null);
  assert.ok(!run.monsters[0].effects.stun);
  // (once it acted: stunnable again)
  rpg.monsterTurn(run);
  assert.ok(!run.monsters[0].effects.steady);
});

test("rpg: Smoke Bomb not two turns in a row", () => {
  const run = duel("rogue", "attack", ["smoke", "smoke"]);
  const me = run.heroes[0];
  me.energy = 5;
  assert.strictEqual(rpg.play(run, "a", { uid: "t0" }), null);
  assert.ok(me.evading);
  rpg.endTurn(run, "a");
  rpg.monsterTurn(run);
  me.energy = 5;
  assert.ok(rpg.runView(run).heroes[0].smokeLocked);
  assert.match(rpg.play(run, "a", { uid: "t1" }), /two turns in a row/);
  // (a turn later: fine again)
  rpg.endTurn(run, "a");
  rpg.monsterTurn(run);
  me.energy = 5;
  assert.strictEqual(rpg.play(run, "a", { uid: "t1" }), null);
});

test("rpg: a restart keeps the parties, their runs and the trade offers - the heroes away until they are back", async () => {
  const persist = require("../game/persist");
  const fake = { of: () => ({ use() {}, on() {}, sockets: new Map(), to: () => ({ emit() {} }), emit() {} }) };
  const live = require("../sockets/rpg_server")(fake, { world: "" });
  const a = live.heroOf("keep_a");
  const b = live.heroOf("keep_b");
  rpg.unlock(a, "warrior");
  rpg.unlock(b, "mage");
  const run = rpg.newRun(1, [{ name: "keep_a", hero: a }, { name: "keep_b", hero: b }]);
  rpg.enterRoom(run, 0);
  live.parties.set("p41", { id: "p41", leader: "keep_a", floor: 1, size: 2, members: ["keep_a", "keep_b"], run, result: null, timer: setTimeout(() => {}, 1), away: {}, endsAt: 5 });
  live.trades.set("t9", { id: "t9", from: "keep_a", to: "keep_b", give: [], take: [], at: Date.now() });
  const saved = persist.snapshotAll();
  live.parties.clear();
  live.trades.clear();
  await persist.restoreSnapshots(saved, persist.keys().filter((key) => key != "rpg"));
  const back = live.parties.get("p41");
  assert.ok(back && back.run, "the party and its run are back");
  assert.strictEqual(back.run.phase, "fight");
  assert.deepStrictEqual(back.run.monsters.map((m) => m.hp), run.monsters.map((m) => m.hp));
  assert.ok(back.run.heroes.every((h) => h.away), "away until their pages are back");
  assert.ok(live.trades.has("t9"));
  live.stop();
});
test("rpg: up to 7 monsters deep down - 5 before floor 15, 6 before floor 25", () => {
  assert.deepStrictEqual([rpg.maxFoes(1), rpg.maxFoes(15), rpg.maxFoes(25)], [5, 6, 7]);
  let most = 0;
  for (let i = 0; i < 400; i++) most = Math.max(most, rpg.monstersFor(28, 4, "hard").length);
  assert.strictEqual(most, 7);
  for (let i = 0; i < 200; i++) assert.ok(rpg.monstersFor(5, 4, "hard").length <= 5);
});
test("rpg: revives - the first of a day free, then 1x an entry of the deepest open floor, 1.25x, 1.5x ... up to 2x", () => {
  const hero = rpg.newHero("warrior");
  const now = new Date(2026, 5, 1, 12).getTime();
  const entry = rpg.entryCost(rpg.maxFloor(hero));
  const prices = [];
  for (let i = 0; i < 4; i++) {
    prices.push(rpg.revivePrice(hero, now));
    rpg.die(hero, "warrior", now);
    rpg.revive(hero, now);
  }
  // (rounded to the price steps)
  [0, entry, entry * 1.25, entry * 1.5].forEach((want, i) => assert.ok(Math.abs(prices[i] - want) <= 50, `${i}: ${prices[i]} for ${want}`));
  // (at most twice the first price)
  for (let i = 0; i < 6; i++) {
    rpg.die(hero, "warrior", now);
    rpg.revive(hero, now);
  }
  assert.ok(Math.abs(rpg.revivePrice(hero, now) - entry * 2) <= 50, String(rpg.revivePrice(hero, now)));
});

test("rpg: luck helps against steady foes - they shrug off fewer stuns", () => {
  assert.strictEqual(rpg.steadyResist({ luck: 0 }), 0.6);
  assert.ok(Math.abs(rpg.steadyResist({ luck: 60 }) - 0.42) < 1e-9);
  assert.strictEqual(rpg.steadyResist({ luck: 300 }), 0.3);
});

test("rpg: luck makes poison and burns stronger - a quarter more at most", () => {
  assert.strictEqual(rpg.luckBoost({ luck: 0 }), 1);
  assert.strictEqual(rpg.luckBoost({ luck: 40 }), 1.1);
  assert.strictEqual(rpg.luckBoost({ luck: 500 }), 1.25);
});
test("rpg: loot per room - deeper floors with more rooms pay less a room, the same share of the entry a floor", () => {
  assert.strictEqual(rpg.lootScale(1), 1);
  assert.ok(rpg.lootScale(5) < 1, "a boss floor: one room more");
  assert.ok(rpg.lootScale(27) < rpg.lootScale(12));
});
