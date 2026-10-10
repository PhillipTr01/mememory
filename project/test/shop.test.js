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

  assert.deepStrictEqual(await shop.worn(["sam", "tess"]), { sam: { frame: "neon", effect: null } });
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
    assert.deepStrictEqual(await shop.worn(["uma"]), { uma: { frame: "galaxy", effect: "halo" } });

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
    assert.deepStrictEqual(await shop.worn(["uma"]), { uma: { frame: "gold", effect: null } });
  } finally {
    shop.reset();
  }
});

test("shop: exclusive items can't be bought - the places of a season get items and coins at its end and keep them", async () => {
  shop.reset();
  h.addUser("win1");
  h.addUser("win2");
  h.addUser("win5");
  h.addUser("win20");
  h.setCoins("win1", 9000000);
  h.setCoins("win2", 0);
  assert.match((await shop.buy("win1", "champion")).error, /can't be bought/);
  assert.match((await shop.wear("win1", "frame", "champion")).error, /don't have/);
  // How to get them: from the rules
  const view = await shop.view("win1");
  assert.strictEqual(view.items.find((item) => item.id === "champion").howToWin, "1st place of a season");
  assert.strictEqual(view.items.find((item) => item.id === "starfall").howToWin, "Places 4-10 of a season");

  // Any item, coins too
  await shop.update({ seasonRewards: [...shop.SEASON_REWARDS.slice(0, 1), { from: 2, to: 2, items: ["runnerup", "hearts"], coins: 5000 }, ...shop.SEASON_REWARDS.slice(2)] });
  const given = await shop.awardSeason({ name: "Spring", icon: "🌸" }, [
    { rank: 1, username: "win1" },
    { rank: 2, username: "win2" },
    { rank: 5, username: "win5" },
    { rank: 20, username: "win20" },
    { rank: null, username: "tess" },
  ]);
  assert.deepStrictEqual(
    given.map((g) => [g.username, g.items, g.coins]),
    [
      ["win1", ["champion", "crowned"], 0],
      ["win2", ["runnerup", "hearts"], 5000],
      ["win5", ["contender", "starfall"], 0],
    ],
  );
  await h.wait(20);
  assert.strictEqual(h.coinsOf("win2"), 5000, "the coins: the normal 🪙");
  assert.ok((await shop.view("win2")).owned.includes("hearts"), "a shop item can be a reward too");
  const won = await shop.view("win1");
  assert.ok(won.owned.includes("champion") && won.owned.includes("crowned"));
  assert.deepStrictEqual([won.won[0].source, won.won[0].rank], ["Spring", 1]);
  assert.strictEqual((await shop.wear("win1", "frame", "champion")).frame, "champion");
  assert.strictEqual((await shop.wear("win1", "effect", "crowned")).effect, "crowned");
  assert.deepStrictEqual(await shop.worn(["win1"]), { win1: { frame: "champion", effect: "crowned" } });
  // Buying something else keeps what was won
  const bought = await shop.buy("win1", "gold");
  assert.ok(!bought.error, bought.error);
  assert.ok(bought.owned.includes("champion"));
  assert.deepStrictEqual(h.userOf("win1").looks.owned, ["gold"], "the stored list: only what was bought");
  assert.strictEqual((await shop.view("win20")).owned.length, 0);
  shop.reset();
});

test("shop: the admin gives a player a reward - any item and / or coins, with a note", async () => {
  shop.reset();
  h.addUser("gwen");
  h.setCoins("gwen", 100);
  assert.match((await shop.give({ username: "gwen" })).error, /item or coins/);
  assert.match((await shop.give({ username: "nobody", coins: 5 })).error, /No such player/);
  assert.match((await shop.give({ username: "gwen", items: ["neon", "gold"] })).error, /one frame/);
  const result = await shop.give({ username: "gwen", items: ["spotlight"], coins: 2500, note: "Poker night" });
  assert.ok(!result.error, result.error);
  await h.wait(20);
  assert.strictEqual(h.coinsOf("gwen"), 2600);
  const view = await shop.view("gwen");
  assert.ok(view.owned.includes("spotlight"));
  assert.deepStrictEqual([view.won[0].source, view.won[0].rank], ["Poker night", null]);
  assert.strictEqual((await shop.view("gwen")).items.find((item) => item.id === "podium").howToWin, "3rd place of a season");
});

test("shop: the admin sets which places win what - one frame and one animation per rule, coins", async () => {
  shop.reset();
  assert.ok((await shop.update({ seasonRewards: [{ from: 1, to: 3, items: ["champion", "runnerup"] }] })).error, "two frames");
  assert.ok((await shop.update({ seasonRewards: [{ from: 2, to: 1, items: ["champion"] }] })).error, "from after to");
  assert.ok((await shop.update({ seasonRewards: [{ from: 1, to: 1, items: [] }] })).error, "nothing");
  assert.ok((await shop.update({ seasonRewards: [{ from: 1, to: 1, items: [], coins: -5 }] })).error, "coins below 0");
  const saved = await shop.update({ seasonRewards: [{ from: 1, to: 5, items: ["crowned"], coins: 1000 }, { from: 1, to: 1, items: ["champion"], coins: 9000 }, { from: 6, to: 6, items: [], coins: 50 }] });
  assert.ok(!saved.error, saved.error);
  assert.deepStrictEqual(shop.rewardsFor(1).items.sort(), ["champion", "crowned"], "every rule that covers the place");
  assert.strictEqual(shop.rewardsFor(1).coins, 10000);
  assert.deepStrictEqual(shop.rewardsFor(4), { items: ["crowned"], coins: 1000 });
  assert.deepStrictEqual(shop.rewardsFor(6), { items: [], coins: 50 });
  assert.deepStrictEqual(shop.rewardsFor(7), { items: [], coins: 0 });
  await shop.update({ seasonRewards: [] });
  assert.deepStrictEqual(shop.rewardsFor(1).items, [], "no rules: nothing");
  await shop.update({ seasonRewards: null });
  assert.deepStrictEqual(shop.rewardsFor(1).items, ["champion", "crowned"], "back to the default");
  shop.reset();
});

test("shop: a season that ends gives its places their rewards", async () => {
  shop.reset();
  seasons.reset();
  h.addUser("vic");
  h.setCoins("vic", 1000);
  const now = Date.now();
  const made = await seasons.create({ name: "Summer", icon: "☀️", start: now - 1000, end: now + 3600 * 1000, budget: 5000, every: 0, closeWait: 0, wagerX: 0 });
  assert.ok(!made.error, made.error);
  await seasons.tick(now);
  await seasons.join("vic", now);
  await seasons.endNow(made.season.id);
  seasons.reset();
  const won = (h.userOf("vic").looks || {}).won || [];
  assert.deepStrictEqual(won.map((entry) => [entry.id, entry.source, entry.rank]), [["champion", "Summer", 1], ["crowned", "Summer", 1]]);
});
