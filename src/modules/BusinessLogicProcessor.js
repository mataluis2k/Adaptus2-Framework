// BusinessLogicProcessor.js
const FirebaseService = require('../services/firebaseService'); // Example service
const EmailService = require('../services/emailService'); // Example service
const DatabaseService = require('../services/databaseService'); // Example service

class BusinessLogicProcessor {
    constructor() {
        // Registry of available actions
        this.actions = {};
    }

    /**
     * Register a new action with the processor.
     * @param {string} name - The name of the action.
     * @param {function} handler - The function to execute the action.
     */
    registerAction(name, handler) {
        if (this.actions[name]) {
            console.warn(`Action ${name} is already registered. Overwriting.`);
        }
        this.actions[name] = handler;
    }

    /**
     * Process a business logic configuration.
     * @param {Array} businessLogic - List of actions to execute.
     * @param {Object} data - Data passed to each action.
     * @returns {Promise<Object>} - The result of executing all actions.
     */
    async process(businessLogic, data) {
        if (!Array.isArray(businessLogic)) {
            throw new Error('Business logic must be an array of actions.');
        }

        const results = {};

        for (const action of businessLogic) {
            const { action: actionName, details, ...params } = action;
            const handler = this.actions[actionName];

            if (!handler) {
                throw new Error(`Action ${actionName} is not registered.`);
            }

            try {
                console.log(`Executing action: ${actionName} - ${details}`);
                results[actionName] = await handler(params, data);
            } catch (error) {
                console.error(`Error executing action ${actionName}: ${error.message}`);
                results[actionName] = { error: error.message };
            }
        }

        return results;
    }
}

// Create an instance of the processor
const processor = new BusinessLogicProcessor();

// Register default actions
processor.registerAction('createUser', async (params, data) => {
    console.log(`Creating user with data: ${JSON.stringify(data)}`);
    return DatabaseService.createUser(data);
});

processor.registerAction('queueWelcomeEmail', async (params, data) => {
    console.log(`Queuing welcome email for: ${data.email}`);
    return EmailService.queueWelcomeEmail(data.email);
});

processor.registerAction('createFirebaseToken', async (params, data) => {
    console.log(`Creating Firebase token for user ID: ${data.uuid}`);
    return FirebaseService.createCustomToken(data.uuid);
});

processor.registerAction('uniqueEmail', async (params, data) => {
    const isUnique = await DatabaseService.checkUniqueEmail(data.email);
    if (!isUnique) throw new Error('Email already exists.');
});

// Export the processor
module.exports = processor;

// Example usage of businesLogicProcessor
// {  
//     "SendSubscriptionProducts" = [ {
//                                 "action": "ChargeUser",
//                                 "details": "Charge subscription products to user",
//                             }, { "action": "SendReciept",
//                                 "details": "Send receipt to user",
//                             }, { "action": "MailSubscriptionProducts",
//                                 "details": "Update user subscription status",
//                             } ] ,
//     "SendOneTimeProducts" = [ {
//                                 "action": "ChargeUser",
//                                 "details": "Charge one-time products to user",
//                             }, { "action": "SendReciept",
//                                 "details": "Send receipt to user",
//                             } ] ,
// }