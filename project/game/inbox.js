const User = require("../models/User");

/*
 * What happened while a player wasn't in the casino (a gift, a money rain):
 * kept on the account and shown as a popup on the next casino page the player
 * opens (sockets/casino_server.js) - then it's gone.
 *
 * An item: {type: "gift" | "rain", at, ...} (gift: from, amount, world; rain: amount, note, world)
 */
const MAX = 20;

async function add(username, item) {
  const user = await User.findOne({ username: username }).select("inbox").lean();
  if (user == null) return;
  const inbox = [...(Array.isArray(user.inbox) ? user.inbox : []), { ...item, at: Date.now() }].slice(-MAX);
  await User.updateOne({ username: username }, { $set: { inbox: inbox } });
}

// Everything waiting - and the inbox is empty again
async function take(username) {
  const user = await User.findOne({ username: username }).select("inbox").lean();
  const inbox = user && Array.isArray(user.inbox) ? user.inbox : [];
  if (inbox.length) await User.updateOne({ username: username }, { $set: { inbox: [] } });
  return inbox;
}

module.exports = { add, take };
