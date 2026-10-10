const { test } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const shop = require("../game/shop");
const seasons = require("../game/seasons");

h.addUser("sam");
h.addUser("tess");

test("shop: buy with the coins, wear it right away, take it off, wear it again - others see what is worn", async () => {
  h.setCoins("sam", 300000);
  const before = await shop.view("sam");
  assert.ok(before.items.length >= 10);
  assert.deepStrictEqual([before.owned, before.frame, before.effect, before.balance, before.season], [[], null, null, 300000, false]);

  const bought = await shop.buy("sam", "neon");
  assert.ok(!bought.error, bought.error);
  assert.strictEqual(h.coinsOf("sam"), 50000);
  assert.deepStrictEqual([bought.owned, bought.frame], [["neon"], "neon"]);
  assert.match((await shop.buy("sam", "neon")).error, /already/);
  assert.match((await shop.buy("sam", "royal")).error, /enough coins/);
  assert.strictEqual(h.coinsOf("sam"), 50000);
  assert.match((await shop.buy("sam", "nothing")).error, /exist/);

  assert.deepStrictEqual(await shop.worn(["sam", "tess"]), { sam: { frame: "neon", effect: null, background: null } });
  assert.strictEqual((await shop.wear("sam", "frame", null)).frame, null);
  assert.deepStrictEqual(await shop.worn(["sam"]), {});
  assert.strictEqual((await shop.wear("sam", "frame", "neon")).frame, "neon");
  // Only what is owned, only in its kind
  assert.match((await shop.wear("sam", "frame", "gold")).error, /don't have/);
  assert.match((await shop.wear("sam", "effect", "neon")).error, /don't have/);
});

test("shop: always the normal 🪙 - also while a season runs (never the season's coins)", async () => {
  h.setCoins("tess", 500000);
  seasons.reset();
  const now = Date.now();
  const made = await seasons.create({ name: "Shop", icon: "🛍", start: now - 1000, end: now + 3600 * 1000, budget: 999999, every: 0, closeWait: 0 });
  await seasons.tick(now);
  await seasons.join("tess", now);
  try {
    const view = await shop.view("tess");
    assert.deepStrictEqual([view.balance, view.season], [500000, false]);
    const bought = await shop.buy("tess", "gold");
    assert.ok(!bought.error);
    assert.strictEqual(h.coinsOf("tess"), 400000);
    assert.strictEqual(h.userOf("tess").seasonCoins, 999999, "the season's coins stay");
  } finally {
    await seasons.endNow(made.season.id);
    seasons.reset();
  }
});

test("shop admin: prices and items off - free for all lets everybody wear everything, off again it comes off (bought stays)", async () => {
  h.addUser("uma");
  h.setCoins("uma", 20000);
  shop.reset();
  try {
    // A new price, an item off: not in the shop, can't be bought or worn
    let config = await shop.update({ items: { gold: { price: 1234 }, neon: { on: false } } });
    assert.strictEqual(config.items.find((i) => i.id === "gold").price, 1234);
    assert.strictEqual(config.items.find((i) => i.id === "gold").defaultPrice, 100000);
    assert.ok(!(await shop.view("uma")).items.some((i) => i.id === "neon"));
    assert.match((await shop.buy("uma", "neon")).error, /exist/);
    assert.ok(!(await shop.buy("uma", "gold")).error);
    assert.strictEqual(h.coinsOf("uma"), 20000 - 1234);
    assert.match((await shop.update({ items: { gold: { price: -5 } } })).error, /price/);

    // Free for all: everything that is on, without buying - no shopping meanwhile
    await shop.update({ free: true });
    assert.ok(!(await shop.wear("uma", "effect", "halo")).error);
    assert.ok(!(await shop.wear("uma", "frame", "galaxy")).error);
    assert.match((await shop.wear("uma", "frame", "neon")).error, /don't have/, "off stays off");
    assert.match((await shop.buy("uma", "royal")).error, /free/);
    assert.deepStrictEqual(await shop.worn(["uma"]), { uma: { frame: "galaxy", effect: "halo", background: null } });

    // Off again: what was not bought comes off - in the database too
    await shop.update({ free: false });
    assert.deepStrictEqual(await shop.worn(["uma"]), {});
    assert.deepStrictEqual([h.userOf("uma").looks.frame, h.userOf("uma").looks.effect], [null, null]);
    assert.deepStrictEqual(h.userOf("uma").looks.owned, ["gold"]);
    // An item turned off: who bought it doesn't wear it (and keeps it)
    await shop.wear("uma", "frame", "gold");
    await shop.update({ items: { gold: { on: false } } });
    assert.deepStrictEqual(await shop.worn(["uma"]), {});
    await shop.update({ items: { gold: { on: true } } });
    assert.deepStrictEqual(await shop.worn(["uma"]), { uma: { frame: "gold", effect: null, background: null } });
  } finally {
    shop.reset();
  }
});

test("shop: the admin gives a player a reward - any item and / or coins, with a note", async () => {
  shop.reset();
  h.addUser("gwen");
  h.setCoins("gwen", 100);
  assert.match((await shop.give({ username: "gwen" })).error, /an item, coins or a prize/);
  assert.match((await shop.give({ username: "nobody", coins: 5 })).error, /No such player/);
  assert.match((await shop.give({ username: "gwen", items: ["neon", "gold"] })).error, /one frame/);
  const result = await shop.give({ username: "gwen", items: ["spotlight"], coins: 2500, note: "Poker night" });
  assert.ok(!result.error, result.error);
  await h.wait(20);
  assert.strictEqual(h.coinsOf("gwen"), 2600);
  const view = await shop.view("gwen");
  assert.ok(view.owned.includes("spotlight"));
  assert.deepStrictEqual([view.won[0].source, view.won[0].rank], ["Poker night", null]);
});

test("shop: a prize of your own (a text) - on its own or with the rest, in the history for the admin", async () => {
  shop.reset();
  h.addUser("pia");
  const before = h.coinLogs.length;
  assert.ok(!(await shop.give({ username: "pia", prize: "€20 voucher", note: "Quiz night" })).error, "a prize alone is enough");
  assert.match((await shop.give({ username: "pia", prize: "x".repeat(81) })).error, /80 characters/);
  await h.wait(20);
  const rows = h.coinLogs.slice(before).filter((row) => row.reason === "prize");
  assert.deepStrictEqual(rows.map((row) => [row.amount, row.note]), [[0, "€20 voucher · Quiz night"]]);
});

test("shop: exclusive items can't be bought - the admin moves any item between the categories (exclusive or a rarity), the shop stays sorted", async () => {
  shop.reset();
  h.addUser("cat");
  h.setCoins("cat", 9000000);
  assert.match((await shop.buy("cat", "champion")).error, /can't be bought/);
  assert.match((await shop.wear("cat", "frame", "champion")).error, /don't have/);
  // Into the shop: with its price, sold like the rest - a shop item out of it: exclusive
  assert.ok(!(await shop.update({ items: { champion: { rarity: "legendary" }, gold: { rarity: "exclusive" } } })).error);
  const champion = shop.items().find((item) => item.id === "champion");
  assert.deepStrictEqual([champion.rarity, champion.exclusive, champion.defaultRarity], ["legendary", false, "exclusive"]);
  assert.ok(!(await shop.buy("cat", "champion")).error, "now for sale");
  assert.match((await shop.buy("cat", "gold")).error, /can't be bought/);
  assert.ok((await shop.update({ items: { gold: { rarity: "mythic" } } })).error, "an unknown category");
  // Sorted: by rarity, then by price
  const order = ["common", "rare", "epic", "legendary", "exclusive"];
  const list = shop.items();
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1];
    const b = list[i];
    assert.ok(order.indexOf(a.rarity) < order.indexOf(b.rarity) || (a.rarity === b.rarity && a.price <= b.price), `${a.id} before ${b.id}`);
  }
  shop.reset();
});

test("shop: backgrounds - bought and worn like the rest, one of each kind (a reward too)", async () => {
  h.addUser("vic");
  h.setCoins("vic", 1000000);
  const bought = await shop.buy("vic", "sunset");
  assert.ok(!bought.error, bought.error);
  assert.strictEqual(bought.background, "sunset");
  assert.deepStrictEqual(await shop.worn(["vic"]), { vic: { frame: null, effect: null, background: "sunset" } });
  assert.strictEqual((await shop.wear("vic", "background", null)).background, null);
  assert.match((await shop.wear("vic", "background", "nebula")).error, /don't have/);
  assert.match((await shop.give({ username: "vic", items: ["sunset", "nebula"] })).error, /one background at most/);
  assert.ok(!(await shop.give({ username: "vic", items: ["nebula", "gold"] })).error);
  assert.strictEqual((await shop.wear("vic", "background", "nebula")).background, "nebula");
  assert.strictEqual(shop.ITEMS.filter((item) => item.kind == "background" && item.rarity != "exclusive").length, 20);
  assert.strictEqual(shop.ITEMS.filter((item) => item.kind == "background" && item.rarity == "exclusive").length, 5);
});
