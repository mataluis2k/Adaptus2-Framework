// src/modules/EventLogger.js

const { create, query } = require('./db');          // your create(config, entity, data)
const { redisClient } = require('./redisClient');
const path = require('path');
const fs   = require('fs');

const configDefault =  {
  queueKey: 'eventLoggerQueue',
  flushIntervalMs: 5000,
  batchSize: 100
};

class EventLogger {
  constructor() {
    this.config = require(path.join(
      process.env.CONFIG_DIR || './config',
      'eventLogger.json'
    ));
    if (!this.config) {
      console.warn('EventLogger config not found, using defaults');
      this.config = configDefault;
    }    
    this.redis = redisClient;
    this.queueKey = this.config.queueKey;
    this.flushing = false;

    // start periodic flush
    this.interval = setInterval(() => this._flush(), this.config.flushIntervalMs);
  }

  /**
   * Queue one event for later insert.
   * @param {{dbType: string, dbConnection: string}} dbConfig  from your getDbConnection signature
   * @param {string} entity   the table/entity name as defined in your apiConfig
   * @param {object} payload  the row data to insert
   */
  async log(dbConfig, entity, payload) {
    const item = JSON.stringify({ dbConfig, entity, payload });
    console.log('EventLogger log:', entity);
    await this.redis.lpush(this.queueKey, item);
    const len = await this.redis.llen(this.queueKey);
    if (len >= this.config.batchSize && !this.flushing) {
      this._flush();
    }
  }

  /** Internal: pull up to batchSize items, then write them via your create() fn */
  async _flush() {
    if (this.flushing) return;
    this.flushing = true;
  
    try {
      // 1. Grab up to batchSize items
      const raws = await this.redis.lrange(this.queueKey, 0, this.config.batchSize - 1);
      if (raws.length === 0) return;
      console.log('EventLogger flush:', raws.length);
      // 2. Trim them off Redis so we won't re-process
      await this.redis.ltrim(this.queueKey, raws.length, -1);
  
      // 3. Parse and dispatch each op
      const objs = raws.map(r => JSON.parse(r));
      await Promise.all(objs.map(async item => {
        if (item.op === 'update') {
          console.log('EventLogger update:', item.entity);
          // UPDATE path: open a connection and execute SQL          
          await query(item.dbConfig, item.sql, item.params);
        } else {
          // INSERT path (default)
          // Need to check for the existeance of created_at and convert to a date
          console.log('EventLogger create:', item.entity);
          if (item.payload.created_at) {
            item.payload.created_at = new Date(item.payload.created_at);
          }
          await create(item.dbConfig, item.entity, item.payload);
        }
      }));
    } catch (err) {
      console.error('EventLogger flush error:', err);
      // On error, items remain in Redis; next interval retries
    } finally {
      this.flushing = false;
    }
  }
  

  async logUpdate(dbConfig, sql, params) {
    const item = JSON.stringify({ dbConfig, sql, params, op: 'update' });
    await this.redis.lpush(this.queueKey, item);
  }
  /** Call on shutdown to flush remaining events */
  async shutdown() {
    clearInterval(this.interval);
    await this._flush();
    await this.redis.quit();
  }
}

module.exports = new EventLogger();
