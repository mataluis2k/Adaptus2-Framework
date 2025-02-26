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
  },
  /**
   * Validates gender: must be one of ["male", "female", "nonbinary"]
   */
  gender: (schema, value, key) => {
    return schema.valid('male', 'female', 'nonbinary').messages({
      'any.only': `${key} must be one of: male, female, nonbinary.`
    });
  },

  /**
   * Validates an ISO 3166-1 alpha-2 country code.
   */
  countryCode: (schema, value, key) => {
    const countryCodes = [
      "AF", "AX", "AL", "DZ", "AS", "AD", "AO", "AI", "AQ", "AG", "AR", "AM", "AW", "AU", "AT", "AZ",
      "BS", "BH", "BD", "BB", "BY", "BE", "BZ", "BJ", "BM", "BT", "BO", "BQ", "BA", "BW", "BV", "BR",
      "IO", "BN", "BG", "BF", "BI", "CV", "KH", "CM", "CA", "KY", "CF", "TD", "CL", "CN", "CX", "CC",
      "CO", "KM", "CG", "CD", "CK", "CR", "CI", "HR", "CU", "CW", "CY", "CZ", "DK", "DJ", "DM", "DO",
      "EC", "EG", "SV", "GQ", "ER", "EE", "ET", "FK", "FO", "FJ", "FI", "FR", "GF", "PF", "TF", "GA",
      "GM", "GE", "DE", "GH", "GI", "GR", "GL", "GD", "GP", "GU", "GT", "GG", "GN", "GW", "GY", "HT",
      "HM", "VA", "HN", "HK", "HU", "IS", "IN", "ID", "IR", "IQ", "IE", "IM", "IL", "IT", "JM", "JP",
      "JE", "JO", "KZ", "KE", "KI", "KP", "KR", "KW", "KG", "LA", "LV", "LB", "LS", "LR", "LY", "LI",
      "LT", "LU", "MO", "MK", "MG", "MW", "MY", "MV", "ML", "MT", "MH", "MQ", "MR", "MU", "YT", "MX",
      "FM", "MD", "MC", "MN", "ME", "MS", "MA", "MZ", "MM", "NA", "NR", "NP", "NL", "NC", "NZ", "NI",
      "NE", "NG", "NU", "NF", "MP", "NO", "OM", "PK", "PW", "PS", "PA", "PG", "PY", "PE", "PH", "PN",
      "PL", "PT", "PR", "QA", "RE", "RO", "RU", "RW", "BL", "SH", "KN", "LC", "MF", "PM", "VC", "WS",
      "SM", "ST", "SA", "SN", "RS", "SC", "SL", "SG", "SX", "SK", "SI", "SB", "SO", "ZA", "GS", "SS",
      "ES", "LK", "SD", "SR", "SJ", "SE", "CH", "SY", "TW", "TJ", "TZ", "TH", "TL", "TG", "TK", "TO",
      "TT", "TN", "TR", "TM", "TC", "TV", "UG", "UA", "AE", "GB", "US", "UM", "UY", "UZ", "VU", "VE",
      "VN", "VG", "VI", "WF", "EH", "YE", "ZM", "ZW"
    ];
    return schema.valid(...countryCodes).messages({
      'any.only': `${key} must be a valid ISO 3166-1 country code.`
    });
  },

  /**
   * Validates timezone using a predefined list from the IANA Time Zone Database.
   */
  timezone: (schema, value, key) => {
    const timezones = Intl.supportedValuesOf("timeZone");
    return schema.valid(...timezones).messages({
      'any.only': `${key} must be a valid IANA timezone.`
    });
  },

  /**
   * Platform validation: must be one of ["ios", "android", "web"].
   */
  platform: (schema, value, key) => {
    return schema.valid('ios', 'android', 'web').messages({
      'any.only': `${key} must be one of: ios, android, web.`
    });
  }
};

module.exports = validationMapping;
