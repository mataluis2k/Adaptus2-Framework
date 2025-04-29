const { v4: uuidv4 } = require('uuid');
const { aarMiddleware } = require('../middleware/aarMiddleware');
const { getDbConnection } = require('./db');
const llmModule = require('./llmModule');
const express = require('express');

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

        const connection = await getDbConnection(ctx.config);
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

            const prompt = `User wants to build a report.\nSchema:\n${schemaString}\n\nQuery: ${userQuery} .\n Important Generate SQL code ONLY.`;
            const llmResponse = await llmModule.simpleLLMCall({
                senderId: ctx.user?.id || 'report_generator',
                recipientId: 'sql_engine',
                message: prompt,
                timestamp: new Date().toISOString(),
                status: 'processing'
            });

            return { code: llmResponse.message };
        } finally {
            //connection.release();
        }
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
           // connection.release();
        }
    }

    registerRoutes() {
        
        const middleware = aarMiddleware("token", this.acl, this.ruleEngineInstance);

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
