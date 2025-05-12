/**
 * E-commerce Event Tracking Library
 * A lightweight, customizable tracking solution for e-commerce websites
 * Features:
 * - Automatic event tracking (pageviews, clicks, form submissions)
 * - Custom event tracking API
 * - Query parameter forwarding
 * - Server-to-server (S2S) event relaying
 * - Cookie management for user identification
 * - Throttling and batching of events for performance
 */

(function(window, document) {
    'use strict';
    
    // Main tracker object
    window.EcomTracker = window.EcomTracker || {};
    
    // Configuration (customize these values)
    const config = {
      endpoint: 'http://localhost:3000/api/track',
      siteId: '100',
      cookieName: '_ecom_visitor',
      cookieExpiry: 365, // days
      sessionTimeout: 30, // minutes
      batchSize: 10,
      batchInterval: 2000, // ms
      debug: false,
      automaticEvents: true,
      s2sEndpoint: 'https://localhost:3000/relay'
    };
    
    // State management
    let state = {
      userId: null,
      sessionId: null,
      eventQueue: [],
      lastActivity: Date.now(),
      initialized: false
    };
    
    // Utility functions
    const utils = {
      generateId: function() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
          const r = Math.random() * 16 | 0;
          const v = c === 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
      },
      
      setCookie: function(name, value, days) {
        const date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        const expires = "expires=" + date.toUTCString();
        document.cookie = name + "=" + value + ";" + expires + ";path=/;SameSite=Lax";
      },
      
      getCookie: function(name) {
        const nameEQ = name + "=";
        const ca = document.cookie.split(';');
        for (let i = 0; i < ca.length; i++) {
          let c = ca[i];
          while (c.charAt(0) === ' ') c = c.substring(1);
          if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
        }
        return null;
      },
      
      getQueryParams: function() {
        const queryParams = {};
        const search = window.location.search.substring(1);
        if (search) {
          const pairs = search.split('&');
          for (let i = 0; i < pairs.length; i++) {
            const pair = pairs[i].split('=');
            queryParams[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || '');
          }
        }
        return queryParams;
      },
      
      log: function(message, obj) {
        if (config.debug) {
          console.log('[EcomTracker]', message, obj || '');
        }
      },
      
      throttle: function(func, delay) {
        let lastCall = 0;
        return function(...args) {
          const now = Date.now();
          if (now - lastCall >= delay) {
            lastCall = now;
            func.apply(this, args);
          }
        };
      }
    };
    
    // Core functionality
    const core = {
      init: function(customConfig) {
        // Merge custom configuration
        if (customConfig) {
          Object.assign(config, customConfig);
        }
        
        // Initialize user identification
        this.identifyUser();
        
        // Set up automatic event tracking
        if (config.automaticEvents) {
          this.setupEventListeners();
        }
        
        // Start the event processing loop
        this.startEventProcessing();
        
        state.initialized = true;
        utils.log('Initialized with config', config);
        
        // Track initial pageview
        EcomTracker.track('pageview');
        
        return this;
      },
      
      identifyUser: function() {
        // Check for existing user ID
        let userId = utils.getCookie(config.cookieName);
        
        // If no user ID exists, create one
        if (!userId) {
          userId = utils.generateId();
          utils.setCookie(config.cookieName, userId, config.cookieExpiry);
        }
        
        // Generate a session ID if needed
        const sessionId = utils.getCookie(config.cookieName + '_session') || utils.generateId();
        utils.setCookie(config.cookieName + '_session', sessionId, config.sessionTimeout / (24 * 60));
        
        state.userId = userId;
        state.sessionId = sessionId;
        utils.log('User identified', { userId, sessionId });
      },
      
      setupEventListeners: function() {
        // Track clicks
        document.addEventListener('click', utils.throttle(function(e) {
          // Get relevant target info
          const target = e.target.closest('a, button') || e.target;
          const tagName = target.tagName.toLowerCase();
          
          if (tagName === 'a' || tagName === 'button' || target.role === 'button') {
            const eventData = {
              element: tagName,
              text: target.innerText || target.textContent,
              classes: target.className,
              id: target.id,
              href: target.href || null,
              path: core.getElementPath(target)
            };
            
            EcomTracker.track('click', eventData);
          }
        }, 300));
        
        // Track form submissions
        document.addEventListener('submit', function(e) {
          const form = e.target;
          const eventData = {
            formId: form.id || null,
            formAction: form.action || null,
            formName: form.name || null,
            formFields: core.getFormFieldNames(form)
          };
          
          EcomTracker.track('form_submit', eventData);
        });
        
        // Track page visibility changes
        document.addEventListener('visibilitychange', function() {
          if (document.visibilityState === 'visible') {
            EcomTracker.track('visibility_visible');
          } else if (document.visibilityState === 'hidden') {
            EcomTracker.track('visibility_hidden');
          }
        });
        
        // Update session on activity
        ['mousedown', 'keydown', 'touchstart', 'scroll'].forEach(function(event) {
          document.addEventListener(event, utils.throttle(function() {
            const now = Date.now();
            if (now - state.lastActivity > config.sessionTimeout * 60 * 1000) {
              // Session expired, create a new session
              state.sessionId = utils.generateId();
              utils.setCookie(config.cookieName + '_session', state.sessionId, config.sessionTimeout / (24 * 60));
              EcomTracker.track('session_renewed');
            }
            state.lastActivity = now;
          }, 1000));
        });
        
        // Handle page unload
        window.addEventListener('beforeunload', function() {
          EcomTracker.track('page_exit');
          core.processEvents(true); // Force send events
        });
        
        utils.log('Event listeners set up');
      },
      
      getElementPath: function(element, path = []) {
        if (!element || element === document.body) return path;
        
        let identifier = element.tagName.toLowerCase();
        if (element.id) {
          identifier += '#' + element.id;
        } else if (element.className && typeof element.className === 'string') {
          identifier += '.' + element.className.replace(/\s+/g, '.');
        }
        
        path.unshift(identifier);
        
        if (path.length >= 3 || element.parentElement === document.body) {
          return path;
        }
        
        return this.getElementPath(element.parentElement, path);
      },
      
      getFormFieldNames: function(form) {
        const fields = [];
        const elements = form.elements;
        
        for (let i = 0; i < elements.length; i++) {
          const element = elements[i];
          const type = element.type;
          const name = element.name || element.id;
          
          if (name && ['password', 'credit-card'].indexOf(name.toLowerCase()) === -1) {
            // Skip sensitive fields
            fields.push(name);
          }
        }
        
        return fields;
      },
      
      startEventProcessing: function() {
        setInterval(function() {
          core.processEvents();
        }, config.batchInterval);
      },
      
      processEvents: function(forceAll = false) {
        if (state.eventQueue.length === 0) return;
        
        const eventsToProcess = forceAll ? state.eventQueue : state.eventQueue.slice(0, config.batchSize);
        
        if (eventsToProcess.length === 0) return;
        
        const payload = {
          siteId: config.siteId,
          userId: state.userId,
          sessionId: state.sessionId,
          timestamp: Date.now(),
          url: window.location.href,
          referrer: document.referrer,
          userAgent: navigator.userAgent,
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight
          },
          events: eventsToProcess
        };
        
        // Send the payload to the server
        this.sendPayload(payload).then(function() {
          // Remove processed events from the queue
          state.eventQueue = state.eventQueue.slice(eventsToProcess.length);
          utils.log('Processed events', eventsToProcess.length);
        }).catch(function(error) {
          utils.log('Error processing events', error);
        });
      },
      
      sendPayload: function(payload) {
        return new Promise(function(resolve, reject) {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', config.endpoint, true);
          xhr.setRequestHeader('Content-Type', 'application/json');
          
          xhr.onload = function() {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(xhr.response);
            } else {
              reject({
                status: xhr.status,
                statusText: xhr.statusText,
                response: xhr.response
              });
            }
          };
          
          xhr.onerror = function() {
            reject({
              status: xhr.status,
              statusText: xhr.statusText,
              response: xhr.response
            });
          };
          
          xhr.send(JSON.stringify(payload));
        });
      },
      
      relayToS2S: function(eventName, data) {
        const s2sPayload = {
          source: 'web_tracker',
          siteId: config.siteId,
          userId: state.userId,
          sessionId: state.sessionId,
          event: eventName,
          data: data,
          queryParams: utils.getQueryParams(),
          timestamp: Date.now(),
          url: window.location.href
        };
        
        fetch(config.s2sEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(s2sPayload),
          keepalive: true
        }).then(function(response) {
          utils.log('S2S relay response', response.status);
        }).catch(function(error) {
          utils.log('S2S relay error', error);
        });
      }
    };
    
    // Public API
    EcomTracker.init = function(customConfig) {
      return core.init(customConfig);
    };
    
    EcomTracker.track = function(eventName, eventData = {}) {
      if (!state.initialized) {
        utils.log('Tracker not initialized. Call EcomTracker.init() first.');
        return;
      }
      
      const event = {
        name: eventName,
        timestamp: Date.now(),
        data: eventData,
        queryParams: utils.getQueryParams()
      };
      
      state.eventQueue.push(event);
      utils.log('Event queued', event);
      
      // If it's a standard e-commerce event, also relay to S2S endpoints
      if (['page_view', 'add_to_cart', 'purchase', 'checkout', 'view_item'].indexOf(eventName) !== -1) {
        core.relayToS2S(eventName, eventData);
      }
      
      return this;
    };
    
    EcomTracker.identify = function(userId, traits = {}) {
      state.userId = userId;
      utils.setCookie(config.cookieName, userId, config.cookieExpiry);
      
      this.track('identify', traits);
      utils.log('User identified manually', { userId, traits });
      
      return this;
    };
    
    EcomTracker.pageview = function(pageData = {}) {
      return this.track('pageview', {
        title: document.title,
        url: window.location.href,
        path: window.location.pathname,
        ...pageData
      });
    };
    
    EcomTracker.ecommerce = {
      viewProduct: function(product) {
        return EcomTracker.track('view_item', product);
      },
      
      addToCart: function(product) {
        return EcomTracker.track('add_to_cart', product);
      },
      
      removeFromCart: function(product) {
        return EcomTracker.track('remove_from_cart', product);
      },
      
      beginCheckout: function(cart) {
        return EcomTracker.track('begin_checkout', cart);
      },
      
      addPaymentInfo: function(paymentInfo) {
        return EcomTracker.track('add_payment_info', paymentInfo);
      },
      
      purchase: function(order) {
        return EcomTracker.track('purchase', order);
      }
    };
    
    EcomTracker.setConfig = function(newConfig) {
      Object.assign(config, newConfig);
      return this;
    };
    
    EcomTracker.getConfig = function() {
      return { ...config };
    };
    
    EcomTracker.debug = function(enable) {
      config.debug = enable;
      return this;
    };
    
  })(window, document);
  
  // Usage examples:
  /*
  // Initialize the tracker
  EcomTracker.init({
    endpoint: 'https://tracking.your-domain.com/collect',
    siteId: 'my-ecommerce-site',
    debug: true
  });
  
  // Track custom events
  EcomTracker.track('product_filter', {
    category: 'Electronics',
    filters: ['price_range', 'brand'],
    resultsCount: 42
  });
  
  // Track e-commerce specific events
  EcomTracker.ecommerce.viewProduct({
    id: 'SKU123',
    name: 'Wireless Headphones',
    price: 89.99,
    brand: 'AudioTech',
    category: 'Electronics/Audio',
    variant: 'Black'
  });
  
  EcomTracker.ecommerce.addToCart({
    id: 'SKU123',
    name: 'Wireless Headphones',
    price: 89.99,
    quantity: 1
  });
  
  EcomTracker.ecommerce.purchase({
    transaction_id: 'T12345',
    value: 89.99,
    currency: 'USD',
    tax: 7.20,
    shipping: 4.99,
    items: [{
      id: 'SKU123',
      name: 'Wireless Headphones',
      price: 89.99,
      quantity: 1
    }]
  });
  */