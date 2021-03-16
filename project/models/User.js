const mongoose = require('mongoose');

const schema = mongoose.Schema({
    statistics: {type: mongoose.Types.ObjectId, ref: 'statistic', required: true},
    email: {type: String, required: true, match: /([0-9A-Za-zÄÖÜäöü\-\.]{5,})@([0-9A-Za-zÄÖÜäöü\-\.]{3,})/, minLength: 10},
    username: {type: String, required: true, minLength: 3},
	password: {type: String, required: true, minLength: 8},
	// active: {type: String, required: true, default: false}
});

module.exports = mongoose.model('user', schema, 'user');