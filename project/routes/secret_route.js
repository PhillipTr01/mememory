const express = require("express");
const { page } = require("../utils/pages");

/*
 * The hidden pages, mounted at the secret address of the jackpot
 * (config.JACKPOT_PATH): the jackpot itself, case battles and poker.
 * The pages link each other relatively, so the address is in no page.
 */
module.exports = function (auth) {
  const router = express.Router({ caseSensitive: false, strict: true });

  router.get("/", auth, (req, res, next) => {
    // Always with a slash at the end, so the relative links work
    if (!req.originalUrl.split("?")[0].endsWith("/")) return res.redirect(req.baseUrl + "/");
    page("jackpot.html")(req, res, next);
  });
  router.get("/battles", auth, page("battles.html"));
  router.get("/poker", auth, page("poker.html"));

  return router;
};
