const express = require('express');

class PaymentWebhookModule {
    constructor(globalContext, dbConfig, app, options) {
        this.globalContext = globalContext;
        this.dbConfig = dbConfig;
        this.app = app;
        this.setupRoutes();
        this.extendContext();
        this.options = options || {};
        // If this safe guard is not set, we will use the default schema
        // from the options passed to the constructor
            if(!this.options.schema) {
                this.options.schema = options.schema || {
                    table: 'payments',
                    orderKey: 'order_id',
                    fields: {
                        transactionId: 'transaction_id',
                        amount: 'amount',
                        provider: 'provider',
                        subscriptionId: 'subscription_id'
                    }
                };
            }
    }

    setupRoutes() {
        this.app.post('/webhooks/payment-action', this.handleWebhook.bind(this));
    }

            async handleWebhook(req, res) {
            const { action, order_id, amount } = req.body;
            const schema = this.options.schema;

            if (!action || !order_id) {
                return res.status(400).json({ error: "Missing 'action' or 'order_id' in request body." });
            }

            if (!schema || !schema.table || !schema.orderKey || !schema.fields) {
                return res.status(500).json({ error: "Webhook schema configuration is invalid or missing." });
            }

            try {
                const connection = await this.dbConfig.getDbConnection();
                const [rows] = await connection.execute(
                    `SELECT * FROM ${schema.table} WHERE ${schema.orderKey} = ? LIMIT 1`, [order_id]
                );
                connection.release();

                if (rows.length === 0) {
                    return res.status(404).json({ error: "Payment not found." });
                }

                const payment = rows[0];

                // Extract mapped fields
                const transactionId = payment[schema.fields.transactionId];
                const paymentAmount = payment[schema.fields.amount];
                const provider = payment[schema.fields.provider];
                const subscriptionId = payment[schema.fields.subscriptionId];

                // Defensive checks
                if (action === 'refundPartial' && (!amount || amount <= 0)) {
                    return res.status(400).json({ error: "Partial refund requires a valid 'amount'." });
                }

                if (amount && amount > paymentAmount) {
                    return res.status(400).json({ error: "Refund amount exceeds original payment." });
                }

                const transport = this.globalContext.transports?.[provider];
                if (!transport || typeof transport[action] !== 'function') {
                    return res.status(400).json({ error: `Unsupported action '${action}' for provider '${provider}'.` });
                }

                let result;
                switch (action) {
                    case 'refundFull':
                        result = await transport.refundFull({ transactionId });
                        break;
                    case 'refundPartial':
                        result = await transport.refundPartial({ transactionId, amount });
                        break;
                    case 'cancelSubscription':
                        result = await transport.cancelSubscription({ subscriptionId });
                        break;
                    case 'pauseSubscription':
                        result = await transport.pauseSubscription({ subscriptionId });
                        break;
                    default:
                        return res.status(400).json({ error: `Unknown action '${action}'` });
                }

                return res.status(200).json({ success: true, result });

            } catch (err) {
                console.error('Webhook Error:', err.message);
                return res.status(500).json({ error: 'Internal server error.' });
            }
        }

    extendContext() {
        if (!this.globalContext.actions) this.globalContext.actions = {};

        this.globalContext.actions.handlePaymentWebhook = async (ctx, params) => {
            return await this.handleWebhook(params);
        };
    }
}

module.exports = PaymentWebhookModule;
