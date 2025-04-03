const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'IhaveaVeryStrongSecret';
const consolelog = require('../modules/logger');
const { setContext } = require('../modules/context');
const defaultUnauthorized = { httpCode: 403, message: 'Access Denied', code: null };
const redis = require('redis');

let redisClient;
async function getRedisClient() {
  if (!process.env.REDIS_URL ) return null;
  if (!redisClient) {
    redisClient = redis.createClient({ url: process.env.REDIS_URL, port: process.env.REDIS_PORT });
    await redisClient.connect().catch(console.error);
  }
  return redisClient;
}

/**
 * ACL Middleware: Ensures user has one of the allowed roles.
 */
const aclMiddleware = (allowedRoles, customMessage = defaultUnauthorized) => {
  return (req, res, next) => {
    let aclError = false;
    consolelog.log('ACL Middleware:', req.user);
    const userRole = req.user?.acl;
    if (allowedRoles && allowedRoles.length > 0) {
      // iterate user roles and check if any of them are in the allowedRoles
      aclError = !allowedRoles.some((role) => {
        if (Array.isArray(userRole)) {
          return userRole.includes(role);
        }
        return userRole === role;
      });      
    }
    if (aclError) {
      consolelog.log('User Denied access, mismatch in ACL Middleware:', allowedRoles, userRole);
      const errorConfig = (customMessage && customMessage.httpCode) ? customMessage : defaultUnauthorized;
      return res.status(errorConfig.httpCode).json({ error: errorConfig.message, code: errorConfig.code });
    }
    next();
  };
};

/**
 * Token Authentication Middleware: Verifies JWT tokens and checks blacklist.
 */
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    consolelog.log('Authorization header missing or token not provided', req.ip);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (
    process.env.TOKEN_BLACKLIST_ENABLED &&
    process.env.TOKEN_BLACKLIST_ENABLED.toLowerCase() === 'true' &&
    process.env.REDIS_URL &&
    process.env.REDIS_PORT
  ) {
    try {
      const client = await getRedisClient();
      if (client) {
        const result = await client.get(`blacklist:${token}`);
        if (result !== null) {
          consolelog.log('Token is blacklisted', req.ip);
          return res.status(401).json({ error: 'Invalid Token. Please log in again.' });
        }
      }
    } catch (error) {
      consolelog.log('Error checking token blacklist:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      consolelog.log('User Denied access, Invalid token', req.ip);
      return res.status(403).json({ error: 'Forbidden' });
    }
    req.user = user;
    consolelog.log('Setting User in Context:', user);
    setContext('user', user);
    next();
  });
};

/**
 * Authentication Middleware: Optionally applies token authentication.
 */
const authenticateMiddleware = (auth) => {
  if (auth) {
    return authenticateToken;
  }
  return (req, res, next) => next();
};

module.exports = { authenticateMiddleware, aclMiddleware };