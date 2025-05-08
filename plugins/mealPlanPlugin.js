module.exports = {
    // Plugin metadata
    name: 'mealPlanPlugin',
    version: '1.0.0',
  
    /**
     * Initialize the plugin: register routes and any setup logic.
     */
    initialize(dependencies) {
      console.log('Initializing mealPlanPlugin...');
      this.extendContext(dependencies);
    },
  
    /**
     * Cleanup logic if the plugin is unloaded.
     */
    async cleanup() {
      console.log('Cleaning up mealPlanPlugin...');
      // No persistent resources to clean up in this plugin
    },
  
    /**
     * Extend the Express app context: register the POST /ui/genMeal endpoint.
     */
    extendContext(dependencies) {
      const { app, customRequire } = dependencies;
      // Import our meal plan generator module
      const mealGen = customRequire('../src/modules/mealPlanGenerator');
  
      // Register the route for generating meal plans
      app.post('/ui/genMeal', async (req, res) => {
        try {
          console.log('Received request to /ui/genMeal:', req.body);
          // Delegate to the generator: it handles parsing and response
          await mealGen.generateMealPlan(req, res);
        } catch (err) {
          console.error('Error in /ui/genMeal:', err);
          res.status(500).json({ error: err.message });
        }
      });
    }
};
  