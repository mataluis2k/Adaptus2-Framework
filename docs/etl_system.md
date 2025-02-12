# **📖 ETL Service User Guide**
## **How to Configure and Run ETL Jobs Without Writing Code**

The **ETL (Extract, Transform, Load) Service** allows you to **move data between databases**, **apply transformations**, and **automate jobs**—all without coding. This guide explains how to **configure, schedule, and manage ETL jobs** using simple configuration files.

---

# **1️⃣ What is the ETL Service?**
The **ETL Service** extracts data from a source (e.g., MySQL, PostgreSQL), transforms it (applying business rules), and loads it into a target database. It can also:
✅ Synchronize schemas between databases.  
✅ Apply **business rules** to transform data.  
✅ Process large datasets in **batches** to prevent slowdowns.  
✅ Run jobs **on a schedule** (e.g., every 5 minutes, hourly, daily).  
✅ Handle **errors and retries** automatically.

---

# **2️⃣ How to Configure an ETL Job**
Each ETL job is defined in a configuration file:  
📂 `config/etlConfig.json`

### **✅ Example ETL Job Configuration**
```json
[
  {
    "source_table": "users",
    "target_table": "customers",
    "keys": ["id"],
    "frequency": "5m",
    "transformations": [
      { "field": "full_name", "expression": "data.first_name + ' ' + data.last_name" },
      { "field": "created_at", "expression": "new Date().toISOString()" }
    ],
    "notifications": [
      { "condition": "data.account_status == 'suspended'", "message": "Suspended account detected: ${data.email}" }
    ]
  }
]
```

---

# **3️⃣ How to Set Up & Run an ETL Job**
## **📌 Step 1: Configure Your ETL Job**
- **Edit** the `etlConfig.json` file to define your job.
- **Specify** the source & target tables, scheduling frequency, and transformation rules.

## **📌 Step 2: Start the ETL Service**
No need to write any code! Simply **start the service**:

```sh
node etl_service.js
```
✅ The service will **automatically schedule jobs** based on the configuration.

## **📌 Step 3: Check Job Execution Logs**
To monitor the ETL job, **check the logs**:

```sh
tail -f logs/etl.log
```
You'll see messages like:

```
Starting ETL job for users -> customers
Processing 1000 records in batch
ETL job completed successfully.
```

---

# **4️⃣ Understanding the ETL Job Configuration**
## **🛠️ Key Components of `etlConfig.json`**
| Field              | Description |
|--------------------|-------------|
| `source_table`     | The table to extract data from. |
| `target_table`     | The table to load transformed data into. |
| `keys`             | The primary key(s) used to track updates. |
| `frequency`        | How often the job runs (`5m` = every 5 minutes, `1h` = hourly). |
| `transformations`  | Rules to modify data before loading it. |
| `notifications`    | Alerts for specific conditions (e.g., `account_status == 'suspended'`). |

---

# **5️⃣ Applying Business Rules to ETL Jobs**
The ETL service allows **custom transformations** using **Business Rules**.

## **✅ Example: Business Rules for Lead Conversion**
Create a **rules file** in 📂 `config/rules/users_rules.dsl`:

```text
IF UPDATE users WHEN data.account_status = "suspended" THEN
    notify "Suspended account detected: ${data.email}"
ELSE IF data.account_status = "active" THEN
    update last_active_date = new Date().toISOString()
```

### **How It Works**
✅ If `account_status = "suspended"`, send a **notification**.  
✅ If `account_status = "active"`, update `last_active_date`.  

💡 **Rules are applied automatically!** No manual intervention is needed.

---

# **6️⃣ Scheduling ETL Jobs**
### **⏳ How to Set Job Frequency**
Set the `frequency` field in `etlConfig.json`:

| Frequency | Runs Every |
|-----------|-----------|
| `"30s"`   | 30 seconds |
| `"5m"`    | 5 minutes |
| `"1h"`    | 1 hour |
| `"24h"`   | 1 day |

**Example:**  
To run an ETL job **every hour**, set:
```json
"frequency": "1h"
```

---

# **7️⃣ Error Handling & Retries**
The ETL service automatically **detects errors** and **retries failed jobs**.

### **✅ How the ETL Service Handles Failures**
1️⃣ If a record **fails validation**, it is **skipped** and logged.  
2️⃣ If the **database connection fails**, the job **waits and retries**.  
3️⃣ If an error occurs **3 times in a row**, the job is **marked as failed**.

📌 **Example Log Message for a Failed Job**
```
ETL job attempt 1 failed for users -> customers
Retrying in 2 seconds...
Retry successful after 1 attempts.
```

---

# **8️⃣ How to Monitor ETL Performance**
You can track **how many records were processed**, **error rates**, and **job execution time**.

## **✅ View ETL Metrics**
Each job logs **performance metrics**, such as:
```
ETL Job Metrics:
- Records Processed: 2,000
- Errors: 5
- Validation Errors: 2
- Execution Time: 12s
```

---

# **9️⃣ Manually Running an ETL Job**
If you need to **run a job immediately** without waiting for the schedule:

```sh
node etl_module.js
```
This will **process all configured ETL jobs** immediately.

---

# **🔟 Troubleshooting Common Issues**
### **🚨 Issue: No Data is Being Processed**
✅ Ensure `etlConfig.json` is correctly formatted.  
✅ Check database **connections** (`source_table`, `target_table`).  
✅ Verify **keys** exist in the tables.  

### **🚨 Issue: Errors in Transformation Rules**
✅ Check `config/rules/{table}_rules.dsl` for typos.  
✅ Ensure expressions (e.g., `data.first_name + ' ' + data.last_name'`) are **valid JavaScript**.  

---

# **🎯 Summary: How to Use the ETL Service**
1️⃣ **Edit `etlConfig.json`** → Define ETL jobs.  
2️⃣ **Start the ETL service** → `node etl_service.js`.  
3️⃣ **Monitor logs** → `tail -f logs/etl.log`.  
4️⃣ **Apply business rules** → Edit `rules/{table}_rules.dsl`.  
5️⃣ **Schedule jobs automatically** → No manual execution needed!  

🚀 **Now you can move, transform, and sync data across databases effortlessly!** 🎯