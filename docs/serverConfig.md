# **Server Recipes Configuration Guide**

This guide explains how to create and structure recipes for your server. Recipes are JSON configurations that define how the server should behave, including authentication, routing, database interactions, API access control, and more.

---

## **Overview**

A recipe is a JSON object or an array of objects that configures:
1. Authentication and security
2. Routes for REST/GraphQL APIs
3. Database connections, table mappings, and CRUD permissions
4. Relationships and schema definitions
5. Advanced features like caching, machine learning (ML), and OpenGraph integration

Each recipe enables the server to dynamically build and expose endpoints.

---

## **Recipe Structure**

Each recipe is a JSON object with several attributes. Here's a breakdown of the fields:

### **1. Authentication**
Defines how users are authenticated to access the API.
- **`auth`**: Specifies the field for username or identifier.  
  Example: `"auth": "username"`
- **`authentication`**: Specifies the field for passwords or credentials.  
  Example: `"authentication": "password"`
- **`encryption`**: Defines the encryption method for stored credentials.  
  Example: `"encryption": "sha256"`

### **2. Routes and Database Mapping**
Specifies how routes connect to database tables.
- **`route`**: The endpoint for the API.  
  Example: `"route": "/api/login"`
- **`dbTable`**: The database table associated with this route.  
  Example: `"dbTable": "users"`

### **3. Permissions**
Defines which fields can be read or written and which methods are allowed.
- **`allowRead`**: Fields that can be fetched via GET requests.  
  Example: `"allowRead": ["id", "username", "role_id"]`
- **`allowWrite`**: Fields that can be updated via POST/PUT requests.  
  Example: `"allowWrite": ["title", "content", "image_url"]`
- **`allowMethods`**: HTTP methods permitted for this route.  
  Example: `"allowMethods": ["GET", "POST", "PUT", "DELETE"]`

### **4. Database Configuration**
Configures the database type, connection, and keys.
- **`dbType`**: Database type (e.g., MySQL, PostgreSQL).  
  Example: `"dbType": "mysql"`
- **`dbConnection`**: Database connection identifier.  
  Example: `"dbConnection": "MYSQL_1"`
- **`keys`**: Primary or unique keys for the table.  
  Example: `"keys": ["id"]`

### **5. Relationships**
Defines relationships between tables for JOIN operations.
- **`relationships`**: Array of relationship definitions.  
  Example: 
  ```json
  "relationships": [
    {
      "type": "one-to-one",
      "relatedTable": "authors",
      "foreignKey": "author_id",
      "relatedKey": "id",
      "joinType": "LEFT JOIN",
      "fields": ["name", "bio"]
    }
  ]
  ```

### **6. OpenGraph Mapping**
Defines fields for generating OpenGraph metadata.
- **`openGraphMapping`**: Maps table columns to OpenGraph tags.  
  Example: 
  ```json
  "openGraphMapping": {
    "og:title": "title",
    "og:description": "content",
    "og:image": "image_url",
    "og:url": "id"
  }
  ```

### **7. Column Definitions**
Describes the schema for the table, including data types.
- **`columnDefinitions`**: Maps field names to their database definitions.  
  Example: 
  ```json
  "columnDefinitions": {
    "id": "INT PRIMARY KEY AUTO_INCREMENT",
    "title": "VARCHAR(255)",
    "content": "TEXT"
  }
  ```

### **8. Machine Learning**
Specifies ML models to apply to the data.
- **`mlmodel`**: List of ML models to use.  
  Example: `"mlmodel": ["sentiment", "recommendation", "anomaly"]`

### **9. Access Control**
Defines API access levels.
- **`acl`**: Access control level (e.g., public or private).  
  Example: `"acl": "publicAccess"`

### **10. Caching**
Specifies caching rules for the endpoint.
- **`cache`**: Cache duration in seconds (0 for no caching).  
  Example: `"cache": 300`

---

## **Step-by-Step Recipe Creation**

### **Step 1: Define Authentication**
Include the `auth`, `authentication`, and `encryption` fields to secure your endpoints.

### **Step 2: Map Routes and Tables**
Choose a route (`/api/...`) and map it to a database table using the `dbTable` field.

### **Step 3: Set Permissions**
List fields allowed for reading and writing with `allowRead` and `allowWrite`. Specify HTTP methods in `allowMethods`.

### **Step 4: Configure Database**
Specify the `dbType` and `dbConnection`. Add primary keys to the `keys` field.

### **Step 5: Define Relationships**
If the table has related data, use the `relationships` field to specify joins.

### **Step 6: Add OpenGraph Metadata**
If applicable, map fields to OpenGraph tags using the `openGraphMapping` field.

### **Step 7: Add ML Models**
Specify any machine learning models to apply to the data.

### **Step 8: Test and Deploy**
Verify the recipe works as expected and deploy it to your server.

---

## **Example Recipes**

### **1. Login API**
```json
{
  "auth": "username",
  "authentication": "password",
  "encryption": "sha256",
  "allowRead": ["id", "username", "password", "role_id"],
  "route": "/api/login",
  "dbTable": "users"
}
```

### **2. Articles API**
```json
{
  "dbType": "mysql",
  "dbConnection": "MYSQL_1",
  "dbTable": "articles",
  "route": "/api/articles",
  "allowMethods": ["GET", "POST", "PUT", "DELETE"],
  "allowRead": ["id", "title", "content", "image_url", "author_id"],
  "allowWrite": ["title", "content", "image_url"],
  "keys": ["id"],
  "acl": "publicAccess",
  "cache": 0,
  "mlmodel": ["sentiment", "recommendation"],
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
    "author_id": "INT"
  },
  "relationships": [
    {
      "type": "one-to-one",
      "relatedTable": "authors",
      "foreignKey": "author_id",
      "relatedKey": "id",
      "joinType": "LEFT JOIN",
      "fields": ["name", "bio"]
    }
  ]
}
```
