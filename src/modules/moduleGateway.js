/**
 * ModuleGateway - Manages conditional module loading based on dependencies
 * This system ensures modules that depend on llmModule are only loaded when llmModule is available
 */

class ModuleGateway {
    constructor() {
        this.enabledModules = new Set();
        this.disabledModules = new Set();
        this.llmDependentModules = new Set([
            'IntelligentChatModule',
            'MessageRouter',
            'agentWorkflowManager',
            'ResponseStrategy',
            'reportBuilderModule',
            'customerSupportModule',
            'chatModule',
            'mealPlanGenerator',
            'ragHandler1'
        ]);
        this.llmDependentPlugins = new Set([
            'pluginGenerator',
            'smartPlugin'
        ]);
        this.moduleCache = new Map();
    }

    /**
     * Checks if llmModule is available and properly configured
     * @returns {boolean} true if llmModule is available
     */
    isLLMModuleAvailable() {
    try {
        // First check if global.llmModule is set and enabled
        if (global.llmModule !== undefined && global.llmModule !== null) {
            // If we have a global reference, check if it's actually enabled
            if (global.llmModule.isModuleEnabled && typeof global.llmModule.isModuleEnabled === 'function') {
                return global.llmModule.isModuleEnabled();
            }
            // If no isModuleEnabled method, assume it's available if not null
            return true;
        }
        
        // Fallback to checking the module directly
        // Clear require cache to get fresh module state
        delete require.cache[require.resolve('./llmModule')];
        const llmModule = require('./llmModule');
        
        if (llmModule) {
            // Update global reference if module is now available
            if (llmModule.isModuleEnabled && llmModule.isModuleEnabled()) {
                global.llmModule = llmModule;
                return true;
            }
        }
        
        return false;
    } catch (error) {
        console.warn('Could not check llmModule availability:', error.message);
        return false;
    }
}

    /**
     * Safely loads a module with dependency checking
     * @param {string} moduleName - Name of the module to load
     * @param {string} modulePath - Path to the module
     * @param {Object} options - Loading options
     * @returns {Object|null} Loaded module or null if dependencies not met
     */
    safeLoadModule(moduleName, modulePath, options = {}) {
        // Check if module is cached
        if (this.moduleCache.has(moduleName)) {
            const cached = this.moduleCache.get(moduleName);
            if (cached.success) {
                return cached.module;
            } else {
                console.warn(`⚠️  Module ${moduleName} previously failed to load due to dependencies`);
                return null;
            }
        }

        // Check if module depends on llmModule
        if (this.llmDependentModules.has(moduleName)) {
            // Clear cache entry to force re-evaluation
            this.moduleCache.delete(moduleName);
            
            if (!this.isLLMModuleAvailable()) {
                console.warn(`⚠️  Module ${moduleName} disabled: depends on llmModule which is not available`);
                this.disabledModules.add(moduleName);
                return null;
            }
        }

        // Attempt to load the module
        try {
            const module = require(modulePath);
            console.log(`✅ Module ${moduleName} loaded successfully`);
            this.enabledModules.add(moduleName);
            this.disabledModules.delete(moduleName); // Remove from disabled if it was there
            this.moduleCache.set(moduleName, { success: true, module });
            return module;
        } catch (error) {
            console.error(`❌ Failed to load module ${moduleName}:`, error.message);
            this.disabledModules.add(moduleName);
            this.moduleCache.set(moduleName, { success: false, reason: error.message });
            return null;
        }
    }

    /**
     * Checks if a plugin can be loaded based on its dependencies
     * @param {string} pluginName - Name of the plugin
     * @param {Object} plugin - Plugin object to validate
     * @returns {boolean} true if plugin can be loaded
     */
    canLoadPlugin(pluginName, plugin = null) {
        // Check if plugin depends on llmModule
        if (this.llmDependentPlugins.has(pluginName)) {
            if (!this.isLLMModuleAvailable()) {
                console.warn(`⚠️  Plugin ${pluginName} cannot be loaded: depends on llmModule which is not available`);
                return false;
            }
        }

        // Additional plugin validation can be added here
        // For example, checking if plugin uses llmModule in its code
        if (plugin && this.pluginUsesLLM(plugin)) {
            if (!this.isLLMModuleAvailable()) {
                console.warn(`⚠️  Plugin ${pluginName} cannot be loaded: uses LLM functionality but llmModule is not available`);
                return false;
            }
        }

        return true;
    }

    /**
     * Analyzes plugin code to detect llmModule usage
     * @param {Object} plugin - Plugin object to analyze
     * @returns {boolean} true if plugin uses llmModule
     */
    pluginUsesLLM(plugin) {
        try {
            // Convert plugin to string to analyze its code
            const pluginString = plugin.toString();
            
            // Check for common llmModule usage patterns
            const llmPatterns = [
                'llmModule',
                'global.llmModule',
                'require.*llmModule',
                'processMessage',
                'callLLM',
                'getLLMInstance',
                'selectPersona',
                'detectRequestedPersona'
            ];

            return llmPatterns.some(pattern => {
                const regex = new RegExp(pattern, 'i');
                return regex.test(pluginString);
            });
        } catch (error) {
            // If we can't analyze the plugin, err on the side of caution
            console.warn(`Could not analyze plugin for LLM usage:`, error.message);
            return false;
        }
    }

    /**
     * Gets the status of all modules
     * @returns {Object} Status object with enabled and disabled modules
     */
    getModuleStatus() {
        return {
            llmModuleAvailable: this.isLLMModuleAvailable(),
            enabledModules: Array.from(this.enabledModules),
            disabledModules: Array.from(this.disabledModules),
            llmDependentModules: Array.from(this.llmDependentModules),
            llmDependentPlugins: Array.from(this.llmDependentPlugins)
        };
    }

    /**
     * Creates a safe require function that respects dependencies
     * @param {string} basePath - Base path for relative requires
     * @returns {Function} Safe require function
     */
    createSafeRequire(basePath = '') {
        return (modulePath, moduleName) => {
            const fullPath = basePath ? require('path').join(basePath, modulePath) : modulePath;
            const name = moduleName || require('path').basename(modulePath, '.js');
            return this.safeLoadModule(name, fullPath);
        };
    }

    /**
     * Clears the module cache - useful for testing or reloading
     */
    clearCache() {
        this.moduleCache.clear();
        this.enabledModules.clear();
        this.disabledModules.clear();
        console.log('Module cache cleared');
    }
}

// Create singleton instance
const moduleGateway = new ModuleGateway();

module.exports = moduleGateway;