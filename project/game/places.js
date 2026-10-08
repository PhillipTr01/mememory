/*
 * The places of a leaderboard: the most coins first - the same coins, the
 * same place (1, 1, 3).
 *
 * The prizes of a season: when players with the same coins share a place
 * that has a prize, it goes by who used fewer second chances - and then by
 * who made more bets. Only those players get `decided` (what was compared:
 * the second chances, the bets - only what made the difference), nobody else
 * needs it. Players equal in all of it share the prize place as well.
 *
 * rows: [{username, coins}] - stats(username): {chances, bets} (only asked
 * when a tie touches a prize) - prizes: Map place -> prize (or none).
 * Returns the rows sorted, with rank (and prize, decided).
 */
function place(rows, options = {}) {
  const prizes = options.prizes && options.prizes.size ? options.prizes : null;
  const sorted = rows.slice().sort((a, b) => b.coins - a.coins || a.username.localeCompare(b.username));
  // The same coins, the same place
  sorted.forEach((row, index) => {
    row.rank = index > 0 && sorted[index - 1].coins === row.coins ? sorted[index - 1].rank : index + 1;
  });
  if (!prizes) return sorted;
  const lastPrize = Math.max(...prizes.keys());
  // The groups with the same coins - only the ones on a prize place need more
  const groups = [];
  sorted.forEach((row) => {
    const group = groups[groups.length - 1];
    if (group && group[0].coins === row.coins) group.push(row);
    else groups.push([row]);
  });
  const result = [];
  for (const group of groups) {
    const start = group[0].rank;
    if (group.length === 1 || start > lastPrize || !options.stats) {
      group.forEach((row) => {
        if (prizes.has(row.rank)) row.prize = prizes.get(row.rank);
      });
      result.push(...group);
      continue;
    }
    // Fewer second chances first, then more bets
    const key = new Map(group.map((row) => [row, { chances: 0, bets: 0, ...options.stats(row.username) }]));
    group.sort((a, b) => key.get(a).chances - key.get(b).chances || key.get(b).bets - key.get(a).bets || a.username.localeCompare(b.username));
    const chancesDiffer = new Set(group.map((row) => key.get(row).chances)).size > 1;
    let prizePlace = start;
    group.forEach((row, index) => {
      const k = key.get(row);
      const prev = group[index - 1];
      if (prev && !(key.get(prev).chances === k.chances && key.get(prev).bets === k.bets)) prizePlace = start + index;
      if (prizes.has(prizePlace)) row.prize = prizes.get(prizePlace);
      // What decided it: the second chances (if they differ in the group), the bets (if the ones
      // with the same second chances differ in them)
      const sameChances = group.filter((other) => key.get(other).chances === k.chances);
      const betsDiffer = sameChances.length > 1 && new Set(sameChances.map((other) => key.get(other).bets)).size > 1;
      if (chancesDiffer || betsDiffer) row.decided = { ...(chancesDiffer ? { chances: k.chances } : {}), ...(betsDiffer ? { bets: k.bets } : {}) };
    });
    result.push(...group);
  }
  return result;
}

// Does a tie touch a prize (then the second chances and bets are needed)?
function tieOnPrize(rows, prizes) {
  if (!prizes || !prizes.size) return false;
  const lastPrize = Math.max(...prizes.keys());
  const placed = place(rows.map((row) => ({ username: row.username, coins: row.coins })));
  return placed.some((row, index) => index > 0 && row.rank <= lastPrize && placed[index - 1].rank === row.rank);
}

module.exports = { place, tieOnPrize };
