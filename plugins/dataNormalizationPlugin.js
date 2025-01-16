

module.exports = {
    name: 'dataNormalizationPlugin',
    version: '1.0.0',

    initialize(dependencies) {
        const { customRequire } = dependencies;
        const { globalContext } = customRequire('../src/modules/context'); // Import shared globalContext
        const { scale, oneHotEncode } = customRequire('../utils/normalizationUtils'); // Custom utility functions for scaling and encoding
        console.log('Initializing dataNormalizationPlugin...');
        this.extendContext();
    },

    async cleanup() {
        console.log('Cleaning up dataNormalizationPlugin...');
        // Perform any necessary cleanup
    },

    /**
     * Normalize a dataset for ML training
     * @param {Array} data - The dataset to normalize (array of objects)
     * @param {Object} schema - Schema describing transformations (e.g., categorical, numerical fields)
     * @returns {Object} Normalized data and metadata for inverse transformation
     */
    normalizeData(data, schema) {
        const normalizedData = [];
        const metadata = {};

        data.forEach((row) => {
            const normalizedRow = {};
            for (const field in schema) {
                const { type, scaleRange } = schema[field];
                if (type === 'categorical') {
                    // One-hot encode categorical values
                    const { encoded, categories } = oneHotEncode(row[field], metadata[field]?.categories);
                    normalizedRow[field] = encoded;
                    metadata[field] = { type, categories };
                } else if (type === 'numerical') {
                    // Scale numerical values
                    const { scaled, scaleParams } = scale(row[field], scaleRange || [0, 1], metadata[field]?.scaleParams);
                    normalizedRow[field] = scaled;
                    metadata[field] = { type, scaleParams };
                } else {
                    // Pass through unsupported types
                    normalizedRow[field] = row[field];
                }
            }
            normalizedData.push(normalizedRow);
        });

        return { normalizedData, metadata };
    },

    extendContext() {
        globalContext.actions.normalizeForML = async (ctx, params) => {
            const { data, schema } = params;
            if (!data || !schema) {
                throw new Error('Both data and schema are required for normalization');
            }
            return this.normalizeData(data, schema);
        };
    },
};
