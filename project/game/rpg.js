/*
 * The dungeon: an RPG in the casino (for now only in the admin's test world - sockets/rpg_server.js).
 *
 * A hero per player: four stats bought with coins (upgrades, every level dearer), gear from chests (a
 * weapon, an armor, a charm - from common to legendary) and potions. A run: a party of 1 to 4 heroes
 * pays the entry of a floor (each the same) and goes through its rooms one by one - fights (turn by
 * turn: everybody picks an action, then the monsters strike), chests, traps, a camp fire. Every room
 * cleared fills the loot pot (coins, per hero); between two rooms the leader goes on or leaves with the
 * loot. All heroes down: the pot is lost. The last room of a floor is an elite fight; a floor cleared
 * opens the next one.
 *
 * Bosses: the hook is here (BOSS_EVERY - the last room of every n-th floor), the bosses come later.
 *
 * Everything random comes from `rng` (Math.random - the tests give their own).
 */

const FLOORS = 30;
const ROOMS = 6;
const PARTY_MAX = 4;
const BAG_MAX = 12;
const POTIONS_MAX = 5;
const POTION_HEAL = 0.45; // of the max HP
const POTION_PRICE = 1000;
// Bosses: the last room of every n-th floor (0: none yet - they come later)
const BOSS_EVERY = 0;

// The stats: what a level gives
const STATS = {
  hp: { name: "Vitality", icon: "❤️", base: 100, per: 15, about: "+15 max HP" },
  atk: { name: "Strength", icon: "⚔️", base: 10, per: 3, about: "+3 attack" },
  def: { name: "Armor", icon: "🛡️", base: 0, per: 2, about: "+2 defense" },
  luck: { name: "Luck", icon: "🍀", base: 5, per: 2, about: "+2% critical hits, dodging traps, better loot" },
};
const STAT_IDS = Object.keys(STATS);
const LEVEL_MAX = 50;
const UPGRADE_BASE = 2000;
const UPGRADE_GROWTH = 1.35;

const ENTRY_BASE = 1000;
const ENTRY_GROWTH = 1.35;
// What a room puts in the pot (per hero, a share of the entry)
const REWARD = { fight: 0.25, elite: 0.4, boss: 1, chest: 0.15, trap: 0, rest: 0 };

const SKILL_POWER = 1.8;
const SKILL_COOLDOWN = 3; // turns
const GUARD = 0.4; // the damage that still comes through
const CRIT = 1.8;
const REVIVE = 0.2; // a hero down: back up after the fight with this much HP
const TRAP_DAMAGE = 0.2;
const REST_HEAL = 0.35;

const RARITIES = [
  { id: "common", name: "Common", weight: 60, power: 1 },
  { id: "rare", name: "Rare", weight: 28, power: 1.5 },
  { id: "epic", name: "Epic", weight: 10, power: 2.2 },
  { id: "legendary", name: "Legendary", weight: 2, power: 3.2 },
];
const SLOTS = {
  weapon: { name: "Weapon", kinds: [["🗡️", "Dagger"], ["⚔️", "Sword"], ["🪓", "Axe"], ["🏹", "Bow"], ["🔱", "Trident"]] },
  armor: { name: "Armor", kinds: [["🥋", "Robe"], ["🦺", "Vest"], ["🛡️", "Shield"], ["🧥", "Mail"]] },
  charm: { name: "Charm", kinds: [["💍", "Ring"], ["📿", "Amulet"], ["🧿", "Talisman"]] },
};
const MATERIALS = ["Rusty", "Iron", "Steel", "Mythril", "Obsidian", "Celestial"];

// The monsters: a group per 5 floors (hp, atk: times the floor's; dodge: misses a hit that often)
const MONSTERS = [
  [{ name: "Slime", icon: "🟢", hp: 1, atk: 0.8 }, { name: "Rat", icon: "🐀", hp: 0.7, atk: 1 }, { name: "Bat", icon: "🦇", hp: 0.6, atk: 0.9, dodge: 0.2 }],
  [{ name: "Goblin", icon: "👺", hp: 1, atk: 1 }, { name: "Spider", icon: "🕷️", hp: 0.8, atk: 1.2 }, { name: "Wolf", icon: "🐺", hp: 0.9, atk: 1.1, dodge: 0.1 }],
  [{ name: "Skeleton", icon: "💀", hp: 1, atk: 1 }, { name: "Ghost", icon: "👻", hp: 0.7, atk: 1, dodge: 0.3 }, { name: "Zombie", icon: "🧟", hp: 1.4, atk: 0.8 }],
  [{ name: "Orc", icon: "👹", hp: 1.2, atk: 1.1 }, { name: "Troll", icon: "🧌", hp: 1.5, atk: 0.9 }, { name: "Golem", icon: "🗿", hp: 1.8, atk: 0.8 }],
  [{ name: "Demon", icon: "😈", hp: 1.1, atk: 1.2 }, { name: "Cyclops", icon: "👁️", hp: 1.3, atk: 1.1 }, { name: "Wraith", icon: "🌫️", hp: 0.9, atk: 1.2, dodge: 0.25 }],
];
const MONSTER_HP = 28;
const MONSTER_HP_GROWTH = 1.17;
const MONSTER_ATK = 7;
const MONSTER_ATK_GROWTH = 1.14;
const PARTY_HP = 0.7; // a monster has this much more HP per hero after the first

const round100 = (value) => Math.max(100, Math.round(value / 100) * 100);
const between = (rng, low, high) => low + rng() * (high - low);
const pick = (rng, list) => list[Math.floor(rng() * list.length)];

/* ---------- The hero ---------- */

function newHero() {
  return { levels: { hp: 0, atk: 0, def: 0, luck: 0 }, gear: { weapon: null, armor: null, charm: null }, bag: [], potions: 2, deepest: 0, runs: 0, cleared: 0 };
}

// What the hero has with levels and gear: {maxHp, atk, def, luck}
function statsOf(hero) {
  const value = (id) => STATS[id].base + STATS[id].per * hero.levels[id];
  const gear = Object.values(hero.gear).filter(Boolean);
  const plus = (key) => gear.reduce((sum, item) => sum + (item[key] || 0), 0);
  return { maxHp: value("hp") + plus("hp"), atk: value("atk") + plus("atk"), def: value("def") + plus("def"), luck: Math.min(60, value("luck") + plus("luck")) };
}

// The price of the next level of a stat (null: the last level reached)
function upgradeCost(level) {
  return level >= LEVEL_MAX ? null : round100(UPGRADE_BASE * Math.pow(UPGRADE_GROWTH, level));
}

// The highest floor a hero may enter
function maxFloor(hero) {
  return Math.min(FLOORS, hero.deepest + 1);
}

function entryCost(floor) {
  return round100(ENTRY_BASE * Math.pow(ENTRY_GROWTH, floor - 1));
}

// For the page: the hero with what it can do
function heroView(hero) {
  return {
    levels: hero.levels,
    stats: statsOf(hero),
    upgrades: Object.fromEntries(STAT_IDS.map((id) => [id, upgradeCost(hero.levels[id])])),
    gear: hero.gear,
    bag: hero.bag,
    potions: hero.potions,
    deepest: hero.deepest,
    maxFloor: maxFloor(hero),
    runs: hero.runs,
    cleared: hero.cleared,
  };
}

/* ---------- Gear ---------- */

let gearCount = 0;

// A piece of gear from a chest of `floor` (luck: a bit more often a better one)
function makeGear(floor, rng = Math.random, luck = 0) {
  const shift = Math.min(0.5, luck / 100);
  const weights = RARITIES.map((rarity, i) => rarity.weight * (i == 0 ? 1 - shift : 1 + shift * i));
  let roll = rng() * weights.reduce((a, b) => a + b, 0);
  let index = 0;
  while (roll >= weights[index] && index < RARITIES.length - 1) roll -= weights[index++];
  const rarity = RARITIES[index];
  const slot = pick(rng, Object.keys(SLOTS));
  const [icon, kind] = pick(rng, SLOTS[slot].kinds);
  const material = MATERIALS[Math.min(MATERIALS.length - 1, Math.floor((floor - 1) / 5))];
  const base = 2 + floor * 1.2;
  const item = { id: "g" + Date.now().toString(36) + (++gearCount).toString(36), slot, rarity: rarity.id, name: material + " " + kind, icon, floor };
  if (slot == "weapon") item.atk = Math.round(base * rarity.power);
  if (slot == "armor") {
    item.def = Math.max(1, Math.round(base * 0.6 * rarity.power));
    item.hp = Math.round(base * 4 * rarity.power);
  }
  if (slot == "charm") item.luck = Math.max(1, Math.round((1 + floor * 0.25) * rarity.power));
  item.value = round100(entryCost(floor) * 0.15 * rarity.power);
  return item;
}

/* ---------- A run ---------- */

// The rooms of a floor: fights, between them a chest / a trap / a camp fire - the last one an elite (a boss)
function planRooms(floor, rng = Math.random) {
  const rooms = [];
  for (let i = 0; i < ROOMS - 1; i++) {
    if (i % 2 == 0) rooms.push({ kind: "fight" });
    else rooms.push({ kind: pick(rng, ["chest", "chest", "trap", "rest"]) });
  }
  rooms.push({ kind: BOSS_EVERY && floor % BOSS_EVERY == 0 ? "boss" : "elite" });
  return rooms;
}

let monsterCount = 0;

function monster(floor, size, kind, rank) {
  const hp = MONSTER_HP * Math.pow(MONSTER_HP_GROWTH, floor - 1) * kind.hp * (1 + PARTY_HP * (size - 1)) * rank.hp;
  const atk = MONSTER_ATK * Math.pow(MONSTER_ATK_GROWTH, floor - 1) * kind.atk * rank.atk;
  const max = Math.max(1, Math.round(hp));
  return { id: "m" + ++monsterCount, name: rank.prefix + kind.name, icon: kind.icon, hp: max, maxHp: max, atk: Math.max(1, Math.round(atk)), dodge: kind.dodge || 0, rank: rank.id };
}

const RANKS = {
  normal: { id: "normal", prefix: "", hp: 1, atk: 1 },
  elite: { id: "elite", prefix: "Elite ", hp: 2.2, atk: 1.3 },
  // (the bosses come later - for now a much stronger one of the floor's monsters)
  boss: { id: "boss", prefix: "Boss ", hp: 5, atk: 1.6 },
};

// The monsters of a fight: 1 to 3 (more with a bigger party) - an elite / a boss comes with a few others
function monstersFor(floor, size, room, rng = Math.random) {
  const group = MONSTERS[Math.min(MONSTERS.length - 1, Math.floor((floor - 1) / 5))];
  if (room == "elite" || room == "boss") {
    const list = [monster(floor, size, pick(rng, group), RANKS[room])];
    for (let i = 0; i < Math.floor(size / 2); i++) list.push(monster(floor, size, pick(rng, group), RANKS.normal));
    return list;
  }
  const count = Math.min(3, 1 + Math.floor(rng() * 2) + Math.floor(size / 3));
  return Array.from({ length: count }, () => monster(floor, size, pick(rng, group), RANKS.normal));
}

// A new run: the heroes (with their stats now) go into the first room
function newRun(floor, party, rng = Math.random) {
  const run = {
    floor,
    rooms: planRooms(floor, rng),
    room: -1,
    phase: "between",
    heroes: party.map(({ name, hero }) => {
      const stats = statsOf(hero);
      return { name, ...stats, hp: stats.maxHp, down: false, potions: hero.potions, cooldown: 0, action: null, guard: false };
    }),
    monsters: [],
    turn: 0,
    pot: 0,
    loot: Object.fromEntries(party.map(({ name }) => [name, []])),
    log: [],
  };
  return run;
}

function say(run, text) {
  run.log.push(text);
  if (run.log.length > 40) run.log.splice(0, run.log.length - 40);
}

const alive = (list) => list.filter((one) => !one.down && one.hp > 0);

// Into the next room: a fight starts, the other rooms happen right away
function enterRoom(run, rng = Math.random) {
  run.room++;
  const room = run.rooms[run.room];
  room.entered = true;
  const heroes = alive(run.heroes);
  if (room.kind == "fight" || room.kind == "elite" || room.kind == "boss") {
    run.monsters = monstersFor(run.floor, run.heroes.length, room.kind, rng);
    run.phase = "fight";
    run.turn = 1;
    run.heroes.forEach((hero) => {
      hero.action = null;
      hero.guard = false;
    });
    say(run, `Room ${run.room + 1}: ${run.monsters.map((m) => m.icon + " " + m.name).join(", ")}!`);
    return;
  }
  if (room.kind == "chest") {
    const coins = Math.round(entryCost(run.floor) * REWARD.chest);
    run.pot += coins;
    say(run, `Room ${run.room + 1}: a chest - 🪙 ${coins} each for the pot.`);
    for (const hero of heroes) {
      // (every hero rolls for gear on its own - luck helps)
      if (rng() * 100 < 35 + hero.luck / 2) {
        const item = makeGear(run.floor, rng, hero.luck);
        run.loot[hero.name].push(item);
        say(run, `${hero.name} finds ${item.icon} ${item.name} (${item.rarity}).`);
      }
    }
  } else if (room.kind == "trap") {
    say(run, `Room ${run.room + 1}: a trap!`);
    for (const hero of heroes) {
      if (rng() * 100 < hero.luck * 2) say(run, `${hero.name} dodges it.`);
      else {
        const damage = Math.round(hero.maxHp * TRAP_DAMAGE);
        hero.hp = Math.max(1, hero.hp - damage);
        say(run, `${hero.name} takes ${damage} damage.`);
      }
    }
  } else if (room.kind == "rest") {
    say(run, `Room ${run.room + 1}: a camp fire - everybody heals.`);
    for (const hero of heroes) hero.hp = Math.min(hero.maxHp, hero.hp + Math.round(hero.maxHp * REST_HEAL));
  }
  room.done = true;
  afterRoom(run);
}

// A room done: the next one - or the floor is cleared
function afterRoom(run) {
  if (run.room >= run.rooms.length - 1) {
    run.phase = "won";
    say(run, `Floor ${run.floor} cleared! 🎉`);
  } else run.phase = "between";
}

// A hero's action for this turn: {action: "attack" | "skill" | "guard" | "potion", target} -> an error or null
function choose(run, name, input) {
  if (run.phase != "fight") return "No fight now.";
  const hero = run.heroes.find((h) => h.name == name);
  if (!hero || hero.down) return "Your hero is down.";
  const action = input && input.action;
  if (!["attack", "skill", "guard", "potion"].includes(action)) return "Unknown action.";
  if (action == "skill" && hero.cooldown > 0) return `The power strike is ready in ${hero.cooldown} turn${hero.cooldown == 1 ? "" : "s"}.`;
  if (action == "potion" && hero.potions <= 0) return "No potions left.";
  if (action == "potion" && hero.hp >= hero.maxHp) return "Your HP is full.";
  const target = input.target != null ? String(input.target) : null;
  hero.action = { action, target };
  return null;
}

// Every hero still standing has picked an action
function allChosen(run) {
  return alive(run.heroes).every((hero) => hero.action);
}

// The turn: the heroes act (who didn't pick: attacks), then the monsters strike
function resolveTurn(run, rng = Math.random) {
  if (run.phase != "fight") return;
  const heroes = alive(run.heroes);
  for (const hero of heroes) {
    const { action, target } = hero.action || { action: "attack" };
    hero.guard = action == "guard";
    if (hero.cooldown > 0) hero.cooldown--;
    if (action == "guard") {
      say(run, `${hero.name} raises the guard.`);
      continue;
    }
    if (action == "potion") {
      const heal = Math.min(hero.maxHp - hero.hp, Math.round(hero.maxHp * POTION_HEAL));
      hero.hp += heal;
      hero.potions--;
      hero.usedPotions = (hero.usedPotions || 0) + 1;
      say(run, `${hero.name} drinks a potion: +${heal} HP.`);
      continue;
    }
    const standing = alive(run.monsters);
    if (!standing.length) break;
    const foe = standing.find((m) => m.id == target) || pick(rng, standing);
    const skill = action == "skill";
    if (skill) hero.cooldown = SKILL_COOLDOWN;
    // (the power strike never misses)
    if (!skill && rng() < foe.dodge) {
      say(run, `${foe.icon} ${foe.name} dodges ${hero.name}'s attack.`);
      continue;
    }
    const crit = rng() * 100 < hero.luck;
    const damage = Math.max(1, Math.round(hero.atk * between(rng, 0.85, 1.15) * (skill ? SKILL_POWER : 1) * (crit ? CRIT : 1)));
    foe.hp = Math.max(0, foe.hp - damage);
    say(run, `${hero.name} ${skill ? "power strikes" : "hits"} ${foe.icon} ${foe.name} for ${damage}${crit ? " (critical!)" : ""}.`);
    if (foe.hp == 0) {
      foe.down = true;
      say(run, `${foe.icon} ${foe.name} is defeated.`);
    }
  }
  if (!alive(run.monsters).length) return winFight(run);
  for (const foe of alive(run.monsters)) {
    const targets = alive(run.heroes);
    if (!targets.length) break;
    const hero = pick(rng, targets);
    const raw = foe.atk * between(rng, 0.85, 1.15) - hero.def;
    const damage = Math.max(1, Math.round(raw * (hero.guard ? GUARD : 1)));
    hero.hp = Math.max(0, hero.hp - damage);
    say(run, `${foe.icon} ${foe.name} hits ${hero.name} for ${damage}${hero.guard ? " (guarded)" : ""}.`);
    if (hero.hp == 0) {
      hero.down = true;
      say(run, `${hero.name} is down!`);
    }
  }
  run.heroes.forEach((hero) => (hero.action = null));
  if (!alive(run.heroes).length) {
    run.phase = "lost";
    run.pot = 0;
    say(run, "The whole party is down - the loot is lost. 💀");
    return;
  }
  run.turn++;
}

function winFight(run) {
  const room = run.rooms[run.room];
  const coins = Math.round(entryCost(run.floor) * REWARD[room.kind]);
  run.pot += coins;
  run.monsters = [];
  say(run, `Victory! 🪙 ${coins} each for the pot.`);
  // (the ones down get back up)
  for (const hero of run.heroes) {
    hero.action = null;
    hero.guard = false;
    if (hero.down) {
      hero.down = false;
      hero.hp = Math.max(1, Math.round(hero.maxHp * REVIVE));
      say(run, `${hero.name} gets back up.`);
    }
  }
  room.done = true;
  afterRoom(run);
}

// For the pages
function runView(run) {
  return {
    floor: run.floor,
    phase: run.phase,
    room: run.room,
    rooms: run.rooms.map((room) => ({ kind: room.kind, done: !!room.done, entered: !!room.entered })),
    heroes: run.heroes.map((h) => ({ name: h.name, hp: h.hp, maxHp: h.maxHp, atk: h.atk, def: h.def, luck: h.luck, down: h.down, potions: h.potions, cooldown: h.cooldown, guard: h.guard, chose: !!h.action })),
    monsters: run.monsters.map((m) => ({ id: m.id, name: m.name, icon: m.icon, hp: m.hp, maxHp: m.maxHp, atk: m.atk, rank: m.rank, down: !!m.down })),
    turn: run.turn,
    pot: run.pot,
    loot: run.loot,
    log: run.log,
  };
}

// How a floor goes for a hero this strong alone (the tests, tuning): {cleared: share of the runs, payback: back per coin}
function simulate(hero, floor, runs = 500, rng = Math.random) {
  let cleared = 0;
  let back = 0;
  for (let i = 0; i < runs; i++) {
    const run = newRun(floor, [{ name: "sim", hero }], rng);
    while (run.phase == "between") {
      enterRoom(run, rng);
      let turns = 0;
      while (run.phase == "fight" && turns++ < 200) {
        const me = run.heroes[0];
        choose(run, "sim", me.hp < me.maxHp * 0.35 && me.potions > 0 ? { action: "potion" } : me.cooldown == 0 ? { action: "skill" } : { action: "attack" });
        resolveTurn(run, rng);
      }
    }
    if (run.phase == "won") cleared++;
    back += run.pot;
  }
  return { cleared: cleared / runs, payback: back / runs / entryCost(floor) };
}

module.exports = {
  FLOORS,
  ROOMS,
  PARTY_MAX,
  BAG_MAX,
  POTIONS_MAX,
  POTION_PRICE,
  BOSS_EVERY,
  STATS,
  STAT_IDS,
  LEVEL_MAX,
  SLOTS,
  RARITIES,
  REWARD,
  SKILL_COOLDOWN,
  newHero,
  statsOf,
  upgradeCost,
  maxFloor,
  entryCost,
  heroView,
  makeGear,
  planRooms,
  monstersFor,
  newRun,
  enterRoom,
  choose,
  allChosen,
  resolveTurn,
  runView,
  simulate,
};
