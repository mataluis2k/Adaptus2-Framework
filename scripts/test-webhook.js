const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const axios = require('axios');
const { config: env } = require('dotenv');
const path = require('path');

env({ path: path.resolve(__dirname, '../.env') });

console.log('=== Webhook Test ===');

// Configuration
const config = {
    jwtSecret: process.env.JWT_SECRET || 'your-jwt-secret',
    webhookSecret: process.env.WEBHOOK_SECRET,
    serverUrl: process.env.SERVER_URL || 'http://localhost:3000',
    tableName: 'clickBank'
};

// Sample payload
const payload = {
    customer_name: "John Doe",
    email: "john@example.com",
    order_amount: 99.99,
    is_priority: true,
    order_date: new Date().toISOString()
};

// Generate JWT token
function generateToken() {
    return jwt.sign(
        { 
            table: config.tableName,
            permissions: ['table_create','table_write']
        },
        config.jwtSecret
    );
}

// Generate webhook signature
async function generateSignature(payload) {
    if (!config.webhookSecret) return null;
    
    const hmac = await crypto.createHmac('sha256', config.webhookSecret);
    return hmac.update(JSON.stringify(payload)).digest('hex');
}

// Test the webhook
async function testWebhook() {
    try {
        const token = generateToken();
        const signature = await generateSignature(payload);
        
        console.log('\n=== Webhook Test ===');
        console.log('Target URL:', `${config.serverUrl}/webhook/catch-all`);
        console.log('Table Name:', config.tableName);
        console.log('Payload:', JSON.stringify(payload, null, 2));

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        };

        if (signature) {
            headers['X-Webhook-Signature'] = signature;
            console.log('Webhook Signature:', signature);
        }

        const response = await axios.post(
            `${config.serverUrl}/webhook/catch-all`,
            payload,
            { headers }
        );

        console.log('\n=== Response ===');
        console.log('Status:', response.status);
        console.log('Data:', JSON.stringify(response.data, null, 2));

    } catch (error) {
        console.error('\n=== Error ===');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('Error:', error.message);
        }
    }
}

// Run the test
testWebhook();
