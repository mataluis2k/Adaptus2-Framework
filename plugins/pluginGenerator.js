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
        const logger = customRequire('../src/modules/logger');
        const vm = customRequire('vm');

        if (!context || !context.app || !customRequire) {
            throw new Error('INVALID_DEPENDENCIES: context.app and customRequire are required');
        }
        const app = context.app;
        const dbConfig = context.dbConfig;
        const pluginManager = context.pluginManager;
        const UniversalApiClient = customRequire('../src/modules/universalAPIClient');

        // Store query function and utilities for use in other methods
        this.query = query;
        this.redisClient = redisClient;
        this.logger = logger;
        this.vm = vm;

        logger.info('Initializing pluginGenerator...');

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
                const { prompt } = req.body || {};
                if (typeof prompt !== 'string' || !prompt.trim()) {
                    return res.status(400).json({ errorCode: 'INVALID_PROMPT', message: 'Prompt must be a non-empty string.' });
                }

                const tableSchemas = await this.getTableSchemas(dbConfig);
                const actions = Object.keys(context.actions);
                const pluginNames = pluginManager ? Array.from(pluginManager.plugins.keys()) : [];
                const apiConfig = context.apiConfig || [];

                const attemptGeneration = async (userPrompt, attempt = 0, errors = []) => {
                    let systemPrompt = this.buildPluginPrompt({ actions, plugins: pluginNames, schemas: tableSchemas, apiConfig });
                    if (attempt > 0 && errors.length) {
                        systemPrompt += `\nPrevious attempt failed validation: ${errors.join(', ')}. Please correct these issues and return only valid JavaScript.`;
                    }

                    const llm = await llmModule.getLLMInstance('llama3');
                    const messages = [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ];

                    const raw = await llm.call(messages);
                    logger.info('LLM Response:', JSON.stringify(raw, null, 2));
                    const code = this.extractCodeFromResponse(raw);
                    const validation = this.validatePluginCode(code);

                    if (!validation.valid && attempt < 1) {
                        logger.warn('Plugin validation failed', validation.errors);
                        return attemptGeneration(userPrompt, attempt + 1, validation.errors);
                    }

                    return { code, validation };
                };

                const { code, validation } = await attemptGeneration(prompt);

                if (!validation.valid) {
                    return res.status(400).json({ errorCode: 'INVALID_PLUGIN', errors: validation.errors });
                }

                res.json({ success: true, code });
            } catch (err) {
                logger.error('Error generating plugin:', err);
                res.status(500).json({ errorCode: 'GENERATION_FAILED', message: err.message });
            }
        });

        /**
         * POST /api/save-plugin
         * Saves a plugin file and loads it into memory using pluginManager
         */
        app.post('/api/save-plugin', middleware, async (req, res) => {
            try {
                const { pluginName, pluginCode } = req.body || {};
                if (typeof pluginName !== 'string' || !pluginName.trim() || typeof pluginCode !== 'string' || !pluginCode.trim()) {
                    return res.status(400).json({ errorCode: 'INVALID_INPUT', message: 'pluginName and pluginCode are required.' });
                }

                const validation = this.validatePluginCode(pluginCode);
                if (!validation.valid) {
                    return res.status(400).json({ errorCode: 'INVALID_PLUGIN', errors: validation.errors });
                }

                const filePath = path.join(__dirname, `../plugins/${pluginName}.js`);
                fs.writeFileSync(filePath, pluginCode, 'utf8');

                const result = await pluginManager.loadPlugin(pluginName);
                logger.info(`Plugin ${pluginName} loaded into memory.`);

                res.json({ success: true, message: `Plugin ${pluginName} saved and loaded.`, loadResult: result });
            } catch (err) {
                logger.error('Error saving/loading plugin:', err);
                res.status(500).json({ errorCode: 'SAVE_FAILED', message: err.message });
            }
        });

        logger.info('pluginGenerator registered /api/generate-plugin and /api/save-plugin');
    },

    /**
     * Build detailed prompt for LLM
     */
    buildPluginPrompt({ actions, plugins, schemas, apiConfig }) {
        const examples = `
/* Example Plugin 1 */
module.exports = {
    name: 'helloWorld',
    version: '1.0.0',
    initialize(dependencies) {
        const { context } = dependencies;
        if (!context || !context.actions) throw new Error('Context with actions is required.');
        async function helloWorld(ctx, params) {
            if (!params || !params.name) throw new Error('Missing name parameter');
            return { greeting: \`Hello ${params.name}\` };
        }
        if (!context.actions.helloWorld) context.actions.helloWorld = helloWorld;
    },
};

/* Example Plugin 2 */
module.exports = {
    name: 'externalApi',
    version: '1.0.0',
    initialize(dependencies) {
        const { context, customRequire } = dependencies;
        const UniversalApiClient = customRequire('../src/modules/universalAPIClient');
        if (!context || !context.actions) throw new Error('Context with actions is required.');
        async function fetchData(ctx, params) {
            const apiKey = ctx.config.myServiceKey || process.env.MY_SERVICE_KEY;
            if (!apiKey) throw new Error('Missing MY_SERVICE_KEY configuration');
            try {
                const client = new UniversalApiClient({ baseUrl: 'https://api.example.com', authType: 'apiKey', authValue: apiKey });
                return await client.get('/resource', params);
            } catch (error) {
                throw new Error('Failed to fetch data: ' + error.message);
            }
        }
        if (!context.actions.fetchData) context.actions.fetchData = fetchData;
    },
};
`;
        return `
You are an expert developer building modular plugins for a Node.js server framework.

Instructions: Return ONLY JavaScript code. Do not include markdown or explanations. Follow the blueprint below and use try/catch for async logic.

${examples}

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
     * Extract JavaScript code from various LLM response formats
     * @param {any} response - Raw response from the LLM
     * @returns {string} - Extracted JavaScript code
     */
    extractCodeFromResponse(response) {
        let content = '';
        if (typeof response === 'string') {
            content = response;
        } else if (response && response.kwargs && response.kwargs.content) {
            content = response.kwargs.content;
        } else if (response && response.content) {
            content = response.content;
        }

        content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

        const codeBlocks = [];
        const blockRegex = /```(?:javascript)?\n([\s\S]*?)```/g;
        let match;
        while ((match = blockRegex.exec(content)) !== null) {
            codeBlocks.push(match[1]);
        }
        if (codeBlocks.length > 0) {
            return codeBlocks.join('\n');
        }
        return content;
    },

    /**
     * Validate generated plugin code for structure and security
     * @param {string} code - Code string to validate
     * @returns {{valid:boolean, errors:string[]}}
     */
    validatePluginCode(code) {
        const errors = [];
        if (!code || typeof code !== 'string') {
            return { valid: false, errors: ['EMPTY_CODE'] };
        }

        try {
            new this.vm.Script(code);
        } catch (err) {
            errors.push('SYNTAX_ERROR: ' + err.message);
            return { valid: false, errors };
        }

        const sandbox = { module: { exports: {} }, exports: {} };
        try {
            this.vm.runInNewContext(code, sandbox, { timeout: 1000 });
        } catch (err) {
            errors.push('EXECUTION_ERROR: ' + err.message);
            return { valid: false, errors };
        }

        const plugin = sandbox.module.exports;
        if (!plugin || typeof plugin !== 'object') {
            errors.push('NO_EXPORT_OBJECT');
        } else {
            if (!plugin.name) errors.push('MISSING_EXPORT_NAME');
            if (!plugin.version) errors.push('MISSING_EXPORT_VERSION');
            if (typeof plugin.initialize !== 'function') {
                errors.push('MISSING_INITIALIZE');
            } else if (!/try\s*{[\s\S]*catch\s*\(/.test(plugin.initialize.toString())) {
                errors.push('INITIALIZE_NO_TRY_CATCH');
            }
        }

        if (/eval\s*\(/.test(code)) {
            errors.push('USES_EVAL');
        }
        if (/(api[_-]?key|password)\s*[:=]/i.test(code)) {
            errors.push('HARDCODED_CREDENTIALS');
        }

        return { valid: errors.length === 0, errors };
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


