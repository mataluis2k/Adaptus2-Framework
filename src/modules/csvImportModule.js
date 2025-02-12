const fs = require('fs');
const csv = require('csv-parser');

class CSVImporterModule {
    constructor(globalContext, dbConfig) {
        this.globalContext = globalContext;
        this.dbConfig = dbConfig;
        this.registerActions();
    }

    registerActions() {
        this.globalContext.actions.import_csv = this.importCSV.bind(this);
    }

    async importCSV(ctx, params) {
        const { filePath, tableName } = params;
        if (!filePath) {
            throw new Error("CSV file path is required.");
        }

        const inferredTableName = tableName || this.extractTableName(filePath);
        const connection = await this.dbConfig.getDbConnection(ctx.config.db);
        
        try {
            const rows = await this.readCSV(filePath);
            if (rows.length === 0) {
                throw new Error("CSV file is empty or invalid.");
            }

            const columns = Object.keys(rows[0]);
            await this.ensureTableExists(connection, inferredTableName, columns);
            await this.insertData(connection, inferredTableName, rows);
            
            return { success: true, message: `Data imported successfully into ${inferredTableName}` };
        } catch (error) {
            console.error("Error in importCSV:", error.message);
            throw new Error("Failed to import CSV data.");
        } finally {
            connection.release();
        }
    }

    extractTableName(filePath) {
        return filePath.split('/').pop().split('.')[0];
    }

    readCSV(filePath) {
        return new Promise((resolve, reject) => {
            const results = [];
            fs.createReadStream(filePath)
                .pipe(csv())
                .on('data', (data) => results.push(data))
                .on('end', () => resolve(results))
                .on('error', (err) => reject(err));
        });
    }

    async ensureTableExists(connection, tableName, columns) {
        const columnDefinitions = columns.map(col => `\`${col}\` TEXT`).join(', ');
        const createTableQuery = `CREATE TABLE IF NOT EXISTS \`${tableName}\` (${columnDefinitions})`;
        await connection.execute(createTableQuery);
    }

    async insertData(connection, tableName, rows) {
        const columns = Object.keys(rows[0]);
        const placeholders = columns.map(() => '?').join(', ');
        const insertQuery = `INSERT INTO \`${tableName}\` (${columns.join(', ')}) VALUES (${placeholders})`;
        
        for (const row of rows) {
            const values = columns.map(col => row[col]);
            await connection.execute(insertQuery, values);
        }
    }
}

module.exports = CSVImporterModule;
