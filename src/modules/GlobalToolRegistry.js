/**
 * GlobalToolRegistry.js
 * 
 * A centralized registry for all tools across the system.
 * Allows dynamic registration and discovery of tools.
 * Integrates with existing modules and context system.
 */

const { globalContext } = require('./context');

class GlobalToolRegistry {
    constructor() {
        this.tools = {};
        this.categories = {};
        this.moduleTools = {};
        
        // Initialize the registry in global context if not already there
        if (!globalContext.toolRegistry) {
            globalContext.toolRegistry = this;
        }
        
        console.log('[GlobalToolRegistry] Initialized');
    }
    
    /**
     * Register a tool with the registry
     * 
     * @param {Object} toolObj - The tool object with name, description, execute method
     * @param {string} category - Category for organizing tools
     * @param {string} moduleName - Name of the module that owns this tool
     * @returns {Object} - The registered tool
     */
    registerTool(toolObj, category = 'general', moduleName = 'system') {
        if (!toolObj || !toolObj.name || typeof toolObj.execute !== 'function') {
            throw new Error('Invalid tool object. Must have name and execute method');
        }
        
        const toolName = toolObj.name.toLowerCase();
        
        // Create standardized tool interface
        const standardizedTool = {
            name: toolName,
            description: toolObj.description || `Tool: ${toolName}`,
            category: category,
            module: moduleName,
            execute: toolObj.execute,
            schema: toolObj.schema || null,
            requiresAuth: toolObj.requiresAuth || false,
            requiresContext: toolObj.requiresContext || false,
            metadata: toolObj.metadata || {}
        };
        
        // Register the tool
        this.tools[toolName] = standardizedTool;
        
        // Add to category index
        if (!this.categories[category]) {
            this.categories[category] = [];
        }
        this.categories[category].push(toolName);
        
        // Add to module index
        if (!this.moduleTools[moduleName]) {
            this.moduleTools[moduleName] = [];
        }
        this.moduleTools[moduleName].push(toolName);
        
        console.log(`[GlobalToolRegistry] Registered tool: ${toolName} (${category})`);
        return standardizedTool;
    }
    
    /**
     * Convert an existing function into a tool and register it
     * 
     * @param {Function} func - The function to convert to a tool
     * @param {Object} options - Configuration options
     * @param {string} options.name - Tool name (defaults to function name)
     * @param {string} options.description - Tool description
     * @param {string} options.category - Tool category
     * @param {string} options.moduleName - Module name
     * @param {Object} options.schema - Parameter schema
     * @returns {Object} - The registered tool
     */
    functionToTool(func, options = {}) {
        if (typeof func !== 'function') {
            throw new Error('First argument must be a function');
        }
        
        const toolName = options.name || func.name;
        if (!toolName) {
            throw new Error('Tool must have a name. Either use a named function or provide name in options');
        }
        
        const toolObj = {
            name: toolName,
            description: options.description || `Tool for ${toolName}`,
            schema: options.schema || null,
            execute: async (params) => {
                try {
                    return await func(params);
                } catch (error) {
                    console.error(`[Tool:${toolName}] Execution error:`, error);
                    throw error;
                }
            },
            requiresAuth: options.requiresAuth || false,
            requiresContext: options.requiresContext || false,
            metadata: options.metadata || {}
        };
        
        return this.registerTool(
            toolObj, 
            options.category || 'general', 
            options.moduleName || 'system'
        );
    }
    
    /**
     * Register multiple tools from a module at once
     * 
     * @param {Array} tools - Array of tool objects to register
     * @param {string} category - Category for all tools
     * @param {string} moduleName - Name of the module
     * @returns {Array} - Array of registered tools
     */
    registerModuleTools(tools, category = 'general', moduleName = 'system') {
        if (!Array.isArray(tools)) {
            throw new Error('Tools must be an array');
        }
        
        const registeredTools = [];
        for (const tool of tools) {
            registeredTools.push(this.registerTool(tool, category, moduleName));
        }
        
        console.log(`[GlobalToolRegistry] Registered ${registeredTools.length} tools from module ${moduleName}`);
        return registeredTools;
    }
    
    /**
     * Import tools from a module that implements a standard interface
     * 
     * @param {Object} module - Module with tools
     * @param {string} category - Default category
     * @param {string} moduleName - Module name
     * @returns {Array} - Array of registered tools
     */
    importFromModule(module, category = null, moduleName = null) {
        // Try to determine module name and category if not provided
        const actualModuleName = moduleName || module.name || 'unknown_module';
        const actualCategory = category || module.defaultCategory || actualModuleName;
        
        let toolsToRegister = [];
        
        // Check for different possible tool exports
        if (Array.isArray(module.tools)) {
            toolsToRegister = module.tools;
        } else if (Array.isArray(module.customerSupportTools)) {
            toolsToRegister = module.customerSupportTools;
            
            // If module is customerSupportModule, use customer_support category
            if (!category && actualModuleName.includes('customerSupport')) {
                category = 'customer_support';
            }
        } else if (typeof module.getTools === 'function') {
            toolsToRegister = module.getTools();
        } else {
            // Look for objects that might be tools
            for (const [key, value] of Object.entries(module)) {
                if (typeof value === 'object' && value !== null && 
                    typeof value.name === 'string' && 
                    typeof value.func === 'function') {
                    // Convert DynamicTool format to our standard format
                    toolsToRegister.push({
                        name: value.name,
                        description: value.description,
                        execute: value.func
                    });
                }
            }
        }
        
        if (toolsToRegister.length === 0) {
            console.warn(`[GlobalToolRegistry] No tools found in module ${actualModuleName}`);
            return [];
        }
        
        return this.registerModuleTools(toolsToRegister, actualCategory, actualModuleName);
    }
    
    /**
     * Register functions from a module as tools
     * Similar to how the CodeReviewPlugin.js works
     * 
     * @param {Object} module - Module with functions to convert to tools
     * @param {Object} options - Options for tool creation
     * @returns {Array} - Array of registered tools
     */
    registerModuleFunctions(module, options = {}) {
        const { 
            category = 'general', 
            moduleName = module.name || 'unknown_module',
            includePrivate = false,
            functionPrefix = '',
            descriptionGenerator = null
        } = options;
        
        const tools = [];
        
        // Get all functions from the module
        for (const [key, value] of Object.entries(module)) {
            // Skip if not a function or if private (starts with _) and includePrivate is false
            if (typeof value !== 'function' || (!includePrivate && key.startsWith('_'))) {
                continue;
            }
            
            // Skip constructor, registerActions methods
            if (['constructor', 'registerActions'].includes(key)) {
                continue;
            }
            
            // Create a description either using the generator or a default
            const description = typeof descriptionGenerator === 'function' 
                ? descriptionGenerator(key, value)
                : `${key} function from ${moduleName} module`;
            
            // Create the tool name with optional prefix
            const toolName = functionPrefix ? `${functionPrefix}_${key}` : key;
            
            // Convert the function to a tool
            const tool = this.functionToTool(value, {
                name: toolName,
                description,
                category,
                moduleName
            });
            
            tools.push(tool);
        }
        
        console.log(`[GlobalToolRegistry] Registered ${tools.length} functions from module ${moduleName}`);
        return tools;
    }
    
    /**
     * Get a tool by name
     * 
     * @param {string} toolName - Name of the tool to retrieve
     * @returns {Object|null} - The tool object or null if not found
     */
    getTool(toolName) {
        return this.tools[toolName.toLowerCase()] || null;
    }
    
    /**
     * Get all tools
     * 
     * @returns {Object} - Map of all tools
     */
    getAllTools() {
        return this.tools;
    }
    
    /**
     * Get tools by category
     * 
     * @param {string} category - Category name
     * @returns {Array} - Array of tools in the category
     */
    getToolsByCategory(category) {
        const toolNames = this.categories[category] || [];
        return toolNames.map(name => this.tools[name]);
    }
    
    /**
     * Get tools by module name
     * 
     * @param {string} moduleName - Module name
     * @returns {Array} - Array of tools from the module
     */
    getToolsByModule(moduleName) {
        const toolNames = this.moduleTools[moduleName] || [];
        return toolNames.map(name => this.tools[name]);
    }
    
    /**
     * Check if a persona has access to a specific tool
     * 
     * @param {string} personaName - Name of the persona
     * @param {string} toolName - Name of the tool
     * @param {Object} personasConfig - Configuration of personas
     * @returns {boolean} - True if the persona has access to the tool
     */
    isToolAllowedForPersona(personaName, toolName, personasConfig) {
        if (!personasConfig || !personasConfig[personaName]) {
            return false;
        }
        
        const persona = personasConfig[personaName];
        if (!persona.tools || !Array.isArray(persona.tools)) {
            return false;
        }
        
        return persona.tools.some(
            allowedTool => allowedTool.toLowerCase() === toolName.toLowerCase()
        );
    }
    
    /**
     * Get all tools available to a specific persona
     * 
     * @param {string} personaName - Name of the persona
     * @param {Object} personasConfig - Configuration of personas
     * @returns {Array} - Array of tools available to the persona
     */
    getToolsForPersona(personaName, personasConfig) {
        if (!personasConfig || !personasConfig[personaName]) {
            return [];
        }
        
        const persona = personasConfig[personaName];
        if (!persona.tools || !Array.isArray(persona.tools)) {
            return [];
        }
        
        return persona.tools
            .map(toolName => this.getTool(toolName))
            .filter(tool => tool !== null);
    }
    
    /**
     * Execute a tool by name
     * 
     * @param {string} toolName - Name of the tool to execute
     * @param {Object} params - Parameters to pass to the tool
     * @param {Object} options - Additional options
     * @returns {Promise<any>} - Result of the tool execution
     */
    async executeTool(toolName, params = {}, options = {}) {
        const tool = this.getTool(toolName);
        if (!tool) {
            throw new Error(`Tool not found: ${toolName}`);
        }
        
        // If tool requires auth, check if auth is provided
        if (tool.requiresAuth && !options.auth) {
            throw new Error(`Tool ${toolName} requires authentication`);
        }
        
        try {
            return await tool.execute(params, options);
        } catch (error) {
            console.error(`[GlobalToolRegistry] Error executing tool ${toolName}:`, error);
            throw error;
        }
    }
}

// Create and export a singleton instance
const toolRegistry = new GlobalToolRegistry();

module.exports = toolRegistry;