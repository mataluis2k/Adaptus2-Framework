const { v7: uuidv7 } = require('uuid');            // UUID generator
const redisClient = require('./redisClient');         // Your Redis client module
const { getDbConnection } = require('./db');          // Your DB module
const BusinessLogicProcessor = require('./BusinessLogicProcessor');
const consolelog = require('./logger');
const { aarMiddleware } = require('../middleware/aarMiddleware');
const responseBus = require('./response');
const { getContext } = require('./context'); // Import the shared globalContext and getContext

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
    let firstClauseKeyword = "";
  
    clauses.forEach((clause) => {
      const regex = new RegExp(clause, "i");
      const match = sqlQuery.match(regex);
      if (match && (firstClauseIndex === -1 || match.index < firstClauseIndex)) {
        firstClauseIndex = match.index;
        firstClauseKeyword = clause;
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
 * 
 * @param {string} sqlQuery - The original SQL query.
 * @param {string} include - The fields to include in the SELECT clause.
 * @returns {string} The SQL query with the specified fields included in the SELECT clause.
 * @throws {Error} If no FROM clause is found in the SQL query.
 * 
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
  const includeFieldsString = includeFields.map(field => `m.${field}`).join(',');
  
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
    let { route, allowMethods, sqlQuery, businessLogic, response, uuidMapping, keys } = endpoint;
    consolelog.log("Dynaroute:", endpoint);
  
    if (!Array.isArray(allowMethods) || allowMethods.length === 0) {
      console.error(`Invalid or missing 'allowMethods' for route ${route}`);
      return;
    }
  
    allowMethods.forEach((method) => {
      const middlewares = [];
      const auth = endpoint.auth;
      const acl = endpoint.acl;
      const ruleEngineInstance = getContext('ruleEngineMiddleware');
  
      app[method.toLowerCase()](route, aarMiddleware(auth, acl,ruleEngineInstance), async (req, res) => {
        try {
          responseBus.Reset(); // Reset the response object at the beginning of the request

          // Data from query parameters (GET) or request body (others)
          const data = method === 'GET' ? req.query : req.body;
  
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
              // The user might send a include in the query parameters that will be used to include the fields in the response
              // e.g. ?include=training-plans.workouts.images,training-plans.workouts.instructor,training-plans.workouts.workout-recommendations,mobile-image
              // We need to parse the include and get those fields inside the sqlQuery 
              const includes = data.include;
              if (includes) {               
                sqlQuery = addIncludes(sqlQuery, includes);
              }
                                
              // We need to passed the sqlQuery to interpolation with the user object which comes on the JWT token the user object could have 
              // user.id or user.username or user.email or any other field that is in the user object
              // we need to interpolate the sqlQuery with the user object
              // we need to get the user object from the context
              const user = getContext('user');
              if (user) {
                // we need to interpolate the sqlQuery with the user object
                // we need to get the keys of the user object
                const keys = Object.keys(user);
                // we need to iterate over the keys and replace the keys in the sqlQuery with the values of the user object
                keys.forEach(key => {
                  sqlQuery = sqlQuery.replace(new RegExp(`{${key}}`, 'g'), user[key]);
                });
                console.log("Interpolated sqlQuery:", sqlQuery);
              }

            let finalSql = ensureWhereClause(sqlQuery);
            const queryParams = [];
  
            // If a filter is provided (e.g., id) and we have a defined key
            if (data.id && keys && keys.length > 0) {
              if (uuidMapping) {
                const realId = await redisClient.get(`uuidMapping:${data.id}`);
                if (!realId) {
                  return res.status(404).json({ error: 'Record not found (invalid UUID)' });
                }
                data.id = realId;
              }
              // Append an additional filter for the primary key column
              finalSql += " AND m." + keys[0] + " = ?";
              queryParams.push(data.id);
            }
  
            const dbConnection = await getDbConnection(endpoint);
            const [queryResult] = await dbConnection.execute(finalSql, queryParams);
  
            // If UUID mapping is enabled, mask the primary key in the results
            if (uuidMapping && queryResult.length > 0) {
              for (const row of queryResult) {
                  for (const key of keys) { // Iterate over all keys in the array
                      const originalId = row[key];
                      if (!originalId) continue; // Skip if key does not exist in the row
          
                      const reverseKey = `uuidMapping:original:${originalId}`;
                      let existingUuid = await redisClient.get(reverseKey);
                      if (existingUuid) {
                          row[key] = existingUuid;
                      } else {
                          const newUuid = uuidv7();
                          row[key] = newUuid;
                          await redisClient.set(`uuidMapping:${newUuid}`, originalId);
                          await redisClient.set(reverseKey, newUuid);
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

          const respond = res.status(responseBus.status).json({
            message: responseBus.message,
            error: responseBus.error,
            data: responseBus.data,
            module: responseBus.module
          });

          return respond;
  
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
