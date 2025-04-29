// agentWorkflowModule.js
const { read, create, update, remove, exists, createTable } = require('./db');
const express = require('express');
const { aarMiddleware } = require('../middleware/aarMiddleware');
const { v4: uuidv4 } = require('uuid');
const bodyParser = require('body-parser');
const moment = require('moment');

// Define table names
const WORKFLOWS_TABLE = 'agent_workflows';
const AGENTS_TABLE = 'agents';
const MCPS_TABLE = 'mcp_tools';

// Define schema for workflows
const workflowsSchemaDefinition = {
  id: 'varchar(36) PRIMARY KEY',
  name: 'varchar(100)',
  created: 'timestamp',
  lastModified: 'timestamp',
  elements: 'json',
  connections: 'json',
  mcpAttachments: 'json',
  inputs: 'json',
  outputs: 'json',
  metadata: 'json',
  settings: 'json'
};

// Define schema for agents
const agentsSchemaDefinition = {
  id: 'varchar(36) PRIMARY KEY',
  name: 'varchar(100)',
  avatar: 'varchar(20)',
  attributes: 'json',
  createdAt: 'timestamp',
  updatedAt: 'timestamp'
};

// Define schema for MCPs
const mcpsSchemaDefinition = {
  id: 'varchar(36) PRIMARY KEY',
  name: 'varchar(100)',
  description: 'text',
  category: 'varchar(50)',
  parameters: 'json',
  createdAt: 'timestamp',
  updatedAt: 'timestamp'
};

class AgentWorkflowModule {
  constructor(config, redisClient, app) {
    this.config = config;
    this.redis = redisClient;
    this.cacheTTL = 300; // seconds
    this.app = app;
    this.router = express.Router();
    this.initSchemas();
    this.setupRoutes();
    this.app.use('/mcp', this.router);
  }

  async initSchemas() {
    try {
      // Register tables in the API config first
      const { getApiConfig } = require('./apiConfig');
      const apiConfig = getApiConfig();
      
      // Setup Workflows table in API config
      if (!apiConfig.find(config => config.dbTable === WORKFLOWS_TABLE)) {
        apiConfig.push({
          routeType: 'def',
          dbTable: WORKFLOWS_TABLE,
          keys: ['id'],
          allowRead: Object.keys(workflowsSchemaDefinition),
          allowWrite: Object.keys(workflowsSchemaDefinition)
        });
      }
      
      // Setup Agents table in API config
      if (!apiConfig.find(config => config.dbTable === AGENTS_TABLE)) {
        apiConfig.push({
          routeType: 'def',
          dbTable: AGENTS_TABLE,
          keys: ['id'],
          allowRead: Object.keys(agentsSchemaDefinition),
          allowWrite: Object.keys(agentsSchemaDefinition)
        });
      }
      
      // Setup MCPs table in API config
      if (!apiConfig.find(config => config.dbTable === MCPS_TABLE)) {
        apiConfig.push({
          routeType: 'def',
          dbTable: MCPS_TABLE,
          keys: ['id'],
          allowRead: Object.keys(mcpsSchemaDefinition),
          allowWrite: Object.keys(mcpsSchemaDefinition)
        });
      }
      
      console.log('[AgentWorkflow] Creating or checking tables schemas...');
      await createTable(this.config, WORKFLOWS_TABLE, workflowsSchemaDefinition);
      await createTable(this.config, AGENTS_TABLE, agentsSchemaDefinition);
      await createTable(this.config, MCPS_TABLE, mcpsSchemaDefinition);
      console.log('[AgentWorkflow] Tables schemas created/verified successfully');
    } catch (error) {
      console.error('[AgentWorkflow] Error initializing schemas:', error.message);
      console.error(error.stack);
    }
  }

  // =============== WORKFLOW METHODS ===============

  async getWorkflows() {
    const cacheKey = 'workflows:list';
    const cached = await this.redis.get(cacheKey);
    
    if (cached) return JSON.parse(cached);
    
    const workflows = await read(this.config, WORKFLOWS_TABLE, {});
    
    // Only cache basic workflow info for the list (not the full content)
    const workflowsList = workflows.map(workflow => ({
      id: workflow.id,
      name: workflow.name,
      lastModified: workflow.lastModified
    }));
    
    await this.redis.set(cacheKey, JSON.stringify(workflowsList), "EX", this.cacheTTL);
    
    return workflowsList;
  }

  async getWorkflowById(id) {
    const cacheKey = `workflow:${id}`;
    const cached = await this.redis.get(cacheKey);
    
    if (cached) return JSON.parse(cached);
    
    const workflows = await read(this.config, WORKFLOWS_TABLE, { id });
    const workflow = workflows.length ? workflows[0] : null;
    
    if (workflow) {
      await this.redis.set(cacheKey, JSON.stringify(workflow), "EX", this.cacheTTL);
    }
    
    return workflow;
  }

  validateWorkflowData(data) {
    if (!data.name || typeof data.name !== 'string') {
      throw new Error('Invalid workflow name');
    }
    if (!data.elements || !Array.isArray(data.elements)) {
      throw new Error('Invalid workflow elements');
    }
    if (!data.connections || !Array.isArray(data.connections)) {
      throw new Error('Invalid workflow connections');
    }
  }

  async createWorkflow(workflowData) {
    this.validateWorkflowData(workflowData);
    
    // Ensure ID is set
    workflowData.id = workflowData.id || `workflow-${uuidv4()}`;
    
    // Set timestamps
    const now = moment().utc().format('YYYY-MM-DD HH:mm:ss');
    workflowData.created = workflowData.created || now;
    workflowData.lastModified = now;
    
    // Ensure all properties are defined
    workflowData.mcpAttachments = workflowData.mcpAttachments || {};
    workflowData.inputs = workflowData.inputs || [];
    workflowData.outputs = workflowData.outputs || [];
    workflowData.metadata = workflowData.metadata || {
      description: `Workflow for ${workflowData.name}`,
      version: "1.0",
      tags: [],
      createdBy: "system"
    };
    workflowData.settings = workflowData.settings || {
      maxConcurrentRequests: 50,
      timeout: 30000,
      retryCount: 3,
      logLevel: "info"
    };
    
    const result = await create(this.config, WORKFLOWS_TABLE, workflowData);
    
    // Invalidate caches
    await this.redis.del('workflows:list');
    
    return result;
  }

  async updateWorkflow(id, workflowData) {
    this.validateWorkflowData(workflowData);
    
    // Update timestamp
    workflowData.lastModified = moment().utc().format('YYYY-MM-DD HH:mm:ss');
    
    // Make sure the ID doesn't change
    workflowData.id = id;
    
    const result = await update(this.config, WORKFLOWS_TABLE, { id }, workflowData);
    
    // Invalidate caches
    await this.redis.del(`workflow:${id}`);
    await this.redis.del('workflows:list');
    
    return result;
  }

  async deleteWorkflow(id) {
    const result = await remove(this.config, WORKFLOWS_TABLE, { id });
    
    // Invalidate caches
    await this.redis.del(`workflow:${id}`);
    await this.redis.del('workflows:list');
    
    return result;
  }

  // =============== AGENT METHODS ===============

  async getAgents() {
    const cacheKey = 'agents:list';
    const cached = await this.redis.get(cacheKey);
    
    if (cached) return JSON.parse(cached);
    
    const agents = await read(this.config, AGENTS_TABLE, {});
    
    await this.redis.set(cacheKey, JSON.stringify(agents), "EX", this.cacheTTL);
    
    return agents;
  }

  validateAgentData(data) {
    if (!data.name || typeof data.name !== 'string') {
      throw new Error('Invalid agent name');
    }
    if (!data.avatar) {
      throw new Error('Invalid agent avatar');
    }
    if (!data.attributes || typeof data.attributes !== 'object') {
      throw new Error('Invalid agent attributes');
    }
  }

  async createOrUpdateAgent(agentData) {
    this.validateAgentData(agentData);
    
    // Ensure ID is set
    agentData.id = agentData.id || uuidv4();
    
    // Set timestamps
    const now = moment().utc().format('YYYY-MM-DD HH:mm:ss');
    agentData.updatedAt = now;
    
    // Check if agent already exists
    const existingAgent = await read(this.config, AGENTS_TABLE, { id: agentData.id });
    
    let result;
    if (existingAgent.length > 0) {
      result = await update(this.config, AGENTS_TABLE, { id: agentData.id }, agentData);
    } else {
      agentData.createdAt = now;
      result = await create(this.config, AGENTS_TABLE, agentData);
    }
    
    // Invalidate cache
    await this.redis.del('agents:list');
    
    return result;
  }

  // =============== MCP METHODS ===============

  async getMcps() {
    const cacheKey = 'mcps:list';
    const cached = await this.redis.get(cacheKey);
    
    if (cached) return JSON.parse(cached);
    
    const mcps = await read(this.config, MCPS_TABLE, {});
    
    await this.redis.set(cacheKey, JSON.stringify(mcps), "EX", this.cacheTTL);
    
    return mcps;
  }

  validateMcpData(data) {
    if (!data.name || typeof data.name !== 'string') {
      throw new Error('Invalid MCP name');
    }
    if (!data.description || typeof data.description !== 'string') {
      throw new Error('Invalid MCP description');
    }
    if (!data.category || typeof data.category !== 'string') {
      throw new Error('Invalid MCP category');
    }
    if (!data.parameters || !Array.isArray(data.parameters)) {
      throw new Error('Invalid MCP parameters');
    }
  }

  async createOrUpdateMcp(mcpData) {
    this.validateMcpData(mcpData);
    
    // Ensure ID is set
    mcpData.id = mcpData.id || uuidv4();
    
    // Set timestamps
    const now = moment().utc().format('YYYY-MM-DD HH:mm:ss');
    mcpData.updatedAt = now;
    
    // Check if MCP already exists
    const existingMcp = await read(this.config, MCPS_TABLE, { id: mcpData.id });
    
    let result;
    if (existingMcp.length > 0) {
      result = await update(this.config, MCPS_TABLE, { id: mcpData.id }, mcpData);
    } else {
      mcpData.createdAt = now;
      result = await create(this.config, MCPS_TABLE, mcpData);
    }
    
    // Invalidate cache
    await this.redis.del('mcps:list');
    
    return result;
  }

  // =============== BULK OPERATIONS ===============

  async bulkImportWorkflows(workflows) {
    const results = [];
    for (const workflowData of workflows) {
      try {
        let result;
        const existingWorkflow = await read(this.config, WORKFLOWS_TABLE, { id: workflowData.id });
        
        if (existingWorkflow.length > 0) {
          result = await this.updateWorkflow(workflowData.id, workflowData);
        } else {
          result = await this.createWorkflow(workflowData);
        }
        
        results.push({ success: true, id: workflowData.id, name: workflowData.name, result });
      } catch (err) {
        results.push({ success: false, id: workflowData.id, name: workflowData.name, error: err.message });
      }
    }
    return results;
  }

  async bulkImportAgents(agents) {
    const results = [];
    for (const agentData of agents) {
      try {
        const result = await this.createOrUpdateAgent(agentData);
        results.push({ success: true, id: agentData.id, name: agentData.name, result });
      } catch (err) {
        results.push({ success: false, id: agentData.id, name: agentData.name, error: err.message });
      }
    }
    return results;
  }

  async bulkImportMcps(mcps) {
    const results = [];
    for (const mcpData of mcps) {
      try {
        const result = await this.createOrUpdateMcp(mcpData);
        results.push({ success: true, id: mcpData.id, name: mcpData.name, result });
      } catch (err) {
        results.push({ success: false, id: mcpData.id, name: mcpData.name, error: err.message });
      }
    }
    return results;
  }

  // =============== ROUTES SETUP ===============

  setupRoutes() {
    this.router.use(bodyParser.json({ limit: '10mb' }));
    
    // Workflow routes
    this.router.get('/workflows', (req, res) => {
      this.getWorkflows()
        .then(workflows => {
          res.json(workflows);
        })
        .catch(err => {
          res.status(500).json({ error: err.message });
        });
    });

    this.router.get('/workflows/:id', (req, res) => {
      this.getWorkflowById(req.params.id)
        .then(workflow => {
          if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
          res.json(workflow);
        })
        .catch(err => {
          res.status(500).json({ error: err.message });
        });
    });

    this.router.post('/workflows', (req, res) => {
      this.createWorkflow(req.body)
        .then(result => {
          res.status(201).json({ success: true, id: req.body.id, result });
        })
        .catch(err => {
          res.status(400).json({ success: false, error: err.message });
        });
    });

    this.router.put('/workflows/:id', (req, res) => {
      this.updateWorkflow(req.params.id, req.body)
        .then(result => {
          res.json({ success: true, result });
        })
        .catch(err => {
          res.status(400).json({ success: false, error: err.message });
        });
    });

    this.router.delete('/workflows/:id', (req, res) => {
      this.deleteWorkflow(req.params.id)
        .then(result => {
          res.json({ success: true, result });
        })
        .catch(err => {
          res.status(500).json({ success: false, error: err.message });
        });
    });

    // Agent routes
    this.router.get('/agents', (req, res) => {
      this.getAgents()
        .then(agents => {
          res.json(agents);
        })
        .catch(err => {
          res.status(500).json({ error: err.message });
        });
    });

    this.router.post('/agents', (req, res) => {
      this.createOrUpdateAgent(req.body)
        .then(result => {
          res.status(201).json({ success: true, id: req.body.id, result });
        })
        .catch(err => {
          res.status(400).json({ success: false, error: err.message });
        });
    });

    // MCP routes
    this.router.get('/mcps', (req, res) => {
      this.getMcps()
        .then(mcps => {
          res.json(mcps);
        })
        .catch(err => {
          res.status(500).json({ error: err.message });
        });
    });

    this.router.post('/mcps', (req, res) => {
      this.createOrUpdateMcp(req.body)
        .then(result => {
          res.status(201).json({ success: true, id: req.body.id, result });
        })
        .catch(err => {
          res.status(400).json({ success: false, error: err.message });
        });
    });

    // Bulk import routes
    this.router.post('/workflows/import', (req, res) => {
      this.bulkImportWorkflows(req.body)
        .then(result => {
          res.json(result);
        })
        .catch(err => {
          res.status(500).json({ error: err.message });
        });
    });

    this.router.post('/agents/import', (req, res) => {
      this.bulkImportAgents(req.body)
        .then(result => {
          res.json(result);
        })
        .catch(err => {
          res.status(500).json({ error: err.message });
        });
    });

    this.router.post('/mcps/import', (req, res) => {
      this.bulkImportMcps(req.body)
        .then(result => {
          res.json(result);
        })
        .catch(err => {
          res.status(500).json({ error: err.message });
        });
    });
  }
}

module.exports = AgentWorkflowModule;