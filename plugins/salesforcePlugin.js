require('dotenv').config(); // Ensure environment variables are loaded
const UniversalApiClient = require('../src/modules/universalAPIClient');

module.exports = {
    name: 'salesforcePushPlugin',
    version: '1.0.0',

    initialize(dependencies) {
        const { context } = dependencies;

        if (!context || !context.actions) {
            throw new Error('Global context with actions is required for Salesforce Push Plugin.');
        }

        /**
         * Push customer data to Salesforce.
         * @param {Object} ctx - Context object containing configuration.
         * @param {Object} params - Parameters including `data` (array of customer records).
         */
        async function pushCustomersToSalesforce(ctx, params) {
            const { data } = params;

            if (!Array.isArray(data) || data.length === 0) {
                throw new Error('Invalid data. "data" must be a non-empty array of customer objects.');
            }

            // Load Salesforce configuration dynamically
            const salesforceBaseUrl = process.env.SALESFORCE_BASE_URL;
            const salesforceApiToken = process.env.SALESFORCE_API_TOKEN;
            const salesforceApiVersion = process.env.SALESFORCE_API_VERSION || '50.0';

            if (!salesforceBaseUrl || !salesforceApiToken) {
                throw new Error('Missing Salesforce configuration. Ensure SALESFORCE_BASE_URL and SALESFORCE_API_TOKEN are set.');
            }

            const salesforceApiClient = new UniversalApiClient({
                baseUrl: salesforceBaseUrl,
                authType: 'token',
                authValue: salesforceApiToken,
            });
  

            try {
                const salesforcePayload = data.map((customer) => ({
                    FirstName: customer.first_name,
                    LastName: customer.last_name,
                    Email: customer.email,
                    Phone: customer.phone,
                    OrderId__c: customer.order_id,
                    Value__c: customer.value,
                    LeadScore__c: customer.leadScore,
                }));

                const url = `/services/data/v${salesforceApiVersion}/sobjects/Lead/`;
                const response = await salesforceApiClient.post(url, {
                    records: salesforcePayload,
                });

                console.log('Customers pushed successfully to Salesforce:', response);
                return response;
            } catch (error) {
                console.error('Error pushing customers to Salesforce:', error.message);
                throw new Error(`Failed to push customers to Salesforce: ${error.message}`);
            }
        }

        // Register the function to the global context
        if (!context.actions.pushCustomersToSalesforce) {
            context.actions.pushCustomersToSalesforce = pushCustomersToSalesforce;
        }

        console.log('Salesforce push action registered in global context.');
    },
};
