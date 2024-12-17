const Redis = require('ioredis');

// Initialize Redis clients
const publisher = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const subscriber = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

function publishEvent(eventName, eventData) {
    const message = JSON.stringify({ event: eventName, data: eventData });
    console.log(`Publishing event: ${eventName}`, eventData);
    publisher.publish(eventName, message);
}

function subscribeEvent(eventName, callback) {
    subscriber.subscribe(eventName, () => {
        console.log(`Subscribed to event: ${eventName}`);
    });

    subscriber.on('message', (channel, message) => {
        if (channel === eventName) {
            const { event, data } = JSON.parse(message);
            console.log(`Received event: ${event}`, data);
            callback(data);
        }
    });
}

// Trigger Rule 1: Create Order from Subscription
subscribeEvent('subscription_renewed', (data) => {
    if (data.renew_at === new Date().toISOString().split('T')[0]) {
        globalContext.actions.createOrder(globalContext, data);
    }
});

// Trigger Rule 2: Create Payment from Order
subscribeEvent('order_created', (data) => {
    if (data.status === 'clearing') {
        globalContext.actions.createPayment(globalContext, data);
    }
});

module.exports = { publishEvent, subscribeEvent };
