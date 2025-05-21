const PaymentTransport = require('../transports/PaymentTransport');
const globalContext = require('./context'); // Import the shared globalContext

class PaymentModule {
    constructor(config, dbConfig) {
        this.config = config;
        this.dbConfig = dbConfig;
        this.transports = {};

        // Initialize transports dynamically
        this.initializeTransports();

        // Extend the global context
        this.extendContext();
    }

    initializeTransports() {
        const availableTransports = this.config.transports || [];

        availableTransports.forEach((transportConfig) => {
            const { name, module: modulePath, options } = transportConfig;

            if (!name) {
                console.error("Transport configuration must include a 'name'.");
                return;
            }

            try {
                const TransportClass = require(`./transports/${name}`); // Dynamically load transport
                const instance = new TransportClass(options);

                if (!(instance instanceof PaymentTransport)) {
                    throw new Error(`${name} transport does not implement the PaymentTransport interface.`);
                }

                this.transports[name] = instance;
                console.log(`Loaded payment transport: ${name}`);
            } catch (error) {
                console.error(`Failed to initialize transport: ${name}`, error.message);
            }
        });
    }

    async createCustomer({ provider, email }) {
        if (!this.transports[provider]) {
            throw new Error(`Transport for provider "${provider}" is not available.`);
        }
        return await this.transports[provider].createCustomer({ email });
    }

    async createPayment({ provider, customerId, amount, currency }) {
        if (!this.transports[provider]) {
            throw new Error(`Transport for provider "${provider}" is not available.`);
        }
        return await this.transports[provider].createPayment({ customerId, amount, currency });
    }

    async createSubscription({ provider, customerId, priceId }) {
        if (!this.transports[provider]) {
            throw new Error(`Transport for provider "${provider}" is not available.`);
        }
        return await this.transports[provider].createSubscription({ customerId, priceId });
    }

    extendContext() {
        if (!globalContext.actions) globalContext.actions = {};

        globalContext.actions.createCustomer = async (ctx, params) => {
            return await this.createCustomer(params);
        };

        globalContext.actions.createPayment = async (ctx, params) => {
            return await this.createPayment(params);
        };

        globalContext.actions.createSubscription = async (ctx, params) => {
            return await this.createSubscription(params);
        };
        globalContext.actions.refundFull = async (ctx, params) => {
            return await this.transports[params.provider].refundFull(params);
        };

        globalContext.actions.refundPartial = async (ctx, params) => {
            return await this.transports[params.provider].refundPartial(params);
        };

        globalContext.actions.cancelSubscription = async (ctx, params) => {
            return await this.transports[params.provider].cancelSubscription(params);
        };

        globalContext.actions.pauseSubscription = async (ctx, params) => {
            return await this.transports[params.provider].pauseSubscription(params);
        };
    }
}

module.exports = PaymentModule;
