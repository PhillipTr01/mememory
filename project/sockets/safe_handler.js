/*
 * Wraps a socket event handler so that a bug or a malformed message from a
 * single client can't crash the whole server (an uncaught exception or an
 * unhandled rejection inside a socket.io listener would stop the process).
 */
module.exports = function safe(eventName, handler) {
  return async (...args) => {
    try {
      await handler(...args);
    } catch (error) {
      console.error(`[socket] Error while handling "${eventName}":`, error);
    }
  };
};
