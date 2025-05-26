#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const os = require('os');
const { execSync } = require('child_process');

// ANSI color codes for styling (same as install script)
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

// Docker image options
const DOCKER_OPTIONS = {
  BASE_ONLY: '1',
  BASE_REDIS_DB: '2', 
  BASE_REDIS_DB_LLM: '3',
  BASE_LLM: '4'
};

// Database options
const DB_TYPES = {
  MYSQL: 'mysql',
  POSTGRES: 'postgres', 
  MONGODB: 'mongodb'
};

// LLM options
const LLM_TYPES = {
  OLLAMA: 'ollama',
  OPENAI: 'openai',
  CLAUDE: 'claude',
  OPENROUTER: 'openrouter'
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

// Display welcome banner
function showWelcomeBanner() {
  console.clear();
  console.log(`
${colors.bright}${colors.fg.cyan}┌───────────────────────────────────────────────┐
│                                               │
│         ADAPTUS2 DOCKER GENERATOR             │
│                                               │
└───────────────────────────────────────────────┘${colors.reset}

This wizard will help you create Docker configurations for Adaptus2.
Choose from different deployment options based on your needs.

${colors.bright}${colors.fg.yellow}Available Options:${colors.reset}
1. ${colors.bright}Base Image${colors.reset} - Adaptus2-framework only
2. ${colors.bright}Base + Redis + Database${colors.reset} - Complete backend stack
3. ${colors.bright}Base + Redis + Database + LLM${colors.reset} - Full AI-enabled stack
4. ${colors.bright}Base + LLM${colors.reset} - Adaptus2 with AI capabilities

${colors.dim}Note: Even for Base Image option, external DB and Redis connections are required${colors.reset}
`);
}

// Check system requirements for local Ollama
function checkSystemRequirements() {
  const requirements = {
    cpu: os.cpus().length,
    memory: Math.round(os.totalmem() / (1024 ** 3)), // GB
    platform: os.platform(),
    arch: os.arch()
  };

  console.log(`\n${colors.fg.yellow}System Requirements Check:${colors.reset}`);
  console.log(`CPU Cores: ${requirements.cpu}`);
  console.log(`Memory: ${requirements.memory} GB`);
  console.log(`Platform: ${requirements.platform}`);
  console.log(`Architecture: ${requirements.arch}`);

  // Check if system meets minimum requirements for local Ollama
  const meetsRequirements = {
    cpu: requirements.cpu >= 4,
    memory: requirements.memory >= 8,
    platform: ['linux', 'darwin', 'win32'].includes(requirements.platform)
  };

  const canRunOllama = meetsRequirements.cpu && meetsRequirements.memory && meetsRequirements.platform;

  if (!canRunOllama) {
    console.log(`\n${colors.fg.red}Warning: Your system may not meet the minimum requirements for local Ollama:${colors.reset}`);
    if (!meetsRequirements.cpu) console.log(`${colors.fg.red}• Minimum 4 CPU cores recommended (you have ${requirements.cpu})${colors.reset}`);
    if (!meetsRequirements.memory) console.log(`${colors.fg.red}• Minimum 8GB RAM recommended (you have ${requirements.memory}GB)${colors.reset}`);
    if (!meetsRequirements.platform) console.log(`${colors.fg.red}• Platform ${requirements.platform} may not be supported${colors.reset}`);
  } else {
    console.log(`\n${colors.fg.green}✓ System meets requirements for local Ollama${colors.reset}`);
  }

  return { requirements, canRunOllama };
}

// Display Docker options menu
async function selectDockerOption() {
  console.log(`\n${colors.bright}${colors.fg.magenta}┌─────────────────────────────────────┐`);
  console.log(`│         DOCKER IMAGE OPTIONS        │`);
  console.log(`└─────────────────────────────────────┘${colors.reset}\n`);

  console.log(`${colors.fg.yellow}1.${colors.reset} Base Image Only`);
  console.log(`   ${colors.dim}• Adaptus2-framework container${colors.reset}`);
  console.log(`   ${colors.dim}• External Redis and Database required${colors.reset}\n`);

  console.log(`${colors.fg.yellow}2.${colors.reset} Base + Redis + Database`);
  console.log(`   ${colors.dim}• Complete backend stack${colors.reset}`);
  console.log(`   ${colors.dim}• Multi-container setup with docker-compose${colors.reset}\n`);

  console.log(`${colors.fg.yellow}3.${colors.reset} Base + Redis + Database + LLM`);
  console.log(`   ${colors.dim}• Full AI-enabled deployment${colors.reset}`);
  console.log(`   ${colors.dim}• Includes LLM service (Ollama/OpenAI/Claude)${colors.reset}\n`);

  console.log(`${colors.fg.yellow}4.${colors.reset} Base + LLM`);
  console.log(`   ${colors.dim}• Adaptus2 with AI capabilities${colors.reset}`);
  console.log(`   ${colors.dim}• External Redis and Database required${colors.reset}\n`);

  const choice = await prompt("Select Docker configuration (1-4)", "2");
  return choice;
}

// Collect database configuration
async function collectDatabaseConfig() {
  console.log(`\n${colors.bright}${colors.fg.magenta}┌─ Database Configuration ─────────────────────┐${colors.reset}`);
  
  const dbType = await prompt(`Database type (${Object.values(DB_TYPES).join(', ')})`, DB_TYPES.MYSQL);
  
  const dbConfig = {
    type: dbType,
    host: 'localhost',
    port: '',
    user: '',
    password: '',
    database: 'adaptus2'
  };

  // Set default ports and collect configuration based on DB type
  switch (dbType) {
    case DB_TYPES.MYSQL:
      dbConfig.port = '3306';
      dbConfig.user = 'root';
      dbConfig.host = await prompt("MySQL Host", dbConfig.host);
      dbConfig.port = await prompt("MySQL Port", dbConfig.port);
      dbConfig.user = await prompt("MySQL User", dbConfig.user);
      dbConfig.password = await prompt("MySQL Password", "");
      dbConfig.database = await prompt("MySQL Database", dbConfig.database);
      break;
      
    case DB_TYPES.POSTGRES:
      dbConfig.port = '5432';
      dbConfig.user = 'postgres';
      dbConfig.host = await prompt("PostgreSQL Host", dbConfig.host);
      dbConfig.port = await prompt("PostgreSQL Port", dbConfig.port);
      dbConfig.user = await prompt("PostgreSQL User", dbConfig.user);
      dbConfig.password = await prompt("PostgreSQL Password", "");
      dbConfig.database = await prompt("PostgreSQL Database", dbConfig.database);
      break;
      
    case DB_TYPES.MONGODB:
      dbConfig.port = '27017';
      dbConfig.uri = await prompt("MongoDB URI", `mongodb://localhost:${dbConfig.port}`);
      dbConfig.database = await prompt("MongoDB Database", dbConfig.database);
      break;
  }

  return dbConfig;
}

// Collect Redis configuration
async function collectRedisConfig() {
  console.log(`\n${colors.bright}${colors.fg.magenta}┌─ Redis Configuration ────────────────────────┐${colors.reset}`);
  
  const redisConfig = {
    host: await prompt("Redis Host", "localhost"),
    port: await prompt("Redis Port", "6379"),
    password: await prompt("Redis Password (optional)", ""),
    url: ""
  };

  // Build Redis URL
  if (redisConfig.password) {
    redisConfig.url = `redis://:${redisConfig.password}@${redisConfig.host}:${redisConfig.port}`;
  } else {
    redisConfig.url = `redis://${redisConfig.host}:${redisConfig.port}`;
  }

  return redisConfig;
}

// Collect LLM configuration
async function collectLLMConfig() {
  console.log(`\n${colors.bright}${colors.fg.magenta}┌─ LLM Configuration ──────────────────────────┐${colors.reset}`);
  
  const llmType = await prompt(`LLM Provider (${Object.values(LLM_TYPES).join(', ')})`, LLM_TYPES.OLLAMA);
  
  const llmConfig = {
    type: llmType,
    local: false,
    baseUrl: '',
    apiKey: '',
    model: ''
  };

  switch (llmType) {
    case LLM_TYPES.OLLAMA:
      const ollamaType = await prompt("Ollama deployment (local/remote)", "local");
      llmConfig.local = ollamaType.toLowerCase() === 'local';
      
      if (llmConfig.local) {
        // Check system requirements
        const { canRunOllama } = checkSystemRequirements();
        if (!canRunOllama) {
          const proceed = await prompt("System may not meet requirements. Continue anyway? (y/n)", "n");
          if (proceed.toLowerCase() !== 'y') {
            console.log(`${colors.fg.yellow}Switching to remote Ollama configuration...${colors.reset}`);
            llmConfig.local = false;
          }
        }
      }
      
      if (!llmConfig.local) {
        llmConfig.baseUrl = await prompt("Ollama Base URL", "http://localhost:11434");
      }
      
      llmConfig.model = await prompt("Ollama Model", "llama3");
      llmConfig.embeddingModel = await prompt("Embedding Model", "mxbai-embed-large");
      break;
      
    case LLM_TYPES.OPENAI:
      llmConfig.apiKey = await prompt("OpenAI API Key", "");
      llmConfig.model = await prompt("OpenAI Model", "gpt-3.5-turbo");
      break;
      
    case LLM_TYPES.CLAUDE:
      llmConfig.apiKey = await prompt("Claude API Key", "");
      llmConfig.model = await prompt("Claude Model", "claude-3-haiku-20240307");
      break;
      
    case LLM_TYPES.OPENROUTER:
      llmConfig.apiKey = await prompt("OpenRouter API Key", "");
      llmConfig.model = await prompt("OpenRouter Model", "openai/gpt-3.5-turbo");
      break;
  }

  return llmConfig;
}

// Generate Dockerfile for Adaptus2
function generateAdaptusDockerfile(config) {
  const { llmConfig } = config;
  
  let dockerfile = `# Adaptus2 Framework Docker Image
FROM node:18-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \\
    curl \\
    git \\
    python3 \\
    python3-pip \\
    build-essential \\
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm install --production

# Copy application code
COPY . .

# Create necessary directories
RUN mkdir -p plugins config public/assets videos

# Copy configuration files
COPY config/ ./config/
COPY plugins/ ./plugins/

`;

  // Add Ollama installation if local LLM is selected
  if (llmConfig && llmConfig.type === LLM_TYPES.OLLAMA && llmConfig.local) {
    dockerfile += `
# Install Ollama for local LLM
RUN curl -fsSL https://ollama.ai/install.sh | sh

# Pull the specified model
RUN ollama serve & \\
    sleep 10 && \\
    ollama pull ${llmConfig.model || 'llama3'} && \\
    ollama pull ${llmConfig.embeddingModel || 'mxbai-embed-large'} && \\
    pkill ollama

`;
  }

  dockerfile += `
# Expose ports
EXPOSE 3000 5000

# Set environment variables
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD curl -f http://localhost:3000/health || exit 1

# Start the application
CMD ["npm", "start"]
`;

  return dockerfile;
}

// Generate docker-compose.yml
function generateDockerCompose(config) {
  const { dockerOption, dbConfig, redisConfig, llmConfig } = config;
  
  let compose = `version: '3.8'

services:
  adaptus2:
    build: .
    ports:
      - "3000:3000"
      - "5000:5000"
    environment:
      - NODE_ENV=production
      - HOST=0.0.0.0
      - PORT=3000
      - JWT_SECRET=${generateRandomSecret(32)}
      - SECRET_SALT=${generateRandomSecret(16)}
`;

  // Add database service if needed
  if ([DOCKER_OPTIONS.BASE_REDIS_DB, DOCKER_OPTIONS.BASE_REDIS_DB_LLM].includes(dockerOption)) {
    if (dbConfig.type === DB_TYPES.MYSQL) {
      compose += `      - DEFAULT_DBTYPE=mysql
      - DEFAULT_DBCONNECTION=MYSQL_1
      - MYSQL_1_HOST=mysql
      - MYSQL_1_PORT=3306
      - MYSQL_1_USER=${dbConfig.user}
      - MYSQL_1_PASSWORD=${dbConfig.password}
      - MYSQL_1_DB=${dbConfig.database}
`;
    } else if (dbConfig.type === DB_TYPES.POSTGRES) {
      compose += `      - DEFAULT_DBTYPE=postgres
      - DEFAULT_DBCONNECTION=POSTGRES_1
      - POSTGRES_1_HOST=postgres
      - POSTGRES_1_PORT=5432
      - POSTGRES_1_USER=${dbConfig.user}
      - POSTGRES_1_PASSWORD=${dbConfig.password}
      - POSTGRES_1_DB=${dbConfig.database}
`;
    } else if (dbConfig.type === DB_TYPES.MONGODB) {
      compose += `      - DEFAULT_DBTYPE=mongodb
      - DEFAULT_DBCONNECTION=MONGODB_1
      - MONGODB_1_URI=mongodb://mongodb:27017
      - MONGODB_1_DB=${dbConfig.database}
`;
    }
  } else {
    // External database configuration
    if (dbConfig.type === DB_TYPES.MYSQL) {
      compose += `      - DEFAULT_DBTYPE=mysql
      - DEFAULT_DBCONNECTION=MYSQL_1
      - MYSQL_1_HOST=${dbConfig.host}
      - MYSQL_1_PORT=${dbConfig.port}
      - MYSQL_1_USER=${dbConfig.user}
      - MYSQL_1_PASSWORD=${dbConfig.password}
      - MYSQL_1_DB=${dbConfig.database}
`;
    } else if (dbConfig.type === DB_TYPES.POSTGRES) {
      compose += `      - DEFAULT_DBTYPE=postgres
      - DEFAULT_DBCONNECTION=POSTGRES_1
      - POSTGRES_1_HOST=${dbConfig.host}
      - POSTGRES_1_PORT=${dbConfig.port}
      - POSTGRES_1_USER=${dbConfig.user}
      - POSTGRES_1_PASSWORD=${dbConfig.password}
      - POSTGRES_1_DB=${dbConfig.database}
`;
    } else if (dbConfig.type === DB_TYPES.MONGODB) {
      compose += `      - DEFAULT_DBTYPE=mongodb
      - DEFAULT_DBCONNECTION=MONGODB_1
      - MONGODB_1_URI=${dbConfig.uri}
      - MONGODB_1_DB=${dbConfig.database}
`;
    }
  }

  // Add Redis configuration
  if ([DOCKER_OPTIONS.BASE_REDIS_DB, DOCKER_OPTIONS.BASE_REDIS_DB_LLM].includes(dockerOption)) {
    compose += `      - REDIS_URL=redis://redis:6379
`;
  } else {
    compose += `      - REDIS_URL=${redisConfig.url}
`;
  }

  // Add LLM configuration
  if ([DOCKER_OPTIONS.BASE_REDIS_DB_LLM, DOCKER_OPTIONS.BASE_LLM].includes(dockerOption) && llmConfig) {
    compose += `      - LLM_TYPE=${llmConfig.type}
`;
    
    if (llmConfig.type === LLM_TYPES.OLLAMA) {
      if (llmConfig.local) {
        compose += `      - OLLAMA_BASE_URL=http://localhost:11434
`;
      } else {
        compose += `      - OLLAMA_BASE_URL=${llmConfig.baseUrl}
`;
      }
      compose += `      - OLLAMA_INFERENCE=${llmConfig.model}
      - OLLAMA_EMBEDDING_MODEL=${llmConfig.embeddingModel}
      - EMBEDDING_PROVIDER=ollama
`;
    } else if (llmConfig.type === LLM_TYPES.OPENAI) {
      compose += `      - OPENAI_API_KEY=${llmConfig.apiKey}
      - OPENAI_MODEL=${llmConfig.model}
`;
    } else if (llmConfig.type === LLM_TYPES.CLAUDE) {
      compose += `      - CLAUDE_API_KEY=${llmConfig.apiKey}
      - CLAUDE_MODEL=${llmConfig.model}
`;
    } else if (llmConfig.type === LLM_TYPES.OPENROUTER) {
      compose += `      - OPENROUTER_API_KEY=${llmConfig.apiKey}
`;
    }
  }

  compose += `    depends_on:
`;

  // Add database service
  if ([DOCKER_OPTIONS.BASE_REDIS_DB, DOCKER_OPTIONS.BASE_REDIS_DB_LLM].includes(dockerOption)) {
    if (dbConfig.type === DB_TYPES.MYSQL) {
      compose += `      - mysql
`;
    } else if (dbConfig.type === DB_TYPES.POSTGRES) {
      compose += `      - postgres
`;
    } else if (dbConfig.type === DB_TYPES.MONGODB) {
      compose += `      - mongodb
`;
    }
    
    compose += `      - redis
`;
  }

  compose += `    restart: unless-stopped
    volumes:
      - ./config:/app/config
      - ./plugins:/app/plugins
      - ./public:/app/public
      - adaptus2_data:/app/data

`;

  // Add Redis service
  if ([DOCKER_OPTIONS.BASE_REDIS_DB, DOCKER_OPTIONS.BASE_REDIS_DB_LLM].includes(dockerOption)) {
    compose += `  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    restart: unless-stopped
`;
    
    if (redisConfig.password) {
      compose += `    command: redis-server --requirepass ${redisConfig.password}
`;
    }
    compose += `
`;
  }

  // Add database service
  if ([DOCKER_OPTIONS.BASE_REDIS_DB, DOCKER_OPTIONS.BASE_REDIS_DB_LLM].includes(dockerOption)) {
    if (dbConfig.type === DB_TYPES.MYSQL) {
      compose += `  mysql:
    image: mysql:8.0
    ports:
      - "3306:3306"
    environment:
      - MYSQL_ROOT_PASSWORD=${dbConfig.password}
      - MYSQL_DATABASE=${dbConfig.database}
      - MYSQL_USER=${dbConfig.user !== 'root' ? dbConfig.user : ''}
      - MYSQL_PASSWORD=${dbConfig.user !== 'root' ? dbConfig.password : ''}
    volumes:
      - mysql_data:/var/lib/mysql
    restart: unless-stopped

`;
    } else if (dbConfig.type === DB_TYPES.POSTGRES) {
      compose += `  postgres:
    image: postgres:15-alpine
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_DB=${dbConfig.database}
      - POSTGRES_USER=${dbConfig.user}
      - POSTGRES_PASSWORD=${dbConfig.password}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

`;
    } else if (dbConfig.type === DB_TYPES.MONGODB) {
      compose += `  mongodb:
    image: mongo:7
    ports:
      - "27017:27017"
    environment:
      - MONGO_INITDB_DATABASE=${dbConfig.database}
    volumes:
      - mongodb_data:/data/db
    restart: unless-stopped

`;
    }
  }

  compose += `volumes:
  adaptus2_data:
`;

  if ([DOCKER_OPTIONS.BASE_REDIS_DB, DOCKER_OPTIONS.BASE_REDIS_DB_LLM].includes(dockerOption)) {
    compose += `  redis_data:
`;
    
    if (dbConfig.type === DB_TYPES.MYSQL) {
      compose += `  mysql_data:
`;
    } else if (dbConfig.type === DB_TYPES.POSTGRES) {
      compose += `  postgres_data:
`;
    } else if (dbConfig.type === DB_TYPES.MONGODB) {
      compose += `  mongodb_data:
`;
    }
  }

  return compose;
}

// Generate .env file for Docker
function generateDockerEnv(config) {
  const { dbConfig, redisConfig, llmConfig } = config;
  
  let envContent = `# Adaptus2 Docker Environment Configuration
# Generated by Adaptus2 Docker Generator

# Server Configuration
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
JWT_SECRET=${generateRandomSecret(32)}
SECRET_SALT=${generateRandomSecret(16)}

# Logging
ENABLE_LOGGING=TRUE
LOG_LEVEL=info

# CORS Configuration
CORS_ENABLED=TRUE
CORS_ORIGIN=*
CORS_METHODS=GET,POST,PUT,DELETE
CORS_CREDENTIALS=true

# Plugin Manager
PLUGIN_MANAGER=local
SERVER_ROLE=MASTER

# CLI Configuration  
SOCKET_CLI=TRUE
SOCKET_CLI_PORT=5000
CLI_USERNAME=admin
CLI_PASSWORD=${generateRandomSecret(8)}

`;

  // Database configuration
  if (dbConfig.type === DB_TYPES.MYSQL) {
    envContent += `# MySQL Configuration
DEFAULT_DBTYPE=mysql
DEFAULT_DBCONNECTION=MYSQL_1
MYSQL_1_HOST=${dbConfig.host}
MYSQL_1_PORT=${dbConfig.port}
MYSQL_1_USER=${dbConfig.user}
MYSQL_1_PASSWORD=${dbConfig.password}
MYSQL_1_DB=${dbConfig.database}

`;
  } else if (dbConfig.type === DB_TYPES.POSTGRES) {
    envContent += `# PostgreSQL Configuration
DEFAULT_DBTYPE=postgres
DEFAULT_DBCONNECTION=POSTGRES_1
POSTGRES_1_HOST=${dbConfig.host} 
POSTGRES_1_PORT=${dbConfig.port}
POSTGRES_1_USER=${dbConfig.user}
POSTGRES_1_PASSWORD=${dbConfig.password}
POSTGRES_1_DB=${dbConfig.database}

`;
  } else if (dbConfig.type === DB_TYPES.MONGODB) {
    envContent += `# MongoDB Configuration
DEFAULT_DBTYPE=mongodb
DEFAULT_DBCONNECTION=MONGODB_1
MONGODB_1_URI=${dbConfig.uri}
MONGODB_1_DB=${dbConfig.database}

`;
  }

  // Redis configuration
  envContent += `# Redis Configuration
REDIS_URL=${redisConfig.url}
REPORT_CACHE_TTL=600
CACHE_DURATION=3600
CLEAR_REDIS_CACHE=false

`;

  // LLM configuration
  if (llmConfig) {
    envContent += `# LLM Configuration
LLM_TYPE=${llmConfig.type}
`;
    
    if (llmConfig.type === LLM_TYPES.OLLAMA) {
      envContent += `OLLAMA_BASE_URL=${llmConfig.local ? 'http://localhost:11434' : llmConfig.baseUrl}
OLLAMA_INFERENCE=${llmConfig.model}
OLLAMA_EMBEDDING_MODEL=${llmConfig.embeddingModel}
EMBEDDING_PROVIDER=ollama
QUALITY_CONTROL_ENABLED=false
QUALITY_CONTROL_MAX_RETRIES=2
`;
    } else if (llmConfig.type === LLM_TYPES.OPENAI) {
      envContent += `OPENAI_API_KEY=${llmConfig.apiKey}
OPENAI_MODEL=${llmConfig.model}
`;
    } else if (llmConfig.type === LLM_TYPES.CLAUDE) {
      envContent += `CLAUDE_API_KEY=${llmConfig.apiKey}
CLAUDE_MODEL=${llmConfig.model}
`;
    } else if (llmConfig.type === LLM_TYPES.OPENROUTER) {
      envContent += `OPENROUTER_API_KEY=${llmConfig.apiKey}
`;
    }
  }

  // Module toggles (basic setup)
  envContent += `
# Module Configuration
ENABLE_CMS=false
MOD_PAGERENDER=false
MOD_PAGECLONE=false  
MOD_CHATSERVER=false
MOD_ECOMMTRACKER=false
MOD_SDUIADMIN=false
MOD_AGENT_WORKFLOW_ENABLED=false
MOD_VIDEOCONFERENCE=false
MOD_STREAMINGSERVER=false
MOD_REPORTING=false
MOD_REPORTBUILDER=false
ML_ANALYTICS=false
`;

  return envContent;
}

// Generate Docker README
function generateDockerReadme(config) {
  const { dockerOption, dbConfig, redisConfig, llmConfig } = config;
  
  let readme = `# Adaptus2 Docker Deployment

This Docker configuration was generated by the Adaptus2 Docker Generator.

## Configuration

### Docker Option
`;

  switch (dockerOption) {
    case DOCKER_OPTIONS.BASE_ONLY:
      readme += `**Base Image Only** - Adaptus2-framework container with external dependencies`;
      break;
    case DOCKER_OPTIONS.BASE_REDIS_DB:
      readme += `**Base + Redis + Database** - Complete backend stack`;
      break;
    case DOCKER_OPTIONS.BASE_REDIS_DB_LLM:
      readme += `**Base + Redis + Database + LLM** - Full AI-enabled deployment`;
      break;
    case DOCKER_OPTIONS.BASE_LLM:
      readme += `**Base + LLM** - Adaptus2 with AI capabilities`;
      break;
  }

  readme += `

### Database Configuration
- **Type**: ${dbConfig.type}
- **Host**: ${dbConfig.host}
- **Database**: ${dbConfig.database}

### Redis Configuration  
- **URL**: ${redisConfig.url}

`;

  if (llmConfig) {
    readme += `### LLM Configuration
- **Provider**: ${llmConfig.type}
`;
    
    if (llmConfig.type === LLM_TYPES.OLLAMA) {
      readme += `- **Deployment**: ${llmConfig.local ? 'Local' : 'Remote'}
- **Model**: ${llmConfig.model}
- **Embedding Model**: ${llmConfig.embeddingModel}
`;
    } else if (llmConfig.apiKey) {
      readme += `- **Model**: ${llmConfig.model}
- **API Key**: Configured
`;
    }
  }

  readme += `
## Quick Start

### 1. Build and Start Services
\`\`\`bash
# Build and start all services
docker-compose up -d --build

# View logs
docker-compose logs -f adaptus2
\`\`\`

### 2. Initialize Database
\`\`\`bash
# Initialize database tables
docker-compose exec adaptus2 npx adaptus2 init

# Build API configuration
docker-compose exec adaptus2 npx adaptus2 build
\`\`\`

### 3. Access the Application
- **Main Application**: http://localhost:3000
- **CLI Interface**: Socket connection on port 5000

`;

  if ([DOCKER_OPTIONS.BASE_REDIS_DB, DOCKER_OPTIONS.BASE_REDIS_DB_LLM].includes(dockerOption)) {
    readme += `### 4. Service Endpoints
- **Redis**: localhost:6379
`;
    
    if (dbConfig.type === DB_TYPES.MYSQL) {
      readme += `- **MySQL**: localhost:3306
`;
    } else if (dbConfig.type === DB_TYPES.POSTGRES) {
      readme += `- **PostgreSQL**: localhost:5432
`;
    } else if (dbConfig.type === DB_TYPES.MONGODB) {
      readme += `- **MongoDB**: localhost:27017
`;
    }
  }

  readme += `
## Management Commands

### Docker Commands
\`\`\`bash
# Stop all services
docker-compose down

# Stop and remove volumes (WARNING: This will delete all data)
docker-compose down -v

# View service status
docker-compose ps

# Scale Adaptus2 instances
docker-compose up -d --scale adaptus2=3
\`\`\`

### Adaptus2 Commands
\`\`\`bash
# Access container shell
docker-compose exec adaptus2 /bin/bash

# Run Adaptus2 CLI
docker-compose exec adaptus2 npx adaptus2-cli

# Generate Swagger documentation
docker-compose exec adaptus2 npx adaptus2 generate-swagger

# Setup CMS
docker-compose exec adaptus2 npx adaptus2-cmsInit
\`\`\`

## Configuration Files

- **Dockerfile**: Application container definition
- **docker-compose.yml**: Multi-service orchestration
- **.env**: Environment variables
- **config/**: Adaptus2 configuration files
- **plugins/**: Adaptus2 plugins

## Troubleshooting

### Common Issues

1. **Port Conflicts**: Ensure ports 3000, 5000, 6379, and database ports are available
2. **Memory Issues**: For local Ollama, ensure sufficient RAM (8GB+ recommended)
3. **Permission Issues**: Ensure Docker has proper permissions for volume mounts

### Viewing Logs
\`\`\`bash
# All services
docker-compose logs

# Specific service
docker-compose logs adaptus2
docker-compose logs redis
docker-compose logs ${dbConfig.type}

# Follow logs in real-time
docker-compose logs -f adaptus2
\`\`\`

### Health Checks
\`\`\`bash
# Check application health
curl http://localhost:3000/health

# Check service status
docker-compose ps
\`\`\`

## Production Considerations

1. **Security**: Update default passwords and API keys
2. **SSL**: Add reverse proxy with SSL termination
3. **Backups**: Set up regular database backups
4. **Monitoring**: Add monitoring and alerting
5. **Scaling**: Consider orchestration platforms for high availability

For more information, visit the [Adaptus2 Framework Documentation](https://github.com/mataluis2k/Adaptus2-Framework).
`;

  return readme;
}

// Main Docker setup function
async function setupDocker() {
  const config = {};
  
  // Select Docker option
  config.dockerOption = await selectDockerOption();
  
  // Collect database configuration (always needed)
  config.dbConfig = await collectDatabaseConfig();
  
  // Collect Redis configuration (always needed)
  config.redisConfig = await collectRedisConfig();
  
  // Collect LLM configuration if needed
  if ([DOCKER_OPTIONS.BASE_REDIS_DB_LLM, DOCKER_OPTIONS.BASE_LLM].includes(config.dockerOption)) {
    config.llmConfig = await collectLLMConfig();
  }
  
  // Generate Docker files
  console.log(`\n${colors.fg.yellow}Generating Docker configuration files...${colors.reset}`);
  
  const dockerfile = generateAdaptusDockerfile(config);
  const dockerCompose = generateDockerCompose(config);
  const dockerEnv = generateDockerEnv(config);
  const dockerReadme = generateDockerReadme(config);
  
  // Write files
  fs.writeFileSync('Dockerfile', dockerfile);
  fs.writeFileSync('docker-compose.yml', dockerCompose);
  fs.writeFileSync('.env.docker', dockerEnv);
  fs.writeFileSync('README-Docker.md', dockerReadme);
  
  console.log(`${colors.fg.green}✓ Generated Dockerfile${colors.reset}`);
  console.log(`${colors.fg.green}✓ Generated docker-compose.yml${colors.reset}`);
  console.log(`${colors.fg.green}✓ Generated .env.docker${colors.reset}`);
  console.log(`${colors.fg.green}✓ Generated README-Docker.md${colors.reset}`);
  
  // Ask about building
  const shouldBuild = await prompt("Build Docker images now? (y/n)", "y");
  
  if (shouldBuild.toLowerCase() === 'y') {
    console.log(`\n${colors.fg.yellow}Building Docker images...${colors.reset}`);
    
    try {
      // Copy .env.docker to .env for Docker build
      if (fs.existsSync('.env')) {
        fs.copyFileSync('.env', '.env.backup');
        console.log(`${colors.fg.yellow}Backed up existing .env to .env.backup${colors.reset}`);
      }
      
      fs.copyFileSync('.env.docker', '.env');
      
      execSync('docker-compose build', { stdio: 'inherit' });
      console.log(`${colors.fg.green}✓ Docker images built successfully${colors.reset}`);
      
      const shouldStart = await prompt("Start services now? (y/n)", "y");
      
      if (shouldStart.toLowerCase() === 'y') {
        execSync('docker-compose up -d', { stdio: 'inherit' });
        console.log(`${colors.fg.green}✓ Services started successfully${colors.reset}`);
        
        console.log(`\n${colors.bright}${colors.fg.cyan}Services are starting up...${colors.reset}`);
        console.log(`${colors.fg.yellow}Main Application: http://localhost:3000${colors.reset}`);
        console.log(`${colors.fg.yellow}CLI Socket: localhost:5000${colors.reset}`);
        
        console.log(`\n${colors.dim}Run 'docker-compose logs -f' to view logs${colors.reset}`);
      }
      
    } catch (error) {
      console.error(`${colors.fg.red}Error building/starting Docker services:${colors.reset}`, error.message);
    }
  } else {
    console.log(`\n${colors.fg.cyan}Docker configuration complete!${colors.reset}`);
    console.log(`${colors.dim}Run 'docker-compose up -d --build' when ready to start${colors.reset}`);
  }
  
  console.log(`\n${colors.fg.green}${colors.bright}Docker setup completed successfully!${colors.reset}`);
}

// Start the Docker setup process
showWelcomeBanner();
setupDocker().catch((err) => {
  console.error(`${colors.fg.red}Error during Docker setup:${colors.reset}`, err);
});