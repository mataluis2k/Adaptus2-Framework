const { workerData, parentPort } = require('worker_threads');
const { executeEtlJob } = require('./etl_module');

(async function runEtlJob() {
    const { job, businessRules, state } = workerData;

    try {
        await executeEtlJob(job, state, { rules: businessRules });
        parentPort.postMessage({ success: true, message: 'ETL job completed successfully' });
    } catch (error) {
        parentPort.postMessage({ success: false, error: error.message });
    }
})();
