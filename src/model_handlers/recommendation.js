/**
 * Recommendation Model Handler
 * 
 * Handles training and updating recommendation models
 */

const { kmeans } = require('ml-kmeans');

/**
 * Train or update a recommendation model
 * 
 * @param {Array} rows - Database rows containing data to analyze
 * @param {Object} endpoint - Endpoint configuration
 * @param {Object|null} existingModel - Existing model data for incremental training
 * @param {Object} mlAnalytics - Reference to the MLAnalytics instance
 * @returns {Object} - The trained recommendation model data
 */
async function recommendationHandler(rows, endpoint, existingModel, mlAnalytics) {
    try {
        // Get configuration
        const mergedConfig = mlAnalytics.getMergedConfig(endpoint.dbTable);
        const { 
            k = 3, 
            scalingRange = [0, 1],
            minClusterSize = 2,
            missingValueStrategy = 'mean',
            weightedFields = {},
            similarityThreshold = 0.5
        } = mergedConfig?.recommendationConfig || {};

        // Reuse config from existing model if available
        const config = existingModel?.config || {
            k,
            scalingRange,
            minClusterSize,
            missingValueStrategy,
            weightedFields,
            similarityThreshold
        };

        // Process data for recommendation
        const { processedData, fieldProcessors } = await processRecommendationData(rows, endpoint, config);
        
        if (existingModel && existingModel.clusters) {
            // Incremental training: update existing model
            return updateRecommendationModel(existingModel, processedData, fieldProcessors, rows, config);
        } else {
            // New model: train from scratch
            return createRecommendationModel(processedData, fieldProcessors, rows, config);
        }
    } catch (error) {
        console.error(`Error in recommendation handler for ${endpoint.dbTable}:`, error);
        throw error;
    }
}

/**
 * Create a new recommendation model
 * 
 * @param {Array} processedData - Processed data for recommendation
 * @param {Array} fieldProcessors - Field processors for data transformation
 * @param {Array} rows - Original database rows
 * @param {Object} config - Recommendation configuration
 * @returns {Object} - The new recommendation model data
 */
function createRecommendationModel(processedData, fieldProcessors, rows, config) {
    if (processedData.length < config.minClusterSize) {
        throw new Error(`Insufficient data points (${processedData.length}) for clustering. Minimum required: ${config.minClusterSize}`);
    }

    // Adjust K based on dataset size
    const numPoints = processedData.length;
    const adjustedK = Math.min(config.k, Math.max(2, Math.floor(numPoints / config.minClusterSize)));

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
            points: points.map(pointIdx => rows[pointIdx].id), // Store actual row IDs
            centroid,
            size: points.length,
            similarities: points.map(pointIdx => {
                const point = processedData[pointIdx];
                // Calculate cosine similarity with centroid
                return calculateCosineSimilarity(point, centroid);
            })
        };
    });

    // Calculate statistics
    const stats = {
        totalPoints: numPoints,
        dimensions: processedData[0]?.length || 0,
        numClusters: enhancedClusters.length,
        clusterSizes: enhancedClusters.map(c => c.size),
        averageSimilarity: enhancedClusters.reduce(
            (sum, c) => sum + (c.similarities.reduce((a, b) => a + b, 0) / c.similarities.length),
            0
        ) / enhancedClusters.length
    };

    return {
        clusters: enhancedClusters,
        fieldProcessors,
        config: {
            ...config,
            adjustedK
        },
        stats,
        lastUpdated: new Date().toISOString()
    };
}

/**
 * Update an existing recommendation model
 * 
 * @param {Object} existingModel - Existing recommendation model
 * @param {Array} newProcessedData - New processed data
 * @param {Array} fieldProcessors - Field processors for data transformation
 * @param {Array} rows - Original database rows
 * @param {Object} config - Recommendation configuration
 * @returns {Object} - The updated recommendation model data
 */
function updateRecommendationModel(existingModel, newProcessedData, fieldProcessors, rows, config) {
    // Run K-means on new data
    const numPoints = newProcessedData.length;
    if (numPoints < config.minClusterSize) {
        // Not enough new data for meaningful clustering, just return existing model
        return existingModel;
    }

    const adjustedK = Math.min(config.k, Math.max(2, Math.floor(numPoints / config.minClusterSize)));
    const clusterResult = kmeans(newProcessedData, adjustedK);

    // Organize new points by their assigned clusters
    const newClusterPoints = new Array(adjustedK).fill(null).map(() => []);
    clusterResult.clusters.forEach((clusterIdx, pointIdx) => {
        newClusterPoints[clusterIdx].push(pointIdx);
    });

    // Create enhanced clusters for new data
    const newClusters = newClusterPoints.map((points, idx) => {
        const centroid = clusterResult.centroids[idx];
        return {
            id: idx,
            points: points.map(pointIdx => rows[pointIdx].id), // Store actual row IDs
            centroid,
            size: points.length,
            similarities: points.map(pointIdx => {
                const point = newProcessedData[pointIdx];
                return calculateCosineSimilarity(point, centroid);
            })
        };
    });

    // Merge clusters from both models
    const mergedClusters = [...existingModel.clusters];

    // Add new clusters or merge with existing ones based on similarity
    newClusters.forEach(newCluster => {
        // Find most similar existing cluster
        let mostSimilarCluster = null;
        let highestSimilarity = -1;

        for (const existingCluster of mergedClusters) {
            const similarity = calculateCosineSimilarity(newCluster.centroid, existingCluster.centroid);
            if (similarity > highestSimilarity) {
                highestSimilarity = similarity;
                mostSimilarCluster = existingCluster;
            }
        }

        if (mostSimilarCluster && highestSimilarity > config.similarityThreshold) {
            // Merge with existing cluster
            const combinedPoints = [...mostSimilarCluster.points, ...newCluster.points];
            const combinedSimilarities = [...mostSimilarCluster.similarities];
            
            // Add new similarities, recalculated against the existing centroid
            newCluster.points.forEach((pointId, idx) => {
                // We don't have the processed data for the existing points, so we'll use the new similarities
                combinedSimilarities.push(newCluster.similarities[idx]);
            });
            
            // Update the cluster
            mostSimilarCluster.points = combinedPoints;
            mostSimilarCluster.similarities = combinedSimilarities;
            mostSimilarCluster.size = combinedPoints.length;
            
            // Update centroid (weighted average based on cluster sizes)
            const existingWeight = mostSimilarCluster.size - newCluster.size;
            const newWeight = newCluster.size;
            const totalWeight = existingWeight + newWeight;
            
            mostSimilarCluster.centroid = mostSimilarCluster.centroid.map((val, i) => 
                ((val * existingWeight) + (newCluster.centroid[i] * newWeight)) / totalWeight
            );
        } else {
            // Add as new cluster
            // Assign a new unique ID
            newCluster.id = mergedClusters.length > 0 ? 
                Math.max(...mergedClusters.map(c => c.id)) + 1 : 0;
            mergedClusters.push(newCluster);
        }
    });

    // Update statistics
    const totalPoints = mergedClusters.reduce((sum, cluster) => sum + cluster.size, 0);
    const stats = {
        totalPoints,
        dimensions: existingModel.stats.dimensions,
        numClusters: mergedClusters.length,
        clusterSizes: mergedClusters.map(c => c.size),
        averageSimilarity: mergedClusters.reduce(
            (sum, c) => sum + (c.similarities.reduce((a, b) => a + b, 0) / c.similarities.length),
            0
        ) / mergedClusters.length
    };

    return {
        clusters: mergedClusters,
        fieldProcessors,
        config: {
            ...config,
            adjustedK: existingModel.config.adjustedK
        },
        stats,
        lastUpdated: new Date().toISOString()
    };
}

/**
 * Process data for recommendation
 * 
 * @param {Array} rows - Database rows
 * @param {Object} endpoint - Endpoint configuration
 * @param {Object} config - Recommendation configuration
 * @returns {Object} - Processed data and field processors
 */
async function processRecommendationData(rows, endpoint, config) {
    const { scale, oneHotEncode, handleMissingValues } = require('../utils/data_utils');
    
    if (!rows || rows.length === 0) {
        throw new Error(`No data provided for recommendations in ${endpoint.dbTable}`);
    }

    // Process all fields that can be used for recommendations
    const processedData = [];
    const fieldProcessors = new Map();
    const fields = endpoint.allowRead || Object.keys(rows[0]);
    const defaultValue = 0; // Default value for missing features

    // First pass: analyze fields and collect all possible categories
    for (const field of fields) {
        const values = rows.map(row => row[field]);
        const sampleValue = values.find(v => v !== null && v !== undefined);
        
        if (!sampleValue) {
            console.warn(`Field ${field} has no valid values, skipping`);
            continue;
        }

        const weight = config.weightedFields[field] || 1;

        if (typeof sampleValue === 'number') {
            // Handle missing values first
            const cleanValues = handleMissingValues(values, config.missingValueStrategy);
            // Scale numeric values
            const { scaled, scaleParams } = scale(cleanValues, config.scalingRange);
            fieldProcessors.set(field, {
                type: 'numeric',
                params: scaleParams,
                weight,
                processor: (val) => {
                    if (val === null || val === undefined) {
                        return defaultValue;
                    }
                    const cleaned = handleMissingValues([val], config.missingValueStrategy)[0];
                    return scale(cleaned, config.scalingRange, scaleParams).scaled * weight;
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

    if (processedData.length === 0) {
        throw new Error('No valid data after preprocessing');
    }

    // Verify all rows have same dimensions
    const firstRowDimension = processedData[0].length;
    const invalidRows = processedData.filter(row => row.length !== firstRowDimension);
    if (invalidRows.length > 0) {
        throw new Error(`Inconsistent feature dimensions detected. Expected ${firstRowDimension} features.`);
    }

    return {
        processedData,
        fieldProcessors: Array.from(fieldProcessors.entries())
    };
}

/**
 * Calculate cosine similarity between two vectors
 * 
 * @param {Array} vector1 - First vector
 * @param {Array} vector2 - Second vector
 * @returns {number} - Cosine similarity (0-1)
 */
function calculateCosineSimilarity(vector1, vector2) {
    if (!vector1 || !vector2 || vector1.length !== vector2.length) {
        return 0;
    }
    
    const dotProduct = vector1.reduce((sum, val, idx) => sum + val * vector2[idx], 0);
    const magnitude1 = Math.sqrt(vector1.reduce((sum, val) => sum + val * val, 0));
    const magnitude2 = Math.sqrt(vector2.reduce((sum, val) => sum + val * val, 0));
    
    if (magnitude1 === 0 || magnitude2 === 0) {
        return 0;
    }
    
    return dotProduct / (magnitude1 * magnitude2);
}

module.exports = recommendationHandler;
