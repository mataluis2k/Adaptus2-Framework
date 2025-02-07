const { v4: uuid } = require('uuid');
const cartManager = require('./cart-manager');
const db = require('./db');

class OrderManager {
    constructor(globalContext, dbConfig) {
        this.globalContext = globalContext;
        this.dbConfig = dbConfig;
        this.registerActions();
    }

    registerActions() {
        this.globalContext.actions.ORD_createOrder = this.createOrder.bind(this);
        this.globalContext.actions.ORD_getOrder = this.getOrder.bind(this);
        this.globalContext.actions.ORD_getOrdersByUserId = this.getOrdersByUserId.bind(this);
        this.globalContext.actions.ORD_updateOrderStatus = this.updateOrderStatus.bind(this);
        this.globalContext.actions.ORD_processPayment = this.processPayment.bind(this);
    }

    async createOrder(ctx, { userId, cartId, shippingAddress, billingAddress, paymentInfo }) {
        const connection = await this.dbConfig.getDbConnection(ctx.config.db);
        const transaction = await connection.transaction();

        try {
            const cart = await cartManager.getCart(cartId);
            if (!cart) {
                throw new Error('Cart not found');
            }

            const totalAmount = cart.items.reduce((sum, item) => sum + (item.productDetails.price * item.quantity), 0);
            const orderId = uuid();

            const orderData = {
                orderId,
                userId: userId || null,
                orderDate: new Date(),
                status: 'pending',
                totalAmount,
                shippingAddress,
                billingAddress,
                items: cart.items,
            };

            await db.models.Order.create(orderData, { transaction });

            // Process payment
            const paymentResult = await this.processPayment(ctx, { orderId, paymentInfo });
            if (paymentResult.success) {
                await db.models.Order.update(
                    { status: 'processing' },
                    { where: { orderId }, transaction }
                );
            } else {
                throw new Error('Payment failed');
            }

            await cartManager.clearCart(cartId);
            await transaction.commit();

            return { success: true, orderId };
        } catch (error) {
            await transaction.rollback();
            console.error('Error creating order:', error.message);
            throw error;
        } finally {
            connection.release();
        }
    }

    async getOrder(ctx, { orderId }) {
        const connection = await this.dbConfig.getDbConnection(ctx.config.db);
        try {
            const order = await db.models.Order.findOne({ where: { orderId } });
            return order || null;
        } finally {
            connection.release();
        }
    }

    async getOrdersByUserId(ctx, { userId }) {
        const connection = await this.dbConfig.getDbConnection(ctx.config.db);
        try {
            const orders = await db.models.Order.findAll({ where: { userId } });
            return orders || [];
        } finally {
            connection.release();
        }
    }

    async updateOrderStatus(ctx, { orderId, newStatus }) {
        const validStatuses = ['pending', 'processing', 'shipped', 'completed', 'cancelled'];
        if (!validStatuses.includes(newStatus)) {
            throw new Error(`Invalid status: ${newStatus}`);
        }

        const connection = await this.dbConfig.getDbConnection(ctx.config.db);
        try {
            const [updated] = await db.models.Order.update({ status: newStatus }, { where: { orderId } });
            if (updated === 0) {
                throw new Error('Order not found');
            }
            return { success: true, orderId, newStatus };
        } finally {
            connection.release();
        }
    }

    async processPayment(ctx, { orderId, paymentInfo }) {
        try {
            const apiClient = new ctx.dependencies.UniversalApiClient({
                baseUrl: ctx.config.paymentGatewayBaseUrl,
                authType: 'token',
                authValue: ctx.config.paymentGatewayToken,
            });

            const response = await apiClient.post('/process-payment', {
                orderId,
                paymentInfo,
            });

            return { success: response.success, transactionId: response.transactionId };
        } catch (error) {
            console.error('Payment processing failed:', error.message);
            return { success: false, error: error.message };
        }
    }
}

module.exports = OrderManager;
