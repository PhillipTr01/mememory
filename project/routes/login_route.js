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
        req.body.password = await bcrypt.hash(req.body.password, 10);

        if (await User.findOne({
                "emailLowerCase": req.body.email.toLowerCase()
            })) {
            err = new Error("Conflict Error! E-Mail is already in use.");
            err.status = 409;
            return next(err);
        }

        if (await User.findOne({
                "usernameLowerCase": req.body.username.toLowerCase()
            })) {
            err = new Error("Conflict Error! Username is already taken.");
            err.status = 409;
            return next(err);
        }

        var stat = await Statistic().save();
        req.body.statistics = stat._id;
        req.body.usernameLowerCase = req.body.username.toLowerCase();
        req.body.emailLowerCase = req.body.email.toLowerCase();

        await User(req.body).save();
        res.status(201).json({
            success: {
                status: 201,
                message: "Successfully signed up."
            }
        });
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
        const user = await User.findOne({
            $or: [{
                emailLowerCase: req.body.email.toLowerCase()
            }, {
                usernameLowerCase: req.body.username.toLowerCase()
            }]
        });

        if (user != null && await bcrypt.compare(req.body.password, user.password)) {
            token = jwt.sign({
                _id: user._id,
                username: user.username,
            }, "FMdYFjdjNCDCDDFXAtgP", {
                expiresIn: "7d"
            });
        } else {
            err = new Error("Authentication failed. Please try again.");
            err.status = 401;
            return next(err);
        }

        res.cookie('token', token, {
            maxAge: 7 * 24 * 60 * 60 * 1000
        }).status(200).json({
            success: {
                status: 200,
                message: "Successfully logged in.",
                token: token
            }
        });
    } catch (error) {
        err = new Error(error.message);
        err.status = 400;
        return next(err);
    }
})

module.exports = router;