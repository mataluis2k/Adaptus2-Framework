const Joi = require('joi');
const validationMapping = require('./validationMapping');
/**
 * Generates a Joi validation schema from the apiConfig validation rules.
 * @param {Object} validationRules - Validation rules from apiConfig.
 * @returns {Object} - Joi schema for validation.
 */
function generateValidationSchema(validationRules) {
    const schemaObj = {};
  
    Object.entries(validationRules).forEach(([key, rules]) => {
      // Start with a default schema. You might default to Joi.any(), then override it if a type is specified.
      let fieldSchema = Joi.any();
  
      // Process the 'type' first if it exists.
      if (rules.type) {
        fieldSchema = validationMapping.type(fieldSchema, rules.type);
      }
  
      // Process the rest of the rules.
      for (const rule in rules) {
        if (rule === 'type') continue; // already processed
        if (validationMapping[rule]) {
          fieldSchema = validationMapping[rule](fieldSchema, rules[rule], key);
        } else {
          console.warn(`No mapping defined for rule: ${rule}`);
        }
      }
  
      schemaObj[key] = fieldSchema;
    });
  
    return Joi.object(schemaObj);
  }
  

/**
 * Middleware to validate incoming requests against apiConfig validation rules.
 * @param {Object} validationRules - Validation rules from apiConfig.
 */
function validationMiddleware(validationRules) {
    const { schema, errorMapping } = generateValidationSchema(validationRules);
  
    return (req, res, next) => {
      const data = req.method === 'GET' ? req.query : req.body;
      const { error } = schema.validate(data, { abortEarly: false });
  
      if (error) {
        // Map each error detail to include custom error codes if available.
        const formattedErrors = error.details.map(detail => {
          // Assuming the field name is the first element in the error path.
          const field = detail.path[0];
          // Get custom error codes for this field if defined.
          const customCodes = errorMapping[field] || {};
          return {
            message: detail.message,
            ...customCodes
          };
        });
  
        // Use the first error's httpCode if available, otherwise default to 400.
        const httpCode = formattedErrors[0].httpCode || 400;
        return res.status(httpCode).json({ errors: formattedErrors });
      }
  
      next();
    };
  }
  
  

module.exports = validationMiddleware;
