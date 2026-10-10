const access = require("../game/access");
const settings = require("../game/settings");
const games = require("../game/games");
const { notices } = require("../game/notices");
const seasons = require("../game/seasons");
const maintenance = require("../game/maintenance");

const testMode = require("../game/test_mode");
const worlds = require("../game/worlds");
const inbox = require("../game/inbox");

// The games - in the normal casino, the season world and the admin's test world (game/worlds.js)
const REAL = ["/jackpot", "/battles", "/poker", "/blackjack", "/slots", "/roulette", "/baucua"];
const SEASON = REAL.map((name) => worlds.SEASON + name);
const GAMES = [...REAL, ...SEASON, ...REAL.map((name) => worlds.TEST + name)];

function socketsOf(io, username) {
  const list = [];
  for (const name of GAMES) for (const socket of io.of(name).sockets.values()) if (socket.data.username === username) list.push(socket);
  return list;
}

/*
 * What all hidden games share: notices for a player on every open casino page
 * (a case battle starts), and when the admin takes a player's access away,
 * every open casino page of the player is closed.
 */
module.exports = function (io) {
  // (a gift while the player has no casino page open: kept for the next visit - game/inbox.js)
  notices.on("notice", (username, event, data) => {
    const sockets = socketsOf(io, username);
    // A reward (a season's place, from the admin): kept first, then shown on one open page (the season's end may move the pages - then the next one shows it)
    if (event === "reward") {
      inbox
        .add(username, { type: "reward", ...data })
        .then(() =>
          setTimeout(() => {
            const open = socketsOf(io, username);
            if (open.length) deliverInbox(open[0]);
          }, 1500),
        )
        .catch((error) => console.error("[inbox] Could not keep a season reward:", error));
      return;
    }
    for (const socket of sockets) socket.emit(event, data);
    if (event === "giftReceived" && sockets.length === 0) inbox.add(username, { type: "gift", ...data }).catch((error) => console.error("[inbox] Could not keep a gift:", error));
  });

  // A casino page opens: what happened while the player was away (gifts, money rains) - as popups
  const delivering = new Set();
  async function deliverInbox(socket) {
    const username = socket.data.username;
    if (!username || delivering.has(username)) return;
    delivering.add(username);
    try {
      const items = await inbox.take(username);
      for (const item of items) {
        if (item.type === "gift") socket.emit("giftReceived", { ...item, missed: true });
        if (item.type === "rain") socket.emit("moneyRain", { ...item, missed: true });
        // (seasonReward: kept before rewards were general - a season's name and place)
        if (item.type === "reward") socket.emit("reward", { ...item, missed: true });
        if (item.type === "seasonReward") socket.emit("reward", { source: item.season, icon: item.icon, rank: item.rank, coins: 0, items: item.items || [], missed: true });
      }
    } catch (error) {
      console.error("[inbox] Could not deliver:", error);
    } finally {
      delivering.delete(username);
    }
  }
  for (const name of GAMES) io.of(name).on("connection", (socket) => setTimeout(() => deliverInbox(socket), 800));

  // A game turned off (admin panel): its open pages go to another game
  settings.changes.on("change", (values) => {
    for (const game of games.GAMES) {
      if (values[game.key] !== false) continue;
      for (const socket of [...io.of(game.namespace).sockets.values(), ...io.of(worlds.SEASON + game.namespace).sockets.values(), ...io.of(worlds.TEST + game.namespace).sockets.values()]) {
        socket.emit("gameOff");
        socket.disconnect(true);
      }
    }
  });

  // Hard reset (admin panel): every open casino page is closed
  access.changes.on("closeAll", () => {
    for (const name of GAMES) {
      for (const socket of io.of(name).sockets.values()) {
        socket.emit("casinoClosed");
        socket.disconnect(true);
      }
    }
  });

  // The open casino pages of the players who may play in a season (who can't doesn't see it)
  function* seasonSockets(season) {
    for (const name of GAMES) for (const socket of io.of(name).sockets.values()) if (seasons.allowed(season, socket.data.username)) yield socket;
  }

  // A season starts: every open casino page asks to join (or later) - nothing else changes
  seasons.changes.on("started", (season) => {
    const full = seasons.byId(season.id);
    for (const socket of seasonSockets(full)) socket.emit("seasonStarted", season);
  });

  // The countdown to the start of a season - and the season world closing before its end: the pages show it
  seasons.changes.on("closing", (info) => {
    const season = info && seasons.byId(info.id);
    if (info == null) {
      for (const name of GAMES) for (const socket of io.of(name).sockets.values()) socket.emit("seasonClosing", null);
      return;
    }
    for (const socket of seasonSockets(season)) socket.emit("seasonClosing", info);
  });

  // A season is over: every open casino page shows it (with a link to the winners) - the pages of
  // the season world load again (in the normal casino, the season's coins in the wallet)
  seasons.changes.on("ended", (season) => {
    const full = seasons.byId(season.id);
    for (const socket of seasonSockets(full)) socket.emit("seasonEnded", { id: season.id, name: season.name, icon: season.icon, winner: season.winner });
  });

  // A player switched the world (joined the season, the switch in the menu, the end of the season):
  // the open casino pages of the player load again - in the other world
  seasons.changes.on("world", (username, world) => {
    for (const socket of socketsOf(io, username)) {
      if (worlds.worldOfNamespace(socket.nsp.name) === world) continue;
      socket.emit("worldChanged", { world: world ? "season" : "normal" });
      socket.disconnect(true);
    }
  });

  // A maintenance comes: every open casino page shows it (like before a season) - over: the season's again, if any
  maintenance.changes.on("closing", (info) => {
    const shown = info || seasons.closingInfo();
    for (const name of GAMES) for (const socket of io.of(name).sockets.values()) socket.emit("seasonClosing", shown);
  });

  // Maintenance: every open casino page of a player not on the whitelist is closed (it shows the maintenance page)
  maintenance.changes.on("change", () => {
    for (const name of GAMES) {
      for (const socket of io.of(name).sockets.values()) {
        if (maintenance.allowed(socket.data.username)) continue;
        socket.emit("casinoClosed");
        socket.disconnect(true);
      }
    }
  });

  // A money rain: every open casino page of who got coins shows it (in the world it rained in)
  // (who has no casino page open: a popup on the next visit)
  require("../game/money_rain").changes.on("rain", (rain) => {
    const names = new Set(rain.names);
    const world = rain.world === "season" ? worlds.SEASON : "";
    const seasonCoin = rain.world === "season" && seasons.running() ? seasons.publicSeason(seasons.running()).coinIcon : null;
    const online = new Set();
    for (const name of GAMES) {
      for (const socket of io.of(name).sockets.values()) {
        if (!names.has(socket.data.username)) continue;
        online.add(socket.data.username);
        if (worlds.worldOfNamespace(name) === world) socket.emit("moneyRain", { amount: rain.amount, note: rain.note || null, world: rain.world, coinIcon: seasonCoin });
        // (in the other world: told as a popup there, the coins are in the other wallet)
        else socket.emit("moneyRain", { amount: rain.amount, note: rain.note || null, world: rain.world, coinIcon: seasonCoin, elsewhere: true });
      }
    }
    for (const username of names) {
      if (!online.has(username)) inbox.add(username, { type: "rain", amount: rain.amount, note: rain.note || null, world: rain.world, coinIcon: seasonCoin }).catch((error) => console.error("[inbox] Could not keep a money rain:", error));
    }
  });

  // Test mode started or stopped: the open casino pages of the player load again - in the other world
  testMode.changes.on("change", (username) => {
    for (const socket of socketsOf(io, username)) {
      socket.emit("casinoClosed");
      socket.disconnect(true);
    }
  });

  // Access taken away: every open casino page of the player is closed
  access.changes.on("revoked", (username) => {
    for (const socket of socketsOf(io, username)) {
      socket.emit("casinoClosed");
      socket.disconnect(true);
    }
  });
};
