const fs = require('fs');
const path = require('path');
const readline = require('readline');
const dotenv = require('dotenv');

// Define default values
const defaultConfig = {
  ENABLE_LOGGING: 'false',
  CONFIG_DIR: process.cwd() + '/config',
  CORS_ENABLED: 'false',
  CORS_ORIGIN: 'http://localhost:5173',
  CORS_METHODS: 'GET,POST,PUT,DELETE',
  JWT_SECRET: 'your_jwt_secret',
  PORT: 3000,
  JWT_EXPIRY: '1d',
  GRAPHQL_DBTYPE: 'mysql',
  GRAPHQL_DBCONNECTION: 'MYSQL_1',
  VECTOR_DB: 'milvus',
  MILVUS_HOST: 'localhost',
  MILVUS_PORT: 19530,
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

  // Handle additional configuration (RAG and DB)
  const useRag = await prompt(
    'Do you need RAG (Retrieval-Augmented Generation) features? (yes/no)',
    existingConfig.RAG || 'no'
  );
  if (useRag.toLowerCase() === 'yes') {
    finalConfig.OPENAI_API_KEY =
      (await prompt(
        'Enter your OpenAI API key (required for RAG)',
        existingConfig.OPENAI_API_KEY || ''
      )) || finalConfig.OPENAI_API_KEY;
  }

  const dbType = await prompt(
    'Database type (mysql/postgres/mongodb)',
    finalConfig.GRAPHQL_DBTYPE
  );
  const dbConnection = `${dbType.toUpperCase()}_1`;

  finalConfig.GRAPHQL_DBTYPE = dbType;
  finalConfig.GRAPHQL_DBCONNECTION = dbConnection;

  finalConfig[`${dbConnection}_HOST`] = await prompt(
    `${dbType.toUpperCase()} host`,
    existingConfig[`${dbConnection}_HOST`] || ''
  );
  finalConfig[`${dbConnection}_USER`] = await prompt(
    `${dbType.toUpperCase()} user`,
    existingConfig[`${dbConnection}_USER`] || ''
  );
  finalConfig[`${dbConnection}_PASSWORD`] = await prompt(
    `${dbType.toUpperCase()} password`,
    existingConfig[`${dbConnection}_PASSWORD`] || ''
  );
  finalConfig[`${dbConnection}_DB`] = await prompt(
    `${dbType.toUpperCase()} database name`,
    existingConfig[`${dbConnection}_DB`] || ''
  );

  // Write updated configuration
  writeEnvFile(envPath, finalConfig);
}

// Run the installer
createEnvFile().catch((err) => {
  console.error('Error during installation:', err);
});
