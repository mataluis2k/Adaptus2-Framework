// AgentWorkflowManager.js

const llmModule = require('./llmModule');
const EventEmitter = require('events');
const logger = require('./logger');
const { read } = require('./db');
const moment = require('moment');

const AGENTS_TABLE = 'agents';

class AgentWorkflowManager extends EventEmitter {
    constructor(config, redisClient, context) {
        super();
        this.config = config;
        this.redis = redisClient;
        this.context = context;
        this.cacheTTL = 300; // seconds
        this.WORKFLOWS_TABLE = 'agent_workflows';

        this.registerActions();
    }

    async loadWorkflow(workflowId) {
        const cacheKey = `workflow:${workflowId}`;
        let workflow = await this.redis.get(cacheKey);

        if (workflow) return JSON.parse(workflow);

        const workflows = await read(this.config, this.WORKFLOWS_TABLE, { id: workflowId });
        workflow = workflows.length ? workflows[0] : null;

        if (workflow) {
            await this.redis.set(cacheKey, JSON.stringify(workflow), "EX", this.cacheTTL);
        }

        return workflow;
    }

    async loadAgent(agentId) {
        const cacheKey = `agent:${agentId}`;
        let agent = await this.redis.get(cacheKey);

        if (agent) return JSON.parse(agent);

        const agents = await read(this.config, AGENTS_TABLE, { id: agentId });
        agent = agents.length ? agents[0] : null;

        if (agent) {
            await this.redis.set(cacheKey, JSON.stringify(agent), "EX", this.cacheTTL);
        }

        return agent;
    }

    async executeWorkflow(workflowId, inputData) {
        const workflow = await this.loadWorkflow(workflowId);
        if (!workflow) {
            logger.error(`Workflow ${workflowId} not found`);
            return;
        }

        logger.info(`Executing workflow: ${workflow.name}`);
        const elementMap = new Map(workflow.elements.map(e => [e.id, e]));

        for (const connection of workflow.connections) {
            const fromElement = elementMap.get(connection.from);
            const toElement = elementMap.get(connection.to);

            const fromPersonaId = fromElement.agentId;
            const agentConfig = await this.loadAgent(fromPersonaId);
            const personaPrompt = llmModule.buildPersonaPrompt(agentConfig);
            const mcpAttachment = workflow.mcpAttachments[fromElement.id];

            if (!mcpAttachment || !mcpAttachment.parameters) {
                logger.error(`Missing MCP attachment for element ${fromElement.id}`);
                continue;
            }

            const commandPayload = {
                prompt: personaPrompt,
                parameters: mcpAttachment.parameters,
                inputData: inputData
            };

            logger.info(`Processing step: ${connection.label}`);
            const llmResponse = await llmModule.processMessage({
                senderId: workflow.id,
                message: JSON.stringify(commandPayload)
            });

            this.emit('workflow-step', {
                from: fromElement.id,
                to: toElement.id,
                response: llmResponse.message
            });

            inputData = llmResponse.message;
        }

        logger.info(`Workflow ${workflow.name} completed.`);
    }

    async triggerWorkflow(workflowId, inputData) {
        await this.executeWorkflow(workflowId, inputData);
    }

    registerActions() {
        if (!this.context || !this.context.actions) {
            throw new Error('Global context with actions is required for AgentWorkflowManager.');
        }

        if (!this.context.actions.triggerAgentWorkflow) {
            this.context.actions.triggerAgentWorkflow = async (ctx, params) => {
                const { workflowId, inputData } = params;
                if (!workflowId || !inputData) {
                    throw new Error('Invalid parameters. Ensure "workflowId" and "inputData" are provided.');
                }

                return this.triggerWorkflow(workflowId, inputData);
            };
        }

        logger.info('AgentWorkflowManager actions registered in global context.');
    }
}

module.exports = AgentWorkflowManager;
