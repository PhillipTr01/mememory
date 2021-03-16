const mongoose = require('mongoose');

const schema = mongoose.Schema({
    easyWin: {type: Number, required: true, default: 0},
    easyLose: {type: Number, required: true, default: 0},
    middleWin: {type: Number, required: true, default: 0},
    middleLose: {type: Number, required: true, default: 0},
    hardWin: {type: Number, required: true, default: 0},
    hardLose: {type: Number, required: true, default: 0},
    expertWin: {type: Number, required: true, default: 0},
    expertLose: {type: Number, required: true, default: 0},
    multiplayerWin: {type: Number, required: true, default: 0},
    multiplayerLose: {type: Number, required: true, default: 0}
});

module.exports = mongoose.model('statistic', schema);