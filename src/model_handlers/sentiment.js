/**
 * Sentiment Analysis Model Handler
 * 
 * Handles training and updating sentiment analysis models
 */

const natural = require('natural');

/**
 * Train or update a sentiment analysis model
 * 
 * @param {Array} rows - Database rows containing text to analyze
 * @param {Object} endpoint - Endpoint configuration
 * @param {Object|null} existingModel - Existing model data for incremental training
 * @param {Object} mlAnalytics - Reference to the MLAnalytics instance
 * @returns {Object} - The trained sentiment model data
 */
async function sentimentHandler(rows, endpoint, existingModel, mlAnalytics) {
    try {
        // Get configuration
        const mergedConfig = mlAnalytics.getMergedConfig(endpoint.dbTable);
        const { 
            language = 'English', 
            textPreprocessing = true,
            minTextLength = 3,
            combineFields = false 
        } = mergedConfig?.sentimentConfig || {};

        // Reuse config from existing model if available
        const config = existingModel?.config || {
            language,
            textPreprocessing,
            minTextLength,
            combineFields
        };

        console.log("Sentiment config", config);
        // Process text for sentiment analysis
        const newSentimentData = processSentimentData(rows, endpoint, config);
        
        if (existingModel && existingModel.data) {
            // Incremental training: add new data to existing model
            return updateSentimentModel(existingModel, newSentimentData);
        } else {
            // New model: train from scratch
            return createSentimentModel(newSentimentData, config);
        }
    } catch (error) {
        console.error(`Error in sentiment handler for ${endpoint.dbTable}:`, error);
        throw error;
    }
}
/**
 * Create a new sentiment model
 * 
 * @param {Array} sentimentData - Processed sentiment data
 * @param {Object} config - Sentiment configuration
 * @returns {Object} - The new sentiment model data
 */
function createSentimentModel(sentimentData, config) {
    return {
        data: sentimentData,
        stats: calculateSentimentStats(sentimentData),
        config,
        lastUpdated: new Date().toISOString()
    };
}
/**
 * Update an existing sentiment model
 * 
 * @param {Object} existingModel - Existing sentiment model
 * @param {Array} newSentimentData - New sentiment data to add
 * @returns {Object} - The updated sentiment model data
 */
function updateSentimentModel(existingModel, newSentimentData) {
    // Merge new data with existing data, avoiding duplicates
    const existingIds = new Set(existingModel.data.map(item => item.id));
    const uniqueNewData = newSentimentData.filter(item => !existingIds.has(item.id));
    
    // Create updated model
    const updatedData = [...existingModel.data, ...uniqueNewData];
    
    return {
        data: updatedData,
        stats: calculateSentimentStats(updatedData),
        config: existingModel.config,
        lastUpdated: new Date().toISOString()
    };
}

/**
 * Process text data for sentiment analysis
 * 
 * @param {Array} rows - Database rows
 * @param {Object} endpoint - Endpoint configuration
 * @param {Object} config - Sentiment configuration
 * @returns {Array} - Processed sentiment data
 */
function processSentimentData(rows, endpoint, config) {
    if(!config.language){
        config.language = 'English';
    }
    
    // Determine the appropriate vocabulary type based on language
    // Different languages are supported by different vocabulary types
    let vocabType = 'afinn'; // Default to afinn
    const lang = config.language.toLowerCase();
    
    // The natural library expects language names with capital first letter
    // and specific vocabulary types
    const supportedLanguages = {
        'english': 'English',
        'spanish': 'Spanish',
        'portuguese': 'Portuguese',
        'dutch': 'Dutch',
        'italian': 'Italian',
        'french': 'French',
        'german': 'German',
        'galician': 'Galician',
        'catalan': 'Catalan',
        'basque': 'Basque'
    };
    
    // Map languages to their supported vocabulary types
    const languageToVocabType = {
        'English': 'afinn',
        'Spanish': 'afinn',
        'Portuguese': 'afinn',
        'Dutch': 'pattern',
        'Italian': 'pattern',
        'French': 'pattern',
        'German': 'pattern',
        'Galician': 'senticon',
        'Catalan': 'senticon',
        'Basque': 'senticon'
    };
    
    // Convert to proper case if supported, or default to English
    const properCaseLanguage = supportedLanguages[lang] || 'English';
    
    // Get the appropriate vocabulary type for this language
    vocabType = languageToVocabType[properCaseLanguage];
    
    // If language is not supported, fall back to English
    if (!supportedLanguages[lang]) {
        console.warn(`Language '${lang}' is not supported for sentiment analysis. Falling back to English.`);
        config.language = 'English';
    }
    
    // Initialize sentiment analyzer with the appropriate vocabulary type
    console.log(`Language: ${properCaseLanguage}, Vocabulary Type: ${vocabType} ===========================================>`);
    let analyzer;
    try {
        analyzer = new natural.SentimentAnalyzer(properCaseLanguage, null, vocabType);
    } catch (error) {
        console.error(`Error initializing SentimentAnalyzer: ${error.message}`);
        console.log('Falling back to English with afinn vocabulary');
        // Fall back to English with afinn vocabulary which is guaranteed to work
        analyzer = new natural.SentimentAnalyzer('English', null, 'afinn');
    }
    const tokenizer = new natural.WordTokenizer();
    
    // Find text fields in data
    const textFields = findTextFields(rows[0] || {}, endpoint);
    
    return rows.map(row => {
        // Extract text content
        let text = extractText(row, textFields, config.combineFields);
        
        // Skip empty or short text
        if (!text || text.length < config.minTextLength) {
            return {
                id: row.id,
                sentiment: 0,
                confidence: 0,
                wordCount: 0
            };
        }
        
        // Apply text preprocessing if enabled
        if (config.textPreprocessing) {
            text = preprocessText(text);
        }
        
        // Tokenize and analyze sentiment
        const tokens = tokenizer.tokenize(text);
        if (!tokens || tokens.length === 0) {
            return {
                id: row.id,
                sentiment: 0,
                confidence: 0,
                wordCount: 0
            };
        }
        
        // Calculate sentiment score
        let sentiment = 0;
        try {
            sentiment = analyzer.getSentiment(tokens);
        } catch (error) {
            console.error(`Error analyzing sentiment: ${error.message}`);
            // Return neutral sentiment on error
            sentiment = 0;
        }
        
        // Return result with metadata
        return {
            id: row.id,
            sentiment,
            confidence: calculateConfidence(sentiment, tokens.length),
            wordCount: tokens.length,
            timestamp: row.created_at || row.timestamp || new Date().toISOString()
        };
    });
}

/**
 * Extract text from a database row
 * 
 * @param {Object} row - Database row
 * @param {Array} textFields - Fields that may contain text
 * @param {boolean} combineFields - Whether to combine all text fields
 * @returns {string} - Extracted text
 */
function extractText(row, textFields, combineFields) {
    if (combineFields) {
        // Combine all text fields
        return textFields
            .map(field => row[field] || '')
            .filter(text => text.trim().length > 0)
            .join(' ');
    } else {
        // Use the first non-empty text field
        for (const field of textFields) {
            const text = row[field];
            if (text && text.trim().length > 0) {
                return text;
            }
        }
    }
    return '';
}

/**
 * Find potential text fields in a row
 * 
 * @param {Object} sampleRow - Sample database row
 * @param {Object} endpoint - Endpoint configuration
 * @returns {Array} - Fields that may contain text
 */
function findTextFields(sampleRow, endpoint) {
    // Check if text fields are specified in config
    const configFields = endpoint.textFields || [];
    if (configFields.length > 0) {
        return configFields;
    }
    
    // Auto-detect text fields
    const potentialTextFields = ['content', 'text', 'description', 'message', 'comment', 'review', 
                                'title', 'summary', 'body', 'details', 'feedback'];
    
    return Object.keys(sampleRow).filter(field => {
        // Check if field is in potential text fields
        if (potentialTextFields.includes(field)) {
            return true;
        }
        
        // Check if field name contains text-related terms
        const fieldNameLower = field.toLowerCase();
        return potentialTextFields.some(textField => fieldNameLower.includes(textField));
    });
}

/**
 * Preprocess text for sentiment analysis
 * 
 * @param {string} text - Raw text
 * @returns {string} - Preprocessed text
 */
function preprocessText(text) {
    return text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ') // Remove punctuation
        .replace(/\s+/g, ' ')     // Remove extra whitespace
        .trim();
}

/**
 * Calculate confidence score for sentiment analysis
 * 
 * @param {number} sentiment - Sentiment score
 * @param {number} wordCount - Number of words in text
 * @returns {number} - Confidence score (0-1)
 */
function calculateConfidence(sentiment, wordCount) {
    // Higher absolute sentiment and more words = higher confidence
    const sentimentConfidence = Math.min(Math.abs(sentiment) * 1.5, 1);
    const lengthConfidence = Math.min(wordCount / 50, 1);
    
    // Weighted combination
    return (sentimentConfidence * 0.7) + (lengthConfidence * 0.3);
}

/**
 * Calculate statistics for sentiment data
 * 
 * @param {Array} sentimentData - Processed sentiment data
 * @returns {Object} - Sentiment statistics
 */
function calculateSentimentStats(sentimentData) {
    if (!sentimentData || sentimentData.length === 0) {
        return {
            count: 0,
            positive: 0,
            negative: 0,
            neutral: 0,
            averageSentiment: 0,
            distribution: {
                positive: 0,
                negative: 0,
                neutral: 0
            }
        };
    }
    
    // Count sentiment categories
    const positive = sentimentData.filter(item => item.sentiment > 0.1).length;
    const negative = sentimentData.filter(item => item.sentiment < -0.1).length;
    const neutral = sentimentData.length - positive - negative;
    
    // Calculate average sentiment
    const totalSentiment = sentimentData.reduce((sum, item) => sum + item.sentiment, 0);
    const averageSentiment = totalSentiment / sentimentData.length;
    
    // Create and return statistics
    return {
        count: sentimentData.length,
        positive,
        negative,
        neutral,
        averageSentiment,
        distribution: {
            positive: positive / sentimentData.length,
            negative: negative / sentimentData.length,
            neutral: neutral / sentimentData.length
        },
        averageConfidence: sentimentData.reduce((sum, item) => sum + item.confidence, 0) / sentimentData.length,
        averageWordCount: sentimentData.reduce((sum, item) => sum + item.wordCount, 0) / sentimentData.length
    };
}


module.exports = sentimentHandler;