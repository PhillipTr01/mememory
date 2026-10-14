/*
 * The dungeon: an RPG in the casino (for now only in the admin's test world - sockets/rpg_server.js).
 *
 * A hero per player: a class (Warrior, Rogue, Mage, Cleric - each its own skills), four stats bought with
 * coins (upgrades, every level dearer), gear from chests (a weapon, an armor, a charm - from common to
 * legendary) and potions. A run: a party of 1 to 4 heroes pays the entry of a floor (each the same) and
 * goes through its rooms - between two rooms the leader picks one of two doors (a fight, a hard fight, a
 * chest, a camp fire, a shrine, a merchant, a mystery) or leaves with the loot. The first room is a
 * fight, the last an elite fight; a floor cleared opens the next one. All heroes down: the pot is lost.
 *
 * Fights are turn by turn and open: every monster shows what it does next and to whom (its intent) -
 * the heroes pick their actions knowing it (attack, guard, a potion or a skill of their class - skills
 * cost energy, one more every turn), then the heroes act, the monsters do what they showed, poison and
 * burns tick. Status effects: poison, burn, stun (loses its next move), chill (half damage), a shield,
 * rage (monsters, more damage).
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
const POTION_HEAL = 0.4; // of the max HP
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
const REWARD = { fight: 0.25, hard: 0.45, elite: 0.4, boss: 1, chest: 0.15, trap: 0, rest: 0, shrine: 0, merchant: 0 };

/* ---------- Classes and their skills ---------- */

// hp, atk: times the stats; def, luck: added
const CLASSES = {
  warrior: { name: "Warrior", icon: "🛡️", about: "Tough - stuns, draws the attacks on himself, hits all", hp: 1.25, atk: 1, def: 3, luck: 0, skills: ["bash", "taunt", "cleave"] },
  rogue: { name: "Rogue", icon: "🗡️", about: "Poisons, then strikes where it hurts - and vanishes in smoke", hp: 0.95, atk: 1.1, def: 0, luck: 10, skills: ["poisonblade", "backstab", "smoke"] },
  mage: { name: "Mage", icon: "🔮", about: "Fire on all foes, frost that weakens - shields for the party", hp: 0.85, atk: 1.2, def: 0, luck: 0, skills: ["frost", "fireball", "barrier"] },
  cleric: { name: "Cleric", icon: "✨", about: "Heals, smites the undead, brings the fallen back", hp: 1.05, atk: 0.9, def: 1, luck: 0, skills: ["heal", "smite", "revive"] },
};
const CLASS_IDS = Object.keys(CLASSES);

// target: "foe" (a monster), "ally" (a hero standing), "fallen" (a hero down), "none" (no target)
const SKILLS = {
  bash: { name: "Shield Bash", icon: "💫", cost: 1, target: "foe", about: "Hits and stuns: the foe loses its next move" },
  taunt: { name: "Taunt", icon: "📣", cost: 1, target: "none", about: "Every foe attacks you this turn - you take 30% less" },
  cleave: { name: "Cleave", icon: "🪓", cost: 2, target: "none", about: "Hits every foe for 80%" },
  poisonblade: { name: "Poison Blade", icon: "☠️", cost: 1, target: "foe", about: "Hits and poisons it for 3 turns" },
  backstab: { name: "Backstab", icon: "🔪", cost: 2, target: "foe", about: "1.6x damage - 3x on a poisoned or stunned foe" },
  smoke: { name: "Smoke Bomb", icon: "💨", cost: 1, target: "none", about: "Nothing hits you this turn" },
  frost: { name: "Frost Bolt", icon: "❄️", cost: 1, target: "foe", about: "Hits and chills: its next 2 moves do half damage" },
  fireball: { name: "Fireball", icon: "🔥", cost: 2, target: "none", about: "Hits every foe for 70% and burns them for 2 turns" },
  barrier: { name: "Barrier", icon: "🔰", cost: 1, target: "ally", about: "A shield that takes 35% of the ally's max HP of damage" },
  heal: { name: "Heal", icon: "💚", cost: 1, target: "ally", about: "Heals an ally for 35% of its max HP" },
  smite: { name: "Smite", icon: "🌟", cost: 1, target: "foe", about: "1.4x damage - 2.5x against the undead" },
  revive: { name: "Revive", icon: "🕊️", cost: 3, target: "fallen", about: "Brings a fallen ally back with 40% HP" },
};

const ENERGY_MAX = 3;
const ENERGY_START = 1;
const GUARD = 0.4; // the damage that still comes through
const TAUNT = 0.7;
const CRIT = 1.8;
const REVIVE = 0.2; // a hero down: back up after the fight with this much HP
const TRAP_DAMAGE = 0.2;
const REST_HEAL = 0.35;
const SHRINE_COST = 0.2; // of the max HP
const SHRINE_POWER = 1.25; // the blessing: more damage for the rest of the run
const MERCHANT_PRICE = 0.1; // a potion: this share of the entry, from the pot

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

/* ---------- Monsters and what they do ---------- */

// What a monster can do (power: times its attack; all: every hero)
const MOVES = {
  attack: { name: "Attack", icon: "⚔️", power: 1 },
  smash: { name: "Smash", icon: "💥", power: 2.2 },
  poison: { name: "Poison bite", icon: "☠️", power: 0.6 },
  steal: { name: "Steal", icon: "🫳", power: 0.5 },
  burn: { name: "Fire wave", icon: "🔥", power: 0.5, all: true },
  drain: { name: "Drain", icon: "🩸", power: 1 },
  defend: { name: "Defend", icon: "🛡️", self: true },
  regen: { name: "Regenerate", icon: "💚", self: true },
  heal: { name: "Heal ally", icon: "💚", self: true },
  howl: { name: "Howl", icon: "📯", self: true },
  fade: { name: "Fade", icon: "🌫️", self: true },
};

// The monsters: a group per 5 floors (hp, atk: times the floor's; dodge: misses a hit that often; moves: what it does)
const MONSTERS = [
  [
    { name: "Slime", icon: "🟢", hp: 1, atk: 0.8, moves: ["attack", "attack", "defend"] },
    { name: "Rat", icon: "🐀", hp: 0.7, atk: 1, moves: ["attack", "poison"] },
    { name: "Bat", icon: "🦇", hp: 0.6, atk: 0.9, dodge: 0.2, moves: ["attack", "drain"] },
  ],
  [
    { name: "Goblin", icon: "👺", hp: 1, atk: 1, moves: ["attack", "attack", "steal"] },
    { name: "Spider", icon: "🕷️", hp: 0.8, atk: 1.1, moves: ["poison", "attack"] },
    { name: "Wolf", icon: "🐺", hp: 0.9, atk: 1.05, dodge: 0.1, moves: ["attack", "attack", "howl"] },
  ],
  [
    { name: "Skeleton", icon: "💀", hp: 1, atk: 1, undead: true, moves: ["attack", "attack", "defend"] },
    { name: "Ghost", icon: "👻", hp: 0.7, atk: 1, undead: true, moves: ["attack", "fade", "drain"] },
    { name: "Zombie", icon: "🧟", hp: 1.4, atk: 0.8, undead: true, moves: ["attack", "smash", "poison"] },
  ],
  [
    { name: "Orc", icon: "👹", hp: 1.2, atk: 1, moves: ["attack", "smash", "howl"] },
    { name: "Troll", icon: "🧌", hp: 1.5, atk: 0.9, moves: ["attack", "smash", "regen"] },
    { name: "Shaman", icon: "🧙", hp: 0.8, atk: 0.9, moves: ["attack", "heal", "burn"] },
  ],
  [
    { name: "Demon", icon: "😈", hp: 1.1, atk: 1.1, moves: ["attack", "burn", "smash"] },
    { name: "Golem", icon: "🗿", hp: 1.8, atk: 0.85, moves: ["smash", "defend", "attack"] },
    { name: "Wraith", icon: "🌫️", hp: 0.9, atk: 1.1, undead: true, dodge: 0.15, moves: ["drain", "fade", "attack"] },
  ],
];
const MONSTER_HP = 30;
const MONSTER_HP_GROWTH = 1.17;
const MONSTER_ATK = 8;
const MONSTER_ATK_GROWTH = 1.14;
const PARTY_HP = 0.7; // a monster has this much more HP per hero after the first

const round100 = (value) => Math.max(100, Math.round(value / 100) * 100);
const between = (rng, low, high) => low + rng() * (high - low);
const pick = (rng, list) => list[Math.floor(rng() * list.length)];

/* ---------- The hero ---------- */

function newHero() {
  return { cls: "warrior", levels: { hp: 0, atk: 0, def: 0, luck: 0 }, gear: { weapon: null, armor: null, charm: null }, bag: [], potions: 2, deepest: 0, runs: 0, cleared: 0 };
}

// What the hero has with class, levels and gear: {maxHp, atk, def, luck}
function statsOf(hero) {
  const cls = CLASSES[hero.cls] || CLASSES.warrior;
  const value = (id) => STATS[id].base + STATS[id].per * hero.levels[id];
  const gear = Object.values(hero.gear).filter(Boolean);
  const plus = (key) => gear.reduce((sum, item) => sum + (item[key] || 0), 0);
  return {
    maxHp: Math.round((value("hp") + plus("hp")) * cls.hp),
    atk: Math.round((value("atk") + plus("atk")) * cls.atk),
    def: value("def") + plus("def") + cls.def,
    luck: Math.min(60, value("luck") + plus("luck") + cls.luck),
  };
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
    cls: hero.cls,
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

/* ---------- The rooms: doors to choose from ---------- */

const ROOM_KINDS = {
  fight: { name: "Fight", icon: "⚔️", about: "Monsters - loot for the pot" },
  hard: { name: "Hard fight", icon: "☠️", about: "More and stronger monsters - almost double the loot" },
  elite: { name: "Elite fight", icon: "👑", about: "The guard of the floor" },
  boss: { name: "Boss", icon: "💀", about: "The master of the floor" },
  chest: { name: "Chest", icon: "🎁", about: "Coins for the pot - maybe gear for each hero" },
  rest: { name: "Camp fire", icon: "🔥", about: "Everybody heals 35% - and gets 1 energy for the next fight" },
  shrine: { name: "Shrine", icon: "⛩️", about: "Pay 20% HP each - 25% more damage for the rest of the run" },
  merchant: { name: "Merchant", icon: "🧳", about: "Potions for coins from the pot" },
  mystery: { name: "Mystery", icon: "❔", about: "A chest, a trap or a fight - who knows" },
  trap: { name: "Trap", icon: "🪤", about: "Luck dodges it" },
};
// The doors between the first and the last room (weights)
const DOOR_POOL = { fight: 3, hard: 2, chest: 2, rest: 1.5, shrine: 1, merchant: 1, mystery: 1.5 };

// Two different doors for the next room
function doorsFor(run, rng = Math.random) {
  const index = run.rooms.length;
  if (index == 0) return ["fight"];
  if (index == ROOMS - 1) return [BOSS_EVERY && run.floor % BOSS_EVERY == 0 ? "boss" : "elite"];
  const doors = [];
  while (doors.length < 2) {
    const pool = Object.entries(DOOR_POOL).filter(([kind]) => !doors.includes(kind));
    let roll = rng() * pool.reduce((sum, [, weight]) => sum + weight, 0);
    let chosen = pool[0][0];
    for (const [kind, weight] of pool) {
      if (roll < weight) {
        chosen = kind;
        break;
      }
      roll -= weight;
    }
    doors.push(chosen);
  }
  return doors;
}

let monsterCount = 0;

const RANKS = {
  normal: { id: "normal", prefix: "", hp: 1, atk: 1 },
  hard: { id: "normal", prefix: "", hp: 1.35, atk: 1.15 },
  elite: { id: "elite", prefix: "Elite ", hp: 2.4, atk: 1.3 },
  // (the bosses come later - for now a much stronger one of the floor's monsters)
  boss: { id: "boss", prefix: "Boss ", hp: 5, atk: 1.6 },
};

function monster(floor, size, kind, rank) {
  const hp = MONSTER_HP * Math.pow(MONSTER_HP_GROWTH, floor - 1) * kind.hp * (1 + PARTY_HP * (size - 1)) * rank.hp;
  const atk = MONSTER_ATK * Math.pow(MONSTER_ATK_GROWTH, floor - 1) * kind.atk * rank.atk;
  const max = Math.max(1, Math.round(hp));
  // (an elite also smashes)
  const moves = rank.id != "normal" && !kind.moves.includes("smash") ? [...kind.moves, "smash"] : kind.moves;
  return { id: "m" + ++monsterCount, name: rank.prefix + kind.name, icon: kind.icon, hp: max, maxHp: max, atk: Math.max(1, Math.round(atk)), dodge: kind.dodge || 0, undead: !!kind.undead, moves, rank: rank.id, effects: {}, intent: null };
}

// The monsters of a fight: 1 to 3 (more with a bigger party, a hard fight one more) - an elite with a few others
function monstersFor(floor, size, room, rng = Math.random) {
  const group = MONSTERS[Math.min(MONSTERS.length - 1, Math.floor((floor - 1) / 5))];
  if (room == "elite" || room == "boss") {
    const list = [monster(floor, size, pick(rng, group), RANKS[room])];
    for (let i = 0; i < Math.ceil(size / 2); i++) list.push(monster(floor, size, pick(rng, group), RANKS.normal));
    return list;
  }
  const extra = room == "hard" ? 1 : 0;
  const count = Math.min(4, 1 + Math.floor(rng() * 2) + Math.floor(size / 3) + extra);
  return Array.from({ length: count }, () => monster(floor, size, pick(rng, group), room == "hard" ? RANKS.hard : RANKS.normal));
}

/* ---------- A run ---------- */

function newRun(floor, party, rng = Math.random) {
  const run = {
    floor,
    rooms: [], // [{kind, done}] the rooms entered
    doors: [],
    phase: "between",
    heroes: party.map(({ name, hero }) => {
      const stats = statsOf(hero);
      return { name, cls: hero.cls, ...stats, hp: stats.maxHp, down: false, potions: hero.potions, energy: ENERGY_START, bonusEnergy: 0, effects: {}, action: null, blessed: false };
    }),
    monsters: [],
    turn: 0,
    pot: 0,
    loot: Object.fromEntries(party.map(({ name }) => [name, []])),
    log: [],
  };
  run.doors = doorsFor(run, rng);
  return run;
}

function say(run, text) {
  run.log.push(text);
  if (run.log.length > 40) run.log.splice(0, run.log.length - 40);
}

const alive = (list) => list.filter((one) => !one.down && one.hp > 0);
const roomNumber = (run) => run.rooms.length;

// Through one of the doors (index into run.doors): a fight starts, the other rooms happen right away
function enterRoom(run, door = 0, rng = Math.random) {
  let kind = run.doors[door] || run.doors[0];
  if (kind == "mystery") {
    kind = pick(rng, ["chest", "chest", "trap", "fight", "hard"]);
    say(run, `Room ${roomNumber(run) + 1}: the mystery door - ${ROOM_KINDS[kind].icon} ${ROOM_KINDS[kind].name}!`);
  }
  const room = { kind, done: false };
  run.rooms.push(room);
  run.doors = [];
  const heroes = alive(run.heroes);
  const n = roomNumber(run);
  if (kind == "fight" || kind == "hard" || kind == "elite" || kind == "boss") {
    run.monsters = monstersFor(run.floor, run.heroes.length, kind, rng);
    run.phase = "fight";
    run.turn = 1;
    for (const hero of run.heroes) {
      hero.action = null;
      hero.effects = {};
      hero.energy = Math.min(ENERGY_MAX, ENERGY_START + hero.bonusEnergy);
      hero.bonusEnergy = 0;
    }
    say(run, `Room ${n}: ${run.monsters.map((m) => m.icon + " " + m.name).join(", ")}!`);
    planIntents(run, rng);
    return;
  }
  if (kind == "chest") {
    const coins = Math.round(entryCost(run.floor) * REWARD.chest);
    run.pot += coins;
    say(run, `Room ${n}: a chest - 🪙 ${coins} each for the pot.`);
    for (const hero of heroes) {
      // (every hero rolls for gear on its own - luck helps)
      if (rng() * 100 < 35 + hero.luck / 2) {
        const item = makeGear(run.floor, rng, hero.luck);
        run.loot[hero.name].push(item);
        say(run, `${hero.name} finds ${item.icon} ${item.name} (${item.rarity}).`);
      }
    }
  } else if (kind == "trap") {
    say(run, `Room ${n}: a trap!`);
    for (const hero of heroes) {
      if (rng() * 100 < hero.luck * 2) say(run, `${hero.name} dodges it.`);
      else {
        const damage = Math.round(hero.maxHp * TRAP_DAMAGE);
        hero.hp = Math.max(1, hero.hp - damage);
        say(run, `${hero.name} takes ${damage} damage.`);
      }
    }
  } else if (kind == "rest") {
    say(run, `Room ${n}: a camp fire - everybody heals and rests.`);
    for (const hero of heroes) {
      hero.hp = Math.min(hero.maxHp, hero.hp + Math.round(hero.maxHp * REST_HEAL));
      hero.bonusEnergy = 1;
    }
  } else if (kind == "shrine") {
    say(run, `Room ${n}: a shrine - blood for power. Everybody deals 25% more damage now.`);
    for (const hero of heroes) {
      hero.hp = Math.max(1, hero.hp - Math.round(hero.maxHp * SHRINE_COST));
      hero.blessed = true;
    }
  } else if (kind == "merchant") {
    // (a potion for every hero who has room for one - paid from the pot, as long as it lasts)
    const price = Math.round(entryCost(run.floor) * MERCHANT_PRICE);
    let sold = 0;
    for (const hero of heroes) {
      if (hero.potions < POTIONS_MAX && run.pot >= price) {
        run.pot -= price;
        hero.potions++;
        sold++;
      }
    }
    say(run, sold ? `Room ${n}: a merchant - ${sold} potion${sold == 1 ? "" : "s"} for 🪙 ${price} each from the pot.` : `Room ${n}: a merchant - but nothing to buy (the pot is too small or the bags are full).`);
  }
  room.done = true;
  afterRoom(run, rng);
}

// A room done: the doors to the next one - or the floor is cleared
function afterRoom(run, rng = Math.random) {
  run.monsters = [];
  if (run.rooms.length >= ROOMS) {
    run.phase = "won";
    say(run, `Floor ${run.floor} cleared! 🎉`);
    return;
  }
  run.phase = "between";
  run.doors = doorsFor(run, rng);
}

/* ---------- A fight ---------- */

// What every monster does next: a move and (an attack) a hero - shown before the heroes choose
function planIntents(run, rng = Math.random) {
  const heroes = alive(run.heroes);
  for (const foe of alive(run.monsters)) {
    let options = foe.moves.filter((move) => {
      if (move == "regen") return foe.hp < foe.maxHp * 0.7;
      if (move == "heal") return alive(run.monsters).some((m) => m.hp < m.maxHp * 0.7);
      if (move == "howl") return !foe.effects.rage;
      if (move == "steal") return heroes.some((h) => h.potions > 0);
      return true;
    });
    if (!options.length) options = ["attack"];
    const move = pick(rng, options);
    const intent = { move };
    if (!MOVES[move].self && !MOVES[move].all && heroes.length) {
      // (the wounded draw them - a hero below half HP twice as often)
      const weights = heroes.map((h) => (h.hp < h.maxHp / 2 ? 2 : 1));
      let roll = rng() * weights.reduce((a, b) => a + b, 0);
      let index = 0;
      while (roll >= weights[index] && index < heroes.length - 1) roll -= weights[index++];
      intent.target = heroes[index].name;
    }
    foe.intent = intent;
  }
}

// What a monster's move would do now (the page shows it)
function intentDamage(foe, move) {
  const info = MOVES[move];
  if (!info.power) return 0;
  let damage = foe.atk * info.power;
  if (foe.effects.rage) damage *= 1.3;
  if (foe.effects.chill) damage *= 0.5;
  return Math.max(1, Math.round(damage));
}

// A hero's action for this turn: {action: "attack" | "guard" | "potion" | "skill", skill, target, ally} -> an error or null
function choose(run, name, input) {
  if (run.phase != "fight") return "No fight now.";
  const hero = run.heroes.find((h) => h.name == name);
  if (!hero || hero.down) return "Your hero is down.";
  const action = input && input.action;
  if (!["attack", "skill", "guard", "potion"].includes(action)) return "Unknown action.";
  if (action == "potion" && hero.potions <= 0) return "No potions left.";
  if (action == "potion" && hero.hp >= hero.maxHp) return "Your HP is full.";
  const choice = { action, target: input.target != null ? String(input.target) : null, ally: input.ally != null ? String(input.ally) : null };
  if (action == "skill") {
    const cls = CLASSES[hero.cls];
    const skill = SKILLS[input.skill];
    if (!skill || !cls.skills.includes(input.skill)) return "Unknown skill.";
    if (hero.energy < skill.cost) return `${skill.name} needs ${skill.cost} energy.`;
    if (skill.target == "fallen" && !run.heroes.some((h) => h.down && (choice.ally == null || h.name == choice.ally))) return "Nobody to bring back.";
    choice.skill = input.skill;
  }
  hero.action = choice;
  return null;
}

// Every hero still standing has picked an action
function allChosen(run) {
  return alive(run.heroes).every((hero) => hero.action);
}

// A hit of a hero on a monster: the damage done (the foe may dodge a plain hit - a fade dodges every plain hit)
function strike(run, hero, foe, power, rng, options = {}) {
  if (!options.sure && (foe.fading || rng() < foe.dodge)) {
    say(run, `${foe.icon} ${foe.name} dodges ${hero.name}.`);
    return 0;
  }
  const crit = rng() * 100 < hero.luck;
  let damage = hero.atk * between(rng, 0.9, 1.1) * power * (crit ? CRIT : 1) * (hero.blessed ? SHRINE_POWER : 1);
  if (foe.defending) damage *= 0.5;
  damage = Math.max(1, Math.round(damage));
  foe.hp = Math.max(0, foe.hp - damage);
  say(run, `${hero.name}${options.verb ? " " + options.verb : " hits"} ${foe.icon} ${foe.name} for ${damage}${crit ? " (critical!)" : ""}${foe.defending ? " (blocked half)" : ""}.`);
  if (foe.hp == 0) {
    foe.down = true;
    say(run, `${foe.icon} ${foe.name} is defeated.`);
  }
  return damage;
}

// Damage to a hero: guard, taunt, smoke and a shield take their part
function hurt(run, hero, raw, source) {
  if (hero.evading) {
    say(run, `${source} misses ${hero.name} in the smoke.`);
    return 0;
  }
  let damage = raw - hero.def;
  if (hero.guarding) damage *= GUARD;
  if (hero.taunting) damage *= TAUNT;
  damage = Math.max(1, Math.round(damage));
  const shield = hero.effects.shield;
  let absorbed = 0;
  if (shield) {
    absorbed = Math.min(shield.hp, damage);
    shield.hp -= absorbed;
    damage -= absorbed;
    if (shield.hp <= 0) delete hero.effects.shield;
  }
  hero.hp = Math.max(0, hero.hp - damage);
  say(run, `${source} hits ${hero.name} for ${damage}${absorbed ? ` (${absorbed} on the shield)` : ""}${hero.guarding ? " (guarded)" : ""}.`);
  if (hero.hp == 0) {
    hero.down = true;
    hero.effects = {};
    say(run, `${hero.name} is down!`);
  }
  return damage;
}

function useSkill(run, hero, choice, rng) {
  const skill = SKILLS[choice.skill];
  hero.energy -= skill.cost;
  const foes = alive(run.monsters);
  const foe = foes.find((m) => m.id == choice.target) || (skill.target == "foe" ? foes[0] : null);
  const ally = (list) => list.find((h) => h.name == choice.ally) || null;
  switch (choice.skill) {
    case "bash":
      if (!foe) return;
      if (strike(run, hero, foe, 0.8, rng, { sure: true, verb: "bashes" }) && !foe.down) {
        foe.effects.stun = 1;
        say(run, `${foe.icon} ${foe.name} is stunned 💫.`);
      }
      return;
    case "taunt":
      hero.taunting = true;
      say(run, `${hero.name} taunts the foes 📣.`);
      return;
    case "cleave":
      say(run, `${hero.name} cleaves 🪓!`);
      for (const one of foes) strike(run, hero, one, 0.8, rng, { sure: true, verb: "cleaves" });
      return;
    case "poisonblade":
      if (!foe) return;
      if (strike(run, hero, foe, 0.8, rng, { sure: true, verb: "cuts" }) && !foe.down) {
        foe.effects.poison = { turns: 3, dmg: Math.max(1, Math.round(hero.atk * 0.45)) };
        say(run, `${foe.icon} ${foe.name} is poisoned ☠️.`);
      }
      return;
    case "backstab":
      if (!foe) return;
      strike(run, hero, foe, foe.effects.poison || foe.effects.stun ? 3 : 1.6, rng, { sure: true, verb: "backstabs" });
      return;
    case "smoke":
      hero.evading = true;
      say(run, `${hero.name} vanishes in smoke 💨.`);
      return;
    case "frost":
      if (!foe) return;
      if (strike(run, hero, foe, 0.9, rng, { sure: true, verb: "freezes" }) && !foe.down) {
        foe.effects.chill = 2;
        say(run, `${foe.icon} ${foe.name} is chilled ❄️.`);
      }
      return;
    case "fireball":
      say(run, `${hero.name} casts a fireball 🔥!`);
      for (const one of foes) {
        if (strike(run, hero, one, 0.7, rng, { sure: true, verb: "burns" }) && !one.down) one.effects.burn = { turns: 2, dmg: Math.max(1, Math.round(hero.atk * 0.3)) };
      }
      return;
    case "barrier": {
      const friend = ally(alive(run.heroes)) || hero;
      friend.effects.shield = { hp: Math.round(friend.maxHp * 0.35) };
      say(run, `${hero.name} shields ${friend.name} 🔰.`);
      return;
    }
    case "heal": {
      const friend = ally(alive(run.heroes)) || hero;
      const heal = Math.min(friend.maxHp - friend.hp, Math.round(friend.maxHp * 0.35));
      friend.hp += heal;
      say(run, `${hero.name} heals ${friend.name} for ${heal} 💚.`);
      return;
    }
    case "smite":
      if (!foe) return;
      strike(run, hero, foe, foe.undead ? 2.5 : 1.4, rng, { sure: true, verb: "smites" });
      return;
    case "revive": {
      const fallen = run.heroes.filter((h) => h.down);
      const friend = ally(fallen) || fallen[0];
      if (!friend) {
        hero.energy += skill.cost;
        return;
      }
      friend.down = false;
      friend.hp = Math.round(friend.maxHp * 0.4);
      say(run, `${hero.name} brings ${friend.name} back 🕊️!`);
      return;
    }
  }
}

// What a monster does: its intent (stunned: nothing)
function monsterMove(run, foe, rng) {
  const intent = foe.intent || { move: "attack" };
  const move = MOVES[intent.move];
  const heroes = alive(run.heroes);
  if (!heroes.length) return;
  const taunter = heroes.find((h) => h.taunting);
  const target = move.self || move.all ? null : taunter || heroes.find((h) => h.name == intent.target) || pick(rng, heroes);
  const source = `${foe.icon} ${foe.name}`;
  const damage = intentDamage(foe, intent.move);
  switch (intent.move) {
    case "attack":
    case "smash":
      hurt(run, target, damage * between(rng, 0.9, 1.1), intent.move == "smash" ? source + " 💥 smashes and" : source);
      break;
    case "poison":
      if (hurt(run, target, damage, source) > 0 && !target.down) {
        target.effects.poison = { turns: 3, dmg: Math.max(1, Math.round(foe.atk * 0.35)) };
        say(run, `${target.name} is poisoned ☠️.`);
      }
      break;
    case "steal":
      hurt(run, target, damage, source);
      if (target.potions > 0 && !target.evading) {
        target.potions--;
        say(run, `${source} steals a potion from ${target.name} 🫳!`);
      }
      break;
    case "drain": {
      const done = hurt(run, target, damage, source);
      foe.hp = Math.min(foe.maxHp, foe.hp + done);
      break;
    }
    case "burn":
      say(run, `${source} sends a fire wave 🔥!`);
      for (const hero of heroes) {
        if (hurt(run, hero, damage, source) > 0 && !hero.down) hero.effects.burn = { turns: 2, dmg: Math.max(1, Math.round(foe.atk * 0.25)) };
      }
      break;
    case "regen": {
      const heal = Math.round(foe.maxHp * 0.25);
      foe.hp = Math.min(foe.maxHp, foe.hp + heal);
      say(run, `${source} regenerates ${heal} HP.`);
      break;
    }
    case "heal": {
      const hurtOne = alive(run.monsters).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
      const heal = Math.round(hurtOne.maxHp * 0.3);
      hurtOne.hp = Math.min(hurtOne.maxHp, hurtOne.hp + heal);
      say(run, `${source} heals ${hurtOne.icon} ${hurtOne.name} for ${heal}.`);
      break;
    }
    case "howl":
      for (const one of alive(run.monsters)) one.effects.rage = 2;
      say(run, `${source} howls 📯 - the monsters rage (more damage)!`);
      break;
  }
  // (chill wears off with every move)
  if (foe.effects.chill && move.power) {
    foe.effects.chill--;
    if (!foe.effects.chill) delete foe.effects.chill;
  }
}

// Poison and burns tick, the turn-long states go
function endTurn(run) {
  for (const one of [...alive(run.heroes), ...alive(run.monsters)]) {
    const label = one.icon ? `${one.icon} ${one.name}` : one.name;
    for (const kind of ["poison", "burn"]) {
      const effect = one.effects[kind];
      if (!effect) continue;
      one.hp = Math.max(0, one.hp - effect.dmg);
      say(run, `${label} takes ${effect.dmg} from ${kind == "poison" ? "poison ☠️" : "the burn 🔥"}.`);
      if (--effect.turns <= 0) delete one.effects[kind];
      if (one.hp == 0) {
        one.down = true;
        say(run, `${label} ${one.icon ? "is defeated" : "is down"}!`);
        break;
      }
    }
    if (one.effects.rage && --one.effects.rage <= 0) delete one.effects.rage;
  }
  for (const hero of run.heroes) {
    hero.guarding = hero.taunting = hero.evading = false;
    hero.action = null;
  }
  for (const foe of run.monsters) foe.defending = foe.fading = false;
}

// The turn: the heroes act (who didn't pick: attacks), then the monsters do what they showed, then poison and burns
function resolveTurn(run, rng = Math.random) {
  if (run.phase != "fight") return;
  // (the monsters' own guard is up before the heroes strike - they showed it)
  for (const foe of alive(run.monsters)) {
    if (foe.effects.stun) continue;
    if (foe.intent && foe.intent.move == "defend") foe.defending = true;
    if (foe.intent && foe.intent.move == "fade") foe.fading = true;
  }
  for (const hero of alive(run.heroes)) {
    const choice = hero.action || { action: "attack" };
    if (choice.action == "guard") {
      hero.guarding = true;
      hero.energy = Math.min(ENERGY_MAX, hero.energy + 1);
      say(run, `${hero.name} raises the guard.`);
    } else if (choice.action == "potion" && hero.potions > 0) {
      const heal = Math.min(hero.maxHp - hero.hp, Math.round(hero.maxHp * POTION_HEAL));
      hero.hp += heal;
      hero.potions--;
      say(run, `${hero.name} drinks a potion: +${heal} HP.`);
    } else if (choice.action == "skill" && SKILLS[choice.skill] && hero.energy >= SKILLS[choice.skill].cost) {
      useSkill(run, hero, choice, rng);
    } else {
      const foes = alive(run.monsters);
      if (foes.length) strike(run, hero, foes.find((m) => m.id == choice.target) || pick(rng, foes), 1, rng);
    }
    if (!alive(run.monsters).length) break;
  }
  if (!alive(run.monsters).length) return winFight(run, rng);
  for (const foe of alive(run.monsters)) {
    if (foe.effects.stun) {
      delete foe.effects.stun;
      say(run, `${foe.icon} ${foe.name} is stunned and does nothing.`);
      continue;
    }
    if (foe.intent && (foe.intent.move == "defend" || foe.intent.move == "fade")) {
      say(run, `${foe.icon} ${foe.name} ${foe.intent.move == "defend" ? "holds its guard" : "fades from sight"}.`);
      continue;
    }
    monsterMove(run, foe, rng);
    if (!alive(run.heroes).length) break;
  }
  endTurn(run);
  if (!alive(run.heroes).length) {
    run.phase = "lost";
    run.pot = 0;
    say(run, "The whole party is down - the loot is lost. 💀");
    return;
  }
  if (!alive(run.monsters).length) return winFight(run, rng);
  for (const hero of alive(run.heroes)) hero.energy = Math.min(ENERGY_MAX, hero.energy + 1);
  run.turn++;
  planIntents(run, rng);
}

function winFight(run, rng) {
  const room = run.rooms[run.rooms.length - 1];
  const coins = Math.round(entryCost(run.floor) * REWARD[room.kind]);
  run.pot += coins;
  say(run, `Victory! 🪙 ${coins} each for the pot.`);
  // (the ones down get back up, every state goes)
  for (const hero of run.heroes) {
    hero.action = null;
    hero.effects = {};
    hero.guarding = hero.taunting = hero.evading = false;
    if (hero.down) {
      hero.down = false;
      hero.hp = Math.max(1, Math.round(hero.maxHp * REVIVE));
      say(run, `${hero.name} gets back up.`);
    }
  }
  room.done = true;
  afterRoom(run, rng);
}

// For the pages
function runView(run) {
  const effectsOf = (effects) => Object.fromEntries(Object.entries(effects).map(([kind, value]) => [kind, typeof value == "object" ? value.turns || value.hp : value]));
  return {
    floor: run.floor,
    phase: run.phase,
    room: run.rooms.length - 1,
    rooms: run.rooms.map((room) => ({ kind: room.kind, done: room.done })),
    doors: run.doors,
    heroes: run.heroes.map((h) => ({ name: h.name, cls: h.cls, hp: h.hp, maxHp: h.maxHp, atk: h.atk, def: h.def, luck: h.luck, down: h.down, potions: h.potions, energy: h.energy, blessed: h.blessed, effects: effectsOf(h.effects), chose: !!h.action })),
    monsters: run.monsters.map((m) => ({
      id: m.id,
      name: m.name,
      icon: m.icon,
      hp: m.hp,
      maxHp: m.maxHp,
      atk: m.atk,
      rank: m.rank,
      undead: m.undead,
      down: !!m.down,
      effects: effectsOf(m.effects),
      intent: m.down || !m.intent ? null : { move: m.intent.move, target: m.intent.target || null, damage: intentDamage(m, m.intent.move), stunned: !!m.effects.stun },
    })),
    turn: run.turn,
    pot: run.pot,
    loot: run.loot,
    log: run.log,
  };
}

/* ---------- Simulation (the tests, tuning) ---------- */

// A plain player: a potion when low, a damage skill when there is energy, the safer door when hurt
function simulatedChoice(run, me) {
  const smashing = alive(run.monsters).some((m) => m.intent && m.intent.target == me.name && m.intent.move == "smash" && !m.effects.stun);
  if (me.hp < me.maxHp * 0.35 && me.potions > 0) return { action: "potion" };
  if (smashing && me.energy < 2) return { action: "guard" };
  const cls = CLASSES[me.cls];
  const foes = alive(run.monsters);
  for (const id of [...cls.skills].reverse()) {
    const skill = SKILLS[id];
    if (me.energy < skill.cost || skill.target == "fallen") continue;
    if (id == "heal" && me.hp > me.maxHp * 0.6) continue;
    if ((id == "taunt" || id == "smoke" || id == "barrier") && !smashing) continue;
    return { action: "skill", skill: id, target: foes[0] && foes[0].id, ally: me.name };
  }
  return { action: "attack", target: foes[0] && foes[0].id };
}

// How a floor goes for a hero this strong alone: {cleared: share of the runs, payback: back per coin}
function simulate(hero, floor, runs = 500, rng = Math.random) {
  let cleared = 0;
  let back = 0;
  for (let i = 0; i < runs; i++) {
    const run = newRun(floor, [{ name: "sim", hero }], rng);
    while (run.phase == "between") {
      const me = run.heroes[0];
      const safe = run.doors.indexOf("rest");
      enterRoom(run, me.hp < me.maxHp * 0.5 && safe >= 0 ? safe : run.doors.indexOf("hard") == 0 ? 1 : 0, rng);
      let turns = 0;
      while (run.phase == "fight" && turns++ < 200) {
        choose(run, "sim", simulatedChoice(run, run.heroes[0]));
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
  CLASSES,
  CLASS_IDS,
  SKILLS,
  MOVES,
  ROOM_KINDS,
  ENERGY_MAX,
  newHero,
  statsOf,
  upgradeCost,
  maxFloor,
  entryCost,
  heroView,
  makeGear,
  doorsFor,
  monstersFor,
  newRun,
  enterRoom,
  planIntents,
  choose,
  allChosen,
  resolveTurn,
  runView,
  simulate,
};
