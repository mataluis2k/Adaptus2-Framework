const fs = require('fs');
const path = require('path');
const { getDbConnection } = require('./db');
//const { sendToQueue } = require('./queue'); // Assumed queue module for async jobs

class BusinessRules {
    constructor(configFilePath = path.join(process.cwd(), 'config/businessRules.json')) {
        this.rules = {};
        this.configFilePath = configFilePath;
    }
    
    /**
     * Load the business rules from a JSON file.
     */
    loadRules() {
        try {
            console.log(this.configFilePath);
            const data = fs.readFileSync(this.configFilePath, 'utf-8');
            const parsedRules = JSON.parse(data);

            this.validateRules(parsedRules);
            this.rules = parsedRules.reduce((acc, rule) => {
                acc[rule.endpoint] = acc[rule.endpoint] || [];
                acc[rule.endpoint].push({
                    events: rule.events || ["GET"],
                    dbType: rule.dbType || null,
                    dbConnection: rule.dbConnection || null,
                    rules: rule.rules
                });
                return acc;
            }, {});
            
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
                    !/^.+?\s*=\s*.+?$/.test(r) && // Virtual column rule
                    !/^INSERT INTO .+ VALUES \(.+\)$/.test(r) && // Insert rule
                    !/^UPDATE .+ SET .+ WHERE .+$/.test(r) && // Update rule
                    !/^TRIGGER .+$/i.test(r) // Trigger rule (e.g., async jobs)
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
     * @param {Object} req - The request object for dynamic parameter extraction
     * @param {Object} ruleSet - The rule set object containing dbType and dbConnection
     * @returns {Promise<Object>} - Updated context after applying the rule
     */
    async executeRule(rule, context, req, ruleSet) {
        // Database query rule (e.g., "distance = QUERY:mysql:db_connection:distances:WHERE zipcode = req.customer.zipcode")
        const queryMatch = rule.match(/^(.+?)\s*=\s*QUERY:(\w+):(\w+):(\w+):WHERE\s+(.+?)\s*:SELECT\s+(.+)$/);
        if (queryMatch) {
            const [_, field, dbType, dbConnection, table, condition, selectColumn] = queryMatch;
            try {
                const connection = await getDbConnection({ dbType, dbConnection });
                if (!connection) {
                    throw new Error(`Database connection failed for ${dbConnection}`);
                }
                const conditionResolved = new Function('req', `with(req) { return \`${condition}\`; }`)(req);
                const query = `SELECT ${selectColumn} FROM ${table} WHERE ${conditionResolved} LIMIT 1`;
                const [rows] = await connection.execute(query);
                context[field] = rows.length > 0 ? rows[0][selectColumn] : null;
            } catch (error) {
                console.error(`Error executing database query rule: ${rule}`, error.message);
            }
            return context;
        }

        // Conditional rule (e.g., "IF price > 20 THEN discount = price - (price * 0.1)")
        const conditionalMatch = rule.match(/^IF (.+) THEN (.+)$/);
        if (conditionalMatch) {
            const [_, condition, action] = conditionalMatch;
    
            try {
                console.log('Condition:', condition);
                console.log('Context before evaluation:', context);

                 // Normalize condition to use strict equality
                const normalizedCondition = condition.replace(/\s=\s/g, ' === ');
                console.log('Normalized Condition:', normalizedCondition);

                // Evaluate the condition for this specific row
                const conditionResult = new Function('context', `
                    with(context) {
                        return (${normalizedCondition});
                    }
                `)(context);
            
                console.log('Condition Result:', conditionResult);

                // Apply the action only if the condition is true
                if (conditionResult === true) {
                    const actionMatch = action.match(/^([\w_]+)\s*=\s*(.+)$/);
                    console.log('Action Match:', actionMatch);

                    if (actionMatch) {
                        const [, field, value] = actionMatch;

                        // Ensure field exists in the context
                        if (field in context) {
                            console.log(`Applying action: Setting ${field} to ${value}`);
                            // Compute the value to assign
                            const computedValue = new Function('context', `with(context) { return ${value}; }`)(context);

                            context[field] = computedValue; // Apply the computed value to the row
                            console.log('Context after action:', context);
                        } else {
                            console.warn(`Field "${field}" does not exist in context. Skipping action.`);
                        }
                    } else if (action.startsWith('INSERT INTO') || action.startsWith('UPDATE')) {
                        // Handle SQL actions (INSERT or UPDATE)
                        const dbType = ruleSet.dbType;
                        const dbConnection = ruleSet.dbConnection;
    
                        if (!dbType || !dbConnection) {
                            console.error('Database type and connection must be specified for Insert or Update actions');
                        } else {
                            try {
                                const connection = await getDbConnection({ dbType, dbConnection });
                                await connection.execute(action); // Execute SQL action
                            } catch (error) {
                                console.error(`Error executing database action: ${action}`, error.message);
                            }
                        }
                    } else if (action.match(/^TRIGGER .+$/i)) {
                        // Handle async job trigger
                        try {
                            const jobData = new Function('context', 'req', `with(context) { return ${action.replace(/^TRIGGER /i, '')}; }`)(context, req);
                            await sendToQueue(jobData); // Send async job to the queue
                        } catch (error) {
                            console.error(`Error triggering async job: ${action}`, error.message);
                        }
                    } else {
                        // Handle any other type of action (direct execution)
                        try {
                            new Function('context', 'req', `with(context) { ${action}; }`)(context, req);
                        } catch (error) {
                            console.error(`Error executing action: ${action}`, error.message);
                        }
                    }
                }
            } catch (error) {
                console.error(`Error evaluating condition for rule: ${rule}`, error.message);
            }
            return context;
        }

        // Virtual column rule (e.g., "tax = price * 0.067")
        const virtualColumnMatch = rule.match(/^(.+?)\s*=\s*(.+)$/);
        if (virtualColumnMatch) {
            const [_, field, formula] = virtualColumnMatch;
            try {
                const computedValue = new Function('context', 'req', `with(context) { return ${formula}; }`)(context, req);
                context[field] = computedValue;
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

            // Special handling for GraphQL
            if (endpointPath === '/graphql') {
                const { query } = req.body;
                const operationMatch = query.match(/(query|mutation)\s+(\w+)/); // Extract operation type and name
                if (!operationMatch) {
                    return next(); // No valid GraphQL operation found
                }

                const [, operationType, operationName] = operationMatch;
                const operationRules = endpointRules.operations[operationName];

                if (!operationRules || !operationRules.events.includes(operationType)) {
                    return next(); // No rules for this operation type/name
                }

                // Apply rules for this operation
                const rulesToApply = operationRules.rules;
                const originalJson = res.json.bind(res);
                res.json = async (data) => {
                    let context = Array.isArray(data.data) ? data.data : [data.data];
                    context = await Promise.all(context.map(async (item) => {
                        let updatedItem = { ...item };
                        for (const rule of rulesToApply) {
                            try {
                                updatedItem = await this.executeRule(rule, updatedItem, req, operationRules);
                            } catch (error) {
                                console.error(`Error applying rule: ${rule}`, error.message);
                            }
                        }
                        return updatedItem;
                    }));

                    // Return a single object if the original response wasn't an array
                    if (!Array.isArray(data.data)) {
                        data.data = context[0];
                    } else {
                        data.data = context;
                    }

                    originalJson(data); // Send modified data in response
                };
                return next();
            }
            const relevantRules = endpointRules.filter(ruleSet => ruleSet.events.includes(req.method));
            if (relevantRules.length === 0) {
                return next(); // No rules for this HTTP method
            }

            // Override the res.json method to apply rules before sending the response
            const originalJson = res.json.bind(res);
            res.json = async (data) => {
                let context = Array.isArray(data.data) ? data.data : [data.data]; // Support arrays
                context = await Promise.all(context.map(async (item) => {
                    let updatedItem = { ...item };
                    for (const ruleSet of relevantRules) {
                        for (const rule of ruleSet.rules) {
                            try {
                                updatedItem = await this.executeRule(rule, updatedItem, req, ruleSet); // Apply rules to each item
                            } catch (error) {
                                console.error(`Error applying rule: ${rule}`, error.message);
                            }
                        }
                    }
                    return updatedItem;
                }));
            
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
