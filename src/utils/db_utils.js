/**
 * Database Utilities
 * 
 * Utilities for database operations in ML analytics
 */

const fs = require('fs');
const path = require('path');

/**
 * Ensure a database index exists
 * 
 * @param {Object} connection - Database connection
 * @param {string} tableName - Table name
 * @param {string} indexName - Index name
 * @param {string} indexDefinition - Index definition
 * @returns {Promise<boolean>} - Whether the index was created
 */
async function ensureIndexExists(connection, tableName, indexName, indexDefinition) {
    try {
        // Check if index exists
        const [existingIndexes] = await connection.query(
            `SHOW INDEX FROM ${tableName} WHERE Key_name = ?`,
            [indexName]
        );
        
        if (existingIndexes.length === 0) {
            console.log(`Creating index ${indexName} on ${tableName}`);
            await connection.query(
                `CREATE INDEX ${indexName} ON ${tableName} (${indexDefinition})`
            );
            return true;
        }
        return false;
    } catch (error) {
        console.error(`Error checking/creating index ${indexName}:`, error);
        return false;
    }
}

/**
 * Log training metrics
 * 
 * @param {string} modelKey - Model key
 * @param {Object} metrics - Training metrics
 */
function logTrainingMetrics(modelKey, metrics) {
    try {
        const logDir = path.join(process.cwd(), 'logs');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        const logPath = path.join(logDir, 'training_logs.json');
        const logEntry = {
            timestamp: new Date().toISOString(),
            modelKey,
            ...metrics
        };

        // Append to log file
        fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n');
    } catch (error) {
        console.error('Error logging training metrics:', error);
    }
}

/**
 * Query database with pagination
 * 
 * @param {Object} connection - Database connection
 * @param {string} tableName - Table name
 * @param {Object} options - Query options
 * @returns {Promise<Object>} - Paginated results
 */
async function queryWithPagination(connection, tableName, options = {}) {
    const {
        page = 1,
        pageSize = 100,
        where = '',
        orderBy = 'id',
        direction = 'ASC',
        fields = '*'
    } = options;
    
    const offset = (page - 1) * pageSize;
    
    try {
        // Build WHERE clause
        const whereClause = where ? `WHERE ${where}` : '';
        
        // Execute paginated query
        const [rows] = await connection.query(
            `SELECT ${fields} FROM ${tableName} ${whereClause} ORDER BY ${orderBy} ${direction} LIMIT ? OFFSET ?`,
            [pageSize, offset]
        );
        
        // Get total count
        const [countResult] = await connection.query(
            `SELECT COUNT(*) as total FROM ${tableName} ${whereClause}`
        );
        const total = countResult[0].total;
        
        return {
            data: rows,
            pagination: {
                page,
                pageSize,
                totalPages: Math.ceil(total / pageSize),
                totalItems: total
            }
        };
    } catch (error) {
        console.error(`Error querying ${tableName} with pagination:`, error);
        throw error;
    }
}

/**
 * Stream data from database in chunks
 * 
 * @param {Object} connection - Database connection
 * @param {string} tableName - Table name
 * @param {Function} callback - Callback for each chunk
 * @param {Object} options - Stream options
 * @returns {Promise<void>}
 */
async function streamData(connection, tableName, callback, options = {}) {
    const {
        chunkSize = 100,
        where = '',
        orderBy = 'id',
        fields = '*'
    } = options;
    
    try {
        // Build WHERE clause
        const whereClause = where ? `WHERE ${where}` : '';
        
        // Get total count
        const [countResult] = await connection.query(
            `SELECT COUNT(*) as total FROM ${tableName} ${whereClause}`
        );
        const total = countResult[0].total;
        
        // Stream data in chunks
        let processed = 0;
        let page = 1;
        
        while (processed < total) {
            const queryOptions = {
                page,
                pageSize: chunkSize,
                where,
                orderBy,
                fields
            };
            
            const result = await queryWithPagination(connection, tableName, queryOptions);
            const rows = result.data;
            
            if (rows.length === 0) break;
            
            // Process chunk
            await callback(rows, {
                processed,
                total,
                page,
                progress: Math.round((processed / total) * 100)
            });
            
            processed += rows.length;
            page++;
        }
    } catch (error) {
        console.error(`Error streaming data from ${tableName}:`, error);
        throw error;
    }
}

/**
 * Execute database query with exponential backoff retry
 * 
 * @param {Object} connection - Database connection
 * @param {string} query - SQL query
 * @param {Array} params - Query parameters
 * @param {Object} options - Retry options
 * @returns {Promise<Object>} - Query results
 */
async function executeQueryWithRetry(connection, query, params = [], options = {}) {
    const {
        maxRetries = 3,
        initialDelay = 500,
        maxDelay = 10000
    } = options;
    
    let retries = 0;
    let delay = initialDelay;
    
    while (true) {
        try {
            return await connection.query(query, params);
        } catch (error) {
            // Check if error is retryable
            const isRetryable = isRetryableError(error);
            
            if (!isRetryable || retries >= maxRetries) {
                throw error;
            }
            
            // Exponential backoff
            retries++;
            const jitter = Math.random() * 200 - 100; // ±100ms jitter
            delay = Math.min(delay * 2, maxDelay) + jitter;
            
            console.warn(`Database query failed, retrying (${retries}/${maxRetries}) in ${delay}ms:`, error.message);
            
            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

/**
 * Check if a database error is retryable
 * 
 * @param {Error} error - Database error
 * @returns {boolean} - Whether the error is retryable
 */
function isRetryableError(error) {
    // Common retryable MySQL/MariaDB error codes
    const retryableErrorCodes = [
        'PROTOCOL_CONNECTION_LOST',
        'ECONNRESET',
        'ECONNREFUSED',
        'ETIMEDOUT',
        'ER_LOCK_DEADLOCK',
        'ER_LOCK_WAIT_TIMEOUT',
        'ER_TOO_MANY_CONNECTIONS'
    ];
    
    if (!error) return false;
    
    return (
        retryableErrorCodes.includes(error.code) ||
        error.message.includes('deadlock') ||
        error.message.includes('lock wait timeout') ||
        error.message.includes('connection') ||
        error.message.includes('timeout')
    );
}

/**
 * Check table schema and create missing columns if needed
 * 
 * @param {Object} connection - Database connection
 * @param {string} tableName - Table name
 * @param {Object} schemaDefinition - Schema definition
 * @returns {Promise<Object>} - Schema update results
 */
async function ensureTableSchema(connection, tableName, schemaDefinition) {
    try {
        // Get existing columns
        const [columns] = await connection.query(
            `SHOW COLUMNS FROM ${tableName}`
        );
        
        const existingColumns = columns.map(col => col.Field);
        const missingColumns = [];
        const results = {
            existingColumns,
            addedColumns: [],
            errors: []
        };
        
        // Check for missing columns
        for (const [columnName, definition] of Object.entries(schemaDefinition)) {
            if (!existingColumns.includes(columnName)) {
                missingColumns.push({
                    name: columnName,
                    definition
                });
            }
        }
        
        // Add missing columns
        for (const column of missingColumns) {
            try {
                await connection.query(
                    `ALTER TABLE ${tableName} ADD COLUMN ${column.name} ${column.definition}`
                );
                console.log(`Added column ${column.name} to ${tableName}`);
                results.addedColumns.push(column.name);
            } catch (error) {
                console.error(`Error adding column ${column.name} to ${tableName}:`, error);
                results.errors.push({
                    column: column.name,
                    error: error.message
                });
            }
        }
        
        return results;
    } catch (error) {
        console.error(`Error checking schema for ${tableName}:`, error);
        throw error;
    }
}

/**
 * Create a database backup
 * 
 * @param {Object} connection - Database connection
 * @param {string} tableName - Table name
 * @param {string} backupDir - Backup directory
 * @returns {Promise<string>} - Path to backup file
 */
async function createBackup(connection, tableName, backupDir = './backups') {
    try {
        // Ensure backup directory exists
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }
        
        // Generate backup filename with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFile = path.join(backupDir, `${tableName}_${timestamp}.json`);
        
        // Query all data
        const [rows] = await connection.query(`SELECT * FROM ${tableName}`);
        
        // Write to backup file
        fs.writeFileSync(backupFile, JSON.stringify(rows, null, 2));
        
        console.log(`Backup created: ${backupFile}`);
        return backupFile;
    } catch (error) {
        console.error(`Error creating backup for ${tableName}:`, error);
        throw error;
    }
}

/**
 * Update ML model predictions in database
 * 
 * @param {Object} connection - Database connection
 * @param {string} tableName - Table name
 * @param {Array} predictions - Model predictions
 * @param {Object} options - Update options
 * @returns {Promise<Object>} - Update results
 */
async function updatePredictions(connection, tableName, predictions, options = {}) {
    const {
        idField = 'id',
        predictionColumns = {},
        batchSize = 100,
        createBackup: shouldBackup = true
    } = options;
    
    try {
        // Create backup if requested
        if (shouldBackup) {
            await createBackup(connection, tableName);
        }
        
        // Ensure prediction columns exist
        const columns = {};
        for (const [key, definition] of Object.entries(predictionColumns)) {
            columns[key] = definition;
        }
        
        await ensureTableSchema(connection, tableName, columns);
        
        // Process predictions in batches
        const results = {
            total: predictions.length,
            updated: 0,
            failed: 0,
            errors: []
        };
        
        // Create batches
        const batches = [];
        for (let i = 0; i < predictions.length; i += batchSize) {
            batches.push(predictions.slice(i, i + batchSize));
        }
        
        // Process each batch
        for (const batch of batches) {
            try {
                // Start transaction
                await connection.beginTransaction();
                
                for (const prediction of batch) {
                    const updateValues = {};
                    
                    // Extract values for each column
                    for (const column of Object.keys(predictionColumns)) {
                        if (prediction[column] !== undefined) {
                            updateValues[column] = prediction[column];
                        }
                    }
                    
                    // Skip if no values to update
                    if (Object.keys(updateValues).length === 0) continue;
                    
                    // Build update query
                    const setClause = Object.entries(updateValues)
                        .map(([column, _]) => `${column} = ?`)
                        .join(', ');
                    
                    const params = [
                        ...Object.values(updateValues),
                        prediction[idField]
                    ];
                    
                    // Execute update
                    const [result] = await connection.query(
                        `UPDATE ${tableName} SET ${setClause} WHERE ${idField} = ?`,
                        params
                    );
                    
                    results.updated += result.affectedRows;
                }
                
                // Commit transaction
                await connection.commit();
            } catch (error) {
                // Rollback transaction on error
                await connection.rollback();
                
                console.error(`Error updating batch in ${tableName}:`, error);
                results.failed += batch.length;
                results.errors.push(error.message);
            }
        }
        
        return results;
    } catch (error) {
        console.error(`Error updating predictions in ${tableName}:`, error);
        throw error;
    }
}

module.exports = {
    ensureIndexExists,
    logTrainingMetrics,
    queryWithPagination,
    streamData,
    executeQueryWithRetry,
    isRetryableError,
    ensureTableSchema,
    createBackup,
    updatePredictions
};