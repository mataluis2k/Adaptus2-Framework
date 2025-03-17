/**
 * @fileoverview Customer Lifetime Value Prediction Model
 * 
 * This handler implements a machine learning model to predict the lifetime value of customers.
 * It uses historical purchase data, engagement metrics, and customer attributes to forecast
 * the expected revenue a customer will generate throughout their relationship with the business.
 * 
 * @module model_handlers/customer_lifetime_value
 * @requires tensorflow/tfjs-node
 * @requires ml_utils
 */

const tf = require('@tensorflow/tfjs-node');
const consolelog = require('../modules/logger');
const { scale, oneHotEncode, handleMissingValues } = require('../modules/ml_utils');

/**
 * Main handler for training and updating Customer Lifetime Value prediction models
 * 
 * @async
 * @function handler
 * @param {Array<Object>} rows - Database rows containing customer data
 * @param {Object} endpoint - Endpoint configuration
 * @param {Object|null} existingModel - Existing model data for incremental training
 * @param {Object} mlAnalytics - ML Analytics instance for configuration access
 * @returns {Object} Trained model data with predictions and statistics
 */
async function handler(rows, endpoint, existingModel, mlAnalytics) {
    if (!rows || rows.length === 0) {
        consolelog.warn(`No data provided for CLV prediction in ${endpoint.dbTable}`);
        return null;
    }

    try {
        // Get configuration from merged endpoint config
        const mergedConfig = mlAnalytics.getMergedConfig(endpoint.dbTable);
        if (!mergedConfig) {
            throw new Error(`Missing configuration for ${endpoint.dbTable}`);
        }

        const {
            targetField = 'lifetime_value',
            predictionHorizon = 365, // days
            historyWindow = 180, // days
            minTransactions = 1,
            featureFields = [],
            testSplit = 0.2,
            epochs = 10,
            earlyStoppingPatience = 3
        } = mergedConfig?.clvConfig || {};

        // Validate target field existence
        if (!rows[0].hasOwnProperty(targetField)) {
            throw new Error(`Target field '${targetField}' not found in data`);
        }

        // Process and prepare data
        const { processedData, featureInfo, metaData } = processCustomerData(
            rows, 
            targetField, 
            featureFields, 
            endpoint,
            historyWindow,
            minTransactions
        );

        if (processedData.features.length === 0) {
            throw new Error('No valid features extracted for CLV prediction');
        }

        // Split data into training and testing sets
        const { trainData, testData } = splitTrainTest(processedData, testSplit);

        // Create and train model
        const model = await trainCLVModel(
            trainData, 
            testData, 
            featureInfo, 
            epochs, 
            earlyStoppingPatience
        );

        // Evaluate model and generate predictions
        const { evaluation, predictions } = await evaluateModel(model, testData, trainData);

        // If using incremental training, merge with existing model
        let finalModel = model;
        if (existingModel && existingModel.tfModel) {
            finalModel = await updateExistingModel(existingModel.tfModel, trainData, {
                epochs: Math.ceil(epochs / 2),
                batchSize: 32
            });
        }

        // Save model and return metadata
        const timestamp = new Date().toISOString();
        return {
            tfModel: finalModel,
            featureInfo,
            performance: evaluation,
            predictions: predictions.slice(0, 10), // Include sample predictions
            config: {
                targetField,
                predictionHorizon,
                historyWindow,
                minTransactions,
                featureFields: featureInfo.map(f => f.field)
            },
            statistics: {
                customers: processedData.features.length,
                averageLTV: metaData.averageLTV,
                minLTV: metaData.minLTV,
                maxLTV: metaData.maxLTV,
                medianLTV: metaData.medianLTV
            },
            timestamp
        };
    } catch (error) {
        consolelog.error(`Error in CLV prediction model for ${endpoint.dbTable}:`, error);
        return {
            error: error.message,
            message: "Failed to train CLV prediction model",
            timestamp: new Date().toISOString()
        };
    }
}

/**
 * Process customer data to prepare for model training
 * 
 * @function processCustomerData
 * @param {Array<Object>} rows - Raw customer data rows
 * @param {string} targetField - Field name containing the target value (CLV)
 * @param {Array<string>} featureFields - Optional specific fields to use as features
 * @param {Object} endpoint - Endpoint configuration with field access rules
 * @param {number} historyWindow - Number of days to consider for historical data
 * @param {number} minTransactions - Minimum transactions required to include a customer
 * @returns {Object} Processed data with features, targets, and feature info
 */
function processCustomerData(rows, targetField, featureFields, endpoint, historyWindow, minTransactions) {
    // Identify customer ID field
    const customerIdField = findCustomerIdField(rows, endpoint);
    
    // Group data by customer
    const customerGroups = groupByCustomer(rows, customerIdField);
    
    // Auto-detect feature fields if not specified
    let selectedFeatureFields = [...featureFields];
    if (selectedFeatureFields.length === 0) {
        selectedFeatureFields = autoDetectFeatureFields(rows, targetField, customerIdField);
    }
    
    const features = [];
    const targets = [];
    const customerIds = [];
    const featureInfo = [];
    const validTargets = [];
    
    // Process each feature field
    for (const field of selectedFeatureFields) {
        const fieldInfo = processFeatureField(rows, field, customerGroups);
        if (fieldInfo) {
            featureInfo.push(fieldInfo);
        }
    }
    
    // Extract RFM (Recency, Frequency, Monetary) metrics
    const rfmFeatures = extractRFMFeatures(customerGroups, historyWindow);
    featureInfo.push(...rfmFeatures.featureInfo);
    
    // Build feature vectors for each customer
    for (const [customerId, customerData] of Object.entries(customerGroups)) {
        // Filter customers with too few transactions
        if (customerData.length < minTransactions) {
            continue;
        }
        
        // Get target value (actual LTV)
        const targetValue = customerData[0][targetField];
        if (targetValue === undefined || targetValue === null || isNaN(targetValue)) {
            continue;
        }
        
        validTargets.push(targetValue);
        
        // Build feature vector
        const customerFeatures = [];
        
        // Add basic features
        for (const fieldInfo of featureInfo) {
            const fieldValues = customerData.map(row => row[fieldInfo.field]);
            const processedValue = processFieldValues(fieldValues, fieldInfo);
            
            if (Array.isArray(processedValue)) {
                customerFeatures.push(...processedValue);
            } else {
                customerFeatures.push(processedValue);
            }
        }
        
        // Add RFM features for this customer
        const customerRFM = rfmFeatures.customerFeatures[customerId];
        if (customerRFM) {
            customerFeatures.push(...Object.values(customerRFM));
        }
        
        features.push(customerFeatures);
        targets.push(targetValue);
        customerIds.push(customerId);
    }
    
    // Calculate statistical summaries
    const sortedTargets = [...validTargets].sort((a, b) => a - b);
    const metaData = {
        averageLTV: validTargets.reduce((sum, val) => sum + val, 0) / validTargets.length,
        minLTV: sortedTargets[0],
        maxLTV: sortedTargets[sortedTargets.length - 1],
        medianLTV: sortedTargets[Math.floor(sortedTargets.length / 2)]
    };
    
    return {
        processedData: {
            features,
            targets,
            customerIds
        },
        featureInfo,
        metaData
    };
}

/**
 * Find customer ID field in the data
 * 
 * @function findCustomerIdField
 * @param {Array<Object>} rows - Data rows
 * @param {Object} endpoint - Endpoint configuration
 * @returns {string} Customer ID field name
 */
function findCustomerIdField(rows, endpoint) {
    // Try to find from endpoint keys
    if (endpoint.keys && endpoint.keys.length > 0) {
        return endpoint.keys[0];
    }
    
    // Look for common customer ID field names
    const commonIdFields = ['customer_id', 'customerId', 'user_id', 'userId', 'id', 'client_id'];
    for (const field of commonIdFields) {
        if (rows[0].hasOwnProperty(field)) {
            return field;
        }
    }
    
    // Default to first field
    return Object.keys(rows[0])[0];
}

/**
 * Group data rows by customer ID
 * 
 * @function groupByCustomer
 * @param {Array<Object>} rows - Data rows
 * @param {string} customerIdField - Field name containing customer ID
 * @returns {Object} Grouped data by customer ID
 */
function groupByCustomer(rows, customerIdField) {
    const groups = {};
    
    for (const row of rows) {
        const customerId = row[customerIdField];
        if (customerId) {
            if (!groups[customerId]) {
                groups[customerId] = [];
            }
            groups[customerId].push(row);
        }
    }
    
    return groups;
}

/**
 * Auto-detect suitable feature fields
 * 
 * @function autoDetectFeatureFields
 * @param {Array<Object>} rows - Data rows
 * @param {string} targetField - Target field to exclude
 * @param {string} customerIdField - Customer ID field to exclude
 * @returns {Array<string>} Detected feature fields
 */
function autoDetectFeatureFields(rows, targetField, customerIdField) {
    // Fields to exclude from features
    const excludeFields = [
        targetField, 
        customerIdField, 
        'created_at', 
        'updated_at',
        'deleted_at'
    ];
    
    // Find numeric, boolean, and categorical fields
    return Object.keys(rows[0]).filter(field => {
        if (excludeFields.includes(field)) return false;
        
        const value = rows[0][field];
        return typeof value === 'number' || 
               typeof value === 'boolean' ||
               (typeof value === 'string' && value.length < 100); // Exclude long text fields
    });
}

/**
 * Process a specific feature field
 * 
 * @function processFeatureField
 * @param {Array<Object>} rows - Data rows
 * @param {string} field - Field name to process
 * @param {Object} customerGroups - Grouped data by customer
 * @returns {Object|null} Field info with processing details
 */
function processFeatureField(rows, field, customerGroups) {
    const values = rows.map(row => row[field]);
    const sampleValue = values.find(v => v !== null && v !== undefined);
    
    if (!sampleValue) return null;
    
    // Determine field type and processing method
    let fieldType, processor;
    
    if (typeof sampleValue === 'number') {
        fieldType = 'numeric';
        const cleanValues = handleMissingValues(values, 'mean');
        const { scaleParams } = scale(cleanValues, [0, 1]);
        
        processor = {
            type: fieldType,
            params: scaleParams,
            process: (values) => {
                const cleanValues = handleMissingValues(values, 'mean');
                return scale(cleanValues, [0, 1], scaleParams).scaled;
            }
        };
    } 
    else if (typeof sampleValue === 'boolean') {
        fieldType = 'boolean';
        processor = {
            type: fieldType,
            process: (values) => values.map(v => v ? 1 : 0)
        };
    }
    else if (typeof sampleValue === 'string') {
        // Check if it's a date
        if (!isNaN(Date.parse(sampleValue))) {
            fieldType = 'date';
            const dateValues = values.map(v => {
                if (!v) return null;
                return (new Date(v)).getTime() / (1000 * 60 * 60 * 24); // Days since epoch
            });
            
            const cleanValues = handleMissingValues(dateValues, 'mean');
            const { scaleParams } = scale(cleanValues, [0, 1]);
            
            processor = {
                type: fieldType,
                params: scaleParams,
                process: (values) => {
                    const dateValues = values.map(v => {
                        if (!v) return null;
                        return (new Date(v)).getTime() / (1000 * 60 * 60 * 24);
                    });
                    
                    const cleanValues = handleMissingValues(dateValues, 'mean');
                    return scale(cleanValues, [0, 1], scaleParams).scaled;
                }
            };
        } 
        else {
            // Categorical field
            fieldType = 'categorical';
            const uniqueValues = [...new Set(values.filter(Boolean))];
            
            processor = {
                type: fieldType,
                categories: uniqueValues,
                process: (values) => {
                    const results = [];
                    
                    for (const value of values) {
                        const { encoded } = oneHotEncode(value, uniqueValues);
                        results.push(encoded);
                    }
                    
                    // Average the one-hot vectors
                    const avgEncoded = Array(uniqueValues.length).fill(0);
                    for (const encoded of results) {
                        for (let i = 0; i < encoded.length; i++) {
                            avgEncoded[i] += encoded[i] / results.length;
                        }
                    }
                    
                    return avgEncoded;
                }
            };
        }
    }
    
    return {
        field,
        type: fieldType,
        processor
    };
}

/**
 * Process field values based on field info
 * 
 * @function processFieldValues
 * @param {Array} values - Field values to process
 * @param {Object} fieldInfo - Field info with processor
 * @returns {number|Array<number>} Processed values
 */
function processFieldValues(values, fieldInfo) {
    if (!fieldInfo.processor) return 0;
    
    const processor = fieldInfo.processor;
    
    if (processor.type === 'numeric' || processor.type === 'date') {
        // Use mean value for numeric/date fields
        const processed = processor.process(values);
        return Array.isArray(processed) 
            ? processed.reduce((sum, val) => sum + val, 0) / processed.length 
            : processed;
    } 
    else if (processor.type === 'boolean') {
        // Use proportion of true values
        const processed = processor.process(values);
        return processed.reduce((sum, val) => sum + val, 0) / processed.length;
    }
    else if (processor.type === 'categorical') {
        // Use the processor's averaging method
        return processor.process(values);
    }
    
    return 0;
}

/**
 * Extract RFM (Recency, Frequency, Monetary) features
 * 
 * @function extractRFMFeatures
 * @param {Object} customerGroups - Customer data grouped by ID
 * @param {number} historyWindow - Number of days to consider
 * @returns {Object} RFM features and info
 */
function extractRFMFeatures(customerGroups, historyWindow) {
    const customerFeatures = {};
    const now = new Date();
    
    // Find date field
    let dateField = null;
    const firstCustomerData = Object.values(customerGroups)[0];
    
    if (firstCustomerData && firstCustomerData.length > 0) {
        const possibleDateFields = ['order_date', 'transaction_date', 'purchase_date', 'date', 'created_at'];
        for (const field of possibleDateFields) {
            if (firstCustomerData[0].hasOwnProperty(field)) {
                dateField = field;
                break;
            }
        }
    }
    
    // Find monetary value field
    let monetaryField = null;
    const possibleMonetaryFields = ['amount', 'total', 'value', 'price', 'revenue', 'order_value'];
    
    if (firstCustomerData && firstCustomerData.length > 0) {
        for (const field of possibleMonetaryFields) {
            if (firstCustomerData[0].hasOwnProperty(field)) {
                monetaryField = field;
                break;
            }
        }
    }
    
    // Collect recency, frequency, monetary values
    const recencyValues = [];
    const frequencyValues = [];
    const monetaryValues = [];
    
    for (const [customerId, transactions] of Object.entries(customerGroups)) {
        // Sort transactions by date if date field exists
        let sortedTransactions = [...transactions];
        if (dateField) {
            sortedTransactions.sort((a, b) => new Date(b[dateField]) - new Date(a[dateField]));
        }
        
        // Calculate recency (days since last purchase)
        let recency = 365; // Default value
        if (dateField && sortedTransactions.length > 0) {
            const lastPurchaseDate = new Date(sortedTransactions[0][dateField]);
            recency = Math.max(0, Math.floor((now - lastPurchaseDate) / (1000 * 60 * 60 * 24)));
        }
        recencyValues.push(recency);
        
        // Calculate frequency (number of purchases)
        const frequency = transactions.length;
        frequencyValues.push(frequency);
        
        // Calculate monetary (average purchase value)
        let monetary = 0;
        if (monetaryField) {
            const values = transactions
                .map(t => t[monetaryField])
                .filter(v => v !== null && v !== undefined && !isNaN(v));
                
            if (values.length > 0) {
                monetary = values.reduce((sum, val) => sum + val, 0) / values.length;
            }
        }
        monetaryValues.push(monetary);
        
        customerFeatures[customerId] = {
            recency, 
            frequency, 
            monetary
        };
    }
    
    // Scale RFM values
    const { scaleParams: recencyParams } = scale(recencyValues, [0, 1]);
    const { scaleParams: frequencyParams } = scale(frequencyValues, [0, 1]);
    const { scaleParams: monetaryParams } = scale(monetaryValues, [0, 1]);
    
    // Scale all customer features
    for (const [customerId, features] of Object.entries(customerFeatures)) {
        customerFeatures[customerId] = {
            recency: scale([features.recency], [0, 1], recencyParams).scaled[0],
            frequency: scale([features.frequency], [0, 1], frequencyParams).scaled[0],
            monetary: scale([features.monetary], [0, 1], monetaryParams).scaled[0]
        };
    }
    
    return {
        customerFeatures,
        featureInfo: [
            {
                field: 'recency',
                type: 'numeric',
                processor: {
                    type: 'numeric',
                    params: recencyParams
                }
            },
            {
                field: 'frequency',
                type: 'numeric',
                processor: {
                    type: 'numeric',
                    params: frequencyParams
                }
            },
            {
                field: 'monetary',
                type: 'numeric',
                processor: {
                    type: 'numeric',
                    params: monetaryParams
                }
            }
        ]
    };
}

/**
 * Split data into training and testing sets
 * 
 * @function splitTrainTest
 * @param {Object} processedData - Processed data with features and targets
 * @param {number} testSplit - Fraction of data to use for testing
 * @returns {Object} Training and testing data sets
 */
function splitTrainTest(processedData, testSplit) {
    const { features, targets, customerIds } = processedData;
    const totalSamples = features.length;
    const testSize = Math.floor(totalSamples * testSplit);
    const trainSize = totalSamples - testSize;
    
    // Create indices and shuffle
    const indices = Array.from({ length: totalSamples }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    
    // Split into train and test sets
    const trainIndices = indices.slice(0, trainSize);
    const testIndices = indices.slice(trainSize);
    
    return {
        trainData: {
            features: trainIndices.map(i => features[i]),
            targets: trainIndices.map(i => targets[i]),
            customerIds: trainIndices.map(i => customerIds[i])
        },
        testData: {
            features: testIndices.map(i => features[i]),
            targets: testIndices.map(i => targets[i]),
            customerIds: testIndices.map(i => customerIds[i])
        }
    };
}

/**
 * Train CLV prediction model
 * 
 * @async
 * @function trainCLVModel
 * @param {Object} trainData - Training data
 * @param {Object} testData - Test data
 * @param {Array<Object>} featureInfo - Feature information
 * @param {number} epochs - Number of training epochs
 * @param {number} earlyStoppingPatience - Early stopping patience
 * @returns {Object} Trained TensorFlow.js model
 */
async function trainCLVModel(trainData, testData, featureInfo, epochs, earlyStoppingPatience) {
    // Create TensorFlow.js model
    const inputShape = trainData.features[0].length;
    const model = tf.sequential();
    
    // Add layers
    model.add(tf.layers.dense({ 
        units: 64, 
        activation: 'relu', 
        inputShape: [inputShape],
        kernelRegularizer: tf.regularizers.l2({ l2: 0.001 })
    }));
    model.add(tf.layers.dropout({ rate: 0.2 }));
    
    model.add(tf.layers.dense({ 
        units: 32, 
        activation: 'relu',
        kernelRegularizer: tf.regularizers.l2({ l2: 0.001 })
    }));
    model.add(tf.layers.dropout({ rate: 0.2 }));
    
    model.add(tf.layers.dense({ 
        units: 16, 
        activation: 'relu'
    }));
    
    // Output layer for regression
    model.add(tf.layers.dense({ 
        units: 1, 
        activation: 'linear' 
    }));
    
    // Compile model
    model.compile({
        optimizer: 'adam',
        loss: 'meanSquaredError',
        metrics: ['meanAbsoluteError']
    });
    
    // Convert data to tensors
    const xTrain = tf.tensor2d(trainData.features);
    const yTrain = tf.tensor2d(trainData.targets, [trainData.targets.length, 1]);
    const xTest = tf.tensor2d(testData.features);
    const yTest = tf.tensor2d(testData.targets, [testData.targets.length, 1]);
    
    // Setup callbacks
    const callbacks = [];
    if (earlyStoppingPatience > 0) {
        callbacks.push(tf.callbacks.earlyStopping({
            monitor: 'val_loss',
            patience: earlyStoppingPatience
        }));
    }
    
    // Train model
    await model.fit(xTrain, yTrain, {
        epochs,
        validationData: [xTest, yTest],
        callbacks,
        batchSize: 32,
        shuffle: true
    });
    
    // Clean up tensors
    xTrain.dispose();
    yTrain.dispose();
    xTest.dispose();
    yTest.dispose();
    
    return model;
}

/**
 * Evaluate model and generate predictions
 * 
 * @async
 * @function evaluateModel
 * @param {Object} model - TensorFlow.js model
 * @param {Object} testData - Test data
 * @param {Object} trainData - Training data (for reference)
 * @returns {Object} Evaluation metrics and predictions
 */
async function evaluateModel(model, testData, trainData) {
    // Convert to tensors
    const xTest = tf.tensor2d(testData.features);
    const yTest = tf.tensor2d(testData.targets, [testData.targets.length, 1]);
    
    // Evaluate model
    const evaluation = await model.evaluate(xTest, yTest);
    const mse = evaluation[0].dataSync()[0];
    const mae = evaluation[1].dataSync()[0];
    
    // Make predictions
    const predictionsTensor = model.predict(xTest);
    const predictionsArray = await predictionsTensor.array();
    
    // Calculate additional metrics
    const trueValues = testData.targets;
    const predictedValues = predictionsArray.map(p => p[0]);
    
    // Calculate R-squared
    const meanTrue = trueValues.reduce((a, b) => a + b, 0) / trueValues.length;
    const totalSumSquares = trueValues.reduce((sum, val) => sum + Math.pow(val - meanTrue, 2), 0);
    const residualSumSquares = trueValues.reduce((sum, val, i) => 
        sum + Math.pow(val - predictedValues[i], 2), 0);
    const rSquared = 1 - (residualSumSquares / totalSumSquares);
    
    // Calculate MAPE (Mean Absolute Percentage Error)
    let mape = 0;
    let validMapeCount = 0;
    for (let i = 0; i < trueValues.length; i++) {
        if (trueValues[i] !== 0) {
            mape += Math.abs((trueValues[i] - predictedValues[i]) / trueValues[i]);
            validMapeCount++;
        }
    }
    mape = (mape / validMapeCount) * 100; // Convert to percentage
    
    // Create sample predictions with actual values
    const predictions = testData.customerIds.map((id, i) => ({
        customerId: id,
        actual: testData.targets[i],
        predicted: predictedValues[i],
        error: testData.targets[i] - predictedValues[i],
        errorPercent: testData.targets[i] !== 0 
            ? ((predictedValues[i] - testData.targets[i]) / testData.targets[i]) * 100 
            : 0
    }));
    
    // Clean up tensors
    xTest.dispose();
    yTest.dispose();
    predictionsTensor.dispose();
    
    return {
        evaluation: {
            mse,
            rmse: Math.sqrt(mse),
            mae,
            rSquared,
            mape
        },
        predictions
    };
}

/**
 * Update existing model with new data
 * 
 * @async
 * @function updateExistingModel
 * @param {Object} existingModel - Existing TensorFlow.js model
 * @param {Object} trainData - New training data
 * @param {Object} config - Training configuration
 * @returns {Object} Updated model
 */
async function updateExistingModel(existingModel, trainData, config) {
    // Convert data to tensors
    const xTrain = tf.tensor2d(trainData.features);
    const yTrain = tf.tensor2d(trainData.targets, [trainData.targets.length, 1]);
    
    // Update the model with incremental training
    await existingModel.fit(xTrain, yTrain, {
        epochs: config.epochs,
        batchSize: config.batchSize,
        shuffle: true
    });
    
    // Clean up tensors
    xTrain.dispose();
    yTrain.dispose();
    
    return existingModel;
}

module.exports = handler;