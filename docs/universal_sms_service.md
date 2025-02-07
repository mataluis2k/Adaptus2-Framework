# Universal SMS Service Documentation

The Universal SMS Service provides a flexible, provider-agnostic interface for sending SMS messages. It supports multiple SMS providers through an adapter pattern, allowing easy integration of new providers while maintaining a consistent API.

## Supported Providers

- Twilio
- Nexmo (Vonage)
- MessageBird

## Features

- Provider-agnostic interface
- Template-based messaging
- Rate limiting
- Phone number validation
- Delivery status tracking
- Retry mechanism
- Comprehensive logging
- Balance checking (provider-dependent)

## Configuration

### Environment Variables

```env
# Default Provider
SMS_PROVIDER=twilio  # Options: twilio, nexmo, messagebird

# Twilio Configuration
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_FROM_NUMBER=+1234567890

# Nexmo Configuration
NEXMO_API_KEY=your_api_key
NEXMO_API_SECRET=your_api_secret
NEXMO_FROM_NUMBER=+1234567890

# MessageBird Configuration
MESSAGEBIRD_API_KEY=your_api_key
MESSAGEBIRD_FROM_NUMBER=+1234567890
```

### Runtime Configuration

```javascript
const UniversalSMSService = require('./services/notification/sms/universalSMSService');

const smsService = new UniversalSMSService({
    provider: 'twilio',  // Override default provider
    rateLimit: {
        max: 10,         // Messages per window
        window: 3600000  // Window size in ms (1 hour)
    },
    twilio: {
        accountSid: 'custom_sid',
        authToken: 'custom_token',
        fromNumber: '+1234567890'
    }
});
```

## Usage

### Basic Sending

```javascript
// Send using template
await smsService.send({
    to: '+1234567890',
    template: 'verification',
    data: {
        code: '123456',
        expiryMinutes: 5
    }
});

// Check message status
const status = await smsService.getStatus('message_id');
```

### Number Validation

```javascript
// Validate phone number
const validation = await smsService.validateNumber('+1234567890');
console.log(validation);
// {
//     valid: true,
//     countryCode: 'US',
//     type: 'mobile',
//     ...provider-specific-data
// }
```

### Balance Check

```javascript
// Check account balance (if supported by provider)
try {
    const balance = await smsService.getBalance();
    console.log(balance);
    // {
    //     amount: 100.50,
    //     currency: 'USD',
    //     ...provider-specific-data
    // }
} catch (error) {
    console.error('Balance check not supported by current provider');
}
```

### Provider Features

```javascript
// Get provider capabilities
const features = smsService.getProviderFeatures();
console.log(features);
// {
//     supportsValidation: true,
//     supportsBalance: true,
//     provider: 'twilio'
// }
```

## Templates

Templates are stored in `templates/sms/` directory:

- `verification.txt`: For verification codes
- `notification.txt`: For general notifications
- `alert.txt`: For urgent messages

Example template:
```txt
Your {{appName}} verification code is: {{code}}

This code will expire in {{expiryMinutes}} minutes.
```

## Adding New Providers

1. Create a new adapter in `src/services/notification/sms/adapters/`:

```javascript
class NewProviderAdapter {
    constructor(config) {
        // Initialize provider client
    }

    async send(to, message) {
        // Implement send logic
        // Must return: { success, messageId, provider, status }
    }

    async getStatus(messageId) {
        // Implement status check
        // Must return: { messageId, status, provider, timestamp }
    }

    // Optional methods
    async validateNumber(number) {
        // Implement number validation
    }

    async balance() {
        // Implement balance check
    }
}
```

2. Update UniversalSMSService:

```javascript
// Add import
const NewProviderAdapter = require('./adapters/newProviderAdapter');

// Add to initializeAdapter method
switch (this.provider.toLowerCase()) {
    case 'newprovider':
        return new NewProviderAdapter(adapterConfig);
    // ...
}
```

## Error Handling

The service provides consistent error handling across providers:

```javascript
try {
    await smsService.send({
        to: '+1234567890',
        template: 'notification',
        data: { message: 'Hello!' }
    });
} catch (error) {
    if (error.message.includes('Rate limit exceeded')) {
        // Handle rate limiting
    } else if (error.message.includes('Invalid phone number')) {
        // Handle validation errors
    } else {
        // Handle other errors
    }
}
```

## Best Practices

1. Provider Selection:
   - Choose default provider in environment variables
   - Override per-instance if needed
   - Consider provider costs and features

2. Rate Limiting:
   - Set appropriate limits based on your use case
   - Monitor rate limit usage
   - Implement queuing for bulk messages

3. Templates:
   - Keep templates simple and reusable
   - Use consistent variable naming
   - Include necessary disclaimers

4. Error Handling:
   - Always implement proper error handling
   - Log errors with context
   - Consider implementing fallback providers

5. Monitoring:
   - Monitor delivery rates
   - Track costs
   - Set up alerts for failures

## Troubleshooting

1. Message Not Sending
   - Check provider credentials
   - Verify phone number format
   - Check rate limits
   - Review provider balance

2. Template Issues
   - Verify template exists
   - Check template variables
   - Validate template syntax

3. Rate Limiting
   - Review rate limit settings
   - Monitor message volume
   - Implement queuing if needed

4. Provider-Specific Issues
   - Check provider status page
   - Verify account status
   - Review provider documentation
