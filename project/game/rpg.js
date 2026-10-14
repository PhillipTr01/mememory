/*
 * The dungeon: an RPG in the casino (for now only in the admin's test world - sockets/rpg_server.js).
 *
 * A hero per player: a class (Warrior, Paladin, Cleric, Rogue, Mage - each a main stat and its own cards),
 * five stats bought with coins (upgrades, every level dearer - the class's main stat counts 1.5x), gear
 * from chests (a weapon, an armor, a charm - from common to legendary) and potions. A run: a party of 1
 * to 4 heroes pays the entry of a floor (each the same) and goes through its rooms. Between two rooms
 * there are three hidden doors - nobody knows what is behind them (a lucky hero sometimes hears a hint):
 * the party votes for one (or to leave with the loot) - the most votes win, a tie goes with the leader.
 * The first room is a fight, the last the guarded gate (an elite fight); a floor cleared opens the next
 * one. All heroes down: the pot is lost.
 *
 * Fights are played with cards (like Slay the Spire): every hero has a deck (a starter deck of the class -
 * every fight won: one card more, picked of three), draws 5 cards a turn and has 3 energy to play them
 * (attacks, block, the class's skills). Every monster shows what it does next and to whom (its intent);
 * when every hero has ended the turn, the monsters do what they showed, poison and burns tick. Status
 * effects: poison, burn, stun (loses its next move), chill (half damage), might (more damage), rage
 * (monsters, more damage). Block takes the damage of the monsters' turn, then it is gone.
 *
 * Bosses: the hook is here (BOSS_EVERY - the last room of every n-th floor), the bosses come later.
 *
 * Everything random comes from `rng` (Math.random - the tests give their own).
 */

const FLOORS = 30;
const ROOMS = 6;
const DOORS = 3;
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
  def: { name: "Armor", icon: "🛡️", base: 0, per: 2, about: "+2 defense (and more block)" },
  luck: { name: "Luck", icon: "🍀", base: 5, per: 2, about: "+2% critical hits, hints behind the doors, dodging traps, better loot" },
  agi: { name: "Agility", icon: "🪶", base: 0, per: 1.5, about: "+1.5% to dodge an attack" },
};
const STAT_IDS = Object.keys(STATS);
const LEVEL_MAX = 50;
const UPGRADE_BASE = 2000;
const UPGRADE_GROWTH = 1.35;
// The main stat of a class: its levels count this much more
const MAIN_BONUS = 1.5;
const DODGE_MAX = 40;

const ENTRY_BASE = 1000;
const ENTRY_GROWTH = 1.35;
// What a room puts in the pot (per hero, a share of the entry)
const REWARD = { fight: 0.2, hard: 0.38, elite: 0.35, boss: 1, chest: 0.15, trap: 0, rest: 0, shrine: 0, merchant: 0 };

/* ---------- Classes and their cards ---------- */

// main: the stat its levels count 1.5x for; hp, atk: times the stats; def, luck, agi: added;
// deck: the starter deck; cards: the class's cards (the rewards)
const CLASSES = {
  warrior: { name: "Warrior", icon: "⚔️", main: "atk", about: "Strength - heavy blows, cleaves the pack, a war cry for the party", hp: 1.15, atk: 1.15, def: 2, luck: 0, agi: 0, signature: ["bash", "cleave"], cards: ["bash", "cleave", "battlecry", "ironwave", "bloodlust"] },
  paladin: { name: "Paladin", icon: "🔰", main: "def", about: "Armor - draws the attacks, shields the party, judges with his armor", hp: 1.15, atk: 0.9, def: 4, luck: 0, agi: 0, signature: ["taunt", "judgement"], cards: ["taunt", "judgement", "holyshield", "consecrate", "bulwark"] },
  cleric: { name: "Cleric", icon: "✨", main: "hp", about: "Vitality - heals, smites the undead, brings the fallen back", hp: 1.2, atk: 0.9, def: 1, luck: 0, agi: 0, signature: ["heal", "smite"], cards: ["heal", "smite", "revive", "prayer", "blessing"] },
  rogue: { name: "Rogue", icon: "🗡️", main: "agi", about: "Agility - dodges, poisons, then strikes where it hurts", hp: 0.95, atk: 1.05, def: 0, luck: 5, agi: 8, signature: ["poisonblade", "backstab"], cards: ["poisonblade", "backstab", "smoke", "envenom", "flurry"] },
  mage: { name: "Mage", icon: "🔮", main: "luck", about: "Luck - spells that crit, fire on all foes, frost that weakens", hp: 0.85, atk: 1.15, def: 0, luck: 8, agi: 0, signature: ["frost", "fireball"], cards: ["frost", "fireball", "barrier", "arcanebolt", "meteor"] },
};
const CLASS_IDS = Object.keys(CLASSES);

// The cards. type: attack / skill; target: "foe" (a monster), "ally" (a hero standing), "fallen" (a hero
// down), "none"; exhaust: gone for the rest of the fight once played
const CARDS = {
  strike: { name: "Strike", icon: "⚔️", cost: 1, type: "attack", target: "foe", text: "Deal 100% damage." },
  defend: { name: "Defend", icon: "🛡️", cost: 1, type: "skill", target: "none", text: "Block 6 + armor." },
  focus: { name: "Focus", icon: "🧠", cost: 0, type: "skill", target: "none", exhaust: true, text: "Draw 2 cards. Exhaust." },
  secondwind: { name: "Second Wind", icon: "🌬️", cost: 1, type: "skill", target: "none", text: "Block 5 + armor, heal 6% HP." },
  adrenaline: { name: "Adrenaline", icon: "💉", cost: 0, type: "skill", target: "none", exhaust: true, text: "+1 energy, draw 1. Exhaust." },
  quickslash: { name: "Quick Slash", icon: "🌀", cost: 0, type: "attack", target: "foe", text: "Deal 50% damage, draw 1." },
  // Warrior
  bash: { name: "Heavy Blow", icon: "💫", cost: 2, type: "attack", target: "foe", text: "Deal 110% damage and stun: it loses its next move." },
  cleave: { name: "Cleave", icon: "🪓", cost: 1, type: "attack", target: "none", text: "Deal 70% damage to every foe." },
  battlecry: { name: "War Cry", icon: "📯", cost: 1, type: "skill", target: "none", exhaust: true, text: "The party deals 30% more damage for 2 turns. Exhaust." },
  ironwave: { name: "Iron Wave", icon: "🌊", cost: 1, type: "attack", target: "foe", text: "Deal 70% damage, block 4 + half the armor." },
  bloodlust: { name: "Bloodlust", icon: "🩸", cost: 0, type: "skill", target: "none", exhaust: true, text: "Lose 8% HP, +2 energy. Exhaust." },
  // Paladin
  taunt: { name: "Taunt", icon: "📣", cost: 1, type: "skill", target: "none", text: "Every foe attacks you this turn - you take 30% less. Block 4 + armor." },
  judgement: { name: "Judgement", icon: "⚖️", cost: 1, type: "attack", target: "foe", text: "Deal attack + armor as damage. Never misses." },
  holyshield: { name: "Holy Shield", icon: "🛡️", cost: 2, type: "skill", target: "none", text: "Every hero blocks 5 + your armor." },
  consecrate: { name: "Consecrate", icon: "🕯️", cost: 2, type: "attack", target: "none", text: "Deal 50% damage to every foe, the party heals 5% HP." },
  bulwark: { name: "Bulwark", icon: "🏰", cost: 1, type: "skill", target: "none", text: "Block 10 + twice the armor." },
  // Cleric
  heal: { name: "Heal", icon: "💚", cost: 1, type: "skill", target: "ally", text: "Heal an ally 25% of its max HP." },
  smite: { name: "Smite", icon: "🌟", cost: 1, type: "attack", target: "foe", text: "Deal 120% damage - 250% against the undead." },
  revive: { name: "Revive", icon: "🕊️", cost: 2, type: "skill", target: "fallen", exhaust: true, text: "A fallen ally stands up with 40% HP. Exhaust." },
  prayer: { name: "Prayer", icon: "🙏", cost: 2, type: "skill", target: "none", text: "The whole party heals 12% HP." },
  blessing: { name: "Blessing", icon: "🌞", cost: 1, type: "skill", target: "ally", text: "An ally deals 30% more damage for 2 turns and blocks 5." },
  // Rogue
  poisonblade: { name: "Poison Blade", icon: "☠️", cost: 1, type: "attack", target: "foe", text: "Deal 60% damage, poison it for 3 turns." },
  backstab: { name: "Backstab", icon: "🔪", cost: 1, type: "attack", target: "foe", text: "Deal 120% damage - 300% on a poisoned or stunned foe." },
  smoke: { name: "Smoke Bomb", icon: "💨", cost: 1, type: "skill", target: "none", text: "Nothing hits you this turn." },
  envenom: { name: "Envenom", icon: "🧪", cost: 1, type: "skill", target: "none", text: "Poison every foe for 2 turns." },
  flurry: { name: "Flurry", icon: "✴️", cost: 1, type: "attack", target: "none", text: "Deal 40% damage three times to random foes." },
  // Mage
  frost: { name: "Frost Bolt", icon: "❄️", cost: 1, type: "attack", target: "foe", text: "Deal 80% damage and chill: its next 2 moves do half damage." },
  fireball: { name: "Fireball", icon: "🔥", cost: 2, type: "attack", target: "none", text: "Deal 70% damage to every foe and burn them for 2 turns." },
  barrier: { name: "Barrier", icon: "🔮", cost: 1, type: "skill", target: "ally", text: "An ally blocks 8 + 60% of your attack." },
  arcanebolt: { name: "Arcane Bolt", icon: "✨", cost: 1, type: "attack", target: "foe", text: "Deal 150% damage." },
  meteor: { name: "Meteor", icon: "☄️", cost: 3, type: "attack", target: "none", text: "Deal 160% damage to every foe." },
};
const NEUTRAL_CARDS = ["focus", "secondwind", "adrenaline", "quickslash"];

const ENERGY = 3; // a turn
const HAND = 5; // cards drawn a turn
const HAND_MAX = 10;
const TAUNT = 0.7;
const CRIT = 1.8;
const MIGHT = 1.3;
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
const MONSTER_HP = 52;
const MONSTER_HP_GROWTH = 1.17;
const MONSTER_ATK = 11;
const MONSTER_ATK_GROWTH = 1.14;
const PARTY_HP = 0.7; // a monster has this much more HP per hero after the first

const round100 = (value) => Math.max(100, Math.round(value / 100) * 100);
const between = (rng, low, high) => low + rng() * (high - low);
const pick = (rng, list) => list[Math.floor(rng() * list.length)];

/* ---------- The hero ---------- */

function newHero() {
  return { cls: "warrior", levels: { hp: 0, atk: 0, def: 0, luck: 0, agi: 0 }, gear: { weapon: null, armor: null, charm: null }, bag: [], potions: 2, deepest: 0, runs: 0, cleared: 0 };
}

// What the hero has with class, levels and gear: {maxHp, atk, def, luck, agi} (agi: the dodge chance, %)
function statsOf(hero) {
  const cls = CLASSES[hero.cls] || CLASSES.warrior;
  const value = (id) => STATS[id].base + STATS[id].per * (hero.levels[id] || 0) * (cls.main == id ? MAIN_BONUS : 1);
  const gear = Object.values(hero.gear).filter(Boolean);
  const plus = (key) => gear.reduce((sum, item) => sum + (item[key] || 0), 0);
  return {
    maxHp: Math.round((value("hp") + plus("hp")) * cls.hp),
    atk: Math.round((value("atk") + plus("atk")) * cls.atk),
    def: Math.round(value("def") + plus("def") + cls.def),
    luck: Math.min(60, Math.round(value("luck") + plus("luck") + cls.luck)),
    agi: Math.min(DODGE_MAX, Math.round(value("agi") + plus("agi") + cls.agi)),
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
    levels: { ...newHero().levels, ...hero.levels },
    stats: statsOf(hero),
    upgrades: Object.fromEntries(STAT_IDS.map((id) => [id, upgradeCost(hero.levels[id] || 0)])),
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

/* ---------- The rooms: hidden doors ---------- */

const ROOM_KINDS = {
  fight: { name: "Fight", icon: "⚔️", about: "Monsters - loot for the pot" },
  hard: { name: "Hard fight", icon: "☠️", about: "More and stronger monsters - almost double the loot" },
  elite: { name: "The guarded gate", icon: "👑", about: "The guard of the floor - beat it to clear the floor" },
  boss: { name: "Boss", icon: "💀", about: "The master of the floor" },
  chest: { name: "Chest", icon: "🎁", about: "Coins for the pot - maybe gear for each hero" },
  trap: { name: "Trap", icon: "🪤", about: "Luck dodges it" },
  rest: { name: "Camp fire", icon: "🔥", about: "Everybody heals 35% - and 1 more energy in the next fight" },
  shrine: { name: "Shrine", icon: "⛩️", about: "Blood for power: 20% HP each, 25% more damage for the rest of the run" },
  merchant: { name: "Merchant", icon: "🧳", about: "Potions for coins from the pot" },
};
// What waits behind a door (weights) - mostly fights
const DOOR_POOL = { fight: 6, hard: 2.5, trap: 1.2, chest: 1.5, rest: 0.7, shrine: 0.4, merchant: 0.4 };
// What a lucky hero hears behind a door
const HINTS = {
  fight: ["You hear growling.", "Something scratches at the door."],
  hard: ["Heavy footsteps - many of them.", "A deep roar shakes the door."],
  chest: ["Something glitters under the door.", "It smells of old gold."],
  trap: ["A faint click.", "The floor in front of it is scratched."],
  rest: ["Warm air comes through the cracks.", "It smells of smoke and bread."],
  shrine: ["A faint chant.", "Candle light flickers behind it."],
  merchant: ["Coins clink.", "Someone hums a tune."],
};

function weighted(rng, entries) {
  let roll = rng() * entries.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [value, weight] of entries) {
    if (roll < weight) return value;
    roll -= weight;
  }
  return entries[entries.length - 1][0];
}

// The doors of the next room: the first a fight, the last the guarded gate - between them three hidden ones
// (the luckiest hero of the party: that often a hint behind each)
function doorsFor(run, rng = Math.random) {
  const index = run.rooms.length;
  if (index == 0) return [{ kind: "fight", hint: null, open: true }];
  if (index == ROOMS - 1) return [{ kind: BOSS_EVERY && run.floor % BOSS_EVERY == 0 ? "boss" : "elite", hint: null, open: true }];
  const luck = Math.max(0, ...run.heroes.map((h) => h.luck));
  return Array.from({ length: DOORS }, () => {
    const kind = weighted(rng, Object.entries(DOOR_POOL));
    return { kind, hint: rng() * 100 < luck ? pick(rng, HINTS[kind]) : null, open: false };
  });
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

// The starter deck of a class: 4 strikes, 4 defends, its two signature cards
function starterDeck(cls) {
  return ["strike", "strike", "strike", "strike", "defend", "defend", "defend", "defend", ...(CLASSES[cls] || CLASSES.warrior).signature];
}

function newRun(floor, party, rng = Math.random) {
  const run = {
    floor,
    rooms: [], // [{kind, done}] the rooms entered
    doors: [],
    votes: {}, // name -> a door's index or "leave"
    phase: "between",
    heroes: party.map(({ name, hero }) => {
      const stats = statsOf(hero);
      return {
        name,
        cls: hero.cls,
        ...stats,
        hp: stats.maxHp,
        down: false,
        potions: hero.potions,
        deck: starterDeck(hero.cls),
        draw: [],
        hand: [],
        discard: [],
        exhausted: [],
        energy: 0,
        bonusEnergy: 0,
        block: 0,
        ended: false,
        effects: {},
        blessed: false,
        reward: null,
      };
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

function shuffle(list, rng) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/* ---------- Votes ---------- */

// A hero's vote: a door (its index) or "leave" -> an error or null
function vote(run, name, choice) {
  if (run.phase != "between") return "Nothing to vote on now.";
  if (!run.heroes.some((h) => h.name == name)) return "Not in this party.";
  if (choice !== "leave" && !(Number.isInteger(choice) && choice >= 0 && choice < run.doors.length)) return "Unknown door.";
  run.votes[name] = choice;
  return null;
}

// Every hero has voted
function allVoted(run) {
  return run.heroes.every((h) => h.name in run.votes);
}

// What the party chose: the most votes - a tie: the leader's vote if it is one of them, else one of them at random;
// nobody voted: "leave"
function tally(run, leader, rng = Math.random) {
  const counts = new Map();
  for (const choice of Object.values(run.votes)) counts.set(choice, (counts.get(choice) || 0) + 1);
  if (!counts.size) return "leave";
  const most = Math.max(...counts.values());
  const top = [...counts].filter(([, n]) => n == most).map(([choice]) => choice);
  if (top.length == 1) return top[0];
  return leader in run.votes && top.includes(run.votes[leader]) ? run.votes[leader] : pick(rng, top);
}

/* ---------- The rooms ---------- */

// Through a door (its index): a fight starts, the other rooms happen right away
function enterRoom(run, door = 0, rng = Math.random) {
  const chosen = run.doors[door] || run.doors[0];
  const kind = chosen.kind;
  const room = { kind, done: false };
  run.rooms.push(room);
  run.doors = [];
  run.votes = {};
  const heroes = alive(run.heroes);
  const n = roomNumber(run);
  if (!chosen.open) say(run, `Room ${n}: the door opens - ${ROOM_KINDS[kind].icon} ${ROOM_KINDS[kind].name}!`);
  if (kind == "fight" || kind == "hard" || kind == "elite" || kind == "boss") {
    run.monsters = monstersFor(run.floor, run.heroes.length, kind, rng);
    run.phase = "fight";
    run.turn = 0;
    for (const hero of run.heroes) {
      hero.draw = shuffle([...hero.deck], rng);
      hero.hand = [];
      hero.discard = [];
      hero.exhausted = [];
      hero.effects = {};
      hero.reward = null;
    }
    say(run, `${run.monsters.map((m) => m.icon + " " + m.name).join(", ")}!`);
    startRound(run, rng);
    return;
  }
  if (kind == "chest") {
    const coins = Math.round(entryCost(run.floor) * REWARD.chest);
    run.pot += coins;
    say(run, `A chest - 🪙 ${coins} each for the pot.`);
    for (const hero of heroes) {
      // (every hero rolls for gear on its own - luck helps)
      if (rng() * 100 < 40 + hero.luck / 2) {
        const item = makeGear(run.floor, rng, hero.luck);
        run.loot[hero.name].push(item);
        say(run, `${hero.name} finds ${item.icon} ${item.name} (${item.rarity}).`);
      }
    }
  } else if (kind == "trap") {
    for (const hero of heroes) {
      if (rng() * 100 < hero.luck * 2) say(run, `${hero.name} dodges the trap.`);
      else {
        const damage = Math.round(hero.maxHp * TRAP_DAMAGE);
        hero.hp = Math.max(1, hero.hp - damage);
        say(run, `${hero.name} takes ${damage} damage from the trap.`);
      }
    }
  } else if (kind == "rest") {
    say(run, "A camp fire - everybody heals and rests.");
    for (const hero of heroes) {
      hero.hp = Math.min(hero.maxHp, hero.hp + Math.round(hero.maxHp * REST_HEAL));
      hero.bonusEnergy = 1;
    }
  } else if (kind == "shrine") {
    say(run, "A shrine - blood for power. Everybody deals 25% more damage now.");
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
    say(run, sold ? `A merchant - ${sold} potion${sold == 1 ? "" : "s"} for 🪙 ${price} each from the pot.` : "A merchant - but nothing to buy (the pot is too small or the bags are full).");
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
  run.votes = {};
  run.doors = doorsFor(run, rng);
}

// A potion (in a fight or between the rooms - it costs no energy)
function drink(run, name) {
  const hero = run.heroes.find((h) => h.name == name);
  if (!hero || hero.down) return "Your hero is down.";
  if (run.phase != "fight" && run.phase != "between") return "Not now.";
  if (hero.potions <= 0) return "No potions left.";
  if (hero.hp >= hero.maxHp) return "Your HP is full.";
  const heal = Math.min(hero.maxHp - hero.hp, Math.round(hero.maxHp * POTION_HEAL));
  hero.hp += heal;
  hero.potions--;
  say(run, `${hero.name} drinks a potion: +${heal} HP.`);
  return null;
}

// The card reward after a fight: one of three for the deck (null: none)
function pickReward(run, name, card) {
  const hero = run.heroes.find((h) => h.name == name);
  if (!hero || !hero.reward) return "No card to pick.";
  if (card != null && !hero.reward.includes(card)) return "Not one of your cards.";
  if (card != null) {
    hero.deck.push(card);
    say(run, `${hero.name} takes ${CARDS[card].icon} ${CARDS[card].name} into the deck.`);
  }
  hero.reward = null;
  return null;
}

// Three different cards: mostly the class's, sometimes a neutral one
function rewardFor(hero, rng) {
  const cls = CLASSES[hero.cls] || CLASSES.warrior;
  const pool = [...cls.cards.map((id) => [id, 2]), ...NEUTRAL_CARDS.map((id) => [id, 1])];
  const cards = [];
  while (cards.length < 3) {
    const card = weighted(rng, pool.filter(([id]) => !cards.includes(id)));
    cards.push(card);
  }
  return cards;
}

/* ---------- A fight ---------- */

let cardCount = 0;

function drawCards(hero, count, rng) {
  for (let i = 0; i < count && hero.hand.length < HAND_MAX; i++) {
    if (!hero.draw.length) {
      if (!hero.discard.length) break;
      hero.draw = shuffle(hero.discard, rng);
      hero.discard = [];
    }
    hero.hand.push({ uid: "c" + ++cardCount, id: hero.draw.pop() });
  }
}

// A new turn of the heroes: block gone, full energy, 5 new cards; the monsters show what they do next
function startRound(run, rng) {
  run.turn++;
  for (const hero of alive(run.heroes)) {
    hero.block = 0;
    hero.energy = ENERGY + hero.bonusEnergy;
    hero.bonusEnergy = 0;
    hero.ended = false;
    drawCards(hero, HAND, rng);
  }
  planIntents(run, rng);
}

// What every monster does next: a move and (an attack) a hero - shown before the heroes play
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
      intent.target = weighted(rng, heroes.map((h) => [h.name, h.hp < h.maxHp / 2 ? 2 : 1]));
    }
    foe.intent = intent;
    // (its guard is up for the whole turn of the heroes - it showed it)
    foe.defending = move == "defend";
    foe.fading = move == "fade";
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

// A hit of a hero on a monster: the damage done (a plain attack may be dodged - a fading foe dodges them all)
function strike(run, hero, foe, power, rng, options = {}) {
  if (foe.down) return 0;
  if (!options.sure && (foe.fading || rng() < foe.dodge)) {
    say(run, `${foe.icon} ${foe.name} dodges ${hero.name}.`);
    return 0;
  }
  const crit = rng() * 100 < hero.luck;
  let damage = hero.atk * between(rng, 0.9, 1.1) * power * (crit ? CRIT : 1) * (hero.blessed ? SHRINE_POWER : 1) * (hero.effects.might ? MIGHT : 1);
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

// Damage to a hero: smoke, a dodge, armor (at most 75% of a hit), taunt - then the block takes it
function hurt(run, hero, raw, source, rng = Math.random) {
  if (hero.evading) {
    say(run, `${source} misses ${hero.name} in the smoke.`);
    return 0;
  }
  if (rng() * 100 < hero.agi) {
    say(run, `${hero.name} dodges ${source} 🪶.`);
    return 0;
  }
  let damage = Math.max(raw * 0.25, raw - hero.def);
  if (hero.taunting) damage *= TAUNT;
  damage = Math.max(1, Math.round(damage));
  const blocked = Math.min(hero.block, damage);
  hero.block -= blocked;
  damage -= blocked;
  hero.hp = Math.max(0, hero.hp - damage);
  say(run, `${source} hits ${hero.name} for ${damage}${blocked ? ` (${blocked} blocked)` : ""}.`);
  if (hero.hp == 0) {
    hero.down = true;
    hero.effects = {};
    hero.block = 0;
    say(run, `${hero.name} is down!`);
  }
  return damage;
}

function healHero(run, hero, amount) {
  const heal = Math.min(hero.maxHp - hero.hp, Math.round(amount));
  hero.hp += heal;
  return heal;
}

// Plays a card of a hero's hand: {uid, target (a monster's id), ally (a hero's name)} -> an error or null
function play(run, name, input, rng = Math.random) {
  if (run.phase != "fight") return "No fight now.";
  const hero = run.heroes.find((h) => h.name == name);
  if (!hero || hero.down) return "Your hero is down.";
  if (hero.ended) return "You ended your turn.";
  const index = hero.hand.findIndex((c) => c.uid == (input && input.uid));
  if (index < 0) return "That card isn't in your hand.";
  const card = CARDS[hero.hand[index].id];
  if (hero.energy < card.cost) return `${card.name} needs ${card.cost} energy.`;
  const foes = alive(run.monsters);
  const foe = foes.find((m) => m.id == input.target) || null;
  if (card.target == "foe" && !foe) return "Pick a foe for it.";
  const friend = alive(run.heroes).find((h) => h.name == input.ally) || hero;
  const fallen = run.heroes.find((h) => h.down && h.name == input.ally) || run.heroes.find((h) => h.down);
  if (card.target == "fallen" && !fallen) return "Nobody to bring back.";
  hero.energy -= card.cost;
  const [{ id }] = hero.hand.splice(index, 1);
  (card.exhaust ? hero.exhausted : hero.discard).push(id);
  cardEffect(run, hero, id, { foe, foes, friend, fallen }, rng);
  if (!alive(run.monsters).length) winFight(run, rng);
  return null;
}

function cardEffect(run, hero, id, { foe, foes, friend, fallen }, rng) {
  const block = (who, amount) => {
    who.block += Math.round(amount);
  };
  switch (id) {
    case "strike":
      return strike(run, hero, foe, 1, rng);
    case "defend":
      block(hero, 6 + hero.def);
      return say(run, `${hero.name} blocks ${6 + hero.def}.`);
    case "focus":
      return drawCards(hero, 2, rng);
    case "secondwind":
      block(hero, 5 + hero.def);
      return say(run, `${hero.name} catches breath: +${healHero(run, hero, hero.maxHp * 0.06)} HP, blocks ${5 + hero.def}.`);
    case "adrenaline":
      hero.energy++;
      return drawCards(hero, 1, rng);
    case "quickslash":
      strike(run, hero, foe, 0.5, rng);
      return drawCards(hero, 1, rng);
    case "bash":
      if (strike(run, hero, foe, 1.1, rng, { sure: true, verb: "smashes" }) && !foe.down) {
        foe.effects.stun = 1;
        say(run, `${foe.icon} ${foe.name} is stunned 💫.`);
      }
      return;
    case "cleave":
      for (const one of foes) strike(run, hero, one, 0.7, rng, { sure: true, verb: "cleaves" });
      return;
    case "battlecry":
      for (const one of alive(run.heroes)) one.effects.might = 2;
      return say(run, `${hero.name} lets out a war cry 📯 - the party hits harder!`);
    case "ironwave":
      strike(run, hero, foe, 0.7, rng);
      return block(hero, 4 + hero.def / 2);
    case "bloodlust":
      hero.hp = Math.max(1, hero.hp - Math.round(hero.maxHp * 0.08));
      hero.energy += 2;
      return say(run, `${hero.name} bleeds for power 🩸.`);
    case "taunt":
      hero.taunting = true;
      block(hero, 4 + hero.def);
      return say(run, `${hero.name} taunts the foes 📣.`);
    case "judgement":
      return strike(run, hero, foe, (hero.atk + hero.def) / hero.atk, rng, { sure: true, verb: "judges" });
    case "holyshield":
      for (const one of alive(run.heroes)) block(one, 5 + hero.def);
      return say(run, `${hero.name} raises a holy shield over the party 🛡️.`);
    case "consecrate":
      for (const one of foes) strike(run, hero, one, 0.5, rng, { sure: true, verb: "burns" });
      for (const one of alive(run.heroes)) healHero(run, one, one.maxHp * 0.05);
      return;
    case "bulwark":
      block(hero, 10 + 2 * hero.def);
      return say(run, `${hero.name} braces behind the shield 🏰.`);
    case "heal":
      return say(run, `${hero.name} heals ${friend.name} for ${healHero(run, friend, friend.maxHp * 0.25)} 💚.`);
    case "smite":
      return strike(run, hero, foe, foe.undead ? 2.5 : 1.2, rng, { sure: true, verb: "smites" });
    case "revive":
      fallen.down = false;
      fallen.hp = Math.round(fallen.maxHp * 0.4);
      fallen.ended = true;
      return say(run, `${hero.name} brings ${fallen.name} back 🕊️!`);
    case "prayer":
      for (const one of alive(run.heroes)) healHero(run, one, one.maxHp * 0.12);
      return say(run, `${hero.name} prays - the party heals 🙏.`);
    case "blessing":
      friend.effects.might = 2;
      block(friend, 5);
      return say(run, `${hero.name} blesses ${friend.name} 🌞.`);
    case "poisonblade":
      if (strike(run, hero, foe, 0.6, rng, { sure: true, verb: "cuts" }) && !foe.down) {
        foe.effects.poison = { turns: 3, dmg: Math.max(1, Math.round(hero.atk * 0.45)) };
        say(run, `${foe.icon} ${foe.name} is poisoned ☠️.`);
      }
      return;
    case "backstab":
      return strike(run, hero, foe, foe.effects.poison || foe.effects.stun ? 3 : 1.2, rng, { sure: true, verb: "backstabs" });
    case "smoke":
      hero.evading = true;
      return say(run, `${hero.name} vanishes in smoke 💨.`);
    case "envenom":
      for (const one of foes) one.effects.poison = { turns: 2, dmg: Math.max(1, Math.round(hero.atk * 0.4)) };
      return say(run, `${hero.name} poisons every foe 🧪.`);
    case "flurry":
      for (let i = 0; i < 3; i++) {
        const standing = alive(run.monsters);
        if (standing.length) strike(run, hero, pick(rng, standing), 0.4, rng, { sure: true, verb: "slashes" });
      }
      return;
    case "frost":
      if (strike(run, hero, foe, 0.8, rng, { sure: true, verb: "freezes" }) && !foe.down) {
        foe.effects.chill = 2;
        say(run, `${foe.icon} ${foe.name} is chilled ❄️.`);
      }
      return;
    case "fireball":
      for (const one of foes) {
        if (strike(run, hero, one, 0.7, rng, { sure: true, verb: "burns" }) && !one.down) one.effects.burn = { turns: 2, dmg: Math.max(1, Math.round(hero.atk * 0.3)) };
      }
      return;
    case "barrier":
      block(friend, 8 + hero.atk * 0.6);
      return say(run, `${hero.name} shields ${friend.name} 🔮.`);
    case "arcanebolt":
      return strike(run, hero, foe, 1.5, rng, { sure: true, verb: "blasts" });
    case "meteor":
      for (const one of foes) strike(run, hero, one, 1.6, rng, { sure: true, verb: "crushes" });
      return;
  }
}

// A hero ends the turn -> true: every hero has - the monsters' turn
function endTurn(run, name) {
  const hero = run.heroes.find((h) => h.name == name);
  if (run.phase != "fight" || !hero || hero.down) return false;
  hero.ended = true;
  return alive(run.heroes).every((h) => h.ended);
}

// What a monster does: its intent
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
      hurt(run, target, damage * between(rng, 0.9, 1.1), intent.move == "smash" ? source + " 💥" : source, rng);
      break;
    case "poison":
      if (hurt(run, target, damage, source, rng) > 0 && !target.down) {
        target.effects.poison = { turns: 3, dmg: Math.max(1, Math.round(foe.atk * 0.35)) };
        say(run, `${target.name} is poisoned ☠️.`);
      }
      break;
    case "steal":
      if (hurt(run, target, damage, source, rng) > 0 && target.potions > 0) {
        target.potions--;
        say(run, `${source} steals a potion from ${target.name} 🫳!`);
      }
      break;
    case "drain": {
      const done = hurt(run, target, damage, source, rng);
      foe.hp = Math.min(foe.maxHp, foe.hp + done);
      break;
    }
    case "burn":
      say(run, `${source} sends a fire wave 🔥!`);
      for (const hero of heroes) {
        if (hurt(run, hero, damage, source, rng) > 0 && !hero.down) hero.effects.burn = { turns: 2, dmg: Math.max(1, Math.round(foe.atk * 0.25)) };
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
      say(run, `${source} howls 📯 - the monsters rage!`);
      break;
    case "defend":
      say(run, `${source} holds its guard.`);
      break;
    case "fade":
      say(run, `${source} fades back.`);
      break;
  }
  // (chill wears off with every move that hurts)
  if (foe.effects.chill && move.power) {
    foe.effects.chill--;
    if (!foe.effects.chill) delete foe.effects.chill;
  }
}

// The monsters' turn: they do what they showed (stunned: nothing), poison and burns tick, the hands go to the
// discard pile - then the heroes' next turn
function monsterTurn(run, rng = Math.random) {
  if (run.phase != "fight") return;
  for (const foe of alive(run.monsters)) {
    if (foe.effects.stun) {
      delete foe.effects.stun;
      say(run, `${foe.icon} ${foe.name} is stunned and does nothing.`);
      continue;
    }
    monsterMove(run, foe, rng);
    if (!alive(run.heroes).length) break;
  }
  for (const one of [...alive(run.heroes), ...alive(run.monsters)]) {
    const label = one.icon ? `${one.icon} ${one.name}` : one.name;
    for (const kind of ["poison", "burn"]) {
      const effect = one.effects[kind];
      if (!effect || one.down) continue;
      one.hp = Math.max(0, one.hp - effect.dmg);
      say(run, `${label} takes ${effect.dmg} from ${kind == "poison" ? "poison ☠️" : "the burn 🔥"}.`);
      if (--effect.turns <= 0) delete one.effects[kind];
      if (one.hp == 0) {
        one.down = true;
        say(run, `${label} ${one.icon ? "is defeated" : "is down"}!`);
      }
    }
    for (const kind of ["rage", "might"]) if (one.effects[kind] && --one.effects[kind] <= 0) delete one.effects[kind];
  }
  for (const hero of run.heroes) {
    hero.taunting = hero.evading = false;
    hero.discard.push(...hero.hand.map((c) => c.id));
    hero.hand = [];
    if (hero.down) hero.block = 0;
  }
  if (!alive(run.heroes).length) {
    run.phase = "lost";
    run.pot = 0;
    say(run, "The whole party is down - the loot is lost. 💀");
    return;
  }
  if (!alive(run.monsters).length) return winFight(run, rng);
  startRound(run, rng);
}

function winFight(run, rng) {
  const room = run.rooms[run.rooms.length - 1];
  const coins = Math.round(entryCost(run.floor) * REWARD[room.kind]);
  run.pot += coins;
  say(run, `Victory! 🪙 ${coins} each for the pot.`);
  // (the ones down get back up, every state goes, the cards back into the deck - and a new card to pick)
  for (const hero of run.heroes) {
    hero.effects = {};
    hero.block = 0;
    hero.taunting = hero.evading = false;
    hero.hand = [];
    hero.draw = [];
    hero.discard = [];
    hero.exhausted = [];
    if (hero.down) {
      hero.down = false;
      hero.hp = Math.max(1, Math.round(hero.maxHp * REVIVE));
      say(run, `${hero.name} gets back up.`);
    }
    hero.reward = rewardFor(hero, rng);
  }
  room.done = true;
  afterRoom(run, rng);
}

// For the pages
function runView(run) {
  const effectsOf = (effects) => Object.fromEntries(Object.entries(effects).map(([kind, value]) => [kind, typeof value == "object" ? value.turns : value]));
  return {
    floor: run.floor,
    phase: run.phase,
    room: run.rooms.length - 1,
    rooms: run.rooms.map((room) => ({ kind: room.kind, done: room.done })),
    // (what is behind a hidden door stays hidden - only a hint, if a lucky hero heard one)
    doors: run.doors.map((door) => ({ open: door.open, kind: door.open ? door.kind : null, hint: door.hint })),
    votes: run.votes,
    heroes: run.heroes.map((h) => ({
      name: h.name,
      cls: h.cls,
      hp: h.hp,
      maxHp: h.maxHp,
      atk: h.atk,
      def: h.def,
      luck: h.luck,
      agi: h.agi,
      down: h.down,
      potions: h.potions,
      energy: h.energy,
      block: h.block,
      ended: h.ended,
      blessed: h.blessed,
      effects: effectsOf(h.effects),
      hand: h.hand,
      drawCount: h.draw.length,
      discardCount: h.discard.length,
      deck: h.deck,
      reward: h.reward,
    })),
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

// The damage coming at a hero this turn (the monsters' intents)
function incoming(run, hero) {
  return alive(run.monsters).reduce((sum, m) => {
    if (!m.intent || m.effects.stun) return sum;
    const move = MOVES[m.intent.move];
    if (move.all || m.intent.target == hero.name) return sum + Math.max(m.intent ? intentDamage(m, m.intent.move) * 0.25 : 0, intentDamage(m, m.intent.move) - hero.def);
    return sum;
  }, 0);
}

// A plain player: blocks what comes at it, heals when low, hits the weakest foe with the rest
function simulatedTurn(run, me, rng) {
  if (me.hp < me.maxHp * 0.3 && me.potions > 0) drink(run, me.name);
  for (let guard = 0; guard < 20 && run.phase == "fight" && !me.ended; guard++) {
    const playable = me.hand.filter((c) => CARDS[c.id].cost <= me.energy && CARDS[c.id].target != "fallen");
    if (!playable.length) break;
    const need = incoming(run, me) - me.block;
    const blockCard = playable.find((c) => ["defend", "bulwark", "secondwind", "taunt", "smoke", "holyshield", "barrier"].includes(c.id));
    const healCard = playable.find((c) => ["heal", "prayer"].includes(c.id));
    const attack = playable.find((c) => CARDS[c.id].type == "attack") || playable.find((c) => !["defend", "bulwark", "secondwind", "taunt", "smoke", "holyshield", "barrier", "heal", "prayer"].includes(c.id));
    const card = me.hp < me.maxHp * 0.5 && healCard ? healCard : need > 2 && blockCard ? blockCard : attack || blockCard || healCard;
    if (!card) break;
    const foe = alive(run.monsters).sort((a, b) => a.hp - b.hp)[0];
    if (play(run, me.name, { uid: card.uid, target: foe && foe.id, ally: me.name }, rng)) break;
  }
}

// How a floor goes for a hero this strong alone: {cleared: share of the runs, payback: back per coin}
function simulate(hero, floor, runs = 500, rng = Math.random) {
  let cleared = 0;
  let back = 0;
  for (let i = 0; i < runs; i++) {
    const run = newRun(floor, [{ name: "sim", hero }], rng);
    while (run.phase == "between") {
      const me = run.heroes[0];
      if (me.reward) pickReward(run, "sim", me.reward[0]);
      enterRoom(run, Math.floor(rng() * run.doors.length), rng);
      let turns = 0;
      while (run.phase == "fight" && turns++ < 100) {
        simulatedTurn(run, run.heroes[0], rng);
        if (run.phase == "fight" && endTurn(run, "sim")) monsterTurn(run, rng);
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
  DOORS,
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
  MAIN_BONUS,
  CARDS,
  NEUTRAL_CARDS,
  ENERGY,
  MOVES,
  ROOM_KINDS,
  newHero,
  statsOf,
  upgradeCost,
  maxFloor,
  entryCost,
  heroView,
  makeGear,
  starterDeck,
  doorsFor,
  monstersFor,
  newRun,
  vote,
  allVoted,
  tally,
  enterRoom,
  drink,
  pickReward,
  planIntents,
  play,
  endTurn,
  monsterTurn,
  runView,
  simulate,
};
