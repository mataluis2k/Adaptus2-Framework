/**
 * MLAnalytics - Core Machine Learning module with modular architecture
 * 
 * This module provides a scalable framework for handling multiple ML model types
 * with a focus on separation of concerns, modularity, and maintainability.
 */

const fs = require('fs');
const path = require('path');
const schedule = require('node-schedule');
const tf = require('@tensorflow/tfjs-node');
const consolelog = require('../modules/logger');
const { getDbConnection } = require('../modules/db');
require('dotenv').config();

// Import model handlers
const ModelHandlerFactory = require('./factory');

class MLAnalytics {
    constructor(mainConfigPath = 'config/apiConfig.json', mlConfigPath = 'config/mlConfig.json') {
        // Model storage
        this.models = {};
        this.tfModels = {}; // TensorFlow.js models
        
        // Configuration
        this.mainConfigPath = path.resolve(process.cwd(), mainConfigPath);
        this.mlConfigPath = path.resolve(process.cwd(), mlConfigPath);
        this.mainConfig = [];
        this.mlConfig = {};
        consolelog.log('ML Analytics -> mainConfigPath:', this.mainConfigPath);
        // Paths for model storage
        this.modelsPath = path.join(process.cwd(), 'models');
        this.tfModelsPath = path.join(process.cwd(), 'models', 'tensorflow');
        
        // Create model directories if they don't exist
        this.initializeDirectories();
        
        // Initialize the model handler factory
        this.modelFactory = new ModelHandlerFactory(this);
    }

    /**
     * Initialize required directories
     */
    initializeDirectories() {
        [this.modelsPath, this.tfModelsPath].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
    }

    /**
     * Save a TensorFlow.js model to disk
     * 
     * @param {string} modelKey - Unique identifier for the model
     * @param {tf.LayersModel} model - TensorFlow.js model to save
     * @returns {Promise<void>}
     */
    async saveTFModel(modelKey, model) {
        try {
            const modelPath = `file://${path.join(this.tfModelsPath, modelKey)}`;
            await model.save(modelPath);
            consolelog.log(`TensorFlow.js model ${modelKey} saved successfully`);
        } catch (error) {
            console.error(`Error saving TensorFlow.js model ${modelKey}:`, error);
            throw error;
        }
    }

    /**
     * Load a TensorFlow.js model from disk
     * 
     * @param {string} modelKey - Unique identifier for the model
     * @returns {Promise<tf.LayersModel|null>} - The loaded model or null if not found
     */
    async loadTFModel(modelKey) {
        try {
            const modelPath = `file://${path.join(this.tfModelsPath, modelKey)}`;
            if (fs.existsSync(path.join(this.tfModelsPath, modelKey, 'model.json'))) {
                const model = await tf.loadLayersModel(modelPath);
                consolelog.log(`TensorFlow.js model ${modelKey} loaded successfully`);
                return model;
            }
        } catch (error) {
            console.error(`Error loading TensorFlow.js model ${modelKey}:`, error);
        }
        return null;
    }

    /**
     * Update a TensorFlow.js model with new data
     * 
     * @param {tf.LayersModel} model - TensorFlow.js model to update
     * @param {Object} newData - New data for training
     * @param {Object} config - Training configuration
     * @returns {Promise<tf.LayersModel>} - The updated model
     */
    async updateTFModel(model, newData, config = {}) {
        const { epochs = 5, batchSize = 32 } = config;
        
        // Convert data to tensors
        const inputTensor = tf.tensor2d(newData.inputs);
        const labelTensor = tf.tensor2d(newData.labels);

        try {
            // Train the model incrementally
            await model.fit(inputTensor, labelTensor, {
                epochs,
                batchSize,
                shuffle: true,
                callbacks: {
                    onEpochEnd: (epoch, logs) => {
                        consolelog.log(`Epoch ${epoch + 1}: loss = ${logs.loss.toFixed(4)}`);
                    }
                }
            });

            // Clean up tensors
            tf.dispose([inputTensor, labelTensor]);
            return model;
        } catch (error) {
            console.error('Error updating TensorFlow.js model:', error);
            // Clean up tensors on error
            tf.dispose([inputTensor, labelTensor]);
            throw error;
        }
    }

    /**
     * Create a new TensorFlow.js model
     * 
     * @param {string} modelType - Type of model to create
     * @param {number} inputShape - Input shape for the model
     * @returns {tf.LayersModel} - The created model
     */
    createTFModel(modelType, inputShape) {
        // Get model architecture from the factory
        const architecture = this.modelFactory.getModelArchitecture(modelType);
        if (!architecture) {
            throw new Error(`Unsupported model type: ${modelType}`);
        }
        return architecture(inputShape);
    }

    /**
     * Save model metadata to disk
     * 
     * @param {string} modelKey - Unique identifier for the model
     * @param {Object} modelData - Model metadata to save
     */
    saveModel(modelKey, modelData) {
        try {
            const modelPath = path.join(this.modelsPath, `${modelKey}.json`);
            fs.writeFileSync(modelPath, JSON.stringify(modelData), 'utf-8');
            consolelog.log(`Model ${modelKey} saved successfully to ${modelPath}`);
        } catch (error) {
            console.error(`Error saving model ${modelKey}:`, error);
            throw error;
        }
    }

    /**
     * Load model metadata from disk
     * 
     * @param {string} modelKey - Unique identifier for the model
     * @returns {Object|null} - The loaded model metadata or null if not found
     */
    loadModel(modelKey) {
        try {
            const modelPath = path.join(this.modelsPath, `${modelKey}.json`);
            if (fs.existsSync(modelPath)) {
                const modelData = JSON.parse(fs.readFileSync(modelPath, 'utf-8'));
                consolelog.log(`Model ${modelKey} loaded successfully`);
                return modelData;
            }
        } catch (error) {
            console.error(`Error loading model ${modelKey}:`, error);
        }
        return null;
    }

    /**
     * Load configuration files
     */
    loadConfig() {
        try {
            // Load main server configuration
            const mainData = fs.readFileSync(this.mainConfigPath, 'utf-8');
            this.mainConfig = JSON.parse(mainData);

            // Load ML-specific configuration
            const mlData = fs.readFileSync(this.mlConfigPath, 'utf-8');
            this.mlConfig = JSON.parse(mlData);
            
            consolelog.log('ML configuration loaded successfully:', this.mlConfig);
        } catch (error) {
            console.error('Error loading configurations:', error.message);
            throw new Error('Failed to load configurations');
        }
    }

    /**
     * Get merged configuration with defaults for a specific database table
     * 
     * @param {string} dbTable - Database table name
     * @returns {Object|null} - Merged configuration or null if not found
     */
    getMergedConfig(dbTable) {
        // Import utility for basic configuration
        const { getDefaultConfig } = require('../utils/config_utils');
        
        // Get default system-wide configuration
        const systemDefaults = getDefaultConfig();

        // Find the endpoint in the main configuration
        const mainEndpoint = this.mainConfig.find((ep) => ep.dbTable === dbTable);
        if (!mainEndpoint) {
            consolelog.warn(`Endpoint ${dbTable} not found in main configuration.`);
            return null;
        }

        // Layer the configurations:
        // 1. System defaults (lowest priority)
        // 2. Global defaults from mlConfig.default
        // 3. Table-specific config from mlConfig.endpoints[dbTable]
        // 4. Main endpoint config (highest priority)
        const mlEndpoint = this.mlConfig.endpoints?.[dbTable] || {};
        const defaultMLConfig = this.mlConfig.default || {};

        // Merge configurations
        const mergedConfig = {
            ...systemDefaults,
            ...defaultMLConfig,
            ...mlEndpoint,
            ...mainEndpoint
        };

        // Merge nested configurations
        Object.keys(systemDefaults).forEach(key => {
            if (typeof systemDefaults[key] === 'object' && !Array.isArray(systemDefaults[key])) {
                mergedConfig[key] = {
                    ...systemDefaults[key],
                    ...(defaultMLConfig[key] || {}),
                    ...(mlEndpoint[key] || {})
                };
            }
        });

        // Log the configuration being used
        consolelog.log(`Configuration for ${dbTable}:`, mergedConfig);

        return mergedConfig;
    }

    /**
     * Stream data in batches using cursor-based pagination with parallel processing
     * 
     * @param {Object} connection - Database connection
     * @param {string} dbTable - Database table name
     * @param {number} batchSize - Number of records to process in each batch
     * @param {Function} callback - Function to call for each batch
     * @returns {Promise<void>}
     */
    async streamDataInBatches(connection, dbTable, batchSize, callback) {
        try {
            const { ensureIndexExists, logTrainingMetrics } = require('./utils/db_utils');

            // Ensure index exists for efficient pagination
            await ensureIndexExists(connection, dbTable, 'idx_id_created', 'id, created_at');

            let lastId = 0;
            let lastCreatedAt = new Date(0).toISOString();
            let rows;
            let totalProcessed = 0;
            const startTime = Date.now();

            do {
                // Use both id and created_at for reliable pagination even with gaps
                [rows] = await connection.query(
                    `SELECT * FROM ${dbTable} 
                    WHERE (id > ? OR (id = ? AND created_at > ?))
                    ORDER BY id ASC, created_at ASC 
                    LIMIT ?`,
                    [lastId, lastId, lastCreatedAt, batchSize]
                );

                if (rows.length > 0) {
                    const lastRow = rows[rows.length - 1];
                    lastId = lastRow.id;
                    lastCreatedAt = lastRow.created_at;
                    
                    // Process rows in parallel using Promise.all
                    const batchPromises = [];
                    const subBatchSize = 100; // Sub-batch size for parallel processing
                    
                    for (let i = 0; i < rows.length; i += subBatchSize) {
                        const batch = rows.slice(i, i + subBatchSize);
                        batchPromises.push(callback(batch));
                    }
                    
                    await Promise.all(batchPromises).catch(error => {
                        console.error(`Error processing batch in ${dbTable}:`, error);
                        // Continue processing other batches even if one fails
                    });
                    
                    totalProcessed += rows.length;
                    
                    // Log progress and metrics
                    const elapsedTime = (Date.now() - startTime) / 1000;
                    const throughput = totalProcessed / elapsedTime;
                    
                    logTrainingMetrics(dbTable, {
                        batchSize,
                        recordsProcessed: totalProcessed,
                        elapsedTime,
                        throughput,
                        lastId,
                        lastCreatedAt
                    });
                    
                    consolelog.log(`Processed batch of ${rows.length} records from ${dbTable}, ` +
                              `total: ${totalProcessed}, throughput: ${throughput.toFixed(2)} records/sec`);
                }
            } while (rows && rows.length === batchSize);

            // Log final metrics
            const totalTime = (Date.now() - startTime) / 1000;
            logTrainingMetrics(dbTable, {
                status: 'completed',
                totalRecords: totalProcessed,
                totalTime,
                averageThroughput: totalProcessed / totalTime
            });
        } catch (error) {
            console.error(`Error streaming data from ${dbTable}:`, error);
            throw error;
        }
    }

    /**
     * Train models for all endpoints in the configuration
     * 
     * @returns {Promise<void>}
     */
    async trainModels(app) {
        if(!app.locals.ml_routes){
            app.locals.ml_routes = [];
        }
        consolelog.log('Training ML models...');
        for (const endpoint of this.mainConfig) {
            const { dbTable, mlmodel } = endpoint;
       

            if (!mlmodel || mlmodel.length === 0) {
                console.warn(`No ML models configured for endpoint ${endpoint.route}`);
                continue;
            }

            let connection;
            try {
                
                connection = await getDbConnection(endpoint);
                if (!connection) {
                    consolelog.error(`Failed to connect to database for ${endpoint.dbConnection}`);
                    continue;
                }

                const mergedConfig = this.getMergedConfig(dbTable);
                if (!mergedConfig) {
                    consolelog.warn(`Skipping training for ${dbTable} due to missing configuration.`);
                    continue;
                }

                const {
                    batchSize = 1000,
                    samplingRate = 0.0,
                    parallelProcessing = false,
                    incrementalTraining = false,
                } = mergedConfig;

                // Load existing models if available
                if (incrementalTraining) {
                    for (const modelType of mlmodel) {
                        
                        app.locals.ml_routes.push({"path":`/ml/${dbTable}/${modelType}/:id?`});
                        const modelKey = `${dbTable}_${modelType}`;
                        const existingModel = this.loadModel(modelKey);
                        if (existingModel) {
                            this.models[modelKey] = existingModel;
                            consolelog.log(`Loaded existing model for ${modelKey}`);
                        }
                    }
                }

                // Sampling logic
                if (samplingRate > 0) {
                    consolelog.log(`Sampling ${samplingRate * 100}% of data for ${dbTable}`);
                    const [rows] = await connection.query(
                        `SELECT * FROM ${dbTable} WHERE RAND() < ?`, 
                        [samplingRate]
                    );
                    await this.processRows(rows, mlmodel, endpoint, parallelProcessing, incrementalTraining);
                    continue; // Skip batch processing if sampling is enabled
                }

                // Stream data in batches using cursor-based pagination
             
                await this.streamDataInBatches(connection, dbTable, batchSize, 
                    async (rows) => {
                        consolelog.log(`Processing batch of ${rows.length} rows for ${dbTable}`);
                        await this.processRows(rows, mlmodel, endpoint, parallelProcessing, incrementalTraining);
                    }
                );

                // Save final model states
                for (const modelType of mlmodel) {
                    consolelog.log(`Saving models for ${dbTable}...`);
                    const modelKey = `${dbTable}_${modelType}`;
                    if (this.models[modelKey]) {
                        await this.saveModel(modelKey, this.models[modelKey]);
                    }
                }
            } catch (error) {
                consolelog.error(`Error training models for ${dbTable}:`, error.message);
            } finally {
                // Ensure the connection is released
                if (connection) {
                    try {
                        if (typeof connection.release === 'function') {
                            //await connection.release();
                          } else if (typeof connection.end === 'function') {
                          //  await connection.end();
                          }
                    } catch (error) {
                        console.error(`Error releasing connection for ${dbTable}:`, error);
                    }
                }
            }
        }
    }

    /**
     * Process a batch of rows for multiple model types
     * 
     * @param {Array} rows - Database rows
     * @param {Array} mlmodel - Array of model types to train
     * @param {Object} endpoint - Endpoint configuration
     * @param {boolean} parallelProcessing - Whether to process models in parallel
     * @param {boolean} incrementalTraining - Whether to do incremental training
     * @returns {Promise<void>}
     */
    async processRows(rows, mlmodel, endpoint, parallelProcessing, incrementalTraining) {
        try {
            if (parallelProcessing) {
                // Train models in parallel with proper error handling
                await Promise.all(
                    mlmodel.map((modelType) => 
                        this.trainModel(modelType, rows, endpoint, incrementalTraining)
                            .catch(error => {
                                console.error(`Error training ${modelType} model:`, error);
                                // Return error but don't fail the entire batch
                                return { error: error.message };
                            })
                    )
                );
            } else {
                // Train models sequentially
                for (const modelType of mlmodel) {
                    try {
                        await this.trainModel(modelType, rows, endpoint, incrementalTraining);
                    } catch (error) {
                        console.error(`Error training ${modelType} model:`, error);
                        // Continue with next model
                    }
                }
            }
        } catch (error) {
            console.error(`Error processing rows for ${endpoint.dbTable}:`, error);
            throw error;
        }
    }

    /**
     * Train a specific model type
     * 
     * @param {string} modelType - Type of model to train
     * @param {Array} rows - Database rows
     * @param {Object} endpoint - Endpoint configuration
     * @param {boolean} incrementalTraining - Whether to do incremental training
     * @returns {Promise<Object>} - The trained model
     */
    async trainModel(modelType, rows, endpoint, incrementalTraining) {
        try {
            const { dbTable } = endpoint;
            const modelKey = `${dbTable}_${modelType}`;

            // Load existing model if doing incremental training
            const existingModel = incrementalTraining ? this.models[modelKey] : null;

            // Get the appropriate handler from the factory
            const handler = this.modelFactory.getModelHandler(modelType);
            
            if (!handler) {
                console.warn(`Unsupported ML model type: ${modelType}`);
                return null;
            }

            // Train the model using the handler
            consolelog.log(`Training ${modelType} model for ${dbTable}...`, endpoint);

            const modelData = await handler(rows, endpoint, existingModel, this);
            
            // Store and save the model
            if (modelData) {
                this.models[modelKey] = modelData;
                await this.saveModel(modelKey, modelData);
            }
            
            return modelData;
        } catch (error) {
            console.error(`Error in trainModel for ${modelType}:`, error);
            throw error;
        }
    }

    /**
     * Create an Express middleware for exposing models via REST API
     * 
     * @returns {Function} - Express middleware function
     */
    middleware() {
        return async (req, res, next) => {
            let connection;
            
            try {
                // Extract the model key and optional key ID from the request path
                const pathParts = req.originalUrl.split('/').filter((part) => part !== '');
                if (pathParts.length < 3) {
                    return next();
                }

                // ml/articles/recommendation/1
                const table = pathParts[1]; // e.g., "articles"
                const model = pathParts[2]; // e.g., "recommendation"
                const keyId = pathParts[3] ? parseInt(pathParts[3], 10) : null; // e.g., "1"
                const detailed = req.query.detailed === 'true'; // Check if detailed response is requested

                const modelKey = `${table}_${model}`;
                const modelData = this.models[modelKey];
                
                if (!modelData) {
                    return res.status(404).json({ error: `Model not found for ${model}` });
                }

                // Get the middleware handler from the factory
                const middlewareHandler = this.modelFactory.getMiddlewareHandler(model);
                
                if (!middlewareHandler) {
                    return res.status(404).json({ error: `No handler found for model type ${model}` });
                }
                
                // Find the endpoint config
                const endpoint = this.mainConfig.find(ep => ep.dbTable === table);
                if (!endpoint) {
                    return res.status(500).json({ error: `Configuration not found for table ${table}` });
                }

                // Get database connection
                connection = await getDbConnection(endpoint);
                if (!connection) {
                    return res.status(500).json({ error: 'Database connection failed' });
                }

                // Call the appropriate middleware handler
                const response = await middlewareHandler(table, keyId, detailed, modelData, connection);
                
                return res.json(response);
            } catch (error) {
                console.error('Error in ML middleware:', error);
                return res.status(500).json({ error: 'Internal server error', message: error.message });
            } finally {
                // Always release the connection
                if (connection) {
                    try {
                        if (typeof connection.release === 'function') {
                            // await connection.release();
                          } else if (typeof connection.end === 'function') {
                            await connection.end();
                          }
                    } catch (error) {
                        console.error('Error releasing database connection:', error);
                    }
                }
            }
        };
    }

    /**
     * Schedule periodic model training
     */
    scheduleTraining(cronExpression = '0 0 * * *') {
        schedule.scheduleJob(cronExpression, () => {
            consolelog.log('Starting periodic model training...');
            this.trainModels().catch(error => {
                consolelog.error('Error during scheduled training:', error);
            });
        });
    }
}

module.exports = MLAnalytics;