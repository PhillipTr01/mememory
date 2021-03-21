const express = require('express');
const router = express.Router();
const Meme = require('../models/Meme')


// Get all meme images
router.get('/', async (req, res, next) => { // Add Authentication
    const memes = await Meme.find().select('link');
    res.json(memes);
});

module.exports = router;