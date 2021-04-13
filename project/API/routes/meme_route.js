const express = require('express');
const router = express.Router();
const Meme = require('../../models/Meme');
const Auth = require('../middleware/auth');


// Get all meme images
router.get('/', Auth, async (req, res, next) => {
    const memes = await Meme.find().select('link');
    res.json(memes);
});

module.exports = router;