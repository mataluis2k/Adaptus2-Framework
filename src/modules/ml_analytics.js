const fs = require('fs');
const path = require('path');
const schedule = require('node-schedule');
const natural = require('natural'); // Sentiment analysis
const { kmeans } = require('ml-kmeans'); // Correct import for KMeans

const { DBSCAN } = require('density-clustering'); // Anomaly detection
const { getDbConnection } = require(path.join(__dirname,'db'));
require('dotenv').config();

class MLAnalytics {
    constructor(mainConfigPath = '../../config/apiConfig.json', mlConfigPath = '../../config/mlConfig.json') {
        this.models = {};
        this.mainConfigPath = path.resolve(__dirname, mainConfigPath);
        this.mlConfigPath = path.resolve(__dirname, mlConfigPath);
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

    getMergedConfig(dbTable) {
        const mainEndpoint = this.mainConfig.find((ep) => ep.dbTable === dbTable);
        if (!mainEndpoint) {
            console.warn(`Endpoint ${dbTable} not found in main configuration.`);
            return null;
        }

        const mlEndpoint = this.mlConfig.endpoints?.[dbTable] || {};
        const defaultMLConfig = this.mlConfig.default || {};

        return {
            ...defaultMLConfig,
            ...mlEndpoint,
            ...mainEndpoint, // Ensure main endpoint properties are included
        };
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
     * Train a sentiment analysis model.
     */
    trainSentimentModel(rows, endpoint) {
        const textFields = endpoint.allowRead.filter((field) => typeof rows[0][field] === 'string');
        if (textFields.length === 0) {
            console.warn(`No suitable text fields for sentiment analysis in ${endpoint.dbTable}`);
            return null;
        }

        const classifier = new natural.SentimentAnalyzer('English', natural.PorterStemmer, 'afinn');
        const sentimentData = rows.map((row) => ({
            id: row[endpoint.keys[0]],
            sentiment: classifier.getSentiment(row[textFields[0]].split(' ')),
        }));

        console.log(`Sentiment model trained for ${endpoint.dbTable}`);
        return sentimentData;
    }

    /**
     * Train a recommendation model using clustering.
     */
    trainRecommendationModel(rows, endpoint) {
        const numericFields = endpoint.allowRead.filter((field) => typeof rows[0][field] === 'number');
        if (numericFields.length === 0) {
            console.warn(`No suitable numeric fields for recommendations in ${endpoint.dbTable}`);
            return null;
        }
    
        const dataset = rows.map((row) => numericFields.map((field) => row[field]));
    
        // Adjust K to be smaller than the number of points
        const numPoints = dataset.length;
        const defaultK = 3; // Default number of clusters
        const k = Math.min(defaultK, Math.max(1, numPoints - 1)); // Ensure K is valid
    
        if (numPoints < 2) {
            console.warn(`Insufficient data points for k-means clustering in ${endpoint.dbTable}`);
            return null;
        }
    
        try {
            const clusters = kmeans(dataset, k); // Use the adjusted K
            console.log(`Recommendation model trained for ${endpoint.dbTable}`);
            return { clusters, numericFields };
        } catch (error) {
            console.error(`Error in k-means clustering for ${endpoint.dbTable}:`, error.message);
            return null;
        }
    }
    

    /**
     * Train an anomaly detection model.
     */
    trainAnomalyModel(rows, endpoint) {
        const numericFields = endpoint.allowRead.filter((field) => typeof rows[0][field] === 'number');
        if (numericFields.length === 0) {
            console.warn(`No suitable numeric fields for anomaly detection in ${endpoint.dbTable}`);
            return null;
        }
    
        const dataset = rows.map((row) => numericFields.map((field) => row[field]));
        const dbscan = new DBSCAN();
        const clusters = dbscan.run(dataset, 0.5, 2); // Example: eps=0.5, minPts=2
    
        if (!clusters || clusters.length === 0) {
            console.warn(`No clusters formed for ${endpoint.dbTable}. Check dataset and parameters.`);
            return {
                clusters: [],
                numericFields,
                message: "No clusters or anomalies detected. Ensure the dataset has meaningful numeric data.",
            };
        }
    
        console.log(`Anomaly detection model trained for ${endpoint.dbTable}`);
        return { clusters, numericFields };
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
                const { clusters, numericFields } = modelData;
    
                // Find the cluster for the given key
                const clusterIndex = clusters.clusters[keyId];
                if (clusterIndex === undefined) {
                    return res.status(404).json({ error: `Key ${keyId} not found in recommendations` });
                }
    
                // Find all keys in the same cluster
                const recommendedKeys = clusters.clusters
                    .map((cluster, index) => (cluster === clusterIndex ? index : null))
                    .filter((index) => index !== null && index !== keyId); // Exclude the original key
    
                return res.json({
                    key: keyId,
                    recommendations: recommendedKeys,
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
