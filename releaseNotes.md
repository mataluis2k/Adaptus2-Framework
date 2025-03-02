# Relase Notes
## Going to try to keep this upto date to make it simpler to track changes and enhancements 

## As of March 2nd 2025

The ML analytics middleware has been enhanced to support detailed record responses for all model types:

**Recommendation Model:**

* Standard: `/ml/{table}/recommendation/{id}`
* Detailed: `/ml/{table}/recommendation/{id}?detailed=true`
    * Returns records with similarity scores attached as `'similarity_score'`

**Sentiment Analysis Model:**

* Standard: `/ml/{table}/sentiment`
* Detailed: `/ml/{table}/sentiment?detailed=true`
    * Returns records with:
        * `sentiment_score`: The calculated sentiment value
        * `sentiment_confidence`: Confidence level of the analysis
        * `word_count`: Number of words analyzed

**Anomaly Detection Model:**

* Standard: `/ml/{table}/anomaly`
* Detailed: `/ml/{table}/anomaly?detailed=true`
    * Returns records with:
        * `is_anomaly`: Always true for anomalous records
        * `anomaly_data`: The processed data that led to anomaly detection

Each model type now supports both the original ML response format and a detailed format that includes the actual database records with their respective ML attributes attached. The enhancement maintains backward compatibility while providing a more user-friendly option to get the actual records with their ML-derived attributes.

**Key improvements:**

* Consistent detailed response format across all model types
* Proper database connection handling with automatic release
* Error handling for database operations
* Preservation of model-specific statistics in responses
* Sorting and scoring maintained for all record types


## As of March 1st 2025
### Release Notes – [Version 2.1.64]

#### Overview

This release focuses on improving error handling, refining middleware configuration, enhancing caching strategies, and ensuring that business rules (DSL) remain synchronized across a clustered environment. These changes address several issues including unexpected application crashes when unsupported HTTP methods are invoked, misconfiguration of ACL parameters, and an over-aggressive cache flush on configuration reload.

---

#### Changes and Fixes

1. **Graceful Handling of Unsupported HTTP Methods**
   - **Issue:** The application was crashing with a "Cannot read properties of null (reading 'httpCode')" error when a DELETE request was executed—even though only GET was defined in the configuration.
   - **Fix:**  
     - Adjusted the route registration logic to ensure that only the HTTP methods explicitly specified in the configuration (e.g., "GET") are registered.
     - Provided a fallback in the ACL middleware for error configurations, ensuring that if a custom error configuration is null or missing its `httpCode`, a default `{ httpCode: 403, message: 'Access Denied' }` is used.
   - **Impact:** Requests for unsupported methods will now return a proper 404 or access-denied response without causing the application to crash.

2. **Refinement of ACL and aarMiddleware Configuration**
   - **Issue:** The middleware expected an ACL configuration as an array; however, the code was sending an object. This led to incorrect extraction of allowed roles and unintended access denials.
   - **Fix:**  
     - Updated the `aarMiddleware` function to handle both arrays and objects for the ACL configuration.  
     - The new logic extracts allowed roles from either an `acl` or `config` property and uses the `unauthorized` or `message` property for custom error messages.
   - **Impact:** This change ensures that the ACL middleware always receives a proper array of allowed roles and a valid error configuration, thereby reducing false negatives in access validation.

3. **Separation of Database Caching vs. Configuration Caching**
   - **Issue:** On configuration reload, the current implementation cleared the entire Redis cache (via `flushall()`), which inadvertently wiped out cached database records.
   - **Proposed Improvement (Less Intrusive Change):**  
     - Introduce distinct key prefixes for different caching domains. For instance, continue to use a key pattern like `cache:...` for database records while using a separate prefix (e.g., `config:`) for configuration data.
     - Implement a new function (e.g., `clearConfigCache()`) that only deletes Redis keys starting with the configuration prefix rather than flushing the entire cache.
   - **Impact:** Database query caching remains intact during a configuration reload, preserving performance and reducing unnecessary database hits.

4. **Business Rules Synchronization Across the Cluster**
   - **Issue:** Although API configuration was being propagated across the cluster, the business rules (DSL) used to initialize the RuleEngine were only loaded from disk on startup and were not synchronized.
   - **Fix:**  
     - Modified the configuration reload logic to check for an updated DSL text in the global context.
     - When a new DSL text is detected (i.e., `updatedConfig.globalContext.dslText` exists), the RuleEngine is reinitialized using `RuleEngine.fromDSL`, and both the `globalContext.ruleEngine` and `app.locals.ruleEngineMiddleware` are updated.
   - **Impact:** This ensures that business rules remain consistent across all nodes in the cluster. Any changes to the DSL (business rules) are propagated, so all instances operate with the same set of rules.

5. **Cluster Configuration Update Propagation**
   - **Enhancement:**  
     - When running in network mode (`PLUGIN_MANAGER === 'network'`), a “safe” copy of the global context (with the existing rule engine removed via a custom replacer) is broadcasted using `broadcastConfigUpdate`.
     - Nodes subscribe to configuration updates via `subscribeToConfigUpdates`, which not only updates the API configuration but also triggers the reinitialization of business rules if the DSL has changed.
   - **Impact:** This mechanism ensures that any configuration changes—including updates to business rules—are propagated to all cluster nodes, maintaining a consistent application state.

---

#### Summary

- **Error Handling:** Improved robustness by preventing crashes when unsupported HTTP methods are invoked and by ensuring a fallback error configuration in ACL middleware.
- **Middleware Configuration:** Enhanced `aarMiddleware` to correctly process ACL configuration objects, leading to more accurate access control.
- **Caching Strategy:** Proposed separation of configuration and database caching to avoid unnecessary cache wipes during config reloads.
- **Business Rules Synchronization:** Added cluster-wide propagation of business rule updates, ensuring consistency across nodes.
- **Cluster Communication:** Improved synchronization via Redis, enabling smooth configuration updates and business rules propagation in network mode.

These changes collectively improve the stability, performance, and consistency of the application, especially in a clustered deployment.



## As of Feb 24th 2025

Below are the release notes summarizing the fixes and improvements made today:

- **User Fingerprinting Improvement:**  
  Updated the fingerprint generation function to create a consistent identifier by excluding transient properties (iat/exp) and using a canonical JSON representation with sorted keys.

- **CommonJS Context Clarification:**  
  Clarified that when using CommonJS modules, you should call the fingerprint function directly (or bind it appropriately) rather than relying on `this`, preventing potential context issues.

- **SQL Parameter Binding Explanation:**  
  Investigated the "Incorrect arguments to mysqld_stmt_execute" error, explaining that it might be due to driver limitations or data type mismatches with parameterized LIMIT and OFFSET clauses.

- **Metadata JSON Parsing Fix:**  
  Fixed a JSON parsing error in the `listContent` function by checking if the metadata field is a string before calling `JSON.parse`, thus avoiding the "[object Object]" error.

- **Enhanced Route Listing:**  
  Updated the route listing functionality to use a new `getRoutes(app)` function. This function correctly traverses nested routers (such as those registered by the CMS module) so that all routes are visible.

- **CLI Integration Update:**  
  Integrated the new `getRoutes` function into the CLI command for listing routes, ensuring that the full set of registered routes (including nested ones) is returned as a well-formatted JSON string.

## As of Feb 23rd 2025

### Release Notes – Dynamic Route Handler Enhancements

#### New Features & Enhancements

- **Automatic WHERE Clause Injection:**  
  - Introduced a helper function to inspect the provided SQL query and automatically insert a dummy `WHERE 1=1` clause if none exists.  
  - This insertion is performed before key clauses such as `GROUP BY`, `ORDER BY`, or `LIMIT` to ensure that additional filters can be appended safely.

- **Improved UUID Mapping for Primary Keys:**  
  - Enhanced dynamic endpoints to support UUID masking by converting the primary key (as defined in the endpoint configuration) into a UUID using `uuidv7`.
  - **Reverse Mapping Implementation:**  
    - Added reverse mapping in Redis using keys in the format `uuidMapping:original:<originalId>`.  
    - Before generating a new UUID for a record, the system now checks if an existing UUID is already associated with the original ID. If found, it reuses the existing UUID instead of generating a new one.
  - This change minimizes duplicate UUID entries in Redis and optimizes memory usage on heavily used servers.

- **Robust Redis Initialization:**  
  - Updated the Redis initialization to load the connection string from `process.env.REDIS_URL` (with a fallback to `redis://localhost:6379`), ensuring that environment variables loaded via the `.env` file are available across all modules.

- **Enhanced Single-Record Query Handling:**  
  - When a record is requested using a UUID filter (e.g., `/api/pending-messages?id=<uuid>`), the system performs a lookup in Redis to convert the UUID back to the original primary key, ensuring correct and consistent data retrieval.

- **General Improvements:**  
  - Improved error handling and logging across the dynamic route handler.
  - Maintained consistency in response formatting and business logic processing.

These enhancements collectively improve the reliability, scalability, and maintainability of dynamic endpoints by ensuring proper SQL query structure, efficient UUID mapping, and optimal use of caching with Redis.