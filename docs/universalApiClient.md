# Building Plugins for the Adaptus2 Framework Using `UniversalApiClient`

The `UniversalApiClient` is a versatile HTTP client designed for modular plugin development within the Adaptus2 framework. This guide walks you through building a plugin using the `UniversalApiClient`, highlighting its features and capabilities.

---

## **What is the `UniversalApiClient`?**
The `UniversalApiClient` simplifies API interactions by providing:
1. **Base URL Management**: Centralized configuration for API requests.
2. **Dynamic Headers**: Support for custom and authentication headers.
3. **Authentication**: Includes support for `Bearer Token` and `API Key` authentication.
4. **CRUD Operations**: Supports `GET`, `POST`, `PUT`, and `DELETE` methods.
5. **Error Handling**: Centralized error management for robust API integrations.

---

## **Key Features**
- **Plugin Compatibility**: Easily integrates with the Adaptus2 framework's global context.
- **Dynamic Configuration**: Leverages environment variables or context-driven settings for runtime flexibility.
- **Custom Headers**: Extend or override headers as needed.
- **Reusability**: Write plugins for different APIs without duplicating code.

---

## **Building a Plugin with `UniversalApiClient`**

### **1. Create the Plugin Module**
Here’s a step-by-step example of creating a Mailgun plugin:

### **Example: Mailgun Plugin**
```javascript
require('dotenv').config();

module.exports = {
    name: 'mailgunPlugin',
    version: '1.0.0',

    initialize(dependencies) {
        const { context, customRequire } = dependencies;
        const UniversalApiClient = customRequire('../src/modules/universalAPIClient');

        // Ensure global context is available
        if (!context || !context.actions) {
            throw new Error('Global context with actions is required for Mailgun Plugin.');
        }

        /**
         * Sends an email via Mailgun.
         * @param {Object} ctx - Context containing configurations.
         * @param {Object} params - Email parameters: { to, subject, text, html }.
         */
        async function sendMailgunEmail(ctx, params) {
            const { to, subject, text, html } = params;

            // Validate input
            if (!to || !subject || (!text && !html)) {
                throw new Error(
                    'Invalid parameters. Ensure "to", "subject", and either "text" or "html" are provided.'
                );
            }

            // Load configuration
            const mailgunBaseUrl = ctx.config.mailgunBaseUrl || process.env.MAILGUN_BASE_URL;
            const mailgunApiKey = ctx.config.mailgunApiKey || process.env.MAILGUN_API_KEY;
            const mailgunDomain = ctx.config.mailgunDomain || process.env.MAILGUN_DOMAIN;

            if (!mailgunBaseUrl || !mailgunApiKey || !mailgunDomain) {
                throw new Error(
                    'Missing Mailgun configuration. Ensure MAILGUN_BASE_URL, MAILGUN_API_KEY, and MAILGUN_DOMAIN are set.'
                );
            }

            // Initialize API Client
            const apiClient = new UniversalApiClient({
                baseUrl: mailgunBaseUrl,
                authType: 'apiKey',
                authValue: `api:${mailgunApiKey}`,
            });

            // Prepare payload
            const data = new URLSearchParams();
            data.append('from', `Mailgun Sandbox <mailgun@${mailgunDomain}>`);
            data.append('to', to);
            data.append('subject', subject);
            if (text) data.append('text', text);
            if (html) data.append('html', html);

            // Make API request
            try {
                const response = await apiClient.post(`/v3/${mailgunDomain}/messages`, data.toString(), {
                    'Content-Type': 'application/x-www-form-urlencoded',
                });
                console.log('Mailgun email sent successfully:', response);
                return response;
            } catch (error) {
                console.error('Error sending Mailgun email:', error.message);
                throw new Error(`Failed to send email: ${error.message}`);
            }
        }

        // Register the action in the global context
        if (!context.actions.sendMailgunEmail) {
            context.actions.sendMailgunEmail = sendMailgunEmail;
        }

        console.log('Mailgun send email action registered in global context.');
    },
};
```

---

## **Using the Plugin**

### **1. Add the Plugin**
Ensure the plugin is loaded during framework initialization:
```javascript
const mailgunPlugin = require('./plugins/mailgunPlugin');
mailgunPlugin.initialize({ context: globalContext, customRequire: require });
```

### **2. Use the Registered Action**
Call the `sendMailgunEmail` action from the global context:
```javascript
await globalContext.actions.sendMailgunEmail(globalContext, {
    to: 'user@example.com',
    subject: 'Welcome to Adaptus2',
    text: 'This is a plain text email.',
    html: '<p>This is an HTML email.</p>',
});
```

---

## **Customizing the `UniversalApiClient`**

### **Initialization Options**
| Option        | Description                                    | Example                                |
|---------------|------------------------------------------------|----------------------------------------|
| `baseUrl`     | Base URL for the API.                         | `https://api.example.com`             |
| `headers`     | Default headers.                              | `{ 'Content-Type': 'application/json' }` |
| `authType`    | Authentication type (`token` or `apiKey`).    | `apiKey`                              |
| `authValue`   | Authentication value.                        | `api:your-api-key`                    |
| `authHeader`  | Header name for authentication (default: `Authorization`). | `x-api-key`                          |

---

## **Extending Plugin Functionality**

### Adding Custom Actions
Register additional API-related actions:
```javascript
async function customAction(ctx, params) {
    const apiClient = new UniversalApiClient({ baseUrl: ctx.config.customApiUrl });
    return apiClient.get('/custom-endpoint', params);
}

// Register in global context
context.actions.customAction = customAction;
```

---

## **Error Handling**
The `handleError` method ensures robust error management:
1. **API Response Errors**: Logs and throws issues with the API response.
2. **Network Errors**: Identifies network or connection issues.
3. **Configuration Errors**: Ensures all required configurations are loaded.

---

## **Best Practices**
1. **Centralize Configuration**: Use `.env` for environment-specific settings.
2. **Modular Development**: Create plugins for specific APIs to keep code clean.
3. **Dynamic Headers**: Override headers as needed for different requests.

By leveraging `UniversalApiClient`, you can build powerful, reusable plugins that seamlessly integrate with the Adaptus2 framework.