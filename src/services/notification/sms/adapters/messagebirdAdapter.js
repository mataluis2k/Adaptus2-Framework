const messagebird = require('messagebird');
const logger = require('../../../../modules/logger');

class MessageBirdAdapter {
    constructor(config) {
        this.client = messagebird(
            config.apiKey || process.env.MESSAGEBIRD_API_KEY
        );
        this.fromNumber = config.fromNumber || process.env.MESSAGEBIRD_FROM_NUMBER;
    }

    async send(to, message) {
        return new Promise((resolve, reject) => {
            this.client.messages.create({
                originator: this.fromNumber,
                recipients: [to],
                body: message,
                datacoding: 'auto'
            }, (error, response) => {
                if (error) {
                    logger.error('MessageBird send error:', error);
                    reject(new Error(`MessageBird: ${error.message}`));
                } else {
                    resolve({
                        success: true,
                        messageId: response.id,
                        provider: 'messagebird',
                        status: response.status,
                        recipient: response.recipients.items[0],
                        encoding: response.encoding
                    });
                }
            });
        });
    }

    async getStatus(messageId) {
        return new Promise((resolve, reject) => {
            this.client.messages.read(messageId, (error, response) => {
                if (error) {
                    logger.error('MessageBird status check error:', error);
                    reject(new Error(`MessageBird status check: ${error.message}`));
                } else {
                    const recipient = response.recipients.items[0];
                    resolve({
                        messageId,
                        status: recipient.status,
                        provider: 'messagebird',
                        timestamp: new Date(recipient.statusDatetime),
                        recipientStatus: recipient.status,
                        recipientStatusReason: recipient.statusReason
                    });
                }
            });
        });
    }

    async validateNumber(number) {
        return new Promise((resolve, reject) => {
            this.client.lookup.read(number, (error, response) => {
                if (error) {
                    logger.error('MessageBird number validation error:', error);
                    reject(new Error(`MessageBird validation: ${error.message}`));
                } else {
                    resolve({
                        valid: true,
                        countryCode: response.countryCode,
                        countryPrefix: response.countryPrefix,
                        type: response.type,
                        formats: {
                            international: response.formats.international,
                            national: response.formats.national
                        }
                    });
                }
            });
        });
    }

    async balance() {
        return new Promise((resolve, reject) => {
            this.client.balance.read((error, response) => {
                if (error) {
                    logger.error('MessageBird balance check error:', error);
                    reject(new Error(`MessageBird balance check: ${error.message}`));
                } else {
                    resolve({
                        amount: response.amount,
                        type: response.type,
                        payment: response.payment
                    });
                }
            });
        });
    }
}

module.exports = MessageBirdAdapter;
