const fs = require('fs');
const path = require('path');
const { getDbConnection } = require("./db");

async function buildApiConfigFromDatabase() {
    const args = process.argv.slice(2);
    let overwrite = false;
    let refresh = false;
    let acl = 'publicAccess';
    let selectedTables = [];

    args.forEach((arg) => {
        if (arg.startsWith('--acl=')) {
            acl = arg.split('=')[1];
        } else if (arg === '--overwrite') {
            overwrite = true;
        } else if (arg === '--refresh') {
            refresh = true;
        } else if (arg.startsWith('--tables=')) {
            selectedTables = arg.split('=')[1].split(',').map((table) => table.trim());
        }
    });

    const configDir = process.env.CONFIG_DIR || path.join(process.cwd(), 'config');
    const configPath = path.join(configDir, 'apiConfig.json');
    let existingConfig = [];

    if (fs.existsSync(configPath)) {
        if (overwrite) {
            console.log(`Overwriting existing configuration at ${configPath}`);
        } else if (refresh) {
            console.log(`Refreshing configuration: loading existing config from ${configPath}`);
            existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        } else {
            console.error(
                `Error: ${configPath} already exists. Use '--overwrite' or '--refresh' to modify it.`
            );
            process.exit(1);
        }
    }

    const dbType = process.env.DEFAULT_DBTYPE;
    const dbConnectionName = process.env.DEFAULT_DBCONNECTION;

    if (!dbType || !dbConnectionName) {
        console.error('Database type or connection name is missing in environment variables.');
        process.exit(1);
    }

    const config = { dbType, dbConnection: dbConnectionName };
    let apiConfig = refresh ? [...existingConfig] : [];

    try {
        const connection = await getDbConnection(config);
        if (!connection) {
            console.error('Failed to establish database connection.');
            process.exit(1);
        }

        console.log(`Connected to ${dbType} for schema extraction.`);

        const tables = await getTablesFromDatabase(connection, dbType, selectedTables);
        for (const tableName of tables) {
            if (refresh && apiConfig.some((conf) => conf.dbTable === tableName)) {
                console.log(`Skipping ${tableName}: already present in configuration.`);
                continue;
            }

            const tableConfig = await generateTableConfig(connection, tableName, dbType, acl);
            apiConfig.push(tableConfig);
        }

        fs.writeFileSync(configPath, JSON.stringify(apiConfig, null, 2));
        console.log(`API configuration saved to ${configPath}`);
    } catch (error) {
        console.error('Error building API config:', error);
    }
}

async function getTablesFromDatabase(connection, dbType, selectedTables) {
    if (dbType.toLowerCase() === 'mysql') {
        const [tables] = await connection.execute('SHOW TABLES');
        return tables
            .map((tableInfo) => Object.values(tableInfo)[0])
            .filter((tableName) => selectedTables.length === 0 || selectedTables.includes(tableName));
    } else if (dbType.toLowerCase() === 'postgres') {
        const result = await connection.query(
            `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
        );
        return result.rows
            .map((row) => row.table_name)
            .filter((tableName) => selectedTables.length === 0 || selectedTables.includes(tableName));
    }
    throw new Error(`Unsupported database type: ${dbType}`);
}

async function generateTableConfig(connection, tableName, dbType, acl) {
    const [columns] = await connection.execute(`SHOW COLUMNS FROM ${tableName}`);
    const columnDefinitions = {};
    const allowRead = [];
    const allowWrite = [];
    const allowedMethods = ['GET', 'POST', 'PUT', 'DELETE'];

    columns.forEach(({ Field, Type }) => {
        columnDefinitions[Field] = Type.includes('int') ? 'Int' : 'String';
        allowRead.push(Field);
        allowWrite.push(Field);
    });

    return {
        dbType,
        dbConnection: process.env.GRAPHQL_DBCONNECTION,
        dbTable: tableName,
        route: `/api/${tableName}`,
        allowRead,
        allowWrite,
        acl,
        allowedMethods,
        columnDefinitions,
    };
}

module.exports = buildApiConfigFromDatabase;
