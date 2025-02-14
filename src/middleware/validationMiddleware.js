const Joi = require('joi');
const validationMapping = require('./validationMapping');
const { getApiConfig } = require('../modules/apiConfig');

/**
 * Generates a Joi validation schema from the validation rules.
 * @param {Object} validationRules - Validation rules from apiConfig.
 * @returns {Object} - Joi schema for validation.
 */
function generateValidationSchema(validationRules) {
    const schemaObj = {};
    const errorMapping = {};
  
    Object.entries(validationRules).forEach(([key, rules]) => {
        // Start with a default schema
        let fieldSchema = Joi.any();
  
        // Process the 'type' first if it exists
        if (rules.type) {
            fieldSchema = validationMapping.type(fieldSchema, rules.type);
        }
  
        // Store error codes if they exist
        if (rules.errorCodes) {
            errorMapping[key] = rules.errorCodes;
        }
  
        // Process the rest of the rules
        for (const rule in rules) {
            if (rule === 'type' || rule === 'errorCodes') continue; // skip already processed
            if (validationMapping[rule]) {
                fieldSchema = validationMapping[rule](fieldSchema, rules[rule], key);
            } else {
                console.warn(`No mapping defined for rule: ${rule}`);
            }
        }
  
        schemaObj[key] = fieldSchema;
    });
  
    return {
        schema: Joi.object(schemaObj),
        errorMapping
    };
}

/**
 * Extracts the base route from a path
 * @param {string} path - The full path
 * @returns {string} - The base route
 */
function getBaseRoute(path) {
    const basePath = process.env.BASE_PATH || '';
    if (!path) return '';
    const segments = path.split('/').filter(Boolean);
    if (segments.length < 2) return '';
    return basePath + segments[1];
}

/**
 * Creates a global validation middleware that handles all HTTP methods
 * @returns {Function} Express middleware function
 */
function createGlobalValidationMiddleware() {
    // Create a map of routes to their endpoint configs for faster lookup
    const routeConfigMap = new Map();
    
    // Get the latest apiConfig
    const apiConfig = getApiConfig();
    
    if (!apiConfig || !Array.isArray(apiConfig)) {
        console.warn('Invalid or missing apiConfig. Validation middleware will be disabled.');
        return function noopMiddleware(req, res, next) { next(); };
    }

    // Store routes in the config map
    apiConfig.forEach(endpoint => {
        if (endpoint.validation && endpoint.route) {
            routeConfigMap.set(endpoint.route, {
                validation: endpoint.validation,
                allowMethods: endpoint.allowMethods || ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
                keys: endpoint.keys || []
            });
            console.log(`Registered validation for route: ${endpoint.route}`);
        }
    });

    // Create and return the middleware function
    const middleware = function validationMiddleware(req, res, next) {
        try {
            const path = req.path || '';
            const baseRoute = getBaseRoute(path);
            const method = req.method;

            // Find matching route config
            const endpointConfig = routeConfigMap.get(baseRoute);
            
            // If no config exists or method not allowed, skip validation
            if (!endpointConfig || !endpointConfig.allowMethods.includes(method)) {
                return next();
            }

            console.log(`Validating ${method} ${path} against rules for ${baseRoute}`);

            // Generate schema for the validation rules
            const { schema, errorMapping } = generateValidationSchema(endpointConfig.validation);
            
            // Get data to validate based on request method
            let dataToValidate = {};
            
            // For GET requests, validate both URL parameters and query parameters
            if (method === 'GET') {
                // Extract ID from URL parameters
                const segments = path.split('/').filter(Boolean);
                const idParam = segments[segments.length - 1];
                
                // If there's an ID parameter and id validation exists
                if (idParam && endpointConfig.validation.id) {
                    // Try to convert to number if the validation requires it
                    if (endpointConfig.validation.id.type === 'number') {
                        const numValue = Number(idParam);
                        if (isNaN(numValue)) {
                            return res.status(400).json({
                                errors: [{
                                    field: 'id',
                                    message: 'id must be a number',
                                    ...(errorMapping.id || {})
                                }]
                            });
                        }
                        dataToValidate.id = numValue;
                    } else {
                        dataToValidate.id = idParam;
                    }
                }
                
                // Add query parameters
                Object.assign(dataToValidate, req.query || {});
            } else if (['POST', 'PUT', 'PATCH'].includes(method)) {
                dataToValidate = req.body || {};
            }

            console.log('Data to validate:', dataToValidate);

            // Validate the data with strict type checking
            const { error } = schema.validate(dataToValidate, { 
                abortEarly: false,
                convert: false,
                allowUnknown: true
            });

            if (error) {
                console.log(`Validation failed for ${method} ${path}:`, error.details);
                const formattedErrors = error.details.map(detail => {
                    const field = detail.path[0];
                    const customCodes = errorMapping[field] || {};
                    return {
                        field,
                        message: detail.message,
                        ...customCodes
                    };
                });

                const httpCode = formattedErrors[0].httpCode || 400;
                return res.status(httpCode).json({ 
                    errors: formattedErrors,
                    method: method,
                    path: path
                });
            }

            next();
        } catch (error) {
            console.error('Validation middleware error:', error);
            res.status(500).json({ 
                error: 'Internal Server Error',
                message: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    };

    // Ensure the middleware is properly named and has the correct length
    Object.defineProperty(middleware, 'name', { value: 'validationMiddleware' });
    Object.defineProperty(middleware, 'length', { value: 3 });

    return middleware;
}

module.exports = createGlobalValidationMiddleware;
