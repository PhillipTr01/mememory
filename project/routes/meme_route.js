const express = require('express');
const router = express.Router();
const Meme = require('../models/Meme');
const Auth = require('../middleware/auth');
const { asyncHandler } = require('../utils/errors');


// Get all meme images
router.get('/', Auth, asyncHandler(async (req, res) => {
    const memes = await Meme.find().select('link');
    res.json(memes);
}));

module.exports = router;
