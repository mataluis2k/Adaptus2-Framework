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
            // Normalize the entity name by removing any numeric IDs or UUIDs
            let pathSegments = req.path.split('/').filter(Boolean);
            let entityName = pathSegments.includes('api') ? pathSegments[pathSegments.indexOf('api') + 1] : pathSegments[0]; // Ensure we get the correct entity
            
            const hasRules = this.ruleEngine.hasRulesForEntity(entityName);
            if (!hasRules) {
                console.log(`No rules defined for entity: ${entityName}. Skipping rule processing.`);
                return next();
            }else {

            const globalContext = this.dependencyManager.context; // Access globalContext from DependencyManager

            if (['POST', 'PUT', 'PATCH'].includes(eventType) && req.body) {
               // response.Reset();
                console.log(`Processing inbound ${eventType} on ${entityName} with data:`, req.body);

                try {
                    // Only include user_agent and user_ip for rule processing
                    const data = {
                        ...req.body,
                        user_agent: req.headers['user-agent'],
                        user_ip: req.ip || req.connection.remoteAddress,
                        method: req.method,
                        path: req.path
                    };

                    await this.ruleEngine.processEvent(eventType, entityName, data, {
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
                console.log(`Processing ${eventType} request on ${entityName}`);
                let processed = false;
                // Process incoming query parameters
                if (req.query && Object.keys(req.query).length > 0) {
                    console.log(`Processing inbound ${eventType} query parameters:`, req.query);
                    try {
                        // Only include user_agent and user_ip for rule processing
                        const data = {
                            ...req.query,
                            user_agent: req.headers['user-agent'],
                            user_ip: req.ip || req.connection.remoteAddress,
                            method: req.method,
                            path: req.path
                        };

                        await this.ruleEngine.processEvent(eventType, entityName, data, {
                            ...globalContext,
                            actions: {
                                ...globalContext.actions,
                                update: (ctx, entity, field, value) => {
                                    req.query[field] = value;
                                },
                            },
                        });
                        processed = true;
                    } catch (err) {
                        console.error(`Error processing inbound ${eventType} query parameters:`, err.message);
                        return res.status(500).json({ error: `${eventType} query parameter processing failed` });
                    }
                }
                if(processed){
                    return next();
                }
                const originalSend = res.send;
                res.req = async (responseData) => {
                    console.log(`Processing inbound ${eventType} on ${entityName} with data:`, responseData);
                    try {
                        // Parse response data if it's a string; handle invalid JSON gracefully
                        let parsedData;
                        try {
                            parsedData = typeof responseData === 'string' ? JSON.parse(responseData) : responseData;
                        } catch (parseError) {
                            console.warn(`Failed to parse response data for ${entityName}. Skipping rule processing.`);
                            return originalSend.call(res, responseData);
                        }
                
                        // Ensure parsedData exists and has a `data` field
                        if (!parsedData || !parsedData.data) {
                            console.log(`No valid data available for entity: ${entityName}. Skipping rule processing.`);
                            return originalSend.call(res, responseData);
                        }
                        
                        // Check if rules exist for the entity
                        const hasRules = this.ruleEngine.hasRulesForEntity(entityName);
                        if (!hasRules) {
                            console.log(`No rules defined for entity: ${entityName}. Skipping rule processing.`);
                            return originalSend.call(res, responseData);
                        }
                
                        // Process rules
                        // Only process the data field without spreading additional context
                        const ruleData = Array.isArray(parsedData.data) ? parsedData.data : [parsedData.data];
                        await this.ruleEngine.processEvent(eventType, entityName, ruleData, {
                            ...globalContext, // Merge globalContext into the rule processing context
                            actions: {
                                ...globalContext.actions, // Use global actions
                                update: (ctx, entity, field, value) => {
                                    if (typeof parsedData.data === 'object') {
                                        parsedData.data[field] = value;
                                    } else {
                                        parsedData.data = { [field]: value };
                                    }
                                },
                            },
                        });
                
                        // Recursively clean user data from the entire response
                        const cleanUserData = (obj) => {
                            if (!obj || typeof obj !== 'object') return;
                            
                            if (Array.isArray(obj)) {
                                obj.forEach(item => cleanUserData(item));
                            } else {
                                delete obj.user;
                                Object.values(obj).forEach(value => cleanUserData(value));
                            }
                        };

                        if (parsedData.data) {
                            cleanUserData(parsedData.data);
                        }
                        originalSend.call(res, JSON.stringify(parsedData));
                    } catch (err) {
                        console.error(`Error processing outbound ${eventType} rules for entity: ${entityName}:`, err.message);
                        // Fallback to original response if processing fails
                        originalSend.call(res, responseData);
                    }
                }

                // this handles the return payload on response
                res.send = async (responseData) => {
                    console.log(`Processing outbound ${eventType} on ${entityName} with data:`, responseData);
                    try {
                        // Parse response data if it's a string; handle invalid JSON gracefully
                        let parsedData;
                        try {
                            parsedData = typeof responseData === 'string' ? JSON.parse(responseData) : responseData;
                        } catch (parseError) {
                            console.warn(`Failed to parse response data for ${entityName}. Skipping rule processing.`);
                            return originalSend.call(res, responseData);
                        }
                
                        if (!parsedData) {
                            console.log(`No valid data available for entity: ${entityName}. Skipping rule processing.`);
                            return originalSend.call(res, responseData);
                        }
                        
                        // Ensure parsedData.data exists by wrapping single objects in a `data` field
                        if (!parsedData.data) {
                            parsedData = { data: parsedData }; // Wrap the entire response
                        }
                        
                        // Check if rules exist for the entity
                        const hasRules = this.ruleEngine.hasRulesForEntity(entityName);
                        if (!hasRules) {
                            console.log(`No rules defined for entity: ${entityName}. Skipping rule processing.`);
                            return originalSend.call(res, JSON.stringify(parsedData));
                        }
                        
                        // Convert single object responses into an array for rule processing
                        const ruleData = Array.isArray(parsedData.data) ? parsedData.data : [parsedData.data];
                        
                        await this.ruleEngine.processEvent(eventType, entityName, ruleData, {
                            ...globalContext,
                            actions: {
                                ...globalContext.actions,
                                update: (ctx, entity, field, value) => {
                                    if (typeof parsedData.data === 'object') {
                                        parsedData.data[field] = value;
                                    } else {
                                        parsedData.data = { [field]: value };
                                    }
                                },
                            },
                        });
                        
                        // Recursively clean user data from the response
                        const cleanUserData = (obj) => {
                            if (!obj || typeof obj !== 'object') return;
                            if (Array.isArray(obj)) {
                                obj.forEach(item => cleanUserData(item));
                            } else {
                                delete obj.user;
                                Object.values(obj).forEach(value => cleanUserData(value));
                            }
                        };
                        if (parsedData.data) {
                            cleanUserData(parsedData.data);
                        }
                        
                        originalSend.call(res, JSON.stringify(parsedData));
                        
                    } catch (err) {
                        console.error(`Error processing outbound ${eventType} rules for entity: ${entityName}:`, err.message);
                        // Fallback to original response if processing fails
                        originalSend.call(res, responseData);
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
