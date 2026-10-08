const { test } = require("node:test");
const assert = require("node:assert");
const { place, tieOnPrize } = require("../game/places");

const rows = (list) => list.map(([username, coins]) => ({ username, coins }));

test("places: the same coins, the same place (1, 1, 3)", () => {
  const placed = place(rows([["a", 50], ["b", 100], ["c", 100], ["d", 10]]));
  assert.deepStrictEqual(placed.map((r) => [r.username, r.rank]), [["b", 1], ["c", 1], ["a", 3], ["d", 4]]);
  assert.ok(placed.every((r) => r.decided == null && r.prize == null));
});

test("places: a tie on a prize place - fewer second chances, then more bets; only shown where it decides", () => {
  const prizes = new Map([[1, "gold"], [2, "silver"], [3, "bronze"]]);
  const stats = { a: { chances: 1, bets: 50 }, b: { chances: 0, bets: 3 }, c: { chances: 0, bets: 9 }, e: { chances: 2, bets: 1 } };
  const placed = place(rows([["top", 200], ["a", 100], ["b", 100], ["c", 100], ["e", 10]]), { prizes, stats: (u) => stats[u] });
  assert.deepStrictEqual(
    placed.map((r) => [r.username, r.rank, r.prize || null, r.decided || null]),
    [
      ["top", 1, "gold", null],
      ["c", 2, "silver", { chances: 0, bets: 9 }],
      ["b", 2, "bronze", { chances: 0, bets: 3 }],
      ["a", 2, null, { chances: 1 }],
      ["e", 5, null, null],
    ],
  );
  // Equal in everything: the same prize
  const same = place(rows([["x", 5], ["y", 5]]), { prizes, stats: () => ({ chances: 0, bets: 2 }) });
  assert.deepStrictEqual(same.map((r) => [r.rank, r.prize, r.decided || null]), [[1, "gold", null], [1, "gold", null]]);
  // No tie on a prize place: nothing looked up
  assert.strictEqual(tieOnPrize(rows([["a", 4], ["b", 3], ["c", 2], ["d", 1], ["e", 1]]), prizes), false);
  assert.strictEqual(tieOnPrize(rows([["a", 3], ["b", 2], ["c", 2]]), prizes), true);
});
