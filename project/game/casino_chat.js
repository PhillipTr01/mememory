const config = require("./config");
const { cleanText } = require("./chat");
const persist = require("./persist");

/*
 * One chat for every hidden game (jackpot, case battles, poker, blackjack): a
 * message written on one page shows up on all of them. Only messages of the
 * players, no info messages. The chat also shows who is online in the casino.
 */
/*
 * A chat of its own: the casino's (key "chat", saved) - or the admin's test
 * world (not saved, see game/worlds.js).
 */
function create(key, options = {}) {
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

  // Everybody with a casino page open (once per player, however many tabs) - season: who plays in
  // the season world right now (the chat marks them with the season's icon)
  function online() {
    const names = new Set();
    const season = new Set();
    for (const page of pages) {
      for (const socket of page.namespace.sockets.values()) {
        names.add(socket.data.username);
        if (page.namespace.name.startsWith("/season/")) season.add(socket.data.username);
      }
    }
    const running = season.size ? require("./seasons").running() : null;
    return {
      names: [...names].sort((a, b) => a.localeCompare(b)),
      season: [...season].sort((a, b) => a.localeCompare(b)),
      seasonIcon: running ? running.icon : null,
      seasonName: running ? running.name : null,
      // The moderators (🛡️ next to their names)
      mods: require("./moderators").names(),
    };
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
      persist.changed(key);
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
    // (sent from the season world: the others see the season badge right away)
    if (socket.nsp && socket.nsp.name.startsWith("/season/")) sendOnline();
    history.push(entry);
    if (history.length > config.CASINO_CHAT_HISTORY) history.splice(0, history.length - config.CASINO_CHAT_HISTORY);
    for (const page of pages) page.namespace.to(page.room).emit("chatMessage", entry);
    persist.changed(key);
  }

  // 📣 A moderator's announcement (game/moderators.js): highlighted for everybody - gone after `minutes`
  function announce(username, text, minutes = 1) {
    const entry = { id: ++messageId, time: Date.now(), type: "announce", name: username, spectator: false, text: text, until: Date.now() + minutes * 60 * 1000 };
    sweepSoon();
    history.push(entry);
    if (history.length > config.CASINO_CHAT_HISTORY) history.splice(0, history.length - config.CASINO_CHAT_HISTORY);
    for (const page of pages) page.namespace.to(page.room).emit("chatMessage", entry);
    persist.changed(key);
  }

  // Announcements whose time is over: out of the chat (for everybody - the pages drop them themselves too)
  let sweepTimer = null;
  function sweep() {
    sweepTimer = null;
    const now = Date.now();
    const before = history.length;
    // (one from before announcements had an end: gone right away)
    for (let i = history.length - 1; i >= 0; i--) if (history[i].type === "announce" && (!history[i].until || history[i].until <= now)) history.splice(i, 1);
    if (history.length !== before) resend();
    sweepSoon();
  }
  function sweepSoon() {
    clearTimeout(sweepTimer);
    sweepTimer = null;
    const next = history.filter((entry) => entry.type === "announce" && entry.until).reduce((min, entry) => Math.min(min, entry.until), Infinity);
    if (next === Infinity) return;
    sweepTimer = setTimeout(sweep, Math.max(1000, next - Date.now() + 500));
    sweepTimer.unref();
  }

  /* ---------- Admin ---------- */

  // Every open chat shows the messages again (after a delete or clear)
  function resend() {
    for (const page of pages) page.namespace.to(page.room).emit("chatHistory", history);
    persist.changed(key);
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
    persist.changed(key);
  }

  function unban(username) {
    const had = bans.delete(username);
    persist.changed(key);
    return had;
  }

  function banList() {
    return [...bans.keys()].filter((name) => banOf(name)).map((name) => ({ username: name, until: bans.get(name) })).sort((a, b) => a.username.localeCompare(b.username));
  }

  // The messages (and bans) survive a restart
  if (options.save !== false) persist.register(
    key,
    () => ({ history: history, messageId: messageId, bans: bans }),
    (saved) => {
      history.splice(0, history.length, ...(saved.history || []));
      messageId = Math.max(messageId, saved.messageId || 0);
      bans = saved.bans instanceof Map ? saved.bans : new Map();
      resend();
      // (announcements whose time is over - or from before they had one: gone)
      sweep();
    },
  );

  return { attach, join, fromUser, announce, online, messages, remove, clear, ban, unban, banList };
}

module.exports = { ...create("chat"), create };
