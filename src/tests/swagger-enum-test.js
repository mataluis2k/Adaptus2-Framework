const generateSwaggerDoc = require('../modules/generateSwaggerDoc.js');

// Test configuration with enum fields
const testConfig = [
  {
    "routeType": "database",
    "dbType": "mysql",
    "dbConnection": "MYSQL_1",
    "dbTable": "test_table",
    "route": "/api/test",
    "allowMethods": ["GET", "POST"],
    "allowRead": ["id", "status", "user_type"],
    "allowWrite": ["status", "user_type"],
    "columnDefinitions": {
      "id": "INT PRIMARY KEY AUTO_INCREMENT",
      "status": "ENUM('active', 'inactive', 'pending')",
      "user_type": {
        "type": "string",
        "enum": ["admin", "user", "guest"],
        "description": "Type of user account"
      }
    }
  }
];

// Generate test documentation
generateSwaggerDoc(testConfig, './docs/test-api-docs.json');
console.log('Test documentation generated successfully');
