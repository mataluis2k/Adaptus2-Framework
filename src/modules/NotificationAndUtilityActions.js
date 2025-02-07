'use strict';

// From the first snippet
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const fetch = require('node-fetch');
const logger = require('./logger');
const notificationService = require('../services/notification');
const { getDbConnection, query } = require('./db');
const UniversalApiClient = require('./UniversalApiClient');

// DB helpers (if applicable)
const {
  create,
  read,
  update,
  delete: deleteRecord,
  query
} = require('./db'); // Adjust path to your db module

// If you have a shared globalContext or logger, import it here:
const { globalContext } = require('../path/to/context') || {};

/**
 * NotificationAndUtilityActions
 * 
 * Merged version: references both direct usage of nodemailer/twilio/fetch 
 * and the service-oriented approach with EmailService, SMSService, etc.
 */
class NotificationAndUtilityActions {
  constructor(gCtx) {
    this.globalContext = gCtx || globalContext;
    this.registerActions();
  }

  registerActions() {
    // Notifications and Communications
    this.globalContext.actions.send_email = this.sendEmail.bind(this);
    this.globalContext.actions.send_sms = this.sendSms.bind(this);
    this.globalContext.actions.send_push_notification = this.sendPushNotification.bind(this);

    // Scheduling and Workflow
    this.globalContext.actions.schedule_action = this.scheduleAction.bind(this);
    this.globalContext.actions.execute_workflow = this.executeWorkflow.bind(this);

    // Data Processing and Transformation
    this.globalContext.actions.calculate = this.calculate.bind(this);
    this.globalContext.actions.transform_data = this.transformData.bind(this);

    // Integration
    this.globalContext.actions.call_api = this.callApi.bind(this);
    this.globalContext.actions.fetch_data = this.fetchData.bind(this);

    // Security and Access Control
    this.globalContext.actions.authenticate_user = this.authenticateUser.bind(this);
    this.globalContext.actions.authorize_action = this.authorizeAction.bind(this);
    this.globalContext.actions.encrypt = this.encrypt.bind(this);
    this.globalContext.actions.decrypt = this.decrypt.bind(this);

    // Logging and Auditing
    this.globalContext.actions.log = this.log.bind(this);
    this.globalContext.actions.audit = this.audit.bind(this);

    // Analytics and Reporting
    this.globalContext.actions.generate_report = this.generateReport.bind(this);
    this.globalContext.actions.track_metric = this.trackMetric.bind(this);

    // File and Media Handling
    this.globalContext.actions.upload_file = this.uploadFile.bind(this);
    this.globalContext.actions.generate_thumbnail = this.generateThumbnail.bind(this);

    // Optional DB CRUD references (if you want them accessible here too):
    this.globalContext.actions.create_record = this.createRecord.bind(this);
    this.globalContext.actions.read_record = this.readRecord.bind(this);
    this.globalContext.actions.update_record = this.updateRecord.bind(this);
    this.globalContext.actions.delete_record = this.deleteRecord.bind(this);
    this.globalContext.actions.query_db = this.queryDb.bind(this);
  }

  /**
   * ------------------------------------------------
   *  NOTIFICATIONS
   * ------------------------------------------------
   */

  /**
   * sendEmail
   * DSL Example:
   *   send_email to:"${data.email}" subject:"Hello" template:"welcome" data:{ "name": "John" }
   */
  async sendEmail(ctx, params) {
    try {
      const { to, subject, template, data } = params;
      if (!to || !template) {
        throw new Error('Missing required email parameters');
      }

      const result = await notificationService.send({
        channels: ['email'],
        templates: { email: template },
        recipients: { email: to },
        data: { ...data, subject }
      });

      logger.info('Email sent successfully', { to, template });
      return result;
    } catch (error) {
      logger.error('Failed to send email:', error);
      throw error;
    }
  }

  /**
   * sendSms
   * DSL Example:
   *   send_sms to:"${data.phone}" template:"verification" data:{ "code": "123456" }
   */
  async sendSms(ctx, params) {
    try {
      const { to, template, data } = params;
      if (!to || !template) {
        throw new Error('Missing required SMS parameters');
      }

      const result = await notificationService.send({
        channels: ['sms'],
        templates: { sms: template },
        recipients: { phone: to },
        data
      });

      logger.info('SMS sent successfully', { to, template });
      return result;
    } catch (error) {
      logger.error('Failed to send SMS:', error);
      throw error;
    }
  }

  /**
   * sendPushNotification
   * DSL Example:
   *   send_push_notification deviceToken:"${data.token}" template:"notification" data:{ "title": "Hello", "message": "New update!" }
   */
  async sendPushNotification(ctx, params) {
    try {
      const { deviceToken, template, data } = params;
      if (!deviceToken || !template) {
        throw new Error('Missing required push notification parameters');
      }

      const result = await notificationService.send({
        channels: ['push'],
        templates: { push: template },
        recipients: { deviceToken },
        data
      });

      logger.info('Push notification sent successfully', { deviceToken, template });
      return result;
    } catch (error) {
      logger.error('Failed to send push notification:', error);
      throw error;
    }
  }

  /**
   * sendMultiChannelNotification
   * DSL Example:
   *   send_multi_channel_notification channels:["email", "sms", "push"] templates:{ "email": "welcome", "sms": "alert", "push": "notification" } data:{ "title": "Welcome", "message": "Hello!" }
   */
  async sendMultiChannelNotification(ctx, params) {
    try {
      const { channels, templates, data, recipients } = params;
      if (!channels || !templates || !recipients) {
        throw new Error('Missing required notification parameters');
      }

      const result = await notificationService.send({
        channels,
        templates,
        recipients,
        data
      });

      logger.info('Multi-channel notification sent successfully', { channels, templates });
      return result;
    } catch (error) {
      logger.error('Failed to send multi-channel notification:', error);
      throw error;
    }
  }

  /**
   * ------------------------------------------------
   *  SCHEDULING & WORKFLOW
   * ------------------------------------------------
   */

  scheduleAction(ctx, params) {
    const { time, action } = params;
    if (!time || !action || !action.type) {
      this._logError('schedule_action', 'Missing time or action.type');
      return;
    }

    const executeAt = new Date(time).getTime();
    const now = Date.now();
    if (executeAt <= now) {
      this._logError('schedule_action', `Time is in the past: ${time}`);
      return;
    }

    setTimeout(() => {
      if (typeof this.globalContext.actions[action.type] === 'function') {
        this.globalContext.actions[action.type](ctx, action);
      } else {
        this._logError('schedule_action', `Action "${action.type}" not found`);
      }
    }, executeAt - now);

    this._logInfo(`Action "${action.type}" scheduled at ${time}`);
  }

  executeWorkflow(ctx, params) {
    const { name, data } = params;
    if (!name) {
      this._logError('execute_workflow', 'Missing workflow name');
      return;
    }
    this._logInfo(`Executing workflow "${name}" with data: ${JSON.stringify(data)}`);
    // Implement your business workflow or orchestration logic here
  }

  /**
   * ------------------------------------------------
   *  DATA PROCESSING
   * ------------------------------------------------
   */

  calculate(ctx, params) {
    const { expression, resultKey } = params;
    if (!expression || !resultKey) {
      this._logError('calculate', 'Missing expression or resultKey');
      return;
    }
    try {
      const result = new Function('data', `with(data) { return ${expression}; }`)(ctx.data || {});
      ctx.data[resultKey] = result;
      this._logInfo(`Calculated ${resultKey} = ${result}`);
    } catch (err) {
      this._logError('calculate', err);
    }
  }

  transformData(ctx, params) {
    const { input, transformation, outputKey } = params;
    if (!input || !transformation || !outputKey) {
      this._logError('transform_data', 'Missing input, transformation, or outputKey');
      return;
    }
    try {
      const result = new Function('data', `return ${transformation};`)(input);
      ctx.data[outputKey] = result;
      this._logInfo(`Transformed data stored in ctx.data["${outputKey}"]`);
    } catch (err) {
      this._logError('transform_data', err);
    }
  }

  /**
   * ------------------------------------------------
   *  INTEGRATION
   * ------------------------------------------------
   */

  /**
   * callApi
   * DSL Example:
   *   call_api url:"https://example.com/api" method:"POST" headers:{} body:{}
   */
  async callApi(ctx, params) {
    const { url, method = 'GET', headers, body } = params;
    if (!url) {
      this._logError('call_api', 'Missing URL');
      return;
    }
    try {
      // Using node-fetch directly
      const response = await fetch(url, { 
        method, 
        headers, 
        body: body ? JSON.stringify(body) : undefined 
      });
      const result = await response.json();
      this._logInfo(`API response from ${url}: ${JSON.stringify(result)}`);
    } catch (err) {
      this._logError('call_api', err);
    }
  }

  /**
   * fetchData
   * DSL Example:
   *   fetch_data url:"https://example.com/data" method:"GET" outputKey:"apiData"
   * Stores the JSON result in ctx.data[outputKey].
   * Alternatively, you could use UniversalApiClient here.
   */
  async fetchData(ctx, params) {
    const { url, method = 'GET', outputKey } = params;
    if (!url || !outputKey) {
      this._logError('fetch_data', 'Missing url or outputKey');
      return;
    }

    try {
      const response = await fetch(url, { method });
      const data = await response.json();
      ctx.data[outputKey] = data;
      this._logInfo(`Fetched data stored in ctx.data["${outputKey}"]`);
    } catch (err) {
      this._logError('fetch_data', err);
    }
  }

  /**
   * ------------------------------------------------
   *  SECURITY & ACCESS CONTROL
   * ------------------------------------------------
   */

  authenticateUser(ctx, params) {
    const { username, password } = params;
    if (!username || !password) {
      this._logError('authenticate_user', 'Missing username or password');
      return;
    }
    // Option A: Placeholder direct logic
    this._logInfo(`Authenticating user ${username}...`);
    // Option B: Use AuthService
    /*
    AuthService.authenticate(username, password)
      .then(user => {
        ctx.data.currentUser = user;
        this._logInfo(`User ${username} authenticated successfully.`);
      })
      .catch(err => this._logError('authenticate_user', err));
    */
  }

  authorizeAction(ctx, params) {
    const { userId, resource, action } = params;
    if (!userId || !resource || !action) {
      this._logError('authorize_action', 'Missing userId, resource, or action');
      return;
    }
    // Option A: Placeholder logic
    this._logInfo(`Authorizing user ${userId} for "${action}" on "${resource}"`);
    // Option B: Use AuthService
    /*
    AuthService.authorize(userId, resource, action)
      .then(allowed => {
        if (!allowed) throw new Error('Not allowed');
        this._logInfo(`User ${userId} authorized for ${action} on ${resource}`);
      })
      .catch(err => this._logError('authorize_action', err));
    */
  }

  encrypt(ctx, params) {
    const { data, outputKey } = params;
    if (!data || !outputKey) {
      this._logError('encrypt', 'Missing data or outputKey');
      return;
    }
    try {
      // Simple base64 approach or AES approach
      // Option A: base64 (like snippet 1)
      const encrypted = Buffer.from(data).toString('base64');
      ctx.data[outputKey] = encrypted;
      this._logInfo(`Data encrypted (base64) -> ctx.data["${outputKey}"]`);
      
      // Option B: AES-256-CBC
      /*
      const key = process.env.ENCRYPTION_KEY || '32_characters_long_key_forAES!';
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key), iv);
      let encrypted = cipher.update(data, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const finalValue = iv.toString('hex') + ':' + encrypted;
      ctx.data[outputKey] = finalValue;
      this._logInfo(`Data encrypted (AES) -> ctx.data["${outputKey}"]`);
      */
    } catch (err) {
      this._logError('encrypt', err);
    }
  }

  decrypt(ctx, params) {
    const { data, outputKey } = params;
    if (!data || !outputKey) {
      this._logError('decrypt', 'Missing data or outputKey');
      return;
    }
    try {
      // Option A: base64 decode
      const decrypted = Buffer.from(data, 'base64').toString('utf8');
      ctx.data[outputKey] = decrypted;
      this._logInfo(`Data decrypted (base64) -> ctx.data["${outputKey}"]`);

      // Option B: AES-256-CBC
      /*
      const key = process.env.ENCRYPTION_KEY || '32_characters_long_key_forAES!';
      const [ivHex, encrypted] = data.split(':');
      const iv = Buffer.from(ivHex, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key), iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      ctx.data[outputKey] = decrypted;
      this._logInfo(`Data decrypted (AES) -> ctx.data["${outputKey}"]`);
      */
    } catch (err) {
      this._logError('decrypt', err);
    }
  }

  /**
   * ------------------------------------------------
   *  LOGGING & AUDITING
   * ------------------------------------------------
   */

  log(ctx, params) {
    const { level = 'info', message } = params;
    if (!message) {
      this._logError('log', 'No message provided');
      return;
    }
    this._log(level, message);
  }

  audit(ctx, params) {
    const { userId, action, details } = params;
    if (!userId || !action) {
      this._logError('audit', 'Missing userId or action');
      return;
    }
    this._logInfo(`Audit: User ${userId} performed ${action} with details: ${JSON.stringify(details)}`);
  }

  /**
   * ------------------------------------------------
   *  ANALYTICS & REPORTING
   * ------------------------------------------------
   */

  async generateReport(ctx, params) {
    const { type, filters, outputKey } = params;
    if (!type || !outputKey) {
      this._logError('generate_report', 'Missing report type or outputKey');
      return;
    }

    // Option A: Mock
    this._logInfo(`Generating ${type} report with filters: ${JSON.stringify(filters)}`);
    ctx.data[outputKey] = `Report: ${type}`;

    // Option B: Use AnalyticsService
    /*
    try {
      const reportData = await AnalyticsService.generateReport(type, filters || {});
      ctx.data[outputKey] = reportData;
      this._logInfo(`Report '${type}' stored in ctx.data["${outputKey}"]`);
    } catch (err) {
      this._logError('generate_report', err);
    }
    */
  }

  trackMetric(ctx, params) {
    const { name, value } = params;
    if (!name) {
      this._logError('track_metric', 'Missing metric name');
      return;
    }

    // Option A: Mock
    this._logInfo(`Tracking metric ${name}: ${value}`);

    // Option B: Use AnalyticsService
    /*
    try {
      AnalyticsService.trackMetric(name, value);
      this._logInfo(`Metric "${name}" tracked with value=${value}`);
    } catch (err) {
      this._logError('track_metric', err);
    }
    */
  }

  /**
   * ------------------------------------------------
   *  FILE & MEDIA HANDLING
   * ------------------------------------------------
   */

  async uploadFile(ctx, params) {
    const { path, file, outputKey } = params;
    if (!path || !file || !outputKey) {
      this._logError('upload_file', 'Missing path, file, or outputKey');
      return;
    }

    // Option A: Simple local approach
    try {
      const filePath = `${path}/${uuidv4()}_${file.name}`;
      // You could do fs.writeFileSync(...) if `file` is a buffer, etc.
      this._logInfo(`File uploaded (mock) to ${filePath}`);
      ctx.data[outputKey] = filePath;
    } catch (err) {
      this._logError('upload_file - local', err);
    }

    // Option B: Using a FileService
    /*
    try {
      const finalPath = await FileService.uploadFile(file, path);
      ctx.data[outputKey] = finalPath;
      this._logInfo(`File uploaded -> ctx.data["${outputKey}"] = ${finalPath}`);
    } catch (err) {
      this._logError('upload_file - FileService', err);
    }
    */
  }

  async generateThumbnail(ctx, params) {
    const { input, output, width = 200, height = 200 } = params;
    if (!input || !output) {
      this._logError('generate_thumbnail', 'Missing input or output');
      return;
    }

    // Option A: Mock
    this._logInfo(`Thumbnail generated (mock) for ${input} at ${output}`);

    // Option B: Use MediaService
    /*
    try {
      await MediaService.generateThumbnail(input, output, { width, height });
      this._logInfo(`Thumbnail generated: ${output}`);
    } catch (err) {
      this._logError('generate_thumbnail - MediaService', err);
    }
    */
  }

  /**
   * ------------------------------------------------
   *  OPTIONAL: DB CRUD ACTIONS
   * ------------------------------------------------
   */
  async createRecord(ctx, params) {
    const { entity, data } = params;
    if (!entity || !data) {
      this._logError('create_record', 'Missing entity or data');
      return;
    }
    try {
      const result = await create(ctx.config, entity, data);
      return result;
    } catch (err) {
      this._logError('create_record', err);
    }
  }

  async readRecord(ctx, params) {
    const { entity, query: q } = params;
    if (!entity) {
      this._logError('read_record', 'Missing entity');
      return;
    }
    try {
      return await read(ctx.config, entity, q || {});
    } catch (err) {
      this._logError('read_record', err);
    }
  }

  async updateRecord(ctx, params) {
    const { entity, query: q, data } = params;
    if (!entity || !q || !data) {
      this._logError('update_record', 'Missing entity, query, or data');
      return;
    }
    try {
      return await update(ctx.config, entity, q, data);
    } catch (err) {
      this._logError('update_record', err);
    }
  }

  async deleteRecord(ctx, params) {
    const { entity, query: q } = params;
    if (!entity || !q) {
      this._logError('delete_record', 'Missing entity or query');
      return;
    }
    try {
      return await deleteRecord(ctx.config, entity, q);
    } catch (err) {
      this._logError('delete_record', err);
    }
  }

  async queryDb(ctx, params) {
    const { sql, values } = params;
    if (!sql) {
      this._logError('query_db', 'Missing SQL statement');
      return;
    }
    try {
      return await query(ctx.config, sql, values || []);
    } catch (err) {
      this._logError('query_db', err);
    }
  }

  /**
   * ------------------------------------------------
   *  INTERNAL LOGGING HELPERS
   * ------------------------------------------------
   */
  _log(level, msg) {
    if (this.globalContext.logger && typeof this.globalContext.logger[level] === 'function') {
      this.globalContext.logger[level](msg);
    } else {
      // fallback to console
      console[level](msg);
    }
  }

  _logInfo(msg) {
    this._log('info', msg);
  }

  _logError(context, err) {
    const message = err instanceof Error ? err.message : err;
    this._log('error', `[${context}] ${message}`);
  }
}

module.exports = NotificationAndUtilityActions;
