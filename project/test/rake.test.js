const test = require("node:test");
const assert = require("node:assert");
const { jackpotRake } = require("../game/rake");

test("jackpot rake: the full cut while the others put in enough", () => {
  assert.strictEqual(jackpotRake(10000, 5000, 3), 300);
  assert.strictEqual(jackpotRake(10000, 9400, 3), 300); // 94%: still 3% (= half of the others' 600)
});

test("jackpot rake: never more than half of the others' coins - the winner never loses", () => {
  assert.strictEqual(jackpotRake(10000, 9600, 3), 200);
  assert.strictEqual(jackpotRake(10010, 10000, 5), 5);
  assert.strictEqual(jackpotRake(10000, 10000, 5), 0);
  for (const own of [1, 500, 9000, 9900, 9999]) assert.ok(10000 - jackpotRake(10000, own, 50) >= own);
});
