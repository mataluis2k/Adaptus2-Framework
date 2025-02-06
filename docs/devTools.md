# DevTools Documentation

The DevTools module provides a comprehensive set of utilities for development, testing, and API documentation in the Adaptus2 Framework. This document outlines the key features and usage of the DevTools class.

## Table of Contents
- [Installation](#installation)
- [Features](#features)
- [API Documentation](#api-documentation)
- [Usage Examples](#usage-examples)

## Installation

The DevTools class is part of the Adaptus2 Framework core modules. It requires the following dependencies:
```json
{
  "axios": "for HTTP requests",
  "winston": "for logging",
  "ajv": "for JSON Schema validation",
  "swagger-jsdoc": "for API documentation",
  "js-yaml": "for YAML processing"
}
```

## Features

### 1. API Documentation Generation
```javascript
const devTools = new DevTools();
await devTools.generateDocs();
```
Automatically generates OpenAPI/Swagger documentation from JSDoc comments in your code. The documentation is saved as YAML in the `docs/api-docs.yaml` file.

### 2. Endpoint Testing
```javascript
const result = await devTools.testEndpoint('GET', 'http://api.example.com/users', {
    headers: { 'Content-Type': 'application/json' },
    expectedStatus: 200,
    expectedSchema: userSchema
});
```
Features:
- HTTP method and URL testing
- Custom headers and payloads
- Response status validation
- JSON Schema validation
- Performance metrics (duration)
- Authentication support

### 3. Configuration Validation
```javascript
const result = await devTools.validateConfig('config.json', configSchema);
```
Validates JSON configuration files against a provided schema, ensuring configuration integrity.

### 4. Development Metrics
```javascript
const metrics = await devTools.getDevMetrics();
```
Provides real-time development metrics including:
- Memory usage
- CPU usage
- Uptime
- Environment details
- Node.js version information

### 5. Test Data Generation
```javascript
const testData = devTools.generateTestData({
    properties: {
        name: { type: 'string' },
        age: { type: 'number', minimum: 0, maximum: 120 },
        email: { type: 'string', format: 'email' }
    }
}, 5);
```
Generates mock data based on JSON Schema definitions, supporting:
- String generation (including email formats)
- Number generation with ranges
- Boolean values
- Arrays with min/max items
- Nested objects
- Enum values

### 6. Development Environment Checks
```javascript
const envCheck = await devTools.checkDevEnvironment();
```
Performs comprehensive environment checks:
- Node.js version verification
- Environment variables
- Required dependencies
- Configuration files presence
- Directory permissions
- Port availability

## API Documentation

### Class: DevTools

#### Constructor
```javascript
const devTools = new DevTools();
```
Initializes the DevTools instance with logging and schema validation capabilities.

#### Methods

##### `generateDocs()`
- **Purpose**: Generates API documentation
- **Returns**: Promise<Object> - Swagger specification object
- **Throws**: Error if documentation generation fails

##### `testEndpoint(method, url, options)`
- **Parameters**:
  - `method`: HTTP method (GET, POST, etc.)
  - `url`: Endpoint URL
  - `options`: Configuration object
    - `payload`: Request body
    - `headers`: Custom headers
    - `expectedStatus`: Expected response status
    - `expectedSchema`: JSON Schema for validation
    - `auth`: Bearer token
- **Returns**: Promise<Object> with test results

##### `validateConfig(configPath, schema)`
- **Parameters**:
  - `configPath`: Path to configuration file
  - `schema`: JSON Schema for validation
- **Returns**: Promise<Object> with validation results

##### `getDevMetrics()`
- **Returns**: Promise<Object> with system metrics

##### `generateTestData(schema, count)`
- **Parameters**:
  - `schema`: JSON Schema definition
  - `count`: Number of items to generate (default: 1)
- **Returns**: Array of generated test data

##### `checkDevEnvironment()`
- **Returns**: Promise<Object> with environment check results

## Usage Examples

### Complete API Testing Workflow
```javascript
const devTools = new DevTools();

// Generate API documentation
await devTools.generateDocs();

// Test an endpoint
const testResult = await devTools.testEndpoint('POST', '/api/users', {
    payload: {
        name: 'Test User',
        email: 'test@example.com'
    },
    expectedStatus: 201,
    expectedSchema: userSchema
});

// Validate configuration
const configValidation = await devTools.validateConfig('config/api.json', apiConfigSchema);

// Generate test data
const testUsers = devTools.generateTestData({
    properties: {
        name: { type: 'string' },
        email: { type: 'string', format: 'email' },
        age: { type: 'number', minimum: 18, maximum: 99 }
    }
}, 10);

// Check development environment
const envStatus = await devTools.checkDevEnvironment();
```

### Error Handling
```javascript
try {
    const result = await devTools.testEndpoint('GET', '/api/users');
    console.log('Test successful:', result);
} catch (error) {
    console.error('Test failed:', error.message);
}
```

## Best Practices

1. **Documentation Generation**
   - Keep JSDoc comments up-to-date
   - Run documentation generation before commits
   - Version control your API documentation

2. **Endpoint Testing**
   - Test both success and error scenarios
   - Include schema validation for critical endpoints
   - Monitor response times for performance issues

3. **Configuration Management**
   - Always validate configurations before deployment
   - Keep schemas updated with configuration changes
   - Use environment-specific configuration files

4. **Test Data**
   - Use realistic data ranges and formats
   - Include edge cases in test data
   - Maintain consistent test data across environments

5. **Environment Checks**
   - Run environment checks during application startup
   - Verify all required services are available
   - Keep port configurations updated
