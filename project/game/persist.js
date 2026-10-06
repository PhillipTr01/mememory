const Setting = require("../models/Setting");

/*
 * The games survive a restart of the server: every game registers a snapshot
 * of its state (history, the running round, the chat ...) and a restore. A
 * change is saved shortly after (a burst of changes: one save), everything is
 * saved when the server stops, and loaded again when it starts.
 *
 * Nothing is saved before the saved state was loaded - otherwise an empty
 * game that just started would overwrite it.
 */
const games = new Map(); // key -> {snapshot, restore}
const timers = new Map(); // key -> pending save
const lastSaved = new Map(); // key -> the text saved last (unchanged: no write)
let ready = false;
let restored = null; // the server waits for the saved state (see expectRestore)
let markRestored = () => {};
const SAVE_AFTER = 100; // ms

// Timers (and other things that can't be saved) are left out; Maps become lists
function toJSON(value) {
  return JSON.stringify(value, (key, item) => {
    if (/timers?$|timeouts$|^interval$/i.test(key)) return undefined;
    if (item instanceof Map) return { __map: [...item.entries()] };
    if (item instanceof Set) return { __set: [...item] };
    return item;
  });
}

function fromJSON(text) {
  return JSON.parse(text, (key, item) => {
    if (item && typeof item === "object" && Array.isArray(item.__map)) return new Map(item.__map);
    if (item && typeof item === "object" && Array.isArray(item.__set)) return new Set(item.__set);
    return item;
  });
}

// `fresh` (optional): starts the game anew from its first state (hard reset in
// the admin panel) - without it the first state is simply restored
function register(key, snapshot, restore, fresh) {
  games.set(key, { snapshot: snapshot, restore: restore, fresh: fresh, initial: toJSON(snapshot()) });
}

// Hard reset: every game as on its very first start (and saved like that)
async function resetAll() {
  for (const [key, game] of games) {
    const initial = fromJSON(game.initial);
    if (game.fresh) game.fresh(initial);
    else game.restore(initial);
    await save(key).catch((error) => console.error(`[persist] Could not save ${key}:`, error));
  }
}

// Something changed: saved soon
function changed(key) {
  if (!ready || timers.has(key)) return;
  const timer = setTimeout(() => {
    timers.delete(key);
    save(key).catch((error) => console.error(`[persist] Could not save ${key}:`, error));
  }, SAVE_AFTER);
  timer.unref();
  timers.set(key, timer);
}

async function save(key) {
  const game = games.get(key);
  if (game == null) return;
  const text = toJSON(game.snapshot());
  if (lastSaved.get(key) === text) return;
  await Setting.updateOne({ key: "game:" + key }, { $set: { value: text } }, { upsert: true });
  lastSaved.set(key, text);
}

// The server stops: everything right now
async function saveAll() {
  if (!ready) return;
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  await Promise.all([...games.keys()].map((key) => save(key).catch((error) => console.error(`[persist] Could not save ${key}:`, error))));
}

// The server starts: every game gets its saved state back (once)
async function restoreAll() {
  for (const [key, game] of games) {
    try {
      const row = await Setting.findOne({ key: "game:" + key }).lean();
      if (row && typeof row.value === "string") game.restore(fromJSON(row.value));
    } catch (error) {
      console.error(`[persist] Could not restore ${key}:`, error);
    }
  }
  ready = true;
  markRestored();
}

/*
 * The server will load the saved state: until then nobody gets into a game
 * (a page that reconnects after a restart would not find its game yet)
 */
function expectRestore() {
  restored = new Promise((resolve) => (markRestored = resolve));
}

function whenRestored() {
  return restored || Promise.resolve();
}

// Tests: start again without anything saved or loaded
function reset() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  lastSaved.clear();
  ready = false;
  restored = null;
}

module.exports = { register, changed, saveAll, restoreAll, resetAll, expectRestore, whenRestored, reset, toJSON, fromJSON };
