const registerFileUploadEndpoint = (app, config) => {
    consolelog.log(config);
    const { route, dbTable, allowWrite, fileUpload , acl, auth } = config;
    consolelog.log(fileUpload);
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
    
    app.post(route, authenticateMiddleware(auth), aclMiddleware(acl), upload.single(fieldName), async (req, res) => {
        const dbConnectionConfig = { dbType: config.dbType, dbConnection: config.dbConnection };
        console.log(req.body);
        // Extract file and metadata
        const { file } = req;
        // uploaded_by should come from the jwt token        
        const uploaded_by = req.user; // Ensure this is passed in the request body
        const user_id = req.user.id ? req.user.user_id : null; 

        if (!file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const sql = `
            INSERT INTO ${dbTable} (${allowWrite.join(', ')})
            VALUES (?, ?, ?, ?, ?)
        `;

        const values = [
            file.filename,
            path.join(fileUpload.storagePath, file.filename),
            file.mimetype,
            uploaded_by,
            user_id
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
                consolelog.log(`Auth for route ${route}:`, auth); // 
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
        const defaultUnauthorized = { httpCode: 403, message: 'Access Denied' };
        const unauthorized = (endpoint.errorCodes && endpoint.errorCodes['unauthorized']) 
            ? endpoint.errorCodes['unauthorized'] 
            : defaultUnauthorized;
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


// A helper function that parses filter parameters and builds SQL clauses.
function buildFilterClause(filterObj, dbTable) {
    const whereParts = [];
    const values = [];
    for (const [field, filterValue] of Object.entries(filterObj)) {
      // Expecting filterValue to be of the form "operator:value", e.g., "gte:100"
      const [operator, ...rest] = filterValue.split(':');
      const value = rest.join(':'); // in case the value itself contains a colon
      let sqlOperator;
      switch (operator.toLowerCase()) {
        case 'gt':
          sqlOperator = '>';
          break;
        case 'gte':
          sqlOperator = '>=';
          break;
        case 'lt':
          sqlOperator = '<';
          break;
        case 'lte':
          sqlOperator = '<=';
          break;
        case 'ne':
          sqlOperator = '!=';
          break;
        case 'like':
          sqlOperator = 'LIKE';
          break;
        case 'eq':
        default:
          sqlOperator = '=';
      }
      whereParts.push(`${dbTable}.${field} ${sqlOperator} ?`);
      values.push(value);
    }
    return {
      clause: whereParts.join(' AND '),
      values,
    };
  }
  
  const getParamPath = keys && keys.length > 0 ? `/:${keys[0]}?` : "";

  app.get(
    `${route}${getParamPath}`,
    authenticateMiddleware(auth),
    aclMiddleware(acl, unauthorized),
    async (req, res) => {
      try {
        console.log("Incoming GET request:", {
          route,
          params: req.params,
          query: req.query,
        });
  
        const connection = await getDbConnection(endpoint);
        if (!connection) {
          console.error(`Database connection failed for ${endpoint.dbConnection}`);
          return res.status(500).json({ error: `Database connection failed for ${endpoint.dbConnection}` });
        }
  
        // Sanitize query parameters.
        const sanitizedQuery = Object.fromEntries(
          Object.entries(req.query).map(([key, value]) => [
            key,
            String(value).replace(/^['"]|['"]$/g, ""),
          ])
        );
  
        // Pagination parameters.
        const limit = parseInt(sanitizedQuery.limit, 10) || 20;
        const offset = parseInt(sanitizedQuery.offset, 10) || 0;
        if (limit < 0 || offset < 0) {
          console.error("Invalid pagination parameters:", { limit, offset });
          return res.status(400).json({ error: "Limit and offset must be non-negative integers" });
        }
  
        // Determine if a single record was requested.
        const recordKey = keys && keys.length > 0 ? keys[0] : "id";
        let recordId = req.params[recordKey];
  
        let whereClause = "";
        let params = [];
  
        if (recordId) {
          // Convert UUID back to original ID if needed.
          if (endpoint.uuidMapping) {
            const decodedId = await getOriginalIdFromUUID(dbTable, recordId);
            if (!decodedId) {
              return res.status(400).json({ error: "Invalid UUID provided" });
            }
            recordId = decodedId;
          }
  
          // Use recordKey in the SQL query.
          whereClause = `WHERE ${dbTable}.${recordKey} = ?`;
          params.push(recordId);
        } else {
          let filterClause = "";
          let filterValues = [];
          if (sanitizedQuery.filter && typeof sanitizedQuery.filter === "object") {
            const { clause, values } = buildFilterClause(sanitizedQuery.filter, dbTable);
            filterClause = clause;
            filterValues = values;
          }
            // If UUID mapping is enabled and the query contains a "uuid" parameter,
            // assign it to the primary key field (keys[0]) and remove the "uuid" key.
            if (endpoint.uuidMapping && sanitizedQuery.uuid !== undefined) {
                sanitizedQuery[endpoint.keys[0]] = sanitizedQuery.uuid;
                delete sanitizedQuery.uuid;
            }
  
          const queryKeys = endpoint.keys
            ? endpoint.keys.filter((key) => sanitizedQuery[key] !== undefined)
            : Object.keys(sanitizedQuery);
          const equalityClause = queryKeys.map((key) => `${dbTable}.${key} = ?`).join(" AND ");
          const equalityValues = [];
          for (const key of queryKeys) {
            let value = sanitizedQuery[key];
            // Only convert the value if this key is the primary key.
            if (endpoint.uuidMapping && key === (endpoint.keys && endpoint.keys[0])) {
              const decodedValue = await getOriginalIdFromUUID(dbTable, value);
              if (!decodedValue) {                
                if(endpoint.errorCodes.notFound){
                    return res.status(endpoint.errorCodes.notFound.httpCode).json({ error: endpoint.errorCodes
                        .notFound.message });
                }
                return res
                  .status(400)
                  .json({ error: `Sorry, record not Found` });
              }
              equalityValues.push(decodedValue);
            } else {
              equalityValues.push(value);
            }
          }
          const clauses = [];
          if (equalityClause) clauses.push(equalityClause);
          if (filterClause) clauses.push(filterClause);
          if (clauses.length) {
            whereClause = `WHERE ${clauses.join(" AND ")}`;
            params = [...equalityValues, ...filterValues];
          }
        }
  
        // Enforce record ownership if configured.
        if (endpoint.owner) {
          const user = getContext("user");
          if (!user) {
            return res.status(401).json({ error: "Unauthorized" });
          }
          whereClause += whereClause ? ` AND ${dbTable}.${endpoint.owner.column} = ?` : `WHERE ${dbTable}.${endpoint.owner.column} = ?`;
          params.push(user[endpoint.owner.tokenField]);
        }
  
        // Validate requested fields.
        const requestedFields = sanitizedQuery.fields
          ? sanitizedQuery.fields.split(",").filter((field) => endpoint.allowRead.includes(field))
          : endpoint.allowRead;
        if (!requestedFields.length) {
          console.error("No valid fields requested:", sanitizedQuery.fields);
          return res.status(400).json({ error: "No valid fields requested" });
        }
        const fields = requestedFields.map((field) => `${dbTable}.${field}`).join(", ");
  
        // Process relationships.
        let joinClause = "";
        let relatedFields = "";
        if (Array.isArray(endpoint.relationships)) {
          endpoint.relationships.forEach((rel) => {
            const joinType = rel.joinType || "LEFT JOIN";
            joinClause += ` ${joinType} ${rel.relatedTable} ON ${dbTable}.${rel.foreignKey} = ${rel.relatedTable}.${rel.relatedKey}`;
            if (Array.isArray(rel.fields) && rel.fields.length > 0) {
              relatedFields += `, ${rel.fields.map((field) => `${rel.relatedTable}.${field}`).join(", ")}`;
            }
          });
        }
        const queryFields = `${fields}${relatedFields}`;
        const paginationClause = recordId ? "" : `LIMIT ${limit} OFFSET ${offset}`;
        const dataQuery = `
          SELECT ${queryFields}, ${recordKey} as originalId
          FROM ${dbTable}
          ${joinClause}
          ${whereClause}
          ${paginationClause}
        `;
        const countQuery = `
          SELECT COUNT(*) as totalCount
          FROM ${dbTable}
          ${joinClause}
          ${whereClause}
        `;
  
        const cacheKey = `cache:${route}:${JSON.stringify(req.params)}:${JSON.stringify(req.query)}`;
        if (endpoint.cache === 1) {
          const cachedData = await redis.get(cacheKey);
          if (cachedData) {
            console.log("Cache hit for key:", cacheKey);
            return res.json(JSON.parse(cachedData));
          }
        }
        console.log("Cache miss or caching disabled. Executing queries.");
  
        let totalCount = 0;
        if (!recordId) {
          const [countResult] = await connection.execute(countQuery, params);
          totalCount = countResult[0]?.totalCount || 0;
        }
  
        const [results] = await connection.execute(dataQuery, params);
  
        // Convert IDs to UUIDs before returning response
        if (endpoint.uuidMapping) {
          results.forEach((record) => {
            record.uuid = generateDeterministicUUID(dbTable, record.originalId, SECRET_SALT);
            storeUUIDMapping(dbTable, record.originalId, record.uuid)
            delete record.originalId;
            delete record[recordKey]; 
          });
        }
  
        let response;
        if (recordId) {
          if (!results.length) {
            return res.status(404).json({ error: "Record not found" });
          }
          response = results[0];
        } else {
          response = {
            data: results,
            metadata: {
              totalRecords: totalCount,
              limit,
              offset,
              totalPages: limit > 0 ? Math.ceil(totalCount / limit) : 0,
            },
          };
        }
  
        if (endpoint.cache === 1) {
          console.log("Caching response for key:", cacheKey);
          await redis.set(cacheKey, JSON.stringify(response), "EX", 300);
        }
        res.json(response);
      } catch (error) {
        console.error(`Error in GET ${route}:`, error.stack);
        res.status(500).json({ error: error.message });
      }
    }
  );
  
    
        
        // POST, PUT, DELETE endpoints (unchanged but dynamically registered based on allowMethods)
        if (allowedMethods.includes("POST")) {
            app.post(route,cors(corsOptions), authenticateMiddleware(auth), aclMiddleware(acl,unauthorized), async (req, res) => {
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
                    res.status(400).json({ error: error.message });
                }
            });
        }
                // For endpoints that require a primary key (PUT, PATCH, DELETE), register them only if keys is defined.
                if (keys && keys.length > 0) {
                    const primaryKey = keys[0];
                
                    // *******************************
                    // PUT Endpoint (Update)
                    // *******************************
                    app.put(
                        `${route}/:${primaryKey}`,
                        authenticateMiddleware(auth),
                        aclMiddleware(acl, unauthorized),
                        async (req, res) => {
                            let recordId = req.params[primaryKey];
                
                            // Check if UUID obfuscation is enabled
                            if (endpoint.uuidMapping) {
                                const decodedId = await getOriginalIdFromUUID(dbTable, recordId);
                                if (!decodedId) {
                                    return res.status(400).json({ error: "Invalid UUID provided" });
                                }
                                recordId = decodedId;
                            }
                
                            if (!recordId) {
                                return res.status(400).json({ error: 'Record key is missing in URL path' });
                            }
                
                            const writableFields = Object.keys(req.body).filter((key) => allowWrite.includes(key));
                            if (writableFields.length === 0) {
                                return res.status(400).json({ error: 'No writable fields provided' });
                            }
                
                            const values = writableFields.map((key) => req.body[key]);
                            const setClause = writableFields.map((key) => `${key} = ?`).join(', ');
                            let query = `UPDATE ${dbTable} SET ${setClause} WHERE ${primaryKey} = ?`;
                            const params = [...values, recordId];
                
                            if (endpoint.owner) {
                                const user = getContext('user');
                                if (!user) {
                                    return res.status(401).json({ error: "Unauthorized" });
                                }
                                query += ` AND ${dbTable}.${endpoint.owner.column} = ?`;
                                params.push(user[endpoint.owner.tokenField]);
                            }
                
                            try {
                                const connection = await getDbConnection(endpoint);
                                await connection.execute(query, params);
                                res.status(200).json({ message: 'Record updated' });
                            } catch (error) {
                                console.error(`Error in PUT ${route}:`, error);
                                res.status(500).json({ error: 'Internal Server Error' });
                            }
                        }
                    );
                
                    // *******************************
                    // PATCH Endpoint (Partial Update)
                    // *******************************
                    app.patch(
                        `${route}/:${primaryKey}`,
                        authenticateMiddleware(auth),
                        aclMiddleware(acl, unauthorized),
                        async (req, res) => {
                            let recordId = req.params[primaryKey];
                
                            // Check if UUID obfuscation is enabled
                            if (endpoint.uuidMapping) {
                                const decodedId = await getOriginalIdFromUUID(dbTable, recordId);
                                if (!decodedId) {
                                    return res.status(400).json({ error: "Invalid UUID provided" });
                                }
                                recordId = decodedId;
                            }
                
                            if (!recordId) {
                                return res.status(400).json({ error: 'Record key is missing in URL path' });
                            }
                
                            const writableFields = Object.keys(req.body).filter((key) => allowWrite.includes(key));
                            if (writableFields.length === 0) {
                                return res.status(400).json({ error: 'No writable fields provided' });
                            }
                
                            const values = writableFields.map((key) => req.body[key]);
                            const setClause = writableFields.map((key) => `${key} = ?`).join(', ');
                            let query = `UPDATE ${dbTable} SET ${setClause} WHERE ${primaryKey} = ?`;
                            const params = [...values, recordId];
                
                            if (endpoint.owner) {
                                const user = getContext('user');
                                if (!user) {
                                    return res.status(401).json({ error: "Unauthorized" });
                                }
                                query += ` AND ${dbTable}.${endpoint.owner.column} = ?`;
                                params.push(user[endpoint.owner.tokenField]);
                            }
                
                            try {
                                const connection = await getDbConnection(endpoint);
                                await connection.execute(query, params);
                                res.status(200).json({ message: 'Record partially updated' });
                            } catch (error) {
                                console.error(`Error in PATCH ${route}:`, error);
                                res.status(500).json({ error: 'Internal Server Error' });
                            }
                        }
                    );
                
                    // *******************************
                    // DELETE Endpoint
                    // *******************************
                    app.delete(
                        `${route}/:${primaryKey}`,
                        authenticateMiddleware(auth),
                        aclMiddleware(acl, unauthorized),
                        async (req, res) => {
                            let recordId = req.params[primaryKey];
                
                            // Check if UUID obfuscation is enabled
                            if (endpoint.uuidMapping) {
                                const decodedId = await getOriginalIdFromUUID(dbTable, recordId);
                                if (!decodedId) {
                                    return res.status(400).json({ error: "Invalid UUID provided" });
                                }
                                recordId = decodedId;
                            }
                
                            if (!recordId) {
                                return res.status(400).json({ error: 'Record key is missing in URL path' });
                            }
                
                            let query = `DELETE FROM ${dbTable} WHERE ${primaryKey} = ?`;
                            const params = [recordId];
                
                            if (endpoint.owner) {
                                const user = getContext('user');
                                if (!user) {
                                    return res.status(401).json({ error: "Unauthorized" });
                                }
                                query += ` AND ${dbTable}.${endpoint.owner.column} = ?`;
                                params.push(user[endpoint.owner.tokenField]);
                            }
                
                            try {
                                const connection = await getDbConnection(endpoint);
                                await connection.execute(query, params);
                                res.status(200).json({ message: 'Record deleted' });
                            } catch (error) {
                                console.error(`Error in DELETE ${route}:`, error);
                                res.status(500).json({ error: 'Internal Server Error' });
                            }
                        }
                    );
                } else {
                    console.log(`Skipping PUT, PATCH, DELETE for ${route} as no keys are defined.`);
                }
                
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
    app.use(route, cors(corsOptions),cors(corsOptions), ...middlewares, express.static(folderPath));
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

