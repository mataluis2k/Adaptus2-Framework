/**
 * ModelHandlerFactory - Factory for creating model handlers based on model types
 * 
 * This factory manages the creation and retrieval of model handlers,
 * model architectures, and middleware handlers for different model types.
 */

const fs = require('fs');
const path = require('path');
const tf = require('@tensorflow/tfjs-node');

class ModelHandlerFactory {
    constructor(mlAnalytics) {
        this.mlAnalytics = mlAnalytics;
        this.initialize();
        this.registerModelHandler('rag', async (rows, endpoint, existingModel, analytics) => {
            console.log("RAG model: No training action required (handled by other architecture).");
            return null; // Or return existingModel if needed
          });
    }

    /**
     * Initialize the factory with all handlers
     */
    initialize() {
        // Dynamically load all model handlers
        this.loadModelHandlers();
        
        // Load model architectures only for the available model handlers
        this.loadModelArchitectures();
        
        // Dynamically load middleware handlers for available model handlers
        this.loadMiddlewareHandlers();
    }

    /**
     * Dynamically load all model handlers from the model_handlers folder.
     */
    loadModelHandlers() {
        this.modelHandlers = {};
        // Assuming model handlers are in the ../model_handlers folder relative to this file
        const handlersPath = path.join(__dirname, '../model_handlers');
        fs.readdirSync(handlersPath).forEach(file => {
            // Only process .js files that are not index.js
            if (file === 'index.js' || path.extname(file) !== '.js') return;
            // Use file name without extension as key (e.g., "sentiment" from "sentiment.js")
            const modelType = path.basename(file, '.js');
            try {
                this.modelHandlers[modelType] = require(path.join(handlersPath, file));
            } catch (err) {
                console.error(`Failed to load model handler for ${modelType}:`, err);
            }
        });
    }

    /**
     * Load TensorFlow.js model architectures for available model handlers.
     * Only include architectures for which a corresponding model handler exists.
     */
    loadModelArchitectures() {
        // Predefined architectures mapping
        const architectures = {
            prediction: (inputShape) => {
                const model = tf.sequential();
                model.add(tf.layers.dense({ units: 64, activation: 'relu', inputShape: [inputShape] }));
                model.add(tf.layers.dropout({ rate: 0.2 }));
                model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
                model.add(tf.layers.dense({ units: 1, activation: 'linear' }));
                model.compile({
                    optimizer: 'adam',
                    loss: 'meanSquaredError',
                    metrics: ['mae']
                });
                return model;
            },
            sentiment: (inputShape) => {
                const model = tf.sequential();
                model.add(tf.layers.dense({ units: 64, activation: 'relu', inputShape: [inputShape] }));
                model.add(tf.layers.dropout({ rate: 0.2 }));
                model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
                model.add(tf.layers.dense({ units: 1, activation: 'tanh' }));
                model.compile({
                    optimizer: 'adam',
                    loss: 'meanSquaredError',
                    metrics: ['accuracy']
                });
                return model;
            },
            recommendation: (inputShape) => {
                const model = tf.sequential();
                model.add(tf.layers.dense({ units: 128, activation: 'relu', inputShape: [inputShape] }));
                model.add(tf.layers.dropout({ rate: 0.3 }));
                model.add(tf.layers.dense({ units: 64, activation: 'relu' }));
                model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
                model.compile({
                    optimizer: 'adam',
                    loss: 'cosineProximity',
                    metrics: ['accuracy']
                });
                return model;
            },
            anomaly: (inputShape) => {
                const model = tf.sequential();
                // Encoder
                model.add(tf.layers.dense({ units: 64, activation: 'relu', inputShape: [inputShape] }));
                model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
                model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
                // Decoder
                model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
                model.add(tf.layers.dense({ units: 64, activation: 'relu' }));
                model.add(tf.layers.dense({ units: inputShape, activation: 'sigmoid' }));
                model.compile({
                    optimizer: 'adam',
                    loss: 'meanSquaredError'
                });
                return model;
            },
            churn: (inputShape) => {
                const model = tf.sequential();
                model.add(tf.layers.dense({ units: 128, activation: 'relu', inputShape: [inputShape] }));
                model.add(tf.layers.dropout({ rate: 0.3 }));
                model.add(tf.layers.dense({ units: 64, activation: 'relu' }));
                model.add(tf.layers.dropout({ rate: 0.2 }));
                model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
                model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));
                model.compile({
                    optimizer: 'adam',
                    loss: 'binaryCrossentropy',
                    metrics: ['accuracy']
                });
                return model;
            },
            segmentation: (inputShape, numSegments = 5) => {
                const model = tf.sequential();
                model.add(tf.layers.dense({ units: 128, activation: 'relu', inputShape: [inputShape] }));
                model.add(tf.layers.dropout({ rate: 0.25 }));
                model.add(tf.layers.dense({ units: 64, activation: 'relu' }));
                model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
                model.add(tf.layers.dense({ units: numSegments, activation: 'softmax' }));
                model.compile({
                    optimizer: 'adam',
                    loss: 'categoricalCrossentropy',
                    metrics: ['accuracy']
                });
                return model;
            },
            fraud: (inputShape) => {
                const model = tf.sequential();
                model.add(tf.layers.dense({ units: 256, activation: 'relu', inputShape: [inputShape] }));
                model.add(tf.layers.dropout({ rate: 0.4 }));
                model.add(tf.layers.dense({ units: 128, activation: 'relu' }));
                model.add(tf.layers.dropout({ rate: 0.3 }));
                model.add(tf.layers.dense({ units: 64, activation: 'relu' }));
                model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));
                model.compile({
                    optimizer: 'adam',
                    loss: 'binaryCrossentropy',
                    metrics: ['accuracy', 'precision', 'recall']
                });
                return model;
            },
            mql: (inputShape) => {
                const model = tf.sequential();
                model.add(tf.layers.dense({ units: 32, activation: 'relu', inputShape: [inputShape] }));
                model.add(tf.layers.dropout({ rate: 0.2 }));
                model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));
                model.compile({
                    optimizer: 'adam',
                    loss: 'binaryCrossentropy',
                    metrics: ['accuracy']
                });
                return model;
            },
            demandForecasting: (inputShape, timeSteps = 10, features = 1) => {
                const model = tf.sequential();
                model.add(tf.layers.lstm({
                    units: 50,
                    returnSequences: true,
                    inputShape: [timeSteps, features]
                }));
                model.add(tf.layers.dropout({ rate: 0.2 }));
                model.add(tf.layers.lstm({ units: 25, returnSequences: false }));
                model.add(tf.layers.dense({ units: 1 }));
                model.compile({
                    optimizer: 'adam',
                    loss: 'meanSquaredError',
                    metrics: ['mae']
                });
                return model;
            }
            // Add other model architectures as needed
        };

        // Activate architectures only for which a corresponding model handler was loaded.
        this.modelArchitectures = {};
        Object.keys(this.modelHandlers).forEach(modelType => {
            if (architectures[modelType]) {
                this.modelArchitectures[modelType] = architectures[modelType];
            }
        });
    }

    /**
     * Dynamically load middleware handlers from the middleware folder.
     * Only activate middleware for which a corresponding model handler exists.
     */
    loadMiddlewareHandlers() {
        this.middlewareHandlers = {};
        // Assuming middleware handlers are in a 'middleware' folder relative to this file
        const middlewarePath = path.join(__dirname, 'middleware');
        if (fs.existsSync(middlewarePath)) {
            fs.readdirSync(middlewarePath).forEach(file => {
                // Process only JavaScript files ending with _middleware.js
                if (!file.endsWith('_middleware.js')) return;
                // Extract model type from file name (e.g., "sentiment_middleware.js" → "sentiment")
                const modelType = file.replace('_middleware.js', '');
                // Only load middleware if a corresponding model handler is available
                if (this.modelHandlers[modelType]) {
                    try {
                        this.middlewareHandlers[modelType] = require(path.join(middlewarePath, file));
                    } catch (err) {
                        console.error(`Failed to load middleware for ${modelType}:`, err);
                    }
                }
            });
        }
    }

    /**
     * Get a model handler for a specific model type
     * 
     * @param {string} modelType - The type of model
     * @returns {Function|null} - The model handler function or null if not found
     */
    getModelHandler(modelType) {
        if (!this.modelHandlers[modelType]) {
            console.warn(`No handler found for model type: ${modelType}`);
            return null;
        }
        return this.modelHandlers[modelType];
    }

    /**
     * Get a model architecture for a specific model type
     * 
     * @param {string} modelType - The type of model
     * @returns {Function|null} - The model architecture function or null if not found
     */
    getModelArchitecture(modelType) {
        if (!this.modelArchitectures[modelType]) {
            console.warn(`No architecture found for model type: ${modelType}`);
            return null;
        }
        return this.modelArchitectures[modelType];
    }

    /**
     * Get a middleware handler for a specific model type
     * 
     * @param {string} modelType - The type of model
     * @returns {Function|null} - The middleware handler function or null if not found
     */
    getMiddlewareHandler(modelType) {
        if (!this.middlewareHandlers[modelType]) {
            console.warn(`No middleware handler found for model type: ${modelType}`);
            return null;
        }
        return this.middlewareHandlers[modelType];
    }

    /**
     * Register a new model handler
     * 
     * @param {string} modelType - The type of model
     * @param {Function} handler - The model handler function
     */
    registerModelHandler(modelType, handler) {
        this.modelHandlers[modelType] = handler;
    }

    /**
     * Register a new model architecture
     * 
     * @param {string} modelType - The type of model
     * @param {Function} architecture - The model architecture function
     */
    registerModelArchitecture(modelType, architecture) {
        this.modelArchitectures[modelType] = architecture;
    }

    /**
     * Register a new middleware handler
     * 
     * @param {string} modelType - The type of model
     * @param {Function} handler - The middleware handler function
     */
    registerMiddlewareHandler(modelType, handler) {
        this.middlewareHandlers[modelType] = handler;
    }
}

module.exports = ModelHandlerFactory;
