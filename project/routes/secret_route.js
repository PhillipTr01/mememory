const express = require("express");
const { page } = require("../utils/pages");
const { asyncHandler } = require("../utils/errors");
const User = require("../models/User");
const withdrawals = require("../game/withdrawals");

/*
 * The hidden pages, mounted at the secret address (config.JACKPOT_PATH):
 * the choice of games, the jackpot, case battles and poker.
 * The pages link each other relatively, so the address is in no page.
 */
module.exports = function (auth) {
  const router = express.Router({ caseSensitive: false, strict: true });

  router.get("/", auth, (req, res, next) => {
    // Always with a slash at the end, so the relative links work
    if (!req.originalUrl.split("?")[0].endsWith("/")) return res.redirect(req.baseUrl + "/");
    page("casino.html")(req, res, next);
  });
  router.get("/jackpot", auth, page("jackpot.html"));
  router.get("/battles", auth, page("battles.html"));
  router.get("/poker", auth, page("poker.html"));

  /* ---------- Payouts of the logged in player ---------- */

  router.use(express.json({ limit: "2kb" }));

  async function nameOf(req) {
    const user = await User.findOne({ _id: req._id }).select("username").lean();
    return user ? user.username : null;
  }

  // Takes the coins off the balance, the admin sees it in the admin panel
  router.post(
    "/withdraw",
    auth,
    asyncHandler(async (req, res) => {
      const name = await nameOf(req);
      if (name == null) return res.status(401).json({ error: "Not logged in." });
      const result = await withdrawals.request(name, Number(req.body && req.body.amount));
      if (result.error) return res.status(400).json({ error: result.error });
      res.json(result.withdrawal);
    }),
  );

  // The own last payouts
  router.get(
    "/withdrawals",
    auth,
    asyncHandler(async (req, res) => {
      const name = await nameOf(req);
      if (name == null) return res.status(401).json({ error: "Not logged in." });
      res.json(await withdrawals.list({ username: name }, 10));
    }),
  );

  return router;
};
