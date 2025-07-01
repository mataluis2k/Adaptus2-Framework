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
      // inject the request into global context
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
            const baseCtx = {
              ...self.dependencyManager.context,
              endpoint: endpointConfig
            };

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
                ...baseCtx,
                actions: {
                  ...(baseCtx.actions || {}),
                  update: (_, __, field, value) => { req.body[field] = value; }
                }
              }
            );

            // short-circuit if plugin set a response
            if (
              (response.data && Object.keys(response.data).length) ||
              response.error ||
              response.status !== 200
            ) {
              const success = response.success !== undefined
                ? response.success
                : (!response.error);
              return res.status(response.status).json({
                success,
                message: response.message,
                error: response.error,
                data: response.data,
                module: response.module,
                code: response.code
              });
            }

            // special status 600 handling
            if (response.status === 600) {
              response.status = 200;
              return res.status(response.status).json({
                message: response.message,
                error: response.error,
                data: response.data,
                module: response.module
              });
            }

            // reset shared state before continuing
            response.Reset();

          } catch (err) {
            console.error(`Error processing inbound ${eventType} rules:`, err.message);
            return res.status(500).json({ error: `${eventType} rules processing failed` });
          }
        }
        return next();
      }

      // === GET ===
      const globalCtx = self.dependencyManager.context || {};
      const allRules = self.ruleEngine.getRules();

      // support both `.resource`+`.event` and `.entity`+`.eventType`
      const entityRules = allRules.filter(rule => {
        const rsrc = ((rule.resource || rule.entity) || '').toLowerCase();
        const evt  = ((rule.event    || rule.eventType) || '').toUpperCase();
        return rsrc === entityName.toLowerCase() && evt === 'GET';
      });

      const hasGetIn      = entityRules.some(r => r.direction === 'in');
      const hasGetOut     = entityRules.some(r => r.direction === 'out');
      const hasGenericGet = entityRules.some(r => r.direction == null);

      // --- GET INBOUND (always processed, even if req.query is empty) ---
      if (hasGetIn || hasGenericGet) {
        try {
          const data = {
            ...req.query,
            user_agent: req.headers['user-agent'],
            user_ip: req.ip || req.connection?.remoteAddress,
            method: req.method,
            path: req.path
          };

          await self.ruleEngine.processEvent(
            'GET',
            entityName,
            data,
            {
              ...globalCtx,
              endpoint: endpointConfig,
              req, res,
              actions: {
                ...(globalCtx.actions || {}),
                update: (_, __, field, value) => { req.query[field] = value; }
              },
              direction: 'in'
            }
          );

          // short-circuit if plugin set a response
          if (
            (response.data && Object.keys(response.data).length) ||
            response.error ||
            response.status !== 200
          ) {
            const success = response.success !== undefined
              ? response.success
              : (!response.error);
            return res.status(response.status).json({
              success,
              message: response.message,
              error: response.error,
              data: response.data,
              module: response.module,
              code: response.code
            });
          }

          // reset shared state before falling through
          response.Reset();

        } catch (err) {
          console.error('Error processing inbound GET rules:', err.message);
          return res.status(500).json({ error: 'GET query parameter processing failed' });
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
            const parsed = typeof responseData === 'string'
              ? JSON.parse(responseData)
              : responseData;

            const payload = parsed.data
              ? (Array.isArray(parsed.data) ? parsed.data : [parsed.data])
              : [];

            if (payload.length) {
              const customUpdate = (ctxInner, action) => {
                if (!action.field) return;
                let val;
                if (typeof action.expression === 'string') {
                  val = action.expression.replace(/\${([^}]+)}/g, (_, expr) => {
                    try {
                      return new Function('data', `with(data){return ${expr}}`)(ctxInner.data);
                    } catch {
                      return null;
                    }
                  });
                } else {
                  val = action.expression;
                }
                ctxInner.data[action.field] = val;
                if (Array.isArray(parsed.data)) {
                  parsed.data.forEach(item => item[action.field] = val);
                } else if (parsed.data && typeof parsed.data === 'object') {
                  parsed.data[action.field] = val;
                }
              };

              await self.ruleEngine.processEvent(
                'GET',
                entityName,
                payload,
                {
                  ...globalCtx,
                  endpoint: endpointConfig,
                  actions: {
                    ...(globalCtx.actions || {}),
                    update: customUpdate
                  },
                  direction: 'out'
                }
              );
            }

            // sanitize nested user fields
            const clean = obj => {
              if (!obj || typeof obj !== 'object') return;
              if (Array.isArray(obj)) return obj.forEach(clean);
              delete obj.user;
              Object.values(obj).forEach(clean);
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

      // no relevant GET rules
      return next();
    };
  }
}

module.exports = RuleEngineMiddleware;
