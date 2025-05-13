const splitCommandAndData = (commandString) => {
  const commandRegex = /^command:\s*(\w+)\s*data:\s*(\{.*\})$/;
  const match = commandString.match(commandRegex);

  if (!match) {
      throw new Error(`Invalid command string format: ${commandString}`);
  }

  const command = match[1]; // Extracts the command name
  const rawData = match[2]; // Extracts the JSON-like data string

  let data;
  try {
      data = JSON.parse(rawData); // Parse the data into a JSON object
  } catch (err) {
      throw new Error(`Failed to parse data as JSON: ${err.message}`);
  }

  return { command, data };
};
// Example usage (CommonJS)
const commandString1 = 'command: rawQuery data:{ "query": "select template from templates where template name = \'welcome\'" }';
const commandString2 = 'command: otherCommand data:{ "key1": "value1", "key2": { "nested": "object" } }';
const commandString3 = 'command: badJson data:{ this is not valid json }';
const commandString4 = 'bad command format';
const commandString5 = 'command: complexJson data:{ "query": "select * from table where field = \\"quoted value\\"" }'; // Escaped quotes

try {
  const result1 = splitCommandAndData(commandString1);
  console.log("Result 1:", result1);
} catch (error) {
  console.error("Error 1:", error.message);
}

try {
  const result2 = splitCommandAndData(commandString2);
  console.log("Result 2:", result2);
} catch (error) {
  console.error("Error 2:", error.message);
}

try {
  const result3 = splitCommandAndData(commandString3);
  console.error("Error 3:", error.message);
} catch (error) {
  console.error("Error 3:", error.message);
}

try {
    const result4 = splitCommandAndData(commandString4);
    console.error("Error 4:", error.message);
  } catch (error) {
    console.error("Error 4:", error.message);
  }

try {
    const result5 = splitCommandAndData(commandString5);
    console.log("Result 5:", result5);
  } catch (error) {
    console.error("Error 5:", error.message);
  }

module.exports = splitCommandAndData;

