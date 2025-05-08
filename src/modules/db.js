require('dotenv').config();
const mysql = require('mysql2/promise');
const { Client } = require('pg');
const { MongoClient, ObjectId } = require('mongodb');
const snowflake = require('snowflake-sdk');
const { globalContext, getContext } = require('./context'); // Import the shared globalContext and getContext
const { getApiConfig } = require('./apiConfig');
const response = require('./response'); // Import the shared response object
const process = require('process');

const dbConnections = {};
const mysqlPools = {};
let isContextExtended = false; // Ensure extendContext is only called once

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
          if (!['mysql', 'postgres'].includes(dbType)) {
            console.warn(`Skipping ${dbTable}: Unsupported database type ${dbType}`);
            continue;
          }
  
          // Reuse existing connection from pool if available
          let connection = connectionPool.get(connString);
          if (!connection) {
            connection = await getDbConnection(endpoint);
            if (!connection) {
              console.error(`Failed to connect to database for ${connString}`);
              continue;
            }
            connectionPool.set(connString, connection);
          }
  
          // Validate column definitions
          if (!Object.keys(columnDefinitions).length) {
            console.warn(`Skipping ${dbTable}: Empty column definitions`);
            continue;
          }
  
          // Handle different column definition formats
          // Check if columnDefinitions contains objects or strings
          const isObjectFormat = Object.values(columnDefinitions).some(
            value => typeof value === 'object' && value !== null
          );
  
          // Validate column names and types based on format
          let invalidColumns = [];
          if (isObjectFormat) {
            // Format: { column: { type: '...', constraints: '...' } }
            invalidColumns = Object.entries(columnDefinitions).filter(([name, def]) => {
              return !name.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/) || 
                    (typeof def.type !== 'string') || 
                    !def.type.match(/^[a-zA-Z0-9\s()]+$/);
            });
          } else {
            // Format: { column: 'TYPE CONSTRAINTS' }
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
            // Check if the table exists using a transaction
            await connection.beginTransaction();
  
            // Check if the table exists with proper error handling
            let tableExists = false;
            try {
              if (dbType === 'mysql') {
                const [rows] = await connection.execute(
                  `SELECT COUNT(*) AS count FROM information_schema.tables 
                   WHERE table_schema = DATABASE() AND table_name = ?`,
                  [dbTable]
                );
                tableExists = rows[0].count > 0;
              } else if (dbType === 'postgres') {
                const [rows] = await connection.execute(
                  `SELECT COUNT(*) AS count FROM information_schema.tables 
                   WHERE table_name = $1`,
                  [dbTable]
                );
                tableExists = rows[0].count > 0;
              }
            } catch (error) {
              console.error(`Error checking table existence for ${dbTable}:`, error);
              await connection.rollback();
              continue;
            }
  
            if (tableExists) {
              console.log(`Table ${dbTable} already exists. Skipping creation.`);
              await connection.commit();
              continue;
            }
  
            // Build and validate the CREATE TABLE query
            // Handle different column definition formats
            let columns;
            if (isObjectFormat) {
              columns = Object.entries(columnDefinitions)
                .map(([column, def]) => {
                  if (def.constraints) {
                    return `${column} ${def.type} ${def.constraints}`;
                  } else {
                    return `${column} ${def.type}`;
                  }
                })
                .join(', ');
            } else {
              columns = Object.entries(columnDefinitions)
                .map(([column, type]) => `${column} ${type}`)
                .join(', ');
            }
  
            const createTableQuery = `CREATE TABLE ${dbTable} (${columns})`;
            console.log(`Executing query: ${createTableQuery}`);
  
            try {
              await connection.execute(createTableQuery);
              await connection.commit();
              console.log(`Table ${dbTable} initialized successfully.`);
            } catch (error) {
              await connection.rollback();
              console.error(`Error creating table ${dbTable}:`, error);
              
              // Provide more detailed error information
              if (error.code === 'ER_DUP_FIELDNAME') {
                console.error('Duplicate column name detected');
              } else if (error.code === 'ER_PARSE_ERROR') {
                console.error('SQL syntax error in CREATE TABLE statement');
              }
            }
          } catch (error) {
            console.error(`Error in table initialization process for ${dbTable}:`, error);
            if (connection) {
              await connection.rollback().catch(console.error);
            }
          }
        }
      } finally {
        // Close all connections in the pool
        for (const connection of connectionPool.values()) {
          try {
            await connection.end();
          } catch (error) {
            console.error('Error closing database connection:', error);
          }
        }
      }
      
      console.log('Database tables initialized successfully.');
      return true;
    } catch (error) {
      console.error('Failed to initialize database tables:', error);
      return false;
    }
}
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
        if (dbType.toLowerCase() === 'mysql') {
            const mysqlConfig = {
                host: process.env[`${normalizedDbConnection}_HOST`],
                user: process.env[`${normalizedDbConnection}_USER`],
                password: process.env[`${normalizedDbConnection}_PASSWORD`],
                database: process.env[`${normalizedDbConnection}_DB`],
                port: process.env[`${normalizedDbConnection}_PORT`] || 3306,
                waitForConnections: true,
                connectionLimit: 10,
                queueLimit: 0
            };            
            if (!mysqlPools[normalizedDbConnection]) {
                const pool = mysql.createPool(mysqlConfig);
                pool.on('error', (err) => {
                    console.error(`[MySQL Pool Error][${normalizedDbConnection}]:`, err);
                });
                mysqlPools[normalizedDbConnection] = pool;
            }
            dbConnections[normalizedDbConnection] = mysqlPools[normalizedDbConnection];
        } else if (dbType.toLowerCase() === 'postgres') {
            const client = new Client({
                host: process.env[`${normalizedDbConnection}_HOST`],
                user: process.env[`${normalizedDbConnection}_USER`],
                password: process.env[`${normalizedDbConnection}_PASSWORD`],
                database: process.env[`${normalizedDbConnection}_DB`],
                port: process.env[`${normalizedDbConnection}_PORT`] || 5432,
            });
            await client.connect();
            dbConnections[normalizedDbConnection] = client;
        } else if (dbType.toLowerCase() === 'mongodb') {
            const client = new MongoClient(process.env[`${normalizedDbConnection}_URI`]);
            await client.connect();
            dbConnections[normalizedDbConnection] = client.db(process.env[`${normalizedDbConnection}_DB`]);
        } else if (dbType.toLowerCase() === 'snowflake') {
            const connection = snowflake.createConnection({
                account: process.env[`${normalizedDbConnection}_ACCOUNT`],
                username: process.env[`${normalizedDbConnection}_USER`],
                password: process.env[`${normalizedDbConnection}_PASSWORD`],
                warehouse: process.env[`${normalizedDbConnection}_WAREHOUSE`],
                database: process.env[`${normalizedDbConnection}_DB`],
                schema: process.env[`${normalizedDbConnection}_SCHEMA`],
            });

            await new Promise((resolve, reject) => {
                connection.connect((err, conn) => {
                    if (err) reject(err);
                    dbConnections[normalizedDbConnection] = conn;
                    resolve(conn);
                });
            });
        }
    } catch (error) {
        console.error(`Failed to connect to database (${dbType}):`, error.message);
        return null;
    }
        // Extend globalContext after the first successful connection
    if (!isContextExtended) {
        extendContext();
        isContextExtended = true; // Prevent multiple extensions
    }
    return dbConnections[normalizedDbConnection];
}

function findDefUsersRoute(table) {
    const apiConfig = getApiConfig();
    return apiConfig.find(item => 
      item.routeType === 'def' &&
      item.dbTable === table
    );
  }
  
// CRUD Operations
async function create(config, entity, data) {

    console.log('create', config, entity, data);
    if(config.dbConnection === 'default') {
        config.dbType = process.env.DEFAULT_DBTYPE || 'mysql';
        config.dbConnection = process.env.DEFAULT_DBCONNECTION || 'MYSQL_1';
    }
    const db = await getDbConnection(config);    
    const modelConfig = findDefUsersRoute(entity);

    if (!modelConfig) {
        throw new Error(`Entity ${entity} not defined in apiConfig.`);
    }
  
    console.log("Incoming data:", data);
    if (typeof data !== "object" || data === null) {
        try {
            data = JSON.parse(JSON.parse(data)); // Only parse if `data` is a string
        } catch (error) {
            console.error("Error parsing data:", data, error);
            throw new Error("Invalid input data: Must be a valid JSON object or string.");
        }
    }
    const allowedFields = modelConfig.allowWrite || [];

    console.log('allowedFields', allowedFields);
   
    const validData = {};

    for (const key of allowedFields) {

      if (data.hasOwnProperty(key)) { // Use hasOwnProperty for safety
        validData[key] = data[key];
      }
    }
    console.log('validData', validData);
    if (Object.keys(validData).length === 0) {
        throw new Error(`No valid fields to create for ${entity}.`);
    }

    try {
        const dbTable = modelConfig.dbTable || entity;

        switch (config.dbType.toLowerCase()) {
            case 'mysql':
            case 'postgres': {
                const keys = Object.keys(validData).join(', ');
                const values = Object.values(validData);
                const placeholders = values.map(() => '?').join(', ');

                const query = `INSERT INTO ${dbTable} (${keys}) VALUES (${placeholders})`;
                const [result] = await db.execute(query, values);
                response.setResponse(200, 'Record created successfully', '', result, 'create_record');
                return response;
            }
            case 'mongodb': {
                const collection = db.collection(dbTable);
                const result = await collection.insertOne(validData);
                return result.ops[0];
            }
            case 'snowflake': {
                const keys = Object.keys(validData).join(', ');
                const values = Object.values(validData);
                const placeholders = values.map(() => '?').join(', ');

                const query = `INSERT INTO ${dbTable} (${keys}) VALUES (${placeholders})`;
                return new Promise((resolve, reject) => {
                    db.execute({ sqlText: query, binds: values }, (err, result) => {
                        if (err) return reject(err);
                        resolve(result);
                    });
                });
            }
        }
    } catch (error) {
        console.error(`Error creating record in`, entity , error.message);
        response.setResponse(500, 'Error creating record in ${entity}', error.message, {}, 'create_record');
        return { error: error.message };
    }
}

async function update(config, entity, query, data) {
    const db = await getDbConnection(config);
    const modelConfig = findDefUsersRoute(entity);

    if (!modelConfig) {
        throw new Error(`Entity ${entity} not defined in apiConfig.`);
    }
    // Test if data is not JSON object and convert it to JSON object
    if (typeof data !== 'object') {
        data = JSON.parse(data);
    }

    const allowedFields = modelConfig.allowWrite || [];
    const primaryKey = modelConfig.keys[0]; // Assume the first key as primary key

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
        const dbTable = modelConfig.dbTable || entity;

        switch (config.dbType.toLowerCase()) {
            case 'mysql':
            case 'postgres': {
                const set = Object.keys(validData).map(key => `${key} = ?`).join(', ');
                const where = Object.keys(query).map(key => `${key} = ?`).join(' AND ');
                const values = [...Object.values(validData), ...Object.values(query)];

                const sql = `UPDATE ${dbTable} SET ${set} WHERE ${where}`;
                const [result] = await db.execute(sql, values);
                return result;
            }
            case 'mongodb': {
                const collection = db.collection(dbTable);
                const result = await collection.updateOne(query, { $set: validData });
                return result.modifiedCount;
            }
            case 'snowflake': {
                const set = Object.keys(validData).map(key => `${key} = ?`).join(', ');
                const where = Object.keys(query).map(key => `${key} = ?`).join(' AND ');
                const values = [...Object.values(validData), ...Object.values(query)];

                const sql = `UPDATE ${dbTable} SET ${set} WHERE ${where}`;
                return new Promise((resolve, reject) => {
                    db.execute({ sqlText: sql, binds: values }, (err, result) => {
                        if (err) return reject(err);
                        resolve(result);
                    });
                });
            }
        }
    } catch (error) {
        console.error(`Error updating record in ${entity}:`, error.message);
        throw error;
    }
}

async function read(config, entity, query) {
    const db = await getDbConnection(config);
    const modelConfig = findDefUsersRoute(entity);

    if (!modelConfig) {
        throw new Error(`Entity ${entity} not defined in apiConfig.`);
    }
   
    const allowedFields = modelConfig.allowRead || [];
    const dbTable = modelConfig.dbTable || entity;

  
    if (modelConfig.owner) {
        const user = getContext('user');
        
        if (user) {
            query = query || {};
            query[modelConfig.owner.column] = user[modelConfig.owner.tokenField]; // Enforce ownership check
        
        }
    }

    try {
        switch (config.dbType.toLowerCase()) {
            case 'mysql':
            case 'postgres': {
                const where = query
                    ? `WHERE ${Object.keys(query)
                          .map(key => `${key} = ?`)
                          .join(' AND ')}`
                    : '';
                const values = query ? Object.values(query) : [];

                const sql = `SELECT ${allowedFields.join(', ')} FROM ${dbTable} ${where}`;
                const [result] = await db.execute(sql, values);
                return result;
            }
            case 'mongodb': {
                const collection = db.collection(dbTable);
                const result = await collection
                    .find(query || {}, { projection: allowedFields.reduce((obj, field) => ({ ...obj, [field]: 1 }), {}) })
                    .toArray();
                return result;
            }
            case 'snowflake': {
                const where = query
                    ? `WHERE ${Object.keys(query)
                          .map(key => `${key} = ?`)
                          .join(' AND ')}`
                    : '';
                const values = query ? Object.values(query) : [];

                const sql = `SELECT ${allowedFields.join(', ')} FROM ${dbTable} ${where}`;
                return new Promise((resolve, reject) => {
                    db.execute({ sqlText: sql, binds: values }, (err, result) => {
                        if (err) return reject(err);
                        resolve(result.rows);
                    });
                });
            }
        }
    } catch (error) {
        console.error(`Error reading records from ${entity}:`, error.message);
        throw error;
    }
}

async function query(config, query, params = []) {
    console.log(config, query , params);
    const db = await getDbConnection(config);

    if (!db) {
        throw new Error(`Database connection for ${config.dbConnection} could not be established.`);
    }

    try {
        switch (config.dbType.toLowerCase()) {
            case 'mysql':
            case 'postgres': {
                // MySQL and PostgreSQL use similar query execution with placeholders
                const [results] = await db.execute(query, params);
               
                return results;
            }
            case 'mongodb': {
                // MongoDB queries are not SQL-based, raw queries don't apply here directly
                throw new Error("Raw queries are not supported for MongoDB. Use native MongoDB commands instead.");
            }
            case 'snowflake': {
                // Snowflake supports raw SQL execution through its connection
                return new Promise((resolve, reject) => {
                    db.execute({ sqlText: query, binds: params }, (err, result) => {
                        if (err) {
                            return reject(err);
                        }
                        resolve(result.rows); // Return rows for consistency
                    });
                });
            }
            default: {
                throw new Error(`Unsupported database type: ${config.dbType}`);
            }
        }
    } catch (error) {
        console.error(`Error executing raw query: ${error.message}`);
        throw error;
    }
}


async function deleteRecord(config, entity, query) {
    const db = await getDbConnection(config);
    const modelConfig = findDefUsersRoute(entity);

    if (!modelConfig) {
        throw new Error(`Entity ${entity} not defined in apiConfig.`);
    }
    

    const primaryKey = modelConfig.keys[0]; // Assume the first key is the primary key
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
        switch (config.dbType.toLowerCase()) {
            case 'mysql':
            case 'postgres': {
                const where = Object.keys(query)
                    .map(key => `${key} = ?`)
                    .join(' AND ');
                const values = Object.values(query);

                const sql = `DELETE FROM ${dbTable} WHERE ${where}`;
                const [result] = await db.execute(sql, values);
                return result;
            }
            case 'mongodb': {
                const collection = db.collection(dbTable);
                const result = await collection.deleteOne(query);
                return result.deletedCount;
            }
            case 'snowflake': {
                const where = Object.keys(query)
                    .map(key => `${key} = ?`)
                    .join(' AND ');
                const values = Object.values(query);

                const sql = `DELETE FROM ${dbTable} WHERE ${where}`;
                return new Promise((resolve, reject) => {
                    db.execute({ sqlText: sql, binds: values }, (err, result) => {
                        if (err) return reject(err);
                        resolve(result);
                    });
                });
            }
        }
    } catch (error) {
        console.error(`Error deleting record from ${entity}:`, error.message);
        throw error;
    }
}
async function tableExists(config, tableName) {
    const db = await getDbConnection(config);
    if (!db) {
        throw new Error(`Database connection for ${config.dbConnection} could not be established.`);
    }
    const dbName = process.env[`${config.dbConnection.replace(/-/g, '_')}_DB`];
    if (!dbName) {
        throw new Error(`Database name for ${config.dbConnection} is not defined.`);
    }
    if (!tableName) {
        throw new Error(`Table name is required to check existence.`);
    }
    try {
        switch (config.dbType.toLowerCase()) {
            case 'mysql':
            case 'postgres': {
                const sql = `SELECT COUNT(*) AS count FROM information_schema.tables WHERE  table_schema = ?  AND table_name = ?`;
                const [rows] = await db.execute(sql, [dbName, tableName]);
                return rows[0].count > 0;
            }
            case 'mongodb': {
                const collections = await db.listCollections().toArray();
                return collections.some(collection => collection.name === tableName);
            }
            case 'snowflake': {
                const sql = `SELECT COUNT(*) AS count FROM information_schema.tables WHERE  table_schema = ?  AND table_name = ?`;
                return new Promise((resolve, reject) => {
                    db.execute({ sqlText: sql, binds: [dbName, tableName] }, (err, result) => {
                        if (err) return reject(err);
                        resolve(result.rows[0].COUNT > 0);
                    });
                });
            }
            default:
                throw new Error(`Unsupported database type: ${config.dbType}`);
        }
    } catch (error) {
        console.error(`Error checking existence of table ${tableName}:`, error.message);
        throw error;
    }
}
async function exists(config, entity, params) {
    const db = await getDbConnection(config);
    const modelConfig = findDefUsersRoute(entity);

    if (!modelConfig) {
        throw new Error(`Entity ${entity} not defined in apiConfig.`);
    }

    try {
        const dbTable = modelConfig.dbTable || entity;

        switch (config.dbType.toLowerCase()) {
            case 'mysql':
            case 'postgres': {
                const where = Object.keys(params)
                    .map(key => `${key} = ?`)
                    .join(' AND ');
                const values = Object.values(params);

                const sql = `SELECT EXISTS(SELECT 1 FROM ${dbTable} WHERE ${where}) as exists_flag`;
                const [result] = await db.execute(sql, values);
                return result[0].exists_flag === 1;
            }
            case 'mongodb': {
                const collection = db.collection(dbTable);
                const count = await collection.countDocuments(params);
                return count > 0;
            }
            case 'snowflake': {
                const where = Object.keys(params)
                    .map(key => `${key} = ?`)
                    .join(' AND ');
                const values = Object.values(params);

                const sql = `SELECT EXISTS(SELECT 1 FROM ${dbTable} WHERE ${where}) as exists_flag`;
                return new Promise((resolve, reject) => {
                    db.execute({ sqlText: sql, binds: values }, (err, result) => {
                        if (err) return reject(err);
                        resolve(result.rows[0].EXISTS_FLAG === true);
                    });
                });
            }
            default:
                throw new Error(`Unsupported database type: ${config.dbType}`);
        }
    } catch (error) {
        console.error(`Error checking existence in ${entity}:`, error);
        throw error;
    }
}

// Extend Global Context with CRUD Actions
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
        const { values } = params; // Query and values for parameterized query
        console.log("In Action",params, ctx.config);
        if(params.data){
            
                const { query } = params.data;
                myQuery = query;
        }
        if (!myQuery) {
            throw new Error("A raw SQL query string is required.");
        }
        const result = await query(ctx.config, myQuery, values || []);
        // count if it is only one record return the record itself and not the array.
        if(result.length === 1) {
                 ctx.data['response'] = JSON.stringify(result[0]);        
        } else {
            ctx.data['response'] = result;
        }
        console.log("Here is my Response",ctx.data['response']);
        return { success: true, result, key: 'response' };
        
    };
}
async function closeAllMysqlPools() {
    for (const name in mysqlPools) {
        try {
            await mysqlPools[name].end();
            console.log(`Closed MySQL pool: ${name}`);
        } catch (err) {
            console.error(`Error closing MySQL pool ${name}:`, err);
        }
    }
}

async function createTable(config, tableName, columnDefinitions) {
    const db = await getDbConnection(config);
    if (!db) {
        throw new Error(`Database connection for ${config.dbConnection} could not be established.`);
    }

    try {
        switch (config.dbType.toLowerCase()) {
            case 'mysql': {
                const columns = [];
                const indexes = [];

                // Process column definitions
                for (const [column, definition] of Object.entries(columnDefinitions)) {
                    if (column === 'INDEX') {
                        // Store indexes for later creation
                        indexes.push(...definition);
                    } else {
                        columns.push(`${column} ${definition}`);
                    }
                }

                // Create table
                const createTableSql = `CREATE TABLE IF NOT EXISTS ${tableName} (${columns.join(', ')})`;
                await query(config, createTableSql);

                // Create indexes for MySQL
                for (const idx of indexes) {
                    try {
                        const match = idx.match(/idx_(\w+)\((\w+)\)/);
                        if (match) {
                            const indexName = `idx_${match[2]}`;
                            const columnName = match[2];
                            
                            // Check if index exists
                            const [indexExists] = await query(config, `
                                SELECT 1 
                                FROM information_schema.statistics 
                                WHERE table_schema = DATABASE()
                                AND table_name = ? 
                                AND index_name = ?
                            `, [tableName, indexName]);
                            
                            if (!indexExists || indexExists.length === 0) {
                                await query(config, `ALTER TABLE ${tableName} ADD INDEX ${indexName} (${columnName})`);
                            }
                        }
                    } catch (err) {
                        if (!err.message.includes('Duplicate')) {
                            throw err;
                        }
                    }
                }
                break;
            }
            case 'postgres': {
                const columns = [];
                const indexes = [];

                // Process column definitions
                for (const [column, definition] of Object.entries(columnDefinitions)) {
                    if (column === 'INDEX') {
                        // Store indexes for later creation
                        indexes.push(...definition);
                    } else {
                        columns.push(`${column} ${definition}`);
                    }
                }

                // Create table
                const createTableSql = `CREATE TABLE IF NOT EXISTS ${tableName} (${columns.join(', ')})`;
                await query(config, createTableSql);

                // Create indexes for PostgreSQL
                for (const idx of indexes) {
                    try {
                        const match = idx.match(/idx_(\w+)\((\w+)\)/);
                        if (match) {
                            const indexName = `idx_${match[2]}`;
                            const columnName = match[2];
                            await query(config, `CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName} (${columnName})`);
                        }
                    } catch (err) {
                        if (!err.message.includes('already exists')) {
                            throw err;
                        }
                    }
                }
                break;
            }
            case 'mongodb': {
                const collection = db.collection(tableName);
                const indexes = [];

                // Extract indexes from column definitions
                if (columnDefinitions.INDEX) {
                    for (const idx of columnDefinitions.INDEX) {
                        const match = idx.match(/idx_(\w+)\((\w+)\)/);
                        if (match) {
                            const field = match[2];
                            indexes.push({ [field]: 1 });
                        }
                    }
                }

                // Create indexes
                for (const idx of indexes) {
                    await collection.createIndex(idx);
                }
                break;
            }
            case 'snowflake': {
                const columns = [];
                const indexes = [];

                // Process column definitions
                for (const [column, definition] of Object.entries(columnDefinitions)) {
                    if (column === 'INDEX') {
                        indexes.push(...definition);
                    } else {
                        columns.push(`${column} ${definition}`);
                    }
                }

                // Create table
                const createTableSql = `CREATE TABLE IF NOT EXISTS ${tableName} (${columns.join(', ')})`;
                await query(config, createTableSql);

                // Create indexes
                for (const idx of indexes) {
                    try {
                        // For MySQL, we need to check if index exists first
                        const checkIndexSql = `
                            SELECT 1 
                            FROM information_schema.statistics 
                            WHERE table_schema = DATABASE()
                            AND table_name = '${tableName}' 
                            AND index_name = ?
                        `;
                        const match = idx.match(/idx_(\w+)\((\w+)\)/);
                        if (match) {
                            const indexName = `idx_${match[2]}`;
                            const columnName = match[2];
                            
                            const [indexExists] = await query(config, checkIndexSql, [indexName]);
                            
                            if (!indexExists || indexExists.length === 0) {
                                const createIndexSql = `CREATE INDEX ${indexName} ON ${tableName} (${columnName})`;
                                await query(config, createIndexSql);
                            }
                        }
                    } catch (err) {
                        // Log error but continue with other indexes
                        console.error(`Error creating index: ${err.message}`);
                        if (!err.message.includes('Duplicate')) {
                            throw err;
                        }
                    }
                }
                break;
            }
            default:
                throw new Error(`Unsupported database type: ${config.dbType}`);
        }
    } catch (error) {
        console.error(`Error creating table ${tableName}:`, error);
        throw error;
    }
}

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