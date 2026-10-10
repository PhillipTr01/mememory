const cases = require("./cases");

/*
 * Bầu cua cá cọp: three dice, each shows one of six animals. A bet on an
 * animal pays (stake included) 2× when one die shows it, 3× for two, 10×
 * for all three - nothing when none does. On average 205/216 of a bet comes
 * back (94.9%), whatever animals a player picks. Every round has its own
 * seed (its hash is shown before the bets, the seed after the roll -
 * provably fair), the dice are rolled from it.
 */
const ANIMALS = [
  { id: "tiger", name: "Tiger", vn: "Cọp" },
  { id: "gourd", name: "Gourd", vn: "Bầu" },
  { id: "rooster", name: "Rooster", vn: "Gà" },
  { id: "fish", name: "Fish", vn: "Cá" },
  { id: "crab", name: "Crab", vn: "Cua" },
  { id: "shrimp", name: "Shrimp", vn: "Tôm" },
];
const IDS = ANIMALS.map((animal) => animal.id);
const DICE = 3;
// Times the bet back (stake included) by how many dice show the animal
const PAYOUT = [0, 2, 3, 10];

// The three dice of a round (animal ids)
function diceFor(seed, round) {
  return Array.from({ length: DICE }, (_, i) => IDS[Math.min(IDS.length - 1, Math.floor(cases.roll(seed, `baucua:${round}:${i}`) * IDS.length))]);
}

// How many dice show the animal
function matches(animal, dice) {
  return dice.filter((id) => id === animal).length;
}

// What a bet of `amount` on `animal` gives back with these dice (0: lost)
function payout(animal, amount, dice) {
  return amount * PAYOUT[matches(animal, dice)];
}

// The share of a bet that comes back on average (the same for every animal)
function rtp() {
  const p = 1 / IDS.length;
  let sum = 0;
  for (let k = 0; k <= DICE; k++) {
    let ways = 1;
    for (let i = 0; i < k; i++) ways = (ways * (DICE - i)) / (i + 1);
    sum += ways * p ** k * (1 - p) ** (DICE - k) * PAYOUT[k];
  }
  return sum;
}

module.exports = { ANIMALS, IDS, DICE, PAYOUT, diceFor, matches, payout, rtp, newSeed: cases.newSeed };
