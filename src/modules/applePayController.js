const UniversalApiClient = require('./universalAPIClient');
const db = require('./db');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class ApplePayController {
    constructor(app) {
        this.app = app;
        this.config = this.loadConfig();
        this.apiClient = new UniversalApiClient({ baseUrl: '' }); // Set dynamically if needed
    }

    loadConfig() {
        const configPath = path.join(__dirname, 'config', 'applePaymentConfig.json');
        if (!fs.existsSync(configPath)) {
            throw new Error("Missing configuration file: applePaymentConfig.json");
        }
        return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }

    registerRoutes() {
        this.app.post('/apple-pay/webhook', async (req, res) => {
            try {
                const { userId, receiptData } = req.body;
                if (!userId || !receiptData) {
                    return res.status(400).json({ error: 'Missing userId or receiptData' });
                }
        
                const result = await this.verifyReceipt(userId, receiptData);
                res.json(result);
            } catch (error) {
                console.error('Apple Pay Webhook Error:', error);
                res.status(500).json({ error: 'Internal Server Error' });
            }
        });
    }        

    get receiptVerifyUri() {
        return this.config.isSandbox 
            ? this.config.receiptVerifySandbox
            : this.config.receiptVerifyProduction;
    }

    static APPLE_PAY_STATUS_CODES = {
        21000: 'The App Store could not read the JSON object you provided.',
        21002: 'The data in the receipt-data property was malformed or missing.',
        21003: 'The receipt could not be authenticated.',
        21004: 'The shared secret you provided does not match the shared secret on file for your account.',
        21005: 'The receipt server is not currently available.',
        21006: 'This receipt is valid but the subscription has expired.',
        21007: 'This receipt is from the test environment, but it was sent to the production environment.',
        21008: 'This receipt is from the production environment, but it was sent to the test environment.',
        21010: 'This receipt could not be authorized. Treat this the same as if a purchase was never made.',
    };

    async verifyReceipt(userId, receiptData) {
        try {
            let receipt = await this.decodeReceipt(this.receiptVerifyUri, receiptData);

            if (!this.isReceiptValid(receipt)) {
                const retryUri = this.getRetryUri(receipt);
                if (retryUri) {
                    receipt = await this.decodeReceipt(retryUri, receiptData);
                }
                if (!this.isReceiptValid(receipt)) {
                    throw new Error(this.getStatusErrorMessage(receipt));
                }
            }

            const validatedPurchases = [];
            for (const purchase of receipt.receipt.in_app || []) {
                const model = await this.getPurchaseModel(purchase.product_id);

                if (!model) continue;

                if (model.type === 'plan') {
                    const subscription = await this.createSubscription(userId, model, purchase, receipt);
                    if (subscription) {
                        validatedPurchases.push(model.product_id);
                    }
                } else {
                    const orderCreated = await this.createOrder(userId, model, purchase, receiptData);
                    if (orderCreated) {
                        validatedPurchases.push(model.product_id);
                    }
                }
            }

            return validatedPurchases.length > 0
                ? { success: true, message: 'Access granted to purchased products', product_ids: validatedPurchases }
                : { success: false, message: 'No valid purchases found' };

        } catch (error) {
            return { success: false, message: `Receipt verification failed: ${error.message}` };
        }
    }

    async decodeReceipt(uri, receiptData) {
        return await this.apiClient.post(uri, {
            password: process.env.APPLE_PAY_SECRET,
            'receipt-data': receiptData,
        });
    }

    isReceiptValid(receipt) {
        return receipt.status === 0;
    }

    getRetryUri(receipt) {
        return receipt.status === 21007
            ? this.config.receiptVerifySandbox
            : this.config.receiptVerifyProduction;
    }

    getStatusErrorMessage(receipt) {
        return ApplePayController.APPLE_PAY_STATUS_CODES[receipt.status] || 'Unknown error';
    }

    async getPurchaseModel(productId) {
        const config = { dbType: this.config.dbType, dbConnection: this.config.dbConnection };

        for (const entity of this.config.purchaseModels) {
            let result = await db.read(config, entity.table, { [entity.key]: productId });
            if (result.length > 0) return { type: entity.type, ...result[0] };
        }

        return null;
    }

    async createSubscription(userId, plan, purchase, receipt) {
        const config = { dbType: this.config.dbType, dbConnection: this.config.dbConnection };

        const existingSubscription = await db.read(config, this.config.subscriptionTable, {
            [this.config.subscriptionColumns.plan]: plan.app_id,
            [this.config.subscriptionColumns.user]: userId,
        });

        if (existingSubscription.length > 0) return existingSubscription[0];

        const newSubscription = {
            id: uuidv4(),
            [this.config.subscriptionColumns.user]: userId,
            [this.config.subscriptionColumns.plan]: plan.app_id,
            status: 'active',
            meta: JSON.stringify({
                original_transaction_id: purchase.original_transaction_id,
                applepay_receipt: receipt.latest_receipt,
            }),
            starts_at: purchase.original_purchase_date,
            ends_at: purchase.expires_date,
        };

        await db.create(config, this.config.subscriptionTable, newSubscription);
        return newSubscription;
    }

    async createOrder(userId, model, purchase, receiptData) {
        const config = { dbType: this.config.dbType, dbConnection: this.config.dbConnection };
        const orderId = this.config.orderPrefix + purchase.original_transaction_id;

        const existingOrder = await db.read(config, this.config.orderTable, { id: orderId });
        if (existingOrder.length > 0) return true;

        const newOrder = {
            id: orderId,
            [this.config.orderColumns.user]: userId,
            [this.config.orderColumns.amount]: model.price,
            status: 'paid',
            meta: JSON.stringify({ applepay_receipt: receiptData }),
            created_at: purchase.original_purchase_date,
            updated_at: purchase.receipt_creation_date,
        };

        await db.create(config, this.config.orderTable, newOrder);

        await db.create(config, this.config.orderItemsTable, {
            order_id: orderId,
            itemable_type: model.type,
            itemable_id: model.id,
            amount: model.price,
            quantity: 1,
            description: model.name,
        });

        return true;
    }
}

module.exports = ApplePayController;
