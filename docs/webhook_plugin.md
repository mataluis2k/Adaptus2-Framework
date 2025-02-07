# Webhook Plugin Documentation

The catchAllWebhookPlugin provides a secure and flexible way to handle incoming webhooks with dynamic table creation and comprehensive audit logging.

## Features

- Dynamic table creation based on payload structure
- Secure data handling with input validation
- JWT-based authentication with permission control
- Webhook signature verification
- Rate limiting and payload size restrictions
- Comprehensive audit logging
- Transaction support with rollback
- Automatic schema inference

## Configuration

### Environment Variables

```env
JWT_SECRET=your_jwt_secret
WEBHOOK_SECRET=your_webhook_secret  # Optional, for webhook signature verification
DEFAULT_DBTYPE=mysql
DEFAULT_DBCONNECTION=MYSQL_1
NODE_ENV=production
```

### Plugin Schema

The plugin automatically creates and manages its audit log table with the following schema:

```sql
CREATE TABLE webhook_audit_log (
    id INT PRIMARY KEY AUTO_INCREMENT,
    action VARCHAR(50) NOT NULL,
    table_name VARCHAR(64) NOT NULL,
    request_id VARCHAR(36) NOT NULL,
    rows_affected INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_request_id (request_id),
    INDEX idx_table_name (table_name)
);
```

## Security Features

1. **Authentication**: JWT-based with required claims
2. **Input Validation**: 
   - Table name pattern: `^[a-zA-Z][a-zA-Z0-9_]{0,63}$`
   - Column name pattern: `^[a-zA-Z][a-zA-Z0-9_]{0,63}$`
   - Maximum 100 columns per table
3. **Rate Limiting**: 100 requests per 15 minutes
4. **Payload Size**: Limited to 1MB
5. **SQL Injection Prevention**: Parameterized queries
6. **Webhook Signatures**: Optional HMAC-SHA256 verification

## Testing Guide

### Quick Start with Test Script

The easiest way to test the webhook plugin is using the provided test script:

1. Install dependencies:
```bash
npm install jsonwebtoken axios crypto
```

2. Run the test script:
```bash
# With default configuration
node scripts/test-webhook.js

# Or with environment variables
JWT_SECRET=your-secret \
WEBHOOK_SECRET=your-webhook-secret \
SERVER_URL=http://your-server:3000 \
node scripts/test-webhook.js
```

The script will:
- Generate a JWT token with table_create permission
- Create a webhook signature if WEBHOOK_SECRET is set
- Send a test payload to the webhook endpoint
- Display detailed request and response information

### Manual Testing

#### 1. Generate JWT Token

Create a test script (e.g., `generate-token.js`):

```javascript
const jwt = require('jsonwebtoken');

const token = jwt.sign(
    { 
        table: 'test_webhooks',
        permissions: ['table_create']
    },
    process.env.JWT_SECRET
);

console.log(token);
```

Run it:
```bash
node generate-token.js
```

### 2. Basic Webhook Test

This example creates a table and inserts customer data:

```bash
curl -X POST http://localhost:3000/webhook/catch-all \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "customer_name": "John Doe",
    "email": "john@example.com",
    "order_amount": 99.99,
    "is_priority": true,
    "order_date": "2025-02-06T12:00:00Z"
  }'
```

The plugin will:
- Create table 'test_webhooks' if it doesn't exist
- Infer and create columns with appropriate types:
  * customer_name: VARCHAR(255)
  * email: VARCHAR(255)
  * order_amount: DOUBLE
  * is_priority: TINYINT(1)
  * order_date: DATETIME
- Insert the data
- Create audit log entries

### 3. Testing with Webhook Signatures

If you've configured WEBHOOK_SECRET, you can test signature verification:

```bash
# Generate signature
PAYLOAD='{"customer_name":"John Doe","email":"john@example.com"}'
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "YOUR_WEBHOOK_SECRET" | cut -d' ' -f2)

# Send request with signature
curl -X POST http://localhost:3000/webhook/catch-all \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "X-Webhook-Signature: $SIGNATURE" \
  -d "$PAYLOAD"
```

### 4. Error Handling Tests

#### a. Invalid Table Name
```javascript
// Generate token with invalid table name
const token = jwt.sign(
    { 
        table: 'invalid-table-name!',
        permissions: ['table_create']
    },
    process.env.JWT_SECRET
);
```

```bash
curl -X POST http://localhost:3000/webhook/catch-all \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{"test": "data"}'
```

#### b. Missing Permissions
```javascript
// Generate token without table_create permission
const token = jwt.sign(
    { 
        table: 'test_webhooks',
        permissions: []
    },
    process.env.JWT_SECRET
);
```

```bash
curl -X POST http://localhost:3000/webhook/catch-all \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{"test": "data"}'
```

### 5. Monitoring

#### View Audit Logs
```sql
SELECT * FROM webhook_audit_log 
WHERE table_name = 'test_webhooks' 
ORDER BY created_at DESC;
```

## Response Formats

### Successful Response
```json
{
    "message": "Request processed successfully",
    "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### Error Response
```json
{
    "error": "Invalid table name format",
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "type": "WebhookError"
}
```

## Data Type Inference

The plugin automatically infers SQL data types based on the payload values:

| JavaScript Type | SQL Type | Condition |
|----------------|----------|-----------|
| number (integer) | BIGINT | > 2147483647 or < -2147483648 |
| number (integer) | INT | Within 32-bit range |
| number (float) | DOUBLE | Any decimal number |
| boolean | TINYINT(1) | true/false |
| string | TEXT | Length > 255 |
| string | DATETIME | Valid date string |
| string | VARCHAR(255) | Length ≤ 255 |
| object | JSON | Non-Date objects |
| null/undefined | TEXT | Fallback type |

## Best Practices

1. Always store the requestId from responses for tracking
2. Monitor the audit log for operation history
3. Use webhook signatures in production
4. Include proper error handling in your webhook sender
5. Implement retry logic with exponential backoff
6. Keep payload sizes reasonable (under 1MB)
7. Use meaningful table names that match the pattern

## Troubleshooting

1. **401 Unauthorized**: Check JWT token validity and format
2. **403 Forbidden**: Verify permissions in JWT claims
3. **400 Bad Request**: Validate payload format and table name
4. **429 Too Many Requests**: Rate limit exceeded
5. **500 Internal Error**: Check server logs for details

Remember to replace:
- YOUR_JWT_TOKEN with actual generated token
- YOUR_WEBHOOK_SECRET with configured secret
- localhost:3000 with actual server address
