const fs = require('fs');
const path = require('path');
const { RuleEngine } = require(path.join(__dirname, '../modules/ruleEngine'));
const response = require(path.join(__dirname, '../modules/response'));
const { setContext } = require('../modules/context'); 

class RuleEngineMiddleware {
    constructor(rules, dependencyManager) {
        try {
            if (!rules) {
                console.warn('No business rules defined. RuleEngineMiddleware is disabled.');
                this.ruleEngine = null;
            } else {
                this.ruleEngine = rules;
                this.dependencyManager = dependencyManager;
            }
        } catch (error) {
            console.error('Error initializing RuleEngineMiddleware:', error.message);
            this.ruleEngine = null; // Disable middleware if initialization fails
        }
    }

    middleware() {
        return async (req, res, next) => {
            setContext('req', req);
            if (!this.ruleEngine) {
                console.warn('RuleEngineMiddleware is disabled. Skipping rules processing.');
                return next();
            }

            const eventType = req.method.toUpperCase(); // HTTP method: "GET", "POST", etc.
            const entityName = req.path.split('/').filter(Boolean).pop();

            const hasRules = this.ruleEngine.hasRulesForEntity(entityName);
            if (!hasRules) {
                console.log(`No rules defined for entity: ${entityName}. Skipping rule processing.`);
                return next();
            }else {

            const globalContext = this.dependencyManager.context; // Access globalContext from DependencyManager

            if (['POST', 'PUT', 'PATCH'].includes(eventType) && req.body) {
                response.Reset();
                console.log(`Processing inbound ${eventType} on ${entityName} with data:`, req.body);

                try {
                   await this.ruleEngine.processEvent(eventType, entityName,req.body, {
                        ...globalContext, // Merge globalContext into the rule processing context
                        actions: {
                            ...globalContext.actions, // Use global actions
                            update: (ctx, entity, field, value) => {
                                req.body[field] = value; // Modify request payload
                            },
                        },
                    });
                                
                    if(response.status === 600){
                        response.status = 200;
                        return res.status(response.status).json({ message: response.message, error: response.error, data: response.data, module: response.module });
                    }
                     
                    return next();

                } catch (err) {
                    console.error(`Error processing inbound ${eventType} rules:`, err.message);
                    return res.status(500).json({ error: `${eventType} rules processing failed` });
                }
            } else if (['GET', 'DELETE'].includes(eventType)) {
                console.log(`Processing outbound ${eventType} on ${entityName} data with data:${res.data}`);
                
                const originalSend = res.send;

                res.send = async (data) => {
                    try {
                        // Parse response data if it's a string; handle invalid JSON gracefully
                        let parsedData;
                        try {
                            parsedData = typeof data === 'string' ? JSON.parse(data) : data;
                        } catch (parseError) {
                            console.warn(`Failed to parse response data for ${entityName}. Skipping rule processing.`);
                            return originalSend.call(res, data);
                        }
                
                        // Ensure parsedData exists and has a `data` field
                        if (!parsedData || !parsedData.data) {
                            console.log(`No valid data available for entity: ${entityName}. Skipping rule processing.`);
                            return originalSend.call(res, data);
                        }
                
                        // Check if rules exist for the entity
                        const hasRules = this.ruleEngine.hasRulesForEntity(entityName);
                        if (!hasRules) {
                            console.log(`No rules defined for entity: ${entityName}. Skipping rule processing.`);
                            return originalSend.call(res, data);
                        }
                
                        // Process rules
                        await this.ruleEngine.processEvent(eventType, entityName, parsedData.data, {
                            ...globalContext, // Merge globalContext into the rule processing context
                            actions: {
                                ...globalContext.actions, // Use global actions
                                update: (ctx, entity, field, value) => {
                                    parsedData[field] = value; // Modify response payload
                                },
                            },
                        });
                
                        // Send the modified response
                        originalSend.call(res, JSON.stringify(parsedData));
                    } catch (err) {
                        console.error(`Error processing outbound ${eventType} rules for entity: ${entityName}:`, err.message);
                        // Fallback to original response if processing fails
                        originalSend.call(res, data);
                    }
                };
            } else {
                console.log(`No rule processing required for ${eventType} on ${entityName}`);
            }
            }
            next();
        };
    }
}

module.exports = RuleEngineMiddleware;
