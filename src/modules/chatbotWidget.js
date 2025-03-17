const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

class ChatbotWidgetModule {
    constructor(app, authenticateMiddleware) {
        this.app = app;
        this.authenticateMiddleware = authenticateMiddleware;
        this.registerRoutes();
    }

    registerRoutes() {
        this.app.get('/com/chatbot-widget', this.authenticateMiddleware, async (req, res) => {
            try {
                const userId = req.user.id;  // Extracted from JWT middleware
                const tempToken = jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '5m' }); // Short-lived

                const widgetPath = path.join(__dirname, '../public/chatbot.js');
                let widgetCode = await fs.promises.readFile(widgetPath, 'utf-8');

                // Inject token dynamically
                widgetCode = widgetCode.replace('AUTH_TOKEN_PLACEHOLDER', tempToken);

                res.setHeader('Content-Type', 'application/javascript');
                res.send(widgetCode);
            } catch (error) {
                console.error("Error serving chatbot widget:", error);
                res.status(500).json({ error: "Failed to serve chatbot widget" });
            }
        });
    }
}

module.exports = ChatbotWidgetModule;