const jwt = require('jsonwebtoken');

module.exports = async (req, res, next) => {

    try {
        const auth = req.headers.authorization.split(" ");
        const bearer = auth[0];
        const token = auth[1];

        if(bearer != 'Bearer') {
            return res.status(401).json({
                error: {
                    status: 401,
                    message: "Wrong format! Format: Bearer <TOKEN>"
                 }
            })
        }
        
        // Check if Token is valid.
        var decode = await jwt.verify(token, process.env.SECRET_KEY);
        req._id = decode._id;
        
        return next();
    } catch (error) {
        return res.status(403).json({
            error: {
                status: 403,
                message: "Token invalid. Please login (again)!"
             }
        })
    }
};