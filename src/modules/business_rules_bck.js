const fs = require('fs');
const path = require('path');

class BusinessRules {
    constructor(configFilePath = path.join(process.cwd(), 'config/businessRules.json')) {
        this.rules = {};
        this.configFilePath = path.resolve(configFilePath);
    }

    /**
     * Load the business rules from a JSON file.
     */
    loadRules() {
        try {
            const data = fs.readFileSync(this.configFilePath, 'utf-8');
            const parsedRules = JSON.parse(data);

            this.validateRules(parsedRules);
            this.rules = parsedRules.reduce((acc, rule) => {
                acc[rule.endpoint] = acc[rule.endpoint] || [];
                acc[rule.endpoint].push(...rule.rules);
                return acc;
            }, {});

            console.log('Business rules loaded successfully:', this.rules);
        } catch (error) {
            console.error('Error loading business rules:', error.message);
            throw new Error('Failed to load business rules');
        }
    }

    /**
     * Validate the structure of the business rules.
     * @param {Array} rules - Array of rules loaded from configuration
     */
    validateRules(rules) {
        if (!Array.isArray(rules)) {
            throw new Error('Invalid rules configuration: Expected an array');
        }

        rules.forEach((rule, index) => {
            if (!rule.endpoint || !Array.isArray(rule.rules)) {
                throw new Error(
                    `Invalid rule at index ${index}: Missing 'endpoint' or 'rules' array`
                );
            }

            rule.rules.forEach((r, ruleIndex) => {
                if (
                    !/^IF .+ THEN .+$/.test(r) && // Conditional rule
                    !/^.+?\s*=\s*.+?$/.test(r)   // Virtual column rule
                ) {
                    throw new Error(
                        `Invalid rule syntax at endpoint ${rule.endpoint}, rule index ${ruleIndex}`
                    );
                }
            });
        });
    }

    /**
     * Parse and execute a business rule.
     * @param {String} rule - The business rule in natural language syntax
     * @param {Object} context - The context (data object)
     * @returns {Object} - Updated context after applying the rule
     */
    executeRule(rule, context) {
        // Conditional rule (e.g., "IF price > 20 THEN discount = price - (price * 0.1)")
        const conditionalMatch = rule.match(/^IF (.+) THEN (.+)$/);
        if (conditionalMatch) {
            const [_, condition, action] = conditionalMatch;

            try {
                const conditionResult = new Function('context', `with(context) { return ${condition}; }`)(context);
                if (conditionResult) {
                    const actionMatch = action.match(/^([\w_]+)\s*=\s*(.+)$/);
                    if (actionMatch) {
                        const [, field, formula] = actionMatch;
                        const computedValue = new Function('context', `with(context) { return ${formula}; }`)(context);
                        context[field] = computedValue; // Add or update the field in the context
                    } else {
                        // Execute raw action (e.g., if it's not field = formula)
                        new Function('context', `with(context) { ${action}; }`)(context);
                    }
                }
            } catch (error) {
                console.error(`Error executing conditional rule: ${rule}`, error.message);
            }
            return context;
        }

        // Virtual column rule (e.g., "tax = price * 0.067")
        const virtualColumnMatch = rule.match(/^(.+?)\s*=\s*(.+)$/);
        if (virtualColumnMatch) {
            const [_, field, formula] = virtualColumnMatch;
            try {
                const computedValue = new Function('context', `with(context) { return ${formula}; }`)(context);
                context[field] = computedValue; // Add the computed value to the context
            } catch (error) {
                console.error(`Error computing virtual column: ${rule}`, error.message);
            }
        }

        return context;
    }

    /**
     * Middleware function to apply business rules dynamically.
     * @returns {Function} - Express middleware
     */
    middleware() {
        return (req, res, next) => {
            const endpointPath = req.route ? req.route.path : req.originalUrl.split('?')[0];
            const endpointRules = this.rules[endpointPath];

            if (!endpointRules || endpointRules.length === 0) {
                return next(); // No rules for this endpoint
            }

            // Override the res.json method to apply rules before sending the response
            const originalJson = res.json.bind(res);
            res.json = (data) => {
                let context = Array.isArray(data.data) ? data.data : [data.data]; // Support arrays
                context = context.map((item) => {
                    let updatedItem = { ...item };
                    endpointRules.forEach((rule) => {
                        updatedItem = this.executeRule(rule, updatedItem); // Apply rules to each item
                    });
                    return updatedItem;
                });

                // Return a single object if the original response wasn't an array
                if (!Array.isArray(data.data)) {
                    data.data = context[0];
                } else {
                    data.data = context;
                }

                originalJson(data); // Send modified data in response
            };

            next();
        };
    }
}

module.exports = BusinessRules;
