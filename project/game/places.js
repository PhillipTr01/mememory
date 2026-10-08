/*
 * The places of a leaderboard.
 *
 * Without a season (no stats): the most coins first - the same coins, the
 * same place (1, 1, 3).
 *
 * In a season (stats given): the most coins first; the same coins - fewer
 * second chances first, then more bets. Only players equal in all of it
 * share a place (and its prize). Where the second chances or the bets made
 * the difference between players with the same coins, the row gets `decided`
 * (only what made the difference).
 *
 * rows: [{username, coins}] - stats(username): {chances, bets} - prizes: Map
 * place -> prize (or none). Returns the rows sorted, with rank (and prize,
 * decided).
 */
function place(rows, options = {}) {
  const prizes = options.prizes && options.prizes.size ? options.prizes : null;
  const keys = new Map(rows.map((row) => [row, { chances: 0, bets: 0, ...(options.stats ? options.stats(row.username) : {}) }]));
  const key = (row) => keys.get(row);
  const sorted = rows.slice().sort((a, b) => b.coins - a.coins || key(a).chances - key(b).chances || key(b).bets - key(a).bets || a.username.localeCompare(b.username));
  const same = (a, b) => a.coins === b.coins && key(a).chances === key(b).chances && key(a).bets === key(b).bets;
  sorted.forEach((row, index) => {
    const prev = sorted[index - 1];
    row.rank = prev && same(prev, row) ? prev.rank : index + 1;
    if (prizes && prizes.has(row.rank)) row.prize = prizes.get(row.rank);
  });
  if (!options.stats) return sorted;
  // What made the difference between players with the same coins
  const byCoins = new Map();
  sorted.forEach((row) => byCoins.set(row.coins, [...(byCoins.get(row.coins) || []), row]));
  for (const group of byCoins.values()) {
    if (group.length < 2) continue;
    const chancesDiffer = new Set(group.map((row) => key(row).chances)).size > 1;
    group.forEach((row) => {
      const sameChances = group.filter((other) => key(other).chances === key(row).chances);
      const betsDiffer = sameChances.length > 1 && new Set(sameChances.map((other) => key(other).bets)).size > 1;
      if (chancesDiffer || betsDiffer) row.decided = { ...(chancesDiffer ? { chances: key(row).chances } : {}), ...(betsDiffer ? { bets: key(row).bets } : {}) };
    });
  }
  return sorted;
}

module.exports = { place };
