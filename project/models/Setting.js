const mongoose = require('mongoose');

// One stored value of the app, e.g. the day the first player got into the casino
const schema = mongoose.Schema({
    key: {type: String, required: true, unique: true},
    value: {type: mongoose.Schema.Types.Mixed},
});

module.exports = mongoose.model('setting', schema, 'setting');
