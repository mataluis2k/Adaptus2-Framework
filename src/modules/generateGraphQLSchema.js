const consolelog = require('./logger');

var { buildSchema } = require('graphql');

function printResolvers(resolvers) {
    Object.entries(resolvers).forEach(([type, resolverGroup]) => {
        consolelog.log(`Resolvers for ${type}:`);
        Object.entries(resolverGroup).forEach(([resolverName, resolverFn]) => {
            consolelog.log(`- ${resolverName}:`);
            consolelog.log(resolverFn.toString()); // Print the function definition
        });
    });
}
// Utility to generate GraphQL schema and root resolvers from config
function generateGraphQLSchema(config) {
    let schemaString = '';
    const rootResolvers = { Query: {}, Mutation: {} };
    var selectFields = "";
    var getAllQuery = "";
    var getByIdQuery = "";
    const tables = [];

    // Collect Query and Mutation fields
    const queryFields = [];
    const mutationFields = [];

    try{
    config.forEach((endpoint) => {
        if  (endpoint.routeType !== 'database')  {
            return; // Skip this iteration
        }

        const { dbTable, allowRead, allowWrite } = endpoint;
        if(tables.includes(dbTable)) {
            return;
        }
        // test if table has allowRead if not skip
        if (!allowRead) {
            return;
        }

        tables.push(dbTable);
    
        // Generate type definition for the database table
        const typeName = dbTable.charAt(0).toUpperCase() + dbTable.slice(1);
        const fields = allowRead.map((field) => `${field}: String`).join('\n');
        schemaString += `
            type ${typeName} {
                ${fields}
            }
        `;
    
        if (allowRead && allowRead.length > 0) {
            queryFields.push(`
                getAll${typeName}: [${typeName}]
                get${typeName}(id: String): ${typeName}
            `);
            // Construct the query strings
            selectFields = allowRead.join(', ');
            getAllQuery = `SELECT ${selectFields} FROM ${dbTable}`;
            getByIdQuery = `SELECT ${selectFields} FROM ${dbTable} WHERE id = ?`;
        
            consolelog.log(`Allow read: ${allowRead}`);
            consolelog.log(`GetAll Query: ${getAllQuery}`);
            consolelog.log(`GetById Query: ${getByIdQuery}`);
        
            // Bind resolvers with queries and ensure dynamic parameters are passed correctly
            rootResolvers.Query[`getAll${typeName}`] = createGetAllResolver(typeName, getAllQuery);
            rootResolvers.Query[`get${typeName}`] = createGetResolver(typeName, getByIdQuery);
        }
    
        // Add Mutation definitions
        if (allowWrite && allowWrite.length > 0) {
            schemaString += `
                input ${typeName}Input {
                    ${allowWrite.map((field) => `${field}: String`).join('\n')}
                }
            `;
    
            mutationFields.push(`
                create${typeName}(input: ${typeName}Input): ${typeName}
            `);
    
            // Use factory function to bind the correct values for the mutation resolver
            rootResolvers.Mutation[`create${typeName}`] = createMutationResolver(typeName, dbTable);
        }
    });
} catch (error) {   
    console.error('Error in generateGraphQLSchema:', error.message);
    throw new Error('Failed to generate GraphQL schema.');
}

    if (queryFields.length > 0) {
        schemaString += `
            type Query {
                ${queryFields.join('\n')}
            }
        `;
    } else {
        // Provide a default Query root if no query fields are added
        schemaString += `
            type Query {
                _empty: String
            }
        `;
    }
    
    if (mutationFields.length > 0) {
        schemaString += `
            type Mutation {
                ${mutationFields.join('\n')}
            }
        `;
    }

    // Build the schema
    const schema = buildSchema(schemaString);

    return { schema, rootResolvers };
}

// Helper function to create "getAll<Type>" resolver
function createGetAllResolver(typeName, query) {
    return async (req, res) => {
        try {            
            const { dbConnection } = res;
            if (!dbConnection) {
                throw new Error('dbConnection is not defined in the context');
            }            
            const [results] = await dbConnection.execute(query);
            
            return results;
        } catch (error) {
            console.error(`Error in getAll${typeName} resolver:`, error.message);
            throw new Error('Failed to fetch data.');
        }
    };
}


function createGetResolver(typeName, query) {
    return async (req, res) => {
        try {
             

            const { dbConnection } = res;
            if (!dbConnection) {
                throw new Error('dbConnection is not defined in the context');
            }

            consolelog.log(`Database connection for get${typeName} acquired`);

            // Assuming `id` is passed in the GraphQL query as an argument
            const { id } = req;
            if (!id) {
                throw new Error('ID is required to fetch the record.');
            }

            
            const [results] = await dbConnection.execute(query, [id]);
            

            return results[0] || null; // Return the first record or null if not found
        } catch (error) {
            console.error(`Error in get${typeName} resolver:`, error.message);
            throw new Error('Failed to fetch data.');
        }
    };
}

// Helper function to create "create<Type>" resolver
function createMutationResolver(typeName, dbTable) {
    return async (_, { input }, { dbConnection }) => {
        try {
            consolelog.log(`Resolver called: create${typeName}`);
            const connection = await dbConnection();
            const fields = Object.keys(input).join(', ');
            const placeholders = Object.keys(input).map(() => '?').join(', ');
            const query = `INSERT INTO ${dbTable} (${fields}) VALUES (${placeholders})`;
            consolelog.log(`SQL Query: ${query}`);
            const [result] = await connection.execute(query, Object.values(input));
            consolelog.log(`Insert Results:`, result);
            return { id: result.insertId, ...input };
        } catch (error) {
            console.error(`Error in create${typeName} resolver:`, error);
            throw new Error('Failed to create entry.');
        }
    };
}

module.exports = generateGraphQLSchema;
