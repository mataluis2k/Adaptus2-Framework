/**
 * Prediction Model Handler
 * 
 * Handles training and updating prediction models for regression/classification tasks.
 * The model is trained to predict a target variable (numerical for regression or categorical for classification)
 * based on a set of features extracted from the provided data rows.
 * 
 * Expected configuration (via mlAnalytics.getMergedConfig):
 * {
 *   predictionConfig: {
 *     task: "regression" | "classification", // Defaults to regression if not specified.
 *     targetField: "nameOfTargetField",       // Field to be predicted (must be present in each row).
 *     missingValueStrategy: "mean",             // (Optional) Strategy for missing values.
 *     scalingRange: [0, 1]                      // (Optional) Range to scale numeric features.
 *   }
 * }
 * 
 * @param {Array} rows - Array of data objects (each representing a row from the database)
 * @param {Object} endpoint - Endpoint configuration
 * @param {Object|null} existingModel - Previously trained model (if available) for incremental updates
 * @param {Object} mlAnalytics - MLAnalytics instance with configuration utilities
 * @returns {Promise<Object>} - An object containing the trained model, feature processors, configuration, evaluation statistics, and a timestamp.
 */
async function predictionHandler(rows, endpoint, existingModel, mlAnalytics) {
    try {
        // Retrieve configuration
        const mergedConfig = mlAnalytics.getMergedConfig(endpoint.dbTable);
        const {
            task = "regression",
            targetField,
            missingValueStrategy = 'mean',
            scalingRange = [0, 1]
        } = mergedConfig?.predictionConfig || {};

        if (!targetField) {
            throw new Error("Target field not specified in prediction configuration.");
        }

        // Preprocess data: extract features (all fields except target) and targets.
        const { features, targets, featureProcessors } = processPredictionData(rows, targetField, missingValueStrategy, scalingRange);

        let model;
        let stats = {};

        if (task === "regression") {
            model = trainRegressionModel(features, targets);
            stats = evaluateRegressionModel(model, features, targets);
        } else if (task === "classification") {
            model = trainClassificationModel(features, targets);
            stats = evaluateClassificationModel(model, features, targets);
        } else {
            throw new Error(`Unsupported prediction task: ${task}`);
        }

        return {
            model,
            featureProcessors,
            config: mergedConfig.predictionConfig,
            stats,
            lastUpdated: new Date().toISOString()
        };
    } catch (error) {
        console.error(`Error in prediction handler for ${endpoint.dbTable}:`, error);
        throw error;
    }
}

/**
 * Process data for prediction by extracting features and target values.
 * Features are scaled using min-max normalization.
 * 
 * @param {Array} rows - Array of data objects.
 * @param {string} targetField - The field to be predicted.
 * @param {string} missingValueStrategy - Strategy for handling missing values.
 * @param {Array} scalingRange - [min, max] range for scaling numeric features.
 * @returns {Object} - Contains features (2D array), targets (array), and featureProcessors (metadata for each feature).
 */
function processPredictionData(rows, targetField, missingValueStrategy, scalingRange) {
    if (!rows || rows.length === 0) {
        throw new Error("No data provided for prediction.");
    }
    // Determine feature names (all keys except the targetField)
    const featureNames = Object.keys(rows[0]).filter(field => field !== targetField);

    // Initialize stats for scaling (min & max per feature)
    const featureStats = {};
    featureNames.forEach(name => {
        featureStats[name] = { min: Infinity, max: -Infinity };
    });

    // First pass: compute min and max values for each feature
    rows.forEach(row => {
        featureNames.forEach(name => {
            const value = row[name];
            if (value !== null && value !== undefined && !isNaN(value)) {
                const num = Number(value);
                if (num < featureStats[name].min) featureStats[name].min = num;
                if (num > featureStats[name].max) featureStats[name].max = num;
            }
        });
    });

    // Scaling helper function
    function scaleValue(val, min, max, range) {
        if (min === max) return range[0];
        return range[0] + ((val - min) / (max - min)) * (range[1] - range[0]);
    }

    const features = [];
    const targets = [];
    // Process each row: scale feature values and extract target
    rows.forEach(row => {
        const featureVector = [];
        featureNames.forEach(name => {
            let val = row[name];
            if (val === null || val === undefined || isNaN(val)) {
                // For simplicity, default missing numeric values to 0
                val = 0;
            } else {
                val = Number(val);
            }
            const stats = featureStats[name];
            const scaled = scaleValue(val, stats.min, stats.max, scalingRange);
            featureVector.push(scaled);
        });
        features.push(featureVector);
        let target = row[targetField];
        if (target === null || target === undefined) {
            throw new Error(`Missing target value for row: ${JSON.stringify(row)}`);
        }
        // If the target is numeric, convert to a number
        if (!isNaN(target)) {
            target = Number(target);
        }
        targets.push(target);
    });

    // Prepare metadata for transforming new records in prediction middleware
    const featureProcessors = featureNames.map(name => ({
        name,
        min: featureStats[name].min,
        max: featureStats[name].max,
        scalingRange
    }));

    return { features, targets, featureProcessors };
}

/**
 * Calculate dot product of two vectors.
 * 
 * @param {Array} vec1 
 * @param {Array} vec2 
 * @returns {number}
 */
function dotProduct(vec1, vec2) {
    let sum = 0;
    for (let i = 0; i < vec1.length; i++) {
        sum += vec1[i] * vec2[i];
    }
    return sum;
}

/**
 * Train a simple linear regression model using gradient descent.
 * 
 * @param {Array} features - 2D array of input features.
 * @param {Array} targets - Array of target values.
 * @returns {Object} - Model parameters and a predict function.
 */
function trainRegressionModel(features, targets) {
    const numFeatures = features[0].length;
    let weights = new Array(numFeatures).fill(0);
    let bias = 0;
    const learningRate = 0.01;
    const iterations = 1000;
    const n = features.length;

    for (let iter = 0; iter < iterations; iter++) {
        let weightGradients = new Array(numFeatures).fill(0);
        let biasGradient = 0;
        for (let i = 0; i < n; i++) {
            const prediction = dotProduct(weights, features[i]) + bias;
            const error = prediction - targets[i];
            for (let j = 0; j < numFeatures; j++) {
                weightGradients[j] += error * features[i][j];
            }
            biasGradient += error;
        }
        // Update weights and bias
        for (let j = 0; j < numFeatures; j++) {
            weights[j] -= (learningRate * weightGradients[j]) / n;
        }
        bias -= (learningRate * biasGradient) / n;
    }
    return {
        weights,
        bias,
        /**
         * Predict target value for a given feature vector.
         * 
         * @param {Array} x - Feature vector.
         * @returns {number} - Predicted value.
         */
        predict: (x) => dotProduct(weights, x) + bias
    };
}

/**
 * Evaluate a regression model using Mean Squared Error (MSE).
 * 
 * @param {Object} model - The regression model.
 * @param {Array} features - 2D array of input features.
 * @param {Array} targets - Array of target values.
 * @returns {Object} - Evaluation statistics.
 */
function evaluateRegressionModel(model, features, targets) {
    let totalError = 0;
    for (let i = 0; i < features.length; i++) {
        const prediction = model.predict(features[i]);
        const error = prediction - targets[i];
        totalError += error * error;
    }
    const mse = totalError / features.length;
    return { mse };
}

/**
 * Sigmoid activation function.
 * 
 * @param {number} z 
 * @returns {number}
 */
function sigmoid(z) {
    return 1 / (1 + Math.exp(-z));
}

/**
 * Train a simple logistic regression model using gradient descent.
 * Assumes binary classification with target values 0 or 1.
 * 
 * @param {Array} features - 2D array of input features.
 * @param {Array} targets - Array of target labels.
 * @returns {Object} - Model parameters and a predict function returning probability.
 */
function trainClassificationModel(features, targets) {
    const numFeatures = features[0].length;
    let weights = new Array(numFeatures).fill(0);
    let bias = 0;
    const learningRate = 0.01;
    const iterations = 1000;
    const n = features.length;

    for (let iter = 0; iter < iterations; iter++) {
        let weightGradients = new Array(numFeatures).fill(0);
        let biasGradient = 0;
        for (let i = 0; i < n; i++) {
            const linearOutput = dotProduct(weights, features[i]) + bias;
            const prediction = sigmoid(linearOutput);
            const error = prediction - targets[i];
            for (let j = 0; j < numFeatures; j++) {
                weightGradients[j] += error * features[i][j];
            }
            biasGradient += error;
        }
        for (let j = 0; j < numFeatures; j++) {
            weights[j] -= (learningRate * weightGradients[j]) / n;
        }
        bias -= (learningRate * biasGradient) / n;
    }
    return {
        weights,
        bias,
        /**
         * Predict probability for a given feature vector.
         * 
         * @param {Array} x - Feature vector.
         * @returns {number} - Predicted probability (0 to 1).
         */
        predict: (x) => sigmoid(dotProduct(weights, x) + bias)
    };
}

/**
 * Evaluate a classification model using accuracy.
 * 
 * @param {Object} model - The classification model.
 * @param {Array} features - 2D array of input features.
 * @param {Array} targets - Array of target labels.
 * @returns {Object} - Evaluation statistics.
 */
function evaluateClassificationModel(model, features, targets) {
    let correct = 0;
    for (let i = 0; i < features.length; i++) {
        const probability = model.predict(features[i]);
        const predicted = probability >= 0.5 ? 1 : 0;
        if (predicted === targets[i]) correct++;
    }
    const accuracy = correct / features.length;
    return { accuracy };
}

module.exports = predictionHandler;
