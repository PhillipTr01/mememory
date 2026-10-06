const crypto = require("crypto");
const express = require("express");
const jwt = require("jsonwebtoken");
const { page } = require("../utils/pages");
const { asyncHandler } = require("../utils/errors");
const config = require("../game/config");
const coins = require("../game/coins");
const withdrawals = require("../game/withdrawals");
const access = require("../game/access");
const User = require("../models/User");
const CoinLog = require("../models/CoinLog");

const COOKIE = "admin_token";
const MAX_TRIES = 5; // wrong passwords per address and minute

/*
 * The admin panel: a secret address (config.ADMIN_PATH) and a password
 * (ADMIN_PASSWORD from the environment, or the one behind ADMIN_PASSWORD_HASH).
 * Without both there is no admin panel at all - every address under it is a 404.
 */
module.exports = function () {
  const router = express.Router({ strict: true });
  const tries = new Map(); // ip -> [times of wrong passwords]

  const enabled = () => Boolean(config.ADMIN_PASSWORD || config.ADMIN_PASSWORD_HASH);
  router.use((req, res, next) => (enabled() ? next() : res.status(404).send("Not found")));
  router.use(express.json({ limit: "4kb" }));
  router.use(express.urlencoded({ extended: false, limit: "2kb" }));

  // Compares in constant time (no hints from how long it takes)
  function rightPassword(password) {
    if (typeof password !== "string" || password.length > 200) return false;
    if (config.ADMIN_PASSWORD) {
      const a = crypto.createHash("sha256").update(password).digest();
      const b = crypto.createHash("sha256").update(config.ADMIN_PASSWORD).digest();
      return crypto.timingSafeEqual(a, b);
    }
    // "scrypt:<salt hex>:<hash hex>"
    const [kind, salt, hash] = String(config.ADMIN_PASSWORD_HASH).split(":");
    if (kind !== "scrypt" || !salt || !hash) return false;
    const expected = Buffer.from(hash, "hex");
    const actual = crypto.scryptSync(password, Buffer.from(salt, "hex"), expected.length);
    return crypto.timingSafeEqual(actual, expected);
  }

  function isAdmin(req) {
    try {
      return jwt.verify(req.cookies[COOKIE], process.env.SECRET_KEY).admin === true;
    } catch (error) {
      return false;
    }
  }

  // Secure only on a real https connection (behind a proxy: X-Forwarded-Proto),
  // a secure cookie on plain http is thrown away by the browser
  function cookieOptions(req) {
    const https = req.secure || String(req.get("x-forwarded-proto") || "").split(",")[0].trim() === "https";
    return { httpOnly: true, sameSite: "lax", secure: https, path: "/" };
  }

  // Only for a logged in admin; the API answers 401, pages show the login
  function admin(req, res, next) {
    if (isAdmin(req)) return next();
    res.status(401).json({ error: "Not logged in." });
  }

  /* ---------- Login ---------- */

  router.get("/", (req, res, next) => {
    if (!req.originalUrl.split("?")[0].endsWith("/")) return res.redirect(req.baseUrl + "/");
    page(isAdmin(req) ? "admin.html" : "admin_login.html")(req, res, next);
  });

  router.post("/login", (req, res) => {
    const now = Date.now();
    const ip = req.ip || "?";
    const recent = (tries.get(ip) || []).filter((time) => now - time < 60 * 1000);
    if (recent.length >= MAX_TRIES) return res.status(429).json({ error: "Too many tries - wait a minute." });
    if (!rightPassword(req.body && req.body.password)) {
      recent.push(now);
      tries.set(ip, recent);
      return res.status(401).json({ error: "Wrong password." });
    }
    tries.delete(ip);
    const token = jwt.sign({ admin: true }, process.env.SECRET_KEY, { expiresIn: config.ADMIN_SESSION });
    res.cookie(COOKIE, token, { ...cookieOptions(req), maxAge: config.ADMIN_SESSION * 1000 });
    res.json({ ok: true });
  });

  router.post("/logout", (req, res) => {
    res.clearCookie(COOKIE, cookieOptions(req));
    res.json({ ok: true });
  });

  /* ---------- API ---------- */

  // Balance as the player sees it (accounts from before a reset get the start coins)
  function balance(user) {
    return user.coinReset === config.COIN_RESET ? user.coins || 0 : config.START_COINS;
  }

  // The players in the casino (approved), richest first
  async function players() {
    const users = await User.find({ casinoApproved: true }).select("username coins coinReset").lean();
    return users.map((user) => ({ username: user.username, coins: balance(user) })).sort((a, b) => b.coins - a.coins || a.username.localeCompare(b.username));
  }

  // Everybody with the access state: who wants in first, then the rest, then the approved players
  async function accessList(q) {
    const users = await User.find({}).select("username casinoApproved casinoApprovedAt casinoRequestedAt").lean();
    const rank = (u) => (u.approved ? 2 : u.requestedAt ? 0 : 1);
    return users
      .map((user) => ({
        username: user.username,
        approved: user.casinoApproved === true,
        approvedAt: user.casinoApprovedAt || null,
        requestedAt: user.casinoRequestedAt || null,
      }))
      .filter((user) => user.username.toLowerCase().includes(q))
      .sort((a, b) => rank(a) - rank(b) || new Date(b.requestedAt || 0) - new Date(a.requestedAt || 0) || a.username.localeCompare(b.username));
  }

  async function waiting() {
    return (await accessList("")).filter((user) => !user.approved && user.requestedAt).length;
  }

  // Everything at a glance: leaderboard, open payouts, totals
  router.get(
    "/api/overview",
    admin,
    asyncHandler(async (req, res) => {
      const all = await players();
      const open = await withdrawals.list({ status: "open" }, 200);
      res.json({
        leaderboard: all.slice(0, 50),
        players: all.length,
        coins: all.reduce((sum, p) => sum + p.coins, 0),
        open: open,
        openCoins: open.reduce((sum, w) => sum + w.amount, 0),
        waiting: await waiting(),
      });
    }),
  );

  router.get(
    "/api/users",
    admin,
    asyncHandler(async (req, res) => {
      const q = String(req.query.q || "").toLowerCase();
      res.json((await players()).filter((p) => p.username.toLowerCase().includes(q)).slice(0, 50));
    }),
  );

  // Change a balance: mode "set" (to the amount) or "add" (+/- amount)
  router.post(
    "/api/balance",
    admin,
    asyncHandler(async (req, res) => {
      const { username, mode, amount, note } = req.body || {};
      const text = typeof note === "string" ? note.slice(0, 300) : undefined;
      if (typeof username !== "string" || !Number.isInteger(amount)) return res.status(400).json({ error: "Username and a whole number." });
      const user = await User.findOne({ username: username }).select("username casinoApproved").lean();
      if (user == null) return res.status(404).json({ error: "No such player." });
      if (!access.approved(user)) return res.status(400).json({ error: "The player isn't approved for the casino." });
      if (mode === "set") {
        if (amount < 0) return res.status(400).json({ error: "A balance can't be negative." });
        await coins.set(username, amount, text);
      } else if (mode === "add") {
        const ok = amount >= 0 ? await coins.add(username, amount, { reason: "admin", note: text }) : await coins.spend(username, -amount, { reason: "admin", note: text });
        if (amount !== 0 && !ok) return res.status(400).json({ error: "The player doesn't have that many coins." });
      } else {
        return res.status(400).json({ error: "Unknown mode." });
      }
      res.json({ username: username, coins: (await coins.get(username)).coins });
    }),
  );

  /* ---------- Access to the casino ---------- */

  // Who wants in, who is in - and what a player approved now gets
  router.get(
    "/api/access",
    admin,
    asyncHandler(async (req, res) => {
      const first = await access.firstApproval();
      const start = access.startCoins(first);
      const all = await accessList(String(req.query.q || "").toLowerCase());
      res.json({ firstApproval: first, startCoins: start.coins, missed: start.missed, players: all.slice(0, 200) });
    }),
  );

  // {username, approve: true | false}
  router.post(
    "/api/access",
    admin,
    asyncHandler(async (req, res) => {
      const { username, approve } = req.body || {};
      if (typeof username !== "string" || typeof approve !== "boolean") return res.status(400).json({ error: "Username and approve." });
      const result = approve ? await access.approve(username) : await access.revoke(username);
      if (result.error) return res.status(400).json(result);
      res.json(result);
    }),
  );

  router.get(
    "/api/withdrawals",
    admin,
    asyncHandler(async (req, res) => {
      const status = ["open", "paid", "rejected"].includes(req.query.status) ? req.query.status : undefined;
      res.json(await withdrawals.list(status ? { status: status } : {}, 200));
    }),
  );

  router.post(
    "/api/withdrawals/:id",
    admin,
    asyncHandler(async (req, res) => {
      const { action, note } = req.body || {};
      const result = await withdrawals.handle(req.params.id, action, typeof note === "string" ? note.slice(0, 300) : undefined);
      if (result.error) return res.status(400).json({ error: result.error });
      res.json({ ok: true });
    }),
  );

  // History of all coin changes, newest first (filter by player / reason)
  router.get(
    "/api/history",
    admin,
    asyncHandler(async (req, res) => {
      const filter = {};
      if (req.query.username) filter.username = String(req.query.username);
      if (req.query.reason) filter.reason = String(req.query.reason);
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
      const rows = await CoinLog.find(filter).sort({ at: -1 }).limit(limit).lean();
      res.json(rows.map((row) => ({ username: row.username, amount: row.amount, reason: row.reason, note: row.note || null, at: row.at })));
    }),
  );

  return router;
};
