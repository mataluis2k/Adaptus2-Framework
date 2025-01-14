require('dotenv').config(); // Ensure environment variables are loaded

const UniversalApiClient = require('../src/modules/UniversalApiClient');

module.exports = {
    name: 'facebookMarketingPlugin',
    version: '1.0.0',

    /**
     * Initialize the plugin and register actions in the global context.
     * @param {Object} dependencies - Dependencies provided by the server.
     */
    initialize(dependencies) {
        const { context } = dependencies;

        if (!context || !context.actions) {
            throw new Error('Global context with actions is required for Facebook Marketing Plugin.');
        }

        /**
         * Send event to Facebook Marketing API.
         * @param {Object} ctx - Context object containing configuration.
         * @param {Object} params - Parameters including `eventType` and `payload`.
         */
        async function sendFacebookEvent(ctx, params) {
            const { eventType, payload } = params;

            // Validate inputs
            if (!eventType || typeof eventType !== 'string') {
                throw new Error('Invalid "eventType". It must be a non-empty string.');
            }
            if (!payload || typeof payload !== 'object') {
                throw new Error('Invalid "payload". It must be a non-empty object.');
            }

            // Load Facebook configuration dynamically
            const facebookApiBaseUrl = ctx.config.facebookApiBaseUrl || process.env.FACEBOOK_API_BASE_URL;
            const accessToken = ctx.config.facebookAccessToken || process.env.FACEBOOK_ACCESS_TOKEN;
            const pixelId = ctx.config.facebookPixelId || process.env.FACEBOOK_PIXEL_ID;

            if (!facebookApiBaseUrl || !accessToken || !pixelId) {
                throw new Error(
                    'Missing Facebook configuration. Ensure FACEBOOK_API_BASE_URL, FACEBOOK_ACCESS_TOKEN, and FACEBOOK_PIXEL_ID are set.'
                );
            }

            const facebookApiClient = new UniversalApiClient({
                baseUrl: facebookApiBaseUrl,
                authType: 'apiKey',
                authValue: accessToken,
                authHeader: 'Authorization', // Facebook uses Bearer token format
            });

            try {
                // Construct the event payload
                const eventPayload = {
                    data: [
                        {
                            event_name: eventType,
                            event_time: Math.floor(Date.now() / 1000),
                            event_source_url: payload.event_source_url, // URL where the event occurred
                            user_data: payload.user_data, // e.g., email, phone, etc.
                            custom_data: payload.custom_data, // Additional custom event data
                        },
                    ],
                };

                // Send the event to Facebook
                const response = await facebookApiClient.post(`/v12.0/${pixelId}/events`, eventPayload);

                console.log(`Facebook event "${eventType}" sent successfully:`, response);
                return response;
            } catch (error) {
                console.error(`Error sending event "${eventType}" to Facebook:`, error.message);
                throw new Error(`Failed to send event "${eventType}" to Facebook: ${error.message}`);
            }
        }

        // Register the function to the global context
        if (!context.actions.sendFacebookEvent) {
            context.actions.sendFacebookEvent = sendFacebookEvent;
        }

        console.log('Facebook Marketing event action registered in global context.');
    },
};
