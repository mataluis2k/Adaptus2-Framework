# Adaptus2 Framework

Adaptus2 is a flexible and modular API server framework built on Express. It integrates a variety of technologies and features to support robust API development, real-time updates, plugin management, and scalable microservices architecture.

---

## Installation

1. **Clone the Repository:**
   ```bash
   git clone <repository-url>
   cd Adaptus2-Framework
   ```

2. **Install Dependencies:**
   Use npm to install all required packages:
   ```bash
   npm install
   ```

3. **Environment Configuration:**
   - Create a `.env` file at the root directory, or copy the provided `env.sample` and update the necessary environment variables.
   - Key variables include:
     - `PORT`
     - `REDIS_URL`
     - `JWT_SECRET`
     - `JWT_EXPIRY`
     - `PLUGIN_MANAGER`
     - `CLUSTER_NAME`
     - Others as needed for your configuration.

4. **Database Setup:**
   - Ensure your database (MySQL or PostgreSQL) is running.
   - Use the command-line flags to initialize tables if needed:
     ```bash
     npm run init
     ```
     (This uses the `--init` flag to setup database tables.)

5. **Starting the Server:**
   To start the server, simply run:
   ```bash
   npm start
   ```
   Additional commands:
   - `npm run build` to build the API configuration from the database.
   - `npm run swagger` to generate Swagger API documentation if configured.

---

## Overview

The Adaptus2 Framework provides a highly configurable server architecture that supports:
- RESTful APIs with dynamic routing and CRUD operations based on external API configurations.
- Real-time communication via WebSocket integrated with Redis Pub/Sub.
- GraphQL endpoint for advanced data querying.
- Built-in support for authentication, authorization, rate limiting, caching, and security enhancements.

---

## Key Features

### Core Server & REST API
- **Express-based Server:**  
  Configured with essential middleware for JSON parsing, URL-encoded payloads, and response compression.
- **Dynamic Routing:**  
  Routes are dynamically registered from a categorized API configuration. Supports standard CRUD operations and proxy endpoints.
- **Database Integration:**  
  Uses a configurable database connection (MySQL or PostgreSQL) with automated table initialization and SQL injection prevention.
- **Redis Caching & Pub/Sub:**  
  Implements Redis for query caching as well as for broadcasting events (database changes, cache updates, configuration changes) to WebSocket clients.
- **Robust Error Handling & Logging:**  
  Integrated logging with Morgan and Winston with detailed error handlers for production-grade monitoring.

### Real-Time Communication
- **WebSocket Server:**  
  Provides real-time notifications for database changes, cache invalidation, and configuration updates. Clients can subscribe/unsubscribe to specific channels.
- **Socket CLI:**  
  An administrative CLI over sockets allows on-the-fly operations like generating tokens, reloading configuration, listing routes, and managing plugins.

### GraphQL Endpoint
- **GraphQL Integration:**  
  A dedicated `/graphql` endpoint enables advanced queries and mutations. Schema generation is handled dynamically based on API configurations and resolvers are flattened for ease of use.

### Plugin Management & Cluster Support
- **Plugin Manager:**  
  A built-in Plugin Manager supports dynamic loading, unloading, and reloading of plugins. Plugins can be broadcasted across clusters via Redis if network mode is enabled.
- **Network Plugin Synchronization:**  
  In cluster environments, plugins are synchronized using Redis channels with support for version checking and dynamic reloading.

### Advanced Middleware & Security
- **Security Middleware:**  
  Uses Helmet for security headers, and enables XSS filtering, content security policies, and protections against common vulnerabilities.
- **Authentication & ACL:**  
  JWT-based authentication with password validation using bcrypt or sha256. Custom authentication and ACL middlewares secure different API endpoints.
- **Rate Limiting & Compression:**  
  Integrated rate limiting protects API endpoints while response compression enhances performance.
- **Global Business Rules Engine:**  
  A rule engine processes business logic defined in DSL files. It facilitates dynamic business rule evaluation and configuration reloading.

### Additional Modules
- **Analytics Module:**  
  Provides endpoints under `/analytics` for fetching endpoint analytics, slow queries reports, and overall API health metrics.
- **Developer Tools:**  
  Development-only endpoints (e.g., `/dev`) expose development tools and debugging information.
- **Optional Modules:**  
  - **Chat Module:** Enables real-time chat functionality if configured.
  - **Streaming Server Module:** Supports streaming endpoints, typically for media content.
  - **ML Analytics Module:** Integrates machine learning analytics, including model training and scheduled tasks.
  - **Ollama Module:** Supports integrations with external tools for advanced processing.
- **File Upload & Static Routes:**  
  Dynamic registration of file upload endpoints and static routes based on configuration.

### Command-Line Operations
- **Build & Initialization Flags:**  
  - `--build`: Build API configuration from the database.
  - `--init`: Initialize database tables.
  - `--generate-swagger`: Generate Swagger API documentation.
- **Graceful Shutdown:**  
  The server supports graceful shutdown on uncaught exceptions, unhandled rejections, and termination signals.

---

## Setup & Configuration

### **Installation**
Make sure you have at least Node v18 or higher!
```bash
Create folder where you want to have your server configs and plugins e.g. 
mkdir adaptus2
cd adaptus2
npm install -g adaptus2-framework
# once installation completes
adaptus2-setup 
# If you already have a database in place with schema , you can hydrates/build the apiConfig.json file 
adaptus2 --build 
# Now you are ready to run the server 
adaptus2 
```

1. **Environment Variables:**  
   Configure environment variables in a `.env` file for settings such as:
   - `PORT`, `REDIS_URL`, `JWT_SECRET`, `JWT_EXPIRY`
   - `PLUGIN_MANAGER`, `CLUSTER_NAME`, etc.
2. **API Configuration:**  
   Define API endpoints, proxy routes, dynamic routes, static routes, and file upload endpoints in a configuration file (e.g., `config/apiConfig.json`).
3. **Database Setup:**  
   Ensure the database is accessible and properly configured. Use the `--init` flag to initialize tables as defined in the configuration.
4. **Plugins:**  
   Place plugins in the `plugins` folder. Plugins can be loaded/unloaded dynamically via the Plugin Manager and synchronized across clusters if operating in network mode.
5. **Running the Server:**  
   Start the server normally (`node server.js`) or use command-line flags for building or initialization.

---

## Development & Debugging

- **Developer Tools:**  
  In development mode (`NODE_ENV=development`), additional routes (e.g., `/dev`) are available for debugging and performance monitoring.
- **Socket CLI:**  
  Connect via the configured socket CLI port to execute administrative commands like:
  - Token generation (`userGenToken`, `appGenToken`)
  - Plugin management (`load`, `unload`, `reload`)
  - Reloading configuration (`configReload`)
  - Listing current routes and actions.
- **Live Updates:**  
  The server listens for SIGHUP signals to reload the API configuration and updates routes and business rules accordingly.

### **Expanding the Logic**
Adaptus2-Framework uses a pluginManager to expand it's capabilities. This modules can be deployed on the plugins folder relative to the folder that the application was install if by the previous example you install the server configs in adaptus2 folder , the plugins would be located on adaptus2/plugins folder. 

Here is an example of what a plugin file might look like.

- Plugin Template :
  ```javascript
  module.exports = {
    name: 'examplePlugin',
    version: '1.0.0',

    initialize(dependencies) {
        console.log('Initializing examplePlugin...');
        const { context, customRequire } = dependencies;
        const UniversalApiClient = customRequire('../src/modules/universalAPIClient'); // Universal api Client
        const db = customRequire('../src/modules/db'); // Database ORM
        const { authenticateMiddleware, aclMiddleware } = customRequire('../src/middleware/authenticationMiddleware'); // Route protection middleware 
        // Perform initialization tasks
    },

    registerRoutes({ app }) {
        const routes = [];
        
        // Register route and keep track of it
        const routePath = '/example';
        app.get(routePath,authenticateMiddleware("token"), aclMiddleware(["publicAccess"]), (req, res) => {
            res.send('Example Plugin Route');
        });
        routes.push({ method: 'get', path: routePath });
    
        // Return registered routes for cleanup later
        return routes;
    },

    async cleanup() {
        console.log('Cleaning up examplePlugin...');
        // Perform cleanup tasks
    },
};
```
---

## License

Distributed under the MIT License. See the [LICENSE](LICENSE) file for more information.

---

## Conclusion

Adaptus2 Framework combines the power of dynamic API configuration, real-time updates, plugin management, and robust middleware to create a scalable and secure platform for modern web applications. Explore the modules, extend the system with plugins, and leverage the real-time features to build responsive and resilient APIs.
