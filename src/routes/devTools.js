const express = require('express');
const router = express.Router();

class DevToolsRoutes {
    constructor(devTools) {
        this.devTools = devTools;
        this.router = router;
        // Add body-parser middleware
        this.router.use(express.json());
        this.setupRoutes();
    }

    setupRoutes() {
        // Generate API documentation
        this.router.get('/docs', async (req, res) => {
            try {
                const docs = await this.devTools.generateDocs();
                res.json(docs);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Test endpoint
        this.router.post('/test-endpoint', async (req, res) => {
            try {
                const { method, url, options } = req.body;
                const result = await this.devTools.testEndpoint(method, url, options);
                res.json(result);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Validate configuration
        this.router.post('/validate-config', async (req, res) => {
            try {
                const { configPath } = req.body;
                const result = await this.devTools.validateConfig(configPath);
                res.json(result);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Get development metrics
        this.router.get('/metrics', async (req, res) => {
            try {
                const metrics = await this.devTools.getDevMetrics();
                res.json(metrics);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Generate test data
        this.router.post('/generate-test-data', async (req, res) => {
            try {
                const { schema, count } = req.body;
                const data = this.devTools.generateTestData(schema, count);
                res.json(data);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Check development environment
        this.router.get('/check-environment', async (req, res) => {
            try {
                const checks = await this.devTools.checkDevEnvironment();
                res.json(checks);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
    }

    getRouter() {
        return this.router;
    }
}

module.exports = DevToolsRoutes;
