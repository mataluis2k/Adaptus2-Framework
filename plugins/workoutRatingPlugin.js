let dbFunctions = {};

module.exports = {
    name: 'workoutRatingPlugin',
    version: '1.0.0',

    initialize(dependencies) {
        console.log('Initializing workoutRatingPlugin...');
        const { customRequire, context } = dependencies;
        const responseBus = customRequire('../src/modules/response');
        const { globalContext, getContext } = customRequire('../src/modules/context');
        dbFunctions = customRequire('../src/modules/db');

        globalContext.actions.updateWorkoutRating = async (ctx, params) => {
            console.log("=======STARTING workoutRatingPlugin=======");
        
            // ctx.data.user might be present but need to make sure is not empty 
            
            if(!ctx.data.user || Object.keys(ctx.data.user).length === 0) {

                ctx.data.user = getContext('user');
                console.log("ctx.data.user:", ctx.data.user);
                
            }
        
            console.log("ctx.data:", ctx.data);

            const { data } = params;
            const response = await this.updateThumbsUp(ctx, data);
            
            responseBus.preventReset = true;
            responseBus.setResponse(200, 'Workout rating updated successfully', null, response, 'workoutRatingPlugin');
            
            ctx.data['response'] = response;
            
            console.log("response:", response);
            return { success: true, result: response, key: 'response' };
        };
    },

    async updateThumbsUp(ctx, params) {
        const dbConfig = this.getDbConfig(ctx);
        console.log(params);
      
        // Extract parameters.
        let { id, workout_id, thumbs_up } = params;
        thumbs_up = parseInt(thumbs_up, 10);
      
        // Validate thumbs_up is either 0 or 1.
        if (thumbs_up !== 0 && thumbs_up !== 1) {
          return this.errorResponse(400, "Invalid input: thumbs_up must be 0 or 1", 1001);
        }
      
        // Extract user_id from ctx.data.user (supporting either property name).
        let user_id = null;
        if (ctx.data && ctx.data.user) {
          user_id = ctx.data.user.id || ctx.data.user.user_id;
        }
        if (!user_id) {
          return this.errorResponse(400, "User ID not provided", 1004);
        }
      
        try {
          // If a valid id is provided, try to update.
          if (id) {
            id = parseInt(id, 10);
            if (!isNaN(id)) {
              const updateQuery = `
                UPDATE workout_ratings_v3
                SET thumbs_up = ?, updated_at = NOW()
                WHERE id = ?;
              `;
              const updateResult = await dbFunctions.query(dbConfig, updateQuery, [thumbs_up, id]);
              if (updateResult.affectedRows > 0) {
                // Update succeeded; fetch the updated record.
                const workoutRatingQuery = this.getWorkoutRatingQuery(id);
                const updatedRating = await dbFunctions.query(dbConfig, workoutRatingQuery);
                console.log("updatedRating:", updatedRating);
                return updatedRating.length > 0
                  ? updatedRating[0]
                  : this.errorResponse(404, "Workout rating not found", 1002);
              }
              // If update did not affect any rows, fall through to create new record.
              console.log("No record updated with provided id, proceeding to create a new record.");
            } else {
              console.log("Invalid id provided; proceeding to create a new record.");
            }
          }
      
          // If id is not provided or update didn't affect any rows,
          // we require workout_id to create a new record.
          if (!workout_id) {
            return this.errorResponse(400, "Invalid input: workout_id is required when id is not provided", 1001);
          }
          workout_id = parseInt(workout_id, 10);
          if (isNaN(workout_id)) {
            return this.errorResponse(400, "Invalid workout_id", 1001);
          }
      
          const insertQuery = `
            INSERT INTO workout_ratings_v3 (workout_id, thumbs_up, user_id, created_at, updated_at)
            VALUES (?, ?, ?, NOW(), NOW());
          `;
          const insertResult = await dbFunctions.query(dbConfig, insertQuery, [workout_id, thumbs_up, user_id]);
          if (insertResult.affectedRows === 0) {
            return this.errorResponse(500, "Failed to create new workout rating", 1005);
          }
          const newRatingId = insertResult.insertId;
          const workoutRatingQuery = this.getWorkoutRatingQuery(newRatingId);
          const newRating = await dbFunctions.query(dbConfig, workoutRatingQuery);
          console.log("newRating:", newRating);
          return newRating.length > 0
            ? newRating[0]
            : this.errorResponse(404, "Workout rating not found after insertion", 1002);
        } catch (error) {
          console.error("Error updating or creating workout rating:", error);
          return this.errorResponse(500, "Internal Server Error", 1003);
        }
      }
      ,      
    getWorkoutRatingQuery(ratingId) {
        return `
            SELECT id, user_id, workout_id, thumbs_up, created_at, updated_at
            FROM workout_ratings_v3
            WHERE id = ${ratingId};
        `;
    },

    errorResponse(status, message, errorCode) {
        return { success: false, status, message, errorCode };
    },

    getDbConfig(ctx) {
        let dbConfig = ctx.config || process.env.DB_CONFIG;
        if (!dbConfig) {
            throw new Error("Database configuration missing");
        }
        return dbConfig;
    },

    async cleanup() {
        console.log('Cleaning up workoutRatingPlugin...');
    },
};