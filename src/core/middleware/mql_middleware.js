/**
 * MQL Prediction Middleware Handler
 *
 * Provides API access to MQL prediction models.
 */

const tf = require('@tensorflow/tfjs-node');
const fs = require('fs');
const path = require('path');

/**
 * Handle MQL prediction requests
 *
 * @param {string} table - Database table name
 * @param {number|null} keyId - Optional ID for a specific record
 * @param {boolean} detailed - Whether to include detailed information
 * @param {Object} modelData - Model metadata saved by the handler
 * @param {Object} connection - Database connection
 * @returns {Promise<Object>} - API response
 */
async function mqlMiddleware(table, keyId, detailed, modelData, connection) {
    try {
        if (modelData.error) {
            return { error: modelData.error };
        }

        const modelDir = path.join(process.cwd(), 'models', 'tensorflow', `${table}_mql`);
        const modelFile = path.join(modelDir, 'model.json');
        if (!fs.existsSync(modelFile)) {
            return { error: 'Model file not found' };
        }
        const modelPath = `file://${modelFile}`;
        const model = await tf.loadLayersModel(modelPath);

        if (keyId !== null) {
            const [records] = await connection.query(`SELECT * FROM ${table} WHERE id = ?`, [keyId]);
            if (!records || records.length === 0) {
                return { error: `Record ${keyId} not found`, status: 404 };
            }
            const record = records[0];
            const input = modelData.features.map(f => parseFloat(record[f]) || 0);
            const inputTensor = tf.tensor2d([input]);
            const prob = model.predict(inputTensor).arraySync()[0][0];
            tf.dispose(inputTensor);
            return { id: keyId, probability: prob, is_mql: prob >= 0.5 };
        }

        // Without keyId, return stats and configuration
        const response = { stats: { accuracy: modelData.accuracy }, config: modelData.config };

        if (detailed) {
            const [records] = await connection.query(`SELECT * FROM ${table}`);
            if (records && records.length > 0) {
                const inputs = records.map(r => modelData.features.map(f => parseFloat(r[f]) || 0));
                const inputTensor = tf.tensor2d(inputs);
                const probs = model.predict(inputTensor).arraySync().map(p => p[0]);
                tf.dispose(inputTensor);
                response.records = records.map((r, idx) => ({ ...r, probability: probs[idx], is_mql: probs[idx] >= 0.5 }));
            } else {
                response.records = [];
            }
        }

        return response;
    } catch (error) {
        console.error('Error in MQL middleware:', error);
        return { error: error.message };
    }
}

module.exports = mqlMiddleware;
