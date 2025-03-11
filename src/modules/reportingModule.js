const { v7: uuidv7 } = require('uuid');
const consolelog = require('./logger');
const { aarMiddleware } = require('../middleware/aarMiddleware');
const responseBus = require('./response');
const { getContext } = require('./context');

class ReportingModule {
    constructor(globalContext, dbConnection, redisClient, app) {
        this.globalContext = globalContext;
        this.connection = dbConnection;
        this.redisClient = redisClient;
        this.app = app;
        this.registerActions();
        this.registerRoutes();
        this.ensureReportsTable();
        //this.seedReportsTable();
    }

    registerActions() {
        this.globalContext.actions.get_reports = this.getReports.bind(this);
        this.globalContext.actions.run_report = this.runReport.bind(this);
    }

    registerRoutes() {
        const ruleEngineInstance = this.app.locals.ruleEngineMiddleware;
        this.app.get("/reports", aarMiddleware("token", [], ruleEngineInstance), async (req, res) => {
            try {
                responseBus.Reset();
                const result = await this.getReports();
                return res.json(result);
            } catch (error) {
                console.error("Error fetching reports:", error.message);
                return res.status(500).json({ error: error.message });
            }
        });

        this.app.get("/reports/:reportName", aarMiddleware("token", [], ruleEngineInstance), async (req, res) => {
            try {
                responseBus.Reset();
                const result = await this.runReport(req, { reportName: req.params.reportName, ...req.query });
                res.json(result);
            } catch (error) {
                console.error("Error running report:", error.message);
                res.status(500).json({ error: error.message });
            }
        });
    }

    async getReports() {
        try {
            // Get the actual connection by awaiting the connection function
            const connection = await this.connection();
            
            const [reports] = await connection.execute('SELECT id, reportName, filters, acl, mlModel FROM adaptus2_reports');
            return { platformName: "Adaptus2-Reporting", reports };
        } finally {
            // connection.release();
        }
    }

    async runReport(ctx, params) {
        const { reportName, ...filters } = params;
        if (!reportName) throw new Error("Report name is required.");

        try {
            // Get the actual connection by awaiting the connection function
            const connection = await this.connection();
            
            const [reportData] = await connection.execute('SELECT sqlQuery, acl, filters, mlModel FROM adaptus2_reports WHERE id = ?', [reportName]);
            if (reportData.length === 0) throw new Error("Report not found.");

            const report = reportData[0];
          //  console.log(ctx);
            this.validateACL(ctx.user.acl, report.acl);

            let finalSql = this.ensureWhereClause(report.sqlQuery);
            finalSql = this.buildQuery(finalSql, filters, report.filters);
            const cacheKey = this.generateCacheKey(reportName, filters);
            
            const cachedResult = await this.redisClient.get(cacheKey);
            if (cachedResult) return JSON.parse(cachedResult);

            const [result] = await connection.execute(finalSql.query, finalSql.values);
            await this.redisClient.set(cacheKey, JSON.stringify(result), 'EX', process.env.REPORT_CACHE_TTL || 600);
            
            return result;
        } finally {
            // connection.release();
        }
    }

    ensureWhereClause(sqlQuery = '') {
        if (/where\s+/i.test(sqlQuery)) return sqlQuery;
        return sqlQuery + " WHERE 1=1";
    }

    buildQuery(baseQuery, filters, allowedFilters) {
        let query = baseQuery;
        const values = [];
        Object.entries(filters).forEach(([key, value]) => {
            if (allowedFilters.includes(key)) {
                query += ` AND ${key} = ?`;
                values.push(value);
            }
        });
        return { query, values };
    }

    generateCacheKey(reportName, filters) {
        return `report:${reportName}:${uuidv7()}`;
    }

    /**
     * Checks if a user has access to a report based on roles.
     * @param {string|Array} userRoles - Single role or roles assigned to the user.
     * @param {Array} reportACL - Roles permitted to access the report.
     * @throws Will throw an error if access is denied or parameters are invalid.
     * @returns {boolean} Returns true if the user has access.
     */
    validateACL(userRoles, reportACL) {
        if (!userRoles || !Array.isArray(reportACL)) {
            throw new Error("Invalid arguments: userRoles is required and reportACL must be an array.");
        }

        const rolesToCheck = Array.isArray(userRoles) ? userRoles : [userRoles];

        const hasAccess = rolesToCheck.some(role => reportACL.includes(role));

        if (!hasAccess) {
            throw new Error("Access denied: insufficient permissions.");
        }

        return true;
    }

    async ensureReportsTable() {
        try {
            // Get the actual connection by awaiting the connection function
            const connection = await this.connection();
            
            const [tables] = await connection.execute("SHOW TABLES LIKE 'adaptus2_reports'");
            if (tables.length === 0) {
                const createTableQuery = `
                    CREATE TABLE adaptus2_reports (
                        id VARCHAR(36) PRIMARY KEY,
                        reportName VARCHAR(255) NOT NULL,
                        sqlQuery TEXT NOT NULL,
                        acl JSON NOT NULL,
                        filters JSON NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                    )`;
                await connection.execute(createTableQuery);
                console.log("Reports table created successfully.");
            }
        } catch (error) {
            console.error("Error ensuring reports table:", error.message);
            process.exit(1);
        } finally {
         //   connection.release();
        }
    }
    async seedReportsTable() {
        try {
            // Get the actual connection by awaiting the connection function
            const connection = await this.connection();
            
            const reports = [
                { reportName: "workouts_report", sqlQuery: "SELECT * FROM workouts", acl: ["publicAccess"], filters: ["uuid"] },
                { reportName: "users_report", sqlQuery: "SELECT id, username, acl FROM users", acl: ["publicAccess"], filters: ["id"] },
                { reportName: "events_report", sqlQuery: "SELECT * FROM events", acl: ["publicAccess"], filters: ["id"] },
                { reportName: "video_catalog_report", sqlQuery: "SELECT * FROM video_catalog", acl: ["publicAccess"], filters: ["videoID"] },
                { reportName: "uploads_report", sqlQuery: "SELECT * FROM uploads", acl: ["publicAccess"], filters: ["id"] },
                { reportName: "articles_report", sqlQuery: "SELECT * FROM articles", acl: ["publicAccess"], filters: ["id", "title"] },
                { reportName: "products_report", sqlQuery: "SELECT * FROM products", acl: ["publicAccess"], filters: ["id", "category_id"] },
                { reportName: "messages_report", sqlQuery: "SELECT * FROM messages", acl: ["publicAccess"], filters: ["id"] },
                { reportName: "authors_report", sqlQuery: "SELECT * FROM authors", acl: ["publicAccess"], filters: ["id"] }
            ];

            for (const report of reports) {
                await connection.execute(
                    "INSERT INTO adaptus2_reports (id, reportName, sqlQuery, acl, filters, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW()) ON DUPLICATE KEY UPDATE sqlQuery=VALUES(sqlQuery), acl=VALUES(acl), filters=VALUES(filters)",
                    [uuidv7(), report.reportName, report.sqlQuery, JSON.stringify(report.acl), JSON.stringify(report.filters)]
                );
            }

            console.log("Reports table seeded successfully.");
        } catch (error) {
            console.error("Error seeding reports table:", error.message);
        } finally {
            // connection.release();
        }
    }

}

module.exports = ReportingModule;
