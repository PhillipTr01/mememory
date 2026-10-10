/* Libraries */
require("dotenv").config();
const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
//const morgan = require('morgan');
const cookieParser = require("cookie-parser");
const http = require("http");
const socketio = require("socket.io");

/* Check configuration - fail fast instead of failing on the first request */
const missing = ["DB_URL", "SECRET_KEY"].filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing environment variable(s): ${missing.join(", ")}. See .env.example`);
  process.exit(1);
}

const PORT = process.env.PORT || 5000;

const { page, staticHeaders } = require("./utils/pages");
const { notFound, errorHandler } = require("./utils/errors");
const persist = require("./game/persist");
// The games of the last run come back before anybody can join one
persist.expectRestore();
const config = require("./game/config");

const app = express();
const server = http.createServer(app);
// Small buffer: no socket message of this game needs more than a few KB.
const io = socketio(server, { maxHttpBufferSize: 1e5 });

app
  .use(express.urlencoded({ extended: true, limit: "10kb" }))
  .use(express.json({ limit: "10kb" }))
  //.use(morgan('dev'))
  .use(cookieParser())
  .use("/static", express.static(path.join(__dirname, "public"), { setHeaders: staticHeaders }));

/* Modules */

const memeScraper = require("./meme_scraper");
const Auth = require("./middleware/auth");
require("./sockets/lobby_server")(io);
require("./sockets/singleplayer_server")(io);
require("./sockets/multiplayer_server")(io);
require("./sockets/tictactoe_server")(io);
require("./sockets/jackpot_server")(io);
require("./sockets/battles_server")(io);
require("./sockets/poker_server")(io);
require("./sockets/blackjack_server")(io);
require("./sockets/slots_server")(io);
require("./sockets/roulette_server")(io);
require("./sockets/baucua_server")(io);
// The admin's test world: every game once more (/test/...), only for players in test mode
{
  const worlds = require("./game/worlds");
  for (const game of ["jackpot", "battles", "poker", "blackjack", "slots", "roulette", "baucua"]) {
    worlds.servers.set(game, require(`./sockets/${game}_server`)(io, { world: worlds.TEST }));
  }
  // The season world: every game once more (/season/...), only for players in the running season
  for (const game of ["jackpot", "battles", "poker", "blackjack", "slots", "roulette", "baucua"]) {
    worlds.seasonServers.set(game, require(`./sockets/${game}_server`)(io, { world: worlds.SEASON }));
  }
}
require("./sockets/casino_server")(io);

/* Page routes */
const authenticationRoute = require("./routes/authentication_route");
const memeRoute = require("./routes/meme_route");
const userRoute = require("./routes/user_route");
const scoreboardRoute = require("./routes/scoreboard_route");
const secretRoute = require("./routes/secret_route");
const adminRoute = require("./routes/admin_route");

/* API routes */
const authenticationAPIRoute = require("./API/routes/authentication_route");
const memeAPIRoute = require("./API/routes/meme_route");
const userAPIRoute = require("./API/routes/user_route");
const scoreboardAPIRoute = require("./API/routes/scoreboard_route");

app
  .use("/requests/authentication", authenticationRoute)
  .use("/requests/memes", memeRoute)
  .use("/requests/user", userRoute)
  .use("/requests/scoreboard", scoreboardRoute)
  .use("/v1/API/authentication", authenticationAPIRoute)
  .use("/v1/API/memes", memeAPIRoute)
  .use("/v1/API/user", userAPIRoute)
  .use("/v1/API/scoreboard", scoreboardAPIRoute);

/* Health check, e.g. for a load balancer or uptime monitoring */
app.get("/health", (req, res) => {
  const dbConnected = mongoose.connection.readyState === 1;
  res.status(dbConnected ? 200 : 503).json({ status: dbConnected ? "ok" : "degraded", database: dbConnected });
});

/* Base routes */

app.get("/", Auth, page("index.html"));
app.get("/home", Auth, page("home.html"));
app.get("/user", Auth, page("user_profile.html"));
app.get("/lobby", Auth, page("lobby.html"));
app.get("/settings", Auth, page("settings.html"));
app.get("/play", Auth, page("multiplayer.html"));
app.get("/singleplayer", Auth, page("singleplayer.html"));
app.get("/tictactoe", Auth, page("tictactoe.html"));
// Hidden: the games with coins (jackpot, case battles, poker) at a secret address
app.use(config.addresses(config.JACKPOT_PATH), secretRoute(Auth));
// The admin panel: a secret address and a password (ADMIN_PASSWORD)
app.use(config.addresses(config.ADMIN_PATH), adminRoute());
console.log(
  config.ADMIN_PASSWORD || config.ADMIN_PASSWORD_HASH
    ? `Admin panel: ${config.ADMIN_PATH}/ (also ${encodeURI(config.ADMIN_PATH)}/), password from ` +
        (config.ADMIN_PASSWORD ? `ADMIN_PASSWORD (${config.ADMIN_PASSWORD.length} characters)` : "ADMIN_PASSWORD_HASH")
    : "Admin panel is off - set ADMIN_PASSWORD (and ADMIN_PATH) in the environment / .env to turn it on.",
);

/* Error handling */
app.use(notFound);
app.use(errorHandler);

/* Connect to Database - retry instead of giving up when MongoDB isn't up yet */
let scraperInterval = null;
let shuttingDown = false;

async function connectDatabase(attempt = 1) {
  try {
    await mongoose.connect(process.env.DB_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      useCreateIndex: true,
      serverSelectionTimeoutMS: 10000,
    });
    console.log("Connected to database.");
    // The values changed in the admin panel, then the games as they were
    // before the restart (rounds, tables, history, chat)
    // The cases (the admin may have changed them - the settings and the battles need them)
    await require("./game/cases")
      .load()
      .catch((error) => console.error("Could not load the cases:", error));
    await require("./game/settings")
      .load()
      .catch((error) => console.error("Could not load the settings:", error));
    await require("./game/streak")
      .load()
      .catch((error) => console.error("Could not load the daily streak:", error));
    await require("./game/maintenance")
      .load()
      .catch((error) => console.error("Could not load the maintenance:", error));
    await require("./game/shop")
      .load()
      .catch((error) => console.error("Could not load the shop:", error));
    // The seasons first (and the coins of the season that started last) - a restored game may pay coins
    const seasons = require("./game/seasons");
    await seasons.load().catch((error) => console.error("Could not load the seasons:", error));
    // The season is known: the coins can be looked at (and changed) - then the games come back
    require("./game/coins").release();
    await persist.restoreAll();
    // ... and the seasons start / end on time
    seasons.start();
    // The daily cashback (the day before - once, after midnight)
    const cashback = require("./game/cashback");
    await cashback.load().catch((error) => console.error("Could not load the cashback:", error));
    cashback.start();
    // The money rains of the admin (planned ones come on time)
    const rain = require("./game/money_rain");
    await rain.load().catch((error) => console.error("Could not load the money rains:", error));
    rain.setOnline(() => require("./game/casino_chat").online().names);
    rain.start();
    startScraper();
  } catch (error) {
    if (shuttingDown) return;
    const delay = Math.min(30000, 1000 * 2 ** attempt);
    console.error(`Database connection failed (${error.message}), retrying in ${delay / 1000}s...`);
    setTimeout(() => connectDatabase(attempt + 1), delay);
  }
}

mongoose.connection.on("disconnected", () => console.warn("Database disconnected."));
mongoose.connection.on("reconnected", () => console.log("Database reconnected."));
mongoose.connection.on("error", (error) => console.error("Database error:", error.message));

/* Get new Memes every 60 minutes */
function startScraper() {
  if (scraperInterval != null) return;
  memeScraper.scrape();
  scraperInterval = setInterval(() => memeScraper.scrape(), 60 * 60 * 1000);
}

/* Last line of defence: log instead of dying silently */
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (error) => {
  // The process state is unknown now - log and exit so a process manager can restart it.
  console.error("Uncaught exception:", error);
  shutdown(1);
});

/* Graceful shutdown */
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("Shutting down...");

  clearInterval(scraperInterval);
  // Force exit if closing takes too long
  setTimeout(() => process.exit(code), 5000).unref();

  // Every game is saved as it is (running rounds, chips, bets) - it goes on after the restart
  persist
    .saveAll()
    .catch((error) => console.error("Saving the games failed:", error))
    .finally(() => {
      io.close();
      server.close(() => {
        mongoose.connection.close(false, () => process.exit(code));
      });
    });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

/* Start Backend */
server.on("error", (error) => {
  console.error("Server error:", error.message);
  process.exit(1);
});

// No balance is looked at before the season is loaded (see game/coins.js hold)
require("./game/coins").hold();
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
connectDatabase();
