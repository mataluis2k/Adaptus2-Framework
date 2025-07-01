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
      this.ruleEngine = null;
    }
  }

  middleware(endpointConfig = null) {
    const self = this;

    return async (req, res, next) => {
      // inject request into global context once
      setContext('req', req);

      if (!self.ruleEngine) {
        return next();
      }

      const eventType = req.method.toUpperCase();
      const pathSegments = req.path.split('/').filter(Boolean);
      const entityName = pathSegments.includes('api')
        ? pathSegments[pathSegments.indexOf('api') + 1]
        : pathSegments[0];

      // === NON-GET (POST/PUT/PATCH/DELETE) ===
      if (eventType !== 'GET') {
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(eventType) && req.body) {
          try {
            // merge context with endpointConfig and dependencyManager.context
            const ctx = {
              ...self.dependencyManager.context,
              endpoint: endpointConfig,
            };

            // prepare data for rules
            const data = {
              ...req.body,
              user_agent: req.headers['user-agent'],
              user_ip: req.ip || req.connection?.remoteAddress,
              method: req.method,
              path: req.path,
            };

            await self.ruleEngine.processEvent(
              eventType,
              entityName,
              data,
              {
                ...ctx,
                actions: {
                  ...(ctx.actions || {}),
                  update: (ctxInner, _, field, value) => {
                    req.body[field] = value;
                  },
                },
              }
            );

            // short-circuit if plugin set response
            if (
              (response.data && Object.keys(response.data).length) ||
              response.error ||
              response.status !== 200
            ) {
              const success = response.success !== undefined
                ? response.success
                : (!response.error);
              return res
                .status(response.status)
                .json({
                  success,
                  message: response.message,
                  error: response.error,
                  data: response.data,
                  module: response.module,
                  code: response.code,
                });
            }

            // handle special 600 status
            if (response.status === 600) {
              response.status = 200;
              return res
                .status(response.status)
                .json({
                  message: response.message,
                  error: response.error,
                  data: response.data,
                  module: response.module,
                });
            }

            // reset shared state before continuing
            response.Reset();
          } catch (err) {
            console.error(`Error processing inbound ${eventType} rules:`, err.message);
            return res
              .status(500)
              .json({ error: `${eventType} rules processing failed` });
          }
        }
        return next();
      }

      // === GET ===
      const globalContext = self.dependencyManager.context || {};
      const allRules = self.ruleEngine.getRules();
      const entityRules = allRules.filter(rule =>
        rule.resource.toLowerCase() === entityName.toLowerCase() &&
        rule.event.toUpperCase() === 'GET'
      );

      const hasGetIn = entityRules.some(r => r.direction === 'in');
      const hasGetOut = entityRules.some(r => r.direction === 'out');
      const hasGenericGet = entityRules.some(r => r.direction == null);

      // --- GET INBOUND ---
      if (hasGetIn || hasGenericGet) {
        if (req.query && Object.keys(req.query).length) {
          try {
            const data = {
              ...req.query,
              user_agent: req.headers['user-agent'],
              user_ip: req.ip || req.connection?.remoteAddress,
              method: req.method,
              path: req.path,
            };

            await self.ruleEngine.processEvent(
              'GET',
              entityName,
              data,
              {
                ...globalContext,
                endpoint: endpointConfig,
                req,
                res,
                actions: {
                  ...(globalContext.actions || {}),
                  update: (_, __, field, value) => {
                    req.query[field] = value;
                  },
                },
                direction: 'in',
              }
            );
          } catch (err) {
            console.error('Error processing inbound GET rules:', err.message);
            return res
              .status(500)
              .json({ error: 'GET query parameter processing failed' });
          }
        }
        return next();
      }

      // --- GET OUTBOUND ---
      if (hasGetOut) {
        const originalSend = res.send;
        res.send = async (responseData) => {
          if (res.statusCode >= 300) {
            return originalSend.call(res, responseData);
          }

          try {
            let parsed = typeof responseData === 'string'
              ? JSON.parse(responseData)
              : responseData;

            // Ensure a data array for rule processing
            const payload = parsed.data
              ? (Array.isArray(parsed.data) ? parsed.data : [parsed.data])
              : [];

            if (payload.length) {
              // custom update merges back into parsed.data
              const customUpdate = (ctxInner, action) => {
                if (!action.field) return;
                let computed;
                if (typeof action.expression === 'string') {
                  computed = action.expression.replace(
                    /\${([^}]+)}/g,
                    (_, expr) => {
                      try {
                        const fn = new Function('data', `with(data){return ${expr}}`);
                        return fn(ctxInner.data);
                      } catch {
                        return null;
                      }
                    }
                  );
                } else {
                  computed = action.expression;
                }
                ctxInner.data[action.field] = computed;
                if (Array.isArray(parsed.data)) {
                  parsed.data.forEach(item => { item[action.field] = computed; });
                } else if (parsed.data && typeof parsed.data === 'object') {
                  parsed.data[action.field] = computed;
                }
              };

              await self.ruleEngine.processEvent(
                'GET',
                entityName,
                payload,
                {
                  ...globalContext,
                  endpoint: endpointConfig,
                  actions: {
                    ...(globalContext.actions || {}),
                    update: customUpdate,
                  },
                  direction: 'out',
                }
              );
            }

            // sanitize any nested user fields
            const clean = obj => {
              if (!obj || typeof obj !== 'object') return;
              if (Array.isArray(obj)) {
                obj.forEach(clean);
              } else {
                delete obj.user;
                Object.values(obj).forEach(clean);
              }
            };
            if (parsed.data) clean(parsed.data);

            originalSend.call(res, JSON.stringify(parsed));
          } catch (err) {
            console.error(`Error processing outbound GET rules for ${entityName}:`, err.message);
            originalSend.call(res, responseData);
          }
        };

        return next();
      }

      // no matching rules
      return next();
    };
  }
}

module.exports = RuleEngineMiddleware;
