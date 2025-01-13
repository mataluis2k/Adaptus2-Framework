const express = require('express');
const cors = require('cors'); // Import the cors middleware
const fs = require('fs');
const path = require('path');
const morgan = require('morgan');
const Redis = require('ioredis');
const crypto = require('crypto');
const multer = require('multer');
const net = require("net");
require('dotenv').config({ path: __dirname + '/.env' });
const jwt = require('jsonwebtoken');
const axios = require('axios');
// Import other modules
const { loadConfig, apiConfig, categorizedConfig, categorizeApiConfig } = require('./modules/apiConfig');
const { getDbConnection, extendContext } = require(path.join(__dirname, '/modules/db'));
// const buildApiConfigFromDatabase = require('./modules/buildConfig');
const BusinessRules = require('./modules/business_rules');
const MLAnalytics = require('./modules/ml_analytics');

const RateLimit = require('./modules/rate_limit');
const generateGraphQLSchema = require('./modules/generateGraphQLSchema');
const { createHandler } = require('graphql-http/lib/use/express');
const ChatModule = require('./modules/chatModule'); // Chat Module
const generateSwaggerDoc = require('./modules/generateSwaggerDoc');
const StreamingServer = require('./modules/streamingServer'); // Streaming Module
const RuleEngine = require('./modules/ruleEngine');  
const DynamicRouteHandler = require('./modules/DynamicRouteHandler');

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

// Initialize a global context for request storage
global.requestContext = new Map();

var newRules = null;
const { passport, authenticateOAuth } = require('./middleware/oauth.js');
const { config } = require('dotenv');


const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const JWT_SECRET = process.env.JWT_SECRET || 'IhaveaVeryStrongSecret';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '1h';

consolelog.log('Current directory:', __dirname);

const graphqlDbType = process.env.GRAPHQL_DBTYPE;
const graphqlDbConnection = process.env.GRAPHQL_DBCONNECTION;

const mlAnalytics = new MLAnalytics();


const { globalContext, middleware } = require('./modules/context');
const e = require('express');

globalContext.actions.log = (ctx, action) => {
    let message = null; // Declare message in the outer scope

    try {
        console.log(action);

        if (action.message) {
            message = action.message; // Assign message here
            // Dynamically evaluate the message string with access to `ctx.data`
            const evaluatedMessage = new Function('data', `with(data) { return \`${message}\`; }`)(ctx.data || {});
            console.log(`[LOG]: ${evaluatedMessage}`);
        } else {
            console.log(`[LOG]: ${action}`);
        }
    } catch (err) {
        console.error(`[LOG]: Error evaluating message "${message}": ${err.message}`);
    }
};

globalContext.actions.response = (ctx, action) => {
    console.log(`[RESPONSE]: ${ctx.data}`);
    return ctx.data;    
};

globalContext.actions.notify = (ctx, target) => {
    console.log(`[NOTIFY]: Notification sent to ${target}`);
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
    app.use(route, ...middlewares, express.static(folderPath));
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

  


function registerRoutes(app, apiConfig) {
    apiConfig.forEach((endpoint, index) => {
        const {  route, dbTable, allowRead, allowWrite, keys, acl, relationships, allowMethods, cache , auth, authentication, encryption} = endpoint;
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
        app.get(route,cors(corsOptions), authenticateMiddleware(auth), aclMiddleware(acl), async (req, res) => {
            try {
                const connection = await getDbConnection(endpoint);
                if (!connection) {
                    return res.status(500).json({ error: `Database connection failed for ${endpoint.dbConnection}` });
                }
        
                // Extract pagination parameters with defaults
                const limit = parseInt(req.query.limit, 10) || 20; // Default 20 records per page
                const offset = parseInt(req.query.offset, 10) || 0; // Default start at the first record
        
                // Check for negative values
                if (limit < 0 || offset < 0) {
                    return res.status(400).json({ error: "Limit and offset must be non-negative integers" });
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
        
                // Query to get the total record count
                const countQuery = `SELECT COUNT(*) as totalCount FROM ${dbTable} ${whereClause ? `WHERE ${whereClause}` : ''}`;
                const [countResult] = await connection.execute(countQuery, params);
                const totalCount = countResult[0].totalCount;
                console.log(`Total records: ${totalCount}`);
                // Query to fetch paginated data
                const query = `
                    SELECT ${queryFields}
                    FROM ${dbTable}
                    ${joinClause}
                    ${whereClause ? `WHERE ${whereClause}` : ''}
                    LIMIT ${limit}
                    OFFSET ${offset}
                `;             
                const [results] = await connection.execute(query, params);
        
                // Return paginated data along with metadata
                res.json({
                    data: results,
                    metadata: {
                        totalRecords: totalCount,
                        limit,
                        offset,
                        totalPages: Math.ceil(totalCount / limit),
                    },
                });
            } catch (error) {
                console.error(`Error in GET ${route}:`, error.message);
                res.status(500).json({ error: error.message });
            }
        });
        
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


class Adaptus2Server {
    constructor({ port = 3000, configPath = './config/apiConfig.json', pluginDir = './plugins' }) {
        this.port = port;
        this.configPath = configPath;
        this.pluginDir = pluginDir;
        this.app = express();
        this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
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
                        case "help":
                            socket.write("Available commands: load, unload, reload, reloadall, list, routes, exit.\n");
                            break;
                        default:
                            socket.write("Unknown command. Available commands: load, unload, reload, reloadall, list, routes, exit.\n");
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
        const ruleEngineMiddleware = new RuleEngineMiddleware(ruleEngine, this.dependencyManager);
        this.app.use(ruleEngineMiddleware.middleware());
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
    
    
    async start(callback) {
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
            this.setupPluginLoader();
            autoloadPlugins(this.pluginManager);
            this.setupReloadHandler(this.configPath);
            if(process.env.SOCKET_CLI) {
                this.setupSocketServer(); // Start the socket server
            }
  
            // Synchronize plugins and subscribe to updates
            await this.synchronizePluginsOnStartup();
            this.subscribeToPluginUpdates();

            
            // Start the server
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
