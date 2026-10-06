const mongoose = require('mongoose');

const schema = mongoose.Schema({
    statistics: {type: mongoose.Types.ObjectId, ref: 'statistic'},
    email: {type: String, required: true, maxLength: 254, match: /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/},
    // Usernames are shown in the game UI, so only allow harmless characters.
    username: {type: String, required: true, minLength: 3, maxLength: 16, match: /^[a-zA-Z0-9_.-]+$/},
	password: {type: String, required: true},
    // Unique indexes prevent duplicate accounts even if two sign-ups race each other.
    emailLowerCase: {type: String, unique: true, sparse: true},
    usernameLowerCase: {type: String, unique: true, sparse: true},
    // Own avatar from the avatar maker (see public/scripts/avatar.js), null = letter
    avatar: {type: mongoose.Schema.Types.Mixed, default: null},
    // Coins for the hidden jackpot (earned by winning games, see game/coins.js)
    coins: {type: Number, min: 0},
    // The last reset of all coins this account got (see game/coins.js)
    coinReset: {type: String},
    coinBonusAt: {type: Date},
    // The secret casino: only for players the admin let in (see game/access.js)
    casinoApproved: {type: Boolean, default: false},
    casinoApprovedAt: {type: Date}, // the first time - the start coins come only once
    casinoRequestedAt: {type: Date}, // tried to open the casino without access
    payoutAllowed: {type: Boolean, default: false}, // may pay coins out (set by the admin)
	// active: {type: String, required: true, default: false}
});

module.exports = mongoose.model('user', schema, 'user');
