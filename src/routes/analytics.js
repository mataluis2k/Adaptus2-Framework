const express = require('express');
const router = express.Router();

class AnalyticsRoutes {
    constructor(apiAnalytics) {
        this.apiAnalytics = apiAnalytics;
        this.router = router;
        this.setupRoutes();
    }

    setupRoutes() {
        // Get analytics for a specific endpoint
        this.router.get('/endpoint/:method/:path(*)', async (req, res) => {
            try {
                const { method, path } = req.params;
                const analytics = await this.apiAnalytics.getEndpointAnalytics(method, path);
                res.json(analytics);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Get slow queries report
        this.router.get('/slow-queries', async (req, res) => {
            try {
                const slowQueries = await this.apiAnalytics.getSlowQueries();
                res.json(slowQueries);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Get current request rate for an endpoint
        this.router.get('/rate/:method/:path(*)', async (req, res) => {
            try {
                const { method, path } = req.params;
                const rate = await this.apiAnalytics.getCurrentRequestRate(method, path);
                res.json(rate);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Get overall API health metrics
        this.router.get('/health', async (req, res) => {
            try {
                const endpointKey = 'endpoint:*';
                const keys = await this.apiAnalytics.redis.keys(endpointKey);
                
                const metrics = await Promise.all(keys.map(async (key) => {
                    const [method, path] = key.split(':').slice(1);
                    const analytics = await this.apiAnalytics.getEndpointAnalytics(method, path);
                    const rate = await this.apiAnalytics.getCurrentRequestRate(method, path);
                    
                    return {
                        endpoint: `${method} ${path}`,
                        analytics,
                        currentRate: rate
                    };
                }));

                res.json({
                    timestamp: new Date().toISOString(),
                    endpoints: metrics
                });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
    }

    getRouter() {
        return this.router;
    }
}

module.exports = AnalyticsRoutes;
