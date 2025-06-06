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
            let pathSegments = req.path.split('/').filter(Boolean);
            let entityName = pathSegments.includes('api') ? pathSegments[pathSegments.indexOf('api') + 1] : pathSegments[0];


            const hasRules = this.ruleEngine.hasRulesForEntity(entityName);
            if (!hasRules) {
                return next();
            } else {
                const globalContext = this.dependencyManager.context; 

                if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(eventType) && req.body) {
                    console.log(`Processing inbound ${eventType} on ${entityName} with data:`, req.body);

                    try {
                        const data = {
                            ...req.body,
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
                                    req.body[field] = value; 
                                },
                            },
                        });

                        if (
                            (response.data && Object.keys(response.data).length > 0 && response.module) || 
                            (response.error && response.error !== '') ||
                            response.status !== 200
                        ) {
                            res.status(response.status).json({
                                success: response.success !== undefined ? response.success : (response.error ? false : true),
                                message: response.message,
                                error: response.error,
                                data: response.data,
                                module: response.module,
                                code: response.code
                            });
                        }
                        
                        if(response.status === 600){
                            response.status = 200;
                            return res.status(response.status).json({ message: response.message, error: response.error, data: response.data, module: response.module });
                        }
                        
                        response.Reset();
                        return next();

                    } catch (err) {
                        console.error(`Error processing inbound ${eventType} rules:`, err.message);
                        return res.status(500).json({ error: `${eventType} rules processing failed` });
                    }
                } else if (eventType === 'GET') {
                    res.locals.ruleEngineData = null;
                    
                    try {
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
                                sendResponse: (ctx, responseData) => {
                                    res.locals.ruleEngineData = responseData;
                                }
                            },
                            direction: 'in'
                        });
                    } catch (err) {
                        console.error(`Error processing inbound GET (GETIN) query parameters:`, err.message);
                        return res.status(500).json({ error: `GET query parameter processing failed` });
                    }

                    const originalSend = res.send;
                    res.send = async (responseData) => {
                        const finalData = res.locals.ruleEngineData !== null ? res.locals.ruleEngineData : responseData;

                        if (res.statusCode >= 300) {
                            originalSend.call(res, finalData);
                            return res.end(); // Forcefully end the response
                        }

                        try {
                            let parsedData;
                            try {
                                parsedData = typeof finalData === 'string' ? JSON.parse(finalData) : finalData;
                            } catch (parseError) {
                                originalSend.call(res, finalData);
                                return res.end(); // Forcefully end the response
                            }

                            if (!parsedData) {
                                originalSend.call(res, finalData);
                                return res.end(); // Forcefully end the response
                            }

                            if (!parsedData.data) {
                                parsedData = { data: parsedData };
                            }

                            const ruleData = Array.isArray(parsedData.data) ? parsedData.data : [parsedData.data];

                             const customUpdateAction = (ctx, action) => {
                                if (action.field && action.expression) {
                                    try {
                                        let computedValue;
                                        if (typeof action.expression === 'string') {
                                            computedValue = action.expression.replace(/\${([^}]+)}/g, (match, inner) => {
                                                try {
                                                    const fn = new Function('data', `with(data) { return ${inner}; }`);
                                                    const value = fn(ctx.data);
                                                    return value !== undefined && value !== null ? value : match;
                                                } catch (e) {
                                                    return match;
                                                }
                                            });
                                        } else {
                                            computedValue = action.expression;
                                        }
                                        ctx.data[action.field] = computedValue;
                                        if (Array.isArray(parsedData.data)) {
                                            parsedData.data.forEach(item => {
                                                item[action.field] = computedValue;
                                            });
                                        } else if (typeof parsedData.data === 'object') {
                                            parsedData.data[action.field] = computedValue;
                                        } else {
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
                                direction: 'out'
                            });

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
                            res.end(); // Forcefully end the response after success

                        } catch (err) {
                            console.error(`Error processing outbound GET (GETOUT) rules for entity: ${entityName}:`, err.message);
                            originalSend.call(res, finalData);
                            res.end(); // Forcefully end the response after failure
                        }
                    };
                    return next();
                } else {
                    // No rule processing required for other methods
                }
            }
            next();
        };
    }
}

module.exports = RuleEngineMiddleware;
