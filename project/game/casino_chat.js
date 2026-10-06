const config = require("./config");
const { cleanText } = require("./chat");

/*
 * One chat for every hidden game (lobby, jackpot, case battles, poker): a
 * message written on one page shows up on all of them. Only messages of the
 * players, no info messages.
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
}

function fromUser(socket, data) {
  const text = cleanText(socket, data);
  if (text == null) return;
  const entry = { id: ++messageId, time: Date.now(), type: "user", name: socket.data.username, spectator: false, text: text };
  history.push(entry);
  if (history.length > config.CHAT_HISTORY) history.splice(0, history.length - config.CHAT_HISTORY);
  for (const page of pages) page.namespace.to(page.room).emit("chatMessage", entry);
}

module.exports = { attach, join, fromUser };
