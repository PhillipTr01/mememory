const { test } = require("node:test");
const assert = require("node:assert");
const bot = require("../game/telegram_bot");

// (the real answer of csgofast wasn't seen yet - two likely shapes; the fields are found by their usual names)
test("telegram bot: the ranking is found in different shapes of the answer", () => {
  const nested = { success: true, data: { items: [{ place: 2, user: { name: "Bob" }, questsCount: 3, shells: 40, prize: { name: "AWP | Asiimov", price: 100 } }, { place: 1, user: { name: "Ann" }, questsCount: 5, shells: 90, prize: { name: "AK-47", price: 200 } }] } };
  assert.deepStrictEqual(bot.parse(nested), [
    { place: 1, name: "Ann", quests: 5, shells: 90, item: { name: "AK-47", price: 200 } },
    { place: 2, name: "Bob", quests: 3, shells: 40, item: { name: "AWP | Asiimov", price: 100 } },
  ]);
  const flat = [{ username: "Cid", quests: [1, 2], points: "12" }];
  assert.deepStrictEqual(bot.parse(flat), [{ place: 1, name: "Cid", quests: 2, shells: 12, item: null }]);
});

test("telegram bot: the message shows names, quests, shells and the price in euros (x 0.57); changes are listed", () => {
  const rows = [
    { place: 1, name: "Ann <3", quests: 5, shells: 90, item: { name: "AK-47", price: 200 } },
    { place: 2, name: "Bob", quests: 3, shells: 40, item: { name: "AWP", price: 100 } },
  ];
  const text = bot.rankingText(rows, Date.parse("2026-10-24T12:00:00Z"));
  assert.match(text, /🥇 <b>Ann &lt;3<\/b>/);
  assert.match(text, /🎯 5 Quests · 🐚 90 Shells/);
  assert.match(text, /🎁 AK-47 · 200 → <b>114,00 €<\/b>/);
  assert.match(text, /Alle Items: 300 → <b>171,00 €<\/b>/);
  const later = [
    { place: 1, name: "Bob", quests: 4, shells: 95, item: { name: "AK-47", price: 200 } },
    { place: 2, name: "Ann <3", quests: 5, shells: 90, item: { name: "AWP", price: 120 } },
  ];
  const lines = bot.changes(rows, later);
  assert.deepStrictEqual(lines, [
    "<b>Bob</b>: ⬆️ Platz 2 → 1, 🎯 3 → 4 Quests, 🐚 40 → 95 Shells",
    "<b>Ann &lt;3</b>: ⬇️ Platz 1 → 2",
    "🎁 Platz 2: AWP jetzt 120 → 68,40 € (vorher 100)",
  ]);
  assert.deepStrictEqual(bot.changes(later, later), []);
  assert.deepStrictEqual(bot.changes(null, later), [], "the first look: nothing to report");
});
