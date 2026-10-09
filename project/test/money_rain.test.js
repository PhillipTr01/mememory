const { test } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const rain = require("../game/money_rain");
const seasons = require("../game/seasons");

const names = ["mr_a", "mr_b", "mr_c", "mr_d"];
for (const name of names) h.addUser(name);
h.addUser("mr_out", { approved: false });

function setAll() {
  [100, 2000, 30000, 400000].forEach((coins, i) => h.setCoins(names[i], coins));
}
const others = (list) => list.filter((name) => name.startsWith("mr_"));

test("money rain: who gets it - everybody, who is online, the last % of the leaderboard, less than N coins", async () => {
  rain.reset();
  setAll();
  rain.setOnline(() => ["mr_b", "mr_d", "somebody"]);
  assert.deepStrictEqual(others(await rain.targets({ target: "all", world: "normal" })), names);
  assert.deepStrictEqual(others(await rain.targets({ target: "online", world: "normal" })), ["mr_b", "mr_d"]);
  // (the other players of the tests have coins too: the last ones are counted among everybody)
  const bottom = await rain.targets({ target: "bottom", percent: 100, world: "normal" });
  assert.ok(names.every((name) => bottom.includes(name)));
  assert.deepStrictEqual(others(await rain.targets({ target: "below", below: 5000, world: "normal" })), ["mr_a", "mr_b"]);
  // What the admin enters is checked
  assert.match(rain.check({ amount: 0 }).error, /1 to/);
  assert.match(rain.check({ amount: 5, target: "bottom", percent: 0 }).error, /1 to 100/);
  assert.match(rain.check({ amount: 5, target: "below" }).error, /Less than/);
  assert.match(rain.check({ amount: 5, at: Date.now() - 3600 * 1000 }).error, /future/);
});

test("money rain: right now - paid at once, the pages are told; planned - on time, again the next day", async () => {
  rain.reset();
  setAll();
  const rained = [];
  const onRain = (r) => rained.push(r);
  rain.changes.on("rain", onRain);
  try {
    const now = Date.now();
    const made = await rain.create({ amount: 500, target: "below", below: 5000, note: "Weekend!" }, now);
    assert.strictEqual(made.rain.status, "done");
    assert.deepStrictEqual([h.coinsOf("mr_a"), h.coinsOf("mr_b"), h.coinsOf("mr_c")], [600, 2500, 30000]);
    assert.deepStrictEqual(others(rained[0].names), ["mr_a", "mr_b"]);
    assert.strictEqual(rained[0].note, "Weekend!");

    // Planned for later, every day
    const at = now + 3600 * 1000;
    const planned = await rain.create({ amount: 1000, target: "online", at: at, repeat: "daily" }, now);
    rain.setOnline(() => ["mr_c"]);
    assert.strictEqual(planned.rain.status, "planned");
    await rain.tick(at - 1000);
    assert.strictEqual(h.coinsOf("mr_c"), 30000, "not yet");
    await rain.tick(at + 1000);
    assert.strictEqual(h.coinsOf("mr_c"), 31000);
    const list = rain.list();
    assert.strictEqual(list.planned.length, 1, "the next one");
    assert.strictEqual(list.planned[0].at, at + 24 * 3600 * 1000);
    assert.ok(!(await rain.cancel(list.planned[0].id)).error);
    assert.strictEqual(rain.list().planned.length, 0);
  } finally {
    rain.changes.off("rain", onRain);
    rain.setOnline(() => []);
  }
});

test("money rain: in the season world - only who joined, the season's coins", async () => {
  rain.reset();
  seasons.reset();
  setAll();
  const now = Date.now();
  await seasons.create({ name: "Rain", icon: "☔", start: now - 1000, end: now + 3600 * 1000, budget: 100, every: 0, closeWait: 0 });
  await seasons.tick(now);
  await seasons.join("mr_a", now);
  await rain.create({ amount: 50, target: "all", world: "season" });
  assert.strictEqual(h.userOf("mr_a").seasonCoins, 150);
  assert.strictEqual(h.coinsOf("mr_a"), 100, "the normal coins stay");
  assert.strictEqual(h.userOf("mr_b").seasonCoins || 0, 0, "not in the season");
  seasons.reset();
});
