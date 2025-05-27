# CRUD Endpoints Guide for Adaptus2 Platform

## Overview

Adaptus2 provides two main approaches for creating CRUD endpoints:
1. **Configuration-based** (via `apiConfig.json`) - Quick and simple
2. **Plugin-based** - For complex business logic

## Part 1: Configuration-Based CRUD Endpoints

### Basic Structure

CRUD endpoints are defined in `apiConfig.json` with the following structure:

```json
{
  "routeType": "database",
  "dbType": "mysql|postgresql|mongodb|snowflake",
  "dbConnection": "CONNECTION_NAME",
  "dbTable": "table_name",
  "route": "/api/resource",
  "allowMethods": ["GET", "POST", "PUT", "DELETE"],
  "allowRead": ["field1", "field2"],
  "allowWrite": ["field1", "field2"],
  "keys": ["id"],
  "acl": ["publicAccess|userAccess|adminAccess"],
  "auth": "token|basic|none",
  "cache": 0
}
```

### Example: Complete CRUD for Products

```json
{
  "routeType": "database",
  "dbType": "mysql",
  "dbConnection": "MYSQL_1",
  "dbTable": "products",
  "route": "/api/products",
  "allowMethods": ["GET", "POST", "PUT", "DELETE"],
  "allowRead": ["id", "name", "price", "stock", "description", "created_at", "updated_at"],
  "allowWrite": ["name", "price", "stock", "description"],
  "keys": ["id"],
  "acl": ["publicAccess"],
  "auth": "token",
  "cache": 300,
  "columnDefinitions": {
    "id": "INT PRIMARY KEY AUTO_INCREMENT",
    "name": "VARCHAR(255) NOT NULL",
    "price": "DECIMAL(10,2) NOT NULL",
    "stock": "INT DEFAULT 0",
    "description": "TEXT",
    "created_at": "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    "updated_at": "TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
  }
}
```

### Key Configuration Properties

#### 1. Route Type and Database
```json
{
  "routeType": "database",  // Required: "database" for CRUD operations
  "dbType": "mysql",        // Database type: mysql, postgresql, mongodb, snowflake
  "dbConnection": "MYSQL_1", // Connection name from .env file
  "dbTable": "products"      // Target database table
}
```

#### 2. HTTP Methods and Route
```json
{
  "route": "/api/products",
  "allowMethods": ["GET", "POST", "PUT", "DELETE"]  // Allowed HTTP methods
}
```

#### 3. Field Access Control
```json
{
  "allowRead": ["id", "name", "price", "stock"],  // Fields returned in GET requests
  "allowWrite": ["name", "price", "stock"],       // Fields allowed in POST/PUT
  "keys": ["id"]                                   // Primary key field(s)
}
```

#### 4. Authentication and ACL
```json
{
  "acl": ["publicAccess"],    // Access control levels
  "auth": "token"             // Authentication type: token, basic, none
}
```

### Advanced Features

#### 1. Rate Limiting
```json
{
  "rateLimit": {
    "requestsPerMinute": 20,
    "requestsPerHour": 1000
  }
}
```

#### 2. Caching
```json
{
  "cache": 300  // Cache GET responses for 300 seconds (0 = no cache)
}
```

#### 3. ML Model Integration
```json
{
  "mlmodel": ["sentiment", "recommendation", "anomaly", "rag"]
}
```

#### 4. Open Graph Mapping
```json
{
  "openGraphMapping": {
    "og:title": "title",
    "og:description": "content",
    "og:image": "image_url",
    "og:url": "id"
  }
}
```

#### 5. Validation Rules
```json
{
  "validationRules": {
    "name": {
      "type": "string",
      "required": true,
      "minLength": 3,
      "maxLength": 100
    },
    "price": {
      "type": "number",
      "required": true,
      "min": 0
    },
    "stock": {
      "type": "integer",
      "required": true,
      "min": 0
    }
  }
}
```

#### 6. Custom Business Logic
```json
{
  "businessLogic": "productsPlugin",  // Reference to a plugin
  "businessRules": "products.dsl"     // Reference to DSL rules file
}
```

### Complete Example: Articles API

```json
{
  "routeType": "database",
  "dbType": "mysql",
  "dbConnection": "MYSQL_1",
  "dbTable": "articles",
  "route": "/api/articles",
  "allowMethods": ["GET", "POST", "PUT", "DELETE"],
  "allowRead": ["id", "title", "content", "image_url", "author_id", "created_at", "updated_at"],
  "allowWrite": ["title", "content", "image_url", "author_id"],
  "keys": ["id", "title"],
  "acl": ["publicAccess"],
  "auth": "token",
  "cache": 0,
  "mlmodel": ["sentiment", "recommendation", "anomaly", "rag"],
  "openGraphMapping": {
    "og:title": "title",
    "og:description": "content",
    "og:image": "image_url",
    "og:url": "id"
  },
  "columnDefinitions": {
    "id": "INT PRIMARY KEY AUTO_INCREMENT",
    "title": "VARCHAR(255)",
    "content": "TEXT",
    "image_url": "VARCHAR(255)",
    "author_id": "INT",
    "created_at": "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    "updated_at": "TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
  },
  "rateLimit": {
    "requestsPerMinute": 20
  }
}
```

### Different Route Types

#### 1. Database Routes (CRUD)
```json
{
  "routeType": "database",
  "dbTable": "users",
  "route": "/api/users"
}
```

#### 2. Plugin Routes
```json
{
  "routeType": "plugin",
  "plugin": "customPlugin",
  "route": "/api/custom"
}
```

#### 3. Proxy Routes
```json
{
  "routeType": "proxy",
  "target": "https://external-api.com",
  "route": "/api/external"
}
```

#### 4. Static Routes
```json
{
  "routeType": "static",
  "staticPath": "./public",
  "route": "/static"
}
```

### ACL Options

- `publicAccess`: No authentication required
- `userAccess`: Requires valid JWT token
- `adminAccess`: Requires admin role in JWT
- Custom roles: Define in JWT payload



### Using Business Rules with CRUD

Create a `.dsl` file to add business logic:

```dsl
# products.dsl
IF POST /api/products THEN
  VALIDATE request.body.price > 0 WITH_ERROR "Price must be positive"
  SET request.body.created_at = NOW()
  LOG "New product created: " + request.body.name

IF PUT /api/products/:id THEN
  SET request.body.updated_at = NOW()
  TRIGGER async "updateInventory" WITH { productId: request.params.id }

IF DELETE /api/products/:id THEN
  CHECK_DB "SELECT COUNT(*) as count FROM orders WHERE product_id = ?" WITH [request.params.id]
  IF db_result.count > 0 THEN
    ABORT 400 "Cannot delete product with existing orders"
```

## API Usage Examples

### 1. GET - List All Records
```bash
curl http://localhost:3000/api/products
```

Response:
```json
[
  {
    "id": 1,
    "name": "Product 1",
    "price": 29.99,
    "stock": 100
  }
]
```

### 2. GET - Single Record
```bash
curl http://localhost:3000/api/products/1
```

### 3. POST - Create Record
```bash
curl -X POST http://localhost:3000/api/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "name": "New Product",
    "price": 19.99,
    "stock": 50
  }'
```

### 4. PUT - Update Record
```bash
curl -X PUT http://localhost:3000/api/products/1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "price": 24.99,
    "stock": 75
  }'
```

### 5. DELETE - Remove Record
```bash
curl -X DELETE http://localhost:3000/api/products/1 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Query Parameters

### Filtering
```bash
# Filter by field value
curl "http://localhost:3000/api/products?stock=100"

# Multiple filters
curl "http://localhost:3000/api/products?price=29.99&stock=100"
```

### Sorting
```bash
# Sort by field
curl "http://localhost:3000/api/products?_sort=price"

# Sort descending
curl "http://localhost:3000/api/products?_sort=-price"
```

### Pagination
```bash
# Page and limit
curl "http://localhost:3000/api/products?_page=1&_limit=10"
```

### Field Selection
```bash
# Select specific fields
curl "http://localhost:3000/api/products?_fields=id,name,price"
```

## Testing CRUD Endpoints

### Using Built-in Test Runner

Create `apiTests.json`:
```json
{
  "tests": [
    {
      "name": "Create Product",
      "endpoint": "/api/products",
      "method": "POST",
      "headers": {
        "Authorization": "Bearer ${TOKEN}"
      },
      "body": {
        "name": "Test Product",
        "price": 29.99,
        "stock": 100
      },
      "expectedStatus": 201
    },
    {
      "name": "Get Products",
      "endpoint": "/api/products",
      "method": "GET",
      "expectedStatus": 200
    }
  ]
}
```

Run tests:
```bash
node src/tests/apiTestRunner.js
```

## Best Practices

1. **Use appropriate ACL**: Match access control to operation sensitivity
2. **Limit exposed fields**: Only include necessary fields in `allowRead`
3. **Validate input**: Use `validationRules` for data integrity
4. **Enable caching**: For read-heavy endpoints
5. **Set rate limits**: Prevent API abuse
6. **Use column definitions**: For automatic table creation
7. **Document your API**: Use Swagger generation

## Troubleshooting

### Common Issues

1. **404 Not Found**: 
   - Check route path in `apiConfig.json`
   - Ensure `adaptus2 build` was run after changes

2. **401 Unauthorized**: 
   - Verify ACL settings
   - Check JWT token validity
   - Ensure auth type matches request

3. **500 Server Error**: 
   - Check database connection in .env
   - Verify table and column names
   - Check `allowRead`/`allowWrite` fields exist

4. **Validation errors**: 
   - Ensure request body matches `allowWrite` fields
   - Check `validationRules` if defined

### Debug Mode

Enable debug logging:
```bash
DEBUG=adaptus2:* npm run dev
```

Check logs:
```bash
tail -f my.log
```

## Next Steps

- For complex business logic, see Part 2: Plugin Development Guide
- Use business rules DSL for request/response transformations
- Implement webhooks for external integrations
- Add GraphQL support for flexible queries