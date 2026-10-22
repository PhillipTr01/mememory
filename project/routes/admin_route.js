const crypto = require("crypto");
const express = require("express");
const jwt = require("jsonwebtoken");
const { page } = require("../utils/pages");
const { asyncHandler } = require("../utils/errors");
const config = require("../game/config");
const coins = require("../game/coins");
const access = require("../game/access");
const casinoChat = require("../game/casino_chat");
const live = require("../game/live");
const settings = require("../game/settings");
const { hardReset, PARTS: RESET_PARTS } = require("../game/hard_reset");
const seasons = require("../game/seasons");
const cases = require("../game/cases");
const maintenance = require("../game/maintenance");
const shop = require("../game/shop");
const testMode = require("../game/test_mode");
const worlds = require("../game/worlds");
const rpg = require("../game/rpg");
const rtpMonitor = require("../game/rtp_monitor");
const streak = require("../game/streak");
const userController = require("../controllers/user_controller");
const passwordReset = require("../controllers/password_reset");
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

  // The normal coins of a player (the season's are in a world of their own - in the seasons tab)
  function normalCoins(user) {
    return balance(user);
  }

  // The players in the casino (approved): the richest first
  async function players() {
    const users = await User.find({ casinoApproved: true }).select("username coins coinReset").lean();
    return users.map((user) => ({ username: user.username, coins: normalCoins(user) })).sort((a, b) => b.coins - a.coins || a.username.localeCompare(b.username));
  }

  // The coin history outside of seasons
  const NORMAL = { era: { $exists: false } };

  // Everybody with the access state: the approved players first, then who wants in, then the rest
  async function accessList(q) {
    const users = await User.find({}).select("username casinoApproved casinoApprovedAt casinoRequestedAt").lean();
    const rank = (u) => (u.approved ? 0 : u.requestedAt ? 1 : 2);
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

  // Who asked for access, the newest first
  async function requests() {
    return (await accessList("")).filter((user) => !user.approved && user.requestedAt);
  }

  // Everything at a glance: leaderboard, totals
  router.get(
    "/api/overview",
    admin,
    asyncHandler(async (req, res) => {
      const all = await players();
      res.json({
        leaderboard: all.slice(0, 50),
        players: all.length,
        coins: all.reduce((sum, p) => sum + p.coins, 0),
        requests: (await requests()).map((user) => ({ username: user.username, requestedAt: user.requestedAt })),
        waiting: (await requests()).length,
        online: casinoChat.online().names,
        games: live.snapshot(),
        activity: (await CoinLog.find(NORMAL).sort({ at: -1 }).limit(8).lean()).map((row) => ({ username: row.username, amount: row.amount, reason: row.reason, at: row.at })),
      });
    }),
  );

  router.get(
    "/api/users",
    admin,
    asyncHandler(async (req, res) => {
      const q = String(req.query.q || "").toLowerCase();
      const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 50));
      res.json((await players()).filter((p) => p.username.toLowerCase().includes(q)).slice(0, limit));
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
      if (mode !== "set" && mode !== "add") return res.status(400).json({ error: "Unknown mode." });
      if (mode === "set" && amount < 0) return res.status(400).json({ error: "A balance can't be negative." });
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

  /*
   * One player in detail: access, coins (normal, the running season's), the streak, what every kind of coin change
   * added up to (the normal history - the page sorts it into games), the items (bought - with the day - and given)
   */
  router.get(
    "/api/players/:name",
    admin,
    asyncHandler(async (req, res) => {
      const user = await User.findOne({ username: String(req.params.name) }).lean();
      if (user == null) return res.status(404).json({ error: "No such player." });
      const name = user.username;
      const approved = access.approved(user);
      const [reasons, last, purchases] = await Promise.all([
        CoinLog.aggregate([{ $match: { username: name, ...NORMAL } }, { $group: { _id: "$reason", amount: { $sum: "$amount" }, count: { $sum: 1 } } }]),
        CoinLog.find({ username: name }).sort({ at: -1 }).limit(1).lean(),
        CoinLog.find({ username: name, reason: "shop" }).sort({ at: -1 }).lean(),
      ]);
      // When an item was bought: the newest purchase of that name
      const boughtAt = new Map();
      for (const row of purchases) if (row.note && !boughtAt.has(row.note)) boughtAt.set(row.note, row.at);
      // (every running season the player is in - two at once at most)
      const inSeasons = approved ? seasons.runningAll().filter((s) => !coins.wallet(s.slot).watching(name)) : [];
      const seasonView = (s) => ({ id: s.id, slot: s.slot, name: s.name, icon: s.icon, coinIcon: seasons.publicSeason(s).coinIcon, coins: coins.wallet(s.slot).balanceOf(user) });
      res.json({
        username: name,
        approved: approved,
        approvedAt: user.casinoApprovedAt || null,
        requestedAt: user.casinoRequestedAt || null,
        online: casinoChat.online().names.includes(name),
        coins: approved ? normalCoins(user) : null,
        season: inSeasons.length ? seasonView(inSeasons[0]) : null,
        seasons: inSeasons.map(seasonView),
        streak: approved ? coins.streakInfo(user) : null,
        lastActive: last.length ? last[0].at : null,
        reasons: reasons.map((row) => ({ reason: row._id, amount: row.amount, count: row.count })),
        items: shop.itemsOf(user).map((item) => (item.given ? item : { ...item, at: boughtAt.get(item.name) || null })),
      });
    }),
  );

  // A password reset link for a player (to give them - valid for a day, once)
  router.post(
    "/api/players/:name/reset-link",
    admin,
    asyncHandler(async (req, res) => {
      const link = await passwordReset.createLink(String(req.params.name));
      if (!link) return res.status(404).json({ error: "No such player." });
      res.json({ ...link, hours: passwordReset.LINK_HOURS });
    }),
  );

  // Take an item away from a player: {id}
  router.post(
    "/api/players/:name/items/remove",
    admin,
    asyncHandler(async (req, res) => {
      const result = await shop.removeItem(String(req.params.name), String((req.body || {}).id || ""));
      if (result.error) return res.status(400).json(result);
      res.json(result);
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
      // A running season that players start themselves: what "Start" gives now
      const join = seasons.running() ? seasons.joinCoins() : null;
      res.json({ firstApproval: first, startCoins: start.coins, baseCoins: coins.base().start, missed: start.missed, since: start.since, join: join, players: all.slice(0, 200) });
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

  // The daily streak: the reward of every day (percent of the daily bonus), what comes after the last day, the grace
  // world: "normal" (the casino) or "season" (every season - its own daily bonus is the base)
  const streakWorld = (value) => (value === "season" ? "season" : "normal");
  const streakView = (world) => ({ world: world, streak: streak.current(world), defaults: streak.DEFAULTS, maxDays: streak.MAX_DAYS, dailyBonus: world === "season" ? config.SEASON_DAILY_BONUS : config.DAILY_BONUS });
  router.get("/api/streak", admin, (req, res) => res.json(streakView(streakWorld(req.query.world))));
  router.post(
    "/api/streak",
    admin,
    asyncHandler(async (req, res) => {
      const { world, ...input } = req.body || {};
      const result = await streak.update(input, streakWorld(world));
      if (result.error) return res.status(400).json({ error: result.error });
      res.json(streakView(streakWorld(world)));
    }),
  );

  // RTP monitor: what every game really paid back (range: today / week / month / all, world: normal / season)
  router.get(
    "/api/rtp",
    admin,
    asyncHandler(async (req, res) => res.json(await rtpMonitor.report(String(req.query.range || "week"), String(req.query.world || "normal")))),
  );

  // History of all coin changes, newest first (filter by player / reason)
  router.get(
    "/api/history",
    admin,
    asyncHandler(async (req, res) => {
      // The normal history - or (scope: a running season's id, "season": the first one) the one of a running season
      const scoped = req.query.scope === "season" ? seasons.running() : req.query.scope && /^\d+$/.test(String(req.query.scope)) ? seasons.running(Number(req.query.scope)) : null;
      const filter = scoped && coins.era(scoped.slot) ? { era: coins.era(scoped.slot) } : { ...NORMAL };
      // A part of a name: every player whose name has it
      const q = String(req.query.username || "").trim().toLowerCase();
      if (q) {
        const names = (await User.find({}).select("username").lean()).map((u) => u.username);
        const exact = names.filter((name) => name.toLowerCase() === q);
        filter.username = { $in: exact.length ? exact : names.filter((name) => name.toLowerCase().includes(q)) };
      }
      // One kind - or a few (a whole game: "jackpot bet,jackpot win")
      if (req.query.reason) filter.reason = { $in: String(req.query.reason).split(",").slice(0, 20) };
      // In pages (page 1: the newest)
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
      const total = await CoinLog.countDocuments(filter);
      const pages = Math.max(1, Math.ceil(total / limit));
      const page = Math.min(pages, Math.max(1, Math.floor(Number(req.query.page)) || 1));
      const rows = await CoinLog.find(filter).sort({ at: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean();
      const season = seasons.running();
      res.json({
        // The running seasons: their history can be picked instead
        season: season ? { id: season.id, name: season.name, icon: season.icon } : null,
        seasons: seasons.runningAll().map((s) => ({ id: s.id, name: s.name, icon: s.icon })),
        names: (await players()).map((p) => p.username),
        page: page,
        pages: pages,
        total: total,
        rows: rows.map((row) => ({ username: row.username, amount: row.amount, reason: row.reason, note: row.note || null, at: row.at })),
      });
    }),
  );

  /* ---------- Moderators (game/moderators.js) ---------- */

  const moderators = require("../game/moderators");
  // Every moderator, what they did (the last actions), the perms there are
  router.get(
    "/api/mods",
    admin,
    asyncHandler(async (req, res) => res.json({ mods: await moderators.list(), log: (await moderators.history()).slice(0, 100), perms: moderators.PERM_NAMES, defaults: moderators.DEFAULTS })),
  );
  // {on, perms: {rain, chat, announce}, rainMax, rainWeekly}
  router.post(
    "/api/players/:name/mod",
    admin,
    asyncHandler(async (req, res) => {
      const result = await moderators.set(req.params.name, req.body || {});
      if (result.error) return res.status(400).json(result);
      res.json({ ...result, log: (await moderators.history(req.params.name)).slice(0, 30) });
    }),
  );
  router.get(
    "/api/players/:name/mod",
    admin,
    asyncHandler(async (req, res) => res.json({ mod: await moderators.get(req.params.name), log: (await moderators.history(req.params.name)).slice(0, 30), perms: moderators.PERM_NAMES, defaults: moderators.DEFAULTS })),
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

  // ?season=<id>: with that season's own limits (seasonValue) - seasons: the ones that can have own limits (not over)
  const settingsSeasons = () => {
    const counts = settings.seasonCounts();
    return seasons
      .list()
      .filter((season) => season.status !== "ended")
      // (running first, then the ones starting, then the planned ones - the next first)
      .sort((a, b) => ["running", "starting", "planned"].indexOf(a.status) - ["running", "starting", "planned"].indexOf(b.status) || a.start - b.start)
      .map((season) => ({ id: season.id, name: season.name, icon: season.icon, status: season.status, start: season.start, own: counts[season.id] || 0 }));
  };
  router.get("/api/settings", admin, (req, res) => res.json({ settings: settings.list(req.query.season != null && req.query.season !== "" ? Number(req.query.season) : null), seasons: settingsSeasons() }));

  // {values: {KEY: number}}, {seasonId, season: {KEY: number | null}} (a season's own limits) or {defaults: true[, seasonId]}
  router.post(
    "/api/settings",
    admin,
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      const seasonId = body.seasonId != null ? Number(body.seasonId) : null;
      const result =
        body.defaults === true
          ? await settings.resetToDefaults(seasonId != null ? { season: seasonId } : {})
          : body.season != null
            ? await settings.updateSeason(seasonId, body.season)
            : await settings.update(body.values);
      if (result.error) return res.status(400).json(result);
      // (the list with the own values of the season picked on the page)
      res.json({ ...result, settings: settings.list(seasonId), seasons: settingsSeasons() });
    }),
  );

  // The avatars of players (for the lists of the admin panel): ?names=alice,bob
  router.get(
    "/api/avatars",
    admin,
    asyncHandler(async (req, res) => res.json(await userController.getAvatars(req.query.names))),
  );

  /* ---------- Maintenance ---------- */

  // The state - and the players to put on the whitelist (everybody with access)
  router.get(
    "/api/maintenance",
    admin,
    asyncHandler(async (req, res) => {
      res.json({ maintenance: maintenance.get(), players: (await players()).map((p) => p.username) });
    }),
  );

  // {on, whitelist, until, note} (only what changes)
  router.post(
    "/api/maintenance",
    admin,
    asyncHandler(async (req, res) => {
      const result = await maintenance.update(req.body || {});
      if (result.error) return res.status(400).json(result);
      res.json(result);
    }),
  );

  /* ---------- Test mode: a player plays with a sandbox balance (nothing is saved) ---------- */

  router.get(
    "/api/test",
    admin,
    asyncHandler(async (req, res) => {
      res.json({
        testers: testMode.list(),
        players: (await players()).map((p) => p.username),
        defaultCoins: testMode.DEFAULT_COINS,
        // What the debug tools can pick from
        options: { draws: config.JACKPOT_DRAWS, deals: (worlds.servers.get("blackjack") || {}).DEALS || [], modes: ["classic", "crazy", "jackpot", "bestof", "worstof"] },
      });
    }),
  );
  // {username, coins}: start (again: the balance back to the start)
  router.post("/api/test", admin, (req, res) => {
    const body = req.body || {};
    const result = testMode.start(String(body.username || ""), body.coins == null ? testMode.DEFAULT_COINS : Number(body.coins));
    if (result.error) return res.status(400).json(result);
    res.json({ ...result, testers: testMode.list() });
  });
  // {username, on}: the test coins filled up by themselves - or not
  router.post("/api/test/refill", admin, (req, res) => {
    const result = testMode.setRefill(String((req.body && req.body.username) || ""), req.body && req.body.on === true);
    if (result.error) return res.status(400).json(result);
    res.json({ ...result, testers: testMode.list() });
  });
  router.post("/api/test/stop", admin, (req, res) => {
    const result = testMode.stop(String((req.body && req.body.username) || ""));
    if (result.error) return res.status(400).json(result);
    res.json({ ...result, testers: testMode.list() });
  });

  // Debug in the test world: bots that bet (nobody's coins), the draw now
  const BOT_NAMES = ["Botty", "RoboRita", "ChipBot", "LuckyBot", "BeepBoop", "Clanky", "Sprocket", "Gizmo", "Widget", "Bolt"];
  const botName = () => "🤖" + BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)] + (Math.floor(Math.random() * 90) + 10);
  router.post("/api/test/bots", admin, (req, res) => {
    const body = req.body || {};
    const count = Math.max(1, Math.min(10, Math.floor(Number(body.count) || 1)));
    const amount = Math.floor(Number(body.amount));
    if (!Number.isInteger(amount) || amount < 1 || amount > 100000000) return res.status(400).json({ error: "An amount from 1 to 100,000,000." });
    const server = worlds.servers.get(body.game);
    if (body.game === "jackpot" && server) {
      for (let i = 0; i < count; i++) server.botBet(botName(), amount);
      return res.json({ ok: true, added: count });
    }
    if (body.game === "roulette" && server) {
      const colors = ["red", "blue", "green"];
      let added = 0;
      for (let i = 0; i < count; i++) if (server.botBet(botName(), colors.includes(body.color) ? body.color : colors[Math.floor(Math.random() * 2)], amount)) added++;
      if (!added) return res.status(400).json({ error: "The reel rolls - in a moment." });
      return res.json({ ok: true, added: added });
    }
    if (body.game === "baucua" && server) {
      const animals = require("../game/baucua").IDS;
      let added = 0;
      for (let i = 0; i < count; i++) if (server.botBet(botName(), animals.includes(body.animal) ? body.animal : animals[Math.floor(Math.random() * animals.length)], amount)) added++;
      if (!added) return res.status(400).json({ error: "The dice are rolling - in a moment." });
      return res.json({ ok: true, added: added });
    }
    res.status(400).json({ error: "Bots only for the jackpot, the roulette and Bầu Cua (case battles have their own)." });
  });
  // One lever of the debug tools: {game, action, value} - only the test world
  router.post("/api/test/debug", admin, async (req, res) => {
    const { game, action, value } = req.body || {};
    // A popup with sample data on the open pages of a tester (only to look at - nothing is paid or kept)
    if (game === "popups") {
      const username = typeof value === "string" ? value : "";
      if (!username || !testMode.active(username)) return res.status(400).json({ error: "Start test mode for a player first - the popup goes to their pages." });
      const sample = previewPopup(action);
      if (!sample) return res.status(400).json({ error: "Unknown popup." });
      require("../game/notices").send(username, sample.event, sample.data);
      return res.json({ ok: true });
    }
    const server = worlds.servers.get(game);
    if (!server) return res.status(400).json({ error: "Unknown game." });
    const levers = {
      jackpot: {
        mode: () => server.setMode(value) || "Not during a draw.",
        winner: () => server.forceWinner(value) || "Nobody of that name in the pot (bots: add one first).",
        ghost: () => server.ghostNow() || "The ghost comes only to a player alone in the pot.",
        clear: () => server.clearPot() || "Not during a draw.",
      },
      roulette: { color: () => server.forceColor(value) },
      baucua: { dice: () => server.forceDice(value) },
      slots: { bonus: () => server.forceBonus(value) },
      blackjack: { deal: () => server.stackDeal(value) || "Unknown deal." },
      battles: {
        mode: () => server.forceMode(value),
        fill: async () => (await server.fillWithBots(String(value || ""))) || "That player has no waiting battle.",
      },
    };
    const lever = levers[game] && levers[game][action];
    if (!lever) return res.status(400).json({ error: "Unknown lever." });
    const done = await lever();
    if (done !== true) return res.status(400).json({ error: typeof done === "string" ? done : "That didn't work." });
    res.json({ ok: true });
  });

  // The popups a player can get - with sample data (Casino → Test mode → Popups)
  function previewPopup(kind) {
    const pick = (k) => shop.items().find((item) => item.kind === k && item.on);
    const sampleItems = ["frame", "effect", "background"].map(pick).filter(Boolean).map((item) => ({ id: item.id, kind: item.kind, name: item.name }));
    const now = streak.current();
    const day = Math.min(3, now.rewards.length);
    const info = { on: true, day: day, next: day + 1, rewards: now.rewards, after: now.after, grace: now.grace, base: config.DAILY_BONUS };
    const index = day < now.rewards.length ? day : now.after === "restart" ? day % now.rewards.length : now.rewards.length - 1;
    const samples = {
      streak: { event: "streakPreview", data: { info: info, paid: Math.round((config.DAILY_BONUS * now.rewards[index]) / 100) } },
      reward: { event: "reward", data: { source: "Test reward", icon: "🎁", rank: null, note: null, coins: 25000, prizes: ["€20 voucher"], items: sampleItems, preview: true } },
      season: { event: "reward", data: { source: "Test season", icon: "🏆", rank: 1, note: null, coins: 100000, prizes: [], items: sampleItems.slice(0, 1), preview: true } },
      cashback: { event: "cashback", data: { amount: 1250, loss: 12500, percent: 10, world: "normal", coinIcon: null } },
      gift: { event: "giftReceived", data: { from: "Santa", amount: 5000, world: "normal" } },
      rain: { event: "moneyRain", data: { amount: 2500, note: "Test rain", world: "normal" } },
    };
    return samples[kind] || null;
  }

  router.post("/api/test/now", admin, (req, res) => {
    const game = req.body && req.body.game;
    const server = worlds.servers.get(game);
    const done = game === "jackpot" && server ? server.drawNow() : (game === "roulette" || game === "baucua") && server ? server.rollNow() : false;
    if (!done) return res.status(400).json({ error: game === "jackpot" ? "No countdown runs (two players needed)." : "No round runs (a bet starts it)." });
    res.json({ ok: true });
  });

  /* ---------- The accessory shop: items on / off, prices, free for all ---------- */

  // (with who has each unique item - one player only)
  router.get("/api/shop", admin, asyncHandler(async (req, res) => res.json({ ...shop.config(), owners: await shop.owners() })));
  // A reward for a player: items (any - the exclusive ones too) and / or coins, with a note
  router.post(
    "/api/shop/give",
    admin,
    asyncHandler(async (req, res) => {
      const result = await shop.give(req.body || {});
      if (result.error) return res.status(400).json(result);
      res.json(result);
    }),
  );
  router.post(
    "/api/shop",
    admin,
    asyncHandler(async (req, res) => {
      const result = await shop.update(req.body || {});
      if (result.error) return res.status(400).json(result);
      res.json({ ...result, owners: await shop.owners() });
    }),
  );

  /* ---------- The dungeon: booster packs for a character of a player ---------- */

  router.get("/api/rpg/characters/:username", admin, (req, res) => {
    const server = worlds.normalServers.get("rpg");
    res.json({ characters: server ? server.charactersOf(req.params.username) : [], packs: Object.entries(rpg.PACKS).map(([id, pack]) => ({ id, name: pack.name, icon: pack.icon })) });
  });
  router.post("/api/rpg/packs", admin, (req, res) => {
    const { username, cls, packs } = req.body || {};
    const server = worlds.normalServers.get("rpg");
    const problem = server ? server.givePacks(String(username || ""), String(cls || ""), packs) : "The dungeon isn't running.";
    if (problem) return res.status(400).json({ error: problem });
    res.json({ ok: true });
  });

  // A character's deepest cleared floor: {username, cls, deepest} - that floor and the deeper ones start over
  router.post("/api/rpg/floor", admin, (req, res) => {
    const { username, cls, deepest } = req.body || {};
    const server = worlds.normalServers.get("rpg");
    const problem = server ? server.setFloor(String(username || ""), String(cls || ""), Number(deepest)) : "The dungeon isn't running.";
    if (problem) return res.status(400).json({ error: problem });
    res.json({ ok: true });
  });

  // The real runs of the dungeon: cleared runs per class and floor band (solo, party or all) - the log to download
  const RUN_BANDS = [[1, 1], [2, 5], [6, 10], [11, 15], [16, 20], [21, 25], [26, 30]];
  router.get("/api/rpg/runs", admin, (req, res) => {
    const server = worlds.normalServers.get("rpg");
    const stats = server ? server.runStats : { log: [], tally: {} };
    const kinds = req.query.kind === "solo" || req.query.kind === "party" ? [req.query.kind] : ["solo", "party"];
    const sum = (cls, from, to) => {
      const out = { runs: 0, cleared: 0 };
      for (const kind of kinds)
        for (const [floor, count] of Object.entries((stats.tally[kind] || {})[cls] || {}))
          if (Number(floor) >= from && Number(floor) <= to) {
            out.runs += count.runs;
            out.cleared += count.cleared;
          }
      return out;
    };
    res.json({
      kind: kinds.length == 1 ? kinds[0] : "all",
      bands: RUN_BANDS.map(([from, to]) => (from == to ? String(from) : from + "-" + to)),
      classes: rpg.CLASS_IDS.map((id) => ({ id, name: rpg.CLASSES[id].name, icon: rpg.CLASSES[id].icon, bands: RUN_BANDS.map(([from, to]) => sum(id, from, to)), total: sum(id, 1, rpg.FLOORS) })),
      logged: stats.log.length,
    });
  });
  router.get("/api/rpg/runs/download", admin, (req, res) => {
    const server = worlds.normalServers.get("rpg");
    res.setHeader("Content-Disposition", 'attachment; filename="dungeon-runs.json"');
    res.json(server ? server.runStats : { log: [], tally: {} });
  });

  /* ---------- The cases of the case battles ---------- */

  const caseResult = (res, result) => (result.error ? res.status(400).json(result) : res.json({ ...result, cases: cases.list() }));
  router.get("/api/cases", admin, (req, res) => res.json({ cases: cases.list(), deleted: cases.deletedCases(), weightTotal: cases.WEIGHT_TOTAL }));
  // The earlier versions of a case - and one of them back
  router.get("/api/cases/:id/versions", admin, (req, res) => res.json({ versions: cases.versions(req.params.id) }));
  router.post("/api/cases/:id/versions/:key/delete", admin, asyncHandler(async (req, res) => caseResult(res, await cases.removeVersion(req.params.id, req.params.key))));
  router.post("/api/cases/:id/versions/:key", admin, asyncHandler(async (req, res) => caseResult(res, await cases.restoreVersion(req.params.id, req.params.key))));
  router.post("/api/cases", admin, asyncHandler(async (req, res) => caseResult(res, await cases.create(req.body))));
  router.post("/api/cases/:id", admin, asyncHandler(async (req, res) => caseResult(res, await cases.update(req.params.id, req.body))));
  router.post("/api/cases/:id/delete", admin, asyncHandler(async (req, res) => caseResult(res, await cases.remove(req.params.id))));
  router.post("/api/cases/:id/restore", admin, asyncHandler(async (req, res) => caseResult(res, await cases.restore(req.params.id))));
  // The RTP balancer: the chances for a payback (nothing is saved) - {items, rtp} or {error}
  router.post("/api/case-balance", admin, (req, res) => {
    const { items, price, target } = req.body || {};
    const checked = cases.check({ name: "x", icon: "x", price: price, risk: "low", items: items }, "x");
    if (checked.error) return res.status(400).json(checked);
    const result = cases.balance(checked.case.items, checked.case.price, Number(target));
    if (result.error) return res.status(400).json(result);
    res.json(result);
  });

  /* ---------- Seasons ---------- */

  router.get("/api/seasons", admin, (req, res) => res.json({ seasons: seasons.list(), intervals: seasons.INTERVALS, dailyBonus: config.SEASON_DAILY_BONUS, now: Date.now(), kit: require("../game/season_kit").catalog() }));

  // The sandbox while it is built: what is wrong with it - or what every goal and currency says to the players
  router.post("/api/seasons/kit-preview", admin, (req, res) => {
    const kit = require("../game/season_kit");
    const result = kit.check(req.body && req.body.kit);
    if (result.error) return res.json({ error: result.error });
    res.json({ quests: result.kit.quests.map((q) => kit.questText({ ...q, text: "" })), currencies: result.kit.currencies.map((c) => (c.earn ? kit.earnText(c) : null)) });
  });

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

  // The leaderboard of a season (running: now, over: the final places) - with when they started,
  // the second chances and what they did
  router.get(
    "/api/seasons/:id/board",
    admin,
    asyncHandler(async (req, res) => {
      const result = await seasons.board(req.params.id);
      if (result == null) return res.status(404).json({ error: "No such season." });
      res.json(result);
    }),
  );

  // The season coins of a player in the running season: mode "set" (to the amount) or "add" (+/-)
  router.post(
    "/api/seasons/:id/balance",
    admin,
    asyncHandler(async (req, res) => {
      const season = seasons.running(Number(req.params.id));
      if (season == null) return res.status(400).json({ error: "Only the coins of a running season." });
      const { username, mode, amount, note } = req.body || {};
      const text = typeof note === "string" ? note.slice(0, 300) : undefined;
      if (typeof username !== "string" || !Number.isInteger(amount)) return res.status(400).json({ error: "Username and a whole number." });
      if (seasons.joined(username, season) !== true) return res.status(400).json({ error: "The player isn't in the season." });
      const wallet = coins.wallet(season.slot);
      if (mode === "set") {
        if (amount < 0) return res.status(400).json({ error: "A balance can't be negative." });
        await wallet.set(username, amount, text);
      } else if (mode === "add") {
        const ok = amount >= 0 ? await wallet.add(username, amount, { reason: "admin", note: text }) : await wallet.spend(username, -amount, { reason: "admin", note: text });
        if (amount !== 0 && !ok) return res.status(400).json({ error: "The player doesn't have that many coins." });
      } else return res.status(400).json({ error: "Unknown mode." });
      res.json({ username: username, coins: (await wallet.get(username)).coins });
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

  /* ---------- Money rains (game/money_rain.js) ---------- */

  const rain = require("../game/money_rain");
  // (season: the first running one - seasons: every running one with its slot, the "world" of a rain)
  const rainSeason = (s) => ({ id: s.id, slot: s.slot, name: s.name, icon: s.icon, coinIcon: seasons.publicSeason(s).coinIcon });
  router.get("/api/rains", admin, (req, res) => res.json({ ...rain.list(), now: Date.now(), season: seasons.running() ? rainSeason(seasons.running()) : null, seasons: seasons.runningAll().map(rainSeason) }));

  // How many it would reach right now: {players, total, names}
  router.post(
    "/api/rains/preview",
    admin,
    asyncHandler(async (req, res) => {
      const result = await rain.preview(req.body);
      if (result.error) return res.status(400).json(result);
      res.json(result);
    }),
  );

  router.post(
    "/api/rains",
    admin,
    asyncHandler(async (req, res) => {
      const result = await rain.create(req.body);
      if (result.error) return res.status(400).json(result);
      res.json({ ...result, ...rain.list() });
    }),
  );

  router.post(
    "/api/rains/:id/now",
    admin,
    asyncHandler(async (req, res) => {
      const result = await rain.now(req.params.id);
      if (result.error) return res.status(400).json(result);
      res.json({ ...result, ...rain.list() });
    }),
  );

  router.post(
    "/api/rains/:id/cancel",
    admin,
    asyncHandler(async (req, res) => {
      const result = await rain.cancel(req.params.id);
      if (result.error) return res.status(400).json(result);
      res.json(rain.list());
    }),
  );

  // Moderators' money rains: the wait between two (all of them together)
  router.get("/api/rains/mod-wait", admin, asyncHandler(async (req, res) => res.json({ cooldown: await require("../game/moderators").rainCooldown() })));
  router.post(
    "/api/rains/mod-wait",
    admin,
    asyncHandler(async (req, res) => {
      const result = await require("../game/moderators").setRainCooldown((req.body || {}).hours);
      if (result.error) return res.status(400).json(result);
      res.json(result);
    }),
  );

  // A money rain that fell: off the list (the coins stay paid)
  router.post(
    "/api/rains/:id/remove",
    admin,
    asyncHandler(async (req, res) => {
      const result = await rain.remove(req.params.id);
      if (result.error) return res.status(400).json(result);
      res.json(rain.list());
    }),
  );

  // What the hard reset can reset (the checkboxes of the danger zone)
  router.get("/api/reset", admin, (req, res) => res.json({ parts: RESET_PARTS }));

  // The picked parts anew - only with the word typed in
  router.post(
    "/api/reset",
    admin,
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      if (body.confirm !== "RESET") return res.status(400).json({ error: 'Type "RESET" to confirm.' });
      // parts: what to reset (game/hard_reset.js) - none given: the records, access, purchases and seasons
      const result = await hardReset(body.parts);
      if (result.error) return res.status(400).json(result);
      res.json({ ok: true, ...result });
    }),
  );

  return router;
};
