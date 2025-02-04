# Analytics Routes How-To Guide

This guide explains the purpose, configuration, and usage details of the Analytics Routes defined in the `analytics.js` file. It covers all available endpoints, explains the underlying logic, and provides tips for troubleshooting and further customization.

## Overview

The Analytics Routes module is built using Express and encapsulated within the `AnalyticsRoutes` class. It receives an `apiAnalytics` instance as a dependency which provides methods to retrieve various analytics data for endpoints. The class automatically registers its routes on an Express router.

## File Structure

- **File**: `src/routes/analytics.js`
- **Dependencies**:  
  - Express  
  - An instance of `apiAnalytics` that provides methods: `getEndpointAnalytics`, `getSlowQueries`, and `getCurrentRequestRate`, as well as access to a Redis client for key queries.

## Routes Configuration

The routes are set up in the `setupRoutes()` method of the `AnalyticsRoutes` class as follows:

### 1. GET `/endpoint/:method/:path(*)`

- **Purpose**: Retrieves analytics data for a specific API endpoint based on the HTTP method and path.
- **Parameters**:
  - `method`: The HTTP method (e.g., GET, POST).
  - `path`: The endpoint path (supports nested paths).
- **Functionality**: Calls `apiAnalytics.getEndpointAnalytics(method, path)` and returns the result as JSON.
- **Error Handling**: Returns a 500 status with a JSON error message if an exception occurs.

### 2. GET `/slow-queries`

- **Purpose**: Returns a report on slow queries.
- **Functionality**: Invokes `apiAnalytics.getSlowQueries()` to retrieve the slow queries report.
- **Error Handling**: Returns a 500 status with a JSON error message if an exception occurs.

### 3. GET `/rate/:method/:path(*)`

- **Purpose**: Retrieves the current request rate for a specified endpoint.
- **Parameters**:
  - `method`: The HTTP method for the endpoint.
  - `path`: The endpoint path.
- **Functionality**: Calls `apiAnalytics.getCurrentRequestRate(method, path)` and returns the current rate as JSON.
- **Error Handling**: Returns a 500 status with a JSON error message if an exception occurs.

### 4. GET `/health`

- **Purpose**: Provides overall API health metrics.
- **Functionality**:
  - Searches for Redis keys matching `endpoint:*` to gather endpoint identifiers.
  - For each endpoint, extracts the HTTP method and path.
  - Calls both `apiAnalytics.getEndpointAnalytics(method, path)` and `apiAnalytics.getCurrentRequestRate(method, path)` to fetch individual metrics.
  - Aggregates the results into a JSON object containing a timestamp and an array of endpoint metrics.
- **Response Example**:
  ```json
  {
    "timestamp": "2025-02-03T16:11:55.000Z",
    "endpoints": [
      {
        "endpoint": "GET /some/path",
        "analytics": { "metric1": "value", ... },
        "currentRate": { "rate": "value", ... }
      },
      ...
    ]
  }
  ```
- **Error Handling**: Returns a 500 status with a JSON error message if an exception occurs.

## Integration Steps

1. **Importing and Using the Route**:  
   In your Express application, import the `AnalyticsRoutes` class and instantiate it with an `apiAnalytics` object:
   ```javascript
   const AnalyticsRoutes = require('./routes/analytics');
   const analyticsRoutes = new AnalyticsRoutes(apiAnalytics);
   app.use('/analytics', analyticsRoutes.getRouter());
   ```

2. **apiAnalytics Dependency**:  
   Ensure that the `apiAnalytics` object provides the following:
   - `getEndpointAnalytics(method, path)`
   - `getSlowQueries()`
   - `getCurrentRequestRate(method, path)`
   - A Redis client accessible via `apiAnalytics.redis` for the health endpoint.

3. **Environment Setup**:  
   Verify that your Redis instance is properly configured and accessible. Implement appropriate error handling and logging within your analytics module as necessary.

## Testing and Troubleshooting

- **Testing the Endpoints**:  
  Use tools like Postman or cURL to test the endpoints.  
  Example test for endpoint analytics:
  ```
  GET /analytics/endpoint/GET/some/path
  ```

- **Troubleshooting Common Issues**:  
  - **500 Errors**: Examine the error messages returned in the JSON response to diagnose issues with the `apiAnalytics` methods or Redis connectivity.
  - **Data Accuracy**: Confirm that Redis is returning accurate key values for endpoints.
  - **Express Integration**: Ensure the analytics router is correctly registered in your Express app under the `/analytics` base path.

## Conclusion

This guide details how to integrate and utilize the Analytics Routes in your application. Follow the integration and testing steps to ensure that analytics data is properly captured and available, aiding in monitoring the health and performance of your API endpoints.
