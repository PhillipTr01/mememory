const { test } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const cookieParser = require("cookie-parser");

require("./helpers");
const { asyncHandler, httpError } = require("../utils/errors");
const { isStrongPassword } = require("../utils/validation");
const auth = require("../controllers/authentication_controller");
const ApiAuth = require("../API/middleware/auth");
const PageAuth = require("../middleware/auth");

async function request(app, path, options = {}) {
  const server = app.listen(0);
  try {
    const port = server.address().port;
    return await fetch(`http://localhost:${port}${path}`, { redirect: "manual", ...options });
  } finally {
    server.close();
  }
}

function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  res.status(status).json({ error: { status, message: status >= 500 ? "Internal server error." : err.message } });
}

test("asyncHandler forwards rejected promises instead of crashing", async () => {
  const app = express();
  app.get("/boom", asyncHandler(async () => { throw new Error("db down"); }));
  app.get("/teapot", asyncHandler(async () => { throw httpError(418, "teapot"); }));
  app.use(errorHandler);

  const boom = await request(app, "/boom");
  assert.strictEqual(boom.status, 500);
  assert.strictEqual((await boom.json()).error.message, "Internal server error.");

  const teapot = await request(app, "/teapot");
  assert.strictEqual(teapot.status, 418);
});

test("login rejects missing or malformed credentials with 401", async () => {
  for (const body of [undefined, {}, { username: 5, password: [] }, { email: "", username: "", password: "x" }]) {
    await assert.rejects(auth.login(body), (err) => err.status === 401);
  }
});

test("register rejects invalid input with 4xx and never 500", async () => {
  const bodies = [
    undefined,
    {},
    { email: "a@b.de", username: "<svg onload=x>", password: "Passw0rd!", repeatPassword: "Passw0rd!" },
    { email: "not-an-email", username: "alice", password: "Passw0rd!", repeatPassword: "Passw0rd!" },
    { email: { $gt: "" }, username: "alice", password: "Passw0rd!", repeatPassword: "Passw0rd!" },
  ];
  for (const body of bodies) {
    await assert.rejects(auth.register(body), (err) => err.status >= 400 && err.status < 500);
  }
});

test("register: the name of the jackpot's ghost can't be taken", async () => {
  const bodies = [
    { email: "g@b.de", username: "Ghost", password: "Passw0rd!", repeatPassword: "Passw0rd!" },
    { email: "g@b.de", username: "ghost", password: "Passw0rd!", repeatPassword: "Passw0rd!" },
  ];
  for (const body of bodies) {
    await assert.rejects(auth.register(body), (err) => err.status === 409 && /username/.test(err.message));
  }
});

test("password policy", () => {
  assert.ok(isStrongPassword("Passw0rd!"));
  assert.ok(!isStrongPassword("password"));
  assert.ok(!isStrongPassword(undefined));
  assert.ok(!isStrongPassword("A1!" + "a".repeat(100)));
});

test("API auth middleware handles missing and malformed headers", async () => {
  const app = express();
  app.get("/", ApiAuth, (req, res) => res.json({ id: req._id }));

  assert.strictEqual((await request(app, "/")).status, 401);
  assert.strictEqual((await request(app, "/", { headers: { authorization: "Bearer" } })).status, 401);
  assert.strictEqual((await request(app, "/", { headers: { authorization: "Bearer nope" } })).status, 403);
});

test("page auth middleware redirects invalid sessions", async () => {
  const app = express();
  app.use(cookieParser());
  app.get("/home", PageAuth, (req, res) => res.send("home"));

  const res = await request(app, "/home", { headers: { cookie: "token=garbage" } });
  assert.strictEqual(res.status, 302);
  // The login first - then back to the page
  assert.strictEqual(res.headers.get("location"), "/?next=%2Fhome");
});

test("page auth middleware: logged in on the landing page with ?next= - straight there (only addresses on this site)", async () => {
  const app = express();
  app.use(cookieParser());
  app.get("/", PageAuth, (req, res) => res.send("landing"));
  const token = require("jsonwebtoken").sign({ _id: "someone" }, process.env.SECRET_KEY);
  const go = async (next) => (await request(app, "/?next=" + encodeURIComponent(next), { headers: { cookie: "token=" + token } })).headers.get("location");
  assert.strictEqual(await go("/casino/battles"), "/casino/battles");
  assert.strictEqual(await go("//evil.example"), "/home");
  assert.strictEqual(await go("https://evil.example"), "/home");
  // Not logged in: the landing page itself (the login)
  assert.strictEqual((await request(app, "/?next=%2Fhome")).status, 200);
});

test("404: pages get the 404 page, the API a short JSON answer", async () => {
  const { notFound, errorHandler } = require("../utils/errors");
  const app = express();
  app.use(notFound);
  app.use(errorHandler);

  const page = await request(app, "/jackpot", { headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8" } });
  assert.strictEqual(page.status, 404);
  assert.match(page.headers.get("content-type"), /html/);
  assert.match(await page.text(), /No match for this one/);

  const api = await request(app, "/api/nothing", { headers: { accept: "application/json" } });
  assert.strictEqual(api.status, 404);
  assert.deepStrictEqual(await api.json(), { error: { status: 404, message: "Not found." } });
});
