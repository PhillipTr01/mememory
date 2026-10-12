const config = require("./config");
const coins = require("./coins");
const inPlay = require("./in_play");
const notices = require("./notices");
const testMode = () => require("./test_mode");

/*
 * Outside of seasons the admin picks one of two (Settings, General: "Outside seasons"):
 * - "bonus": the daily bonus and the daily cashback, as always
 * - "chance": no daily bonus and no cashback (game/coins.js, game/cashback.js) - instead the second chance:
 *   a balance (the casino's 🪙) at 0, with no bet still running anywhere, is filled up to OFFSEASON_REFILL
 *   right away - every time it happens. A season's coins are never touched.
 */
const GRACE = 2000; // a bet just made: the game gets it in a moment - not "nothing in play" yet
const RETRY = 1500; // a bet still running: looked at again this soon

const waiting = new Map(); // username -> timer (a check later, while a bet still runs)
const busy = new Set(); // a check in progress (two changes at once never fill up twice)

function on() {
  return config.OFFSEASON_MODE === "chance";
}

function later(username) {
  if (waiting.has(username)) return;
  const timer = setTimeout(() => {
    waiting.delete(username);
    check(username).catch((error) => console.error("[offseason] Could not check a balance:", error));
  }, RETRY);
  timer.unref();
  waiting.set(username, timer);
}

// A balance changed (or a page opened): at 0 and nothing in play - filled up. -> the coins given (0: nothing)
async function check(username) {
  if (!on() || !username || busy.has(username) || testMode().active(username)) return 0;
  busy.add(username);
  try {
    const now = await coins.get(username);
    if (!(now.coins <= 0) || now.joined === false) return 0;
    // A bet still running (or just made): when it is over - a win may come
    if (inPlay.where(username).length || Date.now() - coins.lastSpent(username) < GRACE) {
      later(username);
      return 0;
    }
    const amount = Math.max(0, Math.floor(Number(config.OFFSEASON_REFILL) || 0));
    if (amount <= 0) return 0;
    if (!(await coins.add(username, amount, { reason: "second chance", note: "outside seasons" }))) return 0;
    notices.send(username, "refilled", { coins: amount });
    return amount;
  } finally {
    busy.delete(username);
  }
}

// Every change of a balance: looked at (only the normal casino's coins count - check() reads those)
coins.changes.on("change", (username) => {
  if (on()) check(username).catch((error) => console.error("[offseason] Could not check a balance:", error));
});

// (tests)
function reset() {
  waiting.forEach((timer) => clearTimeout(timer));
  waiting.clear();
  busy.clear();
}

module.exports = { on, check, reset };
