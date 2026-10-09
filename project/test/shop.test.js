const { test } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const shop = require("../game/shop");
const seasons = require("../game/seasons");

h.addUser("sam");
h.addUser("tess");

test("shop: buy with the coins, wear it right away, take it off, wear it again - others see what is worn", async () => {
  h.setCoins("sam", 30000);
  const before = await shop.view("sam");
  assert.ok(before.items.length >= 10);
  assert.deepStrictEqual([before.owned, before.frame, before.effect, before.balance, before.season], [[], null, null, 30000, false]);

  const bought = await shop.buy("sam", "neon");
  assert.ok(!bought.error, bought.error);
  assert.strictEqual(h.coinsOf("sam"), 5000);
  assert.deepStrictEqual([bought.owned, bought.frame], [["neon"], "neon"]);
  assert.match((await shop.buy("sam", "neon")).error, /already/);
  assert.match((await shop.buy("sam", "royal")).error, /enough coins/);
  assert.strictEqual(h.coinsOf("sam"), 5000);
  assert.match((await shop.buy("sam", "nothing")).error, /exist/);

  assert.deepStrictEqual(await shop.worn(["sam", "tess"]), { sam: { frame: "neon", effect: null } });
  assert.strictEqual((await shop.wear("sam", "frame", null)).frame, null);
  assert.deepStrictEqual(await shop.worn(["sam"]), {});
  assert.strictEqual((await shop.wear("sam", "frame", "neon")).frame, "neon");
  // Only what is owned, only in its kind
  assert.match((await shop.wear("sam", "frame", "gold")).error, /don't have/);
  assert.match((await shop.wear("sam", "effect", "neon")).error, /don't have/);
});

test("shop: in a season it takes the coins from before the season - never the season's", async () => {
  h.setCoins("tess", 50000);
  const original = { running: seasons.running, storedOf: seasons.storedOf, spendSaved: seasons.spendSaved };
  const saved = { tess: 12000 };
  Object.assign(seasons, {
    running: () => ({ id: 1 }),
    storedOf: (name) => saved[name] ?? null,
    spendSaved: async (name, amount) => (saved[name] >= amount ? ((saved[name] -= amount), true) : false),
  });
  try {
    const view = await shop.view("tess");
    assert.deepStrictEqual([view.balance, view.season], [12000, true]);
    assert.match((await shop.buy("tess", "ice")).error, /before the season/);
    const bought = await shop.buy("tess", "gold");
    assert.ok(!bought.error);
    assert.strictEqual(saved.tess, 2000);
    assert.strictEqual(h.coinsOf("tess"), 50000, "the season's coins stay");
  } finally {
    Object.assign(seasons, original);
  }
});
