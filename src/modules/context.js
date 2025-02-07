const { AsyncLocalStorage } = require('async_hooks');
const asyncLocalStorage = new AsyncLocalStorage();
const { config } = require('dotenv');
const path = require('path');

config({ path: path.resolve(__dirname, '../.env') });

const globalContext = {
    resources: {}, // Resources will be added dynamically
    actions: {},   // Actions will be added dynamically
};

const corsOptions = {
    origin: config.CORS_ORIGIN || '*', // Adjust based on your requirements
    // methods: ['GET', 'POST', 'PUT', 'DELETE'],
    // allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true, // If applicable
  };

module.exports = {
    /**
     * Sets a key-value pair in the AsyncLocalStorage context.
     * @param {string} key - The key to set in the context.
     * @param {any} value - The value to associate with the key.
     */
    setContext: (key, value) => {
        const store = asyncLocalStorage.getStore() || {};
        store[key] = value;
        asyncLocalStorage.enterWith(store);
    },

    /**
     * Retrieves a value from the AsyncLocalStorage context by key.
     * @param {string} key - The key to retrieve from the context.
     * @returns {any} - The value associated with the key.
     */
    getContext: (key) => {
        const store = asyncLocalStorage.getStore();
        return store ? store[key] : undefined;
    },

    /**
     * Middleware to initialize the AsyncLocalStorage context for each request.
     * It also sets the current request (`req`) in the context.
     */
    middleware: (req, res, next) => {
        asyncLocalStorage.run({}, () => {
            module.exports.setContext('req', req);
            next();
        });
    },

    globalContext :{
        resources: {}, // Resources will be added dynamically
        actions: {},
    },
    corsOptions,

};
