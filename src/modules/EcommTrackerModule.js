/**
 * E-commerce Tracking Server Module
 * Handles tracking events from the client-side tracking library
 * and stores them in the MySQL database
 */

const rateLimit = require('express-rate-limit');
const { getDbConnection } = require('./db');
const { v4: uuidv4 } = require('uuid');
const UAParser = require('ua-parser-js');

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
        // Ensure tables exist before processing any events
        if (!this.tablesVerified) {
            await this.verifyDatabaseTables();
        }
        
        const connection = await getDbConnection(ctx.config.db);
        try {
            await connection.beginTransaction();
            
            const result = await this._processEvent(connection, params);
            
            await connection.commit();
            return { success: true, id: result.eventId };
        } catch (error) {
            await connection.rollback();
            console.error("Error in trackEvent:", error.message);
            throw new Error("Internal error during event tracking");
        } finally {
            // connection.release();
        }
    }

    /**
     * Process and store multiple events in a batch
     */
    async trackBatchEvents(ctx, params) {
        if (!Array.isArray(params.events) || params.events.length === 0) {
            return { success: false, error: "No events provided" };
        }

        // Ensure tables exist before processing any events
        if (!this.tablesVerified) {
            await this.verifyDatabaseTables();
        }

        const connection = await getDbConnection(ctx.config.db);
        try {
            await connection.beginTransaction();
            
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
                
                const result = await this._processEvent(connection, fullEventData);
                results.push(result);
            }
            
            await connection.commit();
            return { success: true, results };
        } catch (error) {
            await connection.rollback();
            console.error("Error in trackBatchEvents:", error.message, error.stack);
            throw new Error("Internal error during batch event tracking");
        } finally {
            //connection.release();
        }
    }

    /**
     * Core function to process a single event and store it in the database
     * @private
     */
    async _processEvent(connection, eventData) {
        try {
            // 1. Get user ID from data or generate one
            const userId = eventData.userId || eventData.user_id || uuidv4();
            
            // Check if event has a name/type - required field
            if (!eventData.name && !eventData.event_type && !eventData.eventType) {
                throw new Error("Event type is required (name, event_type, or eventType must be provided)");
            }
            
            // 2. Store the main event - we don't need session tracking in this version
            const eventId = await this._storeEvent(connection, { ...eventData, userId });
            
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
    async _ensureUser(connection, data) {
        const { userId, userAgent, referrer, url } = data;
        
        if (!userId) {
            throw new Error("User ID is required");
        }
        
        // Check if user exists
        const [users] = await connection.execute(
            'SELECT user_id FROM users WHERE user_id = ?',
            [userId]
        );
        
        if (users.length === 0) {
            // Create new user
            await connection.execute(
                'INSERT INTO users (user_id, first_seen, last_seen, user_agent, first_referrer, first_landing_page) VALUES (?, NOW(), NOW(), ?, ?, ?)',
                [userId, userAgent || null, referrer || null, url || null]
            );
        } else {
            // Update existing user's last_seen
            await connection.execute(
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
    async _ensureSession(connection, data) {
        const { sessionId, userId, userAgent, referrer, url, viewport } = data;
        
        if (!sessionId) {
            throw new Error("Session ID is required");
        }
        
        // Check if session exists
        const [sessions] = await connection.execute(
            'SELECT session_id FROM sessions WHERE session_id = ?',
            [sessionId]
        );
        
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
            await connection.execute(
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
            await connection.execute(
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
    async _storeEvent(connection, data) {
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
        
        // Convert timestamp to MySQL datetime - use created_at instead of event_time
        const eventTime = timestamp 
            ? new Date(timestamp).toISOString().slice(0, 19).replace('T', ' ')
            : new Date().toISOString().slice(0, 19).replace('T', ' ');
        
        // Get user agent from event data if available
        const userAgent = data.userAgent || null;
        const ipAddress = data.ipAddress || null;
        
        // Ensure all values are not undefined, replace undefined with null
        const safeUserId = userId || null;
        
        // Try to get event type from any of the possible field names
        const eventName = name || event_type || eventType;
        if (!eventName) {
            throw new Error("Event type is required - cannot be null");
        }
        
        const safePageUrl = pageUrl || null;
        
        // Store the event using the actual table schema
        const [result] = await connection.execute(
            `INSERT INTO events 
            (event_type, user_id, page_url, user_agent, ip_address, event_data, created_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                eventName,
                safeUserId,
                safePageUrl,
                userAgent,
                ipAddress,
                JSON.stringify(eventData || {}),
                eventTime
            ]
        );
        
        return result.insertId;
    }

    /**
     * Process event-specific data based on event type
     * @private
     */
    async _processEventSpecificData(connection, data) {
        const { eventId, name: eventName, data: eventData } = data;
        
        switch (eventName) {
            case 'pageview':
                await this._processPageview(connection, data);
                break;
                
            case 'click':
                await this._processClick(connection, data);
                break;
                
            case 'form_submit':
                await this._processFormSubmission(connection, data);
                break;
                
            case 'view_item':
                await this._processProductView(connection, data);
                break;
                
            case 'add_to_cart':
            case 'remove_from_cart':
                await this._processCartAction(connection, data);
                break;
                
            case 'purchase':
                await this._processPurchase(connection, data);
                break;
                
            // Handle session events
            case 'session_renewed':
            case 'visibility_visible':
            case 'visibility_hidden':
            case 'page_exit':
                await this._updateSession(connection, data);
                break;
        }
        
        return true;
    }

    /**
     * Process pageview events
     * @private
     */
    async _processPageview(connection, data) {
        const { eventId, data: eventData, url } = data;
        
        if (!url) {
            return;
        }
        
        const urlObj = new URL(url);
        const path = urlObj.pathname;
        
        await connection.execute(
            `INSERT INTO pageviews 
            (event_id, url, path, title, referrer) 
            VALUES (?, ?, ?, ?, ?)`,
            [
                eventId || null,
                url || null,
                path || null,
                (eventData && eventData.title) || null,
                (eventData && eventData.referrer) || null
            ]
        );
    }

    /**
     * Process click events
     * @private
     */
    async _processClick(connection, data) {
        const { eventId, data: eventData = {} } = data;
        
        await connection.execute(
            `INSERT INTO clicks 
            (event_id, element_type, element_text, element_id, element_class, element_path, href) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                eventId || null,
                eventData.element || null,
                eventData.text || null,
                eventData.id || null,
                eventData.classes || null,
                eventData.path ? JSON.stringify(eventData.path) : null,
                eventData.href || null
            ]
        );
    }

    /**
     * Process form submission events
     * @private
     */
    async _processFormSubmission(connection, data) {
        const { eventId, data: eventData = {} } = data;
        
        await connection.execute(
            `INSERT INTO form_submissions 
            (event_id, form_name, form_action, form_fields) 
            VALUES (?, ?, ?, ?)`,
            [
                eventId || null,
                eventData.formName || null,
                eventData.formAction || null,
                JSON.stringify(eventData.formFields || [])
            ]
        );
    }

    /**
     * Process product view events
     * @private
     */
    async _processProductView(connection, data) {
        const { eventId, data: eventData = {} } = data;
        
        if (!eventData.id) {
            return;
        }
        
        await connection.execute(
            `INSERT INTO product_views 
            (event_id, product_id, product_name, product_price, product_category, product_brand, product_variant) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                eventId || null,
                eventData.id || null,
                eventData.name || null,
                eventData.price || null,
                eventData.category || null,
                eventData.brand || null,
                eventData.variant || null
            ]
        );
    }

    /**
     * Process cart action events (add to cart, remove from cart)
     * @private
     */
    async _processCartAction(connection, data) {
        const { eventId, name: eventName, data: eventData = {} } = data;
        
        if (!eventData.id) {
            return;
        }
        
        // Determine action type from event name
        let actionType = 'add';
        if (eventName === 'remove_from_cart') {
            actionType = 'remove';
        }
        
        // Calculate total value
        const quantity = eventData.quantity || 1;
        const price = eventData.price || 0;
        const totalValue = quantity * price;
        
        await connection.execute(
            `INSERT INTO cart_actions 
            (event_id, action_type, product_id, product_name, product_price, quantity, total_value) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                eventId || null,
                actionType || null,
                eventData.id || null,
                eventData.name || null,
                price,
                quantity,
                totalValue
            ]
        );
    }

    /**
     * Process purchase events
     * @private
     */
    async _processPurchase(connection, data) {
        const { eventId, data: eventData = {} } = data;
        
        if (!eventData.transaction_id) {
            return;
        }
        
        await connection.execute(
            `INSERT INTO purchases 
            (event_id, transaction_id, revenue, tax, shipping, currency, coupon_code, items) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                eventId || null,
                eventData.transaction_id || null,
                eventData.value || 0,
                eventData.tax || null,
                eventData.shipping || null,
                eventData.currency || 'USD',
                eventData.coupon || null,
                JSON.stringify(eventData.items || [])
            ]
        );
    }

    /**
     * Update session based on session-related events
     * @private
     */
    async _updateSession(connection, data) {
        const { sessionId, name: eventName } = data;
        
        if (!sessionId) {
            return; // Skip if sessionId is missing
        }
        
        if (eventName === 'page_exit') {
            // Update session end time when user exits
            await connection.execute(
                `UPDATE sessions 
                SET ended_at = NOW(), 
                    is_active = FALSE, 
                    duration_seconds = TIMESTAMPDIFF(SECOND, started_at, NOW()) 
                WHERE session_id = ?`,
                [sessionId]
            );
        } else if (eventName === 'session_renewed') {
            // Reset session timeout
            await connection.execute(
                'UPDATE sessions SET is_active = TRUE WHERE session_id = ?',
                [sessionId]
            );
        }
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
        let connection;
        try {
            connection = await getDbConnection(this.dbConfig);
            console.log("Verifying database tables for tracking system...");
            
            // Get list of existing tables
            const [tables] = await connection.query(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = DATABASE()
            `);
            
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
                        await connection.query(createTableSQL);
                        console.log(`Created table: events`);
                        
                        // Create indexes for the events table
                        await connection.query('CREATE INDEX idx_events_user_id ON events(user_id)');
                        await connection.query('CREATE INDEX idx_events_event_type ON events(event_type)');
                        await connection.query('CREATE INDEX idx_events_created_at ON events(created_at)');
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
        } finally {
            if (connection) {
                try {
                    // For mysql2/promise, use end() instead of release() for direct connections
                    // Check if connection has release function first
                    if (typeof connection.release === 'function') {
                       // await connection.release();
                    } else if (typeof connection.end === 'function') {
                        await connection.end();
                    } else if (typeof connection.close === 'function') {
                        await connection.close();
                    } else {
                        console.warn("Could not find a method to close the connection");
                    }
                } catch (releaseErr) {
                    console.error("Error closing database connection:", releaseErr);
                }
            }
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