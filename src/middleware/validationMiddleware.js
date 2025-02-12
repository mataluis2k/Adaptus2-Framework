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
        return (req, res, next) => next();
    }

    apiConfig.forEach(endpoint => {
        if (endpoint.validation && endpoint.route && endpoint.allowMethods) {
            routeConfigMap.set(endpoint.route, {
                validation: endpoint.validation,
                allowMethods: endpoint.allowMethods
            });
        }
    });

    return (req, res, next) => {
        // Get the route and method from the request
        const route = req.path;
        const method = req.method;
        
        // Get endpoint config for this route
        const endpointConfig = routeConfigMap.get(route);
        
        // If no config exists or method not allowed, skip validation
        if (!endpointConfig || !endpointConfig.allowMethods.includes(method)) {
            return next();
        }

        // Generate schema for the validation rules
        const { schema, errorMapping } = generateValidationSchema(endpointConfig.validation);
        
        // Get data based on request method
        let dataToValidate;
        switch (method) {
            case 'GET':
                dataToValidate = req.query;
                break;
            case 'POST':
            case 'PUT':
            case 'PATCH':
                dataToValidate = req.body;
                break;
            case 'DELETE':
                // For DELETE, we might want to validate URL parameters
                dataToValidate = req.params;
                break;
            default:
                // Skip validation for unsupported methods
                return next();
        }
        
        // Validate the data
        const { error } = schema.validate(dataToValidate, { abortEarly: false });
        
        if (error) {
            // Map each error detail to include custom error codes if available
            const formattedErrors = error.details.map(detail => {
                const field = detail.path[0];
                const customCodes = errorMapping[field] || {};
                return {
                    field,
                    message: detail.message,
                    ...customCodes
                };
            });

            // Use the first error's httpCode if available, otherwise default to 400
            const httpCode = formattedErrors[0].httpCode || 400;
            return res.status(httpCode).json({ 
                errors: formattedErrors,
                method: method,
                path: route
            });
        }

        next();
    };
}

module.exports = createGlobalValidationMiddleware;
