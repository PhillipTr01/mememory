const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const User = require('../models/User');
const Statistic = require('../models/Statistic');

router.post('/register', async (req, res, next) => {
    var err = null;

    try {

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

        /* Check if password is strong enough */
        var passwordRegex = /^(?=.*[0-9])(?=.*[a-zA-Z])(?=.*[\*\.\!\@\$\%\^\&\#\(\)\{\}\[\]\:\;\<\>\,\.\?\/\~\_\+\-\=\|\\])\S{8,}$/;
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

        var stat = await Statistic().save();
        req.body.statistics = stat._id;

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
            }, process.env.SECRET_KEY, {
                expiresIn: process.env.EXPIRY_DATE
            });
        } else {
            err = new Error("Authentication: Path `authentication` failed.");
            err.status = 401;
            return next(err);
        }

        res.cookie('token', token, {maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true}).status(200).redirect('/home');
    } catch (error) {
        err = new Error(error.message);
        err.status = 400;
        return next(err);
    }
})

router.get('/logout', async (req, res, next) => {
    var err = null;

    try {
        res.cookie('token', '', {maxAge: 0, httpOnly: true}).status(200).redirect('/');
    } catch (error) {
        err = new Error(error.message);
        err.status = 400;
        return next(err);
    }
})

module.exports = router;