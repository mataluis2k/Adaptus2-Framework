/**
 * Anomaly Detection Middleware Handler
 * 
 * Handles API requests for anomaly detection models
 */

/**
 * Process anomaly detection API requests
 * 
 * @param {string} table - Database table name
 * @param {number|null} keyId - Optional ID to filter results
 * @param {boolean} detailed - Whether to include detailed information
 * @param {Object} modelData - The anomaly detection model data
 * @param {Object} connection - Database connection
 * @returns {Promise<Object>} - API response
 */
async function anomalyMiddleware(table, keyId, detailed, modelData, connection) {
    try {
        // Handle error case
        if (modelData.error) {
            return { error: modelData.error };
        }

        // If no anomalies were detected
        if (!modelData.anomalies || modelData.anomalies.length === 0) {
            return {
                message: "No anomalies detected",
                stats: modelData.stats || {},
                parameters: modelData.params || {}
            };
        }

        // Get all anomalous records
        let anomalyIds = modelData.anomalies.map(anomaly => anomaly.originalData.id);
        
        // If anomalyIds is empty, return empty array
        if (anomalyIds.length === 0) {
            return {
                stats: modelData.stats || {},
                anomalies: []
            };
        }
        
        // If keyId is provided, only return that record if it exists in anomalyIds
        if (keyId !== null) {
            if (!anomalyIds.includes(keyId)) {
                return { 
                    error: `Anomaly ${keyId} not found`,
                    status: 404
                };
            }
            anomalyIds = [keyId];
        }

        // For detailed view, fetch the full records from the database
        if (detailed) {
            const [records] = await connection.query(
                `SELECT * FROM ${table} WHERE id IN (?)`,
                [anomalyIds]
            );

            // Map anomaly data to records
            const recordsWithAnomalyData = records.map(record => {
                const anomalyData = modelData.anomalies.find(
                    anomaly => anomaly.originalData.id === record.id
                );
                
                // Calculate anomaly score based on distance from nearest cluster
                const anomalyScore = calculateAnomalyScore(
                    anomalyData.processedData, 
                    modelData.clusters, 
                    modelData.processedData
                );
                
                return {
                    ...record,
                    is_anomaly: true,
                    anomaly_score: anomalyScore,
                    anomaly_data: anomalyData ? anomalyData.processedData : null,
                    detection_date: modelData.lastUpdated || new Date().toISOString()
                };
            });

            return {
                stats: modelData.stats || {},
                parameters: modelData.params || {},
                anomalies: recordsWithAnomalyData
            };
        } else {
            // Basic view - just return anomaly IDs and scores
            const basicAnomalies = modelData.anomalies.map(anomaly => {
                const anomalyScore = calculateAnomalyScore(
                    anomaly.processedData, 
                    modelData.clusters, 
                    modelData.processedData
                );
                
                return {
                    id: anomaly.originalData.id,
                    anomaly_score: anomalyScore,
                    detection_date: modelData.lastUpdated || new Date().toISOString()
                };
            });

            if (keyId !== null) {
                return {
                    stats: modelData.stats || {},
                    parameters: modelData.params || {},
                    anomaly: basicAnomalies.find(a => a.id === keyId)
                };
            }

            return {
                stats: modelData.stats || {},
                parameters: modelData.params || {},
                anomalies: basicAnomalies
            };
        }
    } catch (error) {
        console.error('Error in anomaly middleware:', error);
        return { 
            error: 'Error processing anomaly detection request',
            message: error.message,
            status: 500
        };
    }
}

/**
 * Calculate anomaly score based on distance from nearest cluster
 * 
 * @param {Array} point - The data point to evaluate
 * @param {Array} clusters - Array of clusters
 * @param {Array} processedData - All processed data points
 * @returns {number} - Anomaly score (0-1, higher means more anomalous)
 */
function calculateAnomalyScore(point, clusters, processedData) {
    if (!point || !clusters || clusters.length === 0 || !processedData) {
        return 1; // Maximum anomaly score if we can't calculate
    }
    
    // Find minimum distance to any cluster center
    let minDistance = Infinity;
    
    for (const cluster of clusters) {
        const clusterPoints = cluster.map(idx => processedData[idx]);
        if (!clusterPoints || clusterPoints.length === 0) continue;
        
        // Calculate cluster center
        const dimensions = point.length;
        const center = Array(dimensions).fill(0);
        
        for (const clusterPoint of clusterPoints) {
            for (let i = 0; i < dimensions; i++) {
                center[i] += clusterPoint[i] / clusterPoints.length;
            }
        }
        
        // Calculate distance to this cluster center
        const distance = calculateEuclideanDistance(point, center);
        minDistance = Math.min(minDistance, distance);
    }
    
    // Normalize to 0-1 range (using a sigmoid-like function)
    // This will map distances to scores where:
    // - Small distances (close to clusters) → scores close to 0
    // - Large distances (far from clusters) → scores close to 1
    return 1 - (1 / (1 + Math.min(minDistance, 10)));
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

module.exports = anomalyMiddleware;
