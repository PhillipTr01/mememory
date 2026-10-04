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
	// active: {type: String, required: true, default: false}
});

module.exports = mongoose.model('user', schema, 'user');
