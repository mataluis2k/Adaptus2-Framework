/**
 * Prediction Middleware Handler
 * 
 * Handles API requests for prediction models.
 * 
 * For a given API call, if a specific keyId is provided, this middleware fetches the corresponding
 * record from the database, processes its features using the same transformations used during training,
 * and returns a prediction (either a numerical value for regression or a binary prediction for classification).
 * 
 * When no keyId is provided, it returns an overview of the model configuration and evaluation statistics.
 * 
 * @param {string} table - Database table name.
 * @param {number|null} keyId - Optional ID to fetch a specific record for prediction.
 * @param {boolean} detailed - Whether to include detailed information (e.g. feature vector, model config, stats).
 * @param {Object} modelData - The trained prediction model data.
 * @param {Object} connection - Database connection.
 * @returns {Promise<Object>} - API response with prediction results or model overview.
 */
async function predictionMiddleware(table, keyId, detailed, modelData, connection) {
    try {
        // Return early if the model data contains an error
        if (modelData.error) {
            return { error: modelData.error };
        }

        // If keyId is provided, fetch the record and return a prediction
        if (keyId !== null) {
            const [records] = await connection.query(`SELECT * FROM ${table} WHERE id = ?`, [keyId]);
            if (!records || records.length === 0) {
                return { error: `Record with key ${keyId} not found`, status: 404 };
            }
            const record = records[0];

            // Use featureProcessors (stored during training) to transform record fields into a feature vector
            const featureProcessors = modelData.featureProcessors || [];
            const featureVector = featureProcessors.map(fp => {
                let val = record[fp.name];
                if (val === null || val === undefined || isNaN(val)) {
                    val = 0;
                } else {
                    val = Number(val);
                }
                // Apply same min-max scaling as in training
                if (fp.min === fp.max) {
                    return fp.scalingRange[0];
                }
                return fp.scalingRange[0] + ((val - fp.min) / (fp.max - fp.min)) * (fp.scalingRange[1] - fp.scalingRange[0]);
            });

            // Predict using the trained model (different logic for regression vs. classification)
            const task = modelData.config.task || "regression";
            let prediction;
            if (task === "regression") {
                prediction = modelData.model.predict(featureVector);
            } else if (task === "classification") {
                const probability = modelData.model.predict(featureVector);
                prediction = probability >= 0.5 ? 1 : 0;
            } else {
                return { error: `Unsupported prediction task: ${task}` };
            }

            if (detailed) {
                return {
                    key: keyId,
                    prediction,
                    featureVector,
                    modelConfig: modelData.config,
                    stats: modelData.stats,
                    lastUpdated: modelData.lastUpdated
                };
            } else {
                return {
                    key: keyId,
                    prediction
                };
            }
        } else {
            // No specific record requested; return an overview of the model
            return {
                config: modelData.config,
                stats: modelData.stats,
                lastUpdated: modelData.lastUpdated
            };
        }
    } catch (error) {
        console.error('Error in prediction middleware:', error);
        return { 
            error: 'Error processing prediction request',
            message: error.message,
            status: 500
        };
    }
}

module.exports = predictionMiddleware;