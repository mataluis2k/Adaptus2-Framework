const jwt = require('jsonwebtoken');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { validate } = require('jsonschema');
const crypto = require('crypto');
const { getDbConnection, query } = require('../src/modules/db');
const logger = require('../src/modules/logger');

// Constants
const MAX_PAYLOAD_SIZE = '1mb';
const TABLE_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const COLUMN_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const MAX_COLUMNS = 100;

// Rate limiting configuration
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later'
});

// Schema for webhook payload validation
const payloadSchema = {
    type: 'object',
    additionalProperties: true, // Allow dynamic properties
    maxProperties: MAX_COLUMNS,
    propertyNames: {
        pattern: '^[a-zA-Z][a-zA-Z0-9_]{0,63}$' // Match COLUMN_NAME_PATTERN
    }
};

class WebhookError extends Error {
    constructor(message, statusCode = 500) {
        super(message);
        this.name = 'WebhookError';
        this.statusCode = statusCode;
    }
}

class AuthError extends Error {
    constructor(message) {
        super(message);
        this.name = 'AuthError';
        this.statusCode = 401;
    }
}

// Define audit log table schema
const AUDIT_LOG_SCHEMA = {
    routeType: 'def',
    dbType: process.env.DEFAULT_DBTYPE || 'mysql',
    dbConnection: process.env.DEFAULT_DBCONNECTION || 'MYSQL_1',
    dbTable: 'webhook_audit_log',
    allowWrite: ['action', 'table_name', 'request_id', 'rows_affected'],
    allowRead: ['id', 'action', 'table_name', 'request_id', 'rows_affected', 'created_at'],
    keys: ['id'],
    acl: ['adminAccess'],
    cache: 0,
    columnDefinitions: {
        id: 'INT NOT NULL AUTO_INCREMENT PRIMARY KEY',
        action: 'VARCHAR(50) NOT NULL',
        table_name: 'VARCHAR(64) NOT NULL',
        request_id: 'VARCHAR(36) NOT NULL',
        rows_affected: 'INT DEFAULT 0',
        created_at: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP'
    }
};

module.exports = {
    name: 'catchAllWebhookPlugin',
    version: '1.0.0',

    async initialize(dependencies) {
        logger.info('Initializing catchAllWebhookPlugin...');
        
        // Initialize audit log table
        const dbConfig = {
            dbType: process.env.DEFAULT_DBTYPE,
            dbConnection: process.env.DEFAULT_DBCONNECTION
        };
        const dbName = process.env[`${this.dbConfig.dbConnection}_DB`] || 'adaptus2';
        try {
            // Check if audit log table exists
            const tableExistsQuery = {
                text: 'SELECT 1 FROM information_schema.tables WHERE  table_schema = ? AND table_name = ?',
                values: [dbName, 'webhook_audit_log']
            };
            const result = await query(dbConfig, tableExistsQuery.text, tableExistsQuery.values);
            
            if (result.length === 0) {
                logger.info('Creating webhook_audit_log table...');
                
                // Create audit log table with proper schema
                const createTableQuery = {
                    text: `CREATE TABLE webhook_audit_log (
                        id INT PRIMARY KEY AUTO_INCREMENT,
                        action VARCHAR(50) NOT NULL,
                        table_name VARCHAR(64) NOT NULL,
                        request_id VARCHAR(36) NOT NULL,
                        rows_affected INT DEFAULT 0,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        INDEX idx_request_id (request_id),
                        INDEX idx_table_name (table_name)
                    )`,
                    values: []
                };
                
                await query(dbConfig, createTableQuery.text, createTableQuery.values);
                logger.info('webhook_audit_log table created successfully');
            }
        } catch (error) {
            logger.error('Failed to initialize webhook_audit_log table:', error);
            // Don't throw - allow plugin to continue even if audit table creation fails
        }
    },

    registerRoutes({ app }) {
        const routes = [];
        const routePath = '/webhook/catch-all';

        // Apply middleware
        app.use(routePath, [
            limiter,
            express.json({ 
                limit: MAX_PAYLOAD_SIZE,
                verify: (req, res, buf) => {
                    // Verify webhook signature if secret is configured
                    if (process.env.WEBHOOK_SECRET) {
                        const signature = req.get('X-Webhook-Signature');
                        if (!signature) {
                            throw new AuthError('Webhook signature missing');
                        }
                        const hmac = crypto.createHmac('sha256', process.env.WEBHOOK_SECRET);
                        const digest = hmac.update(buf).digest('hex');
                        if (signature !== digest) {
                            throw new AuthError('Invalid webhook signature');
                        }
                    }
                }
            })
        ]);

        app.post(routePath, async (req, res) => {
            const requestId = crypto.randomUUID();
            const startTime = Date.now();

            try {
                logger.info('Processing webhook request', { requestId });

                // Authentication
                const token = authenticateRequest(req);
                const { tableName, permissions } = await validateToken(token);
                
                // Validate table name
                if (!TABLE_NAME_PATTERN.test(tableName)) {
                    throw new WebhookError('Invalid table name format', 400);
                }

                // Validate payload
                validatePayload(req.body);

                const dbConfig = getDbConfig();

                // Check table existence and permissions
                await validateTableAccess(dbConfig, tableName, permissions);

                // Start transaction
                const connection = await getDbConnection(dbConfig);
                await connection.beginTransaction();

                try {
                    // Process request
                    if (await tableExists(dbConfig, tableName)) {
                        await insertDataSecurely(dbConfig, tableName, req.body, requestId);
                    } else {
                        await createTableSecurely(dbConfig, tableName, req.body, requestId);
                        await insertDataSecurely(dbConfig, tableName, req.body, requestId);
                    }

                    // Commit transaction
                    await connection.commit();

                    const duration = Date.now() - startTime;
                    logger.info('Successfully processed webhook', { 
                        requestId, 
                        duration,
                        tableName
                    });

                    res.status(200).json({ 
                        message: 'Request processed successfully',
                        requestId
                    });
                } catch (error) {
                    // Rollback transaction on error
                    await connection.rollback();
                    throw error;
                }
            } catch (error) {
                handleError(error, res, requestId);
            }
        });

        routes.push({ method: 'post', path: routePath });
        return routes;
    },

    async cleanup() {
        logger.info('Cleaning up catchAllWebhookPlugin...');
    },

    // Get the audit log table schema for API configuration
    getSchema() {
        return AUDIT_LOG_SCHEMA;
    }
};

// Helper functions
function authenticateRequest(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new AuthError('Invalid authorization header format');
    }
    const token = authHeader.split(' ')[1];
    if (!token) {
        throw new AuthError('Authorization token missing');
    }
    return token;
}

async function validateToken(token) {
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log('Decoded token:', decoded);
        if (!decoded.table || !decoded.permissions) {
            throw new WebhookError('Invalid token payload: missing required claims', 400);
        }
        return {
            tableName: decoded.table,
            permissions: decoded.permissions
        };
    } catch (error) {
        if (error instanceof jwt.JsonWebTokenError) {
            throw new AuthError('Invalid or expired token');
        }
        throw error;
    }
}

function validatePayload(data) {
    const validation = validate(data, payloadSchema);
    if (!validation.valid) {
        const errors = validation.errors.map(err => err.stack).join('; ');
        throw new WebhookError(`Invalid payload: ${errors}`, 400);
    }
}

function getDbConfig() {
    return {
        dbType: process.env.DEFAULT_DBTYPE,
        dbConnection: process.env.DEFAULT_DBCONNECTION
    };
}

async function validateTableAccess(dbConfig, tableName, permissions) {
    try {
        // First check if table exists
        const exists = await tableExists(dbConfig, tableName);
        
        // If table doesn't exist and user doesn't have create permission
        if (!exists && !permissions.includes('table_create')) {
            throw new WebhookError('Table does not exist and no permission to create', 403);
        }

        // If table exists, check if user has write permission
        if (exists && !permissions.includes('table_write')) {
            throw new WebhookError('No permission to write to this table', 403);
        }

        return true;
    } catch (error) {
        if (error instanceof WebhookError) {
            throw error;
        }
        logger.error('Error validating table access:', error);
        throw new WebhookError('Failed to validate table access', 500);
    }
}

async function tableExists(dbConfig, tableName) {
    try {
        const sql = {
            text: 'SELECT 1 FROM information_schema.tables WHERE table_name = ?',
            values: [tableName]
        };
        const result = await query(dbConfig, sql.text, sql.values);
        return result.length > 0;
    } catch (error) {
        logger.error('Error checking table existence', { error, tableName });
        throw new WebhookError('Failed to check table existence');
    }
}

async function createTableSecurely(dbConfig, tableName, data, requestId) {
    try {
        // Validate and sanitize column definitions
        const columns = Object.entries(data).map(([key, value]) => {
            if (!COLUMN_NAME_PATTERN.test(key)) {
                throw new WebhookError(`Invalid column name: ${key}`, 400);
            }
            const type = inferDataType(value);
            return `\`${key}\` ${type}`;
        });

        columns.push('`created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
        columns.push('`updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');

        // Escape table name properly
        const createQuery = {
            text: `CREATE TABLE IF NOT EXISTS \`${tableName}\` (
                id INT PRIMARY KEY AUTO_INCREMENT,
                ${columns.join(',\n')}
            )`,
            values: []
        };

        await query(dbConfig, createQuery.text);
        logger.info('Table created successfully', { requestId, tableName });
        
        // Create audit log entry
        await createAuditLog(dbConfig, {
            action: 'CREATE_TABLE',
            tableName,
            requestId
        });

    } catch (error) {
        logger.error('Failed to create table', { error, tableName, requestId });
        throw new WebhookError(`Failed to create table: ${error.message}`);
    }
}

async function insertDataSecurely(dbConfig, tableName, data, requestId) {
    try {
        // Validate column names and prepare data
        const columnNames = Object.keys(data).filter(key => 
            COLUMN_NAME_PATTERN.test(key)
        );

        if (columnNames.length === 0) {
            throw new WebhookError('No valid columns to insert', 400);
        }

        const values = columnNames.map(key => {
            const value = data[key];
            // Format datetime values for MySQL
            if (typeof value === 'string' && !isNaN(Date.parse(value))) {
                const date = new Date(value);
                return date.toISOString().slice(0, 19).replace('T', ' ');
            }
            return value;
        });
        // Escape table name and column names properly
        const escapedColumns = columnNames.map(col => `\`${col}\``);
        const insertQuery = {
            text: `INSERT INTO \`${tableName}\` (${escapedColumns.join(', ')}) VALUES (${columnNames.map(() => '?').join(', ')})`,
            values: values
        };

        const result = await query(dbConfig, insertQuery.text, insertQuery.values);
        logger.info('Data inserted successfully', { 
            requestId, 
            tableName, 
            rowCount: result.affectedRows 
        });

        // Create audit log entry
        await createAuditLog(dbConfig, {
            action: 'INSERT_DATA',
            tableName,
            requestId,
            rowsAffected: result.affectedRows
        });

        return result;
    } catch (error) {
        logger.error('Failed to insert data', { error, tableName, requestId });
        throw new WebhookError(`Failed to insert data: ${error.message}`);
    }
}

async function createAuditLog(dbConfig, logData) {
    try {
        // Use the schema's allowWrite fields to ensure consistency
        const validData = {
            action: logData.action,
            table_name: logData.tableName,
            request_id: logData.requestId,
            rows_affected: logData.rowsAffected || 0
        };

        // Validate data against schema's allowWrite fields
        const allowedFields = AUDIT_LOG_SCHEMA.allowWrite;
        const columnNames = Object.keys(validData).filter(key => 
            allowedFields.includes(key)
        );
        
        if (columnNames.length === 0) {
            throw new Error('No valid columns to insert in audit log');
        }

        const values = columnNames.map(key => validData[key]);
        const escapedColumns = columnNames.map(col => `\`${col}\``);
        const auditQuery = {
            text: `INSERT INTO \`webhook_audit_log\` (${escapedColumns.join(', ')}) VALUES (${columnNames.map(() => '?').join(', ')})`,
            values: values
        };

        await query(dbConfig, auditQuery.text, auditQuery.values);
        logger.debug('Audit log created', { 
            action: logData.action, 
            tableName: logData.tableName 
        });
    } catch (error) {
        logger.error('Failed to create audit log', { 
            error: error.message,
            action: logData.action,
            tableName: logData.tableName
        });
        // Don't throw - audit log failure shouldn't fail the main operation
    }
}

function inferDataType(value) {
    if (value === null || value === undefined) {
        return 'TEXT';
    }

    switch (typeof value) {
        case 'number':
            if (Number.isInteger(value)) {
                if (value > 2147483647 || value < -2147483648) {
                    return 'BIGINT';
                }
                return 'INT';
            }
            return 'DOUBLE';
        case 'boolean':
            return 'TINYINT(1)';
        case 'string':
            if (value.length > 255) {
                return 'TEXT';
            }
            // Check if it's a date with timezone
            if (!isNaN(Date.parse(value))) {
                // Use TIMESTAMP for values with timezone to handle conversion
                if (value.includes('Z') || value.includes('+') || value.includes('-')) {
                    return 'TIMESTAMP';
                }
                return 'DATETIME';
            }
            return 'VARCHAR(255)';
        case 'object':
            if (value instanceof Date) {
                return 'DATETIME';
            }
            return 'JSON';
        default:
            return 'TEXT';
    }
}

function handleError(error, res, requestId) {
    const statusCode = error.statusCode || 500;
    const errorResponse = {
        error: error.message,
        requestId,
        type: error.name
    };

    if (process.env.NODE_ENV !== 'production') {
        errorResponse.stack = error.stack;
    }

    logger.error('Webhook processing failed', {
        error: error.message,
        stack: error.stack,
        requestId,
        statusCode
    });

    res.status(statusCode).json(errorResponse);
}
