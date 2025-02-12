# **📖 Workflow Engine User Guide**
## **How to Create, Configure, and Run Workflows Without Writing Code**

The **Workflow Engine** allows you to **define, schedule, and execute workflows** automatically, without requiring programming knowledge. You can set up **custom business processes**, automate tasks, and trigger actions based on events.

This guide will walk you through how to **create, schedule, and manage workflows** using **simple configurations**.

---

# **1️⃣ What is the Workflow Engine?**
The **Workflow Engine** enables you to automate business processes by defining **workflows** that contain **a series of actions**. These workflows can:
✅ **Run manually or on a schedule (e.g., hourly, daily, weekly)**.  
✅ **Trigger actions automatically when an event happens (e.g., user signup, payment received)**.  
✅ **Modify data, send notifications, update records, or trigger external services**.  
✅ **Handle errors and retries automatically**.  

---

# **2️⃣ How to Configure a Workflow**
Workflows are defined in **DSL (Domain-Specific Language)** format and stored in the file:  
📂 `config/workflows.dsl`

### **✅ Example Workflow Definition**
```text
WORKFLOW email_notification
WITH MYSQL MYSQL_1 DO
    update email_sent = true
    notify "An email has been sent to ${data.email}"
```

---

# **3️⃣ How to Set Up & Run a Workflow**
## **📌 Step 1: Define Your Workflow**
- **Edit** the `workflows.dsl` file to define the workflow logic.
- **Specify** the **database connection**, **conditions**, and **actions**.

## **📌 Step 2: Start the Workflow Engine**
No need to write code! Simply **start the service**:

```sh
node workflowEngine.js
```
✅ This will **load all defined workflows** and **schedule them automatically**.

## **📌 Step 3: Monitor Workflow Execution**
To check if workflows are running:

```sh
tail -f logs/workflow.log
```

You should see messages like:
```
Executing workflow: email_notification
Workflow email_notification completed successfully.
```

---

# **4️⃣ Understanding Workflow Configuration**
## **🛠️ Key Components of a Workflow**
Each workflow consists of:
| Field               | Description |
|---------------------|-------------|
| `WORKFLOW <name>`   | Defines the name of the workflow. |
| `WITH <DB_TYPE> <DB_CONNECTION> DO` | Specifies which database connection to use. |
| `update <field> = <value>` | Modifies a database field. |
| `notify "<message>"` | Sends a notification message. |

---

# **5️⃣ Applying Business Rules in Workflows**
You can add **rules to process business logic** inside workflows.

## **✅ Example: Automatically Approve High-Value Orders**
```text
WORKFLOW auto_approve_orders
WITH MYSQL MYSQL_1 DO
    update order_status = "approved"
    notify "Order ${data.order_id} approved automatically."
```
### **🔍 Explanation**
- When the workflow **runs**, it **updates `order_status` to "approved"**.
- It **sends a notification** about the approved order.

---

# **6️⃣ Scheduling Workflows Automatically**
### **⏳ How to Set Workflow Frequency**
Workflows can be scheduled to **run at specific intervals**.

## **✅ Example: Run a Workflow Every Hour**
Define a **workflow schedule** in the database by running:
```sh
node workflowEngine.js
```

📂 The workflow schedule is managed in **`workflow_schedules`** table.

| Frequency | Runs Every |
|-----------|-----------|
| `"30s"`   | Every 30 seconds |
| `"5m"`    | Every 5 minutes |
| `"1h"`    | Every hour |
| `"24h"`   | Every day |

---

# **7️⃣ Handling Errors & Retries**
The **Workflow Engine** automatically **detects errors** and **retries failed jobs**.

### **✅ What Happens if a Workflow Fails?**
1️⃣ If an **action fails**, it is **retried** up to 3 times.  
2️⃣ If **all retries fail**, the workflow is marked **as failed**.  
3️⃣ The error is logged, and **execution continues for other workflows**.

📌 **Example Log Message for a Failed Workflow**
```
Workflow auto_approve_orders failed.
Retrying in 5 seconds...
Workflow retry successful.
```

---

# **8️⃣ Running a Workflow Manually**
If you need to **trigger a workflow manually**, use:

```sh
node workflowEngine.js --run workflow_name
```

✅ This will **immediately execute** the specified workflow.

---

# **9️⃣ How to Monitor Workflow Performance**
To see **which workflows are running**, check the logs:

```sh
tail -f logs/workflow.log
```

You'll see messages like:
```
Executing workflow: customer_welcome_email
Workflow customer_welcome_email completed successfully.
```

---

# **🔟 Troubleshooting Common Issues**
### **🚨 Issue: Workflow is Not Running**
✅ Ensure `workflows.dsl` is correctly formatted.  
✅ Check if the **workflow name matches** when scheduling it.  
✅ Verify the **database connection** exists.  

### **🚨 Issue: Workflow Fails Repeatedly**
✅ Check logs for **error messages**.  
✅ Ensure **correct field names** are used in `update` statements.  

---

# **🎯 Summary: How to Use the Workflow Engine**
1️⃣ **Edit `workflows.dsl`** → Define workflows.  
2️⃣ **Start the Workflow Engine** → `node workflowEngine.js`.  
3️⃣ **Monitor logs** → `tail -f logs/workflow.log`.  
4️⃣ **Schedule workflows automatically** → No manual execution needed!  
5️⃣ **Manually run workflows when needed** → `node workflowEngine.js --run workflow_name`.  

🚀 **Now you can automate workflows effortlessly!** 🎯

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
