/**
 * DependencyManager - Manages dependencies for the application and plugins
 * Responsible for providing the dependencies to plugins and maintaining a global context
 */
const { globalContext } = require('./context');
const path = require('path');
const fs = require('fs');

class DependencyManager {
    constructor() {
        this.dependencies = {};
        this.context = globalContext;
        this.rootDir = process.cwd();
        this.serverDir = path.join(this.rootDir, 'src');
        this.modulesDir = path.join(this.serverDir, 'modules');
    }

    /**
     * Set custom directory paths
     * @param {Object} paths - Object containing custom paths
     * @param {string} [paths.rootDir] - Custom root directory path
     * @param {string} [paths.serverDir] - Custom server directory path
     * @param {string} [paths.modulesDir] - Custom modules directory path
     */
    setPaths(paths = {}) {
        if (paths.rootDir) this.rootDir = paths.rootDir;
        if (paths.serverDir) this.serverDir = paths.serverDir;
        if (paths.modulesDir) this.modulesDir = paths.modulesDir;
    }

    /**
     * Load a module by name 
     * @param {string} moduleName - Name of the module to load
     * @returns {Object} The loaded module
     */
       loadModule(moduleName) {
        try {
            // Special case to handle legacy plugin patterns like '../src/middleware/authenticationMiddleware'
               if (moduleName.includes('../src/')) {
                // Fix the path to be relative to the project root
                const fixedPath = moduleName.replace('../', '../../');               
                try {
                    return require(fixedPath);
                } catch (specialError) {
                    console.log(`Note: Could not load ${fixedModulePath}, trying alternative paths`);
                    // If this fails, we'll continue with other resolution methods
                }
            }
            
            // Check if this is a relative path (starts with ./ or ../)
            if (moduleName.startsWith('./') || moduleName.startsWith('../')) {
                // Resolve the path relative to the server directory
                const modulePath = path.resolve(this.serverDir, moduleName);
                return require(modulePath);
            }
            
            // Check if this is referring to a local module in src/modules
            try {
                const localModulePath = path.join(this.modulesDir, moduleName);
                if (fs.existsSync(localModulePath) || fs.existsSync(`${localModulePath}.js`)) {
                    return require(localModulePath);
                }
            } catch (error) {
                // Continue to next approach if this fails
            }
            
            // Check if this is a local module in node_modules
            try {
                // Try to load from project root's node_modules
                const rootNodeModulesPath = path.join(this.rootDir, 'node_modules', moduleName);
                if (fs.existsSync(rootNodeModulesPath)) {
                    return require(rootNodeModulesPath);
                }
                
                // Then try to load from server's node_modules
                const serverNodeModulesPath = path.join(this.serverDir, 'node_modules', moduleName);
                if (fs.existsSync(serverNodeModulesPath)) {
                    return require(serverNodeModulesPath);
                }
            } catch (error) {
                // Continue to next approach if this fails
            }
            
            // If all else fails, use the standard require which will search up the directory tree
            return require(moduleName);
        } catch (error) {
            console.error(`Error loading module ${moduleName}:`, error);
            throw new Error(`Failed to load module: ${moduleName}`);
        }
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