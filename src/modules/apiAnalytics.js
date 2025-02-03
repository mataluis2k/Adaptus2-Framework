 const Redis = require('ioredis');
const winston = require('winston');

class APIAnalytics {
    constructor() {
        // Initialize Redis client for analytics storage
        this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
        
        // Initialize logger
        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            ),
            transports: [
                new winston.transports.File({ 
                    filename: 'analytics.log',
                    maxsize: 5242880, // 5MB
                    maxFiles: 5
                })
            ]
        });

        // Constants for analytics
        this.SLOW_QUERY_THRESHOLD = 1000; // 1 second
        this.RATE_WINDOW = 60; // 1 minute window for rate tracking
        this.METRICS_TTL = 86400; // Store metrics for 24 hours
    }

    // Middleware to track request metrics
    middleware() {
        return async (req, res, next) => {
            const startTime = Date.now();
            const requestId = Math.random().toString(36).substring(7);

            // Store original end function
            const originalEnd = res.end;

            // Track request start
            await this.trackRequestStart(req, requestId);

            // Override end function to capture response metrics
            res.end = async (...args) => {
                const duration = Date.now() - startTime;
                await this.trackRequestComplete(req, res, duration, requestId);
                originalEnd.apply(res, args);
            };

            next();
        };
    }

    // Track the start of a request
    async trackRequestStart(req, requestId) {
        const key = `request:${requestId}`;
        const data = {
            method: req.method,
            path: req.path,
            query: JSON.stringify(req.query),
            timestamp: Date.now(),
            ip: req.ip
        };

        await this.redis.hmset(key, data);
        await this.redis.expire(key, this.METRICS_TTL);
    }

    // Track request completion and store metrics
    async trackRequestComplete(req, res, duration, requestId) {
        try {
            // Update endpoint metrics
            const endpointKey = `endpoint:${req.method}:${req.path}`;
            const timestamp = Math.floor(Date.now() / 1000);
            
            // Track response time
            await this.redis.zadd(`${endpointKey}:times`, timestamp, duration);
            
            // Track status codes
            await this.redis.hincrby(`${endpointKey}:status`, res.statusCode, 1);
            
            // Track request rate
            await this.redis.zadd(`${endpointKey}:requests`, timestamp, requestId);
            
            // Clean up old data
            const oldTimestamp = timestamp - this.METRICS_TTL;
            await Promise.all([
                this.redis.zremrangebyscore(`${endpointKey}:times`, '-inf', oldTimestamp),
                this.redis.zremrangebyscore(`${endpointKey}:requests`, '-inf', oldTimestamp)
            ]);

            // Log slow queries
            if (duration > this.SLOW_QUERY_THRESHOLD) {
                this.logSlowQuery(req, duration, requestId);
            }

            // Track endpoint usage patterns
            await this.trackUsagePattern(req, duration);

        } catch (error) {
            this.logger.error('Error tracking metrics:', error);
        }
    }

    // Log slow queries for analysis
    logSlowQuery(req, duration, requestId) {
        this.logger.warn('Slow Query Detected', {
            requestId,
            method: req.method,
            path: req.path,
            query: req.query,
            duration,
            timestamp: new Date().toISOString()
        });
    }

    // Track endpoint usage patterns
    async trackUsagePattern(req, duration) {
        const hour = new Date().getHours();
        const dayOfWeek = new Date().getDay();
        const pattern = `pattern:${req.method}:${req.path}`;

        await Promise.all([
            // Track hourly patterns
            this.redis.hincrby(`${pattern}:hourly`, hour, 1),
            // Track daily patterns
            this.redis.hincrby(`${pattern}:daily`, dayOfWeek, 1),
            // Track average response time
            this.redis.hset(`${pattern}:avg_time`, hour, 
                await this.calculateMovingAverage(`${pattern}:avg_time:${hour}`, duration)
            )
        ]);
    }

    // Calculate moving average for response times
    async calculateMovingAverage(key, newValue) {
        const currentAvg = await this.redis.get(key) || newValue;
        const alpha = 0.1; // Smoothing factor for exponential moving average
        return (alpha * newValue + (1 - alpha) * currentAvg).toFixed(2);
    }

    // Get analytics for a specific endpoint
    async getEndpointAnalytics(method, path) {
        const endpointKey = `endpoint:${method}:${path}`;
        const pattern = `pattern:${method}:${path}`;

        const [times, status, hourly, daily, avgTime] = await Promise.all([
            this.redis.zrange(`${endpointKey}:times`, 0, -1, 'WITHSCORES'),
            this.redis.hgetall(`${endpointKey}:status`),
            this.redis.hgetall(`${pattern}:hourly`),
            this.redis.hgetall(`${pattern}:daily`),
            this.redis.hgetall(`${pattern}:avg_time`)
        ]);

        return {
            responseTimes: this.parseZrangeResponse(times),
            statusCodes: status,
            patterns: {
                hourly,
                daily,
                averageResponseTime: avgTime
            }
        };
    }

    // Helper to parse Redis ZRANGE response
    parseZrangeResponse(zrangeResult) {
        const result = [];
        for (let i = 0; i < zrangeResult.length; i += 2) {
            result.push({
                value: zrangeResult[i],
                score: zrangeResult[i + 1]
            });
        }
        return result;
    }

    // Get slow queries
    async getSlowQueries() {
        return new Promise((resolve, reject) => {
            const slowQueries = [];
            const stream = this.logger.query({
                level: 'warn',
                limit: 100
            });

            stream.on('data', (log) => {
                if (log.message === 'Slow Query Detected') {
                    slowQueries.push(log);
                }
            });

            stream.on('end', () => resolve(slowQueries));
            stream.on('error', reject);
        });
    }

    // Get current request rate for an endpoint
    async getCurrentRequestRate(method, path) {
        const endpointKey = `endpoint:${method}:${path}`;
        const now = Math.floor(Date.now() / 1000);
        const windowStart = now - this.RATE_WINDOW;

        const requestCount = await this.redis.zcount(
            `${endpointKey}:requests`,
            windowStart,
            now
        );

        return {
            requestsPerMinute: requestCount,
            timestamp: now
        };
    }
}

module.exports = APIAnalytics;
