const { getDbConnection } = require('./db'); // Your database module

const BusinessLogicProcessor = require('./BusinessLogicProcessor'); // Business Logic Processor
const consolelog = require('./logger');
const { authenticateMiddleware, aclMiddleware } = require('../middleware/authenticationMiddleware');
const responseBus = require('./response');

class DynamicRouteHandler {
    /**
     * Register a dynamic route based on the endpoint configuration.
     * @param {Object} app - Express application instance.
     * @param {Object} endpoint - Endpoint configuration from apiConfig.json.
     */
    static registerDynamicRoute(app, endpoint) {
        const { route, allowMethods, validation, sqlQuery, businessLogic, response } = endpoint;
        consolelog.log("Dynaroute:", endpoint);

        if (!Array.isArray(allowMethods) || allowMethods.length === 0) {
            console.error(`Invalid or missing 'allowMethods' for route ${endpoint}`);
            return; // Skip registering this route
        }

        allowMethods.forEach((method) => {
            const middlewares = [];
            // need to add the auth middleware here and acl middleware
            if (endpoint.auth) {
                middlewares.push(authenticateMiddleware(endpoint.auth));
            }
            if (endpoint.acl) {
                middlewares.push(aclMiddleware(endpoint.acl));
            }

            // Register the route with the appropriate method
            app[method.toLowerCase()](route, ...middlewares, async (req, res) => {
                try {
                    const data = method === 'GET' ? req.query : req.body;

                    // Process business logic if defined
                    if (businessLogic) {
                        const businessLogicResult = await BusinessLogicProcessor.process(businessLogic, data);
                        if (response && response.fields) {
                            return res.json(this.filterResponseFields(businessLogicResult, response.fields));
                        }
                        return res.json(businessLogicResult);
                    }

                    // Execute SQL query if defined
                    if (sqlQuery) {
                        console.log("Dynaroute:", endpoint)
                        const dbConnection = await getDbConnection(endpoint);
                        const queryParams = Object.values(data);
                        const [queryResult] = await dbConnection.execute(sqlQuery, queryParams);

                        return res.json({ message: 'SQL query executed successfully', result: queryResult });
                    }

                  
                    const respond = res.status(responseBus.status).json({ message: responseBus.message, error: responseBus.error, data: responseBus.data, module: responseBus.module });
                    responseBus.Reset();
                    return respond;
                  
                } catch (error) {
                    console.error(`Error processing route ${route}:`, error.message);
                    res.status(500).json({ error: 'Internal Server Error', details: error.message });
                }
            });
        });
    }

    /**
     * Filter the response fields based on the configuration.
     * @param {Object} data - Data to filter.
     * @param {Array} fields - Fields to include in the response.
     * @returns {Object} Filtered data.
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
