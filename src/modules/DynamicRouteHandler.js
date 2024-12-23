const { getDbConnection } = require('./db'); // Your database module
const validationMiddleware = require('../middleware/validationMiddleware'); // Validation Middleware
const BusinessLogicProcessor = require('./BusinessLogicProcessor'); // Business Logic Processor

class DynamicRouteHandler {
    /**
     * Register a dynamic route based on the endpoint configuration.
     * @param {Object} app - Express application instance.
     * @param {Object} endpoint - Endpoint configuration from apiConfig.json.
     */
    static registerDynamicRoute(app, endpoint) {
        const { route, allowMethods, validation, sqlQuery, businessLogic, response } = endpoint;

        allowMethods.forEach((method) => {
            const middlewares = [];

            // Attach validation middleware if validation rules are defined
            if (validation) {
                middlewares.push(validationMiddleware(validation));
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
                        endpoint.dbType = "mysql";
                        console.log("DyanQuery:",endpoint);
                        const dbConnection = await getDbConnection(endpoint);
                        const queryParams = Object.values(data);
                        const [queryResult] = await dbConnection.execute(sqlQuery, queryParams);

                        return res.json({ message: 'SQL query executed successfully', result: queryResult });
                    }

                    // Default response if no business logic or SQL is defined
                    res.status(400).json({ error: 'No business logic or SQL query defined for this endpoint.' });
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
