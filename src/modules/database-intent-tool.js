const { DynamicTool } = require('langchain/tools');
const { getDbConnection } = require('./db'); // Assuming this exists
// Use the global llmModule reference instead of requiring it directly to avoid circular dependency
// const { llmModule } = require('./llmModule');

/**
 * Create a unified database tool that can interpret natural language intents,
 * generate appropriate SQL, and execute it against the database.
 * 
 * @returns {DynamicTool} A LangChain DynamicTool for database operations
 */
function createDatabaseIntentTool() {
  return new DynamicTool({
    name: "database_intent_executor",
    description: "Execute database operations based on natural language intent. Use this tool when you need to query or modify data in the database.",
    func: async ({ userIntent, ctx }) => {
      if (!userIntent) {
        return "Error: Missing user intent. Please provide what you want to do with the database.";
      }

      const connection = await getDbConnection(ctx.config);
      try {
        // Get schema information
        const [tables] = await connection.execute('SHOW TABLES');
        const schemaDetails = {};
        
        for (const row of tables) {
          const tableName = Object.values(row)[0];
          const [columns] = await connection.execute(`DESCRIBE \`${tableName}\``);
          schemaDetails[tableName] = columns;
        }
        
        const schemaString = Object.entries(schemaDetails).map(([table, cols]) => {
          return `${table}: ${cols.map(col => `${col.Field} (${col.Type})`).join(', ')}`;
        }).join('\n');
        
        // Generate SQL using LLM
        const prompt = `
Database Schema:
${schemaString}

User Context:
- User ID: ${ctx.user?.id || 'system'}
- User Role: ${ctx.user?.role || 'unknown'}
- Timestamp: ${new Date().toISOString()}

User Intent: ${userIntent}

Based on this intent and schema:
1. Determine the appropriate SQL operation (SELECT/INSERT/UPDATE/DELETE)
2. Identify the correct table(s) to operate on
3. Generate precise SQL query to fulfill the intent
4. Return the SQL as valid, executable code with proper parameterization
`;

        const llmResponse = await global.llmModule.simpleLLMCall({
          senderId: ctx.user?.id || 'intent_executor',
          recipientId: 'sql_engine',
          message: prompt,
          timestamp: new Date().toISOString(),
          status: 'processing',
          format: 'json',
        });

        // Extract and sanitize the SQL
        const sqlQuery = llmResponse.message;
        console.log('Generated SQL:', sqlQuery);
        
        // Safety checks
        if (isUnsafeQuery(sqlQuery)) {
          return `Error: Generated SQL query appears unsafe: ${sqlQuery}`;
        }
        
        // Execute the query
        const [result] = await connection.execute(sqlQuery);
        
        // Log the operation for audit purposes
        logDatabaseOperation({
          userId: ctx.user?.id,
          intent: userIntent,
          sql: sqlQuery,
          timestamp: new Date().toISOString(),
          result: result ? 'success' : 'failure'
        });
        
        // Format the result for return
        const formattedResult = formatQueryResult(result, sqlQuery);
        
        return JSON.stringify({
          success: true,
          sql: sqlQuery,
          result: formattedResult,
          message: `Successfully executed database operation based on intent: "${userIntent}"`
        });
      } catch (error) {
        console.error('Database intent execution error:', error);
        return JSON.stringify({
          success: false,
          error: error.message,
          intent: userIntent
        });
      } finally {
        if (connection) {
          // connection.release();
          // Uncomment above line if using connection pooling
        }
      }
    }
  });
}

/**
 * Check if a SQL query might be unsafe to execute
 * @param {string} sql The SQL query to check
 * @returns {boolean} True if the query appears unsafe
 */
function isUnsafeQuery(sql) {
  // Check for potentially dangerous operations
  const dangerousPatterns = [
    /DROP\s+/i,
    /TRUNCATE\s+/i,
    /ALTER\s+.*ADD\s+USER/i,
    /INTO\s+OUTFILE/i,
    /LOAD\s+DATA/i,
    /GRANT\s+/i,
    /SHUTDOWN/i
  ];
  
  return dangerousPatterns.some(pattern => pattern.test(sql));
}

/**
 * Log database operations for audit purposes
 * @param {Object} operationData Data about the operation
 */
function logDatabaseOperation(operationData) {
  // Implement your logging logic here
  // This could write to a database, file, or monitoring service
  console.log('DB AUDIT LOG:', operationData);
}

/**
 * Format query results based on operation type
 * @param {Object} result Database query result
 * @param {string} sql The SQL query that was executed
 * @returns {Object} Formatted result
 */
function formatQueryResult(result, sql) {
  // Format based on query type
  const sqlLower = sql.toLowerCase().trim();
  
  if (sqlLower.startsWith('select')) {
    return {
      type: 'SELECT',
      rowCount: result.length,
      rows: result
    };
  } else if (sqlLower.startsWith('insert')) {
    return {
      type: 'INSERT',
      affectedRows: result.affectedRows,
      insertId: result.insertId
    };
  } else if (sqlLower.startsWith('update')) {
    return {
      type: 'UPDATE',
      affectedRows: result.affectedRows,
      changedRows: result.changedRows
    };
  } else if (sqlLower.startsWith('delete')) {
    return {
      type: 'DELETE',
      affectedRows: result.affectedRows
    };
  }
  
  return result;
}

// Export the tool creator function
module.exports = {
  createDatabaseIntentTool
};