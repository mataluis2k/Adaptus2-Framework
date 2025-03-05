/**
 * Anomaly Detection Model Handler
 * 
 * Handles training and updating anomaly detection models
 */

const { DBSCAN } = require('density-clustering');

/**
 * Train or update an anomaly detection model
 * 
 * @param {Array} rows - Database rows containing data to analyze
 * @param {Object} endpoint - Endpoint configuration
 * @param {Object|null} existingModel - Existing model data for incremental training
 * @param {Object} mlAnalytics - Reference to the MLAnalytics instance
 * @returns {Object} - The trained anomaly model data
 */
async function anomalyHandler(rows, endpoint, existingModel, mlAnalytics) {
    try {
        // Get configuration
        const mergedConfig = mlAnalytics.getMergedConfig(endpoint.dbTable);
        const { 
            eps = 0.5, 
            minPts = 2,
            scalingRange = [0, 1],
            missingValueStrategy = 'mean'
        } = mergedConfig?.anomalyConfig || {};

        // Reuse config from existing model if available
        const config = existingModel?.params || {
            eps,
            minPts,
            scalingRange,
            missingValueStrategy
        };

        // Process data for anomaly detection
        const { processedData, fieldProcessors } = await processAnomalyData(rows, endpoint, config);
        
        if (existingModel && existingModel.clusters) {
            // Incremental training: update existing model
            return updateAnomalyModel(existingModel, processedData, fieldProcessors, rows, config);
        } else {
            // New model: train from scratch
            return createAnomalyModel(processedData, fieldProcessors, rows, config);
        }
    } catch (error) {
        console.error(`Error in anomaly handler for ${endpoint.dbTable}:`, error);
        throw error;
    }
}

/**
 * Create a new anomaly detection model
 * 
 * @param {Array} processedData - Processed data for anomaly detection
 * @param {Array} fieldProcessors - Field processors for data transformation
 * @param {Array} rows - Original database rows
 * @param {Object} config - Anomaly detection configuration
 * @returns {Object} - The new anomaly model data
 */
function createAnomalyModel(processedData, fieldProcessors, rows, config) {
    // Run DBSCAN on processed data
    const dbscan = new DBSCAN();
    const clusters = dbscan.run(processedData, config.eps, config.minPts);

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

    // Calculate statistics
    const stats = {
        totalPoints: processedData.length,
        dimensions: processedData[0]?.length || 0,
        numClusters: clusters.length,
        numAnomalies: anomalies.length,
        anomalyPercentage: (anomalies.length / processedData.length) * 100,
        clusterSizes: clusters.map(cluster => cluster.length)
    };

    return {
        clusters,
        fieldProcessors,
        anomalies,
        processedData,
        params: config,
        stats,
        lastUpdated: new Date().toISOString()
    };
}

/**
 * Update an existing anomaly detection model
 * 
 * @param {Object} existingModel - Existing anomaly model
 * @param {Array} newProcessedData - New processed data
 * @param {Array} fieldProcessors - Field processors for data transformation
 * @param {Array} rows - Original database rows
 * @param {Object} config - Anomaly detection configuration
 * @returns {Object} - The updated anomaly model data
 */
function updateAnomalyModel(existingModel, newProcessedData, fieldProcessors, rows, config) {
    // Run DBSCAN on new data
    const dbscan = new DBSCAN();
    const newClusters = dbscan.run(newProcessedData, config.eps, config.minPts);

    // Identify new anomalies
    const newAnomalies = [];
    const allNewPoints = new Set(newClusters.flat());
    for (let i = 0; i < newProcessedData.length; i++) {
        if (!allNewPoints.has(i)) {
            newAnomalies.push({
                index: i,
                originalData: rows[i],
                processedData: newProcessedData[i]
            });
        }
    }

    // Merge clusters and anomalies
    const mergedClusters = [...existingModel.clusters];
    const mergedAnomalies = Array.isArray(existingModel.anomalies) ? [...existingModel.anomalies] : [];
    const mergedProcessedData = Array.isArray(existingModel.processedData) ? [...existingModel.processedData] : [];

    // Add new clusters if they're significantly different from existing ones
    newClusters.forEach(newCluster => {
        const newClusterCenter = calculateClusterCenter(newCluster, newProcessedData);
        const isUnique = !mergedClusters.some(existingCluster => {
            const existingCenter = calculateClusterCenter(existingCluster, existingModel.processedData);
            const distance = calculateEuclideanDistance(newClusterCenter, existingCenter);
            return distance < config.eps;
        });

        if (isUnique) {
            // Adjust indices for the merged data
            const offsetCluster = newCluster.map(idx => idx + mergedProcessedData.length);
            mergedClusters.push(offsetCluster);
        }
    });

    // Add new anomalies, avoiding duplicates based on similarity
    if (newAnomalies.length > 0) {
        newAnomalies.forEach(newAnomaly => {
            const isDuplicate = mergedAnomalies.some(existingAnomaly => 
                calculateEuclideanDistance(
                    newAnomaly.processedData,
                    existingAnomaly.processedData
                ) < config.eps
            );

            if (!isDuplicate) {
                // Adjust index for the merged data
                const adjustedAnomaly = {
                    ...newAnomaly,
                    index: newAnomaly.index + mergedProcessedData.length
                };
                mergedAnomalies.push(adjustedAnomaly);
            }
        });
    }

    // Add new processed data
    const updatedProcessedData = [...mergedProcessedData, ...newProcessedData];

    // Update statistics
    const stats = {
        totalPoints: updatedProcessedData.length,
        dimensions: updatedProcessedData[0]?.length || 0,
        numClusters: mergedClusters.length,
        numAnomalies: mergedAnomalies.length,
        anomalyPercentage: (mergedAnomalies.length / updatedProcessedData.length) * 100,
        clusterSizes: mergedClusters.map(cluster => cluster.length)
    };

    return {
        clusters: mergedClusters,
        fieldProcessors,
        anomalies: mergedAnomalies,
        processedData: updatedProcessedData,
        params: config,
        stats,
        lastUpdated: new Date().toISOString()
    };
}

/**
 * Process data for anomaly detection
 * 
 * @param {Array} rows - Database rows
 * @param {Object} endpoint - Endpoint configuration
 * @param {Object} config - Anomaly detection configuration
 * @returns {Object} - Processed data and field processors
 */
async function processAnomalyData(rows, endpoint, config) {
    const { scale, oneHotEncode, handleMissingValues } = require('../utils/data_utils');
    
    if (!rows || rows.length === 0) {
        throw new Error(`No data provided for anomaly detection in ${endpoint.dbTable}`);
    }

    // Process all fields that can be used for anomaly detection
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

        if (typeof sampleValue === 'number') {
            // Handle missing values first
            const cleanValues = handleMissingValues(values, config.missingValueStrategy);
            // Scale numeric values
            const { scaled, scaleParams } = scale(cleanValues, config.scalingRange);
            fieldProcessors.set(field, {
                type: 'numeric',
                params: scaleParams,
                processor: (val) => {
                    if (val === null || val === undefined) {
                        return defaultValue;
                    }
                    const cleaned = handleMissingValues([val], config.missingValueStrategy)[0];
                    return scale(cleaned, config.scalingRange, scaleParams).scaled;
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

    return {
        processedData,
        fieldProcessors: Array.from(fieldProcessors.entries())
    };
}

/**
 * Calculate Euclidean distance between two points
 * 
 * @param {Array} point1 - First point
 * @param {Array} point2 - Second point
 * @returns {number} - Euclidean distance
 */
function calculateEuclideanDistance(point1, point2) {
    if (!point1 || !point2 || point1.length !== point2.length) {
        return Infinity;
    }
    
    return Math.sqrt(
        point1.reduce((sum, val, idx) => sum + Math.pow(val - point2[idx], 2), 0)
    );
}

/**
 * Calculate the center of a cluster
 * 
 * @param {Array} cluster - Array of point indices in the cluster
 * @param {Array} processedData - Processed data points
 * @returns {Array} - Cluster center coordinates
 */
function calculateClusterCenter(cluster, processedData) {
    if (!cluster || cluster.length === 0 || !processedData || processedData.length === 0) {
        return [];
    }
    
    const points = cluster.map(idx => processedData[idx]);
    const dimensions = points[0].length;
    
    return Array(dimensions).fill(0).map((_, dim) => 
        points.reduce((sum, point) => sum + point[dim], 0) / points.length
    );
}

module.exports = anomalyHandler;
