const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const BusinessRules = require('./modules/business_rules');
const { loadState, saveState, loadEtlConfig } = require('./modules/etl_module'); // Reuse ETL module functions

// Execute a single ETL job in a worker thread
function executeEtlJobInWorker(job, businessRules, state) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(path.resolve(__dirname, './modules/etl_worker.js'), {
            workerData: { job, businessRules, state }
        });

        worker.on('message', (result) => resolve(result));
        worker.on('error', (error) => reject(error));
        worker.on('exit', (code) => {
            if (code !== 0) {
                reject(new Error(`Worker stopped with exit code ${code}`));
            }
        });
    });
}

// Schedule ETL jobs
async function scheduleEtlJobs() {
    const etlConfig = loadEtlConfig();
    const state = loadState();

    const businessRules = new BusinessRules('./config/businessRules.json');
    businessRules.loadRules();

    etlConfig.forEach((job) => {
        const interval = parseFrequency(job.frequency);

        setInterval(async () => {
            console.log(`Running ETL job for ${job.source_table} -> ${job.target_table}`);
            try {
                const result = await executeEtlJobInWorker(job, businessRules.rules, state);
                console.log(`ETL job completed successfully: ${JSON.stringify(result)}`);
                saveState(state);
            } catch (error) {
                console.error(`ETL job failed: ${error.message}`);
            }
        }, interval);

        console.log(`Scheduled ETL job for ${job.source_table} -> ${job.target_table} every ${job.frequency}`);
    });
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

// Start ETL Service
(async function startEtlService() {
    try {
        console.log('Starting ETL Service...');
        await scheduleEtlJobs();
        console.log('ETL Service is running.');
    } catch (error) {
        console.error('Failed to start ETL Service:', error);
    }
})();
