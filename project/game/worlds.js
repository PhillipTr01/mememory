const EventEmitter = require("events");
const persist = require("./persist");
const live = require("./live");
const inPlay = require("./in_play");
const casinoLock = require("./casino_lock");
const casinoChat = require("./casino_chat");
const coins = require("./coins");
const limits = require("./limits");
const slots = require("./season_slots");

/*
 * The worlds of the casino - like tenants, they share nothing but the chat:
 * - the normal casino (""): the 🪙, every game
 * - the season worlds ("/season", "/season2" - one per season slot, two
 *   seasons can run at once, game/season_slots.js): while a season runs in
 *   it, every game once more (/season/jackpot, ...) with the season's coins -
 *   only for players who joined the season and switched to it
 *   (game/seasons.js). Its games are saved on their own and start anew with
 *   every season; it closes before the season ends.
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
const SEASONS = slots.WORLDS;
const WORLDS = ["", ...SEASONS, TEST];

const quiet = { register() {}, changed() {} };
const testLock = {
  locked: () => false,
  message: () => "",
  registerRunning() {},
  changes: new EventEmitter(),
};
const testChat = casinoChat.create("test-chat", { save: false });
const seasonPersists = Object.fromEntries(slots.SLOTS.map((slot) => [slot.key, persist.scoped(slot.prefix)]));

function services(world) {
  if (world === TEST) return { coins: coins, persist: quiet, live: quiet, inPlay: quiet, casinoLock: testLock, casinoChat: testChat, limits: limits.forWorld(world) };
  const slot = slots.of(world);
  if (slot) return { coins: coins.wallet(slot.key), persist: seasonPersists[slot.key], live: quiet, inPlay: inPlay[slot.key], casinoLock: casinoLock[slot.key], casinoChat: casinoChat, limits: limits.forWorld(world) };
  return { coins: coins, persist, live, inPlay, casinoLock, casinoChat, limits: limits.forWorld(world) };
}

// The game servers of the test world (for the debug tools of the admin panel): name -> what the server returns
const servers = new Map();
// The game servers of the normal casino that the admin panel talks to (the dungeon): name -> what the server returns
const normalServers = new Map();
// The game servers of the season worlds: world -> name -> what the server returns
const seasonServers = new Map(SEASONS.map((world) => [world, new Map()]));

function isTest(namespace) {
  return typeof namespace === "string" && namespace.startsWith(TEST + "/");
}

// The world of a namespace ("/season/jackpot" -> "/season", "/jackpot" -> "")
function worldOfNamespace(namespace) {
  if (typeof namespace !== "string") return "";
  if (namespace.startsWith(TEST + "/")) return TEST;
  const season = SEASONS.find((world) => namespace.startsWith(world + "/"));
  if (season) return season;
  return "";
}

// The world a player plays in now: the test world (test mode), a season world (joined its season
// and switched there) - or the normal casino
function worldOf(username) {
  if (require("./test_mode").active(username)) return TEST;
  return require("./seasons").worldOf(username) || "";
}

const isSeason = (world) => slots.isSeason(world);

module.exports = { TEST, SEASON, SEASONS, WORLDS, isSeason, services, servers, normalServers, seasonServers, isTest, worldOfNamespace, worldOf, testChat };
