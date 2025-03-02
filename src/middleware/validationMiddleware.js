// validationMiddleware.js
const Joi = require('joi');
const validationMapping = require('./validationMapping');
const { getApiConfig } = require('../modules/apiConfig');
const { getContext } = require('../modules/context');

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
 * Extracts the base route from a path.
 * @param {string} path - The full path.
 * @returns {string} - The base route.
 */
function getBaseRoute(path) {
  const basePath = process.env.BASE_PATH || '/api/';
  if (!path) return '';
  const segments = path.split('/').filter(Boolean);
  if (segments.length < 2) return '';
  return basePath + segments[1];
}

// --- Module-level variable to store the route validation config ---
let routeConfigMap = new Map();

/**
 * Updates the route validation configuration.
 * This function should be called whenever the API configuration is reloaded.
 * @param {Array} apiConfig - The new API configuration array.
 */
function updateValidationRules() {
  const apiConfig = getApiConfig();
  if (Array.isArray(apiConfig)) {
      routeConfigMap.clear();
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
      console.log('Validation rules updated.');
    } else {
      console.error('Invalid API configuration format.');
    }
}

/**
 * Creates a global validation middleware that handles all HTTP methods.
 * @returns {Function} Express middleware function.
 */
function createGlobalValidationMiddleware() {
  // In case updateValidationRules hasn’t been called yet, initialize from the current config.
  if (!routeConfigMap.size) {    
      updateValidationRules();
  }

  const middleware = function validationMiddleware(req, res, next) {
    try {
      const path = req.path || '';
      const method = req.method;
      const basePath = process.env.BASE_PATH || '/api/';

      // Remove the basePath from the path if present
      const trimmedPath = path.startsWith(basePath)
        ? path.substring(basePath.length)
        : path;
      
      // Split the trimmed path into segments
      const segments = trimmedPath.split('/').filter(Boolean);
      
      // The first segment is the route name (e.g., 'videos')
      const routeSegment = segments[0];
      // Reconstruct the base route lookup key (e.g., '/api/videos')
      const baseRoute = basePath + routeSegment;
      
      // Look up the current validation configuration for the route.
      const endpointConfig = routeConfigMap.get(baseRoute);
      
      // If no config exists or the method isn’t allowed, skip validation.
      if (!endpointConfig || !endpointConfig.allowMethods.includes(method)) {
        return next();
      }
      
      console.log(`Validating ${method} ${path} against rules for ${baseRoute}`);
      
      // Generate schema for the validation rules.
      const { schema, errorMapping } = generateValidationSchema(endpointConfig.validation);
      
      // Determine the key name for the ID (if defined in the keys array)
      const keyField = endpointConfig.keys && endpointConfig.keys.length > 0 ? endpointConfig.keys[0] : 'id';
      
      // Initialize the data object to validate.
      let dataToValidate = {};
      
      if (method === 'GET') {
        // If there's a second segment, consider it the optional key/ID parameter.
        const idParam = segments.length > 1 ? segments[1] : null;
        console.log(`Extracted route: ${routeSegment}, id parameter: ${idParam}`);
        
        // Only add the ID if it exists and there is a corresponding validation rule.
        if (idParam && endpointConfig.validation[keyField]) {
          if (endpointConfig.validation[keyField].type === 'number') {
            const numValue = Number(idParam);
            if (isNaN(numValue)) {
              return res.status(400).json({
                errors: [{
                  field: keyField,
                  message: `${keyField} must be a number`,
                  ...(errorMapping[keyField] || {})
                }]
              });
            }
            dataToValidate[keyField] = numValue;
          } else {
            dataToValidate[keyField] = idParam;
          }
        }
        
        // Merge any query parameters into the data to validate.
        Object.assign(dataToValidate, req.query || {});
      } else if (['POST', 'PUT', 'PATCH'].includes(method)) {
        dataToValidate = req.body || {};
        if(!dataToValidate) {
          dataToValidate = getContext('req').body || {};
        }
      }
      
      console.log('Data to validate:', dataToValidate);
      
      // Perform the validation.
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
    } catch (err) {
      console.error('Validation middleware error:', err);
      res.status(500).json({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  };

  // Optionally set a name and length for the middleware function.
  Object.defineProperty(middleware, 'name', { value: 'validationMiddleware' });
  Object.defineProperty(middleware, 'length', { value: 3 });

  return middleware;
}


module.exports = {
  createGlobalValidationMiddleware,
  updateValidationRules
};
