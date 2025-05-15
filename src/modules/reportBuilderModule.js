const { v4: uuidv4 } = require('uuid');
const { aarMiddleware } = require('../middleware/aarMiddleware');
const { getDbConnection } = require('./db');
const llmModule = require('./llmModule');
const { redisClient } = require('./redisClient');
const { create, query } = require('./db');  
const eventLogger = require('./EventLogger');
const express = require('express');

class ReportBuilderModule {
    constructor(globalContext, dbConfig, app) {
        this.globalContext = globalContext;
        this.dbConfig = dbConfig;
        this.app = app;
        this.ruleEngineInstance = this.app.locals.ruleEngineMiddleware;
        this.acl = [process.env.DEFAULT_ADMIN || 'admin'];
        this.schemaCache = {};
        this.registerActions();
        this.registerRoutes();
    }

    registerActions() {
        this.globalContext.actions.generate_sql_code = this.generateSQLCode.bind(this);
        this.globalContext.actions.save_sql_code = this.saveSQLCode.bind(this);
    }
    
    /**
     * Fetch schema details from cache or database and cache for future use
     */
    async getSchemaString(config) {
        const schemaKey = `schema:${config.dbConnection}`;
        
        // Try to get schema from Redis cache first
        let schemaString = await redisClient.get(schemaKey);
        
        if (!schemaString) {
            console.log('Schema cache miss, fetching from database');
            // If not in cache, fetch schema and cache it
            const tables = await query(config, 'SHOW TABLES');
            const schemaDetails = {};

            for (const row of tables) {
                const tableName = Object.values(row)[0];
                const columns = await query(config, `DESCRIBE \`${tableName}\``);
                schemaDetails[tableName] = columns;
            }

            schemaString = Object.entries(schemaDetails).map(([table, cols]) => {
                return `${table}: ${cols.map(col => `${col.Field} (${col.Type})`).join(', ')}`;
            }).join('\n');
            
            // Cache schema for 1 hour (3600 seconds)
            await redisClient.set(schemaKey, schemaString, 'EX', 3600);
        }
        
        return schemaString;
    }

    /**
     * Run SQL query with safety limits
     */
    async runSQLQuery(ctx, params) {
        const { sql } = params;
        if (!sql || typeof sql !== 'string') throw new Error('Missing or invalid SQL query');

        // Ensure query has a LIMIT clause of max 10 rows
        const normalized = sql.trim().replace(/;$/, '');
        const limitedQuery = /\blimit\b/i.test(normalized)
            ? normalized.replace(/limit\s+\d+/i, 'LIMIT 10')
            : `${normalized} LIMIT 10`;

        try {
            const rows = await query(ctx.config, limitedQuery);
            return { data: rows };
        } catch (error) {
            console.error('SQL execution error:', error.message);
            throw new Error('Failed to execute query');
        }
    }
    
    /**
     * Generate SQL code based on user query and database schema
     */
    async generateSQLCode(ctx, params) {
        const { userQuery } = params;
        if (!userQuery) throw new Error('Missing userQuery');
        
        try {
            // Get schema using the helper method 
            const schemaString = await this.getSchemaString(ctx.config);
            
            const prompt = `User wants to build a report.\nSchema:\n${schemaString}\n\nQuery: ${userQuery} .\nGenerate SQL code ONLY.`;
            const llm = await llmModule.getLLMInstance('llama3');
            
            // Create a properly formatted message array
            const messages = [
                { role: "system", content: "You are expert generating SQL code, make sure you reply in JSON" },
                { role: "user", content: prompt }
            ];

            // Modified to handle the response correctly
            const llmResponse = await llm.call(messages);

            // Handle different response formats
            let sqlCode;
            if (typeof llmResponse === 'string') {
                sqlCode = llmResponse;
            } else if (llmResponse.message) {
                sqlCode = llmResponse.message;
            } else if (llmResponse.content) {
                sqlCode = llmResponse.content;
            } else {
                return { code: 'Failed to generate SQL code' };
            }
            
            // Parse JSON response if needed
            let parsedResponse;
            try {
                if (typeof sqlCode === 'string' && (sqlCode.startsWith('{') || sqlCode.includes('```json'))) {
                    // Extract JSON if it's wrapped in code blocks
                    const jsonMatch = sqlCode.match(/```json\s*([\s\S]*?)\s*```/) || 
                                    sqlCode.match(/```\s*([\s\S]*?)\s*```/);
                    const jsonStr = jsonMatch ? jsonMatch[1] : sqlCode;
                    parsedResponse = JSON.parse(jsonStr.replace(/^```json|```$/g, '').trim());
                }
            } catch (jsonError) {
                console.warn('Failed to parse JSON from LLM response, using raw text');
            }
            
            // Return the SQL code, checking different possible locations
            if (parsedResponse && parsedResponse.sql) {
                return { code: parsedResponse.sql };
            } else if (parsedResponse && parsedResponse.query) {
                return { code: parsedResponse.query };
            } else if (typeof sqlCode === 'object' && sqlCode.sql) {
                return { code: sqlCode.sql };
            } else if (typeof sqlCode === 'object' && sqlCode.query) {
                return { code: sqlCode.query };
            } else {
                return { code: sqlCode };
            }
        } catch (error) {
            console.error('Error in generateSQLCode:', error);
            return { code: `Error: ${error.message}` };
        }
    }
     
   extractSQL(aiMessage) {
  const content = aiMessage.content || '';
  // 1) grab the JSON inside ```json … ```
  const block = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (block) {
    try {
      const parsed = JSON.parse(block[1]);
      // your LLM uses "query" as the field
      if (parsed.query) return parsed.query.trim();
      if (parsed.sql)   return parsed.sql.trim();
    } catch (e) {
      console.warn('JSON parsing failed:', e);
    }
  }
  // 2) fallback: look for a "query" property anywhere
  const field = content.match(/"query"\s*:\s*"([^"]+)"/i);
  if (field) return field[1].trim();
  // 3) last resort: simple SQL regex (but strip quotes/punctuation)
  const sql = content.match(/\b(SELECT|INSERT|UPDATE|DELETE)\b[\s\S]*/i);
  if (sql) {
    return sql[0]
      .replace(/["`;]+$/g, '')   // trim trailing quotes, semicolons
      .trim();
  }
  return null;
}
      
    /**
     * Execute SQL from natural language intent
     */
    async executeFromIntent(ctx, params) {
        const { userQuery } = params;
        if (!userQuery) throw new Error('Missing userQuery');
        const userIntent = userQuery.trim();
      
        
        try {
            // Get cached schema
            const schemaString = await this.getSchemaString(ctx.config);
            
            // Generate SQL using LLM
            const promptTemplate = `
Database Schema:
${schemaString}

User Question: ${userIntent}

Based on this Question and schema:
1. Determine the appropriate SQL operation (SELECT/INSERT/UPDATE/DELETE)
2. Identify the correct table(s) to operate on
3. Generate precise SQL query to fulfill the Question
4. Return the SQL as valid, executable code with appropriate error handling
`;
            

            const llm = await llmModule.getLLMInstance('llama3');
                        
            // Create a properly formatted message array
            const messages = [
                { role: "system", content: "You are expert generating SQL code, make sure you reply in JSON" },
                { role: "user", content: promptTemplate }
            ];

            // Modified to handle the response correctly
            const llmResponse = await llm.call(messages);

          

            console.log('LLM Response:', llmResponse);

            // Extract SQL
            const sqlQuery = this.extractSQL(llmResponse);
            if (!sqlQuery) {
                throw new Error('Failed to extract SQL from LLM response');
            }
            console.log('Generated SQL:', sqlQuery);
            
            // Add safety checks here
            if (this.isUnsafeQuery(sqlQuery)) {
                throw new Error('Generated SQL query appears unsafe');
            }
            
            // Execute query and log the execution
            const result = await query(ctx.config, sqlQuery);
            
            
            // Log the SQL execution for analytics (optional)
            await eventLogger.logUpdate(
                ctx.config,
                'INSERT INTO query_logs (user_id, query, timestamp) VALUES (?, ?, NOW())',
                [ctx.user?.id || 'system', sqlQuery]
            );
            
            return { 
                executed: true,
                sql: sqlQuery,
                result: result
            };
        } catch (error) {
            console.error('Error executing SQL:', error.message);
            throw error;
        }
    }
    
    // Safety check function
    isUnsafeQuery(sql) {
        // Implement logic to check for potentially harmful SQL
        // Example: Check for DROP, TRUNCATE, system tables access, etc.
        const dangerousPatterns = [
            /DROP\s+/i,
            /TRUNCATE\s+/i,
            /ALTER\s+.*ADD\s+USER/i,
            /INTO\s+OUTFILE/i,
            /LOAD\s+DATA/i
        ];
        
        return dangerousPatterns.some(pattern => pattern.test(sql));
    }
    
    /**
     * Save SQL code using EventLogger for performance
     */
    async saveSQLCode(ctx, params) {
        const { reportName, sqlQuery, acl = [], filters = [] } = params;
        if (!reportName || !sqlQuery) throw new Error('Missing reportName or sqlQuery');

        // if acl is empty array then set it to this.acl 
        const effectiveAcl = acl.length === 0 ? [...this.acl] : acl;
        
        const id = uuidv4();
        
        // Use EventLogger instead of direct query execution
        await eventLogger.log(
            ctx.config, 
            'adaptus2_reports', 
            {
                id,
                reportName,
                sqlQuery,
                acl: JSON.stringify(effectiveAcl),
                filters: JSON.stringify(filters)
            }
        );
        
        return { success: true, id };
    }

    registerRoutes() {
        const middleware = aarMiddleware("token", this.acl, this.ruleEngineInstance);
        
        this.app.post('/api/userIntent', middleware, async (req, res) => {
            try {
                const ctx = { config: this.dbConfig, user: req.user };
                const result = await this.executeFromIntent(ctx, req.body);
                res.json(result);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        this.app.post('/api/generate-code', middleware, async (req, res) => {
            try {
                const ctx = { config: this.dbConfig, user: req.user };
                const result = await this.generateSQLCode(ctx, req.body);
                res.json(result);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        this.app.post('/api/save-code', middleware, async (req, res) => {
            try {
                const ctx = { config: this.dbConfig, user: req.user };
                const result = await this.saveSQLCode(ctx, req.body);
                res.json(result);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        this.app.post('/api/run-query', middleware, async (req, res) => {
            try {
                const ctx = { config: this.dbConfig, user: req.user };
                const result = await this.runSQLQuery(ctx, req.body);
                res.json(result);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
    }
}

module.exports = ReportBuilderModule;