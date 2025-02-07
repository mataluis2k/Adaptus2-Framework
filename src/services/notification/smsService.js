const twilio = require('twilio');
const logger = require('../../modules/logger');
const { readFileSync } = require('fs');
const { join } = require('path');
const handlebars = require('handlebars');

class SMSService {
    constructor() {
        this.client = twilio(
            process.env.TWILIO_ACCOUNT_SID,
            process.env.TWILIO_AUTH_TOKEN
        );
        this.fromNumber = process.env.TWILIO_FROM_NUMBER;
        
        // Initialize template cache
        this.templates = {};
        this.loadTemplates();

        // Rate limiting configuration
        this.rateLimits = {
            perNumber: {
                max: 5,  // messages
                window: 3600000  // 1 hour in ms
            }
        };
        this.messageLog = new Map(); // Track messages for rate limiting
    }

    loadTemplates() {
        try {
            const templateDir = join(__dirname, '../../../templates/sms');
            // Add default templates
            this.templates.verification = readFileSync(join(templateDir, 'verification.txt'), 'utf8');
            this.templates.notification = readFileSync(join(templateDir, 'notification.txt'), 'utf8');
            this.templates.alert = readFileSync(join(templateDir, 'alert.txt'), 'utf8');
        } catch (error) {
            logger.error('Failed to load SMS templates:', error);
        }
    }

    async send({ to, template, data }) {
        if (!to || !template) {
            throw new Error('Missing required SMS parameters');
        }

        try {
            // Validate phone number
            if (!this.validatePhoneNumber(to)) {
                throw new Error('Invalid phone number');
            }

            // Check rate limits
            if (!this.checkRateLimit(to)) {
                throw new Error('Rate limit exceeded for this number');
            }

            // Get and compile template
            const templateContent = this.templates[template];
            if (!templateContent) {
                throw new Error(`Template '${template}' not found`);
            }

            const compiledTemplate = handlebars.compile(templateContent);
            const message = compiledTemplate(data);

            // Send SMS with retry mechanism
            const result = await this.sendWithRetry({
                to,
                from: this.fromNumber,
                body: message
            });

            // Log successful send
            this.logMessage(to);
            logger.info('SMS sent successfully', { to, template });
            return result;

        } catch (error) {
            logger.error('Failed to send SMS:', error);
            throw error;
        }
    }

    async sendWithRetry(messageOptions, retries = 3, delay = 1000) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                return await this.client.messages.create(messageOptions);
            } catch (error) {
                if (attempt === retries) throw error;
                logger.warn(`SMS send attempt ${attempt} failed, retrying...`);
                await new Promise(resolve => setTimeout(resolve, delay * attempt));
            }
        }
    }

    validatePhoneNumber(number) {
        // Basic E.164 format validation
        const phoneRegex = /^\+[1-9]\d{1,14}$/;
        return phoneRegex.test(number);
    }

    checkRateLimit(phoneNumber) {
        const now = Date.now();
        const numberLog = this.messageLog.get(phoneNumber) || [];
        
        // Clean up old entries
        const recentMessages = numberLog.filter(
            timestamp => now - timestamp < this.rateLimits.perNumber.window
        );

        if (recentMessages.length >= this.rateLimits.perNumber.max) {
            return false;
        }

        return true;
    }

    logMessage(phoneNumber) {
        const now = Date.now();
        const numberLog = this.messageLog.get(phoneNumber) || [];
        
        // Add new message timestamp and clean up old ones
        numberLog.push(now);
        const recentMessages = numberLog.filter(
            timestamp => now - timestamp < this.rateLimits.perNumber.window
        );

        this.messageLog.set(phoneNumber, recentMessages);
    }

    // Queue SMS for later sending
    async queue({ to, template, data, scheduledTime }) {
        // Implementation would depend on your queue system (Redis, Bull, etc.)
        logger.info('SMS queued for later sending', { to, template, scheduledTime });
    }

    // Get delivery status
    async getStatus(messageId) {
        try {
            const message = await this.client.messages(messageId).fetch();
            return {
                status: message.status,
                error: message.errorMessage,
                timestamp: message.dateUpdated
            };
        } catch (error) {
            logger.error('Failed to get message status:', error);
            throw error;
        }
    }
}

// Export singleton instance
module.exports = new SMSService();
