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
                // Keep this quiet to avoid spamming logs on routes without rules.
                return next();
            }

            const eventType = req.method.toUpperCase();
            let pathSegments = req.path.split('/').filter(Boolean);
            let entityName = pathSegments.includes('api') ? pathSegments[pathSegments.indexOf('api') + 1] : pathSegments[0];

            const hasRules = this.ruleEngine.hasRulesForEntity(entityName);
            if (!hasRules) {
                return next();
            }

            const globalContext = this.dependencyManager.context;

            // --- RETAIN ORIGINAL LOGIC FOR NON-GET REQUESTS ---
            // This logic correctly handles inbound processing and allows plugins to short-circuit the response.
            if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(eventType)) {
                if (!req.body) return next();

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
                            ...(globalContext.actions || {}),
                            update: (ctx, entity, field, value) => { req.body[field] = value; },
                        },
                    });

                    // CRITICAL: Check if a plugin has populated the response bus to send a custom response.
                    if (
                        (response.data && Object.keys(response.data).length > 0 && response.module) ||
                        (response.error && response.error !== '') ||
                        response.status !== 200
                    ) {
                        return res.status(response.status).json({
                            success: response.success !== undefined ? response.success : !response.error,
                            message: response.message,
                            error: response.error,
                            data: response.data,
                            module: response.module,
                            code: response.code
                        });
                    }

                    response.Reset();
                    return next();

                } catch (err) {
                    console.error(`Error processing inbound ${eventType} rules:`, err.message);
                    return res.status(500).json({ error: `${eventType} rules processing failed` });
                }
            }

            // --- NEW, SMARTER LOGIC FOR GET REQUESTS ---
            if (eventType === 'GET') {
                const rules = this.ruleEngine.getRules();
                const getRulesForEntity = rules.filter(rule =>
                    rule.entity.toLowerCase() === entityName.toLowerCase() && rule.eventType === 'GET'
                );

                const hasGetInRule = getRulesForEntity.some(rule => rule.direction === 'in');
                const hasGenericGetRule = getRulesForEntity.some(rule => rule.direction === null || rule.direction === undefined);
                const hasGetOutRule = getRulesForEntity.some(rule => rule.direction === 'out');

                // --- PATH 1: Inbound-first processing ---
                if (hasGetInRule || hasGenericGetRule) {
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
                            req, res,
                            actions: {
                                ...(globalContext.actions || {}),
                                update: (ctx, entity, field, value) => { req.query[field] = value; },
                            },
                            direction: 'in'
                        });

                        if (
                            (response.data !== null && response.module) ||
                            (response.error && response.error !== '') ||
                            response.status !== 200
                        ) {
                            return res.status(response.status).json({
                                success: response.success !== undefined ? response.success : !response.error,
                                message: response.message,
                                error: response.error,
                                data: response.data,
                                module: response.module,
                                code: response.code
                            });
                        }

                        response.Reset();
                        return next();

                    } catch (err) {
                        console.error(`Error processing inbound GET rules:`, err.message);
                        return res.status(500).json({ error: 'GET rules processing failed' });
                    }
                }
                // --- PATH 2: Outbound-only processing (PRESERVED FROM ORIGINAL) ---
                else if (hasGetOutRule) {
                    const originalSend = res.send;
                    res.send = async (responseData) => {
                        if (res.statusCode >= 300) {
                            return originalSend.call(res, responseData);
                        }

                        try {
                            let parsedData;
                            try {
                                parsedData = typeof responseData === 'string' ? JSON.parse(responseData) : responseData;
                            } catch (parseError) {
                                return originalSend.call(res, responseData);
                            }

                            if (!parsedData) {
                                return originalSend.call(res, responseData);
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
                                            parsedData.data.forEach(item => { item[action.field] = computedValue; });
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
                                    ...(globalContext.actions || {}),
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

                        } catch (err) {
                            console.error(`Error processing outbound GET (GETOUT) rules for entity: ${entityName}:`, err.message);
                            originalSend.call(res, responseData);
                        }
                    };
                    return next();
                }
            }

            // Fallback for any other methods or scenarios not handled above.
            return next();
        };
    }
}

module.exports = RuleEngineMiddleware;
