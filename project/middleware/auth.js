const jwt = require('jsonwebtoken');

module.exports = async (req, res, next) => {

    try {
        // Check if Token is valid.
        await jwt.verify(req.cookies.token, "FMdYFjdjNCDCDDFXAtgP");

        if (req.originalUrl == '/') {
            res.redirect('/home');
        } else {
            return next();
        }
    } catch (error) {

        if (req.originalUrl != '/') {
            res.cookie('token', '', {maxAge: 0, httpOnly: true}).status(401).redirect('/');
        } else {
            return next();
        }
    }
};