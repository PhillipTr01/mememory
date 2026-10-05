const config = require("./config");

/* Room chat on the server, shared by all games. A room only needs a `chat` array. */
let messageId = 0;

// Adds a message to the chat history and sends it to everyone in the room (sender included).
function add(namespace, gameID, room, message) {
  const entry = { id: ++messageId, time: Date.now(), ...message };
  room.chat.push(entry);
  if (room.chat.length > config.CHAT_HISTORY) {
    room.chat.splice(0, room.chat.length - config.CHAT_HISTORY);
  }
  namespace.to(gameID).emit("chatMessage", entry);
}

// Message from the server itself (joins, leaves, game start, ...)
function system(namespace, gameID, room, text, icon) {
  add(namespace, gameID, room, { type: "system", text: text, icon: icon || "info" });
}

// Message from a user: cleaned up, limited in length and speed
function fromUser(namespace, socket, room, data, spectator) {
  if (room == null || data == null || typeof data.message !== "string") return;

  const text = data.message.replace(/\s+/g, " ").trim().slice(0, config.MAX_CHAT_LENGTH);
  if (text.length == 0) return;

  const now = Date.now();
  if (now - (socket.lastChatMessage || 0) < config.CHAT_COOLDOWN) {
    socket.emit("chatError", "You are sending messages too fast.");
    return;
  }
  socket.lastChatMessage = now;

  add(namespace, socket.gameID, room, {
    type: "user",
    name: socket.data.username,
    spectator: spectator === true,
    text: text,
  });
}

module.exports = { add, system, fromUser };
