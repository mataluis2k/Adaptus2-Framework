const jwt = require('jsonwebtoken');

// Use the secret from your .env file
const JWT_SECRET = 'P0W3rS3cr3t';

// Payload for the token
const payload = {
    id : 1235,
    username: "testUser",
    acl: "publicAccess" // Adjust based on your API's access requirements
};

// Generate a token
const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '365d' });

console.log("Your JWT Token:", token);
