const crypto = require("crypto");
const express = require("express");
const jwt = require("jsonwebtoken");
const { page } = require("../utils/pages");
const { asyncHandler } = require("../utils/errors");
const config = require("../game/config");
const coins = require("../game/coins");
const withdrawals = require("../game/withdrawals");
const access = require("../game/access");
const casinoChat = require("../game/casino_chat");
const live = require("../game/live");
const settings = require("../game/settings");
const { hardReset } = require("../game/hard_reset");
const seasons = require("../game/seasons");
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
  // Off: like any address that doesn't exist (the 404 page)
  router.use((req, res, next) => (enabled() ? next() : next(Object.assign(new Error("Not found"), { status: 404 }))));
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
    return coins.balanceOf(user);
  }

  // In the running season (hit "Start")? Its icon - null: not in it, or no season
  // ... and since when: {icon, joinedAt}
  function seasonOf(username) {
    const season = seasons.running();
    return season && seasons.joined(username) === true ? { icon: season.icon, joinedAt: seasons.joinedAt(username) } : null;
  }

  // The players in the casino (approved): who is in the running season first, then the richest first
  async function players() {
    const users = await User.find({ casinoApproved: true }).select("username coins coinReset").lean();
    return users
      // (in a season: coins = the season balance, bank = the balance from before it - back after the season)
      .map((user) => ({ username: user.username, coins: balance(user), bank: seasons.storedOf(user.username), season: seasonOf(user.username) }))
      .sort((a, b) => !!b.season - !!a.season || b.coins - a.coins || a.username.localeCompare(b.username));
  }

  // Everybody with the access state: the approved players first, then who wants in, then the rest
  async function accessList(q) {
    const users = await User.find({}).select("username casinoApproved casinoApprovedAt casinoRequestedAt payoutAllowed").lean();
    const rank = (u) => (u.approved ? 0 : u.requestedAt ? 1 : 2);
    return users
      .map((user) => ({
        username: user.username,
        approved: user.casinoApproved === true,
        approvedAt: user.casinoApprovedAt || null,
        requestedAt: user.casinoRequestedAt || null,
        payout: user.payoutAllowed === true,
        season: user.casinoApproved === true ? seasonOf(user.username) : null,
      }))
      .filter((user) => user.username.toLowerCase().includes(q))
      .sort((a, b) => rank(a) - rank(b) || !!b.season - !!a.season || new Date(b.requestedAt || 0) - new Date(a.requestedAt || 0) || a.username.localeCompare(b.username));
  }

  // Who asked for access, the newest first
  async function requests() {
    return (await accessList("")).filter((user) => !user.approved && user.requestedAt);
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
        // In a season: the balances from before it, waiting in the bank
        bank: seasons.running() ? all.reduce((sum, p) => sum + (p.bank || 0), 0) : null,
        open: open,
        openCoins: open.reduce((sum, w) => sum + w.amount, 0),
        requests: (await requests()).map((user) => ({ username: user.username, requestedAt: user.requestedAt })),
        waiting: (await requests()).length,
        online: casinoChat.online().names,
        games: live.snapshot(),
        activity: (await CoinLog.find(coins.eraFilter()).sort({ at: -1 }).limit(8).lean()).map((row) => ({ username: row.username, amount: row.amount, reason: row.reason, at: row.at })),
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
      res.json({ firstApproval: first, startCoins: start.coins, baseCoins: coins.base().start, missed: start.missed, since: start.since, players: all.slice(0, 200) });
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

  // Say no to a request (the player can ask again)
  router.post(
    "/api/access/decline",
    admin,
    asyncHandler(async (req, res) => {
      const { username } = req.body || {};
      if (typeof username !== "string") return res.status(400).json({ error: "Username." });
      const result = await access.decline(username);
      if (result.error) return res.status(400).json(result);
      res.json(result);
    }),
  );

  // Payouts for a player on / off: {username, allowed: true | false}
  router.post(
    "/api/payout",
    admin,
    asyncHandler(async (req, res) => {
      const { username, allowed } = req.body || {};
      if (typeof username !== "string" || typeof allowed !== "boolean") return res.status(400).json({ error: "Username and allowed." });
      const result = await access.setPayout(username, allowed);
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
      // (in a season its history, otherwise the one outside of seasons)
      const filter = coins.eraFilter();
      if (req.query.username) filter.username = String(req.query.username);
      if (req.query.reason) filter.reason = String(req.query.reason);
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
      const rows = await CoinLog.find(filter).sort({ at: -1 }).limit(limit).lean();
      res.json(rows.map((row) => ({ username: row.username, amount: row.amount, reason: row.reason, note: row.note || null, at: row.at })));
    }),
  );

  /* ---------- Chat of the casino ---------- */

  // The messages (oldest first), the banned players, who is online
  router.get("/api/chat", admin, (req, res) => {
    res.json({ messages: casinoChat.messages(), bans: casinoChat.banList(), online: casinoChat.online().names });
  });

  router.post("/api/chat/delete", admin, (req, res) => {
    const { id } = req.body || {};
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Message id." });
    if (!casinoChat.remove(id)) return res.status(404).json({ error: "No such message." });
    res.json({ ok: true });
  });

  router.post("/api/chat/clear", admin, (req, res) => {
    casinoChat.clear();
    res.json({ ok: true });
  });

  // {username, minutes} - minutes null: banned for good
  router.post(
    "/api/chat/ban",
    admin,
    asyncHandler(async (req, res) => {
      const { username, minutes } = req.body || {};
      if (typeof username !== "string") return res.status(400).json({ error: "Username." });
      if (minutes != null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 525600)) return res.status(400).json({ error: "Minutes: 1 to 525,600 (or for good)." });
      const user = await User.findOne({ username: username }).select("username").lean();
      if (user == null) return res.status(404).json({ error: "No such player." });
      casinoChat.ban(user.username, minutes == null ? null : minutes);
      res.json({ ok: true, bans: casinoChat.banList() });
    }),
  );

  router.post("/api/chat/unban", admin, (req, res) => {
    const { username } = req.body || {};
    if (typeof username !== "string") return res.status(400).json({ error: "Username." });
    casinoChat.unban(username);
    res.json({ ok: true, bans: casinoChat.banList() });
  });

  /* ---------- Settings ---------- */

  router.get("/api/settings", admin, (req, res) => res.json({ settings: settings.list() }));

  // {values: {KEY: number}} or {defaults: true}
  router.post(
    "/api/settings",
    admin,
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      const result = body.defaults === true ? await settings.resetToDefaults() : await settings.update(body.values);
      if (result.error) return res.status(400).json(result);
      res.json(result);
    }),
  );

  /* ---------- Seasons ---------- */

  router.get("/api/seasons", admin, (req, res) => res.json({ seasons: seasons.list(), intervals: seasons.INTERVALS, dailyBonus: config.SEASON_DAILY_BONUS, now: Date.now() }));

  // A new season: {name, icon, start, end (ms), budget, every (minutes), prizesOn, prizes: [{place, prize}]}
  router.post(
    "/api/seasons",
    admin,
    asyncHandler(async (req, res) => {
      const result = await seasons.create(req.body);
      if (result.error) return res.status(400).json(result);
      res.json({ ...result, seasons: seasons.list() });
    }),
  );

  router.post(
    "/api/seasons/:id",
    admin,
    asyncHandler(async (req, res) => {
      const result = await seasons.update(req.params.id, req.body);
      if (result.error) return res.status(400).json(result);
      res.json({ ...result, seasons: seasons.list() });
    }),
  );

  router.post(
    "/api/seasons/:id/delete",
    admin,
    asyncHandler(async (req, res) => {
      const result = await seasons.remove(req.params.id);
      if (result.error) return res.status(400).json(result);
      res.json({ seasons: seasons.list() });
    }),
  );

  // A season that is over: all its final places (with the prizes)
  router.get("/api/seasons/:id/final", admin, (req, res) => {
    const season = seasons.byId(req.params.id);
    if (season == null || !season.ended || !season.final) return res.status(404).json({ error: "Not over yet." });
    res.json({ at: season.final.at, rows: season.final.rows });
  });

  // The running season ends right now (the final places, the winner page)
  router.post(
    "/api/seasons/:id/end",
    admin,
    asyncHandler(async (req, res) => {
      const result = await seasons.endNow(req.params.id);
      if (result.error) return res.status(400).json(result);
      res.json({ ...result, seasons: seasons.list() });
    }),
  );

  // Everything anew - only with the word typed in
  router.post(
    "/api/reset",
    admin,
    asyncHandler(async (req, res) => {
      if ((req.body || {}).confirm !== "RESET") return res.status(400).json({ error: 'Type "RESET" to confirm.' });
      const result = await hardReset();
      // The seasons too: the casino as on its very first day
      await seasons.clear();
      res.json({ ok: true, ...result });
    }),
  );

  return router;
};
