const mongoose = require('mongoose');

// One change of a coin balance (history for the admin panel, see game/coins.js)
const schema = mongoose.Schema({
    username: {type: String, required: true, index: true},
    amount: {type: Number, required: true}, // + coins in, - coins out
    reason: {type: String, required: true}, // e.g. "jackpot bet", "poker cash-out", "admin"
    note: {type: String, maxLength: 300},
    // A win: the bet it came from (the best wins show it and how many times it was won)
    bet: {type: Number},
    at: {type: Date, default: Date.now, index: true},
    // Written during a season: its reset id (the history from before the season comes back after it)
    era: {type: String, index: true},
});

module.exports = mongoose.model('coinlog', schema, 'coinlog');
