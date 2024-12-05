const fs = require('fs');
const path = require('path');
const { getDbConnection } = require(path.join(__dirname,'db'));

// Function to build API config from a given database connection
async function buildApiConfigFromDatabase() {
    // Get command line arguments
    const args = process.argv.slice(2);
    let overwrite = false;
    let acl = 'publicAccess';

    // Parse command line arguments
    args.forEach((arg) => {
        if (arg.startsWith('--acl=')) {
            acl = arg.split('=')[1];
        } else if (arg === '-overwrite' || arg === '-refresh') {
            overwrite = true;
        }
    });



    // Paths and configurations
    const configPath = path.join(process.cwd(), 'config/apiConfig.json');

    // Check if config file already exists and the overwrite flag is not provided
    if (fs.existsSync(configPath) && !overwrite) {
        console.error(`Error: ${configPath} already exists. Use '-overwrite' flag to regenerate it.`);
        process.exit(1);
    }

    const dbType = process.env.GRAPHQL_DBTYPE;
    const dbConnectionName = process.env.GRAPHQL_DBCONNECTION;

    if (!dbType || !dbConnectionName) {
        console.error("Database type or connection name is missing in environment variables.");
        process.exit(1);
    }

    const config = {
        dbType: dbType,
        dbConnection: dbConnectionName
    };

    let apiConfig = [];

    try {
        const connection = await getDbConnection(config);
        if (!connection) {
            console.error("Failed to establish database connection.");
            process.exit(1);
        }

        console.log(`Connected to ${dbType} for schema extraction.`);

        if (dbType.toLowerCase() === 'mysql') {
            // Get MySQL tables and columns
            const [tables] = await connection.execute("SHOW TABLES");
            for (const tableInfo of tables) {
                const tableName = Object.values(tableInfo)[0];
                const [columns] = await connection.execute(`SHOW COLUMNS FROM ${tableName}`);

                const columnDefinitions = {};
                const allowRead = [];
                const allowWrite = [];
                const allowedMethods = ["GET", "POST", "PUT", "DELETE"];
                const cache = 1;

                columns.forEach(column => {
                    const { Field, Type } = column;
                    columnDefinitions[Field] = Type.includes('int') ? 'Int' : 'String';
                    allowRead.push(Field);
                    allowWrite.push(Field);
                });

                // Get Foreign Key Information for MySQL
                const [foreignKeys] = await connection.execute(`
                    SELECT
                        COLUMN_NAME, 
                        REFERENCED_TABLE_NAME,
                        REFERENCED_COLUMN_NAME
                    FROM
                        INFORMATION_SCHEMA.KEY_COLUMN_USAGE
                    WHERE
                        TABLE_NAME = '${tableName}'
                        AND REFERENCED_TABLE_NAME IS NOT NULL
                `);

                const relationships = [];
                for (const fk of foreignKeys) {
                    const relatedTable = fk.REFERENCED_TABLE_NAME;
                    const foreignKey = fk.COLUMN_NAME;
                    const relatedKey = fk.REFERENCED_COLUMN_NAME;
    
                    // Get columns from the related table
                    const [relatedColumns] = await connection.execute(`SHOW COLUMNS FROM ${relatedTable}`);
                    const relatedFields = relatedColumns.map(col => col.Field);
    
                    relationships.push({
                        type: 'one-to-one',
                        relatedTable,
                        foreignKey,
                        relatedKey,
                        joinType: 'LEFT JOIN',
                        fields: relatedFields // Adding all fields from the related table
                    });
                }

                apiConfig.push({
                    dbType: 'MySQL',
                    dbConnection: dbConnectionName,
                    dbTable: tableName,
                    route: `/api/${tableName}`,
                    allowRead,
                    allowWrite,
                    acl,
                    allowedMethods,
                    cache,
                    columnDefinitions,
                    relationships
                });
            }
        } else if (dbType.toLowerCase() === 'postgres') {
            // Get PostgreSQL tables and columns
            const result = await connection.query(
                `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
            );

            for (const row of result.rows) {
                const tableName = row.table_name;
                const columnResult = await connection.query(
                    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1`, [tableName]
                );

                const columnDefinitions = {};
                const allowRead = [];
                const allowWrite = [];
                const allowedMethods = ["GET", "POST", "PUT", "DELETE"];
                const cache = 1;

                columnResult.rows.forEach(column => {
                    const { column_name, data_type } = column;
                    columnDefinitions[column_name] = data_type.includes('int') ? 'Int' : 'String';
                    allowRead.push(column_name);
                    allowWrite.push(column_name);
                });

                // Get Foreign Key Information for PostgreSQL
                const foreignKeyResult = await connection.query(`
                    SELECT
                        kcu.column_name,
                        ccu.table_name AS referenced_table_name,
                        ccu.column_name AS referenced_column_name
                    FROM 
                        information_schema.key_column_usage kcu
                    JOIN 
                        information_schema.constraint_column_usage ccu
                    ON 
                        kcu.constraint_name = ccu.constraint_name
                    WHERE 
                        kcu.table_name = $1
                `, [tableName]);

                const relationships = [];
                for (const fk of foreignKeyResult.rows) {
                    const relatedTable = fk.referenced_table_name;
                    const foreignKey = fk.column_name;
                    const relatedKey = fk.referenced_column_name;

                    // Get columns from the related table
                    const relatedColumnResult = await connection.query(
                        `SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [relatedTable]
                    );
                    const relatedFields = relatedColumnResult.rows.map(col => col.column_name);

                    relationships.push({
                        type: 'one-to-one',
                        relatedTable,
                        foreignKey,
                        relatedKey,
                        joinType: 'LEFT JOIN',
                        fields: relatedFields // Adding all fields from the related table
                    });
                }

                apiConfig.push({
                    dbType: 'PostgreSQL',
                    dbConnection: dbConnectionName,
                    dbTable: tableName,
                    route: `/api/${tableName}`,
                    allowRead,
                    allowWrite,
                    acl,
                    allowedMethods,
                    cache,
                    columnDefinitions,
                    relationships
                });
            }
        } else if (dbType.toLowerCase() === 'mongodb') {
            // MongoDB does not have foreign keys but can have references
            const collections = await connection.listCollections().toArray();

            for (const collection of collections) {
                const collectionName = collection.name;
                const collectionInfo = await connection.collection(collectionName).findOne();

                const columnDefinitions = {};
                const allowRead = [];
                const allowWrite = [];
                const allowedMethods = ["GET", "POST", "PUT", "DELETE"];
                const cache = 1;

                if (collectionInfo) {
                    for (const [key, value] of Object.entries(collectionInfo)) {
                        columnDefinitions[key] = typeof value === 'number' ? 'Int' : 'String';
                        allowRead.push(key);
                        allowWrite.push(key);
                    }
                }

                // No foreign key relationships in MongoDB - just add the collection info
                apiConfig.push({
                    dbType: 'MongoDB',
                    dbConnection: dbConnectionName,
                    dbTable: collectionName,
                    route: `/api/${collectionName}`,
                    allowRead,
                    allowWrite,
                    acl,
                    allowedMethods,
                    cache,
                    columnDefinitions,
                    relationships: [] // MongoDB does not have typical foreign keys
                });
            }
        } else {
            console.error('Unsupported database type. Please specify MySQL, PostgreSQL, or MongoDB.');
            process.exit(1);
        }

        // Save generated API config to a file
        fs.writeFileSync(configPath, JSON.stringify(apiConfig, null, 2));
        console.log(`API configuration saved to ${configPath}`);
    } catch (error) {
        console.error('Error building API config:', error);
    }
}

module.exports = buildApiConfigFromDatabase;
