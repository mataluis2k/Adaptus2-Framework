# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Adaptus2-Framework is a highly configurable API Express Framework for Node.js that enables dynamic routing, plugin architecture, and real-time capabilities. It provides a flexible server architecture that supports RESTful APIs, WebSockets, GraphQL, and more.

## Key Commands

### Installation and Setup
```bash
# Install globally
npm install -g adaptus2-framework

# Setup a new project
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

# Start the server with increased memory allocation
npm run start

# Run tests
npm test
```

### CLI Tools
```bash
# Use CLI client (defined in cliClient.js)
adaptus2-cli

# CMS configuration initialization
adaptus2-cmsInit

# Docker setup
adaptus2-docker

# ETL service
adaptus2-etl
```

## Architecture

Adaptus2-Framework has a modular, plugin-based architecture with several key components:

### Core Components

1. **Server**: Express-based server with dynamic routing, WebSockets, and GraphQL integration
2. **Plugin Manager**: Manages loading, initialization, and registration of plugins
3. **Database Layer**: Configurable database connections with automated table initialization
4. **Business Rules Engine**: DSL-based rules engine for defining business logic
5. **API Configuration**: JSON-based configurations that define routing, permissions, and database mappings

### Subsystems

1. **Authentication & ACL**: JWT-based authentication with configurable ACL
2. **WebSocket Communications**: Real-time notifications and admin CLI
3. **GraphQL Endpoint**: Dynamic schema generation based on API configurations
4. **ML Analytics**: Integration with machine learning models
5. **Dynamic Routing**: Routes registered from API configurations with CRUD operations
6. **Notification System**: Email, SMS, and push notification capabilities
7. **Redis Caching & Pub/Sub**: For query caching and broadcasting events

## Working with Recipes

Recipes are JSON configurations that define server behavior, including:
- Authentication and security
- Routes for REST/GraphQL APIs
- Database connections, table mappings, and CRUD permissions
- Relationships and schema definitions
- Advanced features like caching and ML integration

Example recipe files are located in the `/recipes` directory.

## Plugin Development

Plugins extend functionality without modifying core code. Each plugin should implement:

```javascript
module.exports = {
  name: 'pluginName',
  version: '1.0.0',

  initialize(dependencies) {
    // Setup plugin
  },

  registerRoutes({ app }) {
    // Register routes
    return routes; // Array of registered routes for cleanup
  },

  async cleanup() {
    // Cleanup when unloaded
  },
};
```

Plugins are stored in the `plugins/` directory and are loaded by the Plugin Manager.

## Business Rules DSL

The framework includes a DSL for defining business rules in a human-readable format:

```
IF <HTTP_METHOD> <RESOURCE> [WHEN <CONDITIONS>] THEN
    <ACTIONS>
ELSE IF <OTHER_CONDITIONS>
    <ACTIONS>
ELSE
    <ACTIONS>
```

Rules can modify API responses, implement conditional logic, and perform various actions without code changes.

## Environment Variables

Key environment variables include:
- `PORT`: Server port (default: 3000)
- `HOST`: Server host (default: 0.0.0.0)
- `REDIS_URL`: Redis connection URL
- `JWT_SECRET`: Secret for JWT tokens
- `PLUGIN_MANAGER`: Enable/disable plugin manager
- `NODE_ENV`: Environment (development/production)

A sample `.env` file is available at `env.sample`.