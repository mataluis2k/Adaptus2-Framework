let dbFunctions = {};

module.exports = {
  name: "getFormPlugin",
  version: "1.0.0",

  initialize(dependencies) {
    console.log('Initializing getFormPlugin...');
    const { customRequire } = dependencies;
    const { globalContext } = customRequire('../src/modules/context');
    this.response = customRequire('../src/modules/response');
    dbFunctions = customRequire('../src/modules/db');
    
    // Load validation middleware
    const { createGlobalValidationMiddleware } = customRequire('../src/middleware/validationMiddleware');
    this.validationMiddleware = createGlobalValidationMiddleware();
    
    // Load dynamicUUID library
    const redis = customRequire('../src/modules/redisClient');
    this.dynamicUUID = customRequire('../src/modules/dynamicUUID')(redis);

    // Register global action
    globalContext.actions.getForm = async (ctx, params) => {
      return await this.getForm(ctx, params);
    };
  },

  async getForm(ctx, params) {
    try {
      console.log("Params is: ");
      console.log(params);

      const data = params.data || {};
      
      console.log("Data for validation: ", JSON.stringify(data));

      // Validate user ID from context
      const user_id = ctx.data.user?.id;
      if (!user_id) {
        return this.setErrorResponse(ctx, 401, "User Authentication required", 1000);
      }

      // Skip validation if no data is provided
      if (Object.keys(data).length > 0) {
        // Clean up data before validation
        const cleanData = this.sanitizeData(data);
        console.log("Sanitized data: ", JSON.stringify(cleanData));
        
        // We'll use the validation middleware schema format for validation
        const validationSchema = this.getValidationSchema(cleanData);
        const { error } = validationSchema.validate(cleanData, {
          abortEarly: false,
          convert: true, // Allow type conversion
          allowUnknown: true
        });
        
        if (error) {
          console.error("Validation error:", error.details);
          throw new Error(error.details[0].message);
        }
      }

      const dbConfig = this.getDbConfig(ctx);

      // Construct and execute query - now async
      const formQuery = await this.buildQuery(ctx, data);
      console.log("Executing query:", formQuery);
      const formResults = await dbFunctions.query(dbConfig, formQuery);
      console.log("Query returned", formResults.length, "results");

      if (formResults.length === 0) {
        return this.setErrorResponse(ctx, 400, "No forms found.", 1001);
      }

      // Ensure SECRET_SALT is available for UUID conversion
      const secretSalt = process.env.SECRET_SALT;
      if (!secretSalt) {
        throw new Error("SECRET_SALT environment variable is missing.");
      }

      console.log("Starting UUID conversion for", formResults.length, "results");
      
      try {
        // Convert numeric IDs to deterministic UUIDs using dynamicUUID library
        // Use Promise.all to ensure all conversions are complete before proceeding
         const convertedResults = await Promise.all(formResults.map(async (row) => {
          try {
            const uuid = this.dynamicUUID.generateDeterministicUUID("form_field_view", "id", row.id, secretSalt);
            console.log(`Converted ID ${row.id} to UUID ${uuid}`);
            
            // Store the mapping in Redis for future lookups
            await this.dynamicUUID.storeUUIDMapping("form_field_view", "id", row.id, uuid);
            
            return {
              ...row,
              id: uuid,
            };
          } catch (err) {
            console.error(`Error converting ID ${row.id} to UUID:`, err);
            // Return the original row if conversion fails
            return row;
          }
        }));
        
        console.log("UUID conversion complete, returning", convertedResults.length, "results");       
        return this.setSuccessResponse(ctx, convertedResults);        
      } catch (error) {
        console.error("Error during UUID conversion:", error);
        return this.setErrorResponse(ctx, 500, "Error processing results", 1002);
      }
    } catch (error) {
      console.error("Error in getForm:", error);
      return this.setErrorResponse(ctx, 400, error.message, 1001);
    }
  },

  // Sanitize data before validation
  sanitizeData(data) {
    const cleanData = { ...data };
    
    // Remove template literals and empty values
    Object.keys(cleanData).forEach(key => {
      if (cleanData[key] === `\${data.${key}}` || cleanData[key] === undefined || cleanData[key] === null) {
        delete cleanData[key];
      }
    });
    
    // Handle created_at specially
    if (cleanData.created_at) {
      try {
        // Try to parse the date to ensure it's valid
        const date = new Date(cleanData.created_at);
        if (!isNaN(date.getTime())) {
          // Convert to ISO string for consistent validation
          cleanData.created_at = date.toISOString();
        } else {
          // If invalid, remove it to avoid validation errors
          delete cleanData.created_at;
        }
      } catch (e) {
        // If there's an error parsing the date, remove it
        delete cleanData.created_at;
      }
    }
    
    return cleanData;
  },

  getValidationSchema(data) {
    const Joi = require('joi');
    
    // Create a schema based on the provided data
    const schemaObj = {};
    
    // Only add validation for fields that exist in the data
    if (data.id !== undefined) {
      schemaObj.id = Joi.string().required();
    }
    
    if (data.slug !== undefined) {
      schemaObj.slug = Joi.string().required();
    }
    
    if (data.name !== undefined) {
      schemaObj.name = Joi.string().required();
    }
    
    if (data.created_at !== undefined) {
      // More flexible date validation
      schemaObj.created_at = Joi.date().allow(null);
    }
    
    return Joi.object(schemaObj);
  },

  async buildQuery(ctx, data) {
    let query = `
      SELECT ffv.* FROM form_field_view ffv
      LEFT JOIN permissions p ON p.entity_type='users' AND p.entity_id=${ctx.data.user.id}
      LEFT JOIN abilities a ON a.id=p.ability_id
      WHERE ffv.ability_name IN ('public', a.name)
    `;

    const conditions = [];
    const data_safe = data || {};

    // If 'id' is provided and it's not the literal string "${data.id}",
    // convert it from UUID back to the original numeric ID.
    if (data_safe.id && data_safe.id !== "${data.id}") {
      const secretSalt = process.env.SECRET_SALT;
      if (!secretSalt) {
        throw new Error("SECRET_SALT environment variable is missing.");
      }

      try {
        // Use the dynamicUUID library to get the original ID - properly awaited
        const originalId = await this.dynamicUUID.getOriginalIdFromUUID("form_field_view", "id", data_safe.id);
        console.log(`originalId is: ${originalId}`);
        
        if (!originalId) {
          // If we can't find the ID in Redis, use a fallback query
          console.log("ID not found in Redis, using fallback query");
          return `
            SELECT ffv.* FROM form_field_view ffv
            LEFT JOIN permissions p ON p.entity_type='users' AND p.entity_id=${ctx.data.user.id}
            LEFT JOIN abilities a ON a.id=p.ability_id
            WHERE ffv.ability_name IN ('public', a.name)
            GROUP BY ffv.id;
          `;
        }
        
        conditions.push(`ffv.id = '${originalId}'`);
      } catch (err) {
        console.error("UUID conversion error:", err);
        // Instead of failing, use a fallback query
        console.log("Using fallback query without ID filter");
        return `
          SELECT ffv.* FROM form_field_view ffv
          LEFT JOIN permissions p ON p.entity_type='users' AND p.entity_id=${ctx.data.user.id}
          LEFT JOIN abilities a ON a.id=p.ability_id
          WHERE ffv.ability_name IN ('public', a.name)
          GROUP BY ffv.id;
        `;
      }
    }

    if (data_safe.slug && data_safe.slug !== "${data.slug}") {
      conditions.push(`ffv.ability_name = '${data_safe.slug}'`);
    }
    if (data_safe.name && data_safe.name !== "${data.name}") {
      conditions.push(`ffv.name = '${data_safe.name}'`);
    }
    if (data_safe.created_at && data_safe.created_at !== "${data.created_at}") {
      try {
        // Handle date comparison directly since we don't have the dateTimeHelper
        const date = new Date(data_safe.created_at);
        if (!isNaN(date.getTime())) {
          conditions.push(`ffv.created_at = '${date.toISOString().slice(0, 19).replace('T', ' ')}'`);
        } else {
          console.warn("Invalid date format for created_at, skipping this condition");
        }
      } catch (e) {
        console.warn("Error processing created_at date:", e.message);
      }
    }

    if (conditions.length > 0) {
      query += " AND " + conditions.join(" AND ");
    }

    query += " GROUP BY ffv.id;";
    return query;
  },

  getDbConfig(ctx) {
    return (
      ctx.config ||
      process.env.DB_CONFIG ||
      (() => {
        throw new Error("Database configuration is missing.");
      })()
    );
  },

  setSuccessResponse(ctx, results) {
    this.response.setResponse(200, "Forms fetched successfully", "", results, "getFormPlugin");
    return { success: true, result: results, key: "response", status: 200 };
  },

  setErrorResponse(ctx, status, message, errorCode) {
    const errorResponse = { success: false, status, message, errorCode };
    this.response.setResponse(status, message, null, errorResponse, "getFormPlugin");
    return errorResponse;
  },

  async cleanup() {
    console.log("Cleaning up getFormPlugin...");
  },
};
