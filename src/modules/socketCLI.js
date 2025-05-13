const net = require("net");
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

/**
 * SocketCLI Module
 * Provides a command-line interface over a socket connection for server administration
 */
class SocketCLI {
    /**
     * Initialize the Socket CLI server
     * @param {Object} options Configuration options
     * @param {Object} options.server The main server instance
     * @param {Object} options.redisClient Redis client for cache operations
     * @param {String} options.jwtSecret Secret for JWT operations
     * @param {String} options.jwtExpiry JWT expiration time
     * @param {Object} options.ruleEngine Rule engine instance
     * @param {Object} options.pluginManager Plugin manager instance
     * @param {Function} options.clearRedisCache Function to clear Redis cache
     * @param {Function} options.loadConfig Function to reload configuration
     * @param {Function} options.getContext Function to get request context
     * @param {Function} options.updateValidationRules Function to update validation rules
     */
    constructor(options) {
        this.server = options.server;
        this.app = options.server.app;
        this.redisClient = options.redisClient;
        // Create a separate Redis client for commands (not in subscriber mode)
        this.redisCommandClient = null;
        if (options.redisClient) {
            const { createRedisClient } = require('./redisClient');
            // Create a new Redis client with the same connection settings
            this.redisCommandClient = createRedisClient();
        }
        this.JWT_SECRET = options.jwtSecret || process.env.JWT_SECRET || 'IhaveaVeryStrongSecret';
        this.JWT_EXPIRY = options.jwtExpiry || process.env.JWT_EXPIRY || '1h';
        this.ruleEngine = options.ruleEngine;
        this.pluginManager = options.pluginManager;
        this.clearRedisCache = options.clearRedisCache;
        this.loadConfig = options.loadConfig;
        this.getContext = options.getContext;
        this.updateValidationRules = options.updateValidationRules;
        this.requestLogger = options.requestLogger;
        this.packageJson = options.packageJson;
        this.initializeRules = options.initializeRules;
        this.socketServer = null;
        this.globalContext = options.globalContext || global.globalContext || this.server.globalContext;

        // Access these from server instance
        this.apiConfig = this.server.apiConfig;
        this.categorizedConfig = this.server.categorizedConfig;
    }

    /**
     * Start the socket CLI server
     * @param {String} host Host to bind to
     * @param {Number} port Port to listen on
     */
    start(host, port) {
        const SOCKET_CLI_PORT = port || process.env.SOCKET_CLI_PORT || 5000;
        
        this.socketServer = net.createServer((socket) => {
            console.log("CLI client connected.");

            socket.on("data", async (data) => {
                const input = data.toString().trim();
                const [command, ...args] = input.split(" ");

                try {
                    switch (command) {
                        case "unlock":
                            if (args.length === 1) {
                                // Use the dedicated command client instead of the subscriber client
                                if (!this.redisCommandClient) {
                                    socket.write("Redis command client not available. Creating one now.\n");
                                    const { createRedisClient } = require('./redisClient');
                                    this.redisCommandClient = createRedisClient();
                                }
                                const fileName = args[0];
                                const lockKey = `config-lock:${fileName}`;
                                await this.redisCommandClient.del(lockKey);
                                socket.write(`Lock removed for ${fileName}\n`);
                            } else {
                                socket.write("Usage: unlock <fileName>\n");
                            }
                            break;

                        case "permalock":
                            if (args.length === 2) {
                                // Use the dedicated command client instead of the subscriber client
                                if (!this.redisCommandClient) {
                                    socket.write("Redis command client not available. Creating one now.\n");
                                    const { createRedisClient } = require('./redisClient');
                                    this.redisCommandClient = createRedisClient();
                                }
                                const [fileName, userId] = args;
                                const lockKey = `config-lock:${fileName}`;
                                await this.redisCommandClient.set(lockKey, userId);
                                socket.write(`Permanent lock set on ${fileName} by user ${userId}\n`);
                            } else {
                                socket.write("Usage: permalock <fileName> <userId>\n");
                            }
                            break;
                        case "listlocks":
                            try {
                                // Use the dedicated command client instead of the subscriber client
                                if (!this.redisCommandClient) {
                                    socket.write("Redis command client not available. Creating one now.\n");
                                    const { createRedisClient } = require('./redisClient');
                                    this.redisCommandClient = createRedisClient();
                                }

                                const keys = await this.redisCommandClient.keys("config-lock:*");

                                if (keys.length === 0) {
                                    socket.write("No locked config files found.\n");
                                    break;
                                }

                                const results = [];
                                for (const key of keys) {
                                    const userId = await this.redisCommandClient.get(key);
                                    const ttl = await this.redisCommandClient.ttl(key);
                                    const fileName = key.replace("config-lock:", "");
                                    const expiresIn = ttl === -1 ? 'permanent' : `${ttl}s`;

                                    results.push(`${fileName} → userId: ${userId}, expires in: ${expiresIn}`);
                                }

                                socket.write(`Locked Config Files:\n${results.join("\n")}\n`);
                            } catch (err) {
                                socket.write(`Error listing locks: ${err.message}\n`);
                                console.error("Error in listlocks command:", err);
                            }
                            break;                            
                        case "version":
                            console.log(`Adaptus2-Framework Version: ${this.packageJson.version}`);
                            socket.write(`Adaptus2-Framework Version: ${this.packageJson.version}\n`);
                            break;
                        case "requestLog":
                            const requestId = args[0];
                            if (!requestId) {
                                socket.write("Usage: requestLog <requestId>\n");
                                break;
                            }
                            try {
                                // Look up complete log
                                const log = await this.requestLogger.getRequestLog(requestId);
                                if (log) {
                                    socket.write(JSON.stringify(log, null, 2));
                                } else {
                                    socket.write(`No log found with request ID: ${requestId}\n`);
                                }
                            } catch (error) {
                                socket.write(`Failed to retrieve request log: ${error.message}\n`);
                            }
                            break;
                        case "shutdown":
                            console.log("Shutting down server...");
                            socket.write(command);
                            await this.server.shutdown();                            
                            break;
                        case "userGenToken":
                            if (args.length < 2) {
                                socket.write("Usage: userGenToken <username> <acl>\n");
                            } else {
                                const [username, acl] = args;
                                try {
                                    // Generate the JWT
                                    const payload = { username, acl };
                                    const token = jwt.sign(payload, this.JWT_SECRET, { expiresIn: this.JWT_EXPIRY });

                                    socket.write(`Generated user token:\n${token}\n`);
                                } catch (error) {
                                    console.error("Error generating user token:", error.message);
                                    socket.write(`Error generating user token: ${error.message}\n`);
                                }
                            }
                            break;

                        case "appGenToken":
                            if (args.length < 2) {
                                socket.write("Usage: appGenToken <table> <acl>\n");
                            } else {
                                const [table, acl] = args;
                                try {
                                    // Generate the JWT
                                    const payload = { table, acl, username: table };
                                    const token = jwt.sign(payload, this.JWT_SECRET, { expiresIn: this.JWT_EXPIRY });

                                    socket.write(`Generated app token:\n${token}\n`);
                                } catch (error) {
                                    console.error("Error generating app token:", error.message);
                                    socket.write(`Error generating app token: ${error.message}\n`);
                                }
                            }
                            break;  
                        case "showConfig":
                            socket.write(JSON.stringify(this.server.apiConfig, null, 2));
                            break;   
                        case "showRules":
                            if (this.ruleEngine) {
                                socket.write(JSON.stringify(this.ruleEngine.getRules(), null, 2));
                            } else {
                                socket.write("No rules currently loaded.\n");
                            }
                            break;
                        case "nodeInfo":
                            if (args.length < 2) {
                                socket.write("Usage: nodeInfo <route|table> <routeType>\n");
                            } else {
                                let configObject;
                                console.log(args[0], args[1]);
                                // need to show based on object name
                                if (args[1] === 'def') {
                                    configObject = this.server.apiConfig.find(item => 
                                        item.routeType === args[1] &&
                                        item.dbTable === args[0]
                                    );                   
                                } else {
                                    configObject = this.server.apiConfig.find(item => 
                                        item.route === args[0] &&
                                        item.routeType === args[1]
                                    );
                                }            
                                if (configObject) {
                                    socket.write(JSON.stringify(configObject, null, 2));
                                } else {
                                    socket.write(`Config object ${args[0]} not found.\n`);
                                }  
                            }
                            break;
                            case "configReload":
                                try {
                                    console.log('Reloading configuration...');
                                    this.clearRedisCache();
                                    this.initializeRules(this.app);
                                    
                                    // Debug information
                                    console.log(`Current directory: ${__dirname}`);
                                    console.log('Attempting to load apiConfig from the same directory as socketCLI.js');
                                    
                                    try {
                                        // First, let's check if the module exists
                                        const fs = require('fs');
                                        if (!fs.existsSync(`${__dirname}/apiConfig.js`)) {
                                            console.error(`File not found: ${__dirname}/apiConfig.js`);
                                            socket.write(`Error: apiConfig.js not found in ${__dirname}\n`);
                                            return;
                                        }
                                        
                                        console.log(`apiConfig.js exists at ${__dirname}/apiConfig.js`);
                                        
                                        // Now try to require the module with detailed error trapping
                                        let apiConfigModule;
                                        try {
                                            apiConfigModule = require('./apiConfig');
                                            console.log('apiConfig module loaded successfully');
                                            console.log('Available methods:', Object.keys(apiConfigModule));
                                        } catch (importError) {
                                            console.error(`Error importing apiConfig module: ${importError.message}`);
                                            socket.write(`Error importing apiConfig module: ${importError.message}\n`);
                                            return;
                                        }
                                        
                                        // Check if the module has the required functions
                                        if (!apiConfigModule || !apiConfigModule.loadConfig) {
                                            console.error('apiConfig module is missing loadConfig function');
                                            socket.write('Error: apiConfig module is missing loadConfig function\n');
                                            return;
                                        }
                                        
                                        if (!apiConfigModule.categorizeApiConfig) {
                                            console.error('apiConfig module is missing categorizeApiConfig function');
                                            socket.write('Error: apiConfig module is missing categorizeApiConfig function\n');
                                            return;
                                        }
                                        
                                        // Load the new configuration with detailed error handling
                                        let newConfig;
                                        try {
                                            console.log('Calling loadConfig()...');
                                            newConfig = await apiConfigModule.loadConfig();
                                            console.log('loadConfig() completed');
                                        } catch (loadError) {
                                            console.error(`Error in loadConfig: ${loadError.message}`);
                                            socket.write(`Error in loadConfig: ${loadError.message}\n`);
                                            return;
                                        }
                                        
                                        // Check if loadConfig returned a valid value
                                        if (newConfig === undefined) {
                                            console.error('loadConfig() returned undefined');
                                            socket.write('Error: loadConfig() returned undefined\n');
                                            return;
                                        }
                                        
                                        if (newConfig === null) {
                                            console.error('loadConfig() returned null');
                                            socket.write('Error: loadConfig() returned null\n');
                                            return;
                                        }
                                        
                                        // Try to stringify the config to check if it's valid JSON
                                        try {
                                            JSON.stringify(newConfig);
                                            console.log('Configuration is valid JSON');
                                        } catch (jsonError) {
                                            console.error(`Configuration is not valid JSON: ${jsonError.message}`);
                                            console.error('Config type:', typeof newConfig);
                                            console.error('Config preview:', newConfig && typeof newConfig === 'object' ? Object.keys(newConfig) : newConfig);
                                            socket.write(`Error: Configuration is not valid JSON: ${jsonError.message}\n`);
                                            return;
                                        }
                                        
                                        // Update server configuration
                                        this.server.apiConfig = newConfig;
                                        console.log('API config assigned to server successfully');
                                        
                                        // Categorize the config
                                        try {
                                            console.log('Categorizing API config...');
                                            this.server.categorizedConfig = apiConfigModule.categorizeApiConfig(this.server.apiConfig);
                                            console.log('API config categorized successfully');
                                        } catch (categorizeError) {
                                            console.error(`Error categorizing config: ${categorizeError.message}`);
                                            socket.write(`Error categorizing config: ${categorizeError.message}\n`);
                                            return;
                                        }
                                        
                                        // Update validation rules
                                        try {
                                            console.log('Updating validation rules...');
                                            this.updateValidationRules();
                                            console.log('Validation rules updated successfully');
                                        } catch (validationError) {
                                            console.error(`Error updating validation rules: ${validationError.message}`);
                                            socket.write(`Error updating validation rules: ${validationError.message}\n`);
                                            // Continue execution, this might not be critical
                                        }

                                        // Create new RuleEngineMiddleware
                                        try {
                                            console.log('Creating new RuleEngineMiddleware...');
                                            const RuleEngineMiddleware = require('../middleware/RuleEngineMiddleware');
                                            const ruleEngineMiddleware = new RuleEngineMiddleware(this.ruleEngine, this.server.dependencyManager);
                                            this.app.locals.ruleEngineMiddleware = ruleEngineMiddleware;
                                            console.log('RuleEngineMiddleware created successfully');
                                        } catch (middlewareError) {
                                            console.error(`Error creating RuleEngineMiddleware: ${middlewareError.message}`);
                                            socket.write(`Error creating RuleEngineMiddleware: ${middlewareError.message}\n`);
                                            // Continue execution, this might not be critical
                                        }
                                        
                                        // CLEAR ALL ROUTES
                                        console.log('Clearing existing routes...');
                                        this.app._router.stack = this.app._router.stack.filter((layer) => !layer.route);
                                        console.log('Routes cleared successfully');
                                        
                                        // RE-REGISTER ROUTES
                                        console.log('Re-registering routes...');
                                        
                                        try {
                                            if (typeof this.server.registerRoutes === 'function') {
                                                console.log('Calling registerRoutes()...');
                                                this.server.registerRoutes();
                                                console.log('registerRoutes() completed successfully');
                                            } else {
                                                console.error('server.registerRoutes is not a function');
                                                socket.write('Error: server.registerRoutes is not a function\n');
                                            }
                                            
                                            if (typeof this.server.registerProxyEndpoints === 'function') {
                                                console.log('Calling registerProxyEndpoints()...');
                                                this.server.registerProxyEndpoints();
                                                console.log('registerProxyEndpoints() completed successfully');
                                            } else {
                                                console.error('server.registerProxyEndpoints is not a function');
                                                socket.write('Error: server.registerProxyEndpoints is not a function\n');
                                            }
                                            
                                            if (typeof this.server.registerDynamicEndpoints === 'function') {
                                                console.log('Calling registerDynamicEndpoints()...');
                                                this.server.registerDynamicEndpoints();
                                                console.log('registerDynamicEndpoints() completed successfully');
                                            } else {
                                                console.error('server.registerDynamicEndpoints is not a function');
                                                socket.write('Error: server.registerDynamicEndpoints is not a function\n');
                                            }
                                            
                                            if (typeof this.server.registerFileUploadEndpoints === 'function') {
                                                console.log('Calling registerFileUploadEndpoints()...');
                                                this.server.registerFileUploadEndpoints();
                                                console.log('registerFileUploadEndpoints() completed successfully');
                                            } else {
                                                console.error('server.registerFileUploadEndpoints is not a function');
                                                socket.write('Error: server.registerFileUploadEndpoints is not a function\n');
                                            }
                                            
                                            if (typeof this.server.registerStaticEndpoints === 'function') {
                                                console.log('Calling registerStaticEndpoints()...');
                                                this.server.registerStaticEndpoints();
                                                console.log('registerStaticEndpoints() completed successfully');
                                            } else {
                                                console.error('server.registerStaticEndpoints is not a function');
                                                socket.write('Error: server.registerStaticEndpoints is not a function\n');
                                            }
                                        } catch (routeError) {
                                            console.error(`Error registering routes: ${routeError.message}`);
                                            socket.write(`Error registering routes: ${routeError.message}\n`);
                                            // Continue, some routes may have been registered
                                        }
                                        
                                        console.log("API config reloaded successfully.");
                                        socket.write("API config reloaded successfully.\n");
                                    } catch (configError) {
                                        console.error(`Error loading API config: ${configError.stack || configError.message}`);
                                        socket.write(`Error loading API config: ${configError.message}\n`);
                                        return; // Exit the configReload command early
                                    }
                                } catch (error) {
                                    console.error(`Error reloading API config: ${error.stack || error.message}`);
                                    socket.write(`Error reloading API config: ${error.message}\n`);
                                }
                                break;
                            
                        case "listPlugins":
                            try {
                                const plugins = fs.readdirSync(this.pluginManager.pluginDir)
                                    .filter(file => file.endsWith('.js')) // Only include JavaScript files
                                    .map(file => path.basename(file, '.js')); // Remove file extension
                                if (plugins.length === 0) {
                                    socket.write("No plugins found in the plugins folder.\n");
                                } else {
                                    socket.write(`Available plugins:\n${plugins.join("\n")}\n`);
                                }
                            } catch (err) {
                                socket.write(`Error reading plugins folder: ${err.message}\n`);
                            }
                            break;
                            case "listActions":
                                try {
                                    // First check if we have a valid globalContext reference
                                    if (!this.globalContext) {
                                        socket.write("Error: GlobalContext not found. Trying alternative methods...\n");

                                        // Import context module directly
                                        try {
                                            const contextModule = require('./context');
                                            if (contextModule && contextModule.globalContext) {
                                                this.globalContext = contextModule.globalContext;
                                                socket.write("Found globalContext in context module.\n");
                                            }
                                        } catch (importError) {
                                            console.error("Error importing context module:", importError);
                                        }

                                        // Try to get it directly from global
                                        if (!this.globalContext && global.globalContext && global.globalContext.actions) {
                                            this.globalContext = global.globalContext;
                                            socket.write("Found globalContext in global scope.\n");
                                        } else if (!this.globalContext && this.server.globalContext && this.server.globalContext.actions) {
                                            this.globalContext = this.server.globalContext;
                                            socket.write("Found globalContext in server instance.\n");
                                        } else if (!this.globalContext && this.getContext && typeof this.getContext === 'function') {
                                            try {
                                                const context = this.getContext();
                                                if (context && context.actions) {
                                                    this.globalContext = context;
                                                    socket.write("Found context using getContext() function.\n");
                                                }
                                            } catch (ctxError) {
                                                socket.write(`Error using getContext(): ${ctxError.message}\n`);
                                            }
                                        }

                                        // If we still don't have it, create a minimal context
                                        if (!this.globalContext) {
                                            console.log("Creating minimal globalContext for actions");
                                            this.globalContext = {
                                                resources: {},
                                                actions: {}
                                            };
                                            socket.write("Created minimal globalContext.\n");
                                        }
                                    }

                                    // Now check if we have actions
                                    if (!this.globalContext.actions) {
                                        this.globalContext.actions = {};
                                        socket.write("No actions property found. Created empty actions object.\n");
                                    }

                                    // List the actions
                                    const actions = Object.keys(this.globalContext.actions);
                                    if (actions.length === 0) {
                                        socket.write("No actions available. The actions object is empty.\n");
                                    } else {
                                        socket.write(`Available actions (${actions.length}):\n${actions.join("\n")}\n`);
                                    }
                                } catch (error) {
                                    socket.write(`Error in listActions: ${error.message}\n`);
                                    console.error("Error in listActions:", error);
                                }
                                break;
                        case "load":
                            if (args.length) {
                                const response = await this.pluginManager.loadPlugin(args[0]);
                                socket.write(`We got: ${response}\n`);
                            } else {
                                socket.write("Usage: load <pluginName>\n");
                            }
                            break;
                        case "unload":
                            if (args.length) {
                                this.pluginManager.unloadPlugin(args[0]);
                                socket.write(`Plugin ${args[0]} unloaded successfully.\n`);
                            } else {
                                socket.write("Usage: unload <pluginName>\n");
                            }
                            break;
                        case "reload":
                            if (args.length) {
                                this.pluginManager.unloadPlugin(args[0]);
                                this.pluginManager.loadPlugin(args[0]);
                                socket.write(`Plugin ${args[0]} reloaded successfully.\n`);
                            } else {
                                socket.write("Usage: reload <pluginName>\n");
                            }
                            break;
                        case "reloadall":
                            this.pluginManager.plugins.forEach((_, pluginName) => {
                                this.pluginManager.unloadPlugin(pluginName);
                                this.pluginManager.loadPlugin(pluginName);
                            });
                            socket.write("All plugins reloaded successfully.\n");
                            break;
                        case "list":
                            const plugins = Array.from(this.pluginManager.plugins.keys());
                            socket.write(`Loaded plugins: ${plugins.join(", ")}\n`);
                            break;
                        case "routes":
                            const routes = this.server.getRoutes(this.app);
                            socket.write(`Registered routes: ${JSON.stringify(routes, null, 2)}\n`);
                            break;
                        case "exit":
                            socket.write("Goodbye!\n");
                            socket.end();
                            break;
                        case "validate-config":
                            try {
                                if (!this.server.devTools) {
                                    const DevTools = require('./devTools.js');
                                    this.server.devTools = new DevTools();
                                }
                                const schema = {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        required: ["routeType"],
                                        allOf: [
                                            {
                                                if: {
                                                    properties: { routeType: { const: "def" } }
                                                },
                                                then: {
                                                    required: []
                                                }
                                            },
                                            {
                                                if: {
                                                    properties: { routeType: { not: { const: "def" } } }
                                                },
                                                then: {
                                                    required: ["route"]
                                                }
                                            }
                                        ],
                                        properties: {
                                            routeType: {
                                                type: "string",
                                                enum: ["dynamic", "static", "database", "proxy", "def", "fileUpload"]
                                            },
                                            dbType: {
                                                type: "string",
                                                enum: ["mysql"]
                                            },
                                            dbConnection: {
                                                type: "string"
                                            },
                                            route: {
                                                type: "string",
                                                pattern: "^/"
                                            },
                                            auth: {
                                                type: "string"
                                            },
                                            acl: {
                                                type: "array",
                                                items: {
                                                    type: "string"
                                                }
                                            },
                                            allowMethods: {
                                                type: "array",
                                                items: {
                                                    type: "string",
                                                    enum: ["GET", "POST", "PUT", "DELETE", "PATCH"]
                                                }
                                            },
                                            allowRead: {
                                                type: "array",
                                                items: {
                                                    type: "string"
                                                }
                                            },
                                            allowWrite: {
                                                type: "array",
                                                items: {
                                                    type: "string"
                                                }
                                            },
                                            columnDefinitions: {
                                                type: "object",
                                                additionalProperties: {
                                                    type: "string"
                                                }
                                            }
                                        }
                                    }
                                };

                                const configPath = path.join(process.cwd(), 'config', 'apiConfig.json');
                                const result = await this.server.devTools.validateConfig(configPath, schema);
                                
                                // Filter and format the results to only show objects with errors
                                if (!result.valid && result.errors) {
                                    const errorsByObject = {};
                                    
                                    result.errors.forEach(error => {
                                        // Handle both array indices and property paths
                                        const matches = error.instancePath.match(/\/(\d+)/);
                                        if (matches) {
                                            const index = matches[1];
                                            if (!errorsByObject[index]) {
                                                errorsByObject[index] = {
                                                    object: result.config[index],
                                                    errors: []
                                                };
                                            }
                                            // Format the error message to be more descriptive
                                            const property = error.instancePath.split('/').slice(2).join('/') || 'object';
                                            const message = `${property}: ${error.message}`;
                                            errorsByObject[index].errors.push(message);
                                        }
                                    });

                                    const formattedResult = Object.entries(errorsByObject).map(([index, data]) => ({
                                        index: parseInt(index),
                                        object: data.object,
                                        errors: data.errors
                                    }));

                                    socket.write(JSON.stringify(formattedResult, null, 2) + '\n');
                                } else {
                                    socket.write("Configuration is valid. No errors found.\n");
                                }
                            } catch (error) {
                                socket.write(`Error validating config: ${error.message}\n`);
                            }
                            break;

                        case "help":                   
                        default:
                            socket.write(
                                "Available commands:\n" +
                                "- version: Display server version\n" +
                                "- showRules: Display loaded business rules\n" +
                                "- nodeInfo <route|table> <routeType>: Show config for a specific route/table\n" +
                                "- showConfig: Show complete API configuration\n" +
                                "- userGenToken <username> <acl>: Generate JWT for a user\n" +
                                "- appGenToken <table> <acl>: Generate JWT for an application\n" +
                                "- load <pluginName>: Load a plugin\n" +
                                "- unload <pluginName>: Unload a plugin\n" +
                                "- reload <pluginName>: Reload a specific plugin\n" +
                                "- reloadall: Reload all plugins\n" +
                                "- list: List loaded plugins\n" +
                                "- routes: List all registered routes\n" +
                                "- configReload: Reload server configuration\n" +
                                "- listActions: List available actions\n" +
                                "- validate-config: Validate configuration file\n" +
                                "- requestLog <requestId>: Get log for a specific request\n" +
                                "- exit: Close the connection\n"
                            );               
                    }
                } catch (error) {
                    socket.write(`Error: ${error.message}\n`);
                }
            });

            socket.on("end", () => {
                console.log("CLI client disconnected.");
            });
        });

        this.socketServer.listen(SOCKET_CLI_PORT, host, () => {
            console.log(`Socket CLI server running on ${host}:${SOCKET_CLI_PORT}`);
        });
        
        return this.socketServer;
    }

    /**
     * Stop the socket CLI server
     */
    async stop() {
        return new Promise((resolve) => {
            // Clean up Redis command client if it exists
            if (this.redisCommandClient) {
                try {
                    this.redisCommandClient.quit().catch(err => {
                        console.error('Error closing Redis command client:', err);
                    });
                } catch (err) {
                    console.error('Error closing Redis command client:', err);
                }
            }

            if (this.socketServer) {
                this.socketServer.close(() => {
                    console.log('Socket CLI server stopped');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}

module.exports = SocketCLI;