const access = require("../game/access");
const settings = require("../game/settings");
const games = require("../game/games");
const { notices } = require("../game/notices");
const seasons = require("../game/seasons");
const maintenance = require("../game/maintenance");

const testMode = require("../game/test_mode");
const worlds = require("../game/worlds");
const inbox = require("../game/inbox");
const safe = require("./safe_handler");

// The games - in the normal casino, the season world and the admin's test world (game/worlds.js)
const REAL = ["/jackpot", "/battles", "/poker", "/blackjack", "/slots", "/roulette", "/baucua"];
// (every season world: one per season slot)
const SEASON = worlds.SEASONS.flatMap((world) => REAL.map((name) => world + name));
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
    // A reward (a season's place, from the admin): kept first, then shown on every open page of the player - the
    // one they look at too, not only the first (the season's end may move the pages - then the next one shows it)
    if (event === "reward" && !(data && data.preview)) {
      inbox
        .add(username, { type: "reward", ...data })
        .then(() =>
          setTimeout(() => {
            const open = socketsOf(io, username);
            if (open.length) deliverInbox(open);
          }, 1500),
        )
        .catch((error) => console.error("[inbox] Could not keep a season reward:", error));
      return;
    }
    for (const socket of sockets) socket.emit(event, data);
    if (event === "giftReceived" && sockets.length === 0) inbox.add(username, { type: "gift", ...data }).catch((error) => console.error("[inbox] Could not keep a gift:", error));
    if (event === "cashback" && sockets.length === 0) inbox.add(username, { type: "cashback", ...data }).catch((error) => console.error("[inbox] Could not keep a cashback:", error));
  });

  // A casino page opens: what happened while the player was away (gifts, money rains, rewards) - as popups.
  // sockets: one page - or every open page of the player (a reward: always on every open page)
  const delivering = new Set();
  async function deliverInbox(sockets) {
    const pages = Array.isArray(sockets) ? sockets : [sockets];
    const username = pages[0] && pages[0].data.username;
    if (!username) return;
    // (another delivery for the player right now - a page opening: once more in a moment, so a reward doesn't wait for the next page)
    if (delivering.has(username)) {
      if (Array.isArray(sockets)) setTimeout(() => deliverInbox(sockets.filter((socket) => socket.connected)), 1000);
      return;
    }
    delivering.add(username);
    try {
      const items = await inbox.take(username);
      // (a reward: on every open page of the player - the page opening right now may not be the one they look at)
      const everyPage = [...new Set([...pages, ...socketsOf(io, username)])];
      for (const item of items) {
        if (item.type === "reward" || item.type === "seasonReward") {
          const data = item.type === "reward" ? { ...item, missed: true } : { source: item.season, icon: item.icon, rank: item.rank, coins: 0, items: item.items || [], missed: true };
          for (const socket of everyPage) socket.emit("reward", data);
          continue;
        }
        for (const socket of pages) {
          if (item.type === "gift") socket.emit("giftReceived", { ...item, missed: true });
          if (item.type === "rain") socket.emit("moneyRain", { ...item, missed: true });
          if (item.type === "cashback") socket.emit("cashback", { ...item, missed: true });
        }
      }
    } catch (error) {
      console.error("[inbox] Could not deliver:", error);
    } finally {
      delivering.delete(username);
    }
  }
  for (const name of GAMES) io.of(name).on("connection", (socket) => setTimeout(() => deliverInbox(socket), 800));

  // The free coins of the day (the popup of every casino page) - in the world of the page: one handler for every game
  for (const name of GAMES) {
    const wallet = worlds.services(worlds.worldOfNamespace(name)).coins;
    io.of(name).on("connection", (socket) =>
      socket.on(
        "claimBonus",
        safe("claimBonus", async () => {
          const username = socket.data.username;
          const paid = await wallet.claim(username);
          if (paid) socket.emit("bonusClaimed", paid);
          // (the pages get the balance again - also when there was nothing to claim)
          wallet.notify(username);
        }),
      ),
    );
  }

  // A setting changed (admin panel): every open page gets the balance again - with the max bet by balance as it
  // is now (the pages work out what is left from the rule they got last)
  settings.changes.on("change", () => {
    const names = (list) => new Set(list.flatMap((name) => [...io.of(name).sockets.values()].map((socket) => socket.data.username)).filter(Boolean));
    names([...REAL, ...REAL.map((name) => worlds.TEST + name)]).forEach((username) => worlds.services("").coins.notify(username));
    for (const world of worlds.SEASONS) names(REAL.map((name) => world + name)).forEach((username) => worlds.services(world).coins.notify(username));
  });

  // The admin changed a moderator's rights: their open pages load them again (the 🛡️ button, the chat tools)
  require("../game/moderators").changes.on("change", (username) => {
    for (const socket of socketsOf(io, username)) socket.emit("modChanged");
    // (everybody: the 🛡️ in the chat)
    require("../game/casino_chat").refreshOnline();
    require("../game/worlds").testChat.refreshOnline();
  });

  // A game turned off (admin panel): its open pages go to another game
  settings.changes.on("change", (values) => {
    for (const game of games.GAMES) {
      if (values[game.key] !== false) continue;
      for (const socket of [game.namespace, ...worlds.SEASONS.map((world) => world + game.namespace), worlds.TEST + game.namespace].flatMap((name) => [...io.of(name).sockets.values()])) {
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

  // The countdown to the start of a season - and a season world closing before its end: the pages show it
  // (two seasons: every page the first countdown of a season the player may play in - none: null)
  const closingFor = (username) => seasons.closingInfos().find((info) => seasons.allowed(seasons.byId(info.id), username)) || null;
  seasons.changes.on("closing", () => {
    for (const name of GAMES) for (const socket of io.of(name).sockets.values()) socket.emit("seasonClosing", closingFor(socket.data.username));
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
      // (the world: a season slot "season" / "season2" - or "normal")
      const slot = require("../game/season_slots").of(world);
      socket.emit("worldChanged", { world: slot ? slot.key : "normal" });
      socket.disconnect(true);
    }
  });

  // A maintenance comes: every open casino page shows it (like before a season) - over: the season's again, if any
  maintenance.changes.on("closing", (info) => {
    for (const name of GAMES) for (const socket of io.of(name).sockets.values()) socket.emit("seasonClosing", info || closingFor(socket.data.username));
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
    const slot = require("../game/season_slots").of(rain.world);
    const world = slot ? slot.world : "";
    const seasonCoin = slot && seasons.running(slot.key) ? seasons.publicSeason(seasons.running(slot.key)).coinIcon : null;
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
