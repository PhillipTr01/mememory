const bcrypt = require('bcrypt');

const Statistic = require('../models/Statistic');
const User = require('../models/User');
const { httpError } = require('../utils/errors');
const { isNonEmptyString, isStrongPassword } = require('../utils/validation');

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

module.exports = { getUsername, getStatistic, deleteUser, changePassword };
