# Notification System Documentation

The notification system provides a unified interface for sending notifications across multiple channels (email, SMS, and push notifications) with support for templating, rate limiting, and delivery tracking.

## Features

- Multi-channel notification support (Email, SMS, Push)
- Template-based content management
- Rate limiting and throttling
- Delivery tracking and status monitoring
- Retry mechanisms with exponential backoff
- Comprehensive error handling
- Audit logging

## Services

### Email Service

Handles email notifications with support for HTML templates and attachments.

```javascript
// Send a welcome email
await notificationService.send({
    channels: ['email'],
    templates: { email: 'welcome' },
    recipients: { email: 'user@example.com' },
    data: {
        name: 'John Doe',
        appName: 'MyApp',
        dashboardUrl: 'https://app.example.com'
    }
});
```

### SMS Service

Manages SMS notifications with rate limiting and delivery tracking.

```javascript
// Send a verification code
await notificationService.send({
    channels: ['sms'],
    templates: { sms: 'verification' },
    recipients: { phone: '+1234567890' },
    data: {
        code: '123456',
        expiryMinutes: 5
    }
});
```

### Push Service

Handles push notifications across multiple platforms (iOS, Android, Web) using Firebase Cloud Messaging.

```javascript
// Send a push notification
await notificationService.send({
    channels: ['push'],
    templates: { push: 'notification' },
    recipients: { deviceToken: 'device-token' },
    data: {
        title: 'New Message',
        message: 'You have a new message',
        actionUrl: 'https://app.example.com/messages'
    }
});
```

## Multi-Channel Notifications

Send notifications across multiple channels simultaneously:

```javascript
await notificationService.send({
    channels: ['email', 'sms', 'push'],
    templates: {
        email: 'welcome',
        sms: 'welcome',
        push: 'notification'
    },
    recipients: {
        email: 'user@example.com',
        phone: '+1234567890',
        deviceToken: 'device-token'
    },
    data: {
        name: 'John Doe',
        appName: 'MyApp',
        message: 'Welcome to MyApp!'
    }
});
```

## Templates

### Email Templates
Located in `templates/email/`:
- `welcome.html`: New user welcome email
- `notification.html`: General notification template

### SMS Templates
Located in `templates/sms/`:
- `verification.txt`: Verification code template
- `notification.txt`: General notification template
- `alert.txt`: High-priority alert template

### Push Templates
Located in `templates/push/`:
- `notification.json`: Standard push notification
- `alert.json`: High-priority alert notification
- `update.json`: Low-priority update notification

## Environment Variables

```env
# Email Configuration
EMAIL_SERVICE=gmail
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-specific-password
EMAIL_FROM=noreply@yourapp.com

# SMS Configuration (Twilio)
TWILIO_ACCOUNT_SID=your-account-sid
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_FROM_NUMBER=+1234567890

# Firebase Configuration
GOOGLE_APPLICATION_CREDENTIALS=path/to/firebase-credentials.json
```

## Rate Limiting

### SMS
- 5 messages per hour per phone number
- Configurable in `smsService.js`

### Push Notifications
- 100 notifications per hour per device
- Configurable in `pushService.js`

## Error Handling

All notification methods return a result object:

```javascript
{
    success: boolean,
    results: {
        email?: object,
        sms?: object,
        push?: object
    },
    errors?: [
        {
            channel: string,
            error: string
        }
    ]
}
```

## Logging and Monitoring

All notification activities are logged with:
- Request ID for tracking
- Channel-specific details
- Delivery status
- Error information

## Best Practices

1. Template Management:
   - Keep templates simple and reusable
   - Use consistent variables across templates
   - Test templates across different clients/devices

2. Error Handling:
   - Always check the response status
   - Implement retry logic for transient failures
   - Log all delivery failures for monitoring

3. Rate Limiting:
   - Respect channel-specific limits
   - Implement queuing for bulk notifications
   - Monitor rate limit usage

4. Security:
   - Validate all recipient information
   - Sanitize template variables
   - Use environment variables for sensitive credentials

## Usage in Business Rules

Example business rule using the notification system:

```javascript
when "user.registered" then
    send_multi_channel_notification
        channels: ["email", "sms"]
        templates: {
            email: "welcome",
            sms: "welcome"
        }
        recipients: {
            email: "${user.email}",
            phone: "${user.phone}"
        }
        data: {
            name: "${user.name}",
            appName: "MyApp"
        }
end
```

## Extending the System

To add a new notification channel:

1. Create a new service in `src/services/notification/`
2. Add templates in `templates/[channel]/`
3. Update `NotificationService` to support the new channel
4. Add channel-specific configuration to environment variables
5. Update documentation with new channel details

## Troubleshooting

Common issues and solutions:

1. Email Not Sending
   - Check SMTP credentials
   - Verify recipient email format
   - Check spam folder
   - Review email service logs

2. SMS Failures
   - Verify phone number format (E.164)
   - Check Twilio balance
   - Review rate limit status
   - Verify sender number is valid

3. Push Notification Issues
   - Validate FCM token
   - Check Firebase credentials
   - Verify payload format
   - Review Firebase Console logs
