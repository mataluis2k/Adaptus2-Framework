let dbFunctions = {};
let baseURL;
let responseHelper;

const moment = require('moment');
const CONSTANTS = require('../modules/constants/email');

const gdprCountries = [
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES',
  'FI', 'FR', 'HR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT',
  'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'SE', 'IS', 'LI', 'NO'
];

module.exports = {
  name: 'deleteUserPlugin',
  version: '1.0.0',

  initialize(dependencies) {
    console.log('🔧 Initializing deleteUserPlugin...');
    const { customRequire, context } = dependencies;
    const { globalContext, getContext } = customRequire('../src/modules/context');
    responseHelper = customRequire('../src/modules/response');
    dbFunctions = customRequire('../src/modules/db');
    this.logoutHelper = require('./logoutPlugin');
    baseURL = process.env.BASE_URL || 'http://localhost:3000';
    console.log('✅ deleteUserPlugin initialized successfully');

    // Register global action for deleting a user.
    globalContext.actions.deleteUser = async (globalContext, params) => {
      console.log('🔄 Starting deleteUser action...');

      const req = getContext('req');
      const authHeader = req.headers?.authorization;
      const token = authHeader?.split(' ')[1];

      if (!token) {
        return this.setErrorResponse(globalContext, 401, "Authentication token is required", [1001]);
      }
      params.data.token = token;
      
      // If the ID is in query params but not in data, use it
      if (req.query && req.query.id && !params.data.id) {
        console.log('🔄 Using ID from query params:', req.query.id);
        params.data.id = req.query.id;
      }
      
      try {
        const result = await this.deleteUser(globalContext, params.data);
        console.log('💡 deleteUser function result:', result.status, result.message);
        
        // This approach uses the response helper directly
        responseHelper.setResponse(
          result.status || 200,
          result.message || "User deleted successfully",
          null,
          result.data || {},
          "deleteUserPlugin"
        );
        
        return result;
      } catch (error) {
        console.error('💥 Error in deleteUser action:', error.message, error.stack);
        return this.setErrorResponse(globalContext, 500, error.message || "An unexpected error occurred", [1001]);
      }
    };
  },
 
  async deleteUser(ctx, params) {
    try {
      console.log('📝 Starting deleteUser function...');

      const { id: passedUuid, token } = params;
      if (!passedUuid) {
        return this.setErrorResponse(ctx, 400, "User UUID is required", [1001]);
      }

      const tokenUser = ctx.data.user;
      if (!tokenUser || !tokenUser.id) {
        return this.setErrorResponse(ctx, 401, "Unauthorized: User not authenticated", [1001]);
      }

      const dbConfig = this.getDbConfig(ctx);

      let userRecord;
      try {
        const users = await dbFunctions.read(dbConfig, 'users_v2', { id: tokenUser.id });
        if (!users || users.length === 0) {
          return this.setErrorResponse(ctx, 404, "User not found", [1001]);
        }
        userRecord = users[0];
      } catch (error) {
        console.log('❌ Error fetching user record:', error.message);
        return this.setErrorResponse(ctx, 500, "Failed to retrieve user record", [1001]);
      }

      const originalEmail = userRecord.email;
      const userId = userRecord.id;
      
      // Delete user subscriptions
    //   try {
    //     await dbFunctions.query(dbConfig, `DELETE FROM subscriptions_v2 WHERE user_id = ?`, [userId]);
    //     console.log('✅ User subscriptions deleted');
    //   } catch (subError) {
    //     console.log('❌ Error deleting subscriptions:', subError.message);
    //     return this.setErrorResponse(ctx, 500, "Failed to delete user subscriptions", [1001]);
    //   }
      
      if (userRecord.uuid !== passedUuid) {
        console.log('❌ Error: UUID mismatch');
        console.log('🔍 UUID comparison:', {
          passedUuid: passedUuid,
          userUuid: userRecord.uuid,
          match: passedUuid === userRecord.uuid
        });
        return this.setErrorResponse(ctx, 403, "Forbidden: You can only delete your own account", [1001]);
      }

      let deleteMode;
      try {
        console.log('🌍 Checking user country:', userRecord.country_code);
        if (gdprCountries.includes(userRecord.country_code)) {
          console.log('🔒 GDPR country detected - performing hard delete');
          const deleteResult = await dbFunctions.delete(dbConfig, 'users_v2', { id: userId });
          if (!deleteResult || deleteResult.affectedRows === 0) {
            return this.setErrorResponse(ctx, 500, "Failed to delete user", [1001]);
          }
          deleteMode = 'hard';
          console.log('✅ Hard delete completed');
        } else {
          console.log('🔄 Non-GDPR country - performing soft delete');
          let prefixedEmail, exists;
          const randomString = () => Math.random().toString(36).substring(2, 10);
          do {
            prefixedEmail = `${randomString()}_${userRecord.email}`;
            const existingUsers = await dbFunctions.read(dbConfig, 'users_v2', { email: prefixedEmail });
            exists = existingUsers.length > 0;
          } while (exists);
          
          const now = moment().utc().format('YYYY-MM-DD HH:mm:ss');
          
          const updateResult = await dbFunctions.update(dbConfig, 'users_v2', { id: userId }, { email: prefixedEmail, deleted_at: now });
          if (!updateResult || updateResult.affectedRows === 0) {
            return this.setErrorResponse(ctx, 500, "Failed to soft-delete user", [1001]);
          }
          deleteMode = 'soft';
          console.log('✅ Soft delete completed');
        }
      } catch (error) {
        console.log('❌ Error during deletion process:', error.message);
        return this.setErrorResponse(ctx, 500, "Failed to delete user", [1001]);
      }

      // Send account deletion email
      try {
        await ctx.actions.sendMail(ctx, {
          data: {
            data: {
              to: originalEmail,
              subject: CONSTANTS.ACCOUNT_DELETED_SUBJECT,
              template: "account_deleted"
            }
          }
        });
        console.log('✅ Deletion email sent successfully');
      } catch (mailError) {
        console.log('❌ Error sending deletion email:', mailError.message);
        // Don't return error here as the user is already deleted
      }

      console.log('🚪 Logging out user...');
      this.logoutHelper.logout(ctx, { token });
      console.log('✅ User logged out successfully');

      // Prepare response data that will be passed back to the client
      const responseData = {
        message: "User deleted successfully",
        mode: deleteMode,
        id: userRecord.id,
        uuid: userRecord.uuid
      };

      // Return the response in a format the framework expects
      return {
        status: 200,
        message: "User deleted successfully",
        data: responseData,
        error: null
      };
    } catch (error) {
      console.error('❌ Unexpected error in deleteUser:', error.message, error.stack);
      return this.setErrorResponse(ctx, 500, "An unexpected error occurred", [1001]);
    }
  },

  getDbConfig(ctx) {
    let dbConfig = ctx.config || process.env.DB_CONFIG;
    if (!dbConfig) {
      console.log('❌ Error: Database configuration missing');
      throw new Error('Database configuration missing');
    }
    return dbConfig;
  },

  setErrorResponse(ctx, status, message, errorCode) {
    console.log(`❌ Error Response - Status: ${status}, Message: ${message}, Code: ${errorCode}`);
    
    // Set the error directly in responseHelper
    responseHelper.setResponse(
      status,
      message,
      errorCode,
      null,
      "deleteUserPlugin",
      false,
      errorCode
    );
    
    // Return an error response
    return {
      status: status,
      message: message,
      data: null,
      error: {
        message: message,
        code: errorCode
      }
    };
  }
};