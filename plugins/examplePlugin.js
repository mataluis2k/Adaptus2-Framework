module.exports = {
    name: 'examplePlugin',
    version: '1.0.0',

    initialize(dependencies) {
        console.log('Initializing examplePlugin...');
        const { context, customRequire } = dependencies;
        const UniversalApiClient = customRequire('../src/modules/universalAPIClient');
        const { authenticateMiddleware, aclMiddleware } = customRequire('../src/middleware/authenticationMiddleware');
        // Perform initialization tasks
    },

    registerRoutes({ app }) {
        const routes = [];
        
        // Register route and keep track of it
        const routePath = '/example';
        app.get(routePath,authenticateMiddleware("token"), aclMiddleware(["publicAccess"]), (req, res) => {
            res.send('Example Plugin Route');
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