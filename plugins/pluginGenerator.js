module.exports = {
    name: 'pluginGenerator',
    version: '1.0.0',

    /**
     * Initializes the plugin and registers endpoints.
     * @param {Object} dependencies - Provided by server.
     */
    initialize(dependencies) {
        const { context, customRequire, process } = dependencies;
        const fs = customRequire('fs');
        const path = customRequire('path');
        const express = customRequire('express');
        const { read, query } = customRequire('../src/modules/db');
        const llmModule = customRequire('../src/modules/llmModule');
        const { redisClient } = customRequire('../src/modules/redisClient');
        const app = context.app;
        const dbConfig = context.dbConfig;
        const pluginManager = context.pluginManager;
        const UniversalApiClient = customRequire('../src/modules/universalAPIClient');

        // Store query function for use in methods
        this.query = query;
        // Store redisClient for use in methods
        this.redisClient = redisClient;

        if (!app || !pluginManager) {
            throw new Error('Express app and plugin manager are required for pluginGenerator.');
        }

        const { aarMiddleware } = customRequire('../src/middleware/aarMiddleware');
        const middleware = aarMiddleware(true, ['publicAccess'], app.locals.ruleEngineMiddleware);

        /**
         * POST /api/generate-plugin
         * Generates a plugin using LLM based on userPrompt
         */
        app.post('/api/generate-plugin', async (req, res) => {
            try {
                const { prompt } = req.body;
                if (!prompt) return res.status(400).json({ error: 'Missing userPrompt' });

                const tableSchemas = await this.getTableSchemas(dbConfig);
                const actions = Object.keys(context.actions);
                const pluginNames = pluginManager ? Array.from(pluginManager.plugins.keys()) : [];
                const apiConfig = context.apiConfig || [];

                const prompt1 = this.buildPluginPrompt({
                    actions,
                    plugins: pluginNames,
                    schemas: tableSchemas,
                    apiConfig,
                });

                console.log(prompt1);
                const llm = await llmModule.getLLMInstance('llama3');
                const messages = [
                    { role: 'system', content: prompt1 },
                    { role: 'user', content: prompt }
                ];
                let result = await llm.call(messages);

                // Extract code from the response
                console.log('LLM Response:', JSON.stringify(result, null, 2));
                let code = "";
                try {
                    // Handle the response object
                    if (result && result.kwargs && result.kwargs.content) {
                        // Remove the think section if it exists
                        let content = result.kwargs.content;
                        const thinkMatch = content.match(/<think>[\s\S]*?<\/think>/);
                        if (thinkMatch) {
                            content = content.replace(thinkMatch[0], '').trim();
                        }
                        
                        // Extract code blocks
                        const codeBlocks = content.match(/```[\s\S]*?```/g);
                        if (codeBlocks) {
                            code = codeBlocks.map(block => {
                                // Remove the language identifier and backticks
                                return block.replace(/```\w*\n/, '').replace(/```$/, '');
                            }).join('\n\n');
                        } else {
                            code = content;
                        }
                    } else if (typeof result === 'string') {
                        // Handle string response
                        const thinkMatch = result.match(/<think>[\s\S]*?<\/think>/);
                        if (thinkMatch) {
                            result = result.replace(thinkMatch[0], '').trim();
                        }
                        code = result;
                    }
                } catch (parseError) {
                    console.warn('Failed to parse LLM response:', parseError.message);
                    // If parsing fails, try to use the raw response
                    if (typeof result === 'string') {
                        code = result;
                    } else if (result && result.kwargs && result.kwargs.content) {
                        code = result.kwargs.content;
                    }
                }

                res.json({ 
                    success: true,
                    code: code // Send code directly at the top level
                });
            } catch (err) {
                console.error('Error generating plugin:', err.message);
                res.status(500).json({ error: err.message });
            }
        });

        /**
         * POST /api/save-plugin
         * Saves a plugin file and loads it into memory using pluginManager
         */
        app.post('/api/save-plugin', middleware, async (req, res) => {
            try {
                const { pluginName, pluginCode } = req.body;
                if (!pluginName || !pluginCode) {
                    return res.status(400).json({ error: 'Missing pluginName or pluginCode' });
                }

                const filePath = path.join(__dirname, `../plugins/${pluginName}.js`);
                fs.writeFileSync(filePath, pluginCode, 'utf8');

                const result = await pluginManager.loadPlugin(pluginName);
                console.log(`Plugin ${pluginName} loaded into memory.`);

                res.json({ success: true, message: `Plugin ${pluginName} saved and loaded.`, loadResult: result });
            } catch (err) {
                console.error('Error saving/loading plugin:', err.message);
                res.status(500).json({ error: err.message });
            }
        });

        console.log('pluginGenerator registered /api/generate-plugin and /api/save-plugin');
    },

    /**
     * Build detailed prompt for LLM
     */
    buildPluginPrompt({ actions, plugins, schemas, apiConfig }) {
        return `
You are an expert developer building modular plugins for a Node.js server framework.

Instructions for LLM to Create Server Plugins, YOU MUST WRITE IT IN JAVASCRIPT AND YOU MUST FOLLOW THE BLUEPRINT BELOW:

The goal of these instructions is to guide an LLM in producing server plugins based on a well-defined blueprint. These plugins should follow a standardized architecture, be production-ready, and integrate seamlessly into the server's existing ecosystem.

### Existing Actions available to use in the plugin:
${actions.join('\n')}

### Installed Plugins available to use in the plugin:
${plugins.join('\n')}

### Table Schemas available to use in the plugin:
${schemas}

### API Config available to use in the plugin:
${JSON.stringify(apiConfig, null, 2)}
---
### Dependecies available to plugins: 
 getDependencies() {
        return { ...this.dependencies, context: this.context , customRequire: this.loadModule, process: process };
 }

### Modules available for plugins to load using the customRequire function:

../src/modules/universalAPIClient  // Allows to make http request , replaces axios 
../src/modules/db   // Database ORM supporting mongo, mysql , postgresql , and snowflake
These are the methods available from the db module :
const  { getDbConnection, create, read, update, delete, query }= customRequire('./db'); // Adjust path to your db module
for example:
 create(config, entity, data);
 
 Where as: 
 config = {  dbType, dbConnection }
 entity = Name of the table to be used by the function
 data or query self explanatory


### **1. Plugin Blueprint**

Each plugin must follow this **blueprint** to ensure consistency:

#### **Plugin Structure**
\`\`\`javascript
module.exports = {
    name: '<pluginName>', // Unique plugin identifier
    version: '1.0.0', // Version of the plugin

    /**
     * Initialize the plugin and register actions in the global context.
     * @param {Object} dependencies - Dependencies provided by the server.
     */
    initialize(dependencies) {
        const { context, customRequire } = dependencies;
        const UniversalApiClient = customRequire('../src/modules/universalAPIClient');

        if (!context || !context.actions) {
            throw new Error('Global context with actions is required for <pluginName>.');
        }

        /**
         * Main function exposed by the plugin, registered in context.
         * @param {Object} ctx - Context object containing configuration.
         * @param {Object} params - Parameters for the operation.
         */
        async function <actionName>(ctx, params) {
            // Validate parameters
            if (!params || typeof params !== 'object') {
                throw new Error('Invalid parameters. Ensure params is a valid object.');
            }

            // Load configuration dynamically
            const requiredConfig = ctx.config.<requiredConfigKey> || process.env.<ENV_VARIABLE_NAME>;
            if (!requiredConfig) {
                throw new Error(
                    'Missing configuration. Ensure <requiredConfigKey> is set in context or environment variables.'
                );
            }

            try {
                 const someApiClient = new UniversalApiClient({
                    baseUrl: mailgunBaseUrl,
                    authType: 'apiKey',
                    authValue: 'api: mailgunApiKey',
                });
                // Perform the plugin's main logic
                // Example: Sending data to an external API
                const response = await someApiClient.post('<apiEndpoint>', params);
                console.log('<actionName> executed successfully:', response);

                return response; // Return result
            } catch (error) {
                console.error('Error in <actionName>:', error.message);
                throw new Error('Failed to execute <actionName>: error.message');
            }
        }

        // Register the function to the global context
        if (!context.actions.<actionName>) {
            context.actions.<actionName> = <actionName>;
        }

        console.log('<pluginName> action registered in global context.');
    },
};
\`\`\`

---

#### **Key Features of the Plugin Blueprint**
1. **Dynamic Configuration**:
   - Plugins must load configuration dynamically from  either 'ctx.config' or 'process.env' variables. This avoids hardcoding sensitive values and ensures flexibility across environments.

2. **Polymorphic Design**:
   - Plugins should accept parameters ('params') dynamically, allowing a single function to handle multiple use cases without duplicating code.

3. **Context Integration**:
   - IF plugin is extending businessRules actions then it must register its primary action(s) into 'context.actions' for integration with 'businessRules.dsl'.

4. **Error Handling**:
   - Validate inputs and configurations rigorously.
   - Provide meaningful error messages for missing configurations or invalid inputs.

5. **Reusability**:
   - Encapsulate all reusable logic in the plugin for easy extension and scalability.

---

### **2. Output Requirements**

The LLM must produce output that is **production-ready** and meets the following criteria:

#### **Code Requirements**
1. **Modularity**:
   - Each plugin must be self-contained, residing in 'src/plugins/<pluginName>.js'.
2. **Documentation**:
   - Provide clear, concise inline comments for each function and block of code.
3. **Security**:
   - Sensitive data (e.g., API keys) must be fetched from '.env' variables or the 'ctx.config' object.
4. **Error Handling**:
   - Use 'try-catch' blocks for all asynchronous operations.
   - Throw meaningful errors for invalid configurations or failed operations.

#### **Integration Instructions**
For each plugin, provide:
1. **Setup Instructions**:
   - Include a list of required environment variables and their descriptions.
2. **Usage in 'businessRules.dsl'**:
   - Provide examples of how to invoke the plugin's action in 'businessRules.dsl'.
3. **Dependency Information**:
   - List any external libraries (e.g., 'axios') required by the plugin and how to install them.

---

### **3. Detailed Instructions for Plugin Creation**

#### **Step 1: Define Plugin Metadata**
Start by defining the 'name' and 'version' of the plugin:

\`\`\`javascript
module.exports = {
    name: '<pluginName>',
    version: '1.0.0',
\`\`\`

#### **Step 2: Initialize Plugin**
- Use the 'initialize' method to register the plugin's action into 'context.actions'.
- Ensure 'dependencies.context' is available and log appropriate messages during initialization.

#### **Step 3: Main Plugin Logic**
- Define the primary function that will perform the plugin's operation.
- Use the 'ctx' parameter to dynamically load configuration values.
- Accept 'params' as the payload for polymorphic handling.

#### **Step 4: Register Plugin Action**
- Register the main function into 'context.actions' using a unique name.
- Validate that the action is not already registered to avoid conflicts.
`;
    },

    /**
     * Collect table schemas as text
     */
    async getTableSchemas(config) {
        console.log('getTableSchemas');
        
        // Generate a cache key based on the database configuration
        const cacheKey = `schema:${config.dbConnection || 'default'}`;
        
        try {
            // Try to get schema from cache first
            const cachedSchema = await this.redisClient.get(cacheKey);
            if (cachedSchema) {
                console.log('Retrieved schema from cache');
                return cachedSchema;
            }

            // If not in cache, fetch from database
            const tables = await this.query(config, 'SHOW TABLES');
            const schemaDetails = {};

            for (const row of tables) {
                const table = Object.values(row)[0];
                const cols = await this.query(config, `DESCRIBE \`${table}\``);
                schemaDetails[table] = cols.map(c => `${c.Field} (${c.Type})`).join(', ');
            }

            const schemaText = Object.entries(schemaDetails)
                .map(([table, cols]) => `${table}: ${cols}`)
                .join('\n');

            // Cache the schema for 1 hour (3600 seconds)
            await this.redisClient.set(cacheKey, schemaText, 'EX', 3600);
            console.log('Cached schema for 1 hour');

            return schemaText;
        } catch (error) {
            console.error('Error in getTableSchemas:', error);
            // If Redis fails, fall back to direct database query
            const tables = await this.query(config, 'SHOW TABLES');
            const schemaDetails = {};

            for (const row of tables) {
                const table = Object.values(row)[0];
                const cols = await this.query(config, `DESCRIBE \`${table}\``);
                schemaDetails[table] = cols.map(c => `${c.Field} (${c.Type})`).join(', ');
            }

            return Object.entries(schemaDetails)
                .map(([table, cols]) => `${table}: ${cols}`)
                .join('\n');
        }
    }
};


