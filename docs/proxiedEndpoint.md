# Configuring Proxied Endpoints for `server2.js`

This guide explains how to configure and manage proxied endpoints for your `server2.js` application using the provided configuration system. Proxied endpoints allow your API server to forward requests to external APIs, enrich responses, and handle caching.

---

## Configuration Structure

Each proxy endpoint configuration must include the following properties:

### Mandatory Fields:
- **`type`**: Must be set to `"proxy"`.
- **`route`**: The endpoint exposed by your server (e.g., `/api/proxy/posts`).
- **`method`**: HTTP method (`GET`, `POST`, etc.) used to access the proxy.
- **`targetUrl`**: The external API URL the proxy forwards requests to.

### Optional Fields:
- **`queryMapping`**: Maps incoming query parameters to the external API's expected parameters.
- **`headers`**: Static headers to include in the forwarded request (e.g., `Authorization`).
- **`cache`**: Enables caching for responses with a Time-To-Live (`ttl`) in seconds.
  - Example:
    ```json
    "cache": {
      "enabled": true,
      "ttl": 600
    }
    ```
- **`enrich`**: Enriches the response data by querying internal APIs and appending additional fields.
  - Example:
    ```json
    "enrich": [
      {
        "route": "/api/authors",
        "key": "userId",
        "fields": ["name", "bio"]
      }
    ]
    ```
- **`responseMapping`**: Maps external API response fields to desired local names.

---

## Example Configuration

Here’s a complete example of proxy endpoint configurations:

```json
[
  {
    "type": "proxy",
    "route": "/api/proxy/posts",
    "method": "GET",
    "targetUrl": "https://jsonplaceholder.typicode.com/posts",
    "queryMapping": {
      "userId": "userId"
    },
    "headers": {
      "Authorization": "Bearer <token>"
    },
    "cache": {
      "enabled": true,
      "ttl": 600
    },
    "enrich": [
      {
        "route": "/api/authors",
        "key": "userId",
        "fields": ["name", "bio"]
      }
    ],
    "responseMapping": {
      "id": "postId",
      "title": "postTitle",
      "body": "postContent"
    }
  },
  {
    "type": "proxy",
    "route": "/api/proxy/users",
    "method": "GET",
    "targetUrl": "https://jsonplaceholder.typicode.com/users",
    "headers": {
      "Authorization": "Bearer <token>"
    },
    "cache": {
      "enabled": false
    },
    "responseMapping": {
      "id": "userId",
      "name": "fullName",
      "email": "contactEmail"
    }
  }
]
```

---

## Key Features

### Query Parameter Mapping
Use the `queryMapping` field to translate incoming query parameters into the expected parameters for the external API.

**Example:**
```json
"queryMapping": {
  "localKey": "externalKey"
}
```

Incoming `/api/proxy/posts?userId=1` maps `userId` to `userId` in the external API request.

---

### Headers
Add static headers to requests forwarded to the external API.

**Example:**
```json
"headers": {
  "Authorization": "Bearer <token>"
}
```

---

### Response Enrichment
The `enrich` field allows you to fetch additional information from internal APIs and append it to the response.

**Example:**
```json
"enrich": [
  {
    "route": "/api/authors",
    "key": "userId",
    "fields": ["name", "bio"]
  }
]
```
Each item in the external API response containing a `userId` will be enriched with the `name` and `bio` fields from `/api/authors`.

---

### Response Mapping
Transform the external API's response fields into a more user-friendly format.

**Example:**
```json
"responseMapping": {
  "id": "postId",
  "title": "postTitle",
  "body": "postContent"
}
```
An external API response of:
```json
{
  "id": 1,
  "title": "Test Post",
  "body": "This is the content."
}
```
Will be transformed into:
```json
{
  "postId": 1,
  "postTitle": "Test Post",
  "postContent": "This is the content."
}
```

---

## Enabling Caching
Caching helps improve performance by storing API responses temporarily. Configure it using the `cache` field.

**Example:**
```json
"cache": {
  "enabled": true,
  "ttl": 600
}
```
- **`enabled`**: Enable or disable caching.
- **`ttl`**: Time-to-Live (in seconds) for the cached response.

---

## Integration Steps

1. **Update Configuration File**:
   Add your proxy configurations to the `apiConfig.json` file.

2. **Register Proxy Endpoints**:
   Ensure the `registerProxyEndpoints` function in `server2.js` is called during server initialization:
   ```js
   this.registerProxyEndpoints();
   ```

3. **Start Server**:
   Run the server to expose the configured proxy endpoints.

---

## Testing Proxy Endpoints

1. Use a tool like Postman or `curl` to test your endpoint.
   **Example**:
   ```bash
   curl -X GET "http://localhost:3000/api/proxy/posts?userId=1"
   ```

2. Verify caching, enrichment, and response mapping in the API response.

---