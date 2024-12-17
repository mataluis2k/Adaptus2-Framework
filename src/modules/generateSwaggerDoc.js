const fs = require('fs');
const path = require('path');

/**
 * Generates Swagger documentation from the given API configuration.
 * @param {Array} apiConfig - The API configuration array from apiConfig.json.
 * @param {String} outputFilePath - Path to save the generated Swagger JSON file.
 */
function generateSwaggerDoc(apiConfig, outputFilePath) {
    const swaggerDoc = {
        openapi: "3.0.0",
        info: {
            title: "API Documentation",
            version: "1.0.0",
            description: "Generated API documentation"
        },
        servers: [
            {
                url: "http://localhost:3000",
                description: "Local server"
            }
        ],
        paths: {}
    };

    console.log(`API Config:`,apiConfig);
    apiConfig.forEach(endpoint => {
        const { route, allowMethods = ["GET"], allowRead = [], allowWrite = [], columnDefinitions = {} } = endpoint;
        console.log(`First Endpoint:`,endpoint);
        swaggerDoc.paths[route] = swaggerDoc.paths[route] || {};

        if (allowMethods.includes("GET")) {
            swaggerDoc.paths[route].get = {
                summary: `Retrieve records from ${endpoint.dbTable}`,
                parameters: allowRead.map(field => ({
                    name: field,
                    in: "query",
                    schema: {
                        type: "string"
                    },
                    description: `Filter by ${field}`
                })),
                responses: {
                    "200": {
                        description: "Successful response",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: generatePropertiesSchema(columnDefinitions, allowRead)
                                    }
                                }
                            }
                        }
                    }
                }
            };
        }

        if (allowMethods.includes("POST")) {
            swaggerDoc.paths[route].post = {
                summary: `Create a new record in ${endpoint.dbTable}`,
                requestBody: {
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: generatePropertiesSchema(columnDefinitions, allowWrite)
                            }
                        }
                    }
                },
                responses: {
                    "201": {
                        description: "Record created successfully"
                    }
                }
            };
        }

        if (allowMethods.includes("PUT")) {
            swaggerDoc.paths[`${route}/{id}`] = swaggerDoc.paths[`${route}/{id}`] || {};
            swaggerDoc.paths[`${route}/{id}`].put = {
                summary: `Update a record in ${endpoint.dbTable}`,
                parameters: [
                    {
                        name: "id",
                        in: "path",
                        required: true,
                        schema: {
                            type: "integer"
                        },
                        description: "ID of the record to update"
                    }
                ],
                requestBody: {
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: generatePropertiesSchema(columnDefinitions, allowWrite)
                            }
                        }
                    }
                },
                responses: {
                    "200": {
                        description: "Record updated successfully"
                    }
                }
            };
        }

        if (allowMethods.includes("DELETE")) {
            swaggerDoc.paths[`${route}/{id}`] = swaggerDoc.paths[`${route}/{id}`] || {};
            swaggerDoc.paths[`${route}/{id}`].delete = {
                summary: `Delete a record from ${endpoint.dbTable}`,
                parameters: [
                    {
                        name: "id",
                        in: "path",
                        required: true,
                        schema: {
                            type: "integer"
                        },
                        description: "ID of the record to delete"
                    }
                ],
                responses: {
                    "200": {
                        description: "Record deleted successfully"
                    }
                }
            };
        }
    });

    fs.writeFileSync(outputFilePath, JSON.stringify(swaggerDoc, null, 2), 'utf-8');
    console.log(`Swagger documentation generated at ${outputFilePath}`);
}


/**
 * Converts a string to PascalCase.
 * @param {String} str - Input string.
 * @returns {String} PascalCase string.
 */
function toPascalCase(str) {
    return str
        .split('_')
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
}

/**
 * Generate GraphQL arguments for a field set.
 * @param {Array} fields - Field names.
 * @returns {Object} Arguments for GraphQL schema.
 */
function generateGraphQLArgs(fields) {
    return fields.reduce((args, field) => {
        args[field] = { type: "String" }; // Assume all fields are strings; adjust as needed.
        return args;
    }, {});
}

/**
 * Generate the schema properties for the given fields.
 * @param {Object} columnDefinitions - Column definitions from the endpoint config.
 * @param {Array} fields - Array of field names.
 * @returns {Object} Schema properties for Swagger.
 */
function generatePropertiesSchema(columnDefinitions, fields) {
    const properties = {};
    fields.forEach(field => {
        const columnDefinition = columnDefinitions[field];
        properties[field] = { type: mapSQLTypeToOpenAPIType(columnDefinition) };
    });
    return properties;
}

/**
 * Maps SQL data types to OpenAPI data types.
 * @param {String} sqlType - SQL column type.
 * @returns {String} Corresponding OpenAPI type.
 */
function mapSQLTypeToOpenAPIType(sqlType) {
    if (!sqlType) return "string"; // Default to string if type is unknown
    if (sqlType.startsWith("VARCHAR") || sqlType.startsWith("TEXT")) return "string";
    if (sqlType.startsWith("INT")) return "integer";
    if (sqlType.startsWith("DECIMAL") || sqlType.startsWith("FLOAT") || sqlType.startsWith("DOUBLE")) return "number";
    return "string";
}

// // Example usage:
// const apiConfig = JSON.parse(fs.readFileSync(path.resolve(__dirname, './config/apiConfig.json'), 'utf-8'));
// generateSwaggerDoc(apiConfig, './swagger.json');

module.exports = generateSwaggerDoc;
