const express = require('express');
const router = express.Router();
const Auth = require('../middleware/auth');
const scoreboard = require('../../controllers/scoreboard_controller');
const { asyncHandler } = require('../../utils/errors');

// Get the best Users from all difficulty levels
router.get('/', Auth, asyncHandler(async (req, res) => {
    res.status(200).json(await scoreboard.getScoreboard());
}));

module.exports = router;
