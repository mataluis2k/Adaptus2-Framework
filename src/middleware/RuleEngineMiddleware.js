const fs = require('fs');
const path = require('path');
// Note: Assuming 'ruleEngine' module export is { RuleEngine }, but the file is ruleEngine.js
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
        const self = this;

        return async (req, res, next) => {
            const { setContext } = require('../modules/context');
            setContext('req', req);

            if (!self.ruleEngine) {
                return next();
            }

            const eventType = req.method.toUpperCase();
            let pathSegments = req.path.split('/').filter(Boolean);
            let entityName = pathSegments.includes('api') ? pathSegments[pathSegments.indexOf('api') + 1] : pathSegments[0];

            if (eventType !== 'GET') {
                // Logic for POST/PUT/etc. remains the same
                if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(eventType) && req.body) {
                    try {
                        const data = { ...req.body, user_agent: req.headers['user-agent'], user_ip: req.ip, method: req.method, path: req.path };
                        await self.ruleEngine.processEvent(eventType, entityName, data, {
                            ...(self.dependencyManager.context || {}),
                            actions: { ...((self.dependencyManager.context || {}).actions || {}), update: (ctx, entity, field, value) => { req.body[field] = value; } },
                        });
                    } catch (err) {
                      console.error(`Error processing inbound ${eventType} rules:`, err.message);
                      return res.status(500).json({ error: `${eventType} rules processing failed` });
                    }
                }
                return next();
            }

            const globalContext = self.dependencyManager.context || {};
            const rules = self.ruleEngine.getRules();

            const getRulesForEntity = rules.filter(rule =>
                rule.entity.toLowerCase() === entityName.toLowerCase() && rule.eventType === 'GET'
            );

            const hasGetInRule = getRulesForEntity.some(rule => rule.direction === 'in');
            const hasGetOutRule = getRulesForEntity.some(rule => rule.direction === 'out');
            const hasGenericGetRule = getRulesForEntity.some(rule => rule.direction === null);

            if (hasGetInRule || hasGenericGetRule) {
                const data = { ...req.query, user_agent: req.headers['user-agent'], user_ip: req.ip, method: req.method, path: req.path };

                await self.ruleEngine.processEvent('GET', entityName, data, {
                    ...globalContext,
                    req: req,
                    res: res,
                    actions: { ...(globalContext.actions || {}) },
                    direction: 'in'
                });
                // The plugin has run and populated the responseBus.
                // We now pass control to the DynamicRouteHandler.
                return next();

            } else if (hasGetOutRule) {
                // Logic for GETOUT remains the same
                const originalSend = res.send;
                res.send = async (responseData) => {
                    try {
                        let parsedData = (typeof responseData === 'string') ? JSON.parse(responseData) : responseData;
                        const ruleData = parsedData.data ? (Array.isArray(parsedData.data) ? parsedData.data : [parsedData.data]) : [];

                        if (ruleData.length > 0) {
                            await self.ruleEngine.processEvent('GET', entityName, ruleData, {
                                ...globalContext,
                                actions: { ...(globalContext.actions || {}) },
                                direction: 'out'
                            });
                        }
                        originalSend.call(res, JSON.stringify(parsedData));
                    } catch (err) {
                        console.error(`Error processing outbound GET rules for entity: ${entityName}:`, err.message);
                        originalSend.call(res, responseData);
                    }
                };
                return next();
            } else {
                return next();
            }
        };
    }
  }

  module.exports = RuleEngineMiddleware;
