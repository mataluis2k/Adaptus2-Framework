const express = require('express');
const fs = require('fs');
const path = require('path');
const morgan = require('morgan');
const Redis = require('ioredis');
require('dotenv').config();
const jwt = require('jsonwebtoken');

// Import other modules
const { getDbConnection } = require('./modules/db');
const buildApiConfigFromDatabase = require('./modules/buildConfig');
const BusinessRules = require('./modules/business_rules');
const MLAnalytics = require('./modules/ml_analytics');
const mlAnalytics = new MLAnalytics();
const RateLimit = require('./modules/rate_limit');
const generateGraphQLSchema = require('./modules/generateGraphQLSchema');
const { createHandler } = require('graphql-http/lib/use/express');
const ChatModule = require('./modules/chatModule'); // Chat Module
const generateSwaggerDoc = require('./modules/generateSwaggerDoc');

const StreamingServer = require('./modules/streamingServer'); // Streaming Module


const DSLParser = require('./modules/dslparser');
const RuleEngine = require('./modules/ruleEngine.js');  
const crypto = require('crypto');
const consolelog = require('./modules/logger');

const PaymentModule = require('./modules/paymentModule'); // Payment Module


const configFile = path.join(process.cwd(), 'config/apiConfig.json');
const rulesConfigPath = path.join(process.cwd(), 'config/businessRules.dsl'); // Path to the rules file
const RuleEngineMiddleware = require('./middleware/RuleEngineMiddleware.js');

ruleEngine = null; // Global variable to hold the rule engine
const {  initializeRAG , handleRAG } = require("./modules/ragHandler1.js");
require('dotenv').config({ path: process.cwd() + '/.env' });
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'error.log', level: 'error' })
    ],
});

var newRules = null;
const { passport, authenticateOAuth } = require('./middleware/oauth');
const { exit } = require('process');

const redisServer = process.env.REDIS_URL +":"+ process.env.REDIS_PORT || 'redis://localhost:6379';
if(!process.env.REDIS_URL) {
    console.log('No Redis URL provided. Using default URL:', redisServer);
}

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const JWT_SECRET = process.env.JWT_SECRET || 'IhaveaVeryStrongSecret';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '1h';

console.log('Current directory:', process.cwd());

const graphqlDbType = process.env.GRAPHQL_DBTYPE;
const graphqlDbConnection = process.env.GRAPHQL_DBCONNECTION;

let apiConfig = [];

const globalContext = {
    actions: {
        log: (ctx, message) => consolelog.log(`[LOG]: ${message}`),
        notify: (ctx, target) => consolelog.log(`[NOTIFY]: Notification to ${target}`),
    },
};

function flattenResolvers(resolvers) {
    const flatResolvers = {};

    // Add Query resolvers to the top-level
    if (resolvers.Query) {
        Object.assign(flatResolvers, resolvers.Query);
    }

    // Add Mutation resolvers to the top-level (if any)
    if (resolvers.Mutation) {
        Object.assign(flatResolvers, resolvers.Mutation);
    }

    return flatResolvers;
}


function registerProxyEndpoints(apiConfig) {
    apiConfig.forEach((config) => {
        if (config.type === "proxy") {
            const { route, method, targetUrl, queryMapping, headers, cache, enrich, responseMapping } = config;

            app[method.toLowerCase()](route, async (req, res) => {
                try {
                    const cacheKey = `${route}:${JSON.stringify(req.query)}`;
                    
                    // Check cache if enabled
                    if (cache?.enabled) {
                        const cachedData = await getFromCache(cacheKey);
                        if (cachedData) {
                            consolelog.log("Cache hit for:", cacheKey);
                            return res.json(cachedData);
                        }
                    }

                    // Map incoming query parameters to external API
                    const externalParams = {};
                    for (const [localKey, externalKey] of Object.entries(queryMapping || {})) {
                        if (req.query[localKey] !== undefined) {
                            externalParams[externalKey] = req.query[localKey];
                        }
                    }

                    // Make the external API request
                    const externalResponse = await axios({
                        url: targetUrl,
                        method,
                        params: externalParams,
                        headers: headers || {},
                    });

                    let responseData = externalResponse.data;

                    // Enrich response with internal endpoints
                    if (enrich && Array.isArray(enrich)) {
                        for (const enrichment of enrich) {
                            const { route: enrichRoute, key, fields } = enrichment;

                            for (const item of responseData) {
                                const enrichKeyValue = item[key];
                                if (enrichKeyValue) {
                                    const enrichmentResponse = await axios.get(enrichRoute, {
                                        params: { [key]: enrichKeyValue },
                                    });

                                    const enrichmentData = enrichmentResponse.data;
                                    // Add specified fields to the original response
                                    fields.forEach((field) => {
                                        if (enrichmentData[field] !== undefined) {
                                            item[field] = enrichmentData[field];
                                        }
                                    });
                                }
                            }
                        }
                    }

                    // Map response fields if responseMapping is defined
                    if (responseMapping) {
                        responseData = responseData.map((item) => {
                            const mappedItem = {};
                            for (const [externalKey, localKey] of Object.entries(responseMapping)) {
                                mappedItem[localKey] = item[externalKey];
                            }
                            return mappedItem;
                        });
                    }

                    // Cache response if caching is enabled
                    if (cache?.enabled) {
                        setToCache(cacheKey, responseData, cache.ttl);
                    }

                    res.json(responseData);
                } catch (error) {
                    console.error("Error in proxy endpoint:", error.message);
                    res.status(500).json({ error: "Internal Server Error" });
                }
            });
        }
    });
}

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' }); // Stop execution
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Forbidden' }); // Stop execution
        }
        req.user = user; // Attach user data to the request
        next(); // Proceed to the next middleware or route handler
    });
};

function registerRoutes(app, apiConfig) {
    apiConfig.forEach((endpoint) => {
        const { route, dbTable, allowRead, allowWrite, keys, acl, relationships, allowMethods, cache , auth, authentication, encryption} = endpoint;

        // Default to all methods if `allowMethods` is not specified
        const allowedMethods = allowMethods || ["GET", "POST", "PUT", "DELETE"];

        // Access Control Middleware
        const aclMiddleware = (req, res, next) => {
            if (req.user.acl !== acl) {
                return res.status(403).json({ error: 'Access Denied' });
            }
            next();
        };

        if (auth && authentication) {
            consolelog.log(`Adding authentication for route: ${route}`);
            app.post(route, async (req, res) => {
                const username = req.body[auth];
                const password = req.body[authentication];

                if (!username || !password) {
                    return res.status(400).json({ error: "Username and password are required" });
                }

                try {
                    const connection = await getDbConnection(endpoint);

                    if (!connection) {
                        return res.status(500).json({ error: `Database connection failed for ${endpoint.dbConnection}` });
                    }

                    // Query user record from database
                    const query = `SELECT ${allowRead.join(", ")} FROM ${dbTable} WHERE ${auth} = ?`;
                    const [results] = await connection.execute(query, [username]);

                    if (results.length === 0) {
                        return res.status(401).json({ error: "Invalid username or password" });
                    }

                    const user = results[0];

                    // Password validation
                    let isValidPassword = false;

                    if (encryption === "bcrypt") {
                        isValidPassword = await bcrypt.compare(password, user[authentication]);
                    } else if (encryption === "sha256") {
                        const hashedPassword = crypto.createHash("sha256").update(password).digest("hex");
                        isValidPassword = hashedPassword === user[authentication];
                    } else {
                        return res.status(500).json({ error: `Unsupported encryption type: ${encryption}` });
                    }

                    if (!isValidPassword) {
                        return res.status(401).json({ error: "Invalid username or password" });
                    }

                    // Generate JWT token
                    const tokenPayload = {};
                    allowRead.forEach((field) => {
                        if(field !== authentication) {
                            tokenPayload[field] = user[field];
                        }
                    });

                    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRY });

                    res.json({
                        message: "Authentication successful",
                        token,
                    });
                } catch (error) {
                    console.error(`Error in POST ${route}:`, error.message);
                    res.status(500).json({ error: "Internal Server Error" });
                }
            });
        }


        // GET Endpoint with Redis Caching
        if (allowedMethods.includes("GET")) {
            app.get(route, authenticateToken, aclMiddleware, async (req, res) => {
                try {
                    const connection = await getDbConnection(endpoint);
                    if (!connection) {
                        return res.status(500).json({ error: `Database connection failed for ${endpoint.dbConnection}` });
                    }

                    // Determine cache key and TTL
                    const cacheTTL = cache || 0; // Default to no caching if not specified
                    const cacheKey = `${route}:${JSON.stringify(req.query)}`;

                    if (cacheTTL > 0) {
                        // Check Redis cache
                        const cachedData = await redis.get(cacheKey);
                        if (cachedData) {
                            consolelog.log(`Cache hit for key: ${cacheKey}`);
                            return res.json({ data: JSON.parse(cachedData) });
                        }
                    }

                    // Determine requested columns
                    const requestedFields = req.query.fields
                        ? req.query.fields.split(',').filter((field) => allowRead.includes(field))
                        : allowRead;

                    if (requestedFields.length === 0) {
                        return res.status(400).json({ error: 'Invalid or no fields requested' });
                    }

                    const fields = requestedFields.map((field) => `${dbTable}.${field}`).join(', ');

                    // Handle relationships
                    let joinClause = '';
                    let relatedFields = '';
                    if (relationships && Array.isArray(relationships)) {
                        relationships.forEach((rel) => {
                            joinClause += ` ${rel.joinType} ${rel.relatedTable} ON ${dbTable}.${rel.foreignKey} = ${rel.relatedTable}.${rel.relatedKey}`;
                            if (rel.fields && Array.isArray(rel.fields)) {
                                relatedFields += rel.fields.map((field) => `${rel.relatedTable}.${field}`).join(', ');
                            }
                        });
                    }

                    const queryFields = relatedFields ? `${fields}, ${relatedFields}` : fields;

                    // Construct WHERE clause from keys
                    let whereClause = '';
                    let params = [];
                    if (keys && keys.length > 0) {
                        const queryKeys = keys.filter((key) => req.query[key] !== undefined);
                        if (queryKeys.length > 0) {
                            whereClause = queryKeys.map((key) => `${dbTable}.${key} = ?`).join(' AND ');
                            params = queryKeys.map((key) => req.query[key]);
                        }
                    }

                    // Execute query
                    const query = `SELECT ${queryFields} FROM ${dbTable} ${joinClause} ${whereClause ? `WHERE ${whereClause}` : ''}`;
                    consolelog.log(`Executing query: ${query} with params: ${params}`);

                    const [results] = await connection.execute(query, params);

                    // Handle no results
                    if (results.length === 0) {
                        return res.status(404).json({ error: 'Data not found' });
                    }

                    // Cache the query results in Redis if caching is enabled
                    if (cacheTTL > 0) {
                        consolelog.log(`Caching response for key: ${cacheKey} with TTL: ${cacheTTL}`);
                        await redis.setex(cacheKey, cacheTTL, JSON.stringify(results));
                    }

                    res.json({ data: results });
                } catch (error) {
                    console.error(`Error in GET ${route}:`, error.message);
                    res.status(500).json({ error: 'Internal Server Error' });
                }
            });
        }

        // POST, PUT, DELETE endpoints (unchanged but dynamically registered based on allowMethods)
        if (allowedMethods.includes("POST")) {
            app.post(route, authenticateToken, aclMiddleware, async (req, res) => {
                const writableFields = Object.keys(req.body).filter((key) => allowWrite.includes(key));
                if (writableFields.length === 0) {
                    return res.status(400).json({ error: 'No writable fields provided' });
                }

                const values = writableFields.map((key) => req.body[key]);
                const placeholders = writableFields.map(() => '?').join(', ');
                const query = `INSERT INTO ${dbTable} (${writableFields.join(', ')}) VALUES (${placeholders})`;

                try {
                    const connection = await getDbConnection(endpoint);
                    const [result] = await connection.execute(query, values);
                    res.status(201).json({ message: 'Record created', id: result.insertId });
                } catch (error) {
                    console.error(`Error in POST ${route}:`, error);
                    res.status(500).json({ error: 'Internal Server Error' });
                }
            });
        }

        if (allowedMethods.includes("PUT")) {
            app.put(`${route}/:id`, authenticateToken, aclMiddleware, async (req, res) => {
                const writableFields = Object.keys(req.body).filter((key) => allowWrite.includes(key));
                if (writableFields.length === 0) {
                    return res.status(400).json({ error: 'No writable fields provided' });
                }

                const values = writableFields.map((key) => req.body[key]);
                const setClause = writableFields.map((key) => `${key} = ?`).join(', ');
                const query = `UPDATE ${dbTable} SET ${setClause} WHERE id = ?`;

                try {
                    const connection = await getDbConnection(endpoint);
                    await connection.execute(query, [...values, req.params.id]);
                    res.json({ message: 'Record updated' });
                } catch (error) {
                    console.error(`Error in PUT ${route}:`, error);
                    res.status(500).json({ error: 'Internal Server Error' });
                }
            });
        }

        if (allowedMethods.includes("DELETE")) {
            app.delete(`${route}/:id`, authenticateToken, aclMiddleware, async (req, res) => {
                const query = `DELETE FROM ${dbTable} WHERE id = ?`;

                try {
                    const connection = await getDbConnection(endpoint);
                    await connection.execute(query, [req.params.id]);
                    res.json({ message: 'Record deleted' });
                } catch (error) {
                    console.error(`Error in DELETE ${route}:`, error);
                    res.status(500).json({ error: 'Internal Server Error' });
                }
            });
        }
    });
}

function initializeRules() {
    try {
        const dslText = fs.readFileSync(rulesConfigPath, 'utf-8');

        // Use RuleEngine's fromDSL to initialize the engine properly
        const ruleEngineInstance = RuleEngine.fromDSL(dslText);

        if (ruleEngine) {
            // Merge new rules with existing rules
            ruleEngine.rules = [...ruleEngine.rules, ...ruleEngineInstance.rules];
        } else {
            // Initialize the rule engine with the parsed rules
            ruleEngine = ruleEngineInstance;
        }
       
        consolelog.log('Business rules initialized successfully.');
    } catch (error) {
        console.error('Failed to initialize business rules:', error.message);
        process.exit(1); // Exit server if rules can't be loaded
    }
}



function setupRag(apiConfig) {
    // Initialize RAG during server startup
    initializeRAG(apiConfig).catch((error) => {
        console.error("Failed to initialize RAG:", error.message);
        process.exit(1); // Exit if initialization fails
    });
}

class PluginManager {
    constructor(pluginDir, server, dependencyManager) {
        this.pluginDir = pluginDir;
        this.server = server;
        this.plugins = new Map(); // Track plugins by name
        this.dependencyManager = dependencyManager;
    }

    /**
     * Load all plugins statically during server startup.
     */
    loadPlugins() {
        const pluginFiles = fs.readdirSync(this.pluginDir).filter((file) => file.endsWith('.js'));

        pluginFiles.forEach((file) => {
            const pluginName = file.replace('.js', '');
            this.loadPlugin(pluginName);
        });
    }

    /**
     * Load a single plugin dynamically by name.
     * @param {string} pluginName - Name of the plugin to load (without `.js`).
     */
    async loadPlugin(pluginName) {
        const pluginPath = path.join(this.pluginDir, `${pluginName}.js`);
    
        if (this.plugins.has(pluginName)) {
            console.warn(`Plugin ${pluginName} is already loaded.`);
            return;
        }
    
        try {
            const plugin = require(pluginPath);
    
            if (!this.validatePlugin(plugin)) {
                throw new Error(`Plugin ${pluginName} failed validation.`);
            }
    
            const dependencies = this.dependencyManager.getDependencies();
            if (typeof plugin.initialize === 'function') {
                plugin.initialize(dependencies);
            }
    
            let registeredRoutes = [];
            if (typeof plugin.registerRoutes === 'function') {
                registeredRoutes = plugin.registerRoutes({ app: this.server.app });
            }
    
            this.plugins.set(pluginName, { instance: plugin, routes: registeredRoutes });
            consolelog.log(`Plugin loaded dynamically: ${plugin.name} v${plugin.version}`);
        } catch (error) {
            console.error(`Failed to load plugin ${pluginName}:`, error.message);
        }
    }
    
    

    /**
     * Unload a plugin safely.
     * @param {string} pluginName - Name of the plugin to unload.
     */
    unloadPlugin(pluginName) {
        if (!this.plugins.has(pluginName)) {
            console.warn(`Plugin ${pluginName} is not loaded.`);
            return;
        }
    
        const { instance: plugin, routes } = this.plugins.get(pluginName);
        try {
            if (plugin.cleanup) {
                plugin.cleanup();
            }
    
            // Remove registered routes
            routes.forEach(({ method, path }) => {
                const stack = this.server.app._router.stack;
                for (let i = 0; i < stack.length; i++) {
                    const layer = stack[i];
                    if (layer.route && layer.route.path === path && layer.route.methods[method]) {
                        stack.splice(i, 1); // Remove the route
                        consolelog.log(`Unregistered route ${method.toUpperCase()} ${path}`);
                    }
                }
            });
    
            // Clean up module cache
            delete require.cache[require.resolve(path.join(this.pluginDir, `${pluginName}.js`))];
            this.plugins.delete(pluginName);
    
            consolelog.log(`Plugin ${pluginName} unloaded successfully.`);
        } catch (error) {
            console.error(`Error unloading plugin ${pluginName}:`, error.message);
        }
    }
    
    

    /**
     * Validate a plugin to ensure it conforms to the required structure.
     * @param {object} plugin - The plugin module to validate.
     * @returns {boolean} - True if valid, false otherwise.
     */
    validatePlugin(plugin) {
        const requiredMethods = ['initialize', 'registerRoutes'];
        return requiredMethods.every((method) => typeof plugin[method] === 'function');
    }

    /**
     * Register routes or middleware for all active plugins.
     * @param {object} app - Express application instance.
     */
    registerPlugins(app) {
        this.plugins.forEach((plugin, pluginName) => {
            try {
                const dependencies = this.dependencyManager.getDependencies();
                if (typeof plugin.registerMiddleware === 'function') {
                    plugin.registerMiddleware({ ...dependencies, app });
                }
                if (typeof plugin.registerRoutes === 'function') {
                    plugin.registerRoutes({ ...dependencies, app });
                }
                consolelog.log(`Routes registered for plugin: ${pluginName}`);
            } catch (error) {
                console.error(`Error in plugin ${pluginName}:`, error.message);
            }
        });
    }
}

class DependencyManager {
    constructor() {
        this.dependencies = {};
        this.context = globalContext; 
    }

    addDependency(name, instance) {
        this.dependencies[name] = instance;
    }

    getDependencies() {
        return { ...this.dependencies, context: this.context };
    }

    extendContext(key, value) {
        this.context[key] = value;
    }
}


class FlexAPIServer {
    constructor({ port = 3000, configPath = '../config/apiConfig.json', pluginDir = '../plugins' }) {
        this.port = port;
        this.configPath = configPath;
        this.pluginDir = pluginDir;
        this.app = express();
        this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
        this.apiConfig = [];
        this.businessRules = new BusinessRules();
        this.dependencyManager = new DependencyManager();
        this.pluginManager = new PluginManager(this.pluginDir, this, this.dependencyManager);

        // Optional modules
        this.chatModule = null;
        this.paymentModule = null;
        this.streamingServer = null;
    }

    setupPluginLoader() {
       // Signal to dynamically load a plugin
        process.on('SIGUSR2', async () => {
            consolelog.log('Received SIGUSR2. Enter command (load/unload) and plugin name:');
            process.stdin.once('data', async (input) => {
                const [command, pluginName] = input.toString().trim().split(' ');
                this.pluginManager.server = { app: this.app }; // Provide the app instance
                if (command === 'load') {
                    this.pluginManager.loadPlugin(pluginName);
                } else if (command === 'unload') {
                    this.pluginManager.unloadPlugin(pluginName);
                } else if (command === 'list') {
                    consolelog.log('Loaded Plugins:', Array.from(this.pluginManager.plugins.keys()));
                } else if (command === 'reload') {
                    this.pluginManager.unloadPlugin(pluginName);
                    this.pluginManager.loadPlugin(pluginName);
                } else if (command === 'reloadall') {
                    this.pluginManager.plugins.forEach((plugin, name) => {
                        this.pluginManager.unloadPlugin(name);
                        this.pluginManager.loadPlugin(name);
                    });
                } else if(command === 'routes') {
                    const routes = this.app._router.stack
                        .filter((layer) => layer.route)
                        .map((layer) => ({ path: layer.route.path, methods: Object.keys(layer.route.methods) }));
                        consolelog.log(routes);
                } else {
                    consolelog.log('Invalid command. Use "load <pluginName>" or "unload <pluginName>".');
                }
            });
        });
    }
        
    async loadConfig() {
        try {
            const configData = fs.readFileSync(configFile, 'utf-8');
            this.apiConfig = JSON.parse(configData);
            consolelog.log('Configuration loaded successfully.');
        } catch (error) {
            console.error('Error loading configuration:', error);
            throw error;
        }
    }


  

        // Reload Configuration
    setupReloadHandler(configFile) {
        process.on('SIGHUP', async () => {
            consolelog.log('Reloading configuration...');
            await loadConfig(configFile);
            registerRoutes();
            consolelog.log('Configuration reloaded.');
        });
    }


    registerMiddleware() {
        this.app.use(express.json());
        this.app.use(morgan('combined'));
        // this.businessRules.loadRules();
        // this.app.use(this.businessRules.middleware());
        const rateLimit = new RateLimit(this.apiConfig, this.redis);
        this.app.use(rateLimit.middleware());      
        consolelog.log('Rule Engine for Middleware',ruleEngine);
        const ruleEngineMiddleware = new RuleEngineMiddleware(ruleEngine);
        this.app.use(ruleEngineMiddleware.middleware());
    }

    registerRoutes() {
        registerRoutes(this.app, this.apiConfig);
    }

    registerProxyEndpoints() {
        registerProxyEndpoints(this.apiConfig);
    }

    setupConfigBuilder(app,configFilePath){
        app.get('/api/config', (req, res) => {
            try {                
                const configs = this.apiConfig;
                res.json(configs);
            } catch (err) {
                res.status(500).json({ error: "Failed to load configurations" });
            }
        });
        
        // Add or update configuration
        app.post('/api/config', (req, res) => {
            try {
                const newConfig = req.body;
                const configs = JSON.parse(fs.readFileSync(configFilePath, 'utf-8'));
                configs.push(newConfig);
                fs.writeFileSync(configFilePath, JSON.stringify(configs, null, 2));
                res.json({ message: "Configuration saved" });
            } catch (err) {
                res.status(500).json({ error: "Failed to save configuration" });
            }
        });
        
        
        
        app.get('/internal/builder', (req, res) => {
            res.sendFile(path.join(__dirname, './static', 'builder.html'));
        });
    }

    async setupGraphQL() {
        if (!graphqlDbType || !graphqlDbConnection) return;

        var { schema, rootResolvers } = generateGraphQLSchema(this.apiConfig);
        rootResolvers = flattenResolvers(rootResolvers);
    
        const driver = {
            dbConnection: async () => await getDbConnection({ dbType: graphqlDbType, dbConnection: graphqlDbConnection }),
        };

        this.app.use(
            '/graphql',
            express.json(),
            (req, res, next) => {
                req.parsedBody = req.body;
                res.dbConnection = driver.dbConnection;
                next();
            }
        );

        this.app.use(
            '/graphql',
            createHandler({
                schema,
                rootValue: rootResolvers,
                context: async (req, res) => ({
                    req,
                    res,
                    dbConnection: await driver.dbConnection(),
                }),
            })
        );
    }

    // Initialize optional modules safely
    initializeOptionalModules(app) {
        // Initialize Chat Module
        try {
            const httpServer = require('http').createServer(app); // Reuse server
            this.chatModule = new ChatModule(httpServer, app, JWT_SECRET, this.apiConfig);
            this.chatModule.start();
            consolelog.log('Chat module initialized.');
        } catch (error) {
            console.error('Failed to initialize Chat Module:', error.message);
        }

        // // Initialize Payment Module
        // try {
        //     const dbConfig = {
        //         getConnection: async () => await getDbConnection({ dbType: "mysql", dbConnection: "MYSQL_1" }),
        //     };
        //     this.paymentModule = new PaymentModule(this.app, dbConfig);
        //     consolelog.log('Payment module initialized.');
        // } catch (error) {
        //     console.error('Failed to initialize Payment Module:', error.message);
        // }

        // Initialize Streaming Server Module
        try {
            const s3Config = {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
                region: process.env.AWS_REGION,
            };
            this.streamingServer = new StreamingServer(this.app, s3Config);
            this.streamingServer.registerRoutes();
            consolelog.log('Streaming server module initialized.');
        } catch (error) {
            console.error('Failed to initialize Streaming Server Module:', error.message);
        }

        mlAnalytics.loadConfig();
        mlAnalytics.trainModels();
        mlAnalytics.scheduleTraining();

        app.use('/ml', mlAnalytics.middleware());



        app.post("/api/rag", async (req, res) => {
        try {
            const { query } = req.body;
            if (!query) {
            return res.status(400).json({ error: "Query is required." });
            }
           
            const response = await handleRAG(query, this.apiConfig);

            res.json({ data: response });
        } catch (error) {
            console.error("RAG API Error:", error.message);
            res.status(500).json({ error: "Internal Server Error" });
        }
        });
          
    }
    setupDependencies() {
        // Add common dependencies to the manager.
        this.dependencyManager.addDependency('app', this.app);
        this.dependencyManager.addDependency('db', getDbConnection); // Add a database connection function.
        this.dependencyManager.addDependency('logger', logger);
    }

    async start(callback) {
        try {
          
            consolelog.log(configFile);
               // Validate required parameters
             // Extract command-line arguments (excluding the first two default arguments)
            const args = process.argv.slice(2);

            const isSwaggerGeneration = args.includes('--generate-swagger');

            // Default paths
            let inputConfigPath = path.resolve(process.cwd(), './config/apiConfig.json');
            let outputSwaggerPath = path.resolve(process.cwd(), './swagger.json');

            // Allow users to provide custom input and output paths
            args.forEach((arg, index) => {
                if (arg === '--input' && args[index + 1]) {
                    inputConfigPath = path.resolve(process.cwd(), args[index + 1]);
                }
                if (arg === '--output' && args[index + 1]) {
                    outputSwaggerPath = path.resolve(process.cwd(), args[index + 1]);
                }
            });

            // Handle Swagger generation
            if (isSwaggerGeneration) {
                try {
                  
                    console.log(`Saving Swagger file to: ${outputSwaggerPath}`);
                    const apiConfig = JSON.parse(fs.readFileSync(inputConfigPath, 'utf-8'));
                    console.log(apiConfig);
                    generateSwaggerDoc(apiConfig, outputSwaggerPath);

                    console.log('Swagger documentation generated successfully. Exiting...');
                    process.exit(0);
                } catch (error) {
                    console.error(`Error generating Swagger: ${error.message}`);
                    process.exit(1);
                }
            }
            // Check if any parameters are passed
            if (args.length > 0 && !args.includes('--build') && !args.includes('--init')) {
                consolelog.log(
                    'Error: Invalid parameters provided. Please use one of the following:\n' +
                    '  --build   Build API configuration from the database.\n' +
                    '  --init    Initialize database tables.\n' +
                    'Or start the server without parameters to run normally.'
                );
                process.exit(1); // Exit with an error code
            }
            // Add support for building API config from database
            if (process.argv.includes('--build')) {
                consolelog.log('Building API configuration from database...');
                await buildApiConfigFromDatabase(configFile);
                consolelog.log('API configuration build complete.');
                process.exit(0);
            }

            // Load the API configuration
            await this.loadConfig(configFile);

            this.setupDependencies(); // Initialize dependencies.

            // Check if -init parameter is provided
            if (process.argv.includes('--init')) {
                consolelog.log('Initializing database tables...');
                await this.initializeTables();
                consolelog.log('Table initialization complete. Exiting...');
                process.exit(0);
            }

          

            setupRag(this.apiConfig);
            initializeRules();
            
            this.registerMiddleware();
            this.registerRoutes();
            this.registerProxyEndpoints();
            this.initializeOptionalModules(this.app);
            await this.setupGraphQL();

            this.setupConfigBuilder(this.app,this.apiConfig);
           this.setupPluginLoader();
           this.setupReloadHandler(this.configPath);

            this.app.listen(this.port, () => {
                consolelog.log(`API server running on port ${this.port}`);
                if (callback) callback();
            });
            return this.app;

        } catch (error) {
            console.error('Failed to start server:', error);
        }
    }
   

    close() {
        if (this.server) {
            this.server.close();
        }
    }
}




// Export the FlexAPIServer class
module.exports = FlexAPIServer;

// Example: Create a new server instance and start it
if (require.main === module) {
    const server = new FlexAPIServer({
        port: process.env.PORT || 3000,
        configPath: './config/apiConfig.json',
    });
    server.start();
}
