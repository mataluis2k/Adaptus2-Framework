const { v7: uuidv7 } = require('uuid');            // UUID generator
const Redis = require('ioredis');
const dynaRouteRedis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');     // Your Redis client module
const { getDbConnection } = require('./db');         // Your DB module
const BusinessLogicProcessor = require('./BusinessLogicProcessor');
const consolelog = require('./logger');
const { aarMiddleware } = require('../middleware/aarMiddleware');
const responseBus = require('./response');
const { getContext } = require('./context');         // Import the shared globalContext and getContext
        // Import the RateLimit class
const unauthorizedResponse = responseBus.unauthorized(); // Import the unauthorized response from the response module
/**
 * Inspects the SQL query and ensures it contains a WHERE clause.
 * If no WHERE clause is found, it inserts "WHERE 1=1" before any ORDER BY.
 * This dummy condition allows for appending additional AND clauses later.
 * 
 * @param {string} sqlQuery - The original SQL query.
 * @returns {string} The SQL query guaranteed to contain a WHERE clause.
 */
function ensureWhereClause(sqlQuery = '') {
  // If a WHERE clause is already present, do nothing.
  if (/where\s+/i.test(sqlQuery)) {
    return sqlQuery;
  }

  // List possible clause keywords in the order they appear in a typical SQL query.
  // We look for the first occurrence of any of these.
  const clauses = ["group\\s+by", "order\\s+by", "limit"];
  let firstClauseIndex = -1;

  clauses.forEach((clause) => {
    const regex = new RegExp(clause, "i");
    const match = sqlQuery.match(regex);
    if (match && (firstClauseIndex === -1 || match.index < firstClauseIndex)) {
      firstClauseIndex = match.index;
    }
  });

  if (firstClauseIndex !== -1) {
    // Insert "WHERE 1=1" right before the first encountered clause.
    const beforeClause = sqlQuery.substring(0, firstClauseIndex);
    const afterClause = sqlQuery.substring(firstClauseIndex);
    return beforeClause + " WHERE 1=1 " + afterClause;
  }

  // If none of the clauses are found, simply append the WHERE clause.
  return sqlQuery + " WHERE 1=1";
}

/**
 * Adds the specified fields to the SELECT clause of the SQL query.
 *  
 * @param {string} sqlQuery - The original SQL query.
 * @param {string} include - The fields to include in the SELECT clause.
 * @returns {string} The SQL query with the specified fields included in the SELECT clause.
 * @throws {Error} If no FROM clause is found in the SQL query.
 */
function addIncludes(sqlQuery, include) {
  const fromIndex = sqlQuery.search(/FROM/i);
  if (fromIndex === -1) {
    throw new Error("Invalid SQL query, no FROM clause found.");
  }
  
  let selectClause = sqlQuery.substring(0, fromIndex).trim();
  const fromClause = sqlQuery.substring(fromIndex);
  
  // Ensure the select clause ends with a comma
  if (!selectClause.endsWith(',')) {
    selectClause += ',';
  }
  
  // Process the include fields, trimming any extra spaces
  const includeFields = include.split(',').map(field => field.trim());
  const includeFieldsString = includeFields.map(field => `${field}`).join(',');
  
  sqlQuery = `${selectClause} ${includeFieldsString} ${fromClause}`;
  return sqlQuery;
}

class DynamicRouteHandler {
  /**
   * Register a dynamic route based on the endpoint configuration.
   * @param {Object} app - Express application instance.
   * @param {Object} endpoint - Endpoint configuration from apiConfig.json.
   */
  static registerDynamicRoute(app, endpoint) {
    // Expect:
    // - keys: an array of all searchable keys.
    // - uuidMapping: an array of keys (a subset of keys) that should be encoded as UUIDs,
    //   or a boolean (for backwards compatibility) where true means only keys[0] is encoded.
    let { route, allowMethods, sqlQuery, businessLogic, response, uuidMapping, keys } = endpoint;
    consolelog.log("Dynaroute:", endpoint);

    if (!Array.isArray(allowMethods) || allowMethods.length === 0) {
      console.error(`Invalid or missing 'allowMethods' for route ${route}`);
      return;
    }

    // Backwards compatibility: if uuidMapping is a boolean and true, then set it to [keys[0]]
    if (typeof uuidMapping === 'boolean' && uuidMapping === true) {
      if (Array.isArray(keys) && keys.length > 0) {
        uuidMapping = [keys[0]];
      } else {
        uuidMapping = []; // or leave it as an empty array if no keys are provided
      }
    }
  
    allowMethods.forEach((method) => {
      const auth = endpoint.auth;
      const acl = endpoint.acl;
      
      // Retrieve the rule engine instance from app.locals.
      const ruleEngineInstance = app.locals.ruleEngineMiddleware;
      
      if(method.toLowerCase() === 'get'){
        const getParamPath = keys && keys.length > 0 ? `/:${keys[0]}?` : "";
        route = `${route}${getParamPath}`;
      }
   
  
      // Create middleware array for the route
      const middlewares = [aarMiddleware(auth, {acl,unauthorizedResponse }, ruleEngineInstance)];
      
      // Add rate limiting middleware if configured
      // if (endpoint.rateLimit && endpoint.rateLimit.requestsPerMinute) {
      //   const rateLimitMiddleware = async (req, res, next) => {
      //     try {
      //       const { requestsPerMinute } = endpoint.rateLimit;
      //       const clientIP = req.ip;
      //       const rateLimitKey = `rate-limit:${route}:${clientIP}`;
            
      //       const requestCount = await dynaRouteRedis.incr(rateLimitKey);

            
      //       if (requestCount === 1) {
      //         // Set expiration to 1 minute
      //         await dynaRouteRedis.expire(rateLimitKey, 60);
      //       }
            
      //       if (requestCount > requestsPerMinute) {
      //         console.log(`Rate limit exceeded for ${clientIP} on dynamic route ${route}`);
      //         return res.status(429).json({ error: 'Too Many Requests' });
      //       }
            
      //       next();
      //     } catch (error) {
      //       console.error('Rate limit middleware error:', error.message);
      //       next(); // Continue to the next middleware in case of error
      //     }
      //   };
        
      //   middlewares.push(rateLimitMiddleware);
      // }
      
      app[method.toLowerCase()](route, middlewares, async (req, res) => {
        try {
          responseBus.Reset(); // Reset the response object at the beginning of the request

          // Data from query parameters (GET) or request body (others)
          const data = method.toLowerCase() === 'get' ? { ...req.query, ...req.params } : req.body;

          // Process business logic if defined (if any business logic is set, ignore SQL)
          if (businessLogic) {
            const businessLogicResult = await BusinessLogicProcessor.process(businessLogic, data);
            if (response && response.fields) {
              return res.json(this.filterResponseFields(businessLogicResult, response.fields));
            }
            return res.json(businessLogicResult);
          }
  
          // Execute SQL query if defined
          if (sqlQuery) {
              // The user might send an "include" in the query parameters that will be used to include the fields in the response
              const includes = data.include;
              if (includes) {               
                sqlQuery = addIncludes(sqlQuery, includes);
              }
                                
              // Interpolate the sqlQuery with the user object from context
              const user = getContext('user');
              if (user) {
                // Get the keys from the user object for interpolation (renamed to avoid conflict)
                const userKeys = Object.keys(user);
                userKeys.forEach(key => {
                  sqlQuery = sqlQuery.replace(new RegExp(`{${key}}`, 'g'), user[key]);
                });
                console.log("Interpolated sqlQuery:", sqlQuery);
              }

            let finalSql = ensureWhereClause(sqlQuery);
            const queryParams = [];
  
            // Process each searchable key specified in the keys array.
            // For each key present in the request data, add a filter.
            if (Array.isArray(keys) && keys.length > 0) {
              for (const searchKey of keys) {
                if (data[searchKey] !== undefined) {
                  let searchValue = data[searchKey];
                  // If the key should be encoded as UUID, convert the provided UUID to the real value.
                  if (Array.isArray(uuidMapping) && uuidMapping.includes(searchKey)) {
                    // Use a key that includes the searchKey to avoid collisions across columns
                    const realId = await dynaRouteRedis.get(`uuidMapping:${searchKey}:${searchValue}`);
                    if (!realId) {
                      return res.status(404).json({ error: `Record not found (invalid UUID for ${searchKey})` });
                    }
                    searchValue = realId;
                  }
                  
                  finalSql += " AND " + searchKey + " = ?";
                  queryParams.push(searchValue);
                }
              }
            }
  
            const dbConnection = await getDbConnection(endpoint);
            const [queryResult] = await dbConnection.execute(finalSql, queryParams);
  
            // For response encryption, iterate over the keys in uuidMapping only.
            if (Array.isArray(uuidMapping) && queryResult.length > 0) {
              for (const row of queryResult) {
                for (const key of uuidMapping) { // Only encrypt the keys specified in the uuidMapping array
                  const originalId = row[key];
                  if (!originalId) continue; // Skip if key does not exist in the row
          
                  const reverseKey = `uuidMapping:original:${key}:${originalId}`;
                  let existingUuid = await dynaRouteRedis.get(reverseKey);
                  if (existingUuid) {
                    row[key] = existingUuid;
                  } else {
                    const newUuid = uuidv7();
                    row[key] = newUuid;
                    // Store forward mapping with the key in the Redis key
                    await dynaRouteRedis.set(`uuidMapping:${key}:${newUuid}`, originalId);
                    await dynaRouteRedis.set(reverseKey, newUuid);
                  }

                }
              }
            }
  
            return res.json({ message: 'SQL query executed successfully', result: queryResult });
          }
  
          // Fallback response if no SQL or business logic defined.
          if (!responseBus.data || Object.keys(responseBus.data).length === 0) {
            responseBus.setResponse(200, 'Success', null, {}, responseBus.module);
          }

          return res.status(responseBus.status).json({
            message: responseBus.message,
            error: responseBus.error,
            data: responseBus.data,
            module: responseBus.module
          });
  
        } catch (error) {
          console.error(`Error processing route ${route}:`, error.message);
          return res.status(500).json({ error: 'Internal Server Error', details: error.message });
        }
      });
    });
  }
  
  /**
   * Filter the response fields based on the configuration.
   * @param {Object|Array} data - Data to filter.
   * @param {Array} fields - Fields to include in the response.
   * @returns {Object|Array} Filtered data.
   */
  static filterResponseFields(data, fields) {
    if (Array.isArray(data)) {
      return data.map((item) => this.filterResponseFields(item, fields));
    }
    return fields.reduce((filtered, field) => {
      if (data[field] !== undefined) {
        filtered[field] = data[field];
      }
      return filtered;
    }, {});
  }
}

module.exports = DynamicRouteHandler;
