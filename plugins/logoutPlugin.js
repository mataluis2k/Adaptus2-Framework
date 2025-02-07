let logoutFunction;

module.exports = {
    name: 'logoutPlugin',
    version: '1.0.0',

    initialize(dependencies) {
        console.log('Initializing logoutPlugin...');

        const { context, customRequire } = dependencies;
        const Redis = customRequire('ioredis');
        const jwt = customRequire('jsonwebtoken');
        const { authenticateMiddleware } = customRequire('../src/middleware/authenticationMiddleware');

        require('dotenv').config();

        const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
        const JWT_SECRET = process.env.JWT_SECRET;
        const JWT_LOGOUT_STRATEGY = process.env.JWT_LOGOUT_STRATEGY || 'client';

        /**
         * Logout function based on strategy
         */
        async function logout(ctx, params) {
            const { req, res } = ctx;
            switch (JWT_LOGOUT_STRATEGY) {
                case "client":
                    return clientSideLogout(res);
                case "blacklist":
                    return await blacklistLogout(req, res);
                case "rotate":
                    return await refreshTokenLogout(req, res);
                default:
                    return res.status(500).json({ error: "Invalid JWT_LOGOUT_STRATEGY value" });
            }
        }

        logoutFunction = logout;
        /**
         * Client-side logout (Default)
         */
        function clientSideLogout(res) {
            res.clearCookie("jwt_token");
            res.json({ message: "Logged out. Clear token from client storage." });
        }

        /**
         * Blacklist JWT token by storing it in Redis
         */
        async function blacklistLogout(req, res) {
            try {
                const token = req.headers.authorization?.split(" ")[1];
                if (!token) return res.status(400).json({ error: "No token provided" });

                const decoded = jwt.verify(token, JWT_SECRET);
                const exp = decoded.exp;

                // Store token in Redis with expiration
                await redis.set(token, "blacklisted", "EX", exp - Math.floor(Date.now() / 1000));

                res.json({ message: "Logged out successfully" });
            } catch (error) {
                res.status(401).json({ error: "Invalid token" });
            }
        }

        /**
         * Refresh Token Rotation Logout
         */
        async function refreshTokenLogout(req, res) {
            const refreshToken = req.cookies.refresh_token;
            if (!refreshToken) return res.status(400).json({ error: "No refresh token provided" });

            await redis.set(refreshToken, "revoked", "EX", 604800);
            res.clearCookie("refresh_token");
            res.json({ message: "Logged out successfully" });
        }

        // Register the logout function to the global context
        if (!context.actions.logout) {
            context.actions.logout = logout;
        }
    },

    registerRoutes({ app , context}) {
        const routes = [];

        const { authenticateMiddleware } = require('../src/middleware/authenticationMiddleware');

        // Register Logout API Route
        const routePath = '/logout';
        app.post(routePath, authenticateMiddleware("token"), async (req, res) => {            
            await logoutFunction;({ req, res }, {});
            return res.status(200).json({ message: 'Logged out successfully' });
        });

        routes.push({ method: 'post', path: routePath });

        return routes;
    },

    async cleanup() {
        console.log('Cleaning up logoutPlugin...');
    },
};
