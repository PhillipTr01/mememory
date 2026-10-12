const crypto = require('crypto');
const bcrypt = require('bcrypt');

const User = require('../models/User');
const { httpError } = require('../utils/errors');
const { isNonEmptyString, isStrongPassword } = require('../utils/validation');

/*
 * Password reset links: a player lost their password, the admin makes a link in the admin panel (Players) and
 * gives it to them. The link holds a random token - only its hash is kept, so the database alone can't
 * open it. One link per player (a new one replaces the old), valid for LINK_HOURS, used once.
 */
const LINK_HOURS = 24;

const hashOf = (token) => crypto.createHash('sha256').update(token).digest('hex');

// The admin: a new link for a player -> {username, path, until} (null: no such player)
async function createLink(username) {
    if (!isNonEmptyString(username)) return null;
    const user = await User.findOne({username: username.trim()}).select('username').lean();
    if (user == null) return null;
    const token = crypto.randomBytes(32).toString('base64url');
    const until = new Date(Date.now() + LINK_HOURS * 3600 * 1000);
    await User.updateOne({username: user.username}, {$set: {resetTokenHash: hashOf(token), resetTokenUntil: until}});
    return {username: user.username, path: '/reset-password?token=' + token, until: until};
}

// The player of a token that still works (null: wrong, used or too old)
async function userOf(token) {
    if (!isNonEmptyString(token) || token.length > 100) return null;
    const user = await User.findOne({resetTokenHash: hashOf(token)}).select('username resetTokenUntil').lean();
    if (user == null || !user.resetTokenUntil || new Date(user.resetTokenUntil).getTime() < Date.now()) return null;
    return user;
}

// The page asks: does the link still work -> {username}
async function check(token) {
    const user = await userOf(token);
    if (user == null) throw httpError(410, 'reset: This link doesn\'t work anymore.');
    return {username: user.username};
}

// The new password: {token, password, repeatPassword}
async function reset(body) {
    body = body || {};
    const user = await userOf(body.token);
    if (user == null) throw httpError(410, 'reset: This link doesn\'t work anymore.');
    if (!isStrongPassword(body.password)) throw httpError(400, 'password: Path `password` is too weak.');
    if (body.password !== body.repeatPassword) throw httpError(400, 'password: Path `password` is not matching with `repeatPassword`.');
    const hash = await bcrypt.hash(body.password, 10);
    // (only once: the token goes with the change)
    const done = await User.updateOne({username: user.username, resetTokenHash: hashOf(body.token)}, {$set: {password: hash}, $unset: {resetTokenHash: 1, resetTokenUntil: 1}});
    if (done && (done.matchedCount != null ? done.matchedCount : done.n) === 0) throw httpError(410, 'reset: This link doesn\'t work anymore.');
    return {username: user.username};
}

module.exports = { createLink, check, reset, LINK_HOURS };
