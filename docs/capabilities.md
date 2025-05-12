### I. Core Server Features

- **Express.js Framework:**  
  Built on Express.js, a popular Node.js web framework that provides advanced routing, middleware handling, and request processing capabilities.

- **HTTP and WebSocket Server:**  
  Handles both standard HTTP requests and WebSocket connections for real-time communication.

- **Clustering and Plugin Management:**  
  Supports local and network-based plugin management for distributed deployments and dynamic plugin loading/unloading, facilitated via Redis for inter-process communication.

- **Security:**  
  - Uses Helmet for setting security headers.  
  - Implements rate limiting with `express-rate-limit`.  
  - Validates input using `Joi`.

- **Request Logging:**  
  Logs incoming and outgoing requests with details such as timestamps, response codes, durations, user IDs, IP addresses, and optionally request/response bodies (encrypted or unencrypted). All data is stored in a database, with a CLI command available to fetch complete logs.

- **Error Handling:**  
  Incorporates comprehensive error handling mechanisms with enhanced logging for unhandled rejections, uncaught exceptions, and other errors.

- **Configuration Management:**  
  - Loads configurations from `apiConfig.json` and `businessRules.dsl`, allowing dynamic adjustments without needing server restarts.  
  - Supports configuration reloading via the `SIGHUP` signal.  
  - Provides built-in config synchronization for clustered setups using Redis pub/sub.

- **CLI Socket Interface:**  
  Offers a socket server for CLI-based administrative tasks, including:  
  - Server version checking  
  - Request log retrieval  
  - Graceful server shutdown  
  - User and app token generation  
  - Configuration display and reload  
  - Plugin management (load, unload, reload, list)  
  - Route listing  
  - Configuration validation  
  - Listing of available actions

- **Redis Caching:**  
  Uses Redis for caching responses to reduce database load and improve performance. A CLI command is available to clear the Redis cache.

- **Database Connections:**  
  Supports multiple simultaneous database connections (e.g., MySQL, PostgreSQL, MongoDB, Snowflake) and allows dynamic table creation and initialization based on database type.

- **Authentication Middleware:**  
  Supports token-based authentication using JWT and OAuth2, with the ability to plug in custom authentication methods.

- **Access Control Middleware (ACL):**  
  Enforces role-based access control with fine-grained permission management and customizable error messages.

- **Multer File Upload:**  
  Provides file upload capabilities with support for custom storage options (e.g., disk or cloud storage).

- **UUID Generation:**  
  Utilizes `uuidv7` and Redis to generate deterministic UUIDs for primary keys, ensuring protection of original IDs.

- **External API Call Logging:**  
  Leverages Axios interceptors to log external API calls along with their durations and status codes.

- **Dynamic Routing:**  
  Supports both database-driven and configuration-driven dynamic route registration.

- **Static Routes:**  
  Allows configuration and management of static file serving routes.

- **GraphQL API:**  
  Automates the generation of GraphQL schema and resolvers based on the database configuration.

- **Console and File Logging:**  
  Employs Winston to log messages to both the console and files, with configurable log levels and exception handling.

---

### II. Modules

- **`apiConfig`:**  
  Loads and manages API configurations, including route categorization, custom type loading, and resource registration.

- **`db`:**  
  Manages database connections and CRUD operations (create, read, update, delete) for various systems, with functionality to initialize or create tables dynamically.

- **`business_rules`:**  
  Loads, parses, and applies business rules to process data prior to response generation. Supports complex conditional logic, calculations, and database interactions.

- **`ruleEngine`:**  
  Parses a custom Business Rules DSL to create and manage rules for data transformation and validation. Supports IF-THEN-ELSE logic, data manipulation, asynchronous jobs, and database queries.

- **`context`:**  
  Utilizes `AsyncLocalStorage` to manage request and plugin context data, maintaining global resources and actions.

- **`dynamicUUID`:**  
  Dedicated to handling UUID generation, mapping, and retrieval, ensuring original IDs are protected.

- **`genToken`:**  
  Generates JWT tokens with customizable expiry times, embedding user information and roles.

- **`rate_limit`:**  
  Implements rate limiting functionality to safeguard the server from abuse.

- **`generateGraphQLSchema`:**  
  Dynamically creates the GraphQL schema based on the API configuration and handles schema generation.

- **`chatModule`:**  
  Sets up a chat server using Socket.IO for real-time messaging, complete with database persistence, message receipts, and AI support via an integrated LLM module.

- **`ollamaModule`:**  
  Facilitates interactions with various language models using Ollama, including an AI query handler for chat functionality.

- **`streamingServer`:**  
  Handles video streaming and the generation of HLS playlists using fluent-ffmpeg, leveraging Redis and AWS S3 for caching and storage.

- **`requestLoggingMiddleware`:**  
  Custom middleware for enhanced logging of requests and responses into a database, with a CLI command for log retrieval.

- **`validationMiddleware`:**  
  A global middleware utilizing `Joi` for request validation.

- **`configSync`:**  
  Manages configuration synchronization across clustered server instances using Redis pub/sub.

- **`adminInterface`:**  
  Provides a basic administrative interface for browsing database tables.

- **`response`:**  
  A global object to manage responses from actions and the rule engine, with reset functionality to prevent inadvertent response overwriting.

- **`notification`:**  
  Centralizes the sending of notifications through multiple channels (email, SMS, push notifications).

- **`etl_module`:**  
  Handles ETL (Extract, Transform, Load) jobs with configurable batching, retry mechanisms, and schema synchronization.

- **`parseCommand`:**  
  Parses structured commands from strings to extract key-value pairs and data sections.

---

### III. Plugins

- **`facebookMarketingPlugin`:**  
  Sends custom events to the Facebook Marketing API for tracking purposes.

- **`dataNormalizationPlugin`:**  
  Normalizes datasets for machine learning, including scaling numerical data and one-hot encoding categorical variables.

- **`workoutRatingPlugin`:**  
  Manages the creation and updating of workout ratings.

- **`taxJarPlugin`:**  
  Retrieves tax information from the TaxJar API.

- **`googleAnalyticsPlugin`:**  
  Sends events to the Google Analytics 4 (GA4) Measurement Protocol.

- **`mergeTemplatePlugin`:**  
  Merges data with Handlebars templates to generate dynamic content.

- **`galleryPlugin`:**  
  Resizes images and uploads them to AWS S3.

- **`klaviyoPlugin`:**  
  Integrates with Klaviyo by adding customers to their mailing lists.

- **`githubWebhookPlugin`:**  
  Processes GitHub webhook events (specifically for pull request events) and automatically adds comments to new PRs.

- **`passwordResetLinkBuilder`:**  
  Generates and stores password reset links in a database.

- **`salesforcePushPlugin`:**  
  Pushes customer data to Salesforce.

- **`submitQuestionPlugin`:**  
  Handles the submission of questions to a database.

- **`teamsChatPlugin`:**  
  Integrates with Microsoft Teams for chat and notifications via Microsoft Graph API event subscriptions.

- **`slackChatPlugin`:**  
  Integrates with Slack for chat and notification functionalities.

- **`examplePlugin`:**  
  Provides a simple example demonstrating basic plugin structure and global context extension.

- **`contentDispatcherPlugin`:**  
  Loads, caches, and renders templated pages using Handlebars.

- **`offerTaxPlugin`:**  
  Fetches offers and applies TaxJar tax calculations.

- **`braintreePaymentPlugin`:**  
  Integrates with Braintree for processing payments.

- **`socialLoginPlugin`:**  
  Implements social login features using Google and Facebook OAuth2 strategies.

- **`mailgunPlugin`:**  
  Sends emails using the Mailgun API.

- **`catchAllWebhookPlugin`:**  
  Processes generic webhooks, validates payloads, and can insert data into specified tables, with dynamic table creation and audit logging.

- **`logoutPlugin`:**  
  Implements logout functionality with customizable strategies (client-side, blacklist, refresh token rotation).

- **`snowflakeAuditModule`:**  
  Analyzes Snowflake audit logs and notifies users of potential UI/UX issues, using OpenAI's codeLlama model to evaluate code changes.

- **`GoogleFitDataModule`:**  
  Processes health data from Google Fit.

- **`IHealthDataModule`:**  
  Manages data from IHealth devices.
