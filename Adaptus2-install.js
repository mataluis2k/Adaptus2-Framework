#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const dotenv = require('dotenv');

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
  CORS_ORIGIN: "http://localhost:5173",
  CORS_METHODS: "GET,POST,PUT,DELETE",
  DEFAULT_DBTYPE: "mysql",
  DEFAULT_DBCONNECTION: "MYSQL_1",
  PAYMENT_MODULE: "FALSE",
  MYSQL_1_HOST: "localhost",
  MYSQL_1_USER: "myUser99",
  MYSQL_1_PASSWORD: "localtest22_!",
  MYSQL_1_DB: "openGraphDemo",
  SOCKET_CLI: "TRUE",
  SOCKET_CLI_PORT: 5000,
  POSTGRES_1_HOST: "localhost",
  POSTGRES_1_USER: "postgres",
  POSTGRES_1_PASSWORD: "password",
  POSTGRES_1_DB: "mydatabase",
  MONGODB_1_URI: "mongodb://localhost:27017",
  MONGODB_1_DB: "mydatabase",
  JWT_SECRET: "P0W3rS3cr3t",
  JWT_EXPIRY: "365d",
  PORT: 3000,
  CHAT_SERVER_PORT: 3007,
  OPENAI_API_KEY: "your-openai-api-key",
  QDRANT_URL: "http://localhost:6333",
  SENDGRID_API_KEY: "your-sendgrid-api-key",
  MAILCHIMP_API_KEY: "your-mailchimp-api-key",
  MAILGUN_BASE_URL: "https://api.mailgun.net/v3",
  MAILGUN_API_KEY: "your-mailgun-api-key",
  MAILGUN_DOMAIN: "your-mailgun-domain",
  STRIPE_SECRET_KEY: "your-stripe-secret-key",
  BRAINTREE_ENV: "sandbox",
  BRAINTREE_MERCHANT_ID: "your-braintree-merchant-id",
  BRAINTREE_PUBLIC_KEY: "your-braintree-public-key",
  BRAINTREE_PRIVATE_KEY: "your-braintree-private-key",
  AWS_ACCESS_KEY_ID: "your-aws-access-key-id",
  AWS_SECRET_ACCESS_KEY: "your-aws-secret-access-key",
  AWS_REGION: "us-east-1",
  STREAMING_FILESYSTEM_PATH: "./videos",
  STREAMING_DEFAULT_PROTOCOL: "hls",
  STREAMING_MAX_BANDWIDTH: 5000000,
  VECTOR_DB: "milvus",
  MILVUS_HOST: "localhost",
  MILVUS_PORT: 19530,
  ELASTICSEARCH_HOST: "http://localhost:9200",
  ELASTICSEARCH_INDEX: "your-index",
  SALESFORCE_BASE_URL: "https://your-salesforce-instance.salesforce.com",
  SALESFORCE_API_TOKEN: "your-salesforce-token",
  FACEBOOK_API_BASE_URL: "https://graph.facebook.com",
  FACEBOOK_ACCESS_TOKEN: "your-facebook-token",
  FACEBOOK_PIXEL_ID: "your-facebook-pixel",
  GA4_API_BASE_URL: "https://www.google-analytics.com",
  GA4_MEASUREMENT_ID: "your-ga4-id",
  GA4_API_SECRET: "your-ga4-secret",
  PLUGIN_MANAGER: "network",
  CLUSTER_NAME: "devops7",
  SERVER_ID: "Server1",
  SERVER_ROLE: "MASTER"
};

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

  const envContent = Object.entries(currentConfig)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  fs.writeFileSync(envPath, envContent);
  console.log(`Configuration saved to ${envPath}`);
}

configure().catch((err) => {
  console.error("Error during configuration:", err);
});
