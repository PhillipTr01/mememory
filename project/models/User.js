const mongoose = require('mongoose');

const schema = mongoose.Schema({
    statistics: {type: mongoose.Types.ObjectId, ref: 'statistic', required: true},
    email: {type: String, required: true, match: /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/},
    username: {type: String, required: true, minLength: 3, maxLength: 16},
	password: {type: String, required: true},
    emailLowerCase: {type: String},
    usernameLowerCase: {type: String},
	// active: {type: String, required: true, default: false}
});

module.exports = mongoose.model('user', schema, 'user');