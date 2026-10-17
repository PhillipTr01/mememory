const { test } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const shop = require("../game/shop");
const seasons = require("../game/seasons");

h.addUser("sam");
h.addUser("tess");

test("shop: buy with the coins, wear it right away, take it off, wear it again - others see what is worn", async () => {
  h.setCoins("sam", 3000000);
  const before = await shop.view("sam");
  assert.ok(before.items.length >= 10);
  assert.deepStrictEqual([before.owned, before.frame, before.effect, before.balance, before.season], [[], null, null, 3000000, false]);

  const bought = await shop.buy("sam", "neon");
  assert.ok(!bought.error, bought.error);
  assert.strictEqual(h.coinsOf("sam"), 500000);
  assert.deepStrictEqual([bought.owned, bought.frame], [["neon"], "neon"]);
  assert.match((await shop.buy("sam", "neon")).error, /already/);
  assert.match((await shop.buy("sam", "royal")).error, /enough coins/);
  assert.strictEqual(h.coinsOf("sam"), 500000);
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
  h.setCoins("tess", 5000000);
  seasons.reset();
  const now = Date.now();
  const made = await seasons.create({ name: "Shop", icon: "🛍", start: now - 1000, end: now + 3600 * 1000, budget: 999999, every: 0, closeWait: 0 });
  await seasons.tick(now);
  await seasons.join("tess", now);
  try {
    const view = await shop.view("tess");
    assert.deepStrictEqual([view.balance, view.season], [5000000, false]);
    const bought = await shop.buy("tess", "gold");
    assert.ok(!bought.error);
    assert.strictEqual(h.coinsOf("tess"), 4000000);
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
    assert.strictEqual(config.items.find((i) => i.id === "gold").defaultPrice, 1000000);
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
  const result = await shop.give({ username: "gwen", items: ["constellation"], coins: 2500, note: "Poker night" });
  assert.ok(!result.error, result.error);
  await h.wait(20);
  assert.strictEqual(h.coinsOf("gwen"), 2600);
  const view = await shop.view("gwen");
  assert.ok(view.owned.includes("constellation"));
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
  h.setCoins("cat", 90000000);
  assert.match((await shop.buy("cat", "champion")).error, /can't be bought/);
  assert.match((await shop.wear("cat", "frame", "champion")).error, /don't have/);
  // Into the shop: with its price, sold like the rest - a shop item out of it: exclusive
  assert.ok(!(await shop.update({ items: { champion: { rarity: "legendary" }, gold: { rarity: "exclusive" } } })).error);
  const champion = shop.items().find((item) => item.id === "champion");
  assert.deepStrictEqual([champion.rarity, champion.exclusive, champion.defaultRarity], ["legendary", false, "exclusive"]);
  assert.ok(!(await shop.buy("cat", "champion")).error, "now for sale");
  assert.match((await shop.buy("cat", "gold")).error, /can't be bought/);
  assert.ok((await shop.update({ items: { gold: { rarity: "nonsense" } } })).error, "an unknown category");
  // Sorted: by rarity, then (the sets together) by price
  const order = shop.RARITIES;
  const list = shop.items();
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1];
    const b = list[i];
    assert.ok(order.indexOf(a.rarity) < order.indexOf(b.rarity) || (a.rarity === b.rarity && (a.set || b.set || a.price <= b.price)), `${a.id} before ${b.id}`);
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
  assert.strictEqual(shop.ITEMS.filter((item) => item.kind == "background" && !["exclusive", "unique"].includes(item.rarity)).length, 18);
});

test("season prizes are like rewards: a prize of your own, coins and items - given to the places at the end", async () => {
  shop.reset();
  seasons.reset();
  h.addUser("vic");
  h.addUser("wes");
  h.setCoins("vic", 1000);
  h.setCoins("wes", 1000);
  const now = Date.now();
  const bad = await seasons.create({ name: "P", icon: "🏆", start: now - 1000, end: now + 3600 * 1000, budget: 100, every: 0, closeWait: 0, prizesOn: true, prizes: [{ place: 1, items: ["neon", "gold"] }] });
  assert.match(bad.error, /place 1: one frame/);
  const made = await seasons.create({
    name: "Prizes",
    icon: "🏆",
    start: now - 1000,
    end: now + 3600 * 1000,
    budget: 100,
    every: 0,
    closeWait: 0,
    wagerX: 0,
    prizesOn: true,
    prizes: [
      { place: 1, prize: "€25 voucher", coins: 10000, items: ["constellation"] },
      { place: 2, coins: 500 },
    ],
  });
  assert.ok(!made.error, made.error);
  assert.strictEqual(made.season.prizes[0].label, "€25 voucher · 🪙 10,000 · " + shop.byId("constellation").name);
  await seasons.tick(now);
  await seasons.join("vic", now);
  await seasons.join("wes", now);
  h.userOf("vic").seasonCoins = 900;
  await seasons.endNow(made.season.id);
  await h.wait(30);
  // vic first (900 + 1000 back + 10,000), wes second (100 + 1000 + 500)
  assert.deepStrictEqual([h.coinsOf("vic"), h.coinsOf("wes")], [11900, 1600]);
  assert.ok((await shop.view("vic")).owned.includes("constellation"));
  assert.deepStrictEqual(
    (await shop.view("vic")).won.map((w) => [w.source, w.rank]),
    [["Prizes", 1]],
  );
  assert.ok(h.coinLogs.some((row) => row.username === "vic" && row.reason === "prize" && /€25 voucher/.test(row.note)));
  seasons.reset();
});

for (const [set, name, ids] of [
  ["voidmirror", "Void Mirror", ["voidmirror", "voidecho", "voidglass"]],
  ["mage", "Archmage", ["archmage", "arcane", "astral"]],
  ["panda", "Panda Master", ["pandamaster", "bamboostorm", "bambooforest"]],
  ["ink", "Ink Blot", ["inkblot", "inktendrils", "rorschach"]],
]) {
  test(`shop: the ${name} set - a frame, an animation and a background that belong together`, () => {
    const items = shop.ITEMS.filter((item) => item.set === set);
    assert.deepStrictEqual(items.map((item) => [item.id, item.kind]), [[ids[0], "frame"], [ids[1], "effect"], [ids[2], "background"]]);
    assert.ok(items.every((item) => item.rarity === "unique"), "unique - one player only");
    const css = require("fs").readFileSync(require("path").join(__dirname, "../public/styles/looks.css"), "utf8");
    for (const id of ["look-frame-" + ids[0], "look-fx-" + ids[1], "look-bg-" + ids[2]]) assert.ok(css.includes("." + id), id);
  });
}

test("shop: mythic - sold, only as sets, after legendary; a whole set at once (only what is missing), then worn", async () => {
  shop.reset();
  assert.deepStrictEqual(shop.RARITIES.slice(3, 5), ["legendary", "mythic"]);
  const mythic = shop.ITEMS.filter((item) => item.rarity === "mythic");
  assert.ok(mythic.length >= 6 && mythic.every((item) => item.set), "mythic: only sets");
  // dearer than every legendary item
  const legendary = Math.max(...shop.ITEMS.filter((item) => item.rarity === "legendary").map((item) => item.price));
  assert.ok(mythic.every((item) => item.price > legendary));
  h.addUser("myra");
  const price = (set) => mythic.filter((item) => item.set === set).reduce((sum, item) => sum + item.price, 0);
  h.setCoins("myra", price("grove") - 1);
  assert.match((await shop.buySet("myra", "grove")).error, /enough coins/);
  // one piece first - then the rest of the set, only what is missing
  h.setCoins("myra", price("grove"));
  assert.ok(!(await shop.buy("myra", "fireflies")).error);
  const view = await shop.buySet("myra", "grove");
  assert.ok(!view.error, view.error);
  assert.deepStrictEqual(view.bought.sort(), ["grovevines", "moonlitgrove"]);
  assert.strictEqual(h.coinsOf("myra"), 0);
  assert.deepStrictEqual([view.frame, view.effect, view.background], ["grovevines", "fireflies", "moonlitgrove"]);
  assert.match((await shop.buySet("myra", "grove")).error, /already/);
  // exclusive sets: never sold
  assert.match((await shop.buySet("myra", "phoenix")).error, /can't be bought/);
  assert.match((await shop.buySet("myra", "nothing")).error, /doesn't exist/);
});

test("shop: every set complete - a frame, an animation and a background, all in one category, with the set's name", () => {
  const sets = [...new Set(shop.ITEMS.filter((item) => item.set).map((item) => item.set))];
  assert.deepStrictEqual(sets.sort(), Object.keys(shop.SETS).sort());
  for (const set of sets) {
    const items = shop.ITEMS.filter((item) => item.set === set);
    assert.deepStrictEqual(items.map((item) => item.kind).sort(), ["background", "effect", "frame"], set);
    assert.strictEqual(new Set(items.map((item) => item.rarity)).size, 1, set);
    for (const item of shop.items().filter((i) => i.set === set)) assert.strictEqual(item.setName, shop.SETS[set]);
  }
  // in the shop's order: a set together - frame, animation, background
  const order = shop.items().filter((item) => item.set === "phoenix").map((item) => item.id);
  const all = shop.items().map((item) => item.id);
  assert.deepStrictEqual(order, ["phoenix", "rebirth", "phoenixsky"]);
  assert.strictEqual(all.indexOf("phoenixsky") - all.indexOf("phoenix"), 2);
});

test("shop: unique items - hidden from the shop (only their owner sees them), never sold, one player only", async () => {
  shop.reset();
  h.addUser("uno");
  h.addUser("duo");
  h.setCoins("uno", 9000000);
  // Hidden: not in anybody's shop - not bought, not worn
  assert.ok(!(await shop.view("uno")).items.some((item) => item.id === "voidmirror"));
  assert.match((await shop.buy("uno", "voidmirror")).error, /can't be bought/);
  assert.match((await shop.wear("uno", "frame", "voidmirror")).error, /don't have/);
  // (free for all: still not for everybody)
  await shop.update({ free: true });
  assert.match((await shop.wear("uno", "frame", "voidmirror")).error, /don't have/);
  await shop.update({ free: false });
  // Given to one player: in their shop, worn - nobody else can get it
  assert.ok(!(await shop.give({ username: "uno", items: ["voidmirror"] })).error);
  assert.ok((await shop.view("uno")).items.some((item) => item.id === "voidmirror"));
  assert.ok(!(await shop.wear("uno", "frame", "voidmirror")).error);
  assert.ok(!(await shop.view("duo")).items.some((item) => item.id === "voidmirror"));
  assert.match((await shop.give({ username: "duo", items: ["voidmirror"] })).error, /belongs to uno/);
  assert.deepStrictEqual(await shop.owners(), { voidmirror: "uno" });
  // (a season prize can't hand it out twice either)
  await shop.reward("duo", { items: ["voidmirror"], coins: 0, prize: "" }, { source: "Test" });
  assert.ok(!shop.looksOf(await require("../models/User").findOne({ username: "duo" })).owned.includes("voidmirror"));
  // Taken away: free for someone else again
  await shop.removeItem("uno", "voidmirror");
  assert.ok(!(await shop.give({ username: "duo", items: ["voidmirror"] })).error);
  assert.deepStrictEqual(await shop.owners(), { voidmirror: "duo" });
  shop.reset();
});

