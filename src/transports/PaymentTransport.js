class PaymentTransport {
    constructor() {
        if (this.createCustomer === undefined) {
            throw new Error("Transport must implement createCustomer method.");
        }
        if (this.createPayment === undefined) {
            throw new Error("Transport must implement createPayment method.");
        }
        if (this.createSubscription === undefined) {
            throw new Error("Transport must implement createSubscription method.");
        }
    }
}

module.exports = PaymentTransport;
