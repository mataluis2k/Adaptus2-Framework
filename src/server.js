const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const morgan = require('morgan');
const Redis = require('ioredis');
const WebSocket = require('ws');
const http = require('http');
const APIAnalytics = require('./modules/apiAnalytics');
const AnalyticsRoutes = require('./routes/analytics');
const DevTools = require('./modules/devTools.js');
const DevToolsRoutes = require('./routes/devTools');
const crypto = require('crypto');
const multer = require('multer');
const net = require("net");
const helmet = require('helmet'); // Security middleware
const rateLimit = require('express-rate-limit'); // Rate limiting
const compression = require('compression'); // Response compression
require('dotenv').config({ path: __dirname + '/.env' });
const jwt = require('jsonwebtoken');
const axios = require('axios');
const requestLogger = require('./middleware/requestLoggingMiddleware');

// Constants for configuration
const REDIS_RETRY_STRATEGY = (times) => Math.min(times * 50, 2000); // Exponential backoff
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MAX_REQUEST_SIZE = '10mb';
// Configure axios defaults
axios.defaults.timeout = DEFAULT_TIMEOUT;
axios.defaults.maxContentLength = 10 * 1024 * 1024; // 10MB
axios.interceptors.request.use(request => {
    request.startTime = Date.now();
    return request;
});

axios.interceptors.response.use(
    response => {
        try {
            const consolelog = require('./modules/logger');
            const duration = Date.now() - response.config.startTime;
            consolelog.log('External API Request:', {
                url: response.config.url,
                method: response.config.method,
                duration: `${duration}ms`,
                status: response.status,
                timestamp: new Date().toISOString()
            });
            return response;
        } catch (error) {
            console.error('Failed to log axios response:', error);
            return response;
        }
    },
    error => {
        try {
            const consolelog = require('./modules/logger');
            consolelog.error('External API Error:', {
                url: error.config?.url,
                method: error.config?.method,
                status: error.response?.status,
                statusText: error.response?.statusText,
                error: error.stack || error.message,
                timestamp: new Date().toISOString()
            });
        } catch (loggingError) {
            console.error('Failed to log axios error:', loggingError);
            console.error('Original error:', error);
        }
        return Promise.reject(error);
    }
);

// Import other modules with error handling
const { loadConfig, apiConfig, categorizedConfig, categorizeApiConfig } = require('./modules/apiConfig');
const { getDbConnection, extendContext } = require(path.join(__dirname, '/modules/db'));
const buildApiConfigFromDatabase = require('./modules/buildConfig');
const BusinessRules = require('./modules/business_rules');
const MLAnalytics = require('./modules/ml_analytics');

const RateLimit = require('./modules/rate_limit');
const generateGraphQLSchema = require('./modules/generateGraphQLSchema');
const { createHandler } = require('graphql-http/lib/use/express');
const ChatModule = require('./modules/chatModule'); // Chat Module
const generateSwaggerDoc = require('./modules/generateSwaggerDoc');
const StreamingServer = require('./modules/streamingServer'); // Streaming Module
const RuleEngine = require('./modules/ruleEngine');
const ollamaModule = require('./modules/ollamaModule'); // Ollama Module
const DynamicRouteHandler = require('./modules/DynamicRouteHandler');
const FirebaseService = require('./services/firebaseService'); // Firebase Service
const CMSManager = require('./modules/cmsManager'); // CMS Module

// Changes to enable clustering and plugin management
const PLUGIN_MANAGER = process.env.PLUGIN_MANAGER || 'local'; 
const CLUSTER_NAME = process.env.CLUSTER_NAME || 'default'; // Default cluster
const PLUGIN_UPDATE_CHANNEL = `${CLUSTER_NAME}:plugins:update`;
const PLUGIN_FILE_PREFIX = `${CLUSTER_NAME}:plugin:file:`;
const PLUGIN_EVENT_CHANNEL = `${process.env.CLUSTER_NAME || 'default'}:plugin:events`;
const PLUGIN_CODE_KEY = `${process.env.CLUSTER_NAME || 'default'}:plugin:code:`;   
// Plugn manager for cluster end here

const CONFIG_UPDATE_CHANNEL = `${CLUSTER_NAME}:config:update`;
const CONFIG_STORAGE_KEY = `${CLUSTER_NAME}:config:data`;
const { broadcastConfigUpdate, subscribeToConfigUpdates } = require('./modules/configSync');
const configDir = process.env.CONFIG_DIR || path.join(process.cwd(), 'config');
const configFile = path.join(configDir, 'apiConfig.json');
const rulesConfigPath = path.join(configDir, 'businessRules.dsl'); // Path to the rules file
const RuleEngineMiddleware = require('./middleware/RuleEngineMiddleware');
const { authenticateMiddleware, aclMiddleware } = require('./middleware/authenticationMiddleware');
const Handlebars = require('handlebars');
const bcrypt = require("bcryptjs");
const response = require('./modules/response'); // Import the shared response object

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
        new winston.transports.Console({
            handleExceptions: true,
            handleRejections: true
        }),
        new winston.transports.File({
            filename: 'error.log',
            level: 'error',
            handleExceptions: true,
            handleRejections: true,
            maxsize: 5242880, // 5MB
            maxFiles: 5,
            tailable: true,
            eol: '\n',
            options: { flags: 'a' }
        })
    ],
    exitOnError: false // Don't exit on handled exceptions
});

// Add error event handlers for the file transport
logger.transports.forEach(transport => {
    if (transport instanceof winston.transports.File) {
        transport.on('error', (error) => {
            console.error('Error in file transport:', error);
        });
    }
});

// Initialize a global context for request storage
global.requestContext = new Map();

var newRules = null;
const { passport, authenticateOAuth } = require('./middleware/oauth.js');
const { config } = require('dotenv');


// Redis configuration with error handling and retry strategy
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    retryStrategy: REDIS_RETRY_STRATEGY,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    connectTimeout: 10000,
    lazyConnect: true
});

redis.on('error', (err) => {
    try {
        const consolelog = require('./modules/logger');
        consolelog.error('Redis Error:', {
            error: err.stack || err.message,
            timestamp: new Date().toISOString()
        });
    } catch (loggingError) {
        console.error('Failed to log Redis error:', loggingError);
        console.error('Original error:', err);
    }
});

redis.on('connect', () => {
    try {
        const consolelog = require('./modules/logger');
        consolelog.log('Redis Connection:', {
            status: 'connected',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Failed to log Redis connection:', error);
    }
});
const JWT_SECRET = process.env.JWT_SECRET || 'IhaveaVeryStrongSecret';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '1h';

// WebSocket event types
const WS_EVENTS = {
    DATABASE_CHANGE: 'DATABASE_CHANGE',
    CACHE_INVALIDATED: 'CACHE_INVALIDATED',
    CONFIG_UPDATED: 'CONFIG_UPDATED',
    ERROR: 'ERROR'
};

// Redis pub/sub channels
const REDIS_CHANNELS = {
    DB_CHANGES: 'db:changes',
    CACHE_UPDATES: 'cache:updates',
    CONFIG_CHANGES: 'config:changes'
};

// Create Redis publisher/subscriber instances
const redisPublisher = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const redisSubscriber = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

consolelog.log('Current directory:', __dirname);

const graphqlDbType = process.env.DEFAULT_DBTYPE;
const graphqlDbConnection = process.env.DEFAULT_DBCONNECTION;

const mlAnalytics = new MLAnalytics();


const { globalContext, middleware } = require('./modules/context');
const e = require('express');

globalContext.actions.log = (ctx, action) => {
    let message = null;

    try {
        const consolelog = require('./modules/logger');
        consolelog.log('Action Log:', {
            action: action,
            timestamp: new Date().toISOString()
        });

        if (action.message) {
            message = action.message;
            const evaluatedMessage = new Function('data', `with(data) { return \`${message}\`; }`)(ctx.data || {});
            consolelog.log('Evaluated Message:', {
                message: evaluatedMessage,
                timestamp: new Date().toISOString()
            });
        }
    } catch (error) {
        try {
            const consolelog = require('./modules/logger');
            consolelog.error('Error in action.log:', {
                error: error.stack || error.message,
                message: message,
                timestamp: new Date().toISOString()
            });
        } catch (loggingError) {
            console.error('Failed to log action error:', loggingError);
            console.error('Original error:', error);
        }
    }
};

globalContext.actions.response = (ctx, action) => {
    try {
        const consolelog = require('./modules/logger');
        const { key = "data" } = action;

        if (!ctx.data[key]) {
            ctx.data[key] = {};
            consolelog.log('Response Object:', {
                status: 'initialized',
                key: key,
                timestamp: new Date().toISOString()
            });
        } else {
            consolelog.log('Response Object:', {
                status: 'exists',
                key: key,
                timestamp: new Date().toISOString()
            });
        }

        return { success: true, message: `Response object is ready under key: ${key}` };
    } catch (error) {
        try {
            const consolelog = require('./modules/logger');
            consolelog.error('Error in action.response:', {
                error: error.stack || error.message,
                timestamp: new Date().toISOString()
            });
        } catch (loggingError) {
            console.error('Failed to log response error:', loggingError);
            console.error('Original error:', error);
        }
        throw error;
    }
};

globalContext.actions.mergeTemplate = (ctx, params) => {
            const { data } = params;
            const template = data.template;
            let templateData = data.data;
            console.log(templateData);
            if (typeof templateData === 'string') {
                try {
                    // Attempt to parse JSON strings
                    templateData = JSON.parse(templateData);
                } catch (error) {
                    console.warn(
                        'Invalid templateData format. Could not parse as JSON. Proceeding with raw string.',error.message
                    );
                }
            }
            if (!template || typeof template !== 'string') {
                throw new Error('Invalid template. Ensure template is a valid string.');
            }
            if (!templateData || typeof templateData !== 'object') {
                throw new Error('Invalid data. Ensure data is a valid object.');
            }

            try {
                // Compile the Handlebars template and merge with data
                const compiledTemplate = Handlebars.compile(template);
                const result = compiledTemplate(templateData);
                ctx.data['response'] = result;
                console.log('Template merged successfully:', result);
                return { success: true, result, key: 'response' };
            } catch (error) {
                console.error('Error merging template:', error.message);
                throw new Error(`Failed to merge template: ${error.message}`);
            }
};

globalContext.actions.notify = (ctx, target) => {
    console.log(`[NOTIFY]: Notification sent to ${target}`);
};

globalContext.actions.end = (ctx, params) => {
    console.log('[END]: End of action sequence');
    response.setResponse(600, null, null, null, 'END');
    return response;
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

// Plugin broadcaster for cluster
async function loadAndBroadcastPluginNetwork(pluginName, pluginPath, pluginConfig) {
    console.log(`Using network plugin manager to load and broadcast plugin: ${pluginName} in cluster: ${CLUSTER_NAME}`);
    try {
        const fs = require('fs');
        const { promisify } = require('util');
        const readFile = promisify(fs.readFile);

        const pluginCode = await readFile(pluginPath, 'utf-8');

        // Store plugin code and config in Redis with cluster isolation
        await redis.hset(`${PLUGIN_FILE_PREFIX}${pluginName}`, {
            code: Buffer.from(pluginCode).toString('base64'), // Encode the plugin code
            config: JSON.stringify(pluginConfig),
        });

        // Publish an update message to the cluster-specific Redis Pub/Sub channel
        await redis.publish(PLUGIN_UPDATE_CHANNEL, JSON.stringify({ name: pluginName }));

        console.log(`Plugin "${pluginName}" broadcasted successfully in cluster "${CLUSTER_NAME}".`);
    } catch (err) {
        console.error(`Error broadcasting plugin "${pluginName}" in cluster "${CLUSTER_NAME}":`, err);
    }
}

function registerProxyEndpoints(app, apiConfig) {
    apiConfig.forEach((config, index) => {
        const {
            auth,
            acl,
            route,
            allowMethods,
            targetUrl,
            queryMapping,
            headers,
            cache,
            enrich,
            responseMapping,
        } = config;

        try {
            // Validate config structure
            if (config.routeType !== "proxy") {
                console.log(`Skipping non-proxy config at index ${index}`);
                return;
            }

            // Validate critical fields
            if (!route || !allowMethods || !targetUrl || !Array.isArray(allowMethods)) {
                console.error(`Invalid proxy configuration at index ${index}:`, config);
                throw new Error("Missing required fields: route, allowMethods, or targetUrl.");
            }
            if (typeof auth === 'undefined') {
                console.warn(`Missing 'auth' for route ${route} at index ${index}. Defaulting to no authentication.`);
            }

            if (typeof acl === 'undefined') {
                console.warn(`Missing 'acl' for route ${route} at index ${index}. Defaulting to no ACL.`);
            }

            // Register routes for each method in allowMethods
            allowMethods.forEach((method) => {
                console.log(`Registering proxy for route: ${route}, method: ${method}, targetUrl: ${targetUrl}`);
                console.log(`Auth for route ${route}:`, auth); // 
                app[method.toLowerCase()](
                    route,
                    authenticateMiddleware(auth),
                    aclMiddleware(acl),
                    async (req, res) => {
                        console.log(`Proxy request received on route: ${route} [${method}]`);
                        try {
                            const cacheKey = `${route}:${method}:${JSON.stringify(req.query)}`;

                            // Check cache if enabled
                            if (cache?.enabled) {
                                console.log(`Checking cache for key: ${cacheKey}`);
                                const cachedData = await redis.get(cacheKey);
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

                            // Make the external API request
                            const externalResponse = await axios({
                                url: targetUrl,
                                method: method.toLowerCase(),
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
                                // Validate that responseData is an array
                                if (!Array.isArray(responseData)) {
                                    const foundArray = findArrayWithKeys(responseData, Object.keys(responseMapping));
                                    if (foundArray) {
                                        responseData = foundArray;
                                    } else {
                                        throw new Error(`Response data is not an array and does not contain keys: ${Object.keys(responseMapping)}`);
                                    }
                                }
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
                                console.log(`Caching response for key: ${cacheKey} with TTL: ${cache.ttl}`);
                                await redis.setex(cacheKey, cache.ttl, JSON.stringify(responseData));
                            }

                            res.json(responseData);
                        } catch (error) {
                            console.error(`Error in proxy endpoint for route ${route}:`, error.message);
                            res.status(500).json({ error: "Internal Server Error" });
                        }
                    }
                );
            });
        } catch (err) {
            console.error(`Failed to register proxy at index ${index}:`, err.message);
        }
    });
}

function autoloadPlugins(pluginManager) {
    const configFilePath = path.join(configDir, 'plugins.json'); // File containing plugins to load

    try {
        if (!fs.existsSync(configFilePath)) {
            console.warn(`Plugin configuration file not found at ${configFilePath}. No plugins will be loaded.`);
            return;
        }

        const pluginList = JSON.parse(fs.readFileSync(configFilePath, 'utf-8'));

        if (!Array.isArray(pluginList)) {
            console.error(`Invalid plugin configuration format. Expected an array of plugin names.`);
            return;
        }

        pluginList.forEach((pluginName) => {
            try {
                pluginManager.loadPlugin(pluginName);
                console.log(`Plugin ${pluginName} loaded successfully.`);
            } catch (error) {
                console.error(`Failed to load plugin ${pluginName}: ${error.message}`);
            }
        });
    } catch (error) {
        console.error(`Error reading or parsing plugin configuration file: ${error.message}`);
    }
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

function registerStaticRoute(app, endpoint) {
    const { route, folderPath, auth, acl } = endpoint;

    if (!route || !folderPath) {
        console.error(`Invalid or missing parameters for static route: ${JSON.stringify(endpoint)}`);
        return; // Skip invalid configuration
    }

    const middlewares = [];
    
    // Add authentication middleware if specified
    if (auth) {
        middlewares.push(authenticateMiddleware(auth));
    }

    // Add access control middleware if specified
    if (acl) {
        middlewares.push(aclMiddleware(acl));
    }

    // Serve static files
    console.log(`Registering static route: ${route} -> ${folderPath}`);
    app.use(route, cors(corsOptions), ...middlewares, express.static(folderPath));
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
        console.log(req.body);
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

  /**
 * Validates a user's password against a stored bcrypt hash.
 * Automatically detects bcrypt versions: $2a$, $2b$, $2y$
 * 
 * @param {string} plainPassword - The user's plaintext password
 * @param {string} hashedPassword - The bcrypt hashed password (from the database)
 * @returns {string} - "Pass" if valid, "Failed" if invalid
 */
function validatePassword(plainPassword, hashedPassword) {
    if (!plainPassword || !hashedPassword) {
        throw new Error("Both plainPassword and hashedPassword are required.");
    }

    // Check if the hash starts with a valid bcrypt version
    if (!hashedPassword.startsWith("$2a$") &&
        !hashedPassword.startsWith("$2b$") &&
        !hashedPassword.startsWith("$2y$")) {
        throw new Error("Invalid bcrypt version or hash format.");
    }

    // Compare the password with the stored hash
    const isMatch = bcrypt.compareSync(plainPassword, hashedPassword);

    return isMatch;
}


function registerRoutes(app, apiConfig) {
    // Connection pool for database connections
    const connectionPool = new Map();

    // Cleanup function for connection pool
    const cleanup = async () => {
        for (const [key, conn] of connectionPool.entries()) {
            try {
                await conn.end();
                connectionPool.delete(key);
            } catch (error) {
                console.error(`Error closing connection for ${key}:`, error);
            }
        }
    };

    // Handle process termination
    process.on('SIGTERM', cleanup);
    process.on('SIGINT', cleanup);

    apiConfig.forEach((endpoint, index) => {
        const { route, dbTable, dbConnection: connString, allowRead, allowWrite, keys, acl, relationships, allowMethods, cache, auth, authentication, encryption } = endpoint;
        
        // Validate required configuration
        if (!connString || !dbTable || !route) {
            console.error(`Invalid endpoint configuration at index ${index}:`, {
                hasConnection: !!connString,
                hasTable: !!dbTable,
                hasRoute: !!route
            });
            return;
        }

        // if allowRead is undefined do not validate it
        if (allowRead !== undefined && !Array.isArray(allowRead) ) {
            console.error(`Invalid Read permissions at index ${route}:`, {
                allowRead
            });
            return;
        }

        if (allowWrite !== undefined && !Array.isArray(allowWrite) ) {
            console.error(`Invalid Write permissions at index ${route}:`, {
                allowWrite
            });
            return;
        }

        // Input validation helper
        const validateInput = (input, allowedFields) => {
            if (!input || typeof input !== 'object') return false;
            return Object.keys(input).every(key => 
                allowedFields.includes(key) && 
                typeof input[key] === 'string' && 
                input[key].length < 1000
            );
        };

        // SQL injection prevention helper
        const escapeSql = (str) => {
            if (typeof str !== 'string') return str;
            return str.replace(/[\0\x08\x09\x1a\n\r"'\\\%]/g, char => {
                switch (char) {
                    case "\0": return "\\0";
                    case "\x08": return "\\b";
                    case "\x09": return "\\t";
                    case "\x1a": return "\\z";
                    case "\n": return "\\n";
                    case "\r": return "\\r";
                    case "\"":
                    case "'":
                    case "\\":
                    case "%":
                        return "\\"+char;
                    default: return char;
                }
            });
        };
        consolelog.log(endpoint);
        // Default to all methods if `allowMethods` is not specified
        const allowedMethods = allowMethods || ["GET", "POST", "PUT", "DELETE", "PATCH"];

          // Validate config structure, this is already cleaned up in the config but leaving it here for reference
        if (endpoint.routeType !== "database") {
            console.log(`Skipping proxy/dyanmic/cron at index ${index}`);
            return;
        }
        
        // A bit confusing, but this is the same as the proxy check above
        // Ideally we need to have a optimized loader. 
        //Ditto for the proxy check above
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
                        isValidPassword = validatePassword(password, user[authentication]);
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


        app.get(route, cors(corsOptions),authenticateMiddleware(auth), aclMiddleware(acl), async (req, res) => {
            try {
                console.log('Incoming GET request:', {
                    route,
                    query: req.query,
                });
        
                const connection = await getDbConnection(endpoint);
                if (!connection) {
                    console.error(`Database connection failed for ${endpoint.dbConnection}`);
                    return res.status(500).json({ error: `Database connection failed for ${endpoint.dbConnection}` });
                }
        
                // Sanitize and validate query parameters
                const sanitizedQuery = Object.fromEntries(
                    Object.entries(req.query).map(([key, value]) => [key, value.replace(/^['"]|['"]$/g, '')])
                );
        
                // Extract pagination parameters with defaults
                const limit = parseInt(sanitizedQuery.limit, 10) || 20;
                const offset = parseInt(sanitizedQuery.offset, 10) || 0;
                if (limit < 0 || offset < 0) {
                    console.error('Invalid pagination parameters:', { limit, offset });
                    return res.status(400).json({ error: 'Limit and offset must be non-negative integers' });
                }
        
                // Check for keys and build WHERE clause dynamically
                const queryKeys = endpoint.keys
                    ? endpoint.keys.filter((key) => sanitizedQuery[key] !== undefined)
                    : Object.keys(sanitizedQuery); // Use all query params if keys are not defined
                const whereClause = queryKeys
                    .map((key) => `${endpoint.dbTable}.${key} = ?`)
                    .join(' AND ');
                const params = queryKeys.map((key) => sanitizedQuery[key]);
        
                // Validate fields to select
                const requestedFields = sanitizedQuery.fields
                    ? sanitizedQuery.fields.split(',').filter((field) => endpoint.allowRead.includes(field))
                    : endpoint.allowRead;
                if (!requestedFields.length) {
                    console.error('No valid fields requested:', sanitizedQuery.fields);
                    return res.status(400).json({ error: 'No valid fields requested' });
                }
        
                const fields = requestedFields.map((field) => `${endpoint.dbTable}.${field}`).join(', ');
        
                // Process relationships
                let joinClause = '';
                let relatedFields = '';
                if (Array.isArray(endpoint.relationships)) {
                    endpoint.relationships.forEach((rel) => {
                        joinClause += ` LEFT JOIN ${rel.relatedTable} ON ${endpoint.dbTable}.${rel.foreignKey} = ${rel.relatedTable}.${rel.relatedKey}`;
                        relatedFields += `, ${rel.fields.map((field) => `${rel.relatedTable}.${field}`).join(', ')}`;
                    });
                }
        
                const queryFields = `${fields}${relatedFields}`;
        
                // Generate the SQL query and cache key
                const whereClauseString = whereClause ? `WHERE ${whereClause}` : '';
                const dataQuery = `
                    SELECT ${queryFields}
                    FROM ${endpoint.dbTable}
                    ${joinClause}
                    ${whereClauseString}
                    LIMIT ${limit} OFFSET ${offset}
                `;
                const countQuery = `
                    SELECT COUNT(*) as totalCount
                    FROM ${endpoint.dbTable}
                    ${joinClause}
                    ${whereClauseString}
                `;
                const cacheKey = `cache:${route}:${JSON.stringify(req.query)}`;
        
                // Caching logic
                if (endpoint.cache === 1) {
                    const cachedData = await redis.get(cacheKey);
                    if (cachedData) {
                        console.log('Cache hit for key:', cacheKey);
                        return res.json(JSON.parse(cachedData));
                    }
                }
        
                console.log('Cache miss or cache disabled. Executing queries.');
        
                let totalCount = 0;
                if (whereClauseString.trim() === "") {
                    try {
                        // Check if the approximate count table exists using information_schema
                        const [tables] = await connection.execute(
                            "SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
                            ['table_stats']
                        );
                        if (tables.length > 0) {
                            // Use approximate count from table_stats for large tables without filters
                            const approxQuery = "SELECT row_count as totalCount FROM table_stats WHERE table_name = ?";
                            try {
                                const [approxResult] = await connection.execute(approxQuery, [endpoint.dbTable]);
                                totalCount = approxResult[0]?.totalCount || 0;
                            } catch (err) {
                                // If error indicates that table_stats doesn't exist, fallback to exact count
                                if (err && (err.code === 'ER_NO_SUCH_TABLE' || err.message.includes("doesn't exist"))) {
                                    const [countResult] = await connection.execute(countQuery, params);
                                    totalCount = countResult[0]?.totalCount || 0;
                                } else {
                                    throw err;
                                }
                            }
                        } else {
                            // Fallback to exact count if table_stats doesn't exist
                            const [countResult] = await connection.execute(countQuery, params);
                            totalCount = countResult[0]?.totalCount || 0;
                        }
                    } catch (err) {
                        // On error, fallback to exact count
                        const [countResult] = await connection.execute(countQuery, params);
                        totalCount = countResult[0]?.totalCount || 0;
                    }
                } else {
                    // Fallback to exact count when filtering is applied
                    const [countResult] = await connection.execute(countQuery, params);
                    totalCount = countResult[0]?.totalCount || 0;
                }
        
                // Execute the data query
                const [results] = await connection.execute(dataQuery, params);
        
                // Prepare the response
                const response = {
                    data: results,
                    metadata: {
                        totalRecords: totalCount,
                        limit,
                        offset,
                        totalPages: Math.ceil(totalCount / limit),
                    },
                };
        
                // Cache the response if caching is enabled
                if (endpoint.cache === 1) {
                    console.log('Caching response for key:', cacheKey);
                    await redis.set(cacheKey, JSON.stringify(response), 'EX', 300); // Cache for 5 minutes
                }
        
                // Send the response
                res.json(response);
            } catch (error) {
                console.error(`Error in GET ${route}:`, error.stack);
                res.status(500).json({ error: error.message });
            }
        });
    
        
        // POST, PUT, DELETE endpoints (unchanged but dynamically registered based on allowMethods)
        if (allowedMethods.includes("POST")) {
            app.post(route,cors(corsOptions), authenticateMiddleware(auth), aclMiddleware(acl), async (req, res) => {
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
            app.put(`${route}`, authenticateMiddleware(auth), aclMiddleware(acl), async (req, res) => {
                const writableFields = Object.keys(req.body).filter((key) => allowWrite.includes(key));
                if (writableFields.length === 0) {
                    return res.status(400).json({ error: 'No writable fields provided' });
                }
        
                const recordKeys = keys; // The keys defined in the configuration
                const keyValues = recordKeys.map((key) => req.body[key]);
                if (keyValues.some((value) => value === undefined)) {
                    return res.status(400).json({ error: 'Missing required key fields in request body' });
                }
        
                const values = writableFields.map((key) => req.body[key]);
                const setClause = writableFields.map((key) => `${key} = ?`).join(', ');
                const whereClause = recordKeys.map((key) => `${key} = ?`).join(' AND ');
                const query = `UPDATE ${dbTable} SET ${setClause} WHERE ${whereClause}`;
        
                try {
                    const connection = await getDbConnection(endpoint);
                    await connection.execute(query, [...values, ...keyValues]);
                    res.status(200).json({ message: 'Record updated' });
                } catch (error) {
                    console.error(`Error in PUT ${route}:`, error);
                    res.status(500).json({ error: 'Internal Server Error' });
                }
            });
        }
        if (allowedMethods.includes("PATCH")) {
            app.patch(`${route}`, authenticateMiddleware(auth), aclMiddleware(acl), async (req, res) => {
                const writableFields = Object.keys(req.body).filter((key) => allowWrite.includes(key));
                if (writableFields.length === 0) {
                    return res.status(400).json({ error: 'No writable fields provided' });
                }
        
                const recordKeys = keys; // The keys defined in the configuration
                const keyValues = recordKeys.map((key) => req.body[key]);
                if (keyValues.some((value) => value === undefined)) {
                    return res.status(400).json({ error: 'Missing required key fields in request body' });
                }
        
                const values = writableFields.map((key) => req.body[key]);
                const setClause = writableFields.map((key) => `${key} = ?`).join(', ');
                const whereClause = recordKeys.map((key) => `${key} = ?`).join(' AND ');
                const query = `UPDATE ${dbTable} SET ${setClause} WHERE ${whereClause}`;
        
                try {
                    const connection = await getDbConnection(endpoint);
                    await connection.execute(query, [...values, ...keyValues]);
                    res.status(200).json({ message: 'Record partially updated' });
                } catch (error) {
                    console.error(`Error in PATCH ${route}:`, error);
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
                    res.status(200).json({ message: 'Record deleted' });
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

        //DSLParser.autoRegisterFromContext(globalContext);

        const dslText = fs.readFileSync(rulesConfigPath, 'utf-8');
        
        // Use RuleEngine's fromDSL to initialize the engine properly
        const ruleEngineInstance = RuleEngine.fromDSL(dslText, globalContext);
        if (ruleEngine instanceof RuleEngine) {
            // Reload rules in the existing rule engine instance
            ruleEngine.reloadRules(ruleEngineInstance.rules);
        } else {
            // Initialize the rule engine with the parsed rules
            ruleEngine = ruleEngineInstance;
        }
        console.log(ruleEngine);      
        consolelog.log('Business rules initialized successfully.');
    } catch (error) {
        console.error('Failed to initialize business rules:', error.message);        
    }
}

// Global error handlers with enhanced logging
process.on('unhandledRejection', (reason, promise) => {
    try {
        const consolelog = require('./modules/logger');
        consolelog.error('Unhandled Rejection:', {
            reason: reason instanceof Error ? reason.stack : reason,
            promise: promise
        });
    } catch (error) {
        console.error('Failed to log unhandled rejection:', error);
    }
});

process.on('uncaughtException', (error) => {
    try {
        const consolelog = require('./modules/logger');
        consolelog.error('Uncaught Exception:', {
            error: error.stack || error.message,
            timestamp: new Date().toISOString()
        });
    } catch (loggingError) {
        console.error('Failed to log uncaught exception:', loggingError);
        console.error('Original error:', error);
    }
});

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
        this.pluginDir = path.resolve(pluginDir);
        this.server = server;
        this.plugins = new Map(); // Track plugins by name
        this.dependencyManager = dependencyManager;
        
        this.publisherRedis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
        this.subscriberRedis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
        if(process.env.PLUGIN_MANAGER === 'network') {
            this.serverId = process.env.SERVER_ID;
            if (!this.serverId) {
                throw new Error('SERVER_ID environment variable is required.');
            }

            console.log(`Server ID: ${this.serverId}`);
        }
        this.subscribeToPluginEvents();
    }

    loadModule(moduleName) {
        // Add the server path to the module name        
        return require(moduleName);
      }
      
    /**
     * Load a plugin and broadcast it (if in network mode).
     */
    async loadPlugin(pluginName, broadcast = true) {
        const pluginPath = path.join(this.pluginDir, `${pluginName}.js`);
    
        if (this.plugins.has(pluginName)) {
            console.warn(`Plugin ${pluginName} is already loaded.`);
            return;
        }
    
        try {
            const pluginCode = fs.readFileSync(pluginPath, 'utf-8');
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
    
            const pluginHash = this.getHash(pluginCode);
    
            this.plugins.set(pluginName, { instance: plugin, routes: registeredRoutes, hash: pluginHash });
            console.log(`Plugin ${pluginName} loaded successfully.`);
    
            if (process.env.PLUGIN_MANAGER === 'network' && broadcast) {
                await this.publisherRedis.hset(`${PLUGIN_CODE_KEY}${pluginName}`, {
                    code: Buffer.from(pluginCode).toString('base64'),
                });
    
                await this.publisherRedis.publish(
                    PLUGIN_EVENT_CHANNEL,
                    JSON.stringify({ action: 'load', pluginName, serverId: this.serverId })
                );
                console.log(`Broadcasted load event for plugin: ${pluginName}`);
            }
    
            return `Plugin ${pluginName} loaded successfully.`;
        } catch (error) {
            console.error(`Failed to load plugin ${pluginName}:`, error.message);
            delete require.cache[require.resolve(pluginPath)];
            this.plugins.delete(pluginName);
            return `Failed to load plugin ${pluginName}: ${error.message}`;
        }
    }
    

    /**
     * Unload a plugin and broadcast it (if in network mode).
     */
    async unloadPlugin(pluginName, broadcast = true) {
        if (!this.plugins.has(pluginName)) {
            console.warn(`Plugin ${pluginName} is not loaded.`);
            return;
        }
    
        const { instance: plugin, routes } = this.plugins.get(pluginName);
        try {
            if (plugin.cleanup) {
                console.log(`Cleaning up ${pluginName}...`);
                plugin.cleanup();
            }
    
            routes.forEach(({ method, path }) => {
                const stack = this.server.app._router.stack;
                for (let i = 0; i < stack.length; i++) {
                    const layer = stack[i];
                    if (layer.route && layer.route.path === path && layer.route.methods[method]) {
                        stack.splice(i, 1);
                        console.log(`Unregistered route ${method.toUpperCase()} ${path}`);
                    }
                }
            });
    
            delete require.cache[require.resolve(path.join(this.pluginDir, `${pluginName}.js`))];
            this.plugins.delete(pluginName);
    
            console.log(`Plugin ${pluginName} unloaded successfully.`);
    
            if (process.env.PLUGIN_MANAGER === 'network' && broadcast) {
                await this.publisherRedis.publish(
                    PLUGIN_EVENT_CHANNEL,
                    JSON.stringify({ action: 'unload', pluginName, serverId: this.serverId })
                );
                console.log(`Broadcasted unload event for plugin: ${pluginName}`);
            }
        } catch (error) {
            console.error(`Error unloading plugin ${pluginName}:`, error.message);
        }
    }

    subscribeToPluginEvents() {
        if (process.env.PLUGIN_MANAGER !== 'network') {
            console.log('Plugin manager is in local mode. No subscription to Redis events.');
            return;
        }
    
        this.subscriberRedis.subscribe(PLUGIN_EVENT_CHANNEL, (err) => {
            if (err) {
                console.error(`Failed to subscribe to plugin events: ${err.message}`);
            } else {
                console.log(`Subscribed to plugin events on channel ${PLUGIN_EVENT_CHANNEL}.`);
            }
        });
    
        this.subscriberRedis.on('message', async (channel, message) => {
            if (channel !== PLUGIN_EVENT_CHANNEL) return;
        
            console.log(`Received message on channel: ${channel}`);
            console.log(`Message content: ${message}`);
        
            try {
                const { action, pluginName, serverId } = JSON.parse(message);
        
                // Ignore messages originating from the current server
                if (serverId === this.serverId) {
                    console.log(`Ignoring message from self (Server ID: ${serverId}).`);
                    return;
                }
        
                if (action === 'load') {
                    console.log(`Processing load event for plugin: ${pluginName}`);
                    await this.loadPlugin(pluginName, false); // Do not rebroadcast
                } else if (action === 'unload') {
                    console.log(`Processing unload event for plugin: ${pluginName}`);
                    await this.unloadPlugin(pluginName, false); // Do not rebroadcast
                } else {
                    console.warn(`Unknown action: ${action}`);
                }
            } catch (error) {
                console.error(`Failed to process message: ${error.message}`);
            }
        });
    }
    

    async loadPluginFromRedisIfDifferent(pluginName) {
        try {
            const pluginData = await this.publisherRedis.hgetall(`${PLUGIN_CODE_KEY}${pluginName}`);
            if (!pluginData.code) {
                throw new Error(`No code found for plugin ${pluginName} in Redis.`);
            }

            const pluginCode = Buffer.from(pluginData.code, 'base64').toString('utf-8');
            const pluginHash = this.getHash(pluginCode);

            if (this.plugins.has(pluginName)) {
                const currentPluginHash = this.plugins.get(pluginName).hash;
                if (currentPluginHash === pluginHash) {
                    console.log(`Plugin ${pluginName} is already loaded with the same code. Skipping load.`);
                    return;
                } else {
                    console.log(`Plugin ${pluginName} code has changed. Reloading.`);
                    this.unloadPlugin(pluginName);
                }
            }

            const tempPath = path.join(this.pluginDir, `${pluginName}.js`);
            fs.writeFileSync(tempPath, pluginCode, 'utf-8');

            await this.loadPlugin(pluginName);

            this.plugins.get(pluginName).hash = pluginHash;
        } catch (error) {
            console.error(`Failed to load plugin ${pluginName} from Redis:`, error.message);
        }
    }

    validatePlugin(plugin) {
        const requiredMethods = ['initialize'];
        return requiredMethods.every((method) => typeof plugin[method] === 'function');
    }

    getHash(code) {
        return crypto.createHash('sha256').update(code, 'utf8').digest('hex');
    }

    close() {
        this.publisherRedis.disconnect();
        this.subscriberRedis.disconnect();
    }
}

class DependencyManager {
    constructor() {
        this.dependencies = {};
        this.context = globalContext; 
    }

    loadModule(moduleName) {
        // Maybe do some logic to point to your server’s node_modules
        return require(moduleName);
    }

    addDependency(name, instance) {
        this.dependencies[name] = instance;
    }

    getDependencies() {
        return { ...this.dependencies, context: this.context , customRequire: this.loadModule, process: process };
    }

    extendContext(key, value) {
        this.context[key] = value;
    }
}

async function handleBuildCommand() {
    try {
        console.log('Executing build command...');
        await buildApiConfigFromDatabase();
        console.log('Build command completed successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Build command failed:', error);
        process.exit(1);
    }
}

class Adaptus2Server {
    constructor({ port = 3000, configPath = './config/apiConfig.json', pluginDir = './plugins' }) {
        // Initialize API Analytics and DevTools
        this.apiAnalytics = new APIAnalytics();
        this.devTools = new DevTools();
        // Create HTTP server instance
        this.httpServer = http.createServer();
        this.port = port;
        this.configPath = configPath;
        this.pluginDir = pluginDir;
        this.app = express();
        this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
        
        // Attach Express app to HTTP server
        this.httpServer.on('request', this.app);
        
        // Initialize WebSocket server
        this.wss = new WebSocket.Server({ server: this.httpServer });
        this.setupWebSocket();
        this.apiConfig = apiConfig;
        this.categorizedConfig = categorizedConfig;
        this.businessRules = new BusinessRules();
        this.dependencyManager = new DependencyManager();
        this.pluginManager = new PluginManager(this.pluginDir, this, this.dependencyManager);
        this.socketServer = null;
        // Optional modules
        this.chatModule = null;
        this.paymentModule = null;
        this.streamingServer = null;
        this.app.use(middleware);
    }

    setupSocketServer() {
        this.socketServer = net.createServer((socket) => {
            console.log("CLI client connected.");

            socket.on("data", async (data) => {
                const input = data.toString().trim();
                const [command, ...args] = input.split(" ");

                try {
                    switch (command) {
                        case "requestLog":
                            const requestId = args[0];
                            // Look up complete log
                            const log = await requestLogger.getRequestLog(requestId);
                            socket.write(JSON.stringify(log));
                            break;
                        case "SHUTDOWN":
                            console.log("Shutting down server...");
                            await this.shutdown();
                            break;
                        case "userGenToken":
                            if (args.length < 2) {
                                socket.write("Usage: userGenToken <username> <acl>\n");
                            } else {
                                const [username, acl] = args;
                                try {
                                    // Generate the JWT
                                    const payload = { username, acl };
                                    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
    
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
                                    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
    
                                    socket.write(`Generated app token:\n${token}\n`);
                                } catch (error) {
                                    console.error("Error generating app token:", error.message);
                                    socket.write(`Error generating app token: ${error.message}\n`);
                                }
                            }
                            break;                               
                        case "configReload":
                            try {                               
                                consolelog.log('Reloading configuration...');
                                initializeRules();
                                this.apiConfig = await loadConfig();
                                consolelog.log(this.apiConfig);
                                this.categorizedConfig = categorizeApiConfig(this.apiConfig);  
                                // Clear existing routes
                                this.app._router.stack = this.app._router.stack.filter((layer) => {
                                    // Keep layers that are not associated with a route
                                    if (!layer.route) return true;

                                    // Check if the route is part of databaseRoutes
                                    return !this.categorizedConfig.databaseRoutes.some((routeConfig) => {
                                        return layer.route.path === routeConfig.route;
                                    });
                                });                              
                                registerRoutes(this.app, this.categorizedConfig.databaseRoutes); 
                                if (PLUGIN_MANAGER === 'network') {
                                    await broadcastConfigUpdate(this.apiConfig, this.categorizedConfig, globalContext);
                                    subscribeToConfigUpdates((updatedConfig) => {
                                        this.apiConfig = updatedConfig.apiConfig;
                                        this.categorizedConfig = updatedConfig.categorizedConfig;
                                        globalContext.resources = updatedConfig.globalContext.resources || {};
                                        console.log('Configuration updated from cluster.');
                                    });
                                }                                                              
                                consolelog.log("API config reloaded successfully.");
                                socket.write("API config reloaded successfully.");
                            } catch (error) {
                                consolelog.error(`Error reloading API config: ${error.message}`);
                                socket.write("Error reloading API config: ${error.message}");
                            }
                            break;
                        case "listPlugins":
                            try {
                                const plugins = fs.readdirSync(this.pluginDir)
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
                            const actions = Object.keys(globalContext.actions);
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
                            const routes = this.app._router.stack
                                .filter((layer) => layer.route)
                                .map((layer) => ({
                                    path: layer.route.path,
                                    methods: Object.keys(layer.route.methods).join(", "),
                                }));
                            socket.write(`Registered routes: ${JSON.stringify(routes, null, 2)}\n`);
                            break;
                        case "exit":
                            socket.write("Goodbye!\n");
                            socket.end();
                            break;
                        case "validate-config":
                            try {
                                if (!this.devTools) {
                                    this.devTools = new DevTools();
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
                                const result = await this.devTools.validateConfig(configPath, schema);
                                
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
                            socket.write("Available commands:userGenToken, appGenToken, load, unload, reload, reloadall, list, routes, configReload, listActions, validate-config, exit.\n");               
                    }
                } catch (error) {
                    socket.write(`Error: ${error.message}\n`);
                }
            });

            socket.on("end", () => {
                console.log("CLI client disconnected.");
            });
        });

        const SOCKET_CLI_PORT = process.env.SOCKET_CLI_PORT || 5000;
        this.socketServer.listen(SOCKET_CLI_PORT, "localhost", () => {
            console.log("Socket CLI server running on localhost"+SOCKET_CLI_PORT);
        });
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
        
    

    async initializeTables() {
        console.log('Initializing tables...');
        
        // Create a connection pool for better performance
        const connectionPool = new Map();
        
        try {
            for (const endpoint of this.apiConfig) {
                const { dbType, dbTable, columnDefinitions, dbConnection: connString } = endpoint;
                consolelog.log("Working on endpoint", endpoint);

                // Input validation
                if (!dbType || !dbTable || !columnDefinitions) {
                    console.warn(`Skipping invalid endpoint configuration:`, {
                        dbType,
                        dbTable,
                        hasColumnDefs: !!columnDefinitions
                    });
                    continue;
                }

                // Validate database type
                if (!['mysql', 'postgres'].includes(dbType)) {
                    console.warn(`Skipping ${dbTable}: Unsupported database type ${dbType}`);
                    continue;
                }

                // Reuse existing connection from pool if available
                let connection = connectionPool.get(connString);
                if (!connection) {
                    connection = await getDbConnection(endpoint);
                    if (!connection) {
                        console.error(`Failed to connect to database for ${connString}`);
                        continue;
                    }
                    connectionPool.set(connString, connection);
                }
    
                // Validate column definitions
                if (!Object.keys(columnDefinitions).length) {
                    console.warn(`Skipping ${dbTable}: Empty column definitions`);
                    continue;
                }

                // Validate column names and types
                const invalidColumns = Object.entries(columnDefinitions).filter(([name, type]) => {
                    return !name.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/) || !type.match(/^[a-zA-Z0-9\s()]+$/);
                });

                if (invalidColumns.length > 0) {
                    console.error(`Invalid column definitions in ${dbTable}:`, invalidColumns);
                    continue;
                }
    
                try {
                    // Check if the table exists using a transaction
                    await connection.beginTransaction();

                    // Check if the table exists with proper error handling
                    let tableExists = false;
                    try {
                        if (dbType === 'mysql') {
                            const [rows] = await connection.execute(
                                `SELECT COUNT(*) AS count FROM information_schema.tables 
                                 WHERE table_schema = DATABASE() AND table_name = ?`,
                                [dbTable]
                            );
                            tableExists = rows[0].count > 0;
                        } else if (dbType === 'postgres') {
                            const [rows] = await connection.execute(
                                `SELECT COUNT(*) AS count FROM information_schema.tables 
                                 WHERE table_name = $1`,
                                [dbTable]
                            );
                            tableExists = rows[0].count > 0;
                        }
                    } catch (error) {
                        console.error(`Error checking table existence for ${dbTable}:`, error);
                        await connection.rollback();
                        continue;
                    }
    
                    if (tableExists) {
                        console.log(`Table ${dbTable} already exists. Skipping creation.`);
                        await connection.commit();
                        continue;
                    }
    
                    // Build and validate the CREATE TABLE query
                    const columns = Object.entries(columnDefinitions)
                        .map(([column, type]) => `${column} ${type}`)
                        .join(', ');
        
                    const createTableQuery = `CREATE TABLE ${dbTable} (${columns})`;
                    console.log(`Executing query: ${createTableQuery}`);

                    try {
                        await connection.execute(createTableQuery);
                        await connection.commit();
                        console.log(`Table ${dbTable} initialized successfully.`);
                    } catch (error) {
                        await connection.rollback();
                        console.error(`Error creating table ${dbTable}:`, error);
                        
                        // Provide more detailed error information
                        if (error.code === 'ER_DUP_FIELDNAME') {
                            console.error('Duplicate column name detected');
                        } else if (error.code === 'ER_PARSE_ERROR') {
                            console.error('SQL syntax error in CREATE TABLE statement');
                        }
                    }
                } catch (error) {
                    console.error(`Error in table initialization process for ${dbTable}:`, error);
                    if (connection) {
                        await connection.rollback().catch(console.error);
                    }
                }
            }
        } finally {
            // Close all connections in the pool
            for (const connection of connectionPool.values()) {
                try {
                    await connection.end();
                } catch (error) {
                    console.error('Error closing database connection:', error);
                }
            }
        }
    }
    
  

        // Reload Configuration
    setupReloadHandler(configFile) {
        process.on('SIGHUP', async () => {           
            try {
                consolelog.log('Reloading configuration...');
                this.apiConfig = await loadConfig();                
                this.categorizedConfig = categorizeApiConfig(this.apiConfig);                                
                registerRoutes(this.app, this.categorizedConfig.databaseRoutes);                                                               
                console.log("API config reloaded successfully.");                
            } catch (configError) {
                console.error('Failed to load API configuration:', configError.message);                
            }
        });
    }


    registerMiddleware() {
        // API Analytics middleware
        this.app.use(this.apiAnalytics.middleware());

        // Security middleware
        this.app.use(helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    scriptSrc: ["'self'", "'unsafe-inline'"],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    imgSrc: ["'self'", "data:", "https:"],
                }
            },
            xssFilter: true,
            noSniff: true,
            referrerPolicy: { policy: 'same-origin' }
        }));

        // Request parsing with size limits
        this.app.use(express.json({ limit: MAX_REQUEST_SIZE }));
        this.app.use(express.urlencoded({ extended: true, limit: MAX_REQUEST_SIZE }));
        
        // Response compression
        this.app.use(compression());

        // Logging middleware with enhanced error handling
        this.app.use(morgan('combined', {
            skip: (req, res) => res.statusCode < 400, // Only log errors
            stream: {
                write: message => {
                    try {
                        const consolelog = require('./modules/logger');
                        consolelog.error(message.trim());
                    } catch (error) {
                        console.error('Failed to log request:', error);
                    }
                }
            }
        }));

        // Error handling for malformed JSON
        this.app.use((err, req, res, next) => {
            if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
                return res.status(400).json({ 
                    error: 'Invalid JSON payload',
                    details: process.env.NODE_ENV === 'development' ? err.message : undefined
                });
            }
            next(err);
        });

        // Rate limiting
        const rateLimit = new RateLimit(this.apiConfig, this.redis);
        this.app.use(rateLimit.middleware());

        // Rule engine middleware
        consolelog.log('Rule Engine for Middleware', ruleEngine);
        const ruleEngineMiddleware = new RuleEngineMiddleware(ruleEngine, this.dependencyManager);
        this.app.use(ruleEngineMiddleware.middleware());

        // Global error handler with enhanced logging
        this.app.use((err, req, res, next) => {
            try {
                const consolelog = require('./modules/logger');
                consolelog.error('Unhandled error:', {
                    error: err.stack || err.message,
                    url: req.url,
                    method: req.method,
                    timestamp: new Date().toISOString(),
                    requestId: req.id,
                    userId: req.user?.id,
                    body: process.env.NODE_ENV === 'development' ? req.body : undefined
                });
            } catch (loggingError) {
                console.error('Failed to log error:', loggingError);
                console.error('Original error:', err);
            }

            res.status(err.status || 500).json({
                error: 'Internal Server Error',
                message: process.env.NODE_ENV === 'development' ? err.message : undefined,
                requestId: req.id
            });
        });
        this.app.use(requestLogger.middleware());
    }

    
    // to minimized reload time we splice the config before sending it to the different functions.
    registerRoutes() {       
        registerRoutes(this.app, this.categorizedConfig.databaseRoutes);
    }

    registerProxyEndpoints() {
        registerProxyEndpoints(this.app, this.categorizedConfig.proxyRoutes);
    }

    registerDynamicEndpoints() {                
        this.categorizedConfig.dynamicRoutes.forEach((route) => DynamicRouteHandler.registerDynamicRoute(this.app, route));
    }

    registerFileUploadEndpoints() { 
        this.categorizedConfig.fileUploadRoutes.forEach((route) => registerFileUploadEndpoint(this.app, route));
    }


    registerStaticEndpoints() { 
        this.categorizedConfig.staticRoutes.forEach((route) => registerStaticRoute(this.app, route));
    }

    async setupGraphQL() {
        if (!graphqlDbType || !graphqlDbConnection) return;

        var { schema, rootResolvers } = generateGraphQLSchema(this.categorizedConfig.databaseRoutes);
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
        // Initialize CMS if enabled
        if (process.env.ENABLE_CMS === 'true') {
            try {
                this.cmsManager = new CMSManager(globalContext, {
                    dbType: process.env.DEFAULT_DBTYPE,
                    dbConnection: process.env.DEFAULT_DBCONNECTION
                });
                console.log('CMS module initialized successfully');
            } catch (error) {
                console.error('Failed to initialize CMS module:', error.message);
            }
        }

        // Initialize Firebase Service
        try {
            new FirebaseService(); // Initialize Firebase
            console.log('Firebase service initialized successfully');
        } catch (error) {
            console.error('Failed to initialize Firebase service:', error.message);
        }

        // Initialize Ollama Module
        try {
            ollamaModule.initialize().then(() => {
                console.log('Ollama module initialized successfully');
                ollamaModule.setupRoutes(app);
            }).catch(error => {
                console.error('Failed to initialize Ollama module:', error.message);
            });
        } catch (error) {
            console.error('Failed to setup Ollama module:', error.message);
        }

        // Initialize Chat Module
        if(process.env.CHAT_SERVER_PORT){
            const chat_port = process.env.CHAT_SERVER_PORT;
            try {
                const corsOptions = {  origin: process.env.CORS_ORIGIN,  methods : process.env.CORS_METHODS };
                const httpServer = require('http').createServer(app); // Reuse server
                this.chatModule = new ChatModule(httpServer, app, JWT_SECRET, this.apiConfig, corsOptions);
                this.chatModule.start();
                httpServer.listen(chat_port, () => {
                    console.log('Chat running on http://localhost:' + chat_port);
                });
                consolelog.log('Chat module initialized.');
            } catch (error) {
                console.error('Failed to initialize Chat Module:', error.message);
            }
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

    async synchronizePluginsOnStartup() {
        if (PLUGIN_MANAGER === 'network') {
            console.log(`Synchronizing plugins for cluster "${CLUSTER_NAME}"...`);
            try {
                const keys = await redis.keys(`${PLUGIN_FILE_PREFIX}*`);
                for (const key of keys) {
                    const name = key.replace(PLUGIN_FILE_PREFIX, '');
                    const pluginData = await redis.hgetall(key);
    
                    if (pluginData.code && pluginData.config) {
                        const pluginCode = Buffer.from(pluginData.code, 'base64').toString('utf-8');
                        const pluginConfig = JSON.parse(pluginData.config);
    
                        // Dynamically load the plugin
                        loadPluginNetwork(name, pluginCode, pluginConfig);
                        console.log(`Plugin "${name}" synchronized successfully in cluster "${CLUSTER_NAME}".`);
                    }
                }
            } catch (err) {
                console.error(`Error during plugin synchronization in cluster "${CLUSTER_NAME}":`, err);
            }
        }
    }
    subscribeToPluginUpdates() {
        if (process.env.PLUGIN_MANAGER !== 'network') return;
    
        console.log(`Subscribing to plugin updates for cluster "${process.env.CLUSTER_NAME}"...`);
        this.redis.subscribe(`${process.env.CLUSTER_NAME}:plugins:update`, (err) => {
            if (err) {
                console.error(`Failed to subscribe to plugin updates: ${err.message}`);
            } else {
                console.log(`Subscribed to plugin updates for cluster "${process.env.CLUSTER_NAME}".`);
            }
        });
    
        this.redis.on('message', async (channel, message) => {
            if (channel === `${process.env.CLUSTER_NAME}:plugins:update`) {
                await this.handlePluginUpdate(message);
            }
        });
    }
    
    
    // Set up WebSocket server and handlers
    setupWebSocket() {
        // Store connected clients
        const clients = new Set();

        // Handle new WebSocket connections
        this.wss.on('connection', (ws, req) => {
            // Add client to set
            clients.add(ws);
            
            // Handle client messages
            ws.on('message', async (message) => {
                try {
                    const data = JSON.parse(message);
                    // Handle different message types
                    switch (data.type) {
                        case 'subscribe':
                            ws.subscribedChannels = ws.subscribedChannels || new Set();
                            ws.subscribedChannels.add(data.channel);
                            break;
                        case 'unsubscribe':
                            if (ws.subscribedChannels) {
                                ws.subscribedChannels.delete(data.channel);
                            }
                            break;
                        default:
                            console.warn('Unknown message type:', data.type);
                    }
                } catch (error) {
                    console.error('WebSocket message error:', error);
                    ws.send(JSON.stringify({
                        type: WS_EVENTS.ERROR,
                        error: 'Invalid message format'
                    }));
                }
            });

            // Handle client disconnection
            ws.on('close', () => {
                clients.delete(ws);
            });

            // Send initial connection success message
            ws.send(JSON.stringify({
                type: 'connected',
                timestamp: new Date().toISOString()
            }));
        });

        // Subscribe to Redis channels
        redisSubscriber.subscribe(
            REDIS_CHANNELS.DB_CHANGES,
            REDIS_CHANNELS.CACHE_UPDATES,
            REDIS_CHANNELS.CONFIG_CHANGES
        );

        // Handle Redis messages
        redisSubscriber.on('message', (channel, message) => {
            // Broadcast to relevant WebSocket clients
            const data = JSON.parse(message);
            clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN &&
                    (!client.subscribedChannels || client.subscribedChannels.has(channel))) {
                    client.send(JSON.stringify({
                        type: this.getEventTypeForChannel(channel),
                        channel,
                        data
                    }));
                }
            });
        });
    }

    // Helper to map Redis channels to WebSocket event types
    getEventTypeForChannel(channel) {
        switch (channel) {
            case REDIS_CHANNELS.DB_CHANGES:
                return WS_EVENTS.DATABASE_CHANGE;
            case REDIS_CHANNELS.CACHE_UPDATES:
                return WS_EVENTS.CACHE_INVALIDATED;
            case REDIS_CHANNELS.CONFIG_CHANGES:
                return WS_EVENTS.CONFIG_UPDATED;
            default:
                return 'unknown';
        }
    }

    // Method to publish database changes
    async publishDatabaseChange(table, operation, data) {
        try {
            await redisPublisher.publish(REDIS_CHANNELS.DB_CHANGES, JSON.stringify({
                table,
                operation,
                data,
                timestamp: new Date().toISOString()
            }));
        } catch (error) {
            console.error('Error publishing database change:', error);
        }
    }

    // Method to publish cache updates
    async publishCacheInvalidation(key, reason) {
        try {
            await redisPublisher.publish(REDIS_CHANNELS.CACHE_UPDATES, JSON.stringify({
                key,
                reason,
                timestamp: new Date().toISOString()
            }));
        } catch (error) {
            console.error('Error publishing cache invalidation:', error);
        }
    }

    // Register analytics routes
    registerAnalyticsRoutes() {
        const analyticsRoutes = new AnalyticsRoutes(this.apiAnalytics);
        this.app.use('/analytics', authenticateMiddleware(true), analyticsRoutes.getRouter());
    }

    // Register development tools routes (only in development environment)
    registerDevTools() {
        if (process.env.NODE_ENV === 'development') {
            const devToolsRoutes = new DevToolsRoutes(this.devTools);
            this.app.use('/dev', authenticateMiddleware(true), devToolsRoutes.getRouter());
            console.log('Development tools enabled and routes registered');
        }
    }

    async start(callback) {
        process.on('uncaughtException', (error) => {
            logger.error('Uncaught Exception:', error);
            // Perform graceful shutdown
            this.shutdown(1);
        });

        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
            // Perform graceful shutdown
            this.shutdown(1);
        });

        try {
            // Extract command-line arguments
            const args = process.argv.slice(2);
    
            // Check for valid parameters
            if (args.length > 0 && !args.includes('--build') && !args.includes('--init') && !args.includes('--generate-swagger')) {
                consolelog.log(
                    'Error: Invalid parameters provided. Please use one of the following:\n' +
                    '  --build   Build API configuration from the database.\n' +
                    '  --init    Initialize database tables.\n' +
                    '  --generate-swagger   Generate Swagger documentation.\n' +
                    'Or start the server without parameters to run normally.'
                );
                process.exit(1); // Exit with an error code
            }
            if (process.argv.includes('--build')) {
                await handleBuildCommand();
                exit();
            }

    
            // Handle the --generate-swagger flag
            if (args.includes('--generate-swagger')) {
                consolelog.log('Generating Swagger documentation...');
                const inputConfigPath = path.resolve(process.cwd(), './config/apiConfig.json');
                const outputSwaggerPath = path.resolve(process.cwd(), './swagger.json');
    
                try {
                    const apiConfig = JSON.parse(fs.readFileSync(inputConfigPath, 'utf-8'));
                    generateSwaggerDoc(apiConfig, outputSwaggerPath);
                    consolelog.log('Swagger documentation generated successfully. Exiting...');
                    process.exit(0);
                } catch (error) {
                    console.error(`Error generating Swagger: ${error.message}`);
                    process.exit(1);
                }
            }
    
            // Handle the --init flag
            if (args.includes('--init')) {
                consolelog.log('Initializing database tables...');
                await this.initializeTables();
                consolelog.log('Table initialization complete. Exiting...');
                process.exit(0);
            }
    
            // Load the API configuration
            this.apiConfig = await loadConfig();
            this.categorizedConfig = categorizeApiConfig(this.apiConfig);
            consolelog.log("Categorized config initialized:", this.categorizedConfig);
            // Broadcast initial configuration in network mode
            if (PLUGIN_MANAGER === 'network') {
                await broadcastConfigUpdate(this.apiConfig, this.categorizedConfig, globalContext);
                subscribeToConfigUpdates((updatedConfig) => {
                    this.apiConfig = updatedConfig.apiConfig;
                    this.categorizedConfig = updatedConfig.categorizedConfig;
                    globalContext.resources = updatedConfig.globalContext.resources || {};
                    console.log('Configuration updated from cluster.');
                });
            }
    
            // Set up other parts of the server
            this.setupDependencies();
            this.setupPluginLoader();
            autoloadPlugins(this.pluginManager);
            this.registerAnalyticsRoutes();
            this.registerDevTools();
            setupRag(this.apiConfig);
            extendContext();
            initializeRules();
            this.registerMiddleware();
            this.registerRoutes();
            this.registerProxyEndpoints();
            this.registerDynamicEndpoints();
            this.registerFileUploadEndpoints();
            this.registerStaticEndpoints();
            this.initializeOptionalModules(this.app);
            await this.setupGraphQL();
           
            this.setupReloadHandler(this.configPath);
            if(process.env.SOCKET_CLI) {
                this.setupSocketServer(); // Start the socket server
            }
  
            // Synchronize plugins and subscribe to updates
            await this.synchronizePluginsOnStartup();
            this.subscribeToPluginUpdates();

            
            // Start the HTTP server (which includes WebSocket)
            this.httpServer.listen(this.port, () => {
                consolelog.log(`API server running on port ${this.port} (HTTP/WebSocket)`);
                if (callback) callback();
            });
    
            return this.app;
        } catch (error) {
            console.error('Failed to start server:', error);
        }
    }
    
   

    async shutdown(code = 0) {
        const consolelog = require('./modules/logger');
        try {
            consolelog.log('Initiating graceful shutdown...');

            // Cleanup CMS if initialized
            if (this.cmsManager) {
                try {
                    // await this.cmsManager.cleanup(); To be implemented.
                    consolelog.log('CMS module cleaned up successfully');
                } catch (error) {
                    consolelog.error('Error cleaning up CMS module:', error);
                }
            }

            // Close WebSocket server
            if (this.wss) {
                await new Promise((resolve) => {
                    this.wss.close(() => {
                        consolelog.log('WebSocket server closed');
                        resolve();
                    });
                });
            }
            
            // Close all connections
            const connections = await Promise.allSettled([
                this.redis.quit(),
                this.publisherRedis?.quit(),
                this.subscriberRedis?.quit(),
                redisPublisher.quit(),
                redisSubscriber.quit()
            ]);

            connections.forEach((result, index) => {
                if (result.status === 'rejected') {
                    consolelog.error(`Failed to close connection ${index}:`, result.reason);
                }
            });

            // Close the server
            if (this.server) {
                await new Promise((resolve) => {
                    this.server.close(resolve);
                });
            }

            // Close socket server if it exists
            if (this.socketServer) {
                await new Promise((resolve) => {
                    this.socketServer.close(resolve);
                });
            }

            consolelog.log('All connections closed successfully');
            consolelog.log('Graceful shutdown completed');

            // Ensure all logs are written before cleanup
            await new Promise(resolve => setTimeout(resolve, 500));

            // Cleanup logger as the final step
            if (consolelog.cleanup) {
                await consolelog.cleanup();
            }

            // Small delay to ensure logger cleanup is complete
            await new Promise(resolve => setTimeout(resolve, 100));
            
            process.exit(code);
        } catch (error) {
            // Log error before cleanup
            consolelog.error('Error during shutdown:', error);
            
            // Ensure error is logged before cleanup
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Cleanup logger
            if (consolelog.cleanup) {
                await consolelog.cleanup();
            }
            
            process.exit(1);
        }
    }
}




// Export the FlexAPIServer class
module.exports = { Adaptus2Server, authenticateMiddleware, aclMiddleware };

// Example: Create a new server instance and start it
if (require.main === module) {

    // Proceed to initialize and start the server
    const { Adaptus2Server } = require('./server');
    const server = new Adaptus2Server({
        port: process.env.PORT || 3000,
        configPath: './config/apiConfig.json',
    });

    server.start();

}
