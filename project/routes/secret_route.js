const express = require("express");
const { page } = require("../utils/pages");
const { asyncHandler } = require("../utils/errors");
const User = require("../models/User");
const withdrawals = require("../game/withdrawals");
const access = require("../game/access");
const leaderboard = require("../game/leaderboard");

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

  // Always with a slash at the end, so the relative links work
  router.get("/", auth, (req, res, next) => (req.originalUrl.split("?")[0].endsWith("/") ? next() : res.redirect(req.baseUrl + "/")));
  router.get("/", auth, approved, page("jackpot.html"));
  // The jackpot also under its own name
  router.get("/jackpot", auth, approved, page("jackpot.html"));
  router.get("/battles", auth, approved, page("battles.html"));
  router.get("/poker", auth, approved, page("poker.html"));
  router.get("/blackjack", auth, approved, page("blackjack.html"));
  router.get("/leaderboard", auth, approved, page("leaderboard.html"));

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

  /* ---------- Leaderboard (made once a day) ---------- */

  router.get(
    "/leaderboard/data",
    auth,
    approved,
    asyncHandler(async (req, res) => res.json(await leaderboard.view(req.username))),
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
