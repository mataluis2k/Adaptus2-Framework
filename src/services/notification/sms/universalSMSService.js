const logger = require('../../../modules/logger');
const { readFileSync } = require('fs');
const { join } = require('path');
const handlebars = require('handlebars');

// Import adapters
const TwilioAdapter = require('./adapters/twilioAdapter');
const NexmoAdapter = require('./adapters/nexmoAdapter');
const MessageBirdAdapter = require('./adapters/messagebirdAdapter');

class UniversalSMSService {
    constructor(config = {}) {
        this.config = config;
        this.provider = config.provider || process.env.SMS_PROVIDER || 'twilio';
        this.adapter = this.initializeAdapter();

        // Initialize template cache
        this.templates = {};
        this.loadTemplates();

        // Rate limiting configuration
        this.rateLimits = {
            perNumber: {
                max: config.rateLimit?.max || 5,
                window: config.rateLimit?.window || 3600000
            }
        };
        this.messageLog = new Map();
    }

    initializeAdapter() {
        const adapterConfig = {
            // Twilio config
            accountSid: this.config.twilio?.accountSid || process.env.TWILIO_ACCOUNT_SID,
            authToken: this.config.twilio?.authToken || process.env.TWILIO_AUTH_TOKEN,
            fromNumber: this.config.twilio?.fromNumber || process.env.TWILIO_FROM_NUMBER,

            // Nexmo config
            apiKey: this.config.nexmo?.apiKey || process.env.NEXMO_API_KEY,
            apiSecret: this.config.nexmo?.apiSecret || process.env.NEXMO_API_SECRET,
            fromNumber: this.config.nexmo?.fromNumber || process.env.NEXMO_FROM_NUMBER,

            // MessageBird config
            apiKey: this.config.messagebird?.apiKey || process.env.MESSAGEBIRD_API_KEY,
            fromNumber: this.config.messagebird?.fromNumber || process.env.MESSAGEBIRD_FROM_NUMBER
        };

        switch (this.provider.toLowerCase()) {
            case 'twilio':
                return new TwilioAdapter(adapterConfig);
            case 'nexmo':
                return new NexmoAdapter(adapterConfig);
            case 'messagebird':
                return new MessageBirdAdapter(adapterConfig);
            default:
                throw new Error(`Unsupported SMS provider: ${this.provider}`);
        }
    }

    loadTemplates() {
        try {
            const templateDir = join(__dirname, '../../../../templates/sms');
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
            // Validate phone number format
            if (!this.validatePhoneNumber(to)) {
                throw new Error('Invalid phone number format');
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

            // Send message with retry mechanism
            const result = await this.sendWithRetry(to, message);

            // Log successful send
            this.logMessage(to);
            logger.info('SMS sent successfully', { to, template, provider: this.provider });
            return result;

        } catch (error) {
            logger.error('Failed to send SMS:', error);
            throw error;
        }
    }

    async sendWithRetry(to, message, retries = 3, delay = 1000) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                return await this.adapter.send(to, message);
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

    async getStatus(messageId) {
        try {
            return await this.adapter.getStatus(messageId);
        } catch (error) {
            logger.error('Failed to get message status:', error);
            throw error;
        }
    }

    async validateNumber(number) {
        try {
            if (typeof this.adapter.validateNumber === 'function') {
                return await this.adapter.validateNumber(number);
            }
            // Fallback to basic validation if adapter doesn't support validation
            return {
                valid: this.validatePhoneNumber(number),
                provider: this.provider
            };
        } catch (error) {
            logger.error('Failed to validate number:', error);
            throw error;
        }
    }

    // Queue SMS for later sending (implementation would depend on your queue system)
    async queue({ to, template, data, scheduledTime }) {
        logger.info('SMS queued for later sending', { 
            to, 
            template, 
            scheduledTime,
            provider: this.provider 
        });
    }

    // Get provider-specific features
    getProviderFeatures() {
        const features = {
            supportsValidation: typeof this.adapter.validateNumber === 'function',
            supportsBalance: typeof this.adapter.balance === 'function',
            provider: this.provider
        };

        return features;
    }

    // Get account balance if supported by provider
    async getBalance() {
        if (typeof this.adapter.balance === 'function') {
            try {
                return await this.adapter.balance();
            } catch (error) {
                logger.error('Failed to get balance:', error);
                throw error;
            }
        }
        throw new Error('Balance check not supported by this provider');
    }
}

module.exports = UniversalSMSService;
