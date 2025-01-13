const request = require('supertest');
const jwt = require('jsonwebtoken');
const FlexAPIServer = require('../server2'); // Adjust the path to your server.js file

let serverInstance;
let app;

beforeAll(async () => {
    // Initialize and start the server
    serverInstance = new FlexAPIServer({
        port: 4000,
        configPath: '../config/apiConfig.json', // Adjust path if needed
    });

    app = await serverInstance.start();
    console.log('FlexAPI Server is running on port 4000');

    // Add a delay to ensure server is fully started
    await new Promise(resolve => setTimeout(resolve, 4000)); // Adjust delay as needed
});

afterAll(() => {
    // Close the server
    serverInstance.close();
});

describe('OAuth Authentication', () => {
    let token;

    test('should authenticate user and return token from /api/login', async () => {
        const res = await request(app)
            .post('/api/login')
            .send({
                username: 'testuser', 
                password: 'testpassword', 
            });

        console.log('Login Response:', res.body); // Debug if needed
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty('token'); // Ensure token is in the response

        token = res.body.token; // Save token for subsequent tests
    });

    test('should authenticate user with valid OAuth token', async () => {
        const res = await request(app)
            .get('/api/products') 
            .set('Authorization', `Bearer ${token}`);

        console.log('Protected Route Response:', res.body); // Debug if needed
        expect(res.statusCode).toBe(200);
        expect(res.statusCode).not.toBe(401);
        expect(res.statusCode).not.toBe(403);
        expect(res.statusCode).not.toBe(404);
    });

    test('should reject user with invalid token', async () => {
        const res = await request(app)
            .get('/api/products')
            .set('Authorization', 'Bearer invalidtoken');

        expect(res.statusCode).toBe(403);
        expect(res.body).toHaveProperty('error', 'Forbidden');
    });

    test('should reject user with no token', async () => {
        const res = await request(app)
            .get('/api/products')
            .set('Authorization', '');

        expect(res.statusCode).toBe(401);
        expect(res.body).toHaveProperty('error', 'Unauthorized');
    });
});