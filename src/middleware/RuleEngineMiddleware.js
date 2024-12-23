const fs = require('fs');
const path = require('path');
const { RuleEngine } = require(path.join(__dirname, '../modules/ruleEngine'));

class RuleEngineMiddleware {
    constructor(rules) {
        try {                        
            if (!rules) {
                console.warn('No business rules defined. RuleEngineMiddleware is disabled.');
                this.ruleEngine = null;
            } else {
                this.ruleEngine = rules;
            }
        } catch (error) {
            console.error('Error initializing RuleEngineMiddleware:', error.message);
            this.ruleEngine = null; // Disable middleware if initialization fails
        }
    }

    middleware() {
        return (req, res, next) => {
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
    

            if (['POST', 'PUT', 'PATCH'].includes(eventType) && req.body) {
                // Process inbound data for POST, PUT, PATCH requests
                console.log(`Processing inbound ${eventType} on ${entityName} with data:`, req.body);

                try {
                    this.ruleEngine.processEvent(eventType, entityName, req.body, {
                        actions: {
                            update: (context, entity, field, value) => {
                                req.body[field] = value; // Modify request payload
                            },
                            log: (context, message) => console.log(message),
                            notify: (context, target) => console.log(`Notify target: ${target}`),
                        },
                    });
                } catch (err) {
                    console.error(`Error processing inbound ${eventType} rules:`, err.message);
                    return res.status(500).json({ error: `${eventType} rules processing failed` });
                }
            } else if (['GET', 'DELETE'].includes(eventType)) {
                console.log(`Processing outbound ${eventType} on ${entityName}`);
                // Process outbound data for GET and DELETE requests
                const originalSend = res.send;
                res.send = (data) => {
                   

                    try {
                        const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
                        console.log(`Processing outbound ${eventType} on ${entityName} with data:`, parsedData.data);
                        this.ruleEngine.processEvent(eventType, entityName, parsedData.data, {
                            actions: {
                                update: (context, entity, field, value) => {
                                    parsedData[field] = value; // Modify response payload
                                },
                                log: (context, message) => console.log(message),
                                notify: (context, target) => console.log(`Notify target: ${target}`),
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
