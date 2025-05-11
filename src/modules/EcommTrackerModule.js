/**
 * E-commerce Tracking Server Module
 * Handles tracking events from the client-side tracking library
 * and stores them in the MySQL database
 */

const rateLimit = require('express-rate-limit');
const { getDbConnection } = require('./db');
const { v4: uuidv4 } = require('uuid');
const UAParser = require('ua-parser-js');
const eventLogger  = require('./EventLogger');

class EcommerceTracker {
    constructor(globalContext, dbConfig) {
        this.globalContext = globalContext;
        this.dbConfig = dbConfig;
        this.tablesVerified = false;
        this.registerActions();
        
        // Verify database tables on initialization
        this.verifyDatabaseTables().catch(err => {
            console.error("Failed to verify database tables:", err);
        });
    }

    registerActions() {
        this.globalContext.actions.track_ecommerce_event = this.trackEvent.bind(this);
        this.globalContext.actions.track_batch_events = this.trackBatchEvents.bind(this);
        this.globalContext.actions.verify_tracking_tables = this.verifyDatabaseTables.bind(this);
    }

    /**
     * Process and store a single tracking event
     */
    async trackEvent(ctx, params) {

        try {
            console.log("Batch Single Events:", params);
            const result = await this._processEvent(this.dbConfig, params);
            return { success: true, id: result.eventId };
        } catch (error) {

            console.error("Error in trackEvent:", error.message);
            throw new Error("Internal error during event tracking");
        }
    }

    /**
     * Process and store multiple events in a batch
     */
    async trackBatchEvents(ctx, params) {
        if (!Array.isArray(params.events) || params.events.length === 0) {
            return { success: false, error: "No events provided" };
        }

      console.log("Batch events:", params);
      

      
        try {
      
            
            const results = [];
            for (const eventData of params.events) {
                // Merge site and user data with each event
                const fullEventData = {
                    ...eventData,
                    siteId: params.siteId,
                    userId: params.userId,
                    sessionId: params.sessionId,
                    timestamp: params.timestamp || eventData.timestamp,
                    url: params.url || eventData.url,
                    referrer: params.referrer,
                    userAgent: params.userAgent,
                    viewport: params.viewport
                };
                
                const result = await this._processEvent(this.dbConfig, fullEventData);
                results.push(result);
            }
                  
            return { success: true, results };
        } catch (error) {
            
            console.error("Error in trackBatchEvents:", error.message, error.stack);
            throw new Error("Internal error during batch event tracking");
        } 
    }

    /**
     * Core function to process a single event and store it in the database
     * @private
     */
    async _processEvent(dbConfig, eventData) {
        try {
            // Ensure we have a valid dbConfig
            if(dbConfig === undefined) {
                dbConfig = this.dbConfig;
            }

            // 1. Get user ID from data or generate one
            const userId = eventData.userId || eventData.user_id || uuidv4();

            // Check if event has a name/type - required field
            if (!eventData.name && !eventData.event_type && !eventData.eventType) {
                throw new Error("Event type is required (name, event_type, or eventType must be provided)");
            }

            // 2. Store the main event - we don't need session tracking in this version
            const eventId = await this._storeEvent(dbConfig, { ...eventData, userId });
            await this._processEventSpecificData(dbConfig, { ...eventData, eventId });

            // 3. Process event-specific data based on event name if needed
            // Skip session/user management for now since the schema is different

            return { eventId, userId };
        } catch (error) {
            console.error("Error processing event:", error);
            throw error;
        }
    }

    /**
     * Ensure the user exists in the database, create if not
     * @private
     */
    async _ensureUser(dbConfig, data) {
        const { userId, userAgent, referrer, url } = data;

        if (!userId) {
            throw new Error("User ID is required");
        }

        // Use the query method from the db module that works with adaptus2-orm
        const { query } = require('./db');

        // Check if user exists
        const usersResult = await query(
            dbConfig,
            'SELECT user_id FROM users WHERE user_id = ?',
            [userId]
        );

        const users = usersResult.data || [];

        if (users.length === 0) {
            // Create new user
            await query(
                dbConfig,
                'INSERT INTO users (user_id, first_seen, last_seen, user_agent, first_referrer, first_landing_page) VALUES (?, NOW(), NOW(), ?, ?, ?)',
                [userId, userAgent || null, referrer || null, url || null]
            );
        } else {
            // Update existing user's last_seen
            await query(
                dbConfig,
                'UPDATE users SET last_seen = NOW(), total_sessions = total_sessions + 1 WHERE user_id = ?',
                [userId]
            );
        }

        return userId;
    }

    /**
     * Ensure the session exists in the database, create if not
     * @private
     */
    async _ensureSession(dbConfig, data) {
        const { sessionId, userId, userAgent, referrer, url, viewport } = data;

        if (!sessionId) {
            throw new Error("Session ID is required");
        }

        // Use the query method from the db module that works with adaptus2-orm
        const { query } = require('./db');

        // Check if session exists
        const sessionsResult = await query(
            dbConfig,
            'SELECT session_id FROM sessions WHERE session_id = ?',
            [sessionId]
        );

        const sessions = sessionsResult.data || [];

        if (sessions.length === 0) {
            // Parse user agent if available
            let browserName = '';
            let browserVersion = '';
            let deviceType = 'desktop';
            let osName = '';

            if (userAgent) {
                const uaParser = new UAParser(userAgent);
                const browser = uaParser.getBrowser() || {};
                const device = uaParser.getDevice() || {};
                const os = uaParser.getOS() || {};

                browserName = browser.name || '';
                browserVersion = browser.version || '';
                deviceType = device.type || 'desktop';
                osName = os.name || '';
            }

            // Parse UTM parameters from URL if available
            const utmParams = url ? this._extractUtmParams(url) : {};

            // Get viewport dimensions safely
            const viewportWidth = viewport && viewport.width ? viewport.width : null;
            const viewportHeight = viewport && viewport.height ? viewport.height : null;

            // Create new session
            await query(
                dbConfig,
                `INSERT INTO sessions
                (session_id, user_id, started_at, device_type, browser, browser_version,
                os, viewport_width, viewport_height, referrer, landing_page,
                utm_source, utm_medium, utm_campaign, utm_term, utm_content)
                VALUES (?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    sessionId,
                    userId || null,
                    deviceType,
                    browserName,
                    browserVersion,
                    osName,
                    viewportWidth,
                    viewportHeight,
                    referrer || null,
                    url || null,
                    (utmParams && utmParams.utm_source) || null,
                    (utmParams && utmParams.utm_medium) || null,
                    (utmParams && utmParams.utm_campaign) || null,
                    (utmParams && utmParams.utm_term) || null,
                    (utmParams && utmParams.utm_content) || null
                ]
            );
        } else {
            // Update session's last activity
            await query(
                dbConfig,
                'UPDATE sessions SET is_active = TRUE WHERE session_id = ?',
                [sessionId]
            );
        }

        return sessionId;
    }

    /**
     * Store the main event record
     * @private
     */
    async _storeEvent(dbConfig, data) {
        const {
          userId,
          sessionId,
          name,
          event_type,
          eventType,
          timestamp,
          url: pageUrl,
          data: eventData,
          queryParams
        } = data;

        const payload = {
          event_type: eventType || event_type || name,
          user_id:    userId,
          page_url:   pageUrl,
          user_agent: data.userAgent || null,
          ip_address: data.ipAddress || null,
          event_data: eventData,
          created_at: timestamp
        };

        // now enqueue `payload` instead of writing directly to the DB
        await eventLogger.log(dbConfig, 'events', payload);
        return payload;
      }

    /**
     * Process event-specific data based on event type
     * @private
     */
    async _processEventSpecificData(dbConfig, data) {
        const { eventId, name: eventName, data: eventData } = data;

        switch (eventName) {
            case 'pageview':
                await this._processPageview(dbConfig, data);
                break;

            case 'click':
                await this._processClick(dbConfig, data);
                break;

            case 'form_submit':
                await this._processFormSubmission(dbConfig, data);
                break;

            case 'view_item':
                await this._processProductView(dbConfig, data);
                break;

            case 'add_to_cart':
            case 'remove_from_cart':
                await this._processCartAction(dbConfig, data);
                break;

            case 'purchase':
                await this._processPurchase(dbConfig, data);
                break;

            // Handle session events
            case 'session_renewed':
            case 'visibility_visible':
            case 'visibility_hidden':
            case 'page_exit':
                await this._updateSession(dbConfig, data);
                break;
        }

        return true;
    }

    /**
     * Process pageview events
     * @private
     */
    async _processPageview(_, data) {
        const { eventId, data: eventData = {}, url } = data;
        if (!url) return;
      
        const urlObj = new URL(url);
        const path = urlObj.pathname;
      
        const payload = {
          event_id: eventId           || null,
          url:      url               || null,
          path:     path              || null,
          title:    eventData.title   || null,
          referrer: eventData.referrer|| null,
        };
      
        await eventLogger.log(
          this.dbConfig,    // { dbType, dbConnection }
          'pageviews',      // table/entity name
          payload
        );
      }
      
      async _processClick(_, data) {
        const { eventId, data: eventData = {} } = data;
      
        const payload = {
          event_id:     eventId                      || null,
          element_type: eventData.element            || null,
          element_text: eventData.text               || null,
          element_id:   eventData.id                 || null,
          element_class:eventData.classes            || null,
          element_path: eventData.path
                           ? JSON.stringify(eventData.path)
                           : null,
          href:         eventData.href               || null,
        };
      
        await eventLogger.log(
          this.dbConfig,   // { dbType, dbConnection }
          'clicks',        // table/entity name
          payload
        );
      }
    /**
     * Process form submission events
     * @private
     */
    async _processFormSubmission(_, data) {
        const { eventId, data: eventData = {} } = data;
      
        const payload = {
          event_id:    eventId                   || null,
          form_name:   eventData.formName        || null,
          form_action: eventData.formAction      || null,
          form_fields: JSON.stringify(eventData.formFields || [])
        };
      
        await eventLogger.log(
          this.dbConfig,        // { dbType, dbConnection }
          'form_submissions',   // table/entity name
          payload
        );
      }
      

    /**
     * Process product view events
     * @private
     */
    async _processProductView(_, data) {
        const { eventId, data: eventData = {} } = data;
        if (!eventData.id) return;
      
        const payload = {
          event_id:        eventId || null,
          product_id:      eventData.id,
          product_name:    eventData.name || null,
          product_price:   eventData.price || null,
          product_category:eventData.category || null,
          product_brand:   eventData.brand || null,
          product_variant: eventData.variant || null,
        };
      
        await eventLogger.log(
          this.dbConfig,     // { dbType, dbConnection }
          'product_views',   // table/entity name
          payload
        );
      }
      

    /**
     * Process cart action events (add to cart, remove from cart)
     * @private
     */
    async _processCartAction(_, data) {
        const { eventId, name: eventName, data: eventData = {} } = data;
        if (!eventData.id) return;
      
        // Determine action type
        const actionType = eventName === 'remove_from_cart' ? 'remove' : 'add';
      
        // Calculate values
        const quantity   = eventData.quantity || 1;
        const price      = eventData.price    || 0;
        const totalValue = quantity * price;
      
        // Build payload matching cart_actions table
        const payload = {
          event_id:     eventId   || null,
          action_type:  actionType,
          product_id:   eventData.id,
          product_name: eventData.name    || null,
          product_price: price,
          quantity,
          total_value: totalValue,
        };
      
        // Enqueue for non-blocking insert
        await eventLogger.log(
          this.dbConfig,     // { dbType, dbConnection }
          'cart_actions',    // table/entity name
          payload
        );
      }
      
    /**
     * Process purchase events
     * @private
     */
    async _processPurchase(_, data) {
        const { eventId, data: eventData = {} } = data;
        if (!eventData.transaction_id) return;
      
        const payload = {
          event_id:        eventId || null,
          transaction_id:  eventData.transaction_id || null,
          revenue:         eventData.value        || 0,
          tax:             eventData.tax          || null,
          shipping:        eventData.shipping     || null,
          currency:        eventData.currency     || 'USD',
          coupon_code:     eventData.coupon       || null,
          items:           JSON.stringify(eventData.items || [])
        };
      
        await eventLogger.log(
          this.dbConfig,   // { dbType, dbConnection }
          'purchases',     // table/entity name
          payload
        );
      }
      
    /**
     * Update session based on session-related events
     * @private
     */
    async _updateSession(_, data) {
        const { sessionId, name: eventName } = data;
        if (!sessionId) return;
      
        let sql, params = [sessionId];
        if (eventName === 'page_exit') {
          sql = `
            UPDATE sessions
              SET ended_at          = NOW(),
                  is_active         = FALSE,
                  duration_seconds  = TIMESTAMPDIFF(SECOND, started_at, NOW())
            WHERE session_id = ?`;
        } else if (eventName === 'session_renewed') {
          sql    = `UPDATE sessions SET is_active = TRUE WHERE session_id = ?`;
        } else {
          return;
        }
      
        // enqueue the UPDATE for non-blocking execution
        await eventLogger.logUpdate(this.dbConfig, sql, params);
      }

    /**
     * Extract UTM parameters from URL
     * @private
     */
    _extractUtmParams(url) {
        if (!url) return {};
        
        try {
            const urlObj = new URL(url);
            const params = urlObj.searchParams;
            
            return {
                utm_source: params.get('utm_source'),
                utm_medium: params.get('utm_medium'),
                utm_campaign: params.get('utm_campaign'),
                utm_term: params.get('utm_term'),
                utm_content: params.get('utm_content')
            };
        } catch (e) {
            console.error('Error parsing URL for UTM params:', e);
            return {};
        }
    }

    /**
     * Set up Express routes for handling tracking requests
     */
    setupRoutes(app) {
        const eventLimiter = rateLimit({
            windowMs: 60 * 1000, // 1 minute
            max: 180, // 180 requests per minute
            message: "Too many tracking requests from this IP, please try again after a minute"
        });
        
        // Endpoint for single event tracking
        app.post('/api/track', eventLimiter, async (req, res) => {
            try {
                // Validate required fields
                if (!req.body.name && !req.body.event_type && !req.body.eventType) {
                    return res.status(400).json({ 
                        success: false, 
                        error: "Event type is required (name, event_type, or eventType must be provided)" 
                    });
                }
                
                const result = await this.trackEvent({ config: { db: this.dbConfig } }, req.body);
                res.status(200).json(result);
            } catch (error) {
                console.error("API Error:", error);
                // Send more specific error for client debugging
                const errorMessage = error.message.includes("Event type is required") 
                    ? error.message 
                    : "Internal server error";
                res.status(500).json({ success: false, error: errorMessage });
            }
        });

          // Endpoint for single event tracking
          app.post('/api/trackevent', eventLimiter, async (req, res) => {
            try {
                console.log(req.body);
                if (Array.isArray(req.body.events) || req.body.events.length > 0) {
                    
                    
                    // Validate that each event has an event type
                    for (let i = 0; i < req.body.events.length; i++) {
                        const event = req.body.events[i];
                        if (!event.name && !event.event_type && !event.eventType) {
                            return res.status(400).json({ 
                                success: false, 
                                error: `Event at index ${i} is missing an event type. Each event must have name, event_type, or eventType.` 
                            });
                        }
                    }
                    
                    const result = await this.trackBatchEvents({ config: { db: this.dbConfig } }, req.body);
                    res.status(200).json(result);
                }
                // Validate required fields
                if (!req.body.name && !req.body.event_type && !req.body.eventType) {
                    return res.status(400).json({ 
                        success: false, 
                        error: "Event type is required (name, event_type, or eventType must be provided)" 
                    });
                }
                
                const result = await this.trackEvent({ config: { db: this.dbConfig } }, req.body);
                res.status(200).json(result);
            } catch (error) {
                console.error("API Error:", error);
                // Send more specific error for client debugging
                const errorMessage = error.message.includes("Event type is required") 
                    ? error.message 
                    : "Internal server error";
                res.status(500).json({ success: false, error: errorMessage });
            }
        });
        
        // Endpoint for batch event tracking (more efficient)
        app.post('/api/track/batch', eventLimiter, async (req, res) => {
            try {
                // Validate events array
                if (!Array.isArray(req.body.events) || req.body.events.length === 0) {
                    return res.status(400).json({ 
                        success: false, 
                        error: "No events provided. Request must include an events array." 
                    });
                }
                
                // Validate that each event has an event type
                for (let i = 0; i < req.body.events.length; i++) {
                    const event = req.body.events[i];
                    if (!event.name && !event.event_type && !event.eventType) {
                        return res.status(400).json({ 
                            success: false, 
                            error: `Event at index ${i} is missing an event type. Each event must have name, event_type, or eventType.` 
                        });
                    }
                }
                
                const result = await this.trackBatchEvents({ config: { db: this.dbConfig } }, req.body);
                res.status(200).json(result);
            } catch (error) {
                console.error("API Batch Error:", error);
                // Send more specific error for client debugging
                const errorMessage = error.message.includes("Event type is required") 
                    ? error.message 
                    : "Internal server error";
                res.status(500).json({ success: false, error: errorMessage });
            }
        });
        
        // Endpoint for S2S event relay (from third-party services)
        app.post('/api/track/s2s', eventLimiter, async (req, res) => {
            try {
                // Validate event has a type before transforming
                if (!req.body.event && !req.body.eventName && !req.body.event_type && !req.body.eventType) {
                    return res.status(400).json({ 
                        success: false, 
                        error: "Event type is required in S2S payload" 
                    });
                }
                
                // Transform the S2S payload into our standard format
                const transformedPayload = this._transformS2SPayload(req.body);
                
                // Double check transformed event has a name
                if (!transformedPayload.name && !transformedPayload.event_type && !transformedPayload.eventType) {
                    return res.status(400).json({ 
                        success: false, 
                        error: "Event type is missing after payload transformation" 
                    });
                }
                
                const result = await this.trackEvent({ config: { db: this.dbConfig } }, transformedPayload);
                res.status(200).json(result);
            } catch (error) {
                console.error("S2S API Error:", error);
                // Send more specific error for client debugging
                const errorMessage = error.message.includes("Event type is required") 
                    ? error.message 
                    : "Internal server error";
                res.status(500).json({ success: false, error: errorMessage });
            }
        });
    }

    /**
     * Transform S2S payloads from third-party services into our format
     * @private
     */
    _transformS2SPayload(payload) {
        // This is a placeholder implementation
        // You would need to adapt this based on the actual format of your S2S payloads
        
        const { 
            source, 
            event, 
            eventName,
            event_type,
            eventType,
            data, 
            userId, 
            user_id,
            sessionId, 
            timestamp, 
            url, 
            queryParams 
        } = payload;
        
        // Use the first available event type field
        const eventTypeName = event || eventName || event_type || eventType;
        
        if (!eventTypeName) {
            throw new Error("Event type is required - cannot be null");
        }
        
        return {
            userId: userId || user_id,
            sessionId: sessionId || uuidv4(),
            name: eventTypeName,
            timestamp: timestamp || Date.now(),
            url,
            data,
            queryParams,
            source
        };
    }

    /**
     * Verify that all required database tables exist and create them if they don't
     */
    async verifyDatabaseTables() {
        try {
            console.log("Verifying database tables for tracking system...");

            // Use the query method from the db module which works with adaptus2-orm
            const { query } = require('./db');

            // Get list of existing tables using the db.query function
            const tablesResult = await query(this.dbConfig, `
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = DATABASE()
            `);

            // Handle the result based on the adaptus2-orm return structure
            const tables = tablesResult.data || [];

            // Handle null or undefined tables safely
            const existingTables = Array.isArray(tables)
                ? tables.map(t => (t.table_name || t.TABLE_NAME || '').toLowerCase())
                : [];

            console.log("Existing tables:", existingTables);

            // Define required tables - we only need the events table in this simplified version
            const requiredTables = ['events'];

            // Check which tables need to be created
            const missingTables = requiredTables.filter(
                table => !existingTables.includes(table)
            );

            if (missingTables.length === 0) {
                console.log("All tracking tables verified.");
                this.tablesVerified = true;
                return { success: true, message: "All tracking tables exist." };
            }

            console.log(`Creating ${missingTables.length} missing tables: ${missingTables.join(', ')}`);

            try {
                // Create the events table if missing
                if (missingTables.includes('events')) {
                    const createTableSQL = this._getCreateTableSQL('events', false);
                    if (createTableSQL) {
                        await query(this.dbConfig, createTableSQL);
                        console.log(`Created table: events`);

                        // Create indexes for the events table
                        await query(this.dbConfig, 'CREATE INDEX idx_events_user_id ON events(user_id)');
                        await query(this.dbConfig, 'CREATE INDEX idx_events_event_type ON events(event_type)');
                        await query(this.dbConfig, 'CREATE INDEX idx_events_created_at ON events(created_at)');
                    } else {
                        console.error(`No creation SQL found for events table`);
                        throw new Error(`Unable to create events table`);
                    }
                }
            } catch (error) {
                console.error("Error creating tables:", error);
                throw error;
            }

            this.tablesVerified = true;
            return {
                success: true,
                message: `Created ${missingTables.length} missing tables: ${missingTables.join(', ')}`
            };
        } catch (error) {
            console.error("Error verifying/creating database tables:", error);
            this.tablesVerified = false;
            throw new Error("Failed to verify database structure: " + error.message);
        }
    }

    /**
     * Get SQL to create a specific table
     * @private
     * @param {string} tableName - The name of the table to create
     * @param {boolean} withForeignKeys - Whether to include foreign key constraints (default: true)
     * @returns {string} The SQL statement to create the table
     */
    _getCreateTableSQL(tableName, withForeignKeys = true) {
        // Base table definitions without foreign keys
        const baseDefinitions = {
            users: `
                CREATE TABLE users (
                    user_id VARCHAR(36) PRIMARY KEY,
                    first_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    last_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    total_sessions INT NOT NULL DEFAULT 1,
                    user_agent TEXT,
                    first_referrer TEXT,
                    first_landing_page TEXT,
                    attributes JSON
                ) ENGINE=InnoDB
            `,
            
            sessions: `
                CREATE TABLE sessions (
                    session_id VARCHAR(36) PRIMARY KEY,
                    user_id VARCHAR(36) NOT NULL,
                    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    ended_at TIMESTAMP NULL,
                    duration_seconds INT,
                    is_active BOOLEAN DEFAULT TRUE,
                    device_type VARCHAR(50),
                    browser VARCHAR(50),
                    browser_version VARCHAR(50),
                    os VARCHAR(50),
                    screen_width INT,
                    screen_height INT,
                    viewport_width INT,
                    viewport_height INT,
                    referrer TEXT,
                    landing_page TEXT,
                    exit_page TEXT,
                    utm_source VARCHAR(100),
                    utm_medium VARCHAR(100),
                    utm_campaign VARCHAR(100),
                    utm_term VARCHAR(100),
                    utm_content VARCHAR(100)
                    ${withForeignKeys ? ',FOREIGN KEY (user_id) REFERENCES users(user_id)' : ''}
                ) ENGINE=InnoDB
            `,
            
            events: `
                CREATE TABLE events (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    event_type VARCHAR(255) NOT NULL,
                    user_id VARCHAR(255) NOT NULL,
                    page_url TEXT NOT NULL,
                    user_agent TEXT,
                    ip_address VARCHAR(255),
                    event_data JSON,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `,
            
            pageviews: `
                CREATE TABLE pageviews (
                    pageview_id BIGINT AUTO_INCREMENT PRIMARY KEY,
                    event_id BIGINT NOT NULL,
                    url TEXT NOT NULL,
                    path TEXT NOT NULL,
                    title TEXT,
                    referrer TEXT,
                    time_on_page INT,
                    is_bounce BOOLEAN,
                    is_exit BOOLEAN
                    ${withForeignKeys ? ',FOREIGN KEY (event_id) REFERENCES events(event_id)' : ''}
                ) ENGINE=InnoDB
            `,
            
            clicks: `
                CREATE TABLE clicks (
                    click_id BIGINT AUTO_INCREMENT PRIMARY KEY, 
                    event_id BIGINT NOT NULL,
                    element_type VARCHAR(50),
                    element_text TEXT,
                    element_id VARCHAR(100),
                    element_class TEXT,
                    element_path TEXT,
                    href TEXT
                    ${withForeignKeys ? ',FOREIGN KEY (event_id) REFERENCES events(event_id)' : ''}
                ) ENGINE=InnoDB
            `,
            
            form_submissions: `
                CREATE TABLE form_submissions (
                    form_id BIGINT AUTO_INCREMENT PRIMARY KEY,
                    event_id BIGINT NOT NULL,
                    form_name VARCHAR(100),
                    form_action TEXT,
                    form_fields JSON
                    ${withForeignKeys ? ',FOREIGN KEY (event_id) REFERENCES events(event_id)' : ''}
                ) ENGINE=InnoDB
            `,
            
            product_views: `
                CREATE TABLE product_views (
                    product_view_id BIGINT AUTO_INCREMENT PRIMARY KEY,
                    event_id BIGINT NOT NULL,
                    product_id VARCHAR(100) NOT NULL,
                    product_name TEXT,
                    product_price DECIMAL(10,2),
                    product_category TEXT,
                    product_brand TEXT,
                    product_variant TEXT
                    ${withForeignKeys ? ',FOREIGN KEY (event_id) REFERENCES events(event_id)' : ''}
                ) ENGINE=InnoDB
            `,
            
            cart_actions: `
                CREATE TABLE cart_actions (
                    cart_action_id BIGINT AUTO_INCREMENT PRIMARY KEY,
                    event_id BIGINT NOT NULL,
                    action_type VARCHAR(20) NOT NULL,
                    product_id VARCHAR(100) NOT NULL,
                    product_name TEXT,
                    product_price DECIMAL(10,2),
                    quantity INT,
                    total_value DECIMAL(10,2)
                    ${withForeignKeys ? ',FOREIGN KEY (event_id) REFERENCES events(event_id)' : ''}
                ) ENGINE=InnoDB
            `,
            
            purchases: `
                CREATE TABLE purchases (
                    purchase_id BIGINT AUTO_INCREMENT PRIMARY KEY,
                    event_id BIGINT NOT NULL,
                    transaction_id VARCHAR(100) NOT NULL,
                    revenue DECIMAL(10,2) NOT NULL,
                    tax DECIMAL(10,2),
                    shipping DECIMAL(10,2),
                    currency VARCHAR(3) DEFAULT 'USD',
                    coupon_code VARCHAR(50),
                    items JSON
                    ${withForeignKeys ? ',FOREIGN KEY (event_id) REFERENCES events(event_id)' : ''}
                ) ENGINE=InnoDB
            `
        };
        
        return baseDefinitions[tableName] || null;
    }
}

module.exports = EcommerceTracker;