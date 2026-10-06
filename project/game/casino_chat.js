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

function fromUser(socket, data) {
  const text = cleanText(socket, data);
  if (text == null) return;
  const entry = { id: ++messageId, time: Date.now(), type: "user", name: socket.data.username, spectator: false, text: text };
  history.push(entry);
  if (history.length > config.CHAT_HISTORY) history.splice(0, history.length - config.CHAT_HISTORY);
  for (const page of pages) page.namespace.to(page.room).emit("chatMessage", entry);
  persist.changed("chat");
}

// The messages survive a restart
persist.register(
  "chat",
  () => ({ history: history, messageId: messageId }),
  (saved) => {
    history.splice(0, history.length, ...(saved.history || []));
    messageId = Math.max(messageId, saved.messageId || 0);
  },
);

module.exports = { attach, join, fromUser };
