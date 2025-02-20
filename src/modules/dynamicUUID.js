const crypto = require('crypto');

// Function to generate a UUID deterministically from an ID
function generateDeterministicUUID(tableName, recordId, secretSalt) {
    const hmac = crypto.createHmac("sha256", secretSalt);
    hmac.update(`${tableName}:${recordId}`);
    const hash = hmac.digest("hex");

    // Format into UUID v7 style (version '7' in the UUID)
    return [
        hash.substring(0, 8),
        hash.substring(8, 4),
        "7" + hash.substring(12, 3), // Set UUID v7 version
        hash.substring(16, 4),
        hash.substring(20, 12),
    ].join("-");
}


module.exports = { generateDeterministicUUID };