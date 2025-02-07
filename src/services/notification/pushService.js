const admin = require('firebase-admin');
const logger = require('../../modules/logger');
const { readFileSync } = require('fs');
const { join } = require('path');
const handlebars = require('handlebars');

class PushService {
    constructor() {
        if (!admin.apps.length) {
            try {
                admin.initializeApp({
                    credential: admin.credential.applicationDefault()
                });
            } catch (error) {
                logger.error('Failed to initialize Firebase Admin:', error);
                throw error;
            }
        }

        // Initialize template cache
        this.templates = {};
        this.loadTemplates();

        // Rate limiting configuration
        this.rateLimits = {
            perDevice: {
                max: 100,  // notifications
                window: 3600000  // 1 hour in ms
            }
        };
        this.notificationLog = new Map(); // Track notifications for rate limiting
    }

    loadTemplates() {
        try {
            const templateDir = join(__dirname, '../../../templates/push');
            // Add default templates
            this.templates.notification = readFileSync(join(templateDir, 'notification.json'), 'utf8');
            this.templates.alert = readFileSync(join(templateDir, 'alert.json'), 'utf8');
            this.templates.update = readFileSync(join(templateDir, 'update.json'), 'utf8');
        } catch (error) {
            logger.error('Failed to load push notification templates:', error);
        }
    }

    async send({ token, template, data, options = {} }) {
        if (!token || !template) {
            throw new Error('Missing required push notification parameters');
        }

        try {
            // Check rate limits
            if (!this.checkRateLimit(token)) {
                throw new Error('Rate limit exceeded for this device');
            }

            // Get and compile template
            const templateContent = this.templates[template];
            if (!templateContent) {
                throw new Error(`Template '${template}' not found`);
            }

            const compiledTemplate = handlebars.compile(templateContent);
            const messageContent = JSON.parse(compiledTemplate(data));

            // Merge template with options
            const message = {
                token,
                ...messageContent,
                ...options,
                data: {
                    ...messageContent.data,
                    ...data,
                    timestamp: Date.now().toString()
                }
            };

            // Send notification with retry mechanism
            const result = await this.sendWithRetry(message);

            // Log successful send
            this.logNotification(token);
            logger.info('Push notification sent successfully', { token, template });
            return result;

        } catch (error) {
            logger.error('Failed to send push notification:', error);
            throw error;
        }
    }

    async sendWithRetry(message, retries = 3, delay = 1000) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                return await admin.messaging().send(message);
            } catch (error) {
                if (attempt === retries) throw error;
                logger.warn(`Push notification attempt ${attempt} failed, retrying...`);
                await new Promise(resolve => setTimeout(resolve, delay * attempt));
            }
        }
    }

    async sendToTopic({ topic, template, data, options = {} }) {
        try {
            const templateContent = this.templates[template];
            if (!templateContent) {
                throw new Error(`Template '${template}' not found`);
            }

            const compiledTemplate = handlebars.compile(templateContent);
            const messageContent = JSON.parse(compiledTemplate(data));

            const message = {
                topic,
                ...messageContent,
                ...options,
                data: {
                    ...messageContent.data,
                    ...data,
                    timestamp: Date.now().toString()
                }
            };

            const result = await admin.messaging().send(message);
            logger.info('Topic notification sent successfully', { topic, template });
            return result;

        } catch (error) {
            logger.error('Failed to send topic notification:', error);
            throw error;
        }
    }

    checkRateLimit(token) {
        const now = Date.now();
        const deviceLog = this.notificationLog.get(token) || [];
        
        // Clean up old entries
        const recentNotifications = deviceLog.filter(
            timestamp => now - timestamp < this.rateLimits.perDevice.window
        );

        if (recentNotifications.length >= this.rateLimits.perDevice.max) {
            return false;
        }

        return true;
    }

    logNotification(token) {
        const now = Date.now();
        const deviceLog = this.notificationLog.get(token) || [];
        
        // Add new notification timestamp and clean up old ones
        deviceLog.push(now);
        const recentNotifications = deviceLog.filter(
            timestamp => now - timestamp < this.rateLimits.perDevice.window
        );

        this.notificationLog.set(token, recentNotifications);
    }

    async subscribeToTopic(tokens, topic) {
        try {
            await admin.messaging().subscribeToTopic(tokens, topic);
            logger.info('Subscribed to topic successfully', { tokens, topic });
        } catch (error) {
            logger.error('Failed to subscribe to topic:', error);
            throw error;
        }
    }

    async unsubscribeFromTopic(tokens, topic) {
        try {
            await admin.messaging().unsubscribeFromTopic(tokens, topic);
            logger.info('Unsubscribed from topic successfully', { tokens, topic });
        } catch (error) {
            logger.error('Failed to unsubscribe from topic:', error);
            throw error;
        }
    }

    // Queue notification for later sending
    async queue({ token, template, data, scheduledTime, options = {} }) {
        // Implementation would depend on your queue system (Redis, Bull, etc.)
        logger.info('Push notification queued for later sending', { 
            token, 
            template, 
            scheduledTime 
        });
    }
}

// Export singleton instance
module.exports = new PushService();
