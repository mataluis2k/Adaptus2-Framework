const { workerData, parentPort } = require('worker_threads');

async function executeWorkflow(workflow, data, context) {
    try {
        // Execute each action in the workflow
        for (const action of workflow.actions) {
            if (!context.actions[action.action]) {
                throw new Error(`Unknown action: ${action.action}`);
            }
            await context.actions[action.action](context, action);
        }

        parentPort.postMessage({ 
            success: true, 
            message: `Workflow ${workflow.name} completed successfully` 
        });
    } catch (error) {
        parentPort.postMessage({ 
            success: false, 
            error: error.message 
        });
    }
}

// Execute the workflow when the worker starts
(async function() {
    const { workflow, data, context } = workerData;
    await executeWorkflow(workflow, data, context);
})();
