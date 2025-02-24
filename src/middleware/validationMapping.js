const Joi = require('joi');

// Mapping functions: each function takes (schema, value, fieldName) and returns an updated schema.
const validationMapping = {
  /**
   * Sets the base type for the field.
   * Supported types: string, number, boolean, array, date.
   */
  type: (schema, value) => {
    switch (value) {
      case 'string':
        return Joi.string();
      case 'number':
        return Joi.number().strict(); 
      case 'boolean':
        return Joi.boolean();
      case 'array':
        return Joi.array();
      case 'date':
        return Joi.date();
      default:
        return schema;
    }
  },

  /**
   * Add validation when the type is Joi.number
   */
  number: (schema, value, key) => {
    return Joi.number().strict().messages({
      'number.base': `${key} must be a number.`,
    });
  },
  /**
   * Requires that a field is not empty.
   */
  notEmpty: (schema, value, key) => {
    if (value) {
      // For strings, an empty string is considered empty.
      return schema.required().messages({
        'any.required': `${key} is required.`,
        'string.empty': `${key} cannot be empty.`
      });
    }
    return schema;
  },

  /**
   * Enforces a minimum length on strings.
   */
  minLength: (schema, value, key) => {
    if (schema.describe().type === 'string') {
      return schema.min(value).messages({
        'string.min': `${key} must be at least ${value} characters long.`
      });
    }
    return schema;
  },

  /**
   * Enforces a maximum length on strings.
   */
  maxLength: (schema, value, key) => {
    if (schema.describe().type === 'string') {
      return schema.max(value).messages({
        'string.max': `${key} must be at most ${value} characters long.`
      });
    }
    return schema;
  },

  /**
   * Applies email validation.
   */
  isValidEmail: (schema, value, key) => {
    if (value && schema.describe().type === 'string') {
      return schema.email().messages({
        'string.email': `${key} must be a valid email address.`
      });
    }
    return schema;
  },

  /**
   * Validates an ISO 3166-1 country code (two uppercase letters).
   */
  isISO3166CountryCode: (schema, value, key) => {
    if (value && schema.describe().type === 'string') {
      return schema.pattern(/^[A-Z]{2}$/).messages({
        'string.pattern.base': `${key} must be a valid ISO 3166-1 country code.`
      });
    }
    return schema;
  },

  /**
   * Validates against a regular expression.
   * The value should be a string representation of the regex pattern.
   */
  regex: (schema, value, key) => {
    if (value && schema.describe().type === 'string') {
      return schema.pattern(new RegExp(value)).messages({
        'string.pattern.base': `${key} does not match the required pattern.`
      });
    }
    return schema;
  },

  /**
   * Validates that the value is one of the allowed values (enum).
   * The value should be an array of allowed values.
   */
  enum: (schema, value, key) => {
    if (Array.isArray(value) && value.length) {
      return schema.valid(...value).messages({
        'any.only': `${key} must be one of [${value.join(', ')}].`
      });
    }
    return schema;
  },

  /**
   * Enforces a minimum numeric value.
   */
  min: (schema, value, key) => {
    if (schema.describe().type === 'number') {
      return schema.min(value).messages({
        'number.min': `${key} must be greater than or equal to ${value}.`
      });
    }
    return schema;
  },

  /**
   * Enforces a maximum numeric value.
   */
  max: (schema, value, key) => {
    if (schema.describe().type === 'number') {
      return schema.max(value).messages({
        'number.max': `${key} must be less than or equal to ${value}.`
      });
    }
    return schema;
  },

  /**
   * Enforces a minimum date.
   * The value should be a date string or timestamp that can be parsed by Joi.date().
   */
  dateMin: (schema, value, key) => {
    if (schema.describe().type === 'date') {
      return schema.min(value).messages({
        'date.min': `${key} must be after ${value}.`
      });
    }
    return schema;
  },

  /**
   * Enforces a maximum date.
   * The value should be a date string or timestamp.
   */
  dateMax: (schema, value, key) => {
    if (schema.describe().type === 'date') {
      return schema.max(value).messages({
        'date.max': `${key} must be before ${value}.`
      });
    }
    return schema;
  },

  /**
   * Validates the minimum number of items in an array.
   */
  arrayMin: (schema, value, key) => {
    if (schema.describe().type === 'array') {
      return schema.min(value).messages({
        'array.min': `${key} must contain at least ${value} items.`
      });
    }
    return schema;
  },

  /**
   * Validates the maximum number of items in an array.
   */
  arrayMax: (schema, value, key) => {
    if (schema.describe().type === 'array') {
      return schema.max(value).messages({
        'array.max': `${key} must contain at most ${value} items.`
      });
    }
    return schema;
  },

  /**
   * Ensures all array items are unique.
   */
  uniqueItems: (schema, value, key) => {
    if (value && schema.describe().type === 'array') {
      return schema.unique().messages({
        'array.unique': `${key} must contain unique items.`
      });
    }
    return schema;
  },

  /**
   * Validates that a string is a valid URL.
   */
  isUrl: (schema, value, key) => {
    if (value && schema.describe().type === 'string') {
      return schema.uri().messages({
        'string.uri': `${key} must be a valid URL.`
      });
    }
    return schema;
  },

  /**
   * Validates that a string is a valid credit card number.
   */
  isCreditCard: (schema, value, key) => {
    if (value && schema.describe().type === 'string') {
      return schema.creditCard().messages({
        'string.creditCard': `${key} must be a valid credit card number.`
      });
    }
    return schema;
  }
};

module.exports = validationMapping;
