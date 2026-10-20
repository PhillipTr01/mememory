const rpg = require("../game/rpg");
const socketAuth = require("./socket_auth");
const safe = require("./safe_handler");
const version = require("../game/version");
const testMode = require("../game/test_mode");
const worlds = require("../game/worlds");
const config = require("../game/config");

const ROOM = "rpg";

/*
 * The dungeon (game/rpg.js) - in the admin's test world (/test/rpg: like everything there, nothing of it is
 * saved) and, once the admin turns it on (GAME_RPG), in the normal casino (/rpg: the characters are saved).
 *
 * Parties: a player opens one (a floor, 1 to 4 heroes - alone it starts right away) or joins an open
 * one (its floor open for the own hero too); the leader starts it. Every hero pays the entry of the
 * floor. A fight is played with cards: every hero plays from the hand, then ends the turn - when all
 * have (or the turn's time is up) the monsters act. Between two rooms everybody votes for one of the
 * hidden doors or to leave with the loot (all voted - or the time up: the votes so far, none: leave),
 * and picks the card won in the fight. The end (cleared, left or all down): the pot is paid, the gear
 * goes to the bags, the potions left go back - lost: nothing but the potions drunk.
 */
module.exports = function (io, options = {}) {
  const world = options.world != null ? options.world : worlds.TEST;
  const { coins, casinoChat, persist } = worlds.services(world);
  const room = io.of(world + "/rpg");
  room.use(socketAuth.casino);
  casinoChat.attach(room, ROOM);

  // How long a turn may take, how long one away from the page keeps the place in a party (ms) - the tests make
  // them short (between the rooms: no clock)
  // (the turn: the admin panel's - unless a test set its own)
  const timing = {
    own: null,
    get turn() {
      return this.own != null ? this.own : config.RPG_TURN_TIME;
    },
    set turn(value) {
      this.own = value;
    },
    away: 120000,
    close: 60000,
  };

  const heroes = new Map(); // username -> hero (rpg.newHero)
  const parties = new Map(); // id -> {id, leader, floor, size, members, run, endsAt, timer, result}
  const partyOf = new Map(); // username -> party id
  let partyCount = 0;

  function heroOf(name) {
    if (!heroes.has(name)) heroes.set(name, rpg.newHero());
    return heroes.get(name);
  }

  // (only the players of this world get coins here - test coins never go to a real balance)
  const ours = (name) => world !== worlds.TEST || testMode.active(name);

  function socketsOf(name) {
    return [...room.sockets.values()].filter((socket) => socket.data.username === name);
  }

  function sendHero(name) {
    persist.changed("rpg");
    const view = rpg.heroView(heroOf(name));
    socketsOf(name).forEach((socket) => socket.emit("rpgHero", view));
  }

  // A member for the lobby: the class, the level, the deepest floor and the stats the run will start with
  function whoOf(hero) {
    const char = rpg.charOf(hero);
    const perks = rpg.talentPerks(hero);
    const stats = rpg.statsOf(hero, hero.cls, { agi: perks.agi || 0 });
    return {
      cls: hero.cls,
      level: char.level,
      deepest: char.deepest || 0,
      hp: Math.round(stats.maxHp * (1 + (perks.maxHp || 0))),
      atk: stats.atk,
      def: stats.def,
      crit: Math.round(stats.luck + (perks.crit || 0)),
      dodge: Math.round(stats.agi),
    };
  }

  function partyView(party) {
    return {
      id: party.id,
      leader: party.leader,
      floor: party.floor,
      size: party.size,
      entry: rpg.entryCost(party.floor),
      members: party.members,
      // (who they are: the class, the level - for the lobby)
      who: Object.fromEntries(party.members.map((name) => [name, whoOf(heroOf(name))])),
      started: party.run != null,
      result: party.result || null,
      summary: party.summary || null,
      timeLeft: party.endsAt ? Math.max(0, party.endsAt - Date.now()) : null,
      run: party.run ? rpg.runView(party.run) : null,
    };
  }

  function emitParties() {
    const list = [...parties.values()].filter((party) => !party.result).map((party) => ({ id: party.id, leader: party.leader, floor: party.floor, size: party.size, members: party.members, levels: party.members.map((name) => rpg.charOf(heroOf(name)).level), started: party.run != null }));
    room.to(ROOM).emit("rpgParties", list);
  }

  // (only to the members whose party it is now - never to a page of another run)
  const inParty = (party, name) => partyOf.get(name) === party.id;
  function emitParty(party) {
    // (a run changed: saved soon after - it goes on after a restart)
    persist.changed("rpg");
    const view = partyView(party);
    for (const name of party.members) if (inParty(party, name)) socketsOf(name).forEach((socket) => socket.emit("rpgParty", view));
  }

  // A player out of a party: the pages told - unless the player is in another party by now
  function letGo(party, name) {
    if (!inParty(party, name)) return;
    partyOf.delete(name);
    socketsOf(name).forEach((socket) => {
      socket.leave("party:" + party.id);
      socket.emit("rpgParty", null);
    });
  }

  async function sendCoins(name) {
    const data = await coins.get(name);
    socketsOf(name).forEach((socket) => socket.emit("coins", data));
  }
  coins.changes.on("change", (name) => {
    if (socketsOf(name).length) sendCoins(name).catch(() => {});
  });

  function rules() {
    return {
      floors: rpg.FLOORS,
      rooms: rpg.ROOMS,
      dust: rpg.DUST,
      sellShare: config.RPG_CARD_SELL,
      sell: Object.fromEntries(Object.keys(rpg.DUST).map((rarity) => [rarity, rpg.sellPrice(rarity)])),
      resetCooldown: config.RPG_RESET_COOLDOWN,
      tradeFree: config.RPG_TRADE_FREE,
      tradeDeviation: config.RPG_TRADE_DEVIATION,
      entries: Array.from({ length: rpg.FLOORS }, (_, i) => rpg.entryCost(i + 1)),
      partyMax: rpg.PARTY_MAX,
      bagMax: rpg.BAG_MAX,
      bagTop: rpg.BAG_TOP,
      potionsMax: rpg.POTIONS_MAX,
      potionsTop: rpg.POTIONS_TOP,
      decksTop: rpg.DECKS_TOP,
      potionMana: rpg.POTION_MANA,
      potionHeal: rpg.POTION_HEAL,
      merchantBuy: rpg.MERCHANT_BUY,
      potionPrice: rpg.POTION_PRICE,
      stats: rpg.STATS,
      levelMax: rpg.LEVEL_MAX,
      classes: rpg.CLASSES,
      // (every card upgraded: its cost and text - and what the upgrade changes)
      upgrades: Object.fromEntries(Object.keys(rpg.CARDS).map((id) => [id, { cost: rpg.cardInfo(id + "+").cost, text: rpg.cardInfo(id + "+").text, note: rpg.upgradeNote(id) }])),
      classPrice: rpg.CLASS_PRICE,
      cardRarities: rpg.CARD_RARITIES,
      heroLevelMax: rpg.HERO_LEVEL_MAX,
      partyLoot: rpg.PARTY_LOOT,
      partyGap: config.RPG_PARTY_GAP,
      charPrice: config.RPG_CHAR_PRICE,
      abilities: rpg.ABILITIES,
      charHarder: config.RPG_CHAR_HARDER,
      low: { free: config.RPG_LOW_FREE, cut: config.RPG_LOW_CUT, min: config.RPG_LOW_MIN },
      deckMin: rpg.DECK_MIN,
      deckMax: rpg.DECK_MAX,
      deckLeast: rpg.DECK_LEAST,
      lanes: rpg.LANES,
      packPrice: rpg.PACK_PRICE,
      packSize: rpg.PACK_SIZE,
      packs: rpg.PACKS,
      cartMax: rpg.CART_MAX,
      mainBonus: rpg.MAIN_BONUS,
      moves: rpg.MOVES,
      roomKinds: rpg.ROOM_KINDS,
      energy: rpg.ENERGY,
      turn: timing.turn,
      away: timing.away,
      deathCooldown: rpg.DEATH_COOLDOWN,
      cards: rpg.CARDS,
      talents: rpg.TALENTS,
      talentLevels: rpg.TALENT_LEVELS,
      relics: rpg.RELICS,
      affixes: rpg.AFFIXES,
      monsterTraits: rpg.MONSTER_TRAITS,
      monsterTypes: rpg.MONSTER_TYPES,
      doors: rpg.DOORS,
    };
  }

  function join(party, name) {
    party.members.push(name);
    partyOf.set(name, party.id);
    socketsOf(name).forEach((socket) => socket.join("party:" + party.id));
  }

  function leave(party, name) {
    party.members = party.members.filter((member) => member !== name);
    letGo(party, name);
    if (!party.members.length) return close(party);
    if (party.leader === name) party.leader = party.members[0];
    emitParty(party);
  }

  function close(party) {
    clearTimeout(party.timer);
    parties.delete(party.id);
    for (const name of party.members) letGo(party, name);
  }

  // The clock of a fight - started anew only when the turn changes (a card played doesn't): the time up, the
  // monsters' turn. Only with others (alone: no clock), only in a fight. A run stands still while all are away.
  function schedule(party) {
    const run = party.run;
    const paused = run && (run.heroes.length < 2 || run.heroes.every((h) => h.away));
    const key = run && !paused ? run.phase + ":" + run.rooms.length + ":" + run.turn : null;
    if (key === party.clock) return;
    party.clock = key;
    clearTimeout(party.timer);
    party.endsAt = null;
    if (!key) return;
    if (run.phase === "fight") {
      party.endsAt = Date.now() + timing.turn;
      party.timer = setTimeout(() => monstersAct(party), timing.turn);
    }
  }

  function monstersAct(party) {
    if (!party.run || party.run.phase !== "fight" || party.result) return;
    rpg.monsterTurn(party.run);
    afterChange(party);
  }

  // The votes counted: through the door with the most - or out with the loot
  async function decide(party) {
    if (!party.run || party.run.phase !== "between" || party.result) return;
    const choice = rpg.tally(party.run);
    // (the floor cleared, the deep stairs not taken: out with the loot - a clear)
    if (choice === "leave") return finish(party, party.run.cleared ? "won" : "left");
    rpg.enterRoom(party.run, choice);
    afterChange(party);
  }

  // After every change of a run: over - paid; nobody left to wait for - on; otherwise the clock again
  function afterChange(party) {
    const run = party.run;
    const phase = run.phase;
    if (phase === "won" || phase === "lost" || phase === "left") return finish(party, phase).catch((error) => console.error("[rpg] Could not end a run:", error));
    if (rpg.turnDone(run) && run.heroes.some((h) => !h.away)) return monstersAct(party);
    if (phase === "between" && rpg.allVoted(run)) return decide(party).catch((error) => console.error("[rpg] Could not go on:", error));
    schedule(party);
    emitParty(party);
  }

  // The potions refilled (auto refill on): bought one by one up to the most - until the coins run out
  async function refill(name) {
    const hero = heroOf(name);
    if (!hero.autoPotions || !hero.cls) return;
    while (hero.potions < rpg.potionsMax(hero)) {
      if (!(await coins.spend(name, rpg.potionPrice(rpg.maxFloor(hero)), { reason: "rpg potion" }))) return;
      hero.potions++;
    }
  }

  // Out of a run before its end (left, or away too long): no share of the pot, no loot - half the XP; the others
  // go on
  function abandonRun(party, name) {
    const run = party.run;
    clearTimeout((party.away || {})[name]);
    const gone = rpg.abandon(run, name);
    if (!gone) return;
    if (heroes.has(name)) {
      const hero = heroOf(name);
      hero.potions = Math.min(rpg.potionsMax(hero), hero.potions + gone.potions);
      rpg.gainXp(rpg.charOf(hero, gone.cls), Math.round(gone.xp / 2));
      sendHero(name);
      refill(name)
        .then(() => sendHero(name))
        .catch((error) => console.error("[rpg] Could not refill potions:", error));
    }
    party.members = party.members.filter((member) => member !== name);
    letGo(party, name);
    if (party.leader === name && party.members.length) party.leader = party.members[0];
    afterChange(party);
    emitParties();
  }

  // Away from the page in a run (no tab left) - back
  function away(party, name, gone) {
    party.away = party.away || {};
    clearTimeout(party.away[name]);
    delete party.away[name];
    rpg.setAway(party.run, name, gone);
    // (in a party: the place kept a while - alone: the run waits)
    if (gone && party.run.heroes.length > 1) party.away[name] = setTimeout(() => abandonRun(party, name), timing.away);
    if (!gone) party.clock = null;
    afterChange(party);
  }

  async function start(party) {
    const entry = rpg.entryCost(party.floor);
    const paid = [];
    // (the practice run: free)
    for (const name of party.tutorial ? [] : party.members) {
      if (!(await coins.spend(name, entry, { reason: "rpg entry", note: "floor " + party.floor }))) {
        // (one can't pay: nobody pays)
        await Promise.all(paid.map((who) => coins.add(who, entry, { reason: "rpg refund" })));
        return name;
      }
      paid.push(name);
    }
    party.run = rpg.newRun(
      party.floor,
      party.members.map((name) => ({ name, hero: heroOf(name) })),
      Math.random,
      { tutorial: party.tutorial, deeper: party.tutorial ? 0 : rpg.DEEPER_CHANCE },
    );
    for (const name of party.members) {
      const hero = heroOf(name);
      rpg.charOf(hero).runs++;
      // (the floor cools down for everyone of the party)
      if (!party.tutorial) rpg.coolFloor(hero, party.floor);
      // (the potions go along - what is left comes back)
      hero.potions = 0;
    }
    rpg.enterRoom(party.run, 0);
    afterChange(party);
    emitParties();
    return null;
  }

  /*
   * The real runs (the next balancing): every hero's run that ended - its class, floor, level, stat levels and deck,
   * cleared or not. The last RUN_LOG of them and a tally per class and floor (solo and in a party apart).
   */
  const RUN_LOG = 5000;
  const runStats = { log: [], tally: {} }; // tally: "solo" | "party" -> class -> floor -> {runs, cleared}
  function recordRun(run, one, char, cleared) {
    if (world === worlds.TEST || run.tutorial) return;
    const kind = run.heroes.length > 1 ? "party" : "solo";
    const byClass = ((runStats.tally[kind] = runStats.tally[kind] || {})[one.cls] = runStats.tally[kind][one.cls] || {});
    const count = (byClass[run.floor] = byClass[run.floor] || { runs: 0, cleared: 0 });
    count.runs++;
    if (cleared) count.cleared++;
    runStats.log.push({ at: Date.now(), cls: one.cls, floor: run.floor, cleared, party: run.heroes.length, level: char.level, levels: { ...char.levels }, deck: [...(one.deck || [])] });
    if (runStats.log.length > RUN_LOG) runStats.log.splice(0, runStats.log.length - RUN_LOG);
    persist.changed("rpgRuns");
  }
  persist.register(
    "rpgRuns",
    () => runStats,
    (saved) => {
      runStats.log = Array.isArray(saved.log) ? saved.log : [];
      runStats.tally = saved.tally || {};
    },
  );

  // The end of a run: the pot to every hero, the loot to the bags (not when lost), the potions left back
  async function finish(party, result) {
    if (party.result) return;
    clearTimeout(party.timer);
    party.endsAt = null;
    const run = party.run;
    party.result = result;
    party.summary = {};
    if (result === "left") run.phase = "left";
    for (const timer of Object.values(party.away || {})) clearTimeout(timer);
    for (const one of run.heroes) {
      if (!heroes.has(one.name)) continue;
      const hero = heroOf(one.name);
      hero.potions = Math.min(rpg.potionsMax(hero), hero.potions + one.potions);
      // (the practice run: done - nothing else counts, nobody dies)
      if (run.tutorial) {
        rpg.charOf(hero, one.cls).tutorialDone = true;
        party.summary[one.name] = { xp: 0, ups: 0, level: rpg.charOf(hero, one.cls).level, firstClear: 0 };
        sendHero(one.name);
        continue;
      }
      // (the floor counts for the character that went down - its class)
      const char = rpg.charOf(hero, one.cls);
      // XP for the character (lost: half of it) - a floor cleared the first time: a bonus (coins, XP)
      // (the floor counts as cleared even when the deep stairs went wrong)
      const cleared = result === "won" || !!run.cleared;
      const firstClear = cleared && run.floor > char.deepest;
      // (the first clear: half the entry more - a bigger party more)
      const bonus = firstClear ? Math.round((rpg.entryCost(run.floor) * rpg.FIRST_CLEAR * rpg.partyBonus(run.heroes.length)) / 100) * 100 : 0;
      const xp = Math.round((result === "lost" ? one.xp / 2 : one.xp) + (firstClear ? rpg.xpFor("floor", run.floor) * 2 : 0));
      recordRun(run, one, char, cleared);
      const ups = rpg.gainXp(char, xp);
      party.summary[one.name] = { xp, ups, level: char.level, firstClear: bonus };
      if (bonus && ours(one.name)) await coins.add(one.name, bonus, { reason: "rpg first clear", note: "floor " + run.floor });
      if (cleared) {
        char.deepest = Math.max(char.deepest, run.floor);
        char.cleared++;
        // (a cleared run counts for today: the next run of the floor pays less)
        rpg.countRun(hero, run.floor, one.cls);
      }
      // (the party down: the character is dead for a while)
      // (the floor open again: the death is wait enough)
      if (result === "lost") {
        rpg.die(hero, one.cls);
        rpg.warmFloor(hero, run.floor, one.cls);
      }
      if (result !== "lost") {
        for (const item of run.loot[one.name] || []) {
          // (a card: into the character's collection)
          if (item.card) {
            // (another class's card: to that class's character - like a pack's)
            rpg.collect(rpg.charOf(hero, rpg.cardClass(item.card) || one.cls), item.card);
            continue;
          }
          if (hero.bag.length < rpg.bagSize(hero)) hero.bag.push(item);
          // (the bag full: sold right away)
          else if (ours(one.name)) await coins.add(one.name, item.value, { reason: "rpg sell", note: item.name });
        }
      }
      // (a character far deeper than this floor: a smaller share)
      const pot = rpg.payout(run, one, result);
      party.summary[one.name].pot = pot;
      if (pot > 0 && ours(one.name)) await coins.add(one.name, pot, { reason: "rpg loot", note: "floor " + run.floor + " - " + result });
      await refill(one.name);
      sendHero(one.name);
    }
    emitParty(party);
    emitParties();
    // (the end stays on the pages for a while - then the party is gone)
    party.timer = setTimeout(() => close(party), timing.close);
  }

  // The test mode stopped: the hero is gone (nothing of the test world stays) - out of its party or run too
  // (only the test world's dungeon: the characters of the normal casino stay)
  if (world === worlds.TEST)
    testMode.changes.on("change", (name) => {
      if (testMode.active(name)) return;
      const party = parties.get(partyOf.get(name));
      if (party && party.run && !party.result) abandonRun(party, name);
      else if (party) leave(party, name);
      heroes.delete(name);
    });

  /* ---------- Trades: an offer from one player to another - checked again when it is taken ---------- */

  const trades = new Map(); // id -> {id, from, to, give, take, at}
  let tradeCount = 0;
  const TRADE_TIME = 24 * 3600000; // an offer not answered: gone after this long
  const TRADES_OPEN = 5; // offers a player may have out at once

  // A player in a run right now (trades wait)
  const running = (name) => {
    const party = parties.get(partyOf.get(name));
    return party != null && party.run != null && !party.result;
  };

  // A side of an offer as the client sends it -> clean entries (or null)
  function cleanSide(side) {
    if (!Array.isArray(side) || side.length > 20) return null;
    const clean = [];
    for (const one of side) {
      if (one && one.k === "card" && rpg.CLASS_IDS.includes(one.cls) && rpg.CARDS[one.id] && Number.isInteger(one.n) && one.n > 0) clean.push({ k: "card", cls: one.cls, id: one.id, n: one.n });
      else if (one && one.k === "gear" && typeof one.id === "string") clean.push({ k: "gear", id: one.id });
      else return null;
    }
    return clean;
  }

  // A side for the page: what it is, what it is worth (a piece no longer there: gone)
  function sideView(hero, side) {
    return side.map((one) => {
      if (one.k === "card") return { ...one, value: rpg.CARD_RARITIES[rpg.CARDS[one.id].rarity].value * one.n };
      const item = hero.bag.find((piece) => piece.id === one.id);
      return item ? { k: "gear", id: one.id, item, value: item.value || 0 } : { k: "gear", id: one.id, gone: true, value: 0 };
    });
  }

  // The offers of a player (made and received) to its pages
  function sendTrades(name) {
    persist.changed("rpg");
    const now = Date.now();
    for (const [id, offer] of trades) if (now - offer.at > TRADE_TIME) trades.delete(id);
    const list = [...trades.values()]
      .filter((offer) => offer.from === name || offer.to === name)
      .map((offer) => ({ id: offer.id, from: offer.from, to: offer.to, give: sideView(heroOf(offer.from), offer.give), take: sideView(heroOf(offer.to), offer.take), giveCoins: offer.giveCoins || 0, takeCoins: offer.takeCoins || 0, left: Math.max(0, TRADE_TIME - (now - offer.at)) }));
    socketsOf(name).forEach((socket) => socket.emit("rpgTrades", list));
  }

  room.on("connection", (socket) => {
    version.announce(socket);
    const username = socket.data.username;
    socket.join(ROOM);
    socket.emit("joined", { username: username });
    socket.emit("rpgRules", rules());
    socket.emit("rpgHero", rpg.heroView(heroOf(username)));
    sendTrades(username);
    casinoChat.join(socket);
    const mine = parties.get(partyOf.get(username));
    if (mine) {
      socket.join("party:" + mine.id);
      socket.emit("rpgParty", partyView(mine));
      if (mine.run && !mine.result && mine.run.heroes.some((h) => h.name === username && h.away)) away(mine, username, false);
    }
    emitParties();
    sendCoins(username).catch((error) => console.error("[rpg] Could not load coins:", error));
    // (a click that came too late - the run went on: nothing to say, see rpg.STALE)
    const error = (message) => {
      if (!rpg.STALE.has(message)) socket.emit("rpgError", message);
    };
    const myParty = () => parties.get(partyOf.get(username));
    const inRun = () => {
      const party = myParty();
      return party != null && party.run != null && !party.result;
    };

    // One action of a player after the other (fast clicks, two tabs)
    let busy = Promise.resolve();
    function on(event, handler) {
      socket.on(
        event,
        safe(event, (data) => {
          busy = busy.then(() => handler(data || {})).catch((err) => console.error(`[rpg] "${event}":`, err));
          return busy;
        }),
      );
    }

    /* ---------- The hero ---------- */

    on("upgrade", async (data) => {
      if (!rpg.STAT_IDS.includes(data.stat)) return;
      if (inRun()) return error("Not during a run.");
      const hero = heroOf(username);
      const char = rpg.charOf(hero);
      if (!hero.cls) return error("Pick a class first.");
      const level = char.levels[data.stat] || 0;
      const cost = rpg.statPrice(hero, level);
      if (cost == null) return error("Already max level.");
      if (rpg.statFull(hero, data.stat)) return error("Already capped.");
      if (!(await coins.spend(username, cost, { reason: "rpg upgrade", note: data.stat }))) return error(coins.refusal(username) || "You don't have enough coins.");
      char.levels[data.stat] = level + 1;
      sendHero(username);
    });

    // A stat point (one per hero level): a free level of a stat
    on("point", (data) => {
      if (!rpg.STAT_IDS.includes(data.stat)) return;
      if (inRun()) return error("Not during a run.");
      const hero = heroOf(username);
      const char = rpg.charOf(hero);
      if (!hero.cls || char.points <= 0) return error("No stat points.");
      if (rpg.upgradeCost(char.levels[data.stat] || 0) == null) return error("Already max level.");
      if (rpg.statFull(hero, data.stat)) return error("Already capped.");
      char.points--;
      char.levels[data.stat] = (char.levels[data.stat] || 0) + 1;
      sendHero(username);
    });

    // The deck (built between the runs): a card of the collection in, a card out
    on("deckAdd", (data) => {
      if (inRun()) return error("Not during a run.");
      const problem = rpg.deckAdd(heroOf(username), String(data.id));
      if (problem) return error(problem);
      sendHero(username);
    });

    on("deckRemove", (data) => {
      if (inRun()) return error("Not during a run.");
      const problem = rpg.deckRemove(heroOf(username), String(data.id));
      if (problem) return error(problem);
      sendHero(username);
    });

    // The whole deck (the deck builder: cleared, the starter deck again): {ids}
    on("deckSet", (data) => {
      if (inRun()) return error("Not during a run.");
      const problem = rpg.deckSet(heroOf(username), data.ids);
      if (problem) return error(problem);
      sendHero(username);
    });

    // The shop's cart: {cart: {pack id: count}} - paid at once, the packs wait
    // unopened
    on("buyPacks", async (data) => {
      const hero = heroOf(username);
      const check = rpg.cartPrice(data.cart);
      if (check.error) return error(check.error);
      const note = check.items.map(([id, n]) => id + " x" + n).join(", ");
      if (!(await coins.spend(username, check.total, { reason: "rpg pack", note }))) return error(coins.refusal(username) || "You don't have enough coins.");
      rpg.addPacks(hero, check.items);
      socket.emit("rpgBought", { items: check.items, total: check.total });
      sendHero(username);
    });

    // Every pack waiting at once
    on("openAll", async () => {
      const hero = heroOf(username);
      const opened = rpg.openAll(hero);
      if (typeof opened === "string") return error(opened);
      const spare = opened.cards.reduce((sum, card) => sum + card.coins, 0);
      if (spare > 0) await coins.add(username, spare, { reason: "rpg spare cards" });
      socket.emit("rpgPack", { cards: opened.cards, spare, pack: "all", count: opened.count, left: 0 });
      sendHero(username);
    });

    // An unopened pack: its cards of the class played into the collection (spare copies sold)
    on("openPack", async (data) => {
      const hero = heroOf(username);
      const id = String(data.pack);
      const cards = rpg.openStored(hero, id);
      if (typeof cards === "string") return error(cards);
      const spare = cards.reduce((sum, card) => sum + card.coins, 0);
      if (spare > 0) await coins.add(username, spare, { reason: "rpg spare cards" });
      socket.emit("rpgPack", { cards, spare, pack: id, left: rpg.packsOf(hero)[id] || 0 });
      sendHero(username);
    });

    // A talent of the class (one of two, per tier) - the first pick free, a change (swap) for coins
    on("talent", async (data) => {
      if (inRun()) return error("Not during a run.");
      const hero = heroOf(username);
      const tier = Number(data.tier);
      const id = String(data.id);
      const swap = data.swap === true;
      const problem = rpg.pickTalent(hero, tier, id, { swap, check: true });
      if (problem) return error(problem);
      if (swap) {
        const price = rpg.talentSwapPrice(hero);
        if (price > 0 && !(await coins.spend(username, price, { reason: "rpg talent", note: id }))) return error(coins.refusal(username) || "You don't have enough coins.");
      }
      rpg.pickTalent(hero, tier, id, { swap });
      sendHero(username);
    });

    // Another character: a class unlocked already
    on("class", (data) => {
      if (!rpg.CLASS_IDS.includes(data.id)) return;
      if (inRun() || myParty()) return error("Not in a party.");
      const hero = heroOf(username);
      if (!hero.unlocked.includes(data.id)) return error("Unlock that class first.");
      hero.cls = data.id;
      sendHero(username);
    });

    // A class unlocked: the first one free, every other for CLASS_PRICE
    on("unlock", async (data) => {
      if (!rpg.CLASS_IDS.includes(data.id)) return;
      if (inRun() || myParty()) return error("Not in a party.");
      const hero = heroOf(username);
      if (hero.unlocked.includes(data.id)) return;
      const price = rpg.classPrice(hero);
      if (price > 0 && !(await coins.spend(username, price, { reason: "rpg class", note: data.id }))) return error(coins.refusal(username) || "You don't have enough coins.");
      rpg.unlock(hero, data.id);
      sendHero(username);
    });

    // Dead (the party went down): back right away for coins - dearer with every revive of the day
    // The practice run: free, alone - or skipped
    on("tutorial", async () => {
      if (myParty()) return error("You are in a party already.");
      const hero = heroOf(username);
      if (!hero.cls) return error("Pick a class first.");
      if (rpg.deckReady(hero)) return error(rpg.deckReady(hero));
      const party = { id: "p" + ++partyCount, leader: username, floor: 1, size: 1, members: [], run: null, endsAt: null, timer: null, result: null, tutorial: true };
      parties.set(party.id, party);
      join(party, username);
      await start(party);
    });

    on("skipTutorial", () => {
      const hero = heroOf(username);
      if (!hero.cls) return;
      rpg.charOf(hero).tutorialDone = true;
      sendHero(username);
    });

    on("revive", async () => {
      if (inRun()) return error("Not during a run.");
      const hero = heroOf(username);
      if (!rpg.deadFor(hero)) return error("Your character isn't dead.");
      const price = rpg.revivePrice(hero);
      if (price > 0 && !(await coins.spend(username, price, { reason: "rpg revive" }))) return error(coins.refusal(username) || "You don't have enough coins.");
      rpg.revive(hero);
      sendHero(username);
    });

    // One more slot in the bag (up to BAG_TOP) - dearer every time
    on("bagSlot", async () => {
      if (inRun()) return error("Not during a run.");
      const hero = heroOf(username);
      const price = rpg.bagSlotPrice(hero);
      if (price == null) return error("Bag is at max size.");
      if (!(await coins.spend(username, price, { reason: "rpg bag slot" }))) return error(coins.refusal(username) || "You don't have enough coins.");
      hero.bagSlots = (hero.bagSlots || 0) + 1;
      sendHero(username);
    });

    // One more deck slot (up to DECKS_TOP) - dearer every time
    on("deckSlot", async () => {
      if (inRun()) return error("Not during a run.");
      const hero = heroOf(username);
      const price = rpg.deckSlotPrice(hero);
      if (price == null) return error("Deck slots are at max.");
      if (!(await coins.spend(username, price, { reason: "rpg deck slot" }))) return error(coins.refusal(username) || "You don't have enough coins.");
      hero.deckSlots = (hero.deckSlots || 0) + 1;
      sendHero(username);
    });

    // Another deck of the slots played: {slot}
    on("deckUse", (data) => {
      if (inRun() || myParty()) return error("Not in a party.");
      const problem = rpg.useDeck(heroOf(username), Number(data.slot));
      if (problem) return error(problem);
      sendHero(username);
    });

    // One more potion slot (up to POTIONS_TOP) - dearer every time
    on("potionSlot", async () => {
      if (inRun()) return error("Not during a run.");
      const hero = heroOf(username);
      const price = rpg.potionSlotPrice(hero);
      if (price == null) return error("Potion slots are at max.");
      if (!(await coins.spend(username, price, { reason: "rpg potion slot" }))) return error(coins.refusal(username) || "You don't have enough coins.");
      hero.potionSlots = (hero.potionSlots || 0) + 1;
      sendHero(username);
    });

    on("potion", async () => {
      if (inRun()) return error("Not during a run.");
      const hero = heroOf(username);
      if (hero.potions >= rpg.potionsMax(hero)) return error(`At most ${rpg.potionsMax(hero)} potions.`);
      if (!(await coins.spend(username, rpg.potionPrice(rpg.maxFloor(hero)), { reason: "rpg potion" }))) return error(coins.refusal(username) || "You don't have enough coins.");
      hero.potions++;
      sendHero(username);
    });

    // The auto refill of the potions after every run: on / off (on: filled up right away)
    on("autoPotions", async (data) => {
      const hero = heroOf(username);
      hero.autoPotions = !!(data && data.on);
      if (!inRun()) await refill(username);
      sendHero(username);
    });

    on("equip", (data) => {
      if (inRun()) return error("Not during a run.");
      const hero = heroOf(username);
      const index = hero.bag.findIndex((item) => item.id === data.id);
      if (index < 0) return;
      const wrong = rpg.canWear(hero.bag[index], hero.cls);
      if (wrong) return error(wrong);
      const gear = rpg.charOf(hero).gear;
      const [item] = hero.bag.splice(index, 1);
      if (gear[item.slot]) hero.bag.push(gear[item.slot]);
      gear[item.slot] = item;
      sendHero(username);
    });

    on("unequip", (data) => {
      if (inRun()) return error("Not during a run.");
      const hero = heroOf(username);
      const gear = rpg.charOf(hero).gear;
      const item = gear[data.slot];
      if (!item) return;
      if (hero.bag.length >= rpg.bagSize(hero)) return error("Your bag is full.");
      gear[data.slot] = null;
      hero.bag.push(item);
      sendHero(username);
    });

    on("sell", async (data) => {
      if (inRun()) return error("Not during a run.");
      const hero = heroOf(username);
      const index = hero.bag.findIndex((item) => item.id === data.id);
      if (index < 0) return;
      const [item] = hero.bag.splice(index, 1);
      await coins.add(username, item.value, { reason: "rpg sell", note: item.name });
      sendHero(username);
    });

    /* ---------- Dust: spare cards to dust, dust to cards ---------- */

    on("dust", (data) => {
      if (inRun()) return error("Not during a run.");
      if (!rpg.CLASS_IDS.includes(data.cls) || !rpg.CARDS[data.id]) return;
      const done = rpg.dustCard(heroOf(username), data.cls, data.id, Number.isInteger(data.n) ? data.n : 1, data.any === true);
      if (done.error) return error(done.error);
      sendHero(username);
    });

    on("dustAll", () => {
      if (inRun()) return error("Not during a run.");
      if (!rpg.dustAll(heroOf(username))) return error("No spare cards to dust.");
      sendHero(username);
    });

    // Cards sold for coins (spare copies - or, asked first, one a deck needs)
    on("sell", async (data) => {
      if (inRun()) return error("Not during a run.");
      if (!rpg.CLASS_IDS.includes(data.cls) || !rpg.CARDS[data.id]) return;
      const done = rpg.sellCard(heroOf(username), data.cls, data.id, Number.isInteger(data.n) ? data.n : 1, data.any === true);
      if (done.error) return error(done.error);
      if (done.coins > 0 && ours(username)) await coins.add(username, done.coins, { reason: "rpg card sale", note: rpg.CARDS[data.id].name });
      sendHero(username);
    });

    // Cards picked in craft mode, sold or dusted together
    const picked = (data) => (Array.isArray(data && data.cards) ? data.cards.slice(0, 500).map((one) => ({ cls: String(one && one.cls), id: String(one && one.id), n: Number(one && one.n), any: !!one && one.any === true })) : []);
    on("dustMany", (data) => {
      if (inRun()) return error("Not during a run.");
      const done = rpg.dustCards(heroOf(username), picked(data));
      if (done.error) return error(done.error);
      sendHero(username);
    });
    on("sellMany", async (data) => {
      if (inRun()) return error("Not during a run.");
      const list = picked(data);
      const done = rpg.sellCards(heroOf(username), list);
      if (done.error) return error(done.error);
      if (done.coins > 0 && ours(username)) await coins.add(username, done.coins, { reason: "rpg card sale", note: list.length + " cards" });
      sendHero(username);
    });

    on("sellAll", async () => {
      if (inRun()) return error("Not during a run.");
      const got = rpg.sellAll(heroOf(username));
      if (!got) return error("No spare cards to sell.");
      if (ours(username)) await coins.add(username, got, { reason: "rpg card sale", note: "spare cards" });
      sendHero(username);
    });

    on("craft", (data) => {
      if (inRun()) return error("Not during a run.");
      const problem = rpg.craftCard(heroOf(username), String(data.id));
      if (problem) return error(problem);
      sendHero(username);
    });

    // A deck slot named
    on("deckName", (data) => {
      const problem = rpg.nameDeck(heroOf(username), data.slot, data.name);
      if (problem) return error(problem);
      sendHero(username);
    });

    // Starting over: every thing of the dungeon gone, nothing sold for it - "RESET" typed, once in a while
    on("resetHero", (data) => {
      if (data.confirm !== "RESET") return;
      if (myParty()) return error("Leave your party first.");
      const done = rpg.resetHero(heroOf(username));
      if (done.error) return error(done.error);
      heroes.set(username, done.hero);
      for (const [id, offer] of trades)
        if (offer.from === username || offer.to === username) {
          trades.delete(id);
          sendTrades(offer.from === username ? offer.to : offer.from);
        }
      persist.changed("rpg");
      sendTrades(username);
      sendHero(username);
      socket.emit("rpgToast", "Your dungeon starts fresh.");
    });

    /* ---------- Trades ---------- */

    // The players to trade with: everyone with a character
    on("tradePlayers", () => {
      const list = [...heroes.entries()].filter(([name, hero]) => name !== username && hero.cls && ours(name)).map(([name, hero]) => ({ name, cls: hero.cls, level: rpg.charOf(hero).level }));
      socket.emit("rpgTradePlayers", list);
    });

    // What another player has to trade
    on("tradeLook", (data) => {
      const name = String(data.name || "");
      if (name === username || !heroes.has(name) || !heroOf(name).cls) return error("No such player.");
      socket.emit("rpgTradeLook", { name, cls: heroOf(name).cls, list: rpg.tradeList(heroOf(name)) });
    });

    on("tradeOffer", async (data) => {
      const to = String(data.to || "");
      const give = cleanSide(data.give);
      const take = cleanSide(data.take);
      const giveCoins = rpg.tradeCoins(data.giveCoins);
      const takeCoins = rpg.tradeCoins(data.takeCoins);
      if (!give || !take || giveCoins == null || takeCoins == null) return;
      if (to === username || !heroes.has(to) || !ours(to)) return error("No such player.");
      // (coins go along - never alone)
      if (!give.length && !take.length) return error(giveCoins || takeCoins ? "Add a card or a piece of gear. Coins alone can't be traded." : "Pick something to trade.");
      if (giveCoins && (await coins.get(username)).coins < giveCoins) return error("You don't have that many coins.");
      const mixed = rpg.tradeMixed(give, take);
      if (mixed) return error(mixed);
      if ([...trades.values()].filter((offer) => offer.from === username).length >= TRADES_OPEN) return error(`At most ${TRADES_OPEN} offers at once.`);
      const mine = rpg.tradeSide(heroOf(username), give);
      if (mine.error) return error(mine.error);
      const theirs = rpg.tradeSide(heroOf(to), take);
      if (theirs.error) return error(theirs.error);
      const unfair = rpg.tradeFair(mine.value + giveCoins, theirs.value + takeCoins, mine.top || theirs.top);
      if (unfair) return error(unfair);
      const id = "t" + ++tradeCount;
      trades.set(id, { id, from: username, to, give, take, giveCoins, takeCoins, at: Date.now() });
      sendTrades(username);
      sendTrades(to);
    });

    on("tradeAnswer", async (data) => {
      const offer = trades.get(String(data.id));
      if (!offer || offer.to !== username) return;
      if (!data.accept) {
        trades.delete(offer.id);
        sendTrades(offer.from);
        sendTrades(offer.to);
        return;
      }
      if (running(offer.from) || running(offer.to)) return error("Not while one of you is in a run.");
      // (the coins first: taken from who pays them - not there: the trade waits)
      const giveCoins = offer.giveCoins || 0;
      const takeCoins = offer.takeCoins || 0;
      if (takeCoins && !(await coins.spend(offer.to, takeCoins, { reason: "rpg trade", note: "to " + offer.from }))) return error("You don't have enough coins for this trade.");
      if (giveCoins && !(await coins.spend(offer.from, giveCoins, { reason: "rpg trade", note: "to " + offer.to }))) {
        if (takeCoins) await coins.add(offer.to, takeCoins, { reason: "rpg trade", note: "refund" });
        return error(offer.from + " doesn't have the coins for this trade any more.");
      }
      const problem = rpg.trade(heroOf(offer.from), heroOf(offer.to), offer.give, offer.take, { give: giveCoins, take: takeCoins });
      // (the trade failed: the coins back)
      if (problem) {
        if (takeCoins) await coins.add(offer.to, takeCoins, { reason: "rpg trade", note: "refund" });
        if (giveCoins) await coins.add(offer.from, giveCoins, { reason: "rpg trade", note: "refund" });
      } else {
        if (giveCoins) await coins.add(offer.to, giveCoins, { reason: "rpg trade", note: "from " + offer.from });
        if (takeCoins) await coins.add(offer.from, takeCoins, { reason: "rpg trade", note: "from " + offer.to });
      }
      // (a full bag: the offer stays - room made, it can be taken)
      if (problem && /bag is full/.test(problem)) return error(problem);
      trades.delete(offer.id);
      if (problem) error(problem);
      else {
        persist.changed("rpg");
        sendHero(offer.from);
        sendHero(offer.to);
        socketsOf(offer.from).forEach((one) => one.emit("rpgToast", `${offer.to} took your trade.`));
      }
      sendTrades(offer.from);
      sendTrades(offer.to);
    });

    on("tradeCancel", (data) => {
      const offer = trades.get(String(data.id));
      if (!offer || offer.from !== username) return;
      trades.delete(offer.id);
      sendTrades(offer.from);
      sendTrades(offer.to);
    });

    /* ---------- Parties ---------- */

    const cooling = (floor) => `Floor ${floor} on cooldown: ${Math.ceil(rpg.floorCooldown(heroOf(username), floor) / 60000)} min.`;

    on("create", async (data) => {
      const floor = Number(data.floor);
      const size = Number(data.size);
      if (myParty()) return error("You are in a party already.");
      if (!heroOf(username).cls) return error("Pick a class first.");
      if (rpg.deckReady(heroOf(username))) return error(rpg.deckReady(heroOf(username)));
      if (rpg.deadFor(heroOf(username))) return error("Your character is dead.");
      if (!Number.isInteger(floor) || floor < 1 || floor > rpg.maxFloor(heroOf(username))) return error("That floor isn't open for you yet.");
      if (rpg.floorCooldown(heroOf(username), floor)) return error(cooling(floor));
      if (!Number.isInteger(size) || size < 1 || size > rpg.PARTY_MAX) return;
      const party = { id: "p" + ++partyCount, leader: username, floor, size, members: [], run: null, endsAt: null, timer: null, result: null };
      parties.set(party.id, party);
      join(party, username);
      // Alone: right into the dungeon
      if (size === 1) {
        const broke = await start(party);
        if (broke) {
          close(party);
          return error(coins.refusal(username) || "You don't have enough coins.");
        }
        return;
      }
      emitParty(party);
      emitParties();
    });

    on("join", (data) => {
      const party = parties.get(data.id);
      if (myParty()) return error("You are in a party already.");
      if (!party || party.run || party.result) return error("That party is gone.");
      if (!heroOf(username).cls) return error("Pick a class first.");
      if (party.members.length >= party.size) return error("That party is full.");
      if (rpg.deckReady(heroOf(username))) return error(rpg.deckReady(heroOf(username)));
      if (rpg.deadFor(heroOf(username))) return error("Your character is dead.");
      if (party.floor > rpg.maxFloor(heroOf(username))) return error(`Floor ${party.floor} isn't open for you yet.`);
      if (rpg.floorCooldown(heroOf(username), party.floor)) return error(cooling(party.floor));
      if (rpg.levelGap(party.members.map((name) => rpg.charOf(heroOf(name)).level), rpg.charOf(heroOf(username)).level)) return error(`Party levels can be at most ${config.RPG_PARTY_GAP} apart.`);
      join(party, username);
      emitParty(party);
      emitParties();
    });

    // Out of the party - in the middle of a run: out of the run (nothing of the pot, no loot)
    on("leave", () => {
      const party = myParty();
      if (!party) return;
      if (party.run && !party.result) return abandonRun(party, username);
      leave(party, username);
      emitParties();
    });

    on("start", async () => {
      const party = myParty();
      if (!party || party.run) return;
      if (party.leader !== username) return error("Only the leader starts.");
      if (party.members.length < 2) return error("Wait for a second hero - or go alone.");
      // (the leader's own floor cooling down - a leader after the first one left)
      if (rpg.floorCooldown(heroOf(username), party.floor)) return error(cooling(party.floor));
      const dead = party.members.find((name) => rpg.deadFor(heroOf(name)));
      if (dead) return error(dead === username ? "Your character is dead." : `${dead}'s character is dead.`);
      const unready = party.members.find((name) => rpg.deckReady(heroOf(name)));
      if (unready) return error(`${unready}'s deck isn't ready: ${rpg.deckReady(heroOf(unready))}`);
      const broke = await start(party);
      if (broke) return error(`${broke} doesn't have enough coins for the entry.`);
    });

    /* ---------- The run ---------- */

    const myRun = () => {
      const party = myParty();
      return party && party.run && !party.result ? party : null;
    };

    // A card of the hand: {uid, target, ally}
    on("play", (data) => {
      const party = myRun();
      if (!party) return;
      const problem = rpg.play(party.run, username, { uid: String(data.uid), target: data.target != null ? String(data.target) : null, ally: data.ally != null ? String(data.ally) : null });
      if (problem) return error(problem);
      afterChange(party);
    });

    // The turn ended - every hero has: the monsters' turn
    on("endTurn", () => {
      const party = myRun();
      if (!party) return;
      if (rpg.endTurn(party.run, username)) return monstersAct(party);
      emitParty(party);
    });

    on("drink", () => {
      const party = myRun();
      if (!party) return;
      const problem = rpg.drink(party.run, username);
      if (problem) return error(problem);
      emitParty(party);
    });

    // The relic of the elite's guard ({id: null} - none)
    on("relic", (data) => {
      const party = myRun();
      if (!party) return;
      const problem = rpg.pickRelic(party.run, username, data.id != null ? String(data.id) : null);
      if (problem) return error(problem);
      emitParty(party);
    });

    // A choice in a room (the camp fire, the shrine, an encounter ...): {option, card} - card: an index of the deck
    // or a card offered
    on("choose", (data) => {
      const party = myRun();
      if (!party) return;
      const option = String(data.option);
      const card = typeof data.card === "number" ? data.card : data.card != null ? String(data.card) : null;
      const problem = rpg.choose(party.run, username, { option, card });
      if (problem) return error(problem);
      emitParty(party);
    });

    // The card reward after a fight ({card: null} - none)
    on("pick", (data) => {
      const party = myRun();
      if (!party) return;
      const card = data.card != null ? String(data.card) : null;
      const problem = rpg.pickReward(party.run, username, card);
      if (problem) return error(problem);
      emitParty(party);
    });

    // A mage in the party: the card reward drawn again
    on("reroll", () => {
      const party = myRun();
      if (!party) return;
      const problem = rpg.rerollReward(party.run, username);
      if (problem) return error(problem);
      emitParty(party);
    });

    // The merchant: {item: "potion", "remove:<index of the deck>", a card or a relic} - paid with the own coins
    on("buy", async (data) => {
      const party = myRun();
      if (!party) return;
      const item = String(data.item);
      const check = rpg.canBuy(party.run, username, item);
      if (check.error) return error(check.error);
      if (!(await coins.spend(username, check.price, { reason: "rpg merchant", note: item }))) return error(coins.refusal(username) || "You don't have enough coins.");
      // (the run may have gone on meanwhile)
      if (rpg.canBuy(party.run, username, item).error) {
        await coins.add(username, check.price, { reason: "rpg refund" });
        return error("Too late.");
      }
      const got = rpg.bought(party.run, username, item);
      // (a card bought: the player's for good - into the collection now, whatever becomes of the run)
      if (got && got.card) {
        const hero = heroOf(username);
        const one = party.run.heroes.find((h) => h.name == username);
        rpg.collect(rpg.charOf(hero, rpg.cardClass(got.card) || one.cls), got.card);
        sendHero(username);
      }
      emitParty(party);
    });

    // A page got an update of another run than its own (dropped it): logged - what sent it
    on("stray", (data) => {
      const mine = myParty();
      console.warn(`[rpg] stray update for ${username}: showing ${JSON.stringify(data)} - the server has party ${mine ? mine.id : "none"} run ${mine && mine.run ? mine.run.uid : "none"}; parties with ${username}: ${[...parties.values()].filter((p) => p.members.includes(username)).map((p) => p.id + "/" + (p.run ? p.run.uid + ":" + p.run.phase : "lobby") + (p.result ? "/" + p.result : "")).join(", ")}`);
    });

    // A vote between two rooms: {door: its index} or {door: "leave"} - everybody voted: counted
    on("vote", async (data) => {
      const party = myRun();
      // (a click that came late - the room went on already: nothing to say)
      if (!party || party.run.phase !== "between") return;
      const choice = data.door === "leave" ? "leave" : Number(data.door);
      const problem = rpg.vote(party.run, username, choice);
      if (problem) return error(problem);
      if (rpg.allVoted(party.run)) return decide(party);
      emitParty(party);
    });

    socket.on(
      "sendChatMessage",
      safe("sendChatMessage", (data) => casinoChat.fromUser(socket, data)),
    );

    // Gone (no tab left): out of a party that hasn't started - in a run: away (see away())
    socket.on("disconnect", () => {
      if (socketsOf(username).length) return;
      const party = myParty();
      if (party && !party.run) {
        leave(party, username);
        emitParties();
      } else if (party && !party.result) away(party, username, true);
    });
  });

  // Saved (the normal casino): the characters, the parties with their runs, the trade offers - after a restart a run
  // goes on where it was (its heroes away until their pages are back; in a party: a while to come back)
  const RESTORE_GRACE = 10 * 60000;
  persist.register(
    "rpg",
    () => ({
      heroes,
      parties: [...parties.values()].filter((party) => !party.result).map(({ timer, away, clock, endsAt, ...party }) => party),
      trades: [...trades.values()],
    }),
    (saved) => {
      heroes.clear();
      for (const party of parties.values()) clearTimeout(party.timer);
      parties.clear();
      partyOf.clear();
      trades.clear();
      for (const [name, hero] of saved.heroes || []) heroes.set(name, hero);
      // (saved before the runs were kept: a run cut by the restart - its entry and potions back)
      for (const run of saved.cut || []) {
        for (const one of run.heroes) {
          if (heroes.has(one.name)) heroOf(one.name).potions = Math.min(rpg.potionsMax(heroOf(one.name)), heroOf(one.name).potions + one.potions);
          if (run.entry > 0) coins.add(one.name, run.entry, { reason: "rpg refund", note: "server restart" }).catch(() => {});
        }
      }
      for (const party of saved.parties || []) {
        Object.assign(party, { timer: null, away: {}, clock: null, endsAt: null });
        parties.set(party.id, party);
        for (const name of party.members) partyOf.set(name, party.id);
        partyCount = Math.max(partyCount, Number(String(party.id).slice(1)) || 0);
        if (!party.run) continue;
        for (const one of party.run.heroes) {
          rpg.setAway(party.run, one.name, true);
          if (party.run.heroes.length > 1) party.away[one.name] = setTimeout(() => abandonRun(party, one.name), RESTORE_GRACE);
        }
      }
      for (const offer of saved.trades || []) {
        trades.set(offer.id, offer);
        tradeCount = Math.max(tradeCount, Number(String(offer.id).slice(1)) || 0);
      }
    },
  );

  // Packs from the admin: {pack id: count} for a character of the player (its class) -> an error or null
  function givePacks(name, cls, packs) {
    if (!heroes.has(name)) return "This player has no character yet.";
    const hero = heroOf(name);
    if (!hero.unlocked.includes(cls)) return "This player has no such character.";
    const items = Object.entries(packs || {}).filter(([id, n]) => rpg.PACKS[id] && Number.isInteger(n) && n > 0);
    if (!items.length || items.some(([, n]) => n > 100)) return "Pick 1 to 100 packs.";
    rpg.addPacks(hero, items, cls);
    sendHero(name);
    const what = items.map(([id, n]) => n + " " + rpg.PACKS[id].name + (n > 1 ? "s" : "")).join(", ");
    socketsOf(name).forEach((socket) => socket.emit("rpgToast", `🎁 You got ${what} for your ${rpg.CLASSES[cls].name}.`));
    return null;
  }

  // A player's characters for the admin: [{id, name, icon, level, deepest}]
  function charactersOf(name) {
    if (!heroes.has(name)) return [];
    const hero = heroOf(name);
    return hero.unlocked.map((id) => ({ id, name: rpg.CLASSES[id].name, icon: rpg.CLASSES[id].icon, level: rpg.charOf(hero, id).level, deepest: rpg.charOf(hero, id).deepest || 0 }));
  }

  // The admin sets a character's deepest cleared floor (a bug, a reset to an earlier floor): the next one opens, the
  // deeper ones close; clear: the floors' cooldowns and today's runs gone too -> an error or null
  // (the floor set and every deeper one start over: their cooldowns and today's runs gone - the floors above stay as they are)
  function setFloor(name, cls, deepest) {
    if (!heroes.has(name)) return "This player has no character yet.";
    const hero = heroOf(name);
    if (!hero.unlocked.includes(cls)) return "This player has no such character.";
    if (!Number.isInteger(deepest) || deepest < 0 || deepest > rpg.FLOORS) return `Pick a floor from 0 to ${rpg.FLOORS}.`;
    const party = parties.get(partyOf.get(name));
    if (party && party.run && !party.result) return "This player is in a run right now. Try again after it.";
    const char = rpg.charOf(hero, cls);
    char.deepest = deepest;
    const from = Math.max(1, deepest);
    for (let floor = from; floor <= rpg.FLOORS; floor++) {
      if (char.cooldowns) delete char.cooldowns[floor];
      if (char.floorRuns && char.floorRuns.floors) delete char.floorRuns.floors[floor];
    }
    sendHero(name);
    persist.changed("rpg");
    socketsOf(name).forEach((socket) => socket.emit("rpgToast", deepest ? `🏰 Your ${rpg.CLASSES[cls].name}'s deepest floor is now ${deepest}.` : `🏰 Your ${rpg.CLASSES[cls].name} starts again from floor 1.`));
    return null;
  }

  return {
    heroes,
    parties,
    trades,
    givePacks,
    charactersOf,
    setFloor,
    runStats,
    finish,
    timing,
    heroOf,
    stop: () => parties.forEach((party) => [party.timer, ...Object.values(party.away || {})].forEach(clearTimeout)),
  };
};
