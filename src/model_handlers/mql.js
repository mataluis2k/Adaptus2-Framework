/**
 * MQL (Marketing Qualified Lead) Model Handler
 *
 * Trains a simple classification model to predict if a lead is marketing qualified.
 */

const tf = require('@tensorflow/tfjs-node');

/**
 * Train or update an MQL prediction model
 *
 * @param {Array} rows - Database rows containing lead data
 * @param {Object} endpoint - Endpoint configuration
 * @param {Object|null} existingModel - Existing model data for incremental training
 * @param {Object} mlAnalytics - Reference to the MLAnalytics instance
 * @returns {Object} - The trained MQL model metadata
 */
async function mqlHandler(rows, endpoint, existingModel, mlAnalytics) {
    try {
        const mergedConfig = mlAnalytics.getMergedConfig(endpoint.dbTable);
        const {
            targetField = 'is_mql',
            featureFields = [],
            epochs = 10,
            batchSize = 32
        } = mergedConfig?.mqlConfig || {};

        if (!rows || rows.length === 0) {
            throw new Error(`No data provided for ${endpoint.dbTable}`);
        }

        // Determine which fields to use as features
        const features = featureFields.length > 0
            ? featureFields
            : Object.keys(rows[0]).filter(f => f !== targetField && typeof rows[0][f] === 'number');

        if (features.length === 0) {
            throw new Error('No numeric feature fields found for MQL model');
        }

        const inputs = [];
        const labels = [];

        for (const row of rows) {
            if (row[targetField] === undefined || row[targetField] === null) {
                continue;
            }
            inputs.push(features.map(f => parseFloat(row[f]) || 0));
            labels.push(row[targetField] ? 1 : 0);
        }

        if (inputs.length === 0) {
            throw new Error(`No rows with target field ${targetField}`);
        }

        const inputTensor = tf.tensor2d(inputs);
        const labelTensor = tf.tensor2d(labels, [labels.length, 1]);

        const modelKey = `${endpoint.dbTable}_mql`;
        let model = existingModel && mlAnalytics.tfModels[modelKey];

        if (model) {
            model = await mlAnalytics.updateTFModel(model, { inputs, labels }, { epochs, batchSize });
        } else {
            model = mlAnalytics.createTFModel('mql', features.length);
            await model.fit(inputTensor, labelTensor, { epochs, batchSize });
        }

        await mlAnalytics.saveTFModel(modelKey, model);
        mlAnalytics.tfModels[modelKey] = model;

        const preds = model.predict(inputTensor).greater(tf.scalar(0.5));
        const correctTensor = preds.equal(labelTensor);
        const accuracy = correctTensor.mean().arraySync();

        tf.dispose([inputTensor, labelTensor, preds, correctTensor]);

        return {
            modelType: 'mql',
            features,
            config: { targetField, featureFields: features, epochs, batchSize },
            accuracy,
            lastUpdated: new Date().toISOString()
        };
    } catch (error) {
        console.error(`Error in MQL handler for ${endpoint.dbTable}:`, error);
        throw error;
    }
}

module.exports = mqlHandler;
