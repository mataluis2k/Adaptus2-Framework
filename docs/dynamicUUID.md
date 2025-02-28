### **Feature: UUID-Based Key Obfuscation for API Endpoints**

#### **Overview**
This feature introduces an optional **UUID-based key obfuscation mechanism** for API endpoints in the `Adaptus2-Framework`. It enhances **security and data abstraction** by replacing database primary keys with dynamically generated **UUID v7** when returning responses. API clients interact using UUIDs instead of direct database keys, while the server maintains a **mapping system** to resolve UUIDs back to the original keys.

---

#### **Key Capabilities**
1. **Dynamic UUID Generation & Mapping**
   - When enabled, API responses replace primary keys with **UUID v7**.
   - A **UUID-to-key mapping** is stored in **Redis** (preferred) or an in-memory cache.
   - Expiration policies ensure **efficient memory usage**.

2. **Configurable Per Endpoint**
   - Controlled via `apiConfig.json` with the `"uuidMapping": true` option.
   - Can be globally enabled/disabled via an **environment variable**.

3. **Transparent Request Handling**
   - **GET requests** return obfuscated UUIDs instead of real keys.
   - **PUT, PATCH, DELETE requests** automatically resolve UUIDs back to real keys.
   - If `uuidMapping` is disabled, the system **defaults to standard key-based operations**.

4. **Performance & Scalability**
   - Uses **Redis** for fast key lookups across distributed API instances.
   - UUIDs are **temporary and auto-expire** to prevent unnecessary data persistence.

---

#### **Example Flow**
1. **Client Requests Data (`GET /api/authors`)**
   - Returns:
     ```json
     [
       {
         "uuid": "c20c1582-4b6d-11ee-883f-c723cf1c5c2e",
         "name": "John Doe",
         "bio": "Author and writer."
       }
     ]
     ```
   - The actual database ID (e.g., `42`) is mapped internally.

2. **Client Updates a Record (`PUT /api/authors/:uuid`)**
   - Client sends:
     ```json
     {
       "uuid": "c20c1582-4b6d-11ee-883f-c723cf1c5c2e",
       "name": "Johnathan Doe"
     }
     ```
   - The server resolves the UUID → **maps it to `id = 42`** → updates the database.

3. **Client Deletes a Record (`DELETE /api/authors/:uuid`)**
   - The server **looks up and removes the real record** while the UUID expires.

---

#### **Benefits**
✅ **Security:** Prevents exposing sequential or meaningful database keys.  
✅ **Flexibility:** Allows **selective adoption** per endpoint.  
✅ **Scalability:** Works seamlessly in **distributed API environments** via Redis.  
✅ **Transparency:** API consumers don’t need to handle key mappings manually.  

Would you like me to generate API documentation or integration guidelines for this? 🚀