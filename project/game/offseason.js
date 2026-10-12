const config = require("./config");
const coins = require("./coins");
const inPlay = require("./in_play");
const notices = require("./notices");
const testMode = () => require("./test_mode");
const days = require("./days");
const Setting = require("../models/Setting");
const User = require("../models/User");

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

/*
 * The daily streaks are safe while the second chance is on: nobody can claim then, so the days don't
 * count as missed. When the daily bonus comes back, every last claim moves forward by the days of the
 * pause (at most to yesterday) - the streak goes on with the next day. When it started: a setting.
 */
const PAUSE_KEY = "offseasonPause";
const DAY = 24 * 3600 * 1000;

async function pauseOf() {
  const row = await Setting.findOne({ key: PAUSE_KEY }).lean();
  return row && row.value && Number.isFinite(row.value.since) ? row.value.since : null;
}

// The mode now (a change in the admin panel, or the start of the server): the pause starts - or ends
async function sync(now = Date.now()) {
  const since = await pauseOf();
  if (on() && since == null) {
    await Setting.updateOne({ key: PAUSE_KEY }, { $set: { value: { since: now } } }, { upsert: true });
  } else if (!on() && since != null) {
    await Setting.updateOne({ key: PAUSE_KEY }, { $set: { value: null } }, { upsert: true });
    return keepStreaks(since, now);
  }
  return 0;
}

// The days from `since` to `now` didn't count: every streak's last claim forward -> how many moved
async function keepStreaks(since, now = Date.now()) {
  const paused = days.dayNumber(now) - days.dayNumber(since);
  if (paused <= 0) return 0;
  const today = days.dayNumber(now);
  const users = await User.find({ coinBonusAt: { $ne: null }, coinStreak: { $gt: 0 } }).select("username coinBonusAt").lean();
  let moved = 0;
  for (const user of users) {
    const time = new Date(user.coinBonusAt).getTime();
    if (!Number.isFinite(time)) continue;
    const last = days.dayNumber(time);
    // (claimed on the day it started - or before: as if just before the pause; never later than yesterday)
    const day = Math.min(last + paused, today - 1);
    if (day <= last) continue;
    // (noon of that day)
    const at = new Date(days.dayStart(now) - (today - day) * DAY + 12 * 3600 * 1000);
    await User.updateOne({ username: user.username }, { $set: { coinBonusAt: at } });
    moved++;
  }
  return moved;
}

// The admin switches: the pause starts or ends right away
require("./settings").changes.on("change", (values) => {
  if (values && "OFFSEASON_MODE" in values) sync().catch((error) => console.error("[offseason] Could not keep the streaks:", error));
});

// (tests)
function reset() {
  waiting.forEach((timer) => clearTimeout(timer));
  waiting.clear();
  busy.clear();
}

module.exports = { on, check, sync, keepStreaks, reset };
