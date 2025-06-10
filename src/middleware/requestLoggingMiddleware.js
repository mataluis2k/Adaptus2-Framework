const { getDbConnection, query } = require('../modules/db');
const logger = require('../modules/logger');
const eventLogger = require('../modules/EventLogger');
const crypto = require('crypto');

class RequestLogger {
    constructor() {
        this.enabled = process.env.REQUEST_LOGGING_ENABLED === 'true';
        this.encryptPayload = process.env.REQUEST_LOGGING_ENCRYPT === 'true';
        this.encryptionKey = process.env.REQUEST_LOGGING_ENCRYPTION_KEY;
        this.tableName = process.env.REQUEST_LOGGING_TABLE || 'request_logs';
        this.dbConfig = {
            dbType: process.env.DEFAULT_DBTYPE,
            dbConnection: process.env.DEFAULT_DBCONNECTION
        };
        this.dbName = process.env[`${this.dbConfig.dbConnection}_DB`] || 'adaptus2';
        if (this.enabled) {
            this.initialize();
        }
    }

    async initialize() {
        try {
            // Check if table exists
            const tableExistsQuery = {
                text: 'SELECT 1 FROM information_schema.tables WHERE  table_schema = ? AND table_name = ?',
                values: [this.dbName, this.tableName]
            };

            const connection = await getDbConnection(this.dbConfig);
            const result = await query(this.dbConfig, tableExistsQuery.text, tableExistsQuery.values);

            if (result.length === 0) {
                await this.createLoggingTable();
            }
        } catch (error) {
            logger.error('Failed to initialize request logging:', error);
        }
    }

    async createLoggingTable() {
        const createTableQuery = {
            text: `CREATE TABLE ${this.tableName} (
                id BIGINT PRIMARY KEY AUTO_INCREMENT,
                request_id VARCHAR(36) NOT NULL,
                timestamp_start TIMESTAMP(6) NOT NULL,
                timestamp_end TIMESTAMP(6) NOT NULL,
                method VARCHAR(10) NOT NULL,
                url TEXT NOT NULL,
                path TEXT NOT NULL,
                query_params TEXT,
                headers TEXT,
                body TEXT,
                response_body TEXT,
                response_status INT,
                ip_address VARCHAR(45),
                user_agent TEXT,
                user_id VARCHAR(255),
                duration_ms INT,
                encrypted BOOLEAN DEFAULT false,
                INDEX idx_request_id (request_id),
                INDEX idx_timestamp_start (timestamp_start),
                INDEX idx_method (method),
                INDEX idx_status (response_status),
                INDEX idx_user_id (user_id)
            )`,
            values: []
        };

        try {
            await query(this.dbConfig, createTableQuery.text);
            logger.info(`Created request logging table: ${this.tableName}`);
        } catch (error) {
            logger.error('Failed to create request logging table:', error);
            throw error;
        }
    }

    encrypt(data) {
        if (!this.encryptionKey) {
            throw new Error('Encryption key not configured');
        }

        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(this.encryptionKey, 'hex'), iv);

        let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
        encrypted += cipher.final('hex');

        const authTag = cipher.getAuthTag();

        // Return IV, encrypted data, and auth tag as a single string
        return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    }

    decrypt(encryptedData) {
        if (!this.encryptionKey) {
            throw new Error('Encryption key not configured');
        }

        const [ivHex, authTagHex, encryptedText] = encryptedData.split(':');

        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(this.encryptionKey, 'hex'), iv);

        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return JSON.parse(decrypted);
    }
    formatForMySQL(date) {
        if (!(date instanceof Date)) return null;
        return date.toISOString().slice(0, 23).replace('T', ' ');
    }

    middleware() {
        return async (req, res, next) => {
            if (!this.enabled) {
                return next();
            }

            const requestId = crypto.randomUUID();
            const startTime = process.hrtime();
            const startTimestamp = new Date();

            // Capture the original response methods
            const originalSend = res.send;
            const originalJson = res.json;
            let responseBody;

            // Helper function to safely add requestId to response
            const addRequestId = (body) => {
                if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
                    return { ...body, requestId };
                }
                return body;
            };

            // Override response methods to capture and modify the response body
            res.send = function (body) {
                responseBody = body;
                const modifiedBody = addRequestId(body);
                return originalSend.call(this, modifiedBody);
            };

            res.json = function (body) {
                const modifiedBody = addRequestId(body);
                responseBody = JSON.stringify(modifiedBody);
                return originalJson.call(this, modifiedBody);
            };

            res.on('finish', async () => {
                try {
                    const endTimestamp = new Date();
                    const [seconds, nanoseconds] = process.hrtime(startTime);
                    const durationMs = seconds * 1000 + nanoseconds / 1000000;

                    // Helper function to safely stringify data
                    const safeStringify = (data) => {
                        if (typeof data === 'string') return data;
                        try {
                            return JSON.stringify(data);
                        } catch (e) {
                            return String(data);
                        }
                    };

                    let requestBody = req.body;
                    let responseData = responseBody;

                    // Ensure data is stringified before encryption
                    if (Object.keys(requestBody || {}).length > 0) {
                        requestBody = safeStringify(requestBody);
                    }
                    if (responseData) {
                        responseData = safeStringify(responseData);
                    }

                    // Encrypt data if enabled
                    if (this.encryptPayload) {
                        if (requestBody) {
                            requestBody = this.encrypt(requestBody);
                        }
                        if (responseData) {
                            responseData = this.encrypt(responseData);
                        }
                    }

                    const logData = {
                        request_id: requestId,
                        timestamp_start: this.formatForMySQL(startTimestamp),
                        timestamp_end: this.formatForMySQL(endTimestamp),
                        method: req.method,
                        url: req.originalUrl,
                        path: req.path,
                        query_params: JSON.stringify(req.query),
                        headers: JSON.stringify(req.headers),
                        body: requestBody || null,
                        response_body: responseData || null,
                        response_status: res.statusCode,
                        ip_address: req.ip,
                        user_agent: req.get('user-agent'),
                        user_id: req.user?.id || null,
                        duration_ms: Math.round(durationMs),
                        encrypted: this.encryptPayload
                    };

                    try {
                        await eventLogger.log(this.dbConfig, this.tableName, logData);
                    } catch (e) {
                        logger.error('EventLogger failed to queue request log:', e);
                    }


                } catch (error) {
                    logger.error('Failed to log request:', error);
                }
            });

            next();
        };
    }

    async getRequestLog(requestId) {
        try {
            const selectQuery = {
                text: `SELECT * FROM ${this.tableName} WHERE request_id = ?`,
                values: [requestId]
            };

            const results = await query(this.dbConfig, selectQuery.text, selectQuery.values);

            // Handle empty results or non-array results safely
            if (!results || !Array.isArray(results) || results.length === 0) {
                return null;
            }

            const log = results[0];

            // Decrypt data if encrypted
            if (log.encrypted) {
                if (log.body) {
                    log.body = this.decrypt(log.body);
                }
                if (log.response_body) {
                    log.response_body = this.decrypt(log.response_body);
                }
            } else {
                // Parse JSON strings
                if (log.body) {
                    log.body = JSON.parse(log.body);
                }
                if (log.response_body) {
                    log.response_body = JSON.parse(log.response_body);
                }
            }

            return log;
        } catch (error) {
            logger.error('Failed to retrieve request log:', error);
            throw error;
        }
    }

    async cleanup(olderThan) {
        try {
            const deleteQuery = {
                text: `DELETE FROM ${this.tableName} WHERE timestamp_start < ?`,
                values: [olderThan]
            };

            const result = await query(this.dbConfig, deleteQuery.text, deleteQuery.values);
            return result.affectedRows;
        } catch (error) {
            logger.error('Failed to cleanup request logs:', error);
            throw error;
        }
    }

    async getLogsCount() {
        try {
            const countQuery = {
                text: `SELECT COUNT(*) as count FROM ${this.tableName}`,
                values: []
            };

            const [result] = await query(this.dbConfig, countQuery.text, countQuery.values);
            return result.count;
        } catch (error) {
            logger.error('Failed to get logs count:', error);
            throw error;
        }
    }

    async getLogsByTimeRange(startTime, endTime) {
        try {
            const selectQuery = {
                text: `SELECT * FROM ${this.tableName}
                      WHERE timestamp_start BETWEEN ? AND ?
                      ORDER BY timestamp_start DESC`,
                values: [startTime, endTime]
            };

            const logs = await query(this.dbConfig, selectQuery.text, selectQuery.values);
            return logs.map(log => this.processLogForOutput(log));
        } catch (error) {
            logger.error('Failed to get logs by time range:', error);
            throw error;
        }
    }

    async getLogsByStatusCode(statusCode) {
        try {
            const selectQuery = {
                text: `SELECT * FROM ${this.tableName}
                      WHERE response_status = ?
                      ORDER BY timestamp_start DESC`,
                values: [statusCode]
            };

            const logs = await query(this.dbConfig, selectQuery.text, selectQuery.values);
            return logs.map(log => this.processLogForOutput(log));
        } catch (error) {
            logger.error('Failed to get logs by status code:', error);
            throw error;
        }
    }

    async getLogsByUserId(userId) {
        try {
            const selectQuery = {
                text: `SELECT * FROM ${this.tableName}
                      WHERE user_id = ?
                      ORDER BY timestamp_start DESC`,
                values: [userId]
            };

            const logs = await query(this.dbConfig, selectQuery.text, selectQuery.values);
            return logs.map(log => this.processLogForOutput(log));
        } catch (error) {
            logger.error('Failed to get logs by user ID:', error);
            throw error;
        }
    }

    processLogForOutput(log) {
        try {
            // Decrypt and parse data if encrypted
            if (log.encrypted) {
                if (log.body) {
                    log.body = this.decrypt(log.body);
                }
                if (log.response_body) {
                    log.response_body = this.decrypt(log.response_body);
                }
            } else {
                // Parse JSON strings
                if (log.body) {
                    log.body = JSON.parse(log.body);
                }
                if (log.response_body) {
                    log.response_body = JSON.parse(log.response_body);
                }
            }

            // Parse other JSON fields
            if (log.query_params) {
                log.query_params = JSON.parse(log.query_params);
            }
            if (log.headers) {
                log.headers = JSON.parse(log.headers);
            }

            return log;
        } catch (error) {
            logger.error('Failed to process log for output:', error);
            return log; // Return raw log if processing fails
        }
    }
}

// Export singleton instance
module.exports = new RequestLogger();
