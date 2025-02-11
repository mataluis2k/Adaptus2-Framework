#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const dotenv = require('dotenv');

// Parse command line arguments
const args = process.argv.slice(2);
const AUTO_MODE = args.includes('--auto') || args.includes('-a');

// Define paths
const pluginDir = path.join(__dirname, './plugins'); // Adjust relative to the script
const configDir = path.join(__dirname, './config'); // Adjust relative to the script
const userDir = path.join(process.cwd(), 'plugins');
const userConfig = path.join(process.cwd(), 'config');

// Function to copy directory
function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`Source directory does not exist: ${src}`);
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

// Perform the copy
try {
  console.log(`Copying plugin directory from ${pluginDir} to ${userDir}`);
  copyDir(pluginDir, userDir);
  console.log('Plugin directory copied successfully!');
  console.log(`Copying config directory from ${configDir} to ${userConfig}`);
  copyDir(configDir, userConfig);
  console.log('Config directory copied successfully!');
} catch (err) {
  console.error('Error copying plugin/config directory:', err.message);
}

const groups = {
  "GENERAL SETTINGS": [
    "ENABLE_LOGGING",
    "CONFIG_DIR",
    "CORS_ENABLED",
    "CORS_ORIGIN",
    "CORS_METHODS",
    "DEFAULT_DBTYPE",
    "DEFAULT_DBCONNECTION",
    "PAYMENT_MODULE"
  ],
  "LLM Configuration": [
    "LLM_TYPE",
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "CLAUDE_API_KEY",
    "CLAUDE_MODEL",
    "OPENROUTER_API_KEY"
  ],
  "OAuth Configuration": [
    "OAUTH_CLIENT_ID",
    "OAUTH_CLIENT_SECRET",
    "OAUTH_AUTH_URL",
    "OAUTH_TOKEN_URL",
    "OAUTH_CALLBACK_URL",
    "TOKEN_DURATION"
  ],
  "GraphQL Configuration": [
    "GRAPHQL_DBTYPE",
    "GRAPHQL_DBCONNECTION"
  ],
  "Firebase Configuration": [
    "GOOGLE_APPLICATION_CREDENTIALS"
  ],
  "MySQL": ["MYSQL_1_HOST", "MYSQL_1_USER", "MYSQL_1_PASSWORD", "MYSQL_1_DB"],
  "Command Line Interface": ["SOCKET_CLI", "SOCKET_CLI_PORT"],
  "PostgreSQL": ["POSTGRES_1_HOST", "POSTGRES_1_USER", "POSTGRES_1_PASSWORD", "POSTGRES_1_DB"],
  "MongoDB": ["MONGODB_1_URI", "MONGODB_1_DB"],
  "JWT and Authorization": ["JWT_SECRET", "JWT_EXPIRY"],
  "CHAT Server Configuration": ["PORT", "CHAT_SERVER_PORT"],
  "RAG CONFIG": ["OPENAI_API_KEY", "QDRANT_URL"],
  "EMAIL MARKETING": [
    "SENDGRID_API_KEY",
    "MAILCHIMP_API_KEY",
    "MAILGUN_BASE_URL",
    "MAILGUN_API_KEY",
    "MAILGUN_DOMAIN"
  ],
  "Payment Gateway Stripe": ["STRIPE_SECRET_KEY"],
  "Payment Gateway Braintree": [
    "BRAINTREE_ENV",
    "BRAINTREE_MERCHANT_ID",
    "BRAINTREE_PUBLIC_KEY",
    "BRAINTREE_PRIVATE_KEY"
  ],
  "AWS S3 Configuration": [
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_REGION"
  ],
  "Local Filesystem Configuration": ["STREAMING_FILESYSTEM_PATH"],
  "Streaming Configuration": [
    "STREAMING_DEFAULT_PROTOCOL",
    "STREAMING_MAX_BANDWIDTH"
  ],
  "Vector Database Configuration": [
    "VECTOR_DB",
    "MILVUS_HOST",
    "MILVUS_PORT"
  ],
  "Elasticsearch Configuration": [
    "ELASTICSEARCH_HOST",
    "ELASTICSEARCH_INDEX"
  ],
  "Salesforce Configuration": [
    "SALESFORCE_BASE_URL",
    "SALESFORCE_API_TOKEN"
  ],
  "S2S Pixel Configuration": [
    "FACEBOOK_API_BASE_URL",
    "FACEBOOK_ACCESS_TOKEN",
    "FACEBOOK_PIXEL_ID",
    "GA4_API_BASE_URL",
    "GA4_MEASUREMENT_ID",
    "GA4_API_SECRET"
  ],
  "Clustering Setup": [
    "PLUGIN_MANAGER",
    "CLUSTER_NAME",
    "SERVER_ID",
    "SERVER_ROLE"
  ]
};

const defaultConfig = {
  ENABLE_LOGGING: "TRUE",
  CONFIG_DIR: "./config",
  CORS_ENABLED: "false",
  CORS_ORIGIN: "*",
  CORS_METHODS: "GET,POST,PUT,DELETE",
  DEFAULT_DBTYPE: "mysql",
  DEFAULT_DBCONNECTION: "MYSQL_1",
  PAYMENT_MODULE: "FALSE",
  // LLM Configuration
  LLM_TYPE: "ollama",
  OPENAI_MODEL: "gpt-3.5-turbo",
  CLAUDE_MODEL: "claude-2",
  OPENAI_API_KEY: "your-openai-api-key",
  CLAUDE_API_KEY: "your-claude-api-key",
  OPENROUTER_API_KEY: "your-openrouter-api-key",
  // OAuth Configuration
  OAUTH_CLIENT_ID: "your-client-id",
  OAUTH_CLIENT_SECRET: "your-client-secret",
  OAUTH_AUTH_URL: "https://provider.com/oauth/authorize",
  OAUTH_TOKEN_URL: "https://provider.com/oauth/token",
  OAUTH_CALLBACK_URL: "http://localhost:3000/auth/callback",
  TOKEN_DURATION: "1d",
  // GraphQL Configuration
  GRAPHQL_DBTYPE: "mysql",
  GRAPHQL_DBCONNECTION: "MYSQL_1",
  MYSQL_1_HOST: "mariadb",
  MYSQL_1_USER: "root",
  MYSQL_1_PASSWORD: "root",
  MYSQL_1_DB: "adaptus2_db",
  SOCKET_CLI: "TRUE",
  SOCKET_CLI_PORT: 5000,
  
  JWT_SECRET: "your-jwt-secret",
  JWT_EXPIRY: "365d",
  PORT: 3000,
  CHAT_SERVER_PORT: 3007,
  REDIS_URL: "redis://redis:6380",
  
  STREAMING_FILESYSTEM_PATH: "./videos",
  STREAMING_DEFAULT_PROTOCOL: "hls",
  STREAMING_MAX_BANDWIDTH: 5000000,
  VECTOR_DB: "milvus",
  PLUGIN_MANAGER: "network",
  CLUSTER_NAME: "devops7",
  SERVER_ID: "Server1",
  SERVER_ROLE: "MASTER"
};


function verifyAndCreateConfigDir(configDir) {
  if (!fs.existsSync(configDir)) {
    console.log("Config directory does not exist. Creating: ${configDir}");
    fs.mkdirSync(configDir, { recursive: true });
  }

  const businessRulesPath = path.join(configDir, 'businessRules.dsl');
  if (!fs.existsSync(businessRulesPath)) {
    console.log("Creating empty file: ${businessRulesPath}");
    fs.writeFileSync(businessRulesPath, '');
  }

  const mlConfigPath = path.join(configDir, 'mlConfig.json');
  if (!fs.existsSync(mlConfigPath)) {
    console.log("Creating default ML config file: ${mlConfigPath}");
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

function prompt(question, defaultValue = "") {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) =>
    rl.question(`${question} [default: ${defaultValue}]: `, (answer) => {
      rl.close();
      resolve(answer || defaultValue);
    })
  );
}

function printMenu(groups, currentConfig) {
  console.log("\nAvailable Options:");
  const entries = Object.keys(groups);
  for (let i = 0; i < entries.length; i++) {
    const groupConfigured = groups[entries[i]].some((key) => key in currentConfig);
    console.log(`${i + 1}. ${entries[i]}${groupConfigured ? " \u2713" : ""}`);
  }
  console.log(`${entries.length + 1}. Save and Exit`);
}

async function configureGroup(groupName, keys, config) {
  console.log(`\nConfiguring ${groupName}...`);
  for (const key of keys) {
    const currentValue = config[key] || "";
    config[key] = await prompt(`Set value for ${key}`, currentValue);
    if (key === "CONFIG_DIR") {
      verifyAndCreateConfigDir(config[key]);
    }
  }
}

async function disableGroup(groupName, keys, config) {
  console.log(`\nDisabling ${groupName}...`);
  keys.forEach((key) => delete config[key]);
}

async function configure() {
  const envPath = path.join(process.cwd(), ".env");
  let currentConfig = fs.existsSync(envPath)
    ? dotenv.parse(fs.readFileSync(envPath))
    : { ...defaultConfig };

  if (AUTO_MODE) {
    console.log("Running in automated mode - using default configuration...");
    currentConfig = { ...defaultConfig };
    
    // Ensure config directory exists
    if (currentConfig.CONFIG_DIR) {
      verifyAndCreateConfigDir(currentConfig.CONFIG_DIR);
    }
  } else {
    if (!fs.existsSync(envPath)) {
      console.log("No existing configuration found. Configuring General Settings first...");
      await configureGroup("GENERAL SETTINGS", groups["GENERAL SETTINGS"], currentConfig);
    }

    while (true) {
      printMenu(groups, currentConfig);
      const choice = await prompt("Select an option by number:", "1");
      const optionIndex = parseInt(choice, 10) - 1;

      if (optionIndex === Object.keys(groups).length) {
        console.log("Saving configuration and exiting...");
        break;
      }

      const selectedGroup = Object.keys(groups)[optionIndex];
      if (selectedGroup) {
        const action = await prompt(
          `Do you want to (1) Configure or (2) Disable ${selectedGroup}?`,
          "1"
        );

        if (action === "1") {
          await configureGroup(selectedGroup, groups[selectedGroup], currentConfig);
        } else if (action === "2") {
          await disableGroup(selectedGroup, groups[selectedGroup], currentConfig);
        } else {
          console.log("Invalid action. Please try again.");
        }
      } else {
        console.log("Invalid selection. Please try again.");
      }
    }
  }

  const envContent = Object.entries(currentConfig)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  fs.writeFileSync(envPath, envContent);
  console.log(`Configuration saved to ${envPath}`);
}

configure().catch((err) => {
  console.error("Error during configuration:", err);
});
