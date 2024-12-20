const express = require('express');
const cors = require('cors'); // Import the cors middleware
const fs = require('fs');
const path = require('path');
const morgan = require('morgan');
const Redis = require('ioredis');

require('dotenv').config({ path: __dirname + '/.env' });
const jwt = require('jsonwebtoken');
const axios = require('axios');
// Import other modules
const { getDbConnection } = require(path.join(__dirname, '/modules/db'));
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

const RuleEngine = require('./modules/ruleEngine');  
const crypto = require('crypto');
const multer = require('multer');

const PaymentModule = require('./modules/paymentModule'); // Payment Module
const DSLParser = require('./modules/dslparser');
const configDir = process.env.CONFIG_DIR || path.join(process.cwd(), 'config');
const configFile = path.join(configDir, 'apiConfig.json');
const rulesConfigPath = path.join(configDir, 'businessRules.dsl'); // Path to the rules file
const RuleEngineMiddleware = require('./middleware/RuleEngineMiddleware');

ruleEngine = null; // Global variable to hold the rule engine
const {  initializeRAG , handleRAG } = require("./modules/ragHandler1");
const corsOptions = {
    origin: 'http://localhost:5173', // Replace with your frontend's origin
    // methods: ['GET', 'POST', 'PUT', 'DELETE'],
    // allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true, // If applicable
  };

const consolelog = require('./modules/logger');
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
const { passport, authenticateOAuth } = require('./middleware/oauth.js');
const { config } = require('dotenv');


const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const JWT_SECRET = process.env.JWT_SECRET || 'IhaveaVeryStrongSecret';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '1h';

consolelog.log('Current directory:', __dirname);

const graphqlDbType = process.env.GRAPHQL_DBTYPE;
const graphqlDbConnection = process.env.GRAPHQL_DBCONNECTION;

let apiConfig = [];

const globalContext = {
    actions: {
        log: (ctx, message) => consolelog.log(`[LOG]: ${message}`),
        notify: (ctx, target) => consolelog.log(`[NOTIFY]: Notification to ${target}`),
    },
};



const aclMiddleware = (allowedRoles) => {
    return (req, res, next) => {
        if (allowedRoles) {
            // Ensure `req.user.role` exists and matches one of the allowed roles
            const userRole = req.user?.role;
            if (!userRole || !allowedRoles.includes(userRole)) {
                return res.status(403).json({ error: 'Access Denied' });
            }
        }
        next(); // Skip ACL check if not required
    };
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

const authenticateMiddleware = (authType) => {
    return (req, res, next) => {
        if (authType) {
            // Enforce token authentication (e.g., JWT)
            return authenticateToken(req, res, next); // Replace with your existing token logic
        }
        next(); // Skip authentication if not required
    };
};

function findArrayWithKeys(data, requiredKeys) {
    if (Array.isArray(data)) {
        // Check if this array matches the criteria
        if (data.length > 0 && data.every(item => 
            item && typeof item === 'object' && requiredKeys.every(k => k in item))) {
            return data; // Found the array
        } else {
            // Otherwise, search inside each element
            for (const element of data) {
                const found = findArrayWithKeys(element, requiredKeys);
                if (found) return found;
            }
        }
    } else if (data && typeof data === 'object') {
        // Search all object values
        for (const key in data) {
            const found = findArrayWithKeys(data[key], requiredKeys);
            if (found) return found;
        }
    }
    // If not found
    return null;
}

function registerProxyEndpoints(app, apiConfig) {
    apiConfig.forEach((config, index) => {
        const { auth, acl, route, method, targetUrl, queryMapping, headers, cache, enrich, responseMapping } = config;
        try {           
            // Validate config structure
            if (config.dbType !== "proxy") {
                console.log(`Skipping non-proxy config at index ${index}`);
                return;
            }

            // Validate critical fields
            if (!route || !method || !targetUrl) {
                console.error(`Invalid proxy configuration at index ${index}:`, config);
                throw new Error("Missing required fields: route, method, or targetUrl.");
            }

            // Log proxy registration details
            console.log(`Registering proxy for route: ${route}, method: ${method}, targetUrl: ${targetUrl}`);
            // [method.toLowerCase()]
            app.get(route, authenticateMiddleware(auth), aclMiddleware(acl), async (req, res) => {                                
                console.log(`Proxy request received on route: ${route}`);
                console.log(`Request query parameters:`, req.query);

                try {
                    const cacheKey = `${route}:${JSON.stringify(req.query)}`;

                    // Check cache if enabled
                    if (cache?.enabled) {
                        console.log(`Checking cache for key: ${cacheKey}`);
                        const cachedData =  await redis.get(cacheKey);
                        if (cachedData) {
                            console.log("Cache hit:", cachedData);
                            return res.json(JSON.parse(cachedData));
                        }
                        console.log("Cache miss for key:", cacheKey);
                    }

                    // Map incoming query parameters to external API
                    const externalParams = {};
                    for (const [localKey, externalKey] of Object.entries(queryMapping || {})) {
                        if (req.query[localKey] !== undefined) {
                            externalParams[externalKey] = req.query[localKey];
                        }
                    }
                    console.log(`Mapped query parameters:`, externalParams);

                    // Make the external API request
                    console.log(`Making external API request to: ${targetUrl}`);
                    const externalResponse = await axios({
                        url: targetUrl,
                        method: method.toLowerCase(), // Ensure correct case
                        params: externalParams,
                        headers: headers || {},
                    });

                    console.log(`External API response status: ${externalResponse.status}`);
                    console.log(`External API response data:`, externalResponse.data);

                    let responseData = externalResponse.data;

                    // Enrich response with internal endpoints
                    if (enrich && Array.isArray(enrich)) {
                        console.log("Enriching response with internal endpoints.");
                        for (const enrichment of enrich) {
                            const { route: enrichRoute, key, fields } = enrichment;

                            for (const item of responseData) {
                                const enrichKeyValue = item[key];
                                if (enrichKeyValue) {
                                    console.log(`Fetching enrichment data from: ${enrichRoute} for key: ${key} = ${enrichKeyValue}`);
                                    const enrichmentResponse = await axios.get(enrichRoute, {
                                        params: { [key]: enrichKeyValue },
                                    });

                                    const enrichmentData = enrichmentResponse.data;
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
                        // Extract the external keys we need from responseMapping.
                        const requiredKeys = Object.keys(responseMapping);
                    
                        // Find the array in the nested response data
                        let targetArray = findArrayWithKeys(responseData, requiredKeys);
                    
                        if (!targetArray) {
                            console.error("No suitable array found in response data to map over.");
                            // Handle this scenario gracefully - maybe return the data as is.
                            return res.json(responseData);
                        }
                    
                        console.log("Mapping response fields based on configuration.");
                        targetArray = targetArray.map((item) => {
                            const mappedItem = {};
                            for (const [externalKey, localKey] of Object.entries(responseMapping)) {
                                mappedItem[localKey] = item[externalKey];
                            }
                            return mappedItem;
                        });
                    
                        // If you need to reinsert this mapped array back into the original structure,
                        // you might need to reconstruct the original data structure or just replace `responseData`
                        // with the targetArray if that's what you'd like to return.
                        responseData = targetArray;
                        console.log(`Mapped response data:`, responseData);
                    }
                    // Cache response if caching is enabled
                    if (cache?.enabled) {
                        console.log(`Caching response for key: ${cacheKey} with TTL: ${cache.ttl}`);                       
                        await redis.setex(cacheKey, cache.ttl, JSON.stringify(responseData));
                    }

                    res.json(responseData);
                } catch (error) {
                    console.error(`Error in proxy endpoint for route ${route}:`, error.message);
                    res.status(500).json({ error: "Internal Server Error" });
                }
            });
        } catch (err) {
            console.error(`Failed to register proxy at index ${index}:`, err.message);
        }
    });
}
// Dynamic multer storage based on the config
function getMulterStorage(storagePath) {
    return multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, storagePath);
      },
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, `${uniqueSuffix}-${file.originalname}`);
      },
    });
}

const registerFileUploadEndpoint = (app, config) => {
    const { route, dbTable, allowWrite, fileUpload , acl, auth } = config;
    const upload = multer({
        storage: getMulterStorage(fileUpload.storagePath),
        fileFilter: (req, file, cb) => {
            if (fileUpload.allowedFileTypes.includes(file.mimetype)) {
                cb(null, true);
            } else {
                cb(new Error(`Unsupported file type: ${file.mimetype}`), false);
            }
        },
    });

    const fieldName = fileUpload.fieldName || 'file'; // Default to 'file' if not specified

    app.post(route, cors(corsOptions),authenticateMiddleware(auth), aclMiddleware(acl), upload.single(fieldName), async (req, res) => {
        const dbConnectionConfig = { dbType: config.dbType, dbConnection: config.dbConnection };

        // Extract file and metadata
        const { file } = req;
        // uploaded_by should come from the jwt token        
        const uploaded_by = req.user; // Ensure this is passed in the request body

        if (!file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const sql = `
            INSERT INTO ${dbTable} (${allowWrite.join(', ')})
            VALUES (?, ?, ?, ?)
        `;

        const values = [
            file.filename,
            path.join(fileUpload.storagePath, file.filename),
            file.mimetype,
            uploaded_by,
        ];

        console.log(`Uploading file to ${route}:`, values);

        try {
            const connection = await getDbConnection(dbConnectionConfig);
            const [result] = await connection.execute(sql, values);

            res.status(201).json({ message: 'File uploaded successfully', fileId: result.insertId });
        } catch (error) {
            console.error(`Error uploading file at ${route}:`, error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });
};

  


function registerRoutes(app, apiConfig) {
    apiConfig.forEach((endpoint, index) => {
        const {  route, dbTable, allowRead, allowWrite, keys, acl, relationships, allowMethods, cache , auth, authentication, encryption} = endpoint;

        // Default to all methods if `allowMethods` is not specified
        const allowedMethods = allowMethods || ["GET", "POST", "PUT", "DELETE"];

          // Validate config structure
        if (endpoint.dbType === "proxy") {
            console.log(`Skipping proxy config at index ${index}`);
            return;
        }
        // A bit confusing, but this is the same as the proxy check above
        // Ideally we need to have a optimized loader. 
        if (endpoint.fileUpload) {
            registerFileUploadEndpoint(app, endpoint);
            return;
        }
     

        if (auth && authentication) {
            consolelog.log(`Adding authentication for route: ${route}`);
            app.post(route,cors(corsOptions), async (req, res) => {
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
                        user: username,
                    });
                } catch (error) {
                    console.error(`Error in POST ${route}:`, error.message);
                    res.status(500).json({ error: "Internal Server Error" });
                }
            });
        }


        // GET Endpoint with Redis Caching
        if (allowedMethods.includes("GET")) {
            app.get(route, authenticateMiddleware(auth), aclMiddleware(acl), async (req, res) => {
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
            app.post(route, authenticateMiddleware(auth), aclMiddleware(acl), async (req, res) => {
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
            app.put(`${route}/:id`, authenticateMiddleware(auth), aclMiddleware(acl), async (req, res) => {
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
            app.delete(`${route}/:id`, authenticateMiddleware(auth), aclMiddleware(acl), async (req, res) => {
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
    const openAIApiKey = process.env.OPENAI_API_KEY;
    if (!openAIApiKey) {
      console.log('OpenAI API key not found. RAG will not be initialized.');
        return;
    }
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
    constructor({ port = 3000, configPath = './config/apiConfig.json', pluginDir = '../plugins' }) {
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
        consolelog.log('pluginManager loaded...');
       // Signal to dynamically load a plugin
        process.on('SIGUSR2', async () => {
            console.log('Received SIGUSR2. Enter command (load/unload) and plugin name:');
            process.stdin.once('data', async (input) => {
                const [command, pluginName] = input.toString().trim().split(' ');
                this.pluginManager.server = { app: this.app }; // Provide the app instance
                if (command === 'load') {
                    this.pluginManager.loadPlugin(pluginName);
                } else if (command === 'unload') {
                    this.pluginManager.unloadPlugin(pluginName);
                } else if (command === 'list') {
                    console.log('Loaded Plugins:', Array.from(this.pluginManager.plugins.keys()));
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
                        console.log(routes);
                } else {
                    console.log('Invalid command. Use "load <pluginName>" or "unload <pluginName>".');
                }
            });
        });
    }
        
    async loadConfig() {
        try {
            console.log('Loading configuration...',configFile);
            const configData = fs.readFileSync(configFile, 'utf-8');
            this.apiConfig = JSON.parse(configData);
            consolelog.log('Configuration loaded successfully.');
        } catch (error) {
            console.error('Error loading configuration:', error);
            throw error;
        }
    }

    async initializeTables() {
        console.log('Initializing tables...');
        
        for (const endpoint of this.apiConfig) {
            const { dbType, dbTable, columnDefinitions } = endpoint;
            consolelog.log("Working on endpoint",endpoint);
            // Not acceptable dbType's are skipped
            if (!['mysql', 'postgres'].includes(dbType)) {
                console.warn(`Skipping ${dbTable}: Unsupported database type ${dbType}`);
                continue;
            }
            const connection = await getDbConnection(endpoint);
            
            if (!connection) {
                console.error(`Failed to connect to database for ${endpoint.dbConnection}`);
                continue;
            }
    
            if (!columnDefinitions) {
                console.warn(`Skipping ${dbTable}: No column definitions provided.`);
                continue;
            }
    
            try {
                // Check if the table exists
                let tableExists = false;
                if (dbType === 'mysql') {
                    const [rows] = await connection.execute(
                        `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?`,
                        [dbTable]
                    );
                    tableExists = rows[0].count > 0;
                } else if (dbType === 'postgres') {
                    const [rows] = await connection.execute(
                        `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_name = $1`,
                        [dbTable]
                    );
                    tableExists = rows[0].count > 0;
                } else {
                    console.warn(`Skipping ${dbTable}: Unsupported database type ${dbType}`);
                    continue;
                }
    
                if (tableExists) {
                    console.log(`Table ${dbTable} already exists. Skipping creation.`);
                    continue;
                }
    
                // Build the CREATE TABLE query
                const columns = Object.entries(columnDefinitions)
                    .map(([column, type]) => `${column} ${type}`)
                    .join(', ');
    
                const createTableQuery = `CREATE TABLE ${dbTable} (${columns})`;
                console.log(`Executing query: ${createTableQuery}`);
                await connection.execute(createTableQuery);
                console.log(`Table ${dbTable} initialized successfully.`);
            } catch (error) {
                console.error(`Error initializing table ${dbTable}:`, error);
            }
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
        registerProxyEndpoints(this.app, this.apiConfig);
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
            const corsOptions = {  origin: process.env.CORS_ORIGIN,  methods : process.env.CORS_METHODS };
            const httpServer = require('http').createServer(app); // Reuse server
            this.chatModule = new ChatModule(httpServer, app, JWT_SECRET, this.apiConfig, corsOptions);
            this.chatModule.start();
            httpServer.listen(3007, () => {
                console.log('Server running on http://localhost:3000');
            });
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

      

        app.use(cors(corsOptions));
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
                await buildApiConfigFromDatabase();
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
