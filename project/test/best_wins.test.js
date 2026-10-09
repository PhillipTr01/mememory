const test = require("node:test");
const assert = require("node:assert");
require("./helpers");
const CoinLog = require("../models/CoinLog");
const best = require("../game/best_wins");

test("best wins: the biggest wins of a game - today and all time, a push of blackjack is no win, the test world has none", async () => {
  const now = Date.now();
  await CoinLog.create({ username: "bw_a", amount: 500, reason: "blackjack win", note: "win", at: new Date(now) });
  await CoinLog.create({ username: "bw_b", amount: 900, reason: "blackjack win", note: "push", at: new Date(now) });
  await CoinLog.create({ username: "bw_c", amount: 3000, reason: "blackjack win", note: "blackjack", at: new Date(now - 3 * 86400000) });
  await CoinLog.create({ username: "bw_d", amount: 99999, reason: "slots win", note: "x", at: new Date(now) });
  const lists = await best.lists("blackjack win", "");
  assert.deepStrictEqual(lists.today.map((w) => [w.name, w.win]), [["bw_a", 500]]);
  assert.deepStrictEqual(lists.all.map((w) => [w.name, w.win]), [["bw_c", 3000], ["bw_a", 500]]);
  assert.deepStrictEqual(await best.lists("blackjack win", "/test"), { today: [], all: [] });
});

test("best wins: a game that writes its wins down itself (poker pots) - the 10 biggest, saved with the game", () => {
  const sent = [];
  const room = { on() {}, emit: (event, data) => sent.push(data) };
  let saved = null;
  const persist = { register: (key, get) => (saved = get), changed() {} };
  const pots = best.attachRecorded(room, "poker-best", persist);
  for (let i = 1; i <= 12; i++) pots.record("p" + i, i * 100, "Flush");
  pots.record("nobody", 0);
  const lists = pots.lists();
  assert.strictEqual(lists.all.length, 10);
  assert.deepStrictEqual([lists.all[0].win, lists.all[9].win], [1200, 300]);
  assert.strictEqual(lists.today[0].note, "Flush");
  assert.strictEqual(saved().all.length, 10, "saved with the game");
});
