const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'IhaveaVeryStrongSecret';
const consolelog = require('../modules/logger');
const { setContext } = require('../modules/context');
const defaultUnauthorized = { httpCode: 403, message: 'Access Denied' };

/**
 * ACL Middleware: Ensures user has one of the allowed roles.
 */
const aclMiddleware = (allowedRoles, customMessage = defaultUnauthorized) => {
    return (req, res, next) => {
        if (allowedRoles) {
            consolelog.log('ACL Middleware:', req.user);
            const userRole = req.user?.acl; // Adjust based on your user object structure
            if (!userRole || !allowedRoles.includes(userRole)) {
                consolelog.log('User Denied access, mismatch in ACL Middleware:', allowedRoles);
                // Ensure a valid error configuration is used:
                const errorConfig = (customMessage && customMessage.httpCode) ? customMessage : defaultUnauthorized;
                return res.status(errorConfig.httpCode).json({ error: errorConfig.message });
            }
        }
        next(); // Proceed if ACL passes
    };
};

/**
 * Token Authentication Middleware: Verifies JWT tokens.
 */
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        consolelog.log('Authorization header missing or token not provided', req.ip);
        return res.status(401).json({ error: 'Unauthorized' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            consolelog.log('User Denied access, Invalid token', req.ip);
            return res.status(403).json({ error: 'Forbidden' });
        }

        req.user = user; // Attach user data to the request
        consolelog.log('Setting User in Context:', user);
        setContext('user', user); // Store user in context
        next(); // Proceed to the next middleware or route handler
    });
};

/**
 * Authentication Middleware: Optionally applies token authentication.
 */
const authenticateMiddleware = (auth) => {
    if (auth) {
        // Return `authenticateToken` if authentication is required
        return authenticateToken;
    }
    // Otherwise, skip authentication and proceed to the next middleware
    return (req, res, next) => next();
};

module.exports = { authenticateMiddleware, aclMiddleware };