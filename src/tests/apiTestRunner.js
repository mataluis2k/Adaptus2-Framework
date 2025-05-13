const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { oadConfig, getApiConfig } = require('../modules/apiConfig');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

const API_BASE_URL = process.env.API_TEST_URL || 'http://localhost:3000';
const AUTH_TOKEN = process.env.TEST_AUTH_TOKEN || ''; // Read authentication token from .env

async function runTests() {
    console.log('Loading API configuration...');
    apiConfig = await loadConfig();

    if (!Array.isArray(apiConfig) || apiConfig.length === 0) {
        console.error('No API configuration found. Exiting...');
        process.exit(1);
    }

    console.log('Running automated tests...');
    for (const endpoint of apiConfig) {
        if (!endpoint.route || !endpoint.allowMethods) continue;
        
        const url = `${API_BASE_URL}${endpoint.route}`;
        const headers = endpoint.auth ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {};
        
        if (endpoint.allowMethods.includes('GET')) {
            await testGetRequest(url, endpoint, headers);
        }
        if (endpoint.allowMethods.includes('POST')) {
            await testPostRequest(url, endpoint, headers);
        }
        if (endpoint.allowMethods.includes('PUT')) {
            await testPutRequest(url, endpoint, headers);
        }
        if (endpoint.allowMethods.includes('DELETE')) {
            await testDeleteRequest(url, endpoint, headers);
        }
    }

    console.log('All tests completed.');
}

async function testGetRequest(url, endpoint, headers) {
    try {
        console.log(`Testing GET ${url}`);
        const response = await axios.get(url, { headers });
        console.log(`✅ GET ${url} - Status: ${response.status}`);
    } catch (error) {
        console.error(`❌ GET ${url} - Error: ${error.message}`);
    }
}

async function testPostRequest(url, endpoint, headers) {
    try {
        console.log(`Testing POST ${url}`);
        const sampleData = createTestData(endpoint.allowWrite);
        const response = await axios.post(url, sampleData, { headers });
        console.log(`✅ POST ${url} - Status: ${response.status}`);
    } catch (error) {
        console.error(`❌ POST ${url} - Error: ${error.message}`);
    }
}

async function testPutRequest(url, endpoint, headers) {
    try {
        console.log(`Testing PUT ${url}`);
        const sampleData = createTestData(endpoint.allowWrite);
        const response = await axios.put(url, sampleData, { headers });
        console.log(`✅ PUT ${url} - Status: ${response.status}`);
    } catch (error) {
        console.error(`❌ PUT ${url} - Error: ${error.message}`);
    }
}

async function testDeleteRequest(url, endpoint, headers) {
    try {
        console.log(`Testing DELETE ${url}`);
        const response = await axios.delete(url, { headers });
        console.log(`✅ DELETE ${url} - Status: ${response.status}`);
    } catch (error) {
        console.error(`❌ DELETE ${url} - Error: ${error.message}`);
    }
}

function createTestData(fields) {
    const sampleData = {};
    fields.forEach(field => {
        sampleData[field] = `test-${Math.random().toString(36).substr(2, 5)}`;
    });
    return sampleData;
}

if (process.argv.includes('--testEndpoints')) {
    runTests();
}
