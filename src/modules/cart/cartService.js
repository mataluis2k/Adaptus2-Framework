const { publishEvent } = require('./eventBroker');

class CartService {
    constructor() {
        this.carts = {}; // In-memory cart storage (replace with database in production)
    }

    addItemToCart(userId, item) {
        if (!this.carts[userId]) {
            this.carts[userId] = [];
        }

        this.carts[userId].push(item);
        publishEvent('item_added_to_cart', { userId, item });
        return this.carts[userId];
    }

    removeItemFromCart(userId, itemId) {
        if (!this.carts[userId]) return null;

        this.carts[userId] = this.carts[userId].filter(item => item.id !== itemId);
        publishEvent('item_removed_from_cart', { userId, itemId });
        return this.carts[userId];
    }

    getCart(userId) {
        return this.carts[userId] || [];
    }
}

module.exports = CartService;
