const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');

const Auth = require('../middleware/auth');
const Statistic = require('../models/Statistic');
const User = require('../models/User');

router.get('/username', Auth, async (req, res, next) => {
    var err = null;

    try {
        var user = await User.findOne({_id: req._id});

        if(user != null) {
            res.status(200).json({username: user.username});
        } else {
            err = new Error("Ressource not found!");
            err.status = 404;
            return next(err);
        }
    } catch (error) {
        err = new Error(error.message);
        err.status = 400;
        return next(err);
    }
});

router.get('/statistic', Auth, async (req, res, next) => {
    var err = null;

    try {
        var user = await User.findOne({_id: req._id});

        if (user != null) {
            var statistic = await Statistic.findOne({_id: user.statistics});

            if (statistic != null) {
                res.status(200).json(statistic);
            } else {
                err = new Error("Ressource not found!");
                err.status = 404;
                return next(err);
            }
        }

    } catch (error) {
        err = new Error(error.message);
        err.status = 400;
        return next(err);
    }
});

router.delete('/', Auth, async (req, res, next) => {
    var err = null;

    try {
        var user = await User.findOne({_id: req._id});

        if (user != null) {
            var statistic = await Statistic.findOne({_id: user.statistics});

            if (statistic != null) {
                await User.deleteOne({_id: req._id});
                await Statistic.deleteOne({_id: user.statistics});
                res.cookie('token', '', {maxAge: 0, httpOnly: true}).status(200).json({success: {status: 200, message: "Successfully deleted user."}});
            } else {
                err = new Error("Ressource not found!");
                err.status = 404;
                return next(err);
            }
        }
    } catch (error) {
        err = new Error(error.message);
        err.status = 400;
        return next(err);
    }
});

router.put('/changePassword', Auth, async (req, res, next) => {
    var err = null;
    try {
        var user = await User.findOne({_id: req._id});

        if (user != null && await bcrypt.compare(req.body.oldPassword, user.password)) {

            /* Check if password is strong enough */
            var passwordRegex = /^(?=.*[0-9])(?=.*[a-zA-Z])(?=.*[\*\.\!\@\$\%\^\&\#\(\)\{\}\[\]\:\;\<\>\,\.\?\/\~\_\+\-\=\|\\])\S{8,}$/;
            if (!passwordRegex.test(req.body.newPassword)) {
                err = new Error("password: Path `password` is too weak.");
                err.status = 400;
                return next(err);
            }

            /* Check if password is matching with repeatPassword */
            if (req.body.newPassword != req.body.repeatNewPassword) {
                err = new Error("password: Path `password` is not matching with `repeatPassword`.");
                err.status = 400;
                return next(err);
            }

        } else {
            err = new Error("Authentication: Path `authentication` failed.");
            err.status = 401;
            return next(err);
        }

        req.body.newPassword = await bcrypt.hash(req.body.newPassword, 10);

        await User.updateOne({_id: req._id}, {password: req.body.newPassword}, {runValidators: true})
        res.status(200).json({success: {status: 200, message: "Successfully updated password of user."}});
    } catch (error) {
        err = new Error(error.message);
        err.status = 400;
        return next(err);
    }
});

module.exports = router;