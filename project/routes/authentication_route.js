const express = require('express');
const router = express.Router();

const auth = require('../controllers/authentication_controller');
const { asyncHandler } = require('../utils/errors');

router.post('/register', asyncHandler(async (req, res) => {
    await auth.register(req.body);
    res.status(201).json({success: {status: 201, message: "Successfully signed up."}});
}));

router.post('/login', asyncHandler(async (req, res) => {
    const token = await auth.login(req.body);

    // Save token in cookies to authenticate the user session
    res.cookie('token', token, auth.cookieOptions(auth.TOKEN_MAX_AGE)).redirect('/home');
}));

router.get('/logout', (req, res) => {
    // Delete cookie so the session is not valid anymore
    res.cookie('token', '', auth.cookieOptions(0)).redirect('/');
});

module.exports = router;
