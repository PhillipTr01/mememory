const jwt = require("jsonwebtoken");
const User = require("../models/User");

function readCookie(header, name) {
  if (typeof header !== "string") return null;

  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch (error) {
        return null;
      }
    }
  }
  return null;
}

/*
 * Socket.io middleware: only logged in users may connect. The username is
 * taken from the database instead of trusting what the client sends, so
 * nobody can play (and change statistics) in the name of somebody else.
 */
module.exports = async function socketAuth(socket, next) {
  try {
    const token = readCookie(socket.handshake.headers.cookie, "token");
    const decode = jwt.verify(token, process.env.SECRET_KEY);
    const user = await User.findOne({ _id: decode._id }).select("username");

    if (user == null) {
      return next(new Error("unauthorized"));
    }

    socket.data.username = user.username;
    return next();
  } catch (error) {
    return next(new Error("unauthorized"));
  }
};
