const express = require('express');
const router = express.Router();

// const Auth = require('../middleware/auth');
const Statistic = require('../models/Statistic');

router.get('/:statisticID', async (req, res, next) => {
    var err = null;

    try {
        const statisticID = req.params.statisticID;
        const statistic = await Statistic.findOne({
            _id: statisticID
        });

        if (statistic != null) {
            res.status(200).json(statistic);
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
})

module.exports = router;