const cases = require("./cases");

/*
 * Roulette: a wheel of 15 slots - 7 red, 7 blue, 1 green. Red and blue pay
 * 2× the bet, green 14× (the house keeps 1/15 on average: 93.3% back).
 * Every round has its own seed (its hash is shown before the bets, the seed
 * after the roll - provably fair), the slot is rolled from it.
 */
const COLORS = ["red", "blue", "green"];
const PAYOUT = { red: 2, blue: 2, green: 14 };

// The wheel in order: green, then red and blue in turn
const WHEEL = [{ number: 0, color: "green" }];
for (let n = 1; n <= 14; n++) WHEEL.push({ number: n, color: n % 2 ? "red" : "blue" });

function slotFor(seed, round) {
  return Math.min(WHEEL.length - 1, Math.floor(cases.roll(seed, `roulette:${round}`) * WHEEL.length));
}

// What a bet of `amount` on `color` gives back when `slot` comes (0: lost)
function payout(color, amount, slot) {
  return WHEEL[slot].color === color ? amount * PAYOUT[color] : 0;
}

// Red and blue together never: one of them (and green with it)
function allowed(bets, color) {
  if (color === "red") return !(bets.blue > 0);
  if (color === "blue") return !(bets.red > 0);
  return true;
}

// The share of the bets the wheel gives back on average (the same for every color)
function rtp(color) {
  return (WHEEL.filter((slot) => slot.color === color).length / WHEEL.length) * PAYOUT[color];
}

module.exports = { COLORS, PAYOUT, WHEEL, slotFor, payout, allowed, rtp, newSeed: cases.newSeed };
