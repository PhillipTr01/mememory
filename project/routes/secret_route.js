const express = require("express");
const { page } = require("../utils/pages");
const { asyncHandler } = require("../utils/errors");
const User = require("../models/User");
const access = require("../game/access");
const leaderboard = require("../game/leaderboard");
const seasons = require("../game/seasons");
const coins = require("../game/coins");
const games = require("../game/games");
const info = require("../game/info");
const maintenance = require("../game/maintenance");
const gifts = require("../game/gifts");
const shop = require("../game/shop");
const testMode = require("../game/test_mode");
const worlds = require("../game/worlds");
const moderators = require("../game/moderators");

/*
 * The hidden pages, mounted at the secret address (config.JACKPOT_PATH):
 * the jackpot is the start page, case battles, poker and blackjack next to it.
 * The pages link each other relatively, so the address is in no page.
 */
module.exports = function (auth) {
  const router = express.Router({ caseSensitive: false, strict: true });

  // The addresses of data (not pages) - without access: an error instead of the page to ask for it
  const DATA = /^\/(leaderboard\/|info\/|season|second-chance|request|maintenance|gift|shop\/|looks)/;

  // Only for players the admin let in - everybody else gets the page to ask for access
  const approved = asyncHandler(async (req, res, next) => {
    const user = await User.findOne({ _id: req._id }).select("username casinoApproved").lean();
    if (access.approved(user)) {
      // Maintenance: only the players on the whitelist - the others get the maintenance page
      if (!maintenance.allowed(user.username)) {
        if (req.method === "GET" && !DATA.test(req.path)) return page("casino_maintenance.html")(req, res, next);
        return res.status(503).json({ error: "The casino is closed for maintenance.", maintenance: maintenance.publicInfo() });
      }
      req.username = user.username;
      return next();
    }
    // A page (any address of the casino): the page to ask for access - right there, it opens the
    // page asked for once the access is there. Everything else (data): no access.
    if (req.method === "GET" && !DATA.test(req.path)) return page("casino_request.html")(req, res, next);
    res.status(403).json({ error: "No access." });
  });

  // The tabs of the games that are off are hidden (admin panel, Settings)
  // (and the accent color of the running season)
  const hideOff = (req) => {
    const off = games.GAMES.filter((game) => !games.enabled(game.id, req && req.username));
    return (off.length ? `<style>${off.map((game) => `.cs-tab[href="${game.tab}"]`).join(", ")} { display: none !important; }</style>` : "") + seasons.accentStyle(req && req.username) + seasons.coinScript(req && req.username) + worldScript(req);
  };

  // The world of the player (game/worlds.js): the pages connect to it - the test world (test
  // mode), a season world (CASINO_WORLD "season": the pages show it - CASINO_SLOT: which one, "season" /
  // "season2", CASINO_SEASON: its id) or the normal casino
  const worldScript = (req) => {
    const world = req && req.username ? worlds.worldOf(req.username) : "";
    if (!world) return "";
    const season = worlds.isSeason(world) ? seasons.running(world) : null;
    const seasonVars = season ? `window.CASINO_WORLD = "season";window.CASINO_SLOT = ${JSON.stringify(season.slot)};window.CASINO_SEASON = ${season.id};` : "";
    return `<script>window.CASINO_NS = ${JSON.stringify(world)};${seasonVars}</script>`;
  };

  // A game page - or, when the game is off, the next game that is on
  function gamePage(id, file) {
    const send = page(file, hideOff);
    return (req, res, next) => {
      if (games.enabled(id, req.username)) return send(req, res, next);
      const other = games.firstEnabled(req.username);
      res.redirect(req.baseUrl + (other ? other.page : "/leaderboard"));
    };
  }

  // Always with a slash at the end, so the relative links work
  router.get("/", auth, (req, res, next) => (req.originalUrl.split("?")[0].endsWith("/") ? next() : res.redirect(req.baseUrl + "/")));
  router.get("/", auth, approved, gamePage("jackpot", "jackpot.html"));
  // The jackpot also under its own name
  router.get("/jackpot", auth, approved, gamePage("jackpot", "jackpot.html"));
  router.get("/battles", auth, approved, gamePage("battles", "battles.html"));
  router.get("/poker", auth, approved, gamePage("poker", "poker.html"));
  router.get("/blackjack", auth, approved, gamePage("blackjack", "blackjack.html"));
  router.get("/slots", auth, approved, gamePage("slots", "slots.html"));
  router.get("/roulette", auth, approved, gamePage("roulette", "roulette.html"));
  router.get("/baucua", auth, approved, gamePage("baucua", "baucua.html"));
  router.get("/runner", auth, approved, gamePage("runner", "runner.html"));
  router.get("/leaderboard", auth, approved, page("leaderboard.html", hideOff));
  router.get("/shop", auth, approved, page("shop.html", hideOff));
  router.get("/rpg", auth, approved, gamePage("rpg", "rpg.html"));

  // How a game works (the "i" next to the title)
  router.get("/info/:game", auth, approved, (req, res) => {
    const about = info.get(req.params.game, worlds.worldOf(req.username));
    if (about == null) return res.status(404).json({ error: "Unknown game." });
    res.json(about);
  });

  router.use(express.json({ limit: "2kb" }));

  /* ---------- Asking for access ---------- */

  // {approved, requested, startCoins}: what the page to ask for access shows
  router.get(
    "/request",
    auth,
    asyncHandler(async (req, res) => {
      const user = await User.findOne({ _id: req._id }).select("casinoApproved casinoRequestedAt").lean();
      if (user == null) return res.status(401).json({ error: "Not logged in." });
      res.json({ approved: access.approved(user), requested: user.casinoRequestedAt != null, startCoins: access.startCoins(await access.firstApproval()).coins });
    }),
  );

  /* ---------- Moderators (game/moderators.js): their panel on the casino pages ---------- */

  // {mod (null: no moderator), rainLeft, mutes, muteMax, log}
  router.get(
    "/mod",
    auth,
    approved,
    // (in the season world: no money rains - the panel says so)
    asyncHandler(async (req, res) => res.json({ ...(await moderators.panel(req.username)), inSeason: seasons.inSeasonWorld(req.username) })),
  );

  const modResult = (res, result) => (result.error ? res.status(400).json(result) : res.json(result));
  // (a money rain in the world the moderator plays in right now - test mode: no)
  const modWorld = (username) => (seasons.hereIn(username) ? seasons.hereIn(username).slot : "normal");
  router.post(
    "/mod/rain/preview",
    auth,
    approved,
    asyncHandler(async (req, res) => modResult(res, await moderators.rainPreview(req.username, req.body || {}, modWorld(req.username)))),
  );
  router.post(
    "/mod/rain",
    auth,
    approved,
    asyncHandler(async (req, res) => {
      if (testMode.active(req.username)) return res.status(400).json({ error: testMode.MESSAGE });
      modResult(res, await moderators.rain(req.username, req.body || {}, modWorld(req.username)));
    }),
  );
  router.post(
    "/mod/chat/delete",
    auth,
    approved,
    asyncHandler(async (req, res) => modResult(res, await moderators.deleteMessage(req.username, (req.body || {}).id))),
  );
  router.post(
    "/mod/chat/mute",
    auth,
    approved,
    asyncHandler(async (req, res) => modResult(res, await moderators.mute(req.username, (req.body || {}).username, (req.body || {}).minutes))),
  );
  router.post(
    "/mod/chat/unmute",
    auth,
    approved,
    asyncHandler(async (req, res) => modResult(res, await moderators.unmute(req.username, (req.body || {}).username))),
  );
  // The players a moderator can give coins to
  router.get(
    "/mod/players",
    auth,
    approved,
    asyncHandler(async (req, res) => modResult(res, await moderators.givePlayers(req.username))),
  );

  // A moderator gives one player coins: {to, amount, note}
  router.post(
    "/mod/give",
    auth,
    approved,
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      modResult(res, await moderators.give(req.username, { to: body.to, amount: body.amount, note: body.note }));
    }),
  );
  router.post(
    "/mod/announce",
    auth,
    approved,
    asyncHandler(async (req, res) => modResult(res, await moderators.announce(req.username, (req.body || {}).text, (req.body || {}).minutes))),
  );

  /* ---------- Gifts: coins for another player (a click on a name in the chat) ---------- */

  // How much the player can still give a player (?to=name): {limit, given, left}
  router.get(
    "/gift",
    auth,
    approved,
    asyncHandler(async (req, res) => res.json(await gifts.status(req.username, typeof req.query.to === "string" ? req.query.to : null))),
  );

  // {to, amount} -> {coins, left} or {error}
  router.post(
    "/gift",
    auth,
    approved,
    asyncHandler(async (req, res) => {
      const { to, amount } = req.body || {};
      const result = await gifts.give(req.username, to, amount);
      if (result.error) return res.status(400).json(result);
      res.json(result);
    }),
  );

  // The maintenance page asks: still closed? (allowed: in again)
  router.get(
    "/maintenance",
    auth,
    asyncHandler(async (req, res) => {
      const user = await User.findOne({ _id: req._id }).select("username casinoApproved").lean();
      if (user == null) return res.status(401).json({ error: "Not logged in." });
      res.json({ ...maintenance.publicInfo(), allowed: maintenance.allowed(user.username) });
    }),
  );

  router.post(
    "/request",
    auth,
    asyncHandler(async (req, res) => {
      await access.request(req._id);
      res.json({ requested: true });
    }),
  );

  /* ---------- Leaderboard (live, or as often as the season says) ---------- */

  router.get(
    "/leaderboard/data",
    auth,
    approved,
    // (?board=normal or a season's id: another board than the one of the player's world)
    asyncHandler(async (req, res) => res.json(await leaderboard.view(req.username, Date.now(), req.query.board ? String(req.query.board) : null))),
  );

  // The winner page of a season that is over
  router.get(
    "/leaderboard/season/:id",
    auth,
    approved,
    asyncHandler(async (req, res) => {
      const result = leaderboard.final(req.params.id, req.username);
      if (result == null) return res.status(404).json({ error: "No such season." });
      res.json(result);
    }),
  );

  // The season a request means: ?season= / {season} (an id) - nothing: the one of the player's world, else the first they joined
  const seasonOfReq = (req) => {
    const id = (req.body && req.body.season) || req.query.season;
    if (id != null && id !== "") return seasons.running(Number(id));
    return seasons.hereIn(req.username) || seasons.joinedSeasons(req.username)[0] || seasons.running();
  };

  // A second chance in the season: can the player take one now? (see game/seasons.js)
  router.get(
    "/second-chance",
    auth,
    approved,
    asyncHandler(async (req, res) => {
      const season = seasonOfReq(req);
      res.json({ ...(await seasons.chanceStatus(req.username, Date.now(), season || -1)), season: season ? season.id : null });
    }),
  );

  router.post(
    "/second-chance",
    auth,
    approved,
    asyncHandler(async (req, res) => {
      const season = seasonOfReq(req);
      if (!season) return res.status(400).json({ error: "No season runs." });
      const result = await seasons.useChance(req.username, Date.now(), season);
      if (result.error) return res.status(400).json(result);
      res.json(result);
    }),
  );

  // The switch between the worlds: {to: "normal" | a season's id | its slot ("season", "season2")} -> {world, season} or {error}
  router.post(
    "/season/world",
    auth,
    approved,
    asyncHandler(async (req, res) => {
      if (testMode.active(req.username)) return res.status(400).json({ error: "🧪 Test mode: you play in the test world." });
      const result = await seasons.switchWorld(req.username, String((req.body && req.body.to) || ""));
      if (result.error) return res.status(400).json(result);
      res.json(result);
    }),
  );

  // Join: the player is in the running season (the budget, on its leaderboard) - and in the season world
  router.post(
    "/season/join",
    auth,
    approved,
    asyncHandler(async (req, res) => {
      // ({season}: its id - nothing: the first running one the player may join)
      const id = req.body && req.body.season;
      const season = id != null && id !== "" ? seasons.running(Number(id)) : seasons.runningAll().find((s) => seasons.allowed(s, req.username) && !seasons.joined(req.username, s));
      if (!season) return res.status(400).json({ error: "No season runs." });
      const result = await seasons.join(req.username, Date.now(), season);
      if (result.error) return res.status(400).json(result);
      res.json(result);
    }),
  );

  // The season for the pill at the top: {season, upcoming, joined, world, joinCoins, lastSeason, closing}
  // season: the running one (only when the player may play in it), upcoming: a highlighted planned one
  const seasonInfo = (season) => ({
    id: season.id,
    name: season.name,
    icon: season.icon,
    coinIcon: seasons.publicSeason(season).coinIcon,
    start: season.startedAt || season.start,
    end: season.end,
    color: season.color || null,
    budget: season.budget,
    dailyBonus: Number.isInteger(season.dailyBonus) ? season.dailyBonus : coins.wallet(season.slot || "season").dailyBonus(),
    secondChances: season.secondChances || 0,
    chanceDelay: Number.isInteger(season.chanceDelay) ? season.chanceDelay : null,
    // (each prize as one line: the own prize, the coins, the items - like on the leaderboard)
    prizes: season.prizesOn ? season.prizes.map((p) => ({ place: p.place, prize: seasons.prizeText(p) })) : [],
    players: Object.keys(season.joined || {}).length,
    closed: seasons.accessOf(season).mode !== "all",
    wagerX: seasons.wagerXOf(season),
    slot: season.started && !season.ended ? season.slot : null,
  });
  // A running season for one player: with joined and what joining gives
  const runningInfo = (season, username) => ({
    ...seasonInfo(season),
    joined: seasons.joined(username, season),
    joinCoins: seasons.joined(username, season) ? null : seasons.joinCoins(Date.now(), season),
  });
  router.get(
    "/season",
    auth,
    approved,
    asyncHandler(async (req, res) => {
      // Every running season the player may play in (two at once at most) - season: the one of the player's
      // world, else the first of them (the pill, the popups)
      const all = seasons.runningAll().filter((s) => seasons.allowed(s, req.username));
      const here = seasons.hereIn(req.username);
      const season = here || all[0] || null;
      const upcoming = all.length ? null : seasons.upcoming(req.username);
      const ended = seasons.lastEnded();
      const closing = seasons.closingInfos().find((info) => seasons.allowed(seasons.byId(info.id), req.username)) || null;
      res.json({
        season: season ? seasonInfo(season) : null,
        seasons: all.map((s) => runningInfo(s, req.username)),
        upcoming: upcoming ? seasonInfo(upcoming) : null,
        // In the season (joined)? null: no season
        joined: season ? seasons.joined(req.username, season) : null,
        // The world the player plays in now: "normal" - or the slot of a season ("season", "season2")
        world: here ? here.slot : "normal",
        current: here ? here.id : null,
        // What joining gives now (the budget and the daily bonuses missed since the start)
        joinCoins: season && !seasons.joined(req.username, season) ? seasons.joinCoins(Date.now(), season) : null,
        lastSeason: ended ? { id: ended.id, name: ended.name, icon: ended.icon, endedAt: ended.endedAt } : null,
        // The countdown to a season (or a season world closing) - or a maintenance
        closing: closing || maintenance.closingInfo(),
      });
    }),
  );

  // The accessory shop: frames and animations for the avatar (see game/shop.js)
  router.get(
    "/shop/data",
    auth,
    approved,
    asyncHandler(async (req, res) => res.json(await shop.view(req.username))),
  );

  router.post(
    "/shop/buy",
    auth,
    approved,
    asyncHandler(async (req, res) => {
      const result = await shop.buy(req.username, String((req.body && req.body.id) || ""));
      if (result.error) return res.status(400).json(result);
      res.json(result);
    }),
  );

  // A whole set at once (what of it is still missing)
  router.post(
    "/shop/buy-set",
    auth,
    approved,
    asyncHandler(async (req, res) => {
      const result = await shop.buySet(req.username, String((req.body && req.body.set) || ""));
      if (result.error) return res.status(400).json(result);
      res.json(result);
    }),
  );

  router.post(
    "/shop/wear",
    auth,
    approved,
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      const result = await shop.wear(req.username, String(body.kind || ""), body.id == null ? null : String(body.id));
      if (result.error) return res.status(400).json(result);
      res.json(result);
    }),
  );

  // What players wear (the avatars of a casino page): /looks?names=alice,bob
  router.get(
    "/looks",
    auth,
    approved,
    asyncHandler(async (req, res) => {
      const names = String(req.query.names || "").split(",").map((n) => n.trim()).filter(Boolean).slice(0, 100);
      res.json(names.length ? await shop.worn(names) : {});
    }),
  );

  // Any other address of the casino: without access the page to ask for it (with access: not found)
  router.get(/.*/, auth, approved, (req, res, next) => next());

  return router;
};
