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
const PARTY_MAX = 4;
const BAG_MAX = 12;
const POTIONS_MAX = 5;
const POTION_HEAL = 0.4; // of the max HP
const POTION_PRICE = 5000; // with floor 1 open - dearer with every floor the character reached (potionPrice)
const POTION_GROWTH = 1.12;
function potionPrice(floor = 1) {
  return round100(POTION_PRICE * Math.pow(POTION_GROWTH, Math.max(0, floor - 1)));
}
// Bosses: the last room of every n-th floor (0: none yet - they come later)
const BOSS_EVERY = 0;

// The stats: what a level gives
const STATS = {
  hp: { name: "Vitality", icon: "❤️", base: 100, per: 15, about: "+15 max HP" },
  atk: { name: "Strength", icon: "⚔️", base: 10, per: 3, about: "+3 attack" },
  def: { name: "Armor", icon: "🛡️", base: 0, per: 2, about: "+2 defense (and more block)" },
  luck: { name: "Luck", icon: "🍀", base: 5, per: 2, about: "+2% critical hits - sense danger behind the doors, dodge traps, better loot" },
  agi: { name: "Agility", icon: "🪶", base: 0, per: 1.5, about: "+1.5% to dodge an attack" },
};
const STAT_IDS = Object.keys(STATS);
const LEVEL_MAX = 50;
const UPGRADE_BASE = 5000;
const UPGRADE_GROWTH = 1.2;
// The main stat of a class: its levels count this much more
const MAIN_BONUS = 1.5;
const DODGE_MAX = 40;

const ENTRY_BASE = 5000;
const ENTRY_GROWTH = 1.25;
// What a room puts in the pot (per hero, a share of the entry)
const REWARD = { fight: 0.2, hard: 0.38, elite: 0.35, boss: 1, chest: 0.15, trap: 0, rest: 0, shrine: 0, merchant: 0 };

/* ---------- Classes and their cards ---------- */

// main: the stat its levels count 1.5x for; hp, atk: times the stats; def, luck, agi: added;
// deck: the starter deck; cards: the class's cards (the rewards)
const CLASSES = {
  warrior: { name: "Warrior", icon: "⚔️", main: "atk", about: "Strength - heavy blows, cleaves the pack, a war cry for the party", hp: 1.15, atk: 1.15, def: 2, luck: 0, agi: 0, signature: ["bash", "cleave"], cards: ["bash", "cleave", "battlecry", "ironwave", "bloodlust", "bodyslam", "uppercut", "whirlwind", "impervious"], mystic: "titanswrath" },
  paladin: { name: "Paladin", icon: "🔰", main: "def", about: "Armor - draws the attacks, shields the party, judges with his armor", hp: 1.15, atk: 0.9, def: 4, luck: 0, agi: 0, signature: ["taunt", "judgement"], cards: ["taunt", "judgement", "holyshield", "consecrate", "bulwark", "righteous", "aegis", "retribution", "layhands"], mystic: "divine" },
  cleric: { name: "Cleric", icon: "✨", main: "hp", about: "Vitality - heals, smites the undead, brings the fallen back", hp: 1.2, atk: 0.9, def: 1, luck: 0, agi: 0, signature: ["heal", "smite"], cards: ["heal", "smite", "revive", "prayer", "blessing", "holylight", "ward", "purify", "wrath"], mystic: "resurrection" },
  rogue: { name: "Rogue", icon: "🗡️", main: "agi", about: "Agility - dodges, poisons, then strikes where it hurts", hp: 0.95, atk: 1.05, def: 0, luck: 5, agi: 8, signature: ["poisonblade", "backstab"], cards: ["poisonblade", "backstab", "smoke", "envenom", "flurry", "daggers", "shadowstep", "eviscerate", "lethaldose"], mystic: "deathmark" },
  mage: { name: "Mage", icon: "🔮", main: "luck", about: "Luck - spells that crit, fire on all foes, frost that weakens", hp: 0.85, atk: 1.15, def: 0, luck: 8, agi: 0, signature: ["frost", "fireball"], cards: ["frost", "fireball", "barrier", "arcanebolt", "meteor", "spark", "icearmor", "chainlightning", "blizzard"], mystic: "timewarp" },
};
const CLASS_IDS = Object.keys(CLASSES);

// The cards. type: attack / skill; target: "foe" (a monster), "ally" (a hero standing), "fallen" (a hero
// down), "none"; exhaust: gone for the rest of the fight once played
const CARDS = {
  strike: { name: "Strike", icon: "⚔️", cost: 1, type: "attack", target: "foe", text: "Deal 100% damage." },
  defend: { name: "Defend", icon: "🛡️", cost: 1, type: "skill", target: "none", text: "Block 6 + armor." },
  focus: { name: "Focus", icon: "🧠", cost: 0, type: "skill", target: "none", exhaust: true, text: "Draw 2 cards. Exhaust." },
  secondwind: { name: "Second Wind", icon: "🌬️", cost: 1, type: "skill", target: "none", text: "Block 5 + armor, heal 6% HP." },
  adrenaline: { name: "Adrenaline", icon: "💉", cost: 0, type: "skill", target: "none", exhaust: true, text: "+1 mana, draw 1. Exhaust." },
  quickslash: { name: "Quick Slash", icon: "🌀", cost: 0, type: "attack", target: "foe", text: "Deal 50% damage, draw 1." },
  shrug: { name: "Shrug It Off", icon: "🤷", cost: 1, type: "skill", target: "none", text: "Block 8 + armor, draw 1." },
  pommel: { name: "Pommel Strike", icon: "🔨", cost: 1, type: "attack", target: "foe", text: "Deal 90% damage, draw 1." },
  bandage: { name: "Bandage", icon: "🩹", cost: 0, type: "skill", target: "none", exhaust: true, text: "Heal 8% HP. Exhaust." },
  twinstrike: { name: "Twin Strike", icon: "🤺", cost: 1, type: "attack", target: "foe", text: "Deal 60% damage twice." },
  overpower: { name: "Overpower", icon: "🦾", cost: 2, type: "attack", target: "foe", text: "Deal 210% damage." },
  trance: { name: "Battle Trance", icon: "🧘", cost: 0, type: "skill", target: "none", exhaust: true, text: "Draw 3 cards. Exhaust." },
  laststand: { name: "Last Stand", icon: "🧱", cost: 1, type: "skill", target: "none", text: "Block 6 + armor - below half HP: three times as much." },
  rally: { name: "Rally", icon: "🚩", cost: 1, type: "skill", target: "none", text: "Every hero blocks 5 and draws 1 card." },
  // Warrior
  bash: { name: "Heavy Blow", icon: "💫", cost: 2, type: "attack", target: "foe", text: "Deal 110% damage and stun: it loses its next move." },
  cleave: { name: "Cleave", icon: "🪓", cost: 1, type: "attack", target: "none", text: "Deal 70% damage to every foe." },
  battlecry: { name: "War Cry", icon: "📯", cost: 1, type: "skill", target: "none", exhaust: true, text: "The party deals 30% more damage for 2 turns. Exhaust." },
  ironwave: { name: "Iron Wave", icon: "🌊", cost: 1, type: "attack", target: "foe", text: "Deal 70% damage, block 4 + half the armor." },
  bodyslam: { name: "Body Slam", icon: "🤼", cost: 1, type: "attack", target: "foe", text: "Deal damage equal to your block (at least 50%)." },
  uppercut: { name: "Uppercut", icon: "👊", cost: 2, type: "attack", target: "foe", text: "Deal 100% damage, stun and chill it." },
  whirlwind: { name: "Whirlwind", icon: "🌪️", cost: 2, type: "attack", target: "none", text: "Deal 110% damage to every foe." },
  impervious: { name: "Impervious", icon: "🗿", cost: 2, type: "skill", target: "none", exhaust: true, text: "Block 25 + twice the armor. Exhaust." },
  bloodlust: { name: "Bloodlust", icon: "🩸", cost: 0, type: "skill", target: "none", exhaust: true, text: "Lose 8% HP, +2 mana. Exhaust." },
  // Paladin
  taunt: { name: "Taunt", icon: "📣", cost: 1, type: "skill", target: "none", text: "Every foe attacks you this turn - you take 30% less. Block 4 + armor." },
  judgement: { name: "Judgement", icon: "⚖️", cost: 1, type: "attack", target: "foe", text: "Deal attack + armor as damage. Never misses." },
  holyshield: { name: "Holy Shield", icon: "🛡️", cost: 2, type: "skill", target: "none", text: "Every hero blocks 5 + your armor." },
  consecrate: { name: "Consecrate", icon: "🕯️", cost: 2, type: "attack", target: "none", text: "Deal 50% damage to every foe, the party heals 5% HP." },
  righteous: { name: "Righteous Blow", icon: "🔆", cost: 2, type: "attack", target: "foe", text: "Deal 160% damage, heal 5% HP." },
  aegis: { name: "Aegis", icon: "🪬", cost: 1, type: "skill", target: "ally", text: "An ally blocks 12 + your armor." },
  retribution: { name: "Retribution", icon: "⚜️", cost: 1, type: "attack", target: "none", text: "Deal 70% damage to every foe, block 4 + armor." },
  layhands: { name: "Lay on Hands", icon: "🤲", cost: 2, type: "skill", target: "ally", exhaust: true, text: "Heal an ally 45% of its max HP. Exhaust." },
  bulwark: { name: "Bulwark", icon: "🏰", cost: 1, type: "skill", target: "none", text: "Block 10 + twice the armor." },
  // Cleric
  heal: { name: "Heal", icon: "💚", cost: 1, type: "skill", target: "ally", text: "Heal an ally 25% of its max HP." },
  smite: { name: "Smite", icon: "🌟", cost: 1, type: "attack", target: "foe", text: "Deal 120% damage - 250% against the undead." },
  revive: { name: "Revive", icon: "🕊️", cost: 2, type: "skill", target: "fallen", exhaust: true, text: "A fallen ally stands up with 40% HP. Exhaust." },
  prayer: { name: "Prayer", icon: "🙏", cost: 2, type: "skill", target: "none", text: "The whole party heals 12% HP." },
  holylight: { name: "Holy Light", icon: "🕯️", cost: 1, type: "attack", target: "foe", text: "Deal 90% damage, the weakest hero heals 8%." },
  ward: { name: "Ward", icon: "🔰", cost: 1, type: "skill", target: "none", text: "Every hero blocks 4 + your armor." },
  purify: { name: "Purify", icon: "💧", cost: 1, type: "skill", target: "ally", text: "An ally loses poison and burns, heals 12% HP." },
  wrath: { name: "Divine Wrath", icon: "🌩️", cost: 2, type: "attack", target: "none", text: "Deal 110% damage to every foe - 250% against the undead." },
  blessing: { name: "Blessing", icon: "🌞", cost: 1, type: "skill", target: "ally", text: "An ally deals 30% more damage for 2 turns and blocks 5." },
  // Rogue
  poisonblade: { name: "Poison Blade", icon: "☠️", cost: 1, type: "attack", target: "foe", text: "Deal 60% damage, poison it for 3 turns." },
  backstab: { name: "Backstab", icon: "🔪", cost: 1, type: "attack", target: "foe", text: "Deal 120% damage - 300% on a poisoned or stunned foe." },
  smoke: { name: "Smoke Bomb", icon: "💨", cost: 1, type: "skill", target: "none", text: "Nothing hits you this turn." },
  envenom: { name: "Envenom", icon: "🧪", cost: 1, type: "skill", target: "none", text: "Poison every foe for 2 turns." },
  daggers: { name: "Throwing Daggers", icon: "🗡️", cost: 1, type: "attack", target: "foe", text: "Deal 50% damage twice - poisoned: 80%." },
  shadowstep: { name: "Shadow Step", icon: "👤", cost: 1, type: "skill", target: "none", text: "Block 5 + your dodge / 2, draw 1." },
  eviscerate: { name: "Eviscerate", icon: "💢", cost: 2, type: "attack", target: "foe", text: "Deal 180% damage - a poisoned foe stays poisoned 2 turns longer." },
  lethaldose: { name: "Lethal Dose", icon: "⚗️", cost: 1, type: "skill", target: "none", exhaust: true, text: "The poison on every foe: twice as strong, 3 turns longer. Exhaust." },
  flurry: { name: "Flurry", icon: "✴️", cost: 1, type: "attack", target: "none", text: "Deal 40% damage three times to random foes." },
  // Mage
  frost: { name: "Frost Bolt", icon: "❄️", cost: 1, type: "attack", target: "foe", text: "Deal 80% damage and chill: its next 2 moves do half damage." },
  fireball: { name: "Fireball", icon: "🔥", cost: 2, type: "attack", target: "none", text: "Deal 70% damage to every foe and burn them for 2 turns." },
  barrier: { name: "Barrier", icon: "🔮", cost: 1, type: "skill", target: "ally", text: "An ally blocks 8 + 60% of your attack." },
  arcanebolt: { name: "Arcane Bolt", icon: "✨", cost: 1, type: "attack", target: "foe", text: "Deal 150% damage." },
  spark: { name: "Spark", icon: "✴️", cost: 0, type: "attack", target: "foe", text: "Deal 60% damage." },
  icearmor: { name: "Ice Armor", icon: "🧊", cost: 1, type: "skill", target: "none", text: "Block 7 + 40% of your attack, chill a random foe." },
  chainlightning: { name: "Chain Lightning", icon: "⚡", cost: 2, type: "attack", target: "none", text: "Deal 90% damage to every foe, stun one of them." },
  blizzard: { name: "Blizzard", icon: "🌨️", cost: 2, type: "attack", target: "none", text: "Deal 80% damage to every foe and chill them all." },
  meteor: { name: "Meteor", icon: "☄️", cost: 3, type: "attack", target: "none", text: "Deal 160% damage to every foe." },
  // Mystic: once per run - gone from the deck for the rest of the run once played (only in booster packs)
  titanswrath: { name: "Titan's Wrath", icon: "🌋", cost: 2, type: "attack", target: "none", mystic: true, text: "Deal 350% damage to every foe. Mystic." },
  divine: { name: "Divine Intervention", icon: "👼", cost: 1, type: "skill", target: "none", mystic: true, text: "Every hero blocks 30 + armor and heals 30% HP. Mystic." },
  resurrection: { name: "Resurrection", icon: "🌅", cost: 2, type: "skill", target: "none", mystic: true, text: "Every fallen hero stands up with 60% HP, the party heals 25%. Mystic." },
  deathmark: { name: "Death Mark", icon: "💀", cost: 1, type: "attack", target: "foe", mystic: true, text: "A foe below half HP dies (not a boss) - else 400% damage. Mystic." },
  timewarp: { name: "Time Warp", icon: "⏳", cost: 0, type: "skill", target: "none", mystic: true, text: "+4 mana, draw 4 cards. Mystic." },
};

// How rare a card is (booster packs, rewards): basic (the starter deck), common, rare, epic, mystic
const CARD_RARITY = {
  strike: "basic",
  defend: "basic",
  focus: "common",
  secondwind: "common",
  quickslash: "common",
  shrug: "common",
  pommel: "common",
  bandage: "common",
  twinstrike: "common",
  overpower: "epic",
  trance: "rare",
  laststand: "rare",
  rally: "rare",
  bodyslam: "common",
  uppercut: "common",
  whirlwind: "rare",
  impervious: "epic",
  righteous: "common",
  aegis: "common",
  retribution: "rare",
  layhands: "epic",
  holylight: "common",
  ward: "common",
  purify: "rare",
  wrath: "epic",
  daggers: "common",
  shadowstep: "common",
  eviscerate: "rare",
  lethaldose: "epic",
  spark: "common",
  icearmor: "common",
  chainlightning: "rare",
  blizzard: "epic",
  adrenaline: "rare",
  bash: "common",
  cleave: "common",
  ironwave: "common",
  battlecry: "rare",
  bloodlust: "epic",
  taunt: "common",
  judgement: "common",
  bulwark: "common",
  holyshield: "rare",
  consecrate: "rare",
  heal: "common",
  smite: "common",
  prayer: "rare",
  blessing: "rare",
  revive: "epic",
  poisonblade: "common",
  backstab: "common",
  flurry: "common",
  smoke: "rare",
  envenom: "rare",
  frost: "common",
  barrier: "common",
  arcanebolt: "common",
  fireball: "rare",
  meteor: "epic",
  titanswrath: "mystic",
  divine: "mystic",
  resurrection: "mystic",
  deathmark: "mystic",
  timewarp: "mystic",
};
// A card's rarity: its weight in packs and rewards, how many of it a collection holds, what a spare one sells for
const CARD_RARITIES = {
  basic: { name: "Basic", weight: 0, copies: 4, value: 0 },
  common: { name: "Common", weight: 64, copies: 3, value: 500 },
  rare: { name: "Rare", weight: 26, copies: 2, value: 1000 },
  epic: { name: "Epic", weight: 8, copies: 2, value: 2500 },
  legendary: { name: "Legendary", weight: 3, copies: 1, value: 5000 },
  mystic: { name: "Mystic", weight: 1, copies: 1, value: 10000 },
};
for (const [id, rarity] of Object.entries(CARD_RARITY)) CARDS[id].rarity = rarity;
// The larger part of the base set: cards made of effects (game/rpg_cards.js)
const MORE_CARDS = require("./rpg_cards");
Object.assign(CARDS, MORE_CARDS.cards);
for (const [cls, ids] of Object.entries(MORE_CARDS.classCards)) CLASSES[cls].cards.push(...ids);
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
  standard: { name: "Base Set Pack", icon: "🎴", about: "The classic: 5 cards, the last one rare or better.", price: 10000, size: 5, better: 1, least: "rare", boost: {} },
  premium: { name: "Hero Pack", icon: "💎", about: "5 cards - the last two rare or better, epics and legendaries twice as often.", price: 25000, size: 5, better: 2, least: "rare", boost: { epic: 2, legendary: 2, mystic: 2 } },
  mythic: { name: "Mythic Pack", icon: "🌟", about: "3 cards - one epic or better for sure, legendaries four, mystics five times as often.", price: 50000, size: 3, better: 1, least: "epic", boost: { epic: 3, legendary: 4, mystic: 5 } },
};
const PACK_IDS = Object.keys(PACKS);
const PACK_BUNDLE = 3; // three packs at once ...
const BUNDLE_OFF = 0.1; // ... 10% off
const PACK_SIZE = PACKS.standard.size;
const PACK_PRICE = PACKS.standard.price;
const RARITY_RANK = ["basic", "common", "rare", "epic", "legendary", "mystic"];

const CART_MAX = 50; // packs of a kind in one cart

// The price of packs of a kind: PACK_BUNDLE or more at once - 10% off
function packPrice(id, count = 1) {
  const pack = PACKS[id];
  if (!pack) return null;
  return count >= PACK_BUNDLE ? Math.round((pack.price * count * (1 - BUNDLE_OFF)) / 100) * 100 : pack.price * count;
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
      ["🗡️", "Dagger", { atk: 0.7, agi: 1.1 }],
      ["🤺", "Rapier", { atk: 0.85, agi: 1 }],
      ["⚔️", "Sword", { atk: 1, agi: 0.6 }],
      ["🔱", "Trident", { atk: 1.1, agi: 0.5 }],
      ["🏹", "Bow", { atk: 0.9, agi: 0.8, luck: 0.3 }],
      ["🪄", "Wand", { atk: 0.8, agi: 0.4, luck: 0.6 }],
      ["🪓", "Axe", { atk: 1.3, agi: 0.3 }],
      ["🏏", "Mace", { atk: 1.2, agi: 0.25, def: 0.3 }],
      ["🔨", "Warhammer", { atk: 1.5, agi: 0.15 }],
    ],
  },
  armor: {
    name: "Armor",
    kinds: [
      ["🥋", "Robe", { def: 0.5, hp: 1, agi: 0.5 }],
      ["🧣", "Cloak", { def: 0.4, hp: 0.7, agi: 0.8, luck: 0.3 }],
      ["👢", "Boots", { def: 0.5, hp: 0.5, agi: 1 }],
      ["🦺", "Vest", { def: 0.8, hp: 0.9, agi: 0.3 }],
      ["🧤", "Gauntlets", { def: 0.7, hp: 0.5, atk: 0.3 }],
      ["🪖", "Helm", { def: 0.9, hp: 0.8 }],
      ["🧥", "Mail", { def: 1.1, hp: 1.1 }],
      ["🛡️", "Shield", { def: 1.4, hp: 0.6 }],
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
// A bigger party: every monster has this much more HP and attack per hero after the first - and there are more of
// them (a party is no easier than going alone)
const PARTY_HP = 1.0;
const PARTY_ATK = 0.15;

/* ---------- Progression: hero levels, talents, relics, card upgrades ---------- */

// Perks: what talents and relics give (added up per hero): startBlock (block at the start of a fight), firstMana
// (mana on the first turn), draw (cards a turn), attack (more damage, share), firstStrike (the first attack of a
// turn, share), lowHp (damage below half HP, share), crit (critical chance, %), lifesteal (of attack damage),
// thorns (damage back when hit), block (more block, share), heal (more healing, share), afterFight (healed after a
// fight won, share of max HP), poison (stronger poison, share), maxHp (share), agi (dodge, %)
const PERK_KEYS = ["startBlock", "firstMana", "draw", "attack", "firstStrike", "lowHp", "crit", "lifesteal", "thorns", "block", "heal", "afterFight", "poison", "maxHp", "agi"];

// Talents: every class at hero level 3, 6 and 10 - one of two
const TALENT_LEVELS = [3, 6, 10];
const TALENTS = {
  warrior: [
    [{ id: "ironskin", name: "Iron Skin", icon: "🪨", text: "Start every fight with 8 block.", perks: { startBlock: 8 } }, { id: "rhythm", name: "Battle Rhythm", icon: "🥁", text: "Your first attack each turn deals 50% more.", perks: { firstStrike: 0.5 } }],
    [{ id: "berserk", name: "Berserker", icon: "😤", text: "35% more damage below half HP.", perks: { lowHp: 0.35 } }, { id: "recovery", name: "Recovery", icon: "🩹", text: "Heal 12% after every fight won.", perks: { afterFight: 0.12 } }],
    [{ id: "warlord", name: "Warlord", icon: "👑", text: "+1 mana on the first turn of every fight.", perks: { firstMana: 1 } }, { id: "bloodthirst", name: "Bloodthirst", icon: "🩸", text: "Heal 15% of the damage of your attacks.", perks: { lifesteal: 0.15 } }],
  ],
  paladin: [
    [{ id: "bastion", name: "Bastion", icon: "🏰", text: "30% more block from your cards.", perks: { block: 0.3 } }, { id: "aegis", name: "Aegis", icon: "🛡️", text: "Start every fight with 10 block.", perks: { startBlock: 10 } }],
    [{ id: "spikes", name: "Spiked Armor", icon: "🌵", text: "Who hits you takes 6 damage.", perks: { thorns: 6 } }, { id: "faith", name: "Faith", icon: "🙏", text: "Heal 15% after every fight won.", perks: { afterFight: 0.15 } }],
    [{ id: "crusader", name: "Crusader", icon: "⚔️", text: "25% more damage.", perks: { attack: 0.25 } }, { id: "vigil", name: "Vigil", icon: "❤️", text: "+20% max HP.", perks: { maxHp: 0.2 } }],
  ],
  cleric: [
    [{ id: "mercy", name: "Mercy", icon: "💚", text: "40% more healing.", perks: { heal: 0.4 } }, { id: "vital", name: "Vitality", icon: "❤️", text: "+15% max HP.", perks: { maxHp: 0.15 } }],
    [{ id: "zeal", name: "Zeal", icon: "🔥", text: "Your first attack each turn deals 50% more.", perks: { firstStrike: 0.5 } }, { id: "sanctuary", name: "Sanctuary", icon: "⛪", text: "Start every fight with 8 block.", perks: { startBlock: 8 } }],
    [{ id: "miracle", name: "Miracle", icon: "✨", text: "+1 mana on the first turn of every fight.", perks: { firstMana: 1 } }, { id: "halo", name: "Halo", icon: "😇", text: "Heal 20% after every fight won.", perks: { afterFight: 0.2 } }],
  ],
  rogue: [
    [{ id: "venom", name: "Venom", icon: "🐍", text: "Your poison is 60% stronger.", perks: { poison: 0.6 } }, { id: "quick", name: "Quick Hands", icon: "🤹", text: "Draw 1 more card every turn.", perks: { draw: 1 } }],
    [{ id: "assassin", name: "Assassin", icon: "🗡️", text: "Your first attack each turn deals 60% more.", perks: { firstStrike: 0.6 } }, { id: "evasion", name: "Evasion", icon: "🪶", text: "+10% to dodge an attack.", perks: { agi: 10 } }],
    [{ id: "lethal", name: "Lethal", icon: "🎯", text: "+15% critical hits.", perks: { crit: 15 } }, { id: "leech", name: "Leech", icon: "🦇", text: "Heal 12% of the damage of your attacks.", perks: { lifesteal: 0.12 } }],
  ],
  mage: [
    [{ id: "insight", name: "Insight", icon: "📖", text: "Draw 1 more card every turn.", perks: { draw: 1 } }, { id: "arcane", name: "Arcane Power", icon: "🔮", text: "20% more damage.", perks: { attack: 0.2 } }],
    [{ id: "fortune", name: "Fortune", icon: "🍀", text: "+15% critical hits.", perks: { crit: 15 } }, { id: "wellspring", name: "Wellspring", icon: "💧", text: "+1 mana on the first turn of every fight.", perks: { firstMana: 1 } }],
    [{ id: "archmage", name: "Archmage", icon: "🧙", text: "30% more damage.", perks: { attack: 0.3 } }, { id: "ward", name: "Ward", icon: "🔰", text: "Start every fight with 10 block.", perks: { startBlock: 10 } }],
  ],
};

// Relics: for one run - a hard fight won gives a choice of three, chests sometimes one, the merchant sells one
const RELICS = {
  vampfang: { name: "Vampire Fang", icon: "🦷", text: "Heal 10% of the damage of your attacks.", perks: { lifesteal: 0.1 } },
  whetstone: { name: "Whetstone", icon: "🪨", text: "15% more damage.", perks: { attack: 0.15 } },
  buckle: { name: "Iron Buckle", icon: "🔩", text: "Start every fight with 6 block.", perks: { startBlock: 6 } },
  crystal: { name: "Mana Crystal", icon: "💎", text: "+1 mana on the first turn of every fight.", perks: { firstMana: 1 } },
  tome: { name: "Ancient Tome", icon: "📜", text: "Draw 1 more card every turn.", perks: { draw: 1 } },
  thornmail: { name: "Thorn Mail", icon: "🌵", text: "Who hits you takes 4 damage.", perks: { thorns: 4 } },
  heartstone: { name: "Heart Stone", icon: "❤️‍🔥", text: "+15% max HP (and healed by it).", perks: { maxHp: 0.15 } },
  clover: { name: "Four-Leaf Clover", icon: "🍀", text: "+10% critical hits.", perks: { crit: 10 } },
  salve: { name: "Mending Salve", icon: "🧴", text: "Heal 10% after every fight won.", perks: { afterFight: 0.1 } },
  helm: { name: "Berserker Helm", icon: "🪖", text: "30% more damage below half HP.", perks: { lowHp: 0.3 } },
  vial: { name: "Venom Vial", icon: "🧪", text: "Your poison is 50% stronger.", perks: { poison: 0.5 } },
  symbol: { name: "Holy Symbol", icon: "✝️", text: "30% more healing.", perks: { heal: 0.3 } },
  sigil: { name: "Shield Sigil", icon: "🔰", text: "25% more block from your cards.", perks: { block: 0.25 } },
  banner: { name: "War Banner", icon: "🚩", text: "Your first attack each turn deals 40% more.", perks: { firstStrike: 0.4 } },
};
const RELIC_IDS = Object.keys(RELICS);

// The traits of an elite: one of them
const AFFIXES = {
  armored: { name: "Armored", icon: "🛡️", text: "Takes 30% less damage." },
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
function xpFor(kind, floor) {
  return Math.round((XP[kind] || 0) * (1 + (floor - 1) * 0.35));
}

const round100 = (value) => Math.max(100, Math.round(value / 100) * 100);
const between = (rng, low, high) => low + rng() * (high - low);
const pick = (rng, list) => list[Math.floor(rng() * list.length)];

/* ---------- The hero ---------- */

// A class (a character) bought after the first one (the first is free)
const CLASS_PRICE = 1000000;

// A player's hero: one character per class unlocked (its own levels, gear worn, floors) - the bag, the potions
// are shared. cls: the character played now (null: none picked yet - the first is free)
function newHero(cls = null) {
  const hero = { cls: null, unlocked: [], chars: {}, bag: [], potions: 2, packs: {} };
  if (cls) unlock(hero, cls);
  return hero;
}

function newChar() {
  return { levels: { hp: 0, atk: 0, def: 0, luck: 0, agi: 0 }, gear: { weapon: null, armor: null, charm: null }, deepest: 0, runs: 0, cleared: 0, level: 1, xp: 0, points: 0, talents: [] };
}

// A character of the hero (the one played now, or of a class)
function charOf(hero, cls = hero.cls) {
  if (!cls) return newChar();
  if (!hero.chars[cls]) hero.chars[cls] = newChar();
  const char = hero.chars[cls];
  // (the cards: the starter deck - its cards the first of the collection)
  if (!char.deck) {
    char.deck = starterDeck(cls);
    char.collection = {};
    for (const id of char.deck) char.collection[id] = (char.collection[id] || 0) + 1;
  }
  return char;
}

/* ---------- The collection and the deck (built between the runs, like Hearthstone) ---------- */

// The cards a class can own: its own (and its mystic one), the neutral ones, the basic ones
function poolOf(cls) {
  const c = CLASSES[cls] || CLASSES.warrior;
  return ["strike", "defend", ...c.cards, c.mystic, ...NEUTRAL_CARDS];
}

// A card into the collection -> true, or false: it holds all the copies of it already
function collect(char, id) {
  const max = CARD_RARITIES[CARDS[id].rarity].copies;
  if ((char.collection[id] || 0) >= max) return false;
  char.collection[id] = (char.collection[id] || 0) + 1;
  return true;
}

// A card of the collection into the deck -> an error or null
function deckAdd(hero, id) {
  const char = charOf(hero);
  if (!CARDS[id] || !poolOf(hero.cls).includes(id)) return "Not a card of your class.";
  const inDeck = char.deck.filter((one) => one == id).length;
  if (inDeck >= (char.collection[id] || 0)) return "You don't own more of it - booster packs bring more cards.";
  const { max } = deckLimits(hero);
  if (char.deck.length >= max) return `At most ${max} cards (a charm may make room for more).`;
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
  if (ids.length > max) return `At most ${max} cards (a charm may make room for more).`;
  const pool = poolOf(hero.cls);
  const counts = {};
  for (const id of ids) {
    if (!CARDS[id] || !pool.includes(id)) return "Not a card of your class.";
    counts[id] = (counts[id] || 0) + 1;
    if (counts[id] > (char.collection[id] || 0)) return `You don't own that many of ${CARDS[id].name}.`;
  }
  char.deck = [...ids];
  return null;
}

// The deck may go down: as many cards as the limits allow (DECK_MIN to DECK_MAX - the charm's) -> an error or null
function deckReady(hero) {
  const n = charOf(hero).deck.length;
  const { min, max } = deckLimits(hero);
  if (n < min) return `Your deck needs at least ${min} cards (it has ${n}) - build it in the Deck tab.`;
  if (n > max) return `Your deck holds at most ${max} cards (it has ${n}) - take some out in the Deck tab.`;
  return null;
}

// A booster pack opened: its cards of the class (the last ones of a rarity at least) -> [{id, fresh, coins}] -
// a card the collection holds all copies of already is sold (its coins: the server pays them)
function openPack(hero, rng = Math.random, packId = "standard") {
  const char = charOf(hero);
  const pack = PACKS[packId] || PACKS.standard;
  const pool = poolOf(hero.cls).filter((id) => CARDS[id].rarity != "basic");
  const cards = [];
  for (let i = 0; i < pack.size; i++) {
    const better = i >= pack.size - pack.better;
    const least = RARITY_RANK.indexOf(pack.least);
    const choices = pool.filter((id) => !better || RARITY_RANK.indexOf(CARDS[id].rarity) >= least).map((id) => [id, CARD_RARITIES[CARDS[id].rarity].weight * (pack.boost[CARDS[id].rarity] || 1)]);
    const id = weighted(rng, choices);
    const fresh = collect(char, id);
    cards.push({ id, fresh, coins: fresh ? 0 : CARD_RARITIES[CARDS[id].rarity].value });
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
  return hero.unlocked.length ? CLASS_PRICE : 0;
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
  if (char.level < TALENT_LEVELS[tier]) return `Opens at hero level ${TALENT_LEVELS[tier]}.`;
  if (char.talents[tier]) return "Picked already.";
  if (!options.some((t) => t.id == id)) return "Unknown talent.";
  char.talents[tier] = id;
  return null;
}

// The perks of a character's talents
function talentPerks(hero, cls = hero.cls) {
  const char = charOf(hero, cls);
  const perks = {};
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
function statsOf(hero, clsId = hero.cls) {
  const cls = CLASSES[clsId] || CLASSES.warrior;
  const char = charOf(hero, clsId || "warrior");
  const value = (id) => STATS[id].base + STATS[id].per * (char.levels[id] || 0) * (cls.main == id ? MAIN_BONUS : 1);
  const gear = Object.values(char.gear).filter(Boolean);
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

// The highest floor the character played now may enter
function maxFloor(hero) {
  return Math.min(FLOORS, charOf(hero).deepest + 1);
}

function entryCost(floor) {
  return round100(ENTRY_BASE * Math.pow(ENTRY_GROWTH, floor - 1));
}

// For the page: the hero - the character played now, the others in short
function heroView(hero) {
  const char = charOf(hero);
  return {
    cls: hero.cls,
    unlocked: hero.unlocked,
    classPrice: classPrice(hero),
    chars: Object.fromEntries(hero.unlocked.map((id) => [id, { level: Object.values(charOf(hero, id).levels).reduce((a, b) => a + b, 0), deepest: charOf(hero, id).deepest }])),
    levels: { ...newChar().levels, ...char.levels },
    stats: statsOf(hero),
    upgrades: Object.fromEntries(STAT_IDS.map((id) => [id, upgradeCost(char.levels[id] || 0)])),
    gear: char.gear,
    bag: hero.bag,
    potions: hero.potions,
    deepest: char.deepest,
    maxFloor: maxFloor(hero),
    runs: char.runs,
    cleared: char.cleared,
    deck: char.deck,
    collection: char.collection,
    packs: hero.packs || {},
    potionPrice: potionPrice(maxFloor(hero)),
    deckMax: deckLimits(hero).max,
    deckMin: deckLimits(hero).min,
    pool: hero.cls ? poolOf(hero.cls) : [],
    level: char.level,
    xp: char.xp,
    xpNeed: xpNeed(char.level),
    points: char.points,
    talents: char.talents,
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
  const [icon, kind, mix] = pick(rng, SLOTS[slot].kinds);
  const material = MATERIALS[Math.min(MATERIALS.length - 1, Math.floor((floor - 1) / 5))];
  const base = 2 + floor * 1.2;
  const item = { id: "g" + Date.now().toString(36) + (++gearCount).toString(36), slot, rarity: rarity.id, name: material + " " + kind, icon, floor };
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

/* ---------- The map of a floor (like Slay the Spire): rows of rooms, paths between them ---------- */

const ROOM_KINDS = {
  fight: { name: "Fight", icon: "⚔️", about: "Monsters - loot for the pot" },
  hard: { name: "Hard fight", icon: "☠️", about: "More and stronger monsters - almost double the loot and a relic" },
  elite: { name: "The guarded gate", icon: "👑", about: "The guard of the floor - beat it to clear the floor" },
  boss: { name: "Boss", icon: "💀", about: "The master of the floor" },
  chest: { name: "Treasure", icon: "🎁", about: "Coins for the pot - gear, maybe a relic" },
  trap: { name: "Trap", icon: "🪤", about: "Disarm it (luck) or sneak past" },
  rest: { name: "Camp fire", icon: "🔥", about: "Rest (heal) or smith (upgrade a card)" },
  shrine: { name: "Shrine", icon: "⛩️", about: "Blood for power - or walk on" },
  merchant: { name: "Merchant", icon: "🧳", about: "Cards, relics, potions - and he takes a card out of your deck" },
  event: { name: "Encounter", icon: "📜", about: "Something strange - a choice to make" },
};
// What waits in a room of the map (weights) - mostly fights
const DOOR_POOL = { fight: 10, hard: 3.5, trap: 0.4, chest: 0.6, rest: 0.5, shrine: 0.2, merchant: 0.3, event: 0.6 };
const LANES = 4; // the columns of the map
// What a room of the map is - hidden; the party senses it (sees its kind) that often: SENSE_BASE + SENSE x luck %
const SENSE_BASE = 20;
const SENSE = 1.5;
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

// The map of a floor: ROOMS rows - the first a fight, the last the guarded gate, between them 2 to 4 rooms a row;
// every room leads to one or more of the next row (the paths never cross). A room's kind is hidden - sensed
// (shown) at SENSE_BASE + SENSE x luck %
function makeMap(run, rng = Math.random) {
  const chance = senseChance(run);
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
  return Math.min(SENSE_MAX, Math.round(SENSE_BASE + SENSE * Math.max(0, ...alive(run.heroes).map((h) => h.luck))));
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

const RANKS = {
  normal: { id: "normal", prefix: "", hp: 1, atk: 1 },
  hard: { id: "normal", prefix: "", hp: 1.35, atk: 1.15 },
  elite: { id: "elite", prefix: "Elite ", hp: 2.4, atk: 1.3 },
  // (the bosses come later - for now a much stronger one of the floor's monsters)
  boss: { id: "boss", prefix: "Boss ", hp: 5, atk: 1.6 },
};

function monster(floor, size, kind, rank) {
  const hp = MONSTER_HP * Math.pow(MONSTER_HP_GROWTH, floor - 1) * kind.hp * (1 + PARTY_HP * (size - 1)) * rank.hp;
  const atk = MONSTER_ATK * Math.pow(MONSTER_ATK_GROWTH, floor - 1) * kind.atk * rank.atk * (1 + PARTY_ATK * (size - 1));
  const max = Math.max(1, Math.round(hp));
  // (an elite also smashes)
  const moves = rank.id != "normal" && !kind.moves.includes("smash") ? [...kind.moves, "smash"] : kind.moves;
  const foe = { id: "m" + ++monsterCount, name: rank.prefix + kind.name, icon: kind.icon, hp: max, maxHp: max, atk: Math.max(1, Math.round(atk)), dodge: kind.dodge || 0, undead: !!kind.undead, moves, rank: rank.id, effects: {}, intent: null, affix: null };
  // (an elite has a trait from floor 3 on: armored, enraged or regenerating)
  if ((rank.id == "elite" && floor >= 3) || rank.id == "boss") {
    foe.affix = affixRoll();
    foe.name = AFFIXES[foe.affix].name + " " + foe.name;
    if (foe.affix == "enraged") foe.atk = Math.round(foe.atk * 1.3);
  }
  return foe;
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
  const count = Math.min(5, 1 + Math.floor(rng() * 2) + Math.floor(size / 2) + extra);
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
    event: null, // the room the party is in (not a fight): {kind, id, lines, choices, offers - the merchant's, ...}
    map: null, // the rows of the floor (makeMap)
    at: null, // the room of the map the party is in: {row, index}
    seen: [], // the encounters met already
    doors: [], // the rooms of the map it may go to next
    votes: {}, // name -> a door's index or "leave"
    phase: "between",
    heroes: party.map(({ name, hero }) => {
      const stats = statsOf(hero);
      // (the talents of the character: perks for the whole run - relics add theirs)
      const perks = talentPerks(hero);
      stats.maxHp = Math.round(stats.maxHp * (1 + (perks.maxHp || 0)));
      stats.agi = Math.min(DODGE_MAX + 10, stats.agi + (perks.agi || 0));
      return {
        name,
        cls: hero.cls,
        level: charOf(hero).level,
        maxFloor: maxFloor(hero),
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
  run.map = makeMap(run, rng);
  run.doors = doorsFor(run);
  return run;
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
  const free = RELIC_IDS.filter((id) => !hero.relics.includes(id));
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

// The rooms that aren't fights: what every hero may choose there (card: the choice needs a card - "smith", "deck":
// one of the deck, "offer": one of the cards offered)
const ROOM_OPTIONS = {
  chest: [{ id: "open", label: "Open it", text: "Gear for the bag (luck: better) - now and then a relic" }],
  trap: [
    { id: "disarm", label: "Disarm it", text: "Luck: a piece of gear - failed: 25% damage" },
    { id: "sneak", label: "Sneak past", text: "Take 10% damage" },
  ],
  rest: [
    { id: "rest", label: "Rest", text: "Heal 35% HP, +1 mana in the next fight" },
    { id: "smith", label: "Smith", text: "Upgrade a card of your deck: 40% stronger", card: "smith" },
  ],
  shrine: [
    { id: "pray", label: "Pray", text: "Give 20% HP - deal 25% more damage for the rest of the run" },
    { id: "leave", label: "Walk on", text: "Nothing happens" },
  ],
};
const LEAVE = { id: "leave", label: "Leave", text: "Nothing happens" };
// The encounters (rooms of the kind "event") - one at random, none twice a run
const ENCOUNTERS = {
  fountain: {
    name: "The Fountain",
    icon: "⛲",
    story: "Clear water bubbles up in an old stone basin. It glows faintly.",
    options: [
      { id: "drink", label: "Drink", text: "Heal 30% HP" },
      { id: "bottle", label: "Fill a flask", text: "+1 potion" },
    ],
  },
  library: {
    name: "The Forgotten Library",
    icon: "📚",
    story: "Dusty shelves full of old battle manuals - there is time to study one of them.",
    options: [
      { id: "read", label: "Study", text: "Pick 1 of 5 cards for your deck", card: "offer" },
      { id: "nap", label: "Take a nap", text: "Heal 20% HP" },
    ],
  },
  forge: {
    name: "The Abandoned Forge",
    icon: "⚒️",
    story: "The anvil is still warm, the hammer lies ready. The heat of the coals burns your skin.",
    options: [{ id: "temper", label: "Temper", text: "Upgrade 2 random cards - lose 8% HP" }, LEAVE],
  },
  idol: {
    name: "The Golden Idol",
    icon: "🗿",
    story: "A golden idol on a stone pedestal. It is surely cursed.",
    options: [{ id: "take", label: "Take it", text: "A random relic - 10% less max HP for this run" }, LEAVE],
  },
  hermit: {
    name: "The Hermit",
    icon: "🧙",
    story: 'An old hermit by a small fire: "You carry too much. Give me one of your cards."',
    options: [{ id: "purge", label: "Give a card", text: "Remove a card from your deck (this run)", card: "deck" }, LEAVE],
  },
  gambler: {
    name: "The Gambler",
    icon: "🎲",
    story: 'A grinning imp shakes a cup of dice: "Your blood against my treasure?"',
    options: [{ id: "roll", label: "Roll the dice", text: "50%: a relic - else lose 15% HP" }, LEAVE],
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
  if (!chosen.open && !chosen.sensed) say(run, `Room ${n}: the door opens - ${ROOM_KINDS[kind].icon} ${ROOM_KINDS[kind].name}!`);
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
    const coins = Math.round(entryCost(run.floor) * REWARD.chest);
    run.pot += coins;
    note(`🪙 ${coins} each for the loot pot.`);
  } else if (kind == "merchant") {
    // (every hero shops on its own, with its own coins - no choice to make)
    run.event.choices = null;
    run.event.offers = {};
    const prices = merchantPrices(run.floor);
    for (const hero of heroes) {
      const cards = rewardFor(hero, rng, MERCHANT_CARDS);
      const relics = relicOffer(hero, rng, MERCHANT_RELICS);
      const price = { potion: potionPrice(hero.maxFloor), remove: prices.remove };
      for (const id of cards) price[id] = Math.round((prices.card * CARD_PRICE[CARDS[id].rarity]) / 100) * 100;
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
  if (run.rooms.length >= ROOMS) {
    run.phase = "won";
    say(run, `Floor ${run.floor} cleared! 🎉`);
    return;
  }
  run.phase = "between";
  run.votes = {};
  run.doors = doorsFor(run);
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
  if (option.id == "bottle" && hero.potions >= POTIONS_MAX) return `At most ${POTIONS_MAX} potions.`;
  const note = (text) => {
    event.lines.push(text);
    say(run, text);
  };
  const lose = (share) => {
    const damage = Math.round(hero.maxHp * share);
    hero.hp = Math.max(1, hero.hp - damage);
    return damage;
  };
  const gear = () => {
    const item = makeGear(run.floor, rng, hero.luck);
    run.loot[hero.name].push(item);
    return item;
  };
  const relic = () => {
    const [id] = relicOffer(hero, rng, 1);
    if (id) giveRelic(run, hero, id);
    return id;
  };
  event.choices[name] = option.id;
  switch (option.id) {
    case "open": {
      // (every hero rolls on its own - luck helps)
      if (rng() * 100 < 40 + hero.luck / 2) {
        const item = gear();
        note(`${name} finds ${item.icon} ${item.name} (${item.rarity}) - into the bag at the end of the run.`);
      } else note(`${name} finds nothing but dust.`);
      if (rng() < 0.2) {
        const id = relic();
        if (id) note(`${name} finds a relic: ${RELICS[id].icon} ${RELICS[id].name}.`);
      }
      break;
    }
    case "disarm":
      if (rng() * 100 < disarmChance(hero)) {
        const item = gear();
        note(`${name} disarms the trap 🍀 - and finds ${item.icon} ${item.name} in it.`);
      } else note(`${name} sets it off: ${lose(0.25)} damage.`);
      break;
    case "sneak":
      note(`${name} sneaks past: ${lose(0.1)} damage.`);
      break;
    case "rest":
      hero.bonusEnergy = 1;
      note(`${name} rests: +${healHero(run, hero, hero.maxHp * REST_HEAL)} HP, +1 mana in the next fight.`);
      break;
    case "smith": {
      const id = hero.deck[index];
      hero.deck[index] = id + "+";
      note(`${name} smiths ${CARDS[id].icon} ${CARDS[id].name}+ ⚒️.`);
      break;
    }
    case "pray":
      hero.blessed = true;
      note(`${name} gives ${lose(SHRINE_COST)} HP - and deals 25% more damage for the rest of the run.`);
      break;
    case "drink":
      note(`${name} drinks: +${healHero(run, hero, hero.maxHp * 0.3)} HP.`);
      break;
    case "bottle":
      hero.potions++;
      note(`${name} fills a flask: +1 potion 🧪.`);
      break;
    case "read":
      hero.deck.push(input.card);
      note(`${name} studies ${CARDS[input.card].icon} ${CARDS[input.card].name} - into the deck.`);
      break;
    case "nap":
      note(`${name} naps: +${healHero(run, hero, hero.maxHp * 0.2)} HP.`);
      break;
    case "temper": {
      const free = hero.deck.map((id, i) => i).filter((i) => !isUpgraded(hero.deck[i]));
      const picked = shuffle(free, rng).slice(0, 2);
      picked.forEach((i) => (hero.deck[i] += "+"));
      note(`${name} tempers ${picked.map((i) => cardInfo(hero.deck[i]).name).join(" and ") || "nothing"} - ${lose(0.08)} damage from the heat.`);
      break;
    }
    case "take": {
      const id = relic();
      hero.maxHp = Math.max(1, Math.round(hero.maxHp * 0.9));
      hero.hp = Math.min(hero.hp, hero.maxHp);
      note(id ? `${name} takes the idol: ${RELICS[id].icon} ${RELICS[id].name} - but 10% less max HP.` : `${name} takes the idol - it crumbles to dust.`);
      break;
    }
    case "purge": {
      const [id] = hero.deck.splice(index, 1);
      note(`${name} gives ${cardInfo(id).icon} ${cardInfo(id).name} to the hermit.`);
      break;
    }
    case "roll":
      if (rng() < 0.5) {
        const id = relic();
        note(id ? `${name} wins 🎲: ${RELICS[id].icon} ${RELICS[id].name}!` : `${name} wins - but the imp has nothing left.`);
      } else note(`${name} loses 🎲: ${lose(0.15)} damage.`);
      break;
    default:
      note(`${name} walks on.`);
  }
  return null;
}

// The merchant's prices (coins): a potion, a (common) card, a relic, a card taken out of the deck
const CARD_PRICE = { common: 1, rare: 1.5, epic: 2.5, legendary: 3.5, basic: 1, mystic: 5 };
function merchantPrices(floor) {
  const card = round100(Math.max(4000, entryCost(floor) * 0.8));
  return { card, relic: card * 3, remove: card };
}

// What a hero may buy of the merchant: {price} or {error} (item: "potion", "remove:<index of the deck>", a card or a
// relic of its offer)
function canBuy(run, name, item) {
  const hero = run.heroes.find((h) => h.name == name);
  const offer = run.event && run.event.offers && run.event.kind == "merchant" && run.event.offers[name];
  if (run.phase != "between" || !offer || !hero) return { error: "No merchant here." };
  if (item == "potion") {
    if (hero.potions >= POTIONS_MAX) return { error: `At most ${POTIONS_MAX} potions.` };
    return { price: offer.prices.potion };
  }
  if (/^remove:\d+$/.test(item)) {
    if (offer.removed) return { error: "He takes one card a visit." };
    if (!hero.deck[Number(item.slice(7))]) return { error: "Pick a card of your deck." };
    if (hero.deck.length <= DECK_LEAST) return { error: `Your deck keeps at least ${DECK_LEAST} cards.` };
    return { price: offer.prices.remove };
  }
  if (offer.bought.includes(item)) return { error: "Sold already." };
  if (!offer.cards.includes(item) && !offer.relics.includes(item)) return { error: "He doesn't sell that." };
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
    return note(`${name} has the merchant take ${cardInfo(id).icon} ${cardInfo(id).name} out of the deck.`);
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
  // (the class's cards and the neutral ones - weighted by their rarity; no basic, no mystic one)
  const pool = poolOf(hero.cls).filter((id) => !["basic", "mystic"].includes(CARDS[id].rarity)).map((id) => [id, CARD_RARITIES[CARDS[id].rarity].weight]);
  const cards = [];
  while (cards.length < Math.min(count, pool.length)) cards.push(weighted(rng, pool.filter(([id]) => !cards.includes(id))));
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
  const first = run.turn == 1;
  fx(run, { k: "turn", side: "heroes", first });
  for (const hero of alive(run.heroes)) {
    hero.block = first ? perk(hero, "startBlock") : 0;
    hero.energy = ENERGY + hero.bonusEnergy + (first ? perk(hero, "firstMana") : 0);
    hero.bonusEnergy = 0;
    hero.ended = false;
    hero.attacked = false;
    drawCards(hero, HAND + perk(hero, "draw"), rng);
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
    fx(run, { k: "miss", to: foe.id });
    return 0;
  }
  const crit = rng() * 100 < hero.luck + perk(hero, "crit");
  // (the perks of talents and relics: more damage, the first attack of a turn, low HP)
  const bonus = 1 + perk(hero, "attack") + (hero.firstAttack ? perk(hero, "firstStrike") : 0) + (hero.hp < hero.maxHp / 2 ? perk(hero, "lowHp") : 0);
  let damage = hero.atk * between(rng, 0.9, 1.1) * power * bonus * (crit ? CRIT : 1) * (hero.blessed ? SHRINE_POWER : 1) * (hero.effects.might ? MIGHT : 1);
  if (foe.defending) damage *= 0.5;
  if (foe.affix == "armored") damage *= 0.7;
  damage = Math.max(1, Math.round(damage));
  foe.hp = Math.max(0, foe.hp - damage);
  say(run, `${hero.name}${options.verb ? " " + options.verb : " hits"} ${foe.icon} ${foe.name} for ${damage}${crit ? " (critical!)" : ""}${foe.defending ? " (blocked half)" : ""}.`);
  fx(run, { k: "hit", to: foe.id, n: damage, crit });
  if (perk(hero, "lifesteal") && !hero.down) healHero(run, hero, damage * perk(hero, "lifesteal"));
  if (foe.hp == 0) {
    foe.down = true;
    say(run, `${foe.icon} ${foe.name} is defeated.`);
    fx(run, { k: "down", to: foe.id });
  }
  return damage;
}

// Damage to a hero: smoke, a dodge, armor (at most 75% of a hit), taunt - then the block takes it
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
  let damage = Math.max(raw * 0.25, raw - hero.def);
  if (hero.taunting) damage *= TAUNT;
  damage = Math.max(1, Math.round(damage));
  const blocked = Math.min(hero.block, damage);
  hero.block -= blocked;
  damage -= blocked;
  hero.hp = Math.max(0, hero.hp - damage);
  say(run, `${source} hits ${hero.name} for ${damage}${blocked ? ` (${blocked} blocked)` : ""}.`);
  fx(run, { k: "hit", to: hero.name, n: damage, b: blocked });
  // (thorns: who hits pays)
  if (foe && perk(hero, "thorns") && !foe.down) {
    foe.hp = Math.max(0, foe.hp - perk(hero, "thorns"));
    say(run, `${foe.icon} ${foe.name} takes ${perk(hero, "thorns")} from ${hero.name}'s thorns 🌵.`);
    fx(run, { k: "hit", to: foe.id, n: perk(hero, "thorns") });
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

function healHero(run, hero, amount) {
  const heal = Math.min(hero.maxHp - hero.hp, Math.round(amount));
  hero.hp += heal;
  if (heal > 0 && run.phase == "fight") fx(run, { k: "heal", to: hero.name, n: heal });
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
  (card.exhaust || card.mystic ? hero.exhausted : hero.discard).push(id);
  // (mystic: once per run - out of the run's deck)
  if (card.mystic) {
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
  if (info.fx) {
    if (info.type != "attack") say(run, `${hero.name} plays ${info.icon} ${info.name}.`);
    for (const fx of info.fx) playFx(run, hero, fx, { foe, friend, up, venom, block, heal }, rng);
    return;
  }
  switch (baseCard(id)) {
    case "strike":
      return strike(run, hero, foe, (1) * up, rng);
    case "defend":
      return say(run, `${hero.name} blocks ${block(hero, 6 + hero.def)}.`);
    case "focus":
      return drawCards(hero, 2, rng);
    case "secondwind":
      return say(run, `${hero.name} catches breath: blocks ${block(hero, 5 + hero.def)}, +${heal(hero, hero.maxHp * 0.06)} HP.`);
    case "adrenaline":
      hero.energy++;
      return drawCards(hero, 1, rng);
    case "quickslash":
      strike(run, hero, foe, (0.5) * up, rng);
      return drawCards(hero, 1, rng);
    case "bash":
      if (strike(run, hero, foe, (1.1) * up, rng, { sure: true, verb: "smashes" }) && !foe.down) {
        foe.effects.stun = 1;
        say(run, `${foe.icon} ${foe.name} is stunned 💫.`);
      }
      return;
    case "cleave":
      for (const one of foes) strike(run, hero, one, (0.7) * up, rng, { sure: true, verb: "cleaves" });
      return;
    case "battlecry":
      for (const one of alive(run.heroes)) one.effects.might = 2;
      return say(run, `${hero.name} lets out a war cry 📯 - the party hits harder!`);
    case "ironwave":
      strike(run, hero, foe, (0.7) * up, rng);
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
      return strike(run, hero, foe, ((hero.atk + hero.def) / hero.atk) * up, rng, { sure: true, verb: "judges" });
    case "holyshield":
      for (const one of alive(run.heroes)) block(one, 5 + hero.def);
      return say(run, `${hero.name} raises a holy shield over the party 🛡️.`);
    case "consecrate":
      for (const one of foes) strike(run, hero, one, (0.5) * up, rng, { sure: true, verb: "burns" });
      for (const one of alive(run.heroes)) heal(one, one.maxHp * 0.05);
      return;
    case "bulwark":
      block(hero, 10 + 2 * hero.def);
      return say(run, `${hero.name} braces behind the shield 🏰.`);
    case "heal":
      return say(run, `${hero.name} heals ${friend.name} for ${heal(friend, friend.maxHp * 0.25)} 💚.`);
    case "smite":
      return strike(run, hero, foe, (foe.undead ? 2.5 : 1.2) * up, rng, { sure: true, verb: "smites" });
    case "revive":
      fallen.down = false;
      fallen.hp = Math.round(fallen.maxHp * 0.4);
      fallen.ended = true;
      return say(run, `${hero.name} brings ${fallen.name} back 🕊️!`);
    case "prayer":
      for (const one of alive(run.heroes)) heal(one, one.maxHp * 0.12);
      return say(run, `${hero.name} prays - the party heals 🙏.`);
    case "blessing":
      friend.effects.might = 2;
      block(friend, 5);
      return say(run, `${hero.name} blesses ${friend.name} 🌞.`);
    case "poisonblade":
      if (strike(run, hero, foe, (0.6) * up, rng, { sure: true, verb: "cuts" }) && !foe.down) {
        foe.effects.poison = { turns: 3, dmg: Math.max(1, Math.round(hero.atk * 0.45 * venom)) };
        say(run, `${foe.icon} ${foe.name} is poisoned ☠️.`);
      }
      return;
    case "backstab":
      return strike(run, hero, foe, (foe.effects.poison || foe.effects.stun ? 3 : 1.2) * up, rng, { sure: true, verb: "backstabs" });
    case "smoke":
      hero.evading = true;
      return say(run, `${hero.name} vanishes in smoke 💨.`);
    case "envenom":
      for (const one of foes) one.effects.poison = { turns: 2, dmg: Math.max(1, Math.round(hero.atk * 0.4 * venom)) };
      return say(run, `${hero.name} poisons every foe 🧪.`);
    case "flurry":
      for (let i = 0; i < 3; i++) {
        const standing = alive(run.monsters);
        if (standing.length) strike(run, hero, pick(rng, standing), (0.4) * up, rng, { sure: true, verb: "slashes" });
      }
      return;
    case "frost":
      if (strike(run, hero, foe, (0.8) * up, rng, { sure: true, verb: "freezes" }) && !foe.down) {
        foe.effects.chill = 2;
        say(run, `${foe.icon} ${foe.name} is chilled ❄️.`);
      }
      return;
    case "fireball":
      for (const one of foes) {
        if (strike(run, hero, one, (0.7) * up, rng, { sure: true, verb: "burns" }) && !one.down) one.effects.burn = { turns: 2, dmg: Math.max(1, Math.round(hero.atk * 0.3)) };
      }
      return;
    case "barrier":
      block(friend, 8 + hero.atk * 0.6);
      return say(run, `${hero.name} shields ${friend.name} 🔮.`);
    case "arcanebolt":
      return strike(run, hero, foe, (1.5) * up, rng, { sure: true, verb: "blasts" });
    case "titanswrath":
      for (const one of foes) strike(run, hero, one, 3.5 * up, rng, { sure: true, verb: "erupts on" });
      return;
    case "divine":
      for (const one of alive(run.heroes)) {
        block(one, 30 + hero.def);
        heal(one, one.maxHp * 0.3);
      }
      return say(run, `${hero.name} calls down a divine intervention 👼!`);
    case "resurrection":
      for (const one of run.heroes.filter((h) => h.down)) {
        one.down = false;
        one.hp = Math.round(one.maxHp * 0.6);
        one.ended = true;
      }
      for (const one of alive(run.heroes)) heal(one, one.maxHp * 0.25);
      return say(run, `${hero.name}: a resurrection 🌅!`);
    case "deathmark":
      if (foe.hp < foe.maxHp / 2 && foe.rank != "boss") {
        foe.hp = 0;
        foe.down = true;
        return say(run, `${hero.name} marks ${foe.icon} ${foe.name} for death 💀 - it falls.`);
      }
      return strike(run, hero, foe, 4 * up, rng, { sure: true, verb: "marks" });
    case "timewarp":
      hero.energy += 4;
      drawCards(hero, 4, rng);
      return say(run, `${hero.name} warps time ⏳.`);
    case "meteor":
      for (const one of foes) strike(run, hero, one, (1.6) * up, rng, { sure: true, verb: "crushes" });
      return;
    // The neutral cards of the base set
    case "shrug":
      say(run, `${hero.name} shrugs it off: blocks ${block(hero, 8 + hero.def)}.`);
      return drawCards(hero, 1, rng);
    case "pommel":
      strike(run, hero, foe, 0.9 * up, rng);
      return drawCards(hero, 1, rng);
    case "bandage":
      return say(run, `${hero.name} bandages up: +${heal(hero, hero.maxHp * 0.08)} HP 🩹.`);
    case "twinstrike":
      strike(run, hero, foe, 0.6 * up, rng);
      if (!foe.down) strike(run, hero, foe, 0.6 * up, rng);
      return;
    case "overpower":
      return strike(run, hero, foe, 2.1 * up, rng, { verb: "overpowers" });
    case "trance":
      return drawCards(hero, 3, rng);
    case "laststand":
      return say(run, `${hero.name} stands fast: blocks ${block(hero, (6 + hero.def) * (hero.hp < hero.maxHp / 2 ? 3 : 1))} 🧱.`);
    case "rally":
      for (const one of alive(run.heroes)) {
        block(one, 5);
        drawCards(one, 1, rng);
      }
      return say(run, `${hero.name} rallies the party 🚩.`);
    // The warrior
    case "bodyslam":
      return strike(run, hero, foe, Math.max(0.5, hero.block / Math.max(1, hero.atk)) * up, rng, { sure: true, verb: "slams" });
    case "uppercut":
      if (strike(run, hero, foe, 1 * up, rng, { sure: true, verb: "uppercuts" }) && !foe.down) {
        foe.effects.stun = 1;
        foe.effects.chill = 2;
        say(run, `${foe.icon} ${foe.name} is stunned and chilled.`);
      }
      return;
    case "whirlwind":
      for (const one of foes) strike(run, hero, one, 1.1 * up, rng, { sure: true, verb: "whirls into" });
      return;
    case "impervious":
      return say(run, `${hero.name} is impervious: blocks ${block(hero, 25 + 2 * hero.def)} 🗿.`);
    // The paladin
    case "righteous":
      strike(run, hero, foe, 1.6 * up, rng, { sure: true, verb: "strikes down" });
      return heal(hero, hero.maxHp * 0.05);
    case "aegis":
      return say(run, `${hero.name} shields ${friend.name}: blocks ${block(friend, 12 + hero.def)} 🪬.`);
    case "retribution":
      for (const one of foes) strike(run, hero, one, 0.7 * up, rng, { sure: true, verb: "punishes" });
      return block(hero, 4 + hero.def);
    case "layhands":
      return say(run, `${hero.name} lays hands on ${friend.name}: +${heal(friend, friend.maxHp * 0.45)} HP 🤲.`);
    // The cleric
    case "holylight": {
      strike(run, hero, foe, 0.9 * up, rng, { sure: true, verb: "lights up" });
      const weakest = alive(run.heroes).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
      if (weakest) heal(weakest, weakest.maxHp * 0.08);
      return;
    }
    case "ward":
      for (const one of alive(run.heroes)) block(one, 4 + hero.def);
      return say(run, `${hero.name} wards the party 🔰.`);
    case "purify":
      delete friend.effects.poison;
      delete friend.effects.burn;
      return say(run, `${hero.name} purifies ${friend.name}: +${heal(friend, friend.maxHp * 0.12)} HP 💧.`);
    case "wrath":
      for (const one of foes) strike(run, hero, one, (one.undead ? 2.5 : 1.1) * up, rng, { sure: true, verb: "smites" });
      return;
    // The rogue
    case "daggers":
      for (let i = 0; i < 2 && !foe.down; i++) strike(run, hero, foe, (foe.effects.poison ? 0.8 : 0.5) * up, rng, { sure: true, verb: "throws at" });
      return;
    case "shadowstep":
      say(run, `${hero.name} steps into the shadows: blocks ${block(hero, 5 + hero.agi / 2)} 👤.`);
      return drawCards(hero, 1, rng);
    case "eviscerate":
      strike(run, hero, foe, 1.8 * up, rng, { sure: true, verb: "eviscerates" });
      if (!foe.down && foe.effects.poison) foe.effects.poison.turns += 2;
      return;
    case "lethaldose":
      for (const one of foes) {
        if (!one.effects.poison) continue;
        one.effects.poison.dmg *= 2;
        one.effects.poison.turns += 3;
      }
      return say(run, `${hero.name} doubles the dose ⚗️.`);
    // The mage
    case "spark":
      return strike(run, hero, foe, 0.6 * up, rng, { sure: true, verb: "zaps" });
    case "icearmor": {
      block(hero, 7 + hero.atk * 0.4);
      const chilled = foes.length ? pick(rng, foes) : null;
      if (chilled) chilled.effects.chill = 2;
      return say(run, `${hero.name} wears ice 🧊${chilled ? ` - ${chilled.icon} ${chilled.name} is chilled` : ""}.`);
    }
    case "chainlightning": {
      for (const one of foes) strike(run, hero, one, 0.9 * up, rng, { sure: true, verb: "shocks" });
      const standing = alive(run.monsters);
      if (standing.length) {
        const stunned = pick(rng, standing);
        stunned.effects.stun = 1;
        say(run, `${stunned.icon} ${stunned.name} is stunned 💫.`);
      }
      return;
    }
    case "blizzard":
      for (const one of foes) {
        if (strike(run, hero, one, 0.8 * up, rng, { sure: true, verb: "freezes" }) && !one.down) one.effects.chill = 2;
      }
      return;
  }
}

// A step of a card made of effects (game/rpg_cards.js)
function playFx(run, hero, fx, { foe, friend, up, venom, block, heal }, rng) {
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
  const state = (m, cond) => (cond == "low" ? hero.hp < hero.maxHp / 2 : cond == "undead" ? m.undead : !!m.effects[cond]);
  if (fx.hit != null) {
    for (let i = 0; i < (fx.times || 1); i++) {
      for (const m of foesOf(fx.to)) {
        const power = (fx.bonusIf && state(m, fx.bonusIf) ? fx.bonus : fx.hit) + ((fx.def || 0) * hero.def) / Math.max(1, hero.atk);
        strike(run, hero, m, power * up, rng, { sure: true });
      }
    }
  } else if (fx.block != null) {
    const value = fx.block + (fx.def || 0) * hero.def + (fx.atk || 0) * hero.atk + (fx.agi || 0) * hero.agi;
    for (const one of heroesOf(fx.to)) block(one, value);
  } else if (fx.heal != null) {
    for (const one of heroesOf(fx.to)) heal(one, one.maxHp * fx.heal);
  } else if (fx.status) {
    for (const m of foesOf(fx.to)) {
      if (fx.status == "poison") m.effects.poison = { turns: fx.turns || 3, dmg: Math.max(1, Math.round(hero.atk * 0.45 * venom)) };
      else if (fx.status == "burn") m.effects.burn = { turns: fx.turns || 2, dmg: Math.max(1, Math.round(hero.atk * 0.3 * up)) };
      else if (fx.status == "stun") m.effects.stun = 1;
      else m.effects[fx.status] = fx.turns || 1;
    }
  } else if (fx.might != null) {
    for (const one of heroesOf(fx.to)) one.effects.might = fx.might;
  } else if (fx.draw != null) drawCards(hero, fx.draw, rng);
  else if (fx.mana != null) hero.energy += fx.mana;
  else if (fx.lose != null) hero.hp = Math.max(1, hero.hp - Math.round(hero.maxHp * fx.lose));
  else if (fx.evade) hero.evading = true;
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
      hurt(run, target, damage * between(rng, 0.9, 1.1), intent.move == "smash" ? source + " 💥" : source, rng, foe);
      break;
    case "poison":
      if (hurt(run, target, damage, source, rng, foe) > 0 && !target.down) {
        target.effects.poison = { turns: 3, dmg: Math.max(1, Math.round(foe.atk * 0.35)) };
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
        if (hurt(run, hero, damage, source, rng, foe) > 0 && !hero.down) hero.effects.burn = { turns: 2, dmg: Math.max(1, Math.round(foe.atk * 0.25)) };
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
  for (const foe of alive(run.monsters)) {
    if (foe.affix != "regen" || foe.hp >= foe.maxHp) continue;
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
      if (one.hp == 0) {
        one.down = true;
        fx(run, { k: "down", to: one.icon ? one.id : one.name });
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
    fx(run, { k: "defeat" });
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
  fx(run, { k: "victory", coins });
  // (the spoils of the fight - the page lists them: the coins, the card, the relic)
  run.spoils = { room: run.rooms.length, coins, xp: xpFor(room.kind, run.floor) };
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
    hero.xp += xpFor(room.kind, run.floor);
    // (a perk: healed after a fight won)
    if (perk(hero, "afterFight")) healHero(run, hero, hero.maxHp * perk(hero, "afterFight"));
    // (a hard fight won: one of three relics)
    if (room.kind == "hard") hero.relicChoice = relicOffer(hero, rng);
  }
  room.done = true;
  afterRoom(run, rng);
  if (run.phase == "won") for (const hero of run.heroes) hero.xp += xpFor("floor", run.floor);
}

// For the pages
function runView(run) {
  const effectsOf = (effects) => Object.fromEntries(Object.entries(effects).map(([kind, value]) => [kind, typeof value == "object" ? value.turns : value]));
  return {
    floor: run.floor,
    phase: run.phase,
    room: run.rooms.length - 1,
    rooms: run.rooms.map((room) => ({ kind: room.kind, done: room.done })),
    // The map: what a room is stays hidden - unless sensed, open (the first, the last) or gone through
    map: (run.map || []).map((row) => row.map((node) => ({ col: node.col, kind: shownKind(node), sensed: node.sensed, visited: node.visited, next: node.next }))),
    at: run.at,
    doors: run.doors.map((door) => ({ row: door.row, index: door.index, kind: shownKind(door) })),
    sense: senseChance(run),
    event: run.event && {
      kind: run.event.kind,
      id: run.event.id,
      encounter: run.event.id ? ENCOUNTERS[run.event.id] : null,
      options: optionsOf(run.event),
      lines: run.event.lines,
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
      blessed: h.blessed,
      effects: effectsOf(h.effects),
      hand: h.hand,
      drawCount: h.draw.length,
      discardCount: h.discard.length,
      // (the piles to look at - the draw pile in no order: what comes next stays a secret)
      piles: { draw: [...h.draw].sort(), discard: h.discard, exhausted: h.exhausted },
      deck: h.deck,
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
      hp: m.hp,
      maxHp: m.maxHp,
      atk: m.atk,
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
    if (move.all || m.intent.target == hero.name) return sum + Math.max(m.intent ? intentDamage(m, m.intent.move) * 0.25 : 0, intentDamage(m, m.intent.move) - hero.def);
    return sum;
  }, 0);
}

// A plain player: blocks what comes at it, heals when low, hits the weakest foe with the rest
function simulatedTurn(run, me, rng) {
  if (me.hp < me.maxHp * 0.3 && me.potions > 0) drink(run, me.name);
  for (let guard = 0; guard < 20 && run.phase == "fight" && !me.ended; guard++) {
    const playable = me.hand.filter((c) => cardInfo(c.id).cost <= me.energy && cardInfo(c.id).target != "fallen");
    if (!playable.length) break;
    const need = incoming(run, me) - me.block;
    const blockCard = playable.find((c) => ["defend", "bulwark", "secondwind", "taunt", "smoke", "holyshield", "barrier"].includes(baseCard(c.id)));
    const healCard = playable.find((c) => ["heal", "prayer"].includes(baseCard(c.id)));
    const attack = playable.find((c) => cardInfo(c.id).type == "attack") || playable.find((c) => !["defend", "bulwark", "secondwind", "taunt", "smoke", "holyshield", "barrier", "heal", "prayer"].includes(baseCard(c.id)));
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
      if (me.relicChoice) pickRelic(run, "sim", me.relicChoice[0]);
      if (run.event && run.event.kind == "rest") choose(run, "sim", me.hp < me.maxHp * 0.7 ? { option: "rest" } : { option: "smith", card: me.deck.findIndex((id) => !isUpgraded(id)) }, rng);
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
  potionPrice,
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
  CLASS_PRICE,
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
  PACK_PRICE,
  PACKS,
  PACK_IDS,
  PACK_BUNDLE,
  BUNDLE_OFF,
  packPrice,
  cartPrice,
  addPacks,
  openStored,
  openAll,
  CART_MAX,
  deckMax,
  poolOf,
  collect,
  deckAdd,
  deckRemove,
  openPack,
  TALENTS,
  TALENT_LEVELS,
  RELICS,
  AFFIXES,
  UPGRADE,
  cardInfo,
  xpNeed,
  xpFor,
  HERO_LEVEL_MAX,
  gainXp,
  pickTalent,
  talentPerks,
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
  canBuy,
  bought,
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
