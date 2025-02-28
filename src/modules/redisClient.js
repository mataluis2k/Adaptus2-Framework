const Redis = require('ioredis');
const redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

module.exports = redisClient;
