const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
    let decode = null;

    try {
        // Check if Token is valid.
        decode = jwt.verify(req.cookies.token, process.env.SECRET_KEY);
    } catch (error) {
        decode = null;
    }

    if (decode != null && decode._id) {
        req._id = decode._id;

        // Logged in users don't need the landing page.
        return req.originalUrl == '/' ? res.redirect('/home') : next();
    }

    if (req.originalUrl == '/') {
        return next();
    }

    // Remove an invalid/expired token and send the user to the landing page.
    if (req.cookies.token) {
        res.clearCookie('token', {httpOnly: true, sameSite: 'lax'});
    }
    return res.redirect('/');
};
