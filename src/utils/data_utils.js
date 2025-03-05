/**
 * Data Preprocessing Utilities
 * 
 * Common functions for data preprocessing and normalization
 */

/**
 * Scale numerical values to a specified range
 * 
 * @param {number|Array} value - Value or array of values to scale
 * @param {Array} range - Target range as [min, max]
 * @param {Object} existingParams - Optional existing scaling parameters
 * @returns {Object} - Scaled values and scaling parameters
 */
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
            if (typeof v !== 'number' || isNaN(v) || !isFinite(v)) return (min + max) / 2;
            return (v - scaleParams.min) / (scaleParams.max - scaleParams.min) * (max - min) + min;
        };

        const scaled = Array.isArray(value) ? values.map(scaleValue) : scaleValue(value);
        return { scaled, scaleParams };
    } catch (error) {
        console.error('Error in scale function:', error);
        throw error;
    }
}

/**
 * One-hot encode categorical values
 * 
 * @param {any} value - Value to encode
 * @param {Array} existingCategories - Optional existing categories
 * @returns {Object} - Encoded value, categories, and mapping
 */
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

/**
 * Handle missing values in data
 * 
 * @param {Array} data - Array of values that may contain missing values
 * @param {string} strategy - Strategy for handling missing values
 * @returns {Array} - Data with missing values handled
 */
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
            // If no valid data, return array of zeros or empty array
            return strategy === 'remove' ? [] : Array(data.length).fill(0);
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
                const entries = Object.entries(counts);
                replacementValue = entries.reduce((a, b) => a[1] > b[1] ? a : b)[0];
                replacementValue = Number(replacementValue); // Convert back to number
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

/**
 * Normalize data to a specific range
 * 
 * @param {Array} data - Array of values to normalize
 * @param {number} min - Minimum value of target range
 * @param {number} max - Maximum value of target range
 * @returns {Array} - Normalized data
 */
function normalizeData(data, min = 0, max = 1) {
    try {
        if (!Array.isArray(data)) {
            throw new Error('Data must be an array');
        }

        const validData = data.filter(v => typeof v === 'number' && !isNaN(v) && isFinite(v));
        if (validData.length === 0) {
            return Array(data.length).fill((min + max) / 2);
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

/**
 * Extract features from dates for time series analysis
 * 
 * @param {Array} dates - Array of Date objects
 * @param {string} aggregationLevel - Level of aggregation (hourly, daily, weekly, monthly)
 * @returns {Object} - Extracted time features
 */
function extractTimeFeatures(dates, aggregationLevel = 'daily') {
    const features = {
        dayOfWeek: [],
        month: [],
        quarter: [],
        year: [],
        dayOfMonth: [],
        weekOfYear: []
    };
    
    // Add hour of day for hourly aggregation
    if (aggregationLevel === 'hourly') {
        features.hourOfDay = [];
    }
    
    for (const date of dates) {
        // Basic features
        features.dayOfWeek.push(date.getDay() / 6); // Normalize to 0-1
        features.month.push(date.getMonth() / 11); // Normalize to 0-1
        features.quarter.push(Math.floor(date.getMonth() / 3) / 3); // Normalize to 0-1
        features.year.push((date.getFullYear() - 2000) / 30); // Rough normalization
        features.dayOfMonth.push((date.getDate() - 1) / 30); // Normalize to 0-1
        
        // Week of year
        const startOfYear = new Date(date.getFullYear(), 0, 1);
        const millisecondsPerDay = 86400000; // 24 * 60 * 60 * 1000
        const dayOfYear = Math.floor((date - startOfYear) / millisecondsPerDay);
        const weekOfYear = Math.floor(dayOfYear / 7);
        features.weekOfYear.push(weekOfYear / 52); // Normalize to 0-1
        
        // Hour of day for hourly aggregation
        if (aggregationLevel === 'hourly') {
            features.hourOfDay.push(date.getHours() / 23); // Normalize to 0-1
        }
    }
    
    // Add sinusoidal features for cyclical data (day of week, month, etc.)
    // These capture the cyclical nature of time better than linear values
    features.sinDayOfWeek = features.dayOfWeek.map(v => Math.sin(2 * Math.PI * v));
    features.cosDayOfWeek = features.dayOfWeek.map(v => Math.cos(2 * Math.PI * v));
    features.sinMonth = features.month.map(v => Math.sin(2 * Math.PI * v));
    features.cosMonth = features.month.map(v => Math.cos(2 * Math.PI * v));
    
    if (aggregationLevel === 'hourly') {
        features.sinHourOfDay = features.hourOfDay.map(v => Math.sin(2 * Math.PI * v));
        features.cosHourOfDay = features.hourOfDay.map(v => Math.cos(2 * Math.PI * v));
    }
    
    return features;
}

/**
 * Detect seasonality in time series data
 * 
 * @param {Array} values - Time series values
 * @param {Array} periods - Potential seasonality periods to check
 * @returns {Object} - Detected seasonality information
 */
function detectSeasonality(values, periods = [7, 30, 365]) {
    const result = {
        hasSeasonality: false,
        mainPeriod: null,
        strength: 0,
        periods: {}
    };
    
    // Calculate mean and standard deviation
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const stdDev = Math.sqrt(values.reduce((sq, val) => sq + Math.pow(val - mean, 2), 0) / values.length);
    
    // If not enough data or no variation, return early
    if (values.length < 10 || stdDev === 0) {
        return result;
    }
    
    // Test each seasonality period
    for (const period of periods) {
        // Skip if not enough data for this period
        if (values.length < period * 2) {
            continue;
        }
        
        // Calculate autocorrelation for this period
        let autocorrelation = 0;
        let validPairs = 0;
        
        for (let i = 0; i < values.length - period; i++) {
            autocorrelation += (values[i] - mean) * (values[i + period] - mean);
            validPairs++;
        }
        
        // Normalize
        autocorrelation = autocorrelation / (validPairs * stdDev * stdDev);
        
        // Store result
        result.periods[period] = {
            autocorrelation,
            significant: autocorrelation > 0.3 // Arbitrary threshold
        };
        
        // Update main period if this one is more significant
        if (result.periods[period].significant && 
            (result.mainPeriod === null || 
             Math.abs(result.periods[period].autocorrelation) > Math.abs(result.periods[result.mainPeriod].autocorrelation))) {
            result.mainPeriod = period;
            result.strength = Math.abs(result.periods[period].autocorrelation);
            result.hasSeasonality = true;
        }
    }
    
    return result;
}

/**
 * Handle outliers in time series data
 * 
 * @param {Array} values - Time series values
 * @param {string} method - Method for handling outliers (remove, winsorize, none)
 * @returns {Array} - Values with outliers handled
 */
function handleOutliers(values, method = 'winsorize') {
    if (method === 'none' || values.length < 4) {
        return [...values];
    }
    
    // Calculate quartiles
    const sorted = [...values].sort((a, b) => a - b);
    const q1Index = Math.floor(sorted.length * 0.25);
    const q3Index = Math.floor(sorted.length * 0.75);
    
    const q1 = sorted[q1Index];
    const q3 = sorted[q3Index];
    
    // Calculate IQR and bounds
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;
    
    // Process values based on method
    if (method === 'remove') {
        return values.filter(v => v >= lowerBound && v <= upperBound);
    } else if (method === 'winsorize') {
        return values.map(v => {
            if (v < lowerBound) return lowerBound;
            if (v > upperBound) return upperBound;
            return v;
        });
    }
    
    // Default: return original values
    return [...values];
}

/**
 * Encode categorical variables
 * 
 * @param {Array} data - Array of categorical values
 * @param {string} method - Encoding method (onehot, label, dummy)
 * @returns {Object} - Encoded data and mapping information
 */
function encodeCategorical(data, method = 'onehot') {
    if (!Array.isArray(data)) {
        throw new Error('Data must be an array');
    }
    
    // Get unique categories
    const categories = [...new Set(data.filter(v => v !== null && v !== undefined))];
    categories.sort(); // Sort for consistency
    
    // Create mapping from categories to indices
    const mapping = Object.fromEntries(categories.map((cat, idx) => [cat, idx]));
    
    let encoded;
    if (method === 'label') {
        // Label encoding: convert each category to its index
        encoded = data.map(value => {
            if (value === null || value === undefined) return -1; // Handle missing values
            return mapping[value];
        });
        
        return { encoded, categories, mapping, method };
    } 
    else if (method === 'onehot' || method === 'dummy') {
        // One-hot or dummy encoding: create a binary vector for each category
        const numCategories = method === 'dummy' ? categories.length - 1 : categories.length;
        encoded = [];
        
        for (const value of data) {
            if (value === null || value === undefined) {
                // Handle missing values with zeros
                encoded.push(Array(numCategories).fill(0));
            } else {
                const index = mapping[value];
                const vector = Array(numCategories).fill(0);
                
                // For dummy encoding, don't set any bit for the last category
                if (method === 'dummy' && index === categories.length - 1) {
                    // All zeros for the reference category
                } else {
                    // Set the appropriate bit
                    const vectorIndex = method === 'dummy' ? index : index;
                    if (vectorIndex < numCategories) {
                        vector[vectorIndex] = 1;
                    }
                }
                
                encoded.push(vector);
            }
        }
        
        return { encoded, categories, mapping, method };
    }
    
    throw new Error(`Unsupported encoding method: ${method}`);
}

/**
 * Impute missing values in a dataset
 * 
 * @param {Array<Array>} data - 2D array of data
 * @param {Array<string>} strategies - Imputation strategy for each column
 * @returns {Array<Array>} - Data with missing values imputed
 */
function imputeMissingValues(data, strategies) {
    if (!Array.isArray(data) || !Array.isArray(strategies)) {
        throw new Error('Data and strategies must be arrays');
    }
    
    if (data.length === 0) return [];
    
    // Transpose data to work with columns
    const columns = [];
    const numRows = data.length;
    const numCols = data[0].length;
    
    for (let j = 0; j < numCols; j++) {
        const column = [];
        for (let i = 0; i < numRows; i++) {
            column.push(data[i][j]);
        }
        columns.push(column);
    }
    
    // Apply imputation strategies to each column
    for (let j = 0; j < numCols; j++) {
        const strategy = strategies[j] || 'mean';
        columns[j] = handleMissingValues(columns[j], strategy);
    }
    
    // Transpose back to original format
    const imputedData = [];
    for (let i = 0; i < numRows; i++) {
        const row = [];
        for (let j = 0; j < numCols; j++) {
            row.push(columns[j][i]);
        }
        imputedData.push(row);
    }
    
    return imputedData;
}

module.exports = {
    scale,
    oneHotEncode,
    handleMissingValues,
    normalizeData,
    extractTimeFeatures,
    detectSeasonality,
    handleOutliers,
    encodeCategorical,
    imputeMissingValues
};