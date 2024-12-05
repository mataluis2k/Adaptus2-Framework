const Redis = require('ioredis');

class RateLimit {
    /**
     * @param {Array} apiConfig - The API configuration array
     * @param {String} redisUrl - The Redis connection string
     */
    constructor(apiConfig, redis) {
        this.apiConfig = apiConfig;
        this.redis = redis;
    }

    /**
     * Middleware function for rate limiting.
     */
    middleware() {
        return async (req, res, next) => {
            try {
                // Safely access the route path
                const routePath = req.route && req.route.path ? req.route.path : req.originalUrl;
    
                const endpointConfig = this.apiConfig.find((endpoint) => endpoint.route === routePath);
    
                if (!endpointConfig || !endpointConfig.rateLimit) {
                    return next(); // Skip rate limiting if not configured
                }
    
                const { requestsPerMinute } = endpointConfig.rateLimit;
                const clientIP = req.ip;
    
                const rateLimitKey = `rate-limit:${routePath}:${clientIP}`;
                const requestCount = await this.redis.incr(rateLimitKey);
    
                if (requestCount === 1) {
                    // Set expiration to 1 minute
                    await this.redis.expire(rateLimitKey, 60);
                }
    
                if (requestCount > requestsPerMinute) {
                    console.log(`Rate limit exceeded for ${clientIP} on route ${routePath}`);
                    return res.status(429).json({ error: 'Too Many Requests' });
                }
    
                next();
            } catch (error) {
                console.error('Rate limit middleware error:', error.message);
                res.status(500).json({ error: 'Internal Server Error' });
            }
        };
    }
}    
module.exports = RateLimit;
