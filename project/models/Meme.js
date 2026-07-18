const mongoose = require("mongoose");

const schema = mongoose.Schema({
  link: {
    type: String,
    required: true,
    match: /https:\/\/i\.redd\.it\/[^\s"'<>]+\.(jpg|jpeg|png|gif|webp)/i,
    minLength: 15,
  },
});

module.exports = mongoose.model("meme", schema);
