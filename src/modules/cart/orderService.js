const { publishEvent } = require('./eventBroker');

class OrderService {
    constructor() {
        this.orders = {}; // In-memory order storage (replace with database in production)
        this.extendContext();
    }

    extendContext() {
        if (!globalContext.actions) globalContext.actions = {};
        globalContext.actions.createOrder = (ctx, subscription) => {
            const cartItems = subscription.cartItems || [
                { id: "item1", name: "Sample Item", price: 100 },
            ];
            const order = this.createOrder(subscription.userId, cartItems);
            console.log("Order created successfully:", order);
        };
    }

    createOrder(userId, cartItems) {
        const orderId = `order_${Date.now()}`;
        const order = {
            orderId,
            userId,
            items: cartItems,
            status: "Created",
            totalAmount: cartItems.reduce((sum, item) => sum + item.price, 0),
        };

        this.orders[orderId] = order;
        publishEvent("order_created", order);
        return order;
    }

    updateOrderStatus(orderId, status) {
        if (!this.orders[orderId]) throw new Error('Order not found');

        this.orders[orderId].status = status;
        publishEvent('order_status_updated', { orderId, status });
        return this.orders[orderId];
    }
}

module.exports = OrderService;
