const crypto = require("crypto");

/*
 * Every coin in the pot is one ticket: entries [{name, coins}] in order get
 * the tickets 0..total-1 one after the other. A random ticket decides, so the
 * chance to win is the share of the pot.
 */
function pickWinner(entries, randomInt = crypto.randomInt) {
  const total = entries.reduce((sum, entry) => sum + entry.coins, 0);
  if (total <= 0) return null;
  return winnerOf(entries, randomInt(total));
}

function winnerOf(entries, ticket) {
  const total = entries.reduce((sum, entry) => sum + entry.coins, 0);
  let counted = 0;
  const winner = entries.find((entry) => (counted += entry.coins) > ticket);
  return { winner: winner.name, ticket: ticket, total: total };
}

/*
 * Provably fair (like on jackpot sites): the winning number (0..1) is chosen
 * when the round starts. Everybody sees its hash right away, the number and the
 * secret only after the draw - so the number couldn't be changed after the bets,
 * and everybody can check: sha256(number + ":" + secret) == hash.
 */
function newFairRound() {
  const number = (crypto.randomInt(1e12) / 1e12).toFixed(12);
  const secret = crypto.randomBytes(8).toString("hex");
  return { number: number, secret: secret, hash: fairHash(number, secret) };
}

function fairHash(number, secret) {
  return crypto.createHash("sha256").update(number + ":" + secret).digest("hex");
}

// The winning ticket of a round: the number decides where in the pot it lands
function fairWinner(entries, number) {
  const total = entries.reduce((sum, entry) => sum + entry.coins, 0);
  if (total <= 0) return null;
  return winnerOf(entries, Math.min(total - 1, Math.floor(Number(number) * total)));
}

module.exports = { pickWinner, winnerOf, newFairRound, fairHash, fairWinner };
