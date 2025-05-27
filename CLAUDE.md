# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Adaptus2-Framework is a highly configurable API Express Framework for Node.js that enables dynamic routing, plugin architecture, and real-time capabilities. It provides a flexible server architecture that supports RESTful APIs, WebSockets, GraphQL, and more.

## Key Commands

### Installation and Setup
```bash
# Install globally (requires Node v18+)
npm install -g adaptus2-framework

# Setup a new project interactively
adaptus2-setup

# Generate API configuration from database
adaptus2 build
# or with options
adaptus2 build --acl publicAccess --overwrite --refresh

# Initialize database tables
adaptus2 init

# Generate Swagger documentation
adaptus2 generate-swagger
```

### Development
```bash
# Start the server in development mode with auto-reload
npm run dev

# Start the server with 8GB memory allocation
npm run start

# Run Jest test suite
npm test

# Copy plugins after installation
npm run postinstall
```

### CLI Tools
```bash
# Administrative CLI interface (defined in cliClient.js)
adaptus2-cli

# CMS configuration initialization
adaptus2-cmsInit

# Docker setup
adaptus2-docker

# ETL service runner
adaptus2-etl
```

### Server Signals
- `SIGHUP`: Reload configuration without restart
- `SIGTERM/SIGINT`: Graceful shutdown

## Architecture

### Core Architecture Pattern

The framework follows a **Module Gateway Pattern** where optional modules are lazy-loaded based on configuration. The server core (`src/server.js`) initializes essential middleware and delegates to specialized modules through a centralized gateway (`src/modules/moduleGateway.js`).

### Key Architectural Components

1. **Dynamic Routing System**: Routes are loaded from `apiConfig.json` and registered dynamically. Each route supports:
   - Standard CRUD operations with database mapping
   - Custom business logic via plugins
   - ACL-based permissions
   - Request/response transformations via business rules

2. **Plugin System**: Plugins (`plugins/` directory) extend functionality without core modifications:
   ```javascript
   module.exports = {
     name: 'pluginName',
     version: '1.0.0',
     
     initialize(dependencies) {
       const { context, db, logger, customRequire } = dependencies;
       // Access to shared context, database, logger, and module loader
     },
     
     registerRoutes({ app }) {
       // Optional: register Express routes
       return routes; // Array for cleanup
     },
     
     async cleanup() {
       // Cleanup when unloaded
     }
   };
   ```

3. **Business Rules Engine**: DSL-based rules in `.dsl` files that process at runtime:
   ```
   IF <HTTP_METHOD> <RESOURCE> [WHEN <CONDITIONS>] THEN
       <ACTIONS>
   ELSE
       <ACTIONS>
   ```
   Rules support database operations, async triggers, response modifications, and conditional logic.

4. **Workflow Engine**: Define complex workflows in `workflows.dsl`:
   ```
   WORKFLOW updateInventory SCHEDULE "0 * * * *"
   WITH DB connection DO
     UPDATE products SET stock = stock - 1 WHERE id = ?
   ```

5. **Database Abstraction**: Multi-database support (MySQL, PostgreSQL, MongoDB, Snowflake) with:
   - Connection pooling
   - Automated table initialization via `--init` flag
   - UUID obfuscation for security
   - Query caching via Redis

6. **Real-time Communication**:
   - WebSocket server for push notifications
   - Redis pub/sub for cluster communication
   - Socket CLI for administrative operations

### Module Loading Strategy

Modules are conditionally loaded based on configuration to optimize memory usage:
- **Always loaded**: Core routing, authentication, database
- **Conditionally loaded**: Chat, ML analytics, streaming, Ollama, ETL
- **Lazy loaded**: Heavy modules load only when first accessed

### Configuration Hierarchy

1. **Environment variables** (`.env` file)
2. **Recipe files** (`recipes/*.json`) - Server presets
3. **API configuration** (`apiConfig.json`) - Routes and permissions
4. **Business rules** (`*.dsl` files) - Runtime logic

## Working with the Codebase

### Adding New Features

1. **For simple endpoints**: Add to `apiConfig.json`
2. **For complex logic**: Create a plugin in `plugins/`
3. **For data transformations**: Use business rules DSL
4. **For scheduled tasks**: Use workflow DSL

### Testing Endpoints

The framework includes a built-in test runner:
```bash
# Run API tests defined in apiTests.json
node src/tests/apiTestRunner.js
```

### Database Operations

When working with databases:
- Use the `db` module from dependencies in plugins
- Leverage built-in CRUD operations via dynamic routes
- UUID fields are automatically obfuscated/deobfuscated

### Redis Integration

Redis is used for:
- Query result caching (automatic for GET requests)
- WebSocket event broadcasting
- Plugin synchronization in cluster mode
- Pub/sub for configuration updates

### Security Considerations

- JWT tokens with configurable expiry
- ACL middleware for role-based access
- Request logging with optional encryption
- Rate limiting per endpoint
- Helmet.js for security headers

## Environment Variables

Essential environment variables:
- `PORT`: Server port (default: 3000)
- `HOST`: Server host (default: 0.0.0.0)
- `REDIS_URL`: Redis connection URL
- `JWT_SECRET`: Secret for JWT tokens
- `JWT_EXPIRY`: Token expiration (default: 86400)
- `PLUGIN_MANAGER`: Enable/disable plugin manager
- `NODE_ENV`: Environment (development/production)
- `CLUSTER_NAME`: For multi-instance deployments

See `env.sample` for complete list.