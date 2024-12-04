const webpush = require("web-push");
const admin = require("firebase-admin");
const bodyParser = require("body-parser");

class PushNotification {
    constructor(app, fcmConfig, vapidKeys, dbConfig) {
        // Initialize Firebase Admin SDK
        admin.initializeApp({
            credential: admin.credential.cert(fcmConfig),
        });

        // VAPID keys for Web Push Protocol
        webpush.setVapidDetails(
            vapidKeys.subject,
            vapidKeys.publicKey,
            vapidKeys.privateKey
        );

        // Database configuration (e.g., MySQL or other)
        this.dbConfig = dbConfig;

        // Attach routes
        this.app = app;
        this.registerRoutes();
    }

    async saveDeviceToken(userId, token, type) {
        // Save the token to the database (or another storage system)
        const query = `
            INSERT INTO device_tokens (user_id, token, type)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE token = VALUES(token)
        `;

        const connection = await this.dbConfig.getConnection();
        await connection.execute(query, [userId, token, type]);
        connection.release();
    }

    async getDeviceTokens(userId) {
        const query = `SELECT token, type FROM device_tokens WHERE user_id = ?`;
        const connection = await this.dbConfig.getConnection();
        const [results] = await connection.execute(query, [userId]);
        connection.release();
        return results;
    }

    async sendFcmNotification(token, notification) {
        try {
            const response = await admin.messaging().send({
                token,
                notification,
            });
            console.log(`FCM notification sent: ${response}`);
            return response;
        } catch (err) {
            console.error("Error sending FCM notification:", err.message);
            throw err;
        }
    }

    async sendWebPushNotification(subscription, payload) {
        try {
            const response = await webpush.sendNotification(subscription, JSON.stringify(payload));
            console.log("Web push notification sent:", response);
            return response;
        } catch (err) {
            console.error("Error sending web push notification:", err.message);
            throw err;
        }
    }

    registerRoutes() {
        // Middleware for parsing JSON requests
        this.app.use(bodyParser.json());

        // Register device token
        this.app.post("/push/register", async (req, res) => {
            const { userId, token, type } = req.body;

            if (!userId || !token || !type) {
                return res.status(400).json({ error: "userId, token, and type are required" });
            }

            try {
                await this.saveDeviceToken(userId, token, type);
                res.json({ message: "Device token registered successfully" });
            } catch (err) {
                console.error("Error saving device token:", err.message);
                res.status(500).json({ error: "Internal Server Error" });
            }
        });

        // Send notification
        this.app.post("/push/send", async (req, res) => {
            const { userId, notification } = req.body;

            if (!userId || !notification) {
                return res.status(400).json({ error: "userId and notification are required" });
            }

            try {
                const tokens = await this.getDeviceTokens(userId);

                for (const { token, type } of tokens) {
                    if (type === "fcm") {
                        await this.sendFcmNotification(token, notification);
                    } else if (type === "webpush") {
                        await this.sendWebPushNotification(JSON.parse(token), notification);
                    }
                }

                res.json({ message: "Notification sent successfully" });
            } catch (err) {
                console.error("Error sending notification:", err.message);
                res.status(500).json({ error: "Internal Server Error" });
            }
        });
    }
}

module.exports = PushNotification;
