const fs = require('fs');
const path = require('path');
const { getDbConnection } = require('./db');
const BusinessRules = require('./business_rules');
const RuleEngine = require('./ruleEngine');
const { getApiConfig } = require('./apiConfig');
const configDir = process.env.CONFIG_DIR || path.join(process.cwd(), 'config');

// ETL Metrics tracking class
class ETLMetrics {
    constructor() {
        this.startTime = Date.now();
        this.recordsProcessed = 0;
        this.errors = 0;
        this.validationErrors = 0;
    }

    recordSuccess() {
        this.recordsProcessed++;
    }

    recordError() {
        this.errors++;
    }

    recordValidationError() {
        this.validationErrors++;
    }

    getMetrics() {
        const duration = Date.now() - this.startTime;
        return {
            duration,
            recordsProcessed: this.recordsProcessed,
            errors: this.errors,
            validationErrors: this.validationErrors,
            errorRate: this.errors / (this.recordsProcessed || 1),
            throughput: (this.recordsProcessed / (duration / 1000)).toFixed(2)
        };
    }
}

// Data validation functions
function validateField(value, schemaType) {
    if (!value && !schemaType.allowNull) {
        return false;
    }
    
    switch(schemaType.type.toLowerCase()) {
        case 'varchar':
        case 'text':
            return typeof value === 'string';
        case 'int':
        case 'bigint':
            return Number.isInteger(Number(value));
        case 'decimal':
        case 'float':
            return !isNaN(Number(value));
        case 'datetime':
        case 'timestamp':
            return !isNaN(Date.parse(value));
        case 'boolean':
            return typeof value === 'boolean' || value === 0 || value === 1;
        default:
            return true;
    }
}

function validateData(data, schema) {
    const errors = [];
    for (const [field, value] of Object.entries(data)) {
        if (schema[field] && !validateField(value, schema[field])) {
            errors.push(`Invalid value for field ${field}: ${value}`);
        }
    }
    return errors;
}

// Transaction management
async function processWithTransaction(connection, operations) {
    await connection.beginTransaction();
    try {
        for (const op of operations) {
            await op();
        }
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    }
}

// Paths for additional configurations and state files
const stateFilePath = path.join(configDir, 'etl_state.json');
const etlConfigPath = path.join(configDir, 'etlConfig.json');


// Load or initialize state file
function loadState() {
    try {
        return JSON.parse(fs.readFileSync(stateFilePath, 'utf-8'));
    } catch {
        return {};
    }
}

// Save state to file
function saveState(state) {
    fs.writeFileSync(stateFilePath, JSON.stringify(state, null, 2));
}

// Load ETL config
function loadEtlConfig() {
    try {
        return JSON.parse(fs.readFileSync(etlConfigPath, 'utf-8'));
    } catch (error) {
        console.error('Error loading ETL config:', error);
        process.exit(1);
    }
}

// Get the schema of a table
async function getTableSchema(connection, table) {
    const query = `DESCRIBE ${table}`;
    const [rows] = await connection.execute(query);
    return rows.reduce((acc, { Field, Type }) => {
        acc[Field] = Type;
        return acc;
    }, {});
}

// Sync target schema with source schema
async function syncSchema(sourceConnection, targetConnection, sourceTable, targetTable) {
    console.log(`Synchronizing schema for source table: ${sourceTable}, target table: ${targetTable}`);

    const sourceSchema = await getTableSchema(sourceConnection, sourceTable);
    const targetSchema = await getTableSchema(targetConnection, targetTable);

    const missingColumns = Object.entries(sourceSchema).filter(([column]) => !targetSchema[column]);

    for (const [column, type] of missingColumns) {
        const alterQuery = `ALTER TABLE ${targetTable} ADD COLUMN ${column} ${type}`;
        console.log(`Adding column: ${column} (${type}) to target table: ${targetTable}`);
        await targetConnection.execute(alterQuery);
    }

    console.log(`Schema synchronization completed for target table: ${targetTable}`);
}


/**
 * Load rules for a given entity (table).
 * @param {string} entity - The name of the entity/table.
 * @returns {Array} - An array of rules.
 */
function loadRulesForEntity(entity) {
    const ruleFilePath = path.join(process.cwd(), `config/rules/${entity}_rules.dsl`);
    if (fs.existsSync(ruleFilePath)) {
        const dslText = fs.readFileSync(ruleFilePath, 'utf-8');
        const ruleEngineInstance = RuleEngine.fromDSL(dslText);
        return ruleEngineInstance.rules;
    }
    console.warn(`No rules found for entity: ${entity}`);
    return [];
}

// Observer module to get modified records
async function fetchModifiedRecords(connection, table, lastUpdatedAt) {
    if (!lastUpdatedAt) return `SELECT * FROM ${table}`;
    return `SELECT * FROM ${table} WHERE updated_at > ?`;
}

async function processLargeTableInBatches(
    sourceConnection,
    targetConnection,
    sourceTable,
    targetTable,
    batchSize,
    businessRulesInstance,
    lastProcessedKeyValues,
    lastJobRun,
    state,
    config
) {
    const metrics = new ETLMetrics();
    console.log(`Processing table ${sourceTable} in batches of ${batchSize}`);

    let hasMoreData = true;
    const keys = config.keys || [];
    if (keys.length === 0) {
        throw new Error(`No keys defined for table ${sourceTable} in the configuration.`);
    }

    // Get source and target schemas for validation
    const sourceSchema = await getTableSchema(sourceConnection, sourceTable);
    const targetSchema = await getTableSchema(targetConnection, targetTable);

    // Determine if updated_at exists in source schema
    const hasUpdatedAt = Object.keys(sourceSchema).includes('updated_at');

    // Get business rules for the source table
    const ruleEngineInstance = new RuleEngine(loadRulesForEntity(sourceTable));

    while (hasMoreData) {
        let query = '';
        let params = [];

        if (hasUpdatedAt) {
            // Query for updated or new records since the last job run
            query = `SELECT * FROM ${sourceTable} WHERE updated_at > ? ORDER BY ${keys.join(', ')} ASC LIMIT ${batchSize}`;
            params = [lastJobRun || new Date(0).toISOString()];
        } else {
            // Build lexicographical conditions for composite keys
            const lexConditions = keys
                .map((key, index) => {
                    const earlierKeys = keys.slice(0, index).map(k => `${k} = ?`).join(' AND ');
                    const currentKey = `${key} > ?`;
                    return earlierKeys ? `(${earlierKeys} AND ${currentKey})` : currentKey;
                })
                .join(' OR ');

            query = `SELECT * FROM ${sourceTable} WHERE ${lexConditions} ORDER BY ${keys.join(', ')} ASC LIMIT ${batchSize}`;
            params = [...lastProcessedKeyValues, ...Array(keys.length - lastProcessedKeyValues.length).fill('')];
        }

        const [rows] = await sourceConnection.execute(query, params);
        hasMoreData = rows.length > 0;

        for (const row of rows) {
            // Validate data before transformation
            const validationErrors = validateData(row, sourceSchema);
            if (validationErrors.length > 0) {
                console.error(`Validation errors for record in ${sourceTable}:`, validationErrors);
                metrics.recordValidationError();
                continue;
            }

            let transformedData = { ...row };
            
            try {
                ruleEngineInstance.processEvent('UPDATE', sourceTable, row);
                
                // Build upsert query for target table
                const fields = Object.keys(transformedData).join(', ');
                const values = Object.values(transformedData).map(() => '?').join(', ');
                const insertQuery = `INSERT INTO ${targetTable} (${fields}) VALUES (${values}) ON DUPLICATE KEY UPDATE ${fields.split(', ').map(f => `${f} = VALUES(${f})`).join(', ')}`;

                // Process with transaction
                await processWithTransaction(targetConnection, [
                    async () => {
                        await targetConnection.execute(insertQuery, Object.values(transformedData));
                    }
                ]);

                metrics.recordSuccess();
                console.log(`Record from ${sourceTable} successfully transferred to ${targetTable}`);
            } catch (err) {
                metrics.recordError();
                console.error(`Error transferring record to ${targetTable}:`, err);
                
                // Implement retry logic for failed records
                const maxRetries = 3;
                let retryCount = 0;
                while (retryCount < maxRetries) {
                    try {
                        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retryCount)));
                        await processWithTransaction(targetConnection, [
                            async () => {
                                await targetConnection.execute(insertQuery, Object.values(transformedData));
                            }
                        ]);
                        console.log(`Record retry successful after ${retryCount + 1} attempts`);
                        metrics.recordSuccess();
                        break;
                    } catch (retryErr) {
                        retryCount++;
                        if (retryCount === maxRetries) {
                            console.error(`Failed to transfer record after ${maxRetries} retries:`, retryErr);
                        }
                    }
                }
            }
        }

        if (rows.length > 0) {
            const lastRow = rows[rows.length - 1];
            lastProcessedKeyValues = keys.map(key => lastRow[key]);
        }

        // Update state after each batch
        state[sourceTable] = {
            lastProcessedKeyValues,
            lastJobRun: new Date().toISOString(),
        };
        saveState(state);
    }

    const finalMetrics = metrics.getMetrics();
    console.log(`Finished processing table ${sourceTable}. Metrics:`, finalMetrics);
    return finalMetrics;
}



// Perform ETL job
async function executeEtlJob(job, state, businessRules, apiConfig) {
    const jobMetrics = new ETLMetrics(); 
    const { source_table, target_table } = job;
    
    const dbConnection1 = apiConfig.find(item => item.dbTable === source_table)?.dbConnection || null;
    const dbConnection2 = apiConfig.find(item => item.dbTable === target_table)?.dbConnection || null;
    const dbType1 = apiConfig.find(item => item.dbTable === source_table)?.dbType || null;
    const dbType2 = apiConfig.find(item => item.dbTable === target_table)?.dbType || null;

    if (!dbConnection2 || !dbType2) {
        console.error(`Database connection or type not found for tables  ${target_table}`);
        return;
    }
    if (!dbConnection1 || !dbType1 ) {
        console.error(`Database connection or type not found for tables ${source_table} `);
        return;
    }

    console.log(dbType1, dbType2, dbConnection1, dbConnection2);
    const sourceConnection = await getDbConnection({ dbType: dbType1, dbConnection: dbConnection1 });
    const targetConnection = await getDbConnection({ dbType: dbType2, dbConnection: dbConnection2 });

    if (!sourceConnection || !targetConnection) {
        console.error(`Failed to connect to databases for tables ${source_table} or ${target_table}`);
        return;
    }

    // Sync schema
    await syncSchema(sourceConnection, targetConnection, source_table, target_table);

    const keys = job.keys || [];
    if (keys.length === 0) {
        throw new Error(`No keys defined for table ${source_table} in the configuration.`);
    }

    const lastProcessedKeyValues = state[source_table]?.lastProcessedKeyValues || keys.map(() => 0);
    const lastJobRun = state[source_table]?.lastJobRun || null;
    const batchSize = 1000; // Configurable batch size

    const maxJobRetries = 3;
    let jobRetryCount = 0;

    while (jobRetryCount < maxJobRetries) {
        try {
            const batchMetrics = await processLargeTableInBatches(
                sourceConnection,
                targetConnection,
                source_table,
                target_table,
                batchSize,
                businessRules,
                lastProcessedKeyValues,
                lastJobRun,
                state,
                job
            );

            // Combine metrics
            jobMetrics.recordsProcessed += batchMetrics.recordsProcessed;
            jobMetrics.errors += batchMetrics.errors;
            jobMetrics.validationErrors += batchMetrics.validationErrors;

            // Job completed successfully
            break;
        } catch (err) {
            jobRetryCount++;
            console.error(`ETL job attempt ${jobRetryCount} failed for ${source_table} -> ${target_table}:`, err);
            
            if (jobRetryCount < maxJobRetries) {
                // Exponential backoff before retry
                const backoffTime = 1000 * Math.pow(2, jobRetryCount);
                console.log(`Retrying job in ${backoffTime/1000} seconds...`);
                await new Promise(resolve => setTimeout(resolve, backoffTime));
            } else {
                console.error(`ETL job failed after ${maxJobRetries} attempts`);
                throw err;
            }
        }
    }

    // Log final job metrics
    const finalJobMetrics = jobMetrics.getMetrics();
    console.log(`ETL job metrics for ${source_table} -> ${target_table}:`, finalJobMetrics);
    return finalJobMetrics;
}



// Main ETL execution loop
async function main() {
    const etlConfig = loadEtlConfig();
    const state = loadState();
    const apiConfig = getApiConfig();
    const businessRules = new BusinessRules(path.join(configDir,'businessRules.json'));

    businessRules.loadRules(); // Load transformation rules

    for (const job of etlConfig) {
        console.log(`Starting ETL job for ${job.source_table} -> ${job.target_table}`);
        await executeEtlJob(job, state, businessRules, apiConfig);
    }

    console.log('All ETL jobs completed.');
}

// Schedule ETL execution based on frequency
function scheduleEtl() {
    const etlConfig = loadEtlConfig();
    const frequencies = new Set(etlConfig.map(job => job.frequency));
    for (const frequency of frequencies) {
        const interval = parseFrequency(frequency);
        setInterval(main, interval);
    }
}

// Parse frequency string like "5m", "1h" to milliseconds
function parseFrequency(frequency) {
    const match = frequency.match(/^(\d+)([smh])$/);
    if (!match) {
        throw new Error(`Invalid frequency format: ${frequency}`);
    }
    const [, value, unit] = match;
    const multiplier = unit === 's' ? 1000 : unit === 'm' ? 60000 : 3600000;
    return parseInt(value, 10) * multiplier;
}

scheduleEtl();

if (require.main === module) {
    (async () => {
        try {
            console.log('Running ETL process...');
            await main(); // Call the main ETL execution loop
            console.log('ETL process completed successfully.');
        } catch (error) {
            console.error('ETL process failed:', error.message);
        }
    })();
}
