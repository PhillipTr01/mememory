const express = require('express');
const router = express.Router();

const Auth = require('../middleware/auth');
const users = require('../controllers/user_controller');
const { cookieOptions } = require('../controllers/authentication_controller');
const { asyncHandler } = require('../utils/errors');

router.get('/username', Auth, asyncHandler(async (req, res) => {
    res.status(200).json(await users.getUsername(req._id));
}));

router.get('/statistic', Auth, asyncHandler(async (req, res) => {
    res.status(200).json(await users.getStatistic(req._id));
}));

router.delete('/', Auth, asyncHandler(async (req, res) => {
    await users.deleteUser(req._id);
    res.cookie('token', '', cookieOptions(0)).status(200).json({success: {status: 200, message: "Successfully deleted user."}});
}));

router.put('/changePassword', Auth, asyncHandler(async (req, res) => {
    await users.changePassword(req._id, req.body);
    res.status(200).json({success: {status: 200, message: "Successfully updated password of user."}});
}));

module.exports = router;
