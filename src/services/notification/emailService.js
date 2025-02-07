const nodemailer = require('nodemailer');
const logger = require('../../modules/logger');
const { readFileSync } = require('fs');
const { join } = require('path');
const handlebars = require('handlebars');

class EmailService {
    constructor() {
        this.transporter = nodemailer.createTransport({
            service: process.env.EMAIL_SERVICE || 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASSWORD
            }
        });

        // Initialize template cache
        this.templates = {};
        this.loadTemplates();
    }

    loadTemplates() {
        try {
            const templateDir = join(__dirname, '../../../templates/email');
            // Add default templates
            this.templates.welcome = readFileSync(join(templateDir, 'welcome.html'), 'utf8');
            this.templates.reset = readFileSync(join(templateDir, 'reset-password.html'), 'utf8');
            this.templates.notification = readFileSync(join(templateDir, 'notification.html'), 'utf8');
        } catch (error) {
            logger.error('Failed to load email templates:', error);
        }
    }

    async send({ to, subject, template, data, attachments = [] }) {
        if (!to || !subject || !template) {
            throw new Error('Missing required email parameters');
        }

        try {
            // Validate email address
            if (!this.validateEmail(to)) {
                throw new Error('Invalid email address');
            }

            // Get and compile template
            const templateContent = this.templates[template];
            if (!templateContent) {
                throw new Error(`Template '${template}' not found`);
            }

            const compiledTemplate = handlebars.compile(templateContent);
            const html = compiledTemplate(data);

            const mailOptions = {
                from: process.env.EMAIL_FROM,
                to,
                subject,
                html,
                attachments
            };

            // Send email with retry mechanism
            const result = await this.sendWithRetry(mailOptions);
            logger.info('Email sent successfully', { to, subject, template });
            return result;

        } catch (error) {
            logger.error('Failed to send email:', error);
            throw error;
        }
    }

    async sendWithRetry(mailOptions, retries = 3, delay = 1000) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                return await this.transporter.sendMail(mailOptions);
            } catch (error) {
                if (attempt === retries) throw error;
                logger.warn(`Email send attempt ${attempt} failed, retrying...`);
                await new Promise(resolve => setTimeout(resolve, delay * attempt));
            }
        }
    }

    validateEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    // Queue email for later sending
    async queue({ to, subject, template, data, scheduledTime }) {
        // Implementation would depend on your queue system (Redis, Bull, etc.)
        logger.info('Email queued for later sending', { to, subject, template, scheduledTime });
    }
}

// Export singleton instance
module.exports = new EmailService();
