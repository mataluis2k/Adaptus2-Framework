#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const dotenv = require('dotenv');
const util = require('util');

// ANSI color codes for a more appealing CLI
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  underscore: "\x1b[4m",
  blink: "\x1b[5m",
  reverse: "\x1b[7m",
  hidden: "\x1b[8m",
  
  fg: {
    black: "\x1b[30m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
    crimson: "\x1b[38m"
  },
  
  bg: {
    black: "\x1b[40m",
    red: "\x1b[41m",
    green: "\x1b[42m",
    yellow: "\x1b[43m",
    blue: "\x1b[44m",
    magenta: "\x1b[45m",
    cyan: "\x1b[46m",
    white: "\x1b[47m",
    crimson: "\x1b[48m"
  }
};

// Define paths
const pluginDir = path.join(__dirname, './plugins'); // Adjust relative to the script
const configDir = path.join(__dirname, './config'); // Adjust relative to the script
const userDir = path.join(process.cwd(), 'plugins');
const userConfig = path.join(process.cwd(), 'config');

// Function to copy directory
function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`${colors.fg.red}Source directory does not exist: ${src}${colors.reset}`);
    process.exit(1);
  }

  fs.mkdirSync(dest, { recursive: true });

  fs.readdirSync(src).forEach((item) => {
    const srcPath = path.join(src, item);
    const destPath = path.join(dest, item);

    if (fs.statSync(srcPath).isDirectory()) {
      // Recursively copy directories
      copyDir(srcPath, destPath);
    } else {
      // Compare files before copying
      if (fs.existsSync(destPath)) {
        const srcStat = fs.statSync(srcPath);
        const destStat = fs.statSync(destPath);

        // If the files are different, only copy if the destination file is not modified
        if (srcStat.mtimeMs !== destStat.mtimeMs) {
          console.log(`${colors.fg.green}Skipping modified file: ${destPath}${colors.reset}`);
          return; // Skip copying if the destination file has been modified
        } else {
          console.log(`${colors.fg.green}Skipping identical file: ${destPath}${colors.reset}`);
          return; // Skip copying if the files are identical
        }
      }

      // Copy the source file to the destination if it's not already there or has not been modified
      fs.copyFileSync(srcPath, destPath);
      console.log(`${colors.fg.blue}Copied file: ${destPath}${colors.reset}`);
    }
  });
}

// Installer modes
const INSTALLER_MODES = {
  BASIC: 'basic',
  EXPERT: 'expert'
};

let installerMode = INSTALLER_MODES.BASIC;

// Groups of configuration options
const baseGroups = {
  "GENERAL SETTINGS": {
    variables: ["ENABLE_LOGGING", "CONFIG_DIR", "CORS_ENABLED", "CORS_ORIGIN", "CORS_METHODS", "CORS_CREDENTIALS", "DEFAULT_DBTYPE", "DEFAULT_DBCONNECTION"],
    description: "Basic application settings that control logging, CORS, and default database connections",
    always: true,
    mode: INSTALLER_MODES.BASIC
  },
  "SERVER CONFIGURATION": {
    variables: ["HOST", "PORT", "NODE_ENV", "SECRET_SALT"],
    description: "Core server configuration settings for host, port, and environment",
    always: true,
    mode: INSTALLER_MODES.BASIC
  },
  "AUTHENTICATION": {
    variables: ["JWT_SECRET", "JWT_EXPIRY"],
    description: "Authentication settings including JWT configuration",
    always: true,
    mode: INSTALLER_MODES.BASIC
  },
  "MEMORY & PERFORMANCE": {
    variables: ["MEMORY_MONITORING_INTERVAL", "MEMORY_THRESHOLD_PERCENT", "ENABLE_MEMORY_MONITORING", "DBPRECACHE"],
    description: "Performance monitoring and optimization settings",
    always: false,
    mode: INSTALLER_MODES.EXPERT
  },
  "ERROR HANDLING": {
    variables: ["SHUTDOWN_ON_UNCAUGHT", "SHUTDOWN_ON_REJECTION"],
    description: "Error handling behavior for uncaught exceptions",
    always: false,
    mode: INSTALLER_MODES.EXPERT
  },
  "DEVELOPMENT TOOLS": {
    variables: ["DEBUG", "LOG_LEVEL"],
    description: "Development and debugging tools",
    always: false,
    mode: INSTALLER_MODES.EXPERT
  },
  "CLUSTER SETUP": {
    variables: ["PLUGIN_MANAGER", "CLUSTER_NAME", "SERVER_ID", "SERVER_ROLE"],
    description: "Settings for distributed deployments and clustering",
    always: true,
    mode: INSTALLER_MODES.BASIC
  },
  "REDIS CONFIGURATION": {
    variables: ["REDIS_URL", "REPORT_CACHE_TTL", "CACHE_DURATION", "CLEAR_REDIS_CACHE"],
    description: "Redis connection and caching settings",
    dependencies: [],
    always: false,
    mode: INSTALLER_MODES.EXPERT
  },
  "DATABASE: MySQL": {
    variables: ["MYSQL_1_HOST", "MYSQL_1_USER", "MYSQL_1_PASSWORD", "MYSQL_1_DB"],
    description: "MySQL database connection settings",
    dependencies: [{ var: "DEFAULT_DBTYPE", value: "mysql" }],
    mode: INSTALLER_MODES.BASIC
  },
  "DATABASE: PostgreSQL": {
    variables: ["POSTGRES_1_HOST", "POSTGRES_1_USER", "POSTGRES_1_PASSWORD", "POSTGRES_1_DB"],
    description: "PostgreSQL database connection settings",
    dependencies: [{ var: "DEFAULT_DBTYPE", value: "postgres" }],
    mode: INSTALLER_MODES.BASIC
  },
  "DATABASE: MongoDB": {
    variables: ["MONGODB_1_URI", "MONGODB_1_DB"],
    description: "MongoDB database connection settings",
    dependencies: [{ var: "DEFAULT_DBTYPE", value: "mongodb" }],
    mode: INSTALLER_MODES.BASIC
  },
  "GRAPHQL": {
    variables: ["GRAPHQL_DBTYPE", "GRAPHQL_DBCONNECTION"],
    description: "GraphQL API configuration",
    always: false,
    mode: INSTALLER_MODES.EXPERT
  },
  "LLM INTEGRATION": {
    variables: ["LLM_TYPE", "OPENAI_API_KEY", "OPENAI_MODEL", "CLAUDE_API_KEY", "CLAUDE_MODEL", "OPENROUTER_API_KEY"],
    description: "Large Language Model integration settings",
    always: false,
    mode: INSTALLER_MODES.BASIC
  },
  "OLLAMA CONFIGURATION": {
    variables: ["OLLAMA_BASE_URL", "OLLAMA_INFERENCE", "OLLAMA_EMBEDDING_MODEL", "EMBEDDING_PROVIDER", "QUALITY_CONTROL_ENABLED", "QUALITY_CONTROL_MAX_RETRIES"],
    description: "Ollama LLM configuration settings",
    dependencies: [{ var: "LLM_TYPE", value: "ollama" }],
    mode: INSTALLER_MODES.EXPERT
  },
  "RAG CONFIGURATION": {
    variables: ["QDRANT_URL"],
    description: "Retrieval Augmented Generation settings",
    always: false,
    mode: INSTALLER_MODES.EXPERT
  },
  "VECTOR DATABASE": {
    variables: ["VECTOR_DB", "MILVUS_HOST", "MILVUS_PORT", "ELASTICSEARCH_HOST", "ELASTICSEARCH_INDEX", "CHROMA_URL", "CHROMA_TENANT", "CHROMA_DATABASE", "CHROMA_COLLECTION_NAME", "ALWAYS_UPDATE_COLLECTION", "USE_CONTEXT_SUMMARIZATION"],
    description: "Vector database settings for embedding storage",
    always: false,
    mode: INSTALLER_MODES.EXPERT
  },
  "OAUTH": {
    variables: ["OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET", "OAUTH_AUTH_URL", "OAUTH_TOKEN_URL", "OAUTH_CALLBACK_URL", "TOKEN_DURATION"],
    description: "OAuth authentication settings",
    always: false,
    mode: INSTALLER_MODES.EXPERT
  },
  "CLOUD STORAGE": {
    variables: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION", "STREAMING_FILESYSTEM_PATH", "S3_BUCKET_NAME"],
    description: "Cloud storage settings for AWS",
    always: false,
    mode: INSTALLER_MODES.EXPERT
  },
  "EMAIL SERVICES": {
    variables: ["SENDGRID_API_KEY", "MAILCHIMP_API_KEY", "MAILGUN_BASE_URL", "MAILGUN_API_KEY", "MAILGUN_DOMAIN"],
    description: "Email service integration settings",
    always: false,
    mode: INSTALLER_MODES.EXPERT
  },
  "PAYMENT PROCESSING": {
    variables: ["PAYMENT_MODULE", "STRIPE_SECRET_KEY", "BRAINTREE_ENV", "BRAINTREE_MERCHANT_ID", "BRAINTREE_PUBLIC_KEY", "BRAINTREE_PRIVATE_KEY", "APPLE_SHARED_SECRET"],
    description: "Payment processing integration settings",
    always: false,
    mode: INSTALLER_MODES.EXPERT
  },
  "INTEGRATIONS": {
    variables: ["GOOGLE_APPLICATION_CREDENTIALS", "SALESFORCE_BASE_URL", "SALESFORCE_API_TOKEN", "FACEBOOK_API_BASE_URL", "FACEBOOK_ACCESS_TOKEN", "FACEBOOK_PIXEL_ID", "GA4_API_BASE_URL", "GA4_MEASUREMENT_ID", "GA4_API_SECRET"],
    description: "Third-party service integration settings",
    always: false,
    mode: INSTALLER_MODES.EXPERT
  }
};

// Module-specific groups that only appear when their module is enabled
const moduleGroups = {
  "CONSOLE CONFIGURATION": {
    variables: ["SOCKET_CLI", "SOCKET_CLI_PORT", "CLI_USERNAME", "CLI_PASSWORD"],
    description: "Socket CLI configuration for remote management",
    always: true,
    mode: INSTALLER_MODES.BASIC
  },
  "CHAT SERVER": {
    variables: ["CHAT_SERVER_PORT", "DEFAULT_PERSONA"],
    description: "Chat server configuration",
    dependencies: [{ var: "MOD_CHATSERVER", value: "true" }],
    mode: INSTALLER_MODES.BASIC
  },
  "VIDEO CONFERENCE": {
    variables: ["WS_SIGNALING_PORT"],
    description: "Video conferencing server configuration",
    dependencies: [{ var: "MOD_VIDEOCONFERENCE", value: "true" }],
    mode: INSTALLER_MODES.BASIC
  },
  "STREAMING SERVER": {
    variables: ["STREAMING_DBTYPE", "DBSTREAMING_DBCONNECTION", "VIDEO_TABLE", "VIDEO_ID_COLUMN", "VIDEO_PATH_COLUMN", "VIDEO_HLS_COLUMN", "VIDEO_SOURCE_COLUMN", "VIDEO_FILENAME_COLUMN", "VIDEO_PARAM_NAME", "FFMPEG_PROFILE"],
    description: "Media streaming server configuration",
    dependencies: [{ var: "MOD_STREAMINGSERVER", value: "true" }],
    mode: INSTALLER_MODES.EXPERT
  },
  "CMS CONFIGURATION": {
    variables: ["DEFAULT_ADMIN"],
    description: "Content Management System configuration",
    dependencies: [{ var: "ENABLE_CMS", value: "true" }],
    mode: INSTALLER_MODES.BASIC
  },
  "CUSTOMER SUPPORT QUERIES": {
    variables: ["USER_PROFILE_QUERY", "ORDER_HISTORY_QUERY", "ORDER_HISTORY_TABLE", "ORDER_HISTORY_CONDITION", "ORDER_HISTORY_FIELDS", "ORDER_HISTORY_LIMIT", "ORDER_HISTORY_SORT", "CUSTOMER_NOTES_QUERY", "LOYALTY_POINTS_QUERY", "REFUND_POLICY_DAYS", "REFUND_UPDATE_QUERY", "REFUND_ELIGIBILITY_QUERY", "ORDER_NOTES_UPDATE_QUERY", "ORDER_DETAIL_QUERY", "ADD_CUSTOMER_NOTE_QUERY", "ADD_LOYALTY_POINTS_QUERY", "TRACKING_INFO_QUERY", "RETURN_STATUS_QUERY", "CREATE_RETURN_QUERY"],
    description: "Customer support and order management queries",
    dependencies: [{ var: "MOD_ECOMMTRACKER", value: "true" }],
    mode: INSTALLER_MODES.EXPERT
  },
  "REPORTING CONFIGURATION": {
    variables: [],
    description: "Reporting module configuration",
    dependencies: [{ var: "MOD_REPORTING", value: "true" }],
    mode: INSTALLER_MODES.BASIC
  },
  "ASSET MANAGEMENT": {
    variables: ["ASSETS_URL_PATH", "ASSETS_DISK_PATH"],
    description: "Asset management configuration",
    dependencies: [{ var: "MOD_PAGECLONE", value: "true" }],
    mode: INSTALLER_MODES.EXPERT
  },
  "MODULE TOGGLES": {
    variables: ["ENABLE_CMS", "MOD_PAGERENDER", "MOD_PAGECLONE", "MOD_CHATSERVER", "MOD_ECOMMTRACKER", "MOD_SDUIADMIN", "MOD_AGENT_WORKFLOW_ENABLED", "MOD_VIDEOCONFERENCE", "MOD_STREAMINGSERVER", "MOD_REPORTING", "MOD_REPORTBUILDER", "ML_ANALYTICS"],
    description: "Module enablement toggles for various features",
    always: true,
    mode: INSTALLER_MODES.BASIC
  }
};

// Merge base groups and module groups
const groups = { ...baseGroups, ...moduleGroups };

// Essential configuration that will always be included
const mandatoryConfig = {
  // General settings (always required)
  ENABLE_LOGGING: "FALSE",
  CONFIG_DIR: "./config",
  DEFAULT_DBTYPE: "mysql",
  DEFAULT_DBCONNECTION: "MYSQL_1",
  
  // Authentication (always required)
  JWT_SECRET: generateRandomSecret(32),
  JWT_EXPIRY: "30d",
  
  // Server settings (always required)
  PORT: 3000,
  HOST: "0.0.0.0",
  
  // Cluster setup (always required)
  PLUGIN_MANAGER: "local",
  SERVER_ROLE: "MASTER"
};

// Full configuration options (used only when a group is enabled)
const fullConfig = {
  // General settings
  CORS_ENABLED: "FALSE",
  CORS_ORIGIN: "*",
  CORS_METHODS: "GET,POST,PUT,DELETE",
  CORS_CREDENTIALS: "true",
  NODE_ENV: "production",
  SECRET_SALT: generateRandomSecret(16),
  
  // Redis Configuration
  REDIS_URL: "redis://localhost:6379",
  REPORT_CACHE_TTL: "600",
  CACHE_DURATION: "3600",
  CLEAR_REDIS_CACHE: "false",
  
  // Memory & Performance
  MEMORY_MONITORING_INTERVAL: "60000",
  MEMORY_THRESHOLD_PERCENT: "80",
  ENABLE_MEMORY_MONITORING: "false",
  DBPRECACHE: "false",
  
  // Module Toggles
  ENABLE_CMS: "false",
  MOD_PAGERENDER: "false",
  MOD_PAGECLONE: "false",
  MOD_CHATSERVER: "false",
  MOD_ECOMMTRACKER: "false",
  MOD_SDUIADMIN: "false",
  MOD_AGENT_WORKFLOW_ENABLED: "false",
  MOD_VIDEOCONFERENCE: "false",
  MOD_STREAMINGSERVER: "false",
  MOD_REPORTING: "false",
  MOD_REPORTBUILDER: "false",
  ML_ANALYTICS: "false",
  
  // Error Handling
  DEBUG: "false",
  LOG_LEVEL: "info",
  SHUTDOWN_ON_UNCAUGHT: "false",
  SHUTDOWN_ON_REJECTION: "false",
  
  // Server configuration
  SOCKET_CLI: "TRUE",
  SOCKET_CLI_PORT: 5000,
  CHAT_SERVER_PORT: 3007,
  WS_SIGNALING_PORT: 4000,
  CLI_USERNAME: "admin",
  CLI_PASSWORD: generateRandomSecret(8),
  
  // Default Settings
  DEFAULT_PERSONA: "helpfulAssistant",
  DEFAULT_ADMIN: "admin",
  DEFAULT_DB_CONNECTION: "DEFAULT_DBCONNECTION",
  
  // MySQL
  MYSQL_1_HOST: "localhost",
  MYSQL_1_USER: "root",
  MYSQL_1_PASSWORD: "",
  MYSQL_1_DB: "app",
  
  // PostgreSQL
  POSTGRES_1_HOST: "localhost",
  POSTGRES_1_USER: "postgres",
  POSTGRES_1_PASSWORD: "",
  POSTGRES_1_DB: "app",
  
  // MongoDB
  MONGODB_1_URI: "mongodb://localhost:27017",
  MONGODB_1_DB: "app",
  
  // GraphQL Configuration
  GRAPHQL_DBTYPE: "mysql",
  GRAPHQL_DBCONNECTION: "MYSQL_1",
  
  // LLM Integration
  LLM_TYPE: "ollama",
  OPENAI_MODEL: "gpt-3.5-turbo",
  CLAUDE_MODEL: "claude-2",
  
  // Ollama Configuration
  OLLAMA_BASE_URL: "http://localhost:11434",
  OLLAMA_INFERENCE: "llama3",
  OLLAMA_EMBEDDING_MODEL: "mxbai-embed-large",
  EMBEDDING_PROVIDER: "ollama",
  QUALITY_CONTROL_ENABLED: "false",
  QUALITY_CONTROL_MAX_RETRIES: "2",
  
  // RAG Configuration
  QDRANT_URL: "http://localhost:6333",
  
  // Vector Database
  VECTOR_DB: "milvus",
  MILVUS_HOST: "localhost",
  MILVUS_PORT: 19530,
  ELASTICSEARCH_HOST: "http://localhost:9200",
  ELASTICSEARCH_INDEX: "default",
  CHROMA_URL: "http://localhost:8000",
  CHROMA_TENANT: "default_tenant",
  CHROMA_DATABASE: "default_database",
  CHROMA_COLLECTION_NAME: "default_collection",
  ALWAYS_UPDATE_COLLECTION: "false",
  USE_CONTEXT_SUMMARIZATION: "false",
  
  // Storage
  STREAMING_FILESYSTEM_PATH: "./videos",
  ASSETS_URL_PATH: "/assets",
  ASSETS_DISK_PATH: "./public/assets",
  S3_BUCKET_NAME: "",
  
  // OAuth
  TOKEN_DURATION: "1d",
  
  // Payments
  PAYMENT_MODULE: "FALSE",
  BRAINTREE_ENV: "sandbox",

  // Streaming & Media
  STREAMING_DBTYPE: "mysql",
  DBSTREAMING_DBCONNECTION: "MYSQL_1",
  VIDEO_TABLE: "video_catalog",
  VIDEO_ID_COLUMN: "videoID",
  VIDEO_PATH_COLUMN: "videoPath",
  VIDEO_HLS_COLUMN: "hls",
  VIDEO_SOURCE_COLUMN: "source",
  VIDEO_FILENAME_COLUMN: "filename",
  VIDEO_PARAM_NAME: "videoID",
  FFMPEG_PROFILE: "mediumBandwidth",
  
  // Customer Support
  ORDER_HISTORY_QUERY: "SELECT * FROM ${table} WHERE ${condition} ORDER BY ${sort} LIMIT ${limit}",
  USER_PROFILE_QUERY: "SELECT name, email, meta FROM users_v2 WHERE id = ? LIMIT 1",
  ORDER_HISTORY_TABLE: "view_order_history",
  ORDER_HISTORY_CONDITION: "user_id = ?",
  ORDER_HISTORY_FIELDS: "external_order_id, status, amount, created_at, tracking_number, items",
  ORDER_HISTORY_LIMIT: "5",
  ORDER_HISTORY_SORT: "created_at DESC",
  REFUND_POLICY_DAYS: "30",
  CUSTOMER_NOTES_QUERY: "SELECT * FROM customer_notes WHERE customer_id = ? ORDER BY created_at DESC",
  LOYALTY_POINTS_QUERY: "SELECT points FROM loyalty_program WHERE user_id = ?",
};

// Generate a secure random string for secrets
function generateRandomSecret(length = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Verify and create config directory and initial files
function verifyAndCreateConfigDir(configDir) {
  if (!fs.existsSync(configDir)) {
    console.log(`${colors.fg.yellow}Config directory does not exist. Creating: ${configDir}${colors.reset}`);
    fs.mkdirSync(configDir, { recursive: true });
  }

  const businessRulesPath = path.join(configDir, 'businessRules.dsl');
  if (!fs.existsSync(businessRulesPath)) {
    console.log(`${colors.fg.yellow}Creating empty file: ${businessRulesPath}${colors.reset}`);
    fs.writeFileSync(businessRulesPath, '');
  }

  const mlConfigPath = path.join(configDir, 'mlConfig.json');
  if (!fs.existsSync(mlConfigPath)) {
    console.log(`${colors.fg.yellow}Creating default ML config file: ${mlConfigPath}${colors.reset}`);
    const mlConfig = {
      default: {
        batchSize: 1000,
        samplingRate: 1,
        parallelProcessing: false,
        incrementalTraining: false,
      },
    };
    fs.writeFileSync(mlConfigPath, JSON.stringify(mlConfig, null, 2));
  }
}

// Improved prompt function with styling
function prompt(question, defaultValue = "") {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) =>
    rl.question(`${colors.fg.cyan}${question}${colors.reset} ${colors.dim}[default: ${defaultValue}]${colors.reset}: `, (answer) => {
      rl.close();
      resolve(answer || defaultValue);
    })
  );
}

// Display a visually appealing menu
function printMenu(groups, currentConfig) {
  console.log("\n" + colors.bright + colors.fg.magenta + "┌─────────────────────────────────────┐");
  console.log("│         CONFIGURATION MENU         │");
  console.log("└─────────────────────────────────────┘" + colors.reset);
  
  // Display mode information
  console.log(`\n${colors.fg.cyan}Current Mode: ${colors.bright}${installerMode.toUpperCase()}${colors.reset}\n`);
  
  // Filter groups based on conditionals and mode
  const filteredGroups = [];
  
  for (const [groupName, groupInfo] of Object.entries(groups)) {
    // Skip groups that don't match the current mode
    if (groupInfo.mode !== installerMode && !groupInfo.always) {
      continue;
    }
    
    // Check dependencies
    let shouldShow = true;
    
    if (groupInfo.dependencies) {
      shouldShow = groupInfo.dependencies.some(dep => {
        return currentConfig[dep.var] === dep.value;
      });
    }
    
    // Always show groups marked as "always"
    if (groupInfo.always) {
      shouldShow = true;
    }
    
    if (shouldShow) {
      filteredGroups.push(groupName);
    }
  }
  
  const columnWidth = 40;
  const columns = 2;
  
  // Print in multiple columns if there are enough items
  for (let i = 0; i < Math.ceil(filteredGroups.length / columns); i++) {
    let line = "";
    
    for (let j = 0; j < columns; j++) {
      const index = i + j * Math.ceil(filteredGroups.length / columns);
      if (index < filteredGroups.length) {
        const groupName = filteredGroups[index];
        const displayNumber = (index + 1).toString().padStart(2, ' ');
        const groupConfigured = groups[groupName].variables.some((key) => currentConfig[key] !== undefined);
        
        // Add checkmark or empty space for enabled/disabled
        const statusSymbol = groupConfigured ? 
          colors.fg.green + " ✓" + colors.reset : 
          colors.fg.red + " ✗" + colors.reset;
        
        line += `${colors.fg.yellow}${displayNumber}${colors.reset}. ${groupName.padEnd(columnWidth - 7)}${statusSymbol}`;
      }
    }
    console.log(line);
  }
  
  console.log("\n" + colors.fg.green + "S" + colors.reset + ". Save and Exit");
  console.log(colors.fg.red + "Q" + colors.reset + ". Quit without Saving");
  console.log(colors.fg.blue + "M" + colors.reset + `. Switch to ${installerMode === INSTALLER_MODES.BASIC ? 'EXPERT' : 'BASIC'} Mode`);
}

// Configure a group of settings
async function configureGroup(groupName, groupInfo, config) {
  console.log(`\n${colors.bright}${colors.fg.magenta}┌─ Configuring ${groupName} ───${"─".repeat(40-groupName.length)}┐${colors.reset}`);
  console.log(`${colors.fg.blue}${groupInfo.description}${colors.reset}\n`);
  
  for (const key of groupInfo.variables) {
    // Get current or default value
    const currentValue = config[key] !== undefined ? config[key] : 
                         fullConfig[key] !== undefined ? fullConfig[key] : "";
    
    config[key] = await prompt(`${key}`, currentValue);
    
    // Special handling for CONFIG_DIR
    if (key === "CONFIG_DIR" && config[key]) {
      verifyAndCreateConfigDir(config[key]);
    }
    
    // Check for dependencies to automatically suggest
    await checkDependencies(key, config[key], config);
  }
  
  console.log(`${colors.fg.green}Configuration for ${groupName} completed.${colors.reset}`);
}

// Check for dependencies to automatically suggest
async function checkDependencies(key, value, config) {
  // Find groups that depend on this key-value pair
  const dependentGroups = [];
  
  for (const [groupName, groupInfo] of Object.entries(groups)) {
    if (groupInfo.dependencies) {
      const hasDependency = groupInfo.dependencies.some(dep => 
        dep.var === key && dep.value === value
      );
      
      if (hasDependency) {
        dependentGroups.push({ name: groupName, info: groupInfo });
      }
    }
  }
  
  // If found dependent groups, offer to configure them
  if (dependentGroups.length > 0) {
    console.log(`\n${colors.fg.yellow}Setting ${key}=${value} enables these additional configuration options:${colors.reset}`);
    
    for (let i = 0; i < dependentGroups.length; i++) {
      console.log(`${i+1}. ${dependentGroups[i].name} - ${dependentGroups[i].info.description}`);
    }
    
    const configDeps = await prompt("Would you like to configure these now? (y/n)", "y");
    
    if (configDeps.toLowerCase() === 'y') {
      for (const depGroup of dependentGroups) {
        await configureGroup(depGroup.name, depGroup.info, config);
      }
    }
  }
}

// Disable a group of settings
async function disableGroup(groupName, groupInfo, config) {
  console.log(`\n${colors.fg.yellow}Disabling ${groupName}...${colors.reset}`);
  
  // Check if any of these keys are part of the mandatory config
  const mandatoryKeys = groupInfo.variables.filter(key => mandatoryConfig[key] !== undefined);
  if (mandatoryKeys.length > 0) {
    console.log(`${colors.fg.red}Warning: The following keys are mandatory and cannot be removed:${colors.reset}`);
    mandatoryKeys.forEach(key => console.log(`  - ${key}`));
    
    // Only remove non-mandatory keys
    groupInfo.variables.forEach((key) => {
      if (!mandatoryConfig[key]) {
        delete config[key];
      }
    });
  } else {
    // Remove all keys in this group
    groupInfo.variables.forEach((key) => delete config[key]);
  }
  
  console.log(`${colors.fg.green}${groupName} settings have been disabled.${colors.reset}`);
}

// Display a spinner during operations
function showSpinner(message) {
  const spinnerChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  process.stdout.write(`${colors.fg.cyan}${message}${colors.reset} `);
  
  return setInterval(() => {
    process.stdout.write(`\r${colors.fg.cyan}${message}${colors.reset} ${spinnerChars[i]} `);
    i = (i + 1) % spinnerChars.length;
  }, 80);
}

// Toggle between basic and expert mode
function toggleInstallerMode() {
  installerMode = installerMode === INSTALLER_MODES.BASIC ? 
                  INSTALLER_MODES.EXPERT : 
                  INSTALLER_MODES.BASIC;
                  
  console.log(`\n${colors.fg.green}Switched to ${colors.bright}${installerMode.toUpperCase()}${colors.reset}${colors.fg.green} mode.${colors.reset}`);
}

// Main configuration function
async function configure() {
  const envPath = path.join(process.cwd(), ".env");
  let currentConfig = {};
  
  // Check for existing configuration
  if (fs.existsSync(envPath)) {
    currentConfig = dotenv.parse(fs.readFileSync(envPath));
    console.log(`${colors.fg.green}Existing configuration found.${colors.reset}`);
  } else {
    // Include mandatory config items by default
    currentConfig = { ...mandatoryConfig };
    console.log(`${colors.fg.yellow}No existing configuration found. Using defaults for essential settings.${colors.reset}`);
    
    // Set up initial database configuration
    console.log(`${colors.bright}${colors.fg.magenta}Initial Setup Required${colors.reset}`);
    
    // Choose installer mode first
    const modeChoice = await prompt(`Choose installer mode (${colors.bright}basic${colors.reset} for essential settings, ${colors.bright}expert${colors.reset} for all settings)`, INSTALLER_MODES.BASIC);
    installerMode = modeChoice.toLowerCase() === INSTALLER_MODES.EXPERT ? INSTALLER_MODES.EXPERT : INSTALLER_MODES.BASIC;
    
    // Configure database type
    const dbTypeOptions = "mysql, postgres, mongodb";
    const dbType = await prompt(`Select database type (${dbTypeOptions})`, "mysql");
    currentConfig.DEFAULT_DBTYPE = dbType;
    
    // Configure database connection based on selected type
    let dbGroup;
    if (dbType === "mysql") {
      dbGroup = "DATABASE: MySQL";
    } else if (dbType === "postgres") {
      dbGroup = "DATABASE: PostgreSQL";
    } else if (dbType === "mongodb") {
      dbGroup = "DATABASE: MongoDB";
    }
    
    if (dbGroup) {
      await configureGroup(dbGroup, groups[dbGroup], currentConfig);
    }
  }

  // Copy plugin and config directories
  try {
    const spinner = showSpinner("Setting up directories...");
    
    console.log(`\n${colors.fg.blue}Copying plugin directory from ${pluginDir} to ${userDir}${colors.reset}`);
    copyDir(pluginDir, userDir);
    
    console.log(`${colors.fg.blue}Copying config directory from ${configDir} to ${userConfig}${colors.reset}`);
    copyDir(configDir, userConfig);
    
    clearInterval(spinner);
    process.stdout.write(`\r${colors.fg.green}Directories setup complete!${colors.reset}` + " ".repeat(20) + "\n");
  } catch (err) {
    console.error(`${colors.fg.red}Error copying directories:${colors.reset}`, err.message);
  }
  
  // Main configuration loop
  while (true) {
    printMenu(groups, currentConfig);
    const choice = await prompt("Select an option (number, S to save, Q to quit, M to change mode)", "");
    
    if (choice.toLowerCase() === 's') {
      console.log(`${colors.fg.green}Saving configuration and exiting...${colors.reset}`);
      break;
    } else if (choice.toLowerCase() === 'q') {
      console.log(`${colors.fg.yellow}Exiting without saving...${colors.reset}`);
      return;
    } else if (choice.toLowerCase() === 'm') {
      toggleInstallerMode();
      continue;
    }
    
    const filteredGroups = Object.keys(groups).filter(groupName => {
      // Filter based on mode
      if (groups[groupName].mode !== installerMode && !groups[groupName].always) {
        return false;
      }
      
      // Filter based on dependencies
      if (groups[groupName].dependencies) {
        const shouldShow = groups[groupName].dependencies.some(dep => {
          return currentConfig[dep.var] === dep.value;
        });
        
        if (!shouldShow && !groups[groupName].always) {
          return false;
        }
      }
      
      return true;
    });
    
    const optionIndex = parseInt(choice, 10) - 1;
    const selectedGroup = filteredGroups[optionIndex];
    
    if (selectedGroup) {
      const actionPrompt = `Do you want to ${colors.fg.green}(E)nable/Configure${colors.reset} or ${colors.fg.red}(D)isable${colors.reset} ${selectedGroup}?`;
      const action = await prompt(actionPrompt, "E");
      
      if (action.toLowerCase() === 'e') {
        await configureGroup(selectedGroup, groups[selectedGroup], currentConfig);
      } else if (action.toLowerCase() === 'd') {
        await disableGroup(selectedGroup, groups[selectedGroup], currentConfig);
      } else {
        console.log(`${colors.fg.yellow}Invalid action. Please try again.${colors.reset}`);
      }
    } else {
      console.log(`${colors.fg.red}Invalid selection. Please try again.${colors.reset}`);
    }
  }

  // Ensure all mandatory config is included
  for (const [key, value] of Object.entries(mandatoryConfig)) {
    if (currentConfig[key] === undefined) {
      currentConfig[key] = value;
    }
  }

  // Check if module toggles were configured and suggest related settings
  const enabledModules = Object.entries(currentConfig)
    .filter(([key, value]) => key.startsWith('MOD_') && value === 'true')
    .map(([key]) => key);
  
  if (enabledModules.length > 0) {
    console.log(`\n${colors.fg.yellow}You've enabled these modules:${colors.reset}`);
    enabledModules.forEach((module, index) => {
      console.log(`${index + 1}. ${module}`);
    });
    
    // Find relevant configuration groups for these modules
    const relevantGroups = [];
    
    for (const [groupName, groupInfo] of Object.entries(groups)) {
      if (groupInfo.dependencies) {
        const hasDependency = groupInfo.dependencies.some(dep => 
          enabledModules.includes(dep.var) && currentConfig[dep.var] === dep.value
        );
        
        if (hasDependency) {
          relevantGroups.push({ name: groupName, info: groupInfo });
        }
      }
    }
    
    if (relevantGroups.length > 0) {
      console.log(`\n${colors.fg.yellow}You may want to configure these related settings:${colors.reset}`);
      relevantGroups.forEach(({ name, info }, index) => {
        console.log(`${index + 1}. ${name} - ${info.description}`);
      });
      
      const configureRelated = await prompt("Would you like to configure these related settings now? (y/n)", "y");
      
      if (configureRelated.toLowerCase() === 'y') {
        for (const { name, info } of relevantGroups) {
          await configureGroup(name, info, currentConfig);
        }
      }
    }
  }

  // Generate the .env file content
  const envContent = Object.entries(currentConfig)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  fs.writeFileSync(envPath, envContent);
  console.log(`${colors.fg.green}${colors.bright}Configuration saved to ${envPath}${colors.reset}`);
  
  // Show a summary of enabled features
  console.log(`\n${colors.fg.magenta}${colors.bright}Configuration Summary:${colors.reset}`);
  
  const enabledGroups = Object.entries(groups)
    .filter(([_, groupInfo]) => 
      groupInfo.variables.some(key => currentConfig[key] !== undefined)
    )
    .map(([groupName]) => groupName);
  
  enabledGroups.forEach(group => {
    console.log(`${colors.fg.green}✓ ${group}${colors.reset}`);
  });
  
  console.log(`\n${colors.fg.cyan}Enabled Modules:${colors.reset}`);
  const moduleToggles = Object.entries(currentConfig)
    .filter(([key, value]) => (key.startsWith('MOD_') || key.startsWith('ENABLE_')) && value === 'true')
    .map(([key]) => key);
  
  if (moduleToggles.length > 0) {
    moduleToggles.forEach(module => {
      console.log(`${colors.fg.green}✓ ${module}${colors.reset}`);
    });
  } else {
    console.log(`${colors.fg.yellow}No modules enabled${colors.reset}`);
  }
}

// Display welcome banner
function showWelcomeBanner() {
  console.clear();
  console.log(`
${colors.bright}${colors.fg.cyan}┌───────────────────────────────────────────────┐
│                                               │
│         APPLICATION SETUP WIZARD              │
│                                               │
└───────────────────────────────────────────────┘${colors.reset}

This wizard will help you configure your application.
Only enabled features will be saved to your .env file.

${colors.bright}${colors.fg.yellow}Two Installation Modes:${colors.reset}
- ${colors.bright}BASIC${colors.reset}: Shows only essential settings
- ${colors.bright}EXPERT${colors.reset}: Shows all available configuration options

You can toggle between modes during setup by pressing ${colors.bright}'M'${colors.reset}
`);
}

// Start the configuration process
showWelcomeBanner();
configure().catch((err) => {
  console.error(`${colors.fg.red}Error during configuration:${colors.reset}`, err);
});