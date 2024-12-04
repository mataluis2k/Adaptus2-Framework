# Business Rules Manual for Dynamic Business Rules Module

This manual describes how to write effective business rules for the **Dynamic Business Rules Module**. The module supports different types of rules, including new capabilities to insert or update records and trigger asynchronous jobs. These features make it possible to track events like clicks or handle fulfillment processes when payments are made. This guide will walk you through writing these business rules and making full use of the new functionalities.

## Overview of Business Rule Types
The module supports the following business rule types:

1. **Conditional Rules (`IF <condition> THEN <action>`)**: Perform an action if a condition is met.
2. **Virtual Column Rules (`<field> = <expression>`)**: Compute values and assign them to fields.
3. **Database Insert Rules (`INSERT INTO <table> VALUES (<values>)`)**: Insert a record into a database when a condition is met.
4. **Database Update Rules (`UPDATE <table> SET <field> = <value> WHERE <condition>`)**: Update a record in the database.
5. **Async Job Trigger Rules (`TRIGGER <job_data>`)**: Trigger asynchronous tasks that are sent to a queue to be processed by a job daemon.

### 1. Conditional Rules
Conditional rules allow you to perform an action if a specified condition is met.

**Syntax**: 
```
IF <condition> THEN <action>
```

- `<condition>`: A JavaScript-like expression that evaluates to `true` or `false`.
- `<action>`: Can be an assignment, a database operation, or an asynchronous job trigger.

**Examples**:
- `IF price > 20 THEN discount = price * 0.1` 
  - If the `price` is greater than 20, apply a discount of 10%.
- `IF customer.vip_status == true THEN TRIGGER { type: 'sendEmail', to: customer.email, subject: 'Thank You!' }`
  - If the customer is a VIP, trigger an asynchronous job to send an email.

### 2. Virtual Column Rules
Virtual column rules allow computed values to be assigned to a specific field within the response.

**Syntax**:
```
<field> = <expression>
```

- `<field>`: The name of the field in the response.
- `<expression>`: A JavaScript-like expression to compute the value.

**Examples**:
- `tax = price * 0.067`
  - Calculates the tax based on a 6.7% rate and assigns it to `tax`.

### 3. Database Insert Rules
These rules allow inserting new records into a database when certain conditions are met.

**Syntax**:
```
INSERT INTO <table> VALUES (<values>)
```

- `<table>`: The name of the database table.
- `<values>`: The values to be inserted, using JavaScript expressions for dynamic data.

**Examples**:
- `INSERT INTO click_tracking VALUES (req.user.id, req.url, NOW())`
  - This inserts a record into the `click_tracking` table with the user ID, the URL they visited, and the current timestamp.

### 4. Database Update Rules
These rules allow updating an existing record in a database.

**Syntax**:
```
UPDATE <table> SET <field> = <value> WHERE <condition>
```

- `<table>`: The name of the database table.
- `<field>`: The field to update.
- `<value>`: The new value to set.
- `<condition>`: The condition to determine which records should be updated.

**Examples**:
- `UPDATE orders SET status = 'fulfilled' WHERE order_id = context.order_id`
  - Updates the `orders` table and sets the status to `fulfilled` for a specific order.

### 5. Async Job Trigger Rules
Async job trigger rules send data to an asynchronous queue for further processing, such as sending emails or fulfilling orders.

**Syntax**:
```
TRIGGER <job_data>
```

- `<job_data>`: A JavaScript-like object representing the data to be sent to the queue.

**Examples**:
- `TRIGGER { type: 'sendEmail', to: context.customer.email, subject: 'Order Confirmation', body: 'Your order has been confirmed.' }`
  - This sends an email asynchronously to the customer confirming their order.
- `TRIGGER { type: 'fulfillment', orderId: context.order_id, action: 'start' }`
  - This triggers an asynchronous job to start the fulfillment process for a specific order.

## Defining Rules Based on HTTP Methods
Business rules can be defined for specific HTTP methods (`GET`, `POST`, etc.) using the `events` attribute in the configuration.

**Example Configuration**:
```json
{
  "endpoint": "/api/orders",
  "events": ["POST"],
  "rules": [
    "IF req.body.payment_status == 'completed' THEN TRIGGER { type: 'fulfillment', orderId: req.body.order_id, action: 'start' }"
  ]
}
```
- This rule applies to the `/api/orders` endpoint for `POST` requests.
- If the payment status is `completed`, an asynchronous fulfillment job is triggered.

## Using the Middleware
The `BusinessRules` module provides middleware that can be used with an Express server to apply the business rules dynamically.

**Example Usage**:
```javascript
const BusinessRules = require('./business_rules');
const businessRules = new BusinessRules('./config/businessRules.json');

businessRules.loadRules();
app.use(businessRules.middleware());
```
- This will load the business rules from a JSON file and apply them dynamically to incoming requests.

## Practical Use Cases
1. **Click Tracking**: Insert click events into a tracking table whenever a user clicks a link.
   ```
   IF req.method == 'GET' THEN INSERT INTO click_tracking VALUES (req.user.id, req.url, NOW())
   ```

2. **Email Notifications**: Trigger an email notification after an order is successfully placed.
   ```
   IF req.body.order_status == 'confirmed' THEN TRIGGER { type: 'sendEmail', to: req.body.customer_email, subject: 'Order Confirmation', body: 'Thank you for your order.' }
   ```

3. **Order Fulfillment**: Update the status of an order and trigger an async fulfillment job.
   ```
   IF req.body.payment_status == 'paid' THEN UPDATE orders SET status = 'processing' WHERE order_id = req.body.order_id
   IF req.body.payment_status == 'paid' THEN TRIGGER { type: 'fulfillment', orderId: req.body.order_id, action: 'start' }
   ```

## Example Configurations
Here are three complete JSON configuration examples that use `TRIGGER`, `INSERT`, and `UPDATE` rules:

### Example 1: Triggering an Asynchronous Job
```json
{
  "endpoint": "/api/orders",
  "events": ["POST"],
  "rules": [
    "IF req.body.order_status == 'confirmed' THEN TRIGGER { type: 'sendEmail', to: req.body.customer_email, subject: 'Order Confirmation', body: 'Thank you for your order.' }"
  ]
}
```
- This configuration triggers an email notification when the order status is `confirmed`.

### Example 2: Inserting a Record into the Database
```json
{
  "endpoint": "/api/clicks",
  "events": ["GET"],
  "rules": [
    "INSERT INTO click_tracking VALUES (req.user.id, req.url, NOW())"
  ]
}
```
- This configuration inserts a click event into the `click_tracking` table whenever a `GET` request is made to the `/api/clicks` endpoint.

### Example 3: Updating a Record in the Database
```json
{
  "endpoint": "/api/orders",
  "events": ["POST"],
  "dbType": "MySQL",
  "dbConnection": "MYSQL_1",
  "rules": [
    "IF req.body.payment_status == 'paid' THEN UPDATE orders SET status = 'processing' WHERE order_id = req.body.order_id"
  ]
}
```
- This configuration updates the `orders` table, setting the status to `processing` if the payment status is `paid`.

## Summary
The **Dynamic Business Rules Module** allows you to define rules that can manipulate response data, interact with databases, or trigger asynchronous events. The newly added features for inserting or updating records and triggering async jobs provide powerful tools for automating workflows like click tracking, sending notifications, and handling order fulfillment. By leveraging this system, you can efficiently implement flexible business logic in a centralized and configurable manner.

