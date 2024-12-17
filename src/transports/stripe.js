const stripe = require('stripe');

class StripeTransport {
    constructor(options) {
        if (!options.apiKey) {
            throw new Error('Stripe API key is required.');
        }
        this.client = stripe(options.apiKey);
    }

    async createCustomer({ email }) {
        return await this.client.customers.create({ email });
    }

    async createPayment({ customerId, amount, currency }) {
        return await this.client.paymentIntents.create({
            customer: customerId,
            amount,
            currency,
        });
    }

    async createSubscription({ customerId, priceId }) {
        return await this.client.subscriptions.create({
            customer: customerId,
            items: [{ price: priceId }],
        });
    }
}

module.exports = StripeTransport;
