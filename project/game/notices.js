const EventEmitter = require("events");

/*
 * Notices for one player on every open casino page, whichever game it shows
 * (sent by sockets/casino_server.js): notices.send(username, event, data).
 */
const notices = new EventEmitter();
notices.setMaxListeners(0);

function send(username, event, data) {
  notices.emit("notice", username, event, data);
}

module.exports = { send, notices };
