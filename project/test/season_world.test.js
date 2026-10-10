const { test, before, after } = require("node:test");
const assert = require("node:assert");
const h = require("./helpers");
const config = require("../game/config");
const seasons = require("../game/seasons");

Object.assign(config, { SEASON_CLOSE_WAIT: 0, JACKPOT_BET_DELAY: [10, 20] });

let server;
const tokens = {};
const sockets = [];
before(async () => {
  server = await h.startServer();
  for (const name of ["sw_in", "sw_out"]) tokens[name] = h.addUser(name);
});
after(async () => {
  sockets.forEach((s) => s.close());
  seasons.reset();
  server.roulette.stop();
  server.season.roulette.stop();
  await server.close();
});

const connect = (ns, name) => {
  const socket = server.client(ns, tokens[name]);
  sockets.push(socket);
  return socket;
};
const refused = async (ns, name) => (await h.once(connect(ns, name), "connect_error")).message;

test("season world: only who joined and switched there plays in it - with the season's coins; the switch sends the open pages to the other world", async () => {
  seasons.reset();
  h.setCoins("sw_in", 10000);
  h.setCoins("sw_out", 10000);
  const now = Date.now();
  await seasons.create({ name: "World", icon: "🌍", start: now - 1000, end: now + 3600 * 1000, budget: 3000, every: 0 });
  await seasons.tick(now);
  // Not joined: only the normal casino
  assert.strictEqual(await refused("/season/jackpot", "sw_out"), "world");
  await h.once(connect("/jackpot", "sw_out"), "jackpotState");

  // Joined: the season world - the normal casino sends the page there
  await seasons.join("sw_in", now);
  assert.strictEqual(await refused("/jackpot", "sw_in"), "world");
  const inSeason = connect("/season/jackpot", "sw_in");
  const wallet = await h.once(inSeason, "coins");
  assert.deepStrictEqual([wallet.coins, wallet.normal, wallet.world], [3000, 10000, "season"]);

  // A bet in the season world: the season's coins, the normal ones stay
  const landed = new Promise((resolve) => inSeason.on("jackpotState", (s) => s.entries && s.entries.some((e) => e.name === "sw_in") && resolve()));
  inSeason.emit("bet", { amount: 500 });
  await landed;
  assert.deepStrictEqual([h.userOf("sw_in").seasonCoins, h.coinsOf("sw_in")], [2500, 10000]);
  assert.strictEqual(server.jackpot.pot.entries.some((e) => e.name === "sw_in"), false, "the normal jackpot saw nothing");

  // The switch: the open page of the season world goes (and loads in the normal casino)
  const changed = h.once(inSeason, "worldChanged");
  await seasons.switchWorld("sw_in", "normal");
  assert.deepStrictEqual(await changed, { world: "normal" });
  const normal = connect("/jackpot", "sw_in");
  assert.strictEqual((await h.once(normal, "coins")).coins, 10000);
  seasons.reset();
});
