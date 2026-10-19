/*
 * The base set's larger part: cards made of effects (fx) - game/rpg.js plays them, the text is written from them.
 *
 * An effect (a step of a card, in order):
 *   {hit: power, to: "foe" | "all" | "random", times, def: share of the armor added, bonusIf: a state, bonus: power then}
 *   {block: base, def, atk, agi: shares of the hero's stats added, to: "self" | "ally" | "party"}
 *   {heal: share of the max HP, to: "self" | "ally" | "party" | "weakest"}
 *   {status: "poison" | "burn" | "chill" | "stun", turns, to: "foe" | "all" | "random"}
 *   {might: turns, to: "self" | "ally" | "party"} - 30% more damage
 *   {draw: n} {mana: n} {lose: share of the max HP} {evade: true}
 *   {aura: "guard" | "regen" | "focus", turns, to: "self" | "party", block, def, agi | heal | mana} - an AURA: at the start
 *   of each of the next turns (block, healing, mana)
 *   {status: "exposed", turns} - the foe takes 25% more damage (the warrior's sunder)
 *   {thorns: base, def: share of the armor, turns, to: "self" | "party"} - who hits takes it back (the paladin)
 *   on a hit: drain: share of the damage dealt healed, drainTo: "self" | "weakest" | "party" (the cleric's atonement)
 *   on a hit: consume: true - the foe's state the bonus asked for is used up (the mage's shatter and detonate)
 *   {conjure: card id, n} - cards made for the fight into the hand, gone once played (the rogue's shivs)
 * States for bonusIf ("a|b": any, "a&b": both): poison, burn, chill, stun, exposed, undead, boss, called (summoned)
 *   (the foe) - low (the hero below half HP), combo (a skill played this turn), guarded (the hero has block), healed
 *   (a heal played this turn), chain (two cards played before this one this turn)
 */

// The first cards of the game (the starter decks, the classes' own) - class membership: CLASSES in game/rpg.js
const BASE = {
  strike: ["Strike", "⚔️", 1, "basic", [{ hit: 1 }]],
  defend: ["Defend", "🛡️", 1, "basic", [{ block: 5, def: 0.7, to: "ally" }]],
  focus: ["Focus", "🧠", 0, "common", [{ draw: 2 }], true],
  secondwind: ["Second Wind", "🌬️", 1, "common", [{ block: 5, def: 1 }, { heal: 0.06 }]],
  adrenaline: ["Adrenaline", "💉", 0, "rare", [{ mana: 1 }, { draw: 1 }], true],
  quickslash: ["Quick Slash", "🌀", 0, "common", [{ hit: 0.5 }, { draw: 1 }]],
  shrug: ["Shrug It Off", "🤷", 1, "common", [{ block: 8, def: 1 }, { draw: 1 }]],
  pommel: ["Pommel Strike", "🔨", 1, "common", [{ hit: 0.9 }, { draw: 1 }]],
  bandage: ["Bandage", "🩹", 0, "common", [{ heal: 0.08 }], true],
  twinstrike: ["Twin Strike", "🤺", 1, "common", [{ hit: 0.6, times: 2 }]],
  overpower: ["Overpower", "🦾", 2, "epic", [{ hit: 2.1 }]],
  trance: ["Battle Trance", "🧘", 0, "rare", [{ draw: 3 }], true],
  laststand: ["Last Stand", "🧱", 1, "rare", [{ block: 6, def: 1, low: 3 }]],
  rally: ["Rally", "🚩", 1, "rare", [{ block: 5, to: "party" }, { draw: 1, to: "party" }]],
  bash: ["Heavy Blow", "💫", 2, "common", [{ hit: 1.1 }, { status: "stun" }]],
  cleave: ["Cleave", "🪓", 1, "common", [{ hit: 0.7, to: "all" }]],
  battlecry: ["War Cry", "📯", 1, "rare", [{ might: 2, to: "party" }], true],
  ironwave: ["Iron Wave", "🌊", 1, "common", [{ hit: 0.7 }, { block: 4, def: 0.5 }]],
  bodyslam: ["Body Slam", "🤼", 1, "common", [{ hit: 0.5, fromBlock: true }]],
  uppercut: ["Uppercut", "👊", 2, "common", [{ hit: 1.2 }, { status: "stun" }]],
  whirlwind: ["Whirlwind", "🌪️", 2, "rare", [{ hit: 1.1, to: "all" }]],
  impervious: ["Impervious", "🗿", 2, "epic", [{ block: 25, def: 2 }], true],
  bloodlust: ["Bloodlust", "🩸", 0, "epic", [{ lose: 0.08 }, { mana: 2 }], true],
  taunt: ["Taunt", "📣", 1, "common", [{ taunt: true }, { block: 4, def: 1 }]],
  judgement: ["Judgement", "⚖️", 1, "common", [{ hit: 1, def: 1 }]],
  holyshield: ["Holy Shield", "🛡️", 2, "rare", [{ block: 5, def: 1, to: "party" }]],
  consecrate: ["Consecrate", "🕯️", 2, "rare", [{ hit: 0.5, to: "all" }, { block: 3, def: 0.5, to: "party" }]],
  righteous: ["Righteous Blow", "🔆", 2, "common", [{ hit: 1.6 }, { block: 4, def: 0.5 }]],
  aegis: ["Aegis", "🪬", 1, "common", [{ block: 12, def: 1, to: "ally" }]],
  retribution: ["Retribution", "⚜️", 1, "rare", [{ hit: 0.7, to: "all" }, { block: 4, def: 1 }]],
  layhands: ["Sacred Shield", "🛡️", 2, "epic", [{ block: 20, def: 1.5, to: "ally" }], true],
  bulwark: ["Bulwark", "🏰", 1, "common", [{ block: 10, def: 1.3 }]],
  heal: ["Heal", "💚", 1, "common", [{ heal: 0.25, to: "ally" }]],
  smite: ["Smite", "🌟", 1, "common", [{ hit: 1.2, bonusIf: "undead|boss", bonus: 2.5 }]],
  revive: ["Revive", "🕊️", 2, "epic", [{ revive: 0.4 }], true],
  prayer: ["Prayer", "🙏", 2, "rare", [{ heal: 0.12, to: "party" }]],
  holylight: ["Holy Light", "🕯️", 1, "common", [{ hit: 0.9 }, { heal: 0.08, to: "weakest" }]],
  ward: ["Ward", "🔰", 1, "common", [{ block: 5, to: "party" }]],
  purify: ["Purify", "💧", 1, "rare", [{ cleanse: true, to: "ally" }, { heal: 0.12, to: "ally" }]],
  wrath: ["Divine Wrath", "🌩️", 2, "epic", [{ hit: 1.1, to: "all", bonusIf: "undead", bonus: 2.5 }]],
  blessing: ["Blessing", "🌞", 1, "rare", [{ might: 2, to: "ally" }, { block: 5, to: "ally" }]],
  poisonblade: ["Poison Blade", "☠️", 1, "common", [{ hit: 0.6 }, { status: "poison", turns: 3 }]],
  backstab: ["Backstab", "🔪", 1, "common", [{ hit: 1.2, bonusIf: "poison|stun", bonus: 3 }]],
  smoke: ["Smoke Bomb", "💨", 1, "rare", [{ evade: true }], true],
  envenom: ["Envenom", "🧪", 1, "rare", [{ status: "poison", turns: 2, to: "all" }]],
  daggers: ["Throwing Daggers", "🗡️", 1, "common", [{ hit: 0.5, times: 2, bonusIf: "poison", bonus: 0.8 }]],
  shadowstep: ["Shadow Step", "👤", 1, "common", [{ block: 5, agi: 0.5 }, { draw: 1 }]],
  eviscerate: ["Eviscerate", "💢", 2, "rare", [{ hit: 1.8 }, { extend: 2 }]],
  lethaldose: ["Lethal Dose", "⚗️", 1, "epic", [{ amplify: true, to: "all" }], true],
  flurry: ["Flurry", "✴️", 1, "common", [{ hit: 0.4, to: "random", times: 3 }]],
  frost: ["Frost Bolt", "❄️", 1, "common", [{ hit: 0.8 }, { status: "chill", turns: 2 }]],
  fireball: ["Fireball", "🔥", 2, "rare", [{ hit: 0.7, to: "all" }, { status: "burn", turns: 2, to: "all" }]],
  barrier: ["Barrier", "🔮", 1, "common", [{ block: 8, atk: 0.6, to: "ally" }]],
  arcanebolt: ["Arcane Bolt", "✨", 1, "common", [{ hit: 1.5 }]],
  spark: ["Spark", "✴️", 0, "common", [{ hit: 0.6 }]],
  icearmor: ["Ice Armor", "🧊", 1, "common", [{ block: 7, atk: 0.4 }, { status: "chill", turns: 1, to: "random" }]],
  chainlightning: ["Chain Lightning", "⚡", 2, "rare", [{ hit: 0.9, to: "all" }, { status: "stun", to: "random" }]],
  blizzard: ["Blizzard", "🌨️", 2, "epic", [{ hit: 0.8, to: "all" }, { status: "chill", turns: 2, to: "all" }]],
  meteor: ["Meteor", "☄️", 3, "epic", [{ hit: 1.6, to: "all" }]],
  titanswrath: ["Titan's Wrath", "🌋", 2, "mythic", [{ hit: 3.5, to: "all" }], "mythic"],
  divine: ["Divine Intervention", "👼", 1, "mythic", [{ block: 30, def: 1.5, to: "party" }, { taunt: true }], "mythic"],
  resurrection: ["Resurrection", "🌅", 2, "mythic", [{ revive: 0.6, to: "all" }, { heal: 0.25, to: "party" }], "mythic"],
  deathmark: ["Death Mark", "💀", 1, "mythic", [{ hit: 4, execute: 0.5 }], "mythic"],
  timewarp: ["Time Warp", "⏳", 0, "mythic", [{ mana: 4 }, { draw: 4 }], "mythic"],
};

// id: [name, icon, cost, rarity, fx, exhaust (true - or "mythic": in the hand from the start of every fight, once a fight)]
const NEUTRAL = {
  jab: ["Jab", "🥊", 0, "common", [{ hit: 0.5 }]],
  // (combos: far harder after a skill this turn)
  riposte: ["Riposte", "🤺", 1, "common", [{ hit: 0.6, bonusIf: "combo", bonus: 1.6 }]],
  brace: ["Brace", "🪵", 1, "common", [{ block: 10 }]],
  firstaid: ["First Aid", "⛑️", 1, "common", [{ heal: 0.12 }]],
  dash: ["Dash", "🏃", 1, "common", [{ hit: 0.6 }, { block: 5 }]],
  inspire: ["Inspire", "🎺", 1, "rare", [{ might: 2, to: "ally" }, { draw: 1 }]],
  gamble: ["Desperate Gamble", "🎲", 0, "rare", [{ mana: 1 }, { draw: 2 }, { lose: 0.06 }], true],
  panacea: ["Panacea", "🧴", 1, "rare", [{ heal: 0.1, to: "party" }]],
  // (AURAS: lasting a few turns)
  steadybreath: ["Steady Breath", "🌬️", 1, "common", [{ aura: "focus", mana: 1, turns: 2 }], true],
  stoneskin: ["Stoneskin", "🪨", 1, "rare", [{ aura: "guard", block: 5, turns: 3 }]],
  berserkerbrew: ["Berserker Brew", "🍷", 0, "legendary", [{ mana: 2 }, { might: 2 }], true],
  goldenstrike: ["Golden Strike", "🏆", 3, "legendary", [{ hit: 2.5 }, { draw: 1 }]],
  wish: ["Wish", "🌟", 0, "mythic", [{ heal: 0.3 }, { mana: 2 }, { draw: 3 }], "mythic"],
  kick: ["Kick", "🦵", 1, "common", [{ hit: 0.8 }, { status: "chill", turns: 1 }]],
  smokebomb: ["Smoke Bomb", "💨", 1, "rare", [{ block: 8 }, { status: "chill", turns: 1, to: "all" }]],
  whirlingsteel: ["Whirling Steel", "🌪️", 2, "epic", [{ hit: 0.8, to: "all" }, { draw: 1 }]],
  ironskin: ["Iron Skin", "🧥", 1, "epic", [{ block: 14, def: 1 }, { heal: 0.05 }]],
  secondbreath: ["Second Breath", "🫁", 0, "epic", [{ mana: 1 }, { heal: 0.08 }, { draw: 1 }], true],
  huntersmark: ["Hunter's Mark", "🎯", 1, "epic", [{ hit: 1 }, { status: "stun" }]],
  command: ["Warlord's Command", "📯", 1, "legendary", [{ might: 3, to: "party" }, { draw: 2, to: "party" }], true],
  titangrip: ["Titan Grip", "🗿", 3, "legendary", [{ hit: 1.8 }, { block: 12, def: 1 }]],
  phoenix: ["Phoenix Feather", "🪶", 1, "mythic", [{ heal: 0.35, to: "party" }, { revive: 0.3, to: "all" }], "mythic"],
  // (4 mana: finishers for any class - a mana card, a mana relic or a camp fire first)
  colossus: ["Colossal Strike", "🗡️", 4, "legendary", [{ hit: 4 }]],
  cataclysm: ["Cataclysm", "🌋", 4, "epic", [{ hit: 1.6, to: "all" }, { status: "burn", turns: 2, to: "all" }]],
  bladestorm: ["Storm of Blades", "🌩️", 4, "epic", [{ hit: 0.7, to: "random", times: 6 }]],
  fortress: ["Fortress", "🏰", 4, "epic", [{ block: 30, def: 2 }], true],
  dawnofhope: ["Dawn of Hope", "🌅", 4, "legendary", [{ heal: 0.25, to: "party" }, { block: 10, to: "party" }], true],
};

const CLASS = {
  warrior: {
    warbanner: ["War Banner", "🚩", 2, "epic", [{ aura: "guard", block: 6, def: 0.5, turns: 3 }, { might: 3 }]],
    heavyslash: ["Heavy Slash", "⚒️", 1, "common", [{ hit: 1.35 }]],
    followthrough: ["Follow Through", "🔁", 1, "common", [{ hit: 0.8, bonusIf: "combo", bonus: 1.9 }]],
    shieldup: ["Shield Up", "🛡️", 1, "common", [{ block: 9, def: 1 }]],
    headbutt: ["Headbutt", "🐏", 1, "common", [{ hit: 1 }, { draw: 1 }]],
    warstomp: ["War Stomp", "🦶", 2, "common", [{ hit: 0.7, to: "all" }, { block: 4, def: 0.5 }]],
    recklesscharge: ["Reckless Charge", "🐂", 0, "common", [{ hit: 1 }, { lose: 0.04 }]],
    fortify: ["Fortify", "🏯", 1, "common", [{ block: 6, def: 1.5 }]],
    clothesline: ["Clothesline", "💪", 2, "common", [{ hit: 1.4 }, { might: 1 }]],
    boomerang: ["Sword Boomerang", "🪃", 1, "common", [{ hit: 0.45, to: "random", times: 3 }]],
    bloodrage: ["Blood Rage", "😤", 1, "rare", [{ lose: 0.06 }, { might: 3 }, { draw: 1 }]],
    shockwave: ["Shockwave", "💥", 2, "rare", [{ hit: 0.5, to: "all" }, { status: "stun", to: "random" }], true],
    seeingred: ["Seeing Red", "👁️", 1, "rare", [{ mana: 2 }], true],
    flamebarrier: ["Iron Barrier", "🛡️", 2, "rare", [{ block: 12, def: 1 }, { might: 2 }]],
    rampage: ["Rampage", "🐗", 1, "rare", [{ hit: 1.1, bonusIf: "low", bonus: 2.2 }]],
    ironwill: ["Iron Will", "🪨", 1, "rare", [{ block: 6, def: 1 }, { might: 1 }]],
    reaper: ["Reaper", "⚰️", 2, "epic", [{ hit: 0.9, to: "all" }, { heal: 0.12 }], true],
    juggernaut: ["Juggernaut", "🚂", 2, "epic", [{ hit: 2.4 }, { block: 8, def: 1 }]],
    demonform: ["Demon Form", "👹", 1, "legendary", [{ might: 4 }, { mana: 1 }], true],
    bludgeon: ["Bludgeon", "🏏", 3, "legendary", [{ hit: 3.2 }]],
    earthshaker: ["Earthshaker", "🌍", 3, "legendary", [{ hit: 1.6, to: "all" }, { status: "stun", to: "all" }], true],
    lastbastion: ["Last Bastion", "🛡️", 2, "legendary", [{ block: 20, def: 2 }, { might: 2 }]],
    ragnarok: ["Ragnarok", "⚡", 3, "mythic", [{ hit: 2, to: "all", times: 2 }], "mythic"],
    undyingrage: ["Undying Rage", "😡", 1, "mythic", [{ heal: 0.4 }, { might: 3 }, { mana: 2 }], "mythic"],
    doublechop: ["Double Chop", "🪓", 1, "rare", [{ hit: 0.7, times: 2 }]],
    grit: ["Grit", "😬", 1, "rare", [{ block: 7, def: 1 }, { draw: 1 }]],
    taunting: ["Battle Roar", "🦁", 1, "rare", [{ might: 2 }, { block: 6, def: 1 }]],
    secondswing: ["Second Swing", "🔁", 1, "rare", [{ hit: 0.6 }, { hit: 0.6, to: "random" }]],
    cleavingblow: ["Cleaving Blow", "🗡️", 2, "epic", [{ hit: 1.1, to: "all" }, { block: 6, def: 1 }]],
    berserk: ["Berserk", "🔴", 1, "epic", [{ might: 3 }, { lose: 0.05 }, { mana: 1 }], true],
    bulwarkbash: ["Bulwark Bash", "🧱", 2, "epic", [{ hit: 0.8, def: 1 }, { block: 8, def: 1 }]],
    rageburst: ["Rage Burst", "💢", 1, "epic", [{ hit: 1.3, bonusIf: "low", bonus: 2.6 }]],
    rallyingcry: ["Rallying Cry", "📣", 1, "epic", [{ block: 6, to: "party" }, { might: 1, to: "party" }]],
    ironcharge: ["Iron Charge", "🐎", 2, "epic", [{ hit: 1.6 }, { status: "stun" }]],
    warlord: ["Warlord", "🪖", 2, "legendary", [{ hit: 1.4, to: "all" }, { might: 2, to: "party" }]],
    skullsplitter: ["Skullsplitter", "⛏️", 3, "legendary", [{ hit: 3 }, { status: "stun" }]],
    // (4 mana)
    titansfall: ["Titan's Fall", "🏔️", 4, "legendary", [{ hit: 2, to: "all" }, { status: "stun", to: "all" }], true],
    warpath: ["Warpath", "🐗", 4, "epic", [{ hit: 1.1, times: 3 }]],
    // (the second set: SUNDER - an exposed foe takes 25% more damage, the big blows hit it far harder - and
    // BLOODTHIRST - hits that heal)
    sunder: ["Sunder", "⛓️", 1, "common", [{ hit: 0.8 }, { status: "exposed", turns: 2 }]],
    armorcrack: ["Armor Crack", "🧱", 1, "common", [{ status: "exposed", turns: 3 }, { block: 5, def: 0.5 }]],
    punish: ["Punish", "🤜", 1, "common", [{ hit: 0.9, bonusIf: "exposed", bonus: 1.8 }]],
    rendinghowl: ["Rending Howl", "🐺", 1, "common", [{ status: "exposed", turns: 2, to: "all" }]],
    bloodthirst: ["Bloodthirst", "🧛", 1, "common", [{ hit: 1, drain: 0.3 }]],
    brutalsweep: ["Brutal Sweep", "🧹", 2, "common", [{ hit: 0.8, to: "all", bonusIf: "exposed", bonus: 1.4 }]],
    gauntletjab: ["Gauntlet Jab", "🧤", 0, "common", [{ hit: 0.4 }, { status: "exposed", turns: 1 }]],
    shieldbreaker: ["Shield Breaker", "🔓", 2, "common", [{ hit: 1.1 }, { status: "exposed", turns: 2 }, { block: 4, def: 0.5 }]],
    hamstring: ["Hamstring", "🦵", 1, "common", [{ hit: 0.7 }, { status: "chill", turns: 1 }, { status: "exposed", turns: 1 }]],
    scarredhide: ["Scarred Hide", "🦏", 1, "common", [{ block: 6, def: 1 }, { heal: 0.03 }]],
    bloodyedge: ["Bloody Edge", "🩸", 1, "common", [{ hit: 0.7, times: 2, drain: 0.15 }]],
    crushingblow: ["Crushing Blow", "💥", 2, "rare", [{ hit: 1.6, bonusIf: "exposed", bonus: 2.8 }]],
    mortalstrike: ["Mortal Strike", "🗡️", 2, "rare", [{ hit: 1.4 }, { status: "exposed", turns: 2 }, { draw: 1 }]],
    intimidate: ["Intimidate", "👺", 1, "rare", [{ status: "exposed", turns: 2, to: "all" }, { block: 5, def: 0.5 }]],
    savagebite: ["Savage Bite", "🐻", 1, "rare", [{ hit: 1, drain: 0.4, bonusIf: "low", bonus: 1.8 }]],
    splitapart: ["Split Apart", "🪚", 2, "rare", [{ hit: 0.9, to: "all" }, { status: "exposed", turns: 1, to: "all" }]],
    bonebreaker: ["Bonebreaker", "🦴", 1, "rare", [{ hit: 1.2, bonusIf: "exposed", bonus: 2.4, consume: true }]],
    bloodfeast: ["Blood Feast", "🍖", 2, "rare", [{ hit: 0.8, to: "all", drain: 0.25 }]],
    relentless: ["Relentless", "♾️", 1, "rare", [{ hit: 0.7, bonusIf: "exposed", bonus: 1.3 }, { draw: 1 }]],
    tasteofblood: ["Taste of Blood", "👅", 0, "rare", [{ lose: 0.05 }, { status: "exposed", turns: 2 }, { draw: 1 }]],
    shatterguard: ["Shatter Guard", "🪓", 1, "rare", [{ hit: 0.6, times: 2 }, { status: "exposed", turns: 1 }]],
    executioner: ["Executioner's Swing", "🪓", 2, "epic", [{ hit: 1.2, execute: 0.25 }]],
    vampiricrage: ["Vampiric Rage", "🦇", 1, "epic", [{ might: 2 }, { hit: 0.9, drain: 0.5 }]],
    demolish: ["Demolish", "🏚️", 3, "epic", [{ hit: 2.4, bonusIf: "exposed", bonus: 4.2, consume: true }]],
    battlescars: ["Battle Scars", "🎖️", 1, "epic", [{ block: 8, def: 1, low: 2 }, { status: "exposed", turns: 2, to: "random" }]],
    rupturearmor: ["Rupture Armor", "🔩", 2, "epic", [{ status: "exposed", turns: 3, to: "all" }, { might: 1 }], true],
    warhunger: ["War Hunger", "🍗", 2, "epic", [{ hit: 1, to: "all", drain: 0.35 }]],
    butcher: ["Butcher", "🔪", 1, "epic", [{ hit: 0.6, times: 3, bonusIf: "exposed", bonus: 1 }]],
    unstoppable: ["Unstoppable", "🦬", 2, "epic", [{ hit: 1.5 }, { block: 8, def: 1 }, { status: "exposed", turns: 2 }]],
    annihilate: ["Annihilate", "🗯️", 3, "legendary", [{ hit: 3, bonusIf: "exposed", bonus: 5, consume: true }]],
    bloodgod: ["Blood God", "🏺", 3, "legendary", [{ hit: 1.2, to: "all", drain: 0.5 }, { might: 2 }]],
    shattertheline: ["Shatter the Line", "🎳", 2, "legendary", [{ status: "exposed", turns: 3, to: "all" }, { hit: 1, to: "all" }]],
    warlordsfury: ["Warlord's Fury", "🦅", 1, "legendary", [{ might: 3 }, { status: "exposed", turns: 2, to: "all" }], true],
    crimsontide: ["Crimson Tide", "🌺", 4, "legendary", [{ hit: 1.2, times: 3, drain: 0.3 }]],
    worldbreaker: ["Worldbreaker", "🗻", 3, "mythic", [{ status: "exposed", turns: 3, to: "all" }, { hit: 2.5, to: "all" }], "mythic"],
    eternalwar: ["Eternal War", "🏹", 2, "mythic", [{ hit: 3, drain: 1 }, { might: 3 }], "mythic"],
  },
  paladin: {
    zeal: ["Zeal", "🔥", 0, "common", [{ mana: 1 }, { block: 3, def: 0.5 }], true],
    devotionaura: ["Devotion Aura", "🔆", 1, "rare", [{ aura: "guard", block: 4, def: 0.5, turns: 3, to: "party" }]],
    shieldslam: ["Shield Slam", "🔘", 1, "common", [{ hit: 0.6, def: 1 }]],
    guard: ["Guard", "🚧", 1, "common", [{ block: 7, def: 1, to: "ally" }]],
    shieldslam: ["Shield Slam", "🛡️", 1, "common", [{ hit: 0.5, def: 0.5, bonusIf: "combo", bonus: 1.4 }]],
    shieldbash: ["Shield Bash", "🛡️", 2, "common", [{ hit: 0.5, def: 0.5 }, { status: "stun" }]],
    holystrike: ["Holy Strike", "✝️", 1, "common", [{ hit: 1.1, bonusIf: "stun|undead", bonus: 2.2 }]],
    vow: ["Vow", "📜", 1, "common", [{ block: 5, def: 1 }, { draw: 1 }]],
    crusade: ["Crusade", "🏇", 2, "common", [{ hit: 0.6, def: 0.5, to: "all" }]],
    radiance: ["Radiance", "🔅", 1, "common", [{ hit: 0.7 }, { block: 3, def: 0.5, to: "party" }]],
    steadfast: ["Steadfast", "⚓", 1, "common", [{ block: 6, def: 1.3 }]],
    rebuke: ["Rebuke", "🙅", 1, "common", [{ hit: 0.8 }, { taunt: true }]],
    sanctuary: ["Sanctuary", "⛪", 2, "rare", [{ block: 6, def: 1, to: "party" }, { taunt: true }]],
    avenger: ["Avenger's Shield", "🥏", 2, "rare", [{ hit: 0.5, def: 0.4, to: "random", times: 3 }]],
    devotion: ["Devotion", "💒", 1, "rare", [{ mana: 1 }, { block: 4, def: 1 }], true],
    shieldwall: ["Shield Wall", "🧱", 2, "rare", [{ block: 10, def: 2.5 }]],
    blessedhammer: ["Blessed Hammer", "🔨", 1, "rare", [{ hit: 0.9, def: 0.5 }, { draw: 1 }]],
    martyr: ["Martyr", "🥀", 0, "rare", [{ lose: 0.08 }, { block: 8, def: 1, to: "party" }]],
    guardianangel: ["Guardian Angel", "😇", 2, "epic", [{ block: 15, def: 1, to: "party" }], true],
    divinestorm: ["Divine Storm", "⛈️", 3, "legendary", [{ hit: 1.3, def: 0.5, to: "all" }]],
    avatar: ["Avatar of Light", "☀️", 2, "epic", [{ might: 3 }, { block: 10, def: 1 }], true],
    verdict: ["Final Verdict", "🏛️", 3, "legendary", [{ hit: 2, def: 1, bonusIf: "stun|undead", bonus: 3 }]],
    oath: ["Crusader's Oath", "📯", 2, "legendary", [{ block: 12, def: 1, to: "party" }, { taunt: true }], true],
    justice: ["Hammer of Justice", "🛕", 2, "legendary", [{ hit: 2.2, def: 1 }, { status: "stun" }]],
    aegisgods: ["Aegis of the Gods", "🌐", 2, "mythic", [{ block: 40, def: 1, to: "party" }], "mythic"],
    holyavenger: ["Holy Avenger", "🗡️", 2, "mythic", [{ hit: 3, def: 2 }, { block: 15, def: 1, to: "party" }], "mythic"],
    hallowedshield: ["Hallowed Shield", "🛡️", 1, "rare", [{ block: 8, def: 1, to: "ally" }]],
    smiteevil: ["Shield Toss", "🥏", 1, "rare", [{ hit: 0.8, def: 0.6, bonusIf: "stun|undead", bonus: 1.8 }]],
    standfirm: ["Stand Firm", "🗿", 1, "rare", [{ taunt: true }, { block: 6, def: 1 }]],
    shieldfaith: ["Shield of Faith", "🔰", 1, "epic", [{ block: 12, def: 1.2, to: "ally" }, { taunt: true }]],
    crusaderstrike: ["Crusader Strike", "⚔️", 1, "epic", [{ hit: 1.2, bonusIf: "stun|undead", bonus: 2.4 }, { block: 4, def: 0.5 }]],
    hallowground: ["Hallowed Ground", "🕯️", 2, "epic", [{ hit: 0.7, def: 0.3, to: "all" }, { taunt: true }]],
    divineprotection: ["Divine Protection", "🙏", 1, "epic", [{ block: 8, def: 1.5 }]],
    lightswrath: ["Light's Wrath", "🌩️", 3, "epic", [{ hit: 1.8, def: 0.5 }]],
    holybanner: ["Holy Banner", "🚩", 1, "epic", [{ block: 4, def: 0.5, to: "party" }, { draw: 2 }], true],
    sacredvow: ["Sacred Vow", "📿", 0, "epic", [{ block: 6, def: 1 }, { draw: 1 }], true],
    hammeroflight: ["Hammer of Light", "☀️", 3, "legendary", [{ hit: 2, def: 1 }, { block: 6, def: 1, to: "party" }]],
    holybulwark: ["Holy Bulwark", "🏰", 2, "legendary", [{ block: 14, def: 1.5, to: "party" }], true],
    // (4 mana)
    judgementday: ["Judgement Day", "🔔", 4, "legendary", [{ hit: 1.5, def: 1, to: "all" }, { status: "stun", to: "random" }]],
    bastion: ["Bastion", "🏯", 4, "epic", [{ block: 18, def: 2, to: "party" }], true],
    // (the second set: THORNS - who hits the paladin pays for a few turns - and GUARDED blows, harder while it
    // has block up)
    thornedshield: ["Thorned Shield", "🌵", 1, "common", [{ block: 6, def: 1 }, { thorns: 4, def: 0.3, turns: 2 }]],
    retaliate: ["Retaliate", "↩️", 1, "common", [{ hit: 0.8, bonusIf: "guarded", bonus: 1.5 }]],
    bastionstrike: ["Bastion Strike", "🔲", 1, "common", [{ hit: 0.6, def: 0.6, bonusIf: "guarded", bonus: 1.2 }]],
    spikedmail: ["Spiked Mail", "🦔", 1, "common", [{ thorns: 6, def: 0.5, turns: 3 }]],
    holyrebuke: ["Holy Rebuke", "🛎️", 1, "common", [{ taunt: true }, { thorns: 4, def: 0.3, turns: 1 }]],
    shieldcharge: ["Shield Charge", "🦏", 2, "common", [{ hit: 1, def: 0.5, bonusIf: "guarded", bonus: 1.8 }, { block: 4, def: 0.5 }]],
    brambleward: ["Bramble Ward", "🌾", 1, "common", [{ block: 5, def: 0.6, to: "ally" }, { thorns: 3, def: 0.3, turns: 2, to: "party" }]],
    steelanswer: ["Steel Answer", "⚙️", 1, "common", [{ hit: 0.5, bonusIf: "guarded", bonus: 1 }, { block: 5, def: 0.8 }]],
    lightsparry: ["Light's Parry", "✋", 1, "common", [{ block: 8, def: 1 }, { thorns: 3, def: 0.4, turns: 1 }]],
    sanctifiedblade: ["Sanctified Blade", "🗝️", 1, "common", [{ hit: 1, bonusIf: "guarded|undead", bonus: 1.7 }]],
    thornsaura: ["Aura of Thorns", "🌹", 1, "rare", [{ thorns: 5, def: 0.5, turns: 3, to: "party" }]],
    vengefulshield: ["Vengeful Shield", "🛡️", 2, "rare", [{ hit: 0.6, def: 0.5, bonusIf: "guarded", bonus: 1.2 }, { block: 8, def: 1.2 }]],
    ironvow: ["Iron Vow", "📏", 1, "rare", [{ block: 6, def: 1.2 }, { thorns: 4, def: 0.4, turns: 2 }]],
    radiantspikes: ["Radiant Spikes", "⭐", 2, "rare", [{ hit: 0.7, to: "all", bonusIf: "guarded", bonus: 1.3 }]],
    guardiansoath: ["Guardian's Oath", "🤝", 1, "rare", [{ taunt: true }, { block: 7, def: 1 }, { thorns: 3, def: 0.3, turns: 1 }]],
    reprisal: ["Reprisal", "🔄", 2, "rare", [{ hit: 1.4, bonusIf: "guarded", bonus: 2.4 }]],
    thornwall: ["Wall of Thorns", "🧱", 2, "rare", [{ block: 8, def: 1, to: "party" }, { thorns: 3, def: 0.3, turns: 2, to: "party" }]],
    blessedspikes: ["Blessed Spikes", "📍", 0, "rare", [{ thorns: 4, def: 0.3, turns: 2 }], true],
    shieldecho: ["Shield Echo", "🔊", 1, "rare", [{ hit: 0.5, def: 0.5, times: 2, bonusIf: "guarded", bonus: 0.9 }]],
    martyrsresolve: ["Martyr's Resolve", "🕯️", 1, "rare", [{ lose: 0.05 }, { thorns: 8, def: 0.6, turns: 2 }, { taunt: true }]],
    crownofthorns: ["Crown of Thorns", "👑", 2, "epic", [{ thorns: 8, def: 0.8, turns: 3 }, { block: 8, def: 1 }]],
    ramparts: ["Rampart Slam", "🏰", 2, "epic", [{ hit: 1.4, def: 1, bonusIf: "guarded", bonus: 2.4 }]],
    sacredbrambles: ["Sacred Brambles", "🌳", 2, "epic", [{ thorns: 5, def: 0.5, turns: 3, to: "party" }, { taunt: true }], true],
    shieldretribution: ["Shield of Retribution", "🔰", 1, "epic", [{ block: 10, def: 1.2 }, { thorns: 6, def: 0.5, turns: 1 }]],
    lightbarrage: ["Light Barrage", "🌠", 2, "epic", [{ hit: 0.5, def: 0.4, to: "random", times: 4, bonusIf: "guarded", bonus: 0.8 }]],
    vigilance: ["Vigilance", "👁️", 1, "epic", [{ block: 7, def: 1 }, { thorns: 4, def: 0.4, turns: 2 }, { draw: 1 }]],
    righteouscounter: ["Righteous Counter", "⚔️", 2, "epic", [{ taunt: true }, { hit: 1.2, def: 0.8, bonusIf: "guarded", bonus: 2 }]],
    hallowedthorns: ["Hallowed Thorns", "🕸️", 1, "epic", [{ hit: 0.8, to: "all", bonusIf: "undead", bonus: 1.6 }, { thorns: 3, def: 0.4, turns: 1 }]],
    saintsthorns: ["Thorns of the Saint", "🥀", 2, "legendary", [{ thorns: 10, def: 1, turns: 3, to: "party" }], true],
    lastjudgement: ["Last Judgement", "🏛️", 3, "legendary", [{ hit: 2.2, def: 1.2, bonusIf: "guarded", bonus: 3.6 }]],
    eternalguard: ["Eternal Guard", "🛡️", 2, "legendary", [{ block: 14, def: 1.5, to: "party" }, { thorns: 4, def: 0.4, turns: 2, to: "party" }]],
    sunshield: ["Sun Shield", "☀️", 1, "legendary", [{ block: 10, def: 1.2 }, { hit: 0.7, def: 0.4, to: "all" }]],
    avengingwrath: ["Avenging Wrath", "🪽", 4, "legendary", [{ hit: 1.4, def: 1, to: "all", bonusIf: "guarded", bonus: 2.2 }, { taunt: true }]],
    thornheart: ["Thornheart", "❤️‍🔥", 2, "mythic", [{ thorns: 15, def: 1.5, turns: 4, to: "party" }, { block: 20, def: 1, to: "party" }], "mythic"],
    hammerofdawn: ["Hammer of Dawn", "🔨", 3, "mythic", [{ hit: 4, def: 2, bonusIf: "guarded", bonus: 6 }, { taunt: true }], "mythic"],
  },
  cleric: {
    renewalaura: ["Aura of Renewal", "🌿", 1, "rare", [{ aura: "regen", heal: 0.05, turns: 3, to: "party" }]],
    mend: ["Mend", "🌿", 1, "common", [{ heal: 0.15, to: "ally" }]],
    holybolt: ["Holy Bolt", "🌠", 1, "common", [{ hit: 1, bonusIf: "undead", bonus: 2.2 }]],
    banish: ["Banish", "🔆", 1, "common", [{ hit: 0.6, to: "all", bonusIf: "called", bonus: 1.8 }]],
    answered: ["Answered Prayer", "📿", 1, "common", [{ hit: 0.7, bonusIf: "combo", bonus: 1.7 }]],
    renew: ["Renew", "🌱", 1, "common", [{ heal: 0.08, to: "party" }]],
    faith: ["Blessed Ward", "🛡️", 1, "common", [{ block: 9, to: "ally" }]],
    chastise: ["Chastise", "☝️", 1, "common", [{ hit: 0.8, bonusIf: "undead", bonus: 1.8 }]],
    penance: ["Penance", "🔔", 1, "common", [{ hit: 0.6 }, { heal: 0.06, to: "weakest" }]],
    meditate: ["Meditate", "🪷", 0, "common", [{ draw: 1 }, { heal: 0.04 }]],
    grace: ["Light's Grace", "🪽", 1, "common", [{ heal: 0.1, to: "ally" }, { block: 4, to: "ally" }]],
    circle: ["Circle of Healing", "⭕", 2, "rare", [{ heal: 0.18, to: "party" }]],
    holynova: ["Holy Nova", "❇️", 2, "rare", [{ hit: 0.7, to: "all" }, { heal: 0.07, to: "party" }]],
    hymn: ["Divine Hymn", "🎶", 1, "rare", [{ might: 2, to: "party" }, { heal: 0.05, to: "party" }], true],
    exorcism: ["Exorcism", "🧿", 1, "rare", [{ hit: 0.9, bonusIf: "undead", bonus: 3.5 }]],
    sanctify: ["Sanctify", "🫶", 1, "rare", [{ block: 6, to: "party" }, { cleanse: true, to: "party" }]],
    innerfire: ["Inner Fire", "♨️", 1, "rare", [{ might: 2 }, { heal: 0.08 }]],
    miracle: ["Miracle", "🌈", 2, "legendary", [{ heal: 0.35, to: "party" }], true],
    guardianspirit: ["Guardian Spirit", "👻", 1, "epic", [{ block: 20, to: "ally" }, { heal: 0.15, to: "ally" }], true],
    holyfire: ["Holy Fire", "🎇", 3, "epic", [{ hit: 1.6, bonusIf: "undead", bonus: 3.2 }, { heal: 0.08, to: "party" }]],
    ascension: ["Ascension", "👑", 2, "legendary", [{ mana: 2 }, { draw: 2 }, { heal: 0.1, to: "party" }], true],
    beacon: ["Beacon of Light", "🗼", 2, "legendary", [{ heal: 0.2, to: "party" }, { block: 8, to: "party" }]],
    dawnbreak: ["Dawnbreak", "🌄", 2, "legendary", [{ hit: 1.2, to: "all", bonusIf: "undead", bonus: 3 }, { heal: 0.08, to: "party" }]],
    saintsgrace: ["Saint's Grace", "💖", 2, "mythic", [{ heal: 0.5, to: "party" }, { might: 2, to: "party" }], "mythic"],
    rapture: ["Rapture", "🪐", 2, "mythic", [{ hit: 2, to: "all" }, { heal: 0.2, to: "party" }], "mythic"],
    prayerbeads: ["Prayer Beads", "📿", 1, "common", [{ heal: 0.06 }, { draw: 1 }]],
    soothe: ["Soothe", "🌿", 1, "rare", [{ heal: 0.1, to: "ally" }]],
    holyspark: ["Holy Spark", "✨", 1, "rare", [{ hit: 0.9 }, { heal: 0.04 }]],
    shelter: ["Shelter", "⛺", 1, "rare", [{ block: 6, to: "party" }]],
    holyword: ["Holy Word", "🗣️", 1, "epic", [{ heal: 0.15, to: "weakest" }, { draw: 1 }]],
    spiritlink: ["Spirit Link", "🔗", 1, "epic", [{ heal: 0.08, to: "party" }, { cleanse: true }]],
    radiantburst: ["Radiant Burst", "✴️", 2, "epic", [{ hit: 0.8, to: "all" }, { heal: 0.08, to: "party" }]],
    sanctuarylight: ["Sanctuary Light", "🕊️", 1, "epic", [{ block: 8, to: "ally" }, { heal: 0.08, to: "ally" }]],
    lastrites: ["Last Rites", "🪦", 3, "epic", [{ hit: 1.6, bonusIf: "undead", bonus: 3.2 }]],
    blessedwater: ["Blessed Water", "💧", 0, "epic", [{ heal: 0.1, to: "ally" }, { mana: 1 }], true],
    divinehymn: ["Divine Hymn", "🎶", 3, "legendary", [{ heal: 0.2, to: "party" }, { block: 6, to: "party" }]],
    heavenswrath: ["Wrath of Heaven", "🌤️", 3, "legendary", [{ hit: 1.3, to: "all", bonusIf: "undead", bonus: 2.6 }, { heal: 0.08 }]],
    // (4 mana)
    sacredflame: ["Sacred Flame", "🕯️", 4, "epic", [{ hit: 2.2, bonusIf: "undead", bonus: 4.4 }, { heal: 0.12, to: "party" }]],
    salvation: ["Salvation", "🕊️", 4, "legendary", [{ heal: 0.35, to: "party" }, { cleanse: true, to: "party" }, { block: 8, to: "party" }], true],
    // (the second set: ATONEMENT - holy blows that heal the weakest ally or the party - and blows harder after a
    // heal this turn)
    atonement: ["Atonement", "✝️", 1, "common", [{ hit: 0.8, drain: 0.4, drainTo: "weakest" }]],
    searinglight: ["Searing Light", "🔦", 1, "common", [{ hit: 0.8, bonusIf: "healed", bonus: 1.6 }]],
    penitentstrike: ["Penitent Strike", "🛐", 1, "common", [{ heal: 0.06, to: "weakest" }, { hit: 0.6, bonusIf: "healed", bonus: 1.1 }]],
    mercy: ["Mercy", "🤲", 1, "common", [{ heal: 0.1, to: "weakest" }, { draw: 1 }]],
    lightlash: ["Light Lash", "〰️", 0, "common", [{ hit: 0.4, drain: 0.5, drainTo: "weakest" }]],
    holyrain: ["Holy Rain", "🌧️", 2, "common", [{ hit: 0.5, to: "all", drain: 0.3, drainTo: "party" }]],
    faithfulstrike: ["Faithful Strike", "🙌", 1, "common", [{ hit: 1, bonusIf: "healed|undead", bonus: 1.8 }]],
    lighttouch: ["Light Touch", "🫳", 0, "common", [{ heal: 0.05, to: "ally" }, { draw: 1 }]],
    censure: ["Censure", "📖", 1, "common", [{ hit: 0.7, drain: 0.4 }, { status: "burn", turns: 1 }]],
    kindlefaith: ["Kindle Faith", "🔥", 1, "common", [{ heal: 0.06, to: "party" }, { might: 1 }]],
    punishment: ["Divine Punishment", "⚡", 2, "rare", [{ hit: 1.5, bonusIf: "healed", bonus: 2.6 }]],
    bloodoffering: ["Blood Offering", "🩸", 1, "rare", [{ lose: 0.06 }, { heal: 0.14, to: "party" }]],
    lightsiphon: ["Light Siphon", "🌀", 1, "rare", [{ hit: 0.9, drain: 0.4, drainTo: "weakest" }, { draw: 1 }]],
    wrathfulprayer: ["Wrathful Prayer", "🌩️", 1, "rare", [{ hit: 0.6, to: "all", bonusIf: "healed", bonus: 1.1 }]],
    halo: ["Halo", "😇", 1, "rare", [{ aura: "regen", heal: 0.04, turns: 2, to: "party" }, { draw: 1 }]],
    judgementray: ["Ray of Judgement", "🔆", 2, "rare", [{ hit: 1.2, drain: 0.5, drainTo: "party" }]],
    shepherdsstaff: ["Shepherd's Staff", "🦯", 1, "rare", [{ hit: 0.5, times: 2, drain: 0.3, drainTo: "weakest" }]],
    chorus: ["Chorus", "🎼", 1, "rare", [{ heal: 0.06, to: "party" }, { might: 1, to: "party" }]],
    hallowedlight: ["Hallowed Light", "💡", 2, "rare", [{ hit: 0.7, to: "all", bonusIf: "undead", bonus: 1.6, drain: 0.2, drainTo: "party" }]],
    litany: ["Litany", "📃", 1, "rare", [{ hit: 0.9, bonusIf: "healed", bonus: 1.6 }, { heal: 0.06, to: "weakest" }]],
    absolution: ["Absolution", "🫧", 2, "epic", [{ hit: 1.4, drain: 0.6, drainTo: "weakest" }]],
    holyvengeance: ["Holy Vengeance", "🗡️", 2, "epic", [{ hit: 1.6, bonusIf: "healed", bonus: 2.8 }, { heal: 0.05, to: "party" }]],
    lightwell: ["Lightwell", "🪔", 1, "epic", [{ aura: "regen", heal: 0.05, turns: 3, to: "party" }, { hit: 0.5, to: "all" }], true],
    sacredbond: ["Sacred Bond", "💞", 1, "epic", [{ heal: 0.15, to: "weakest" }, { block: 6, to: "party" }]],
    seraphswing: ["Seraph's Wing", "🕊️", 1, "epic", [{ hit: 0.6, to: "all", drain: 0.4, drainTo: "party" }]],
    finalrites: ["Final Rites", "⚱️", 3, "epic", [{ hit: 2, bonusIf: "undead|healed", bonus: 3.4 }, { heal: 0.1, to: "weakest" }]],
    lifetransfer: ["Life Transfer", "🧬", 1, "epic", [{ hit: 1, drain: 0.8, drainTo: "weakest" }], true],
    divineinsight: ["Divine Insight", "🔭", 0, "epic", [{ heal: 0.06 }, { draw: 2 }], true],
    lightsjudgement: ["Light's Judgement", "🏵️", 3, "legendary", [{ hit: 1.4, to: "all", drain: 0.5, drainTo: "party" }]],
    archangel: ["Archangel", "🧚", 2, "legendary", [{ heal: 0.2, to: "party" }, { might: 2, to: "party" }, { draw: 1 }], true],
    holystorm: ["Holy Storm", "🌪️", 2, "legendary", [{ hit: 0.6, to: "random", times: 4, drain: 0.3, drainTo: "weakest" }]],
    divinemandate: ["Divine Mandate", "🎗️", 2, "legendary", [{ hit: 2, bonusIf: "healed", bonus: 3.6 }]],
    lifebloom: ["Lifebloom", "🌸", 1, "legendary", [{ aura: "regen", heal: 0.07, turns: 3, to: "party" }, { cleanse: true, to: "party" }], true],
    dayoflight: ["Day of Light", "🔆", 2, "mythic", [{ hit: 2.5, to: "all", drain: 0.6, drainTo: "party" }], "mythic"],
    eternallight: ["Eternal Light", "🕯️", 1, "mythic", [{ heal: 0.4, to: "party" }, { aura: "regen", heal: 0.08, turns: 4, to: "party" }], "mythic"],
  },
  rogue: {
    preparation: ["Preparation", "🎒", 0, "common", [{ mana: 1 }, { block: 3, agi: 0.2 }], true],
    shadowveil: ["Shadow Veil", "🌫️", 1, "rare", [{ aura: "guard", block: 4, agi: 0.3, turns: 3 }]],
    shiv: ["Shiv", "🪡", 0, "common", [{ hit: 0.5 }]],
    deadlypoison: ["Deadly Poison", "🐍", 1, "common", [{ status: "poison", turns: 4 }]],
    sneakattack: ["Sneak Attack", "🥷", 1, "common", [{ hit: 0.9, bonusIf: "poison|stun", bonus: 2.2 }]],
    dodgeroll: ["Dodge and Roll", "🤸", 1, "common", [{ block: 7, agi: 0.5 }]],
    nightcut: ["Night Cut", "🌘", 0, "common", [{ hit: 0.45, bonusIf: "combo", bonus: 1.3 }]],
    slice: ["Slice", "✂️", 0, "common", [{ hit: 0.6 }]],
    garrote: ["Garrote", "🪢", 1, "common", [{ hit: 0.7 }, { status: "poison", turns: 2 }]],
    caltrops: ["Caltrops", "📌", 1, "common", [{ hit: 0.3, to: "all" }, { status: "poison", turns: 2, to: "all" }]],
    pickpocket: ["Pickpocket", "🫳", 1, "common", [{ hit: 0.6 }, { draw: 1 }]],
    bladedance: ["Blade Dance", "💃", 1, "rare", [{ hit: 0.35, to: "random", times: 4 }]],
    noxious: ["Noxious Fumes", "🌫️", 1, "rare", [{ status: "poison", turns: 3, to: "all" }]],
    ambush: ["Ambush", "🌑", 2, "rare", [{ hit: 2, bonusIf: "poison|stun", bonus: 3 }]],
    vanish: ["Vanish", "🫥", 1, "rare", [{ evade: true }, { draw: 2 }], true],
    crippling: ["Crippling Cloud", "☁️", 2, "rare", [{ status: "poison", turns: 3, to: "all" }, { draw: 1 }]],
    footwork: ["Footwork", "👟", 1, "rare", [{ block: 5, agi: 1 }, { might: 1 }]],
    rush: ["Adrenaline Rush", "⚡", 0, "epic", [{ mana: 1 }, { draw: 2 }], true],
    corpseexplosion: ["Corpse Explosion", "💣", 2, "epic", [{ hit: 1, to: "all", bonusIf: "poison", bonus: 2 }]],
    shadowclone: ["Shadow Clone", "👥", 2, "legendary", [{ hit: 0.5, to: "random", times: 6 }], true],
    assassinate: ["Assassinate", "🎯", 3, "legendary", [{ hit: 2.6, bonusIf: "poison", bonus: 4 }]],
    fanofknives: ["Fan of Knives", "🪭", 3, "legendary", [{ hit: 0.6, to: "all", times: 2 }, { status: "poison", turns: 3, to: "all" }]],
    shadowdance: ["Shadow Dance", "🌘", 1, "legendary", [{ evade: true }, { draw: 3 }, { mana: 1 }], true],
    scorpionkiss: ["Scorpion's Kiss", "🦂", 2, "mythic", [{ status: "poison", turns: 6, to: "all" }, { hit: 1, to: "all", bonusIf: "poison", bonus: 2.5 }], "mythic"],
    masquerade: ["Masquerade", "🎭", 2, "mythic", [{ hit: 0.8, to: "random", times: 8 }], "mythic"],
    quickhands: ["Quick Hands", "🖐️", 0, "rare", [{ draw: 2 }, { hit: 0.3 }]],
    rupture: ["Rupture", "💉", 1, "rare", [{ hit: 0.8 }, { status: "poison", turns: 2 }]],
    feint: ["Feint", "🎭", 1, "rare", [{ block: 5, agi: 0.5 }, { draw: 1 }]],
    twinfangs: ["Twin Fangs", "🐍", 1, "epic", [{ hit: 0.6, times: 2 }, { status: "poison", turns: 2 }]],
    bladeflurry: ["Blade Flurry", "🔪", 3, "epic", [{ hit: 0.5, to: "random", times: 4 }]],
    shadowstrike: ["Shadow Strike", "🌘", 1, "epic", [{ hit: 1.3, bonusIf: "poison|stun", bonus: 2.4 }]],
    toxiccloud: ["Toxic Cloud", "🟢", 1, "epic", [{ status: "poison", turns: 3, to: "all" }]],
    evasion: ["Evasion", "🦘", 1, "epic", [{ evade: true }, { draw: 1 }], true],
    cheapshot: ["Cheap Shot", "🥾", 1, "epic", [{ hit: 0.7 }, { status: "stun" }]],
    lacerate: ["Lacerate", "🩸", 1, "epic", [{ hit: 0.9 }, { extend: 2 }]],
    shadowdeath: ["Death From Shadows", "🌑", 3, "legendary", [{ hit: 2.4, bonusIf: "poison|stun", bonus: 3.6 }]],
    venomstorm: ["Venom Storm", "☠️", 2, "legendary", [{ status: "poison", turns: 4, to: "all" }, { amplify: true, to: "all" }], true],
    // (4 mana)
    massacre: ["Massacre", "🩸", 4, "legendary", [{ hit: 0.9, to: "all", times: 2 }, { status: "poison", turns: 4, to: "all" }]],
    kingslayer: ["Kingslayer", "👑", 4, "epic", [{ hit: 3.2, bonusIf: "poison|stun", bonus: 4.6 }]],
    // (the second set: SHIVS - blades made in the fight, gone once thrown - and CHAIN blows, harder after two
    // cards this turn)
    knifetoss: ["Knife Toss", "🗡️", 1, "common", [{ hit: 0.5 }, { conjure: "shiv", n: 1 }]],
    cloakanddagger: ["Cloak and Dagger", "🧥", 1, "common", [{ block: 5, agi: 0.4 }, { conjure: "shiv", n: 1 }]],
    finishingblow: ["Finishing Blow", "✒️", 1, "common", [{ hit: 0.8, bonusIf: "chain", bonus: 1.8 }]],
    bladestash: ["Blade Stash", "🧰", 1, "common", [{ conjure: "shiv", n: 2 }]],
    tempo: ["Tempo", "⏱️", 0, "common", [{ hit: 0.3, bonusIf: "chain", bonus: 0.9 }, { draw: 1 }]],
    taintedblade: ["Tainted Blade", "🦠", 1, "common", [{ conjure: "shiv", n: 1 }, { status: "poison", turns: 2 }]],
    countercut: ["Counter Cut", "🔁", 1, "common", [{ block: 4, agi: 0.5 }, { hit: 0.5, bonusIf: "chain", bonus: 1.2 }]],
    pocketsand: ["Pocket Sand", "🏖️", 0, "common", [{ status: "chill", turns: 1 }, { conjure: "shiv", n: 1 }]],
    combination: ["Combination", "🔢", 1, "common", [{ hit: 0.4, times: 2, bonusIf: "chain", bonus: 0.9 }]],
    bleedout: ["Bleed Out", "🩸", 1, "common", [{ hit: 0.6, bonusIf: "chain", bonus: 1 }, { status: "poison", turns: 2 }]],
    bladefan: ["Blade Fan", "🎐", 2, "rare", [{ hit: 0.5, to: "all" }, { conjure: "shiv", n: 2 }]],
    flowingstrikes: ["Flowing Strikes", "🌊", 1, "rare", [{ hit: 0.35, to: "random", times: 3, bonusIf: "chain", bonus: 0.7 }]],
    cutthroat: ["Cutthroat", "🔪", 2, "rare", [{ hit: 1.4, bonusIf: "chain", bonus: 2.8 }]],
    hiddenarmory: ["Hidden Armory", "🗄️", 1, "rare", [{ conjure: "shiv", n: 3 }], true],
    shadowplay: ["Shadow Play", "🃏", 0, "rare", [{ draw: 2 }, { conjure: "shiv", n: 1 }], true],
    toxicrhythm: ["Toxic Rhythm", "🥁", 1, "rare", [{ hit: 0.4, bonusIf: "chain", bonus: 1.2 }, { status: "poison", turns: 3 }]],
    momentum: ["Momentum", "🛼", 1, "rare", [{ mana: 1 }, { hit: 0.4, bonusIf: "chain", bonus: 1 }], true],
    venomshivs: ["Venom Shivs", "🐍", 1, "rare", [{ conjure: "shiv", n: 2 }, { status: "poison", turns: 2, to: "random" }]],
    crescendo: ["Crescendo", "🎻", 2, "rare", [{ hit: 0.6, to: "all", bonusIf: "chain", bonus: 1.2 }]],
    ricochet: ["Ricochet", "🏓", 1, "rare", [{ hit: 0.4, to: "random", times: 2 }, { conjure: "shiv", n: 1 }]],
    thousandcuts: ["Thousand Cuts", "🌫️", 2, "epic", [{ hit: 0.3, to: "random", times: 5, bonusIf: "chain", bonus: 0.55 }]],
    kniferain: ["Knife Rain", "🌧️", 2, "epic", [{ conjure: "shiv", n: 3 }, { hit: 0.4, to: "all" }]],
    deathblossom: ["Death Blossom", "🌺", 2, "epic", [{ hit: 0.7, to: "all", bonusIf: "chain", bonus: 1.4 }, { status: "poison", turns: 2, to: "all" }]],
    phantomblade: ["Phantom Blade", "🗡️", 1, "epic", [{ hit: 1.1, bonusIf: "chain", bonus: 2.4 }, { draw: 1 }]],
    quickdraw: ["Quick Draw", "🤠", 0, "epic", [{ conjure: "shiv", n: 2 }, { draw: 1 }], true],
    nightfall: ["Nightfall", "🌒", 1, "epic", [{ evade: true }, { conjure: "shiv", n: 2 }], true],
    markedfordeath: ["Marked for Death", "🎯", 1, "epic", [{ status: "exposed", turns: 2 }, { conjure: "shiv", n: 1 }]],
    shadowrhythm: ["Shadow Rhythm", "🌑", 1, "epic", [{ block: 6, agi: 0.8 }, { hit: 0.5, bonusIf: "chain", bonus: 1.2 }]],
    kingofblades: ["King of Blades", "🤴", 2, "legendary", [{ conjure: "shiv", n: 4 }], true],
    perfectchain: ["Perfect Chain", "⛓️", 2, "legendary", [{ hit: 1.8, bonusIf: "chain", bonus: 4 }]],
    eclipse: ["Eclipse", "🕳️", 3, "legendary", [{ hit: 0.8, to: "all", times: 2, bonusIf: "chain", bonus: 1.4 }]],
    venomdance: ["Venom Dance", "🕺", 1, "legendary", [{ hit: 0.4, to: "random", times: 4 }, { status: "poison", turns: 2, to: "all" }, { conjure: "shiv", n: 1 }]],
    silentreaper: ["Silent Reaper", "🤫", 4, "legendary", [{ hit: 3, bonusIf: "chain|poison", bonus: 5 }]],
    infiniteblades: ["Infinite Blades", "🌀", 1, "mythic", [{ conjure: "shiv", n: 6 }, { mana: 1 }], "mythic"],
    grandfinale: ["Grand Finale", "💥", 2, "mythic", [{ hit: 2, to: "all", bonusIf: "chain", bonus: 5 }], "mythic"],
  },
  mage: {
    arcaneaura: ["Arcane Aura", "🔷", 1, "epic", [{ aura: "focus", mana: 1, turns: 3 }], true],
    firebolt: ["Fire Bolt", "🌶️", 1, "common", [{ hit: 0.8 }, { status: "burn", turns: 2 }]],
    frostnova: ["Frost Nova", "💠", 1, "common", [{ status: "chill", turns: 2, to: "all" }, { block: 4 }]],
    missile: ["Magic Missile", "🪄", 1, "common", [{ hit: 0.4, to: "random", times: 3 }]],
    manashield: ["Mana Shield", "🔷", 1, "common", [{ block: 6, atk: 0.5 }]],
    scorch: ["Scorch", "🥵", 1, "common", [{ hit: 1, bonusIf: "burn", bonus: 1.8 }]],
    intellect: ["Arcane Intellect", "📘", 1, "common", [{ draw: 2 }]],
    ignite: ["Ignite", "🧨", 0, "common", [{ status: "burn", turns: 3 }]],
    icelance: ["Ice Lance", "🔱", 1, "common", [{ hit: 0.8, bonusIf: "chill", bonus: 2 }]],
    flamestrike: ["Flamestrike", "🎆", 2, "rare", [{ hit: 1, to: "all" }, { status: "burn", turns: 1, to: "all" }]],
    coneofcold: ["Cone of Cold", "🍦", 2, "rare", [{ hit: 0.6, to: "all" }, { status: "chill", turns: 1, to: "all" }]],
    barrage: ["Arcane Barrage", "🌀", 2, "rare", [{ hit: 0.55, to: "random", times: 4 }]],
    polymorph: ["Polymorph", "🐑", 1, "rare", [{ status: "stun", turns: 1 }, { status: "chill", turns: 3 }], true],
    mirrorimage: ["Mirror Image", "🪞", 1, "rare", [{ block: 9, atk: 0.5 }, { draw: 1 }]],
    evocation: ["Evocation", "🌌", 1, "rare", [{ mana: 2 }], true],
    pyroblast: ["Pyroblast", "☄️", 3, "legendary", [{ hit: 3.5 }]],
    glacialspike: ["Glacial Spike", "🏔️", 2, "epic", [{ hit: 1.6, bonusIf: "chill", bonus: 3 }]],
    arcanepower: ["Arcane Power", "✳️", 1, "epic", [{ might: 3 }, { draw: 1 }], true],
    firestorm: ["Firestorm", "🏮", 3, "legendary", [{ hit: 1.2, to: "all" }, { status: "burn", turns: 3, to: "all" }]],
    supernova: ["Supernova", "🌞", 3, "legendary", [{ hit: 2.2, to: "all" }]],
    absolutezero: ["Absolute Zero", "🥶", 2, "legendary", [{ status: "chill", turns: 3, to: "all" }, { block: 15, atk: 0.5 }]],
    armageddon: ["Armageddon", "☢️", 3, "mythic", [{ hit: 3, to: "all" }, { status: "burn", turns: 3, to: "all" }], "mythic"],
    ascendance: ["Arcane Ascendance", "🔯", 0, "mythic", [{ mana: 3 }, { draw: 3 }, { might: 3 }], "mythic"],
    flamejet: ["Flame Jet", "🔥", 1, "rare", [{ hit: 0.9 }, { status: "burn", turns: 2 }]],
    staticfield: ["Static Field", "🌀", 1, "rare", [{ hit: 0.4, to: "all" }, { draw: 1 }]],
    blink: ["Blink", "🌟", 1, "rare", [{ block: 6 }, { draw: 2 }]],
    frostbite: ["Frostbite", "🥶", 1, "rare", [{ hit: 0.8 }, { status: "chill", turns: 2 }]],
    spellecho: ["Spell Echo", "🔮", 1, "rare", [{ hit: 0.55, to: "all", bonusIf: "combo", bonus: 1.2 }]],
    firewave: ["Fire Wave", "🌊", 2, "epic", [{ hit: 1, to: "all" }, { status: "burn", turns: 1, to: "all" }]],
    iceshards: ["Ice Shards", "❄️", 1, "epic", [{ hit: 0.5, times: 3 }, { status: "chill", turns: 1 }]],
    arcanesurge: ["Arcane Surge", "🔷", 0, "epic", [{ mana: 2 }, { draw: 1 }], true],
    lightningbolt: ["Lightning Bolt", "⚡", 1, "epic", [{ hit: 1.5, bonusIf: "chill", bonus: 2.5 }]],
    combustion: ["Combustion", "💥", 2, "epic", [{ hit: 2, bonusIf: "burn", bonus: 3 }]],
    frostward: ["Frost Ward", "🛡️", 1, "epic", [{ block: 8, atk: 0.5 }, { status: "chill", turns: 1, to: "all" }]],
    meteorshower: ["Meteor Shower", "☄️", 3, "legendary", [{ hit: 0.9, to: "random", times: 5 }, { status: "burn", turns: 2, to: "all" }]],
    frozentomb: ["Frozen Tomb", "🧊", 2, "legendary", [{ status: "stun", to: "all" }, { status: "chill", turns: 2, to: "all" }], true],
    // (4 mana: a finisher - it needs a mana card, a mana relic or a camp fire first)
    inferno: ["Inferno", "🔥", 4, "epic", [{ hit: 1.8, to: "all" }, { status: "burn", turns: 3, to: "all" }]],
    deepfreeze: ["Deep Freeze", "🧊", 4, "legendary", [{ hit: 1.5, to: "all" }, { status: "chill", turns: 3, to: "all" }, { status: "stun", to: "all" }], true],
    // (the second set: SHATTER and DETONATE - a chilled or burning foe takes a big blow that ends the state -
    // FROSTFIRE on a foe both burning and chilled, and conjured Sparks)
    shatter: ["Shatter", "💎", 1, "common", [{ hit: 0.8, bonusIf: "chill", bonus: 2, consume: true }]],
    detonate: ["Detonate", "🎇", 1, "common", [{ hit: 0.7, bonusIf: "burn", bonus: 1.9, consume: true }]],
    frostfirebolt: ["Frostfire Bolt", "🌗", 1, "common", [{ hit: 0.8, bonusIf: "burn&chill", bonus: 2.2 }]],
    kindling: ["Kindling", "🌡️", 0, "common", [{ status: "burn", turns: 2 }, { draw: 1 }]],
    rimeshield: ["Rime Shield", "🌫️", 1, "common", [{ status: "chill", turns: 2 }, { block: 5, atk: 0.3 }]],
    conjuresparks: ["Conjure Sparks", "✴️", 1, "common", [{ conjure: "spark", n: 2 }]],
    thermalshock: ["Thermal Shock", "🔺", 1, "common", [{ status: "burn", turns: 2 }, { status: "chill", turns: 1 }]],
    arcaneecho: ["Arcane Echo", "🔈", 1, "common", [{ hit: 0.6 }, { conjure: "spark", n: 1 }]],
    frozenorb: ["Frozen Orb", "🔵", 2, "common", [{ hit: 0.6, to: "all", bonusIf: "chill", bonus: 1.2 }]],
    cinderburst: ["Cinder Burst", "🟠", 2, "common", [{ hit: 0.6, to: "all", bonusIf: "burn", bonus: 1.2 }]],
    manaward: ["Mana Ward", "🟦", 1, "common", [{ block: 6, atk: 0.5 }, { conjure: "spark", n: 1 }]],
    glassstorm: ["Glass Storm", "🌬️", 2, "rare", [{ hit: 0.6, to: "all", bonusIf: "chill", bonus: 1.5, consume: true }]],
    pyroclasm: ["Pyroclasm", "🌋", 2, "rare", [{ hit: 0.6, to: "all", bonusIf: "burn", bonus: 1.5, consume: true }]],
    frostfirenova: ["Frostfire Nova", "🌓", 2, "rare", [{ status: "burn", turns: 2, to: "all" }, { status: "chill", turns: 1, to: "all" }]],
    arcaneflurry: ["Arcane Flurry", "🎑", 1, "rare", [{ conjure: "spark", n: 3 }], true],
    steamblast: ["Steam Blast", "🌁", 1, "rare", [{ hit: 1, bonusIf: "burn&chill", bonus: 2.6 }]],
    mirrorshards: ["Mirror Shards", "🔹", 1, "rare", [{ hit: 0.4, to: "random", times: 3, bonusIf: "chill", bonus: 0.8 }]],
    wildmagic: ["Wild Magic", "🎰", 1, "rare", [{ hit: 0.5, to: "random", times: 2 }, { status: "burn", turns: 1, to: "random" }, { status: "chill", turns: 1, to: "random" }]],
    cryoshell: ["Cryo Shell", "🐚", 1, "rare", [{ block: 8, atk: 0.5 }, { status: "chill", turns: 2, to: "random" }]],
    overload: ["Overload", "🔌", 0, "rare", [{ mana: 1 }, { conjure: "spark", n: 1 }], true],
    arcanebrand: ["Arcane Brand", "🏷️", 1, "rare", [{ status: "burn", turns: 3 }, { status: "exposed", turns: 1 }]],
    shatterpoint: ["Shatterpoint", "🔶", 2, "epic", [{ hit: 1.6, bonusIf: "chill", bonus: 3.6, consume: true }]],
    conflagrate: ["Conflagrate", "🔥", 2, "epic", [{ hit: 1.4, bonusIf: "burn", bonus: 3.2, consume: true }]],
    elementalfury: ["Elemental Fury", "🌀", 3, "epic", [{ hit: 1.1, to: "all", bonusIf: "burn&chill", bonus: 2.2 }]],
    sparkstorm: ["Spark Storm", "⛈️", 2, "epic", [{ conjure: "spark", n: 3 }, { draw: 1 }], true],
    polarity: ["Polarity", "🧲", 1, "epic", [{ status: "burn", turns: 3 }, { status: "chill", turns: 2 }, { draw: 1 }]],
    frostbinding: ["Frost Binding", "⛓️", 2, "epic", [{ status: "chill", turns: 3, to: "all" }, { block: 8, atk: 0.6 }]],
    arcaneconduit: ["Arcane Conduit", "📡", 1, "epic", [{ aura: "focus", mana: 1, turns: 2 }, { conjure: "spark", n: 1 }], true],
    meltdown: ["Meltdown", "🫠", 2, "epic", [{ hit: 0.9, to: "all", bonusIf: "chill", bonus: 1.8, consume: true }, { status: "burn", turns: 2, to: "all" }]],
    frostfirecomet: ["Frostfire Comet", "☄️", 3, "legendary", [{ hit: 2.4, bonusIf: "burn&chill", bonus: 4.8 }]],
    heatdeath: ["Heat Death", "🌡️", 3, "legendary", [{ hit: 1.2, to: "all", bonusIf: "burn", bonus: 2.6, consume: true }]],
    glacier: ["Glacier", "🏔️", 3, "legendary", [{ hit: 1.2, to: "all", bonusIf: "chill", bonus: 2.6, consume: true }, { block: 10, atk: 0.5 }]],
    sparkweaver: ["Sparkweaver", "🕸️", 1, "legendary", [{ conjure: "spark", n: 3 }, { mana: 1 }], true],
    twinelements: ["Twin Elements", "♊", 2, "legendary", [{ status: "burn", turns: 3, to: "all" }, { status: "chill", turns: 2, to: "all" }, { draw: 1 }], true],
    singularity: ["Singularity", "🕳️", 3, "mythic", [{ hit: 2, to: "all", bonusIf: "burn|chill", bonus: 4.5, consume: true }], "mythic"],
    arcanecascade: ["Arcane Cascade", "🌊", 0, "mythic", [{ conjure: "spark", n: 5 }, { mana: 2 }], "mythic"],
  },
};

/* ---------- The text of a card, written from its effects ---------- */

const pct = (value) => Math.round(value * 100) + "%";
// (a condition - or more of them, "poison|stun": any of them)
const ifText = (cond) => {
  // ("burn&chill": a burning and chilled foe)
  if (cond.includes("&")) return "on a " + cond.split("&").map((one) => STATUS[one][1]).join(" and ") + " foe";
  if (!cond.includes("|")) return IF[cond];
  const parts = cond.split("|").map((one) => IF[one]);
  // ("against the undead or a boss" - "on a poisoned or stunned foe" - "on a stunned foe or against the undead")
  if (parts.every((one) => one.startsWith("against "))) return "against " + parts.map((one) => one.replace(/^against /, "")).join(" or ");
  if (parts.every((one) => /^on a .* foe$/.test(one))) return "on a " + parts.map((one) => one.replace(/^on a | foe$/g, "")).join(" or ") + " foe";
  return parts.join(" or ");
};
const IF = { poison: "on a poisoned foe", burn: "on a burning foe", chill: "on a chilled foe", stun: "on a stunned foe", exposed: "on an exposed foe", undead: "against the undead", boss: "against a boss", called: "against a summoned foe", low: "while you are below half HP", combo: "if you played a skill this turn", guarded: "while you have block", healed: "if you healed this turn", chain: "if you played 2 other cards this turn" };
const STATUS = {
  poison: ["poison", "poisoned"],
  burn: ["burn", "burning"],
  chill: ["chill", "chilled"],
  stun: ["stun", "stunned"],
  exposed: ["expose", "exposed"],
};
// (what the end of a state is called: a shatter ends the chill)
const ENDS = { poison: "its poison", burn: "its burn", chill: "its chill", stun: "its stun", exposed: "the exposure" };
// The name of a card by its id (a card made in a fight: its name in the text)
const nameOf = (id) => {
  for (const list of [BASE, NEUTRAL, ...Object.values(CLASS)]) if (list[id]) return list[id][0];
  return id;
};

function amount(fx) {
  const parts = [String(fx.block)];
  if (fx.def) parts.push(fx.def == 1 ? "your armor" : pct(fx.def) + " of your armor");
  if (fx.atk) parts.push(pct(fx.atk) + " of your attack");
  if (fx.agi) parts.push(fx.agi == 0.5 ? "half your dodge" : fx.agi == 1 ? "your dodge" : pct(fx.agi) + " of your dodge");
  return parts.join(" + ");
}

function phrase(fx, n) {
  if (fx.aura) {
    const who = fx.to == "party" ? "the party " : "";
    const each = fx.aura == "guard" ? who + (who ? "blocks " : "block ") + (n && n.block ? n.block(fx) : amount(fx)) : fx.aura == "regen" ? who + (who ? "heals " : "heal ") + (n && n.heal ? n.heal(fx.heal) + " HP" : pct(fx.heal) + " of your max HP") : "+" + fx.mana + " mana";
    // (an aura works from the next turn on - it says so)
    return each + " at the start of your next " + fx.turns + " turns";
  }
  if (fx.hit != null) {
    let text = "deal " + (n ? n.dmg(fx.hit, fx) : pct(fx.hit)) + " damage";
    if (fx.def && !n) text += " + " + (fx.def == 1 ? "your armor" : pct(fx.def) + " of your armor");
    if (fx.to == "all") text += " to every foe";
    if (fx.to == "random") text += " to a random foe";
    if (fx.times) text += fx.times == 2 ? " twice" : " " + fx.times + " times";
    if (fx.bonusIf) text += ", or " + (n ? n.dmg(fx.bonus, fx) : pct(fx.bonus)) + " " + ifText(fx.bonusIf);
    if (fx.bonusIf && fx.consume) text += ", which ends " + fx.bonusIf.split(/[|&]/).map((one) => ENDS[one]).join(" and ");
    if (fx.fromBlock) text = "deal your block as damage, min " + (n ? n.dmg(fx.hit, fx) : pct(fx.hit));
    if (fx.execute) text = "a foe below " + pct(fx.execute) + " HP dies (no boss), else " + text.replace(/^deal /, "");
    if (fx.drain) text += ", " + (fx.drainTo == "weakest" ? "the weakest ally heals " : fx.drainTo == "party" ? "the party heals " : "heal ") + pct(fx.drain) + " of the damage dealt";
    return text;
  }
  if (fx.thorns != null) {
    const value = n && n.thorns ? n.thorns(fx) : String(fx.thorns) + (fx.def ? " + " + (fx.def == 1 ? "your armor" : pct(fx.def) + " of your armor") : "");
    return "for " + fx.turns + " turn" + (fx.turns == 1 ? "" : "s") + ", a foe that hits " + (fx.to == "party" ? "the party" : "you") + " takes " + value + " as damage";
  }
  if (fx.conjure) return "add " + (fx.n == 1 ? "a " + nameOf(fx.conjure) : fx.n + " " + nameOf(fx.conjure) + "s") + " to your hand, gone once played";
  if (fx.status == "exposed") {
    const turns = " take" + (fx.to == "all" ? "" : "s") + " 25% more damage for " + (fx.turns || 2) + " turn" + ((fx.turns || 2) == 1 ? "" : "s");
    return fx.to == "all" ? "expose every foe, they" + turns : fx.to == "random" ? "expose a random foe, it" + turns : "expose it, it" + turns;
  }
  if (fx.block != null) {
    const value = n ? n.block(fx) : amount(fx);
    const low = fx.low ? ", " + (fx.low == 2 ? "twice" : fx.low + " times") + " as much while you are below half HP" : "";
    if (fx.to == "ally") return "you or an ally block " + value + low;
    if (fx.to == "party") return "the party blocks " + value + low;
    return "block " + value + low;
  }
  if (fx.heal != null) {
    const value = n ? n.heal(fx.heal) + " HP" : pct(fx.heal) + " of your max HP";
    if (fx.to == "ally") return "you or an ally heal " + value;
    if (fx.to == "party") return "the party heals " + value;
    if (fx.to == "weakest") return "the weakest ally heals " + value;
    return "heal " + value;
  }
  if (fx.status) {
    const [verb] = STATUS[fx.status];
    const whom = fx.to == "all" ? "every foe" : fx.to == "random" ? "a random foe" : "it";
    const turns = fx.status == "stun" ? "" : " for " + (fx.turns || 1) + (fx.status == "chill" ? " move" : " turn") + ((fx.turns || 1) == 1 ? "" : "s");
    return verb + " " + whom + turns;
  }
  if (fx.might != null) {
    const who = fx.to == "ally" ? "an ally deals" : fx.to == "party" ? "the party deals" : "deal";
    return who + " 30% more damage for " + fx.might + " turn" + (fx.might == 1 ? "" : "s");
  }
  if (fx.draw != null) return (fx.to == "party" ? "everyone draws " : "draw ") + fx.draw + " card" + (fx.draw == 1 ? "" : "s");
  if (fx.mana != null) return "+" + fx.mana + " mana";
  if (fx.lose != null) return "lose " + (n ? n.lose(fx.lose) : pct(fx.lose)) + " HP";
  if (fx.evade) return "nothing hits you this turn";
  if (fx.taunt) return "taunt all foes this turn, take 30% less";
  if (fx.revive != null) return (fx.to == "all" ? "every fallen ally stands up" : "a fallen ally stands up") + " with " + pct(fx.revive) + " HP";
  if (fx.cleanse) return (fx.to == "ally" ? "you or an ally lose" : "lose") + " poison and burns";
  if (fx.extend != null) return "its poison lasts " + fx.extend + " turns longer";
  if (fx.amplify) return "double the poison on every foe and make it last 3 turns longer";
  return "";
}

// (exhaust: true - gone for the fight; "mythic" - in the hand from the start of every fight, gone for it once played)
// (n: the numbers of a character - its damage, block, healing - instead of the shares)
function textOf(fx, exhaust, n) {
  const text = fx.map((one) => phrase(one, n)).filter(Boolean).join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1) + "." + (exhaust == "mythic" ? " Mythic." : exhaust ? " Exhaust." : "");
}

// What a card aims at: a foe (a hit or a state on one), an ally - or nothing to pick
function targetOf(fx) {
  if (fx.some((one) => one.revive != null && one.to != "all")) return "fallen";
  if (fx.some((one) => (one.hit != null || one.status || one.extend != null) && (!one.to || one.to == "foe"))) return "foe";
  if (fx.some((one) => one.to == "ally")) return "ally";
  return "none";
}

/* ---------- Balance: every card's numbers fit its cost and rarity ---------- */

// What a step is worth in "units" (1 unit: what 1 mana buys in a Strike - 100% damage to one foe); fixed: the
// part that isn't scaled (mana, cards, states)
const FOES = 2.2; // foes in a fight, on average (a hit to every foe)
const PARTY_WORTH = 2.8;
// How often a bonus condition is met (the share of its worth the bonus gets) - 0.25 when not listed
const OFTEN = { guarded: 0.35, chain: 0.4, healed: 0.6, exposed: 0.35 }; // a block or heal for the whole party: worth this many single ones
// How much a share of the armor in a block is worth (a share of 1: the hero's armor) - the Paladin's common cards
// count it higher, its armor makes them block far more early on than the other classes'
let defWorth = 0.3;
const DEF_WORTH = { paladin: { common: 0.55 } };
// (the Paladin's cards of the first set: CLASSES.paladin in game/rpg.js)
const BASE_OWNER = { paladin: ["taunt", "judgement", "holyshield", "consecrate", "bulwark", "righteous", "aegis", "retribution", "layhands"] };
function worth(fx) {
  if (fx.aura) return { scaled: 0, fixed: fx.turns * (fx.to == "party" ? PARTY_WORTH : 1) * (fx.aura == "focus" ? fx.mana : fx.aura == "regen" ? fx.heal / 0.12 : fx.block / 7 + (fx.def || 0) * 0.3 + (fx.agi || 0) * 0.05) * 0.7 };
  if (fx.hit != null) {
    // (a bonus on two states at once is met less often - one that ends the state: a bit less again)
    // (some are met most of the time by the class they are made for: block up, two cards before, a heal before)
    const met = fx.bonusIf ? Math.max(...fx.bonusIf.split("|").map((one) => OFTEN[one] || 0.25)) : 0;
    const often = fx.bonusIf && fx.bonusIf.includes("&") ? 0.15 : fx.consume ? met * 0.8 : met;
    const base = (fx.bonusIf ? fx.hit * (1 - often) + fx.bonus * often : fx.hit) * (fx.fromBlock ? 2 : 1) * (fx.execute ? 1.3 : 1);
    // (drain: the healing is worth a part of it - more when it heals the weakest or the party)
    const drain = fx.drain ? 1 + fx.drain * (fx.drainTo == "party" ? 1.6 : fx.drainTo == "weakest" ? 1.2 : 0.8) : 1;
    return { scaled: (base + (fx.def || 0) * 0.5) * (fx.times || 1) * (fx.to == "all" ? FOES * 0.75 : 1) * drain, fixed: 0 };
  }
  // (thorns: what comes back over the turns - from about two hits a turn)
  if (fx.thorns != null) return { scaled: 0, fixed: (fx.thorns / 10 + (fx.def || 0) * 0.45) * fx.turns * 0.5 * (fx.to == "party" ? PARTY_WORTH : 1) };
  if (fx.conjure) return { scaled: 0, fixed: 0.6 * fx.n };
  // (the whole party: worth more - in a party it covers 2 to 4 heroes)
  if (fx.block != null) return { scaled: (fx.block / 7 + (fx.def || 0) * defWorth + (fx.atk || 0) + (fx.agi || 0) * 0.05) * (fx.to == "party" ? PARTY_WORTH : 1) * (fx.low ? 1.4 : 1), fixed: 0 };
  if (fx.heal != null) return { scaled: (fx.heal / 0.12) * (fx.to == "party" ? PARTY_WORTH : 1), fixed: 0 };
  let fixed = 0;
  if (fx.status) fixed = { poison: 0.45, burn: 0.3, chill: 0.45, stun: 1, exposed: 0.35 }[fx.status] * (fx.status == "stun" ? 1 : fx.turns || 1) * (fx.to == "all" ? FOES * 0.75 : 1);
  else if (fx.might != null) fixed = 0.35 * fx.might * (fx.to == "party" ? PARTY_WORTH : 1);
  else if (fx.draw != null) fixed = 0.5 * fx.draw;
  else if (fx.mana != null) fixed = fx.mana;
  else if (fx.lose != null) fixed = (-fx.lose / 0.12) * 0.7;
  else if (fx.evade) fixed = 1.6;
  else if (fx.taunt) fixed = 0.6;
  else if (fx.revive != null) fixed = fx.revive * 5 * (fx.to == "all" ? 1.5 : 1);
  else if (fx.cleanse) fixed = 0.5;
  else if (fx.extend != null) fixed = 0.3 * fx.extend;
  else if (fx.amplify) fixed = 2.5;
  return { scaled: 0, fixed };
}

// What a card may be worth: its cost (a 0 cost card a bit), more the rarer, more when it is gone after one play
const RARITY_POWER = { basic: 1, common: 1, rare: 1.15, epic: 1.3, legendary: 1.5, mythic: 2 };
function budget(cost, rarity, exhaust) {
  return (Math.max(cost, 0.6) + 0.15) * RARITY_POWER[rarity] * (exhaust === true ? 1.3 : 1) * (exhaust == "mythic" ? 1.5 : 1);
}

// The damage, block and healing of a card scaled to its budget (at most 0.6x to 1.8x what was written) - cards
// that are mostly mana, cards or states stay as they are
function balanced(fx, cost, rarity, exhaust) {
  // (a block with nothing of the hero's stats in it: a part of the armor too - it grows with the character, as Defend
  // does; a pack card is never worse than a basic one later on)
  if (rarity != "basic") fx = fx.map((one) => (one.block != null && !one.def && !one.atk && !one.agi ? { ...one, block: Math.max(2, Math.round(one.block * 0.7)), def: 1 } : one));
  const parts = fx.map(worth);
  const scaled = parts.reduce((sum, p) => sum + p.scaled, 0);
  const fixed = parts.reduce((sum, p) => sum + p.fixed, 0);
  if (scaled < 0.5 || rarity == "basic") return fx;
  const k = Math.max(0.6, Math.min(1.8, (budget(cost, rarity, exhaust) - fixed) / scaled));
  const round = (value, step) => Math.round(value / step) * step;
  return fx.map((one) => {
    const out = { ...one };
    if (one.aura) return out;
    if (one.hit != null) {
      out.hit = round(one.hit * k, 0.05);
      if (one.bonus != null) out.bonus = round(one.bonus * k, 0.05);
      if (one.def) out.def = round(one.def * k, 0.05);
    } else if (one.block != null) {
      out.block = Math.max(1, Math.round(one.block * k));
      for (const key of ["def", "atk", "agi"]) if (one[key]) out[key] = round(one[key] * k, 0.05);
    } else if (one.heal != null) out.heal = round(one.heal * k, 0.01);
    return out;
  });
}

// The cards: {id: card} - with their rarity, the class ones per class, the neutral ones
function build(list, cls) {
  const cards = {};
  for (const [id, [name, icon, cost, rarity, written, exhaust]] of Object.entries(list)) {
    const owner = cls || Object.keys(BASE_OWNER).find((one) => BASE_OWNER[one].includes(id));
    defWorth = (DEF_WORTH[owner] && DEF_WORTH[owner][rarity]) || 0.3;
    const fx = balanced(written, cost, rarity, exhaust);
    defWorth = 0.3;
    cards[id] = { name, icon, cost, type: fx.some((one) => one.hit != null) ? "attack" : fx.some((one) => one.aura || (one.might != null && one.might > 1)) ? "aura" : "skill", target: targetOf(fx), exhaust: exhaust === true, mythic: exhaust == "mythic", rarity, fx, text: textOf(fx, exhaust) };
  }
  return cards;
}

const base = build(BASE);
const neutral = build(NEUTRAL);
const byClass = Object.fromEntries(Object.entries(CLASS).map(([cls, list]) => [cls, build(list, cls)]));

module.exports = {
  textOf,
  cards: Object.assign({}, base, neutral, ...Object.values(byClass)),
  neutral: Object.keys(neutral),
  classCards: Object.fromEntries(Object.entries(byClass).map(([cls, cards]) => [cls, Object.keys(cards)])),
};
