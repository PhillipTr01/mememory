const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
    let decode = null;

    try {
        // Check if Token is valid.
        decode = jwt.verify(req.cookies.token, process.env.SECRET_KEY);
    } catch (error) {
        decode = null;
    }

    // (the whole address - this middleware also runs in routers mounted further down)
    const landing = req.originalUrl.split('?')[0] == '/';

    if (decode != null && decode._id) {
        req._id = decode._id;

        // Logged in users don't need the landing page (with ?next=: back to where they wanted to go).
        if (landing) return res.redirect(safeNext(req.query.next) || '/home');
        return next();
    }

    if (landing) {
        return next();
    }

    // Remove an invalid/expired token and send the user to the landing page.
    if (req.cookies.token) {
        res.clearCookie('token', {httpOnly: true, sameSite: 'lax'});
    }
    // A page: the login first - then back to it (/?next=...)
    if (req.method == 'GET') return res.redirect('/?next=' + encodeURIComponent(req.originalUrl));
    return res.redirect('/');
};

// Only an address on this site (not "//other.site" or "https://...")
function safeNext(next) {
    return typeof next == 'string' && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : null;
}

module.exports.safeNext = safeNext;
