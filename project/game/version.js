/*
 * Changes with every start of the server. Pages know the version they were
 * loaded with (meta tag), the sockets tell the current one: a page that is
 * older than the server (it reconnected after a restart / update) reloads,
 * so old page code never talks to a newer server.
 */
const BOOT_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// Sends the version to a new socket connection
function announce(socket) {
  socket.emit("appVersion", BOOT_ID);
}

module.exports = { BOOT_ID, announce };
