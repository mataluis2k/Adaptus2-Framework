const Joi = require('joi');

/**
 * Generates a Joi validation schema from the apiConfig validation rules.
 * @param {Object} validationRules - Validation rules from apiConfig.
 * @returns {Object} - Joi schema for validation.
 */
function generateValidationSchema(validationRules) {
    const schema = {};

    Object.entries(validationRules).forEach(([key, rules]) => {
        let fieldSchema;

        // Initialize schema based on rules
        if (rules.isValidEmail) {
            fieldSchema = Joi.string().email();
        } else {
            fieldSchema = Joi.any(); // Fallback for unspecified rules
        }

        // Apply additional rules
        if (rules.notEmpty) {
            fieldSchema = fieldSchema.required().not('').messages({
                'any.required': `${key} is required.`,
                'string.empty': `${key} cannot be empty.`
            });
        }

        if (rules.minLength) {
            if (fieldSchema.type === 'string') {
                fieldSchema = fieldSchema.min(rules.minLength).messages({
                    'string.min': `${key} must be at least ${rules.minLength} characters long.`
                });
            } else {
                console.error(`${key}: minLength validation is only applicable to string fields.`);
                //throw new Error(`${key}: minLength validation is only applicable to string fields.`);
            }
        }

        if (rules.isISO3166CountryCode) {
            if (fieldSchema.isJoi && fieldSchema._type === 'string') {
                fieldSchema = fieldSchema.pattern(/^[A-Z]{2}$/).messages({
                    'string.pattern.base': `${key} must be a valid ISO 3166-1 country code.`
                });
            } else {
                console.error(`${key}: isISO3166CountryCode validation is only applicable to string fields.`);
                
            }
        }

        if (rules.isEnum) {
            fieldSchema = fieldSchema.valid(...(rules.enumValues || [])).messages({
                'any.only': `${key} must be one of ${rules.enumValues.join(', ')}.`
            });
        }

        // Assign the field schema
        schema[key] = fieldSchema;
    });

    return Joi.object(schema);
}

/**
 * Middleware to validate incoming requests against apiConfig validation rules.
 * @param {Object} validationRules - Validation rules from apiConfig.
 */
function validationMiddleware(validationRules) {
    const schema = generateValidationSchema(validationRules);

    return (req, res, next) => {
        const data = req.method === 'GET' ? req.query : req.body;
        const { error } = schema.validate(data, { abortEarly: false }); // Validate all fields

        if (error) {
            return res.status(400).json({ error: error.details.map((e) => e.message) });
        }

        next();
    };
}

module.exports = validationMiddleware;
