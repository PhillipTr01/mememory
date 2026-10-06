const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const User = require('../models/User');
const Statistic = require('../models/Statistic');
const { httpError } = require('../utils/errors');
const { isNonEmptyString, isStrongPassword } = require('../utils/validation');

const TOKEN_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

/* Creates a new user together with an empty statistic. */
async function register(body) {
    body = body || {};

    // Only take the fields a client is allowed to set (no `statistics` etc.).
    const data = {
        email: typeof body.email === 'string' ? body.email.trim() : body.email,
        username: typeof body.username === 'string' ? body.username.trim() : body.username,
        password: body.password,
    };

    try {
        await User.validate(data);
    } catch (error) {
        throw httpError(400, error.message);
    }

    /* Check if e-Mail ist already in use */
    if (await User.findOne({emailLowerCase: data.email.toLowerCase()})) {
        throw httpError(409, "email: Path `email` is already in use.");
    }

    /* Check if username is already taken (or reserved: "Ghost" is the house in the jackpot) */
    if (data.username.toLowerCase() === "ghost" || await User.findOne({usernameLowerCase: data.username.toLowerCase()})) {
        throw httpError(409, "username: Path `username` is already taken.");
    }

    /* Check if password is strong enough */
    if (!isStrongPassword(data.password)) {
        throw httpError(400, "password: Path `password` is too weak.");
    }

    /* Check if password is matching with repeatPassword */
    if (data.password !== body.repeatPassword) {
        throw httpError(400, "password: Path `password` is not matching with `repeatPassword`.");
    }

    data.password = await bcrypt.hash(data.password, 10);
    data.usernameLowerCase = data.username.toLowerCase();
    data.emailLowerCase = data.email.toLowerCase();

    const stat = await Statistic().save();
    data.statistics = stat._id;

    try {
        await User(data).save();
    } catch (error) {
        // Don't leave an orphaned statistic behind.
        await Statistic.deleteOne({_id: stat._id}).catch(() => {});

        // Duplicate key: another sign-up with the same name/e-mail won the race.
        if (error.code === 11000) {
            if (error.keyPattern && error.keyPattern.emailLowerCase) {
                throw httpError(409, "email: Path `email` is already in use.");
            }
            throw httpError(409, "username: Path `username` is already taken.");
        }
        throw error;
    }
}

/* Checks the credentials and returns a signed JWT. */
async function login(body) {
    body = body || {};

    // The identifier can either be the e-mail or the username.
    const identifier = isNonEmptyString(body.email) ? body.email : body.username;

    if (!isNonEmptyString(identifier) || !isNonEmptyString(body.password)) {
        throw httpError(401, "Authentication: Path `authentication` failed.");
    }

    const lower = identifier.trim().toLowerCase();
    const user = await User.findOne({$or: [{emailLowerCase: lower}, {usernameLowerCase: lower}]});

    // Check if user exists and if the password given is correct
    if (user == null || !(await bcrypt.compare(body.password, user.password))) {
        throw httpError(401, "Authentication: Path `authentication` failed.");
    }

    return jwt.sign({_id: user._id}, process.env.SECRET_KEY, {
        expiresIn: process.env.EXPIRY_DATE || '7d',
    });
}

function cookieOptions(maxAge) {
    return {
        maxAge: maxAge,
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
    };
}

module.exports = { register, login, cookieOptions, TOKEN_MAX_AGE };
