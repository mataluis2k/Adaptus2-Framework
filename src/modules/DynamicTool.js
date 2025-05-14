/**
 * Dynamic Tool Template that can be used for quickly creating new tools
 * Compatible with the GlobalToolRegistry
 */

class DynamicTool {
    /**
     * Create a new dynamic tool
     * 
     * @param {Object} options - Tool configuration options
     * @param {string} options.name - Unique name for the tool
     * @param {string} options.description - Description of what the tool does
     * @param {Function} options.execute - Function that executes the tool
     * @param {Object} options.schema - Schema for the tool parameters
     * @param {string} options.category - Category for the tool
     * @param {boolean} options.requiresAuth - Whether tool requires authentication
     * @param {Object} options.metadata - Additional metadata for the tool
     */
    constructor(options) {
        if (!options.name) {
            throw new Error('Tool must have a name');
        }
        
        if (typeof options.execute !== 'function') {
            throw new Error('Tool must have an execute function');
        }
        
        this.name = options.name;
        this.description = options.description || `Tool: ${options.name}`;
        this.execute = options.execute;
        this.schema = options.schema || null;
        this.category = options.category || 'general';
        this.requiresAuth = options.requiresAuth || false;
        this.requiresContext = options.requiresContext || false;
        this.metadata = options.metadata || {};
    }
    
    /**
     * Register this tool with the global tool registry
     * 
     * @param {Object} toolRegistry - The global tool registry
     * @param {string} moduleName - Name of the module registering the tool
     * @returns {Object} - The registered tool
     */
    register(toolRegistry, moduleName = 'dynamic') {
        return toolRegistry.registerTool(this, this.category, moduleName);
    }
    
    /**
     * Create a new tool from a function
     * 
     * @param {Function} func - Function to convert to a tool
     * @param {Object} options - Tool options
     * @returns {DynamicTool} - A new dynamic tool
     */
    static fromFunction(func, options = {}) {
        if (typeof func !== 'function') {
            throw new Error('First argument must be a function');
        }
        
        const toolName = options.name || func.name;
        if (!toolName) {
            throw new Error('Tool must have a name. Either use a named function or provide name in options');
        }
        
        return new DynamicTool({
            name: toolName,
            description: options.description || `Tool for ${toolName}`,
            category: options.category || 'general',
            schema: options.schema || null,
            execute: async (params, opts) => {
                try {
                    return await func(params, opts);
                } catch (error) {
                    console.error(`[Tool:${toolName}] Execution error:`, error);
                    throw error;
                }
            },
            requiresAuth: options.requiresAuth || false,
            requiresContext: options.requiresContext || false,
            metadata: options.metadata || {}
        });
    }
    
    /**
     * Create multiple tools from module methods
     * 
     * @param {Object} module - Module with methods to convert
     * @param {Object} options - Options for tool creation
     * @returns {Array<DynamicTool>} - Array of dynamic tools
     */
    static fromModule(module, options = {}) {
        const { 
            category = 'general', 
            moduleName = module.name || 'unknown_module',
            includePrivate = false,
            functionPrefix = '',
            descriptionGenerator = null
        } = options;
        
        const tools = [];
        
        // Get all functions from the module
        for (const [key, value] of Object.entries(module)) {
            // Skip if not a function or if private (starts with _) and includePrivate is false
            if (typeof value !== 'function' || (!includePrivate && key.startsWith('_'))) {
                continue;
            }
            
            // Skip constructor, registerActions methods
            if (['constructor', 'registerActions'].includes(key)) {
                continue;
            }
            
            // Create a description either using the generator or a default
            const description = typeof descriptionGenerator === 'function' 
                ? descriptionGenerator(key, value)
                : `${key} function from ${moduleName} module`;
            
            // Create the tool name with optional prefix
            const toolName = functionPrefix ? `${functionPrefix}_${key}` : key;
            
            // Create a new dynamic tool
            const tool = new DynamicTool({
                name: toolName,
                description,
                category,
                execute: async (params, opts) => {
                    try {
                        // Call the original function with appropriate context
                        return await value.call(module, params, opts);
                    } catch (error) {
                        console.error(`[Tool:${toolName}] Execution error:`, error);
                        throw error;
                    }
                },
                metadata: {
                    sourceModule: moduleName,
                    sourceFunction: key
                }
            });
            
            tools.push(tool);
        }
        
        return tools;
    }
}

/**
 * Example of creating a dynamic tool for database operations
 */
function createDatabaseTool(options = {}) {
    const { 
        name = 'db_query',
        description = 'Execute a database query',
        dbConfig = null,
        requiresAuth = true
    } = options;
    
    return new DynamicTool({
        name,
        description,
        category: 'database',
        requiresAuth,
        schema: {
            query: {
                type: 'string',
                description: 'SQL query to execute'
            },
            params: {
                type: 'array',
                description: 'Query parameters'
            }
        },
        execute: async ({ query, params = [] }, opts = {}) => {
            // Get database connection
            const config = dbConfig || opts.dbConfig;
            if (!config) {
                throw new Error('Database configuration required');
            }
            
            try {
                // Execute the query
                const db = await getDbConnection(config);
                const [results] = await db.execute(query, params);
                return { success: true, results };
            } catch (error) {
                console.error('Database query error:', error);
                return { 
                    success: false, 
                    error: error.message,
                    recoverable: error.code !== 'ER_ACCESS_DENIED_ERROR'
                };
            }
        }
    });
}

/**
 * Example of creating an API request tool
 */
function createApiTool(options = {}) {
    const { 
        name = 'api_request',
        description = 'Make an API request to an external service',
        baseUrl = '',
        headers = {},
        requiresAuth = false
    } = options;
    
    return new DynamicTool({
        name,
        description,
        category: 'api',
        requiresAuth,
        schema: {
            method: {
                type: 'string',
                enum: ['GET', 'POST', 'PUT', 'DELETE'],
                default: 'GET',
                description: 'HTTP method'
            },
            endpoint: {
                type: 'string',
                description: 'API endpoint'
            },
            data: {
                type: 'object',
                description: 'Request body for POST/PUT requests'
            },
            params: {
                type: 'object',
                description: 'Query parameters'
            }
        },
        execute: async ({ method = 'GET', endpoint, data = null, params = {} }, opts = {}) => {
            try {
                // Construct URL with query parameters
                const url = new URL(baseUrl + endpoint);
                Object.entries(params).forEach(([key, value]) => {
                    url.searchParams.append(key, value);
                });
                
                // Prepare fetch options
                const fetchOptions = {
                    method,
                    headers: {
                        'Content-Type': 'application/json',
                        ...headers,
                        ...(opts.headers || {})
                    }
                };
                
                // Add body for POST/PUT requests
                if (['POST', 'PUT'].includes(method) && data) {
                    fetchOptions.body = JSON.stringify(data);
                }
                
                // Make the request
                const response = await fetch(url.toString(), fetchOptions);
                
                // Parse the response
                let responseData;
                const contentType = response.headers.get('content-type');
                if (contentType?.includes('application/json')) {
                    responseData = await response.json();
                } else {
                    responseData = await response.text();
                }
                
                return {
                    success: response.ok,
                    status: response.status,
                    statusText: response.statusText,
                    data: responseData
                };
            } catch (error) {
                console.error('API request error:', error);
                return {
                    success: false,
                    error: error.message,
                    recoverable: !(error instanceof TypeError)
                };
            }
        }
    });
}

// Export the DynamicTool class and helper functions
module.exports = {
    DynamicTool,
    createDatabaseTool,
    createApiTool
};