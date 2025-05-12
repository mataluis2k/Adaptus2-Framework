/**
 * PluginManager - Manages loading, unloading, and synchronizing plugins
 * Supports both local and network (Redis-based) plugin management
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Redis = require('ioredis');
const { promisify } = require('util');

// Constants for configuration
const CLUSTER_NAME = process.env.CLUSTER_NAME || 'default'; // Default cluster
const PLUGIN_UPDATE_CHANNEL = `${CLUSTER_NAME}:plugins:update`;
const PLUGIN_FILE_PREFIX = `${CLUSTER_NAME}:plugin:file:`;
const PLUGIN_EVENT_CHANNEL = `${CLUSTER_NAME}:plugin:events`;
const PLUGIN_CODE_KEY = `${CLUSTER_NAME}:plugin:code:`;

class PluginManager {
    /**
     * Create a new PluginManager instance
     * @param {string} pluginDir - Directory where plugins are stored
     * @param {Object} server - Server instance providing the app
     * @param {Object} dependencyManager - Instance of DependencyManager for plugin dependencies
     */
    constructor(pluginDir, server, dependencyManager) {
        this.pluginDir = path.resolve(pluginDir);
        this.server = server;
        this.plugins = new Map(); // Track plugins by name
        this.dependencyManager = dependencyManager;
        this.tempFiles = new Set(); // Track temporary plugin files
        
        // Create Redis connections for pub/sub
        this.publisherRedis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
        this.subscriberRedis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
        
        // Network mode setup
        if (process.env.PLUGIN_MANAGER === 'network') {
            this.serverId = process.env.SERVER_ID;
            if (!this.serverId) {
                throw new Error('SERVER_ID environment variable is required for network plugin mode.');
            }
            console.log(`Plugin Manager initialized with Server ID: ${this.serverId}`);
        }
        
        // Setup subscription to plugin events
        this.subscribeToPluginEvents();
        
        // Ensure plugin directory exists
        if (!fs.existsSync(this.pluginDir)) {
            fs.mkdirSync(this.pluginDir, { recursive: true });
            console.log(`Created plugin directory: ${this.pluginDir}`);
        }
    }

    /**
     * Load a module by name
     * @param {string} moduleName - Name of the module to load
     * @returns {Object} The loaded module
     */
    loadModule(moduleName) {
        return require(moduleName);
    }
      
    /**
     * Load a plugin and broadcast it (if in network mode)
     * @param {string} pluginName - Name of the plugin to load
     * @param {boolean} broadcast - Whether to broadcast the load event (in network mode)
     * @returns {string} Status message
     */
    async loadPlugin(pluginName, broadcast = true) {
        // In network mode for non-master, pull code from Redis
        if (process.env.PLUGIN_MANAGER === 'network' && process.env.SERVER_ROLE !== 'master') {
            await this.loadPluginFromRedisIfDifferent(pluginName);
            return;
        }

        const pluginPath = path.join(this.pluginDir, `${pluginName}.js`);
    
        if (this.plugins.has(pluginName)) {
            console.warn(`Plugin ${pluginName} is already loaded.`);
            return;
        }
    
        try {
            // Read and load the plugin
            const pluginCode = fs.readFileSync(pluginPath, 'utf-8');
            
            // Clear from require cache if already loaded
            if (require.cache[require.resolve(pluginPath)]) {
                delete require.cache[require.resolve(pluginPath)];
            }
            
            const plugin = require(pluginPath);
    
            if (!this.validatePlugin(plugin)) {
                throw new Error(`Plugin ${pluginName} failed validation.`);
            }
    
            // Initialize the plugin with dependencies
            const dependencies = this.dependencyManager.getDependencies();
            if (typeof plugin.initialize === 'function') {
                plugin.initialize(dependencies);
            }
    
            // Register routes if the plugin has registerRoutes method
            let registeredRoutes = [];
            if (typeof plugin.registerRoutes === 'function') {
                registeredRoutes = plugin.registerRoutes({ app: this.server.app });
            }
    
            const pluginHash = this.getHash(pluginCode);
    
            // Store plugin information
            this.plugins.set(pluginName, { 
                instance: plugin, 
                routes: registeredRoutes, 
                hash: pluginHash,
                path: pluginPath
            });
            
            console.log(`Plugin ${pluginName} loaded successfully.`);
    
            // In network mode, broadcast the plugin to other servers
            if (process.env.PLUGIN_MANAGER === 'network' && broadcast) {
                await this.publisherRedis.hset(`${PLUGIN_CODE_KEY}${pluginName}`, {
                    code: Buffer.from(pluginCode).toString('base64'),
                });
    
                await this.publisherRedis.publish(
                    PLUGIN_EVENT_CHANNEL,
                    JSON.stringify({ action: 'load', pluginName, serverId: this.serverId })
                );
                console.log(`Broadcasted load event for plugin: ${pluginName}`);
            }
    
            return `Plugin ${pluginName} loaded successfully.`;
        } catch (error) {
            console.error(`Failed to load plugin ${pluginName}:`, error.message);
            // Clean up on error
            if (require.cache[require.resolve(pluginPath)]) {
                delete require.cache[require.resolve(pluginPath)];
            }
            this.plugins.delete(pluginName);
            return `Failed to load plugin ${pluginName}: ${error.message}`;
        }
    }
    
    /**
     * Unload a plugin and broadcast the unload event (if in network mode)
     * @param {string} pluginName - Name of the plugin to unload
     * @param {boolean} broadcast - Whether to broadcast the unload event
     * @returns {Promise<void>}
     */
    async unloadPlugin(pluginName, broadcast = true) {
        if (!this.plugins.has(pluginName)) {
            console.warn(`Plugin ${pluginName} is not loaded.`);
            return;
        }
    
        const pluginData = this.plugins.get(pluginName);
        const { instance: plugin, routes, path: pluginPath } = pluginData;
        
        try {
            // Call plugin cleanup method if available
            if (typeof plugin.cleanup === 'function') {
                console.log(`Cleaning up ${pluginName}...`);
                await plugin.cleanup();
            }
    
            // Unregister routes
            if (Array.isArray(routes)) {
                routes.forEach(({ method, path }) => {
                    const stack = this.server.app._router.stack;
                    for (let i = 0; i < stack.length; i++) {
                        const layer = stack[i];
                        if (layer.route && layer.route.path === path && layer.route.methods[method]) {
                            stack.splice(i, 1);
                            console.log(`Unregistered route ${method.toUpperCase()} ${path}`);
                        }
                    }
                });
            }
    
            // Remove plugin from require cache
            if (pluginPath && require.cache[require.resolve(pluginPath)]) {
                delete require.cache[require.resolve(pluginPath)];
            }
            
            // Clean up temp file if it exists
            if (this.tempFiles && this.tempFiles.has(pluginPath)) {
                try {
                    if (fs.existsSync(pluginPath)) {
                        fs.unlinkSync(pluginPath);
                    }
                    this.tempFiles.delete(pluginPath);
                } catch (cleanupError) {
                    console.error(`Failed to clean up temp file ${pluginPath}:`, cleanupError);
                }
            }
    
            // Remove plugin from the plugins map
            this.plugins.delete(pluginName);
    
            console.log(`Plugin ${pluginName} unloaded successfully.`);
    
            // Broadcast unload event if requested and in network mode
            if (process.env.PLUGIN_MANAGER === 'network' && broadcast) {
                await this.publisherRedis.publish(
                    PLUGIN_EVENT_CHANNEL,
                    JSON.stringify({ action: 'unload', pluginName, serverId: this.serverId })
                );
                console.log(`Broadcasted unload event for plugin: ${pluginName}`);
            }
        } catch (error) {
            console.error(`Error unloading plugin ${pluginName}:`, error);
        }
    }

    /**
     * Set up subscription to plugin events from Redis
     */
    subscribeToPluginEvents() {
        if (process.env.PLUGIN_MANAGER !== 'network') {
            console.log('Plugin manager is in local mode. No subscription to Redis events.');
            return;
        }
    
        this.subscriberRedis.subscribe(PLUGIN_EVENT_CHANNEL, (err) => {
            if (err) {
                console.error(`Failed to subscribe to plugin events: ${err.message}`);
            } else {
                console.log(`Subscribed to plugin events on channel ${PLUGIN_EVENT_CHANNEL}.`);
            }
        });
    
        this.subscriberRedis.on('message', async (channel, message) => {
            if (channel !== PLUGIN_EVENT_CHANNEL) return;
        
            console.log(`Received message on channel: ${channel}`);
            console.log(`Message content: ${message}`);
        
            try {
                const { action, pluginName, serverId } = JSON.parse(message);
        
                // Ignore messages originating from this server
                if (serverId === this.serverId) {
                    console.log(`Ignoring message from self (Server ID: ${serverId}).`);
                    return;
                }
        
                if (action === 'load') {
                    console.log(`Processing load event for plugin: ${pluginName}`);
                    await this.loadPlugin(pluginName, false); // Do not rebroadcast
                } else if (action === 'unload') {
                    console.log(`Processing unload event for plugin: ${pluginName}`);
                    await this.unloadPlugin(pluginName, false); // Do not rebroadcast
                } else {
                    console.warn(`Unknown action: ${action}`);
                }
            } catch (error) {
                console.error(`Failed to process message: ${error.message}`);
            }
        });
    }
    
    /**
     * Load a plugin from Redis if the code has changed
     * @param {string} pluginName - Name of the plugin to load
     * @returns {Promise<void>}
     */
    async loadPluginFromRedisIfDifferent(pluginName) {
        try {
            const pluginData = await this.publisherRedis.hgetall(`${PLUGIN_CODE_KEY}${pluginName}`);
            if (!pluginData.code) {
                throw new Error(`No code found for plugin ${pluginName} in Redis.`);
            }
    
            const pluginCode = Buffer.from(pluginData.code, 'base64').toString('utf-8');
            const pluginHash = this.getHash(pluginCode);
    
            // Check if plugin is already loaded with the same code
            if (this.plugins.has(pluginName)) {
                const currentPluginHash = this.plugins.get(pluginName).hash;
                if (currentPluginHash === pluginHash) {
                    console.log(`Plugin ${pluginName} is already loaded with the same code. Skipping load.`);
                    return;
                } else {
                    console.log(`Plugin ${pluginName} code has changed. Reloading.`);
                    await this.unloadPlugin(pluginName, false); // Pass false to avoid broadcasting
                }
            }
    
            const tempPath = path.join(this.pluginDir, `${pluginName}.js`);
            
            // Keep track of created temp files to clean them up later
            if (!this.tempFiles) this.tempFiles = new Set();
            this.tempFiles.add(tempPath);
            
            // Write the plugin code to a file
            fs.writeFileSync(tempPath, pluginCode, 'utf-8');
    
            try {
                // Clear the module from require cache first to ensure we load the new version
                if (require.cache[require.resolve(tempPath)]) {
                    delete require.cache[require.resolve(tempPath)];
                }
                
                // Load the plugin
                const plugin = require(tempPath);
                
                if (!this.validatePlugin(plugin)) {
                    throw new Error(`Plugin ${pluginName} failed validation.`);
                }
                
                const dependencies = this.dependencyManager.getDependencies();
                if (typeof plugin.initialize === 'function') {
                    plugin.initialize(dependencies);
                }
                
                let registeredRoutes = [];
                if (typeof plugin.registerRoutes === 'function') {
                    registeredRoutes = plugin.registerRoutes({ app: this.server.app });
                }
                
                // Store the plugin with its hash
                this.plugins.set(pluginName, { 
                    instance: plugin, 
                    routes: registeredRoutes, 
                    hash: pluginHash,
                    path: tempPath 
                });
                
                console.log(`Plugin ${pluginName} loaded successfully from Redis.`);
                
            } catch (error) {
                console.error(`Failed to load plugin ${pluginName}:`, error);
                
                // Clean up the temp file if loading failed
                try {
                    if (fs.existsSync(tempPath)) {
                        fs.unlinkSync(tempPath);
                        this.tempFiles.delete(tempPath);
                    }
                } catch (cleanupError) {
                    console.error(`Failed to clean up temp file ${tempPath}:`, cleanupError);
                }
                
                throw error;
            }
        } catch (error) {
            console.error(`Failed to load plugin ${pluginName} from Redis:`, error);
        }
    }

    /**
     * Validate that a plugin has the required methods
     * @param {Object} plugin - The plugin to validate
     * @returns {boolean} - Whether the plugin is valid
     */
    validatePlugin(plugin) {
        const requiredMethods = ['initialize'];
        return requiredMethods.every((method) => typeof plugin[method] === 'function');
    }

    /**
     * Generate a hash of the plugin code
     * @param {string} code - The plugin code
     * @returns {string} - SHA256 hash of the code
     */
    getHash(code) {
        return crypto.createHash('sha256').update(code, 'utf8').digest('hex');
    }

    /**
     * Clean up resources used by the plugin manager
     */
    close() {
        // Unload all plugins to clean up their resources
        Array.from(this.plugins.keys()).forEach(pluginName => {
            this.unloadPlugin(pluginName, false);
        });
        
        // Clean up any remaining temp files
        if (this.tempFiles) {
            this.tempFiles.forEach(filePath => {
                try {
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                } catch (error) {
                    console.error(`Failed to clean up temp file ${filePath}:`, error);
                }
            });
            this.tempFiles.clear();
        }
        
        // If we've subscribed to plugin events, unsubscribe
        if (this.pluginSubscription) {
            this.pluginSubscription.unsubscribe();
        }
        
        // Close Redis connections properly
        if (this.publisherRedis) {
            this.publisherRedis.quit().catch(err => {
                console.error('Error closing publisher Redis connection:', err);
            });
        }
        
        if (this.subscriberRedis) {
            this.subscriberRedis.quit().catch(err => {
                console.error('Error closing subscriber Redis connection:', err);
            });
        }
    }
}

/**
 * Helper function to load and broadcast a plugin in network mode
 * @param {string} pluginName - Name of plugin to load
 * @param {string} pluginPath - Path to the plugin file
 * @param {Object} pluginConfig - Configuration for the plugin
 * @returns {Promise<void>}
 */
async function loadAndBroadcastPluginNetwork(pluginName, pluginPath, pluginConfig) {
    console.log(`Using network plugin manager to load and broadcast plugin: ${pluginName} in cluster: ${CLUSTER_NAME}`);
    try {
        const fs = require('fs');
        const { promisify } = require('util');
        const readFile = promisify(fs.readFile);
        const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

        const pluginCode = await readFile(pluginPath, 'utf-8');

        // Store plugin code and config in Redis with cluster isolation
        await redis.hset(`${PLUGIN_FILE_PREFIX}${pluginName}`, {
            code: Buffer.from(pluginCode).toString('base64'), // Encode the plugin code
            config: JSON.stringify(pluginConfig),
        });

        // Publish an update message to the cluster-specific Redis Pub/Sub channel
        await redis.publish(PLUGIN_UPDATE_CHANNEL, JSON.stringify({ name: pluginName }));
        console.log(`Plugin "${pluginName}" broadcasted successfully in cluster "${CLUSTER_NAME}".`);
        
        // Clean up Redis connection
        redis.quit().catch(err => {
            console.error('Error closing Redis connection:', err);
        });
    } catch (err) {
        console.error(`Error broadcasting plugin "${pluginName}" in cluster "${CLUSTER_NAME}":`, err);
    }
}

/**
 * Auto-load plugins from a configuration file
 * @param {PluginManager} pluginManager - Instance of the plugin manager
 */
function autoloadPlugins(pluginManager) {
    const configDir = process.env.CONFIG_DIR || path.join(process.cwd(), 'config');
    const configFilePath = path.join(configDir, 'plugins.json'); // File containing plugins to load

    try {
        if (!fs.existsSync(configFilePath)) {
            console.warn(`Plugin configuration file not found at ${configFilePath}. No plugins will be loaded.`);
            return;
        }

        const pluginList = JSON.parse(fs.readFileSync(configFilePath, 'utf-8'));

        if (!Array.isArray(pluginList)) {
            console.error(`Invalid plugin configuration format. Expected an array of plugin names.`);
            return;
        }

        pluginList.forEach((pluginName) => {
            try {
                pluginManager.loadPlugin(pluginName);
                console.log(`Plugin ${pluginName} loaded successfully.`);
            } catch (error) {
                console.error(`Failed to load plugin ${pluginName}: ${error.message}`);
            }
        });
    } catch (error) {
        console.error(`Error reading or parsing plugin configuration file: ${error.message}`);
    }
}

module.exports = {
    PluginManager,
    loadAndBroadcastPluginNetwork,
    autoloadPlugins
};