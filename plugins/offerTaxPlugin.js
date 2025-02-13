module.exports = {
    name: 'offerTaxPlugin',
    version: '1.0.0',

    /**
     * Initialize the plugin and register actions in the global context.
     * @param {Object} dependencies - Dependencies provided by the server.
     */
    initialize(dependencies) {
        const { context, customRequire } = dependencies;
        const { getDbConnection, query } = customRequire('../src/modules/db');

        if (!context || !context.actions) {
            throw new Error('Global context with actions is required for offerTaxPlugin.');
        }

        /**
         * Fetch offers, calculate tax using TaxJar, and return the final offer details.
         * @param {Object} ctx - Context object containing configuration.
         * @param {Object} params - Parameters containing optional offer ID.
         * @returns {Promise<Object>} - Offer details with tax information.
         */
        async function getOfferWithTax(ctx, params) {
            if (!params || typeof params !== 'object') {
                throw new Error('Invalid parameters. Ensure params is a valid object.');
            }

            const dbConfig = ctx.config.dbConfig || process.env.DB_CONFIG;
            if (!dbConfig) {
                throw new Error('Missing database configuration. Ensure dbConfig is set.');
            }

            const userId = ctx.user.id;
            if (!userId) {
                throw new Error('User ID is required to fetch address.');
            }

            try {
                // Fetch user's address
                const addressQuery = `SELECT CONCAT(street1, street2, street3) as street, city, state, country, postal_code FROM addresses WHERE user_id = '${userId}' AND deleted_at IS NULL`;
                const [address] = await query(dbConfig, addressQuery);
                if (!address) {
                    throw new Error('No address found for user.');
                }

                // Fetch offer
                let offerQuery = 'SELECT * FROM offers';
                if (params.id) {
                    offerQuery += ` WHERE id='${params.id}'`;
                }
                const offers = await query(dbConfig, offerQuery);
                if (offers.length === 0) {
                    throw new Error('No offers found.');
                }

                // Build tax request payload
                const taxPayload = {
                    amount: offers.reduce((sum, offer) => sum + offer.price, 0),
                    shipping: 0,
                    line_items: offers.map(offer => ({
                        id: offer.id,
                        description: offer.description,
                        quantity: offer.quantity || 1,
                        product_tax_code: offer.tax_code || 'default_tax_code',
                        unit_price: offer.price,
                    })),
                    country: address.country,
                    state: address.state,
                    city: address.city,
                    postal_code: address.postal_code,
                };

                // Fetch tax info using TaxJar
                const taxInfo = await context.actions.getTaxInfo(ctx, taxPayload);

                // Merge tax info with offers
                return { offers, tax: taxInfo };
            } catch (error) {
                console.error('Error in getOfferWithTax:', error.message);
                throw new Error(`Failed to retrieve offers with tax: ${error.message}`);
            }
        }

        // Register the function to the global context
        if (!context.actions.getOfferWithTax) {
            context.actions.getOfferWithTax = getOfferWithTax;
        }

        console.log('offerTaxPlugin action registered in global context.');
    },
};
