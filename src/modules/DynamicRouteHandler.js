const { v7: uuidv7 } = require('uuid');            // UUID generator
const redisClient = require('./redisClient');         // Your Redis client module
const { getDbConnection } = require('./db');          // Your DB module
const BusinessLogicProcessor = require('./BusinessLogicProcessor');
const consolelog = require('./logger');
const { authenticateMiddleware, aclMiddleware } = require('../middleware/authenticationMiddleware');
const responseBus = require('./response');

/**
 * Inspects the SQL query and ensures it contains a WHERE clause.
 * If no WHERE clause is found, it inserts "WHERE 1=1" before any ORDER BY.
 * This dummy condition allows for appending additional AND clauses later.
 * 
 * @param {string} sqlQuery - The original SQL query.
 * @returns {string} The SQL query guaranteed to contain a WHERE clause.
 */
function ensureWhereClause(sqlQuery) {
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

class DynamicRouteHandler {
  /**
   * Register a dynamic route based on the endpoint configuration.
   * @param {Object} app - Express application instance.
   * @param {Object} endpoint - Endpoint configuration from apiConfig.json.
   */
  static registerDynamicRoute(app, endpoint) {
    const { route, allowMethods, sqlQuery, businessLogic, response, uuidMapping, keys } = endpoint;
    consolelog.log("Dynaroute:", endpoint);

    if (!Array.isArray(allowMethods) || allowMethods.length === 0) {
      console.error(`Invalid or missing 'allowMethods' for route ${route}`);
      return;
    }

    allowMethods.forEach((method) => {
      const middlewares = [];
      if (endpoint.auth) {
        middlewares.push(authenticateMiddleware(endpoint.auth));
      }
      if (endpoint.acl) {
        middlewares.push(aclMiddleware(endpoint.acl));
      }

      app[method.toLowerCase()](route, ...middlewares, async (req, res) => {
        try {
          // Data from query parameters (GET) or request body (others)
          const data = method === 'GET' ? req.query : req.body;

          // Ensure the SQL query has a WHERE clause so we can safely append filters.
          let finalSql = ensureWhereClause(sqlQuery);
          const queryParams = [];

          // If a filter is provided (e.g., id) and we have a defined key
          if (data.id && keys && keys.length > 0) {
            // If UUID mapping is enabled, convert the provided UUID to the real primary key.
            if (uuidMapping) {
              const realId = await redisClient.get(`uuidMapping:${data.id}`);
              if (!realId) {
                return res.status(404).json({ error: 'Record not found (invalid UUID)' });
              }
              data.id = realId;
            }
            // Assuming the primary key column is the first key (e.g., 'id').
            // Append an additional filter.
            finalSql += " AND m." + keys[0] + " = ?";
            queryParams.push(data.id);
          }

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
            const dbConnection = await getDbConnection(endpoint);
            const [queryResult] = await dbConnection.execute(finalSql, queryParams);

            // If UUID mapping is enabled, iterate over the results to mask the primary key.
            if (uuidMapping && queryResult.length > 0) {
              const primaryKeyField = keys[0]; // e.g., 'id'
              for (const row of queryResult) {
                const originalId = row[primaryKeyField];
                // Check if there is already a UUID mapping for this originalId
                const reverseKey = `uuidMapping:original:${originalId}`;
                let existingUuid = await redisClient.get(reverseKey);
                if (existingUuid) {
                  // Reuse the existing UUID mapping.
                  row[primaryKeyField] = existingUuid;
                } else {
                  // Generate a new UUID, update the row, and store both forward and reverse mappings.
                  const newUuid = uuidv7();
                  row[primaryKeyField] = newUuid;
                  await redisClient.set(`uuidMapping:${newUuid}`, originalId);
                  await redisClient.set(reverseKey, newUuid);
                }
              }
            }

            return res.json({ message: 'SQL query executed successfully', result: queryResult });
          }

          // Fallback response if no SQL or business logic defined.
          const respond = res.status(responseBus.status).json({
            message: responseBus.message,
            error: responseBus.error,
            data: responseBus.data,
            module: responseBus.module
          });
          responseBus.Reset();
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
