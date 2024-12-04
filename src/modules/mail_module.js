const nodemailer = require("nodemailer");
const sgMail = require("@sendgrid/mail");
const mailchimp = require("@mailchimp/mailchimp_transactional");

class MailModule {
    constructor(app, config, dbConfig) {
        this.app = app;
        this.config = config;

        // Configure Sendmail
        this.sendmailTransport = nodemailer.createTransport({
            sendmail: true,
            newline: "unix",
            path: "/usr/sbin/sendmail",
        });

        // Configure SendGrid
        if (config.sendgridApiKey) {
            sgMail.setApiKey(config.sendgridApiKey);
        }

        // Configure Mailchimp
        this.mailchimpClient = config.mailchimpApiKey
            ? mailchimp(config.mailchimpApiKey)
            : null;

        this.dbConfig = dbConfig;

        // Register manual processing route
        this.registerRoutes();
    }

    async getPendingEmails() {
        const query = `SELECT * FROM email_queue WHERE status = 'pending' ORDER BY created_at LIMIT 10`;

        const connection = await this.dbConfig.getConnection();
        const [rows] = await connection.execute(query);
        connection.release();
        return rows;
    }

    async updateEmailStatus(emailId, status, error = null) {
        const query = `UPDATE email_queue SET status = ?, error_message = ?, sent_at = NOW() WHERE id = ?`;

        const connection = await this.dbConfig.getConnection();
        await connection.execute(query, [status, error, emailId]);
        connection.release();
    }

    async sendEmail(provider, options) {
        switch (provider) {
            case "sendmail":
                return this.sendWithSendmail(options);
            case "sendgrid":
                return this.sendWithSendGrid(options);
            case "mailchimp":
                return this.sendWithMailchimp(options);
            default:
                throw new Error("Invalid email provider specified");
        }
    }

    async sendWithSendmail({ from, to, subject, text, html }) {
        const mailOptions = { from, to, subject, text, html };
        return this.sendmailTransport.sendMail(mailOptions);
    }

    async sendWithSendGrid({ from, to, subject, text, html }) {
        const msg = { from, to, subject, text, html };
        return sgMail.send(msg);
    }

    async sendWithMailchimp({ from, to, subject, text, html }) {
        if (!this.mailchimpClient) {
            throw new Error("Mailchimp API key is not configured");
        }

        const message = {
            from_email: from,
            subject,
            text,
            html,
            to: [{ email: to }],
        };

        return this.mailchimpClient.messages.send({ message });
    }

    async processEmails() {
        const emails = await this.getPendingEmails();

        for (const email of emails) {
            const { id, provider, from_email, to_email, subject, body_text, body_html } = email;

            try {
                // Send the email using the appropriate provider
                await this.sendEmail(provider, {
                    from: from_email,
                    to: to_email,
                    subject,
                    text: body_text,
                    html: body_html,
                });

                // Update the email status to "sent"
                await this.updateEmailStatus(id, "sent");
                console.log(`Email ID ${id} sent successfully`);
            } catch (error) {
                // Update the email status to "failed" with the error message
                await this.updateEmailStatus(id, "failed", error.message);
                console.error(`Failed to send email ID ${id}:`, error.message);
            }
        }
    }

    registerRoutes() {
        // Manually trigger email processing
        this.app.post("/mail/process", async (req, res) => {
            try {
                await this.processEmails();
                res.json({ message: "Email processing complete" });
            } catch (error) {
                console.error("Error processing emails:", error.message);
                res.status(500).json({ error: "Failed to process emails" });
            }
        });
    }
}

module.exports = MailModule;
