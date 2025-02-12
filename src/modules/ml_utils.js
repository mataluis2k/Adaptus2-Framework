/**
 * ML utility functions for data preprocessing and normalization
 */

// Utility to normalize data for TensorFlow.js models
function normalizeData(data, min = 0, max = 1) {
    try {
        if (!Array.isArray(data)) {
            throw new Error('Data must be an array');
        }

        const validData = data.filter(v => typeof v === 'number' && !isNaN(v) && isFinite(v));
        if (validData.length === 0) {
            return Array(data.length).fill(0);
        }

        const minValue = Math.min(...validData);
        const maxValue = Math.max(...validData);

        // Handle edge case where all values are the same
        if (minValue === maxValue) {
            return data.map(() => (min + max) / 2);
        }

        return data.map(value => {
            if (typeof value !== 'number' || isNaN(value) || !isFinite(value)) {
                return (min + max) / 2; // Return middle of range for invalid values
            }
            return (value - minValue) / (maxValue - minValue) * (max - min) + min;
        });
    } catch (error) {
        console.error('Error in normalizeData function:', error);
        throw error;
    }
}

// Utility to scale numerical values with robust error handling and default values
function scale(value, range = [0, 1], existingParams = null) {
    try {
        // Input validation
        if (!Array.isArray(range) || range.length !== 2) {
            throw new Error('Range must be an array of two numbers');
        }

        const [min, max] = range;
        if (min >= max) {
            throw new Error('Invalid range: min must be less than max');
        }

        // Handle single value vs array
        const values = Array.isArray(value) ? value : [value];
        
        // Filter out invalid values but don't throw error
        const validValues = values.filter(v => typeof v === 'number' && !isNaN(v) && isFinite(v));

        let scaleParams;
        if (existingParams) {
            // Validate existing parameters
            if (typeof existingParams.min !== 'number' || typeof existingParams.max !== 'number') {
                throw new Error('Invalid scaling parameters');
            }
            scaleParams = existingParams;
        } else {
            if (validValues.length === 0) {
                // Return default value if no valid values
                return {
                    scaled: Array.isArray(value) ? values.map(() => 0) : 0,
                    scaleParams: { min: 0, max: 1 }
                };
            }
            scaleParams = {
                min: Math.min(...validValues),
                max: Math.max(...validValues)
            };
        }

        // Handle edge case where min equals max
        if (scaleParams.min === scaleParams.max) {
            const defaultValue = (min + max) / 2; // Use middle of range
            return {
                scaled: Array.isArray(value) ? values.map(() => defaultValue) : defaultValue,
                scaleParams
            };
        }

        // Perform scaling with default value for invalid inputs
        const scaleValue = (v) => {
            if (typeof v !== 'number' || isNaN(v) || !isFinite(v)) return 0;
            return (v - scaleParams.min) / (scaleParams.max - scaleParams.min) * (max - min) + min;
        };

        const scaled = Array.isArray(value) ? values.map(scaleValue) : scaleValue(value);
        return { scaled, scaleParams };
    } catch (error) {
        console.error('Error in scale function:', error);
        throw error;
    }
}

// Utility to one-hot encode categorical values with enhanced functionality and default values
function oneHotEncode(value, existingCategories = null) {
    try {
        let categories = existingCategories ? [...existingCategories] : [];
        
        // Handle null/undefined values by returning zero vector
        if (value === null || value === undefined) {
            return {
                encoded: categories.length > 0 ? Array(categories.length).fill(0) : [0],
                categories,
                originalValue: null,
                mapping: Object.fromEntries(categories.map((cat, idx) => [cat, idx]))
            };
        }

        // Convert value to string for consistent handling
        const stringValue = String(value);

        // Handle new category
        if (!categories.includes(stringValue)) {
            categories.push(stringValue);
        }

        // Sort categories for consistent ordering
        categories.sort();

        // Create encoded array
        const encoded = categories.map(category => category === stringValue ? 1 : 0);

        return {
            encoded,
            categories,
            originalValue: value,
            mapping: Object.fromEntries(categories.map((cat, idx) => [cat, idx]))
        };
    } catch (error) {
        console.error('Error in oneHotEncode function:', error);
        // Return zero vector on error
        return {
            encoded: [0],
            categories: [],
            originalValue: null,
            mapping: {}
        };
    }
}

// Utility to handle missing values
function handleMissingValues(data, strategy = 'mean') {
    try {
        if (!Array.isArray(data)) {
            throw new Error('Data must be an array');
        }

        const validStrategies = ['mean', 'median', 'mode', 'zero', 'remove'];
        if (!validStrategies.includes(strategy)) {
            throw new Error(`Invalid strategy. Must be one of: ${validStrategies.join(', ')}`);
        }

        const validData = data.filter(v => v !== null && v !== undefined && !isNaN(v));
        
        if (validData.length === 0) {
            throw new Error('No valid data points available');
        }

        let replacementValue;
        switch (strategy) {
            case 'mean':
                replacementValue = validData.reduce((a, b) => a + b, 0) / validData.length;
                break;
            case 'median':
                const sorted = [...validData].sort((a, b) => a - b);
                const mid = Math.floor(sorted.length / 2);
                replacementValue = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
                break;
            case 'mode':
                const counts = validData.reduce((acc, val) => {
                    acc[val] = (acc[val] || 0) + 1;
                    return acc;
                }, {});
                replacementValue = Object.entries(counts).reduce((a, b) => a[1] > b[1] ? a : b)[0];
                break;
            case 'zero':
                replacementValue = 0;
                break;
            case 'remove':
                return validData;
        }

        return data.map(v => (v === null || v === undefined || isNaN(v)) ? replacementValue : v);
    } catch (error) {
        console.error('Error in handleMissingValues function:', error);
        throw error;
    }
}

// Utility to check and create database indexes
async function ensureIndexExists(connection, tableName, indexName, indexDefinition) {
    try {
        const [existingIndexes] = await connection.query(
            `SHOW INDEX FROM ${tableName} WHERE Key_name = ?`,
            [indexName]
        );
        
        if (existingIndexes.length === 0) {
            console.log(`Creating index ${indexName} on ${tableName}`);
            await connection.query(
                `CREATE INDEX ${indexName} ON ${tableName} (${indexDefinition})`
            );
            return true;
        }
        return false;
    } catch (error) {
        console.error(`Error checking/creating index ${indexName}:`, error);
        return false;
    }
}

// Utility to log training metrics
function logTrainingMetrics(modelKey, metrics) {
    try {
        const logDir = path.join(process.cwd(), 'logs');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        const logPath = path.join(logDir, 'training_logs.json');
        const logEntry = {
            timestamp: new Date().toISOString(),
            modelKey,
            ...metrics
        };

        // Append to log file
        fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n');
    } catch (error) {
        console.error('Error logging training metrics:', error);
    }
}

module.exports = {
    scale,
    oneHotEncode,
    handleMissingValues,
    normalizeData,
    ensureIndexExists,
    logTrainingMetrics
};
