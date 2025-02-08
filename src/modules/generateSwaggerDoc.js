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
        paths: {},
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: "http",
                    scheme: "bearer",
                    bearerFormat: "JWT"
                },
                tokenAuth: {
                    type: "apiKey",
                    in: "header",
                    name: "X-API-Token"
                }
            },
            schemas: {
                Error: {
                    type: "object",
                    properties: {
                        code: {
                            type: "integer",
                            format: "int32"
                        },
                        message: {
                            type: "string"
                        }
                    }
                }
            }
        },
        tags: []
    };

    // Generate tags from unique route prefixes
    const tags = new Set();
    apiConfig.forEach(endpoint => {
        const routePrefix = endpoint.route.split('/')[2]; // Get prefix after /api/
        if (routePrefix) {
            tags.add(routePrefix);
        }
    });
    swaggerDoc.tags = Array.from(tags).map(tag => ({
        name: tag,
        description: `Operations related to ${tag}`
    }));
    
    apiConfig.forEach(endpoint => {
        const { route, allowMethods = ["GET"], allowRead = [], allowWrite = [], columnDefinitions = {}, auth } = endpoint;
        console.log(`First Endpoint:`,endpoint);
        swaggerDoc.paths[route] = swaggerDoc.paths[route] || {};
        
        // Determine security based on auth type
        const security = [];
        if (auth === "token") {
            security.push({ tokenAuth: [] });
        } else if (auth === "bearer") {
            security.push({ bearerAuth: [] });
        }

        if (allowMethods.includes("GET")) {
            const routePrefix = route.split('/')[2];
            swaggerDoc.paths[route].get = {
                tags: routePrefix ? [routePrefix] : undefined,
                operationId: `get${toPascalCase(endpoint.dbTable || routePrefix || 'Records')}`,
                summary: `Retrieve records from ${endpoint.dbTable}`,
                parameters: allowRead.map(field => ({
                    name: field,
                    in: "query",
                    schema: getPropertyType(columnDefinitions[field]),
                    description: `Filter by ${field}`
                })),
                security,
                responses: {
                    "200": {
                        description: "Successful response",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        required: getRequiredFields(columnDefinitions, allowRead),
                                        properties: generatePropertiesSchema(columnDefinitions, allowRead)
                                    }
                                },
                                example: generateExample(columnDefinitions, allowRead)
                            }
                        }
                    },
                    "400": {
                        description: "Bad request",
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: "#/components/schemas/Error"
                                },
                                example: {
                                    code: 400,
                                    message: "Invalid request parameters"
                                }
                            }
                        }
                    },
                    "401": {
                        description: "Unauthorized",
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: "#/components/schemas/Error"
                                },
                                example: {
                                    code: 401,
                                    message: "Authentication required"
                                }
                            }
                        }
                    }
                }
            };
        }

        if (allowMethods.includes("POST")) {
            const routePrefix = route.split('/')[2];
            swaggerDoc.paths[route].post = {
                tags: routePrefix ? [routePrefix] : undefined,
                operationId: `create${toPascalCase(endpoint.dbTable || routePrefix || 'Record')}`,
                summary: `Create a new record in ${endpoint.dbTable}`,
                security,
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: getRequiredFields(columnDefinitions, allowWrite),
                                properties: generatePropertiesSchema(columnDefinitions, allowWrite)
                            },
                            example: generateExample(columnDefinitions, allowWrite)
                        }
                    }
                },
                responses: {
                    "201": {
                        description: "Record created successfully",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        id: {
                                            type: "integer",
                                            description: "ID of the created record"
                                        },
                                        message: {
                                            type: "string",
                                            example: "Record created successfully"
                                        }
                                    }
                                }
                            }
                        }
                    },
                    "400": {
                        description: "Bad request",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/Error" },
                                example: {
                                    code: 400,
                                    message: "Invalid request body"
                                }
                            }
                        }
                    },
                    "401": {
                        description: "Unauthorized",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/Error" },
                                example: {
                                    code: 401,
                                    message: "Authentication required"
                                }
                            }
                        }
                    }
                }
            };
        }

        if (allowMethods.includes("PUT")) {
            const routePrefix = route.split('/')[2];
            swaggerDoc.paths[`${route}/{id}`] = swaggerDoc.paths[`${route}/{id}`] || {};
            swaggerDoc.paths[`${route}/{id}`].put = {
                tags: routePrefix ? [routePrefix] : undefined,
                operationId: `update${toPascalCase(endpoint.dbTable || routePrefix || 'Record')}`,
                summary: `Update a record in ${endpoint.dbTable}`,
                security,
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
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: getRequiredFields(columnDefinitions, allowWrite),
                                properties: generatePropertiesSchema(columnDefinitions, allowWrite)
                            },
                            example: generateExample(columnDefinitions, allowWrite)
                        }
                    }
                },
                responses: {
                    "200": {
                        description: "Record updated successfully",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        message: {
                                            type: "string",
                                            example: "Record updated successfully"
                                        }
                                    }
                                }
                            }
                        }
                    },
                    "400": {
                        description: "Bad request",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/Error" },
                                example: {
                                    code: 400,
                                    message: "Invalid request body"
                                }
                            }
                        }
                    },
                    "401": {
                        description: "Unauthorized",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/Error" },
                                example: {
                                    code: 401,
                                    message: "Authentication required"
                                }
                            }
                        }
                    },
                    "404": {
                        description: "Record not found",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/Error" },
                                example: {
                                    code: 404,
                                    message: "Record not found"
                                }
                            }
                        }
                    }
                }
            };
        }

        if (allowMethods.includes("DELETE")) {
            const routePrefix = route.split('/')[2];
            swaggerDoc.paths[`${route}/{id}`] = swaggerDoc.paths[`${route}/{id}`] || {};
            swaggerDoc.paths[`${route}/{id}`].delete = {
                tags: routePrefix ? [routePrefix] : undefined,
                operationId: `delete${toPascalCase(endpoint.dbTable || routePrefix || 'Record')}`,
                summary: `Delete a record from ${endpoint.dbTable}`,
                security,
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
                        description: "Record deleted successfully",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        message: {
                                            type: "string",
                                            example: "Record deleted successfully"
                                        }
                                    }
                                }
                            }
                        }
                    },
                    "401": {
                        description: "Unauthorized",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/Error" },
                                example: {
                                    code: 401,
                                    message: "Authentication required"
                                }
                            }
                        }
                    },
                    "404": {
                        description: "Record not found",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/Error" },
                                example: {
                                    code: 404,
                                    message: "Record not found"
                                }
                            }
                        }
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
        properties[field] = getPropertyType(columnDefinition);
    });
    return properties;
}

/**
 * Gets the OpenAPI property type definition including enum values if present
 * @param {Object} columnDefinition - Column definition from the endpoint config
 * @returns {Object} OpenAPI property type definition
 */
/**
 * Gets the OpenAPI property type definition including enum values and formats
 * @param {Object} columnDefinition - Column definition from the endpoint config
 * @returns {Object} OpenAPI property type definition
 */
function getPropertyType(columnDefinition) {
    if (!columnDefinition) return { type: "string" };

    const property = {
        type: mapSQLTypeToOpenAPIType(columnDefinition.type || columnDefinition)
    };

    // Handle enum values if present
    if (columnDefinition.enum || (typeof columnDefinition === 'string' && columnDefinition.startsWith('ENUM'))) {
        const enumValues = columnDefinition.enum || 
            columnDefinition.match(/ENUM\((.*)\)/i)?.[1]
                ?.split(',')
                ?.map(val => val.trim().replace(/'/g, ''));
                
        if (enumValues) {
            property.enum = enumValues;
        }
    }

    // Add format based on SQL type
    const type = typeof columnDefinition === 'string' ? columnDefinition.toUpperCase() : '';
    if (type.includes('DATETIME') || type.includes('TIMESTAMP')) {
        property.format = 'date-time';
    } else if (type.includes('DATE')) {
        property.format = 'date';
    } else if (type.includes('EMAIL')) {
        property.format = 'email';
    } else if (type.includes('UUID')) {
        property.format = 'uuid';
    } else if (type.includes('URI')) {
        property.format = 'uri';
    } else if (type.includes('IPV4')) {
        property.format = 'ipv4';
    } else if (type.includes('IPV6')) {
        property.format = 'ipv6';
    }

    // Add description if provided
    if (columnDefinition.description) {
        property.description = columnDefinition.description;
    }

    // Add pattern if provided
    if (columnDefinition.pattern) {
        property.pattern = columnDefinition.pattern;
    }

    // Add min/max for numeric types
    if (property.type === 'integer' || property.type === 'number') {
        if (columnDefinition.minimum !== undefined) property.minimum = columnDefinition.minimum;
        if (columnDefinition.maximum !== undefined) property.maximum = columnDefinition.maximum;
    }

    // Add min/max length for strings
    if (property.type === 'string') {
        if (columnDefinition.minLength !== undefined) property.minLength = columnDefinition.minLength;
        if (columnDefinition.maxLength !== undefined) property.maxLength = columnDefinition.maxLength;
    }

    return property;
}

/**
 * Determines which fields are required based on column definitions
 * @param {Object} columnDefinitions - Column definitions from the endpoint config
 * @param {Array} fields - Array of field names to check
 * @returns {Array} Array of required field names
 */
function getRequiredFields(columnDefinitions, fields) {
    return fields.filter(field => {
        const def = columnDefinitions[field];
        if (!def) return false;
        
        // Check for NOT NULL in SQL definition
        if (typeof def === 'string' && def.toUpperCase().includes('NOT NULL')) {
            return true;
        }
        
        // Check for required flag in object definition
        if (typeof def === 'object' && def.required === true) {
            return true;
        }
        
        return false;
    });
}

/**
 * Generates example values for fields based on their types
 * @param {Object} columnDefinitions - Column definitions from the endpoint config
 * @param {Array} fields - Array of field names
 * @returns {Object} Example object
 */
function generateExample(columnDefinitions, fields) {
    const example = {};
    fields.forEach(field => {
        const def = columnDefinitions[field];
        if (!def) {
            example[field] = "";
            return;
        }

        const type = typeof def === 'string' ? def.toUpperCase() : def.type;
        
        if (def.example !== undefined) {
            example[field] = def.example;
        } else if (def.enum || type.startsWith('ENUM')) {
            const enumValues = def.enum || type.match(/ENUM\((.*)\)/i)?.[1]
                ?.split(',')
                ?.map(val => val.trim().replace(/'/g, ''));
            example[field] = enumValues?.[0] || "";
        } else if (type.includes('INT')) {
            example[field] = 1;
        } else if (type.includes('DECIMAL') || type.includes('FLOAT')) {
            example[field] = 1.0;
        } else if (type.includes('BOOL')) {
            example[field] = true;
        } else if (type.includes('DATE')) {
            example[field] = new Date().toISOString();
        } else if (type.includes('JSON')) {
            example[field] = { key: "value" };
        } else {
            example[field] = "example";
        }
    });
    return example;
}

/**
 * Maps SQL data types to OpenAPI data types.
 * @param {String} sqlType - SQL column type.
 * @returns {String} Corresponding OpenAPI type.
 */
function mapSQLTypeToOpenAPIType(sqlType) {
    if (!sqlType) return "string"; // Default to string if type is unknown
    const type = typeof sqlType === 'string' ? sqlType.toUpperCase() : '';
    
    if (type.startsWith("VARCHAR") || type.startsWith("TEXT") || type.startsWith("ENUM")) return "string";
    if (type.startsWith("INT")) return "integer";
    if (type.startsWith("DECIMAL") || type.startsWith("FLOAT") || type.startsWith("DOUBLE")) return "number";
    if (type.startsWith("BOOL")) return "boolean";
    if (type.startsWith("DATE") || type.startsWith("TIMESTAMP")) return "string";
    return "string";
}

// // Example usage:
// const apiConfig = JSON.parse(fs.readFileSync(path.resolve(__dirname, './config/apiConfig.json'), 'utf-8'));
// generateSwaggerDoc(apiConfig, './swagger.json');

module.exports = generateSwaggerDoc;
