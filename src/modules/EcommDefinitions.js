// Combined CMS table schemas
const ECOMMTRACKER_TABLE_SCHEMAS = {
    sessions: {
      routeType: 'def',
      dbType: process.env.DEFAULT_DBTYPE || 'mysql',
      dbConnection: process.env.DEFAULT_DBCONNECTION || 'MYSQL_1',
      dbTable: 'sessions',
      allowWrite: [
        'session_id', 'user_id', 'started_at', 'ended_at', 'duration_seconds',
        'is_active', 'device_type', 'browser', 'browser_version', 'os',
        'screen_width', 'screen_height', 'viewport_width', 'viewport_height',
        'referrer', 'landing_page', 'exit_page', 'utm_source', 'utm_medium',
        'utm_campaign', 'utm_term', 'utm_content'
      ],
      allowRead: [
        'session_id', 'user_id', 'started_at', 'ended_at', 'duration_seconds',
        'is_active', 'device_type', 'browser', 'browser_version', 'os',
        'screen_width', 'screen_height', 'viewport_width', 'viewport_height',
        'referrer', 'landing_page', 'exit_page', 'utm_source', 'utm_medium',
        'utm_campaign', 'utm_term', 'utm_content'
      ],
      keys: ['session_id'],
      acl: ['adminAccess'],
      cache: 0,
      columnDefinitions: {
        session_id: 'VARCHAR(36) PRIMARY KEY',
        user_id: 'VARCHAR(36) NOT NULL',
        started_at: 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP',
        ended_at: 'TIMESTAMP',
        duration_seconds: 'INT',
        is_active: 'BOOLEAN DEFAULT TRUE',
        device_type: 'VARCHAR(50)',
        browser: 'VARCHAR(50)',
        browser_version: 'VARCHAR(50)',
        os: 'VARCHAR(50)',
        screen_width: 'INT',
        screen_height: 'INT',
        viewport_width: 'INT',
        viewport_height: 'INT',
        referrer: 'TEXT',
        landing_page: 'TEXT',
        exit_page: 'TEXT',
        utm_source: 'VARCHAR(100)',
        utm_medium: 'VARCHAR(100)',
        utm_campaign: 'VARCHAR(100)',
        utm_term: 'VARCHAR(100)',
        utm_content: 'VARCHAR(100)'
      }
    },
  
    events: {
      routeType: 'def',
      dbType: process.env.DEFAULT_DBTYPE || 'mysql',
      dbConnection: process.env.DEFAULT_DBCONNECTION || 'MYSQL_1',
      dbTable: 'events',
      allowWrite: [
        'id', 'event_type', 'user_id', 'page_url', 'user_agent',
        'ip_address', 'event_data'
      ],
      allowRead: [
        'id', 'event_type', 'user_id', 'page_url', 'user_agent',
        'ip_address', 'event_data', 'created_at'
      ],
      keys: ['id'],
      acl: ['adminAccess'],
      cache: 0,
      columnDefinitions: {
        id: 'INT AUTO_INCREMENT PRIMARY KEY',
        event_type: 'VARCHAR(255) NOT NULL',
        user_id: 'VARCHAR(255) NOT NULL',
        page_url: 'TEXT NOT NULL',
        user_agent: 'TEXT',
        ip_address: 'VARCHAR(255)',
        event_data: 'JSON',
        created_at: 'DATETIME DEFAULT CURRENT_TIMESTAMP'
      }
    },
  
    pageviews: {
      routeType: 'def',
      dbType: process.env.DEFAULT_DBTYPE || 'mysql',
      dbConnection: process.env.DEFAULT_DBCONNECTION || 'MYSQL_1',
      dbTable: 'pageviews',
      allowWrite: [
        'pageview_id', 'event_id', 'url', 'path', 'title',
        'referrer', 'time_on_page', 'is_bounce', 'is_exit'
      ],
      allowRead: [
        'pageview_id', 'event_id', 'url', 'path', 'title',
        'referrer', 'time_on_page', 'is_bounce', 'is_exit'
      ],
      keys: ['pageview_id'],
      acl: ['adminAccess'],
      cache: 0,
      columnDefinitions: {
        pageview_id: 'BIGINT AUTO_INCREMENT PRIMARY KEY',
        event_id: 'BIGINT NOT NULL',
        url: 'TEXT NOT NULL',
        path: 'TEXT NOT NULL',
        title: 'TEXT',
        referrer: 'TEXT',
        time_on_page: 'INT',
        is_bounce: 'BOOLEAN',
        is_exit: 'BOOLEAN'
      }
    },
  
    clicks: {
      routeType: 'def',
      dbType: process.env.DEFAULT_DBTYPE || 'mysql',
      dbConnection: process.env.DEFAULT_DBCONNECTION || 'MYSQL_1',
      dbTable: 'clicks',
      allowWrite: [
        'click_id', 'event_id', 'element_type', 'element_text',
        'element_id', 'element_class', 'element_path', 'href'
      ],
      allowRead: [
        'click_id', 'event_id', 'element_type', 'element_text',
        'element_id', 'element_class', 'element_path', 'href'
      ],
      keys: ['click_id'],
      acl: ['adminAccess'],
      cache: 0,
      columnDefinitions: {
        click_id: 'BIGINT AUTO_INCREMENT PRIMARY KEY',
        event_id: 'BIGINT NOT NULL',
        element_type: 'VARCHAR(50)',
        element_text: 'TEXT',
        element_id: 'VARCHAR(100)',
        element_class: 'TEXT',
        element_path: 'TEXT',
        href: 'TEXT'
      }
    },
  
    form_submissions: {
      routeType: 'def',
      dbType: process.env.DEFAULT_DBTYPE || 'mysql',
      dbConnection: process.env.DEFAULT_DBCONNECTION || 'MYSQL_1',
      dbTable: 'form_submissions',
      allowWrite: ['form_id', 'event_id', 'form_name', 'form_action', 'form_fields'],
      allowRead: ['form_id', 'event_id', 'form_name', 'form_action', 'form_fields'],
      keys: ['form_id'],
      acl: ['adminAccess'],
      cache: 0,
      columnDefinitions: {
        form_id: 'BIGINT AUTO_INCREMENT PRIMARY KEY',
        event_id: 'BIGINT NOT NULL',
        form_name: 'VARCHAR(100)',
        form_action: 'TEXT',
        form_fields: 'JSON'
      }
    },
  
    product_views: {
      routeType: 'def',
      dbType: process.env.DEFAULT_DBTYPE || 'mysql',
      dbConnection: process.env.DEFAULT_DBCONNECTION || 'MYSQL_1',
      dbTable: 'product_views',
      allowWrite: [
        'product_view_id', 'event_id', 'product_id', 'product_name',
        'product_price', 'product_category', 'product_brand', 'product_variant'
      ],
      allowRead: [
        'product_view_id', 'event_id', 'product_id', 'product_name',
        'product_price', 'product_category', 'product_brand', 'product_variant'
      ],
      keys: ['product_view_id'],
      acl: ['adminAccess'],
      cache: 0,
      columnDefinitions: {
        product_view_id: 'BIGINT AUTO_INCREMENT PRIMARY KEY',
        event_id: 'BIGINT NOT NULL',
        product_id: 'VARCHAR(100) NOT NULL',
        product_name: 'TEXT',
        product_price: 'DECIMAL(10,2)',
        product_category: 'TEXT',
        product_brand: 'TEXT',
        product_variant: 'TEXT'
      }
    },
  
    cart_actions: {
      routeType: 'def',
      dbType: process.env.DEFAULT_DBTYPE || 'mysql',
      dbConnection: process.env.DEFAULT_DBCONNECTION || 'MYSQL_1',
      dbTable: 'cart_actions',
      allowWrite: [
        'cart_action_id', 'event_id', 'action_type', 'product_id',
        'product_name', 'product_price', 'quantity', 'total_value'
      ],
      allowRead: [
        'cart_action_id', 'event_id', 'action_type', 'product_id',
        'product_name', 'product_price', 'quantity', 'total_value'
      ],
      keys: ['cart_action_id'],
      acl: ['adminAccess'],
      cache: 0,
      columnDefinitions: {
        cart_action_id: 'BIGINT AUTO_INCREMENT PRIMARY KEY',
        event_id: 'BIGINT NOT NULL',
        action_type: 'VARCHAR(20) NOT NULL',
        product_id: 'VARCHAR(100) NOT NULL',
        product_name: 'TEXT',
        product_price: 'DECIMAL(10,2)',
        quantity: 'INT',
        total_value: 'DECIMAL(10,2)'
      }
    },
  
    purchases: {
      routeType: 'def',
      dbType: process.env.DEFAULT_DBTYPE || 'mysql',
      dbConnection: process.env.DEFAULT_DBCONNECTION || 'MYSQL_1',
      dbTable: 'purchases',
      allowWrite: [
        'purchase_id', 'event_id', 'transaction_id', 'revenue',
        'tax', 'shipping', 'currency', 'coupon_code', 'items'
      ],
      allowRead: [
        'purchase_id', 'event_id', 'transaction_id', 'revenue',
        'tax', 'shipping', 'currency', 'coupon_code', 'items'
      ],
      keys: ['purchase_id'],
      acl: ['adminAccess'],
      cache: 0,
      columnDefinitions: {
        purchase_id: 'BIGINT AUTO_INCREMENT PRIMARY KEY',
        event_id: 'BIGINT NOT NULL',
        transaction_id: 'VARCHAR(100) NOT NULL',
        revenue: 'DECIMAL(10,2) NOT NULL',
        tax: 'DECIMAL(10,2)',
        shipping: 'DECIMAL(10,2)',
        currency: 'VARCHAR(3) DEFAULT "USD"',
        coupon_code: 'VARCHAR(50)',
        items: 'JSON'
      }
    }
  };
  
  module.exports = ECOMMTRACKER_TABLE_SCHEMAS;
  