/*
 * The house's cut of a jackpot pot. At most `percent` of the pot - and at most
 * half of what the others put in: a winner never gets back less than the own
 * coins, and always keeps at least half of the others' coins.
 * (With 3%: from a share of 94% of the pot on, the cut shrinks to 0 at 100%.)
 */
function jackpotRake(total, own, percent) {
  const full = Math.floor((total * percent) / 100);
  const others = Math.max(0, total - own);
  return Math.max(0, Math.min(full, Math.floor(others / 2)));
}

module.exports = { jackpotRake };
