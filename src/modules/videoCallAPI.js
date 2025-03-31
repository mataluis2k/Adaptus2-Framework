const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your_secret_key';

const SIGNALING_PORT = process.env.WS_SIGNALING_PORT;
const HOST = process.env.HOST;

router.get('/comm/video-call-widget', async (req, res) => {
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


router.get('/comm/video-call', (req, res) => {
    const { username, userId } = req.query;

    if (!username || !userId) {
        return res.status(400).send('Missing username or userId in query parameters');
    }

    // Generate a JWT token
    const token = jwt.sign(
        { username, userId },
        JWT_SECRET,
        { expiresIn: '1h' }
    );

    // Serve the HTML with injected values
    const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Modern Video Call Widget</title>
        <link rel="stylesheet" href="/css/videoCallWidget2.css">
        <script src="/js/videoCallWidget.js" defer></script>
    </head>
    <body>
        <div class="container">
            <h1>Video Call Widget</h1>
            <div class="room-setup">
                <label for="roomId">Enter Room ID:</label>
                <input type="text" id="roomId" placeholder="Example: room123">
                <button onclick="startCall()">
                    <span>Start Video Call</span>
                    <span>📹</span>
                </button>
            </div>
            <div class="instructions">
                <p>Enter a room ID above to start a video call. Share this room ID with others so they can join the same call.</p>
            </div>
        </div>
        <script>
            function startCall() {
                const roomId = document.getElementById('roomId').value.trim();
                if (!roomId) {
                    alert("Please enter a Room ID!");
                    return;
                }

                const authToken = '${token}';
                const websocketUrl = 'ws://${HOST}:${SIGNALING_PORT}';

                new VideoCallWidget({
                    websocketUrl: websocketUrl,
                    roomId: roomId,
                    authToken: authToken
                });

                const container = document.querySelector('.container');
                const notification = document.createElement('div');
                notification.style.backgroundColor = '#4a69bd';
                notification.style.color = 'white';
                notification.style.padding = '10px';
                notification.style.borderRadius = '6px';
                notification.style.marginTop = '20px';
                notification.style.textAlign = 'center';
                notification.innerHTML = \`<strong>Call started in room: \${roomId}</strong><br>The video call widget has been opened.\`;
                container.appendChild(notification);
            }
        </script>
    </body>
    </html>
    `;

    res.setHeader('Content-Type', 'text/html');
    res.send(htmlContent);
});

module.exports = router;
