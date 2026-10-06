const { test } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const leaderboard = require("../game/leaderboard");
const days = require("../game/days");

for (const name of ["anna", "ben", "cleo"]) h.addUser(name);
h.addUser("dora", { approved: false });

test("leaderboard: the approved players by coins - made once a day, with the places of the day before", async () => {
  h.setCoins("anna", 1000);
  h.setCoins("ben", 5000);
  h.setCoins("cleo", 3000);
  h.setCoins("dora", 99999); // not in the casino: not on the board
  const morning = days.dayStart(Date.parse("2026-10-06T12:00:00Z")) + 9 * 3600 * 1000;

  const first = await leaderboard.view("anna", morning);
  assert.deepStrictEqual(first.rows.map((r) => [r.rank, r.username, r.coins]), [[1, "ben", 5000], [2, "cleo", 3000], [3, "anna", 1000]]);
  assert.ok(first.rows.every((r) => r.before === null), "new on the board");
  assert.strictEqual(first.me.rank, 3);
  assert.strictEqual(first.nextIn, days.nextDay(morning) - morning);

  // The same day: nothing changes, whatever happens with the coins
  h.setCoins("anna", 9000);
  const later = await leaderboard.view("anna", morning + 10 * 3600 * 1000);
  assert.deepStrictEqual(later.rows.map((r) => r.username), ["ben", "cleo", "anna"]);
  assert.strictEqual(later.updatedAt, first.updatedAt);

  // After midnight: the new places, and who went up or down
  const nextDay = days.nextDay(morning) + 60 * 1000;
  const next = await leaderboard.view("anna", nextDay);
  assert.deepStrictEqual(next.rows.map((r) => [r.rank, r.username, r.before]), [[1, "anna", 3], [2, "ben", 1], [3, "cleo", 2]]);
  assert.strictEqual(next.updatedAt, nextDay);
});
