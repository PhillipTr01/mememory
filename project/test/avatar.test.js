const { test } = require("node:test");
const assert = require("node:assert");

require("./helpers");
const User = require("../models/User");
const { AVATAR_PARTS, AVATAR_DEFAULT, cleanAvatar } = require("../public/scripts/avatar");
const users = require("../controllers/user_controller");

// Small in-memory users for this file
const stored = new Map([
  ["id_alice", { _id: "id_alice", username: "alice", avatar: null }],
  ["id_bob", { _id: "id_bob", username: "bob", avatar: { ...AVATAR_DEFAULT, hair: "mohawk" } }],
]);
User.updateOne = async (filter, update) => {
  const user = stored.get(filter._id);
  if (user == null) return { n: 0, nModified: 0 };
  Object.assign(user, update.$set);
  return { n: 1, nModified: 1 };
};
User.find = (filter) => {
  const list = [...stored.values()].filter((u) => filter.username.$in.includes(u.username));
  const query = { select: () => query, lean: () => Promise.resolve(list) };
  return query;
};

test("avatar: only known parts are kept, the rest becomes the default", () => {
  assert.strictEqual(cleanAvatar(null), null);
  assert.strictEqual(cleanAvatar("hello"), null);
  const clean = cleanAvatar({ hair: "mohawk", bg: "javascript:alert(1)", eyes: 5, extra: "<script>" });
  assert.deepStrictEqual(Object.keys(clean).sort(), Object.keys(AVATAR_PARTS).sort());
  assert.strictEqual(clean.hair, "mohawk");
  assert.strictEqual(clean.bg, AVATAR_DEFAULT.bg);
  assert.strictEqual(clean.eyes, AVATAR_DEFAULT.eyes);
  // Every default is a valid option
  for (const key of Object.keys(AVATAR_PARTS)) assert.ok(AVATAR_PARTS[key].includes(AVATAR_DEFAULT[key]), key);
});

test("avatar: saving checks the input, null goes back to the letter", async () => {
  const saved = await users.setAvatar("id_alice", { avatar: { hair: "bun", accessory: "scumbag", bg: "#000" } });
  assert.strictEqual(saved.hair, "bun");
  assert.strictEqual(saved.accessory, "scumbag");
  assert.strictEqual(stored.get("id_alice").avatar.bg, AVATAR_DEFAULT.bg);

  for (const body of [{}, { avatar: "x" }, { avatar: [1] }, null]) {
    await assert.rejects(users.setAvatar("id_alice", body), (error) => error.status === 400);
  }
  await assert.rejects(users.setAvatar("id_nobody", { avatar: null }), (error) => error.status === 404);

  assert.strictEqual(await users.setAvatar("id_alice", { avatar: null }), null);
  assert.strictEqual(stored.get("id_alice").avatar, null);
});

test("avatar: the player lists get the avatars of many users at once", async () => {
  const avatars = await users.getAvatars("bob,alice,carol,bob");
  assert.deepStrictEqual(Object.keys(avatars).sort(), ["alice", "bob", "carol"]);
  assert.strictEqual(avatars.bob.hair, "mohawk");
  assert.strictEqual(avatars.alice, null);
  assert.strictEqual(avatars.carol, null, "unknown users get the letter");
  assert.deepStrictEqual(await users.getAvatars(undefined), {});
  assert.deepStrictEqual(await users.getAvatars(["a", "b"]), {});
});
