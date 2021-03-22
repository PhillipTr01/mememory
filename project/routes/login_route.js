const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// const Auth = require('../middleware/auth');
const User = require('../models/User');
const Statistic = require('../models/Statistic');

router.post('/register', async (req, res, next) => {
    var err = null;

    try {

        var stat = await Statistic().save();
        req.body.statistics = stat._id;

        await User.validate(req.body);

        /* Check if e-Mail ist already in use */
        if (await User.findOne({"emailLowerCase": req.body.email.toLowerCase()})) {
            err = new Error("email: Path `email` is already in use.");
            err.status = 409;
            return next(err);
        }

        /* Check if username is already taken */
        if (await User.findOne({"usernameLowerCase": req.body.username.toLowerCase()})) {
            err = new Error("username: Path `username` is already taken.");
            err.status = 409;
            return next(err);
        }

        /* Check if password is long enough */
        if (JSON.stringify(req.body.password).length < 8) {
            err = new Error("password: Path `password` is shorter than the minimum allowed length (8).");
            err.status = 400;
            return next(err);
        }

        /* Check if password is strong enough */
        var passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,}$/
        if (!passwordRegex.test(req.body.password)) {
            err = new Error("password: Path `password` is too weak.");
            err.status = 400;
            return next(err);
        }

        /* Check if password is matching with repeatPassword */
        if (req.body.password != req.body.repeatPassword) {
            err = new Error("password: Path `password` is not matching with `repeatPassword`.");
            err.status = 400;
            return next(err);
        }

        req.body.password = await bcrypt.hash(req.body.password, 10);
        req.body.usernameLowerCase = req.body.username.toLowerCase();
        req.body.emailLowerCase = req.body.email.toLowerCase();

        await User(req.body).save();
        res.status(201).json({success: {status: 201, message: "Successfully signed up."}});
    } catch (error) {
        err = new Error(error.message);
        err.status = 400;
        return next(err);
    }
});

router.post('/login', async (req, res, next) => {
    var err = null;
    var token = null;

    try {
        const user = await User.findOne({$or: [{emailLowerCase: req.body.email.toLowerCase()}, {usernameLowerCase: req.body.username.toLowerCase()}]});

        if (user != null && await bcrypt.compare(req.body.password, user.password)) {
            token = jwt.sign({
                _id: user._id,
                username: user.username,
            }, "FMdYFjdjNCDCDDFXAtgP", {
                expiresIn: "30d"
            });
        } else {
            err = new Error("Authentication: Path `authentication` failed.");
            err.status = 401;
            return next(err);
        }

        res.cookie('token', token, {maxAge: 30 * 24 * 60 * 60 * 1000}).status(200).json({success: {status: 200, message: "Successfully logged in."}});
    } catch (error) {
        err = new Error(error.message);
        err.status = 400;
        return next(err);
    }
})

module.exports = router;