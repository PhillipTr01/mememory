/*
 * The places of a leaderboard.
 *
 * Without a season (no stats): the most coins first - the same coins, the
 * same place (1, 1, 3).
 *
 * In a season (stats given): the most coins first; the same coins - fewer
 * second chances first, then more coins wagered. Only players equal in all of it
 * share a place (and its prize). Where the second chances or the coins wagered made
 * the difference between players with the same coins, the row gets `decided`
 * (only what made the difference).
 *
 * rows: [{username, coins}] - stats(username): {chances, wagered} - prizes: Map
 * place -> prize (or none). Returns the rows sorted, with rank (and prize,
 * decided).
 *
 * need(username) (a season): the coins a player has to wager to get a place
 * (counted with stats().chanceWagered: the wager since the current chance began).
 * Who hasn't wagered that much yet stays on the board - after everybody with a
 * place, without a place or a prize (rank null, pending: true) - every row with
 * wager: {done, need}.
 */
function place(rows, options = {}) {
  if (options.need) {
    const { need, ...rest } = options;
    // (the wager of the current chance - or of the whole season, when not given per chance)
    const done = (row) => {
      const s = options.stats ? options.stats(row.username) : {};
      return (s.chanceWagered != null ? s.chanceWagered : s.wagered) || 0;
    };
    const counted = [];
    const pending = [];
    for (const row of rows) {
      row.wager = { done: done(row), need: need(row.username) };
      (row.wager.done >= row.wager.need ? counted : pending).push(row);
    }
    const placed = place(counted, rest);
    pending.sort((a, b) => b.coins - a.coins || b.wager.done - a.wager.done || a.username.localeCompare(b.username));
    pending.forEach((row) => {
      row.rank = null;
      row.pending = true;
      delete row.prize;
    });
    return [...placed, ...pending];
  }
  const prizes = options.prizes && options.prizes.size ? options.prizes : null;
  const keys = new Map(rows.map((row) => [row, { chances: 0, wagered: 0, ...(options.stats ? options.stats(row.username) : {}) }]));
  const key = (row) => keys.get(row);
  const sorted = rows.slice().sort((a, b) => b.coins - a.coins || key(a).chances - key(b).chances || key(b).wagered - key(a).wagered || a.username.localeCompare(b.username));
  const same = (a, b) => a.coins === b.coins && key(a).chances === key(b).chances && key(a).wagered === key(b).wagered;
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
      const wageredDiffer = sameChances.length > 1 && new Set(sameChances.map((other) => key(other).wagered)).size > 1;
      if (chancesDiffer || wageredDiffer) row.decided = { ...(chancesDiffer ? { chances: key(row).chances } : {}), ...(wageredDiffer ? { wagered: key(row).wagered } : {}) };
    });
  }
  return sorted;
}

module.exports = { place };
