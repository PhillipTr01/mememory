const crypto = require("crypto");

/*
 * Every coin in the pot is one ticket: entries [{name, coins}] in order get
 * the tickets 0..total-1 one after the other. A random ticket decides, so the
 * chance to win is the share of the pot.
 */
function pickWinner(entries, randomInt = crypto.randomInt) {
  const total = entries.reduce((sum, entry) => sum + entry.coins, 0);
  if (total <= 0) return null;
  const ticket = randomInt(total);
  let counted = 0;
  const winner = entries.find((entry) => (counted += entry.coins) > ticket);
  return { winner: winner.name, ticket: ticket, total: total };
}

module.exports = { pickWinner };
