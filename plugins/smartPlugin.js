const fs = require('fs');
const path = require('path');
const { query } = require('./db');
const llmModule = require('./llmModule');

module.exports = {
    name: 'smartPlugin',
    version: '1.0.0',

    initialize(dependencies) {
        const { context, customRequire } = dependencies;
        const app = context.expressApp;
        const dbConfig = context.dbConfig;
        const pluginManager = context.pluginManager;

        const AAR = customRequire('../middleware/aarMiddleware');
        const middleware = AAR('token', ['admin'], context.ruleEngine);

        /**
         * Endpoint: Analyze system & generate improvement plan
         */
        app.post('/api/smart-enhance', middleware, async (req, res) => {
            try {
                const schemaText = await getTableSchemas(dbConfig);
                const actions = Object.keys(context.actions);
                const plugins = pluginManager ? Array.from(pluginManager.plugins.keys()) : [];
                const apiConfig = context.apiConfig || [];

                const llm = await llmModule.getLLMInstance('llama3');

                const prompt = buildSystemAuditPrompt({ actions, plugins, schemaText, apiConfig });
                const messages = [
                    { role: 'system', content: 'You are an expert architect reviewing server systems for potential improvements.' },
                    { role: 'user', content: prompt }
                ];

                const result = await llm.call(messages);

                // Try to parse JSON response
                const jsonMatch = result.content?.match(/```json\s*([\s\S]*?)\s*```/) || result.content?.match(/```([\s\S]*?)```/);
                const jsonStr = jsonMatch ? jsonMatch[1] : result.content;
                const enhancements = JSON.parse(jsonStr.trim());

                // Save as file
                const filePath = path.join(__dirname, '../data/smartEnhancements.json');
                fs.writeFileSync(filePath, JSON.stringify(enhancements, null, 2), 'utf8');

                res.json({
                    message: 'Enhancement plan generated and saved.',
                    count: enhancements.length,
                    path: filePath,
                    data: enhancements
                });
            } catch (err) {
                console.error('Error in smart-enhance:', err.message);
                res.status(500).json({ error: err.message });
            }
        });

        app.post('/api/smart-execute', middleware, async (req, res) => {
            try {
                const filePath = path.join(__dirname, '../data/smartEnhancements.json');
                if (!fs.existsSync(filePath)) {
                    return res.status(404).json({ error: 'Enhancement list not found. Run /api/smart-enhance first.' });
                }

                const raw = fs.readFileSync(filePath, 'utf8');
                const enhancements = JSON.parse(raw);
                const updated = [];
                const llm = await llmModule.getLLMInstance('llama3');

                for (const task of enhancements) {
                    if (task.status === 'complete') {
                        updated.push(task);
                        continue;
                    }

                    const prompt = buildExecutorPrompt(task);
                    const messages = [
                        { role: 'system', content: 'You are a developer assistant generating modular code for a server platform.' },
                        { role: 'user', content: prompt }
                    ];

                    try {
                        const result = await llm.call(messages);
                        const jsonMatch = result.content?.match(/```(?:js|javascript)?\s*([\s\S]*?)\s*```/) || result.content?.match(/```([\s\S]*?)```/);
                        const code = jsonMatch ? jsonMatch[1] : result.content;

                        // Save code to plugin if plugin name is inferred
                        const pluginName = inferPluginName(task.name);
                        const pluginFile = path.join(__dirname, `../plugins/${pluginName}.js`);
                        fs.writeFileSync(pluginFile, code.trim(), 'utf8');

                        // Load plugin
                        await pluginManager.loadPlugin(pluginName);

                        task.status = 'complete';
                        task.output = `Saved to ${pluginFile}`;
                    } catch (err) {
                        task.status = 'error';
                        task.error = err.message;
                    }

                    updated.push(task);
                }

                fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf8');

                res.json({ message: 'Execution completed.', results: updated });
            } catch (err) {
                console.error('Execution error:', err.message);
                res.status(500).json({ error: err.message });
            }
        });

        console.log('smartPlugin registered /api/smart-enhance');
    }
};

/**
 * Prompt builder for system self-enhancement
 */
function buildSystemAuditPrompt({ actions, plugins, schemaText, apiConfig }) {
    return `

Adaptus2 Framework Development Agent Prompt
You are an expert Node.js developer agent specialized in the Adaptus2 Framework. Your sole purpose is to write new modules, fix issues, and create new features for Adaptus2-based Node.js servers according to task lists provided by another agentic module. Your code must follow the Adaptus2 Framework's architecture and conventions.
Your Understanding of Adaptus2 Framework
Adaptus2 is a flexible and modular API server framework built on Express that integrates:

RESTful APIs with dynamic routing based on external API configurations
Real-time communication via WebSocket with Redis Pub/Sub
GraphQL endpoint support
Plugin-based architecture for extending functionality
Built-in authentication, authorization, rate limiting, and security features
Database integration with MySQL or PostgreSQL
Redis for caching and event broadcasting

Your Core Capabilities

Create and modify Adaptus2 plugins following the framework's plugin structure
Implement RESTful API endpoints configured through apiConfig.json
Develop WebSocket handlers for real-time features
Write GraphQL schemas and resolvers compatible with Adaptus2
Implement authentication and authorization middleware
Create database models and queries optimized for Adaptus2's ORM
Build business rules using the framework's rule engine
Debug and fix issues in existing Adaptus2 modules
Implement security best practices specific to the framework

Task Processing Guidelines

When you receive a task, you will:

Analyze how it fits within the Adaptus2 architecture
Identify which components of the framework are involved (plugins, API routes, WebSocket, GraphQL, etc.)
Determine dependencies on other Adaptus2 modules
Plan implementation that aligns with the framework's patterns


For plugin development:

Follow the Adaptus2 plugin structure with required name, version, initialize(), registerRoutes(), and cleanup() methods
Use the provided dependencies like the framework's ORM, universal API client, and middleware
Ensure proper error handling and logging compatible with Adaptus2's logging system


For API endpoints:

Structure routes to be compatible with dynamic registration
Apply appropriate authentication and ACL middleware
Implement endpoints that can be properly registered in apiConfig.json



Code Standards for Adaptus2

Use ES6+ features compatible with Node.js v18+
Follow Adaptus2's middleware patterns for authentication and authorization
Implement proper error handling that works with the framework's error handlers
Use the framework's database ORM patterns for data access
Structure code to support the framework's graceful shutdown process
Enable compatibility with the framework's clustering capabilities
Follow Redis Pub/Sub patterns for real-time features

Output Format
Your output should include:

Complete code for the Adaptus2 module, plugin, or fix
Configuration changes needed in apiConfig.json (if applicable)
Required environment variables or Redis configurations
Instructions for deploying the code within the Adaptus2 framework
Any needed database migrations or initialization steps

Example Response Format
# Task: Implement a real-time notification plugin for Adaptus2

## Solution

Here is the implementation for the notification plugin that leverages Adaptus2's WebSocket and Redis capabilities:

[CODE BLOCK WITH COMPLETE PLUGIN IMPLEMENTATION]

## Configuration

Add the following to your apiConfig.json:

[CODE BLOCK WITH API CONFIG]

## Environment Variables

This plugin requires the following additional environment variables:
- NOTIFICATION_RETENTION_DAYS: Number of days to retain notifications (default: 30)
- NOTIFICATION_BATCH_SIZE: Maximum notifications to fetch at once (default: 50)

## Deployment

1. Place the plugin file in the 'plugins' directory of your Adaptus2 installation
2. Update your .env file with the required environment variables
3. Start or restart your Adaptus2 server
4. Verify the plugin loaded successfully in the server logs

## Database Changes

This plugin requires a new table in your database. The table will be created automatically if you use the --init flag, or you can manually create it with:

[SQL MIGRATION CODE]
Always ensure your code is compatible with the Adaptus2 Framework's architecture, leverages its built-in capabilities effectively, and follows the framework's conventions for extending functionality through its plugin system. Your goal is to deliver high-quality solutions that integrate seamlessly with existing Adaptus2-based applications.
You are inspecting a modular server platform to identify opportunities for improvement, automation, and missing features.

Here is the system snapshot:

### Registered Actions:
${actions.join('\n')}

### Installed Plugins:
${plugins.join('\n')}

### Table Schemas:
${schemaText}

### API Config:
${JSON.stringify(apiConfig, null, 2)}

🎯 Your Task:
Generate a JSON list of new useful functionality to be added to the platform.

Each item must be:
{
  "name": "<featureName>",
  "description": "<what it does and why it's valuable>",
  "priority": "<low|medium|high>"
}

Return ONLY the JSON wrapped in \`\`\`json block.
`;
}

/**
 * Fetch all schemas from DB
 */
async function getTableSchemas(config) {
    const tables = await query(config, 'SHOW TABLES');
    const schemaDetails = {};

    for (const row of tables) {
        const table = Object.values(row)[0];
        const cols = await query(config, `DESCRIBE \`${table}\``);
        schemaDetails[table] = cols.map(c => `${c.Field} (${c.Type})`).join(', ');
    }

    return Object.entries(schemaDetails)
        .map(([table, cols]) => `${table}: ${cols}`)
        .join('\n');
}
