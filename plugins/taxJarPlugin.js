module.exports = {
    name: 'taxJarPlugin',
    version: '1.0.0',

    /**
     * Initialize the plugin and register actions in the global context.
     * @param {Object} dependencies - Dependencies provided by the server.
     */
    initialize(dependencies) {
        const { context, customRequire } = dependencies;
        const UniversalApiClient = customRequire('../src/modules/universalAPIClient');

        if (!context || !context.actions) {
            throw new Error('Global context with actions is required for taxJarPlugin.');
        }

        /**
         * Fetch tax information from TaxJar.
         * @param {Object} ctx - Context object containing configuration.
         * @param {Object} params - Parameters for the TaxJar request.
         * @returns {Promise<Object>} - Tax information response from TaxJar.
         */
        async function getTaxInfo(ctx, params) {
            if (!params || typeof params !== 'object') {
                throw new Error('Invalid parameters. Ensure params is a valid object.');
            }

            const taxJarApiKey = ctx.config.taxJarApiKey || process.env.TAXJAR_API_KEY;
            if (!taxJarApiKey) {
                throw new Error('Missing configuration. Ensure taxJarApiKey is set in context or environment variables.');
            }

            try {
                const taxJarClient = new UniversalApiClient({
                    baseUrl: 'https://api.taxjar.com/v2',
                    authType: 'token',
                    authValue: taxJarApiKey,
                });

                const response = await taxJarClient.get('/taxes', params);
                console.log('getTaxInfo executed successfully:', response);

                return response;
            } catch (error) {
                console.error('Error in getTaxInfo:', error.message);
                throw new Error(`Failed to retrieve tax information: ${error.message}`);
            }
        }

        // Register the function to the global context
        if (!context.actions.getTaxInfo) {
            context.actions.getTaxInfo = getTaxInfo;
        }

        console.log('taxJarPlugin action registered in global context.');
    },
};
