require('dotenv').config();
const mysql = require('mysql2/promise');
const { Client } = require('pg');
const { MongoClient, ObjectId } = require('mongodb');
const snowflake = require('snowflake-sdk');


const dbConnections = {};


async function getDbConnection(config) {
    const { dbType, dbConnection } = config;
    const normalizedDbConnection = dbConnection.replace(/-/g, '_');

    if (dbConnections[normalizedDbConnection]) {
        return dbConnections[normalizedDbConnection];
    }

    try {
        if (dbType.toLowerCase() === 'mysql') {
            dbConnections[normalizedDbConnection] = await mysql.createConnection({
                host: process.env[`${normalizedDbConnection}_HOST`],
                user: process.env[`${normalizedDbConnection}_USER`],
                password: process.env[`${normalizedDbConnection}_PASSWORD`],
                database: process.env[`${normalizedDbConnection}_DB`],
                port: process.env[`${normalizedDbConnection}_PORT`] || 3306,
            });
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

    return dbConnections[normalizedDbConnection];
}

// CRUD Operations
async function create(config, entity, data) {
    const db = await getDbConnection(config);
    const modelConfig = apiConfig[entity];

    if (!modelConfig) {
        throw new Error(`Entity ${entity} not defined in apiConfig.`);
    }

    const allowedFields = modelConfig.allowWrite || [];
    const validData = Object.keys(data)
        .filter(key => allowedFields.includes(key))
        .reduce((obj, key) => ({ ...obj, [key]: data[key] }), {});

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
                return result;
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
        console.error(`Error creating record in ${entity}:`, error.message);
        throw error;
    }
}

async function update(config, entity, query, data) {
    const db = await getDbConnection(config);
    const modelConfig = apiConfig[entity];

    if (!modelConfig) {
        throw new Error(`Entity ${entity} not defined in apiConfig.`);
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
    const modelConfig = apiConfig[entity];

    if (!modelConfig) {
        throw new Error(`Entity ${entity} not defined in apiConfig.`);
    }

    const allowedFields = modelConfig.allowRead || [];
    const dbTable = modelConfig.dbTable || entity;

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
                console.log(results);
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
    const modelConfig = apiConfig[entity];

    if (!modelConfig) {
        throw new Error(`Entity ${entity} not defined in apiConfig.`);
    }

    const primaryKey = modelConfig.keys[0]; // Assume the first key is the primary key
    const dbTable = modelConfig.dbTable || entity;

    if (!query || !query[primaryKey]) {
        throw new Error(`Primary key (${primaryKey}) is required to delete records from ${entity}.`);
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

// Extend Global Context with CRUD Actions
function extendContext() {
    if (!globalContext.actions) globalContext.actions = {};

    globalContext.actions.create = async (ctx, params) => {
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

    globalContext.actions.rawQuery = async (ctx, params) => {
        const { query, values } = params; // Query and values for parameterized query
        if (!query) {
            throw new Error("A raw SQL query string is required.");
        }
        return await executeRawQuery(ctx.config, query, values || []);
    };
}

module.exports = { getDbConnection, create, read, update, delete: deleteRecord, extendContext, query };

