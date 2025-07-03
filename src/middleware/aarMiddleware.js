// consolidatedMiddleware.js
const { authenticateMiddleware, aclMiddleware } = require('./authenticationMiddleware');



/**
 * Creates a consolidated middleware chain that includes:
 *   - Authentication middleware (if authConfig is provided)
 *   - ACL middleware (if aclConfig is provided)
 *   - RuleEngine middleware (always included)
 *
 * @param {any|null} authConfig - Configuration for authentication; if null, authentication is disabled.
 * @param {any|null} aclConfig - Configuration for ACL; if null, ACL is disabled.
 * @param {object} ruleEngineInstance - An instance of the RuleEngine middleware.
 * @param {object} endpointConfig - Optional endpoint configuration to pass to plugins.
 * @returns {Array<Function>} An array of middleware functions.
 */
function aarMiddleware(authConfig, aclConfig, ruleEngineInstance, endpointConfig = null) {
  const middlewares = [];

  // Add authentication middleware if authConfig is provided.
  if (authConfig != null) {
    middlewares.push(authenticateMiddleware(authConfig));
  }

  // Process ACL middleware if aclConfig is provided.
  if (aclConfig != null) {
    let allowedRoles;
    let message = null;
    if (Array.isArray(aclConfig)) {
      // If aclConfig is an array, use it directly.
      allowedRoles = aclConfig;
    } else if (typeof aclConfig === 'object') {
      // Try to extract allowed roles from the acl or config property.
      allowedRoles = aclConfig.acl || aclConfig.config || [];
      // Extract error message from unauthorized or message property.
      message = aclConfig.unauthorized || aclConfig.message || null;
    } else {
      allowedRoles = [];
    }
    // If allowedRoles is not already an array, wrap it.
    if (!Array.isArray(allowedRoles)) {
      allowedRoles = [allowedRoles];
    }
    middlewares.push(aclMiddleware(allowedRoles, message));
  }

  // Always include the RuleEngine middleware with endpoint configuration.
  middlewares.push(ruleEngineInstance.middleware(endpointConfig));

  return middlewares;
}

module.exports = { aarMiddleware };
/** TO use it we would declare the route as follows app.get(route, aarMiddleware(auth, acl, ruleEngineInstance)
 * Where auth and acl can be null if those values are NOT present, that will disabled the authentication and ACL middleware
*/
