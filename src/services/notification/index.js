const emailService = require('./emailService');
const smsService = require('./smsService');
const pushService = require('./pushService');
const logger = require('../../modules/logger');

class NotificationService {
    constructor() {
        this.services = {
            email: emailService,
            sms: smsService,
            push: pushService
        };
    }

    /**
     * Send a notification through multiple channels
     * @param {Object} params
     * @param {Array} params.channels - Array of channels to send through ('email', 'sms', 'push')
     * @param {Object} params.data - Data to send (will be mapped to each channel's requirements)
     * @param {Object} params.templates - Template names for each channel
     * @param {Object} params.recipients - Recipients for each channel
     * @returns {Promise<Object>} Results from each channel
     */
    async send({ channels = [], data = {}, templates = {}, recipients = {} }) {
        const results = {};
        const errors = [];

        await Promise.all(channels.map(async (channel) => {
            try {
                if (!this.services[channel]) {
                    throw new Error(`Unknown channel: ${channel}`);
                }

                switch (channel) {
                    case 'email':
                        if (!recipients.email || !templates.email) {
                            throw new Error('Missing email recipient or template');
                        }
                        results.email = await this.services.email.send({
                            to: recipients.email,
                            subject: data.subject || 'Notification',
                            template: templates.email,
                            data
                        });
                        break;

                    case 'sms':
                        if (!recipients.phone || !templates.sms) {
                            throw new Error('Missing phone number or SMS template');
                        }
                        results.sms = await this.services.sms.send({
                            to: recipients.phone,
                            template: templates.sms,
                            data
                        });
                        break;

                    case 'push':
                        if (!recipients.deviceToken || !templates.push) {
                            throw new Error('Missing device token or push template');
                        }
                        results.push = await this.services.push.send({
                            token: recipients.deviceToken,
                            template: templates.push,
                            data
                        });
                        break;
                }
            } catch (error) {
                errors.push({ channel, error: error.message });
                logger.error(`Failed to send ${channel} notification:`, error);
            }
        }));

        return {
            success: errors.length === 0,
            results,
            errors: errors.length > 0 ? errors : undefined
        };
    }

    /**
     * Queue notifications for later sending
     */
    async queue({ channels = [], data = {}, templates = {}, recipients = {}, scheduledTime }) {
        const results = {};
        const errors = [];

        await Promise.all(channels.map(async (channel) => {
            try {
                if (!this.services[channel]) {
                    throw new Error(`Unknown channel: ${channel}`);
                }

                switch (channel) {
                    case 'email':
                        results.email = await this.services.email.queue({
                            to: recipients.email,
                            subject: data.subject || 'Notification',
                            template: templates.email,
                            data,
                            scheduledTime
                        });
                        break;

                    case 'sms':
                        results.sms = await this.services.sms.queue({
                            to: recipients.phone,
                            template: templates.sms,
                            data,
                            scheduledTime
                        });
                        break;

                    case 'push':
                        results.push = await this.services.push.queue({
                            token: recipients.deviceToken,
                            template: templates.push,
                            data,
                            scheduledTime
                        });
                        break;
                }
            } catch (error) {
                errors.push({ channel, error: error.message });
                logger.error(`Failed to queue ${channel} notification:`, error);
            }
        }));

        return {
            success: errors.length === 0,
            results,
            errors: errors.length > 0 ? errors : undefined
        };
    }

    /**
     * Get a specific notification service
     */
    getService(name) {
        const service = this.services[name];
        if (!service) {
            throw new Error(`Unknown service: ${name}`);
        }
        return service;
    }
}

// Export singleton instance
module.exports = new NotificationService();
