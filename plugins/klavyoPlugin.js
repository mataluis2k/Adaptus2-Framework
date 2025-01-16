
const axios = require('axios');

module.exports = {
    name: 'klaviyoPlugin',
    version: '1.0.0',

    /**
     * Initialize the plugin and extend the global context.
     */
    initialize(dependencies) {
        console.log('Initializing klaviyoPlugin...');
        const { context, customRequire } = dependencies;
        const { authenticateMiddleware, aclMiddleware } = customRequire('../src/middleware/authenticationMiddleware');
        const { globalContext } = customRequire('../src/modules/context'); // Import the shared globalContext
        this.extendContext();
    },

    /**
     * Cleanup logic for the plugin.
     */
    async cleanup() {
        console.log('Cleaning up klaviyoPlugin...');
        // Perform cleanup tasks
    },

    /**
     * Insert a customer into Klaviyo's mailing list.
     * @param {object} config - Configuration object (includes Klaviyo API Key and List ID).
     * @param {string} entity - Entity being processed (optional context identifier).
     * @param {object} data - Customer data (e.g., email, name, etc.).
     * @returns {object} - Response from Klaviyo or error object.
     */
    async insertCustomerToKlaviyo(config, entity, data) {
       
        const apiKey = process.env('YOUR_KLAVIYO_API_KEY'); // Replace with your Klaviyo API Key
        const listId = process.env('YOUR_LIST_ID');

        // Need to make sure data is a valid object with at least email
        // Sanitize data if necessary.

        
        if (!email || !listId || !apiKey) {
            throw new Error('Missing required fields: email, listId, or apiKey');
        }

        try {
            const response = await axios.post(
                `https://a.klaviyo.com/api/v2/list/${listId}/members`,
                {
                    profiles: [
                        data
                    ],
                },
                {
                    headers: {
                        Authorization: `Klaviyo-API-Key ${apiKey}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            console.log(`Customer ${email} added to Klaviyo list successfully.`);
            return response.data;
        } catch (error) {
            console.error('Error adding customer to Klaviyo:', error.response?.data || error.message);
            throw error;
        }
    },

    /**
     * Extend the global context to expose the `insertCustomerToKlaviyo` function.
     */
    extendContext() {
        globalContext.actions.addCustomerToKlaviyo = async (ctx, params) => {
            const { entity, data } = params;
            return await this.insertCustomerToKlaviyo(ctx.config, entity, data);
        };
    },
};
