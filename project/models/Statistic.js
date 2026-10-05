const mongoose = require('mongoose');

const schema = mongoose.Schema({
    easyWin: {type: Number, required: true, default: 0},
    easyLose: {type: Number, required: true, default: 0},
    mediumWin: {type: Number, required: true, default: 0},
    mediumLose: {type: Number, required: true, default: 0},
    hardWin: {type: Number, required: true, default: 0},
    hardLose: {type: Number, required: true, default: 0},
    expertWin: {type: Number, required: true, default: 0},
    expertLose: {type: Number, required: true, default: 0},
    multiplayerWin: {type: Number, required: true, default: 0},
    multiplayerLose: {type: Number, required: true, default: 0},
    // Tic Tac Toe XL: every round counts
    tictactoeWin: {type: Number, required: true, default: 0},
    tictactoeLose: {type: Number, required: true, default: 0},
    tictactoeDraw: {type: Number, required: true, default: 0}
});

/*
 * Atomically increments one counter of a user's statistic.
 * $inc avoids lost updates when two games finish at the same time.
 */
schema.statics.increment = async function (username, field) {
    const User = require('./User');
    const user = await User.findOne({username: username}).select('statistics');

    if (user == null || user.statistics == null) {
        return false;
    }

    const result = await this.updateOne({_id: user.statistics}, {$inc: {[field]: 1}});
    return result.n > 0 || result.matchedCount > 0;
};

module.exports = mongoose.model('statistic', schema);
