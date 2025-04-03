
const jwt = require('jsonwebtoken');
// get .env variables two levels up
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY = process.env.JWT_EXPIRY;

async function genToken(user, allowRead,authentication) {
    // Generate JWT token
    const tokenPayload = {};
    allowRead.forEach((field) => {
        if(field !== authentication) {
            tokenPayload[field] = user[field];
            if(user['acl']) {
                // convert string acl comma delimited to array
                tokenPayload['acl'] = user['acl'].split(',').map((item) => item.trim());
            }  
        }
    });

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
    return token;
}

module.exports = genToken;