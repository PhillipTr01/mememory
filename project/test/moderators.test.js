const { test } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const mods = require("../game/moderators");
const rain = require("../game/money_rain");
const chat = require("../game/casino_chat");

for (const name of ["md_mod", "md_a", "md_b", "md_c"]) h.addUser(name);
h.addUser("md_out", { approved: false });

test("moderators: the admin makes a player a moderator - with the rights and limits picked", async () => {
  mods.reset();
  assert.strictEqual(await mods.get("md_mod"), null);
  assert.match((await mods.set("md_out", { on: true })).error, /access to the casino/);
  assert.match((await mods.set("md_mod", { on: true, rainMax: 0 })).error, /1 to/);
  const made = await mods.set("md_mod", { on: true, perms: { rain: true, chat: true, announce: false }, rainMax: 50000, rainWeekly: 60000 });
  assert.deepStrictEqual(made.mod.perms, { rain: true, chat: true, announce: false });
  assert.ok(mods.names().includes("md_mod"), "the chat knows it");
  assert.deepStrictEqual((await mods.list()).map((m) => m.username), ["md_mod"]);
});

test("moderators: a money rain - every player online gets the amount (the moderator too, never alone), the limits count it once", async () => {
  rain.reset();
  mods.reset();
  await mods.set("md_mod", { on: true, perms: { rain: true }, rainMax: 50000, rainWeekly: 60000 });
  const online = ["md_mod", "md_a", "md_b"];
  rain.setOnline(() => online);
  try {
    for (const name of [...online, "md_c"]) h.setCoins(name, 1000);
    assert.match((await mods.rain("md_mod", { amount: 50001 })).error, /At most/);
    assert.deepStrictEqual(await mods.rainPreview("md_mod", { amount: 10000 }), { players: 3, others: 2, each: 10000, total: 30000 });
    const sent = await mods.rain("md_mod", { amount: 10000, note: "Party" });
    assert.ok(!sent.error, sent.error);
    assert.deepStrictEqual([sent.players, sent.each, sent.total, sent.left], [3, 10000, 30000, 50000], "the week's limit: 10,000 counted (not 30,000)");
    for (const name of online) assert.strictEqual(h.coinsOf(name), 11000, name + ": the moderator gets theirs too");
    assert.strictEqual(h.coinsOf("md_c"), 1000, "not online: nothing");
    // 12 hours (at least) until the next one
    assert.match((await mods.set("md_mod", { on: true, perms: { rain: true }, rainCooldown: 11 })).error, /at least 12/);
    const wait = await mods.rain("md_mod", { amount: 100 });
    assert.match(wait.error, /rain again in (11 h 59 min|12 h)/);
    // (the wait over: the limit of the week counts - 60,000, 50,000 left)
    const User = require("../models/User");
    const user = await User.findOne({ username: "md_mod" }).lean();
    await User.updateOne({ username: "md_mod" }, { $set: { mod: { ...user.mod, lastRain: Date.now() - 13 * 3600 * 1000 } } });
    assert.match((await mods.rain("md_mod", { amount: 50001 })).error, /At most|more this week/);
    assert.ok(!(await mods.rain("md_mod", { amount: 45000 })).error, "within 50,000 left - 3 x 45,000 paid is fine");
    assert.strictEqual(h.coinsOf("md_a"), 1000 + 10000 + 45000);
    // Alone online - or only with other moderators: no money rain (the wait over again)
    const again = await User.findOne({ username: "md_mod" }).lean();
    await User.updateOne({ username: "md_mod" }, { $set: { mod: { ...again.mod, lastRain: Date.now() - 13 * 3600 * 1000 } } });
    rain.setOnline(() => ["md_mod"]);
    assert.match((await mods.rain("md_mod", { amount: 100 })).error, /but moderators/);
    await mods.set("md_c", { on: true, perms: { chat: true } });
    rain.setOnline(() => ["md_mod", "md_c"]);
    assert.match((await mods.rain("md_mod", { amount: 100 })).error, /but moderators/);
    assert.strictEqual((await mods.rainPreview("md_mod", { amount: 100 })).others, 0);
    await mods.set("md_c", { on: false });
    // Written down - and in the admin's list of money rains, with who made it
    assert.ok((await mods.history("md_mod")).some((entry) => entry.action === "rain"));
    assert.strictEqual(rain.list().done[0].by, "md_mod");
    // In a season: never
    assert.match((await mods.rain("md_mod", { amount: 100 }, "season")).error, /No money rains in a season/);
    // Without the right: no
    await mods.set("md_mod", { on: true, perms: { rain: false } });
    assert.match((await mods.rain("md_mod", { amount: 100 })).error, /may not/);
  } finally {
    rain.setOnline(() => []);
  }
});

test("moderators: the chat - delete a message, mute for a while (not other moderators), announce", async () => {
  mods.reset();
  chat.clear();
  await mods.set("md_mod", { on: true, perms: { chat: true, announce: true } });
  await mods.set("md_b", { on: true, perms: { chat: true } });
  chat.announce("md_a", "a message to delete");
  const id = chat.messages()[0].id;
  assert.match((await mods.deleteMessage("md_a", id)).error, /may not/);
  assert.ok((await mods.deleteMessage("md_mod", id)).ok);
  assert.strictEqual(chat.messages().length, 0);
  assert.match((await mods.mute("md_mod", "md_a", 2000)).error, /1 to 1440/);
  assert.match((await mods.mute("md_mod", "md_b", 10)).error, /each other/);
  assert.match((await mods.mute("md_mod", "md_mod", 10)).error, /yourself/);
  const muted = await mods.mute("md_mod", "md_a", 10);
  assert.deepStrictEqual(muted.mutes.map((m) => m.username), ["md_a"]);
  assert.ok((await mods.unmute("md_mod", "md_a")).ok);
  assert.ok((await mods.announce("md_mod", "Tournament at 8!")).ok);
  assert.deepStrictEqual([chat.messages()[0].type, chat.messages()[0].name, chat.messages()[0].text], ["announce", "md_mod", "Tournament at 8!"]);
  assert.deepStrictEqual((await mods.history("md_mod")).map((e) => e.action), ["announce", "unmute", "mute", "delete"]);
  await mods.set("md_b", { on: false });
  assert.ok(!mods.names().includes("md_b"));
});
