const express = require('express');
const request = require('supertest');
const requestLogger = require('../middleware/requestLoggingMiddleware');
const crypto = require('crypto');

// Mock environment variables
process.env.REQUEST_LOGGING_ENABLED = 'true';
process.env.REQUEST_LOGGING_ENCRYPT = 'true';
process.env.REQUEST_LOGGING_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
process.env.REQUEST_LOGGING_TABLE = 'test_request_logs';

describe('Request Logging Middleware', () => {
    let app;
    
    beforeAll(async () => {
        // Create Express app
        app = express();
        
        // Add body parser
        app.use(express.json());
        
        // Add request logging middleware
        app.use(requestLogger.middleware());
        
        // Test routes
        app.get('/test', (req, res) => {
            res.json({ message: 'GET test successful' });
        });
        
        app.post('/test', (req, res) => {
            res.json({ 
                message: 'POST test successful',
                receivedData: req.body
            });
        });
        
        app.get('/error', (req, res) => {
            res.status(500).json({ error: 'Test error' });
        });

        // Wait for table creation
        await new Promise(resolve => setTimeout(resolve, 1000));
    });

    test('should log GET request', async () => {
        const response = await request(app)
            .get('/test')
            .set('User-Agent', 'test-agent');

        expect(response.status).toBe(200);
        
        // Wait for log to be written
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Get the last log entry
        const log = await requestLogger.getRequestLog(response.body.requestId);
        
        expect(log).toBeDefined();
        expect(log.method).toBe('GET');
        expect(log.path).toBe('/test');
        expect(log.response_status).toBe(200);
        expect(log.user_agent).toBe('test-agent');
    });

    test('should log POST request with body', async () => {
        const testData = { key: 'value' };
        
        const response = await request(app)
            .post('/test')
            .send(testData)
            .set('User-Agent', 'test-agent');

        expect(response.status).toBe(200);
        
        // Wait for log to be written
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Get the last log entry
        const log = await requestLogger.getRequestLog(response.body.requestId);
        
        expect(log).toBeDefined();
        expect(log.method).toBe('POST');
        expect(log.path).toBe('/test');
        expect(log.response_status).toBe(200);
        if (process.env.REQUEST_LOGGING_ENCRYPT === 'true') {
            expect(log.body).toEqual(testData);  // Should be automatically decrypted
        } else {
            expect(JSON.parse(log.body)).toEqual(testData);
        }
    });

    test('should log error responses', async () => {
        const response = await request(app)
            .get('/error')
            .set('User-Agent', 'test-agent');

        expect(response.status).toBe(500);
        
        // Wait for log to be written
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Get the last log entry
        const log = await requestLogger.getRequestLog(response.body.requestId);
        
        expect(log).toBeDefined();
        expect(log.method).toBe('GET');
        expect(log.path).toBe('/error');
        expect(log.response_status).toBe(500);
    });

    test('should handle query parameters', async () => {
        const response = await request(app)
            .get('/test?param1=value1&param2=value2')
            .set('User-Agent', 'test-agent');

        expect(response.status).toBe(200);
        
        // Wait for log to be written
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Get the last log entry
        const log = await requestLogger.getRequestLog(response.body.requestId);
        
        expect(log).toBeDefined();
        expect(log.query_params).toBeDefined();
        const params = JSON.parse(log.query_params);
        expect(params.param1).toBe('value1');
        expect(params.param2).toBe('value2');
    });

    test('should measure request duration', async () => {
        // Add a slow route
        app.get('/slow', async (req, res) => {
            await new Promise(resolve => setTimeout(resolve, 100));
            res.json({ message: 'Slow response' });
        });

        const response = await request(app)
            .get('/slow')
            .set('User-Agent', 'test-agent');

        expect(response.status).toBe(200);
        
        // Wait for log to be written
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Get the last log entry
        const log = await requestLogger.getRequestLog(response.body.requestId);
        
        expect(log).toBeDefined();
        expect(log.duration_ms).toBeGreaterThanOrEqual(100);
    });

    test('should cleanup old logs', async () => {
        // Create some old logs
        const oldDate = new Date();
        oldDate.setDate(oldDate.getDate() - 31);  // 31 days old
        
        // Get current count
        const beforeCount = await requestLogger.getLogsCount();
        
        // Cleanup logs older than 30 days
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        await requestLogger.cleanup(thirtyDaysAgo);
        
        // Get new count
        const afterCount = await requestLogger.getLogsCount();
        
        expect(afterCount).toBeLessThan(beforeCount);
    });

    test('should handle large payloads', async () => {
        const largeData = {
            array: Array(1000).fill('test string'),
            nested: {
                data: Array(1000).fill({ key: 'value' })
            }
        };
        
        const response = await request(app)
            .post('/test')
            .send(largeData)
            .set('User-Agent', 'test-agent');

        expect(response.status).toBe(200);
        
        // Wait for log to be written
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Get the last log entry
        const log = await requestLogger.getRequestLog(response.body.requestId);
        
        expect(log).toBeDefined();
        if (process.env.REQUEST_LOGGING_ENCRYPT === 'true') {
            expect(log.body).toEqual(largeData);  // Should be automatically decrypted
        } else {
            expect(JSON.parse(log.body)).toEqual(largeData);
        }
    });
});
