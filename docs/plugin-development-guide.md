# Plugin Development Guide for Adaptus2 Platform

## Part 2: Creating Plugins for Complex Business Logic

## Overview

Plugins extend Adaptus2 functionality without modifying the core framework. They're ideal for:
- Complex business logic beyond CRUD
- Third-party API integrations
- Custom authentication schemes
- Specialized data processing
- WebSocket functionality
- Background jobs and scheduled tasks

## Plugin Structure

### Basic Plugin Template

```javascript
module.exports = {
  // Required metadata
  name: 'myPlugin',
  version: '1.0.0',
  description: 'Plugin description',
  
  // Optional metadata
  author: 'Your Name',
  dependencies: ['otherPlugin'], // Other plugins this depends on
  
  // Lifecycle methods
  async initialize(dependencies) {
    // Plugin initialization
  },
  
  registerRoutes(dependencies) {
    // Register Express routes
    return routes; // Return array for cleanup
  },
  
  async cleanup() {
    // Cleanup resources
  }
};
```

### Complete Plugin Example

```javascript
// plugins/orderProcessingPlugin.js
const stripe = require('stripe');

module.exports = {
  name: 'orderProcessing',
  version: '1.0.0',
  description: 'Handles order processing with payment integration',
  
  // Store plugin state
  stripeClient: null,
  orderQueue: [],
  
  async initialize({ context, db, logger, customRequire, config }) {
    this.context = context;
    this.db = db;
    this.logger = logger;
    
    // Initialize Stripe
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (stripeKey) {
      this.stripeClient = stripe(stripeKey);
      this.logger.info('Stripe client initialized');
    }
    
    // Set up background processing
    this.startOrderProcessor();
  },
  
  registerRoutes({ app, auth, validator }) {
    const routes = [];
    
    // Process order endpoint
    routes.push(
      app.post('/api/orders/process', 
        auth.requireUser,
        validator.body({
          items: 'array',
          'items.*.product_id': 'number',
          'items.*.quantity': 'number',
          payment_method: 'string'
        }),
        this.processOrder.bind(this)
      )
    );
    
    // Get order status
    routes.push(
      app.get('/api/orders/:orderId/status',
        auth.requireUser,
        this.getOrderStatus.bind(this)
      )
    );
    
    // Webhook for payment updates
    routes.push(
      app.post('/webhooks/stripe',
        this.handleStripeWebhook.bind(this)
      )
    );
    
    return routes;
  },
  
  // Route handlers
  async processOrder(req, res) {
    try {
      const { items, payment_method } = req.body;
      const userId = req.user.id;
      
      // Calculate total
      const total = await this.calculateOrderTotal(items);
      
      // Create order in database
      const order = await this.db.query(
        'INSERT INTO orders (user_id, total, status) VALUES (?, ?, ?)',
        [userId, total, 'pending']
      );
      
      // Process payment
      const payment = await this.stripeClient.paymentIntents.create({
        amount: Math.round(total * 100), // Convert to cents
        currency: 'usd',
        payment_method,
        confirm: true,
        metadata: { orderId: order.insertId }
      });
      
      // Update order status
      await this.db.query(
        'UPDATE orders SET status = ?, payment_id = ? WHERE id = ?',
        ['processing', payment.id, order.insertId]
      );
      
      // Add to processing queue
      this.orderQueue.push({ orderId: order.insertId, items });
      
      res.json({
        success: true,
        orderId: order.insertId,
        status: 'processing',
        estimatedDelivery: this.calculateDeliveryDate()
      });
      
    } catch (error) {
      this.logger.error('Order processing failed:', error);
      res.status(500).json({ error: 'Order processing failed' });
    }
  },
  
  async getOrderStatus(req, res) {
    const { orderId } = req.params;
    const userId = req.user.id;
    
    const [order] = await this.db.query(
      'SELECT * FROM orders WHERE id = ? AND user_id = ?',
      [orderId, userId]
    );
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    res.json({
      orderId: order.id,
      status: order.status,
      total: order.total,
      createdAt: order.created_at,
      updatedAt: order.updated_at
    });
  },
  
  async handleStripeWebhook(req, res) {
    const sig = req.headers['stripe-signature'];
    
    try {
      const event = this.stripeClient.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
      
      if (event.type === 'payment_intent.succeeded') {
        const paymentIntent = event.data.object;
        const orderId = paymentIntent.metadata.orderId;
        
        await this.db.query(
          'UPDATE orders SET status = ? WHERE id = ?',
          ['paid', orderId]
        );
        
        this.logger.info(`Order ${orderId} payment confirmed`);
      }
      
      res.json({ received: true });
    } catch (err) {
      this.logger.error('Webhook error:', err);
      res.status(400).json({ error: 'Webhook error' });
    }
  },
  
  // Helper methods
  async calculateOrderTotal(items) {
    let total = 0;
    
    for (const item of items) {
      const [product] = await this.db.query(
        'SELECT price FROM products WHERE id = ?',
        [item.product_id]
      );
      
      if (product) {
        total += product.price * item.quantity;
      }
    }
    
    return total;
  },
  
  calculateDeliveryDate() {
    const date = new Date();
    date.setDate(date.getDate() + 5); // 5 days delivery
    return date.toISOString();
  },
  
  // Background processor
  startOrderProcessor() {
    setInterval(async () => {
      while (this.orderQueue.length > 0) {
        const order = this.orderQueue.shift();
        await this.fulfillOrder(order);
      }
    }, 5000); // Process every 5 seconds
  },
  
  async fulfillOrder({ orderId, items }) {
    try {
      // Update inventory
      for (const item of items) {
        await this.db.query(
          'UPDATE products SET stock = stock - ? WHERE id = ?',
          [item.quantity, item.product_id]
        );
      }
      
      // Update order status
      await this.db.query(
        'UPDATE orders SET status = ? WHERE id = ?',
        ['fulfilled', orderId]
      );
      
      // Send notification (if notification module exists)
      if (this.context.modules.notification) {
        await this.context.modules.notification.send({
          type: 'email',
          to: 'customer@example.com',
          subject: 'Order Fulfilled',
          body: `Your order #${orderId} has been fulfilled!`
        });
      }
      
      this.logger.info(`Order ${orderId} fulfilled`);
    } catch (error) {
      this.logger.error(`Failed to fulfill order ${orderId}:`, error);
    }
  },
  
  async cleanup() {
    // Clean up resources
    this.orderQueue = [];
    this.stripeClient = null;
    this.logger.info('Order processing plugin cleaned up');
  }
};
```

## Plugin Dependencies

### Available Dependencies

```javascript
async initialize(dependencies) {
  const {
    context,        // Global context object
    db,             // Database connection
    logger,         // Logger instance
    customRequire,  // Require function for modules
    config,         // Plugin configuration
    redis,          // Redis client (if available)
    io              // Socket.io instance (if available)
  } = dependencies;
}
```

### Accessing Other Modules

```javascript
// Access other plugins
const otherPlugin = this.context.plugins.get('otherPluginName');

// Access core modules
const { mail, notification, workflow } = this.context.modules;

// Access shared utilities
const { uuid, crypto } = this.context.utils;
```

## Common Plugin Patterns

### 1. API Integration Plugin

```javascript
// plugins/weatherApiPlugin.js
const axios = require('axios');

module.exports = {
  name: 'weatherApi',
  version: '1.0.0',
  
  apiClient: null,
  cache: new Map(),
  
  async initialize({ logger, config }) {
    this.logger = logger;
    this.apiKey = process.env.WEATHER_API_KEY;
    this.apiClient = axios.create({
      baseURL: 'https://api.openweathermap.org/data/2.5',
      timeout: 5000
    });
  },
  
  registerRoutes({ app, auth }) {
    return [
      app.get('/api/weather/:city', this.getWeather.bind(this))
    ];
  },
  
  async getWeather(req, res) {
    const { city } = req.params;
    
    // Check cache
    if (this.cache.has(city)) {
      const cached = this.cache.get(city);
      if (Date.now() - cached.timestamp < 600000) { // 10 minutes
        return res.json(cached.data);
      }
    }
    
    try {
      const response = await this.apiClient.get('/weather', {
        params: {
          q: city,
          appid: this.apiKey,
          units: 'metric'
        }
      });
      
      const weatherData = {
        city: response.data.name,
        temperature: response.data.main.temp,
        description: response.data.weather[0].description,
        humidity: response.data.main.humidity
      };
      
      // Cache result
      this.cache.set(city, {
        data: weatherData,
        timestamp: Date.now()
      });
      
      res.json(weatherData);
    } catch (error) {
      this.logger.error('Weather API error:', error);
      res.status(500).json({ error: 'Failed to fetch weather data' });
    }
  }
};
```

### 2. WebSocket Plugin

```javascript
// plugins/realtimeNotificationsPlugin.js
module.exports = {
  name: 'realtimeNotifications',
  version: '1.0.0',
  
  io: null,
  connectedUsers: new Map(),
  
  async initialize({ io, db, logger }) {
    this.io = io;
    this.db = db;
    this.logger = logger;
    
    // Set up WebSocket namespace
    const notificationNamespace = io.of('/notifications');
    
    notificationNamespace.on('connection', (socket) => {
      this.handleConnection(socket);
    });
  },
  
  handleConnection(socket) {
    this.logger.info(`User connected: ${socket.id}`);
    
    socket.on('authenticate', async (token) => {
      try {
        const user = await this.verifyToken(token);
        this.connectedUsers.set(socket.id, user.id);
        socket.join(`user-${user.id}`);
        
        // Send pending notifications
        const pending = await this.getPendingNotifications(user.id);
        socket.emit('pending-notifications', pending);
      } catch (error) {
        socket.emit('auth-error', 'Invalid token');
        socket.disconnect();
      }
    });
    
    socket.on('mark-read', async (notificationId) => {
      const userId = this.connectedUsers.get(socket.id);
      if (userId) {
        await this.markAsRead(notificationId, userId);
      }
    });
    
    socket.on('disconnect', () => {
      this.connectedUsers.delete(socket.id);
      this.logger.info(`User disconnected: ${socket.id}`);
    });
  },
  
  // Public method for other plugins to send notifications
  async sendNotification(userId, notification) {
    // Save to database
    await this.db.query(
      'INSERT INTO notifications (user_id, type, title, message) VALUES (?, ?, ?, ?)',
      [userId, notification.type, notification.title, notification.message]
    );
    
    // Send real-time if user is connected
    this.io.of('/notifications').to(`user-${userId}`).emit('new-notification', notification);
  },
  
  async getPendingNotifications(userId) {
    return await this.db.query(
      'SELECT * FROM notifications WHERE user_id = ? AND read_at IS NULL ORDER BY created_at DESC',
      [userId]
    );
  },
  
  async markAsRead(notificationId, userId) {
    await this.db.query(
      'UPDATE notifications SET read_at = NOW() WHERE id = ? AND user_id = ?',
      [notificationId, userId]
    );
  }
};
```

### 3. Scheduled Task Plugin

```javascript
// plugins/dataCleanupPlugin.js
module.exports = {
  name: 'dataCleanup',
  version: '1.0.0',
  
  cleanupInterval: null,
  
  async initialize({ db, logger, config }) {
    this.db = db;
    this.logger = logger;
    
    // Schedule cleanup every hour
    this.cleanupInterval = setInterval(() => {
      this.performCleanup();
    }, 3600000); // 1 hour
    
    // Also run on startup
    this.performCleanup();
  },
  
  async performCleanup() {
    try {
      // Delete old sessions
      const sessionsDeleted = await this.db.query(
        'DELETE FROM sessions WHERE expires_at < NOW()'
      );
      
      // Delete old logs
      const logsDeleted = await this.db.query(
        'DELETE FROM request_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)'
      );
      
      // Clean up orphaned data
      const orphansDeleted = await this.db.query(
        'DELETE FROM order_items WHERE order_id NOT IN (SELECT id FROM orders)'
      );
      
      this.logger.info('Cleanup completed', {
        sessionsDeleted: sessionsDeleted.affectedRows,
        logsDeleted: logsDeleted.affectedRows,
        orphansDeleted: orphansDeleted.affectedRows
      });
      
    } catch (error) {
      this.logger.error('Cleanup failed:', error);
    }
  },
  
  async cleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
};
```

### 4. Middleware Plugin

```javascript
// plugins/requestThrottlingPlugin.js
module.exports = {
  name: 'requestThrottling',
  version: '1.0.0',
  
  requestCounts: new Map(),
  
  async initialize({ redis, logger }) {
    this.redis = redis;
    this.logger = logger;
  },
  
  registerRoutes({ app }) {
    // Apply middleware globally
    app.use(this.throttleMiddleware.bind(this));
    return [];
  },
  
  async throttleMiddleware(req, res, next) {
    const ip = req.ip;
    const key = `throttle:${ip}`;
    
    try {
      if (this.redis) {
        // Use Redis for distributed throttling
        const count = await this.redis.incr(key);
        if (count === 1) {
          await this.redis.expire(key, 60); // 1 minute window
        }
        
        if (count > 100) { // 100 requests per minute
          return res.status(429).json({ error: 'Too many requests' });
        }
      } else {
        // Fallback to in-memory
        const now = Date.now();
        const minute = Math.floor(now / 60000);
        const userKey = `${ip}:${minute}`;
        
        const count = (this.requestCounts.get(userKey) || 0) + 1;
        this.requestCounts.set(userKey, count);
        
        if (count > 100) {
          return res.status(429).json({ error: 'Too many requests' });
        }
        
        // Clean old entries
        if (Math.random() < 0.01) { // 1% chance
          this.cleanOldEntries();
        }
      }
      
      next();
    } catch (error) {
      this.logger.error('Throttling error:', error);
      next(); // Don't block on errors
    }
  },
  
  cleanOldEntries() {
    const now = Date.now();
    const currentMinute = Math.floor(now / 60000);
    
    for (const [key, _] of this.requestCounts) {
      const [ip, minute] = key.split(':');
      if (parseInt(minute) < currentMinute - 1) {
        this.requestCounts.delete(key);
      }
    }
  }
};
```

## Plugin Configuration

### Using Environment Variables

```javascript
module.exports = {
  name: 'configuredPlugin',
  
  async initialize({ config }) {
    // Direct environment access
    this.apiKey = process.env.PLUGIN_API_KEY;
    
    // With defaults
    this.timeout = parseInt(process.env.PLUGIN_TIMEOUT || '5000');
    
    // Configuration validation
    if (!this.apiKey) {
      throw new Error('PLUGIN_API_KEY environment variable is required');
    }
  }
};
```

### Plugin-Specific Configuration

```javascript
// In apiConfig.json
{
  "plugins": {
    "myPlugin": {
      "enabled": true,
      "config": {
        "maxRetries": 3,
        "timeout": 5000
      }
    }
  }
}

// In plugin
async initialize({ config }) {
  this.maxRetries = config.maxRetries || 3;
  this.timeout = config.timeout || 5000;
}
```

## Testing Plugins

### Unit Testing

```javascript
// tests/orderProcessingPlugin.test.js
const plugin = require('../plugins/orderProcessingPlugin');

describe('Order Processing Plugin', () => {
  let mockDependencies;
  
  beforeEach(() => {
    mockDependencies = {
      db: {
        query: jest.fn()
      },
      logger: {
        info: jest.fn(),
        error: jest.fn()
      },
      context: {}
    };
  });
  
  test('should initialize correctly', async () => {
    await plugin.initialize(mockDependencies);
    expect(plugin.db).toBe(mockDependencies.db);
    expect(plugin.logger).toBe(mockDependencies.logger);
  });
  
  test('should calculate order total correctly', async () => {
    mockDependencies.db.query.mockResolvedValueOnce([{ price: 10.99 }]);
    mockDependencies.db.query.mockResolvedValueOnce([{ price: 5.99 }]);
    
    await plugin.initialize(mockDependencies);
    
    const total = await plugin.calculateOrderTotal([
      { product_id: 1, quantity: 2 },
      { product_id: 2, quantity: 1 }
    ]);
    
    expect(total).toBe(27.97); // (10.99 * 2) + (5.99 * 1)
  });
});
```

### Integration Testing

```javascript
// tests/integration/plugin.test.js
const request = require('supertest');
const app = require('../../src/server');

describe('Plugin Integration', () => {
  test('should process order successfully', async () => {
    const response = await request(app)
      .post('/api/orders/process')
      .set('Authorization', 'Bearer valid-token')
      .send({
        items: [
          { product_id: 1, quantity: 2 }
        ],
        payment_method: 'pm_test_123'
      });
    
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('orderId');
    expect(response.body.status).toBe('processing');
  });
});
```

## Best Practices

### 1. Error Handling

```javascript
// Always wrap async operations
async processRequest(req, res) {
  try {
    const result = await this.riskyOperation();
    res.json({ success: true, result });
  } catch (error) {
    this.logger.error('Operation failed:', error);
    
    // Send appropriate error response
    if (error.code === 'VALIDATION_ERROR') {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}
```

### 2. Resource Management

```javascript
module.exports = {
  connections: [],
  intervals: [],
  
  async initialize(deps) {
    // Track resources for cleanup
    const connection = await createConnection();
    this.connections.push(connection);
    
    const interval = setInterval(() => {}, 1000);
    this.intervals.push(interval);
  },
  
  async cleanup() {
    // Clean up all resources
    for (const conn of this.connections) {
      await conn.close();
    }
    
    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    
    this.connections = [];
    this.intervals = [];
  }
};
```

### 3. Plugin Communication

```javascript
// Emit events for other plugins
this.context.eventEmitter.emit('order:created', { orderId, userId });

// Listen to events from other plugins
this.context.eventEmitter.on('user:deleted', async (userId) => {
  await this.cleanupUserData(userId);
});
```

### 4. Performance Optimization

```javascript
module.exports = {
  cache: new Map(),
  
  async getData(key) {
    // Check cache first
    if (this.cache.has(key)) {
      const cached = this.cache.get(key);
      if (Date.now() - cached.time < 300000) { // 5 minutes
        return cached.data;
      }
    }
    
    // Fetch fresh data
    const data = await this.fetchData(key);
    
    // Cache for next time
    this.cache.set(key, {
      data,
      time: Date.now()
    });
    
    return data;
  }
};
```

## Plugin Generator

Use the built-in generator for quick starts:

```bash
# Interactive plugin generator
node plugins/pluginGenerator.js

# This will prompt for:
# - Plugin name
# - Plugin type (api, webhook, scheduler, middleware)
# - Description
# - Required dependencies
```

## Deployment Considerations

### 1. Environment-Specific Logic

```javascript
async initialize({ config }) {
  this.isDevelopment = process.env.NODE_ENV === 'development';
  this.isProduction = process.env.NODE_ENV === 'production';
  
  if (this.isProduction) {
    // Production-specific setup
    this.enableCaching = true;
    this.logLevel = 'error';
  } else {
    // Development setup
    this.enableCaching = false;
    this.logLevel = 'debug';
  }
}
```

### 2. Cluster Support

```javascript
async initialize({ redis }) {
  if (redis) {
    // Use Redis for cluster coordination
    this.storage = {
      get: (key) => redis.get(key),
      set: (key, value) => redis.set(key, JSON.stringify(value)),
      del: (key) => redis.del(key)
    };
  } else {
    // Fallback to in-memory
    const map = new Map();
    this.storage = {
      get: (key) => Promise.resolve(map.get(key)),
      set: (key, value) => Promise.resolve(map.set(key, value)),
      del: (key) => Promise.resolve(map.delete(key))
    };
  }
}
```

## Debugging Plugins

### Enable Debug Logging

```bash
DEBUG=adaptus2:plugins:* npm run dev
```

### Plugin-Specific Debugging

```javascript
module.exports = {
  name: 'debuggablePlugin',
  debug: require('debug')('adaptus2:plugins:debuggablePlugin'),
  
  async someMethod() {
    this.debug('Entering someMethod with args:', arguments);
    
    const result = await this.operation();
    this.debug('Operation result:', result);
    
    return result;
  }
};
```

## Summary

Plugins provide a powerful way to extend Adaptus2 functionality:
- Keep plugins focused on a single responsibility
- Use proper error handling and logging
- Clean up resources in the cleanup method
- Test both unit and integration scenarios
- Document configuration requirements
- Consider performance and scaling implications

For simpler use cases, consider using business rules DSL or configuration-based routes before creating a custom plugin.