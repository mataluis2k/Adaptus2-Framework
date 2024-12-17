const nodemailer = require("nodemailer");

class MailModule {
    constructor(config) {
        this.config = config;
        this.transports = {};

        // Dynamically initialize transports
        this.initializeTransports();

        // Extend the global context
        this.extendContext();
    }

    initializeTransports() {
        const availableTransports = this.config.transports || [];

        availableTransports.forEach((transportConfig) => {
            const { name, module: modulePath, options } = transportConfig;

            if (!name) {
                console.error("Transport configuration must include a 'name'.");
                return;
            }

            try {
                // Dynamically load the module if specified
                const mailModule = modulePath ? require(modulePath) : null;

                // Dynamically create a transport class
                const TransportClass = this.createTransportClass(name, mailModule, options);

                // Instantiate and register the transport
                this.transports[name] = new TransportClass(options);
                console.log(`Loaded mail transport: ${name}`);
            } catch (error) {
                console.error(`Failed to initialize transport: ${name}`, error.message);
            }
        });
    }

    createTransportClass(name, mailModule, options) {
        return class {
            constructor(opts) {
                if (mailModule && opts.apiKey) {
                    this.client = mailModule;
                    this.client.setApiKey(opts.apiKey);
                } else if (!mailModule && opts.path) {
                    this.transport = nodemailer.createTransport({
                        sendmail: true,
                        newline: "unix",
                        path: opts.path,
                    });
                } else {
                    throw new Error(`${name}: Invalid or missing configuration.`);
                }
            }

            async send({ from, to, subject, text, html }) {
                if (this.client) {
                    // Handle providers like SendGrid and Mailchimp
                    const message = {
                        from: from,
                        to: Array.isArray(to) ? to : [to],
                        subject,
                        text,
                        html,
                    };
                    if (name === "mailchimp") {
                        // Adjust message structure for Mailchimp
                        message.to = message.to.map((email) => ({ email }));
                    }
                    return await this.client.messages
                        ? this.client.messages.send({ message }) // Mailchimp
                        : this.client.send(message); // SendGrid
                } else if (this.transport) {
                    // Handle sendmail
                    return await this.transport.sendMail({ from, to, subject, text, html });
                } else {
                    throw new Error(`${name}: No valid transport available.`);
                }
            }
        };
    }

    async sendEmail({ provider, from, to, subject, text, html }) {
        if (!this.transports[provider]) {
            throw new Error(`Transport for provider "${provider}" is not available.`);
        }

        return this.transports[provider].send({ from, to, subject, text, html });
    }

    extendContext() {
        if (!globalContext.actions) globalContext.actions = {};

        globalContext.actions.sendEmail = async (ctx, params) => {
            return await this.sendEmail(params);
        };
    }
}

module.exports = MailModule;
