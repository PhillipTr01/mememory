const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
    const header = req.headers.authorization;
    const parts = typeof header === 'string' ? header.split(' ') : [];

    if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1]) {
        return res.status(401).json({
            error: {
                status: 401,
                message: "Wrong format! Format: Bearer <TOKEN>"
            }
        });
    }

    try {
        // Check if Token is valid.
        const decode = jwt.verify(parts[1], process.env.SECRET_KEY);
        req._id = decode._id;
        return next();
    } catch (error) {
        return res.status(403).json({
            error: {
                status: 403,
                message: "Token invalid. Please login (again)!"
            }
        });
    }
};
