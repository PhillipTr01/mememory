const express = require('express');
const router = express.Router();

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

module.exports = router;