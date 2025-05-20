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
            amount: (amount / 100).toFixed(2),
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

    async refundFull({ transactionId }) {
        const result = await this.client.transaction.refund(transactionId);
        if (result.success) return result.transaction;
        throw new Error(result.message);
    }

    async refundPartial({ transactionId, amount }) {
        const result = await this.client.transaction.refund(transactionId, (amount / 100).toFixed(2));
        if (result.success) return result.transaction;
        throw new Error(result.message);
    }

    async cancelSubscription({ subscriptionId }) {
        const result = await this.client.subscription.cancel(subscriptionId);
        if (result.success) return result.subscription;
        throw new Error(result.message);
    }

    async pauseSubscription({ subscriptionId }) {
        const result = await this.client.subscription.update(subscriptionId, {
            status: 'Paused',
        });
        if (result.success) return result.subscription;
        throw new Error(result.message);
    }
}

module.exports = BraintreeTransport;
