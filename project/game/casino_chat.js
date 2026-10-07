const config = require("./config");
const { cleanText } = require("./chat");
const persist = require("./persist");

/*
 * One chat for every hidden game (jackpot, case battles, poker, blackjack): a
 * message written on one page shows up on all of them. Only messages of the
 * players, no info messages. The chat also shows who is online in the casino.
 */
const history = [];
const pages = []; // [{namespace, room}] every page that shows the chat
let messageId = 0;
// Banned from the chat by the admin: username -> until (ms, null: for good)
let bans = new Map();

// A page (socket.io namespace) shows the chat to everybody in `room`
function attach(namespace, room) {
  pages.push({ namespace: namespace, room: room });
}

function join(socket) {
  socket.emit("chatHistory", history);
  socket.emit("casinoOnline", online());
  sendOnline();
  socket.on("disconnect", sendOnline);
}

// Everybody with a casino page open (once per player, however many tabs)
function online() {
  const names = new Set();
  for (const page of pages) for (const socket of page.namespace.sockets.values()) names.add(socket.data.username);
  return { names: [...names].sort((a, b) => a.localeCompare(b)) };
}

// Joins and leaves come in bursts (page changes): one update for them
let onlineTimer = null;
function sendOnline() {
  if (onlineTimer) return;
  onlineTimer = setTimeout(() => {
    onlineTimer = null;
    const data = online();
    for (const page of pages) page.namespace.to(page.room).emit("casinoOnline", data);
  }, 150);
  onlineTimer.unref();
}

// The ban of a player right now (null: none; an old one is gone by itself)
function banOf(username) {
  if (!bans.has(username)) return null;
  const until = bans.get(username);
  if (until != null && until <= Date.now()) {
    bans.delete(username);
    persist.changed("chat");
    return null;
  }
  return { until: until };
}

function fromUser(socket, data) {
  const ban = banOf(socket.data.username);
  if (ban) {
    const left = ban.until == null ? "" : ` for ${Math.max(1, Math.ceil((ban.until - Date.now()) / 60000))} more min`;
    socket.emit("chatError", `You are banned from the chat${left}.`);
    return;
  }
  const text = cleanText(socket, data);
  if (text == null) return;
  const entry = { id: ++messageId, time: Date.now(), type: "user", name: socket.data.username, spectator: false, text: text };
  history.push(entry);
  if (history.length > config.CASINO_CHAT_HISTORY) history.splice(0, history.length - config.CASINO_CHAT_HISTORY);
  for (const page of pages) page.namespace.to(page.room).emit("chatMessage", entry);
  persist.changed("chat");
}

/* ---------- Admin ---------- */

// Every open chat shows the messages again (after a delete or clear)
function resend() {
  for (const page of pages) page.namespace.to(page.room).emit("chatHistory", history);
  persist.changed("chat");
}

function messages() {
  return history.slice();
}

function remove(id) {
  const index = history.findIndex((entry) => entry.id === id);
  if (index < 0) return false;
  history.splice(index, 1);
  resend();
  return true;
}

function clear() {
  history.splice(0);
  resend();
}

// minutes: null for good
function ban(username, minutes) {
  bans.set(username, minutes == null ? null : Date.now() + minutes * 60 * 1000);
  persist.changed("chat");
}

function unban(username) {
  const had = bans.delete(username);
  persist.changed("chat");
  return had;
}

function banList() {
  return [...bans.keys()].filter((name) => banOf(name)).map((name) => ({ username: name, until: bans.get(name) })).sort((a, b) => a.username.localeCompare(b.username));
}

// The messages (and bans) survive a restart
persist.register(
  "chat",
  () => ({ history: history, messageId: messageId, bans: bans }),
  (saved) => {
    history.splice(0, history.length, ...(saved.history || []));
    messageId = Math.max(messageId, saved.messageId || 0);
    bans = saved.bans instanceof Map ? saved.bans : new Map();
    resend();
  },
);

module.exports = { attach, join, fromUser, online, messages, remove, clear, ban, unban, banList };
