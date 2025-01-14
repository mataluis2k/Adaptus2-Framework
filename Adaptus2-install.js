#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const dotenv = require('dotenv');

const defaultConfig = {
  ENABLE_LOGGING: 'true',
  CONFIG_DIR: './config',
  CORS_ENABLED: 'false',
  CORS_ORIGIN: 'http://localhost:5173',
  CORS_METHODS: 'GET,POST,PUT,DELETE',
  DEFAULT_DBTYPE: 'mysql',
  DEFAULT_DBCONNECTION: 'MYSQL_1',
  MYSQL_1_HOST: 'localhost',
  MYSQL_1_USER: 'root',
  MYSQL_1_PASSWORD: '',
  MYSQL_1_DB: 'test',
  POSTGRES_1_HOST: 'localhost',
  POSTGRES_1_USER: 'postgres',
  POSTGRES_1_PASSWORD: '',
  POSTGRES_1_DB: 'mydatabase',
  MONGODB_1_URI: 'mongodb://localhost:27017',
  MONGODB_1_DB: 'mydatabase',
  JWT_SECRET: 'your_jwt_secret',
  JWT_EXPIRY: '30d',
  PORT: 3000,
  CHAT_SERVER_PORT: 3007,
  SOCKET_CLI_PORT: 5000,
  VECTOR_DB: 'milvus',
  MILVUS_HOST: 'localhost',
  MILVUS_PORT: 19530,
  PAYMENT_MODULE: 'false',
  STRIPE_SECRET_KEY: '',
  BRAINTREE_ENV: 'sandbox',
  BRAINTREE_MERCHANT_ID: '',
  BRAINTREE_PUBLIC_KEY: '',
  BRAINTREE_PRIVATE_KEY: '',
  AWS_ACCESS_KEY_ID: '',
  AWS_SECRET_ACCESS_KEY: '',
  AWS_REGION: 'us-east-1',
  SENDGRID_API_KEY: '',
  MAILGUN_BASE_URL: 'https://api.mailgun.net/v3',
  MAILGUN_API_KEY: '',
  MAILGUN_DOMAIN: '',
  OPENAI_API_KEY: '',
  QDRANT_URL: 'http://localhost:6333',
  PLUGIN_MANAGER: 'local',
  CLUSTER_NAME: 'default',
  SERVER_ID: 'Server1',
  SERVER_ROLE: 'MASTER',
};

function prompt(question, defaultValue) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) =>
    rl.question(`${question} [current: ${defaultValue}]: `, (answer) => {
      rl.close();
      resolve(answer || defaultValue);
    })
  );
}

function verifyAndCreateConfigDir(configDir) {
  if (!fs.existsSync(configDir)) {
    console.log(`Config directory does not exist. Creating: ${configDir}`);
    fs.mkdirSync(configDir, { recursive: true });
  }

  const businessRulesPath = path.join(configDir, 'businessRules.dsl');
  if (!fs.existsSync(businessRulesPath)) {
    console.log(`Creating empty file: ${businessRulesPath}`);
    fs.writeFileSync(businessRulesPath, '');
  }

  const mlConfigPath = path.join(configDir, 'mlConfig.json');
  if (!fs.existsSync(mlConfigPath)) {
    console.log(`Creating default ML config file: ${mlConfigPath}`);
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

function loadEnvFile(envPath) {
  if (fs.existsSync(envPath)) {
    console.log(`Loading existing .env file from ${envPath}...`);
    return dotenv.parse(fs.readFileSync(envPath, 'utf-8'));
  }
  console.log(`No existing .env file found at ${envPath}. Using defaults.`);
  return {};
}

function writeEnvFile(envPath, config) {
  const envContent = Object.entries(config)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  fs.writeFileSync(envPath, envContent);
  console.log(`.env file updated at ${envPath}`);
}

async function createEnvFile() {
  const envPath = path.join(process.cwd(), '.env');
  const existingConfig = loadEnvFile(envPath);
  const finalConfig = { ...defaultConfig, ...existingConfig };

  console.log('Starting configuration update...');
  for (const key of Object.keys(defaultConfig)) {
    finalConfig[key] = await prompt(`Set value for ${key}`, finalConfig[key]);

    if (key === 'CONFIG_DIR') {
      verifyAndCreateConfigDir(finalConfig[key]);
    }
  }

  writeEnvFile(envPath, finalConfig);
}

createEnvFile().catch((err) => {
  console.error('Error during installation:', err);
});
