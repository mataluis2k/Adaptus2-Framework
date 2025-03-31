const fs = require('fs');
const path = require('path');
const Redis = require('ioredis');
const response = require('./response');

class ConfigManager {
    constructor({ app, redisClient, authMiddleware, aclMiddleware }) {
        if (!app || !redisClient) throw new Error('App and Redis client are required');
        this.app = app;
        this.redis = redisClient;
        this.lockTTL = 3600; // 1 hour in seconds
        this.lockPrefix = 'config-lock:';
        this.configDir = process.env.CONFIG_DIR || path.join(process.cwd(), 'config');
        this.authMiddleware = authMiddleware;
        this.aclMiddleware = aclMiddleware;

        this.setupRoutes();
    }

    setupRoutes() {
        this.app.get(
            '/ui/getConfig/:fileName',
            this.authMiddleware,
            this.aclMiddleware,
            this.getConfig.bind(this)
        );

        this.app.post(
            '/ui/saveConfig',
            this.authMiddleware,
            this.aclMiddleware,
            this.saveConfig.bind(this)
        );
    }

    async getConfig(req, res) {
        const { fileName } = req.params;
        const userId = req.user?.id;

        if (!fileName || !userId) {
            return res.status(400).json(response.setResponse(400, 'Missing file name or user info', 'BadRequest', {}, 'ConfigManager'));
        }

        const filePath = path.join(this.configDir, fileName);
        const lockKey = `${this.lockPrefix}${fileName}`;

        try {
            const existingLock = await this.redis.get(lockKey);

            if (!existingLock) {
                await this.redis.set(lockKey, userId, 'EX', this.lockTTL);
            }

            const rawData = fs.readFileSync(filePath, 'utf-8');

            let parsedData;
            try {
                // Try parsing only if the file looks like JSON (starts with { or [)
                if (rawData.trim().startsWith('{') || rawData.trim().startsWith('[')) {
                    parsedData = JSON.parse(rawData);
                } else {
                    parsedData = rawData;
                }
            } catch (jsonErr) {
                // If parsing fails, treat as plain text
                parsedData = rawData;
            }

            const locked = existingLock && existingLock !== userId;
            const result = {
                data: parsedData,
                lock: !!locked,
            };

            res.status(200).json(result);
        } catch (err) {
            console.error('getConfig error:', err.message);
            res.status(500).json(response.setResponse(500, 'Error reading file', err.message, {}, 'ConfigManager'));
        }
    }

    async saveConfig(req, res) {
        const { fileName, content } = req.body;
        const userId = req.user?.id;
    
        if (!fileName || !content || !userId) {
            return res.status(400).json(
                response.setResponse(400, 'Missing required fields', 'BadRequest', {}, 'ConfigManager')
            );
        }
    
        const filePath = path.join(this.configDir, fileName);
        const backupPath = path.join(this.configDir, `${fileName}.${Date.now()}.bak`);
        const lockKey = `${this.lockPrefix}${fileName}`;
        const fileExtension = path.extname(fileName);
    
        try {
            const lockOwner = await this.redis.get(lockKey);
    
            if (lockOwner !== userId) {
                return res.status(403).json(
                    response.setResponse(403, 'You do not own the lock for this config file', 'Forbidden', {}, 'ConfigManager')
                );
            }
    
            // Backup existing file
            if (fs.existsSync(filePath)) {
                fs.copyFileSync(filePath, backupPath);
            }
    
            // Write based on file type
            if (fileExtension === '.json') {
                fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf-8');
            } else if (fileExtension === '.dsl') {
                if (typeof content !== 'string') {
                    return res.status(400).json(
                        response.setResponse(400, '.dsl content must be plain text string', 'BadRequest', {}, 'ConfigManager')
                    );
                }
                fs.writeFileSync(filePath, content, 'utf-8');
            } else {
                return res.status(400).json(
                    response.setResponse(400, 'Unsupported file type', 'BadRequest', {}, 'ConfigManager')
                );
            }
    
            await this.redis.del(lockKey); // Release lock after save
    
            return res.status(200).json(
                response.setResponse(200, 'Configuration saved successfully', '', {}, 'ConfigManager')
            );
        } catch (err) {
            console.error('saveConfig error:', err.message);
            res.status(500).json(
                response.setResponse(500, 'Failed to save config file', err.message, {}, 'ConfigManager')
            );
        }
    }
    
    
}

module.exports = ConfigManager;
// This module manages configuration files, allowing for retrieval and saving of JSON files.