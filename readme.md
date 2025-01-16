# **Adaptus2 Framework**: The Highly Scalable and Configurable API Framework for Node.js
*"Build robust, dynamic, and high-performance APIs with integrated AI features and effortless OpenGraph metadata configuration."*

---

## **2. Overview**
- **What it is**: A Node.js framework for scalable, configurable API services, with advanced features like AI-based retrieval-augmented generation (RAG), dynamic OpenGraph metadata handling, and extensive middleware support.
- **Why it matters**: Simplifies API development with an architecture that enables rapid deployment, seamless extensibility, and efficient operations. Configuration-driven approaches via `apiConfig.json` reduce boilerplate code while enhancing flexibility.

---

## **3. Features**
### **Current Functionality**
- **Dynamic Routing**: Define and manage API routes through `apiConfig.json` for unparalleled flexibility.
- **Dynamic OpenGraph Configuration**: Easily set and manage OpenGraph metadata.
- **Proxy API Support**: Create proxy endpoints with caching, query mapping, and response enrichment.
- **GraphQL Integration**: Generate and expose dynamic GraphQL schemas from API configurations.
- **Middleware System**: Built-in middleware for authentication, rate limiting, logging, and ACLs.
- **Caching Support**: Redis-based caching for optimized performance.
- **Rate Limiting**: Protect APIs with rate-limiting middleware.
- **Dynamic Table Initialization**: Automatically initialize database tables based on configuration.
- **Machine Learning Analytics**: Integration with ML models for analytics and RAG (Retrieval-Augmented Generation).
- **Cluster and Plugin Management**: Manage plugins dynamically across clusters using Redis Pub/Sub.
- **Real-Time Monitoring and Management**: CLI interface and dynamic module loading/unloading support.
- **Business Rule Engine**: DSL-driven rule evaluation and execution framework.

### **Upcoming Features**
- Enhanced real-time WebSocket support.
- Advanced API monitoring and logging.
- Multi-tenancy capabilities for shared configurations.
- Modular plugin architecture for user-defined extensions.
- CLI tools for scaffolding, configuration management, and operational insights.
- Comprehensive OpenGraph templating and customization options.

---

## **4. Why Adaptus2 Framework?**
- Offers a **configuration-driven API server** to accelerate development.
- Features **state-of-the-art AI integration** for RAG and analytics.
- Incorporates robust **caching and performance optimization** tools.
- Built-in support for **SEO-friendly OpenGraph metadata**.
- Fully extensible with a **plugin management system**.
- Comprehensive **middleware and ACL systems** for secure and reliable APIs.
- Open-source and **community-driven** for long-term reliability and growth.

---

## **5. Getting Started**
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

# CLI Commands for Adaptus2Server using CLI tool "adaptus2-cli"

This document provides an overview of the available CLI commands for interacting with the Adaptus2Server application via its socket-based CLI adaptus2-cli

## Getting Started

To access the CLI run the command adaptus2-cli

### Example
```bash
adaptus2-cli
```

Once connected, you can issue the commands listed below.

---

## CLI Commands

### General Commands

| Command       | Description                                         | Usage Example  |
|---------------|-----------------------------------------------------|----------------|
| `help`        | Displays a list of available commands.             | `help`         |
| `exit`        | Disconnects from the CLI.                          | `exit`         |

---

### Token Management

| Command          | Description                                          | Usage Example                      |
|------------------|------------------------------------------------------|-----------------------------------|
| `userGenToken`   | Generates a JWT for a user with a specified ACL.     | `userGenToken <username> <acl>`  |
| `appGenToken`    | Generates a JWT for an application with table access and ACL. | `appGenToken <table> <acl>`      |

---

### Configuration Management

| Command          | Description                            | Usage Example  |
|------------------|----------------------------------------|----------------|
| `configReload`   | Reloads the API configuration.         | `configReload` |

---

### Plugin Management

| Command          | Description                                     | Usage Example             |
|------------------|-------------------------------------------------|---------------------------|
| `listPlugins`    | Lists all available plugins in the directory.   | `listPlugins`             |
| `load`           | Loads a specified plugin.                      | `load <pluginName>`       |
| `unload`         | Unloads a specified plugin.                    | `unload <pluginName>`     |
| `reload`         | Reloads a specified plugin.                    | `reload <pluginName>`     |
| `reloadall`      | Reloads all currently loaded plugins.           | `reloadall`               |
| `list`           | Lists all currently loaded plugins.            | `list`                    |

---

### Route and Action Management

| Command          | Description                                     | Usage Example  |
|------------------|-------------------------------------------------|----------------|
| `routes`         | Displays a list of all registered API routes.  | `routes`       |
| `listActions`    | Lists all available actions from the global context. | `listActions`  |

---

## Notes

- Commands are case-sensitive.
- Ensure that the server is running and the socket server is active before attempting to connect.
- For security, use proper access control for sensitive commands like token generation.

---

---

## **6. Configuration**
### **API Configuration**
Define your API endpoints in `apiConfig.json`:
```json
[
  {
    "route": "/api/example",
    "method": "GET",
    "type": "proxy",
    "targetUrl": "https://example.com",
    "queryMapping": {
      "localParam": "externalParam"
    },
    "responseMapping": {
      "externalField": "localField"
    },
    "cache": {
      "enabled": true,
      "ttl": 3600
    }
  }
]
```
### **OpenGraph Metadata**
Example configuration for dynamic OpenGraph metadata:
```json
{
  "route": "/api/metadata",
  "method": "GET",
  "type": "metadata",
  "title": "Dynamic Title",
  "description": "Automatically configured OpenGraph description",
  "url": "https://yourdomain.com"
}
```

---

## **7. Advanced Features**
- **RAG Integration**: Supports AI-based Retrieval-Augmented Generation for intelligent responses.
- **Dynamic Rule Engine**: Evaluate business rules written in DSL and perform actions accordingly.
- **Universal API Client**: Standardized HTTP client for external API integrations.
- **Dynamic Plugin Management**: Load and manage plugins across clusters in real-time.
- **Extensive Logging and Monitoring**: Built-in tools for runtime insights.


## **8. Roadmap**
- Real-time WebSocket support.
- Advanced OpenGraph customization.
- Multi-tenancy support for shared configurations.
- Enhanced CLI tools for debugging and performance monitoring.
- Improved developer tools and scaffolding for faster development.

---

## **9. Contribution Guidelines**
- Fork the repository, make changes, and submit pull requests.
- Report bugs or suggest features via GitHub Issues.

---

## **10. License**
- Open source under the MIT license.

---

## **11. Support**
- Links to documentation and community forums.
- Contact via email or chat for technical support.

