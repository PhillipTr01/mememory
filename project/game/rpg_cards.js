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

// id: [name, icon, cost, rarity, fx, exhaust (true - or "mystic": once a run)]
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
  wish: ["Wish", "🌟", 0, "mystic", [{ heal: 0.3 }, { mana: 2 }, { draw: 3 }], "mystic"],
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
    bloodrage: ["Blood Rage", "😤", 1, "rare", [{ lose: 0.06 }, { might: 2 }, { draw: 1 }]],
    shockwave: ["Shockwave", "💥", 2, "rare", [{ status: "chill", turns: 2, to: "all" }, { status: "stun", to: "random" }], true],
    seeingred: ["Seeing Red", "👁️", 1, "rare", [{ mana: 2 }], true],
    flamebarrier: ["Flame Barrier", "🔥", 2, "rare", [{ block: 12, def: 1 }, { status: "burn", turns: 2, to: "all" }]],
    rampage: ["Rampage", "🐗", 1, "rare", [{ hit: 1.1, bonusIf: "low", bonus: 2.2 }]],
    ironwill: ["Iron Will", "🪨", 1, "rare", [{ block: 5, def: 1 }, { heal: 0.06 }]],
    reaper: ["Reaper", "⚰️", 2, "epic", [{ hit: 0.9, to: "all" }, { heal: 0.12 }], true],
    juggernaut: ["Juggernaut", "🚂", 2, "epic", [{ hit: 2.4 }, { block: 8, def: 1 }]],
    demonform: ["Demon Form", "👹", 3, "legendary", [{ might: 4 }, { mana: 1 }], true],
    bludgeon: ["Bludgeon", "🏏", 3, "legendary", [{ hit: 3.2 }]],
    earthshaker: ["Earthshaker", "🌍", 3, "legendary", [{ hit: 1.6, to: "all" }, { status: "stun", to: "all" }], true],
    lastbastion: ["Last Bastion", "🛡️", 2, "legendary", [{ block: 20, def: 2 }, { might: 2 }]],
    ragnarok: ["Ragnarok", "⚡", 3, "mystic", [{ hit: 2, to: "all", times: 2 }], "mystic"],
    undyingrage: ["Undying Rage", "😡", 1, "mystic", [{ heal: 0.4 }, { might: 3 }, { mana: 2 }], "mystic"],
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
    devotion: ["Devotion", "💒", 1, "rare", [{ might: 2, to: "party" }], true],
    shieldwall: ["Shield Wall", "🧱", 2, "rare", [{ block: 10, def: 2.5 }]],
    blessedhammer: ["Blessed Hammer", "🔨", 1, "rare", [{ hit: 0.9, def: 0.5 }, { draw: 1 }]],
    martyr: ["Martyr", "🥀", 0, "rare", [{ lose: 0.08 }, { heal: 0.15, to: "weakest" }]],
    guardianangel: ["Guardian Angel", "😇", 2, "epic", [{ block: 15, def: 1, to: "party" }], true],
    divinestorm: ["Divine Storm", "⛈️", 3, "legendary", [{ hit: 1.3, def: 0.5, to: "all" }]],
    avatar: ["Avatar of Light", "☀️", 2, "epic", [{ might: 3 }, { block: 10, def: 1 }], true],
    verdict: ["Final Verdict", "🏛️", 2, "legendary", [{ hit: 2, def: 1, bonusIf: "stun", bonus: 3 }]],
    oath: ["Crusader's Oath", "📯", 2, "legendary", [{ block: 12, def: 1, to: "party" }, { might: 2, to: "party" }], true],
    justice: ["Hammer of Justice", "🛕", 2, "legendary", [{ hit: 2.2, def: 1 }, { status: "stun" }]],
    aegisgods: ["Aegis of the Gods", "🌐", 2, "mystic", [{ block: 40, def: 1, to: "party" }], "mystic"],
    holyavenger: ["Holy Avenger", "🗡️", 2, "mystic", [{ hit: 3, def: 2 }, { heal: 0.15, to: "party" }], "mystic"],
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
    saintsgrace: ["Saint's Grace", "💖", 2, "mystic", [{ heal: 0.5, to: "party" }, { might: 2, to: "party" }], "mystic"],
    rapture: ["Rapture", "🪐", 2, "mystic", [{ hit: 2, to: "all" }, { heal: 0.2, to: "party" }], "mystic"],
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
    rush: ["Adrenaline Rush", "⚡", 0, "epic", [{ mana: 2 }, { draw: 2 }], true],
    corpseexplosion: ["Corpse Explosion", "💣", 2, "epic", [{ hit: 1, to: "all", bonusIf: "poison", bonus: 2 }]],
    shadowclone: ["Shadow Clone", "👥", 2, "legendary", [{ hit: 0.5, to: "random", times: 6 }], true],
    assassinate: ["Assassinate", "🎯", 2, "legendary", [{ hit: 2.6, bonusIf: "poison", bonus: 4 }]],
    fanofknives: ["Fan of Knives", "🪭", 2, "legendary", [{ hit: 0.6, to: "all", times: 2 }, { status: "poison", turns: 3, to: "all" }]],
    shadowdance: ["Shadow Dance", "🌘", 1, "legendary", [{ evade: true }, { draw: 3 }, { mana: 1 }], true],
    scorpionkiss: ["Scorpion's Kiss", "🦂", 2, "mystic", [{ status: "poison", turns: 6, to: "all" }, { hit: 1, to: "all", bonusIf: "poison", bonus: 2.5 }], "mystic"],
    masquerade: ["Masquerade", "🎭", 2, "mystic", [{ hit: 0.8, to: "random", times: 8 }], "mystic"],
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
    armageddon: ["Armageddon", "☢️", 3, "mystic", [{ hit: 3, to: "all" }, { status: "burn", turns: 3, to: "all" }], "mystic"],
    ascendance: ["Arcane Ascendance", "🔯", 0, "mystic", [{ mana: 3 }, { draw: 3 }, { might: 3 }], "mystic"],
  },
};

/* ---------- The text of a card, written from its effects ---------- */

const pct = (value) => Math.round(value * 100) + "%";
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

function phrase(fx) {
  if (fx.hit != null) {
    let text = "deal " + pct(fx.hit) + " damage";
    if (fx.def) text += " + " + (fx.def == 1 ? "your armor" : pct(fx.def) + " of your armor");
    if (fx.to == "all") text += " to every foe";
    if (fx.to == "random") text += " to a random foe";
    if (fx.times) text += fx.times == 2 ? " twice" : " " + fx.times + " times";
    if (fx.bonusIf) text += " - " + pct(fx.bonus) + " " + IF[fx.bonusIf];
    return text;
  }
  if (fx.block != null) {
    if (fx.to == "ally") return "an ally blocks " + amount(fx);
    if (fx.to == "party") return "every hero blocks " + amount(fx);
    return "block " + amount(fx);
  }
  if (fx.heal != null) {
    if (fx.to == "ally") return "an ally heals " + pct(fx.heal) + " HP";
    if (fx.to == "party") return "the party heals " + pct(fx.heal) + " HP";
    if (fx.to == "weakest") return "the weakest hero heals " + pct(fx.heal) + " HP";
    return "heal " + pct(fx.heal) + " HP";
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
  if (fx.draw != null) return "draw " + fx.draw + " card" + (fx.draw == 1 ? "" : "s");
  if (fx.mana != null) return "+" + fx.mana + " mana";
  if (fx.lose != null) return "lose " + pct(fx.lose) + " HP";
  if (fx.evade) return "nothing hits you this turn";
  return "";
}

// (exhaust: true - gone for the fight; "mystic" - gone for the run)
function textOf(fx, exhaust) {
  const text = fx.map(phrase).filter(Boolean).join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1) + "." + (exhaust == "mystic" ? " Mystic." : exhaust ? " Exhaust." : "");
}

// What a card aims at: a foe (a hit or a state on one), an ally - or nothing to pick
function targetOf(fx) {
  if (fx.some((one) => (one.hit != null || one.status) && (!one.to || one.to == "foe"))) return "foe";
  if (fx.some((one) => one.to == "ally")) return "ally";
  return "none";
}

// The cards: {id: card} - with their rarity, the class ones per class, the neutral ones
function build(list) {
  const cards = {};
  for (const [id, [name, icon, cost, rarity, fx, exhaust]] of Object.entries(list)) {
    cards[id] = { name, icon, cost, type: fx.some((one) => one.hit != null) ? "attack" : "skill", target: targetOf(fx), exhaust: exhaust === true, mystic: exhaust == "mystic", rarity, fx, text: textOf(fx, exhaust) };
  }
  return cards;
}

const neutral = build(NEUTRAL);
const byClass = Object.fromEntries(Object.entries(CLASS).map(([cls, list]) => [cls, build(list)]));

module.exports = {
  cards: Object.assign({}, neutral, ...Object.values(byClass)),
  neutral: Object.keys(neutral),
  classCards: Object.fromEntries(Object.entries(byClass).map(([cls, cards]) => [cls, Object.keys(cards)])),
};
