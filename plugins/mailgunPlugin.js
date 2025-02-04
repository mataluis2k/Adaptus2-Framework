require('dotenv').config();


module.exports = {
    name: 'mailgunPlugin',
    version: '1.0.0',

    initialize(dependencies) {
        const { context, customRequire } = dependencies;
        const UniversalApiClient = customRequire('../src/modules/universalAPIClient');

        if (!context || !context.actions) {
            throw new Error('Global context with actions is required for Mailgun Plugin.');
        }

        async function sendMailgunEmail(ctx, params) {
            const { entity, data } = params;
            const { to, subject, text, html } = data;
            console.log(to);

            // Validate parameters
            if (!to || !subject || (!text && !html)) {
                throw new Error(
                    'Invalid parameters. Ensure "to", "subject", and either "text" or "html" are provided.'
                );
            }

            // Load configuration
            const mailgunBaseUrl =
                ctx.config.mailgunBaseUrl || process.env.MAILGUN_BASE_URL;
            const mailgunApiKey =
                ctx.config.mailgunApiKey || process.env.MAILGUN_API_KEY;
            const mailgunDomain =
                ctx.config.mailgunDomain || process.env.MAILGUN_DOMAIN;

            if (!mailgunBaseUrl || !mailgunApiKey || !mailgunDomain) {
                throw new Error(
                    'Missing Mailgun configuration. Ensure MAILGUN_BASE_URL, MAILGUN_API_KEY, and MAILGUN_DOMAIN are set.'
                );
            }

            const apiClient = new UniversalApiClient({
                baseUrl: mailgunBaseUrl,
                authType: 'apiKey',
                authValue: `api:${mailgunApiKey}`,
            });

            const maildata = new URLSearchParams();
            maildata.append('from', `Mailgun Sandbox <mailgun@${mailgunDomain}>`);
            maildata.append('to', to);
            maildata.append('subject', subject);
            if (text) maildata.append('text', text);
            if (html) maildata.append('html', html);

            try {
                const response = await apiClient.post(`/v3/${mailgunDomain}/messages`, maildata.toString(), {
                    'Content-Type': 'application/x-www-form-urlencoded',
                });

                console.log('Mailgun email sent successfully:', response);
                return response;
            } catch (error) {
                console.error('Error sending Mailgun email:', error.message);
                throw new Error(`Failed to send email: ${error.message}`);
            }
        }

        // Register the function in global context
        if (!context.actions.sendMailgunEmail) {
            context.actions.sendMailgunEmail = sendMailgunEmail;
        }

        console.log('Mailgun send email action registered in global context.');
    },
};
