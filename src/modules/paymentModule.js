const express = require("express");
const bodyParser = require("body-parser");
//const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY); // Stripe secret key
const braintree = require("braintree"); // Braintree SDK

class PaymentModule {
    constructor(app, dbConfig) {
        this.app = app;
        this.dbConfig = dbConfig;
        if(process.env.PAYMENT_MODULE) {
            return null;
        }

        // Initialize Braintree Gateway
        if (process.env.BRAINTREE_MERCHANT_ID) {
            this.braintreeGateway = new braintree.BraintreeGateway({
                environment: process.env.BRAINTREE_ENV === "production" 
                    ? braintree.Environment.Production 
                    : braintree.Environment.Sandbox,
                merchantId: process.env.BRAINTREE_MERCHANT_ID,
                publicKey: process.env.BRAINTREE_PUBLIC_KEY,
                privateKey: process.env.BRAINTREE_PRIVATE_KEY,
            });
        }

        // Middleware
        this.app.use(bodyParser.json());

        // Register routes
        this.registerRoutes();
    }

    async saveCustomerToDatabase(userId, customerId, provider) {
        const query = `UPDATE users SET stripe_customer_id = ?, braintree_customer_id = ?, provider = ? WHERE id = ?`;
        const connection = await this.dbConfig.getConnection();
        await connection.execute(query, [provider === "stripe" ? customerId : null, provider === "braintree" ? customerId : null, provider, userId]);
        connection.release();
    }

    async createStripeCustomer(email) {
        const customer = await stripe.customers.create({ email });
        return customer;
    }

    async createBraintreeCustomer(email) {
        const { customer } = await this.braintreeGateway.customer.create({ email });
        return customer;
    }

    async createSubscription(provider, customerId, priceId) {
        if (provider === "stripe") {
            const subscription = await stripe.subscriptions.create({
                customer: customerId,
                items: [{ price: priceId }],
                expand: ["latest_invoice.payment_intent"],
            });
            return subscription;
        } else if (provider === "braintree") {
            const subscription = await this.braintreeGateway.subscription.create({
                paymentMethodToken: customerId, // Assuming token represents the payment method
                planId: priceId,
            });
            if (subscription.success) return subscription.subscription;
            throw new Error(subscription.message);
        } else {
            throw new Error("Unsupported provider");
        }
    }

    async createPaymentIntent(provider, customerId, amount, currency) {
        if (provider === "stripe") {
            const paymentIntent = await stripe.paymentIntents.create({
                customer: customerId,
                amount,
                currency,
            });
            return paymentIntent;
        } else if (provider === "braintree") {
            const sale = await this.braintreeGateway.transaction.sale({
                amount: (amount / 100).toFixed(2), // Braintree expects string amounts
                paymentMethodToken: customerId,
                options: { submitForSettlement: true },
            });
            if (sale.success) return sale.transaction;
            throw new Error(sale.message);
        } else {
            throw new Error("Unsupported provider");
        }
    }

    async saveSubscriptionToDatabase(userId, subscription, provider) {
        const query = `
            INSERT INTO subscriptions (user_id, stripe_subscription_id, braintree_subscription_id, status, plan_id, provider)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        const connection = await this.dbConfig.getConnection();
        await connection.execute(query, [
            userId,
            provider === "stripe" ? subscription.id : null,
            provider === "braintree" ? subscription.id : null,
            subscription.status,
            subscription.planId || subscription.items.data[0].price.id,
            provider,
        ]);
        connection.release();
    }

    async savePaymentToDatabase(userId, payment, provider) {
        const query = `
            INSERT INTO payments (user_id, stripe_payment_intent_id, braintree_transaction_id, amount, currency, status, provider)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        const connection = await this.dbConfig.getConnection();
        await connection.execute(query, [
            userId,
            provider === "stripe" ? payment.id : null,
            provider === "braintree" ? payment.id : null,
            payment.amount || payment.amountPaid * 100,
            payment.currency || "USD",
            payment.status,
            provider,
        ]);
        connection.release();
    }

    registerRoutes() {
        // Create a customer
        this.app.post("/payments/create-customer", async (req, res) => {
            const { userId, email, provider } = req.body;

            if (!userId || !email || !provider) {
                return res.status(400).json({ error: "userId, email, and provider are required" });
            }

            try {
                let customer;
                if (provider === "stripe") {
                    customer = await this.createStripeCustomer(email);
                } else if (provider === "braintree") {
                    customer = await this.createBraintreeCustomer(email);
                } else {
                    throw new Error("Invalid provider");
                }

                await this.saveCustomerToDatabase(userId, customer.id, provider);
                res.json({ message: "Customer created successfully", customerId: customer.id });
            } catch (error) {
                console.error("Error creating customer:", error.message);
                res.status(500).json({ error: "Failed to create customer" });
            }
        });

        // Create a subscription
        this.app.post("/subscriptions/create", async (req, res) => {
            const { userId, priceId, provider } = req.body;

            if (!userId || !priceId || !provider) {
                return res.status(400).json({ error: "userId, priceId, and provider are required" });
            }

            try {
                const query = `SELECT stripe_customer_id, braintree_customer_id FROM users WHERE id = ?`;
                const connection = await this.dbConfig.getConnection();
                const [rows] = await connection.execute(query, [userId]);
                connection.release();

                const customerId = provider === "stripe" ? rows[0].stripe_customer_id : rows[0].braintree_customer_id;

                const subscription = await this.createSubscription(provider, customerId, priceId);
                await this.saveSubscriptionToDatabase(userId, subscription, provider);

                res.json({ message: "Subscription created successfully", subscription });
            } catch (error) {
                console.error("Error creating subscription:", error.message);
                res.status(500).json({ error: "Failed to create subscription" });
            }
        });

        // Create a one-time payment
        this.app.post("/payments/create", async (req, res) => {
            const { userId, amount, currency, provider } = req.body;

            if (!userId || !amount || !currency || !provider) {
                return res.status(400).json({ error: "userId, amount, currency, and provider are required" });
            }

            try {
                const query = `SELECT stripe_customer_id, braintree_customer_id FROM users WHERE id = ?`;
                const connection = await this.dbConfig.getConnection();
                const [rows] = await connection.execute(query, [userId]);
                connection.release();

                const customerId = provider === "stripe" ? rows[0].stripe_customer_id : rows[0].braintree_customer_id;

                const payment = await this.createPaymentIntent(provider, customerId, amount * 100, currency);
                await this.savePaymentToDatabase(userId, payment, provider);

                res.json({ message: "Payment initiated successfully", payment });
            } catch (error) {
                console.error("Error creating payment:", error.message);
                res.status(500).json({ error: "Failed to create payment" });
            }
        });
    }
}

module.exports = PaymentModule;
