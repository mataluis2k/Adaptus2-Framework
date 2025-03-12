module.exports = {
    name: 'examplePlugin',
    version: '1.0.0',

    initialize(dependencies) {
        console.log('Initializing examplePlugin...');
        const { context, customRequire } = dependencies;
        const response = customRequire('../src/modules/response');
        const UniversalApiClient = customRequire('../src/modules/universalAPIClient');        
        // Perform initialization tasks

        // Define a custom action
        async function customAction(ctx, params) {
            console.log('Executing custom action...');
            return response.setResponse(401, 'Custom action executed', { data: 'Custom action data' });
            // Perform custom action
        }
        // Register the function to the global context
        if (!context.actions.customAction) {
            context.actions.customAction = customAction;
        }
    },

    // // If you need to create custom routes, must of the plugin will only expose the methods via the global context
    // registerRoutes({ app }) {
    //     const routes = [];
        
    //     // Register route and keep track of it
    //     const routePath = '/example';
    //     app.get(routePath,authenticateMiddleware("token"), aclMiddleware(["publicAccess"]), (req, res) => {
    //         res.send('Example Plugin Route');
    //     });
    //     routes.push({ method: 'get', path: routePath });
    
    //     // Return registered routes for cleanup later
    //     return routes;
    // },


    async cleanup() {
        console.log('Cleaning up examplePlugin...');
        // Perform cleanup tasks
    },
};