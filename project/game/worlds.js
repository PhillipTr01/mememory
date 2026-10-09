const EventEmitter = require("events");
const persist = require("./persist");
const live = require("./live");
const inPlay = require("./in_play");
const casinoLock = require("./casino_lock");
const casinoChat = require("./casino_chat");

/*
 * The worlds of the casino: the real one ("") - and the admin's test world
 * ("/test"): every game once more on its own namespaces (/test/jackpot, ...),
 * only for players in test mode (game/test_mode.js). Nothing of it is saved,
 * it has a chat of its own, the closing time of a season doesn't touch it
 * and it isn't in the overview of the admin panel or the second chances.
 *
 * services(world): what a game server uses - the real ones, or the test world's.
 */
const TEST = "/test";

const quiet = { register() {}, changed() {} };
const testLock = {
  locked: () => false,
  message: () => "",
  registerRunning() {},
  changes: new EventEmitter(),
};
const testChat = casinoChat.create("test-chat", { save: false });

function services(world) {
  if (world !== TEST) return { persist, live, inPlay, casinoLock, casinoChat };
  return { persist: quiet, live: quiet, inPlay: quiet, casinoLock: testLock, casinoChat: testChat };
}

// The game servers of the test world (for the debug tools of the admin panel): name -> what the server returns
const servers = new Map();

function isTest(namespace) {
  return typeof namespace === "string" && namespace.startsWith(TEST + "/");
}

module.exports = { TEST, services, servers, isTest, testChat };
