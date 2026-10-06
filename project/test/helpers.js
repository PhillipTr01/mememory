/*
 * Test helpers: the database models are replaced by in-memory stubs, so the
 * tests run without a MongoDB instance.
 */
process.env.SECRET_KEY = process.env.SECRET_KEY || "test-secret";

const http = require("http");
const jwt = require("jsonwebtoken");
const socketio = require("socket.io");
const { io: connect } = require("socket.io-client");

const User = require("../models/User");
const Statistic = require("../models/Statistic");
const Meme = require("../models/Meme");
const CoinLog = require("../models/CoinLog");
const Withdrawal = require("../models/Withdrawal");
const Setting = require("../models/Setting");

const users = new Map(); // _id -> {_id, username, statistics}
const increments = []; // [{username, field}]
let memeCount = 40;

function query(value) {
  return { select: () => query(value), lean: () => Promise.resolve(value), then: (res, rej) => Promise.resolve(value).then(res, rej) };
}

User.findOne = (filter) => {
  let user = null;
  if (filter._id) user = users.get(String(filter._id)) || null;
  if (filter.username) user = [...users.values()].find((u) => u.username === filter.username) || null;
  return query(user);
};

// Tiny version of MongoDB's filters / updates, enough for game/coins.js
function matches(doc, filter) {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === "$or") return condition.some((part) => matches(doc, part));
    const value = doc[key];
    if (condition !== null && typeof condition === "object" && !(condition instanceof Date)) {
      if ("$exists" in condition && (value !== undefined) !== condition.$exists) return false;
      if ("$in" in condition && !condition.$in.includes(value)) return false;
      if ("$ne" in condition && value === condition.$ne) return false;
      if ("$gte" in condition && !(value >= condition.$gte)) return false;
      if ("$lt" in condition && !(value < condition.$lt)) return false;
      if ("$lte" in condition && !(value <= condition.$lte)) return false;
      return true;
    }
    return value === condition;
  });
}

User.updateOne = async (filter, update) => {
  const user = [...users.values()].find((u) => matches(u, filter));
  if (user == null) return { n: 0, nModified: 0 };
  Object.assign(user, update.$set || {});
  for (const [key, amount] of Object.entries(update.$inc || {})) user[key] = (user[key] || 0) + amount;
  return { n: 1, nModified: 1 };
};

// find(): a tiny query with sort / limit / select / lean
function list(rows) {
  let result = rows.slice();
  const q = {
    sort(spec) {
      const [key, dir] = Object.entries(spec)[0];
      result.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * dir);
      return q;
    },
    limit(n) {
      result = result.slice(0, n);
      return q;
    },
    select: () => q,
    lean: () => Promise.resolve(result.map((row) => ({ ...row }))),
    then: (res, rej) => Promise.resolve(result).then(res, rej),
  };
  return q;
}

User.find = (filter = {}) => list([...users.values()].filter((u) => matches(u, filter)));

User.updateMany = async (filter, update) => {
  const rows = [...users.values()].filter((u) => matches(u, filter));
  rows.forEach((user) => {
    Object.assign(user, update.$set || {});
    for (const key of Object.keys(update.$unset || {})) delete user[key];
  });
  return { n: rows.length, nModified: rows.length };
};

// In-memory version of a model: create, find, findOne, updateOne, countDocuments
function memoryModel(Model) {
  const docs = [];
  let next = 1;
  Model.create = async (doc) => {
    const row = { _id: `doc${next++}`, ...doc };
    docs.push(row);
    return { ...row };
  };
  Model.find = (filter = {}) => list(docs.filter((d) => matches(d, filter)));
  Model.findOne = (filter = {}) => query(docs.find((d) => matches(d, filter)) || null);
  Model.countDocuments = async (filter = {}) => docs.filter((d) => matches(d, filter)).length;
  Model.deleteMany = async (filter = {}) => {
    const gone = docs.filter((d) => matches(d, filter));
    gone.forEach((d) => docs.splice(docs.indexOf(d), 1));
    return { deletedCount: gone.length };
  };
  Model.updateOne = async (filter, update, options) => {
    const doc = docs.find((d) => matches(d, filter));
    if (doc == null && options && options.upsert) {
      docs.push({ _id: `doc${next++}`, ...filter, ...(update.$set || {}) });
      return { n: 1, nModified: 0, upserted: 1 };
    }
    if (doc == null) return { n: 0, nModified: 0 };
    Object.assign(doc, update.$set || {});
    return { n: 1, nModified: 1 };
  };
  return docs;
}

const coinLogs = memoryModel(CoinLog);
const withdrawals = memoryModel(Withdrawal);
const settings = memoryModel(Setting);

function userByName(username) {
  return [...users.values()].find((u) => u.username === username);
}

Statistic.increment = async (username, field) => {
  increments.push({ username, field });
  return true;
};

Meme.aggregate = async () =>
  Array.from({ length: Math.min(memeCount, 33) }, (_, i) => ({ _id: `https://i.redd.it/meme${i}.png` }));

// options.approved: false - not let into the casino (yet)
function addUser(username, options) {
  const _id = `id_${username}`;
  const approved = !(options && options.approved === false);
  users.set(_id, { _id, username, statistics: `stat_${username}`, casinoApproved: approved, casinoApprovedAt: approved ? new Date(0) : undefined, payoutAllowed: approved });
  return jwt.sign({ _id }, process.env.SECRET_KEY);
}

async function startServer() {
  const server = http.createServer();
  const io = socketio(server);
  require("../sockets/lobby_server")(io);
  require("../sockets/singleplayer_server")(io);
  require("../sockets/multiplayer_server")(io);
  require("../sockets/tictactoe_server")(io);
  const jackpot = require("../sockets/jackpot_server")(io);
  const battles = require("../sockets/battles_server")(io);
  const poker = require("../sockets/poker_server")(io);
  const blackjack = require("../sockets/blackjack_server")(io);
  const slots = require("../sockets/slots_server")(io);
  require("../sockets/casino_server")(io);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  return {
    io,
    port,
    jackpot,
    battles,
    poker,
    blackjack,
    slots,
    client(namespace, token, query) {
      return connect(`http://localhost:${port}${namespace}`, {
        query: query || {},
        transports: ["websocket"],
        reconnection: false,
        forceNew: true,
        extraHeaders: token ? { cookie: `token=${token}` } : {},
      });
    },
    close: () => new Promise((resolve) => { io.close(); server.close(resolve); }),
  };
}

function once(socket, event, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for "${event}"`)), timeout);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = {
  addUser,
  startServer,
  once,
  wait,
  increments,
  coinLogs,
  withdrawals,
  settings,
  coinsOf: (username) => userByName(username).coins,
  userOf: userByName,
  // An account that already got its start coins
  setCoins: (username, amount) => { Object.assign(userByName(username), { coins: amount, coinReset: require("../game/config").COIN_RESET }); },
  setMemeCount: (count) => { memeCount = count; },
};
