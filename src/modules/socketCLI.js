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
                                const fileName = args[0];
                                const lockKey = `config-lock:${fileName}`;
                                await this.redisClient.del(lockKey);
                                socket.write(`Lock removed for ${fileName}\n`);
                            } else {
                                socket.write("Usage: unlock <fileName>\n");
                            }
                            break;

                        case "permalock":
                            if (args.length === 2) {
                                const [fileName, userId] = args;
                                const lockKey = `config-lock:${fileName}`;
                                await this.redisClient.set(lockKey, userId);
                                socket.write(`Permanent lock set on ${fileName} by user ${userId}\n`);
                            } else {
                                socket.write("Usage: permalock <fileName> <userId>\n");
                            }
                            break;
                        case "listlocks":
                            try {
                                const keys = await this.redisClient.keys("config-lock:*");
                        
                                if (keys.length === 0) {
                                    socket.write("No locked config files found.\n");
                                    break;
                                }
                        
                                const results = [];
                                for (const key of keys) {
                                    const userId = await this.redisClient.get(key);
                                    const ttl = await this.redisClient.ttl(key);
                                    const fileName = key.replace("config-lock:", "");
                                    const expiresIn = ttl === -1 ? 'permanent' : `${ttl}s`;
                        
                                    results.push(`${fileName} → userId: ${userId}, expires in: ${expiresIn}`);
                                }
                        
                                socket.write(`Locked Config Files:\n${results.join("\n")}\n`);
                            } catch (err) {
                                socket.write(`Error listing locks: ${err.message}\n`);
                            }
                            break;                            
                        case "version":
                            console.log(`Adaptus2-Framework Version: ${this.packageJson.version}`);
                            socket.write(`Adaptus2-Framework Version: ${this.packageJson.version}\n`);
                            break;
                        case "requestLog":
                            const requestId = args[0];
                            // Look up complete log
                            const log = await this.requestLogger.getRequestLog(requestId);
                            socket.write(JSON.stringify(log));
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
                                this.server.apiConfig = await this.loadConfig();
                                console.log(this.server.apiConfig);
                                this.server.categorizedConfig = this.server.categorizeApiConfig(this.server.apiConfig);  
                                this.updateValidationRules();
                                
                                // Create new RuleEngineMiddleware instance with reloaded ruleEngine
                                const ruleEngineMiddleware = new this.server.RuleEngineMiddleware(this.ruleEngine, this.server.dependencyManager);
                                this.app.locals.ruleEngineMiddleware = ruleEngineMiddleware;
                        
                                // CLEAR ALL ROUTES
                                this.app._router.stack = this.app._router.stack.filter((layer) => !layer.route);
                                
                                // RE-REGISTER ROUTES
                                this.server.registerRoutes(this.app, this.server.categorizedConfig.databaseRoutes);
                                this.server.registerProxyEndpoints(this.app, this.server.categorizedConfig.proxyRoutes);
                                this.server.categorizedConfig.dynamicRoutes.forEach((route) => 
                                    this.server.DynamicRouteHandler.registerDynamicRoute(this.app, route));
                                this.server.categorizedConfig.fileUploadRoutes.forEach((route) => 
                                    this.server.registerFileUploadEndpoint(this.app, route));
                                this.server.categorizedConfig.staticRoutes.forEach((route) => 
                                    this.server.registerStaticRoute(this.app, route));
                                
                                if (process.env.PLUGIN_MANAGER === 'network') {
                                    const removeRuleEngine = (key, value) => {
                                        if (key === 'ruleEngine') {
                                            return undefined;
                                        }
                                        return value;
                                    };
                                    
                                    const safeGlobalContext = JSON.parse(JSON.stringify(global.globalContext, removeRuleEngine));
                        
                                    // Only broadcast if this is NOT a self-originating request
                                    if (!process.env.SERVER_ID || process.env.SERVER_ID !== this.server.serverId) {
                                        await this.server.broadcastConfigUpdate(this.server.apiConfig, this.server.categorizedConfig, safeGlobalContext);
                                    }
                        
                                    this.server.subscribeToConfigUpdates((updatedConfig, sourceServerId) => {
                                        if (sourceServerId === process.env.SERVER_ID) {
                                            console.log(`Ignoring config update from self (Server ID: ${sourceServerId})`);
                                            return;
                                        }
                                        this.server.apiConfig = updatedConfig.apiConfig;
                                        this.server.categorizedConfig = updatedConfig.categorizedConfig;
                                        global.globalContext.resources = updatedConfig.globalContext.resources || {};
                                        global.globalContext.actions = updatedConfig.globalContext.actions || {};
                                        if (updatedConfig.globalContext.dslText) {
                                            global.globalContext.dslText = updatedConfig.globalContext.dslText;
                                            const newRuleEngine = this.server.RuleEngine.fromDSL(updatedConfig.globalContext.dslText, global.globalContext);
                                            if (newRuleEngine) {
                                                global.globalContext.ruleEngine = newRuleEngine;
                                                this.app.locals.ruleEngineMiddleware = new this.server.RuleEngineMiddleware(newRuleEngine);
                                            }
                                        }
                                        console.log('Configuration updated from cluster.');
                                    });
                                }                                                              
                                console.log("API config reloaded successfully.");
                                socket.write("API config reloaded successfully.");
                            } catch (error) {
                                console.error(`Error reloading API config: ${error.message}`);
                                socket.write(`Error reloading API config: ${error.message}`);
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
                            // Fetch and display all actions from globalContext.actions
                            const actions = Object.keys(global.globalContext.actions);
                            if (actions.length === 0) {
                                socket.write("No actions available.\n");
                            } else {
                                socket.write(`Available actions:\n${actions.join("\n")}\n`);
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