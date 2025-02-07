const twilio = require('twilio');
const logger = require('../../../../modules/logger');

class TwilioAdapter {
    constructor(config) {
        this.client = twilio(
            config.accountSid || process.env.TWILIO_ACCOUNT_SID,
            config.authToken || process.env.TWILIO_AUTH_TOKEN
        );
        this.fromNumber = config.fromNumber || process.env.TWILIO_FROM_NUMBER;
    }

    async send(to, message) {
        try {
            const result = await this.client.messages.create({
                body: message,
                from: this.fromNumber,
                to
            });
            return {
                success: true,
                messageId: result.sid,
                provider: 'twilio',
                status: result.status
            };
        } catch (error) {
            logger.error('Twilio send error:', error);
            throw new Error(`Twilio: ${error.message}`);
        }
    }

    async getStatus(messageId) {
        try {
            const message = await this.client.messages(messageId).fetch();
            return {
                messageId,
                status: message.status,
                error: message.errorMessage,
                provider: 'twilio',
                timestamp: message.dateUpdated
            };
        } catch (error) {
            logger.error('Twilio status check error:', error);
            throw new Error(`Twilio status check: ${error.message}`);
        }
    }
}

module.exports = TwilioAdapter;
