// cliSocketServer.js
const net = require('net');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

// Read CLI authentication and port settings from the environment.
const CLI_USERNAME = process.env.CLI_USERNAME;
const CLI_PASSWORD = process.env.CLI_PASSWORD;
const SOCKET_CLI_PORT = process.env.SOCKET_CLI_PORT || 5000;
const requireAuth = CLI_USERNAME && CLI_PASSWORD;

/**
 * Starts the CLI Socket Server.
 *
 * @param {Object} options - An object containing dependencies and configuration.
 *   Expected properties include:
 *     - version: (string) The server version (e.g. from package.json)
 *     - requestLogger: an object with a method getRequestLog(requestId)
 *     - shutdown: async function to gracefully shut down the server
 *     - apiConfig: current API configuration
 *     - globalContext: object containing, for example, a ruleEngine and actions
 *     - app: Express app (used for route re-registration during config reload)
 *     - pluginManager: your plugin manager instance (with loadPlugin/unloadPlugin and plugins map)
 *     - pluginDir: path to the plugins folder
 *     - devTools: (optional) an instance that provides validateConfig(configPath, schema)
 *     - loadConfig: async function that returns updated API config
 *     - categorizeApiConfig: function that accepts apiConfig and returns categorized config
 *     - updateValidationRules: function to update validation rules after config reload
 *     - registerRoutes: function(app, databaseRoutes) to re-register database routes
 *     - registerProxyEndpoints: function(app, proxyRoutes) to re-register proxy endpoints
 *     - DynamicRouteHandler: object with a method registerDynamicRoute(app, route)
 *     - registerFileUploadEndpoint: function(app, route)
 *     - registerStaticRoute: function(app, route)
 *     - broadcastConfigUpdate: async function to broadcast config updates (if using network mode)
 *     - subscribeToConfigUpdates: function(callback) to subscribe for config updates
 *     - clearRedisCache: function to clear Redis cache
 *     - initializeRules: function to initialize/reload business rules
 *     - getRoutes: function(app) that returns a list of registered routes
 *     - JWT_SECRET: string secret for token generation (defaults to process.env.JWT_SECRET)
 *     - JWT_EXPIRY: token expiry duration (defaults to process.env.JWT_EXPIRY)
 *
 * @returns {net.Server} The created CLI server instance.
 */
function startCliServer(options = {}) {
  // Provide defaults for JWT options if not supplied.
  const JWT_SECRET = options.JWT_SECRET || process.env.JWT_SECRET;
  const JWT_EXPIRY = options.JWT_EXPIRY || process.env.JWT_EXPIRY;

  const server = net.createServer((socket) => {
    console.log("CLI client connected.");
    let authenticated = false;

    // If authentication is required, prompt the user.
    if (requireAuth) {
      socket.write("Welcome to the CLI server.\n");
      socket.write("Please authenticate using: AUTH <username> <password>\n");
    } else {
      socket.write("Welcome to the CLI server.\n");
    }

    socket.on("data", async (data) => {
      const input = data.toString().trim();

      // If authentication is required and not yet satisfied,
      // only process the AUTH command.
      if (requireAuth && !authenticated) {
        const parts = input.split(" ");
        if (parts[0].toUpperCase() === "AUTH") {
          const user = parts[1];
          const pass = parts[2];
          if (user === CLI_USERNAME && pass === CLI_PASSWORD) {
            authenticated = true;
            socket.write("Authentication successful.\n");
          } else {
            socket.write("Authentication failed. Try again.\n");
          }
        } else {
          socket.write("Please authenticate first using: AUTH <username> <password>\n");
        }
        return;
      }

      // Once authenticated (or if auth is not required), process commands.
      const [command, ...args] = input.split(" ");
      try {
        switch (command) {
          case "version":
            console.log(`Adaptus2-Framework Version: ${options.version || "N/A"}`);
            socket.write(`Adaptus2-Framework Version: ${options.version || "N/A"}\n`);
            break;

          case "requestLog": {
            const requestId = args[0];
            if (!requestId) {
              socket.write("Usage: requestLog <requestId>\n");
              break;
            }
            const log = await options.requestLogger.getRequestLog(requestId);
            socket.write(JSON.stringify(log, null, 2) + "\n");
            break;
          }

          case "shutdown":
            console.log("Shutting down server...");
            socket.write("Shutting down...\n");
            if (typeof options.shutdown === "function") {
              await options.shutdown();
            }
            break;

          case "userGenToken": {
            if (args.length < 2) {
              socket.write("Usage: userGenToken <username> <acl>\n");
              break;
            }
            const [username, acl] = args;
            try {
              const payload = { username, acl };
              const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
              socket.write(`Generated user token:\n${token}\n`);
            } catch (error) {
              console.error("Error generating user token:", error.message);
              socket.write(`Error generating user token: ${error.message}\n`);
            }
            break;
          }

          case "appGenToken": {
            if (args.length < 2) {
              socket.write("Usage: appGenToken <table> <acl>\n");
              break;
            }
            const [table, acl] = args;
            try {
              const payload = { table, acl, username: table };
              const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
              socket.write(`Generated app token:\n${token}\n`);
            } catch (error) {
              console.error("Error generating app token:", error.message);
              socket.write(`Error generating app token: ${error.message}\n`);
            }
            break;
          }

          case "showConfig":
            socket.write(JSON.stringify(options.apiConfig, null, 2) + "\n");
            break;

          case "showRules":
            socket.write(JSON.stringify(options.globalContext?.ruleEngine, null, 2) + "\n");
            break;

          case "nodeInfo": {
            if (args.length < 2) {
              socket.write("Usage: nodeInfo <route|table> <routeType>\n");
              break;
            }
            let configObject;
            console.log(args[0], args[1]);
            if (args[1] === "def") {
              configObject = options.apiConfig.find(
                (item) => item.routeType === args[1] && item.dbTable === args[0]
              );
            } else {
              configObject = options.apiConfig.find(
                (item) => item.route === args[0] && item.routeType === args[1]
              );
            }
            if (configObject) {
              socket.write(JSON.stringify(configObject, null, 2) + "\n");
            } else {
              socket.write(`Config object ${args[0]} not found.\n`);
            }
            break;
          }

          case "configReload": {
            try {
              options.consolelog?.log("Reloading configuration...");
              await options.clearRedisCache?.();
              await options.initializeRules?.();
              options.apiConfig = await options.loadConfig?.();
              options.consolelog?.log(options.apiConfig);
              options.categorizedConfig = options.categorizeApiConfig?.(options.apiConfig);
              options.updateValidationRules?.();

              // Clear all routes from the app's router.
              if (options.app && options.app._router && Array.isArray(options.app._router.stack)) {
                options.app._router.stack = options.app._router.stack.filter((layer) => !layer.route);
              }

              // Re-register all route types.
              options.registerRoutes?.(options.app, options.categorizedConfig.databaseRoutes);
              options.registerProxyEndpoints?.(options.app, options.categorizedConfig.proxyRoutes);
              options.categorizedConfig.dynamicRoutes?.forEach((route) =>
                options.DynamicRouteHandler.registerDynamicRoute(options.app, route)
              );
              options.categorizedConfig.fileUploadRoutes?.forEach((route) =>
                options.registerFileUploadEndpoint(options.app, route)
              );
              options.categorizedConfig.staticRoutes?.forEach((route) =>
                options.registerStaticRoute(options.app, route)
              );

              if (process.env.PLUGIN_MANAGER === "network") {
                await options.broadcastConfigUpdate?.(options.apiConfig, options.categorizedConfig, options.globalContext);
                options.subscribeToConfigUpdates?.((updatedConfig) => {
                  options.apiConfig = updatedConfig.apiConfig;
                  options.categorizedConfig = updatedConfig.categorizedConfig;
                  if (options.globalContext) {
                    options.globalContext.resources = updatedConfig.globalContext.resources || {};
                  }
                  console.log("Configuration updated from cluster.");
                });
              }
              options.consolelog?.log("API config reloaded successfully.");
              socket.write("API config reloaded successfully.\n");
            } catch (error) {
              options.consolelog?.error(`Error reloading API config: ${error.message}`);
              socket.write(`Error reloading API config: ${error.message}\n`);
            }
            break;
          }

          case "listPlugins": {
            try {
              const plugins = fs
                .readdirSync(options.pluginDir)
                .filter((file) => file.endsWith(".js"))
                .map((file) => path.basename(file, ".js"));
              if (plugins.length === 0) {
                socket.write("No plugins found in the plugins folder.\n");
              } else {
                socket.write(`Available plugins:\n${plugins.join("\n")}\n`);
              }
            } catch (err) {
              socket.write(`Error reading plugins folder: ${err.message}\n`);
            }
            break;
          }

          case "listActions": {
            const actions = options.globalContext?.actions
              ? Object.keys(options.globalContext.actions)
              : [];
            if (actions.length === 0) {
              socket.write("No actions available.\n");
            } else {
              socket.write(`Available actions:\n${actions.join("\n")}\n`);
            }
            break;
          }

          case "load": {
            if (args.length) {
              const response = await options.pluginManager.loadPlugin(args[0]);
              socket.write(`We got: ${response}\n`);
            } else {
              socket.write("Usage: load <pluginName>\n");
            }
            break;
          }

          case "unload": {
            if (args.length) {
              await options.pluginManager.unloadPlugin(args[0]);
              socket.write(`Plugin ${args[0]} unloaded successfully.\n`);
            } else {
              socket.write("Usage: unload <pluginName>\n");
            }
            break;
          }

          case "reload": {
            if (args.length) {
              await options.pluginManager.unloadPlugin(args[0]);
              await options.pluginManager.loadPlugin(args[0]);
              socket.write(`Plugin ${args[0]} reloaded successfully.\n`);
            } else {
              socket.write("Usage: reload <pluginName>\n");
            }
            break;
          }

          case "reloadall": {
            options.pluginManager.plugins.forEach(async (_, pluginName) => {
              await options.pluginManager.unloadPlugin(pluginName);
              await options.pluginManager.loadPlugin(pluginName);
            });
            socket.write("All plugins reloaded successfully.\n");
            break;
          }

          case "list": {
            const loadedPlugins = Array.from(options.pluginManager.plugins.keys());
            socket.write(`Loaded plugins: ${loadedPlugins.join(", ")}\n`);
            break;
          }

          case "routes": {
            const routes = options.getRoutes?.(options.app);
            socket.write(`Registered routes: ${JSON.stringify(routes, null, 2)}\n`);
            break;
          }

          case "exit":
            socket.write("Goodbye!\n");
            socket.end();
            break;

          case "validate-config": {
            try {
              if (!options.devTools) {
                // Optionally instantiate devTools if not provided.
                // options.devTools = new (require('./modules/devTools.js'))();
              }
              const schema = {
                type: "array",
                items: {
                  type: "object",
                  required: ["routeType"],
                  allOf: [
                    {
                      if: { properties: { routeType: { const: "def" } } },
                      then: { required: [] },
                    },
                    {
                      if: { properties: { routeType: { not: { const: "def" } } } },
                      then: { required: ["route"] },
                    },
                  ],
                  properties: {
                    routeType: {
                      type: "string",
                      enum: ["dynamic", "static", "database", "proxy", "def", "fileUpload"],
                    },
                    dbType: { type: "string", enum: ["mysql"] },
                    dbConnection: { type: "string" },
                    route: { type: "string", pattern: "^/" },
                    auth: { type: "string" },
                    acl: { type: "array", items: { type: "string" } },
                    allowMethods: {
                      type: "array",
                      items: { type: "string", enum: ["GET", "POST", "PUT", "DELETE", "PATCH"] },
                    },
                    allowRead: { type: "array", items: { type: "string" } },
                    allowWrite: { type: "array", items: { type: "string" } },
                    columnDefinitions: {
                      type: "object",
                      additionalProperties: { type: "string" },
                    },
                  },
                },
              };

              const configPath = path.join(process.cwd(), "config", "apiConfig.json");
              const result = await options.devTools.validateConfig(configPath, schema);
              if (!result.valid && result.errors) {
                const errorsByObject = {};
                result.errors.forEach((error) => {
                  const matches = error.instancePath.match(/\/(\d+)/);
                  if (matches) {
                    const index = matches[1];
                    if (!errorsByObject[index]) {
                      errorsByObject[index] = { object: result.config[index], errors: [] };
                    }
                    const property = error.instancePath.split("/").slice(2).join("/") || "object";
                    const message = `${property}: ${error.message}`;
                    errorsByObject[index].errors.push(message);
                  }
                });
                const formattedResult = Object.entries(errorsByObject).map(([index, data]) => ({
                  index: parseInt(index),
                  object: data.object,
                  errors: data.errors,
                }));
                socket.write(JSON.stringify(formattedResult, null, 2) + "\n");
              } else {
                socket.write("Configuration is valid. No errors found.\n");
              }
            } catch (error) {
              socket.write(`Error validating config: ${error.message}\n`);
            }
            break;
          }

          case "help":
          default:
            socket.write(
              "Available commands: version, requestLog, shutdown, userGenToken, appGenToken, showConfig, showRules, nodeInfo, configReload, listPlugins, listActions, load, unload, reload, reloadall, list, routes, validate-config, exit, help.\n"
            );
            break;
        }
      } catch (error) {
        socket.write(`Error: ${error.message}\n`);
      }
    });

    socket.on("end", () => {
      console.log("CLI client disconnected.");
    });
  });

  server.listen(SOCKET_CLI_PORT, "localhost", () => {
    console.log(`Socket CLI server running on localhost:${SOCKET_CLI_PORT}`);
  });

  return server;
}

module.exports = { startCliServer };
