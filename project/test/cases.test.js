const { test } = require("node:test");
const assert = require("node:assert");
require("./helpers");
const cases = require("../game/cases");

const editable = (box) => ({ name: box.name, icon: box.icon, price: box.price, risk: box.risk, items: box.items.map((item) => ({ name: item.name, icon: item.icon, value: item.value, weight: item.weight })) });

test("cases editor: the RTP balancer hits the target - only the chances move, the order stays", () => {
  cases.useDefaults();
  const box = cases.caseById("starter");
  for (const target of [0.8, 0.9, 0.99]) {
    const result = cases.balance(box.items, box.price, target);
    assert.ok(Math.abs(result.rtp - target) < 0.002, `${target}: ${result.rtp}`);
    assert.deepStrictEqual(result.items.map((item) => item.value), box.items.map((item) => item.value));
    assert.strictEqual(result.items.reduce((sum, item) => sum + item.weight, 0), cases.WEIGHT_TOTAL);
  }
  // Lower target: the most expensive item rarer
  assert.ok(cases.balance(box.items, box.price, 0.8).items[5].weight < box.items[5].weight);
  assert.match(cases.balance(box.items, box.price, 9).error, /between/);
});

test("cases editor: a change is a new version - battles with the old one keep it; restore, delete, bring back", async () => {
  cases.useDefaults();
  const before = cases.caseById("starter");
  const oldKey = before.key;
  const result = await cases.update("starter", { ...editable(before), price: 12, target: 0.9, autoBalance: true });
  assert.ok(!result.error, result.error);
  assert.strictEqual(result.case.price, 12);
  assert.ok(Math.abs(result.case.rtp - 0.9) < 0.002);
  // The new version is the one to pick - the old one is still there for its battles
  const now = cases.current("starter");
  assert.notStrictEqual(now.key, oldKey);
  assert.strictEqual(cases.caseById(oldKey).price, 10);
  assert.ok(cases.enabled(now.key) && !cases.enabled(oldKey));
  const catalog = cases.catalog();
  assert.ok(catalog.find((box) => box.id === oldKey).retired && catalog.find((box) => box.id === oldKey).off);
  // Versions: the old one back (as a new version)
  assert.deepStrictEqual(cases.versions("starter").map((v) => v.price), [10]);
  const back = await cases.restoreVersion("starter", oldKey);
  assert.strictEqual(back.case.price, 10);
  assert.deepStrictEqual(cases.versions("starter").map((v) => v.price).sort(), [10, 12]);
  // An earlier version no battle has: removable - one a battle has: not
  const versionKey = cases.versions("starter")[0].key;
  cases.setUsedLookup(() => new Set([versionKey]));
  assert.strictEqual(cases.versions("starter")[0].used, true);
  assert.match((await cases.removeVersion("starter", versionKey)).error, /battle/);
  cases.setUsedLookup(() => new Set());
  assert.deepStrictEqual(await cases.removeVersion("starter", versionKey), { ok: true });
  assert.ok(!cases.versions("starter").some((v) => v.key === versionKey));
  // A new case, deleted - and back
  const made = await cases.create({ name: "Test Box!", icon: "🧪", price: 100, risk: "high", target: 0.85, autoBalance: true, items: [{ name: "A", icon: "🅰️", value: 10, weight: 70 }, { name: "B", icon: "🅱️", value: 400, weight: 30 }] });
  assert.strictEqual(made.case.id, "testbox");
  assert.ok(Math.abs(made.case.rtp - 0.85) < 0.002);
  await cases.remove("testbox");
  assert.strictEqual(cases.list().some((box) => box.id === "testbox"), false);
  const gone = cases.deletedCases().find((box) => box.id === "testbox");
  assert.ok(gone);
  await cases.restoreVersion("testbox", gone.key);
  assert.ok(cases.list().some((box) => box.id === "testbox"));
  // Checked: names, prices, at least two items
  assert.match((await cases.create({ name: "", icon: "x", price: 1, risk: "low", items: [] })).error, /name/);
  assert.match((await cases.update("starter", { ...editable(cases.current("starter")), items: [] })).error, /items/);
  cases.useDefaults();
});
