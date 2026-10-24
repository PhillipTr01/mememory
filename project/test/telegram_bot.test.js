const { test } = require("node:test");
const assert = require("node:assert");
const bot = require("../game/telegram_bot");
const sample = require("./fixtures/seasons_top.json");

test("telegram bot: the ranking of csgofast - names, quests, shells, the items with their prices (cents) and the balance", () => {
  const rows = bot.parse(sample);
  assert.deepStrictEqual(rows.map((r) => [r.place, r.name, r.quests, r.shells]), [
    [1, "FlaveDrake", 235, 27462],
    [2, "duck.", 230, 18243],
    [3, "Merlin csgofast.com", 221, 16671],
    [4, "SaLaMaTa", 219, 17609],
  ]);
  assert.deepStrictEqual(rows[0].items, [{ name: "★ StatTrak™ Butterfly Knife | Doppler Black Pearl (Factory New)", price: 27461.54, count: 1 }]);
  assert.strictEqual(rows[0].wallet, 3);
  assert.strictEqual(rows[3].wallet, 10);
});

test("telegram bot: the message shows the price and the price in euros (x 0.57); changes are listed", () => {
  const rows = bot.parse(sample);
  const text = bot.rankingText(rows, Date.parse("2026-10-24T12:00:00Z"));
  assert.match(text, /🥇 <b>FlaveDrake<\/b>\n      🎯 235 Quests · 🐚 27\.462 Shells/);
  assert.match(text, /🔪 ★ StatTrak™ Butterfly Knife \| Doppler Black Pearl \(Factory New\)\n           💲 27\.461,54 → <b>15\.653,08 €<\/b>/);
  assert.match(text, /💵 Guthaben 3,00 → 1,71 €/);
  assert.match(text, /<b>4\.<\/b> <b>SaLaMaTa<\/b>/);
  // Later: duck. passes FlaveDrake, more quests and shells, another price
  const later = JSON.parse(JSON.stringify(sample));
  later.seasonsTop[1].rank = 1;
  later.seasonsTop[0].rank = 2;
  later.seasonsTop[1].completedQuestsCount = 236;
  later.seasonsTop[1].score = 28000;
  const lines = bot.changes(rows, bot.parse(later));
  assert.deepStrictEqual(lines.slice(0, 2), ["<b>duck.</b>: ⬆️ Platz 2 → 1, 🎯 230 → 236 Quests, 🐚 18.243 → 28.000 Shells", "<b>FlaveDrake</b>: ⬇️ Platz 1 → 2"]);
  assert.ok(lines.slice(2).every((line) => line.startsWith("🎁 Platz")), "the prizes of places 1 and 2 swapped");
  assert.deepStrictEqual(bot.changes(rows, rows), []);
  assert.deepStrictEqual(bot.changes(null, rows), [], "the first look: nothing to report");
});
