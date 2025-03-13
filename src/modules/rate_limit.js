// rate_limit.js - Updated implementation
const Redis = require('ioredis');

class RateLimit {
    /**
     * @param {Array} apiConfig - The API configuration array
     * @param {Object} redis - The Redis client instance
     */
    constructor(apiConfig, redisUrl) {
        this.apiConfig = apiConfig;
        // Create a dedicated Redis client for rate limiting
        this.redis = new Redis(redisUrl || process.env.REDIS_URL || 'redis://localhost:6379', {
            retryStrategy: (times) => Math.min(times * 50, 2000),
            maxRetriesPerRequest: 3,
            enableReadyCheck: true,
            connectTimeout: 10000
        });
        
        this.redis.on('error', (err) => {
            console.error('Rate Limit Redis Error:', err.message);
        });
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
                next(); // Continue to the next middleware even if rate limiting fails
            }
        };
    }
    
    /**
     * Close the Redis connection when shutting down
     */
    async close() {
        if (this.redis) {
            await this.redis.quit();
        }
    }
}    
module.exports = RateLimit;