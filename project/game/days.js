const config = require("./config");

/*
 * Calendar days in the time zone of the casino (config.BONUS_TZ): the daily
 * bonus comes back at midnight there, not 24 hours after the last one.
 */
const formats = new Map();

function parts(time) {
  const zone = config.BONUS_TZ;
  if (!formats.has(zone)) {
    formats.set(zone, new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }));
  }
  const values = {};
  for (const part of formats.get(zone).formatToParts(new Date(time))) values[part.type] = Number(part.value);
  return values;
}

// How far the time zone is ahead of UTC at that moment (ms)
function offset(time) {
  const p = parts(time);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(time / 1000) * 1000;
}

// Midnight of the day of `time` (as a timestamp)
function dayStart(time = Date.now()) {
  const p = parts(time);
  const midnight = Date.UTC(p.year, p.month - 1, p.day);
  const guess = midnight - offset(midnight);
  return midnight - offset(guess); // right also on the days the clocks change
}

// Midnight of the next day
function nextDay(time = Date.now()) {
  return dayStart(dayStart(time) + 30 * 60 * 60 * 1000);
}

// Number of the day (days since 1970 in that time zone) - for counting days
function dayNumber(time = Date.now()) {
  const p = parts(time);
  return Math.round(Date.UTC(p.year, p.month - 1, p.day) / (24 * 60 * 60 * 1000));
}

module.exports = { dayStart, nextDay, dayNumber };
