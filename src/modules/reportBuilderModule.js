const { v4: uuidv4 } = require('uuid');
const { aarMiddleware } = require('../middleware/aarMiddleware');
const { getDbConnection } = require('./db');
const llmModule = require('./llmModule');
const express = require('express');
const { format } = require('path');

class ReportBuilderModule {
    constructor(globalContext, dbConfig, app) {
        this.globalContext = globalContext;
        this.dbConfig = dbConfig;
        this.app = app;
        this.ruleEngineInstance = this.app.locals.ruleEngineMiddleware;
        this.acl = [process.env.DEFAULT_ADMIN || 'admin'];
        this.registerActions();
        this.registerRoutes();
    }

    registerActions() {
        this.globalContext.actions.generate_sql_code = this.generateSQLCode.bind(this);
        this.globalContext.actions.save_sql_code = this.saveSQLCode.bind(this);
    }

    async runSQLQuery(ctx, params) {
        const { sql } = params;
        if (!sql || typeof sql !== 'string') throw new Error('Missing or invalid SQL query');

        // Ensure query has a LIMIT clause of max 10 rows
        const normalized = sql.trim().replace(/;$/, '');
        const limitedQuery = /\blimit\b/i.test(normalized)
            ? normalized.replace(/limit\s+\d+/i, 'LIMIT 10')
            : `${normalized} LIMIT 10`;

        const connection = await getDbConnection(ctx.config);
        try {
            const [rows] = await connection.execute(limitedQuery);
            return { data: rows };
        } catch (error) {
            console.error('SQL execution error:', error.message);
            throw new Error('Failed to execute query');
        }
    }
    async generateSQLCode(ctx, params) {
        const { userQuery } = params;
        if (!userQuery) throw new Error('Missing userQuery');
        console.log(ctx.config);
        const connection = await getDbConnection(ctx.config);
        if (!connection) {
            return { code: 'Failed to connect to database' };
        }
        try {
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

            const prompt = `User wants to build a report.\nSchema:\n${schemaString}\n\nQuery: ${userQuery} .\nGenerate SQL code ONLY.`;
            const llm = await llmModule.getLLMInstance('llama3');
            
            // Create a properly formatted message array
            const messages = [
                { role: "system", content: "You are expert generating SQL code , make sure you reply in JSON" },
                { role: "user", content: prompt }
            ];

            // Ensure messages is an array before passing to llm.call
            if (!Array.isArray(messages)) {
                throw new Error('Messages must be an array');
            }

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
            console.log('LLM Response:', llmResponse);
            if(sqlCode.sql){
                return { code: sqlCode.sql };
            } else if(sqlCode.query ){
                return { code: sqlCode.query };
            } else {
                return { code: sqlCode };
            }

           
           
        } catch (error) {
            console.error('Error in generateSQLCode:', error);
            return { code: `Error: ${error.message}` };
        } finally {
            // Connection is automatically released by the pool wrapper
        }
    }
    
    async executeFromIntent(ctx, params) {
        const { prompt } = params;
        const userIntent = prompt || params.userIntent;
        if (!userIntent) throw new Error('Missing userIntent');
        
        const connection1 = await getDbConnection(ctx.config);
        try {
            // Get schema information (as you're already doing)
            const [tables] = await connection1.execute('SHOW TABLES');
            const schemaDetails = {};
            
            for (const row of tables) {
                const tableName = Object.values(row)[0];
                const [columns] = await connection1.execute(`DESCRIBE \`${tableName}\``);
                schemaDetails[tableName] = columns;
            }
            
            const schemaString = Object.entries(schemaDetails).map(([table, cols]) => {
                return `${table}: ${cols.map(col => `${col.Field} (${col.Type})`).join(', ')}`;
            }).join('\n');
            
            // Generate SQL using LLM
            const prompt = `
    Database Schema:
    ${schemaString}
    
    User Intent: ${userIntent}
    
    Based on this intent and schema:
    1. Determine the appropriate SQL operation (SELECT/INSERT/UPDATE/DELETE)
    2. Identify the correct table(s) to operate on
    3. Generate precise SQL query to fulfill the intent
    4. Return the SQL as valid, executable code with appropriate error handling
    `;
    
            const llmResponse = await llmModule.simpleLLMCall({
                senderId: ctx.user?.id || 'intent_executor',
                recipientId: 'sql_engine',
                message: prompt,
                timestamp: new Date().toISOString(),
                status: 'processing',
                format: 'json',
            });
    
            // Execute the generated SQL
            
            console.log('LLM Response:', llmResponse);
            const sqlQuery = llmResponse.sql || llmResponse;
            console.log('Generated SQL:', sqlQuery);
            
            // Add safety checks here
            if (this.isUnsafeQuery(sqlQuery)) {
                throw new Error('Generated SQL query appears unsafe');
            }
            
            const [result] = await connection1.execute(sqlQuery);
            return { 
                executed: true,
                sql: sqlQuery,
                result: result
            };
        } catch (error) {
            console.error('Error executing SQL:', error.message);
        } finally {
            // Connection is automatically released by the pool wrapper
        }
    }
    
    // Add a safety check function
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
    async saveSQLCode(ctx, params) {
        const { reportName, sqlQuery, acl = [], filters = [] } = params;
        if (!reportName || !sqlQuery) throw new Error('Missing reportName or sqlQuery');

        // if acl is empty array then set it to this.acl 
        if (acl.length === 0) {
            acl.push(...this.acl);
        }
        const connection = await getDbConnection(ctx.config);
        const query = `INSERT INTO adaptus2_reports (id, reportName, sqlQuery, acl, filters) VALUES (?, ?, ?, ?, ?)`;
        const id = uuidv4();

        try {
            await connection.execute(query, [
                id,
                reportName,
                sqlQuery,
                JSON.stringify(acl),
                JSON.stringify(filters)
            ]);
            return { success: true, id };
        } finally {
            // Connection is automatically released by the pool wrapper
        }
    }

    registerRoutes() {
        
        const middleware = aarMiddleware("token", this.acl, this.ruleEngineInstance);
        this.app.post('/api/userIntent',  aarMiddleware("token", this.acl, this.ruleEngineInstance), async (req, res) => {
            try {
                const ctx = { config: this.dbConfig, user: req.user };
                const result = await this.executeFromIntent(ctx, req.body);
                res.json(result);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        this.app.post('/api/generate-code',  aarMiddleware("token", this.acl, this.ruleEngineInstance), async (req, res) => {
            try {
                const ctx = { config: this.dbConfig, user: req.user };
                const result = await this.generateSQLCode(ctx, req.body);
                res.json(result);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        this.app.post('/api/save-code',  aarMiddleware("token", this.acl, this.ruleEngineInstance), async (req, res) => {
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
