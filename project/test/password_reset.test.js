const test = require("node:test");
const assert = require("node:assert");
const bcrypt = require("bcrypt");
const h = require("./helpers");
const User = require("../models/User");
const passwordReset = require("../controllers/password_reset");

const userOf = async (name) => User.findOne({ username: name });

test("password reset link: made by the admin, works once, only with a strong password", async () => {
  h.addUser("forgetful");
  assert.strictEqual(await passwordReset.createLink("nobody-here"), null);
  const link = await passwordReset.createLink("forgetful");
  const token = new URL("http://x" + link.path).searchParams.get("token");
  assert.ok(token.length >= 40);
  // Only the hash is kept
  assert.notStrictEqual((await userOf("forgetful")).resetTokenHash, token);
  assert.deepStrictEqual(await passwordReset.check(token), { username: "forgetful" });
  await assert.rejects(passwordReset.check("wrong"), { status: 410 });
  // Too weak / not the same: refused, the link still works
  await assert.rejects(passwordReset.reset({ token, password: "short", repeatPassword: "short" }), { status: 400 });
  await assert.rejects(passwordReset.reset({ token, password: "Good-pass1!", repeatPassword: "Other-pass1!" }), { status: 400 });
  assert.deepStrictEqual(await passwordReset.reset({ token, password: "Good-pass1!", repeatPassword: "Good-pass1!" }), { username: "forgetful" });
  assert.ok(await bcrypt.compare("Good-pass1!", (await userOf("forgetful")).password));
  // Once only
  await assert.rejects(passwordReset.reset({ token, password: "Again-pass1!", repeatPassword: "Again-pass1!" }), { status: 410 });
});

test("password reset link: a newer link replaces the older one, an old link expires", async () => {
  h.addUser("forgetful2");
  const first = new URL("http://x" + (await passwordReset.createLink("forgetful2")).path).searchParams.get("token");
  const second = new URL("http://x" + (await passwordReset.createLink("forgetful2")).path).searchParams.get("token");
  await assert.rejects(passwordReset.check(first), { status: 410 });
  assert.ok(await passwordReset.check(second));
  await User.updateOne({ username: "forgetful2" }, { $set: { resetTokenUntil: new Date(Date.now() - 1000) } });
  await assert.rejects(passwordReset.check(second), { status: 410 });
});
