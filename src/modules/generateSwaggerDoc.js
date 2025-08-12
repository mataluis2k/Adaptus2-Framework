const fs = require('fs');
const path = require('path');

/**
 * Generates Swagger documentation from the given API configuration.
 * @param {Array} apiConfig - The API configuration array from apiConfig.json.
 * @param {String} outputFilePath - Path to save the generated Swagger JSON file.
 * @param {String} businessRulesPath - Optional path to businessRules.dsl file.
 * @param {String} pluginsPath - Optional path to plugins directory.
 */
function generateSwaggerDoc(apiConfig, outputFilePath, businessRulesPath = null, pluginsPath = null) {
    // Parse business rules if provided
    const businessRulesMap = businessRulesPath ? parseBusinessRules(businessRulesPath) : null;

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
        if (endpoint.route) {
            const routePrefix = endpoint.route.split('/')[2]; // Get prefix after /api/
            if (routePrefix) {
                tags.add(routePrefix);
            }
        }
    });
    swaggerDoc.tags = Array.from(tags).map(tag => ({
        name: tag,
        description: `Operations related to ${tag}`
    }));

    apiConfig.forEach(endpoint => {
        const { route, allowMethods = ["GET"], allowRead = [], allowWrite = [], columnDefinitions = {}, auth, routeType } = endpoint;

        // Skip endpoints without a route
        if (!route) {
            console.log(`[DEBUG] Skipping endpoint without route:`, endpoint);
            return;
        }

        // NEW: Check if this is a dynamic endpoint with business rules
        console.log(`[DEBUG] Processing endpoint: ${route}, routeType: ${routeType}, method: ${allowMethods[0]}`);
        console.log(`[DEBUG] Business rules map exists: ${!!businessRulesMap}`);
        if (businessRulesMap) {
            const routeKey = `${allowMethods[0]} ${route}`;
            console.log(`[DEBUG] Looking for route key: "${routeKey}"`);
            console.log(`[DEBUG] Available business rules:`, Object.keys(businessRulesMap));
            console.log(`[DEBUG] Found in business rules: ${!!businessRulesMap[routeKey]}`);
        }

        if (routeType === 'dynamic' && businessRulesMap && businessRulesMap[`${allowMethods[0]} ${route}`]) {
            console.log(`[DEBUG] ✓ Generating dynamic Swagger for: ${route}`);
            const dynamicSwagger = generateDynamicEndpointSwagger(endpoint, businessRulesMap, pluginsPath);
            console.log(`[DEBUG] Dynamic Swagger generated for ${route}:`, JSON.stringify(dynamicSwagger, null, 2));
            Object.assign(swaggerDoc.paths, dynamicSwagger);
            console.log(`[DEBUG] After merge, swaggerDoc.paths[${route}]:`, JSON.stringify(swaggerDoc.paths[route], null, 2));
            console.log(`[DEBUG] Returning early for dynamic endpoint: ${route}`);
            return; // Skip the existing logic for this endpoint
        }

        // EXISTING LOGIC CONTINUES UNCHANGED BELOW
        console.log(`[DEBUG] Using standard Swagger generation for: ${route}`);
        if (swaggerDoc.paths[route]) {
            console.log(`[DEBUG] WARNING: Route ${route} already exists in swaggerDoc.paths, overwriting with standard logic`);
        }
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

/**
 * Parse businessRules.dsl file to extract route-to-action mappings
 * @param {String} filePath - Path to businessRules.dsl file
 * @returns {Object} Mapping of route keys to action info
 */
function parseBusinessRules(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        const businessRulesMap = {};

        console.log(`[DEBUG] Parsing business rules file with ${lines.length} lines`);

        let currentRule = null;

        lines.forEach((line, index) => {
            const trimmedLine = line.trim();

            // Skip empty lines and comments
            if (!trimmedLine || trimmedLine.startsWith('//')) {
                return;
            }

            console.log(`[DEBUG] Processing line ${index + 1}: "${trimmedLine}"`);

            // Check if this is an IF statement (start of a rule)
            const ifMatch = trimmedLine.match(/IF\s+(GET|POST|PUT|DELETE|PATCH)\s+([^\s]+)\s+THEN/);
            if (ifMatch) {
                const [, method, route] = ifMatch;
                // Add /api/ prefix to match the endpoint routes
                const fullRoute = route.startsWith('/') ? route : `/api/${route}`;
                const routeKey = `${method} ${fullRoute}`;

                console.log(`[DEBUG] Found IF statement: ${routeKey}`);
                currentRule = {
                    method,
                    route: fullRoute,
                    action: null,
                    params: []
                };
                return;
            }

            // If we have a current rule and this line contains an action, parse it
            if (currentRule && !currentRule.action) {
                // Match action with optional data parameters
                // First, try to match the action name
                const actionNameMatch = trimmedLine.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
                if (actionNameMatch) {
                    const action = actionNameMatch[1];
                    currentRule.action = action;
                    console.log(`[DEBUG] Found action: ${action} for ${currentRule.method} ${currentRule.route}`);

                    // Now extract data parameters if present
                    let dataParams = null;

                    // Look for "data: { ... }" pattern
                    const dataMatch = trimmedLine.match(/data:\s*(\{[^}]*\})/);
                    if (dataMatch) {
                        dataParams = dataMatch[1];
                    } else {
                        // Look for direct object pattern "{ ... }" (not empty)
                        const directMatch = trimmedLine.match(/\s+(\{[^}]*\})/);
                        if (directMatch && directMatch[1] !== '{}') {
                            dataParams = directMatch[1];
                        }
                    }

                    // Parse data parameters if present
                    if (dataParams) {
                        try {
                            console.log(`[DEBUG] Parsing data params: ${dataParams}`);
                            // Extract parameter names from the data object
                            // Pattern: "paramName": "${data.paramName}"
                            const paramMatches = dataParams.match(/"([^"]+)":\s*"\$\{data\.([^}]+)\}"/g);
                            console.log(`[DEBUG] Param matches found:`, paramMatches);
                            if (paramMatches) {
                                currentRule.params = paramMatches.map(match => {
                                    const paramMatch = match.match(/"([^"]+)":\s*"\$\{data\.([^}]+)\}"/);
                                    console.log(`[DEBUG] Processing match: ${match} -> ${paramMatch ? paramMatch[2] : 'null'}`);
                                    return paramMatch ? paramMatch[2] : null;
                                }).filter(Boolean);
                            }
                            console.log(`[DEBUG] Parsed params for ${currentRule.method} ${currentRule.route}:`, currentRule.params);
                        } catch (e) {
                            console.log(`[DEBUG] Failed to parse data params: ${dataParams}`);
                        }
                    }

                    // Store the completed rule
                    const routeKey = `${currentRule.method} ${currentRule.route}`;
                    businessRulesMap[routeKey] = { ...currentRule };
                    console.log(`[DEBUG] Stored business rule: ${routeKey} -> ${action}`);

                    // Reset for next rule
                    currentRule = null;
                }
            }
        });

        console.log(`[DEBUG] Parsed ${Object.keys(businessRulesMap).length} business rules:`, Object.keys(businessRulesMap));
        return businessRulesMap;
    } catch (error) {
        console.log(`[DEBUG] Error parsing business rules: ${error.message}`);
        return {};
    }
}

/**
 * Find plugin action and extract function signature and response schemas
 * @param {String} actionName - Name of the action to find
 * @param {String} pluginsPath - Path to plugins directory
 * @returns {Object} Action information including function signature and response schemas
 */
function findPluginAction(actionName, pluginsPath) {
    try {
        const fs = require('fs');
        const path = require('path');

        if (!fs.existsSync(pluginsPath)) {
            console.log(`[DEBUG] Plugins directory not found: ${pluginsPath}`);
            return null;
        }

        const pluginFiles = fs.readdirSync(pluginsPath).filter(file => file.endsWith('.js'));

        for (const file of pluginFiles) {
            const filePath = path.join(pluginsPath, file);
            const content = fs.readFileSync(filePath, 'utf8');

            // Look for the action registration pattern: registerAction(..., 'actionName', ...)
            const registerMatch = content.match(new RegExp(`registerAction\\s*\\([^,]+,\\s*['"]${actionName}['"][^)]*\\)`));
            if (registerMatch) {
                console.log(`[DEBUG] Found action ${actionName} registered in ${file}`);

                // Look for the actual function that's bound to this action
                // Pattern: this.actionName.bind(this) or this.actionName
                const functionMatch = content.match(new RegExp(`this\\.([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\.bind\\(this\\)`));
                if (functionMatch) {
                    const actualFunctionName = functionMatch[1];
                    console.log(`[DEBUG] Action ${actionName} maps to function ${actualFunctionName}`);

                    // Now look for the actual function definition and extract response schemas
                    const actualFunctionMatch = content.match(new RegExp(`async\\s+${actualFunctionName}\\s*\\([^)]*\\)\\s*=>\\s*\\{([\\s\\S]*?)\\}`));
                    if (actualFunctionMatch) {
                        const functionBody = actualFunctionMatch[1];
                        console.log(`[DEBUG] Found function body for ${actualFunctionName} (length: ${functionBody.length})`);
                        console.log(`[DEBUG] Function body preview: ${functionBody.substring(0, 200)}...`);
                        const responseSchemas = extractResponseSchemas(functionBody);
                        return {
                            pluginFile: file,
                            functionBody: functionBody,
                            hasReturn: functionBody.includes('return'),
                            hasCreateResponse: functionBody.includes('createSuccessResponse') || functionBody.includes('createErrorResponse'),
                            responseSchemas: responseSchemas
                        };
                    }

                    // Also look for method definition pattern: async functionName(ctx, paramsData) { ... }
                    // Use a more robust approach to extract the complete function body
                    const functionStart = content.indexOf(`async ${actualFunctionName}(`);
                    if (functionStart !== -1) {
                        // Find the opening brace after the function signature
                        const braceStart = content.indexOf('{', functionStart);
                        if (braceStart !== -1) {
                            // Use brace counting to find the matching closing brace
                            let braceCount = 1;
                            let functionEnd = braceStart + 1;

                            while (braceCount > 0 && functionEnd < content.length) {
                                if (content[functionEnd] === '{') {
                                    braceCount++;
                                } else if (content[functionEnd] === '}') {
                                    braceCount--;
                                }
                                functionEnd++;
                            }

                            if (braceCount === 0) {
                                const functionBody = content.substring(braceStart + 1, functionEnd - 1);
                                console.log(`[DEBUG] Found method body for ${actualFunctionName} (length: ${functionBody.length})`);
                                console.log(`[DEBUG] Method body preview: ${functionBody.substring(0, 200)}...`);
                                const responseSchemas = extractResponseSchemas(functionBody);
                                return {
                                    pluginFile: file,
                                    functionBody: functionBody,
                                    hasReturn: functionBody.includes('return'),
                                    hasCreateResponse: functionBody.includes('createSuccessResponse') || functionBody.includes('createErrorResponse'),
                                    responseSchemas: responseSchemas
                                };
                            }
                        }
                    }
                }

                // If no bind pattern, look for direct function assignment
                const directMatch = content.match(new RegExp(`async\\s+${actionName}\\s*\\([^)]*\\)\\s*=>\\s*\\{([\\s\\S]*?)\\}`));
                if (directMatch) {
                    const functionBody = directMatch[1];
                    const responseSchemas = extractResponseSchemas(functionBody);
                    return {
                        pluginFile: file,
                        functionBody: functionBody,
                        hasReturn: functionBody.includes('return'),
                        hasCreateResponse: functionBody.includes('createSuccessResponse') || functionBody.includes('createErrorResponse'),
                        responseSchemas: responseSchemas
                    };
                }
            }
        }

        console.log(`[DEBUG] Action ${actionName} not found in plugins`);
        return null;
    } catch (error) {
        console.log(`[DEBUG] Error finding plugin action: ${error.message}`);
        return null;
    }
}

/**
 * Extract response schemas from plugin function body
 * @param {String} functionBody - The function body to analyze
 * @returns {Object} Extracted response schemas
 */
function extractResponseSchemas(functionBody) {
    const schemas = {
        success: null,
        errors: []
    };

    try {
        console.log(`[DEBUG] Analyzing function body for response schemas...`);

        // Extract createSuccessResponse calls with better regex
        const successMatches = functionBody.match(/createSuccessResponse\s*\(\s*[^,]+,\s*([^,]+),\s*[^,]+/g);
        if (successMatches) {
            console.log(`[DEBUG] Found ${successMatches.length} createSuccessResponse calls`);
            successMatches.forEach((match, index) => {
                console.log(`[DEBUG] Success match ${index + 1}: ${match}`);

                // Extract the responseData parameter (second parameter)
                const dataMatch = match.match(/createSuccessResponse\s*\(\s*[^,]+,\s*([^,]+),\s*[^,]+/);
                if (dataMatch) {
                    const responseDataVar = dataMatch[1].trim();
                    console.log(`[DEBUG] Found success response data variable: ${responseDataVar}`);

                    // Look for the responseData object definition with more flexible regex
                    const dataObjectPattern = new RegExp(`${responseDataVar}\\s*=\\s*\\{([\\s\\S]*?)\\}\\s*;?`);
                    const dataObjectMatch = functionBody.match(dataObjectPattern);
                    if (dataObjectMatch) {
                        const objectContent = dataObjectMatch[1];
                        console.log(`[DEBUG] Found response data object: ${objectContent}`);
                        schemas.success = parseObjectToSchema(objectContent);
                    } else {
                        console.log(`[DEBUG] Could not find object definition for ${responseDataVar}`);
                    }
                }
            });
        } else {
            console.log(`[DEBUG] No createSuccessResponse calls found`);
        }

        // Extract createErrorResponse calls with better regex
        const errorMatches = functionBody.match(/createErrorResponse\s*\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*([^,]+),\s*([^,]+)/g);
        if (errorMatches) {
            console.log(`[DEBUG] Found ${errorMatches.length} createErrorResponse calls`);
            errorMatches.forEach((match, index) => {
                console.log(`[DEBUG] Error match ${index + 1}: ${match}`);

                const errorMatch = match.match(/createErrorResponse\s*\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*([^,]+),\s*([^,]+)/);
                if (errorMatch) {
                    const httpCode = errorMatch[1].trim();
                    const errorCode = errorMatch[2].trim();
                    console.log(`[DEBUG] Found error response: HTTP ${httpCode}, Code ${errorCode}`);

                    schemas.errors.push({
                        httpCode: parseInt(httpCode) || 400,
                        errorCode: errorCode,
                        description: getErrorDescription(httpCode)
                    });
                }
            });
        } else {
            console.log(`[DEBUG] No createErrorResponse calls found`);
        }

    } catch (error) {
        console.log(`[DEBUG] Error extracting response schemas: ${error.message}`);
    }

    return schemas;
}

/**
 * Parse object content to OpenAPI schema
 * @param {String} objectContent - The object content string
 * @returns {Object} OpenAPI schema
 */
function parseObjectToSchema(objectContent) {
    const schema = {
        type: "object",
        properties: {}
    };

    try {
        console.log(`[DEBUG] parseObjectToSchema called with: ${objectContent}`);

        // Split by commas and parse each property
        const properties = objectContent.split(',').map(prop => prop.trim());
        console.log(`[DEBUG] Split properties:`, properties);

        properties.forEach(prop => {
            const colonMatch = prop.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.+)$/);
            if (colonMatch) {
                const [, propertyName, propertyValue] = colonMatch;
                console.log(`[DEBUG] Processing property: ${propertyName} = ${propertyValue}`);
                const propertySchema = inferPropertyType(propertyValue.trim());
                if (propertySchema) {
                    schema.properties[propertyName] = propertySchema;
                    console.log(`[DEBUG] Added property schema for ${propertyName}:`, propertySchema);
                }
            } else {
                console.log(`[DEBUG] Could not parse property: ${prop}`);
            }
        });

        console.log(`[DEBUG] Final schema:`, schema);
    } catch (error) {
        console.log(`[DEBUG] Error parsing object to schema: ${error.message}`);
    }

    return schema;
}

/**
 * Infer property type from value
 * @param {String} value - The property value
 * @returns {Object} OpenAPI property schema
 */
function inferPropertyType(value) {
    // Remove quotes and trim
    const cleanValue = value.replace(/['"]/g, '').trim();

    if (cleanValue === 'true' || cleanValue === 'false') {
        return { type: "boolean", example: cleanValue === 'true' };
    }

    if (!isNaN(cleanValue) && cleanValue !== '') {
        return { type: "integer", example: parseInt(cleanValue) };
    }

    // If this looks like a variable reference, do not include example
    if (!value.includes('"') && !value.includes("'") && (cleanValue.includes('.') || /^[a-z][a-zA-Z0-9_]*$/.test(cleanValue))) {
        if (cleanValue.includes('@')) {
            return { type: "string", format: "email" };
        }
        if (cleanValue.includes('-') && cleanValue.length > 20) {
            return { type: "string", format: "date-time" };
        }
        return { type: "string" };
    }

    if (cleanValue.includes('@')) {
        return { type: "string", format: "email", example: cleanValue };
    }

    if (cleanValue.includes('-') && cleanValue.length > 20) {
        return { type: "string", format: "date-time", example: cleanValue };
    }

    // Default to string
    return { type: "string", example: cleanValue };
}

/**
 * Get error description based on HTTP code
 * @param {String} httpCode - HTTP status code
 * @returns {String} Error description
 */
function getErrorDescription(httpCode) {
    const descriptions = {
        '400': 'Bad request',
        '401': 'Unauthorized',
        '403': 'Forbidden',
        '404': 'Not found',
        '500': 'Internal server error'
    };
    return descriptions[httpCode] || 'Error';
}

/**
 * Generate Swagger documentation for dynamic endpoints based on business rules and plugins
 * @param {Object} endpoint - Endpoint configuration
 * @param {Object} businessRulesMap - Parsed business rules mapping
 * @param {String} pluginsPath - Path to plugins directory
 * @returns {Object} Swagger path object for the dynamic endpoint
 */
function generateDynamicEndpointSwagger(endpoint, businessRulesMap, pluginsPath) {
    const { route, allowMethods = ["GET"], columnDefinitions = {}, auth, allowWrite = [], validation = {} } = endpoint;
    const method = allowMethods[0];
    const routeKey = `${method} ${route}`;

    const businessRule = businessRulesMap[routeKey];
    if (!businessRule) {
        console.log(`[DEBUG] No business rule found for ${routeKey}`);
        return {};
    }

    const actionInfo = findPluginAction(businessRule.action, pluginsPath);
    if (!actionInfo) {
        console.log(`[DEBUG] No plugin action found for ${businessRule.action}`);
        return {};
    }

    // Determine security based on auth type
    const security = [];
    if (auth === "token") {
        security.push({ tokenAuth: [] });
    } else if (auth === "bearer") {
        security.push({ bearerAuth: [] });
    }

    const routePrefix = route.split('/')[2];
    const swaggerPath = {};

    if (method === "GET") {
        swaggerPath[route] = {
            get: {
                tags: routePrefix ? [routePrefix] : undefined,
                operationId: `${businessRule.action}`,
                summary: `Dynamic endpoint: ${businessRule.action}`,
                security,
                responses: {
                    "200": {
                        description: "Successful response",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: { type: "boolean" },
                                        data: { type: "object" },
                                        message: { type: "string" }
                                    }
                                }
                            }
                        }
                    },
                    "400": {
                        description: "Bad request",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/Error" }
                            }
                        }
                    },
                    "401": {
                        description: "Unauthorized",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/Error" }
                            }
                        }
                    }
                }
            }
        };
    } else if (method === "POST") {
        // Generate request body schema from columnDefinitions and allowWrite, or fall back to validation
        const requestProperties = {};
        const requiredFields = [];

        // Determine which fields to use for the request body
        let fieldsToUse = allowWrite;
        let fieldDefinitions = columnDefinitions;

        // If allowWrite is empty but validation exists, use validation fields
        if (allowWrite.length === 0 && Object.keys(validation).length > 0) {
            console.log(`[DEBUG] Using validation fields for ${route} since allowWrite is empty`);
            fieldsToUse = Object.keys(validation);
            fieldDefinitions = validation;
        }

        // Use the determined fields and their definitions
        fieldsToUse.forEach(field => {
            const fieldDef = fieldDefinitions[field];
            if (fieldDef) {
                // Convert validation definition to OpenAPI property
                requestProperties[field] = convertValidationToProperty(fieldDef);

                // Check if field is required
                if (fieldDef.notEmpty || fieldDef.required) {
                    requiredFields.push(field);
                }
            } else {
                // Default property if not in definitions
                requestProperties[field] = { type: "string" };
            }
        });

        // Generate specific response schemas based on the action
        const responses = generateSpecificResponses(businessRule.action, route, actionInfo);

        swaggerPath[route] = {
            post: {
                tags: routePrefix ? [routePrefix] : undefined,
                operationId: `${businessRule.action}`,
                summary: `Dynamic endpoint: ${businessRule.action}`,
                security,
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: requiredFields,
                                properties: requestProperties
                            },
                            example: generateExampleFromValidation(validation, fieldsToUse)
                        }
                    }
                },
                responses
            }
        };
    }

    return swaggerPath;
}

/**
 * Convert validation definition to OpenAPI property
 * @param {Object} validationDef - Validation definition from apiConfig
 * @returns {Object} OpenAPI property definition
 */
function convertValidationToProperty(validationDef) {
    const property = {
        type: validationDef.type || "string"
    };

    // Add description if available
    if (validationDef.description) {
        property.description = validationDef.description;
    }

    // Add pattern if available
    if (validationDef.regex) {
        property.pattern = validationDef.regex;
    }

    // Add enum if available
    if (validationDef.enum) {
        property.enum = validationDef.enum;
    }

    // Add format for email
    if (validationDef.isValidEmail) {
        property.format = "email";
    }

    // Add min/max length
    if (validationDef.minLength !== undefined) {
        property.minLength = validationDef.minLength;
    }
    if (validationDef.maxLength !== undefined) {
        property.maxLength = validationDef.maxLength;
    }

    return property;
}

/**
 * Generate example from validation definitions
 * @param {Object} validation - Validation object from apiConfig
 * @param {Array} fields - Array of field names
 * @returns {Object} Example object
 */
function generateExampleFromValidation(validation, fields) {
    const example = {};
    fields.forEach(field => {
        const fieldDef = validation[field];
        if (!fieldDef) {
            example[field] = "";
            return;
        }

        // Use example if provided
        if (fieldDef.example !== undefined) {
            example[field] = fieldDef.example;
        }
        // Use first enum value if available
        else if (fieldDef.enum && fieldDef.enum.length > 0) {
            example[field] = fieldDef.enum[0];
        }
        // Use type-specific defaults
        else if (fieldDef.type === "string") {
            if (fieldDef.isValidEmail) {
                example[field] = "user@example.com";
            } else {
                example[field] = "example";
            }
        }
        else if (fieldDef.type === "integer") {
            example[field] = 1;
        }
        else if (fieldDef.type === "number") {
            example[field] = 1.0;
        }
        else if (fieldDef.type === "boolean") {
            example[field] = true;
        }
        else {
            example[field] = "example";
        }
    });
    return example;
}

/**
 * Generate specific response schemas based on the action type
 * @param {String} action - The action name
 * @param {String} route - The route path
 * @param {Object} actionInfo - The action information including response schemas
 * @returns {Object} Response schemas
 */
function generateSpecificResponses(action, route, actionInfo) {
    const responses = {};

    console.log(`[DEBUG] generateSpecificResponses called for ${action} on ${route}`);
    console.log(`[DEBUG] actionInfo:`, actionInfo);
    console.log(`[DEBUG] actionInfo.responseSchemas:`, actionInfo?.responseSchemas);
    console.log(`[DEBUG] actionInfo.responseSchemas.success:`, actionInfo?.responseSchemas?.success);

    // Add success response if we have extracted schema
    if (actionInfo && actionInfo.responseSchemas && actionInfo.responseSchemas.success) {
        console.log(`[DEBUG] Using intelligently parsed response schema for ${action}`);
        responses["200"] = {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            success: { type: "boolean", example: true },
                            data: actionInfo.responseSchemas.success,
                            message: { type: "string", example: "Operation completed successfully" }
                        }
                    }
                }
            }
        };
    } else {
        console.log(`[DEBUG] Using fallback generic response schema for ${action}`);
        // Fallback to generic success response
        responses["200"] = {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            success: { type: "boolean" },
                            data: { type: "object" },
                            message: { type: "string" }
                        }
                    }
                }
            }
        };
    }

    // Add specific error responses if we have extracted schemas
    if (actionInfo && actionInfo.responseSchemas && actionInfo.responseSchemas.errors) {
        console.log(`[DEBUG] Adding ${actionInfo.responseSchemas.errors.length} specific error responses for ${action}`);
        actionInfo.responseSchemas.errors.forEach(error => {
            responses[error.httpCode.toString()] = {
                description: error.description,
                content: {
                    "application/json": {
                        schema: { $ref: "#/components/schemas/Error" },
                        example: {
                            success: false,
                            message: error.description,
                            code: error.httpCode
                        }
                    }
                }
            };
        });
    }

    // Add standard error responses as fallbacks
    if (!responses["400"]) {
        responses["400"] = {
            description: "Bad request",
            content: {
                "application/json": {
                    schema: { $ref: "#/components/schemas/Error" },
                    example: {
                        success: false,
                        message: "Invalid request parameters",
                        code: 400
                    }
                }
            }
        };
    }

    if (!responses["401"]) {
        responses["401"] = {
            description: "Unauthorized",
            content: {
                "application/json": {
                    schema: { $ref: "#/components/schemas/Error" },
                    example: {
                        success: false,
                        message: "Authentication required",
                        code: 401
                    }
                }
            }
        };
    }

    if (!responses["500"]) {
        responses["500"] = {
            description: "Internal server error",
            content: {
                "application/json": {
                    schema: { $ref: "#/components/schemas/Error" },
                    example: {
                        success: false,
                        message: "An unexpected error occurred",
                        code: 500
                    }
                }
            }
        };
    }

    console.log(`[DEBUG] Final responses for ${action}:`, Object.keys(responses));
    return responses;
}

// // Example usage:
// const apiConfig = JSON.parse(fs.readFileSync(path.resolve(__dirname, './config/apiConfig.json'), 'utf-8'));
// generateSwaggerDoc(apiConfig, './swagger.json');

module.exports = {
    generateSwaggerDoc,
    inferPropertyType
};
