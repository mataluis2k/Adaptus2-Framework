# **Analytics Framework Module - README**

## **Overview**
The **Analytics Framework Module** is a component designed to add machine learning capabilities to your API server. This module enables **sentiment analysis**, **recommendation systems**, **anomaly detection**, and **explainability** for configured database tables. It supports dynamic training and prediction through user-defined configuration.

---

## **Features**

1. **Sentiment Analysis**:
   - Analyzes text fields to determine sentiment scores.
   - **Example Use Case**: Sentiment of customer reviews.
   - **Key**: `sentiment`

2. **Recommendation Systems**:
   - Groups similar items using clustering.
   - **Example Use Case**: Product or content recommendations.
   - **Key**: `recommendation`

3. **Anomaly Detection**:
   - Detects unusual patterns in numeric data.
   - **Example Use Case**: Fraud detection or outlier identification.
   - **Key**: `anomaly`

4. **Explainability**:
   - Provides reasoning for predictions.
   - **Example Use Case**: Why a user belongs to a specific cluster.
   - **Key**: `explainability`

5. **Dynamic Endpoint Exposure**:
   - Each ML model is exposed via its own API endpoint for querying predictions.
   - **Key**: Automatically enabled for all specified models.

6. **Periodic Training**:
   - Models are retrained periodically via a scheduled cron job.
   - **Key**: Automatically enabled for all specified models.


---

## **Configuration**

### **1. ML Configuration File**
open the apiConfig.json file and to any object that you want to enable Machine Learning and they key "mlmodel" , 
and using array syntax and any ml logic that you want to attach to that object. 

* The system will automatically select the corresponding columns to train the models. 
* You can attached multiple ML logics to the same object.

```json
[
    {
        "dbType": "mysql",
        "dbConnection": "MYSQL_1",
        "dbTable": "articles",
        "route": "/api/articles",
        "allowRead": ["id", "title", "content", "image_url", "author_id"],
        "allowWrite": ["title", "content", "image_url"],
        "keys": ["id"],
        "mlmodel": ["sentiment", "recommendation", "anomaly", "explainability"],
        "columnDefinitions": {
            "id": "INT PRIMARY KEY AUTO_INCREMENT",
            "title": "VARCHAR(255)",
            "content": "TEXT",
            "image_url": "VARCHAR(255)",
            "author_id": "INT"
        }
    }
]
```

## **Usage**



### **2. API Endpoints**
Once configured, the module automatically creates ML endpoints. Example:

#### **Sentiment Analysis**
```bash
GET /api/articles/sentiment
```
Response:
```json
{
    "data": [
        { "id": 1, "sentiment": 0.8 },
        { "id": 2, "sentiment": -0.2 }
    ]
}
```

#### **Recommendations**
```bash
GET /api/articles/recommendation
```
Response:
```json
{
    "data": {
        "clusters": [[1, 2], [3, 4]],
        "numericFields": ["price", "rating"]
    }
}
```

#### **Anomaly Detection**
```bash
GET /api/articles/anomaly
```
Response:
```json
{
    "data": {
        "clusters": [[1, 3], [2, 4]],
        "numericFields": ["views", "shares"]
    }
}
```

#### **Explainability**
```bash
GET /api/articles/explainability
```
Response:
```json
{
    "data": {
        "explainability": "Example Explainability Data"
    }
}
```

---

## **Periodic Training**
The models are retrained daily at midnight:
```bash
0 0 * * *
```
To change the schedule, update the `scheduleTraining` method in `analytics_framework.js`:
```javascript
schedule.scheduleJob('0 6 * * *', () => {
    console.log('Training models at 6 AM...');
    analytics.trainModels();
});
```

## **Best Practices**
1. Keep training configurations minimal to avoid overloading the system.
2. Use Redis for caching predictions where possible.
3. Periodically review model performance and retrain as needed.

---

### README: Configuring the ML Module

This guide provides step-by-step instructions on configuring the ML module using a definition file to control training behaviors. The configuration file is JSON-based and allows you to set both default behaviors and endpoint-specific overrides.

---

### File Structure

Your configuration file should follow this structure:

```json
{
    "default": {
        "batchSize": 1000,
        "samplingRate": 1,
        "parallelProcessing": false,
        "incrementalTraining": false
    },
    "endpoints": {
        "products": {
            "batchSize": 2000,
            "incrementalTraining": true
        }
    }
}
```

---

### Configuration Fields

#### **`default` Section**
Specifies global defaults applied to all endpoints unless overridden. Fields include:

| Field               | Type    | Description                                                                                 | Default Value |
|---------------------|---------|---------------------------------------------------------------------------------------------|---------------|
| `batchSize`         | Integer | Number of rows processed in each batch during training.                                      | `1000`        |
| `samplingRate`      | Float   | Fraction of rows to sample for training. `1` means all rows, `0.1` means 10% of rows.        | `1`           |
| `parallelProcessing`| Boolean | Whether to train models for each endpoint in parallel.                                       | `false`       |
| `incrementalTraining`| Boolean| Whether to update existing models incrementally instead of retraining from scratch.          | `false`       |

#### **`endpoints` Section**
Overrides the default settings for specific endpoints. Each key in this section corresponds to a `dbTable` in your API configuration.

| Field               | Type    | Description                                                                                 | Default Value |
|---------------------|---------|---------------------------------------------------------------------------------------------|---------------|
| `batchSize`         | Integer | Overrides the default batch size for this endpoint.                                          | Inherits from `default` |
| `samplingRate`      | Float   | Overrides the default sampling rate for this endpoint.                                       | Inherits from `default` |
| `parallelProcessing`| Boolean | Overrides the default parallel processing behavior for this endpoint.                        | Inherits from `default` |
| `incrementalTraining`| Boolean| Overrides the default incremental training behavior for this endpoint.                       | Inherits from `default` |

---

### Example Configuration

#### Global Defaults
```json
"default": {
    "batchSize": 1000,
    "samplingRate": 0.5,
    "parallelProcessing": true,
    "incrementalTraining": false
}
```
- **Explanation:**
  - By default, each training process will use 50% of the dataset (`samplingRate: 0.5`).
  - Models are trained in parallel across endpoints (`parallelProcessing: true`).
  - Batch size is 1000 rows per batch.
  - Models are retrained from scratch (`incrementalTraining: false`).

#### Endpoint-Specific Configuration
```json
"endpoints": {
    "products": {
        "batchSize": 2000,
        "incrementalTraining": true
    }
}
```
- **Explanation:**
  - For the `products` table:
    - Uses a batch size of 2000 rows.
    - Updates models incrementally instead of retraining them completely (`incrementalTraining: true`).
    - Inherits `samplingRate: 0.5` and `parallelProcessing: true` from the `default` configuration.

---

### Applying the Configuration

1. **Create the Configuration File**
   Save the JSON configuration in a file, e.g., `mlConfig.json`.

2. **Set File Path in the ML Module**
   Ensure the file path is correctly referenced when initializing the ML module:
   ```javascript
   const mlAnalytics = new MLAnalytics('./config/apiConfig.json', './config/mlConfig.json');
   ```

3. **Load Configuration**
   The module automatically loads the configuration and applies the logic during training:
   ```javascript
   mlAnalytics.loadConfig();
   mlAnalytics.trainModels();
   ```

4. **Verify Logs**
   Check logs to ensure the configuration is being applied:
   - Global settings are applied unless an endpoint-specific configuration overrides them.
   - Warnings are logged if an endpoint is missing from the configuration.

---

### Advanced Tips

#### Validate Your Configuration
Run a JSON linter to ensure your configuration file is valid:
```bash
jsonlint mlConfig.json
```

#### Debugging
If training behaves unexpectedly:
- Verify that the endpoint exists in the `apiConfig.json`.
- Check the logs for messages about missing or invalid configurations.

#### Combining Sampling and Batching
If you use both `samplingRate` and `batchSize`, sampling reduces the dataset before batching. Ensure the sampled dataset size is large enough to accommodate meaningful batches.

---

### Example Output

For the above configuration:
```plaintext
Main configuration loaded successfully.
ML configuration loaded successfully.
Training models for products in batches of 2000...
Processing batch of 2000 rows for products...
Training recommendation model for products incrementally...
Recommendation model trained for products.
```
