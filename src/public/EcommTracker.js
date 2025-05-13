/**
 * Enhanced E-commerce Event Tracking Library
 * A drop-and-forget tracking solution for e-commerce websites
 * 
 * Features:
 * - Automatic event tracking (pageviews, clicks, form submissions)
 * - Automatic e-commerce event detection (add to cart, product views, checkout)
 * - Uses data attributes to identify trackable elements
 * - Custom event tracking API still available
 * - Query parameter forwarding
 * - Server-to-server (S2S) event relaying
 * - Cookie management for user identification
 * - Throttling and batching of events for performance
 */

(function(window, document) {
  'use strict';
  
  // Main tracker object
  window.EcommTracker = window.EcommTracker || {};
  
  // Configuration (customize these values)
  const config = {
    endpoint: 'http://localhost:3000/api/track/batch',
    siteId: '100',
    cookieName: '_ecom_visitor',
    cookieExpiry: 365, // days
    sessionTimeout: 30, // minutes
    batchSize: 10,
    batchInterval: 2000, // ms
    debug: false,
    automaticEvents: true,
    s2sEndpoint: null, // Disabled by default
    // New config options for auto-tracking
    autoTrackProductViews: true,
    autoTrackAddToCart: true,
    autoTrackCheckout: true,
    autoTrackPurchase: true,
    autoTrackNavigation: true,
    // Selector config for auto-tracking
    selectors: {
      addToCart: '[data-track="add-to-cart"], .add-to-cart, [data-action="add-to-cart"]',
      addToCartText: ['Add to Cart', 'Add To Cart', 'Add to Bag', 'Buy Now'],
      productCard: '.product, .product-card, [data-product-id], [data-track="product"]',
      checkout: '.checkout-button, [data-track="checkout"]',
      checkoutText: ['Checkout', 'Check out', 'Proceed to Checkout'],
      purchase: '[data-track="purchase"], [data-action="purchase"], form.purchase-form, #place-order',
      navigation: 'nav a, .navigation a, .nav-links a',
      wishlist: '.wishlist, [data-track="wishlist"], [data-action="wishlist"]',
      wishlistText: ['Wishlist', 'Add to Wishlist', 'Save for Later'],
      searchForm: 'form[action*="search"], form.search-form, [data-track="search"]'
    }
  };
  
  // State management
  let state = {
    userId: null,
    sessionId: null,
    eventQueue: [],
    lastActivity: Date.now(),
    initialized: false,
    currentPage: {
      title: document.title,
      url: window.location.href,
      path: window.location.pathname,
      referrer: document.referrer
    },
    viewedProducts: new Set(), // Ensure products are tracked only once per page view
    cart: [] // Maintain a simple cart state
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
        console.log('[EcommTracker]', message, obj || '');
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
    },
    
    // Find all elements matching a selector
    findElements: function(selector) {
      if (!selector) {
        utils.log('Warning: Empty or undefined selector provided');
        return [];
      }
      
      try {
        const elements = document.querySelectorAll(selector);
        return elements || [];
      } catch (e) {
        utils.log('Invalid selector, could not find elements:', selector, e);
        return [];
      }
    },
    
    // Extract product data from a product element
    extractProductData: function(element) {
      if (!element) return null;
      
      // Look for product card element if given element is a button or other child
      const productElement = element.closest(config.selectors.productCard) || element;
      
      // Extract from data attributes first (most reliable)
      const data = {
        id: productElement.dataset.productId || productElement.dataset.id || null,
        name: productElement.dataset.productName || productElement.dataset.name || null,
        price: parseFloat(productElement.dataset.productPrice || productElement.dataset.price || 0),
        category: productElement.dataset.productCategory || productElement.dataset.category || null,
        variant: productElement.dataset.productVariant || productElement.dataset.variant || null,
        brand: productElement.dataset.productBrand || productElement.dataset.brand || null,
        quantity: parseInt(productElement.dataset.quantity || 1, 10)
      };
      
      // If data attributes aren't available, try to extract from content
      if (!data.name) {
        // Look for product title element
        const titleElement = productElement.querySelector('.product-title, .product-name, h2, h3');
        if (titleElement) {
          data.name = titleElement.textContent.trim();
        }
      }
      
      if (!data.price || isNaN(data.price)) {
        // Look for price element
        const priceElement = productElement.querySelector('.product-price, .price, .current-price');
        if (priceElement) {
          // Extract number from price text (remove currency symbols, etc.)
          const priceMatch = priceElement.textContent.match(/[\d.,]+/);
          if (priceMatch) {
            data.price = parseFloat(priceMatch[0].replace(/,/g, ''));
          }
        }
      }
      
      if (!data.id && data.name) {
        // Create an ID from the name if no ID is available
        data.id = data.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
      }
      
      return data;
    },
    
    // Check if an element or its children contain specific text
    elementContainsText: function(element, text) {
      const lowerText = text.toLowerCase();
      const elementText = element.textContent.toLowerCase();
      return elementText.indexOf(lowerText) !== -1;
    },
    
    // Check if an element matches any selector in a list
    elementMatchesAny: function(element, selectorList) {
      if (!element || !selectorList) return false;
      
      // Make sure element is a DOM element with matches method
      if (!element.nodeType || element.nodeType !== 1 || typeof element.matches !== 'function') {
        return false;
      }
      
      try {
        const selectors = selectorList.split(',');
        
        for (let i = 0; i < selectors.length; i++) {
          const selector = selectors[i].trim();
          
          if (!selector) continue;
          
          // Handle :contains() pseudo-selector
          if (selector.includes(':contains(')) {
            const baseSelector = selector.split(':contains(')[0];
            const textMatch = selector.match(/:contains\("(.+?)"\)/);
            
            if (textMatch && textMatch[1]) {
              const searchText = textMatch[1];
              
              // If base selector exists, check if element matches it first
              if (baseSelector) {
                try {
                  if (!element.matches(baseSelector)) {
                    continue;
                  }
                } catch (e) {
                  utils.log('Error matching selector:', baseSelector, e);
                  continue;
                }
              }
              
              if (utils.elementContainsText(element, searchText)) {
                return true;
              }
            }
          } 
          // Standard selector
          else if (selector) {
            try {
              if (element.matches(selector)) {
                return true;
              }
            } catch (e) {
              utils.log('Error matching selector:', selector, e);
              continue;
            }
          }
        }
      } catch (error) {
        utils.log('Error in elementMatchesAny:', error);
        return false;
      }
      
      return false;
    }
  };
  
  // Core functionality
  const core = {
    init: function(customConfig) {
      try {
        // Make sure initialization happens only once
        if (state.initialized) {
          utils.log('Tracker already initialized');
          return this;
        }
        
        // Merge custom configuration
        if (customConfig) {
          // Deep merge for nested objects like selectors
          if (customConfig.selectors) {
            customConfig.selectors = Object.assign({}, config.selectors, customConfig.selectors);
          }
          Object.assign(config, customConfig);
        }
        
        utils.log('Initializing with config', config);
        
        // Initialize user identification
        this.identifyUser();
        
        // Check if document is ready before setting up DOM-related features
        const setupDomFeatures = () => {
          // Set up automatic event tracking if enabled
          if (config.automaticEvents) {
            this.setupEventListeners();
            
            // Set up MutationObserver only if document.body exists
            if (document.body) {
              this.setupMutationObserver();
            } else {
              // Wait for body to be available
              window.addEventListener('load', () => {
                this.setupMutationObserver();
              });
            }
          }
          
          // If this is a product page (detect based on URL or page content)
          if (config.autoTrackProductViews) {
            this.detectAndTrackProductView();
          }
        };
        
        // Start the event processing loop
        this.startEventProcessing();
        
        // Set initialized state
        state.initialized = true;
        
        // Track initial pageview
        EcommTracker.track('pageview', {
          title: document.title,
          url: window.location.href,
          path: window.location.pathname,
          referrer: document.referrer
        });
        
        // Setup DOM-related features based on document readiness
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', setupDomFeatures);
        } else {
          setupDomFeatures();
        }
        
        utils.log('Initialization completed');
        return this;
      } catch (error) {
        utils.log('Error during initialization:', error);
        return this;
      }
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
    
    detectAndTrackProductView: function() {
      try {
        // Check URL pattern first
        const path = window.location.pathname;
        if (path.match(/\/(product|item|p)\//) || path.match(/\/(products|shop)\/[^\/]+$/)) {
          // This appears to be a product page based on URL
          this.trackProductView();
          return;
        }
        
        // Check for single product display
        try {
          const singleProduct = document.querySelector('.product-detail, .product-page, [data-track="product-detail"]');
          if (singleProduct) {
            const productData = utils.extractProductData(singleProduct);
            if (productData && productData.id) {
              EcommTracker.ecommerce.viewProduct(productData);
              return;
            }
          }
        } catch (error) {
          utils.log('Error detecting single product:', error);
        }
        
        // Check if there's only one product on the page
        try {
          const productSelector = config.selectors && config.selectors.productCard ? 
                                config.selectors.productCard : 
                                '.product, .product-card, [data-product-id]';
          
          const products = utils.findElements(productSelector);
          if (products.length === 1) {
            const productData = utils.extractProductData(products[0]);
            if (productData && productData.id) {
              EcommTracker.ecommerce.viewProduct(productData);
            }
          }
        } catch (error) {
          utils.log('Error detecting multiple products:', error);
        }
      } catch (error) {
        utils.log('Error in detectAndTrackProductView:', error);
      }
    },
    
    trackProductView: function() {
      try {
        // Try to find product information on the page
        let productName = null;
        let productId = null;
        let productPrice = null;
        let productCategory = null;
        
        try {
          const nameElement = document.querySelector('h1, .product-title, .product-name');
          if (nameElement) {
            productName = nameElement.textContent.trim();
          }
        } catch (error) {
          utils.log('Error extracting product name:', error);
        }
        
        try {
          const idElement = document.querySelector('[data-product-id]') || document.querySelector('[data-id]');
          if (idElement) {
            productId = idElement.dataset.productId || idElement.dataset.id;
          }
        } catch (error) {
          utils.log('Error extracting product ID:', error);
        }
        
        // Extract price - look for elements that typically contain price
        try {
          const priceElement = document.querySelector('.price, .product-price, .current-price');
          if (priceElement) {
            const priceMatch = priceElement.textContent.match(/[\d.,]+/);
            if (priceMatch) {
              productPrice = parseFloat(priceMatch[0].replace(/,/g, ''));
            }
          }
        } catch (error) {
          utils.log('Error extracting product price:', error);
        }
        
        // Extract category - look for breadcrumbs or category elements
        try {
          const categoryElement = document.querySelector('.product-category, .breadcrumbs .category');
          if (categoryElement) {
            productCategory = categoryElement.textContent.trim();
          }
        } catch (error) {
          utils.log('Error extracting product category:', error);
        }
        
        if (productName || productId) {
          // Create a derived ID if none is found
          if (!productId && productName) {
            productId = productName.toLowerCase().replace(/[^a-z0-9]/g, '-');
          }
          
          EcommTracker.ecommerce.viewProduct({
            id: productId,
            name: productName,
            price: productPrice,
            category: productCategory
          });
          
          utils.log('Tracked product view:', {
            id: productId,
            name: productName,
            price: productPrice,
            category: productCategory
          });
        } else {
          utils.log('Could not identify product on this page');
        }
      } catch (error) {
        utils.log('Error in trackProductView:', error);
      }
    },
    
    setupEventListeners: function() {
      try {
        // Track clicks
        document.addEventListener('click', utils.throttle((e) => {
          try {
            this.handleClick(e);
          } catch (error) {
            utils.log('Error handling click event:', error);
          }
        }, 300));
        
        // Track form submissions
        document.addEventListener('submit', (e) => {
          try {
            this.handleFormSubmit(e);
          } catch (error) {
            utils.log('Error handling form submission:', error);
          }
        });
        
        // Track page visibility changes
        document.addEventListener('visibilitychange', () => {
          try {
            if (document.visibilityState === 'visible') {
              EcommTracker.track('visibility_visible');
            } else if (document.visibilityState === 'hidden') {
              EcommTracker.track('visibility_hidden');
            }
          } catch (error) {
            utils.log('Error handling visibility change:', error);
          }
        });
        
        // Track product impressions when they come into view
        if (config.autoTrackProductViews) {
          try {
            this.setupProductViewTracking();
          } catch (error) {
            utils.log('Error setting up product view tracking:', error);
          }
        }
        
        // Update session on activity
        const activityEvents = ['mousedown', 'keydown', 'touchstart', 'scroll'];
        activityEvents.forEach(eventName => {
          try {
            document.addEventListener(eventName, utils.throttle(() => {
              const now = Date.now();
              if (now - state.lastActivity > config.sessionTimeout * 60 * 1000) {
                // Session expired, create a new session
                state.sessionId = utils.generateId();
                utils.setCookie(config.cookieName + '_session', state.sessionId, config.sessionTimeout / (24 * 60));
                EcommTracker.track('session_renewed');
              }
              state.lastActivity = now;
            }, 1000));
          } catch (error) {
            utils.log(`Error setting up ${eventName} listener:`, error);
          }
        });
        
        // Handle page unload
        try {
          window.addEventListener('beforeunload', () => {
            EcommTracker.track('page_exit');
            this.processEvents(true); // Force send events
          });
        } catch (error) {
          utils.log('Error setting up beforeunload listener:', error);
        }
        
        utils.log('Event listeners set up successfully');
      } catch (error) {
        utils.log('Error during event listener setup:', error);
      }
    },
    
    handleClick: function(e) {
      try {
        const target = e.target;
        
        // Check for add to cart buttons
        if (config.autoTrackAddToCart && this.isAddToCartAction(target)) {
          const productData = utils.extractProductData(target);
          if (productData && productData.id) {
            EcommTracker.ecommerce.addToCart(productData);
            
            // Add to our internal cart state
            const existingItem = state.cart.find(item => item.id === productData.id);
            if (existingItem) {
              existingItem.quantity += (productData.quantity || 1);
            } else {
              state.cart.push(productData);
            }
          }
        }
        
        // Check for remove from cart buttons
        if (this.isRemoveFromCartAction(target)) {
          const productData = utils.extractProductData(target);
          if (productData && productData.id) {
            EcommTracker.ecommerce.removeFromCart(productData);
            
            // Remove from our internal cart state
            const itemIndex = state.cart.findIndex(item => item.id === productData.id);
            if (itemIndex !== -1) {
              state.cart.splice(itemIndex, 1);
            }
          }
        }
        
        // Check for wishlist buttons
        if (this.isWishlistAction(target)) {
          const productData = utils.extractProductData(target);
          if (productData && productData.id) {
            // Determine if adding or removing based on element state
            const action = target.classList.contains('active') ? 'remove_from_wishlist' : 'add_to_wishlist';
            
            EcommTracker.track(action, productData);
          }
        }
        
        // Check for checkout buttons
        if (config.autoTrackCheckout && this.isCheckoutAction(target)) {
          EcommTracker.ecommerce.beginCheckout({
            items: state.cart,
            value: state.cart.reduce((sum, item) => sum + (item.price * (item.quantity || 1)), 0)
          });
        }
        
        // Check for navigation links
        if (config.autoTrackNavigation && this.isNavigationLink(target)) {
          const linkElement = target.closest('a');
          if (linkElement) {
            const linkText = linkElement.textContent.trim();
            const linkHref = linkElement.getAttribute('href');
            
            EcommTracker.track('navigation_click', {
              text: linkText,
              href: linkHref,
              section: linkElement.dataset.section || linkElement.dataset.nav || this.detectNavigationSection(linkElement)
            });
          }
        }
      } catch (error) {
        utils.log('Error in handleClick:', error);
      }
    },
    
    handleFormSubmit: function(e) {
      const form = e.target;
      
      // Check for search forms
      if (this.isSearchForm(form)) {
        const searchInput = form.querySelector('input[type="search"], input[name="q"], input[name="query"], input[name="s"]');
        if (searchInput) {
          EcommTracker.track('search', {
            search_term: searchInput.value
          });
        }
      }
      
      // Check for checkout/purchase forms
      if (this.isPurchaseForm(form)) {
        // Get total from form if available
        let total = null;
        const totalElement = form.querySelector('.total, .order-total, [data-total]');
        if (totalElement) {
          const totalMatch = totalElement.textContent.match(/[\d.,]+/);
          if (totalMatch) {
            total = parseFloat(totalMatch[0].replace(/,/g, ''));
          }
        }
        
        EcommTracker.ecommerce.purchase({
          transaction_id: utils.generateId(), // Ideally would be extracted from form or page
          value: total || state.cart.reduce((sum, item) => sum + (item.price * (item.quantity || 1)), 0),
          currency: document.documentElement.lang === 'en-US' ? 'USD' : 'EUR', // Simplified currency detection
          items: state.cart
        });
      }
      
      // Track all form submissions
      const eventData = {
        formId: form.id || null,
        formAction: form.action || null,
        formName: form.name || null,
        formFields: this.getFormFieldNames(form)
      };
      
      EcommTracker.track('form_submit', eventData);
    },
    
    setupProductViewTracking: function() {
      try {
        // Use Intersection Observer to detect when products come into view
        if ('IntersectionObserver' in window) {
          const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
              if (entry.isIntersecting) {
                const productElement = entry.target;
                const productData = utils.extractProductData(productElement);
                
                // Only track each product once per page view
                if (productData && productData.id && !state.viewedProducts.has(productData.id)) {
                  state.viewedProducts.add(productData.id);
                  
                  EcommTracker.track('product_impression', productData);
                }
                
                // Stop observing this product
                observer.unobserve(productElement);
              }
            });
          }, {
            threshold: 0.5 // At least 50% of the product must be visible
          });
          
          // Observe all product elements - only if there are any
          const productSelector = config.selectors && config.selectors.productCard ? config.selectors.productCard : '.product, .product-card, [data-product-id]';
          
          try {
            const productElements = utils.findElements(productSelector);
            
            if (productElements && productElements.length > 0) {
              utils.log(`Setting up tracking for ${productElements.length} product elements`);
              productElements.forEach(element => {
                observer.observe(element);
              });
            } else {
              utils.log('No product elements found on this page');
            }
          } catch (error) {
            utils.log('Error finding product elements:', error);
          }
        } else {
          utils.log('IntersectionObserver not available in this browser');
        }
      } catch (error) {
        utils.log('Error setting up product view tracking:', error);
      }
    },
    
    setupMutationObserver: function() {
      // Use MutationObserver to detect dynamically added elements
      if ('MutationObserver' in window && document.body) {
        const observer = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            if (mutation.type === 'childList') {
              // Check for added products
              mutation.addedNodes.forEach(node => {
                if (node.nodeType === 1) { // Element node
                  try {
                    // Check if this is a product element
                    if (utils.elementMatchesAny(node, config.selectors.productCard)) {
                      const productData = utils.extractProductData(node);
                      if (productData && productData.id && !state.viewedProducts.has(productData.id)) {
                        state.viewedProducts.add(productData.id);
                        EcommTracker.track('product_impression', productData);
                      }
                    }
                    
                    // Check for child product elements
                    try {
                      const productElements = node.querySelectorAll(config.selectors.productCard);
                      productElements.forEach(element => {
                        const productData = utils.extractProductData(element);
                        if (productData && productData.id && !state.viewedProducts.has(productData.id)) {
                          state.viewedProducts.add(productData.id);
                          EcommTracker.track('product_impression', productData);
                        }
                      });
                    } catch (error) {
                      utils.log('Error finding child products:', error);
                    }
                    
                    // Set up click handlers for add to cart buttons
                    if (config.autoTrackAddToCart) {
                      try {
                        // Use a standard selector without :contains
                        const addToCartButtons = node.querySelectorAll(config.selectors.addToCart);
                        
                        addToCartButtons.forEach(button => {
                          button.addEventListener('click', (e) => {
                            try {
                              const productData = utils.extractProductData(button);
                              if (productData && productData.id) {
                                EcommTracker.ecommerce.addToCart(productData);
                              }
                            } catch (error) {
                              utils.log('Error handling add to cart click:', error);
                            }
                          });
                        });
                        
                        // Look for buttons with text matching add to cart
                        if (config.selectors.addToCartText && Array.isArray(config.selectors.addToCartText)) {
                          const allButtons = node.querySelectorAll('button, a[role="button"], [role="button"]');
                          
                          allButtons.forEach(button => {
                            const buttonText = button.textContent.toLowerCase();
                            
                            for (let i = 0; i < config.selectors.addToCartText.length; i++) {
                              const textToMatch = config.selectors.addToCartText[i].toLowerCase();
                              
                              if (buttonText.includes(textToMatch)) {
                                button.addEventListener('click', (e) => {
                                  try {
                                    const productData = utils.extractProductData(button);
                                    if (productData && productData.id) {
                                      EcommTracker.ecommerce.addToCart(productData);
                                    }
                                  } catch (error) {
                                    utils.log('Error handling text-matched add to cart click:', error);
                                  }
                                });
                                break; // Once we've found a match, no need to check other text patterns
                              }
                            }
                          });
                        }
                      } catch (error) {
                        utils.log('Error setting up add to cart handlers:', error);
                      }
                    }
                  } catch (error) {
                    utils.log('Error processing mutation node:', error);
                  }
                }
              });
            }
          }
        });
        
        // Start observing only if document.body exists
        try {
          observer.observe(document.body, {
            childList: true,
            subtree: true
          });
        } catch (error) {
          utils.log('MutationObserver error:', error);
          
          // If document.body is not available yet, set up a fallback
          if (document.readyState !== 'complete' && document.readyState !== 'interactive') {
            document.addEventListener('DOMContentLoaded', function() {
              observer.observe(document.body, {
                childList: true,
                subtree: true
              });
            });
          }
        }
      } else {
        utils.log('MutationObserver not available or document.body not ready');
      }
    },
    
    isAddToCartAction: function(element) {
      try {
        const target = element.closest('button, a, [role="button"]') || element;
        return utils.elementMatchesAny(target, config.selectors.addToCart, config.selectors.addToCartText);
      } catch (error) {
        utils.log('Error in isAddToCartAction:', error);
        return false;
      }
    },
    
    isRemoveFromCartAction: function(element) {
      try {
        const target = element.closest('button, a, [role="button"]') || element;
        return target.classList.contains('remove-from-cart') || 
              target.dataset.action === 'remove-from-cart' ||
              utils.elementContainsText(target, 'Remove');
      } catch (error) {
        utils.log('Error in isRemoveFromCartAction:', error);
        return false;
      }
    },
    
    isWishlistAction: function(element) {
      try {
        const target = element.closest('button, a, [role="button"]') || element;
        return utils.elementMatchesAny(target, config.selectors.wishlist, config.selectors.wishlistText);
      } catch (error) {
        utils.log('Error in isWishlistAction:', error);
        return false;
      }
    },
    
    isCheckoutAction: function(element) {
      try {
        const target = element.closest('button, a, [role="button"]') || element;
        return utils.elementMatchesAny(target, config.selectors.checkout, config.selectors.checkoutText);
      } catch (error) {
        utils.log('Error in isCheckoutAction:', error);
        return false;
      }
    },
    
    isNavigationLink: function(element) {
      const linkElement = element.closest('a');
      return linkElement && utils.elementMatchesAny(linkElement, config.selectors.navigation);
    },
    
    isSearchForm: function(form) {
      return utils.elementMatchesAny(form, config.selectors.searchForm) ||
             form.querySelector('input[type="search"]') !== null;
    },
    
    isPurchaseForm: function(form) {
      return utils.elementMatchesAny(form, config.selectors.purchase) ||
             form.id === 'checkout-form' || 
             form.classList.contains('checkout-form') ||
             form.action?.includes('checkout') ||
             form.action?.includes('purchase');
    },
    
    detectNavigationSection: function(linkElement) {
      // Try to detect which section this navigation link belongs to
      const parentNav = linkElement.closest('nav, .nav, .navigation');
      if (parentNav) {
        if (parentNav.classList.contains('main-nav')) return 'main';
        if (parentNav.classList.contains('footer-nav')) return 'footer';
        
        // Check parent headings
        const heading = parentNav.querySelector('h1, h2, h3, h4, h5, h6');
        if (heading) {
          return heading.textContent.trim().toLowerCase();
        }
      }
      
      // Check if this is in the header
      if (linkElement.closest('header')) return 'header';
      if (linkElement.closest('footer')) return 'footer';
      
      return 'unknown';
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
      // Only relay if S2S endpoint is configured and not null/disabled
      if (!config.s2sEndpoint || config.s2sEndpoint === 'disabled') {
        utils.log('S2S relay disabled, skipping relay for event:', eventName);
        return;
      }
      
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
      
      try {
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
      } catch (error) {
        utils.log('S2S relay fetch error', error);
      }
    }
  };
  
  // Public API
  EcommTracker.init = function(customConfig) {
    return core.init(customConfig);
  };
  
  EcommTracker.track = function(eventName, eventData = {}) {
    if (!state.initialized) {
      utils.log('Tracker not initialized. Call EcommTracker.init() first.');
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
    if (['pageview', 'add_to_cart', 'purchase', 'checkout', 'view_item'].indexOf(eventName) !== -1) {
      core.relayToS2S(eventName, eventData);
    }
    
    return this;
  };
  
  EcommTracker.identify = function(userId, traits = {}) {
    state.userId = userId;
    utils.setCookie(config.cookieName, userId, config.cookieExpiry);
    
    this.track('identify', traits);
    utils.log('User identified manually', { userId, traits });
    
    return this;
  };
  
  EcommTracker.pageview = function(pageData = {}) {
    return this.track('pageview', {
      title: document.title,
      url: window.location.href,
      path: window.location.pathname,
      ...pageData
    });
  };
  
  EcommTracker.ecommerce = {
    viewProduct: function(product) {
      return EcommTracker.track('view_item', product);
    },
    
    addToCart: function(product) {
      return EcommTracker.track('add_to_cart', product);
    },
    
    removeFromCart: function(product) {
      return EcommTracker.track('remove_from_cart', product);
    },
    
    beginCheckout: function(cart) {
      return EcommTracker.track('begin_checkout', cart);
    },
    
    addPaymentInfo: function(paymentInfo) {
      return EcommTracker.track('add_payment_info', paymentInfo);
    },
    
    purchase: function(order) {
      return EcommTracker.track('purchase', order);
    }
  };
  
  EcommTracker.setConfig = function(newConfig) {
    Object.assign(config, newConfig);
    return this;
  };
  
  EcommTracker.getConfig = function() {
    return { ...config };
  };
  
  EcommTracker.debug = function(enable) {
    config.debug = enable;
    return this;
  };
  
  // Create a compatibility API for older implementations
  window.ecommTracker = {
    trackEvent: function(eventName, eventData) {
      return EcommTracker.track(eventName, eventData);
    },
    version: '2.0.0'
  };
  
  // Auto-initialize if script has data-auto-init attribute
  const currentScript = document.currentScript;
  if (currentScript && currentScript.dataset.autoInit !== 'false') {
    let customConfig = {};
    
    // Check for endpoint in data attribute
    if (currentScript.dataset.endpoint) {
      customConfig.endpoint = currentScript.dataset.endpoint;
    }
    
    // Check for site ID in data attribute
    if (currentScript.dataset.siteId) {
      customConfig.siteId = currentScript.dataset.siteId;
    }
    
    // Check for debug mode
    if (currentScript.dataset.debug === 'true') {
      customConfig.debug = true;
    }
    
    // Check for S2S endpoint configuration
    if (currentScript.dataset.s2sEndpoint) {
      if (currentScript.dataset.s2sEndpoint === 'disabled') {
        customConfig.s2sEndpoint = null; // Disable S2S relay
      } else {
        customConfig.s2sEndpoint = currentScript.dataset.s2sEndpoint;
      }
    }
    
    // Initialize with any custom config from data attributes
    // Check if the DOM is ready before initializing
    if (document.readyState === 'loading') {
      // DOM is still loading, wait for it to be ready
      document.addEventListener('DOMContentLoaded', function() {
        EcommTracker.init(customConfig);
      });
    } else {
      // DOM is already ready, initialize immediately
      EcommTracker.init(customConfig);
    }
  }
  
})(window, document);

// Usage examples:
/*
// Basic initialization (when not using auto-init)
EcommTracker.init({
  endpoint: 'https://tracking.your-domain.com/collect',
  siteId: 'my-ecommerce-site',
  debug: true
});

// Customizing selectors for different site structures
EcommTracker.init({
  endpoint: 'https://tracking.your-domain.com/collect',
  siteId: 'my-ecommerce-site',
  selectors: {
    addToCart: '.btn-cart, .add-cart-button',
    productCard: '.product-item, .catalog-item'
  }
});

// Manual tracking is still available
EcommTracker.track('custom_event', {
  category: 'user_interaction',
  action: 'feature_usage',
  label: 'advanced_search'
});

// E-commerce tracking API is unchanged
EcommTracker.ecommerce.viewProduct({
  id: 'SKU123',
  name: 'Wireless Headphones',
  price: 89.99,
  brand: 'AudioTech',
  category: 'Electronics/Audio',
  variant: 'Black'
});
*/