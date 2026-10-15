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
 * States for bonusIf: poison, burn, chill, stun, undead (the foe) - low (the hero below half HP)
 */

// The first cards of the game (the starter decks, the classes' own) - class membership: CLASSES in game/rpg.js
const BASE = {
  strike: ["Strike", "⚔️", 1, "basic", [{ hit: 1 }]],
  defend: ["Defend", "🛡️", 1, "basic", [{ block: 6, def: 1, to: "ally" }]],
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
  uppercut: ["Uppercut", "👊", 2, "common", [{ hit: 1 }, { status: "stun" }, { status: "chill", turns: 1 }]],
  whirlwind: ["Whirlwind", "🌪️", 2, "rare", [{ hit: 1.1, to: "all" }]],
  impervious: ["Impervious", "🗿", 2, "epic", [{ block: 25, def: 2 }], true],
  bloodlust: ["Bloodlust", "🩸", 0, "epic", [{ lose: 0.08 }, { mana: 2 }], true],
  taunt: ["Taunt", "📣", 1, "common", [{ taunt: true }, { block: 4, def: 1 }]],
  judgement: ["Judgement", "⚖️", 1, "common", [{ hit: 1, def: 1 }]],
  holyshield: ["Holy Shield", "🛡️", 2, "rare", [{ block: 5, def: 1, to: "party" }]],
  consecrate: ["Consecrate", "🕯️", 2, "rare", [{ hit: 0.5, to: "all" }, { heal: 0.05, to: "party" }]],
  righteous: ["Righteous Blow", "🔆", 2, "common", [{ hit: 1.6 }, { heal: 0.05 }]],
  aegis: ["Aegis", "🪬", 1, "common", [{ block: 12, def: 1, to: "ally" }]],
  retribution: ["Retribution", "⚜️", 1, "rare", [{ hit: 0.7, to: "all" }, { block: 4, def: 1 }]],
  layhands: ["Lay on Hands", "🤲", 2, "epic", [{ heal: 0.45, to: "ally" }], true],
  bulwark: ["Bulwark", "🏰", 1, "common", [{ block: 10, def: 2 }]],
  heal: ["Heal", "💚", 1, "common", [{ heal: 0.25, to: "ally" }]],
  smite: ["Smite", "🌟", 1, "common", [{ hit: 1.2, bonusIf: "undead", bonus: 2.5 }]],
  revive: ["Revive", "🕊️", 2, "epic", [{ revive: 0.4 }], true],
  prayer: ["Prayer", "🙏", 2, "rare", [{ heal: 0.12, to: "party" }]],
  holylight: ["Holy Light", "🕯️", 1, "common", [{ hit: 0.9 }, { heal: 0.08, to: "weakest" }]],
  ward: ["Ward", "🔰", 1, "common", [{ block: 4, def: 1, to: "party" }]],
  purify: ["Purify", "💧", 1, "rare", [{ cleanse: true, to: "ally" }, { heal: 0.12, to: "ally" }]],
  wrath: ["Divine Wrath", "🌩️", 2, "epic", [{ hit: 1.1, to: "all", bonusIf: "undead", bonus: 2.5 }]],
  blessing: ["Blessing", "🌞", 1, "rare", [{ might: 2, to: "ally" }, { block: 5, to: "ally" }]],
  poisonblade: ["Poison Blade", "☠️", 1, "common", [{ hit: 0.6 }, { status: "poison", turns: 3 }]],
  backstab: ["Backstab", "🔪", 1, "common", [{ hit: 1.2, bonusIf: "poison|stun", bonus: 3 }]],
  smoke: ["Smoke Bomb", "💨", 1, "rare", [{ evade: true }]],
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
  divine: ["Divine Intervention", "👼", 1, "mythic", [{ block: 30, def: 1, to: "party" }, { heal: 0.3, to: "party" }], "mythic"],
  resurrection: ["Resurrection", "🌅", 2, "mythic", [{ revive: 0.6, to: "all" }, { heal: 0.25, to: "party" }], "mythic"],
  deathmark: ["Death Mark", "💀", 1, "mythic", [{ hit: 4, execute: 0.5 }], "mythic"],
  timewarp: ["Time Warp", "⏳", 0, "mythic", [{ mana: 4 }, { draw: 4 }], "mythic"],
};

// id: [name, icon, cost, rarity, fx, exhaust (true - or "mythic": once a run)]
const NEUTRAL = {
  jab: ["Jab", "🥊", 0, "common", [{ hit: 0.5 }]],
  brace: ["Brace", "🪵", 1, "common", [{ block: 10 }]],
  firstaid: ["First Aid", "⛑️", 1, "common", [{ heal: 0.12 }]],
  dash: ["Dash", "🏃", 1, "common", [{ hit: 0.6 }, { block: 5 }]],
  inspire: ["Inspire", "🎺", 1, "rare", [{ might: 2, to: "ally" }, { draw: 1 }]],
  gamble: ["Desperate Gamble", "🎲", 0, "rare", [{ mana: 1 }, { draw: 2 }, { lose: 0.06 }], true],
  panacea: ["Panacea", "🧴", 1, "rare", [{ heal: 0.1, to: "party" }]],
  berserkerbrew: ["Berserker Brew", "🍷", 0, "legendary", [{ mana: 2 }, { might: 2 }], true],
  goldenstrike: ["Golden Strike", "🏆", 2, "legendary", [{ hit: 2.5 }, { draw: 1 }]],
  wish: ["Wish", "🌟", 0, "mythic", [{ heal: 0.3 }, { mana: 2 }, { draw: 3 }], "mythic"],
};

const CLASS = {
  warrior: {
    heavyslash: ["Heavy Slash", "⚒️", 1, "common", [{ hit: 1.35 }]],
    shieldup: ["Shield Up", "🛡️", 1, "common", [{ block: 9, def: 1 }]],
    headbutt: ["Headbutt", "🐏", 1, "common", [{ hit: 1 }, { status: "chill", turns: 1 }]],
    warstomp: ["War Stomp", "🦶", 2, "common", [{ hit: 0.6, to: "all" }, { status: "chill", turns: 1, to: "all" }]],
    recklesscharge: ["Reckless Charge", "🐂", 0, "common", [{ hit: 1 }, { lose: 0.04 }]],
    fortify: ["Fortify", "🏯", 1, "common", [{ block: 6, def: 1.5 }]],
    clothesline: ["Clothesline", "💪", 2, "common", [{ hit: 1.2 }, { status: "chill", turns: 2 }]],
    boomerang: ["Sword Boomerang", "🪃", 1, "common", [{ hit: 0.45, to: "random", times: 3 }]],
    bloodrage: ["Blood Rage", "😤", 1, "rare", [{ lose: 0.06 }, { might: 3 }, { draw: 1 }]],
    shockwave: ["Shockwave", "💥", 2, "rare", [{ status: "chill", turns: 2, to: "all" }, { status: "stun", to: "random" }], true],
    seeingred: ["Seeing Red", "👁️", 1, "rare", [{ mana: 2 }], true],
    flamebarrier: ["Flame Barrier", "🔥", 2, "rare", [{ block: 12, def: 1 }, { status: "burn", turns: 2, to: "all" }]],
    rampage: ["Rampage", "🐗", 1, "rare", [{ hit: 1.1, bonusIf: "low", bonus: 2.2 }]],
    ironwill: ["Iron Will", "🪨", 1, "rare", [{ block: 5, def: 1 }, { heal: 0.06 }]],
    reaper: ["Reaper", "⚰️", 2, "epic", [{ hit: 0.9, to: "all" }, { heal: 0.12 }], true],
    juggernaut: ["Juggernaut", "🚂", 2, "epic", [{ hit: 2.4 }, { block: 8, def: 1 }]],
    demonform: ["Demon Form", "👹", 1, "legendary", [{ might: 4 }, { mana: 1 }], true],
    bludgeon: ["Bludgeon", "🏏", 3, "legendary", [{ hit: 3.2 }]],
    earthshaker: ["Earthshaker", "🌍", 3, "legendary", [{ hit: 1.6, to: "all" }, { status: "stun", to: "all" }], true],
    lastbastion: ["Last Bastion", "🛡️", 2, "legendary", [{ block: 20, def: 2 }, { might: 2 }]],
    ragnarok: ["Ragnarok", "⚡", 3, "mythic", [{ hit: 2, to: "all", times: 2 }], "mythic"],
    undyingrage: ["Undying Rage", "😡", 1, "mythic", [{ heal: 0.4 }, { might: 3 }, { mana: 2 }], "mythic"],
  },
  paladin: {
    shieldslam: ["Shield Slam", "🔘", 1, "common", [{ hit: 0.6, def: 1 }]],
    guard: ["Guard", "🚧", 1, "common", [{ block: 7, def: 1, to: "ally" }]],
    holystrike: ["Holy Strike", "✝️", 1, "common", [{ hit: 1.1, bonusIf: "undead", bonus: 2.2 }]],
    vow: ["Vow", "📜", 1, "common", [{ block: 5, def: 1 }, { draw: 1 }]],
    crusade: ["Crusade", "🏇", 2, "common", [{ hit: 0.6, def: 0.5, to: "all" }]],
    radiance: ["Radiance", "🔅", 1, "common", [{ hit: 0.7 }, { heal: 0.05, to: "party" }]],
    steadfast: ["Steadfast", "⚓", 1, "common", [{ block: 4, def: 2 }]],
    rebuke: ["Rebuke", "🙅", 1, "common", [{ hit: 0.8 }, { status: "chill", turns: 1 }]],
    sanctuary: ["Sanctuary", "⛪", 2, "rare", [{ block: 6, def: 1, to: "party" }, { heal: 0.05, to: "party" }]],
    avenger: ["Avenger's Shield", "🥏", 2, "rare", [{ hit: 0.5, def: 0.4, to: "random", times: 3 }]],
    devotion: ["Devotion", "💒", 1, "rare", [{ might: 3, to: "party" }], true],
    shieldwall: ["Shield Wall", "🧱", 2, "rare", [{ block: 10, def: 2.5 }]],
    blessedhammer: ["Blessed Hammer", "🔨", 1, "rare", [{ hit: 0.9, def: 0.5 }, { draw: 1 }]],
    martyr: ["Martyr", "🥀", 0, "rare", [{ lose: 0.08 }, { heal: 0.15, to: "weakest" }]],
    guardianangel: ["Guardian Angel", "😇", 2, "epic", [{ block: 15, def: 1, to: "party" }], true],
    divinestorm: ["Divine Storm", "⛈️", 3, "legendary", [{ hit: 1.3, def: 0.5, to: "all" }]],
    avatar: ["Avatar of Light", "☀️", 2, "epic", [{ might: 3 }, { block: 10, def: 1 }], true],
    verdict: ["Final Verdict", "🏛️", 2, "legendary", [{ hit: 2, def: 1, bonusIf: "stun", bonus: 3 }]],
    oath: ["Crusader's Oath", "📯", 2, "legendary", [{ block: 12, def: 1, to: "party" }, { might: 2, to: "party" }], true],
    justice: ["Hammer of Justice", "🛕", 2, "legendary", [{ hit: 2.2, def: 1 }, { status: "stun" }]],
    aegisgods: ["Aegis of the Gods", "🌐", 2, "mythic", [{ block: 40, def: 1, to: "party" }], "mythic"],
    holyavenger: ["Holy Avenger", "🗡️", 2, "mythic", [{ hit: 3, def: 2 }, { heal: 0.15, to: "party" }], "mythic"],
  },
  cleric: {
    mend: ["Mend", "🌿", 1, "common", [{ heal: 0.15, to: "ally" }]],
    holybolt: ["Holy Bolt", "🌠", 1, "common", [{ hit: 1, bonusIf: "undead", bonus: 2.2 }]],
    renew: ["Renew", "🌱", 1, "common", [{ heal: 0.08, to: "party" }]],
    faith: ["Shield of Faith", "🛡️", 1, "common", [{ block: 8, def: 1, to: "ally" }]],
    chastise: ["Chastise", "☝️", 1, "common", [{ hit: 0.8 }, { status: "chill", turns: 1 }]],
    penance: ["Penance", "🔔", 1, "common", [{ hit: 0.6 }, { heal: 0.06, to: "weakest" }]],
    meditate: ["Meditate", "🪷", 0, "common", [{ draw: 1 }, { heal: 0.04 }]],
    grace: ["Light's Grace", "🪽", 1, "common", [{ heal: 0.1, to: "ally" }, { block: 4, to: "ally" }]],
    circle: ["Circle of Healing", "⭕", 2, "rare", [{ heal: 0.18, to: "party" }]],
    holynova: ["Holy Nova", "❇️", 2, "rare", [{ hit: 0.7, to: "all" }, { heal: 0.07, to: "party" }]],
    hymn: ["Divine Hymn", "🎶", 1, "rare", [{ might: 2, to: "party" }, { heal: 0.05, to: "party" }], true],
    exorcism: ["Exorcism", "🧿", 1, "rare", [{ hit: 0.9, bonusIf: "undead", bonus: 3.5 }]],
    sanctify: ["Sanctify", "🫶", 1, "rare", [{ block: 6, def: 1, to: "party" }]],
    innerfire: ["Inner Fire", "♨️", 1, "rare", [{ might: 2 }, { heal: 0.08 }]],
    miracle: ["Miracle", "🌈", 2, "legendary", [{ heal: 0.35, to: "party" }], true],
    guardianspirit: ["Guardian Spirit", "👻", 1, "epic", [{ block: 20, to: "ally" }, { heal: 0.15, to: "ally" }], true],
    holyfire: ["Holy Fire", "🎇", 2, "epic", [{ hit: 1.4 }, { status: "burn", turns: 3 }]],
    ascension: ["Ascension", "👑", 2, "legendary", [{ mana: 2 }, { draw: 2 }, { heal: 0.1, to: "party" }], true],
    beacon: ["Beacon of Light", "🗼", 2, "legendary", [{ heal: 0.2, to: "party" }, { block: 8, to: "party" }]],
    dawnbreak: ["Dawnbreak", "🌄", 2, "legendary", [{ hit: 1.2, to: "all", bonusIf: "undead", bonus: 3 }, { heal: 0.08, to: "party" }]],
    saintsgrace: ["Saint's Grace", "💖", 2, "mythic", [{ heal: 0.5, to: "party" }, { might: 2, to: "party" }], "mythic"],
    rapture: ["Rapture", "🪐", 2, "mythic", [{ hit: 2, to: "all" }, { heal: 0.2, to: "party" }], "mythic"],
  },
  rogue: {
    shiv: ["Shiv", "🪡", 0, "common", [{ hit: 0.5 }]],
    deadlypoison: ["Deadly Poison", "🐍", 1, "common", [{ status: "poison", turns: 4 }]],
    sneakattack: ["Sneak Attack", "🥷", 1, "common", [{ hit: 0.9, bonusIf: "stun", bonus: 2.2 }]],
    dodgeroll: ["Dodge and Roll", "🤸", 1, "common", [{ block: 7, agi: 0.5 }]],
    slice: ["Slice", "✂️", 0, "common", [{ hit: 0.6 }]],
    garrote: ["Garrote", "🪢", 1, "common", [{ hit: 0.7 }, { status: "chill", turns: 1 }]],
    caltrops: ["Caltrops", "📌", 1, "common", [{ hit: 0.3, to: "all" }, { status: "poison", turns: 2, to: "all" }]],
    pickpocket: ["Pickpocket", "🫳", 1, "common", [{ hit: 0.6 }, { draw: 1 }]],
    bladedance: ["Blade Dance", "💃", 1, "rare", [{ hit: 0.35, to: "random", times: 4 }]],
    noxious: ["Noxious Fumes", "🌫️", 1, "rare", [{ status: "poison", turns: 3, to: "all" }]],
    ambush: ["Ambush", "🌑", 2, "rare", [{ hit: 2, bonusIf: "stun", bonus: 3 }]],
    vanish: ["Vanish", "🫥", 1, "rare", [{ evade: true }, { draw: 2 }], true],
    crippling: ["Crippling Cloud", "☁️", 2, "rare", [{ status: "poison", turns: 3, to: "all" }, { status: "chill", turns: 2, to: "all" }]],
    footwork: ["Footwork", "👟", 1, "rare", [{ block: 5, agi: 1 }, { might: 1 }]],
    rush: ["Adrenaline Rush", "⚡", 0, "epic", [{ mana: 1 }, { draw: 2 }], true],
    corpseexplosion: ["Corpse Explosion", "💣", 2, "epic", [{ hit: 1, to: "all", bonusIf: "poison", bonus: 2 }]],
    shadowclone: ["Shadow Clone", "👥", 2, "legendary", [{ hit: 0.5, to: "random", times: 6 }], true],
    assassinate: ["Assassinate", "🎯", 2, "legendary", [{ hit: 2.6, bonusIf: "poison", bonus: 4 }]],
    fanofknives: ["Fan of Knives", "🪭", 2, "legendary", [{ hit: 0.6, to: "all", times: 2 }, { status: "poison", turns: 3, to: "all" }]],
    shadowdance: ["Shadow Dance", "🌘", 1, "legendary", [{ evade: true }, { draw: 3 }, { mana: 1 }], true],
    scorpionkiss: ["Scorpion's Kiss", "🦂", 2, "mythic", [{ status: "poison", turns: 6, to: "all" }, { hit: 1, to: "all", bonusIf: "poison", bonus: 2.5 }], "mythic"],
    masquerade: ["Masquerade", "🎭", 2, "mythic", [{ hit: 0.8, to: "random", times: 8 }], "mythic"],
  },
  mage: {
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
  },
};

/* ---------- The text of a card, written from its effects ---------- */

const pct = (value) => Math.round(value * 100) + "%";
// (a condition - or more of them, "poison|stun": any of them)
const ifText = (cond) => (cond.includes("|") ? "on a " + cond.split("|").map((one) => IF[one].replace(/^on a | foe$/g, "")).join(" or ") + " foe" : IF[cond]);
const IF = { poison: "on a poisoned foe", burn: "on a burning foe", chill: "on a chilled foe", stun: "on a stunned foe", undead: "against the undead", low: "while you are below half HP" };
const STATUS = {
  poison: ["poison", "poisoned"],
  burn: ["burn", "burning"],
  chill: ["chill", "chilled (half damage)"],
  stun: ["stun", "stunned"],
};

function amount(fx) {
  const parts = [String(fx.block)];
  if (fx.def) parts.push(fx.def == 1 ? "armor" : fx.def + "x armor");
  if (fx.atk) parts.push(pct(fx.atk) + " of your attack");
  if (fx.agi) parts.push(fx.agi == 0.5 ? "half your dodge" : fx.agi == 1 ? "your dodge" : fx.agi + "x your dodge");
  return parts.join(" + ");
}

function phrase(fx, n) {
  if (fx.hit != null) {
    let text = "deal " + (n ? n.dmg(fx.hit, fx) : pct(fx.hit)) + " damage";
    if (fx.def && !n) text += " + " + (fx.def == 1 ? "your armor" : pct(fx.def) + " of your armor");
    if (fx.to == "all") text += " to every foe";
    if (fx.to == "random") text += " to a random foe";
    if (fx.times) text += fx.times == 2 ? " twice" : " " + fx.times + " times";
    if (fx.bonusIf) text += " - " + (n ? n.dmg(fx.bonus, fx) : pct(fx.bonus)) + " " + ifText(fx.bonusIf);
    if (fx.fromBlock) text = "deal damage equal to your block (at least " + (n ? n.dmg(fx.hit, fx) : pct(fx.hit)) + ")";
    if (fx.execute) text = "a foe below " + pct(fx.execute) + " HP dies (not a boss) - else " + text.replace(/^deal /, "");
    return text;
  }
  if (fx.block != null) {
    const value = n ? n.block(fx) : amount(fx);
    const low = fx.low ? " - below half HP: " + fx.low + "x" : "";
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
  if (fx.taunt) return "every foe attacks you this turn - you take 30% less";
  if (fx.revive != null) return (fx.to == "all" ? "every fallen ally stands up" : "a fallen ally stands up") + " with " + pct(fx.revive) + " HP";
  if (fx.cleanse) return (fx.to == "ally" ? "you or an ally lose" : "lose") + " poison and burns";
  if (fx.extend != null) return "its poison lasts " + fx.extend + " turns longer";
  if (fx.amplify) return "the poison on every foe: twice as strong, 3 turns longer";
  return "";
}

// (exhaust: true - gone for the fight; "mythic" - gone for the run)
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
function worth(fx) {
  if (fx.hit != null) {
    const base = (fx.bonusIf ? fx.hit * 0.75 + fx.bonus * 0.25 : fx.hit) * (fx.fromBlock ? 2 : 1) * (fx.execute ? 1.3 : 1);
    return { scaled: (base + (fx.def || 0) * 0.5) * (fx.times || 1) * (fx.to == "all" ? FOES * 0.75 : 1), fixed: 0 };
  }
  if (fx.block != null) return { scaled: (fx.block / 7 + (fx.def || 0) * 0.3 + (fx.atk || 0) + (fx.agi || 0) * 0.05) * (fx.to == "party" ? 1.6 : 1) * (fx.low ? 1.4 : 1), fixed: 0 };
  if (fx.heal != null) return { scaled: (fx.heal / 0.12) * (fx.to == "party" ? 1.6 : 1), fixed: 0 };
  let fixed = 0;
  if (fx.status) fixed = { poison: 0.45, burn: 0.3, chill: 0.45, stun: 1 }[fx.status] * (fx.status == "stun" ? 1 : fx.turns || 1) * (fx.to == "all" ? FOES * 0.75 : 1);
  else if (fx.might != null) fixed = 0.35 * fx.might * (fx.to == "party" ? 1.6 : 1);
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
  const parts = fx.map(worth);
  const scaled = parts.reduce((sum, p) => sum + p.scaled, 0);
  const fixed = parts.reduce((sum, p) => sum + p.fixed, 0);
  if (scaled < 0.5 || rarity == "basic") return fx;
  const k = Math.max(0.6, Math.min(1.8, (budget(cost, rarity, exhaust) - fixed) / scaled));
  const round = (value, step) => Math.round(value / step) * step;
  return fx.map((one) => {
    const out = { ...one };
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
function build(list) {
  const cards = {};
  for (const [id, [name, icon, cost, rarity, written, exhaust]] of Object.entries(list)) {
    const fx = balanced(written, cost, rarity, exhaust);
    cards[id] = { name, icon, cost, type: fx.some((one) => one.hit != null) ? "attack" : "skill", target: targetOf(fx), exhaust: exhaust === true, mythic: exhaust == "mythic", rarity, fx, text: textOf(fx, exhaust) };
  }
  return cards;
}

const base = build(BASE);
const neutral = build(NEUTRAL);
const byClass = Object.fromEntries(Object.entries(CLASS).map(([cls, list]) => [cls, build(list)]));

module.exports = {
  textOf,
  cards: Object.assign({}, base, neutral, ...Object.values(byClass)),
  neutral: Object.keys(neutral),
  classCards: Object.fromEntries(Object.entries(byClass).map(([cls, cards]) => [cls, Object.keys(cards)])),
};
