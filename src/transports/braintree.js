const braintree = require('braintree');

class BraintreeTransport {
    constructor(options) {
        if (!options.merchantId || !options.publicKey || !options.privateKey) {
            throw new Error('Braintree credentials are required.');
        }
        this.client = new braintree.BraintreeGateway({
            environment: options.environment === 'production'
                ? braintree.Environment.Production
                : braintree.Environment.Sandbox,
            merchantId: options.merchantId,
            publicKey: options.publicKey,
            privateKey: options.privateKey,
        });
    }

    async createCustomer({ email }) {
        const { customer } = await this.client.customer.create({ email });
        return customer;
    }

    async createPayment({ customerId, amount, currency }) {
        const sale = await this.client.transaction.sale({
            amount: (amount / 100).toFixed(2), // Braintree expects string amounts
            paymentMethodToken: customerId,
            options: { submitForSettlement: true },
        });
        if (sale.success) return sale.transaction;
        throw new Error(sale.message);
    }

    async createSubscription({ customerId, priceId }) {
        const subscription = await this.client.subscription.create({
            paymentMethodToken: customerId,
            planId: priceId,
        });
        if (subscription.success) return subscription.subscription;
        throw new Error(subscription.message);
    }
}

module.exports = BraintreeTransport;
