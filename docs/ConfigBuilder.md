# Database Configuration Builder - README

## Overview

The **Database Configuration Builder** is a tool designed to dynamically generate API configurations (`apiConfig.json`) based on a given database structure. This module supports a variety of databases, automatically extracting table details and relationships to create a flexible API structure that can be used with your backend server. It is intended to simplify the process of building GraphQL or REST APIs by leveraging the database schema as a source of truth.

## Supported Databases

The **Database Configuration Builder** currently supports:

- **MySQL**: Generates configuration from tables, columns, and foreign key relationships.
- **PostgreSQL**: Similar to MySQL, with support for foreign key extraction.
- **MongoDB**: Generates configuration from collections and sample documents, with no support for foreign key relationships.

## Key Features

- **Database Agnostic**: Works with MySQL, PostgreSQL, and MongoDB.
- **Automatic Schema Extraction**: Automatically extracts columns, types, and relationships (foreign keys).
- **Relationship Mapping**: Adds relationship definitions (`one-to-one` joins) for MySQL and PostgreSQL.
- **Access Control and Caching**: Allows setting access control lists (ACLs) and caching strategies.
- **Command-Line Configuration**: Supports command-line arguments for customizing ACL, overwriting existing configurations, and database connection.

## Installation

Clone the repository and install dependencies:

```bash
npm install
```

## Usage Instructions

### Generate API Configuration with Default Settings

To generate the `apiConfig.json` based on your database schema with default ACL (`publicAccess`):

```bash
node server.js -build
```

### Specify a Custom ACL

You can specify a custom **Access Control List (ACL)** by using the `--acl` flag. For example, to set the ACL to `privateAccess`:

```bash
node server.js -build --acl=privateAccess
```

If no ACL is provided, it defaults to **`publicAccess`**.

### Overwrite Existing Configuration

If `apiConfig.json` already exists and you wish to regenerate it, use the `-overwrite` or `-refresh` flag:

```bash
node server.js -build -overwrite
```

Without the overwrite flag, the script will prevent overwriting existing configurations and display an error.

## Configuration Details

### Generated API Configuration (`apiConfig.json`)

The generated configuration file (`apiConfig.json`) contains the following fields for each table or collection:

- **`dbType`**: Type of the database (`MySQL`, `PostgreSQL`, `MongoDB`).
- **`dbConnection`**: Name of the database connection.
- **`dbTable`**: Name of the table or collection.
- **`route`**: Endpoint route (`/api/{tableName}`).
- **`allowRead`**: Columns or fields allowed for read operations.
- **`allowWrite`**: Columns or fields allowed for write operations.
- **`acl`**: Access control level (`publicAccess` by default or user-defined).
- **`allowedMethods`**: Allowed HTTP methods (e.g., `GET`, `POST`, `PUT`, `DELETE`).
- **`cache`**: Caching strategy for the endpoint.
- **`columnDefinitions`**: Definitions for each column, including types (`Int`, `String`).
- **`relationships`**: Relationships between tables (for MySQL and PostgreSQL only).

Example configuration:

```json
{
  "dbType": "MySQL",
  "dbConnection": "MYSQL_1",
  "dbTable": "articles",
  "route": "/api/articles",
  "allowRead": ["id", "title", "content"],
  "allowWrite": ["title", "content"],
  "acl": "publicAccess",
  "allowedMethods": ["GET", "POST"],
  "cache": 1,
  "columnDefinitions": {
    "id": "Int",
    "title": "String",
    "content": "String"
  },
  "relationships": [
    {
      "type": "one-to-one",
      "relatedTable": "authors",
      "foreignKey": "author_id",
      "relatedKey": "id",
      "joinType": "LEFT JOIN",
      "fields": ["name", "bio", "profile_image"]
    }
  ]
}
```

## Use Cases

### 1. **Building APIs for MySQL or PostgreSQL Databases**

Automatically generate API configuration files for **MySQL** or **PostgreSQL** databases, including tables, columns, and relationships. Ideal for creating a REST or GraphQL API that reflects the current state of your relational database.

- **Foreign Key Support**: Relationships between tables are included, enabling easy construction of complex data queries with joins.

### 2. **MongoDB Collection Configuration**

Generate configurations for **MongoDB** collections, including fields in sample documents. While MongoDB does not have foreign key relationships, the tool still provides useful schema data for creating flexible APIs.

### 3. **Custom ACL and Endpoint Methods**

Configure **Access Control Lists** and **HTTP Methods** for each endpoint, which can be used to control who has access to which data, and how they can interact with it.

- **Use Case**: Creating public vs private APIs or limiting access to certain operations (e.g., read-only).

### 4. **Automated Configuration Refresh**

Use the **`-overwrite`** flag to refresh the configuration when database structures change, ensuring the API configuration remains up-to-date without manual intervention.

- **Use Case**: Adapting the generated APIs when the underlying database schema evolves.

## Example Scenarios

1. **API Generation for Relational Data**:
   - A developer wants to expose a **MySQL** database as a REST API, including relationships between `articles` and `authors`. By running the builder, the tool will generate endpoints for CRUD operations, including details about how articles relate to authors.

2. **Private API for Sensitive Data**:
   - A company is creating a private API for their **PostgreSQL** database, restricting access only to certain operations. The builder can be invoked with the `--acl=privateAccess` flag to ensure proper restrictions.

3. **Non-Relational API Configuration**:
   - An app needs to access a **MongoDB** collection and expose the document structure via an API. The builder will extract sample documents and generate a basic CRUD API for the collection.

## License

This project is licensed under the MIT License.

## Contributions

Contributions are welcome! If you find a bug or want to add new features, please feel free to open an issue or create a pull request.

## Contact

For any questions, please contact the project maintainer.

