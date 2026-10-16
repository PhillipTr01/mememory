/*
 * The dungeon: an RPG in the casino (for now only in the admin's test world - sockets/rpg_server.js).
 *
 * A hero per player: a class (Warrior, Paladin, Cleric, Rogue, Mage - each a main stat and its own cards),
 * five stats bought with coins (upgrades, every level dearer - the class's main stat counts 1.5x), gear
 * from chests (a weapon, an armor, a charm - from common to legendary) and potions. A run: a party of 1
 * to 4 heroes pays the entry of a floor (each the same) and goes through its rooms. Between two rooms
 * there are three hidden doors - nobody knows what is behind them (a lucky hero may sense danger or calm):
 * the party votes for one (or to leave with the loot) - the most votes win, a tie goes with the leader.
 * The first room is a fight, the last the guarded gate (an elite fight); a floor cleared opens the next
 * one. All heroes down: the pot is lost.
 *
 * Fights are played with cards: every hero has a deck (a starter deck of the class -
 * every fight won: one card more, picked of three), draws 5 cards a turn and has 3 energy to play them
 * (attacks, block, the class's skills). Every monster shows what it does next and to whom (its intent);
 * when every hero has ended the turn, the monsters do what they showed, poison and burns tick. Status
 * effects: poison, burn, stun (loses its next move), chill (half damage), might (more damage), rage
 * (monsters, more damage). Block takes the damage of the monsters' turn, then it is gone.
 *
 * Bosses: the last room of every BOSS_EVERY-th floor (BOSSES) - a second phase at half HP.
 *
 * Everything random comes from `rng` (Math.random - the tests give their own).
 */

const config = require("./config");

const FLOORS = 30;
const ROOMS = 6;
const PARTY_MAX = 4;
const BAG_MAX = 5; // the bag at first - room for more in the shop
const BAG_TOP = 15; // at most
const BAG_SLOT_PRICE = 25000; // the first slot more - every next one 60% dearer
const BAG_SLOT_GROWTH = 1.6;

// The room in a hero's bag
function bagSize(hero) {
  return BAG_MAX + (hero.bagSlots || 0);
}

// The price of the next bag slot (null: the bag is as big as it gets)
function bagSlotPrice(hero) {
  const n = hero.bagSlots || 0;
  return BAG_MAX + n >= BAG_TOP ? null : round100(BAG_SLOT_PRICE * Math.pow(BAG_SLOT_GROWTH, n));
}
// Deck slots: decks kept ready, one played - a slot at first, more in the shop (up to DECKS_TOP, for every character)
const DECKS_TOP = 5;
const DECK_SLOT_PRICE = 250000; // the second slot (far dearer than a potion slot) - every next one 60% dearer
function deckSlots(hero) {
  return 1 + (hero.deckSlots || 0);
}
function deckSlotPrice(hero) {
  const n = hero.deckSlots || 0;
  return 1 + n >= DECKS_TOP ? null : round100(DECK_SLOT_PRICE * Math.pow(BAG_SLOT_GROWTH, n));
}
// Another deck of the character played: the one built kept in its slot (an empty slot: an empty deck) -> an error or null
function useDeck(hero, slot) {
  const char = charOf(hero);
  if (!Number.isInteger(slot) || slot < 0 || slot >= deckSlots(hero)) return "No such deck slot.";
  const at = char.deckAt || 0;
  if (slot == at) return null;
  char.decks = char.decks || [];
  char.decks[at] = [...char.deck];
  char.deck = [...(char.decks[slot] || [])];
  char.deckAt = slot;
  return null;
}
// The decks of the character played: their sizes (the one played: its own now)
function decksOf(hero) {
  if (!hero.cls) return [0];
  const char = charOf(hero);
  const at = char.deckAt || 0;
  return Array.from({ length: deckSlots(hero) }, (_, i) => (i == at ? char.deck : (char.decks || [])[i] || []).length);
}
const POTIONS_MAX = 5; // the potions a hero carries at first - room for more in the shop
const POTIONS_TOP = 10; // at most
const POTION_SLOT_PRICE = 50000; // 2x a bag slot - every next one 60% dearer too

// The potions a hero may carry
function potionsMax(hero) {
  return POTIONS_MAX + (hero.potionSlots || 0);
}

// The price of the next potion slot (null: as many as it gets)
function potionSlotPrice(hero) {
  const n = hero.potionSlots || 0;
  return POTIONS_MAX + n >= POTIONS_TOP ? null : round100(POTION_SLOT_PRICE * Math.pow(BAG_SLOT_GROWTH, n));
}
const POTION_HEAL = 0.25; // of the max HP (little - healing is the cleric's)
// (a potion: RPG_POTION_SHARE % of the floor's entry - the same share of a run on every floor)
function potionPrice(floor = 1) {
  return round100((config.RPG_POTION_SHARE / 100) * entryCost(Math.max(1, floor)));
}
// Bosses: the last room of every n-th floor (0: none yet - they come later)
const TUTORIAL_POWER = 0.5; // the practice run's monsters: this strong
const BOSS_EVERY = 5; // the last room of every 5th floor: its boss

// The stats: what a level gives
const STATS = {
  hp: { name: "Vitality", icon: "❤️", base: 100, per: 7.5, about: "+7.5 max HP", desc: "Raises your max HP." },
  atk: { name: "Strength", icon: "⚔️", base: 10, per: 1.5, about: "+1.5 attack", desc: "Raises the damage of your attacks." },
  def: { name: "Armor", icon: "🛡️", base: 0, per: 1, about: "+1 armor", desc: "You take less damage and block more." },
  luck: { name: "Luck", icon: "🍀", base: 5, per: 0.6, soft: [50, 80], about: "+0.6% luck", desc: "Raises your crits, your luck with traps and your loot. It grows slower past 50%." },
  agi: { name: "Instinct", icon: "🦊", base: 0, per: 0.4, soft: [30, 60], about: "+0.4% dodge", desc: "Raises your dodge and your chance to sense rooms. A Rogue senses far better. It grows slower past 30%." },
};
const STAT_IDS = Object.keys(STATS);
const LEVEL_MAX = 100;
// (a stat level: RPG_STAT_SHARE % of the entry of the floor it belongs to - level 1 floor 1, the last one floor 30)
// The main stat of a class: its levels count this much more (a class may have its own: mainBonus)
const MAIN_BONUS = 1.5;
// Luck and instinct: full up to the knee, past it every point counts less - never the max ([knee, max])
function softStat(id, raw) {
  const [knee, max] = STATS[id].soft;
  return Math.round(raw <= knee ? raw : knee + (max - knee) * (1 - Math.exp(-(raw - knee) / (max - knee))));
}

// What a room puts in the pot (per hero, a share of the entry)
const REWARD = { fight: 0.3, hard: 0.55, elite: 0.55, boss: 0.9, chest: 0.3, trap: 0, rest: 0, shrine: 0, merchant: 0 };

/* ---------- Classes and their cards ---------- */

// main: the stat its levels count 1.5x for; hp, atk: times the stats; def, luck, agi: added;
// deck: the starter deck; cards: the class's cards (the rewards)
const CLASSES = {
  warrior: { name: "Warrior", icon: "⚔️", main: "atk", strength: { name: "Armor Breaker", icon: "🪓", text: "Your hits ignore {pierce}% of a foe's armor.", perks: { pierce: 0.4 }, top: 1.5 }, about: "Strength class with heavy blows, cleave and war cry", hp: 1.18, atk: 1.25, def: 2, luck: 0, agi: 0, mainBonus: 1.3, hpPlus: 8, signature: ["bash", "cleave"], cards: ["bash", "cleave", "battlecry", "ironwave", "bloodlust", "bodyslam", "uppercut", "whirlwind", "impervious"], mythic: "titanswrath" },
  paladin: { name: "Paladin", icon: "🔰", main: "def", strength: { name: "Thorns", icon: "🌵", text: "Attackers take damage equal to {thornsDef}% of your armor. Your block cards block {block}% more.", perks: { thornsDef: 0.85, block: 0.17 }, top: 1.5 }, about: "Armor class with taunts and party shields", hp: 1.31, atk: 1.48, def: 3, luck: 0, agi: 0, mainBonus: 1.25, atkPlus: 21, hpPlus: 77, signature: ["taunt", "judgement"], cards: ["taunt", "judgement", "holyshield", "consecrate", "bulwark", "righteous", "aegis", "retribution", "layhands"], mythic: "divine" },
  cleric: { name: "Cleric", icon: "✨", main: "hp", strength: { name: "Holy Light", icon: "💖", text: "Your heals are {heal}% stronger and {healHit}% of every heal smites a random foe.", perks: { heal: 0.2, healHit: 0.25 }, top: 1.5 }, about: "Vitality class with heals, revives and holy damage against the undead", hp: 0.99, atk: 1.2, def: 4, luck: 0, agi: 0, mainBonus: 1.25, hpPlus: 59, atkPlus: 13, signature: ["heal", "smite"], cards: ["heal", "smite", "revive", "prayer", "blessing", "holylight", "ward", "purify", "wrath"], mythic: "resurrection" },
  rogue: { name: "Rogue", icon: "🗡️", main: "agi", strength: { name: "Venom", icon: "🐍", text: "Your poison is {poison}% stronger and you crit {crit}% more often.", perks: { poison: 0.6, crit: 12 }, top: 2.5 }, about: "Instinct class with dodge, scouting and poison", hp: 1.35, atk: 1.55, def: 0, luck: 6, agi: 13, mainBonus: 1.7, signature: ["poisonblade", "backstab"], cards: ["poisonblade", "backstab", "smoke", "envenom", "flurry", "daggers", "shadowstep", "eviscerate", "lethaldose"], mythic: "deathmark" },
  mage: { name: "Mage", icon: "🔮", main: "luck", strength: { name: "Arcane Storm", icon: "🌪️", text: "Hits on every foe are {aoe}% stronger and you crit {crit}% more often.", perks: { aoe: 0.5, crit: 10 }, top: 2.6 }, about: "Luck class with crits, fire and frost", hp: 1.53, atk: 1.56, def: 1, luck: 8, agi: 0, mainBonus: 1.8, signature: ["frost", "fireball"], cards: ["frost", "fireball", "barrier", "arcanebolt", "meteor", "spark", "icearmor", "chainlightning", "blizzard"], mythic: "timewarp" },
};
const CLASS_IDS = Object.keys(CLASSES);

// The cards. type: attack / skill; target: "foe" (a monster), "ally" (a hero standing), "fallen" (a hero
// down), "none"; exhaust: gone for the rest of the fight once played
// The cards: game/rpg_cards.js (made of effects - the text written from them)
const CARDS = {};

// How rare a card is (booster packs, rewards): basic (the starter deck), common, rare, epic, mythic

// A card's rarity: its weight in packs and rewards, how many of it a deck holds, what it is worth (by how rare it is
// in a Base Set pack - the packs are priced by it)
const CARD_RARITIES = {
  basic: { name: "Basic", weight: 0, copies: 4, value: 0 },
  common: { name: "Common", weight: 64, copies: 3, value: 125 },
  rare: { name: "Rare", weight: 26, copies: 2, value: 625 },
  epic: { name: "Epic", weight: 8, copies: 2, value: 2500 },
  legendary: { name: "Legendary", weight: 3, copies: 1, value: 12500 },
  mythic: { name: "Mythic", weight: 0.08, copies: 1, value: 125000 },
};
// The larger part of the base set: cards made of effects (game/rpg_cards.js)
const MORE_CARDS = require("./rpg_cards");
Object.assign(CARDS, MORE_CARDS.cards);
for (const [cls, ids] of Object.entries(MORE_CARDS.classCards)) CLASSES[cls].cards.push(...ids);
// (every class card knows its class - the page marks another class's cards)
for (const [cls, c] of Object.entries(CLASSES)) for (const id of [...c.cards, c.mythic]) if (CARDS[id]) CARDS[id].cls = cls;
// The deck: DECK_MIN to DECK_MAX cards - a charm may make room for more, or let it go down with fewer
const DECK_MIN = 10;
const DECK_MAX = 15;
const DECK_FLOOR = 5; // (never fewer, whatever the charm)
function deckLimits(hero) {
  const gear = Object.values(charOf(hero).gear).filter(Boolean);
  const sum = (key) => gear.reduce((total, item) => total + (item[key] || 0), 0);
  return { min: Math.max(DECK_FLOOR, DECK_MIN - sum("deckMin")), max: DECK_MAX + sum("deckMax") };
}
// (kept for the old callers: the most cards without a charm)
function deckMax() {
  return DECK_MAX;
}
// The booster packs of the base set (the shop): how many cards, the last ones at least of a rarity, the rarer
// ones more often (x their weight)
const PACKS = {
  standard: { name: "Base Set Pack", icon: "🎴", about: "5 cards. The last one is rare or better.", get price() { return config.RPG_PACK_STANDARD; }, size: 5, better: 1, least: "rare", boost: { epic: 0.7, legendary: 0.5, mythic: 0.5 } },
  premium: { name: "Hero Pack", icon: "💎", about: "5 cards, all rare or better, with more epics.", get price() { return config.RPG_PACK_PREMIUM; }, size: 5, better: 5, least: "rare", boost: { epic: 2, legendary: 2.1 } },
  mythic: { name: "Mythic Pack", icon: "🌟", about: "4 cards, all epic or better.", get price() { return config.RPG_PACK_MYTHIC; }, size: 4, better: 4, least: "epic", boost: { legendary: 1.5 } },
};
const PACK_IDS = Object.keys(PACKS);
const PACK_SIZE = PACKS.standard.size;
const RARITY_RANK = ["basic", "common", "rare", "epic", "legendary", "mythic"];

const CART_MAX = 50; // packs of a kind in one cart

// The price of packs of a kind
function packPrice(id, count = 1) {
  const pack = PACKS[id];
  if (!pack) return null;
  return pack.price * count;
}

// A cart ({pack id: count}) -> {total, items: [[id, count]]} or {error}
function cartPrice(cart) {
  if (!cart || typeof cart != "object") return { error: "Your cart is empty." };
  const items = Object.entries(cart).filter(([, n]) => n);
  if (!items.length) return { error: "Your cart is empty." };
  for (const [id, n] of items) {
    if (!PACKS[id]) return { error: "Unknown pack." };
    if (!Number.isInteger(n) || n < 1 || n > CART_MAX) return { error: `1 to ${CART_MAX} packs of a kind.` };
  }
  return { total: items.reduce((sum, [id, n]) => sum + packPrice(id, n), 0), items };
}

// Packs bought: waiting, unopened (opened one after the other - for the class played then)
function addPacks(hero, items) {
  if (!hero.packs) hero.packs = {};
  for (const [id, n] of items) hero.packs[id] = (hero.packs[id] || 0) + n;
}

// Every pack waiting opened (at most OPEN_ALL_MAX) -> {cards: [{id, fresh, coins, pack}], count} or an error (a string)
const OPEN_ALL_MAX = 50;
function openAll(hero, rng = Math.random) {
  if (!hero.cls) return "Pick a class first.";
  const cards = [];
  let count = 0;
  for (const id of PACK_IDS) {
    while (hero.packs && hero.packs[id] > 0 && count < OPEN_ALL_MAX) {
      cards.push(...openStored(hero, id, rng).map((card) => ({ ...card, pack: id })));
      count++;
    }
  }
  return count ? { cards, count } : "No packs to open.";
}

// An unopened pack opened -> its cards (openPack) or an error (a string)
function openStored(hero, id, rng = Math.random) {
  if (!hero.cls) return "Pick a class first.";
  if (!hero.packs || !(hero.packs[id] > 0)) return "No such pack left.";
  hero.packs[id]--;
  return openPack(hero, rng, id);
}
const NEUTRAL_CARDS = ["focus", "secondwind", "adrenaline", "quickslash", "shrug", "pommel", "bandage", "twinstrike", "overpower", "trance", "laststand", "rally", ...MORE_CARDS.neutral];

const ENERGY = 3; // a turn
const HAND = 5; // cards drawn a turn
const HAND_MAX = 10;
const TAUNT = 0.7;
const CRIT = 1.8;
const MIGHT = 1.3;
const REVIVE = 0.2; // a hero down: back up after the fight with this much HP
const REST_HEAL = 0.35;
const SHRINE_COST = 0.2; // of the max HP
const SHRINE_POWER = 1.25; // the blessing: more damage for the rest of the run

const RARITIES = [
  { id: "common", name: "Common", weight: 60, power: 1 },
  { id: "rare", name: "Rare", weight: 28, power: 1.5 },
  { id: "epic", name: "Epic", weight: 10, power: 2.2 },
  { id: "legendary", name: "Legendary", weight: 2, power: 3.2 },
];
// The gear: three slots, every kind with its own mix of stats (x the slot's base for them) - every weapon also
// gives agility (dodge); a charm's "deck": how often it changes the deck's size
const SLOTS = {
  weapon: {
    name: "Weapon",
    kinds: [
      ["🗡️", "Dagger", { atk: 0.7, agi: 1.1 }, ["rogue"]],
      ["🤺", "Rapier", { atk: 0.85, agi: 1 }, ["rogue", "warrior"]],
      ["⚔️", "Sword", { atk: 1, agi: 0.6 }, ["warrior", "paladin"]],
      ["🔱", "Trident", { atk: 1.1, agi: 0.5 }, ["warrior"]],
      ["🏹", "Bow", { atk: 0.9, agi: 0.8, luck: 0.3 }, ["rogue"]],
      ["🪄", "Wand", { atk: 0.8, agi: 0.4, luck: 0.6 }, ["mage"]],
      ["🦯", "Staff", { atk: 0.9, agi: 0.3, luck: 0.4, hp: 0.4 }, ["mage", "cleric"]],
      ["🪓", "Axe", { atk: 1.3, agi: 0.3 }, ["warrior"]],
      ["🏏", "Mace", { atk: 1.2, agi: 0.25, def: 0.3 }, ["paladin", "cleric"]],
      ["🔨", "Warhammer", { atk: 1.5, agi: 0.15 }, ["warrior", "paladin"]],
    ],
  },
  armor: {
    name: "Armor",
    kinds: [
      ["🥋", "Robe", { def: 0.5, hp: 1, agi: 0.5 }, ["mage", "cleric"]],
      ["🧣", "Cloak", { def: 0.4, hp: 0.7, agi: 0.8, luck: 0.3 }, ["rogue", "mage"]],
      ["👢", "Boots", { def: 0.5, hp: 0.5, agi: 1 }],
      ["🦺", "Vest", { def: 0.8, hp: 0.9, agi: 0.3 }, ["rogue", "cleric"]],
      ["🧤", "Gauntlets", { def: 0.7, hp: 0.5, atk: 0.3 }, ["warrior", "paladin"]],
      ["🪖", "Helm", { def: 0.9, hp: 0.8 }, ["warrior", "paladin", "cleric"]],
      ["🧥", "Mail", { def: 1.1, hp: 1.1 }, ["warrior", "paladin"]],
      ["🛡️", "Shield", { def: 1.4, hp: 0.6 }, ["paladin", "warrior"]],
    ],
  },
  charm: {
    name: "Charm",
    kinds: [
      ["💍", "Ring", { luck: 1, deck: 1 }],
      ["🧿", "Talisman", { luck: 1.2, deck: 0.6 }],
      ["📿", "Amulet", { luck: 0.8, hp: 0.5, deck: 0.6 }],
      ["🔮", "Orb", { luck: 0.7, atk: 0.3, deck: 0.6 }],
      ["🪬", "Hamsa", { luck: 0.6, def: 0.4, deck: 0.6 }],
      ["🪶", "Feather", { luck: 0.6, agi: 0.6, deck: 0.6 }],
      ["🗝️", "Rune Key", { luck: 0.5, deck: 1.6 }],
    ],
  },
};
// An epic or legendary piece: a name with a bonus (half a stat more - or the stat, if it had none)
const GEAR_AFFIXES = [
  ["of Swiftness", "agi"],
  ["of Might", "atk"],
  ["of the Bear", "hp"],
  ["of the Fortress", "def"],
  ["of Fortune", "luck"],
];
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
  purge: { name: "Purge", icon: "✨", self: true },
  curse: { name: "Curse", icon: "🕯️", power: 0.4 },
  summon: { name: "Summon", icon: "📣", self: true },
};

// The monsters: a group per 5 floors (hp, atk: times the floor's; dodge: misses a hit that often; moves: what it does)
const MONSTERS = [
  [
    { name: "Slime", icon: "🟢", type: "ooze", hp: 1, atk: 0.8, moves: ["attack", "attack", "defend"] },
    { name: "Rat", icon: "🐀", type: "beast", hp: 0.7, atk: 1, moves: ["attack", "poison"] },
    { name: "Bat", icon: "🦇", type: "beast", hp: 0.6, atk: 0.9, dodge: 0.2, moves: ["attack", "drain"] },
  ],
  [
    { name: "Goblin", icon: "👺", type: "humanoid", hp: 1, atk: 1, moves: ["attack", "attack", "steal"] },
    { name: "Spider", icon: "🕷️", type: "beast", hp: 0.8, atk: 1.1, traits: ["venomproof"], moves: ["poison", "attack"] },
    { name: "Wolf", icon: "🐺", type: "beast", hp: 0.9, atk: 1.05, dodge: 0.1, moves: ["attack", "attack", "howl"] },
  ],
  [
    { name: "Skeleton", icon: "💀", type: "undead", hp: 1, atk: 1, undead: true, traits: ["venomproof"], moves: ["attack", "attack", "defend"] },
    { name: "Ghost", icon: "👻", type: "undead", hp: 0.7, atk: 1, undead: true, moves: ["attack", "fade", "drain"] },
    { name: "Zombie", icon: "🧟", type: "undead", hp: 1.4, atk: 0.8, undead: true, traits: ["bulky"], moves: ["attack", "smash", "poison"] },
  ],
  [
    { name: "Orc", icon: "👹", type: "humanoid", hp: 1.2, atk: 1, traits: ["spiked"], moves: ["attack", "smash", "howl"] },
    { name: "Troll", icon: "🧌", type: "humanoid", hp: 1.3, atk: 0.9, traits: ["bulky"], moves: ["attack", "smash", "regen"] },
    { name: "Shaman", icon: "🧙", type: "humanoid", hp: 0.8, atk: 0.9, moves: ["attack", "heal", "burn", "purge"] },
  ],
  [
    { name: "Demon", icon: "😈", type: "demon", hp: 1.1, atk: 1.1, traits: ["fireproof"], moves: ["attack", "burn", "smash"] },
    { name: "Golem", icon: "🗿", type: "construct", hp: 1.4, atk: 0.85, armor: 0.1, traits: ["venomproof", "bulky"], moves: ["smash", "defend", "attack"] },
    { name: "Wraith", icon: "🌫️", type: "undead", hp: 0.9, atk: 1.1, undead: true, dodge: 0.15, moves: ["drain", "fade", "attack", "curse"] },
  ],
  [
    { name: "Hellhound", icon: "🐕", type: "demon", hp: 1, atk: 1.15, traits: ["fireproof", "spiked"], moves: ["attack", "burn", "howl"] },
    { name: "Gargoyle", icon: "🗽", type: "construct", hp: 1.25, atk: 0.95, armor: 0.15, traits: ["venomproof", "bulky"], moves: ["smash", "defend", "attack"] },
    { name: "Cultist", icon: "🧛", type: "humanoid", hp: 0.9, atk: 1, moves: ["attack", "curse", "purge", "drain"] },
  ],
];

// What makes a monster hard for some heroes - shown on it
// What a monster is (a badge on its card) - the undead: what holy cards smite
const MONSTER_TYPES = {
  beast: { name: "Beast", icon: "🐾" },
  ooze: { name: "Ooze", icon: "💧" },
  humanoid: { name: "Humanoid", icon: "👤" },
  undead: { name: "Undead", icon: "🦴" },
  demon: { name: "Demon", icon: "♨️" },
  construct: { name: "Construct", icon: "⚙️" },
};
const MONSTER_TRAITS = {
  venomproof: { name: "Venomproof", icon: "🧪", text: "Poison does nothing." },
  fireproof: { name: "Fireproof", icon: "🔥", text: "Burns do nothing." },
  bulky: { name: "Bulky", icon: "🪨", text: "Half damage from area hits." },
  spiked: { name: "Spiked", icon: "🦔", text: "Reflects 20% of damage." },
};

// The bosses: the last room of every BOSS_EVERY-th floor - one per group of floors, a second phase at half HP
// (phase: what changes then - more attack, other moves, a summon of its kind)
const BOSSES = [
  { name: "Slime King", icon: "🫧", type: "ooze", power: 0.38, hp: 1.3, atk: 0.9, traits: ["bulky"], moves: ["attack", "smash", "summon"], summon: 0, phase: { atk: 1.3, moves: ["smash", "summon", "attack"], text: "splits and swells with rage" } },
  { name: "Goblin Warlord", icon: "👺", type: "humanoid", power: 0.68, hp: 1.2, atk: 1, moves: ["attack", "smash", "steal", "summon"], summon: 1, phase: { atk: 1.35, moves: ["smash", "howl", "attack"], text: "calls the whole tribe" } },
  { name: "Bone Lord", icon: "☠️", type: "undead", power: 0.54, hp: 1.2, atk: 1, undead: true, traits: ["venomproof"], moves: ["attack", "drain", "summon"], summon: 2, phase: { atk: 1.3, moves: ["drain", "smash", "summon", "curse"], text: "raises the dead around it" } },
  { name: "Troll Chieftain", icon: "🧌", type: "humanoid", power: 1.45, hp: 1.15, atk: 0.9, traits: ["bulky"], moves: ["attack", "smash", "regen"], summon: 3, phase: { atk: 1.35, moves: ["smash", "attack", "regen", "howl"], text: "goes berserk" } },
  { name: "Demon Prince", icon: "👿", type: "demon", power: 1.35, hp: 1, atk: 1, traits: ["fireproof"], moves: ["attack", "burn", "smash", "summon"], summon: 4, phase: { atk: 1.35, moves: ["burn", "smash", "curse"], text: "bursts into flames" } },
  { name: "The Lich", icon: "🧟", type: "undead", power: 1.25, hp: 0.9, atk: 0.85, undead: true, traits: ["venomproof"], moves: ["curse", "drain", "summon", "attack"], summon: 5, phase: { atk: 1.25, moves: ["curse", "drain", "burn", "smash"], text: "tears open its phylactery" } },
];
const MONSTER_HP = 52;
const MONSTER_HP_GROWTH = 0.7; // (every floor deeper: this share of floor 1 more - as even as a character grows)
const MONSTER_ATK = 11;
const MONSTER_ATK_GROWTH = 0.35;
// (a group of 5 floors: its monsters this much stronger - some kinds fight longer than their numbers say)
const GROUP_POWER = [1, 1.03, 1.2, 0.88, 1.15, 1.15];
const MONSTER_DEPTH = 0.035; // a row of the map deeper into a floor: this much stronger
const MONSTER_SPREAD = 0.25; // every monster up to this much stronger or weaker
// A bigger party: every monster has this much more HP and attack per hero after the first - and there are more of
// them (a party is no easier than going alone)
const PARTY_HP = 1.5;
const PARTY_ATK = 0.2;
// ... and pays more: the loot (each) and the first clear's bonus this much more per hero after the first
const PARTY_LOOT = 0.1;
function partyBonus(size) {
  return 1 + PARTY_LOOT * Math.max(0, size - 1);
}

// A character's share of the loot pot on a floor: far under its deepest cleared floor - less (no farming low floors)
function lootShare(deepest, floor) {
  const under = deepest - floor - config.RPG_LOW_FREE;
  if (under <= 0) return 1;
  return Math.max(config.RPG_LOW_MIN / 100, 1 - (config.RPG_LOW_CUT / 100) * under);
}

/* ---------- Progression: hero levels, talents, relics, card upgrades ---------- */

// Perks: what talents and relics give (added up per hero): startBlock (block at the start of a fight), firstMana
// (mana on the first turn), draw (cards a turn), attack (more damage, share), firstStrike (the first attack of a
// turn, share), lowHp (damage below half HP, share), crit (critical chance, %), lifesteal (of attack damage),
// thorns (damage back when hit), block (more block, share), heal (more healing, share), afterFight (healed after a
// fight won, share of max HP), poison (stronger poison, share), maxHp (share), agi (dodge, %), pierce (share of
// a foe's armor ignored), thornsDef (thorns: share of the armor), aoe (more damage on hits to every foe)
const PERK_KEYS = ["healHit", "pierce", "thornsDef", "aoe", "startBlock", "firstMana", "draw", "attack", "firstStrike", "lowHp", "crit", "lifesteal", "thorns", "block", "heal", "afterFight", "poison", "maxHp", "agi"];

// Talents: every class at hero level 3, 6 and 10 - one of two
const TALENT_LEVELS = [3, 6, 10, 15, 20, 25, 30, 40, 50];
const TALENTS = {
  warrior: [
    [{ id: "ironskin", name: "Iron Skin", icon: "🪨", text: "Start every fight with 8 block.", perks: { startBlock: 8 } }, { id: "rhythm", name: "Battle Rhythm", icon: "🥁", text: "Your first attack each turn deals 40% more.", perks: { firstStrike: 0.4 } }],
    [{ id: "berserk", name: "Berserker", icon: "😤", text: "35% more damage below half HP.", perks: { lowHp: 0.35 } }, { id: "sunder", name: "Sunder", icon: "🪓", text: "Ignore 15% more armor.", perks: { pierce: 0.15 } }],
    [{ id: "bloodthirst", name: "Bloodthirst", icon: "🩸", text: "Heal 12% of your attack damage.", perks: { lifesteal: 0.12 } }, { id: "cleaver", name: "Cleaver", icon: "⚔️", text: "15% more damage.", perks: { attack: 0.15 } }],
    [{ id: "shatter", name: "Shatter", icon: "🔨", text: "Ignore 20% more armor.", perks: { pierce: 0.2 } }, { id: "juggernaut", name: "Juggernaut", icon: "🚂", text: "+15% max HP.", perks: { maxHp: 0.15 } }],
    [{ id: "fury", name: "Fury", icon: "😡", text: "30% more damage below half HP.", perks: { lowHp: 0.3 } }, { id: "warlord", name: "Warlord", icon: "👑", text: "+1 mana on the first turn of a fight.", perks: { firstMana: 1 } }],
    [{ id: "sharpedge", name: "Sharp Edge", icon: "🔪", text: "+10% critical hits.", perks: { crit: 10 } }, { id: "recovery", name: "Recovery", icon: "🩹", text: "Heal 12% after every fight won.", perks: { afterFight: 0.12 } }],
    [{ id: "breaker", name: "Armor Breaker", icon: "⛏️", text: "Ignore 25% more armor.", perks: { pierce: 0.25 } }, { id: "momentum", name: "Momentum", icon: "🌀", text: "Your first attack each turn deals 50% more.", perks: { firstStrike: 0.5 } }],
    [{ id: "colossus", name: "Colossus", icon: "🗿", text: "+20% max HP.", perks: { maxHp: 0.2 } }, { id: "undying", name: "Undying", icon: "❤️‍🔥", text: "Heal 15% of your attack damage.", perks: { lifesteal: 0.15 } }],
    [{ id: "titan", name: "Titan", icon: "🌋", text: "25% more damage.", perks: { attack: 0.25 } }, { id: "worldsplitter", name: "Worldsplitter", icon: "💥", text: "Ignore 30% more armor, 10% more damage.", perks: { pierce: 0.3, attack: 0.1 } }],
  ],
  paladin: [
    [{ id: "spikes", name: "Spiked Armor", icon: "🌵", text: "Thorns +30% of your armor.", perks: { thornsDef: 0.3 } }, { id: "bastion", name: "Bastion", icon: "🏰", text: "25% more block from your cards.", perks: { block: 0.25 } }],
    [{ id: "aegis", name: "Aegis", icon: "🛡️", text: "Start every fight with 12 block.", perks: { startBlock: 12 } }, { id: "zealous", name: "Zealous", icon: "💧", text: "+1 mana on the first turn of a fight.", perks: { firstMana: 1 } }],
    [{ id: "retribution", name: "Retribution", icon: "⚡", text: "Thorns +40% of your armor.", perks: { thornsDef: 0.4 } }, { id: "shieldwall", name: "Shield Wall", icon: "🧱", text: "30% more block from your cards.", perks: { block: 0.3 } }],
    [{ id: "holyarmor", name: "Holy Armor", icon: "📿", text: "Start every fight with 10 block, thorns +5.", perks: { startBlock: 10, thorns: 5 } }, { id: "rampart", name: "Rampart", icon: "🏯", text: "Start every fight with 15 block.", perks: { startBlock: 15 } }],
    [{ id: "thornlord", name: "Thorn Lord", icon: "🌹", text: "Thorns +10 and +30% of your armor.", perks: { thorns: 10, thornsDef: 0.3 } }, { id: "steadfast", name: "Steadfast", icon: "⚓", text: "+20% max HP.", perks: { maxHp: 0.2 } }],
    [{ id: "vengeance", name: "Vengeance", icon: "🙏", text: "Thorns +35% of your armor.", perks: { thornsDef: 0.35 } }, { id: "guardian", name: "Guardian", icon: "🛡️", text: "35% more block from your cards.", perks: { block: 0.35 } }],
    [{ id: "crusader", name: "Crusader", icon: "⚔️", text: "Thorns +50% of your armor.", perks: { thornsDef: 0.5 } }, { id: "zealot", name: "Zealot", icon: "🔥", text: "Your first attack each turn deals 40% more.", perks: { firstStrike: 0.4 } }],
    [{ id: "bulwark", name: "Bulwark", icon: "🧱", text: "Start every fight with 20 block, 20% more block.", perks: { startBlock: 20, block: 0.2 } }, { id: "blessed", name: "Blessed", icon: "🌟", text: "+25% max HP.", perks: { maxHp: 0.25 } }],
    [{ id: "avatar", name: "Avatar of Thorns", icon: "☀️", text: "Thorns +80% of your armor.", perks: { thornsDef: 0.8 } }, { id: "divineaegis", name: "Divine Aegis", icon: "👼", text: "50% more block from your cards.", perks: { block: 0.5 } }],
  ],
  cleric: [
    [{ id: "mercy", name: "Mercy", icon: "💚", text: "30% more healing.", perks: { heal: 0.3 } }, { id: "vital", name: "Vitality", icon: "❤️", text: "+15% max HP.", perks: { maxHp: 0.15 } }],
    [{ id: "halo", name: "Halo", icon: "😇", text: "Heal 15% after every fight won.", perks: { afterFight: 0.15 } }, { id: "zeal", name: "Zeal", icon: "🔥", text: "Your first attack each turn deals 40% more.", perks: { firstStrike: 0.4 } }],
    [{ id: "miracle", name: "Miracle", icon: "✨", text: "+1 mana on the first turn of a fight.", perks: { firstMana: 1 } }, { id: "leechlight", name: "Siphon Light", icon: "🕯️", text: "Heal 10% more of your attack damage.", perks: { lifesteal: 0.1 } }],
    [{ id: "grace", name: "Grace", icon: "🕊️", text: "35% more healing.", perks: { heal: 0.35 } }, { id: "sanctuary", name: "Light's Favor", icon: "⛪", text: "+10% max HP, 20% more healing.", perks: { maxHp: 0.1, heal: 0.2 } }],
    [{ id: "devotion", name: "Devotion", icon: "🙏", text: "+20% max HP.", perks: { maxHp: 0.2 } }, { id: "prophet", name: "Prophet", icon: "📜", text: "Draw 1 more card every turn.", perks: { draw: 1 } }],
    [{ id: "renewal", name: "Renewal", icon: "🌱", text: "Heal 20% after every fight won.", perks: { afterFight: 0.2 } }, { id: "smiter", name: "Smiter", icon: "🔨", text: "15% more damage.", perks: { attack: 0.15 } }],
    [{ id: "saint", name: "Saint", icon: "😇", text: "40% more healing.", perks: { heal: 0.4 } }, { id: "benediction", name: "Benediction", icon: "⛪", text: "Heal 10% after every fight won, 15% more healing.", perks: { afterFight: 0.1, heal: 0.15 } }],
    [{ id: "lightwell", name: "Lightwell", icon: "⛲", text: "Heal 15% more of your attack damage.", perks: { lifesteal: 0.15 } }, { id: "inquisitor", name: "Inquisitor", icon: "⚖️", text: "+10% critical hits.", perks: { crit: 10 } }],
    [{ id: "archangel", name: "Archangel", icon: "🪽", text: "+25% max HP, 20% more healing.", perks: { maxHp: 0.25, heal: 0.2 } }, { id: "radiance", name: "Radiance", icon: "🌞", text: "25% more damage.", perks: { attack: 0.25 } }],
  ],
  rogue: [
    [{ id: "venom", name: "Venom", icon: "🐍", text: "Your poison is 40% stronger.", perks: { poison: 0.4 } }, { id: "quick", name: "Quick Hands", icon: "🤹", text: "Draw 1 more card every turn.", perks: { draw: 1 } }],
    [{ id: "assassin", name: "Assassin", icon: "🗡️", text: "Your first attack each turn deals 50% more.", perks: { firstStrike: 0.5 } }, { id: "evasion", name: "Evasion", icon: "🪶", text: "+8% to dodge a hit.", perks: { agi: 8 } }],
    [{ id: "lethal", name: "Lethal", icon: "🎯", text: "+12% critical hits.", perks: { crit: 12 } }, { id: "toxicologist", name: "Toxicologist", icon: "🧪", text: "Your poison is 50% stronger.", perks: { poison: 0.5 } }],
    [{ id: "swift", name: "Swift", icon: "💧", text: "+1 mana on the first turn of a fight.", perks: { firstMana: 1 } }, { id: "leech", name: "Leech", icon: "🦇", text: "Heal 10% of your attack damage.", perks: { lifesteal: 0.1 } }],
    [{ id: "opportunist", name: "Opportunist", icon: "🎭", text: "Your first attack each turn deals 60% more.", perks: { firstStrike: 0.6 } }, { id: "cutthroat", name: "Cutthroat", icon: "🔪", text: "+12% critical hits.", perks: { crit: 12 } }],
    [{ id: "venomancer", name: "Venomancer", icon: "🐍", text: "Your poison is 60% stronger.", perks: { poison: 0.6 } }, { id: "shadow", name: "Shadow", icon: "🌑", text: "+8% to dodge a hit.", perks: { agi: 8 } }],
    [{ id: "deadeye", name: "Deadeye", icon: "👁️", text: "+15% critical hits.", perks: { crit: 15 } }, { id: "sleight", name: "Sleight of Hand", icon: "🃏", text: "Draw 1 more card every turn.", perks: { draw: 1 } }],
    [{ id: "phantom", name: "Phantom", icon: "👻", text: "+10% to dodge a hit.", perks: { agi: 10 } }, { id: "ruthless", name: "Ruthless", icon: "⚔️", text: "20% more damage.", perks: { attack: 0.2 } }],
    [{ id: "plague", name: "Plague", icon: "☣️", text: "Your poison is twice as strong.", perks: { poison: 1 } }, { id: "deathshand", name: "Death's Hand", icon: "💀", text: "+15% critical hits, 15% more damage.", perks: { crit: 15, attack: 0.15 } }],
  ],
  mage: [
    [{ id: "spellstorm", name: "Spellstorm", icon: "🌪️", text: "Hits on every foe deal 20% more.", perks: { aoe: 0.2 } }, { id: "insight", name: "Insight", icon: "📖", text: "Draw 1 more card every turn.", perks: { draw: 1 } }],
    [{ id: "fortune", name: "Fortune", icon: "🍀", text: "+10% critical hits.", perks: { crit: 10 } }, { id: "wellspring", name: "Wellspring", icon: "💧", text: "+1 mana on the first turn of a fight.", perks: { firstMana: 1 } }],
    [{ id: "archmage", name: "Archmage", icon: "🧙", text: "20% more damage.", perks: { attack: 0.2 } }, { id: "ward", name: "Ward", icon: "🔰", text: "Start every fight with 10 block.", perks: { startBlock: 10 } }],
    [{ id: "cataclysm", name: "Cataclysm", icon: "☄️", text: "Hits on every foe deal 30% more.", perks: { aoe: 0.3 } }, { id: "precision", name: "Precision", icon: "🎯", text: "+12% critical hits.", perks: { crit: 12 } }],
    [{ id: "clarity", name: "Clarity", icon: "💎", text: "+1 mana on the first turn of a fight.", perks: { firstMana: 1 } }, { id: "manashield", name: "Mana Shield", icon: "🔷", text: "Start every fight with 12 block.", perks: { startBlock: 12 } }],
    [{ id: "inferno", name: "Inferno", icon: "🔥", text: "Hits on every foe deal 35% more.", perks: { aoe: 0.35 } }, { id: "spellweaver", name: "Spellweaver", icon: "🕸️", text: "Draw 1 more card every turn.", perks: { draw: 1 } }],
    [{ id: "arcaneskin", name: "Arcane Skin", icon: "🧿", text: "+15% max HP.", perks: { maxHp: 0.15 } }, { id: "overload", name: "Overload", icon: "⚡", text: "Your first attack each turn deals 50% more.", perks: { firstStrike: 0.5 } }],
    [{ id: "archon", name: "Archon", icon: "🌌", text: "25% more damage.", perks: { attack: 0.25 } }, { id: "timeweaver", name: "Timeweaver", icon: "⏳", text: "+1 mana on the first turn of a fight.", perks: { firstMana: 1 } }],
    [{ id: "armageddon", name: "Armageddon", icon: "🌋", text: "Hits on every foe deal 50% more.", perks: { aoe: 0.5 } }, { id: "grandmagus", name: "Grand Magus", icon: "🧙", text: "+20% critical hits.", perks: { crit: 20 } }],
  ],
};

// Relics: for one run - a hard fight won gives a choice of three, chests sometimes one, the merchant sells one
const RELICS = {
  vampfang: { name: "Vampire Fang", icon: "🦷", text: "Heal 10% of your attack damage.", perks: { lifesteal: 0.1 } },
  whetstone: { name: "Whetstone", icon: "🪨", text: "15% more damage.", perks: { attack: 0.15 } },
  buckle: { name: "Iron Buckle", icon: "🔩", text: "Start every fight with 6 block.", perks: { startBlock: 6 } },
  crystal: { name: "Mana Crystal", icon: "💎", text: "+1 mana on the first turn of every fight.", perks: { firstMana: 1 } },
  tome: { name: "Ancient Tome", icon: "📜", text: "Draw 1 more card every turn.", perks: { draw: 1 } },
  thornmail: { name: "Thorn Mail", icon: "🌵", text: "Who hits you takes 4 damage.", perks: { thorns: 4 } },
  heartstone: { name: "Heart Stone", icon: "❤️‍🔥", text: "+15% max HP.", perks: { maxHp: 0.15 } },
  clover: { name: "Four-Leaf Clover", icon: "🍀", text: "+10% critical hits.", perks: { crit: 10 } },
  salve: { name: "Mending Salve", icon: "🧴", text: "Heal 10% after every fight won.", perks: { afterFight: 0.1 } },
  helm: { name: "Berserker Helm", icon: "🪖", text: "30% more damage below half HP.", perks: { lowHp: 0.3 } },
  // (classes: only these find it - the rest of no use to the others)
  vial: { name: "Venom Vial", icon: "🧪", text: "Your poison is 50% stronger.", perks: { poison: 0.5 }, classes: ["rogue"] },
  symbol: { name: "Holy Symbol", icon: "✝️", text: "30% more healing.", perks: { heal: 0.3 }, classes: ["cleric"] },
  sigil: { name: "Shield Sigil", icon: "🔰", text: "25% more block from your cards.", perks: { block: 0.25 }, classes: ["paladin"] },
  orb: { name: "Arcane Orb", icon: "🔮", text: "Hits on every foe deal 25% more.", perks: { aoe: 0.25 }, classes: ["mage"] },
  grip: { name: "Giant's Grip", icon: "🦾", text: "Ignore 15% more armor.", perks: { pierce: 0.15 }, classes: ["warrior"] },
  belt: { name: "Titan Belt", icon: "🥋", text: "+10% max HP, 25% more damage below half HP.", perks: { maxHp: 0.1, lowHp: 0.25 }, classes: ["warrior"] },
  pauldrons: { name: "Spiked Pauldrons", icon: "🦔", text: "Thorns: who hits you takes damage, 30% of your armor.", perks: { thornsDef: 0.3 }, classes: ["paladin"] },
  rosary: { name: "Rosary", icon: "📿", text: "Heal 12% after every fight won, attacks heal 5%.", perks: { afterFight: 0.12, lifesteal: 0.05 }, classes: ["cleric"] },
  cloak: { name: "Shadow Cloak", icon: "🧥", text: "+8% dodge.", perks: { agi: 8 }, classes: ["rogue"] },
  focusgem: { name: "Focus Gem", icon: "💠", text: "+12% critical hits.", perks: { crit: 12 }, classes: ["mage"] },
  banner: { name: "War Banner", icon: "🚩", text: "Your first attack each turn deals 40% more.", perks: { firstStrike: 0.4 } },
};
const RELIC_IDS = Object.keys(RELICS);

// The traits of an elite: one of them
const AFFIXES = {
  armored: { name: "Armored", icon: "🛡️", text: "+30% armor." },
  enraged: { name: "Enraged", icon: "😡", text: "Hits 30% harder." },
  regen: { name: "Regenerating", icon: "💚", text: "Heals 8% every turn." },
};

// A card upgraded at a camp fire ("strike+"): 40% stronger
const UPGRADE = 1.4;
const baseCard = (id) => id.replace(/\+$/, "");
const isUpgraded = (id) => id.endsWith("+");
function cardInfo(id) {
  const card = CARDS[baseCard(id)];
  return isUpgraded(id) ? { ...card, name: card.name + "+", upgraded: true } : card;
}

// Hero levels: the XP for the next one; what a fight gives
function xpNeed(level) {
  return Math.round(40 * Math.pow(level, 1.5));
}
// XP: a fight won (by its kind), a floor cleared - x1.35 every floor deeper; at most HERO_LEVEL_MAX
const XP = { fight: 3, hard: 5, elite: 10, boss: 20, floor: 8 };
const HERO_LEVEL_MAX = 50;
const FIRST_CLEAR = 0.5; // a floor cleared the first time: this share of its entry more
function xpFor(kind, floor) {
  return Math.round((XP[kind] || 0) * (1 + (floor - 1) * 0.35));
}

// A price, rounded to a step that fits its size: 10 under 1,000, 50 under 10,000, else 100
const round100 = (value) => {
  const step = value < 1000 ? 10 : value < 10000 ? 50 : 100;
  return Math.max(10, Math.round(value / step) * step);
};
const between = (rng, low, high) => low + rng() * (high - low);
const pick = (rng, list) => list[Math.floor(rng() * list.length)];

/* ---------- The hero ---------- */

// A class (a character) bought after the first one (the first is free)

// A player's hero: one character per class unlocked (its own levels, gear worn, floors) - the bag, the potions
// are shared. cls: the character played now (null: none picked yet - the first is free)
function newHero(cls = null) {
  const hero = { cls: null, unlocked: [], chars: {}, bag: [], potions: 2, packs: {} };
  if (cls) unlock(hero, cls);
  return hero;
}

function newChar() {
  return { levels: { hp: 0, atk: 0, def: 0, luck: 0, agi: 0 }, statsV2: true, gear: { weapon: null, armor: null, charm: null }, deepest: 0, runs: 0, cleared: 0, level: 1, xp: 0, points: 0, talents: [] };
}

// A character of the hero (the one played now, or of a class)
function charOf(hero, cls = hero.cls) {
  if (!cls) return newChar();
  if (!hero.chars[cls]) hero.chars[cls] = newChar();
  const char = hero.chars[cls];
  // (the levels from before the stats went to 100: every one worth half now - twice as many, the power kept)
  if (!char.statsV2) {
    for (const id of Object.keys(char.levels)) char.levels[id] = Math.min(LEVEL_MAX, (char.levels[id] || 0) * 2);
    char.statsV2 = true;
  }
  // (the cards: the starter deck - its cards the first of the collection)
  if (!char.deck) {
    char.deck = starterDeck(cls);
    char.collection = {};
    for (const id of char.deck) char.collection[id] = (char.collection[id] || 0) + 1;
  }
  return char;
}

/* ---------- The collection and the deck (built between the runs) ---------- */

// The cards a class can own: its own (and its mythic one), the neutral ones, the basic ones
function poolOf(cls) {
  const c = CLASSES[cls] || CLASSES.warrior;
  return ["strike", "defend", ...c.cards, c.mythic, ...NEUTRAL_CARDS];
}

// A card into the collection -> true: a copy for the deck, false: one more than a deck may hold (kept all the
// same - for a trade or dust later)
function collect(char, id) {
  const owned = char.collection[id] || 0;
  char.collection[id] = owned + 1;
  return owned < CARD_RARITIES[CARDS[id].rarity].copies;
}

// The copies of a card a deck may hold: the ones owned - at most the rarity's copies
function usable(char, id) {
  return Math.min(char.collection[id] || 0, CARD_RARITIES[CARDS[id].rarity].copies);
}

// A card of the collection into the deck -> an error or null
function deckAdd(hero, id) {
  const char = charOf(hero);
  if (!CARDS[id] || !poolOf(hero.cls).includes(id)) return "Not a card of your class.";
  const inDeck = char.deck.filter((one) => one == id).length;
  if (inDeck >= usable(char, id)) return (char.collection[id] || 0) > inDeck ? `At most ${CARD_RARITIES[CARDS[id].rarity].copies} of a ${CARD_RARITIES[CARDS[id].rarity].name.toLowerCase()} card.` : "You don't own more copies.";
  const { max } = deckLimits(hero);
  if (char.deck.length >= max) return `At most ${max} cards.`;
  char.deck.push(id);
  return null;
}

// A card out of the deck -> an error or null
function deckRemove(hero, id) {
  const char = charOf(hero);
  const index = char.deck.lastIndexOf(id);
  if (index < 0) return "Not in your deck.";
  char.deck.splice(index, 1);
  return null;
}

// A whole deck at once (the deck builder: cleared, back to the starter deck) -> an error or null
function deckSet(hero, ids) {
  const char = charOf(hero);
  if (!Array.isArray(ids) || ids.some((id) => typeof id != "string")) return "Not a deck.";
  const { max } = deckLimits(hero);
  if (ids.length > max) return `At most ${max} cards.`;
  const pool = poolOf(hero.cls);
  const counts = {};
  for (const id of ids) {
    if (!CARDS[id] || !pool.includes(id)) return "Not a card of your class.";
    counts[id] = (counts[id] || 0) + 1;
    if (counts[id] > usable(char, id)) return `You don't own that many of ${CARDS[id].name}.`;
  }
  char.deck = [...ids];
  return null;
}

// The deck may go down: as many cards as the limits allow (DECK_MIN to DECK_MAX - the charm's) -> an error or null
function deckReady(hero) {
  const n = charOf(hero).deck.length;
  const { min, max } = deckLimits(hero);
  if (n < min) return `Deck needs at least ${min} cards (has ${n}).`;
  if (n > max) return `Deck holds at most ${max} cards (has ${n}).`;
  return null;
}

// The class a card belongs to (null: neutral or basic - every class's)
let cardClasses = null;
function cardClass(id) {
  if (!cardClasses) {
    cardClasses = {};
    for (const cls of Object.keys(CLASSES)) for (const card of [...CLASSES[cls].cards, CLASSES[cls].mythic]) cardClasses[card] = cls;
  }
  return cardClasses[id] || null;
}
// A pack: the cards of the own class and the neutral ones this much more often than another class's
const OWN_PACK_WEIGHT = 2;

// A booster pack opened: its cards of the class (the last ones of a rarity at least) -> [{id, fresh, coins}] -
// a card the collection holds all copies of already stays in it too (fresh: false)
function openPack(hero, rng = Math.random, packId = "standard") {
  const char = charOf(hero);
  const pack = PACKS[packId] || PACKS.standard;
  // (the whole set - another class's card goes to that class's collection, for a later character or a trade)
  const pool = Object.keys(CARDS).filter((id) => CARDS[id].rarity != "basic");
  const own = new Set(poolOf(hero.cls));
  const cards = [];
  for (let i = 0; i < pack.size; i++) {
    const better = i >= pack.size - pack.better;
    const least = RARITY_RANK.indexOf(pack.least);
    const choices = pool.filter((id) => !better || RARITY_RANK.indexOf(CARDS[id].rarity) >= least).map((id) => [id, CARD_RARITIES[CARDS[id].rarity].weight * (pack.boost[CARDS[id].rarity] || 1) * (own.has(id) ? OWN_PACK_WEIGHT : 1)]);
    const id = weighted(rng, choices);
    const other = own.has(id) ? null : cardClass(id);
    const fresh = collect(other ? charOf(hero, other) : char, id);
    cards.push(other ? { id, fresh, coins: 0, cls: other } : { id, fresh, coins: 0 });
  }
  return cards;
}

// A class unlocked (and played) - the price is the server's business
function unlock(hero, cls) {
  if (!hero.unlocked.includes(cls)) hero.unlocked.push(cls);
  charOf(hero, cls);
  hero.cls = cls;
}

// The price of the next class (0: the first one)
function classPrice(hero) {
  return hero.unlocked.length ? config.RPG_CLASS_PRICE : 0;
}

// XP for a character: level ups (a stat point each) -> the levels gained
function gainXp(char, xp) {
  char.xp += Math.max(0, Math.round(xp));
  let ups = 0;
  while (char.level < HERO_LEVEL_MAX && char.xp >= xpNeed(char.level)) {
    char.xp -= xpNeed(char.level);
    char.level++;
    char.points++;
    ups++;
  }
  return ups;
}

// A talent picked (tier: 0, 1, 2 - open at TALENT_LEVELS) -> an error or null
function pickTalent(hero, tier, id) {
  const char = charOf(hero);
  const options = (TALENTS[hero.cls] || [])[tier];
  if (!options) return "Unknown talent.";
  if (char.level < TALENT_LEVELS[tier]) return `Opens at level ${TALENT_LEVELS[tier]}.`;
  if (char.talents[tier] && options.some((t) => t.id == char.talents[tier])) return "Picked already.";
  if (!options.some((t) => t.id == id)) return "Unknown talent.";
  char.talents[tier] = id;
  return null;
}

/* ---------- Out of the fights: every class helps the whole party, more with the levels of its main stat ---------- */

// (per level of the class's main stat, 0 to LEVEL_MAX)
const ABILITIES = {
  warrior: { name: "Smash Open", icon: "🔨", coins: 0.01, gear: 0.003, about: "Every level gives 1% more coins and 0.3% more gear from treasures." },
  paladin: { name: "Shield the Party", icon: "🛡️", trap: 0.006, shrine: 0.005, about: "Every level lowers the damage of traps by 0.6% and of shrines by 0.5%." },
  cleric: { name: "Sanctuary", icon: "🕊️", rest: 0.01, rise: 0.003, about: "Every level gives 1% more healing at camp fires and the fallen rise with 0.3% more HP." },
  mage: { name: "Arcane Insight", icon: "🔮", discount: 0.003, rerollEvery: 25, about: "Every level makes the merchant 0.3% cheaper. You can reroll a card reward once per run, and once more every 25 levels." },
  rogue: { name: "Scout", icon: "🦊", about: "Senses hidden rooms far better, more with every level." },
};

// The level of a class's ability in a run: the highest main-stat level of its heroes standing (null: none of them)
function abilityLevel(run, cls) {
  const main = CLASSES[cls].main;
  const ones = run.heroes.filter((h) => h.cls == cls && !h.down && h.levels);
  return ones.length ? Math.max(...ones.map((h) => h.levels[main] || 0)) : null;
}

// What an ability does at a level -> {name, icon, text}
function abilityOf(cls, level = 0) {
  const a = ABILITIES[cls];
  const p = (share) => Math.round(share * level * 100);
  const text = {
    warrior: () => `Treasure +${p(a.coins)}% coins, ${p(a.gear)}% extra gear.`,
    paladin: () => `Traps -${p(a.trap)}% damage, shrines -${p(a.shrine)}% HP.`,
    cleric: () => `Camp fires heal +${p(a.rest)}%, the fallen rise with ${Math.round((REVIVE + a.rise * level) * 100)}% HP.`,
    mage: () => `Merchant -${p(a.discount)}%, ${1 + Math.floor(level / a.rerollEvery)} card reroll${Math.floor(level / a.rerollEvery) ? "s" : ""} a run.`,
    rogue: () => `Senses rooms (with instinct).`,
  }[cls]();
  return { name: a.name, icon: a.icon, text };
}

// A class's strength at a character level: its perks grow from the base at level 1 to STRENGTH_TOP times it (or its
// own top) at the highest level -> {name, icon, perks, text} (the text with the numbers of that level)
const STRENGTH_TOP = 2;
function strengthOf(cls, level = 1) {
  const base = CLASSES[cls].strength;
  const grow = 1 + (((base.top || STRENGTH_TOP) - 1) * (Math.max(1, level) - 1)) / (HERO_LEVEL_MAX - 1);
  const perks = Object.fromEntries(Object.entries(base.perks).map(([key, value]) => [key, Math.round(value * grow * 1000) / 1000]));
  // (shares as %, crit already in %)
  const text = base.text.replace(/\{(\w+)\}/g, (_, key) => String(key == "crit" ? Math.round(perks[key]) : Math.round(perks[key] * 100)));
  return { name: base.name, icon: base.icon, perks, text };
}

// The perks of a character: its class's strength, its talents
function talentPerks(hero, cls = hero.cls) {
  const char = charOf(hero, cls);
  const perks = addPerks({}, CLASSES[cls] ? strengthOf(cls, char.level).perks : {});
  (TALENTS[cls] || []).forEach((options, tier) => {
    const talent = options.find((t) => t.id == char.talents[tier]);
    if (talent) addPerks(perks, talent.perks);
  });
  return perks;
}

function addPerks(into, perks) {
  for (const [key, value] of Object.entries(perks)) into[key] = (into[key] || 0) + value;
  return into;
}

// What a character has with its class, levels and gear: {maxHp, atk, def, luck, agi} (agi: the dodge chance, %)
function statsOf(hero, clsId = hero.cls, extra = {}) {
  const cls = CLASSES[clsId] || CLASSES.warrior;
  const char = charOf(hero, clsId || "warrior");
  const value = (id) => STATS[id].base + STATS[id].per * (char.levels[id] || 0) * (cls.main == id ? cls.mainBonus || MAIN_BONUS : 1);
  const gear = Object.values(char.gear).filter(Boolean);
  const plus = (key) => gear.reduce((sum, item) => sum + (item[key] || 0), 0);
  return {
    // (the class: a share more - and a flat start bonus, big at first, small later)
    maxHp: Math.round((value("hp") + plus("hp")) * cls.hp + (cls.hpPlus || 0)),
    atk: Math.round((value("atk") + plus("atk")) * cls.atk + (cls.atkPlus || 0)),
    def: Math.round(value("def") + plus("def") + cls.def),
    luck: softStat("luck", value("luck") + plus("luck") + cls.luck + (extra.luck || 0)),
    agi: softStat("agi", value("agi") + plus("agi") + cls.agi + (extra.agi || 0)),
  };
}

// A stat at its cap already: a level more would do nothing (none has one now - luck, instinct only grow slower)
function statFull(hero, id) {
  return false;
}

// The place of a character among its player's (0: the first class unlocked) - later ones pay more, fight harder
function charIndex(hero, cls = hero.cls) {
  return Math.max(0, (hero.unlocked || []).indexOf(cls));
}

// The price of a stat level for this character: later characters pay RPG_CHAR_PRICE % more each
function statPrice(hero, level, cls = hero.cls) {
  const cost = upgradeCost(level);
  return cost == null ? null : round100(cost * (1 + (config.RPG_CHAR_PRICE / 100) * charIndex(hero, cls)));
}

// The price of the next level of a stat (null: the last level reached)
// (as dear as the loot of the floor a character with that level plays: the same share of a run all the way)
function upgradeCost(level) {
  if (level >= LEVEL_MAX) return null;
  return round100((config.RPG_STAT_SHARE / 100) * entryCost(1 + (level * (FLOORS - 1)) / (LEVEL_MAX - 1)));
}

// The highest floor the character played now may enter
function maxFloor(hero) {
  return Math.min(FLOORS, charOf(hero).deepest + 1);
}

function entryCost(floor) {
  return round100(config.RPG_ENTRY_BASE * Math.pow(1 + config.RPG_ENTRY_GROWTH / 100, floor - 1));
}

/* ---------- Death: a character down with its party rests 6 hours - or is brought back for coins ---------- */

// The price of bringing it back: entries of its deepest floor open (config) - twice as much with every revive of the day
const REVIVE_GROWTH = 2;

const dayOf = (now) => new Date(now).toDateString();

// How long a character is still dead (ms, 0: alive)
function deadFor(hero, now = Date.now(), cls = hero.cls) {
  return Math.max(0, (charOf(hero, cls).deadUntil || 0) - now);
}

function die(hero, cls, now = Date.now()) {
  charOf(hero, cls).deadUntil = now + config.RPG_DEATH_TIME;
}

/* ---------- The floor cooldown: a cleared floor not opened again for a while (no farming) - another one's party on it: fine ---------- */

function floorCooldown(hero, floor, now = Date.now(), cls = hero.cls) {
  const char = charOf(hero, cls);
  // (the next floor - not cleared yet: always open)
  if (floor > char.deepest) return 0;
  return Math.max(0, ((char.cooldowns || {})[floor] || 0) - now);
}

function coolFloor(hero, floor, cls = hero.cls, now = Date.now()) {
  const char = charOf(hero, cls);
  char.cooldowns = Object.fromEntries(Object.entries(char.cooldowns || {}).filter(([, until]) => until > now));
  if (config.RPG_FLOOR_COOLDOWN > 0) char.cooldowns[floor] = now + config.RPG_FLOOR_COOLDOWN;
}

// A character of this level in a party with these levels: too far apart? (null: fine)
function levelGap(levels, level) {
  const all = [...levels, level];
  const gap = Math.max(...all) - Math.min(...all);
  return gap > config.RPG_PARTY_GAP ? gap : null;
}

// The floors cooling down now: {floor: ms left}
function cooldownsOf(hero, now = Date.now()) {
  const out = {};
  for (const floor of Object.keys(charOf(hero).cooldowns || {})) {
    const left = floorCooldown(hero, Number(floor), now);
    if (left > 0) out[floor] = left;
  }
  return out;
}

// The revives of today (back to 0 at midnight)
function revivesToday(hero, now = Date.now()) {
  return hero.revives && hero.revives.day == dayOf(now) ? hero.revives.count : 0;
}

function revivePrice(hero, now = Date.now()) {
  return round100(config.RPG_REVIVE_ENTRIES * entryCost(maxFloor(hero)) * Math.pow(REVIVE_GROWTH, revivesToday(hero, now)));
}

// Brought back (paid already) -> an error or null
function revive(hero, now = Date.now()) {
  if (!deadFor(hero, now)) return "Your character isn't dead.";
  charOf(hero).deadUntil = 0;
  hero.revives = { day: dayOf(now), count: revivesToday(hero, now) + 1 };
  return null;
}

// For the page: the hero - the character played now, the others in short
function heroView(hero) {
  const char = charOf(hero);
  return {
    cls: hero.cls,
    unlocked: hero.unlocked,
    classPrice: classPrice(hero),
    chars: Object.fromEntries(hero.unlocked.map((id) => [id, { level: charOf(hero, id).level, deepest: charOf(hero, id).deepest, deadFor: deadFor(hero, Date.now(), id) }])),
    levels: { ...newChar().levels, ...char.levels },
    stats: statsOf(hero),
    upgrades: Object.fromEntries(STAT_IDS.map((id) => [id, statFull(hero, id) ? null : statPrice(hero, char.levels[id] || 0)])),
    charIndex: charIndex(hero),
    full: Object.fromEntries(STAT_IDS.map((id) => [id, statFull(hero, id)])),
    gear: char.gear,
    bag: hero.bag,
    potions: hero.potions,
    deepest: char.deepest,
    maxFloor: maxFloor(hero),
    runs: char.runs,
    cleared: char.cleared,
    deck: char.deck,
    collection: char.collection,
    // (every card of the player - all its characters' collections: the whole set's progress)
    owned: Object.values(hero.chars || {}).reduce((all, one) => {
      for (const [id, n] of Object.entries(one.collection || {})) all[id] = (all[id] || 0) + n;
      return all;
    }, {}),
    packs: hero.packs || {},
    potionPrice: potionPrice(maxFloor(hero)),
    deckMax: deckLimits(hero).max,
    deckMin: deckLimits(hero).min,
    pool: hero.cls ? poolOf(hero.cls) : [],
    texts: hero.cls ? liveTexts({ ...statsOf(hero), perks: talentPerks(hero) }, poolOf(hero.cls)) : {},
    strength: hero.cls ? strengthOf(hero.cls, char.level) : null,
    ability: hero.cls ? abilityOf(hero.cls, char.levels[CLASSES[hero.cls].main] || 0) : null,
    level: char.level,
    xp: char.xp,
    xpNeed: xpNeed(char.level),
    points: char.points,
    talents: char.talents,
    bagSize: bagSize(hero),
    potionsMax: potionsMax(hero),
    potionSlotPrice: potionSlotPrice(hero),
    deckSlotPrice: deckSlotPrice(hero),
    decks: decksOf(hero),
    deckAt: charOf(hero).deckAt || 0,
    bagSlotPrice: bagSlotPrice(hero),
    tutorialDone: !!char.tutorialDone,
    deadFor: deadFor(hero),
    cooldowns: cooldownsOf(hero),
    revivePrice: revivePrice(hero),
    revives: revivesToday(hero),
  };
}

/* ---------- Gear ---------- */

let gearCount = 0;
const GEAR_OWN_CLASS = 0.5;

// Who can wear a piece -> an error or null
function canWear(item, cls) {
  if (item.classes && !item.classes.includes(cls)) return `Only for: ${item.classes.map((id) => CLASSES[id].name).join(", ")}.`;
  return null;
}

// A piece of gear from a chest of `floor` (luck: a bit more often a better one)
// (cls: who found it - half the time a piece its class can wear; weapons and armor fit some classes only, boots
// and charms every one)
function makeGear(floor, rng = Math.random, luck = 0, cls = null) {
  const shift = Math.min(0.5, luck / 100);
  const weights = RARITIES.map((rarity, i) => rarity.weight * (i == 0 ? 1 - shift : 1 + shift * i));
  let roll = rng() * weights.reduce((a, b) => a + b, 0);
  let index = 0;
  while (roll >= weights[index] && index < RARITIES.length - 1) roll -= weights[index++];
  const rarity = RARITIES[index];
  const slot = pick(rng, Object.keys(SLOTS));
  const fitting = SLOTS[slot].kinds.filter((k) => !k[3] || k[3].includes(cls));
  const [icon, kind, mix, classes] = pick(rng, cls && fitting.length && rng() < GEAR_OWN_CLASS ? fitting : SLOTS[slot].kinds);
  const material = MATERIALS[Math.min(MATERIALS.length - 1, Math.floor((floor - 1) / 5))];
  const base = 2 + floor * 1.2;
  const item = { id: "g" + Date.now().toString(36) + (++gearCount).toString(36), slot, rarity: rarity.id, name: material + " " + kind, icon, floor };
  if (classes) item.classes = classes;
  // The stats: the slot's base for each - x the kind's mix, x the rarity
  const stat = {
    atk: (m) => Math.max(1, Math.round(base * m * rarity.power)),
    def: (m) => Math.max(1, Math.round(base * 0.6 * m * rarity.power)),
    hp: (m) => Math.max(1, Math.round(base * 4 * m * rarity.power)),
    agi: (m) => Math.max(1, Math.round((1 + floor * 0.15) * m * rarity.power)),
    luck: (m) => Math.max(1, Math.round((1 + floor * 0.25) * m * rarity.power)),
  };
  for (const key of Object.keys(stat)) if (mix[key]) item[key] = stat[key](mix[key]);
  // (epic, legendary: a bonus with a name)
  if (index >= 2) {
    const [suffix, key] = pick(rng, GEAR_AFFIXES);
    item.name += " " + suffix;
    item[key] = (item[key] || 0) + stat[key](0.5);
  }
  if (slot == "charm") {
    // (a charm may change the deck: room for more cards - or fewer needed)
    const roll = rng();
    const deck = mix.deck || 1;
    if (roll < 0.35 * deck) item.deckMax = [1, 2, 3, 5][index];
    else if (roll < 0.6 * deck) item.deckMin = [1, 1, 2, 3][index];
  }
  item.value = round100(entryCost(floor) * 0.15 * rarity.power);
  return item;
}

/* ---------- The map of a floor: rows of rooms, paths between them ---------- */

const ROOM_KINDS = {
  fight: { name: "Fight", icon: "⚔️", about: "Monsters and loot" },
  hard: { name: "Hard fight", icon: "☠️", about: "Tougher monsters, more loot and a relic" },
  elite: { name: "The guarded gate", icon: "👑", about: "Beat it to clear the floor" },
  boss: { name: "Boss", icon: "💀", about: "The master of the floor" },
  chest: { name: "Treasure", icon: "🎁", about: "Coins, gear and maybe a relic" },
  trap: { name: "Trap", icon: "🪤", about: "Disarm or sneak past" },
  rest: { name: "Camp fire", icon: "🔥", about: "Rest or upgrade a card" },
  shrine: { name: "Shrine", icon: "⛩️", about: "Trade HP for power" },
  merchant: { name: "Merchant", icon: "⚖️", about: "Cards, relics, potions and card removal" },
  event: { name: "Encounter", icon: "📜", about: "A strange choice" },
};
// What waits in a room of the map (weights) - mostly fights
const DOOR_POOL = { fight: 15, hard: 5.4, trap: 0.6, chest: 1, rest: 1, shrine: 0.5, merchant: 0.6, event: 1.4 };
const LANES = 4; // the columns of the map
// What a room of the map is - hidden; the party senses it (sees its kind): its best hero's base + per point of
// instinct (agility) - a Rogue far better at it
const SENSE = { base: 10, per: 0.5 };
const SENSE_ROGUE = { base: 25, per: 1.5 };
const SENSE_MAX = 90;
// (kept for the page: one of the doors to pick)
const DOORS = LANES;

function weighted(rng, entries) {
  let roll = rng() * entries.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [value, weight] of entries) {
    if (roll < weight) return value;
    roll -= weight;
  }
  return entries[entries.length - 1][0];
}

// The rows of a floor's map: ROOMS - deeper floors sometimes more (from floor 11 maybe one, from 21 one or two),
// a boss floor one more
function rowsFor(floor, rng = Math.random) {
  let rows = ROOMS;
  if (floor >= 11 && rng() < 0.5) rows++;
  if (floor >= 21) rows += 1 + (rng() < 0.5 ? 1 : 0);
  if (BOSS_EVERY && floor % BOSS_EVERY == 0) rows++;
  return rows;
}

// The map of a floor: ROOMS rows - the first a fight, the last the guarded gate, between them 2 to 4 rooms a row;
// every room leads to one or more of the next row (the paths never cross). A room's kind is hidden - sensed
// (shown) at senseChance
function makeMap(run, rng = Math.random) {
  const chance = senseChance(run);
  const ROOMS = rowsFor(run.floor, rng);
  const middle = (LANES - 1) / 2;
  const rows = [];
  for (let r = 0; r < ROOMS; r++) {
    const last = r == ROOMS - 1;
    let cols = [middle];
    if (r > 0 && !last) {
      const count = 2 + Math.floor(rng() * (LANES - 1));
      cols = shuffle(Array.from({ length: LANES }, (_, i) => i), rng)
        .slice(0, count)
        .sort((a, b) => a - b);
    }
    rows.push(
      cols.map((col, index) => {
        let kind = r == 0 ? "fight" : last ? (BOSS_EVERY && run.floor % BOSS_EVERY == 0 ? "boss" : "elite") : weighted(rng, Object.entries(DOOR_POOL));
        // (no camp fire or merchant right after the first fight - and no two treasures side by side)
        if (r == 1 && (kind == "rest" || kind == "merchant")) kind = "fight";
        const open = r == 0 || last;
        return { row: r, index, col, kind, open, sensed: !open && rng() * 100 < chance, visited: false, next: [] };
      }),
    );
  }
  // (not all random: a camp fire before the gate - a boss: every room of that row; one treasure on the way; the
  // row before the camp fires no camp fire)
  const boss = rows[ROOMS - 1][0].kind == "boss";
  const before = rows[ROOMS - 2];
  if (ROOMS > 3) {
    if (boss) before.forEach((node) => (node.kind = "rest"));
    else if (!before.some((node) => node.kind == "rest")) before[Math.floor(rng() * before.length)].kind = "rest";
    rows[ROOMS - 3].forEach((node) => {
      if (node.kind == "rest") node.kind = "fight";
    });
    const middle = rows.slice(2, ROOMS - 2).flat();
    if (middle.length && !rows.flat().some((node) => node.kind == "chest")) middle[Math.floor(rng() * middle.length)].kind = "chest";
  }
  // The paths: every room to the nearest of the next row, every room of the next row from the nearest - then some
  // more, as long as they cross no other
  for (let r = 0; r < ROOMS - 1; r++) {
    const here = rows[r];
    const there = rows[r + 1];
    const edges = [];
    const add = (a, b) => {
      if (edges.some(([x, y]) => x == a && y == b)) return true;
      if (edges.some(([x, y]) => (here[x].col < here[a].col && there[y].col > there[b].col) || (here[x].col > here[a].col && there[y].col < there[b].col))) return false;
      edges.push([a, b]);
      return true;
    };
    const nearest = (col, list) => list.reduce((best, node) => (Math.abs(node.col - col) < Math.abs(list[best].col - col) ? node.index : best), 0);
    here.forEach((node) => add(node.index, nearest(node.col, there)));
    there.forEach((node) => {
      if (!edges.some(([, b]) => b == node.index)) add(nearest(node.col, here), node.index);
    });
    // (a single room at either end: paths to all)
    if (here.length == 1 || there.length == 1) here.forEach((a) => there.forEach((b) => add(a.index, b.index)));
    for (const a of here) for (const b of there) if (Math.abs(a.col - b.col) <= 1 && rng() < 0.45) add(a.index, b.index);
    for (const [a, b] of edges) here[a].next.push(b);
    here.forEach((node) => node.next.sort((x, y) => x - y));
  }
  return rows;
}

// The rooms the party may go to next: the first row - or the ones the room it is in leads to
function doorsFor(run) {
  if (!run.map) return [];
  if (!run.at) return run.map[0];
  const row = run.map[run.at.row + 1];
  if (!row) return [];
  return run.map[run.at.row][run.at.index].next.map((i) => row[i]);
}

// How often the party senses what a room is (%)
function senseChance(run) {
  const of = (h) => {
    const s = h.cls == "rogue" ? SENSE_ROGUE : SENSE;
    return s.base + s.per * (h.agi || 0);
  };
  return Math.min(SENSE_MAX, Math.round(Math.max(0, ...alive(run.heroes).map(of))));
}

// A room's kind as the party knows it (null: hidden)
function shownKind(node) {
  return node.open || node.sensed || node.visited ? node.kind : null;
}

let monsterCount = 0;
let affixCount = 0;
// (the traits take turns - every one comes up)
function affixRoll() {
  const ids = Object.keys(AFFIXES);
  return ids[affixCount++ % ids.length];
}

// Monster armor: per floor deeper, at most
const ARMOR_FLOOR = 0.008;
const ARMOR_MAX = 0.6;

const RANKS = {
  normal: { id: "normal", prefix: "", hp: 1, atk: 1 },
  hard: { id: "normal", prefix: "", hp: 1.35, atk: 1.15 },
  elite: { id: "elite", prefix: "Elite ", hp: 2.4, atk: 1.3 },
  // (the bosses come later - for now a much stronger one of the floor's monsters)
  boss: { id: "boss", prefix: "", hp: 3, atk: 1.3 },
};

// How much harder a floor is than the first: evenly, like a character's stats grow (its group a bit more or less)
// (deeper down a character has better gear, talents and cards too: the monsters a bit more on top - DEPTH_EXTRA a floor)
const DEPTH_EXTRA = 0.015;
function floorCurve(growth, floor) {
  return (1 + growth * (floor - 1)) * (1 + DEPTH_EXTRA * (floor - 1)) * GROUP_POWER[Math.min(GROUP_POWER.length - 1, Math.floor((floor - 1) / 5))];
}

// A monster of a floor (depth: the row of the map - the deeper into the floor, the stronger; every one a bit
// stronger or weaker than the next: a fight is never quite sure)
function monster(floor, size, kind, rank, depth = 0, rng = Math.random) {
  const deeper = 1 + MONSTER_DEPTH * depth;
  // (a boss: its own power - every one as hard to beat, compared with its floors)
  const power = kind.power || 1;
  const hp = power * MONSTER_HP * (config.RPG_MONSTER_HP / 100) * floorCurve(MONSTER_HP_GROWTH, floor) * deeper * between(rng, 1 - MONSTER_SPREAD, 1 + MONSTER_SPREAD) * kind.hp * (1 + PARTY_HP * (size - 1)) * rank.hp;
  const atk = power * MONSTER_ATK * (config.RPG_MONSTER_ATK / 100) * floorCurve(MONSTER_ATK_GROWTH, floor) * deeper * between(rng, 1 - MONSTER_SPREAD, 1 + MONSTER_SPREAD) * kind.atk * rank.atk * (1 + PARTY_ATK * (size - 1));
  const max = Math.max(1, Math.round(hp));
  // (an elite also smashes)
  const moves = rank.id != "normal" && !kind.moves.includes("smash") ? [...kind.moves, "smash"] : kind.moves;
  const foe = { id: "m" + ++monsterCount, name: rank.prefix + kind.name, icon: kind.icon, hp: max, maxHp: max, atk: Math.max(1, Math.round(atk)), armor: armorOf(floor, kind, rank), dodge: kind.dodge || 0, undead: !!kind.undead, type: kind.type || null, traits: kind.traits || [], moves, rank: rank.id, effects: {}, intent: null, affix: null };
  // (a boss: its own name, its second phase, its summons)
  if (kind.phase) {
    foe.name = kind.name;
    foe.phase = kind.phase;
    foe.summon = kind.summon;
  }
  // (an elite has a trait from floor 3 on: armored, enraged or regenerating)
  if (rank.id == "elite" && floor >= 3) {
    foe.affix = affixRoll();
    foe.name = AFFIXES[foe.affix].name + " " + foe.name;
    if (foe.affix == "enraged") foe.atk = Math.round(foe.atk * 1.3);
    if (foe.affix == "armored") foe.armor = Math.min(ARMOR_MAX, foe.armor + 0.3);
  }
  return foe;
}

// A monster of a run with later characters in it: stronger (run.harder)
function toughen(run, foe) {
  if (run.harder > 1) {
    foe.maxHp = foe.hp = Math.max(1, Math.round(foe.maxHp * run.harder));
    foe.atk = Math.max(1, Math.round(foe.atk * run.harder));
  }
  return foe;
}

// A monster's armor: the share of a hit it takes off - more deeper down, on elites and bosses, on the armored kinds
function armorOf(floor, kind, rank) {
  const extra = rank.id == "boss" ? 0.15 : rank.id == "elite" ? 0.1 : 0;
  return Math.min(ARMOR_MAX, Math.round((ARMOR_FLOOR * (floor - 1) + extra + (kind.armor || 0)) * 100) / 100);
}

// The monsters of a fight: 1 to 3 (more with a bigger party, a hard fight one more) - an elite with a few others
function monstersFor(floor, size, room, rng = Math.random, depth = 0) {
  const group = MONSTERS[Math.min(MONSTERS.length - 1, Math.floor((floor - 1) / 5))];
  if (room == "elite" || room == "boss") {
    const lead = room == "boss" ? BOSSES[Math.min(BOSSES.length - 1, Math.floor((floor - 1) / BOSS_EVERY))] : pick(rng, group);
    const list = [monster(floor, size, lead, RANKS[room], depth, rng)];
    for (let i = 0; i < Math.ceil(size / 2); i++) list.push(monster(floor, size, pick(rng, group), RANKS.normal, depth, rng));
    return list;
  }
  const extra = room == "hard" ? 1 : 0;
  const count = Math.min(5, 1 + Math.floor(rng() * 2) + Math.floor((size - 1) / 2) + extra);
  return Array.from({ length: count }, () => monster(floor, size, pick(rng, group), room == "hard" ? RANKS.hard : RANKS.normal, depth, rng));
}

/* ---------- A run ---------- */

// The starter deck of a class: 4 strikes, 4 defends, its two signature cards
function starterDeck(cls) {
  return ["strike", "strike", "strike", "strike", "defend", "defend", "defend", "defend", ...(CLASSES[cls] || CLASSES.warrior).signature];
}

// (options.tutorial: the practice run - a short map, weak monsters, no coins)
function newRun(floor, party, rng = Math.random, options = {}) {
  const run = {
    // (unique - the pages know which run an update is of)
    uid: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    floor,
    rooms: [], // [{kind, done}] the rooms entered
    event: null, // the room the party is in (not a fight): {kind, id, lines, choices, offers - the merchant's, ...}
    map: null, // the rows of the floor (makeMap)
    at: null, // the room of the map the party is in: {row, index}
    seen: [], // the encounters met already
    doors: [], // the rooms of the map it may go to next
    votes: {}, // name -> a door's index or "leave"
    phase: "between",
    heroes: party.map(({ name, hero }) => {
      // (the talents of the character: perks for the whole run - relics add theirs; dodge from them: past the knee, slower too)
      const perks = talentPerks(hero);
      const stats = statsOf(hero, hero.cls, { agi: perks.agi || 0 });
      stats.maxHp = Math.round(stats.maxHp * (1 + (perks.maxHp || 0)));
      return {
        name,
        cls: hero.cls,
        level: charOf(hero).level,
        maxFloor: maxFloor(hero),
        levels: { ...charOf(hero).levels },
        potionsMax: potionsMax(hero),
        share: lootShare(charOf(hero).deepest, floor),
        ...stats,
        hp: stats.maxHp,
        perks,
        relics: [],
        relicChoice: null,
        xp: 0,
        down: false,
        potions: hero.potions,
        deck: [...charOf(hero).deck],
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
  if (options.tutorial) run.tutorial = true;
  // (later characters of their players: stronger monsters - a party: the average)
  run.rerolls = null;
  run.harder = 1 + (config.RPG_CHAR_HARDER / 100) * (party.reduce((sum, { hero }) => sum + charIndex(hero), 0) / Math.max(1, party.length));
  run.map = run.tutorial ? tutorialMap() : makeMap(run, rng);
  run.doors = doorsFor(run);
  return run;
}

// The practice run's map: a fight, a camp fire, a fight - everything shown
function tutorialMap() {
  const node = (row, kind) => ({ row, index: 0, col: 1.5, kind, open: true, sensed: false, visited: false, next: row < 2 ? [0] : [] });
  return [[node(0, "fight")], [node(1, "rest")], [node(2, "fight")]];
}

function say(run, text) {
  run.log.push(text);
  if (run.log.length > 40) run.log.splice(0, run.log.length - 40);
}

// What happened in a fight, step by step - the pages play it back (a card, a hit, a block, a heal, a monster's move ...):
// {id, k: kind, to / by: a hero's name or a monster's id, n: an amount ...}
function fx(run, event) {
  run.fxSeq = (run.fxSeq || 0) + 1;
  event.id = run.fxSeq;
  if (!run.fx) run.fx = [];
  run.fx.push(event);
  if (run.fx.length > 80) run.fx.splice(0, run.fx.length - 80);
}

const alive = (list) => list.filter((one) => !one.down && one.hp > 0);
const perk = (hero, key) => (hero.perks && hero.perks[key]) || 0;

// A relic for a hero (its perks for the rest of the run)
function giveRelic(run, hero, id) {
  const relic = RELICS[id];
  hero.relics.push(id);
  addPerks(hero.perks, relic.perks);
  if (relic.perks.maxHp) {
    const more = Math.round(hero.maxHp * relic.perks.maxHp);
    hero.maxHp += more;
    hero.hp += more;
  }
  say(run, `${hero.name} takes ${relic.icon} ${relic.name}: ${relic.text}`);
}

// Three relics a hero hasn't got yet
function relicOffer(hero, rng, count = 3) {
  const free = RELIC_IDS.filter((id) => !hero.relics.includes(id) && (!RELICS[id].classes || RELICS[id].classes.includes(hero.cls)));
  return shuffle(free, rng).slice(0, count);
}
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

// Every hero there has voted (one gone from the page doesn't hold the party up)
function allVoted(run) {
  const here = run.heroes.filter((h) => !h.away);
  return here.length > 0 && here.every((h) => h.name in run.votes);
}

// A hero gone from the page (away: true) or back - the fight and the votes don't wait for one away
function setAway(run, name, away) {
  const hero = run.heroes.find((h) => h.name == name);
  if (hero) hero.away = away;
}

// A hero out of a run before its end (left, or away too long): no share of the pot, no loot - half the XP;
// the others go on (nobody left: the run is over)
function abandon(run, name) {
  const hero = run.heroes.find((h) => h.name == name);
  if (!hero) return null;
  run.heroes = run.heroes.filter((h) => h != hero);
  delete run.votes[name];
  (run.gone = run.gone || []).push({ name, cls: hero.cls, xp: hero.xp, potions: hero.potions });
  say(run, `${name} leaves the party.`);
  if (!run.heroes.length) run.phase = "left";
  return hero;
}

// What the party chose: the most votes - a tie: one of them at random; nobody voted: "leave"
function tally(run, rng = Math.random) {
  const counts = new Map();
  for (const choice of Object.values(run.votes)) counts.set(choice, (counts.get(choice) || 0) + 1);
  if (!counts.size) return "leave";
  const most = Math.max(...counts.values());
  const top = [...counts].filter(([, n]) => n == most).map(([choice]) => choice);
  return top.length == 1 ? top[0] : pick(rng, top);
}

/* ---------- The rooms ---------- */

// The rooms that aren't fights: what every hero may choose there (card: the choice needs a card - "smith", "deck":
// one of the deck, "offer": one of the cards offered)
const ROOM_OPTIONS = {
  chest: [{ id: "open", label: "Open it", text: "Find gear and maybe a relic." }],
  trap: [
    { id: "disarm", label: "Disarm it", text: "With luck you find gear. If it fails, you take 25% damage." },
    { id: "sneak", label: "Sneak past", text: "You take 10% damage." },
  ],
  rest: [
    { id: "rest", label: "Rest", text: "Heal 35% of your HP and get 1 more mana in the next fight." },
    { id: "smith", label: "Smith", text: "Upgrade a card to make it 40% stronger.", card: "smith" },
  ],
  shrine: [
    { id: "pray", label: "Pray", text: "Lose 20% of your HP and deal 25% more damage this run." },
    { id: "leave", label: "Walk on", text: "Nothing happens." },
  ],
};
const LEAVE = { id: "leave", label: "Leave", text: "Nothing happens." };
// The encounters (rooms of the kind "event") - one at random, none twice a run
const ENCOUNTERS = {
  fountain: {
    name: "The Fountain",
    icon: "⛲",
    story: "Clear water bubbles up in an old stone basin. It glows faintly.",
    options: [
      { id: "drink", label: "Drink", text: "Heal 30% of your HP." },
      { id: "bottle", label: "Fill a flask", text: "Get one more potion." },
    ],
  },
  library: {
    name: "The Forgotten Library",
    icon: "📚",
    story: "Dusty shelves full of old battle manuals.",
    options: [
      { id: "read", label: "Study", text: "Pick 1 of 5 cards for your deck.", card: "offer" },
      { id: "nap", label: "Take a nap", text: "Heal 20% of your HP." },
    ],
  },
  forge: {
    name: "The Abandoned Forge",
    icon: "⚒️",
    story: "The anvil is still warm, the coals hot.",
    options: [{ id: "temper", label: "Temper", text: "Upgrade 2 random cards and lose 8% of your HP." }, LEAVE],
  },
  idol: {
    name: "The Golden Idol",
    icon: "🗿",
    story: "A golden idol on a stone pedestal. It is surely cursed.",
    options: [{ id: "take", label: "Take it", text: "Get a random relic and lose 10% max HP for this run." }, LEAVE],
  },
  hermit: {
    name: "The Hermit",
    icon: "🧙",
    story: 'An old hermit by a small fire: "You carry too much. Give me one of your cards."',
    options: [{ id: "purge", label: "Give a card", text: "Remove a card for this run.", card: "deck" }, LEAVE],
  },
  gambler: {
    name: "The Gambler",
    icon: "🎲",
    story: 'A grinning imp shakes a cup of dice: "Your blood against my treasure?"',
    options: [{ id: "roll", label: "Roll the dice", text: "Win a relic with a 50% chance, otherwise lose 15% of your HP." }, LEAVE],
  },
};
const DISARM_BASE = 30; // + 2 x luck %
const MERCHANT_CARDS = 5;
const MERCHANT_RELICS = 2;
const DECK_LEAST = 5; // a run's deck: never fewer cards (the hermit, the merchant take some)

// What a room offers to choose
function optionsOf(event) {
  if (!event) return [];
  if (event.kind == "event") return ENCOUNTERS[event.id].options;
  return ROOM_OPTIONS[event.kind] || [];
}

function disarmChance(hero) {
  return Math.min(90, DISARM_BASE + 2 * hero.luck);
}

// Into a room of the map (its index of run.doors): a fight starts - in the other rooms every hero chooses
function enterRoom(run, door = 0, rng = Math.random) {
  const chosen = run.doors[door] || run.doors[0];
  run.event = null;
  const kind = chosen.kind;
  const room = { kind, done: false };
  chosen.visited = true;
  run.at = { row: chosen.row, index: chosen.index };
  run.rooms.push(room);
  run.doors = [];
  run.votes = {};
  const heroes = alive(run.heroes);
  const n = roomNumber(run);
  if (!chosen.open && !chosen.sensed) say(run, `Room ${n}: ${ROOM_KINDS[kind].icon} ${ROOM_KINDS[kind].name}!`);
  if (kind == "fight" || kind == "hard" || kind == "elite" || kind == "boss") {
    run.monsters = monstersFor(run.floor, run.heroes.length, kind, rng, chosen.row || 0);
    run.monsters.forEach((m) => toughen(run, m));
    // (the practice run: one slime first, then two easy foes - half as strong)
    if (run.tutorial) {
      run.monsters = run.monsters.slice(0, run.rooms.length == 1 ? 1 : 2);
      for (const m of run.monsters) {
        m.maxHp = m.hp = Math.max(1, Math.round(m.maxHp * TUTORIAL_POWER));
        m.atk = Math.max(1, Math.round(m.atk * TUTORIAL_POWER));
        m.armor = 0;
      }
    }
    run.phase = "fight";
    run.turn = 0;
    for (const hero of run.heroes) {
      hero.draw = shuffle([...hero.deck], rng);
      hero.hand = [];
      hero.discard = [];
      hero.exhausted = [];
      hero.effects = {};
      hero.auras = [];
      hero.reward = null;
    }
    say(run, `${run.monsters.map((m) => m.icon + " " + m.name).join(", ")}!`);
    startRound(run, rng);
    return;
  }
  // The room stays until the party goes on: every hero chooses (the merchant: buys) - what happened is shown
  run.event = { kind, id: null, lines: [], choices: Object.fromEntries(heroes.map((h) => [h.name, null])), offers: null };
  const note = (text) => {
    run.event.lines.push(text);
    say(run, text);
  };
  if (kind == "event") {
    const fresh = Object.keys(ENCOUNTERS).filter((id) => !run.seen.includes(id));
    const id = pick(rng, fresh.length ? fresh : Object.keys(ENCOUNTERS));
    run.event.id = id;
    run.seen.push(id);
    if (id == "library") run.event.offers = Object.fromEntries(heroes.map((h) => [h.name, rewardFor(h, rng, 5)]));
    say(run, `${ENCOUNTERS[id].icon} ${ENCOUNTERS[id].name}.`);
  } else if (kind == "chest") {
    // (a warrior smashes it open: more coins, maybe gear for everyone)
    const smash = abilityLevel(run, "warrior");
    const coins = Math.round(entryCost(run.floor) * REWARD.chest * (config.RPG_LOOT / 100) * partyBonus(run.heroes.length) * (1 + ABILITIES.warrior.coins * (smash || 0)));
    run.pot += coins;
    run.event.shared = [{ k: "coins", n: coins }];
    run.event.results = {};
    note(`🪙 ${coins} each to the pot.`);
    if (smash != null)
      for (const hero of heroes)
        if (rng() < ABILITIES.warrior.gear * smash) {
          const item = makeGear(run.floor, rng, hero.luck, hero.cls);
          run.loot[hero.name].push(item);
          (run.event.results[hero.name] = run.event.results[hero.name] || []).push({ k: "gear", item, smashed: true });
          note(`🔨 Smashed open: ${hero.name} finds ${item.icon} ${item.name}.`);
        }
  } else if (kind == "merchant") {
    // (every hero shops on its own, with its own coins - no choice to make)
    run.event.choices = null;
    run.event.offers = {};
    const prices = merchantPrices(run.floor);
    // (a mage haggles: cheaper for everyone)
    const off = 1 - ABILITIES.mage.discount * (abilityLevel(run, "mage") || 0);
    for (const key of Object.keys(prices)) prices[key] = round100(prices[key] * off);
    for (const hero of heroes) {
      const cards = rewardFor(hero, rng, MERCHANT_CARDS);
      const relics = relicOffer(hero, rng, MERCHANT_RELICS);
      // (the floor's prices - the deeper, the dearer)
      const price = { potion: round100(potionPrice(run.floor) * off), remove: prices.remove };
      for (const id of cards) price[id] = round100(prices.card * CARD_PRICE[CARDS[id].rarity]);
      for (const id of relics) price[id] = prices.relic;
      run.event.offers[hero.name] = { cards, relics, bought: [], removed: false, prices: price };
    }
    say(run, "A merchant opens his pack.");
  }
  room.done = true;
  afterRoom(run, rng);
}

// A room done: the next rooms of the map to pick - or the floor is cleared
function afterRoom(run) {
  run.monsters = [];
  if (run.rooms.length >= (run.map ? run.map.length : ROOMS)) {
    run.phase = "won";
    say(run, `Floor ${run.floor} cleared! 🎉`);
    return;
  }
  run.phase = "between";
  run.votes = {};
  run.doors = doorsFor(run);
}

// A potion (in a fight or between the rooms - it costs no energy)
const POTION_MANA = 1;

function drink(run, name) {
  const hero = run.heroes.find((h) => h.name == name);
  if (!hero || hero.down) return "You are down.";
  if (run.phase != "fight" && run.phase != "between") return "Not now.";
  if (hero.potions <= 0) return "No potions left.";
  if (hero.hp >= hero.maxHp) return "Your HP is full.";
  // (in a fight: 1 mana, like a card)
  if (run.phase == "fight" && hero.ended) return "You ended your turn.";
  if (run.phase == "fight" && hero.energy < POTION_MANA) return `A potion needs ${POTION_MANA} mana.`;
  if (run.phase == "fight") hero.energy -= POTION_MANA;
  const heal = Math.min(hero.maxHp - hero.hp, Math.round(hero.maxHp * POTION_HEAL));
  hero.hp += heal;
  if (run.phase == "fight") fx(run, { k: "heal", to: hero.name, n: heal });
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

// A mage's insight: the card reward drawn again - 1 + one more every rerollEvery levels a run, for the party
function rerollReward(run, name, rng = Math.random) {
  const hero = run.heroes.find((h) => h.name == name);
  if (!hero || !hero.reward) return "No card to pick.";
  const level = abilityLevel(run, "mage");
  if (level == null) return "No mage in the party.";
  if (run.rerolls == null) run.rerolls = 1 + Math.floor(level / ABILITIES.mage.rerollEvery);
  if (run.rerolls <= 0) return "No rerolls left.";
  run.rerolls--;
  hero.reward = rewardFor(hero, rng);
  say(run, `🔮 ${hero.name} sees other cards.`);
  return null;
}

// The relic of the elite: one of three (null: none)
function pickRelic(run, name, id) {
  const hero = run.heroes.find((h) => h.name == name);
  if (!hero || !hero.relicChoice) return "No relic to pick.";
  if (id != null && !hero.relicChoice.includes(id)) return "Not one of your relics.";
  if (id != null) giveRelic(run, hero, id);
  hero.relicChoice = null;
  return null;
}

// A hero's choice in a room: {option, card} (card: an index of the deck - or a card offered) -> an error or null
function choose(run, name, input = {}, rng = Math.random) {
  const hero = run.heroes.find((h) => h.name == name);
  const event = run.event;
  if (run.phase != "between" || !event || !event.choices || !hero || !(name in event.choices)) return "Nothing to choose here.";
  if (event.choices[name]) return "You chose already.";
  const option = optionsOf(event).find((o) => o.id == input.option);
  if (!option) return "Not one of the choices.";
  let index = null;
  if (option.card == "smith" || option.card == "deck") {
    index = Number(input.card);
    if (!Number.isInteger(index) || !hero.deck[index]) return "Pick a card of your deck.";
    if (option.card == "smith" && isUpgraded(hero.deck[index])) return "That card is upgraded already.";
    if (option.card == "deck" && hero.deck.length <= DECK_LEAST) return `Your deck keeps at least ${DECK_LEAST} cards.`;
  }
  if (option.card == "offer" && !(event.offers[name] || []).includes(input.card)) return "Pick one of the cards.";
  if (option.id == "bottle" && hero.potions >= (hero.potionsMax || POTIONS_MAX)) return `At most ${hero.potionsMax || POTIONS_MAX} potions.`;
  const note = (text) => {
    event.lines.push(text);
    say(run, text);
  };
  // (what the hero got, for the page's cards: {k: "gear", item} {k: "relic", id} {k: "hp", n} {k: "heal", n}
  // {k: "potion"} {k: "card", id} {k: "upgrade", ids} {k: "buff", text} {k: "nothing"})
  if (!event.results) event.results = {};
  const got = (result) => (event.results[name] = event.results[name] || []).push(result);
  // (a paladin shields the party: traps and shrines hurt less)
  const shield = abilityLevel(run, "paladin") || 0;
  const lose = (share, cut = 0) => {
    const damage = Math.round(hero.maxHp * share * Math.max(0, 1 - cut * shield));
    hero.hp = Math.max(1, hero.hp - damage);
    got({ k: "hp", n: damage });
    return damage;
  };
  const gear = () => {
    const item = makeGear(run.floor, rng, hero.luck, hero.cls);
    run.loot[hero.name].push(item);
    got({ k: "gear", item });
    return item;
  };
  const relic = () => {
    const [id] = relicOffer(hero, rng, 1);
    if (id) giveRelic(run, hero, id);
    if (id) got({ k: "relic", id });
    return id;
  };
  const healed = (n) => (got({ k: "heal", n }), n);
  event.choices[name] = option.id;
  switch (option.id) {
    case "open": {
      // (every hero rolls on its own - luck helps: gear, maybe a relic - nothing of both: dust)
      const lucky = rng() * 100 < 40 + hero.luck / 2;
      const withRelic = rng() < 0.2;
      if (lucky) {
        const item = gear();
        note(`${name} finds ${item.icon} ${item.name} (${item.rarity}).`);
      }
      const id = withRelic ? relic() : null;
      if (id) note(`${name} finds a relic: ${RELICS[id].icon} ${RELICS[id].name}.`);
      if (!lucky && !id) {
        got({ k: "nothing" });
        note(`${name} finds nothing but dust.`);
      }
      break;
    }
    case "disarm":
      if (rng() * 100 < disarmChance(hero)) {
        const item = gear();
        note(`${name} disarms the trap 🍀: ${item.icon} ${item.name}.`);
      } else note(`${name} sets it off: ${lose(0.25, ABILITIES.paladin.trap)} damage.`);
      break;
    case "sneak":
      note(`${name} sneaks past: ${lose(0.1, ABILITIES.paladin.trap)} damage.`);
      break;
    case "rest":
      hero.bonusEnergy = 1;
      note(`${name} rests: +${healed(healHero(run, hero, hero.maxHp * REST_HEAL * (1 + ABILITIES.cleric.rest * (abilityLevel(run, "cleric") || 0))))} HP, +1 mana in the next fight.`);
      got({ k: "buff", icon: "💧", text: "+1 mana in the next fight" });
      break;
    case "smith": {
      const id = hero.deck[index];
      hero.deck[index] = id + "+";
      got({ k: "card", id: id + "+" });
      note(`${name} smiths ${CARDS[id].icon} ${CARDS[id].name}+ ⚒️.`);
      break;
    }
    case "pray":
      hero.blessed = true;
      got({ k: "buff", icon: "✨", text: "+25% damage this run" });
      note(`${name} gives ${lose(SHRINE_COST, ABILITIES.paladin.shrine)} HP: +25% damage this run.`);
      break;
    case "drink":
      note(`${name} drinks: +${healed(healHero(run, hero, hero.maxHp * 0.3))} HP.`);
      break;
    case "bottle":
      hero.potions++;
      got({ k: "potion" });
      note(`${name} fills a flask: +1 potion 🧪.`);
      break;
    case "read":
      hero.deck.push(input.card);
      got({ k: "card", id: input.card });
      note(`${name} studies ${CARDS[input.card].icon} ${CARDS[input.card].name}.`);
      break;
    case "nap":
      note(`${name} naps: +${healed(healHero(run, hero, hero.maxHp * 0.2))} HP.`);
      break;
    case "temper": {
      const free = hero.deck.map((id, i) => i).filter((i) => !isUpgraded(hero.deck[i]));
      const picked = shuffle(free, rng).slice(0, 2);
      picked.forEach((i) => (hero.deck[i] += "+"));
      picked.forEach((i) => got({ k: "card", id: hero.deck[i] }));
      note(`${name} tempers ${picked.map((i) => cardInfo(hero.deck[i]).name).join(" and ") || "nothing"}: ${lose(0.08)} damage.`);
      break;
    }
    case "take": {
      const id = relic();
      hero.maxHp = Math.max(1, Math.round(hero.maxHp * 0.9));
      hero.hp = Math.min(hero.hp, hero.maxHp);
      got({ k: "buff", icon: "💔", text: "-10% max HP this run", bad: true });
      note(id ? `${name} takes the idol: ${RELICS[id].icon} ${RELICS[id].name}, -10% max HP.` : `${name} takes the idol - it crumbles to dust.`);
      break;
    }
    case "purge": {
      const [id] = hero.deck.splice(index, 1);
      got({ k: "card", id, lost: true });
      note(`${name} gives ${cardInfo(id).icon} ${cardInfo(id).name} to the hermit.`);
      break;
    }
    case "roll":
      if (rng() < 0.5) {
        const id = relic();
        if (!id) got({ k: "nothing" });
        note(id ? `${name} wins 🎲: ${RELICS[id].icon} ${RELICS[id].name}!` : `${name} wins - but the imp has nothing left.`);
      } else note(`${name} loses 🎲: ${lose(0.15)} damage.`);
      break;
    default:
      got({ k: "nothing", walked: true });
      note(`${name} walks on.`);
  }
  return null;
}

// What a hero may buy at one merchant
const MERCHANT_BUY = { cards: 2, relics: 1 };
const MERCHANT_CARD = 0.25; // a common card at the merchant: this share of the floor's entry
// The merchant's prices (coins): a potion, a (common) card, a relic, a card taken out of the deck
const CARD_PRICE = { common: 1, rare: 1.5, epic: 2.5, legendary: 3.5, basic: 1, mythic: 5 };
// (the cards are only for the run: cheap - a quarter of the floor's entry, 2,500 on floor 1, growing with the floors
// as the entry, the loot and the stat levels do)
function merchantPrices(floor) {
  const card = round100(entryCost(floor) * MERCHANT_CARD);
  return { card, relic: card * 2, remove: card };
}

// What a hero may buy of the merchant: {price} or {error} (item: "potion", "remove:<index of the deck>", a card or a
// relic of its offer)
function canBuy(run, name, item) {
  const hero = run.heroes.find((h) => h.name == name);
  const offer = run.event && run.event.offers && run.event.kind == "merchant" && run.event.offers[name];
  if (run.phase != "between" || !offer || !hero) return { error: "No merchant here." };
  if (item == "potion") {
    if (hero.potions >= (hero.potionsMax || POTIONS_MAX)) return { error: `At most ${hero.potionsMax || POTIONS_MAX} potions.` };
    return { price: offer.prices.potion };
  }
  if (/^remove:\d+$/.test(item)) {
    if (offer.removed) return { error: "Only one card a visit." };
    if (!hero.deck[Number(item.slice(7))]) return { error: "Pick a card of your deck." };
    if (hero.deck.length <= DECK_LEAST) return { error: `Your deck keeps at least ${DECK_LEAST} cards.` };
    return { price: offer.prices.remove };
  }
  if (offer.bought.includes(item)) return { error: "Sold already." };
  if (!offer.cards.includes(item) && !offer.relics.includes(item)) return { error: "He doesn't sell that." };
  // (a visit: at most MERCHANT_BUY.cards cards and MERCHANT_BUY.relics relics - potions up to the max, a card removed)
  const relic = offer.relics.includes(item);
  const had = offer.bought.filter((id) => offer.relics.includes(id) == relic).length;
  if (relic && had >= MERCHANT_BUY.relics) return { error: `One relic a visit.` };
  if (!relic && had >= MERCHANT_BUY.cards) return { error: `${MERCHANT_BUY.cards} cards a visit.` };
  return { price: offer.prices[item] };
}

// Bought (the coins are taken already)
function bought(run, name, item) {
  const hero = run.heroes.find((h) => h.name == name);
  const offer = run.event.offers[name];
  const note = (text) => {
    run.event.lines.push(text);
    say(run, text);
  };
  if (item == "potion") {
    hero.potions++;
    return note(`${name} buys a potion 🧪.`);
  }
  if (item.startsWith("remove:")) {
    offer.removed = true;
    const [id] = hero.deck.splice(Number(item.slice(7)), 1);
    return note(`${name} removes ${cardInfo(id).icon} ${cardInfo(id).name}.`);
  }
  offer.bought.push(item);
  if (offer.relics.includes(item)) {
    giveRelic(run, hero, item);
    return note(`${name} buys ${RELICS[item].icon} ${RELICS[item].name}.`);
  }
  hero.deck.push(item);
  note(`${name} buys ${CARDS[item].icon} ${CARDS[item].name}.`);
}

// Three different cards: mostly the class's, sometimes a neutral one
function rewardFor(hero, rng, count = 3) {
  // (the class's cards and the neutral ones - weighted by their rarity; no basic, no mythic one)
  const pool = poolOf(hero.cls).filter((id) => !["basic", "mythic"].includes(CARDS[id].rarity)).map((id) => [id, CARD_RARITIES[CARDS[id].rarity].weight]);
  const cards = [];
  while (cards.length < Math.min(count, pool.length)) cards.push(weighted(rng, pool.filter(([id]) => !cards.includes(id))));
  return cards;
}

// Poison stacks (the damage adds up, the longer time counts); a burn doesn't - a new one only replaces a weaker one
function afflict(one, kind, turns, dmg) {
  // (a monster that shrugs it off)
  if (one.traits && one.traits.includes(kind == "poison" ? "venomproof" : "fireproof")) return false;
  const old = one.effects[kind];
  if (kind == "poison" && old) one.effects.poison = { turns: Math.max(old.turns, turns), dmg: old.dmg + dmg };
  else if (old) one.effects[kind] = { turns: Math.max(old.turns, turns), dmg: Math.max(old.dmg, dmg) };
  else one.effects[kind] = { turns, dmg };
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

// A new turn of the heroes: block gone, full energy, the hand filled up to 5; the monsters show what they do next
function startRound(run, rng) {
  run.turn++;
  const first = run.turn == 1;
  fx(run, { k: "turn", side: "heroes", first });
  for (const hero of alive(run.heroes)) {
    hero.block = first ? perk(hero, "startBlock") : 0;
    hero.energy = ENERGY + hero.bonusEnergy + (first ? perk(hero, "firstMana") : 0);
    hero.bonusEnergy = 0;
    hero.ended = false;
    hero.attacked = false;
    // (the AURAS: their block, healing, mana - a turn less)
    for (const aura of hero.auras || []) {
      if (aura.kind == "guard") {
        hero.block += aura.value;
        fx(run, { k: "block", to: hero.name, n: aura.value });
      } else if (aura.kind == "regen") healHero(run, hero, aura.value);
      else if (aura.kind == "focus") hero.energy += aura.value;
      aura.turns--;
    }
    if (hero.auras) hero.auras = hero.auras.filter((aura) => aura.turns > 0);
    drawCards(hero, Math.max(0, HAND + perk(hero, "draw") - hero.hand.length), rng);
  }
  planIntents(run, rng);
}

// What every monster does next: a move and (an attack) a hero - shown before the heroes play
function planIntents(run, rng = Math.random) {
  const heroes = alive(run.heroes);
  for (const foe of alive(run.monsters)) {
    let options = foe.moves.filter((move) => {
      if ((move == "regen" || move == "heal") && furious(run)) return false;
      if (move == "regen") return foe.hp < foe.maxHp * 0.7;
      if (move == "heal") return alive(run.monsters).some((m) => m.hp < m.maxHp * 0.7);
      if (move == "howl") return !foe.effects.rage;
      if (move == "steal") return heroes.some((h) => h.potions > 0);
      // (calls for help: at most SUMMON_MAX monsters a fight - none once furious)
      if (move == "summon") return alive(run.monsters).length < 4 && (foe.summoned || 0) < SUMMON_MAX && !furious(run);
      if (move == "purge") return alive(run.monsters).some((m) => m.effects.poison || m.effects.burn);
      if (move == "curse") return heroes.some((h) => !h.effects.weak);
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
// A fight that drags on: from FURY_TURN the monsters are furious - no more healing, every turn 20% more damage on top
// (no fight lasts forever, not even against a regenerating monster or a hero who only blocks)
const FURY_TURN = 12;
const SUMMON_MAX = 4; // the monsters one boss may call in a fight
const FURY_STEP = 0.2;
const furious = (run) => run.turn >= FURY_TURN;

function intentDamage(foe, move) {
  const info = MOVES[move];
  if (!info.power) return 0;
  let damage = foe.atk * info.power * Math.pow(1 + FURY_STEP, foe.fury || 0);
  if (foe.effects.rage) damage *= 1.3;
  if (foe.effects.chill) damage *= 0.5;
  return Math.max(1, Math.round(damage));
}

const WEAK = 0.7; // a cursed hero's damage
const DEFEND = 0.5; // a monster on guard: this much of a hit gets through
const SPIKES = 0.2; // of a hit on a spiked monster: back to the hitter

// A boss at half HP: its second phase - once (more attack, other moves, a word about it)
function bossPhase(run, foe) {
  if (!foe.phase || foe.phased || foe.down || foe.hp > foe.maxHp / 2) return;
  foe.phased = true;
  foe.atk = Math.round(foe.atk * foe.phase.atk);
  foe.moves = foe.phase.moves;
  say(run, `${foe.icon} ${foe.name} ${foe.phase.text}!`);
  fxEvent(run, { k: "phase", by: foe.id, text: foe.phase.text });
}

// A hit of a hero on a monster: the damage done (a plain attack may be dodged - a fading foe dodges them all)
function strike(run, hero, foe, power, rng, options = {}) {
  if (foe.down) return 0;
  if (!options.sure && (foe.fading || rng() < foe.dodge)) {
    say(run, `${foe.icon} ${foe.name} dodges ${hero.name}.`);
    fx(run, { k: "miss", to: foe.id });
    return 0;
  }
  const crit = rng() * 100 < hero.luck + perk(hero, "crit");
  // (the perks of talents and relics: more damage, the first attack of a turn, low HP)
  const bonus = 1 + perk(hero, "attack") + (hero.firstAttack ? perk(hero, "firstStrike") : 0) + (hero.hp < hero.maxHp / 2 ? perk(hero, "lowHp") : 0);
  let damage = hero.atk * between(rng, 0.9, 1.1) * power * bonus * (crit ? CRIT : 1) * (hero.blessed ? SHRINE_POWER : 1) * (hero.effects.might ? MIGHT : 1);
  // (armor - the warrior's hits break through a part of it; a hit on every foe: the mage's strength)
  damage *= 1 - (foe.armor || 0) * Math.max(0, 1 - perk(hero, "pierce"));
  if (options.aoe) damage *= (1 + perk(hero, "aoe")) * (foe.traits && foe.traits.includes("bulky") ? 0.5 : 1);
  // (cursed: the hero hits softer)
  if (hero.effects.weak) damage *= WEAK;
  // (a foe on guard: half of the hit blocked - the page shows how much)
  const full = Math.max(1, Math.round(damage));
  damage = foe.defending ? Math.max(1, Math.round(damage * DEFEND)) : full;
  const blocked = full - damage;
  foe.hp = Math.max(0, foe.hp - damage);
  say(run, `${hero.name}${options.verb ? " " + options.verb : " hits"} ${foe.icon} ${foe.name} for ${damage}${crit ? " (crit!)" : ""}${foe.defending ? " (half)" : ""}.`);
  fx(run, blocked > 0 ? { k: "hit", to: foe.id, n: damage, crit, b: blocked } : { k: "hit", to: foe.id, n: damage, crit });
  if (perk(hero, "lifesteal") && !hero.down) healHero(run, hero, damage * perk(hero, "lifesteal"));
  // (spiked: a part of the hit comes back)
  if (foe.traits && foe.traits.includes("spiked") && !hero.down) {
    const back = Math.max(1, Math.round(damage * SPIKES));
    hero.hp = Math.max(0, hero.hp - back);
    fx(run, { k: "hit", to: hero.name, n: back, thorns: true });
    if (hero.hp == 0) {
      hero.down = true;
      hero.effects = {};
      hero.block = 0;
      fx(run, { k: "down", to: hero.name });
      say(run, `${hero.name} is down - the spikes!`);
    }
  }
  if (foe.hp == 0) {
    foe.down = true;
    say(run, `${foe.icon} ${foe.name} is defeated.`);
    fx(run, { k: "down", to: foe.id });
  } else bossPhase(run, foe);
  return damage;
}

// Damage to a hero: smoke, a dodge, armor (diminishing), taunt - then the block takes it
function hurt(run, hero, raw, source, rng = Math.random, foe = null) {
  if (hero.evading) {
    say(run, `${source} misses ${hero.name} in the smoke.`);
    fx(run, { k: "miss", to: hero.name });
    return 0;
  }
  if (rng() * 100 < hero.agi) {
    say(run, `${hero.name} dodges ${source} 🪶.`);
    fx(run, { k: "miss", to: hero.name, dodge: true });
    return 0;
  }
  // (armor: less of a hit the more armor - with diminishing returns: as much armor as the hit halves it)
  let damage = (raw * raw) / (raw + Math.max(0, hero.def));
  if (hero.taunting) damage *= TAUNT;
  damage = Math.max(1, Math.round(damage));
  const blocked = Math.min(hero.block, damage);
  hero.block -= blocked;
  damage -= blocked;
  hero.hp = Math.max(0, hero.hp - damage);
  say(run, `${source} hits ${hero.name} for ${damage}${blocked ? ` (${blocked} blocked)` : ""}.`);
  fx(run, { k: "hit", to: hero.name, n: damage, b: blocked });
  // (thorns: who hits pays)
  const thorns = thornsOf(hero);
  if (foe && thorns && !foe.down) {
    foe.hp = Math.max(0, foe.hp - thorns);
    say(run, `${foe.icon} ${foe.name} takes ${thorns} from ${hero.name}'s thorns 🌵.`);
    fx(run, { k: "hit", to: foe.id, n: thorns, thorns: true });
    if (foe.hp == 0) {
      foe.down = true;
      say(run, `${foe.icon} ${foe.name} is defeated.`);
      fx(run, { k: "down", to: foe.id });
    }
  }
  if (hero.hp == 0) {
    hero.down = true;
    fx(run, { k: "down", to: hero.name });
    hero.effects = {};
    hero.block = 0;
    say(run, `${hero.name} is down!`);
  }
  return damage;
}

// Thorns: the damage back to who hits - a flat part, a share of the armor (the paladin)
function thornsOf(hero) {
  return Math.round(perk(hero, "thorns") + perk(hero, "thornsDef") * hero.def);
}

function healHero(run, hero, amount) {
  const heal = Math.min(hero.maxHp - hero.hp, Math.round(amount));
  hero.hp += heal;
  if (heal > 0 && run.phase == "fight") fx(run, { k: "heal", to: hero.name, n: heal });
  return heal;
}

// Plays a card of a hero's hand: {uid, target (a monster's id), ally (a hero's name)} -> an error or null
const NOT_IN_HAND = "That card isn't in your hand.";
// Answers to a click that came too late - the run went on meanwhile (a double click, a click during the monsters'
// turn): the pages aren't told (nothing went wrong for the player)
const STALE = new Set([NOT_IN_HAND, "Nothing to vote on now.", "Nothing to choose here.", "You chose already.", "Not one of the choices.", "Unknown door.", "You ended your turn.", "No fight now.", "Not now.", "No card to pick.", "Picked already.", "No relic to pick.", "No merchant here.", "Sold already.", "Too late."]);
function play(run, name, input, rng = Math.random) {
  if (run.phase != "fight") return "No fight now.";
  const hero = run.heroes.find((h) => h.name == name);
  if (!hero || hero.down) return "You are down.";
  if (hero.ended) return "You ended your turn.";
  const index = hero.hand.findIndex((c) => c.uid == (input && input.uid));
  if (index < 0) return NOT_IN_HAND;
  const card = cardInfo(hero.hand[index].id);
  if (hero.energy < card.cost) return `${card.name} needs ${card.cost} mana.`;
  const foes = alive(run.monsters);
  const foe = foes.find((m) => m.id == input.target) || null;
  if (card.target == "foe" && !foe) return "Pick a foe for it.";
  const friend = alive(run.heroes).find((h) => h.name == input.ally) || hero;
  const fallen = run.heroes.find((h) => h.down && h.name == input.ally) || run.heroes.find((h) => h.down);
  if (card.target == "fallen" && !fallen) return "Nobody to bring back.";
  hero.energy -= card.cost;
  const [{ id }] = hero.hand.splice(index, 1);
  (card.exhaust || card.mythic ? hero.exhausted : hero.discard).push(id);
  // (mythic: once per run - out of the run's deck)
  if (card.mythic) {
    const at = hero.deck.indexOf(id);
    if (at >= 0) hero.deck.splice(at, 1);
  }
  // (the first attack of the turn: the perks for it)
  hero.firstAttack = card.type == "attack" && !hero.attacked;
  if (card.type == "attack") hero.attacked = true;
  fx(run, { k: "card", by: hero.name, card: id, to: card.target == "foe" ? foe.id : card.target == "ally" ? friend.name : card.target == "fallen" ? fallen.name : null });
  cardEffect(run, hero, id, { foe, foes, friend, fallen }, rng);
  hero.firstAttack = false;
  if (!alive(run.monsters).length) winFight(run, rng);
  return null;
}

function cardEffect(run, hero, id, { foe, foes, friend, fallen }, rng) {
  // (an upgraded card: 40% stronger - the perks: more block, more healing, stronger poison)
  const up = isUpgraded(id) ? UPGRADE : 1;
  const block = (who, amount) => {
    const value = Math.round(amount * up * (1 + perk(hero, "block")));
    who.block += value;
    fx(run, { k: "block", to: who.name, n: value });
    return value;
  };
  const heal = (who, amount) => healHero(run, who, amount * up * (1 + perk(hero, "heal")));
  const venom = up * (1 + perk(hero, "poison"));
  const info = CARDS[baseCard(id)];
  if (info.type != "attack") say(run, `${hero.name} plays ${info.icon} ${info.name}.`);
  for (const fx of info.fx) playFx(run, hero, fx, { foe, friend, fallen, up, venom, block, heal, card: baseCard(id) }, rng);
}

// The texts of cards with a character's numbers (its damage, block, healing) instead of the shares: {id: text}
// - stats: {atk, def, agi, maxHp, perks}; ids: the cards (an upgraded one "id+")
function liveTexts(stats, ids) {
  const texts = {};
  for (const id of new Set(ids)) {
    const card = CARDS[baseCard(id)];
    if (!card) continue;
    const up = isUpgraded(id) ? UPGRADE : 1;
    const p = (key) => (stats.perks && stats.perks[key]) || 0;
    const dmg = (power, fx = {}) => Math.max(1, Math.round((stats.atk * power + (fx.def || 0) * stats.def) * (1 + p("attack")) * (fx.to == "all" ? 1 + p("aoe") : 1) * up));
    const n = {
      dmg,
      block: (fx) => Math.round((fx.block + (fx.def || 0) * stats.def + (fx.atk || 0) * stats.atk + (fx.agi || 0) * stats.agi) * (1 + p("block")) * up),
      heal: (share) => Math.round(stats.maxHp * share * (1 + p("heal")) * up),
      lose: (share) => Math.round(stats.maxHp * share),
    };
    texts[id] = MORE_CARDS.textOf(card.fx, card.mythic ? "mythic" : card.exhaust, n);
  }
  return texts;
}

// A step of a card made of effects (game/rpg_cards.js)
// (the event of the playback - the step below is called fx)
const fxEvent = (run, event) => fx(run, event);

function playFx(run, hero, fx, { foe, friend, fallen, up, venom, block, heal, card }, rng) {
  const foesOf = (to) => {
    const standing = alive(run.monsters);
    if (to == "all") return standing;
    if (to == "random") return standing.length ? [pick(rng, standing)] : [];
    return foe && !foe.down ? [foe] : [];
  };
  const heroesOf = (to) => {
    if (to == "party") return alive(run.heroes);
    if (to == "ally") return [friend];
    if (to == "weakest") return alive(run.heroes).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp).slice(0, 1);
    return [hero];
  };
  if (fx.aura) {
    // (an AURA: its value now - given at the start of each of the next turns)
    const value =
      fx.aura == "guard"
        ? Math.round((fx.block + (fx.def || 0) * hero.def + (fx.atk || 0) * hero.atk + (fx.agi || 0) * hero.agi) * up * (1 + perk(hero, "block")))
        : fx.aura == "regen"
          ? Math.round(hero.maxHp * fx.heal * up * (1 + perk(hero, "heal")))
          : fx.mana;
    for (const one of heroesOf(fx.to)) (one.auras = one.auras || []).push({ kind: fx.aura, value, turns: fx.turns, card });
    return;
  }
  // (a condition - "poison|stun": any of them)
  const state = (m, cond) => cond.split("|").some((one) => (one == "low" ? hero.hp < hero.maxHp / 2 : one == "undead" ? m.undead : !!m.effects[one]));
  if (fx.hit != null) {
    for (let i = 0; i < (fx.times || 1); i++) {
      for (const m of foesOf(fx.to)) {
        // (a mark of death: below the share - gone, not a boss)
        if (fx.execute && m.hp < m.maxHp * fx.execute && m.rank != "boss") {
          m.hp = 0;
          m.down = true;
          say(run, `${hero.name} kills ${m.icon} ${m.name} 💀.`);
          fxEvent(run, { k: "down", to: m.id });
          continue;
        }
        let power = (fx.bonusIf && state(m, fx.bonusIf) ? fx.bonus : fx.hit) + ((fx.def || 0) * hero.def) / Math.max(1, hero.atk);
        // (damage of the block - at least the card's)
        if (fx.fromBlock) power = Math.max(power, hero.block / Math.max(1, hero.atk));
        strike(run, hero, m, power * up, rng, { sure: true, aoe: fx.to == "all" });
      }
    }
  } else if (fx.block != null) {
    const value = (fx.block + (fx.def || 0) * hero.def + (fx.atk || 0) * hero.atk + (fx.agi || 0) * hero.agi) * (fx.low && hero.hp < hero.maxHp / 2 ? fx.low : 1);
    for (const one of heroesOf(fx.to)) block(one, value);
  } else if (fx.heal != null) {
    for (const one of heroesOf(fx.to)) heal(one, hero.maxHp * fx.heal);
    // (the cleric's light: a share of a heal - once a card, whoever it heals, even at full HP - hits a random foe)
    const smite = perk(hero, "healHit");
    const standing = alive(run.monsters);
    if (smite > 0 && standing.length && run.phase == "fight") strike(run, hero, pick(rng, standing), (hero.maxHp * fx.heal * up * (1 + perk(hero, "heal")) * smite) / Math.max(1, hero.atk), rng, { sure: true, verb: "smites" });
  } else if (fx.status) {
    for (const m of foesOf(fx.to)) {
      if (fx.status == "poison") afflict(m, "poison", fx.turns || 3, Math.max(1, Math.round(hero.atk * 0.45 * venom)));
      else if (fx.status == "burn") afflict(m, "burn", fx.turns || 2, Math.max(1, Math.round(hero.atk * 0.3 * up)));
      else if (fx.status == "stun") m.effects.stun = 1;
      else m.effects[fx.status] = fx.turns || 1;
    }
  } else if (fx.might != null) {
    for (const one of heroesOf(fx.to)) one.effects.might = fx.might;
  } else if (fx.draw != null) for (const one of fx.to == "party" ? alive(run.heroes) : [hero]) drawCards(one, fx.draw, rng);
  else if (fx.mana != null) hero.energy += fx.mana;
  else if (fx.lose != null) hero.hp = Math.max(1, hero.hp - Math.round(hero.maxHp * fx.lose));
  else if (fx.evade) hero.evading = true;
  else if (fx.taunt) {
    hero.taunting = true;
    say(run, `${hero.name} taunts the foes 📣.`);
  } else if (fx.revive != null) {
    for (const one of fx.to == "all" ? run.heroes.filter((h) => h.down) : fallen ? [fallen] : []) {
      one.down = false;
      one.hp = Math.max(1, Math.round(one.maxHp * fx.revive));
      one.ended = true;
      say(run, `${hero.name} brings ${one.name} back 🕊️!`);
      fxEvent(run, { k: "heal", to: one.name, n: one.hp });
    }
  } else if (fx.cleanse) {
    for (const one of heroesOf(fx.to)) {
      delete one.effects.poison;
      delete one.effects.burn;
    }
  } else if (fx.extend != null) {
    for (const m of foesOf(fx.to)) if (m.effects.poison) m.effects.poison.turns += fx.extend;
  } else if (fx.amplify) {
    for (const m of foesOf(fx.to)) {
      if (!m.effects.poison) continue;
      m.effects.poison.dmg *= 2;
      m.effects.poison.turns += 3;
    }
  }
}

// A hero ends the turn -> true: every hero has - the monsters' turn
function endTurn(run, name) {
  const hero = run.heroes.find((h) => h.name == name);
  if (run.phase != "fight" || !hero || hero.down) return false;
  hero.ended = true;
  return turnDone(run);
}

// Every hero standing has ended the turn (or is away)
function turnDone(run) {
  return run.phase == "fight" && alive(run.heroes).every((h) => h.ended || h.away);
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
      hurt(run, target, damage * between(rng, 0.9, 1.1), intent.move == "smash" ? source + " 💥" : source, rng, foe);
      break;
    case "poison":
      if (hurt(run, target, damage, source, rng, foe) > 0 && !target.down) {
        afflict(target, "poison", 3, Math.max(1, Math.round(foe.atk * 0.35)));
        say(run, `${target.name} is poisoned ☠️.`);
      }
      break;
    case "steal":
      if (hurt(run, target, damage, source, rng, foe) > 0 && target.potions > 0) {
        target.potions--;
        say(run, `${source} steals a potion from ${target.name} 🫳!`);
      }
      break;
    case "drain": {
      const done = hurt(run, target, damage, source, rng, foe);
      foe.hp = Math.min(foe.maxHp, foe.hp + done);
      break;
    }
    case "burn":
      say(run, `${source} sends a fire wave 🔥!`);
      for (const hero of heroes) {
        if (hurt(run, hero, damage, source, rng, foe) > 0 && !hero.down) afflict(hero, "burn", 2, Math.max(1, Math.round(foe.atk * 0.25)));
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
    case "purge":
      for (const one of alive(run.monsters)) {
        delete one.effects.poison;
        delete one.effects.burn;
      }
      say(run, `${source} purges the poison and the flames ✨.`);
      break;
    case "curse":
      if (hurt(run, target, damage, source, rng, foe) > 0 && !target.down) {
        target.effects.weak = 2;
        say(run, `${target.name} is cursed 🕯️: weaker for 2 turns.`);
      }
      break;
    case "summon": {
      // (its kind of the floors - at most 4 standing)
      const group = MONSTERS[Math.min(MONSTERS.length - 1, foe.summon != null ? foe.summon : Math.floor((run.floor - 1) / 5))];
      const count = Math.max(0, Math.min(2, 4 - alive(run.monsters).length, SUMMON_MAX - (foe.summoned || 0)));
      foe.summoned = (foe.summoned || 0) + count;
      for (let i = 0; i < count; i++) {
        const add = toughen(run, monster(run.floor, run.heroes.length, pick(rng, group), RANKS.normal, 0, rng));
        run.monsters.push(add);
      }
      say(run, `${source} calls for help 📣 - ${count} more!`);
      break;
    }
  }
  // (chill wears off with every move that hurts)
  if (foe.effects.chill && move.power) {
    foe.effects.chill--;
    if (!foe.effects.chill) delete foe.effects.chill;
  }
}

// The monsters' turn: they do what they showed (stunned: nothing), poison and burns tick - then the heroes' next turn
function monsterTurn(run, rng = Math.random) {
  if (run.phase != "fight") return;
  fx(run, { k: "turn", side: "foes" });
  for (const foe of alive(run.monsters)) {
    if (foe.effects.stun) {
      delete foe.effects.stun;
      say(run, `${foe.icon} ${foe.name} is stunned and does nothing.`);
      fx(run, { k: "move", by: foe.id, move: "stunned" });
      continue;
    }
    fx(run, { k: "move", by: foe.id, move: (foe.intent || { move: "attack" }).move });
    monsterMove(run, foe, rng);
    if (!alive(run.heroes).length) break;
  }
  // (a long fight: the monsters grow furious - say it once)
  if (furious(run)) {
    if (run.turn == FURY_TURN) {
      say(run, "The monsters grow furious! 😡");
      fx(run, { k: "phase", by: (alive(run.monsters)[0] || {}).id, text: "Furious!" });
    }
    for (const foe of alive(run.monsters)) foe.fury = (foe.fury || 0) + 1;
  }
  for (const foe of alive(run.monsters)) {
    if (foe.affix != "regen" || foe.hp >= foe.maxHp || furious(run)) continue;
    const heal = Math.min(foe.maxHp - foe.hp, Math.round(foe.maxHp * 0.08));
    foe.hp += heal;
    say(run, `${foe.icon} ${foe.name} regenerates ${heal} 💚.`);
    fx(run, { k: "heal", to: foe.id, n: heal });
  }
  for (const one of [...alive(run.heroes), ...alive(run.monsters)]) {
    const label = one.icon ? `${one.icon} ${one.name}` : one.name;
    for (const kind of ["poison", "burn"]) {
      const effect = one.effects[kind];
      if (!effect || one.down) continue;
      one.hp = Math.max(0, one.hp - effect.dmg);
      say(run, `${label} takes ${effect.dmg} from ${kind == "poison" ? "poison ☠️" : "the burn 🔥"}.`);
      fx(run, { k: "hit", to: one.icon ? one.id : one.name, n: effect.dmg, dot: kind });
      if (--effect.turns <= 0) delete one.effects[kind];
      if (one.icon) bossPhase(run, one);
      if (one.hp == 0) {
        one.down = true;
        fx(run, { k: "down", to: one.icon ? one.id : one.name });
        say(run, `${label} ${one.icon ? "is defeated" : "is down"}!`);
      }
    }
    for (const kind of ["rage", "might", "weak"]) if (one.effects[kind] && --one.effects[kind] <= 0) delete one.effects[kind];
  }
  for (const hero of run.heroes) {
    hero.taunting = hero.evading = false;
    // (the hand stays - only the ones down lose theirs)
    if (hero.down) {
      hero.discard.push(...hero.hand.map((c) => c.id));
      hero.hand = [];
      hero.block = 0;
    }
  }
  if (!alive(run.heroes).length) {
    run.phase = "lost";
    run.pot = 0;
    say(run, "The party is down. Loot lost. 💀");
    fx(run, { k: "defeat" });
    return;
  }
  if (!alive(run.monsters).length) return winFight(run, rng);
  startRound(run, rng);
}

function winFight(run, rng) {
  const room = run.rooms[run.rooms.length - 1];
  const coins = run.tutorial ? 0 : Math.round(entryCost(run.floor) * REWARD[room.kind] * (config.RPG_LOOT / 100) * partyBonus(run.heroes.length));
  run.pot += coins;
  say(run, `Victory! 🪙 ${coins} each for the pot.`);
  fx(run, { k: "victory", coins });
  // (the spoils of the fight - the page lists them: the coins, the card, the relic)
  run.spoils = { room: run.rooms.length, coins, xp: xpFor(room.kind, run.floor) };
  // (the ones down get back up, every state goes, the cards back into the deck - and a new card to pick)
  // (a cleric standing: the fallen rise with more HP)
  const rise = REVIVE + ABILITIES.cleric.rise * (abilityLevel(run, "cleric") || 0);
  for (const hero of run.heroes) {
    hero.effects = {};
    hero.auras = [];
    hero.block = 0;
    hero.taunting = hero.evading = false;
    hero.hand = [];
    hero.draw = [];
    hero.discard = [];
    hero.exhausted = [];
    if (hero.down) {
      hero.down = false;
      hero.hp = Math.max(1, Math.round(hero.maxHp * rise));
      say(run, `${hero.name} gets back up.`);
    }
    hero.reward = rewardFor(hero, rng);
    hero.xp += xpFor(room.kind, run.floor);
    // (a perk: healed after a fight won)
    if (perk(hero, "afterFight")) healHero(run, hero, hero.maxHp * perk(hero, "afterFight"));
    // (a hard fight won: one of three relics)
    if (room.kind == "hard" || room.kind == "boss") hero.relicChoice = relicOffer(hero, rng);
    // (a boss: a piece of epic gear or better too)
    if (room.kind == "boss") {
      let item = makeGear(run.floor, rng, hero.luck, hero.cls);
      for (let i = 0; i < 60 && !["epic", "legendary"].includes(item.rarity); i++) item = makeGear(run.floor, rng, hero.luck, hero.cls);
      (run.loot[hero.name] = run.loot[hero.name] || []).push(item);
      say(run, `${hero.name} takes ${item.icon} ${item.name} from the boss.`);
    }
  }
  room.done = true;
  afterRoom(run, rng);
  if (run.phase == "won") for (const hero of run.heroes) hero.xp += xpFor("floor", run.floor);
}

// For the pages
function runView(run) {
  const effectsOf = (effects) => Object.fromEntries(Object.entries(effects).map(([kind, value]) => [kind, typeof value == "object" ? value.turns : value]));
  return {
    uid: run.uid,
    floor: run.floor,
    phase: run.phase,
    room: run.rooms.length - 1,
    rooms: run.rooms.map((room) => ({ kind: room.kind, done: room.done })),
    // The map: what a room is stays hidden - unless sensed, open (the first, the last) or gone through
    map: (run.map || []).map((row) => row.map((node) => ({ col: node.col, kind: shownKind(node), sensed: node.sensed, visited: node.visited, next: node.next }))),
    at: run.at,
    doors: run.doors.map((door) => ({ row: door.row, index: door.index, kind: shownKind(door) })),
    tutorial: !!run.tutorial,
    sense: senseChance(run),
    rerolls: abilityLevel(run, "mage") == null ? null : run.rerolls == null ? 1 + Math.floor(abilityLevel(run, "mage") / ABILITIES.mage.rerollEvery) : run.rerolls,
    event: run.event && {
      kind: run.event.kind,
      id: run.event.id,
      encounter: run.event.id ? ENCOUNTERS[run.event.id] : null,
      options: optionsOf(run.event),
      lines: run.event.lines,
      results: run.event.results || {},
      shared: run.event.shared || [],
      choices: run.event.choices,
      offers: run.event.offers,
      disarm: run.event.kind == "trap" ? Object.fromEntries(run.heroes.map((h) => [h.name, disarmChance(h)])) : null,
    },
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
      away: !!h.away,
      share: h.share,
      blessed: h.blessed,
      effects: effectsOf(h.effects),
      auras: (h.auras || []).map((aura) => ({ kind: aura.kind, value: aura.value, turns: aura.turns, card: aura.card })),
      hand: h.hand,
      drawCount: h.draw.length,
      discardCount: h.discard.length,
      // (the piles to look at - the draw pile in no order: what comes next stays a secret)
      piles: { draw: [...h.draw].sort(), discard: h.discard, exhausted: h.exhausted },
      deck: h.deck,
      texts: liveTexts(h, [...h.deck, ...h.hand.map((c) => c.id), ...h.draw, ...h.discard, ...h.exhausted]),
      reward: h.reward,
      relics: h.relics,
      relicChoice: h.relicChoice,
      perks: h.perks,
      xp: h.xp,
    })),
    monsters: run.monsters.map((m) => ({
      id: m.id,
      name: m.name,
      icon: m.icon,
      type: m.type,
      hp: m.hp,
      maxHp: m.maxHp,
      atk: m.atk,
      armor: m.armor || 0,
      traits: m.traits || [],
      boss: !!m.phase,
      phased: !!m.phased,
      rank: m.rank,
      undead: m.undead,
      affix: m.affix,
      down: !!m.down,
      effects: effectsOf(m.effects),
      intent: m.down || !m.intent ? null : { move: m.intent.move, target: m.intent.target || null, damage: intentDamage(m, m.intent.move), stunned: !!m.effects.stun },
    })),
    turn: run.turn,
    pot: run.pot,
    fx: run.fx || [],
    spoils: run.spoils || null,
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
    const raw = intentDamage(m, m.intent.move);
    if (move.all || m.intent.target == hero.name) return sum + (raw * raw) / (raw + Math.max(0, hero.def));
    return sum;
  }, 0);
}

// A sensible player (the simulations): every card valued by what it does now - damage the foes still have, block
// against what comes, healing of what is missing, poison and stuns where they count - the best per mana first
function simulatedTurn(run, me, rng) {
  if (me.hp < me.maxHp * 0.3 && me.potions > 0 && me.energy >= POTION_MANA) drink(run, me.name);
  for (let guard = 0; guard < 20 && run.phase == "fight" && !me.ended && !me.down; guard++) {
    const foes = alive(run.monsters);
    if (!foes.length) break;
    const need = Math.max(0, incoming(run, me) - me.block);
    // (the foe to hit: one that can fall now - else the one that hurts most)
    const threat = (m) => (m.intent && !m.effects.stun ? intentDamage(m, m.intent.move) : 0);
    const target = foes.slice().sort((x, y) => x.hp - y.hp)[0];
    const worst = foes.slice().sort((x, y) => threat(y) - threat(x))[0];
    const ally = alive(run.heroes).sort((x, y) => x.hp / x.maxHp - y.hp / y.maxHp)[0] || me;
    const fallen = run.heroes.find((h) => h.down);
    let best = null;
    for (const c of me.hand) {
      const card = cardInfo(c.id);
      if (card.cost > me.energy) continue;
      if (card.target == "fallen" && !fallen) continue;
      const up = isUpgraded(c.id) ? UPGRADE : 1;
      const foe = card.fx.some((f) => f.status == "stun" && !f.to) ? worst : target;
      let value = 0;
      let blocked = 0;
      for (const f of card.fx) {
        const many = f.to == "all" ? foes : [foe];
        // (an AURA: what it gives over its turns - a bit less, it comes later)
        if (f.aura) {
          const party = f.to == "party" ? alive(run.heroes).length : 1;
          const each = f.aura == "guard" ? f.block + (f.def || 0) * me.def + (f.atk || 0) * me.atk + (f.agi || 0) * me.agi : f.aura == "regen" ? me.maxHp * f.heal : me.atk * 0.8 * f.mana;
          value += each * f.turns * party * up * 0.6;
          continue;
        }
        if (f.hit != null) {
          for (const m of many) {
            const cond = f.bonusIf && f.bonusIf.split("|").some((k) => (k == "undead" ? m.undead : k == "low" ? me.hp < me.maxHp / 2 : m.effects[k]));
            const dmg = me.atk * (cond ? f.bonus : f.hit) * (f.times || 1) * up * (1 - (m.armor || 0) * Math.max(0, 1 - perk(me, "pierce")));
            value += Math.min(dmg, m.hp) + (dmg >= m.hp ? threat(m) : 0);
          }
        } else if (f.block != null) {
          const amount = (f.block + (f.def || 0) * me.def + (f.atk || 0) * me.atk + (f.agi || 0) * me.agi) * up;
          value += Math.min(amount, Math.max(0, need - blocked));
          blocked += amount;
        } else if (f.heal != null) value += Math.min(me.maxHp * f.heal * up, ally.maxHp - ally.hp) * (ally.hp < ally.maxHp / 2 ? 1.2 : 0.6) + me.maxHp * f.heal * up * perk(me, "healHit");
        else if (f.status == "poison" || f.status == "burn") value += many.length * me.atk * 0.4 * (f.turns || 2);
        else if (f.status == "stun") value += f.to == "all" ? foes.reduce((sum, m) => sum + threat(m), 0) : threat(foe);
        else if (f.status == "chill") value += (f.to == "all" ? foes.reduce((sum, m) => sum + threat(m), 0) : threat(foe)) * 0.4;
        else if (f.might != null) value += me.atk * 0.3 * f.might;
        else if (f.draw != null) value += me.atk * 0.4 * f.draw;
        else if (f.mana != null) value += me.atk * 0.8 * f.mana;
        else if (f.lose != null) value -= me.maxHp * f.lose * 0.5;
        else if (f.evade) value += need;
        else if (f.taunt) value += run.heroes.length > 1 ? need * 0.5 : 0;
        else if (f.revive != null) value += fallen ? me.maxHp * 2 : 0;
        else if (f.cleanse) value += ally.effects.poison || ally.effects.burn ? me.atk : 0;
        else if (f.extend != null || f.amplify) value += foes.some((m) => m.effects.poison) ? me.atk : 0;
      }
      // (a once-a-run card: kept for a hard fight - an exhausting one a bit less eager)
      if (card.mythic) value *= run.monsters.some((m) => m.rank != "normal") ? 1 : 0.3;
      else if (card.exhaust) value *= 0.85;
      const score = value / Math.max(0.5, card.cost);
      if (value > 0 && (!best || score > best.score)) best = { c, card, foe, score };
    }
    if (!best) break;
    if (play(run, me.name, { uid: best.c.uid, target: best.foe && best.foe.id, ally: best.card.target == "fallen" ? fallen.name : ally.name }, rng)) break;
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
      if (me.relicChoice) pickRelic(run, "sim", me.relicChoice[0]);
      if (run.event && run.event.kind == "rest") choose(run, "sim", me.hp < me.maxHp * 0.7 ? { option: "rest" } : { option: "smith", card: me.deck.findIndex((id) => !isUpgraded(id)) }, rng);
      enterRoom(run, Math.floor(rng() * run.doors.length), rng);
      let turns = 0;
      while (run.phase == "fight" && turns++ < 100) {
        simulatedTurn(run, run.heroes[0], rng);
        if (run.phase == "fight" && (endTurn(run, "sim") || turnDone(run))) monsterTurn(run, rng);
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
  rowsFor,
  DOORS,
  PARTY_MAX,
  BAG_MAX,
  BAG_TOP,
  bagSize,
  bagSlotPrice,
  POTIONS_MAX,
  POTIONS_TOP,
  potionsMax,
  potionSlotPrice,
  deckSlots,
  deckSlotPrice,
  useDeck,
  DECKS_TOP,
  get POTION_PRICE() {
    return potionPrice(1);
  },
  potionPrice,
  BOSS_EVERY,
  STATS,
  STAT_IDS,
  LEVEL_MAX,
  get UPGRADE_MAX() {
    return upgradeCost(LEVEL_MAX - 1);
  },
  SLOTS,
  RARITIES,
  REWARD,
  CLASSES,
  CLASS_IDS,
  MAIN_BONUS,
  get CLASS_PRICE() {
    return config.RPG_CLASS_PRICE;
  },
  charOf,
  unlock,
  classPrice,
  CARDS,
  NEUTRAL_CARDS,
  ENERGY,
  MOVES,
  ROOM_KINDS,
  CARD_RARITIES,
  DECK_MIN,
  DECK_MAX,
  DECK_FLOOR,
  deckLimits,
  PACK_SIZE,
  get PACK_PRICE() {
    return config.RPG_PACK_STANDARD;
  },
  PACKS,
  PACK_IDS,
  packPrice,
  cartPrice,
  addPacks,
  openStored,
  openAll,
  CART_MAX,
  deckMax,
  poolOf,
  cardClass,
  collect,
  deckAdd,
  deckRemove,
  openPack,
  TALENTS,
  TALENT_LEVELS,
  RELICS,
  relicOffer,
  AFFIXES,
  MONSTER_TRAITS,
  MONSTER_TYPES,
  BOSSES,
  UPGRADE,
  cardInfo,
  xpNeed,
  xpFor,
  HERO_LEVEL_MAX,
  FIRST_CLEAR,
  partyBonus,
  PARTY_LOOT,
  gainXp,
  pickTalent,
  talentPerks,
  strengthOf,
  pickRelic,
  choose,
  optionsOf,
  disarmChance,
  ROOM_OPTIONS,
  ENCOUNTERS,
  DECK_LEAST,
  LANES,
  makeMap,
  deckSet,
  deckReady,
  giveRelic,
  merchantPrices,
  MERCHANT_BUY,
  canBuy,
  bought,
  newHero,
  statsOf,
  upgradeCost,
  statPrice,
  ABILITIES,
  abilityLevel,
  abilityOf,
  rerollReward,
  charIndex,
  statFull,
  maxFloor,
  entryCost,
  heroView,
  makeGear,
  canWear,
  starterDeck,
  doorsFor,
  monstersFor,
  newRun,
  vote,
  allVoted,
  tally,
  setAway,
  POTION_MANA,
  POTION_HEAL,
  NOT_IN_HAND,
  STALE,
  get DEATH_COOLDOWN() {
    return config.RPG_DEATH_TIME;
  },
  deadFor,
  die,
  floorCooldown,
  coolFloor,
  lootShare,
  levelGap,
  revivePrice,
  revive,
  abandon,
  turnDone,
  enterRoom,
  drink,
  pickReward,
  planIntents,
  play,
  endTurn,
  monsterTurn,
  runView,
  simulate,
  simulatedTurn,
  FURY_TURN,
  afflict,
  liveTexts,
  thornsOf,
  bossPhase,
};
