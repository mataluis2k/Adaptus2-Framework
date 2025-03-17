const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your_secret_key';

router.get('/comm/video-call-widget', authenticateMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const tempToken = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '5m' });

        let widgetCode = await fs.promises.readFile(path.join(__dirname, '../public/videoCall.js'), 'utf-8');
        widgetCode = widgetCode.replace('AUTH_TOKEN_PLACEHOLDER', tempToken);

        res.setHeader('Content-Type', 'application/javascript');
        res.send(widgetCode);
    } catch (error) {
        console.error("Error serving video call widget:", error);
        res.status(500).json({ error: "Failed to serve video call widget" });
    }
});

module.exports = router;
