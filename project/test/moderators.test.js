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
  assert.deepStrictEqual(made.mod.perms, { rain: true, chat: true, announce: false, give: false });
  assert.ok(mods.names().includes("md_mod"), "the chat knows it");
  assert.deepStrictEqual((await mods.list()).map((m) => m.username), ["md_mod"]);
});

test("moderators: a money rain - every player online gets the amount (the moderator too - also with only moderators online), the limits count it once", async () => {
  rain.reset();
  mods.reset();
  await mods.set("md_mod", { on: true, perms: { rain: true }, rainMax: 50000, rainWeekly: 60000 });
  const online = ["md_mod", "md_a", "md_b"];
  rain.setOnline(() => online);
  try {
    for (const name of [...online, "md_c"]) h.setCoins(name, 1000);
    assert.match((await mods.rain("md_mod", { amount: 50001 })).error, /At most/);
    assert.deepStrictEqual(await mods.rainPreview("md_mod", { amount: 10000 }), { players: 3, each: 10000, total: 30000 });
    const sent = await mods.rain("md_mod", { amount: 10000, note: "Party" });
    assert.ok(!sent.error, sent.error);
    assert.deepStrictEqual([sent.players, sent.each, sent.total, sent.left], [3, 10000, 30000, 50000], "the week's limit: 10,000 counted (not 30,000)");
    for (const name of online) assert.strictEqual(h.coinsOf(name), 11000, name + ": the moderator gets theirs too");
    assert.strictEqual(h.coinsOf("md_c"), 1000, "not online: nothing");
    // Their own wait: 12 hours by default (any number of hours - 0: none)
    assert.match((await mods.set("md_mod", { on: true, perms: { rain: true }, rainMax: 50000, rainWeekly: 60000, rainCooldown: -1 })).error, /0 to 8,760/);
    assert.match((await mods.rain("md_mod", { amount: 100 })).error, /after your last one/);
    // ... and the wait of all moderators: 12 hours until the next one of any moderator
    await mods.set("md_b", { on: true, perms: { rain: true } });
    const wait = await mods.rain("md_b", { amount: 100 });
    assert.match(wait.error, /in (11 h 59 min|12 h) \(12 h between two, the last one by md_mod\)/);
    assert.strictEqual((await mods.rainCooldown()).lastBy, "md_mod");
    await mods.set("md_b", { on: false });
    // The admin sets the wait (0: none) - the limit of the week counts then: 60,000, 50,000 left
    assert.match((await mods.setRainCooldown(-1)).error, /0 to 720/);
    await mods.setRainCooldown(0);
    // (their own wait over)
    const User = require("../models/User");
    const user = await User.findOne({ username: "md_mod" }).lean();
    await User.updateOne({ username: "md_mod" }, { $set: { mod: { ...user.mod, lastRain: Date.now() - 13 * 3600 * 1000 } } });
    assert.match((await mods.rain("md_mod", { amount: 50001 })).error, /At most|more this week/);
    assert.ok(!(await mods.rain("md_mod", { amount: 45000 })).error, "within 50,000 left - 3 x 45,000 paid is fine");
    assert.strictEqual(h.coinsOf("md_a"), 1000 + 10000 + 45000);
    // Only moderators online: the money rain falls too (their own wait over again)
    const again = await User.findOne({ username: "md_mod" }).lean();
    await User.updateOne({ username: "md_mod" }, { $set: { mod: { ...again.mod, lastRain: Date.now() - 13 * 3600 * 1000 } } });
    await mods.set("md_c", { on: true, perms: { chat: true } });
    rain.setOnline(() => ["md_mod", "md_c"]);
    assert.strictEqual((await mods.rainPreview("md_mod", { amount: 100 })).players, 2);
    const modsOnly = await mods.rain("md_mod", { amount: 100 });
    assert.ok(!modsOnly.error, modsOnly.error);
    assert.strictEqual(modsOnly.players, 2);
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
  // It stays only for a while (1 minute by default - or what the moderator picked)
  const until = chat.messages()[0].until;
  assert.ok(until > Date.now() + 50 * 1000 && until <= Date.now() + 60 * 1000);
  assert.ok((await mods.announce("md_mod", "Short one", 15)).ok);
  assert.ok(chat.messages()[1].until <= Date.now() + 15 * 60 * 1000);
  assert.deepStrictEqual((await mods.history("md_mod")).map((e) => e.action), ["announce", "announce", "unmute", "mute", "delete"]);
  await mods.set("md_b", { on: false });
  assert.ok(!mods.names().includes("md_b"));
});

test("moderators: give coins to one player - from the casino, its own limits (per gift, a week), other moderators too, never themselves", async () => {
  mods.reset();
  const notices = require("../game/notices").notices;
  await mods.set("md_c", { on: false });
  assert.match((await mods.give("md_mod", { to: "md_a", amount: 100 })).error, /may not give/);
  await mods.set("md_mod", { on: true, perms: { give: true }, giveMax: 5000, giveWeekly: 8000 });
  assert.match((await mods.set("md_mod", { on: true, perms: { give: true }, giveMax: 0 })).error, /per gift/);
  await mods.set("md_b", { on: true, perms: { chat: true } });
  h.setCoins("md_mod", 1000);
  h.setCoins("md_a", 1000);
  assert.match((await mods.give("md_mod", { to: "md_mod", amount: 100 })).error, /yourself/);
  assert.match((await mods.give("md_mod", { to: "md_out", amount: 100 })).error, /no such player/);
  assert.match((await mods.give("md_mod", { to: "md_a", amount: 5001 })).error, /At most/);
  const heard = new Promise((resolve) => notices.once("notice", (username, event, data) => resolve([username, event, data])));
  const given = await mods.give("md_mod", { to: "md_a", amount: 5000, note: "Bug report" });
  assert.deepStrictEqual(given, { to: "md_a", amount: 5000, left: 3000 });
  assert.deepStrictEqual([h.coinsOf("md_a"), h.coinsOf("md_mod")], [6000, 1000], "from the casino - not the moderator's own coins");
  const [who, event, data] = await heard;
  assert.deepStrictEqual([who, event, data.from, data.amount, data.mod], ["md_a", "giftReceived", "md_mod", 5000, true]);
  // The week's limit (apart from the money rain)
  assert.match((await mods.give("md_mod", { to: "md_a", amount: 3001 })).error, /3,000 more this week/);
  assert.strictEqual((await mods.panel("md_mod")).giveLeft, 3000);
  assert.ok((await mods.history("md_mod")).some((entry) => entry.action === "give" && /md_a/.test(entry.detail)), "in the log");
  // Other moderators too - and the list to pick from (everybody in the casino but themselves)
  assert.deepStrictEqual(await mods.give("md_mod", { to: "md_b", amount: 1000 }), { to: "md_b", amount: 1000, left: 2000 });
  const list = (await mods.givePlayers("md_mod")).players;
  assert.ok(!list.some((p) => p.username === "md_mod" || p.username === "md_out"));
  assert.deepStrictEqual(list.find((p) => p.username === "md_b"), { username: "md_b", mod: true });
  assert.match((await mods.givePlayers("md_a")).error, /may not/);
  await mods.set("md_mod", { on: false });
  await mods.set("md_b", { on: false });
});
