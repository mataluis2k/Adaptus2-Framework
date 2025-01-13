const fs = require('fs');
const path = require('path');
const readline = require('readline');
const dotenv = require('dotenv');

// Define default values
const defaultConfig = {
  ENABLE_LOGGING: 'true',
  CONFIG_DIR: './config',
  CORS_ENABLED: 'false',
  CORS_ORIGIN: 'http://localhost:5173',
  CORS_METHODS: 'GET,POST,PUT,DELETE',
  MYSQL_1_HOST: 'localhost',
  MYSQL_1_USER: 'root',
  MYSQL_1_PASSWORD: '',
  MYSQL_1_DB: 'test',
  JWT_SECRET: 'your_jwt_secret',
  PORT: 3000,
  JWT_EXPIRY: '30d',
  GRAPHQL_DBTYPE: 'mysql',
  GRAPHQL_DBCONNECTION: 'MYSQL_1',
  VECTOR_DB: 'milvus',
  MILVUS_HOST: 'localhost',
  MILVUS_PORT: 19530,
  STREAMING_FILESYSTEM_PATH: './videos',
  OPENAI_API_KEY: '',
  QDRANT_URL: 'http://localhost:6333',
  PAYMENT_MODULE: 'false',
  REDIS_URL: 'localhost',
  REDIS_PORT: 6379
};

// Helper to prompt user input
function prompt(question, defaultValue) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) =>
    rl.question(
      `${question} [current: ${defaultValue}]: `,
      (answer) => {
        rl.close();
        resolve(answer || defaultValue);
      }
    )
  );
}

// Load existing .env configuration
function loadEnvFile(envPath) {
  if (fs.existsSync(envPath)) {
    console.log(`Loading existing .env file from ${envPath}...`);
    const envData = fs.readFileSync(envPath, 'utf-8');
    return dotenv.parse(envData); // Parse .env into key-value object
  }
  console.log(`No existing .env file found at ${envPath}. Using defaults.`);
  return {};
}

// Write configuration to .env file
function writeEnvFile(envPath, config) {
  const envContent = Object.entries(config)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  fs.writeFileSync(envPath, envContent);
  console.log(`.env file updated at ${envPath}`);
}

// Main installer function
async function createEnvFile() {
  const envPath = path.join(process.cwd(), '.env');
  const existingConfig = loadEnvFile(envPath);

  const finalConfig = { ...defaultConfig, ...existingConfig };

  console.log('Starting configuration update...');
  for (const key of Object.keys(defaultConfig)) {
    finalConfig[key] = await prompt(
      `Set value for ${key}`,
      finalConfig[key]
    );
  }

  // Prompt for optional modules
  const configureRedis = await prompt('Configure Redis? (yes/no)', 'yes');
  if (configureRedis.toLowerCase() === 'yes') {
    finalConfig.REDIS_URL = await prompt('Redis URL', finalConfig.REDIS_URL);
    finalConfig.REDIS_PORT = await prompt('Redis Port', finalConfig.REDIS_PORT);
  }

  const configurePostgres = await prompt('Configure PostgreSQL? (yes/no)', 'no');
  if (configurePostgres.toLowerCase() === 'yes') {
    finalConfig.POSTGRES_1_HOST = await prompt('PostgreSQL Host', 'localhost');
    finalConfig.POSTGRES_1_USER = await prompt('PostgreSQL User', 'postgres');
    finalConfig.POSTGRES_1_PASSWORD = await prompt('PostgreSQL Password', '');
    finalConfig.POSTGRES_1_DB = await prompt('PostgreSQL Database Name', 'test');
  }

  const configureMongoDB = await prompt('Configure MongoDB? (yes/no)', 'no');
  if (configureMongoDB.toLowerCase() === 'yes') {
    finalConfig.MONGODB_1_URI = await prompt('MongoDB URI', 'mongodb://localhost:27017');
    finalConfig.MONGODB_1_DB = await prompt('MongoDB Database Name', 'test');
  }

  const enablePaymentModule = await prompt('Enable Payment Module? (yes/no)', 'no');
  if (enablePaymentModule.toLowerCase() === 'yes') {
    finalConfig.PAYMENT_MODULE = 'true';
    finalConfig.STRIPE_SECRET_KEY = await prompt('Stripe Secret Key', '');
    finalConfig.BRAINTREE_ENV = await prompt('Braintree Environment (sandbox/production)', 'sandbox');
    finalConfig.BRAINTREE_MERCHANT_ID = await prompt('Braintree Merchant ID', '');
    finalConfig.BRAINTREE_PUBLIC_KEY = await prompt('Braintree Public Key', '');
    finalConfig.BRAINTREE_PRIVATE_KEY = await prompt('Braintree Private Key', '');
  }

  const enableMLConfig = await prompt('Enable Machine Learning Features? (yes/no)', 'no');
  if (enableMLConfig.toLowerCase() === 'yes') {
    finalConfig.OPENAI_API_KEY = await prompt('OpenAI API Key', finalConfig.OPENAI_API_KEY);
    finalConfig.QDRANT_URL = await prompt('Qdrant URL', finalConfig.QDRANT_URL);
  }

  // Write updated configuration
  writeEnvFile(envPath, finalConfig);
}

// Run the installer
createEnvFile().catch((err) => {
  console.error('Error during installation:', err);
});
