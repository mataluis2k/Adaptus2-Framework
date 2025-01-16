module.exports = {
    name: 'braintreePaymentPlugin',
    version: '1.0.0',

    initialize(dependencies) {
        const { context, customRequire } = dependencies;
        const UniversalApiClient = customRequire('../src/modules/universalAPIClient');

        if (!context || !context.actions) {
            throw new Error('Global context with actions is required for Braintree Payment Plugin.');
        }

        async function processBraintreePayment(ctx, params) {
            const { cart, paymentInfo } = params;

            // Validate input parameters
            if (!cart || !Array.isArray(cart) || !paymentInfo || typeof paymentInfo !== 'object') {
                throw new Error('Invalid parameters. Ensure cart is an array and paymentInfo is an object.');
            }

            // Load Braintree configuration dynamically
            const braintreeBaseUrl = ctx.config.braintreeBaseUrl || process.env.BRAINTREE_BASE_URL;
            const braintreeMerchantId = ctx.config.braintreeMerchantId || process.env.BRAINTREE_MERCHANT_ID;
            const braintreeApiKey = ctx.config.braintreeApiKey || process.env.BRAINTREE_API_KEY;

            if (!braintreeBaseUrl || !braintreeMerchantId || !braintreeApiKey) {
                throw new Error('Missing Braintree configuration. Please check the environment variables or context.');
            }

            // Initialize UniversalApiClient
            const apiClient = new UniversalApiClient({
                baseUrl: braintreeBaseUrl,
                authType: 'apiKey',
                authValue: braintreeApiKey,
            });

            try {
                // Prepare the request payload
                const payload = {
                    merchantId: braintreeMerchantId,
                    cart,
                    paymentInfo,
                };

                // Call the Braintree API to process the payment
                const response = await apiClient.post('/process-payment', payload);

                console.log('Payment processed successfully:', response);
                return response;
            } catch (error) {
                console.error('Error processing Braintree payment:', error.message);
                throw new Error(`Failed to process payment: ${error.message}`);
            }
        }

        // Register the payment processing function
        if (!context.actions.processBraintreePayment) {
            context.actions.processBraintreePayment = processBraintreePayment;
        }

        console.log('Braintree Payment Plugin registered in global context.');
    },
};
