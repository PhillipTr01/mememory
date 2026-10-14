const rpg = require("../game/rpg");
const socketAuth = require("./socket_auth");
const safe = require("./safe_handler");
const version = require("../game/version");
const testMode = require("../game/test_mode");
const worlds = require("../game/worlds");

const ROOM = "rpg";

/*
 * The dungeon (game/rpg.js) - for now only in the admin's test world (/test/rpg): like everything there,
 * nothing of it is saved (the heroes live as long as the test mode).
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
  const world = options.world || worlds.TEST;
  const { coins, casinoChat } = worlds.services(world);
  const room = io.of(world + "/rpg");
  room.use(socketAuth.casino);
  casinoChat.attach(room, ROOM);

  // How long a turn / a decision between two rooms may take (ms) - the tests make them short
  // (a room to choose in or a merchant: longer)
  const timing = { turn: 45000, decide: 45000, room: 90000, close: 60000 };

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
    const view = rpg.heroView(heroOf(name));
    socketsOf(name).forEach((socket) => socket.emit("rpgHero", view));
  }

  function partyView(party) {
    return {
      id: party.id,
      leader: party.leader,
      floor: party.floor,
      size: party.size,
      entry: rpg.entryCost(party.floor),
      members: party.members,
      started: party.run != null,
      result: party.result || null,
      summary: party.summary || null,
      timeLeft: party.endsAt ? Math.max(0, party.endsAt - Date.now()) : null,
      run: party.run ? rpg.runView(party.run) : null,
    };
  }

  function emitParties() {
    const list = [...parties.values()].filter((party) => !party.result).map((party) => ({ id: party.id, leader: party.leader, floor: party.floor, size: party.size, members: party.members, started: party.run != null }));
    room.to(ROOM).emit("rpgParties", list);
  }

  function emitParty(party) {
    room.to("party:" + party.id).emit("rpgParty", partyView(party));
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
      entries: Array.from({ length: rpg.FLOORS }, (_, i) => rpg.entryCost(i + 1)),
      partyMax: rpg.PARTY_MAX,
      bagMax: rpg.BAG_MAX,
      potionsMax: rpg.POTIONS_MAX,
      potionPrice: rpg.POTION_PRICE,
      stats: rpg.STATS,
      levelMax: rpg.LEVEL_MAX,
      classes: rpg.CLASSES,
      classPrice: rpg.CLASS_PRICE,
      cardRarities: rpg.CARD_RARITIES,
      heroLevelMax: rpg.HERO_LEVEL_MAX,
      partyLoot: rpg.PARTY_LOOT,
      deckMin: rpg.DECK_MIN,
      deckMax: rpg.DECK_MAX,
      deckLeast: rpg.DECK_LEAST,
      lanes: rpg.LANES,
      packPrice: rpg.PACK_PRICE,
      packSize: rpg.PACK_SIZE,
      packs: rpg.PACKS,
      packBundle: rpg.PACK_BUNDLE,
      bundleOff: rpg.BUNDLE_OFF,
      cartMax: rpg.CART_MAX,
      mainBonus: rpg.MAIN_BONUS,
      moves: rpg.MOVES,
      roomKinds: rpg.ROOM_KINDS,
      energy: rpg.ENERGY,
      turn: timing.turn,
      decide: timing.decide,
      cards: rpg.CARDS,
      talents: rpg.TALENTS,
      talentLevels: rpg.TALENT_LEVELS,
      relics: rpg.RELICS,
      affixes: rpg.AFFIXES,
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
    partyOf.delete(name);
    socketsOf(name).forEach((socket) => {
      socket.leave("party:" + party.id);
      socket.emit("rpgParty", null);
    });
    if (!party.members.length) return close(party);
    if (party.leader === name) party.leader = party.members[0];
    emitParty(party);
  }

  function close(party) {
    clearTimeout(party.timer);
    parties.delete(party.id);
    for (const name of party.members) {
      partyOf.delete(name);
      socketsOf(name).forEach((socket) => {
        socket.leave("party:" + party.id);
        socket.emit("rpgParty", null);
      });
    }
  }

  // The clock of a run - started anew only when the turn or the room changes (a card played doesn't): the heroes'
  // turn of a fight (the time up: the monsters' turn), the vote between two rooms (the time up: the votes so far)
  function schedule(party) {
    const run = party.run;
    const key = run ? run.phase + ":" + run.rooms.length + ":" + run.turn : null;
    if (key === party.clock) return;
    party.clock = key;
    clearTimeout(party.timer);
    party.endsAt = null;
    if (!run) return;
    if (run.phase === "fight") {
      party.endsAt = Date.now() + timing.turn;
      party.timer = setTimeout(() => monstersAct(party), timing.turn);
    } else if (run.phase === "between") {
      const time = run.event ? timing.room : timing.decide;
      party.endsAt = Date.now() + time;
      party.timer = setTimeout(() => decide(party).catch((error) => console.error("[rpg] Could not go on:", error)), time);
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
    const choice = rpg.tally(party.run, party.leader);
    if (choice === "leave") return finish(party, "left");
    rpg.enterRoom(party.run, choice);
    afterChange(party);
  }

  // After every change of a run: over - paid; otherwise the clock again
  function afterChange(party) {
    const phase = party.run.phase;
    if (phase === "won" || phase === "lost") return finish(party, phase).catch((error) => console.error("[rpg] Could not end a run:", error));
    schedule(party);
    emitParty(party);
  }

  async function start(party) {
    const entry = rpg.entryCost(party.floor);
    const paid = [];
    for (const name of party.members) {
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
    );
    for (const name of party.members) {
      const hero = heroOf(name);
      rpg.charOf(hero).runs++;
      // (the potions go along - what is left comes back)
      hero.potions = 0;
    }
    rpg.enterRoom(party.run, 0);
    afterChange(party);
    emitParties();
    return null;
  }

  // The end of a run: the pot to every hero, the loot to the bags (not when lost), the potions left back
  async function finish(party, result) {
    if (party.result) return;
    clearTimeout(party.timer);
    party.endsAt = null;
    const run = party.run;
    party.result = result;
    party.summary = {};
    if (result === "left") run.phase = "left";
    for (const one of run.heroes) {
      if (!heroes.has(one.name)) continue;
      const hero = heroOf(one.name);
      hero.potions = Math.min(rpg.POTIONS_MAX, hero.potions + one.potions);
      // (the floor counts for the character that went down - its class)
      const char = rpg.charOf(hero, one.cls);
      // XP for the character (lost: half of it) - a floor cleared the first time: a bonus (coins, XP)
      const firstClear = result === "won" && run.floor > char.deepest;
      // (the first clear: half the entry more - a bigger party more)
      const bonus = firstClear ? Math.round((rpg.entryCost(run.floor) * rpg.FIRST_CLEAR * rpg.partyBonus(run.heroes.length)) / 100) * 100 : 0;
      const xp = Math.round((result === "lost" ? one.xp / 2 : one.xp) + (firstClear ? rpg.xpFor("floor", run.floor) * 2 : 0));
      const ups = rpg.gainXp(char, xp);
      party.summary[one.name] = { xp, ups, level: char.level, firstClear: bonus };
      if (bonus && ours(one.name)) await coins.add(one.name, bonus, { reason: "rpg first clear", note: "floor " + run.floor });
      if (result === "won") {
        char.deepest = Math.max(char.deepest, run.floor);
        char.cleared++;
      }
      if (result !== "lost") {
        for (const item of run.loot[one.name] || []) {
          if (hero.bag.length < rpg.BAG_MAX) hero.bag.push(item);
          // (the bag full: sold right away)
          else if (ours(one.name)) await coins.add(one.name, item.value, { reason: "rpg sell", note: item.name });
        }
      }
      if (run.pot > 0 && ours(one.name)) await coins.add(one.name, run.pot, { reason: "rpg loot", note: "floor " + run.floor + " - " + result });
      sendHero(one.name);
    }
    emitParty(party);
    emitParties();
    // (the end stays on the pages for a while - then the party is gone)
    party.timer = setTimeout(() => close(party), timing.close);
  }

  // The test mode stopped: the hero is gone (nothing of the test world stays)
  testMode.changes.on("change", (name) => {
    if (testMode.active(name)) return;
    const party = parties.get(partyOf.get(name));
    if (party && !party.run) leave(party, name);
    else if (party) partyOf.delete(name);
    heroes.delete(name);
  });

  room.on("connection", (socket) => {
    version.announce(socket);
    const username = socket.data.username;
    socket.join(ROOM);
    socket.emit("joined", { username: username });
    socket.emit("rpgRules", rules());
    socket.emit("rpgHero", rpg.heroView(heroOf(username)));
    casinoChat.join(socket);
    const mine = parties.get(partyOf.get(username));
    if (mine) {
      socket.join("party:" + mine.id);
      socket.emit("rpgParty", partyView(mine));
    }
    emitParties();
    sendCoins(username).catch((error) => console.error("[rpg] Could not load coins:", error));
    const error = (message) => socket.emit("rpgError", message);
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
      const cost = rpg.upgradeCost(level);
      if (cost == null) return error("That one is at its highest level.");
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
      if (rpg.upgradeCost(char.levels[data.stat] || 0) == null) return error("That one is at its highest level.");
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

    // The shop's cart: {cart: {pack id: count}} - paid at once (10% off for 3 or more of a kind), the packs wait
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
      socket.emit("rpgPack", { cards, spare, pack: id, left: hero.packs[id] || 0 });
      sendHero(username);
    });

    // A talent of the class (one of two, per tier)
    on("talent", (data) => {
      if (inRun()) return error("Not during a run.");
      const problem = rpg.pickTalent(heroOf(username), Number(data.tier), String(data.id));
      if (problem) return error(problem);
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

    on("potion", async () => {
      if (inRun()) return error("Not during a run.");
      const hero = heroOf(username);
      if (hero.potions >= rpg.POTIONS_MAX) return error(`At most ${rpg.POTIONS_MAX} potions.`);
      if (!(await coins.spend(username, rpg.potionPrice(rpg.maxFloor(hero)), { reason: "rpg potion" }))) return error(coins.refusal(username) || "You don't have enough coins.");
      hero.potions++;
      sendHero(username);
    });

    on("equip", (data) => {
      if (inRun()) return error("Not during a run.");
      const hero = heroOf(username);
      const index = hero.bag.findIndex((item) => item.id === data.id);
      if (index < 0) return;
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
      if (hero.bag.length >= rpg.BAG_MAX) return error("Your bag is full.");
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

    /* ---------- Parties ---------- */

    on("create", async (data) => {
      const floor = Number(data.floor);
      const size = Number(data.size);
      if (myParty()) return error("You are in a party already.");
      if (!heroOf(username).cls) return error("Pick a class first.");
      if (rpg.deckReady(heroOf(username))) return error(rpg.deckReady(heroOf(username)));
      if (!Number.isInteger(floor) || floor < 1 || floor > rpg.maxFloor(heroOf(username))) return error("That floor isn't open for you yet.");
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
      if (party.floor > rpg.maxFloor(heroOf(username))) return error(`Floor ${party.floor} isn't open for you yet.`);
      join(party, username);
      emitParty(party);
      emitParties();
    });

    on("leave", () => {
      const party = myParty();
      if (!party) return;
      if (party.run && !party.result) return error("Not in the middle of a run.");
      leave(party, username);
      emitParties();
    });

    on("start", async () => {
      const party = myParty();
      if (!party || party.run) return;
      if (party.leader !== username) return error("Only the leader starts.");
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
        return error("Too late - the party went on.");
      }
      rpg.bought(party.run, username, item);
      emitParty(party);
    });

    // A vote between two rooms: {door: its index} or {door: "leave"} - everybody voted: counted
    on("vote", async (data) => {
      const party = myRun();
      if (!party) return;
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

    // Gone (no tab left) from a party that hasn't started: out of it
    socket.on("disconnect", () => {
      if (socketsOf(username).length) return;
      const party = myParty();
      if (party && !party.run) {
        leave(party, username);
        emitParties();
      }
    });
  });

  return {
    heroes,
    parties,
    timing,
    heroOf,
    stop: () => parties.forEach((party) => clearTimeout(party.timer)),
  };
};
