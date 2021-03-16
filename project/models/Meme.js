const mongoose = require('mongoose');

const schema = mongoose.Schema({
    link: {type: String, required: true, match: /https\:\/\/i\.redd\.it\/([0-9A-Za-z]{13})(.jpg|.png|.gif)/, minLength: 15}
});

module.exports = mongoose.model('meme', schema);