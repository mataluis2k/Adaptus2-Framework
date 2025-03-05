/**
 * Recommendation Middleware Handler
 * 
 * Handles API requests for recommendation models
 */

/**
 * Process recommendation API requests
 * 
 * @param {string} table - Database table name
 * @param {number|null} keyId - Optional ID to filter results
 * @param {boolean} detailed - Whether to include detailed information
 * @param {Object} modelData - The recommendation model data
 * @param {Object} connection - Database connection
 * @returns {Promise<Object>} - API response
 */
async function recommendationMiddleware(table, keyId, detailed, modelData, connection) {
    try {
        // Handle error case
        if (modelData.error) {
            return { error: modelData.error };
        }

        // If no clusters were found
        if (!modelData.clusters || modelData.clusters.length === 0) {
            return {
                message: "No recommendation clusters available",
                stats: modelData.stats || {},
                config: modelData.config || {}
            };
        }

        // If keyId is provided, return recommendations for that specific item
        if (keyId !== null) {
            // Find which cluster contains our target keyId
            const targetCluster = modelData.clusters.find(cluster => 
                cluster.points.includes(keyId)
            );

            if (!targetCluster) {
                return { 
                    error: `Key ${keyId} not found in any cluster`,
                    status: 404
                };
            }

            // Get recommendations from the same cluster, excluding the target key
            const recommendations = targetCluster.points
                .filter(pointId => pointId !== keyId)
                .map((pointId, idx) => ({
                    id: pointId,
                    similarity: targetCluster.similarities[
                        targetCluster.points.indexOf(pointId)
                    ] || 0
                }))
                .sort((a, b) => b.similarity - a.similarity);

            // For detailed view, fetch the full records from the database
            if (detailed) {
                const recommendationIds = recommendations.map(r => r.id);
                
                if (recommendationIds.length === 0) {
                    return {
                        key: keyId,
                        cluster_id: targetCluster.id,
                        cluster_size: targetCluster.size,
                        message: "No recommendations available for this item",
                        recommendations: []
                    };
                }
                
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

                return {
                    key: keyId,
                    cluster_id: targetCluster.id,
                    cluster_size: targetCluster.size,
                    recommendations: recordsWithSimilarity
                };
            }

            // Basic view - just return recommendation IDs and similarity scores
            return {
                key: keyId,
                cluster_id: targetCluster.id,
                cluster_size: targetCluster.size,
                recommendations
            };
        } else {
            // No specific key provided, return cluster overview
            const clusterOverview = modelData.clusters.map(cluster => ({
                id: cluster.id,
                size: cluster.size,
                average_similarity: cluster.similarities.reduce((sum, val) => sum + val, 0) / cluster.similarities.length,
                sample_items: cluster.points.slice(0, 5) // Include a few sample items from each cluster
            }));

            // For detailed view, include more information about clusters
            if (detailed) {
                // Get sample items from each cluster
                const allSampleIds = clusterOverview.flatMap(cluster => cluster.sample_items);
                
                if (allSampleIds.length > 0) {
                    const [sampleRecords] = await connection.query(
                        `SELECT * FROM ${table} WHERE id IN (?)`,
                        [allSampleIds]
                    );
    
                    // Add sample records to each cluster
                    const enhancedClusters = clusterOverview.map(cluster => {
                        const clusterSamples = sampleRecords.filter(record => 
                            cluster.sample_items.includes(record.id)
                        );
                        
                        return {
                            ...cluster,
                            sample_records: clusterSamples
                        };
                    });
    
                    return {
                        stats: modelData.stats,
                        config: modelData.config,
                        clusters: enhancedClusters,
                        last_updated: modelData.lastUpdated || new Date().toISOString()
                    };
                }
            }

            // Basic view
            return {
                stats: modelData.stats,
                config: modelData.config,
                clusters: clusterOverview,
                last_updated: modelData.lastUpdated || new Date().toISOString()
            };
        }
    } catch (error) {
        console.error('Error in recommendation middleware:', error);
        return { 
            error: 'Error processing recommendation request',
            message: error.message,
            status: 500
        };
    }
}

module.exports = recommendationMiddleware;
