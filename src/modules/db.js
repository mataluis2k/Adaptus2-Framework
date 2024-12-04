// db.js
require('dotenv').config();
const mysql = require('mysql2/promise');
const { Client } = require('pg');
const { MongoClient, ObjectId } = require('mongodb');

const dbConnections = {};

async function getDbConnection(config) {
    const { dbType, dbConnection } = config;
    console.log('dbType', dbType);

    // Normalize the dbConnection name (e.g., "mysql-1" -> "MYSQL_1")
    const normalizedDbConnection = dbConnection.replace(/-/g, '_');

    console.log('normalizedDbConnection', normalizedDbConnection);
    // Return existing connection if it already exists
    if (dbConnections[normalizedDbConnection]) {
        return dbConnections[normalizedDbConnection];
    }

    try {
        if (dbType.toLowerCase() === 'mysql') {
            console.log(`Connecting to MySQL using ${normalizedDbConnection}...`);
            dbConnections[normalizedDbConnection] = await mysql.createConnection({
                host: process.env[`${normalizedDbConnection}_HOST`],
                user: process.env[`${normalizedDbConnection}_USER`],
                password: process.env[`${normalizedDbConnection}_PASSWORD`],
                database: process.env[`${normalizedDbConnection}_DB`],
                port: process.env[`${normalizedDbConnection}_PORT`] || 3306,
            });
            console.log(`Connected to MySQL database: ${normalizedDbConnection}`);
        } else if (dbType === 'postgres') {
            console.log(`Connecting to PostgreSQL using ${normalizedDbConnection}...`);
            dbConnections[normalizedDbConnection] = new Client({
                host: process.env[`${normalizedDbConnection}_HOST`],
                user: process.env[`${normalizedDbConnection}_USER`],
                password: process.env[`${normalizedDbConnection}_PASSWORD`],
                database: process.env[`${normalizedDbConnection}_DB`],
                port: process.env[`${normalizedDbConnection}_PORT`] || 5432,
            });
            await dbConnections[normalizedDbConnection].connect();
            console.log(`Connected to PostgreSQL database: ${normalizedDbConnection}`);
        } else if (dbType === 'mongodb') {
            console.log(`Connecting to MongoDB using ${normalizedDbConnection}...`);
            const client = new MongoClient(process.env[`${normalizedDbConnection}_URI`]);
            await client.connect();
            dbConnections[normalizedDbConnection] = client.db(process.env[`${normalizedDbConnection}_DB`]);
            console.log(`Connected to MongoDB database: ${normalizedDbConnection}`);
        }
    } catch (error) {
        console.error(`Failed to connect to database for ${normalizedDbConnection}:`, error.message);
        console.error(`Connection details: 
            HOST: ${process.env[`${normalizedDbConnection}_HOST`]}
            USER: ${process.env[`${normalizedDbConnection}_USER`]}
            PASSWORD: ${process.env[`${normalizedDbConnection}_PASSWORD`]}
            DATABASE: ${process.env[`${normalizedDbConnection}_DB`]}
            PORT: ${process.env[`${normalizedDbConnection}_PORT`] || 3306}`);
        return null;
    }

    return dbConnections[normalizedDbConnection];
}


module.exports = { getDbConnection };
