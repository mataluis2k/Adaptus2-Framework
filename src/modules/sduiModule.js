// sduiModule.js
const { read, create, exists, createTable } = require('./db');
const express = require('express');
const { aarMiddleware } = require('../middleware/aarMiddleware');
const { v4: uuidv4 } = require('uuid');
const bodyParser = require('body-parser');
const moment = require('moment');

const SDUI_TABLE = 'sdui_screens';

const schemaDefinition = {
  id: 'varchar(36) PRIMARY KEY',
  screenId: 'varchar(100)',
  platform: 'varchar(50)',
  version: 'varchar(20)',
  layout: 'json',
  createdAt: 'timestamp',
  updatedAt: 'timestamp'
};

class SDUIModule {
  constructor(config, redisClient, app) {
    this.config = config;
    this.redis = redisClient;
    this.cacheTTL = 300; // seconds
    this.app = app;
    this.router = express.Router();
    this.initSDUISchema();
    this.setupRoutes();
    this.app.use('/sdui', this.router);
  }

  async initSDUISchema() {
    try {
      // Register the table in the API config first
      const { getApiConfig } = require('./apiConfig');
      const apiConfig = getApiConfig();
      
      // Check if table definition already exists in API config
      if (!apiConfig.find(config => config.dbTable === SDUI_TABLE)) {
        // Add definition to API config
        apiConfig.push({
          routeType: 'def',
          dbTable: SDUI_TABLE,
          keys: ['id'],
          allowRead: ['id', 'screenId', 'platform', 'version', 'layout', 'createdAt', 'updatedAt'],
          allowWrite: ['id', 'screenId', 'platform', 'version', 'layout', 'createdAt', 'updatedAt']
        });
      }
      
      console.log('[SDUI] Creating or checking table schema...');
      await createTable(this.config, SDUI_TABLE, schemaDefinition);
      console.log('[SDUI] Table schema created/verified successfully');
    } catch (error) {
      console.error('[SDUI] Error initializing schema:', error.message);
      console.error(error.stack);
    }
  }

  async getScreen(screenId, platform, version) {
    const cacheKey = `sdui:${screenId}:${platform || 'any'}:${version || 'latest'}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const query = { screenId };
    if (platform) query.platform = platform;
    if (version) query.version = version;

    let screens = await read(this.config, SDUI_TABLE, query);

    // Fallback logic if no exact version found
    if (!screens.length && version) {
      delete query.version;
      screens = await read(this.config, SDUI_TABLE, query);
    }

    const screen = screens.length ? screens[0] : null;
    if (screen) {
      
      await this.redis.set(cacheKey,  JSON.stringify(screen), "EX", this.cacheTTL);
    }

    return screen;
  }

  validateScreenData(data) {
    if (!data.screenId || typeof data.screenId !== 'string') {
      throw new Error('Invalid screenId');
    }
    if (!data.platform || typeof data.platform !== 'string') {
      throw new Error('Invalid platform');
    }
    if (!data.version || typeof data.version !== 'string') {
      throw new Error('Invalid version');
    }
    if (!data.layout || typeof data.layout !== 'object') {
      throw new Error('Invalid layout');
    }
  }

  async createOrUpdateScreen(screenData) {
    this.validateScreenData(screenData);
    screenData.id = screenData.id || uuidv4();
    const now =  moment().utc().format('YYYY-MM-DD HH:mm:ss');
    screenData.createdAt = now;
    screenData.updatedAt = now;

    const result = await create(this.config, SDUI_TABLE, screenData);

    // Invalidate cache
    const cacheKey = `sdui:${screenData.screenId}:${screenData.platform}:${screenData.version}`;
    await this.redis.del(cacheKey);

    return result;
  }

  async bulkImport(screens) {
    const results = [];
    for (const screenData of screens) {
      try {
        const result = await this.createOrUpdateScreen(screenData);
        results.push({ success: true, screenId: screenData.screenId, result });
      } catch (err) {
        results.push({ success: false, screenId: screenData.screenId, error: err.message });
      }
    }
    return results;
  }

  async bulkExport() {
    const screens = await read(this.config, SDUI_TABLE, {});
    return screens;
  }

  setupRoutes() {
    this.router.use(bodyParser.json());
    
    // Fix: Pass a function instead of an array as the route handler
    this.router.get('/:screenId', (req, res) => {
      this.getScreen(req.params.screenId, req.query.platform, req.query.version)
        .then(screen => {
          if (!screen) return res.status(404).json({ error: 'Screen not found' });
          res.json(screen);
        })
        .catch(err => {
          res.status(500).json({ error: err.message });
        });
    });

    this.router.post('/', (req, res) => {
      this.createOrUpdateScreen(req.body)
        .then(result => {
          res.json({ success: true, result });
        })
        .catch(err => {
          res.status(400).json({ success: false, error: err.message });
        });
    });

    this.router.post('/import', (req, res) => {
      this.bulkImport(req.body)
        .then(result => {
          res.json(result);
        })
        .catch(err => {
          res.status(500).json({ error: err.message });
        });
    });

    this.router.get('/export/all', (req, res) => {
      this.bulkExport()
        .then(screens => {
          res.json(screens);
        })
        .catch(err => {
          res.status(500).json({ error: err.message });
        });
    });
  }
}

module.exports = SDUIModule;
