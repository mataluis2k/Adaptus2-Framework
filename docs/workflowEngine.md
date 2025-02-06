# Workflow Engine Documentation

The Workflow Engine provides a powerful system for defining, scheduling, and executing business workflows. It supports both immediate execution and scheduled runs with recurring options.

## Table of Contents
- [Defining Workflows](#defining-workflows)
- [Workflow DSL Syntax](#workflow-dsl-syntax)
- [Scheduling Workflows](#scheduling-workflows)
- [Job Types](#job-types)
- [Integration Examples](#integration-examples)

## Defining Workflows

Workflows are defined using a Domain Specific Language (DSL) in the `config/workflowRules.dsl` file. Each workflow consists of a series of actions that will be executed in sequence.

### Basic Structure
```
WORKFLOW update_order_status
WITH mysql MYSQL_1 DO
    update order.status = "processing"
    send order to action.notify
    create_record audit to entity:audit_logs with data: {"event": "order_updated"}
```

## Workflow DSL Syntax

### Keywords
- `WORKFLOW`: Defines a new workflow
- `WITH`: Specifies the database connection
- `DO`: Marks the beginning of workflow actions

### Actions
The workflow engine supports several types of actions:

1. **Update Actions**
```
update entity.field = expression
```

2. **Send Actions**
```
send data to action.handler
```

3. **Create Record Actions**
```
create_record type to entity:table with data: {...}
```

## Scheduling Workflows

### Using the API

```javascript
const { WorkflowEngine } = require('./modules/workflowEngine');

// Initialize
const workflowEngine = new WorkflowEngine(parser, globalContext);
workflowEngine.loadWorkflows(dslText);

// Schedule a one-time workflow
await workflowEngine.scheduleWorkflow('update_order_status', {
    scheduleType: 'once',
    nextRun: new Date('2025-02-05 10:00:00'),
    data: {
        orderId: '12345',
        status: 'processing'
    }
});

// Schedule a recurring workflow
await workflowEngine.scheduleWorkflow('daily_cleanup', {
    scheduleType: 'recurring',
    cronExpression: '0 0 * * *', // Run daily at midnight
    nextRun: new Date(),
    data: {
        batchSize: 100
    }
});
```

### Cron Expression Format

The workflow engine uses standard cron expressions:

```
* * * * *
│ │ │ │ │
│ │ │ │ └── day of week (0-7, where 0 and 7 are Sunday)
│ │ │ └──── month (1-12)
│ │ └────── day of month (1-31)
│ └──────── hour (0-23)
└────────── minute (0-59)
```

Common patterns:
- `*/15 * * * *`: Every 15 minutes
- `0 * * * *`: Every hour
- `0 0 * * *`: Every day at midnight
- `0 0 * * MON`: Every Monday at midnight

## Job Types

### One-time Jobs
- Execute once at a specified time
- Status changes to 'completed' after execution
- Example use cases: Delayed order processing, scheduled notifications

```javascript
await workflowEngine.scheduleWorkflow('send_reminder', {
    scheduleType: 'once',
    nextRun: reminderDate,
    data: { userId: 123, message: 'Reminder content' }
});
```

### Recurring Jobs
- Execute repeatedly based on a cron schedule
- Status resets to 'pending' after each execution
- Example use cases: Daily reports, periodic cleanup tasks

```javascript
await workflowEngine.scheduleWorkflow('generate_daily_report', {
    scheduleType: 'recurring',
    cronExpression: '0 0 * * *',
    nextRun: new Date(),
    data: { reportType: 'sales' }
});
```

## Integration Examples

### With Business Rules

```javascript
// In your business rule action
async function scheduleOrderProcessing(context, data) {
    await workflowEngine.scheduleWorkflow('process_order', {
        scheduleType: 'once',
        nextRun: new Date(Date.now() + 30 * 60000), // 30 minutes from now
        data: {
            orderId: data.orderId,
            customerId: data.customerId
        }
    });
}
```

### With ETL Jobs

```javascript
// In your ETL module
async function scheduleDataSync() {
    await workflowEngine.scheduleWorkflow('sync_data', {
        scheduleType: 'recurring',
        cronExpression: '0 */4 * * *', // Every 4 hours
        data: {
            source: 'CRM',
            target: 'DataWarehouse'
        }
    });
}
```

### Error Handling

The workflow engine automatically handles errors and updates job status:

- Failed jobs are marked as 'failed' in the database
- Recurring jobs will attempt to run again at the next scheduled time
- Error details are logged for debugging

```javascript
try {
    await workflowEngine.executeWorkflow('risky_operation', data);
} catch (error) {
    console.error('Workflow failed:', error.message);
    // Job status is automatically updated to 'failed'
}
```

## Monitoring

You can monitor workflow execution through the workflow_schedules table:

```sql
SELECT workflow_name, status, next_run 
FROM workflow_schedules 
WHERE status = 'pending' 
ORDER BY next_run;
```

Status values:
- pending: Waiting to be executed
- running: Currently executing
- completed: Successfully finished (one-time jobs)
- failed: Execution failed
