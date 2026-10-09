const EventEmitter = require("events");
const persist = require("./persist");
const live = require("./live");
const inPlay = require("./in_play");
const casinoLock = require("./casino_lock");
const casinoChat = require("./casino_chat");
const coins = require("./coins");
const limits = require("./limits");

/*
 * The worlds of the casino - like tenants, they share nothing but the chat:
 * - the normal casino (""): the 🪙, every game
 * - the season world ("/season"): while a season runs, every game once more
 *   (/season/jackpot, ...) with the season's coins - only for players who
 *   joined the season and switched to it (game/seasons.js). Its games are
 *   saved on their own and start anew with every season; it closes before
 *   the season ends.
 * - the admin's test world ("/test"): every game once more, only for players
 *   in test mode (game/test_mode.js). Nothing of it is saved, it has a chat
 *   of its own, nothing closes it and it isn't in the overview of the admin
 *   panel or the second chances.
 *
 * services(world): what a game server uses - the ones of its world (limits:
 * like config, with the season world's own bet limits).
 */
const TEST = "/test";
const SEASON = "/season";
const WORLDS = ["", SEASON, TEST];

const quiet = { register() {}, changed() {} };
const testLock = {
  locked: () => false,
  message: () => "",
  registerRunning() {},
  changes: new EventEmitter(),
};
const testChat = casinoChat.create("test-chat", { save: false });
const seasonPersist = persist.scoped("season/");

function services(world) {
  if (world === TEST) return { coins: coins, persist: quiet, live: quiet, inPlay: quiet, casinoLock: testLock, casinoChat: testChat, limits: limits.forWorld(world) };
  if (world === SEASON) return { coins: coins.season, persist: seasonPersist, live: quiet, inPlay: inPlay.season, casinoLock: casinoLock.season, casinoChat: casinoChat, limits: limits.forWorld(world) };
  return { coins: coins, persist, live, inPlay, casinoLock, casinoChat, limits: limits.forWorld(world) };
}

// The game servers of the test world (for the debug tools of the admin panel): name -> what the server returns
const servers = new Map();
// The game servers of the season world: name -> what the server returns
const seasonServers = new Map();

function isTest(namespace) {
  return typeof namespace === "string" && namespace.startsWith(TEST + "/");
}

// The world of a namespace ("/season/jackpot" -> "/season", "/jackpot" -> "")
function worldOfNamespace(namespace) {
  if (typeof namespace !== "string") return "";
  if (namespace.startsWith(TEST + "/")) return TEST;
  if (namespace.startsWith(SEASON + "/")) return SEASON;
  return "";
}

// The world a player plays in now: the test world (test mode), the season world (joined it and
// switched there) - or the normal casino
function worldOf(username) {
  if (require("./test_mode").active(username)) return TEST;
  if (require("./seasons").inSeasonWorld(username)) return SEASON;
  return "";
}

module.exports = { TEST, SEASON, WORLDS, services, servers, seasonServers, isTest, worldOfNamespace, worldOf, testChat };
