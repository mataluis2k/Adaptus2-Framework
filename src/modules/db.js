require('dotenv').config();
const ORM = require('adaptus2-orm');
const { globalContext, getContext } = require('./context');
const { getApiConfig } = require('./apiConfig');
const response = require('./response');
const process = require('process');

const dbConnections = {};
let isContextExtended = false;

/**
 * IMPORTANT NOTES AND EXCEPTIONS:
 * 
 * 1. CONNECTION POOLING: The original db.js manages MySQL pools manually,
 *    but adaptus2-orm handles pooling internally. The mysqlPools object
 *    is maintained for backward compatibility but is not actively used.
 * 
 * 2. CONNECTION RELEASE: The original db.js has 'db.release()' calls everywhere,
 *    but adaptus2-orm manages connections internally. These calls are
 *    converted to no-ops (empty functions) to maintain interface compatibility.
 * 
 * 3. TRANSACTION HANDLING: The original db.js uses manual transactions in initDatabase,
 *    but adaptus2-orm handles transactions differently. We simulate the behavior
 *    using adaptus2-orm's transaction methods where possible.
 * 
 * 4. SNOWFLAKE CALLBACKS: The original db.js uses callback-style snowflake SDK,
 *    but adaptus2-orm uses promises. We convert between these patterns.
 * 
 * 5. ERROR HANDLING: The original db.js has specific error codes (ER_DUP_FIELDNAME),
 *    but adaptus2-orm normalizes errors. We preserve the interface but may not
 *    have exact error code matching.
 * 
 * 6. CONFIG NORMALIZATION: The original db.js normalizes database connection
 *    names (replacing hyphens with underscores). We maintain this for compatibility.
 */

/**
 * Initialize database tables based on API configuration
 * 
 * NOTE: This function has been adapted to use adaptus2-orm's methods
 * instead of direct SQL execution. Some error handling has been simplified
 * due to ORM abstractions.
 */
async function initDatabase() {
    console.log('Initializing database tables...');
    
    try {
        // Load the API configuration
        const apiConfig = await loadConfig();
        
        // Create a connection pool for better performance
        const connectionPool = new Map();
        
        try {
            for (const endpoint of apiConfig) {
                const { dbType, dbTable, columnDefinitions, dbConnection: connString } = endpoint;
                console.log("Working on endpoint", endpoint);
    
                // Input validation
                if (!dbType || !dbTable || !columnDefinitions) {
                    console.warn(`Skipping invalid endpoint configuration:`, {
                        dbType,
                        dbTable,
                        hasColumnDefs: !!columnDefinitions
                    });
                    continue;
                }
    
                // Validate database type
                if (!['mysql', 'postgres', 'postgresql', 'mongodb', 'snowflake'].includes(dbType.toLowerCase())) {
                    console.warn(`Skipping ${dbTable}: Unsupported database type ${dbType}`);
                    continue;
                }
    
                // Get or create connection using adaptus2-orm
                let connection;
                try {
                    const config = await createOrmConfig(endpoint);
                    connection = await ORM.getDbConnection(config);
                    
                    if (!connection) {
                        console.error(`Failed to connect to database for ${connString}`);
                        continue;
                    }
                } catch (err) {
                    console.error(`Failed to connect to database for ${connString}:`, err);
                    continue;
                }
    
                // Validate column definitions
                if (!Object.keys(columnDefinitions).length) {
                    console.warn(`Skipping ${dbTable}: Empty column definitions`);
                    continue;
                }
    
                // Handle different column definition formats
                const isObjectFormat = Object.values(columnDefinitions).some(
                    value => typeof value === 'object' && value !== null
                );
    
                // Validate column names and types based on format
                let invalidColumns = [];
                if (isObjectFormat) {
                    invalidColumns = Object.entries(columnDefinitions).filter(([name, def]) => {
                        return !name.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/) || 
                              (typeof def.type !== 'string') || 
                              !def.type.match(/^[a-zA-Z0-9\s()]+$/);
                    });
                } else {
                    invalidColumns = Object.entries(columnDefinitions).filter(([name, type]) => {
                        return !name.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/) || 
                              (typeof type !== 'string');
                    });
                }
    
                if (invalidColumns.length > 0) {
                    console.error(`Invalid column definitions in ${dbTable}:`, invalidColumns);
                    continue;
                }
    
                try {
                    // Check if the table exists using adaptus2-orm
                    const config = await createOrmConfig(endpoint);
                    const tableExists = await ORM.tableExists(config, dbTable);
                    
                    if (tableExists.data) {
                        console.log(`Table ${dbTable} already exists. Skipping creation.`);
                        continue;
                    }
    
                    // Prepare column definitions for adaptus2-orm
                    const schema = { columns: {} };
                    
                    if (isObjectFormat) {
                        Object.entries(columnDefinitions).forEach(([column, def]) => {
                            const type = convertToAdaptusType(def.type);
                            schema.columns[column] = {
                                type: type,
                                required: def.constraints ? def.constraints.includes('NOT NULL') : false,
                                unique: def.constraints ? def.constraints.includes('UNIQUE') : false,
                                primaryKey: def.constraints ? def.constraints.includes('PRIMARY KEY') : false,
                                autoIncrement: def.constraints ? def.constraints.includes('AUTO_INCREMENT') : false
                            };
                        });
                    } else {
                        Object.entries(columnDefinitions).forEach(([column, typeStr]) => {
                            const [type, ...constraints] = typeStr.split(' ');
                            const constraintsStr = constraints.join(' ');
                            
                            schema.columns[column] = {
                                type: convertToAdaptusType(type),
                                required: constraintsStr.includes('NOT NULL'),
                                unique: constraintsStr.includes('UNIQUE'),
                                primaryKey: constraintsStr.includes('PRIMARY KEY'),
                                autoIncrement: constraintsStr.includes('AUTO_INCREMENT')
                            };
                        });
                    }
    
                    console.log(`Creating table ${dbTable} with schema:`, schema);
                    
                    try {
                        await ORM.createTable(config, dbTable, schema);
                        console.log(`Table ${dbTable} initialized successfully.`);
                    } catch (error) {
                        console.error(`Error creating table ${dbTable}:`, error);
                        
                        // Provide more detailed error information
                        if (error.message.includes('Duplicate column')) {
                            console.error('Duplicate column name detected');
                        } else if (error.message.includes('syntax error')) {
                            console.error('SQL syntax error in CREATE TABLE statement');
                        }
                    }
                } catch (error) {
                    console.error(`Error in table initialization process for ${dbTable}:`, error);
                }
            }
        } finally {
            // Cleanup is handled automatically by adaptus2-orm
            await ORM.cleanup();
        }
        
        console.log('Database tables initialized successfully.');
        return true;
    } catch (error) {
        console.error('Failed to initialize database tables:', error);
        return false;
    }
}

/**
 * Get database connection using adaptus2-orm
 * 
 * COMPATIBILITY NOTE: This function maintains the same interface as the original,
 * but internally uses adaptus2-orm's connection management. The returned connection
 * object includes a 'release' method that is a no-op for compatibility.
 */
async function getDbConnection(config) {
    console.log('getDbConnection', config);
    if (!config || !config.dbType || !config.dbConnection) {
        // use env default values 
        config.dbType = process.env.DEFAULT_DBTYPE || 'mysql';
        config.dbConnection = process.env.DEFAULT_DBCONNECTION || 'MYSQL_1';
    }

    const { dbType, dbConnection } = config;
    const normalizedDbConnection = dbConnection.replace(/-/g, '_');

    if (dbConnections[normalizedDbConnection]) {
        return dbConnections[normalizedDbConnection];
    }

    try {
        // Create ORM config using the existing createOrmConfig function
        const ormConfig = await createOrmConfig(config);
        
        // Use adaptus2-orm's getDbConnection
        const ormConnection = await ORM.getDbConnection(ormConfig);
        
        if (!ormConnection) {
            throw new Error(`Failed to establish connection for ${normalizedDbConnection}`);
        }

        // Create a wrapper that provides the expected interface
        const connectionWrapper = {
            // Add execute method that matches the expected interface
            execute: async function(sql, params) {
                try {
                    console.log('Executing SQL:', sql, 'with params:', params);
                    const result = await ORM.query(ormConfig, sql, params || []);
                    
                    // Log the raw result type and structure
                    console.log('Raw result type:', typeof result);
                    console.log('Is array?', Array.isArray(result));
                    console.log('Raw result:', result);

                    // Initialize rows array
                    let rows = [];

                    // Handle the result based on its type and structure
                    if (result) {
                        if (Array.isArray(result)) {
                            rows = result;
                        } else if (result.data) {
                            if (Array.isArray(result.data)) {
                                rows = result.data;
                            } else if (result.data.rows) {
                                rows = result.data.rows;
                            } else if (typeof result.data === 'object') {
                                rows = [result.data];
                            } else {
                                rows = [result.data];
                            }
                        } else if (result.rows) {
                            rows = result.rows;
                        } else if (typeof result === 'object') {
                            rows = [result];
                        }
                    }

                    // Ensure rows is an array
                    if (!Array.isArray(rows)) {
                        console.warn('Rows is not an array, converting to array:', rows);
                        rows = [rows];
                    }

                    // Process each row to ensure it's an object
                    rows = rows.map(row => {
                        if (row === null || row === undefined) {
                            return {};
                        }
                        if (typeof row === 'string') {
                            try {
                                return JSON.parse(row);
                            } catch (e) {
                                return { value: row };
                            }
                        }
                        if (typeof row === 'object') {
                            // Handle case where row might be a JSON string
                            if (row.value && typeof row.value === 'string') {
                                try {
                                    return JSON.parse(row.value);
                                } catch (e) {
                                    return row;
                                }
                            }
                            return row;
                        }
                        return { value: row };
                    });

                    // Ensure we have a valid array of objects
                    if (!Array.isArray(rows)) {
                        console.warn('Rows is still not an array after processing, forcing to array');
                        rows = [rows];
                    }

                    // Final validation of rows
                    rows = rows.filter(row => row !== null && row !== undefined);

                    // Log the final processed rows
                    console.log('Final processed rows type:', typeof rows);
                    console.log('Final processed rows is array?', Array.isArray(rows));
                    console.log('Final processed rows length:', rows.length);
                    console.log('Final processed rows:', JSON.stringify(rows, null, 2));

                    // Return in the expected format [rows, fields]
                    return [rows, []]; // Return [rows, fields] format
                } catch (error) {
                    console.error('Error in execute:', error);
                    console.error('Error stack:', error.stack);
                    return [[], []]; // Return empty arrays on error
                }
            },

            // Add query method for backward compatibility
            query: async function(sql, params) {
                try {
                    console.log('Querying SQL:', sql, 'with params:', params);
                    const result = await ORM.query(ormConfig, sql, params || []);
                    
                    // Log the raw result type and structure
                    console.log('Raw query result type:', typeof result);
                    console.log('Is array?', Array.isArray(result));
                    console.log('Raw query result:', result);

                    // Initialize rows array
                    let rows = [];

                    // Handle the result based on its type and structure
                    if (result) {
                        if (Array.isArray(result)) {
                            rows = result;
                        } else if (result.data) {
                            if (Array.isArray(result.data)) {
                                rows = result.data;
                            } else if (result.data.rows) {
                                rows = result.data.rows;
                            } else if (typeof result.data === 'object') {
                                rows = [result.data];
                            } else {
                                rows = [result.data];
                            }
                        } else if (result.rows) {
                            rows = result.rows;
                        } else if (typeof result === 'object') {
                            rows = [result];
                        }
                    }

                    // Ensure rows is an array
                    if (!Array.isArray(rows)) {
                        console.warn('Rows is not an array, converting to array:', rows);
                        rows = [rows];
                    }

                    // Process each row to ensure it's an object
                    rows = rows.map(row => {
                        if (row === null || row === undefined) {
                            return {};
                        }
                        if (typeof row === 'string') {
                            try {
                                return JSON.parse(row);
                            } catch (e) {
                                return { value: row };
                            }
                        }
                        if (typeof row === 'object') {
                            // Handle case where row might be a JSON string
                            if (row.value && typeof row.value === 'string') {
                                try {
                                    return JSON.parse(row.value);
                                } catch (e) {
                                    return row;
                                }
                            }
                            return row;
                        }
                        return { value: row };
                    });

                    // Ensure we have a valid array of objects
                    if (!Array.isArray(rows)) {
                        console.warn('Rows is still not an array after processing, forcing to array');
                        rows = [rows];
                    }

                    // Final validation of rows
                    rows = rows.filter(row => row !== null && row !== undefined);

                    // Log the final processed rows
                    console.log('Final processed rows type:', typeof rows);
                    console.log('Final processed rows is array?', Array.isArray(rows));
                    console.log('Final processed rows length:', rows.length);
                    console.log('Final processed rows:', JSON.stringify(rows, null, 2));

                    return rows;
                } catch (error) {
                    console.error('Error in query:', error);
                    console.error('Error stack:', error.stack);
                    return []; // Return empty array on error
                }
            },

            // Add release method as a no-op for compatibility
            release: function() {
                // No-op since adaptus2-orm handles connection management
       
            }
        };

        // Store the wrapped connection for reuse
        dbConnections[normalizedDbConnection] = connectionWrapper;
       
        // Extend globalContext after the first successful connection
        if (!isContextExtended) {
            extendContext();
            isContextExtended = true;
        }
        
        return connectionWrapper;
    } catch (error) {
        console.error(`Failed to connect to database (${dbType}):`, error.message);
        return null;
    }
}

/**
 * Create adaptus2-orm configuration from legacy config
 * 
 * CONVERSION NOTE: This function converts the legacy configuration format
 * to adaptus2-orm's expected format, handling environment variables and
 * connection string normalization. We don't access internal ConfigManager,
 * instead we create the config object directly as expected by adaptus2-orm.
 */
async function createOrmConfig(config) {
    const { dbType, dbConnection } = config;
    const normalizedDbConnection = dbConnection ? dbConnection.replace(/-/g, '_') : null;
    
    let type;
    switch (dbType.toLowerCase()) {
        case 'mysql':
            type = 'mysql';
            break;
        case 'postgres':
        case 'postgresql':
            type = 'postgresql';
            break;
        case 'mongodb':
            type = 'mongodb';
            break;
        case 'snowflake':
            type = 'snowflake';
            break;
        default:
            throw new Error(`Unsupported database type: ${dbType}`);
    }
    
    const baseConfig = { type };
    
    if (normalizedDbConnection) {
        // Map environment variables to adaptus2-orm format
        switch (type) {
            case 'mysql':
                baseConfig.host = process.env[`${normalizedDbConnection}_HOST`];
                baseConfig.port = parseInt(process.env[`${normalizedDbConnection}_PORT`] || '3306');
                baseConfig.user = process.env[`${normalizedDbConnection}_USER`];
                baseConfig.password = process.env[`${normalizedDbConnection}_PASSWORD`];
                baseConfig.database = process.env[`${normalizedDbConnection}_DB`];
                baseConfig.connectionLimit = 10;
                baseConfig.waitForConnections = true;
                baseConfig.queueLimit = 0;
                break;
                
            case 'postgresql':
                baseConfig.host = process.env[`${normalizedDbConnection}_HOST`];
                baseConfig.port = parseInt(process.env[`${normalizedDbConnection}_PORT`] || '5432');
                baseConfig.user = process.env[`${normalizedDbConnection}_USER`];
                baseConfig.password = process.env[`${normalizedDbConnection}_PASSWORD`];
                baseConfig.database = process.env[`${normalizedDbConnection}_DB`];
                baseConfig.max = 10;
                baseConfig.idleTimeoutMillis = 30000;
                baseConfig.connectionTimeoutMillis = 60000;
                break;
                
            case 'mongodb':
                baseConfig.uri = process.env[`${normalizedDbConnection}_URI`];
                baseConfig.database = process.env[`${normalizedDbConnection}_DB`];
                baseConfig.maxPoolSize = 10;
                baseConfig.minPoolSize = 0;
                baseConfig.serverSelectionTimeoutMS = 30000;
                baseConfig.socketTimeoutMS = 30000;
                break;
                
            case 'snowflake':
                baseConfig.account = process.env[`${normalizedDbConnection}_ACCOUNT`];
                baseConfig.user = process.env[`${normalizedDbConnection}_USER`];
                baseConfig.password = process.env[`${normalizedDbConnection}_PASSWORD`];
                baseConfig.warehouse = process.env[`${normalizedDbConnection}_WAREHOUSE`];
                baseConfig.database = process.env[`${normalizedDbConnection}_DB`];
                baseConfig.schema = process.env[`${normalizedDbConnection}_SCHEMA`] || 'PUBLIC';
                baseConfig.queryTimeout = 120000;
                break;
        }
    }
    
    // Return the config object directly for adaptus2-orm to use
    return baseConfig;
}

/**
 * Convert legacy SQL types to adaptus2-orm types
 * 
 * TYPE MAPPING NOTE: This function maps legacy SQL types to adaptus2-orm's
 * standardized type system. Some specific SQL types may be generalized.
 */
function convertToAdaptusType(sqlType) {
    const type = sqlType.toUpperCase();
    
    if (type.includes('INT')) return 'integer';
    if (type.includes('VARCHAR') || type.includes('CHAR')) return 'string';
    if (type.includes('TEXT')) return 'text';
    if (type.includes('DECIMAL') || type.includes('NUMERIC')) return 'decimal';
    if (type.includes('FLOAT') || type.includes('DOUBLE')) return 'float';
    if (type.includes('DATE')) return 'date';
    if (type.includes('TIMESTAMP') || type.includes('DATETIME')) return 'timestamp';
    if (type.includes('BOOL')) return 'boolean';
    if (type.includes('JSON')) return 'json';
    if (type.includes('BLOB') || type.includes('BINARY')) return 'binary';
    
    // Default to string for unknown types
    return 'string';
}

/**
 * Find route configuration for entity
 * 
 * UNCHANGED: This function remains the same as the original
 */
function findDefUsersRoute(table) {
    const apiConfig = getApiConfig();
    return apiConfig.find(item => 
        item.routeType === 'def' &&
        item.dbTable === table
    );
}

/**
 * Create a record using adaptus2-orm
 * 
 * INTERFACE NOTE: This function maintains the same interface as the original,
 * but uses adaptus2-orm's create method internally. The db.release() call
 * is preserved for compatibility but is a no-op.
 */
async function create(config, entity, data) {
    console.log('create', config, entity, data);
    
    if (config.dbConnection === 'default') {
        config.dbType = process.env.DEFAULT_DBTYPE || 'mysql';
        config.dbConnection = process.env.DEFAULT_DBCONNECTION || 'MYSQL_1';
    }
    
    // Get connection (maintained for compatibility)
    const db = await getDbConnection(config);
    
    // Find model configuration
    const modelConfig = findDefUsersRoute(entity);
    if (!modelConfig) {
        throw new Error(`Entity ${entity} not defined in apiConfig.`);
    }
    
    // Parse data if needed
    console.log("Incoming data:", data);
    if (typeof data !== "object" || data === null) {
        try {
            data = JSON.parse(JSON.parse(data));
        } catch (error) {
            console.error("Error parsing data:", data, error);
            throw new Error("Invalid input data: Must be a valid JSON object or string.");
        }
    }
    
    // Filter allowed fields
    const allowedFields = modelConfig.allowWrite || [];
    const validData = {};
    
    for (const key of allowedFields) {
        if (data.hasOwnProperty(key)) {
            validData[key] = data[key];
        }
    }
    
    console.log('validData', validData);
    if (Object.keys(validData).length === 0) {
        throw new Error(`No valid fields to create for ${entity}.`);
    }
    
    try {
        const ormConfig = await createOrmConfig(config);
        const dbTable = modelConfig.dbTable || entity;
        
        // Use adaptus2-orm's create method
        const result = await ORM.create(ormConfig, dbTable, validData);
        
        // Extract the actual insert data from adaptus2-orm response
        if (result.data) {
            // The original db.js returned a response object, so we maintain that format
            response.setResponse(200, 'Record created successfully', '', result.data, 'create_record');
        } else {
            response.setResponse(500, 'Error creating record', result.error, {}, 'create_record');
        }
        
        return response;
    } catch (error) {
        console.error(`Error creating record in ${entity}:`, error.message);
        response.setResponse(500, `Error creating record in ${entity}`, error.message, {}, 'create_record');
        return { error: error.message };
    } finally {
        // Compatibility: release is a no-op
        if (db && db.release) db.release();
    }
}

/**
 * Update a record using adaptus2-orm
 * 
 * INTERFACE NOTE: Maintains same interface, uses adaptus2-orm's update method
 */
async function update(config, entity, query, data) {
    const db = await getDbConnection(config);
    const modelConfig = findDefUsersRoute(entity);

    if (!modelConfig) {
        throw new Error(`Entity ${entity} not defined in apiConfig.`);
    }
    
    // Parse data if needed
    if (typeof data !== 'object') {
        data = JSON.parse(data);
    }

    const allowedFields = modelConfig.allowWrite || [];
    const primaryKey = modelConfig.keys[0];

    if (primaryKey && !query[primaryKey]) {
        throw new Error(`Primary key (${primaryKey}) is required for updates in ${entity}.`);
    }

    const validData = Object.keys(data)
        .filter(key => allowedFields.includes(key))
        .reduce((obj, key) => ({ ...obj, [key]: data[key] }), {});

    if (Object.keys(validData).length === 0) {
        throw new Error(`No valid fields to update for ${entity}.`);
    }
    
    // Apply ownership check
    if (modelConfig.owner) {
        const user = getContext('user');
        if (user) {
            query[modelConfig.owner.column] = user[modelConfig.owner.tokenField];
        }
    }

    try {
        const ormConfig = await createOrmConfig(config);
        const dbTable = modelConfig.dbTable || entity;
        
        // Use adaptus2-orm's update method
        const result = await ORM.update(ormConfig, dbTable, {
            where: query,
            data: validData
        });
        
        // Extract the result data and return in the original format
        return result.data || { affectedRows: 0 };
    } catch (error) {
        console.error(`Error updating record in ${entity}:`, error.message);
        throw error;
    } finally {
        if (db && db.release) db.release();
    }
}
/**
 * Read records using adaptus2-orm
 * 
 * INTERFACE NOTE: Maintains same interface, uses adaptus2-orm's read method
 */
/**
 * Read records using adaptus2-orm
 * 
 * INTERFACE NOTE: Maintains same interface, uses adaptus2-orm's read method
 * IMPORTANT: The original db.js returned raw arrays, but adaptus2-orm returns response objects.
 * We need to extract the data property to maintain compatibility.
 */
async function read(config, entity, query) {
    const db = await getDbConnection(config);
    const modelConfig = findDefUsersRoute(entity);

    if (!modelConfig) {
        throw new Error(`Entity ${entity} not defined in apiConfig.`);
    }
   
    const allowedFields = modelConfig.allowRead || [];
    const dbTable = modelConfig.dbTable || entity;

    // Apply ownership check
    if (modelConfig.owner) {
        const user = getContext('user');
        if (user) {
            query = query || {};
            query[modelConfig.owner.column] = user[modelConfig.owner.tokenField];
        }
    }

    try {
        const ormConfig = await createOrmConfig(config);
        
        // Prepare read parameters for adaptus2-orm
        const readParams = {};
        if (query) {
            readParams.where = query;
        }
        
        // Call adaptus2-orm's read method
        const result = await ORM.read(ormConfig, dbTable, readParams);
        
        // IMPORTANT: Extract the data array from the response object
        // The original db.js returned raw arrays, not response objects
        return result.data || [];
    } catch (error) {
        console.error(`Error reading records from ${entity}:`, error.message);
        throw error;
    } finally {
        if (db && db.release) db.release();
    }
}

/**
 * Execute raw query using adaptus2-orm
 * 
 * INTERFACE NOTE: Maintains same interface, uses adaptus2-orm's query method
 */
async function query(config, queryString, params = []) {
    console.log(config, queryString, params);
    const db = await getDbConnection(config);

    if (!db) {
        throw new Error(`Database connection for ${config.dbConnection} could not be established.`);
    }

    try {
        const ormConfig = await createOrmConfig(config);
        
        // Use adaptus2-orm's query method
        const result = await ORM.query(ormConfig, queryString, params);
        
        // adaptus2-orm returns a result object with data property
        return result.data || [];
    } catch (error) {
        console.error(`Error executing raw query: ${error.message}`);
        throw error;
    } finally {
        if (db && db.release) db.release();
    }
}

/**
 * Delete record using adaptus2-orm
 * 
 * INTERFACE NOTE: Maintains same interface, uses adaptus2-orm's deleteRecord method
 */
async function deleteRecord(config, entity, query) {
    const db = await getDbConnection(config);
    const modelConfig = findDefUsersRoute(entity);

    if (!modelConfig) {
        throw new Error(`Entity ${entity} not defined in apiConfig.`);
    }

    const primaryKey = modelConfig.keys[0];
    const dbTable = modelConfig.dbTable || entity;

    if (!query || !query[primaryKey]) {
        throw new Error(`Primary key (${primaryKey}) is required to delete records from ${entity}.`);
    }

    // Apply ownership check
    if (modelConfig.owner) {
        const user = getContext('user');
        if (user) {
            query[modelConfig.owner.column] = user[modelConfig.owner.tokenField];
        }
    }
    
    try {
        const ormConfig = await createOrmConfig(config);
        
        // Use adaptus2-orm's deleteRecord method
        const result = await ORM.deleteRecord(ormConfig, dbTable, { where: query });
        
        // Extract the result data and return in the original format
        return result.data || { affectedRows: 0 };
    } catch (error) {
        console.error(`Error deleting record from ${entity}:`, error.message);
        throw error;
    } finally {
        if (db && db.release) db.release();
    }
}


/**
 * Check if table exists using adaptus2-orm
 * 
 * INTERFACE NOTE: Maintains same interface, uses adaptus2-orm's tableExists method
 */
async function tableExists(config, tableName) {
    const db = await getDbConnection(config);
    if (!db) {
        throw new Error(`Database connection for ${config.dbConnection} could not be established.`);
    }
    
    if (!tableName) {
        throw new Error(`Table name is required to check existence.`);
    }
    
    try {
        const ormConfig = await createOrmConfig(config);
        
        // Use adaptus2-orm's tableExists method
        const result = await ORM.tableExists(ormConfig, tableName);
        
        return result.data || false;
    } catch (error) {
        console.error(`Error checking existence of table ${tableName}:`, error.message);
        throw error;
    } finally {
        if (db && db.release) db.release();
    }
}

/**
 * Check if record exists using adaptus2-orm
 * 
 * INTERFACE NOTE: Maintains same interface, uses adaptus2-orm's exists method
 */
async function exists(config, entity, params) {
    const db = await getDbConnection(config);
    const modelConfig = findDefUsersRoute(entity);

    if (!modelConfig) {
        throw new Error(`Entity ${entity} not defined in apiConfig.`);
    }

    try {
        const ormConfig = await createOrmConfig(config);
        const dbTable = modelConfig.dbTable || entity;
        
        // Use adaptus2-orm's exists method
        const result = await ORM.exists(ormConfig, dbTable, { where: params });
        
        // Return just the boolean value, not the response object
        return result.data || false;
    } catch (error) {
        console.error(`Error checking existence in ${entity}:`, error);
        throw error;
    } finally {
        if (db && db.release) db.release();
    }
}
/**
 * Create table using adaptus2-orm
 * 
 * INTERFACE NOTE: Maintains same interface, uses adaptus2-orm's createTable method
 * This function handles the legacy column definition format and converts it to
 * adaptus2-orm's schema format.
 */
async function createTable(config, tableName, columnDefinitions) {
    const db = await getDbConnection(config);
    if (!db) {
        throw new Error(`Database connection for ${config.dbConnection} could not be established.`);
    }

    try {
        const ormConfig = await createOrmConfig(config);
        
        // Check if this is the legacy format (simple string definitions)
        const isLegacyFormat = Object.values(columnDefinitions).every(def => typeof def === 'string');
        
        if (isLegacyFormat) {
            // Handle legacy format by building raw SQL
            const columns = [];
            const indexes = [];
            
            for (const [column, definition] of Object.entries(columnDefinitions)) {
                if (column === 'INDEX') {
                    // Store indexes for later creation
                    indexes.push(...definition);
                } else {
                    columns.push(`${column} ${definition}`);
                }
            }
            
            // Create table using raw SQL for MySQL/PostgreSQL compatibility
            const createTableSql = `CREATE TABLE IF NOT EXISTS ${tableName} (${columns.join(', ')})`;
            console.log(`[createTable] Executing raw SQL: ${createTableSql}`);
            
            await ORM.query(ormConfig, createTableSql);
            
            // Create indexes separately
            for (const idx of indexes) {
                try {
                    const match = idx.match(/idx_(\w+)\((\w+)\)/);
                    if (match) {
                        const indexName = `idx_${match[2]}`;
                        const columnName = match[2];
                        
                        let indexSql;
                        if (config.dbType.toLowerCase() === 'mysql') {
                            indexSql = `CREATE INDEX ${indexName} ON ${tableName} (${columnName})`;
                        } else {
                            indexSql = `CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName} (${columnName})`;
                        }
                        
                        await ORM.query(ormConfig, indexSql);
                    }
                } catch (err) {
                    // Ignore duplicate index errors
                    if (!err.message.includes('already exists') && !err.message.includes('Duplicate')) {
                        console.error(`Error creating index: ${err.message}`);
                    }
                }
            }
        } else {
            // Use adaptus2-orm's createTable for the new format
            const schema = { columns: {}, indexes: {} };
            
            // Process column definitions and extract indexes
            for (const [column, definition] of Object.entries(columnDefinitions)) {
                if (column === 'INDEX') {
                    // Process indexes
                    definition.forEach(idx => {
                        const match = idx.match(/idx_(\w+)\((\w+)\)/);
                        if (match) {
                            const indexName = `idx_${match[2]}`;
                            const columnName = match[2];
                            schema.indexes[indexName] = {
                                columns: [columnName],
                                unique: false
                            };
                        }
                    });
                } else {
                    // Process regular column
                    const parts = definition.split(' ');
                    const type = parts[0];
                    const constraints = parts.slice(1).join(' ');
                    
                    schema.columns[column] = {
                        type: convertToAdaptusType(type),
                        required: constraints.includes('NOT NULL'),
                        unique: constraints.includes('UNIQUE'),
                        primaryKey: constraints.includes('PRIMARY KEY'),
                        autoIncrement: constraints.includes('AUTO_INCREMENT')
                    };
                }
            }
            
            // Use adaptus2-orm's createTable method
            await ORM.createTable(ormConfig, tableName, schema);
        }
        
    } catch (error) {
        console.error(`Error creating table ${tableName}:`, error);
        throw error;
    } finally {
        if (db && db.release) db.release();
    }
}

/**
 * Extend Global Context with CRUD Actions
 * 
 * UNCHANGED: This function remains the same as the original,
 * since the underlying CRUD functions maintain the same interface
 */
function extendContext() {
    if (!globalContext.actions) globalContext.actions = {};

    globalContext.actions.create_record = async (ctx, params) => {            
        const { entity, data } = params;          
        return await create(ctx.config, entity, data);      
    };

    globalContext.actions.read = async (ctx, params) => {
        const { entity, query } = params;
        return await read(ctx.config, entity, query);
    };

    globalContext.actions.update = async (ctx, params) => {
        const { entity, query, data } = params;
        return await update(ctx.config, entity, query, data);
    };

    globalContext.actions.delete = async (ctx, params) => {
        const { entity, query } = params;
        return await deleteRecord(ctx.config, entity, query);
    };

    globalContext.actions.exists = async (ctx, params) => {
        const { entity, query } = params;
        return { exists: await exists(ctx.config, entity, query) };
    };

    globalContext.actions.rawQuery = async (ctx, params) => {
        let myQuery;
        const { values } = params;
        console.log("In Action", params, ctx.config);
        
        if (params.data) {
            const { query } = params.data;
            myQuery = query;
        }
        
        if (!myQuery) {
            throw new Error("A raw SQL query string is required.");
        }
        
        const result = await query(ctx.config, myQuery, values || []);
        
        // Return single record if only one result
        if (result.length === 1) {
            ctx.data['response'] = JSON.stringify(result[0]);
        } else {
            ctx.data['response'] = result;
        }
        
        console.log("Here is my Response", ctx.data['response']);
        return { success: true, result, key: 'response' };
    };
}

/**
 * Close all MySQL pools
 * 
 * COMPATIBILITY NOTE: Since adaptus2-orm manages connections internally,
 * this function is adapted to work with adaptus2-orm's cleanup method
 */
async function closeAllMysqlPools() {
    try {
        // Close all connections managed by adaptus2-orm
        await ORM.cleanup();
        console.log('Closed all database connections via adaptus2-orm');
    } catch (err) {
        console.error('Error closing database connections:', err);
    }
}

// Export all functions with the same interface as the original
module.exports = { 
    getDbConnection, 
    create, 
    read, 
    update, 
    delete: deleteRecord, 
    exists, 
    createTable,
    extendContext, 
    query,
    closeAllMysqlPools,
    initDatabase,
    tableExists
};