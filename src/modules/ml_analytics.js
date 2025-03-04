const fs = require('fs');
const path = require('path');
const schedule = require('node-schedule');
const natural = require('natural'); // Sentiment analysis
const { kmeans } = require('ml-kmeans'); // Correct import for KMeans
const tf = require('@tensorflow/tfjs-node'); // TensorFlow.js with Node.js backend
const consolelog = require('./logger');
const { DBSCAN } = require('density-clustering'); // Anomaly detection
const { getDbConnection } = require(path.join(__dirname,'db'));
require('dotenv').config();

// TensorFlow.js model architectures
const MODEL_ARCHITECTURES = {
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
    }
};

class MLAnalytics {
    constructor(mainConfigPath = 'config/apiConfig.json', mlConfigPath = 'config/mlConfig.json') {
        this.models = {};
        this.tfModels = {}; // TensorFlow.js models
        this.mainConfigPath = path.resolve(process.cwd(), mainConfigPath);
        this.mlConfigPath = path.resolve(process.cwd(), mlConfigPath);
        this.mainConfig = [];
        this.mlConfig = {};
        this.modelsPath = path.join(process.cwd(), 'models');
        this.tfModelsPath = path.join(process.cwd(), 'models', 'tensorflow');
        
        // Create model directories if they don't exist
        [this.modelsPath, this.tfModelsPath].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
    }

    // TensorFlow.js model management
    async saveTFModel(modelKey, model) {
        try {
            const modelPath = `file://${path.join(this.tfModelsPath, modelKey)}`;
            await model.save(modelPath);
            console.log(`TensorFlow.js model ${modelKey} saved successfully`);
        } catch (error) {
            console.error(`Error saving TensorFlow.js model ${modelKey}:`, error);
            throw error;
        }
    }

    async loadTFModel(modelKey) {
        try {
            const modelPath = `file://${path.join(this.tfModelsPath, modelKey)}`;
            if (fs.existsSync(path.join(this.tfModelsPath, modelKey, 'model.json'))) {
                const model = await tf.loadLayersModel(modelPath);
                console.log(`TensorFlow.js model ${modelKey} loaded successfully`);
                return model;
            }
        } catch (error) {
            console.error(`Error loading TensorFlow.js model ${modelKey}:`, error);
        }
        return null;
    }

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
                        console.log(`Epoch ${epoch + 1}: loss = ${logs.loss.toFixed(4)}`);
                    }
                }
            });

            // Clean up tensors
            inputTensor.dispose();
            labelTensor.dispose();

            return model;
        } catch (error) {
            console.error('Error updating TensorFlow.js model:', error);
            // Clean up tensors on error
            inputTensor.dispose();
            labelTensor.dispose();
            throw error;
        }
    }

    createTFModel(modelType, inputShape) {
        if (!MODEL_ARCHITECTURES[modelType]) {
            throw new Error(`Unsupported model type: ${modelType}`);
        }
        return MODEL_ARCHITECTURES[modelType](inputShape);
    }

    // Save model state to disk
    saveModel(modelKey, modelData) {
        try {
            const modelPath = path.join(this.modelsPath, `${modelKey}.json`);
            fs.writeFileSync(modelPath, JSON.stringify(modelData), 'utf-8');
            console.log(`Model ${modelKey} saved successfully`);
        } catch (error) {
            console.error(`Error saving model ${modelKey}:`, error);
        }
    }

    // Load model state from disk
    loadModel(modelKey) {
        try {
            const modelPath = path.join(this.modelsPath, `${modelKey}.json`);
            if (fs.existsSync(modelPath)) {
                const modelData = JSON.parse(fs.readFileSync(modelPath, 'utf-8'));
                console.log(`Model ${modelKey} loaded successfully`);
                return modelData;
            }
        } catch (error) {
            console.error(`Error loading model ${modelKey}:`, error);
        }
        return null;
    }

    /**
     * Load the ML configuration from the JSON file.
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
            consolelog.error('Error loading configurations:', error.message);
            throw new Error('Failed to load configurations');
        }
    }

    /**
     * Get merged configuration with sensible defaults for ML models
     */
    getMergedConfig(dbTable) {
        // System-wide defaults that apply if nothing is configured
        const systemDefaults = {
            // Global training defaults
            batchSize: 1000,
            samplingRate: 1.0,
            parallelProcessing: false,
            incrementalTraining: false,

            // Sentiment analysis defaults
            sentimentConfig: {
                language: 'English',
                textPreprocessing: true,
                minTextLength: 3,
                combineFields: false
            },

            // Recommendation system defaults
            recommendationConfig: {
                k: 3,
                scalingRange: [0, 1],
                minClusterSize: 2,
                missingValueStrategy: 'mean',
                weightedFields: {},
                similarityThreshold: 0.5
            },

            // Anomaly detection defaults
            anomalyConfig: {
                eps: 0.5,
                minPts: 2,
                scalingRange: [0, 1],
                missingValueStrategy: 'mean'
            }
        };

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

        const mergedConfig = {
            ...systemDefaults,
            ...defaultMLConfig,
            ...mlEndpoint,
            ...mainEndpoint,
            
            // Merge nested configurations
            sentimentConfig: {
                ...systemDefaults.sentimentConfig,
                ...(defaultMLConfig.sentimentConfig || {}),
                ...(mlEndpoint.sentimentConfig || {})
            },
            recommendationConfig: {
                ...systemDefaults.recommendationConfig,
                ...(defaultMLConfig.recommendationConfig || {}),
                ...(mlEndpoint.recommendationConfig || {})
            },
            anomalyConfig: {
                ...systemDefaults.anomalyConfig,
                ...(defaultMLConfig.anomalyConfig || {}),
                ...(mlEndpoint.anomalyConfig || {})
            }
        };

        // Log the configuration being used
        consolelog.log(`Configuration for ${dbTable}:`, {
            batchSize: mergedConfig.batchSize,
            samplingRate: mergedConfig.samplingRate,
            sentimentConfig: mergedConfig.sentimentConfig,
            recommendationConfig: mergedConfig.recommendationConfig,
            anomalyConfig: mergedConfig.anomalyConfig
        });

        return mergedConfig;
    }

    /**
     * Train models for all endpoints in the configuration.
     */
    // Stream data in batches using cursor-based pagination with parallel processing
    async streamDataInBatches(connection, dbTable, batchSize, callback) {
        const { ensureIndexExists, logTrainingMetrics } = require('./ml_utils');

        // Ensure index exists
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
                const batchSize = 100; // Sub-batch size for parallel processing
                
                for (let i = 0; i < rows.length; i += batchSize) {
                    const batch = rows.slice(i, i + batchSize);
                    batchPromises.push(callback(batch));
                }
                
                await Promise.all(batchPromises);
                
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
                
                console.log(`Processed batch of ${rows.length} records from ${dbTable}, ` +
                          `total: ${totalProcessed}, throughput: ${throughput.toFixed(2)} records/sec`);
            }
        } while (rows.length === batchSize);

        // Log final metrics
        const totalTime = (Date.now() - startTime) / 1000;
        logTrainingMetrics(dbTable, {
            status: 'completed',
            totalRecords: totalProcessed,
            totalTime,
            averageThroughput: totalProcessed / totalTime
        });
    }

    async trainModels() {
        for (const endpoint of this.mainConfig) {
            const { dbTable, mlmodel } = endpoint;

            if (!mlmodel || mlmodel.length === 0) {
                consolelog.warn(`No ML models configured for endpoint ${endpoint.route}`);
                continue;
            }

            const connection = await getDbConnection(endpoint);
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

            try {
                // Load existing models if available
                for (const modelType of mlmodel) {
                    const modelKey = `${dbTable}_${modelType}`;
                    if (incrementalTraining) {
                        const existingModel = this.loadModel(modelKey);
                        if (existingModel) {
                            this.models[modelKey] = existingModel;
                            console.log(`Loaded existing model for ${modelKey}`);
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
                console.log(`Training models for ${dbTable} in batches of ${batchSize}...`);
                await this.streamDataInBatches(connection, dbTable, batchSize, 
                    async (rows) => {
                        console.log(`Processing batch of ${rows.length} rows for ${dbTable}`);
                        await this.processRows(rows, mlmodel, endpoint, parallelProcessing, incrementalTraining);
                    }
                );

                // Save final model states
                for (const modelType of mlmodel) {
                    const modelKey = `${dbTable}_${modelType}`;
                    if (this.models[modelKey]) {
                        this.saveModel(modelKey, this.models[modelKey]);
                    }
                }
            } catch (error) {
                consolelog.error(`Error training models for ${dbTable}:`, error.message);
            }
        }
    }

    async processRows(rows, mlmodel, endpoint, parallelProcessing, incrementalTraining) {
        if (parallelProcessing) {
            // Train models in parallel
            await Promise.all(
                mlmodel.map((modelType) => this.trainModel(modelType, rows, endpoint, incrementalTraining))
            );
        } else {
            // Train models sequentially
            for (const modelType of mlmodel) {
                await this.trainModel(modelType, rows, endpoint, incrementalTraining);
            }
        }
    }
    

    /**
     * Train a specific model type.
     */
    updateSentimentModel(existingModel, rows, endpoint) {
        if (!existingModel || !existingModel.data) {
            return this.trainSentimentModel(rows, endpoint);
        }

        try {
            const newModel = this.trainSentimentModel(rows, endpoint);
            if (!newModel || newModel.error) {
                return existingModel;
            }

            // Merge data from both models
            const mergedData = [...existingModel.data, ...newModel.data];

            // Recalculate statistics
            const validSentiments = mergedData
                .filter(data => data.sentiment !== null)
                .map(data => data.sentiment);

            const stats = {
                total: mergedData.length,
                valid: validSentiments.length,
                avgSentiment: validSentiments.reduce((a, b) => a + b, 0) / validSentiments.length,
                distribution: {
                    positive: validSentiments.filter(s => s > 0).length,
                    neutral: validSentiments.filter(s => s === 0).length,
                    negative: validSentiments.filter(s => s < 0).length
                }
            };

            return {
                data: mergedData,
                stats,
                config: newModel.config // Use latest config
            };
        } catch (error) {
            console.error('Error in incremental sentiment update:', error);
            return existingModel; // Return existing model on error
        }
    }
    /**
     * Calculate similarity between two cluster centroids using cosine similarity
     * @param {Array} centroid1 - First centroid vector
     * @param {Array} centroid2 - Second centroid vector
     * @returns {number} Similarity score between 0 and 1
     */
    calculateClusterSimilarity(centroid1, centroid2) {
        // Calculate dot product
        const dotProduct = centroid1.reduce((sum, val, idx) => sum + val * centroid2[idx], 0);
        
        // Calculate magnitudes
        const magnitude1 = Math.sqrt(centroid1.reduce((sum, val) => sum + val * val, 0));
        const magnitude2 = Math.sqrt(centroid2.reduce((sum, val) => sum + val * val, 0));
        
        // Avoid division by zero
        if (magnitude1 === 0 || magnitude2 === 0) {
            return 0;
        }
        
        // Return cosine similarity
        return dotProduct / (magnitude1 * magnitude2);
    }

    updateRecommendationModel(existingModel, rows, endpoint) {
        if (!existingModel || !existingModel.clusters) {
            return this.trainRecommendationModel(rows, endpoint);
        }

        try {
            const newModel = this.trainRecommendationModel(rows, endpoint);
            if (!newModel || newModel.error) {
                return existingModel;
            }

            // Merge clusters from both models
            const mergedClusters = [...existingModel.clusters];

            // Add new points to existing clusters based on similarity
            newModel.clusters.forEach(newCluster => {
                const mostSimilarCluster = mergedClusters.reduce((best, cluster) => {
                    const similarity = this.calculateClusterSimilarity(newCluster.centroid, cluster.centroid);
                    return similarity > best.similarity ? { cluster, similarity } : best;
                }, { similarity: -1 }).cluster;

                if (mostSimilarCluster && mostSimilarCluster.similarity > newModel.config.similarityThreshold) {
                    // Update cluster with new points
                    mostSimilarCluster.points.push(...newCluster.points);
                    mostSimilarCluster.similarities.push(...newCluster.similarities);
                    mostSimilarCluster.size = mostSimilarCluster.points.length;

                    // Update centroid (weighted average)
                    const totalPoints = mostSimilarCluster.size;
                    mostSimilarCluster.centroid = mostSimilarCluster.centroid.map((val, idx) => {
                        const newVal = newCluster.centroid[idx];
                        return (val * (totalPoints - newCluster.size) + newVal * newCluster.size) / totalPoints;
                    });
                } else {
                    // Add as new cluster if no similar cluster found
                    mergedClusters.push(newCluster);
                }
            });

            return {
                clusters: mergedClusters,
                fieldProcessors: newModel.fieldProcessors, // Use latest processors
                config: newModel.config, // Use latest config
                stats: {
                    ...newModel.stats,
                    totalPoints: mergedClusters.reduce((sum, c) => sum + c.size, 0),
                    clusterSizes: mergedClusters.map(c => c.size),
                    averageSimilarity: mergedClusters.reduce(
                        (sum, c) => sum + c.similarities.reduce((a, b) => a + b, 0) / c.similarities.length,
                        0
                    ) / mergedClusters.length
                }
            };
        } catch (error) {
            console.error('Error in incremental recommendation update:', error);
            return existingModel; // Return existing model on error
        }
    }

    updateAnomalyModel(existingModel, rows, endpoint) {
        if (!existingModel || !existingModel.clusters) {
            return this.trainAnomalyModel(rows, endpoint);
        }

        try {
            const newModel = this.trainAnomalyModel(rows, endpoint);
            if (!newModel || newModel.error) {
                return existingModel;
            }

            // Merge clusters and anomalies
            const mergedClusters = [...existingModel.clusters];
            // Check if anomalies exists and is an array before spreading
            const mergedAnomalies = Array.isArray(existingModel.anomalies) ? [...existingModel.anomalies] : [];

            // Add new clusters if they're significantly different from existing ones
            newModel.clusters.forEach(newCluster => {
                const newClusterCenter = this.calculateClusterCenter(newCluster, newModel.processedData);
                const isUnique = !mergedClusters.some(existingCluster => {
                    const existingCenter = this.calculateClusterCenter(existingCluster, existingModel.processedData);
                    const distance = this.calculateEuclideanDistance(newClusterCenter, existingCenter);
                    return distance < existingModel.params.eps;
                });

                if (isUnique) {
                    mergedClusters.push(newCluster);
                }
            });

            // Add new anomalies, avoiding duplicates based on similarity
            if (Array.isArray(newModel.anomalies)) {
                newModel.anomalies.forEach(newAnomaly => {
                    const isDuplicate = mergedAnomalies.some(existingAnomaly => 
                        this.calculateEuclideanDistance(
                            newAnomaly.processedData,
                            existingAnomaly.processedData
                        ) < existingModel.params.eps
                    );

                    if (!isDuplicate) {
                        mergedAnomalies.push(newAnomaly);
                    }
                });
            }

            return {
                clusters: mergedClusters,
                fieldProcessors: newModel.fieldProcessors, // Use latest processors
                anomalies: mergedAnomalies,
                params: newModel.params, // Use latest parameters
                processedData: Array.isArray(existingModel.processedData) ? 
                    [...existingModel.processedData, ...newModel.processedData] : 
                    Array.isArray(newModel.processedData) ? [...newModel.processedData] : [],
                stats: {
                    totalPoints: (existingModel.stats?.totalPoints || 0) + (newModel.stats?.totalPoints || 0),
                    dimensions: newModel.stats?.dimensions,
                    numClusters: mergedClusters.length,
                    numAnomalies: mergedAnomalies.length,
                    anomalyPercentage: (mergedAnomalies.length / ((existingModel.stats?.totalPoints || 0) + (newModel.stats?.totalPoints || 0))) * 100 || 0
                }
            };
        } catch (error) {
            console.error('Error in incremental anomaly update:', error);
            return existingModel; // Return existing model on error
        }
    }

    calculateEuclideanDistance(point1, point2) {
        return Math.sqrt(
            point1.reduce((sum, val, idx) => sum + Math.pow(val - point2[idx], 2), 0)
        );
    }

    calculateClusterCenter(cluster, processedData) {
        const points = cluster.map(idx => processedData[idx]);
        const dimensions = points[0].length;
        return Array(dimensions).fill(0).map((_, dim) => 
            points.reduce((sum, point) => sum + point[dim], 0) / points.length
        );
    }

    trainModel(modelType, rows, endpoint, incrementalTraining) {
        const { dbTable } = endpoint;
        const modelKey = `${dbTable}_${modelType}`;

        // Load existing model if doing incremental training
        let existingModel = incrementalTraining ? this.models[modelKey] : null;

        switch (modelType) {
            case 'sentiment':
                if (existingModel) {
                    // Update existing sentiment model
                    this.models[modelKey] = this.updateSentimentModel(existingModel, rows, endpoint);
                } else {
                    // Train new sentiment model
                    this.models[modelKey] = this.trainSentimentModel(rows, endpoint);
                }
                break;
            case 'recommendation':
                if (existingModel) {
                    // Update existing recommendation model
                    this.models[modelKey] = this.updateRecommendationModel(existingModel, rows, endpoint);
                } else {
                    // Train new recommendation model
                    this.models[modelKey] = this.trainRecommendationModel(rows, endpoint);
                }
                break;
            case 'anomaly':
                if (existingModel) {
                    // Update existing anomaly model
                    this.models[modelKey] = this.updateAnomalyModel(existingModel, rows, endpoint);
                } else {
                    // Train new anomaly model
                    this.models[modelKey] = this.trainAnomalyModel(rows, endpoint);
                }
                break;
            case 'rag':
                break;
            default:
                consolelog.warn(`Unsupported ML model type: ${modelType}`);
        }    

        // Save updated model state
        if (this.models[modelKey]) {
            this.saveModel(modelKey, this.models[modelKey]);
        }
    }

    /**
     * Train a sentiment analysis model with enhanced preprocessing and multilingual support.
     */
    trainSentimentModel(rows, endpoint) {
        const { handleMissingValues } = require('./ml_utils');
        
        if (!rows || rows.length === 0) {
            consolelog.warn(`No data provided for sentiment analysis in ${endpoint.dbTable}`);
            return null;
        }

        try {
            // Get configuration for this endpoint
            const mergedConfig = this.getMergedConfig(endpoint.dbTable);
            const {
                language = 'English',
                textPreprocessing = true,
                minTextLength = 3,
                combineFields = false
            } = mergedConfig?.sentimentConfig || {};

            // Find all potential text fields
            const textFields = endpoint.allowRead.filter(field => {
                const value = rows[0][field];
                return typeof value === 'string' || 
                       (Array.isArray(value) && value.every(v => typeof v === 'string'));
            });

            if (textFields.length === 0) {
                throw new Error(`No suitable text fields found in ${endpoint.dbTable}`);
            }

            const classifier = new natural.SentimentAnalyzer(
                language, 
                natural.PorterStemmer, 
                'afinn'
            );

            // Process each row
            const sentimentData = rows.map(row => {
                try {
                    // Combine text from all fields or use primary field
                    let text;
                    if (combineFields) {
                        text = textFields
                            .map(field => row[field])
                            .filter(Boolean)
                            .join(' ');
                    } else {
                        text = row[textFields[0]];
                    }

                    // Handle arrays of text
                    if (Array.isArray(text)) {
                        text = text.join(' ');
                    }

                    // Skip if text is too short
                    if (!text || text.length < minTextLength) {
                        return {
                            id: row[endpoint.keys[0]],
                            sentiment: null,
                            error: 'Text too short or empty'
                        };
                    }

                    // Text preprocessing if enabled
                    if (textPreprocessing) {
                        text = text.toLowerCase()
                            .replace(/[^\w\s]/g, '') // Remove punctuation
                            .replace(/\s+/g, ' ')    // Normalize whitespace
                            .trim();
                    }

                    const words = text.split(' ').filter(Boolean);
                    const sentiment = classifier.getSentiment(words);

                    return {
                        id: row[endpoint.keys[0]],
                        sentiment,
                        confidence: Math.abs(sentiment) / words.length, // Simple confidence score
                        wordCount: words.length
                    };
                } catch (error) {
                    consolelog.error(`Error processing row ${row[endpoint.keys[0]]}:`, error);
                    return {
                        id: row[endpoint.keys[0]],
                        sentiment: null,
                        error: error.message
                    };
                }
            });

            // Filter out failed analyses
            const validSentiments = sentimentData
                .filter(data => data.sentiment !== null)
                .map(data => data.sentiment);

            if (validSentiments.length === 0) {
                throw new Error('No valid sentiment analyses performed');
            }

            // Calculate statistics
            const stats = {
                total: sentimentData.length,
                valid: validSentiments.length,
                avgSentiment: validSentiments.reduce((a, b) => a + b, 0) / validSentiments.length,
                distribution: {
                    positive: validSentiments.filter(s => s > 0).length,
                    neutral: validSentiments.filter(s => s === 0).length,
                    negative: validSentiments.filter(s => s < 0).length
                }
            };

            consolelog.log(`Sentiment model trained for ${endpoint.dbTable}`);
            return {
                data: sentimentData,
                stats,
                config: {
                    language,
                    textFields,
                    textPreprocessing,
                    minTextLength,
                    combineFields
                }
            };
        } catch (error) {
            consolelog.error(`Error in sentiment analysis for ${endpoint.dbTable}:`, error);
            return {
                error: error.message,
                message: "Failed to train sentiment model"
            };
        }
    }

    /**
     * Train a recommendation model using clustering with enhanced preprocessing.
     */
    trainRecommendationModel(rows, endpoint) {
        const { scale, oneHotEncode, handleMissingValues } = require('./ml_utils');
        
        if (!rows || rows.length === 0) {
            consolelog.warn(`No data provided for recommendations in ${endpoint.dbTable}`);
            return null;
        }

        try {
            // Get configuration for this endpoint
            const mergedConfig = this.getMergedConfig(endpoint.dbTable);
            const {
                k = 3,
                scalingRange = [0, 1],
                minClusterSize = 2,
                missingValueStrategy = 'mean',
                weightedFields = {},
                similarityThreshold = 0.5
            } = mergedConfig?.recommendationConfig || {};

            // Process all fields that can be used for recommendations
            const processedData = [];
            const fieldProcessors = new Map();
            const fields = endpoint.allowRead;
            const defaultValue = 0; // Default value for missing features

            // First pass: analyze fields and collect all possible categories
            const categoriesMap = new Map();
            for (const field of fields) {
                const values = rows.map(row => row[field]);
                const sampleValue = values.find(v => v !== null && v !== undefined);
                
                if (!sampleValue) {
                    consolelog.warn(`Field ${field} has no valid values, skipping`);
                    continue;
                }

                const weight = weightedFields[field] || 1;

                if (typeof sampleValue === 'number') {
                    // Handle missing values first
                    const cleanValues = handleMissingValues(values, missingValueStrategy);
                    // Scale numeric values
                    const { scaled, scaleParams } = scale(cleanValues, scalingRange);
                    fieldProcessors.set(field, {
                        type: 'numeric',
                        params: scaleParams,
                        weight,
                        processor: (val) => {
                            if (val === null || val === undefined) {
                                return defaultValue;
                            }
                            const cleaned = handleMissingValues([val], missingValueStrategy)[0];
                            return scale(cleaned, scalingRange, scaleParams).scaled * weight;
                        }
                    });
                } else if (typeof sampleValue === 'string' || typeof sampleValue === 'boolean') {
                    // Collect all unique categories first
                    const uniqueCategories = new Set();
                    values.forEach(val => {
                        if (val !== null && val !== undefined) {
                            uniqueCategories.add(String(val));
                        }
                    });
                    const categories = Array.from(uniqueCategories).sort();
                    
                    fieldProcessors.set(field, {
                        type: 'categorical',
                        params: categories,
                        weight,
                        processor: (val) => {
                            if (val === null || val === undefined) {
                                return Array(categories.length).fill(defaultValue);
                            }
                            const { encoded } = oneHotEncode(val, categories);
                            return encoded.map(v => v * weight);
                        }
                    });
                }
            }

            if (fieldProcessors.size === 0) {
                throw new Error('No valid fields found for processing');
            }

            // Calculate feature dimension
            const totalDimensions = Array.from(fieldProcessors.values()).reduce((sum, processor) => {
                if (processor.type === 'numeric') return sum + 1;
                if (processor.type === 'categorical') return sum + processor.params.length;
                return sum;
            }, 0);

            // Second pass: process all rows with consistent dimensions
            for (const row of rows) {
                const processedRow = [];
                for (const [field, processor] of fieldProcessors) {
                    const value = row[field];
                    const processed = processor.processor(value);
                    if (Array.isArray(processed)) {
                        processedRow.push(...processed);
                    } else {
                        processedRow.push(processed);
                    }
                }
                // Ensure all rows have the same dimension
                while (processedRow.length < totalDimensions) {
                    processedRow.push(defaultValue);
                }
                processedData.push(processedRow);
            }

            if (processedData.length < minClusterSize) {
                throw new Error(`Insufficient data points (${processedData.length}) for clustering. Minimum required: ${minClusterSize}`);
            }

            // Verify all rows have same dimensions
            const firstRowDimension = processedData[0].length;
            const invalidRows = processedData.filter(row => row.length !== firstRowDimension);
            if (invalidRows.length > 0) {
                throw new Error(`Inconsistent feature dimensions detected. Expected ${firstRowDimension} features.`);
            }

            // Adjust K based on dataset size
            const numPoints = processedData.length;
            const adjustedK = Math.min(k, Math.max(2, Math.floor(numPoints / minClusterSize)));

            // Run K-means clustering
            const clusterResult = kmeans(processedData, adjustedK);

            // Organize points by their assigned clusters
            const clusterPoints = new Array(adjustedK).fill(null).map(() => []);
            clusterResult.clusters.forEach((clusterIdx, pointIdx) => {
                clusterPoints[clusterIdx].push(pointIdx);
            });

            // Enhance cluster results with similarity scores
            const enhancedClusters = clusterPoints.map((points, idx) => {
                const centroid = clusterResult.centroids[idx];
                return {
                    id: idx,
                    points,
                    centroid,
                    size: points.length,
                    similarities: points.map(pointIdx => {
                        const point = processedData[pointIdx];
                        // Calculate cosine similarity with centroid
                        const dotProduct = point.reduce((sum, val, i) => sum + val * centroid[i], 0);
                        const magnitude1 = Math.sqrt(point.reduce((sum, val) => sum + val * val, 0));
                        const magnitude2 = Math.sqrt(centroid.reduce((sum, val) => sum + val * val, 0));
                        return dotProduct / (magnitude1 * magnitude2);
                    })
                };
            });

            consolelog.log(`Recommendation model trained for ${endpoint.dbTable}`);
            return {
                clusters: enhancedClusters,
                fieldProcessors: Array.from(fieldProcessors.entries()),
                config: {
                    k: adjustedK,
                    originalK: k,
                    scalingRange,
                    minClusterSize,
                    missingValueStrategy,
                    weightedFields,
                    similarityThreshold
                },
                stats: {
                    totalPoints: numPoints,
                    dimensions: processedData[0].length,
                    clusterSizes: enhancedClusters.map(c => c.size),
                    averageSimilarity: enhancedClusters.reduce(
                        (sum, c) => sum + c.similarities.reduce((a, b) => a + b, 0) / c.similarities.length,
                        0
                    ) / enhancedClusters.length
                }
            };
        } catch (error) {
            consolelog.error(`Error in recommendation model for ${endpoint.dbTable}:`, error);
            return {
                error: error.message,
                message: "Failed to train recommendation model"
            };
        }
    }
    

    /**
     * Train an anomaly detection model with robust data preprocessing.
     */
    trainAnomalyModel(rows, endpoint) {
        const { scale, oneHotEncode, handleMissingValues } = require('./ml_utils');
        
        if (!rows || rows.length === 0) {
            consolelog.warn(`No data provided for anomaly detection in ${endpoint.dbTable}`);
            return null;
        }

        try {
            // Get configuration for this endpoint
            const mergedConfig = this.getMergedConfig(endpoint.dbTable);
            const {
                eps = 0.5,
                minPts = 2,
                scalingRange = [0, 1],
                missingValueStrategy = 'mean'
            } = mergedConfig?.anomalyConfig || {};

            // Process all fields that can be used for anomaly detection
            const processedData = [];
            const fieldProcessors = new Map();
            const fields = endpoint.allowRead;
            const defaultValue = 0; // Default value for missing features

            // First pass: analyze fields and collect all possible categories
            for (const field of fields) {
                const values = rows.map(row => row[field]);
                const sampleValue = values.find(v => v !== null && v !== undefined);
                
                if (!sampleValue) {
                    consolelog.warn(`Field ${field} has no valid values, skipping`);
                    continue;
                }

                if (typeof sampleValue === 'number') {
                    // Handle missing values first
                    const cleanValues = handleMissingValues(values, missingValueStrategy);
                    // Scale numeric values
                    const { scaled, scaleParams } = scale(cleanValues, scalingRange);
                    fieldProcessors.set(field, {
                        type: 'numeric',
                        params: scaleParams,
                        processor: (val) => {
                            if (val === null || val === undefined) {
                                return defaultValue;
                            }
                            const cleaned = handleMissingValues([val], missingValueStrategy)[0];
                            return scale(cleaned, scalingRange, scaleParams).scaled;
                        }
                    });
                } else if (typeof sampleValue === 'string' || typeof sampleValue === 'boolean') {
                    // Collect all unique categories first
                    const uniqueCategories = new Set();
                    values.forEach(val => {
                        if (val !== null && val !== undefined) {
                            uniqueCategories.add(String(val));
                        }
                    });
                    const categories = Array.from(uniqueCategories).sort();
                    
                    fieldProcessors.set(field, {
                        type: 'categorical',
                        params: categories,
                        processor: (val) => {
                            if (val === null || val === undefined) {
                                return Array(categories.length).fill(defaultValue);
                            }
                            const { encoded } = oneHotEncode(val, categories);
                            return encoded;
                        }
                    });
                }
            }

            if (fieldProcessors.size === 0) {
                throw new Error('No valid fields found for processing');
            }

            // Calculate feature dimension
            const totalDimensions = Array.from(fieldProcessors.values()).reduce((sum, processor) => {
                if (processor.type === 'numeric') return sum + 1;
                if (processor.type === 'categorical') return sum + processor.params.length;
                return sum;
            }, 0);

            // Second pass: process all rows with consistent dimensions
            for (const row of rows) {
                const processedRow = [];
                for (const [field, processor] of fieldProcessors) {
                    const value = row[field];
                    const processed = processor.processor(value);
                    if (Array.isArray(processed)) {
                        processedRow.push(...processed);
                    } else {
                        processedRow.push(processed);
                    }
                }
                // Ensure all rows have the same dimension
                while (processedRow.length < totalDimensions) {
                    processedRow.push(defaultValue);
                }
                processedData.push(processedRow);
            }

            if (processedData.length === 0) {
                throw new Error('No valid data after preprocessing');
            }

            // Verify all rows have same dimensions
            const firstRowDimension = processedData[0].length;
            const invalidRows = processedData.filter(row => row.length !== firstRowDimension);
            if (invalidRows.length > 0) {
                throw new Error(`Inconsistent feature dimensions detected. Expected ${firstRowDimension} features.`);
            }

            // Run DBSCAN on processed data
            const dbscan = new DBSCAN();
            const clusters = dbscan.run(processedData, eps, minPts);

            if (!clusters || clusters.length === 0) {
                consolelog.warn(`No clusters formed for ${endpoint.dbTable}. Check dataset and parameters.`);
                return {
                    clusters: [],
                    fieldProcessors: Array.from(fieldProcessors.entries()),
                    message: "No clusters or anomalies detected. Consider adjusting eps and minPts parameters."
                };
            }

            // Identify anomalies (points not assigned to any cluster)
            const anomalies = [];
            const allPoints = new Set(clusters.flat());
            for (let i = 0; i < processedData.length; i++) {
                if (!allPoints.has(i)) {
                    anomalies.push({
                        index: i,
                        originalData: rows[i],
                        processedData: processedData[i]
                    });
                }
            }

            consolelog.log(`Anomaly detection model trained for ${endpoint.dbTable}`);
            return {
                clusters,
                fieldProcessors: Array.from(fieldProcessors.entries()),
                anomalies,
                params: {
                    eps,
                    minPts,
                    scalingRange,
                    missingValueStrategy
                },
                stats: {
                    totalPoints: processedData.length,
                    dimensions: firstRowDimension,
                    numClusters: clusters.length,
                    numAnomalies: anomalies.length,
                    anomalyPercentage: (anomalies.length / processedData.length) * 100
                }
            };
        } catch (error) {
            consolelog.error(`Error in anomaly detection for ${endpoint.dbTable}:`, error);
            return {
                error: error.message,
                message: "Failed to train anomaly detection model"
            };
        }
    }

    /**
     * Middleware to expose ML endpoints.
     */
    middleware() {
        return async (req, res, next) => {
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

                // Handle different model types
                switch (model) {
                    case 'recommendation':
                        if (keyId !== null) {
                            if (modelData.error) {
                                return res.status(500).json({ error: modelData.error });
                            }

                            // Find which cluster contains our target keyId
                            const targetCluster = modelData.clusters.find(cluster => 
                                cluster.points.includes(keyId)
                            );

                            if (!targetCluster) {
                                return res.status(404).json({ 
                                    error: `Key ${keyId} not found in any cluster` 
                                });
                            }

                            // Get recommendations from the same cluster, excluding the target key
                            const recommendations = targetCluster.points
                                .filter(pointIdx => pointIdx !== keyId)
                                .map(pointIdx => ({
                                    id: pointIdx,
                                    similarity: targetCluster.similarities[
                                        targetCluster.points.indexOf(pointIdx)
                                    ]
                                }))
                                .sort((a, b) => b.similarity - a.similarity);

                            if (detailed) {
                                const endpoint = this.mainConfig.find(ep => ep.dbTable === table);
                                if (!endpoint) {
                                    return res.status(500).json({ error: `Configuration not found for table ${table}` });
                                }

                                const connection = await getDbConnection(endpoint);
                                if (!connection) {
                                    return res.status(500).json({ error: 'Database connection failed' });
                                }

                                try {
                                    const recommendationIds = recommendations.map(r => r.id);
                                    const [records] = await connection.query(
                                        `SELECT * FROM ${table} WHERE id IN (?)`,
                                        [recommendationIds]
                                    );

                                    const recordsWithSimilarity = records.map(record => {
                                        const recommendation = recommendations.find(r => r.id === record.id);
                                        return {
                                            ...record,
                                            similarity_score: recommendation ? recommendation.similarity : 0
                                        };
                                    }).sort((a, b) => b.similarity_score - a.similarity_score);

                                    return res.json({
                                        key: keyId,
                                        cluster_id: targetCluster.id,
                                        cluster_size: targetCluster.size,
                                        recommendations: recordsWithSimilarity
                                    });
                                } finally {
                                    connection.release();
                                }
                            }

                            return res.json({
                                key: keyId,
                                cluster_id: targetCluster.id,
                                cluster_size: targetCluster.size,
                                recommendations
                            });
                        }
                        break;

                    case 'sentiment':
                        if (detailed) {
                            const endpoint = this.mainConfig.find(ep => ep.dbTable === table);
                            if (!endpoint) {
                                return res.status(500).json({ error: `Configuration not found for table ${table}` });
                            }

                            const connection = await getDbConnection(endpoint);
                            if (!connection) {
                                return res.status(500).json({ error: 'Database connection failed' });
                            }

                            try {
                                // Get all records with sentiment scores
                                const recordIds = modelData.data.map(item => item.id);
                                const [records] = await connection.query(
                                    `SELECT * FROM ${table} WHERE id IN (?)`,
                                    [recordIds]
                                );

                                // Map sentiment scores to records
                                const recordsWithSentiment = records.map(record => {
                                    const sentimentData = modelData.data.find(item => item.id === record.id);
                                    return {
                                        ...record,
                                        sentiment_score: sentimentData ? sentimentData.sentiment : null,
                                        sentiment_confidence: sentimentData ? sentimentData.confidence : null,
                                        word_count: sentimentData ? sentimentData.wordCount : null
                                    };
                                });

                                return res.json({
                                    stats: modelData.stats,
                                    records: recordsWithSentiment
                                });
                            } finally {
                                connection.release();
                            }
                        }
                        break;

                    case 'anomaly':
                        if (detailed) {
                            const endpoint = this.mainConfig.find(ep => ep.dbTable === table);
                            if (!endpoint) {
                                return res.status(500).json({ error: `Configuration not found for table ${table}` });
                            }

                            const connection = await getDbConnection(endpoint);
                            if (!connection) {
                                return res.status(500).json({ error: 'Database connection failed' });
                            }

                            try {
                                // Get all anomalous records
                                const anomalyIds = modelData.anomalies.map(anomaly => anomaly.originalData.id);
                                const [records] = await connection.query(
                                    `SELECT * FROM ${table} WHERE id IN (?)`,
                                    [anomalyIds]
                                );

                                // Map anomaly data to records
                                const recordsWithAnomalyData = records.map(record => {
                                    const anomalyData = modelData.anomalies.find(
                                        anomaly => anomaly.originalData.id === record.id
                                    );
                                    return {
                                        ...record,
                                        is_anomaly: true,
                                        anomaly_data: anomalyData ? anomalyData.processedData : null
                                    };
                                });

                                return res.json({
                                    stats: modelData.stats,
                                    anomalies: recordsWithAnomalyData
                                });
                            } finally {
                                connection.release();
                            }
                        }
                        break;
                }

                // If not detailed or no specific handling, return raw model data
                res.json({ data: modelData });
            } catch (error) {
                console.error('Error in ML middleware:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        };
    }
    
    
    /**
     * Schedule periodic model training.
     */
    scheduleTraining() {
        schedule.scheduleJob('0 0 * * *', () => {
            consolelog.log('Starting periodic model training...');
            this.trainModels();
        });
    }
}

module.exports = MLAnalytics;
