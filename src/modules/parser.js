// parse-command.js
module.exports = function parseCommand(commandString) {
  // Step 1: Trim and split into tokens by whitespace
  const trimmed = commandString.trim();
  if (!trimmed) return { type: '' };

  // The first token is our type, the rest is for parsing
  const [type, ...restTokens] = trimmed.split(/\s+/);
  const result = { type };

  // Combine everything after the type into a single string for easier searching
  const restString = restTokens.join(' ');

  // Step 2: Check if there's a "data:" substring
  const dataIndex = restString.indexOf('data:');
  if (dataIndex !== -1) {
    // Everything before data: might have key:value pairs
    const beforeData = restString.slice(0, dataIndex).trim();
    // Everything after data: is the data property
    const afterData = restString.slice(dataIndex + 'data:'.length).trim();
    // Parse any key:value pairs in beforeData
    parseKeyValuePairs(beforeData, result);
    // Set data
    result.data = afterData;
  } else {
    // No data: found, parse key:value pairs in the entire remainder
    // If we don't find any, store the entire leftover as data
    const hadPairs = parseKeyValuePairs(restString, result);
    if (!hadPairs) {
      // No key:value pairs -> store everything in data
      result.data = restString;
    }
  }

  return result;
};

/**
 * Attempts to parse key:value pairs in a string.
 * Adds them to the result object, returning true if any were found.
 */
function parseKeyValuePairs(str, resultObj) {
  // This regex captures pairs like key:someValue or key:"some value"
  // (Naive approach: won't handle nested braces, etc.)
  const pairRegex = /(\w+)\s*:\s*("[^"]*"|\S+)/g;

  let foundAny = false;
  let match;
  while ((match = pairRegex.exec(str)) !== null) {
    const key = match[1];
    let value = match[2];
    // Remove outer quotes if present
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    resultObj[key] = value;
    foundAny = true;
  }
  return foundAny;
}
