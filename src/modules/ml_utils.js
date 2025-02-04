/**
 * ML utility functions for data preprocessing and normalization
 */

// Utility to scale numerical values with robust error handling
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
        if (values.some(v => typeof v !== 'number' || isNaN(v))) {
            throw new Error('All values must be valid numbers');
        }

        let scaleParams;
        if (existingParams) {
            // Validate existing parameters
            if (!existingParams.min || !existingParams.max) {
                throw new Error('Invalid scaling parameters');
            }
            scaleParams = existingParams;
        } else {
            const validValues = values.filter(v => !isNaN(v) && isFinite(v));
            if (validValues.length === 0) {
                throw new Error('No valid values to scale');
            }
            scaleParams = {
                min: Math.min(...validValues),
                max: Math.max(...validValues)
            };
        }

        // Handle edge case where min equals max
        if (scaleParams.min === scaleParams.max) {
            return {
                scaled: Array.isArray(value) ? values.map(() => min) : min,
                scaleParams
            };
        }

        // Perform scaling
        const scaleValue = (v) => {
            if (isNaN(v) || !isFinite(v)) return null;
            return (v - scaleParams.min) / (scaleParams.max - scaleParams.min) * (max - min) + min;
        };

        const scaled = Array.isArray(value) ? values.map(scaleValue) : scaleValue(value);
        return { scaled, scaleParams };
    } catch (error) {
        console.error('Error in scale function:', error);
        throw error;
    }
}

// Utility to one-hot encode categorical values with enhanced functionality
function oneHotEncode(value, existingCategories = null) {
    try {
        // Handle null/undefined values
        if (value === null || value === undefined) {
            throw new Error('Cannot encode null or undefined values');
        }

        // Convert value to string for consistent handling
        const stringValue = String(value);

        let categories = existingCategories ? [...existingCategories] : [];
        
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
        throw error;
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

module.exports = {
    scale,
    oneHotEncode,
    handleMissingValues
};
