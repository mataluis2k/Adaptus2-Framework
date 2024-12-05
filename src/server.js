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
const RateLimit = require('./modules/rate_limit');
const generateGraphQLSchema = require('./modules/generateGraphQLSchema');
const { createHandler } = require('graphql-http/lib/use/express');
const ChatModule = require('./modules/chatModule'); // Chat Module
const PaymentModule = require('./modules/paymentModule'); // Payment Module
const StreamingServer = require('./modules/streamingServer'); // Streaming Module
const configFile = path.join(process.cwd(), 'config/apiConfig.json');
    

const {  initializeRAG , handleRAG } = require("./modules/ragHandler1.js");
require('dotenv').config({ path: process.cwd() + '/.env' });

const { passport, authenticateOAuth } = require('./middleware/oauth');
const { exit } = require('process');


const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const JWT_SECRET = process.env.JWT_SECRET || 'IhaveaVeryStrongSecret';

console.log('Current directory:', process.cwd());

const graphqlDbType = process.env.GRAPHQL_DBTYPE;
const graphqlDbConnection = process.env.GRAPHQL_DBCONNECTION;

let apiConfig = [];

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
                            console.log("Cache hit for:", cacheKey);
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
                        tokenPayload[field] = user[field];
                    });

                    const token = jwt.sign(tokenPayload, SECRET_KEY, { expiresIn: TOKEN_EXPIRATION });

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
                            console.log(`Cache hit for key: ${cacheKey}`);
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
                    console.log(`Executing query: ${query} with params: ${params}`);

                    const [results] = await connection.execute(query, params);

                    // Handle no results
                    if (results.length === 0) {
                        return res.status(404).json({ error: 'Data not found' });
                    }

                    // Cache the query results in Redis if caching is enabled
                    if (cacheTTL > 0) {
                        console.log(`Caching response for key: ${cacheKey} with TTL: ${cacheTTL}`);
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

function setupRag(apiConfig) {
    // Initialize RAG during server startup
    initializeRAG(apiConfig).catch((error) => {
        console.error("Failed to initialize RAG:", error.message);
        process.exit(1); // Exit if initialization fails
    });
}

class FlexAPIServer {
    constructor({ port = 3000, configPath = 'config/apiConfig.json' }) {
        this.port = port;
        this.configPath = configPath;
        this.app = express();
        this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
        this.apiConfig = [];
        this.businessRules = new BusinessRules();

        // Optional modules
        this.chatModule = null;
        this.paymentModule = null;
        this.streamingServer = null;
    }

        
    async loadConfig() {
        try {
            const configData = fs.readFileSync(path.resolve(process.cwd(), this.configPath), 'utf-8');
            this.apiConfig = JSON.parse(configData);
            console.log('Configuration loaded successfully.');
        } catch (error) {
            console.error('Error loading configuration:', error);
            console.error("You must create a config folder and add an apiConfig.json file");
            exit(1);            
        }
    }


  

        // Reload Configuration
    setupReloadHandler(configFile) {
        process.on('SIGHUP', async () => {
            console.log('Reloading configuration...');
            await loadConfig(configFile);
            registerRoutes();
            console.log('Configuration reloaded.');
        });
    }


    registerMiddleware() {
        this.app.use(express.json());
        this.app.use(morgan('combined'));
        this.businessRules.loadRules();
        this.app.use(this.businessRules.middleware());
        const rateLimit = new RateLimit(this.apiConfig, this.redis);
        this.app.use(rateLimit.middleware());      
        
    }

    registerRoutes() {
        registerRoutes(this.app, this.apiConfig);
    }

    registerProxyEndpoints() {
        registerProxyEndpoints(this.apiConfig);
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
            const httpServer = require('http').createServer(this.app); // Reuse server
            this.chatModule = new ChatModule(httpServer, this.app);
            this.chatModule.start();
            console.log('Chat module initialized.');
        } catch (error) {
            console.error('Failed to initialize Chat Module:', error.message);
        }

        // // Initialize Payment Module
        // try {
        //     const dbConfig = {
        //         getConnection: async () => await getDbConnection({ dbType: "mysql", dbConnection: "MYSQL_1" }),
        //     };
        //     this.paymentModule = new PaymentModule(this.app, dbConfig);
        //     console.log('Payment module initialized.');
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
            console.log('Streaming server module initialized.');
        } catch (error) {
            console.error('Failed to initialize Streaming Server Module:', error.message);
        }


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

    async start(callback) {
        try {
          
            console.log(configFile);
            // Add support for building API config from database
            if (process.argv.includes('-build')) {
                console.log('Building API configuration from database...');
                await buildApiConfigFromDatabase();
                console.log('API configuration build complete.');
                process.exit(0);
            }

            // Load the API configuration
            await this.loadConfig(configFile);

            // Setup configuration reload handler
            //this.setupReloadHandler(configFile);

            // Check if -init parameter is provided
            if (process.argv.includes('-init')) {
                console.log('Initializing database tables...');
                await this.initializeTables();
                console.log('Table initialization complete. Exiting...');
                process.exit(0);
            }

            setupRag(this.apiConfig);
            
            this.registerMiddleware();
            this.registerRoutes();
            this.registerProxyEndpoints();
            this.initializeOptionalModules(this.app);
            await this.setupGraphQL();

            
           

            this.app.listen(this.port, () => {
                console.log(`API server running on port ${this.port}`);
                if (callback) callback();
            });
        } catch (error) {
            console.error('Failed to start server:', error);
        }
    }
}

// Export the FlexAPIServer class
module.exports = FlexAPIServer;

// Example: Create a new server instance and start it
if (require.main === module) {
    const server = new FlexAPIServer({
        port: process.env.PORT || 3000,
        configPath: 'config/apiConfig.json',
    });
    server.start();
}
