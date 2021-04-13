const express = require('express');
const Statistic = require('../../models/Statistic');
const User = require('../../models/User');
const router = express.Router();
const Auth = require('../middleware/auth');

router.get('/', Auth, async (req, res, next) => {

    var easy = await Statistic.find().sort({easyWin: -1}).limit(10).select("easyWin easyLose");
    var medium = await Statistic.find().sort({mediumWin: -1}).limit(10).select("mediumWin mediumLose");
    var hard = await Statistic.find().sort({hardWin: -1}).limit(10).select("hardWin hardLose");
    var expert = await Statistic.find().sort({expertWin: -1}).limit(10).select("expertWin expertLose");
    var multiplayer = await Statistic.find().sort({multiplayerWin: -1}).limit(10).select("multiplayerWin multiplayerLose");

    easy = await addUserToStatistic(easy);
    medium = await addUserToStatistic(medium);
    hard = await addUserToStatistic(hard);
    expert = await addUserToStatistic(expert);
    multiplayer = await addUserToStatistic(multiplayer);

    var result = {easy, medium, hard, expert, multiplayer}

    res.status(200).json(result);

});

async function addUserToStatistic(obj) {
    var k = 0;
    
    for (statistic of obj) {
        user = await User.findOne({statistics: statistic._id});
        newStatistic = {win: (statistic.easyWin | statistic.mediumWin | statistic.hardWin | statistic.expertWin | statistic.multiplayerWin), lose: (statistic.easyLose | statistic.mediumLose | statistic.hardLose | statistic.expertLose | statistic.multiplayerLose), username: user.username}
        obj[k] = newStatistic;
        k++;
    }
    return obj;
}

module.exports = router;