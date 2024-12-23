const jwt = require('jsonwebtoken');

// Use the secret from your .env file
const JWT_SECRET = 'mysecret';

// Payload for the token
const payload = {
    username: "testUser",
    acl: "publicAccess" // Adjust based on your API's access requirements
};

// Generate a token
const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });

console.log("Your JWT Token:", token);
