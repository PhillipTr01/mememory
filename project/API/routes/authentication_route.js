const express = require('express');
const router = express.Router();

const auth = require('../../controllers/authentication_controller');
const { asyncHandler } = require('../../utils/errors');

router.post('/register', asyncHandler(async (req, res) => {
    await auth.register(req.body);
    res.status(201).json({success: {status: 201, message: "Successfully signed up."}});
}));

router.post('/login', asyncHandler(async (req, res) => {
    const token = await auth.login(req.body);
    res.status(200).json({success: {status: 200, message: "Successfully logged in.", token: token}});
}));

module.exports = router;
