const Redis = require('ioredis');

// Create a singleton Redis client for general use
const createRedisClient = (url = process.env.REDIS_URL || 'redis://localhost:6379', options = {}) => {
    const defaultOptions = {
        retryStrategy: (times) => Math.min(times * 50, 2000), // Exponential backoff
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        connectTimeout: 10000,
        lazyConnect: true
    };

    const mergedOptions = { ...defaultOptions, ...options };
    const redis = new Redis(url, mergedOptions);

    redis.on('error', (err) => {
        try {
            const consolelog = require('./logger');
            consolelog.error('Redis Error:', {
                error: err.stack || err.message,
                timestamp: new Date().toISOString()
            });
        } catch (loggingError) {
            console.error('Failed to log Redis error:', loggingError);
            console.error('Original error:', err);
        }
    });

    redis.on('connect', () => {
        try {
            const consolelog = require('./logger');
            consolelog.log('Redis Connection:', {
                status: 'connected',
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Failed to log Redis connection:', error);
        }
    });

    return redis;
};

// Export a singleton instance for general use
const redisClient = createRedisClient();

module.exports = {
    redisClient,
    createRedisClient
};
