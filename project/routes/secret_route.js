const express = require("express");
const { page } = require("../utils/pages");
const { asyncHandler } = require("../utils/errors");
const User = require("../models/User");
const withdrawals = require("../game/withdrawals");
const access = require("../game/access");

/*
 * The hidden pages, mounted at the secret address (config.JACKPOT_PATH):
 * the choice of games, the jackpot, case battles, poker and blackjack.
 * The pages link each other relatively, so the address is in no page.
 */
module.exports = function (auth) {
  const router = express.Router({ caseSensitive: false, strict: true });

  // Only for players the admin let in - everybody else back to the start page
  // (and the admin sees that they want in)
  const approved = asyncHandler(async (req, res, next) => {
    const user = await User.findOne({ _id: req._id }).select("username casinoApproved").lean();
    if (access.approved(user)) {
      req.username = user.username;
      return next();
    }
    if (user != null) await access.request(req._id).catch(() => {});
    if (req.path.startsWith("/withdraw")) return res.status(403).json({ error: "No access." });
    res.redirect("/");
  });

  router.get("/", auth, approved, (req, res, next) => {
    // Always with a slash at the end, so the relative links work
    if (!req.originalUrl.split("?")[0].endsWith("/")) return res.redirect(req.baseUrl + "/");
    page("casino.html")(req, res, next);
  });
  router.get("/jackpot", auth, approved, page("jackpot.html"));
  router.get("/battles", auth, approved, page("battles.html"));
  router.get("/poker", auth, approved, page("poker.html"));
  router.get("/blackjack", auth, approved, page("blackjack.html"));

  /* ---------- Payouts of the logged in player ---------- */

  router.use(express.json({ limit: "2kb" }));

  // Takes the coins off the balance, the admin sees it in the admin panel
  router.post(
    "/withdraw",
    auth,
    approved,
    asyncHandler(async (req, res) => {
      const name = req.username;
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
