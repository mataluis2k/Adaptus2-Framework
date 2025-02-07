# Request Logging Middleware Documentation

The Request Logging Middleware provides comprehensive request and response logging capabilities with database storage, encryption, and configurable retention policies.

## Features

- Complete request/response logging
- Payload encryption support
- Automatic table creation
- Request timing
- User tracking
- IP and User Agent logging
- Query parameter logging
- Configurable retention
- Performance optimized with indexes

## Configuration

### Environment Variables

```env
# Enable/Disable Request Logging
REQUEST_LOGGING_ENABLED=true

# Encryption Settings
REQUEST_LOGGING_ENCRYPT=true
REQUEST_LOGGING_ENCRYPTION_KEY=your_32_byte_hex_key

# Table Configuration
REQUEST_LOGGING_TABLE=request_logs
```

## Usage

### Basic Setup

```javascript
const requestLogger = require('./middleware/requestLoggingMiddleware');

// Apply middleware to all routes
app.use(requestLogger.middleware());

// Or apply to specific routes
app.use('/api', requestLogger.middleware());
```

### Retrieving Logs

```javascript
// Get log by request ID
const log = await requestLogger.getRequestLog('request-uuid');
console.log(log);
// {
//     request_id: 'uuid',
//     timestamp_start: '2025-02-06T12:00:00.000Z',
//     method: 'POST',
//     url: '/api/endpoint',
//     body: { /* decrypted request body */ },
//     response_body: { /* decrypted response body */ },
//     duration_ms: 123,
//     ...
// }
```

### Cleanup Old Logs

```javascript
// Delete logs older than 30 days
const thirtyDaysAgo = new Date();
thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

const deletedCount = await requestLogger.cleanup(thirtyDaysAgo);
console.log(`Deleted ${deletedCount} old logs`);
```

## Database Schema

The middleware automatically creates a table with the following schema:

```sql
CREATE TABLE request_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    request_id VARCHAR(36) NOT NULL,
    timestamp_start TIMESTAMP(6) NOT NULL,
    timestamp_end TIMESTAMP(6) NOT NULL,
    method VARCHAR(10) NOT NULL,
    url TEXT NOT NULL,
    path TEXT NOT NULL,
    query_params TEXT,
    headers TEXT,
    body TEXT,
    response_body TEXT,
    response_status INT,
    ip_address VARCHAR(45),
    user_agent TEXT,
    user_id VARCHAR(255),
    duration_ms INT,
    encrypted BOOLEAN DEFAULT false,
    INDEX idx_request_id (request_id),
    INDEX idx_timestamp_start (timestamp_start),
    INDEX idx_method (method),
    INDEX idx_status (response_status),
    INDEX idx_user_id (user_id)
);
```

## Encryption

When encryption is enabled:
- Request bodies are encrypted using AES-256-GCM
- Each encrypted value includes IV and auth tag
- Encryption key must be a 32-byte hex string
- Decryption happens automatically when retrieving logs

## Performance Considerations

1. Database Indexes:
   - request_id for quick lookups
   - timestamp_start for cleanup operations
   - method and status for analytics
   - user_id for user activity tracking

2. Storage Requirements:
   - TEXT fields for large payloads
   - Compressed indexes for efficiency
   - Consider regular cleanup of old logs

3. Memory Usage:
   - Streaming response capture
   - Efficient encryption handling
   - Minimal memory overhead

## Best Practices

1. Security:
   - Enable encryption in production
   - Regularly rotate encryption keys
   - Sanitize sensitive headers
   - Implement retention policies

2. Performance:
   - Set appropriate cleanup intervals
   - Monitor table size
   - Index frequently queried fields

3. Maintenance:
   - Regular cleanup of old logs
   - Monitor disk usage
   - Archive important logs

## Error Handling

The middleware handles errors gracefully:
- Failed logs don't affect request processing
- Encryption failures are logged
- Database errors are caught and logged
- Table creation retries on failure

## Monitoring

Monitor the following aspects:
1. Table size and growth rate
2. Log insertion performance
3. Cleanup operation success
4. Encryption/decryption errors

## Example Queries

### Find Slow Requests
```sql
SELECT *
FROM request_logs
WHERE duration_ms > 1000
ORDER BY duration_ms DESC
LIMIT 10;
```

### Error Analysis
```sql
SELECT 
    response_status,
    COUNT(*) as count,
    AVG(duration_ms) as avg_duration
FROM request_logs
WHERE response_status >= 400
GROUP BY response_status;
```

### User Activity
```sql
SELECT 
    user_id,
    COUNT(*) as request_count,
    AVG(duration_ms) as avg_duration
FROM request_logs
WHERE user_id IS NOT NULL
GROUP BY user_id
ORDER BY request_count DESC;
```

## Troubleshooting

1. Logging Not Working
   - Check REQUEST_LOGGING_ENABLED setting
   - Verify database connection
   - Check table permissions

2. Encryption Issues
   - Verify encryption key format
   - Check key length (must be 32 bytes)
   - Ensure consistent key across instances

3. Performance Issues
   - Check index usage
   - Monitor table size
   - Review cleanup schedule

4. Missing Data
   - Check middleware order
   - Verify response capture
   - Check error logs
