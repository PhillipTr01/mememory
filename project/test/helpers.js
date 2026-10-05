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

Statistic.increment = async (username, field) => {
  increments.push({ username, field });
  return true;
};

Meme.aggregate = async () =>
  Array.from({ length: Math.min(memeCount, 33) }, (_, i) => ({ _id: `https://i.redd.it/meme${i}.png` }));

function addUser(username) {
  const _id = `id_${username}`;
  users.set(_id, { _id, username, statistics: `stat_${username}` });
  return jwt.sign({ _id }, process.env.SECRET_KEY);
}

async function startServer() {
  const server = http.createServer();
  const io = socketio(server);
  require("../sockets/lobby_server")(io);
  require("../sockets/singleplayer_server")(io);
  require("../sockets/multiplayer_server")(io);
  require("../sockets/tictactoe_server")(io);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  return {
    io,
    port,
    client(namespace, token) {
      return connect(`http://localhost:${port}${namespace}`, {
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
  setMemeCount: (count) => { memeCount = count; },
};
