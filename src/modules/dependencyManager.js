/**
 * DependencyManager - Manages dependencies for the application and plugins
 * Responsible for providing the dependencies to plugins and maintaining a global context
 */
const { globalContext } = require('./context');

class DependencyManager {
    constructor() {
        this.dependencies = {};
        this.context = globalContext; 
    }

    /**
     * Load a module by name 
     * @param {string} moduleName - Name of the module to load
     * @returns {Object} The loaded module
     */
    loadModule(moduleName) {
        // Maybe do some logic to point to your server's node_modules
        return require(moduleName);
    }

    /**
     * Add a dependency to the manager
     * @param {string} name - Name of the dependency
     * @param {*} instance - Instance of the dependency
     */
    addDependency(name, instance) {
        this.dependencies[name] = instance;
    }

    /**
     * Get all registered dependencies
     * @returns {Object} Object containing all dependencies and context
     */
    getDependencies() {
        return { 
            ...this.dependencies, 
            context: this.context, 
            customRequire: this.loadModule, 
            process: process 
        };
    }

    /**
     * Extend the global context with a new value
     * @param {string} key - Key for the new context value
     * @param {*} value - Value to add to context
     */
    extendContext(key, value) {
        this.context[key] = value;
    }
}

module.exports = DependencyManager;     