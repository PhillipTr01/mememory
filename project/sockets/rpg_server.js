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
 * floor. In a fight everybody picks an action - when all have (or the turn's time is up: who didn't,
 * attacks) the turn is played. Between two rooms the leader goes on or leaves with the loot (the time up:
 * leaves). The end (cleared, left or all down): the pot is paid, the gear goes to the bags, the potions
 * left go back - lost: nothing but the potions drunk.
 */
module.exports = function (io, options = {}) {
  const world = options.world || worlds.TEST;
  const { coins, casinoChat } = worlds.services(world);
  const room = io.of(world + "/rpg");
  room.use(socketAuth.casino);
  casinoChat.attach(room, ROOM);

  // How long a turn / a decision between two rooms may take (ms) - the tests make them short
  const timing = { turn: 25000, decide: 60000, close: 60000 };

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
      skillCooldown: rpg.SKILL_COOLDOWN,
      turn: timing.turn,
      decide: timing.decide,
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

  // The clock of a run: a turn of a fight, the leader's decision between two rooms
  function schedule(party) {
    clearTimeout(party.timer);
    party.endsAt = null;
    const run = party.run;
    if (!run) return;
    if (run.phase === "fight") {
      party.endsAt = Date.now() + timing.turn;
      party.timer = setTimeout(() => playTurn(party), timing.turn);
    } else if (run.phase === "between") {
      party.endsAt = Date.now() + timing.decide;
      party.timer = setTimeout(() => finish(party, "left").catch((error) => console.error("[rpg] Could not end a run:", error)), timing.decide);
    }
  }

  function playTurn(party) {
    if (!party.run || party.run.phase !== "fight") return;
    rpg.resolveTurn(party.run);
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
      hero.runs++;
      // (the potions go along - what is left comes back)
      hero.potions = 0;
    }
    rpg.enterRoom(party.run);
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
    if (result === "left") run.phase = "left";
    for (const one of run.heroes) {
      if (!heroes.has(one.name)) continue;
      const hero = heroOf(one.name);
      hero.potions = Math.min(rpg.POTIONS_MAX, hero.potions + one.potions);
      if (result === "won") {
        hero.deepest = Math.max(hero.deepest, run.floor);
        hero.cleared++;
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
      const cost = rpg.upgradeCost(hero.levels[data.stat]);
      if (cost == null) return error("That one is at its highest level.");
      if (!(await coins.spend(username, cost, { reason: "rpg upgrade", note: data.stat }))) return error(coins.refusal(username) || "You don't have enough coins.");
      hero.levels[data.stat]++;
      sendHero(username);
    });

    on("potion", async () => {
      if (inRun()) return error("Not during a run.");
      const hero = heroOf(username);
      if (hero.potions >= rpg.POTIONS_MAX) return error(`At most ${rpg.POTIONS_MAX} potions.`);
      if (!(await coins.spend(username, rpg.POTION_PRICE, { reason: "rpg potion" }))) return error(coins.refusal(username) || "You don't have enough coins.");
      hero.potions++;
      sendHero(username);
    });

    on("equip", (data) => {
      if (inRun()) return error("Not during a run.");
      const hero = heroOf(username);
      const index = hero.bag.findIndex((item) => item.id === data.id);
      if (index < 0) return;
      const [item] = hero.bag.splice(index, 1);
      if (hero.gear[item.slot]) hero.bag.push(hero.gear[item.slot]);
      hero.gear[item.slot] = item;
      sendHero(username);
    });

    on("unequip", (data) => {
      if (inRun()) return error("Not during a run.");
      const hero = heroOf(username);
      const item = hero.gear[data.slot];
      if (!item) return;
      if (hero.bag.length >= rpg.BAG_MAX) return error("Your bag is full.");
      hero.gear[data.slot] = null;
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
      if (party.members.length >= party.size) return error("That party is full.");
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
      const broke = await start(party);
      if (broke) return error(`${broke} doesn't have enough coins for the entry.`);
    });

    /* ---------- The run ---------- */

    on("act", (data) => {
      const party = myParty();
      if (!party || !party.run || party.result) return;
      const problem = rpg.choose(party.run, username, data);
      if (problem) return error(problem);
      if (rpg.allChosen(party.run)) return playTurn(party);
      emitParty(party);
    });

    on("next", () => {
      const party = myParty();
      if (!party || !party.run || party.result || party.run.phase !== "between") return;
      if (party.leader !== username) return error("The leader decides.");
      rpg.enterRoom(party.run);
      afterChange(party);
    });

    on("exit", async () => {
      const party = myParty();
      if (!party || !party.run || party.result || party.run.phase !== "between") return;
      if (party.leader !== username) return error("The leader decides.");
      await finish(party, "left");
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
