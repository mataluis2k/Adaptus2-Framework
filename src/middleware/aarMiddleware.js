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
 * @returns {Array<Function>} An array of middleware functions.
 */
function aarMiddleware(authConfig, aclConfig, ruleEngineInstance) {
  const middlewares = [];

  // Add authentication middleware if authConfig is provided.
  if (authConfig != null) {
    middlewares.push(authenticateMiddleware(authConfig));
  }

  // Process ACL middleware if aclConfig is provided.
  if (aclConfig != null) {
    // If aclConfig is an array, wrap it in an object with a null message.
    if (Array.isArray(aclConfig)) {
      aclConfig = { config: aclConfig, message: null };
    }
    // Destructure with default values to avoid errors.
    const { config = [], message = null } = aclConfig;
    middlewares.push(aclMiddleware(config, message));
  }

  // Always include the RuleEngine middleware.
  middlewares.push(ruleEngineInstance.middleware());

  return middlewares;
}

module.exports = { aarMiddleware };
/** TO use it we would declare the route as follows app.get(route, aarMiddleware(auth, acl, ruleEngineInstance) 
 * Where auth and acl can be null if those values are NOT present, that will disabled the authentication and ACL middleware
*/