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
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  });
}

// Groups of configuration options
const groups = {
  "GENERAL SETTINGS": [
    "ENABLE_LOGGING",
    "CONFIG_DIR",
    "CORS_ENABLED",
    "CORS_ORIGIN",
    "CORS_METHODS",
    "DEFAULT_DBTYPE",
    "DEFAULT_DBCONNECTION"
  ],
  "SERVER CONFIGURATION": [
    "PORT",
    "SOCKET_CLI",
    "SOCKET_CLI_PORT",
    "CHAT_SERVER_PORT"
  ],
  "AUTHENTICATION": [
    "JWT_SECRET",
    "JWT_EXPIRY"
  ],
  "CLUSTER SETUP": [
    "PLUGIN_MANAGER",
    "CLUSTER_NAME",
    "SERVER_ID",
    "SERVER_ROLE"
  ],
  "DATABASE: MySQL": [
    "MYSQL_1_HOST", 
    "MYSQL_1_USER", 
    "MYSQL_1_PASSWORD", 
    "MYSQL_1_DB"
  ],
  "DATABASE: PostgreSQL": [
    "POSTGRES_1_HOST", 
    "POSTGRES_1_USER", 
    "POSTGRES_1_PASSWORD", 
    "POSTGRES_1_DB"
  ],
  "DATABASE: MongoDB": [
    "MONGODB_1_URI", 
    "MONGODB_1_DB"
  ],
  "GRAPHQL": [
    "GRAPHQL_DBTYPE",
    "GRAPHQL_DBCONNECTION"
  ],
  "LLM INTEGRATION": [
    "LLM_TYPE",
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "CLAUDE_API_KEY",
    "CLAUDE_MODEL",
    "OPENROUTER_API_KEY"
  ],
  "RAG CONFIGURATION": [
    "QDRANT_URL"
  ],
  "OAUTH": [
    "OAUTH_CLIENT_ID",
    "OAUTH_CLIENT_SECRET",
    "OAUTH_AUTH_URL",
    "OAUTH_TOKEN_URL",
    "OAUTH_CALLBACK_URL",
    "TOKEN_DURATION"
  ],
  "VECTOR DATABASE": [
    "VECTOR_DB",
    "MILVUS_HOST",
    "MILVUS_PORT",
    "ELASTICSEARCH_HOST",
    "ELASTICSEARCH_INDEX"
  ],
  "CLOUD STORAGE": [
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_REGION",
    "STREAMING_FILESYSTEM_PATH"
  ],
  "EMAIL SERVICES": [
    "SENDGRID_API_KEY",
    "MAILCHIMP_API_KEY",
    "MAILGUN_BASE_URL",
    "MAILGUN_API_KEY",
    "MAILGUN_DOMAIN"
  ],
  "PAYMENT PROCESSING": [
    "PAYMENT_MODULE",
    "STRIPE_SECRET_KEY",
    "BRAINTREE_ENV",
    "BRAINTREE_MERCHANT_ID",
    "BRAINTREE_PUBLIC_KEY",
    "BRAINTREE_PRIVATE_KEY"
  ],
  "INTEGRATIONS": [
    "GOOGLE_APPLICATION_CREDENTIALS",
    "SALESFORCE_BASE_URL",
    "SALESFORCE_API_TOKEN",
    "FACEBOOK_API_BASE_URL",
    "FACEBOOK_ACCESS_TOKEN",
    "FACEBOOK_PIXEL_ID",
    "GA4_API_BASE_URL",
    "GA4_MEASUREMENT_ID",
    "GA4_API_SECRET"
  ]
};

// Essential configuration that will always be included
const mandatoryConfig = {
  // General settings (always required)
  ENABLE_LOGGING: "TRUE",
  CONFIG_DIR: "./config",
  DEFAULT_DBTYPE: "mysql",
  DEFAULT_DBCONNECTION: "MYSQL_1",
  
  // Authentication (always required)
  JWT_SECRET: generateRandomSecret(32),
  JWT_EXPIRY: "30d",
  
  // Server settings (always required)
  PORT: 3000,
  
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
  
  // Server configuration
  SOCKET_CLI: "FALSE",
  SOCKET_CLI_PORT: 5000,
  CHAT_SERVER_PORT: 3007,
  
  // Cluster setup
  CLUSTER_NAME: "default",
  SERVER_ID: "server1",
  
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
  
  // RAG Configuration
  QDRANT_URL: "http://localhost:6333",
  
  // Vector Database
  VECTOR_DB: "milvus",
  MILVUS_HOST: "localhost",
  MILVUS_PORT: 19530,
  ELASTICSEARCH_HOST: "http://localhost:9200",
  ELASTICSEARCH_INDEX: "default",
  
  // Storage
  STREAMING_FILESYSTEM_PATH: "./videos",
  
  // OAuth
  TOKEN_DURATION: "1d",
  
  // Payments
  PAYMENT_MODULE: "FALSE",
  BRAINTREE_ENV: "sandbox",
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
  
  const groupsArray = Object.keys(groups);
  const columnWidth = 40;
  const columns = 2;
  
  // Print in multiple columns if there are enough items
  for (let i = 0; i < Math.ceil(groupsArray.length / columns); i++) {
    let line = "";
    
    for (let j = 0; j < columns; j++) {
      const index = i + j * Math.ceil(groupsArray.length / columns);
      if (index < groupsArray.length) {
        const groupName = groupsArray[index];
        const displayNumber = (index + 1).toString().padStart(2, ' ');
        const groupConfigured = groups[groupName].some((key) => currentConfig[key] !== undefined);
        
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
}

// Configure a group of settings
async function configureGroup(groupName, keys, config) {
  console.log(`\n${colors.bright}${colors.fg.magenta}┌─ Configuring ${groupName} ───${"─".repeat(40-groupName.length)}┐${colors.reset}`);
  
  for (const key of keys) {
    // Get current or default value
    const currentValue = config[key] !== undefined ? config[key] : 
                         fullConfig[key] !== undefined ? fullConfig[key] : "";
    
    config[key] = await prompt(`${key}`, currentValue);
    
    // Special handling for CONFIG_DIR
    if (key === "CONFIG_DIR" && config[key]) {
      verifyAndCreateConfigDir(config[key]);
    }
  }
  
  console.log(`${colors.fg.green}Configuration for ${groupName} completed.${colors.reset}`);
}

// Disable a group of settings
async function disableGroup(groupName, keys, config) {
  console.log(`\n${colors.fg.yellow}Disabling ${groupName}...${colors.reset}`);
  
  // Check if any of these keys are part of the mandatory config
  const mandatoryKeys = keys.filter(key => mandatoryConfig[key] !== undefined);
  if (mandatoryKeys.length > 0) {
    console.log(`${colors.fg.red}Warning: The following keys are mandatory and cannot be removed:${colors.reset}`);
    mandatoryKeys.forEach(key => console.log(`  - ${key}`));
    
    // Only remove non-mandatory keys
    keys.forEach((key) => {
      if (!mandatoryConfig[key]) {
        delete config[key];
      }
    });
  } else {
    // Remove all keys in this group
    keys.forEach((key) => delete config[key]);
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
    await configureGroup("DATABASE: MySQL", groups["DATABASE: MySQL"], currentConfig);
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
    const choice = await prompt("Select an option (number, S to save, Q to quit)", "");
    
    if (choice.toLowerCase() === 's') {
      console.log(`${colors.fg.green}Saving configuration and exiting...${colors.reset}`);
      break;
    } else if (choice.toLowerCase() === 'q') {
      console.log(`${colors.fg.yellow}Exiting without saving...${colors.reset}`);
      return;
    }
    
    const optionIndex = parseInt(choice, 10) - 1;
    const selectedGroup = Object.keys(groups)[optionIndex];
    
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

  // Generate the .env file content
  const envContent = Object.entries(currentConfig)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  fs.writeFileSync(envPath, envContent);
  console.log(`${colors.fg.green}${colors.bright}Configuration saved to ${envPath}${colors.reset}`);
  
  // Show a summary of enabled features
  console.log(`\n${colors.fg.magenta}${colors.bright}Configuration Summary:${colors.reset}`);
  const enabledGroups = Object.keys(groups).filter(group => 
    groups[group].some(key => currentConfig[key] !== undefined)
  );
  
  enabledGroups.forEach(group => {
    console.log(`${colors.fg.green}✓ ${group}${colors.reset}`);
  });
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
`);
}

// Start the configuration process
showWelcomeBanner();
configure().catch((err) => {
  console.error(`${colors.fg.red}Error during configuration:${colors.reset}`, err);
});