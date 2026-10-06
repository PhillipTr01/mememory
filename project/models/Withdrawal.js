const mongoose = require('mongoose');

// A player took coins off the balance to be paid out (handled in the admin panel)
const schema = mongoose.Schema({
    username: {type: String, required: true, index: true},
    amount: {type: Number, required: true, min: 1},
    status: {type: String, enum: ['open', 'paid', 'rejected'], default: 'open', index: true},
    note: {type: String, maxLength: 300}, // from the admin
    createdAt: {type: Date, default: Date.now},
    handledAt: {type: Date},
});

module.exports = mongoose.model('withdrawal', schema, 'withdrawal');
