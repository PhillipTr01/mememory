const { test } = require("node:test");
const assert = require("node:assert");
const { place } = require("../game/places");

const rows = (list) => list.map(([username, coins]) => ({ username, coins }));

test("places: without a season - the same coins, the same place (1, 1, 3)", () => {
  const placed = place(rows([["a", 50], ["b", 100], ["c", 100], ["d", 10]]));
  assert.deepStrictEqual(placed.map((r) => [r.username, r.rank]), [["b", 1], ["c", 1], ["a", 3], ["d", 4]]);
  assert.ok(placed.every((r) => r.decided == null && r.prize == null));
});

test("places: in a season - the same coins: fewer second chances, then more coins wagered; only equal in all of it share a place", () => {
  const prizes = new Map([[1, "gold"], [2, "silver"], [3, "bronze"]]);
  const stats = { top: { chances: 3, wagered: 100 }, a: { chances: 1, wagered: 5000 }, b: { chances: 0, wagered: 300 }, c: { chances: 0, wagered: 900 }, d: { chances: 0, wagered: 900 }, e: { chances: 2, wagered: 100 } };
  const placed = place(rows([["top", 200], ["a", 100], ["b", 100], ["c", 100], ["d", 100], ["e", 10]]), { prizes, stats: (u) => stats[u] });
  assert.deepStrictEqual(
    placed.map((r) => [r.username, r.rank, r.prize || null, r.decided || null]),
    [
      ["top", 1, "gold", null],
      ["c", 2, "silver", { chances: 0, wagered: 900 }],
      ["d", 2, "silver", { chances: 0, wagered: 900 }],
      ["b", 4, null, { chances: 0, wagered: 300 }],
      ["a", 5, null, { chances: 1 }],
      ["e", 6, null, null],
    ],
  );
});
