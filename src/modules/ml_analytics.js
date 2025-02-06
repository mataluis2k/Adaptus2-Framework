const fs = require('fs');
const path = require('path');
const schedule = require('node-schedule');
const natural = require('natural'); // Sentiment analysis
const { kmeans } = require('ml-kmeans'); // Correct import for KMeans

const { DBSCAN } = require('density-clustering'); // Anomaly detection
const { getDbConnection } = require(path.join(__dirname,'db'));
require('dotenv').config();

class MLAnalytics {
    constructor(mainConfigPath = 'config/apiConfig.json', mlConfigPath = 'config/mlConfig.json') {
        this.models = {};
        this.mainConfigPath = path.resolve(process.cwd(), mainConfigPath);
        this.mlConfigPath = path.resolve(process.cwd(), mlConfigPath);
        this.mainConfig = [];
        this.mlConfig = {};
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

            
            console.log('ML configuration loaded successfully:', this.mlConfig);
        } catch (error) {
            console.error('Error loading configurations:', error.message);
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
            console.warn(`Endpoint ${dbTable} not found in main configuration.`);
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
        console.log(`Configuration for ${dbTable}:`, {
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
    async trainModels() {
        for (const endpoint of this.mainConfig) {
            const { dbTable, mlmodel } = endpoint;

            if (!mlmodel || mlmodel.length === 0) {
                console.warn(`No ML models configured for endpoint ${endpoint.route}`);
                continue;
            }

            const connection = await getDbConnection(endpoint);
            if (!connection) {
                console.error(`Failed to connect to database for ${endpoint.dbConnection}`);
                continue;
            }

            const mergedConfig = this.getMergedConfig(dbTable);
            if (!mergedConfig) {
                console.warn(`Skipping training for ${dbTable} due to missing configuration.`);
                continue;
            }

            const {
                batchSize = 1000,
                samplingRate = 0.0,
                parallelProcessing = false,
                incrementalTraining = false,
            } = mergedConfig;

            try {
                // Sampling logic
                if (samplingRate > 0) {
                    console.log(`Sampling ${samplingRate * 100}% of data for ${dbTable}`);
                    const [rows] = await connection.query(
                        `SELECT * FROM ${dbTable} WHERE RAND() < ?`, 
                        [samplingRate]
                    );
                    await this.processRows(rows, mlmodel, endpoint, parallelProcessing, incrementalTraining);
                    continue; // Skip batch processing if sampling is enabled
                }

                // Batch processing logic
                let offset = 0;
                let rows;

                console.log(`Training models for ${dbTable} in batches of ${batchSize}...`);
                do {
                    const [batch] = await connection.query(
                        `SELECT * FROM ${dbTable} LIMIT ? OFFSET ?`,
                        [batchSize, offset]
                    );

                    rows = batch;
                    offset += batchSize;

                    console.log(`Processing batch of ${rows.length} rows for ${dbTable}`);
                    await this.processRows(rows, mlmodel, endpoint, parallelProcessing, incrementalTraining);
                } while (rows.length === batchSize);
            } catch (error) {
                console.error(`Error training models for ${dbTable}:`, error.message);
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
    trainModel(modelType, rows, endpoint) {
        const { dbTable } = endpoint;
        switch (modelType) {
            case 'sentiment':
                this.models[`${dbTable}_sentiment`] = this.trainSentimentModel(rows, endpoint);
                break;
            case 'recommendation':
                this.models[`${dbTable}_recommendation`] = this.trainRecommendationModel(rows, endpoint);
                break;
            case 'anomaly':
                this.models[`${dbTable}_anomaly`] = this.trainAnomalyModel(rows, endpoint);
                break;
            case 'rag':
                break;
            default:
                console.warn(`Unsupported ML model type: ${modelType}`);
        }
    }

    /**
     * Train a sentiment analysis model with enhanced preprocessing and multilingual support.
     */
    trainSentimentModel(rows, endpoint) {
        const { handleMissingValues } = require('./ml_utils');
        
        if (!rows || rows.length === 0) {
            console.warn(`No data provided for sentiment analysis in ${endpoint.dbTable}`);
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
                    console.error(`Error processing row ${row[endpoint.keys[0]]}:`, error);
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

            console.log(`Sentiment model trained for ${endpoint.dbTable}`);
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
            console.error(`Error in sentiment analysis for ${endpoint.dbTable}:`, error);
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
            console.warn(`No data provided for recommendations in ${endpoint.dbTable}`);
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
                    console.warn(`Field ${field} has no valid values, skipping`);
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

            console.log(`Recommendation model trained for ${endpoint.dbTable}`);
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
            console.error(`Error in recommendation model for ${endpoint.dbTable}:`, error);
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
            console.warn(`No data provided for anomaly detection in ${endpoint.dbTable}`);
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
                    console.warn(`Field ${field} has no valid values, skipping`);
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
                console.warn(`No clusters formed for ${endpoint.dbTable}. Check dataset and parameters.`);
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

            console.log(`Anomaly detection model trained for ${endpoint.dbTable}`);
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
            console.error(`Error in anomaly detection for ${endpoint.dbTable}:`, error);
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
        return (req, res, next) => {
            // Extract the model key and optional key ID from the request path
            const pathParts = req.originalUrl.split('/').filter((part) => part !== ''); // Ignore empty parts
            if (pathParts.length < 3) {
                // Not an ML-specific route; pass control to the next middleware or route handler
                return next();
            }
    
            // ml/articles/recommendation/1
            const table = pathParts[1]; // e.g., "articles"
            const model = pathParts[2]; // e.g., "recommendation"
            const keyId = pathParts[3] ? parseInt(pathParts[3], 10) : null; // e.g., "1"
    
            const modelKey = `${table}_${model}`;
            const modelData = this.models[modelKey];
            if (!modelData) {
                return res.status(404).json({ error: `Model not found for ${model}` });
            }
    
            // For recommendations, process the request with the key ID
            if (model === 'recommendation' && keyId !== null) {
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
                    .sort((a, b) => b.similarity - a.similarity); // Sort by similarity descending

                return res.json({
                    key: keyId,
                    cluster_id: targetCluster.id,
                    cluster_size: targetCluster.size,
                    recommendations
                });
            }
    
            // Default behavior: Return raw model data
            res.json({ data: modelData });
        };
    }
    
    
    /**
     * Schedule periodic model training.
     */
    scheduleTraining() {
        schedule.scheduleJob('0 0 * * *', () => {
            console.log('Starting periodic model training...');
            this.trainModels();
        });
    }
}

module.exports = MLAnalytics;
