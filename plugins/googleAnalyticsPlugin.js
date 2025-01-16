
module.exports = {
    name: 'googleAnalyticsPlugin',
    version: '1.0.0',

    /**
     * Initialize the plugin and register actions in the global context.
     * @param {Object} dependencies - Dependencies provided by the server.
     */
    initialize(dependencies) {
        const { context, customRequire } = dependencies;
        const UniversalApiClient = customRequire('../src/modules/universalAPIClient');

        if (!context || !context.actions) {
            throw new Error('Global context with actions is required for Google Analytics Plugin.');
        }

        /**
         * Send event to Google Analytics 4 (GA4) Measurement Protocol.
         * @param {Object} ctx - Context object containing configuration.
         * @param {Object} params - Parameters including `eventType` and `payload`.
         */
        async function sendGA4Event(ctx, params) {
            const { eventType, payload } = params;

            // Validate inputs
            if (!eventType || typeof eventType !== 'string') {
                throw new Error('Invalid "eventType". It must be a non-empty string.');
            }
            if (!payload || typeof payload !== 'object') {
                throw new Error('Invalid "payload". It must be a non-empty object.');
            }

            // Load GA4 configuration dynamically
            const ga4ApiBaseUrl = ctx.config.ga4ApiBaseUrl || process.env.GA4_API_BASE_URL;
            const measurementId = ctx.config.ga4MeasurementId || process.env.GA4_MEASUREMENT_ID;
            const apiSecret = ctx.config.ga4ApiSecret || process.env.GA4_API_SECRET;

            if (!ga4ApiBaseUrl || !measurementId || !apiSecret) {
                throw new Error(
                    'Missing GA4 configuration. Ensure GA4_API_BASE_URL, GA4_MEASUREMENT_ID, and GA4_API_SECRET are set.'
                );
            }

            const ga4ApiClient = new UniversalApiClient({
                baseUrl: ga4ApiBaseUrl,
            });

            try {
                // Construct the GA4 event payload
                const eventPayload = {
                    client_id: payload.client_id || '555', // Replace with dynamic client_id if available
                    events: [
                        {
                            name: eventType,
                            params: payload.params || {}, // Include event-specific parameters
                        },
                    ],
                };

                // Append measurement ID and API secret to the request URL
                const endpoint = `/mp/collect?measurement_id=${measurementId}&api_secret=${apiSecret}`;

                // Send the event to GA4
                const response = await ga4ApiClient.post(endpoint, eventPayload);

                console.log(`GA4 event "${eventType}" sent successfully:`, response);
                return response;
            } catch (error) {
                console.error(`Error sending event "${eventType}" to GA4:`, error.message);
                throw new Error(`Failed to send event "${eventType}" to GA4: ${error.message}`);
            }
        }

        // Register the function to the global context
        if (!context.actions.sendGA4Event) {
            context.actions.sendGA4Event = sendGA4Event;
        }

        console.log('GA4 event action registered in global context.');
    },
};
