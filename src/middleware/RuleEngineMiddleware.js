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
            //let entityName = req.path.toLowerCase();

            
            const hasRules = this.ruleEngine.hasRulesForEntity(entityName);
            if (!hasRules) {
                console.log(`No rules defined for entity: ${entityName}. Skipping rule processing.`);
                return next();
            } else {
                const globalContext = this.dependencyManager.context; // Access globalContext from DependencyManager

                if (['POST', 'PUT', 'PATCH'].includes(eventType) && req.body) {
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
                } else if (eventType === 'GET') {
                    console.log(`Processing ${eventType} request on ${entityName}`);
                    let inboundProcessed = false;

                    // Process incoming GET query parameters (GETIN)
                    if (req.query && Object.keys(req.query).length > 0) {
                        console.log(`Processing inbound GET (GETIN) query parameters for ${entityName}:`, req.query);
                        try {
                            // Only include user_agent and user_ip for rule processing
                            const data = {
                                ...req.query,
                                user_agent: req.headers['user-agent'],
                                user_ip: req.ip || req.connection.remoteAddress,
                                method: req.method,
                                path: req.path
                            };

                            // Process with direction='in' for GETIN rules
                            await this.ruleEngine.processEvent(eventType, entityName, data, {
                                ...globalContext,
                                actions: {
                                    ...globalContext.actions,
                                    update: (ctx, entity, field, value) => {
                                        req.query[field] = value;
                                    },
                                },
                                direction: 'in'  // Specify 'in' direction for GETIN rules
                            });
                            inboundProcessed = true;
                        } catch (err) {
                            console.error(`Error processing inbound GET (GETIN) query parameters:`, err.message);
                            return res.status(500).json({ error: `GET query parameter processing failed` });
                        }
                    }

                    // Set up interception of outbound data (GETOUT)
                    const originalSend = res.send;
                    res.send = async (responseData) => {
                        if (res.statusCode >= 300) {
                            console.log(`Skipping rule processing because status is ${res.statusCode} for ${entityName}`);
                            return originalSend.call(res, responseData);
                        }
                        
                        console.log(`Processing outbound GET (GETOUT) on ${entityName} with data`);
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
                            
                            // Convert single object responses into an array for rule processing
                            const ruleData = Array.isArray(parsedData.data) ? parsedData.data : [parsedData.data];
                            
                            // Process with direction='out' for GETOUT rules
                          //  console.log("Before rule processing, data:", JSON.stringify(ruleData));
                            
                            // Define a custom update action that modifies both ruleData and parsedData
                            const customUpdateAction = (ctx, action) => {
                                if (action.field && action.expression) {
                                    try {
                                  
                                        
                                        // Get the computed value from the expression
                                        let computedValue;
                                        if (typeof action.expression === 'string') {
                                            // Handle string expressions with placeholders
                                            computedValue = action.expression.replace(/\${([^}]+)}/g, (match, inner) => {
                                                try {
                                                    const fn = new Function('data', `with(data) { return ${inner}; }`);
                                                    const value = fn(ctx.data);
                                                    return value !== undefined && value !== null ? value : match;
                                                } catch (e) {
                                                    console.warn(`Failed to resolve placeholder ${match}: ${e.message}`);
                                                    return match;
                                                }
                                            });
                                        } else {
                                            computedValue = action.expression;
                                        }
                                        
                                        
                                        
                                        // Update the data in the context (affects ruleData)
                                        ctx.data[action.field] = computedValue;
                                        
                                        // Also update parsedData directly
                                        if (Array.isArray(parsedData.data)) {
                                            // If it's an array, update each item
                                            parsedData.data.forEach(item => {
                                                item[action.field] = computedValue;
                                            });
                                        } else if (typeof parsedData.data === 'object') {
                                            // If it's a single object
                                            parsedData.data[action.field] = computedValue;
                                        } else {
                                            // If it's something else, create an object
                                            parsedData.data = { [action.field]: computedValue };
                                        }
                                        
                                      
                                    } catch (err) {
                                        console.error(`Error in custom update action for field "${action.field}":`, err.message);
                                    }
                                }
                            };
                            
                            await this.ruleEngine.processEvent(eventType, entityName, ruleData, {
                                ...globalContext,
                                actions: {
                                    ...globalContext.actions,
                                    update: customUpdateAction
                                },
                                direction: 'out'  // Specify 'out' direction for GETOUT rules
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
                            console.error(`Error processing outbound GET (GETOUT) rules for entity: ${entityName}:`, err.message);
                            // Fallback to original response if processing fails
                            originalSend.call(res, responseData);
                        }
                    };
                    
                    if (inboundProcessed) {
                        return next();
                    }
                } else if (eventType === 'DELETE') {
                    // Handle DELETE requests (unchanged from original)
                    // ...
                } else {
                    console.log(`No rule processing required for ${eventType} on ${entityName}`);
                }
            }
            next();
        };
    }
}

module.exports = RuleEngineMiddleware;
