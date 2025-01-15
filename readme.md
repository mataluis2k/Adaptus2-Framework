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

### **Basic Usage**
- Example setup:
  ```javascript
  const { Adaptus2Server } = require('adaptus2-framework');

  const app = new Adaptus2Server({
    port: 3000,
    configPath: './config/apiConfig.json',
  });

  app.start(() => {
    console.log('Adaptus2 Framework server is running on port 3000');
  });
  ```

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

---

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

