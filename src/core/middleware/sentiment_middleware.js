/**
 * Sentiment Analysis Middleware Handler
 * 
 * Handles API requests for sentiment analysis models
 */

/**
 * Process sentiment analysis API requests
 * 
 * @param {string} table - Database table name
 * @param {number|null} keyId - Optional ID to filter results
 * @param {boolean} detailed - Whether to include detailed information
 * @param {Object} modelData - The sentiment analysis model data
 * @param {Object} connection - Database connection
 * @returns {Promise<Object>} - API response
 */
async function sentimentMiddleware(table, keyId, detailed, modelData, connection) {
    try {
        // Handle error case
        if (modelData.error) {
            return { error: modelData.error };
        }

        // If no sentiment data is available
        if (!modelData.data || modelData.data.length === 0) {
            return {
                message: "No sentiment data available",
                stats: modelData.stats || {},
                config: modelData.config || {}
            };
        }

        // Get all records with sentiment scores
        let recordIds = modelData.data.map(item => item.id);
        
        // If keyId is provided, only return that record if it exists in recordIds
        if (keyId !== null) {
            if (!recordIds.includes(keyId)) {
                return { 
                    error: `Record ${keyId} not found`,
                    status: 404
                };
            }
            recordIds = [keyId];
        }

        // If recordIds is empty, return empty array
        if (recordIds.length === 0) {
            return {
                stats: modelData.stats || {},
                records: []
            };
        }

        // For detailed view, fetch the full records from the database
        if (detailed) {
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
                    word_count: sentimentData ? sentimentData.wordCount : null,
                    sentiment_category: getSentimentCategory(sentimentData ? sentimentData.sentiment : 0)
                };
            });

            if (keyId !== null) {
                return {
                    stats: modelData.stats || {},
                    record: recordsWithSentiment[0]
                };
            }

            return {
                stats: modelData.stats || {},
                records: recordsWithSentiment
            };
        } else {
            // Basic view - just return sentiment data
            const sentimentResults = modelData.data
                .filter(item => recordIds.includes(item.id))
                .map(item => ({
                    id: item.id,
                    sentiment: item.sentiment,
                    confidence: item.confidence,
                    word_count: item.wordCount,
                    sentiment_category: getSentimentCategory(item.sentiment)
                }));

            if (keyId !== null) {
                return {
                    stats: modelData.stats || {},
                    sentiment: sentimentResults[0]
                };
            }

            return {
                stats: modelData.stats || {},
                sentiments: sentimentResults
            };
        }
    } catch (error) {
        console.error('Error in sentiment middleware:', error);
        return { 
            error: 'Error processing sentiment analysis request',
            message: error.message,
            status: 500
        };
    }
}

/**
 * Get sentiment category based on score
 * 
 * @param {number} score - Sentiment score
 * @returns {string} - Sentiment category (positive, negative, neutral)
 */
function getSentimentCategory(score) {
    if (score > 0.1) return 'positive';
    if (score < -0.1) return 'negative';
    return 'neutral';
}

module.exports = sentimentMiddleware;
