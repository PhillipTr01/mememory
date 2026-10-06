const bcrypt = require('bcrypt');

const Statistic = require('../models/Statistic');
const User = require('../models/User');
const { httpError } = require('../utils/errors');
const { isNonEmptyString, isStrongPassword } = require('../utils/validation');
const { cleanAvatar, AVATAR_LETTER } = require('../public/scripts/avatar');

const MAX_AVATAR_NAMES = 50;

async function findUser(id) {
    const user = await User.findOne({_id: id});

    if (user == null) {
        throw httpError(404, "Ressource not found!");
    }
    return user;
}

async function getUsername(id) {
    const user = await findUser(id);
    return {username: user.username};
}

async function getStatistic(id) {
    const user = await findUser(id);
    const statistic = await Statistic.findOne({_id: user.statistics});

    if (statistic == null) {
        throw httpError(404, "Ressource not found!");
    }
    return statistic;
}

async function deleteUser(id) {
    const user = await findUser(id);

    // Delete the user first: a leftover statistic is harmless, a user without one is not.
    await User.deleteOne({_id: user._id});
    if (user.statistics != null) {
        await Statistic.deleteOne({_id: user.statistics});
    }
}

async function changePassword(id, body) {
    body = body || {};
    const user = await User.findOne({_id: id});

    if (user == null || !isNonEmptyString(body.oldPassword) ||
        !(await bcrypt.compare(body.oldPassword, user.password))) {
        throw httpError(401, "Authentication: Path `authentication` failed.");
    }

    /* Check if password is strong enough */
    if (!isStrongPassword(body.newPassword)) {
        throw httpError(400, "password: Path `password` is too weak.");
    }

    /* Check if password is matching with repeatPassword */
    if (body.newPassword !== body.repeatNewPassword) {
        throw httpError(400, "password: Path `password` is not matching with `repeatPassword`.");
    }

    const hash = await bcrypt.hash(body.newPassword, 10);
    await User.updateOne({_id: user._id}, {password: hash}, {runValidators: true});
}

/* Avatars of some users as {username: config or null} (for the player lists). */
async function getAvatars(names) {
    if (typeof names !== 'string' || names.length === 0) return {};
    const list = [...new Set(names.split(',').map((name) => name.trim()).filter(Boolean))].slice(0, MAX_AVATAR_NAMES);
    const users = await User.find({username: {$in: list}}).select('username avatar').lean();
    const result = {};
    list.forEach((name) => { result[name] = null; });
    // null = no own avatar (the page draws the default one of the name)
    users.forEach((user) => { result[user.username] = user.avatar === AVATAR_LETTER ? AVATAR_LETTER : cleanAvatar(user.avatar); });
    return result;
}

/*
 * Saves the own avatar. Only known parts are stored.
 * null = back to the default avatar of the name, "letter" = only the letter.
 */
async function setAvatar(id, body) {
    const config = body != null ? body.avatar : undefined;
    const letter = config === AVATAR_LETTER;
    if (!letter && config !== null && (config == null || typeof config !== 'object' || Array.isArray(config))) {
        throw httpError(400, "avatar: Path `avatar` is invalid.");
    }
    const avatar = letter ? AVATAR_LETTER : cleanAvatar(config);
    const result = await User.updateOne({_id: id}, {$set: {avatar: avatar}});
    if (!(result.n > 0 || result.matchedCount > 0)) {
        throw httpError(404, "Ressource not found!");
    }
    return avatar;
}

module.exports = { getUsername, getStatistic, deleteUser, changePassword, getAvatars, setAvatar };
