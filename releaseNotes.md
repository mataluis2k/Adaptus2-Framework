# Relase Notes
## Going to try to keep this upto date to make it simpler to track changes and enhancements 

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