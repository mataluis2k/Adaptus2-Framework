const crypto = require('crypto');

module.exports = (redis) => {
  // Function to store mapping in Redis using a column-specific key.
  async function storeUUIDMapping(tableName, column, recordId, uuid) {
    // Build a key that includes the table name, column, and UUID.
    const key = `uuid_map:${tableName}:${column}:${uuid}`;
    await redis.set(key, recordId);
  }

  // Function to retrieve the original ID from a UUID using a column-specific key.
  async function getOriginalIdFromUUID(tableName, column, uuid) {
    const key = `uuid_map:${tableName}:${column}:${uuid}`;
    const recordId = await redis.get(key);
    return recordId || null; // Return null if not found
  }

  // Function to generate a UUID deterministically from an ID and column name.
  function generateDeterministicUUID(tableName, column, recordId, secretSalt) {
    const hmac = crypto.createHmac("sha256", secretSalt);
    // Incorporate table name, column, and recordId for a column-specific hash.
    hmac.update(`${tableName}:${column}:${recordId}`);
    const hash = hmac.digest("hex");
    // Use the first 32 hex digits to format into a UUID-like string.
    const shortHash = hash.substring(0, 32);
    return [
      shortHash.substring(0, 8),
      shortHash.substring(8, 12),
      "7" + shortHash.substring(13, 16), // Force version '7'
      shortHash.substring(16, 20),
      shortHash.substring(20, 32),
    ].join("-");
  }

  return { storeUUIDMapping, getOriginalIdFromUUID, generateDeterministicUUID };
};