// contentDispatcherPlugin.js
// We need to re-write this plugin to use the new plugin system, use handlebars instead of ejs
// and use the tail end of the route to look up the page on a database and render it.
// The plugin should have the following features:
// 1. Initialize the plugin with the handlebars module.
// 2. Render a template with the handlebars module.
// 3. Register a route with prefix /dsp/{templateName} that looks up the template in a database and renders it.
// 4. It should cache the render pages in redis for 5 minutes.
// 5. The plugin should have a method to clear the cache.


const path = require('path');
const handlebars = require('handlebars');
const redis = require('redis');
const client = redis.createClient();

class DispatcherPlugin {
    constructor() {
        this.handlebars = handlebars;
        this.cache = {};
    }

    async renderTemplate(template, data) {
        const templateFn = this.handlebars.compile(template);
        return templateFn(data);
    }

    async clearCache() {
        this.cache = {};
    }

    async middleware() {
        return async (req, res, next) => {
          
        };
    }
}



module.exports = {
    
    name: 'dispacherPlugin',
    version: '1.0.0',

    initialize(dependencies) {
        console.log('Initializing examplePlugin...');
        const { customRequire } = dependencies;
        const { getDbConnection } = customRequire('../src/modules/db'); // Your database module
        const consolelog = customRequire('../src/modules/logger');
        const { authenticateMiddleware, aclMiddleware } = customRequire('../src/middleware/authenticationMiddleware');
        const response = customRequire('../src/modules/response');
        const { RuleEngine } = customRequire('../src/modules/ruleEngine');       
    },

    registerRoutes({ app, endpoint }) {
        const routes = [];
        
        const { dbType, dbConnection, route, allowMethods, sqlQuery, validation, response, acl, auth, cache, method  } = endpoint;
        // Register route and keep track of it
       
        app.get(route,authenticateMiddleware(auth), aclMiddleware(acl), async (req, res) => {
            const templateName = req.path.split('/').filter(Boolean).pop();
            const template = this.cache[templateName];
            if (template) {
                console.log(`Rendering cached template: ${templateName}`);
                return res.send(template);
            }

            const dbConnection = await getDbConnection();
            const [queryResult] = await dbConnection.execute('SELECT template FROM templates WHERE name = ?', [templateName]);
            if (queryResult.length === 0) {
                console.error(`Template not found: ${templateName}`);
                return res.status(404).json({ message: 'Template not found' });
            }

            const renderedTemplate = await this.renderTemplate(queryResult[0].template, {});
            this.cache[templateName] = renderedTemplate;
            client.setex(templateName, 300, renderedTemplate);
            console.log(`Rendering template: ${templateName}`);
            return res.send(renderedTemplate);
        });
        routes.push({ method: 'get', path: routePath });
    
        // Return registered routes for cleanup later
        return routes;
    },

    async cleanup() {
        console.log('Cleaning up examplePlugin...');
        // Perform cleanup tasks
    },
};