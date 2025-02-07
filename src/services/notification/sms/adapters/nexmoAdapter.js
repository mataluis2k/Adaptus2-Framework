const Nexmo = require('nexmo');
const logger = require('../../../../modules/logger');

class NexmoAdapter {
    constructor(config) {
        this.client = new Nexmo({
            apiKey: config.apiKey || process.env.NEXMO_API_KEY,
            apiSecret: config.apiSecret || process.env.NEXMO_API_SECRET
        });
        this.fromNumber = config.fromNumber || process.env.NEXMO_FROM_NUMBER;
    }

    async send(to, message) {
        return new Promise((resolve, reject) => {
            this.client.message.sendSms(
                this.fromNumber,
                to,
                message,
                (error, response) => {
                    if (error) {
                        logger.error('Nexmo send error:', error);
                        reject(new Error(`Nexmo: ${error.message}`));
                    } else {
                        const result = response.messages[0];
                        resolve({
                            success: result.status === '0',
                            messageId: result['message-id'],
                            provider: 'nexmo',
                            status: result.status === '0' ? 'sent' : 'failed',
                            remainingBalance: result['remaining-balance'],
                            messagePrice: result['message-price']
                        });
                    }
                }
            );
        });
    }

    async getStatus(messageId) {
        return new Promise((resolve, reject) => {
            this.client.message.search({ id: messageId }, (error, response) => {
                if (error) {
                    logger.error('Nexmo status check error:', error);
                    reject(new Error(`Nexmo status check: ${error.message}`));
                } else {
                    resolve({
                        messageId,
                        status: response.status,
                        provider: 'nexmo',
                        timestamp: new Date(response.date_received),
                        errorCode: response['error-code'],
                        price: response.price
                    });
                }
            });
        });
    }

    async validateNumber(number) {
        return new Promise((resolve, reject) => {
            this.client.number.insight({
                level: 'basic',
                number: number
            }, (error, result) => {
                if (error) {
                    logger.error('Nexmo number validation error:', error);
                    reject(new Error(`Nexmo validation: ${error.message}`));
                } else {
                    resolve({
                        valid: result.status === 0,
                        countryCode: result.country_code,
                        carrier: result.current_carrier,
                        type: result.current_carrier_network_type
                    });
                }
            });
        });
    }
}

module.exports = NexmoAdapter;
