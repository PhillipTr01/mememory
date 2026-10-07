const express = require("express");
const { page } = require("../utils/pages");
const { asyncHandler } = require("../utils/errors");
const User = require("../models/User");
const withdrawals = require("../game/withdrawals");
const access = require("../game/access");
const leaderboard = require("../game/leaderboard");
const seasons = require("../game/seasons");
const coins = require("../game/coins");
const games = require("../game/games");
const info = require("../game/info");

/*
 * The hidden pages, mounted at the secret address (config.JACKPOT_PATH):
 * the jackpot is the start page, case battles, poker and blackjack next to it.
 * The pages link each other relatively, so the address is in no page.
 */
module.exports = function (auth) {
  const router = express.Router({ caseSensitive: false, strict: true });

  // Only for players the admin let in - everybody else gets the page to ask for access
  const approved = asyncHandler(async (req, res, next) => {
    const user = await User.findOne({ _id: req._id }).select("username casinoApproved payoutAllowed").lean();
    if (access.approved(user)) {
      req.username = user.username;
      req.payoutAllowed = user.payoutAllowed === true;
      return next();
    }
    if (req.path.startsWith("/withdraw") || req.path.startsWith("/leaderboard/")) return res.status(403).json({ error: "No access." });
    if (req.path === "/") return page("casino_request.html")(req, res, next);
    res.redirect(req.baseUrl + "/");
  });

  // The tabs of the games that are off are hidden (admin panel, Settings)
  // (and the accent color of the running season)
  const hideOff = () => {
    const off = games.GAMES.filter((game) => !games.enabled(game.id));
    return (off.length ? `<style>${off.map((game) => `.cs-tab[href="${game.tab}"]`).join(", ")} { display: none !important; }</style>` : "") + seasons.accentStyle();
  };

  // A game page - or, when the game is off, the next game that is on
  function gamePage(id, file) {
    const send = page(file, hideOff);
    return (req, res, next) => {
      if (games.enabled(id)) return send(req, res, next);
      const other = games.firstEnabled();
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
  router.get("/leaderboard", auth, approved, page("leaderboard.html", hideOff));

  // How a game works (the "i" next to the title)
  router.get("/info/:game", auth, approved, (req, res) => {
    const about = info.get(req.params.game);
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
    asyncHandler(async (req, res) => res.json(await leaderboard.view(req.username))),
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

  // A second chance in the season: can the player take one now? (see game/seasons.js)
  router.get(
    "/second-chance",
    auth,
    approved,
    asyncHandler(async (req, res) => res.json(await seasons.chanceStatus(req.username))),
  );

  router.post(
    "/second-chance",
    auth,
    approved,
    asyncHandler(async (req, res) => {
      const result = await seasons.useChance(req.username);
      if (result.error) return res.status(400).json(result);
      res.json(result);
    }),
  );

  // "Start": the player is in the running season (the budget, on the leaderboard)
  router.post(
    "/season/join",
    auth,
    approved,
    asyncHandler(async (req, res) => {
      const result = await seasons.join(req.username);
      if (result.error) return res.status(400).json(result);
      res.json(result);
    }),
  );

  // The season now (for the link in the navigation bar): {season, lastSeason, joined, closing}
  router.get(
    "/season",
    auth,
    approved,
    asyncHandler(async (req, res) => {
      const season = seasons.running();
      const ended = seasons.lastEnded();
      res.json({
        season: season
          ? {
              id: season.id,
              name: season.name,
              icon: season.icon,
              start: season.startedAt || season.start,
              end: season.end,
              color: season.color || null,
              budget: season.budget,
              dailyBonus: coins.dailyBonus(),
              secondChances: season.secondChances || 0,
              prizes: season.prizesOn ? season.prizes : [],
              players: Object.keys(season.joined || {}).length,
            }
          : null,
        // In the season (hit "Start")? null: no season
        joined: seasons.joined(req.username),
        // What "Start" gives now (the budget and the daily bonuses missed since the start)
        joinCoins: season && !seasons.joined(req.username) ? seasons.joinCoins() : null,
        lastSeason: ended ? { id: ended.id, name: ended.name, icon: ended.icon, endedAt: ended.endedAt } : null,
        // The casino closes for a season right now (the pages show it)
        closing: seasons.closingInfo(),
      });
    }),
  );

  /* ---------- Payouts of the logged in player ---------- */

  // Takes the coins off the balance, the admin sees it in the admin panel
  router.post(
    "/withdraw",
    auth,
    approved,
    asyncHandler(async (req, res) => {
      const name = req.username;
      if (!req.payoutAllowed) return res.status(403).json({ error: "Payouts aren't enabled for you." });
      const result = await withdrawals.request(name, Number(req.body && req.body.amount));
      if (result.error) return res.status(400).json({ error: result.error });
      res.json(result.withdrawal);
    }),
  );

  // The own last payouts
  router.get(
    "/withdrawals",
    auth,
    approved,
    asyncHandler(async (req, res) => {
      const name = req.username;
      res.json(await withdrawals.list({ username: name }, 10));
    }),
  );

  return router;
};
