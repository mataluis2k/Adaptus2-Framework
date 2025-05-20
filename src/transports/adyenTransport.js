const { Client, Config, CheckoutAPI, RecurringAPI } = require('@adyen/api-library');

class AdyenTransport {
    constructor(options) {
        if (!options.apiKey || !options.merchantAccount) {
            throw new Error('Adyen credentials are required.');
        }

        const config = new Config();
        config.apiKey = options.apiKey;
        config.merchantAccount = options.merchantAccount;

        this.client = new Client({ config });
        this.client.setEnvironment(options.environment === 'production' ? 'LIVE' : 'TEST');

        this.checkout = new CheckoutAPI(this.client);
        this.recurring = new RecurringAPI(this.client);

        this.merchantAccount = options.merchantAccount;
    }

    async createCustomer({ email }) {
        // Adyen doesn’t create standalone customers. We return a synthetic customer reference
        return { id: `adyen-${Date.now()}`, email };
    }

    async createPayment({ customerId, amount, currency }) {
        // For testing purposes, you must pass real encrypted card data from frontend
        const paymentRequest = {
            amount: { value: amount, currency },
            paymentMethod: {
                type: 'scheme',
                // These must be securely generated in the frontend
                encryptedCardNumber: customerId.cardNumber,
                encryptedExpiryMonth: customerId.expiryMonth,
                encryptedExpiryYear: customerId.expiryYear,
                encryptedSecurityCode: customerId.cvc
            },
            reference: `ORDER-${Date.now()}`,
            merchantAccount: this.merchantAccount
        };

        const result = await this.checkout.payments(paymentRequest);
        if (result.resultCode !== 'Authorised') {
            throw new Error(`Payment failed: ${result.resultCode}`);
        }

        return result;
    }

    async createSubscription({ customerId, priceId }) {
        // Placeholder: real Adyen subscription integration would involve Contracts & scheduled recurring
        throw new Error('Adyen createSubscription is not yet implemented. Requires custom recurring setup.');
    }

    async refundFull({ transactionId }) {
        const result = await this.checkout.paymentsRefunds(transactionId, {
            merchantAccount: this.merchantAccount
        });

        if (result.status !== 'received') {
            throw new Error(`Refund failed: ${result.status}`);
        }

        return result;
    }

    async refundPartial({ transactionId, amount }) {
        const result = await this.checkout.paymentsRefunds(transactionId, {
            amount: {
                currency: 'EUR', // Ideally passed in via params
                value: amount
            },
            merchantAccount: this.merchantAccount
        });

        if (result.status !== 'received') {
            throw new Error(`Partial refund failed: ${result.status}`);
        }

        return result;
    }

    async cancelSubscription({ subscriptionId }) {
        // Adyen does not manage subscriptions the same way; usually handled via contracts and merchant logic
        throw new Error('cancelSubscription is not implemented. Use your internal logic for Adyen.');
    }

    async pauseSubscription({ subscriptionId }) {
        throw new Error('pauseSubscription is not supported by Adyen out of the box.');
    }
}

module.exports = AdyenTransport;
