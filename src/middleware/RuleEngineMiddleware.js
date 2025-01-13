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
            }

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
                                
                    if(response.status !== 200){
                        return res.status(response.status).json({ message: response.message, error: response.error, data: response.data, module: response.module });
                    }
                    return next();
                } catch (err) {
                    console.error(`Error processing inbound ${eventType} rules:`, err.message);
                    return res.status(500).json({ error: `${eventType} rules processing failed` });
                }
            } else if (['GET', 'DELETE'].includes(eventType)) {
                console.log(`Processing outbound ${eventType} on ${entityName}`);
                const originalSend = res.send;

                res.send = async (data) => {
                    try {
                        const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
                        console.log(`Processing outbound ${eventType} on ${entityName} with data:`, parsedData.data);

                       await this.ruleEngine.processEvent(eventType, entityName, parsedData.data, {
                            ...globalContext, // Merge globalContext into the rule processing context
                            actions: {
                                ...globalContext.actions, // Use global actions
                                update: (ctx, entity, field, value) => {
                                    parsedData[field] = value; // Modify response payload
                                },
                            },
                        });

                        originalSend.call(res, JSON.stringify(parsedData));
                    } catch (err) {
                        console.error(`Error processing outbound ${eventType} rules:`, err.message);
                        originalSend.call(res, data); // Fallback to original data if processing fails
                    }
                };
            } else {
                console.log(`No rule processing required for ${eventType} on ${entityName}`);
            }

            next();
        };
    }
}

module.exports = RuleEngineMiddleware;
