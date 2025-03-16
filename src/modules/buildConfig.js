const fs = require('fs');
const path = require('path');
const { getDbConnection } = require("./db");

async function buildApiConfigFromDatabase(options) {
    // Use options.acl, options.overwrite, options.refresh, and options.tables
    let overwrite = options.overwrite || false;
    let refresh = options.refresh || false;
    let acl = options.acl || null;
    let selectedTables = [];
  
    if (options.tables) {
      selectedTables = options.tables.split(',').map(table => table.trim());
    }
  
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
        if (refresh && apiConfig.some(conf => conf.dbTable === tableName)) {
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
        // Get tables and also fetch any custom enum types
        const enumTypesQuery = `
            SELECT t.typname as enum_name,
                   array_agg(e.enumlabel ORDER BY e.enumsortorder) as enum_values
            FROM pg_type t
            JOIN pg_enum e ON t.oid = e.enumtypid
            GROUP BY t.typname;
        `;
        const enumTypes = await connection.query(enumTypesQuery);
        
        // Store enum types for later use in column definitions
        global.pgEnumTypes = enumTypes.rows.reduce((acc, row) => {
            acc[row.enum_name] = row.enum_values;
            return acc;
        }, {});

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
    if (dbType.toLowerCase() === 'mysql') {
        return generateMySQLTableConfig(connection, tableName, dbType, acl);
    } else if (dbType.toLowerCase() === 'postgres') {
        return generatePostgresTableConfig(connection, tableName, dbType, acl);
    }
    throw new Error(`Unsupported database type: ${dbType}`);
}

async function generateMySQLTableConfig(connection, tableName, dbType, acl) {
    const [columns] = await connection.execute(`SHOW FULL COLUMNS FROM ${tableName}`);
    const columnDefinitions = {};
    const allowRead = [];
    const allowWrite = [];

    columns.forEach(({ Field, Type, Null, Key, Default, Extra, Comment }) => {
        // Extract the base column definition
        let columnDef = {};

        // Handle ENUM types
        if (Type.toUpperCase().startsWith('ENUM')) {
            // Parse enum values and create a proper object definition
            const enumMatch = Type.match(/^enum\((.*)\)$/i);
            if (enumMatch) {
                const enumValues = enumMatch[1]
                    .split(',')
                    .map(val => val.trim().replace(/'/g, ''));
                
                columnDef = {
                    type: 'string',
                    enum: enumValues
                };
                
                if (Comment) {
                    columnDef.description = Comment;
                }
            } else {
                columnDef = Type; // Fallback to raw type if parsing fails
            }
        } else {
            // Handle other types with their full definitions
            columnDef = {
                type: Type.toUpperCase()
            };
            
            // Add constraints
            const constraints = [];
            if (Null === 'NO') constraints.push('NOT NULL');
            if (Default !== null) constraints.push(`DEFAULT ${Default}`);
            if (Extra.includes('auto_increment')) constraints.push('AUTO_INCREMENT');
            if (Key === 'PRI') constraints.push('PRIMARY KEY');
            
            if (constraints.length > 0) {
                columnDef.constraints = constraints.join(' ');
            }
            
            if (Comment) {
                columnDef.description = Comment;
            }
        }

        columnDefinitions[Field] = columnDef;
        
        // Don't include auto-increment fields in allowWrite
        if (!Extra.includes('auto_increment')) {
            allowWrite.push(Field);
        }
        allowRead.push(Field);
    });

    return createTableConfig(tableName, dbType, allowRead, allowWrite, columnDefinitions, acl);
}

async function generatePostgresTableConfig(connection, tableName, dbType, acl) {
    // Get column information including comments
    const columnsQuery = `
        SELECT 
            c.column_name,
            c.data_type,
            c.udt_name,
            c.is_nullable,
            c.column_default,
            c.character_maximum_length,
            c.numeric_precision,
            c.numeric_scale,
            pg_catalog.col_description(format('%s.%s',c.table_schema,c.table_name)::regclass::oid, c.ordinal_position) as column_comment,
            tc.constraint_type
        FROM information_schema.columns c
        LEFT JOIN information_schema.key_column_usage kcu
            ON c.table_name = kcu.table_name 
            AND c.column_name = kcu.column_name
        LEFT JOIN information_schema.table_constraints tc
            ON kcu.constraint_name = tc.constraint_name
        WHERE c.table_name = $1
        ORDER BY c.ordinal_position;
    `;
    
    const result = await connection.query(columnsQuery, [tableName]);
    const columnDefinitions = {};
    const allowRead = [];
    const allowWrite = [];
    
    result.rows.forEach(column => {
        let columnDef = {};
        
        // Handle enum types
        if (global.pgEnumTypes && global.pgEnumTypes[column.udt_name]) {
            columnDef = {
                type: 'string',
                enum: global.pgEnumTypes[column.udt_name]
            };
        } else {
            columnDef = {
                type: mapPostgresType(column.data_type, column.udt_name)
            };
            
            // Add constraints
            const constraints = [];
            if (column.is_nullable === 'NO') constraints.push('NOT NULL');
            if (column.column_default) constraints.push(`DEFAULT ${column.column_default}`);
            if (column.constraint_type === 'PRIMARY KEY') constraints.push('PRIMARY KEY');
            
            if (constraints.length > 0) {
                columnDef.constraints = constraints.join(' ');
            }
            
            // Add length/precision constraints
            if (column.character_maximum_length) {
                columnDef.maxLength = column.character_maximum_length;
            }
            if (column.numeric_precision) {
                columnDef.precision = column.numeric_precision;
                if (column.numeric_scale) {
                    columnDef.scale = column.numeric_scale;
                }
            }
        }
        
        // Add description if present
        if (column.column_comment) {
            columnDef.description = column.column_comment;
        }
        
        columnDefinitions[column.column_name] = columnDef;
        allowRead.push(column.column_name);
        
        // Don't include auto-incrementing fields in allowWrite
        if (!column.column_default?.includes('nextval')) {
            allowWrite.push(column.column_name);
        }
    });
    
    return createTableConfig(tableName, dbType, allowRead, allowWrite, columnDefinitions, acl);
}

function createTableConfig(tableName, dbType, allowRead, allowWrite, columnDefinitions, acl) {
    const tableConfig = {
        routeType: "database",
        dbType,
        dbConnection: process.env.DEFAULT_DBCONNECTION,
        dbTable: tableName,
        route: `/api/${tableName}`,
        allowRead,
        allowWrite,
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
        columnDefinitions,
    };

    if (acl) {
        tableConfig.auth = "token";
        tableConfig.acl = [acl];
    }

    return tableConfig;
}

function mapPostgresType(dataType, udtName) {
    switch (dataType.toLowerCase()) {
        case 'integer':
        case 'smallint':
        case 'bigint':
            return 'INT';
        case 'character varying':
        case 'varchar':
        case 'text':
            return 'VARCHAR';
        case 'boolean':
            return 'BOOL';
        case 'numeric':
        case 'decimal':
            return 'DECIMAL';
        case 'timestamp without time zone':
        case 'timestamp with time zone':
            return 'TIMESTAMP';
        case 'date':
            return 'DATE';
        case 'json':
        case 'jsonb':
            return 'JSON';
        case 'user-defined':
            return udtName.toUpperCase(); // For enum types
        default:
            return dataType.toUpperCase();
    }
}

module.exports = buildApiConfigFromDatabase;
