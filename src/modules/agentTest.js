// triggerWorkflow.js

require('dotenv').config();
const redis = require('redis');
const AgentWorkflowManager = require('./AgentWorkflowManager');
const config = { dbType: 'mysql', dbConnection: 'MYSQL_1' }
const { createClient } = redis;

(async () => {
    const [,, workflowId, ...inputArgs] = process.argv;

    if (!workflowId) {
        console.error('Usage: node triggerWorkflow.js <workflowId> [inputData as JSON]');
        process.exit(1);
    }

    let inputData;
    try {
        inputData = inputArgs.length ? JSON.parse(inputArgs.join(' ')) : {};
    } catch (err) {
        console.error('Invalid inputData JSON:', err.message);
        process.exit(1);
    }

    const redisClient = createClient();
    await redisClient.connect();

    const context = { actions: {} };
    const manager = new AgentWorkflowManager(config, redisClient, context);

    manager.on('workflow-step', ({ from, to, response }) => {
        console.log(`Step completed: ${from} ➝ ${to}`);
        console.log(`Response: ${response}\n`);
    });

    try {
        await manager.triggerWorkflow(workflowId, inputData);
        console.log('Workflow execution completed.');
    } catch (err) {
        console.error('Error executing workflow:', err.message);
    } finally {
        await redisClient.disconnect();
    }
})();
